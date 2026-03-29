diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/x-engagement.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/x-engagement.js
index 65ebdca..13ed074 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/x-engagement.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/x-engagement.js
@@ -423,6 +423,73 @@ async function uploadMediaToX(buffer, helpers) {
   return String(data.media_id_string);
 }
 
+// ---------------------------------------------------------------------------
+// Variable-frequency polling (W8 -- market-hours-aware)
+// ---------------------------------------------------------------------------
+
+/**
+ * Returns the polling interval in ms based on current New York time.
+ * Market hours (Mon-Fri 9:00-15:59 NY): 5 min
+ * Extended hours (Mon-Fri 16:00-19:59 NY): 15 min
+ * Overnight + weekends: 60 min
+ *
+ * Both `h` and `day` are derived from the same TZ-normalized Date so DST
+ * transitions are handled correctly. Using now.getDay() / now.getHours()
+ * directly would use the server's UTC offset, causing misclassification at
+ * day boundaries (e.g. 00:30 UTC Monday = 19:30 EST Sunday).
+ *
+ * @param {Date} [now=new Date()] - Injectable for testing
+ * @returns {number} Interval in milliseconds
+ */
+function getCurrentPollingInterval(now) {
+  if (!now) now = new Date();
+  var nyDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
+  var h   = nyDate.getHours();
+  var day = nyDate.getDay(); // 0=Sun, 6=Sat -- in NY time
+
+  if ([1, 2, 3, 4, 5].indexOf(day) !== -1 && h >= 9 && h < 16)
+    return 5 * 60 * 1000;   // market hours: Mon-Fri 9:00-15:59 NY
+  if ([1, 2, 3, 4, 5].indexOf(day) !== -1 && h >= 16 && h < 20)
+    return 15 * 60 * 1000;  // extended hours: Mon-Fri 16:00-19:59 NY
+  return 60 * 60 * 1000;    // overnight + weekends
+}
+
+/**
+ * Orchestrates the skip-check logic for W8 polling cycle.
+ * Reads X_State.last_run, skips if insufficient time has elapsed,
+ * otherwise patches last_run BEFORE engagement and polling_interval AFTER.
+ *
+ * @param {object} opts
+ * @param {number}   [opts.nowMs]            - Current epoch ms (injectable, defaults to Date.now())
+ * @param {function} opts.nocodbGetState     - async () => { last_run: <ms> }
+ * @param {function} opts.nocodbPatchState   - async (fields) => void
+ * @param {function} opts.runEngagement      - async () => void
+ * @returns {Promise<{ skipped: boolean, elapsed: number, interval: number }>}
+ */
+async function runXPollingCycle(opts) {
+  var nowMs = (opts && opts.nowMs != null) ? opts.nowMs : Date.now();
+  var interval = getCurrentPollingInterval(new Date(nowMs));
+
+  var state = await opts.nocodbGetState();
+  var lastRun = (state && state.last_run) ? Number(state.last_run) : 0;
+  var elapsed = nowMs - lastRun;
+
+  if (elapsed < interval) {
+    return { skipped: true, elapsed: elapsed, interval: interval };
+  }
+
+  // PATCH last_run BEFORE engagement to prevent concurrent re-entry
+  await opts.nocodbPatchState({ last_run: nowMs });
+
+  // Run the engagement flow
+  await opts.runEngagement();
+
+  // PATCH polling_interval AFTER engagement (for observability in X_State)
+  await opts.nocodbPatchState({ polling_interval: interval });
+
+  return { skipped: false, elapsed: elapsed, interval: interval };
+}
+
 module.exports = {
   filterRelevant: filterRelevant,
   draftReply: draftReply,
@@ -437,4 +504,6 @@ module.exports = {
   buildEngagementSequence: buildEngagementSequence,
   maybeAttachMedia: maybeAttachMedia,
   uploadMediaToX: uploadMediaToX,
+  getCurrentPollingInterval: getCurrentPollingInterval,
+  runXPollingCycle: runXPollingCycle,
 };
diff --git a/ryan_cole/insiderbuying-site/n8n/tests/x-engagement.test.js b/ryan_cole/insiderbuying-site/n8n/tests/x-engagement.test.js
index 2dd7cb8..a337e0b 100644
--- a/ryan_cole/insiderbuying-site/n8n/tests/x-engagement.test.js
+++ b/ryan_cole/insiderbuying-site/n8n/tests/x-engagement.test.js
@@ -15,6 +15,8 @@ const {
   buildEngagementSequence,
   maybeAttachMedia,
   uploadMediaToX,
+  getCurrentPollingInterval,
+  runXPollingCycle,
 } = require('../code/insiderbuying/x-engagement.js');
 
 // ---------------------------------------------------------------------------
@@ -735,3 +737,176 @@ describe('uploadMediaToX', () => {
     assert.equal(result, '1234567890123456789');
   });
 });
+
+// ---------------------------------------------------------------------------
+// getCurrentPollingInterval -- timezone correctness
+// All dates use winter (EST = UTC-5) unless noted.
+// 2024-01-08 = Monday, 2024-01-12 = Friday, 2024-01-13 = Saturday
+// ---------------------------------------------------------------------------
+describe('getCurrentPollingInterval', () => {
+  it('Monday 10:00 AM NY -> 5 * 60 * 1000 (market hours)', () => {
+    // 2024-01-08 15:00 UTC = 10:00 EST
+    const d = new Date('2024-01-08T15:00:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 5 * 60 * 1000);
+  });
+
+  it('Monday 10:00 AM NY expressed as UTC 15:00 -> same result (TZ normalization)', () => {
+    const d = new Date('2024-01-08T15:00:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 5 * 60 * 1000);
+  });
+
+  it('Friday 17:00 NY (extended hours, after market close) -> 15 * 60 * 1000', () => {
+    // 2024-01-12 22:00 UTC = 17:00 EST
+    const d = new Date('2024-01-12T22:00:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 15 * 60 * 1000);
+  });
+
+  it('Friday 21:00 NY (overnight) -> 60 * 60 * 1000', () => {
+    // 2024-01-13 02:00 UTC = Friday 21:00 EST (21 >= 20, so not extended hours)
+    const d = new Date('2024-01-13T02:00:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 60 * 60 * 1000);
+  });
+
+  it('Saturday 14:00 NY -> 60 * 60 * 1000 (weekend)', () => {
+    // 2024-01-13 19:00 UTC = Saturday 14:00 EST
+    const d = new Date('2024-01-13T19:00:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 60 * 60 * 1000);
+  });
+
+  it('TZ regression: 00:30 UTC Monday (= 19:30 EST Sunday) -> 60 * 60 * 1000, NOT weekday', () => {
+    // Without TZ normalization, getDay() returns 1 (Monday UTC) and h=0 -> still 60 min overnight.
+    // The real bug would be if the code used UTC day=1 + some UTC hour in extended range.
+    // With toLocaleString TZ normalization: day=0 (Sunday NY), so correctly returns 60 min.
+    const d = new Date('2024-01-08T00:30:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 60 * 60 * 1000);
+  });
+
+  it('DST spring-forward Sunday 2024-03-10 ~2:00 AM NY -> 60 * 60 * 1000 (weekend)', () => {
+    // 2024-03-10 07:00 UTC ~ 2:00 AM EST on spring-forward Sunday
+    const d = new Date('2024-03-10T07:00:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 60 * 60 * 1000);
+  });
+
+  it('Monday 9:00 AM NY (boundary open) -> 5 * 60 * 1000', () => {
+    // 2024-01-08 14:00 UTC = 9:00 EST (h=9, start of market hours)
+    const d = new Date('2024-01-08T14:00:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 5 * 60 * 1000);
+  });
+
+  it('Monday 8:59 AM NY (before market) -> 60 * 60 * 1000', () => {
+    // 2024-01-08 13:59 UTC = 8:59 EST (h=8, before market hours)
+    const d = new Date('2024-01-08T13:59:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 60 * 60 * 1000);
+  });
+
+  it('Monday 19:59 NY (last minute extended hours) -> 15 * 60 * 1000', () => {
+    // 2024-01-09 00:59 UTC = Monday 19:59 EST (h=19, still extended hours)
+    const d = new Date('2024-01-09T00:59:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 15 * 60 * 1000);
+  });
+
+  it('Monday 20:00 NY (overnight starts) -> 60 * 60 * 1000', () => {
+    // 2024-01-09 01:00 UTC = Monday 20:00 EST (h=20, overnight)
+    const d = new Date('2024-01-09T01:00:00.000Z');
+    assert.equal(getCurrentPollingInterval(d), 60 * 60 * 1000);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Skip logic ordering (runXPollingCycle)
+// ---------------------------------------------------------------------------
+describe('skip logic ordering', () => {
+  it('elapsed < pollingInterval -> engagement function NOT called', async () => {
+    // Monday 10:00 AM NY = 5-min interval; last_run is only 4 min ago
+    const nowMs = new Date('2024-01-08T15:00:00.000Z').getTime();
+    const interval = 5 * 60 * 1000;
+    const lastRun = nowMs - (interval - 1000); // 1 second short of interval
+
+    let engagementCalled = false;
+    const result = await runXPollingCycle({
+      nowMs,
+      nocodbGetState: async () => ({ last_run: lastRun }),
+      nocodbPatchState: async () => {},
+      runEngagement: async () => { engagementCalled = true; },
+    });
+
+    assert.equal(engagementCalled, false, 'engagement must not be called when not enough time elapsed');
+    assert.equal(result.skipped, true);
+  });
+
+  it('elapsed >= pollingInterval -> last_run PATCH called BEFORE engagement', async () => {
+    const nowMs = new Date('2024-01-08T15:00:00.000Z').getTime();
+    const interval = 5 * 60 * 1000;
+    const lastRun = nowMs - interval; // exactly at interval (elapsed === interval)
+
+    const callLog = [];
+    await runXPollingCycle({
+      nowMs,
+      nocodbGetState: async () => ({ last_run: lastRun }),
+      nocodbPatchState: async (fields) => { callLog.push({ patch: Object.assign({}, fields) }); },
+      runEngagement: async () => { callLog.push({ engagement: true }); },
+    });
+
+    const patchIdx = callLog.findIndex(function(e) { return e.patch && e.patch.last_run !== undefined; });
+    const engagementIdx = callLog.findIndex(function(e) { return e.engagement === true; });
+
+    assert.ok(patchIdx !== -1, 'last_run PATCH was never called');
+    assert.ok(engagementIdx !== -1, 'engagement was never called');
+    assert.ok(patchIdx < engagementIdx, 'last_run PATCH must occur before engagement (patchIdx=' + patchIdx + ', engagementIdx=' + engagementIdx + ')');
+  });
+
+  it('after engagement -> polling_interval PATCH called with correct interval', async () => {
+    const nowMs = new Date('2024-01-08T15:00:00.000Z').getTime(); // Monday 10:00 NY = 5 min
+    const interval = 5 * 60 * 1000;
+    const lastRun = nowMs - interval;
+
+    const patches = [];
+    await runXPollingCycle({
+      nowMs,
+      nocodbGetState: async () => ({ last_run: lastRun }),
+      nocodbPatchState: async (fields) => { patches.push(Object.assign({}, fields)); },
+      runEngagement: async () => {},
+    });
+
+    const pollingPatch = patches.find(function(p) { return p.polling_interval !== undefined; });
+    assert.ok(pollingPatch, 'polling_interval PATCH was never called');
+    assert.equal(pollingPatch.polling_interval, interval);
+  });
+
+  it('polling_interval PATCH occurs after engagement completes', async () => {
+    const nowMs = new Date('2024-01-08T15:00:00.000Z').getTime();
+    const interval = 5 * 60 * 1000;
+    const lastRun = nowMs - interval;
+
+    const callLog = [];
+    await runXPollingCycle({
+      nowMs,
+      nocodbGetState: async () => ({ last_run: lastRun }),
+      nocodbPatchState: async (fields) => { callLog.push({ patch: Object.assign({}, fields) }); },
+      runEngagement: async () => { callLog.push({ engagement: true }); },
+    });
+
+    const engagementIdx = callLog.findIndex(function(e) { return e.engagement === true; });
+    const pollingPatchIdx = callLog.findIndex(function(e) { return e.patch && e.patch.polling_interval !== undefined; });
+
+    assert.ok(engagementIdx !== -1, 'engagement not called');
+    assert.ok(pollingPatchIdx !== -1, 'polling_interval PATCH not called');
+    assert.ok(engagementIdx < pollingPatchIdx, 'polling_interval PATCH must come after engagement');
+  });
+
+  it('skipped execution does not call nocodbPatchState', async () => {
+    const nowMs = new Date('2024-01-08T15:00:00.000Z').getTime();
+    const interval = 5 * 60 * 1000;
+    const lastRun = nowMs - 30000; // 30 seconds ago, much less than 5 min
+
+    let patchCalled = false;
+    await runXPollingCycle({
+      nowMs,
+      nocodbGetState: async () => ({ last_run: lastRun }),
+      nocodbPatchState: async () => { patchCalled = true; },
+      runEngagement: async () => {},
+    });
+
+    assert.equal(patchCalled, false, 'nocodbPatchState must not be called on skip');
+  });
+});
