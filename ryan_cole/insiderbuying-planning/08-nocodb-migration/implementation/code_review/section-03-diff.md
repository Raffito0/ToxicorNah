diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js
index b0c476d..0d216cb 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js
@@ -21,10 +21,9 @@ const FD_BASE_URL = 'https://api.financialdatasets.ai';
 
 // Required environment variables
 const REQUIRED_ENV = [
-  'AIRTABLE_API_KEY',
-  'AIRTABLE_BASE_ID',
-  'INSIDER_ALERTS_TABLE_ID',
-  'MONITOR_STATE_TABLE_ID',
+  'NOCODB_API_TOKEN',
+  'NOCODB_BASE_URL',
+  'NOCODB_PROJECT_ID',
   'FINANCIAL_DATASETS_API_KEY',
   'SUPABASE_URL',
   'SUPABASE_SERVICE_ROLE_KEY',
@@ -153,50 +152,80 @@ function generateUUID() {
 }
 
 // ---------------------------------------------------------------------------
-// Async: Airtable — fetch existing dedup keys (past 7 days)
+// Async: NocoDB — fetch existing dedup keys (past 7 days)
 // ---------------------------------------------------------------------------
 
 /**
- * Returns a Set<string> of dedup_key values from Airtable Insider_Alerts
- * for the past 7 days. Handles Airtable pagination.
+ * Returns a Set<string> of dedup_key values from NocoDB Insider_Alerts
+ * for the past 7 days. Handles NocoDB offset pagination.
  *
  * @param {Object} opts
- * @param {string} opts.baseId
- * @param {string} opts.tableId
- * @param {string} opts.apiKey
- * @param {Function} opts.fetchFn  — injectable for tests
+ * @param {Object} opts.nocodb  — NocoDB client instance
  */
 async function fetchDedupKeys(opts = {}) {
-  const { baseId, tableId, apiKey, fetchFn } = opts;
+  const { nocodb } = opts;
   const keys = new Set();
 
   const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
     .toISOString()
     .split('T')[0];
-  const formula = `IS_AFTER({filing_date}, '${sevenDaysAgo}')`;
-
-  let offset = null;
-  do {
-    const params = new URLSearchParams({ filterByFormula: formula });
-    if (offset) params.set('offset', offset);
-    const url = `https://api.airtable.com/v0/${baseId}/${tableId}?${params.toString()}`;
-
-    const res = await fetchFn(url, {
-      headers: { Authorization: `Bearer ${apiKey}` },
+  const where = `(filing_date,gt,${sevenDaysAgo})`;
+
+  const LIMIT = 100;
+  let offset = 0;
+  let isLastPage = false;
+
+  while (!isLastPage) {
+    const { list, pageInfo } = await nocodb.list('Insider_Alerts', {
+      where,
+      sort: '-Id',
+      fields: 'dedup_key',
+      limit: LIMIT,
+      offset,
     });
-    const data = await res.json();
-
-    for (const record of (data.records || [])) {
-      const key = record.fields && record.fields.dedup_key;
+    for (const record of (list || [])) {
+      const key = record.dedup_key;
       if (key != null) keys.add(key);
     }
-
-    offset = data.offset || null;
-  } while (offset);
+    isLastPage = pageInfo && pageInfo.isLastPage;
+    offset += LIMIT;
+  }
 
   return keys;
 }
 
+// ---------------------------------------------------------------------------
+// Async: NocoDB — Monitor_State read/write helpers
+// ---------------------------------------------------------------------------
+
+/**
+ * Read the Monitor_State record for a given workflow name.
+ * Returns the record (with integer Id) or null if not found.
+ *
+ * @param {string} stateName  e.g. 'market'
+ * @param {Object} opts
+ * @param {Object} opts.nocodb
+ */
+async function readMonitorState(stateName, opts) {
+  const { nocodb } = opts;
+  const where = `(name,eq,${stateName})`;
+  const result = await nocodb.list('Monitor_State', { where, limit: 1 });
+  return (result.list && result.list[0]) || null;
+}
+
+/**
+ * Write the last_check_timestamp back to Monitor_State.
+ *
+ * @param {number} stateId    NocoDB integer Id of the record
+ * @param {string} timestamp  ISO 8601 timestamp string
+ * @param {Object} opts
+ * @param {Object} opts.nocodb
+ */
+async function writeMonitorState(stateId, timestamp, opts) {
+  const { nocodb } = opts;
+  await nocodb.update('Monitor_State', stateId, { last_check_timestamp: timestamp });
+}
+
 // ---------------------------------------------------------------------------
 // Async: SEC — load CIK ticker map
 // ---------------------------------------------------------------------------
@@ -409,35 +438,27 @@ async function detectCluster(ticker, transactionDate, currentInsiderName, opts =
 async function runSecMonitor(input, helpers) {
   const fetchFn = helpers && helpers.fetchFn;
   const env = (helpers && helpers.env) || {};
+  const nocodb = helpers && helpers.nocodb;
 
   // Validate required env vars
   const missing = REQUIRED_ENV.filter((k) => !env[k]);
   if (missing.length > 0) {
     throw new Error(`sec-monitor: missing required env vars: ${missing.join(', ')}`);
   }
+  if (!nocodb) {
+    throw new Error('sec-monitor: helpers.nocodb is required');
+  }
 
   // Step 1: Pre-load in parallel
   const [existingDedupKeys, cikTickerMap] = await Promise.all([
-    fetchDedupKeys({
-      baseId: env.AIRTABLE_BASE_ID,
-      tableId: env.INSIDER_ALERTS_TABLE_ID,
-      apiKey: env.AIRTABLE_API_KEY,
-      fetchFn,
-    }),
+    fetchDedupKeys({ nocodb }),
     loadCikTickerMap({ fetchFn }),
   ]);
 
-  // Step 2: Get last_check_timestamp from Monitor_State
-  const stateUrl =
-    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.MONITOR_STATE_TABLE_ID}` +
-    `?filterByFormula=${encodeURIComponent(`{name}='${input.monitorStateName || 'market'}'`)}`;
-  const stateRes = await fetchFn(stateUrl, {
-    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
-  });
-  const stateData = await stateRes.json();
-  const stateRecord = stateData.records && stateData.records[0];
+  // Step 2: Read last_check_timestamp from Monitor_State
+  const stateRecord = await readMonitorState(input.monitorStateName || 'market', { nocodb });
   const lastCheckTimestamp =
-    (stateRecord && stateRecord.fields && stateRecord.fields.last_check_timestamp) ||
+    (stateRecord && stateRecord.last_check_timestamp) ||
     new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
   const lastCheckDate = lastCheckTimestamp.split('T')[0];
 
@@ -550,20 +571,7 @@ async function runSecMonitor(input, helpers) {
 
   // Update Monitor_State last_check_timestamp
   if (stateRecord) {
-    const now = new Date().toISOString();
-    await fetchFn(
-      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.MONITOR_STATE_TABLE_ID}/${stateRecord.id}`,
-      {
-        method: 'PATCH',
-        headers: {
-          Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
-          'Content-Type': 'application/json',
-        },
-        body: JSON.stringify({
-          fields: { last_check_timestamp: now },
-        }),
-      },
-    );
+    await writeMonitorState(stateRecord.Id, new Date().toISOString(), { nocodb });
   }
 
   return results;
@@ -588,6 +596,8 @@ module.exports = {
   loadCikTickerMap,
   enrichFiling,
   detectCluster,
+  readMonitorState,
+  writeMonitorState,
 
   // Orchestrator
   runSecMonitor,
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js
new file mode 100644
index 0000000..2e1a297
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js
@@ -0,0 +1,281 @@
+'use strict';
+
+const {
+  SUBREDDITS,
+  SEARCH_KEYWORDS,
+  buildSearchQueries,
+  filterByScore,
+  draftComment,
+  validateComment,
+  logComment,
+} = require('../../n8n/code/insiderbuying/reddit-monitor');
+
+// ─── SUBREDDITS / SEARCH_KEYWORDS ─────────────────────────────────────────
+
+describe('SUBREDDITS', () => {
+  test('is a non-empty array', () => {
+    expect(Array.isArray(SUBREDDITS)).toBe(true);
+    expect(SUBREDDITS.length).toBeGreaterThan(0);
+  });
+
+  test('contains expected finance subreddits', () => {
+    expect(SUBREDDITS).toContain('wallstreetbets');
+    expect(SUBREDDITS).toContain('stocks');
+    expect(SUBREDDITS).toContain('investing');
+  });
+});
+
+describe('SEARCH_KEYWORDS', () => {
+  test('is a non-empty array', () => {
+    expect(Array.isArray(SEARCH_KEYWORDS)).toBe(true);
+    expect(SEARCH_KEYWORDS.length).toBeGreaterThan(0);
+  });
+
+  test('contains core insider-buying keywords', () => {
+    expect(SEARCH_KEYWORDS).toContain('insider buying');
+    expect(SEARCH_KEYWORDS).toContain('Form 4');
+    expect(SEARCH_KEYWORDS).toContain('insider activity');
+  });
+});
+
+// ─── buildSearchQueries ────────────────────────────────────────────────────
+
+describe('buildSearchQueries()', () => {
+  test('returns at least SEARCH_KEYWORDS when no tickers provided', () => {
+    const queries = buildSearchQueries([]);
+    SEARCH_KEYWORDS.forEach((kw) => expect(queries).toContain(kw));
+  });
+
+  test('appends $TICKER insider for each ticker', () => {
+    const queries = buildSearchQueries(['AAPL', 'TSLA']);
+    expect(queries).toContain('$AAPL insider');
+    expect(queries).toContain('$TSLA insider');
+  });
+
+  test('appends TICKER insider buying for each ticker', () => {
+    const queries = buildSearchQueries(['AAPL', 'TSLA']);
+    expect(queries).toContain('AAPL insider buying');
+    expect(queries).toContain('TSLA insider buying');
+  });
+
+  test('handles null/undefined gracefully', () => {
+    expect(() => buildSearchQueries(null)).not.toThrow();
+    expect(() => buildSearchQueries(undefined)).not.toThrow();
+    const queries = buildSearchQueries(null);
+    expect(Array.isArray(queries)).toBe(true);
+  });
+
+  test('ignores non-string ticker entries', () => {
+    const queries = buildSearchQueries([null, 42, 'MSFT']);
+    expect(queries).toContain('$MSFT insider');
+    expect(queries).toContain('MSFT insider buying');
+  });
+});
+
+// ─── filterByScore ────────────────────────────────────────────────────────
+
+describe('filterByScore()', () => {
+  test('returns empty array for null/non-array input', () => {
+    expect(filterByScore(null)).toEqual([]);
+    expect(filterByScore(undefined)).toEqual([]);
+    expect(filterByScore('string')).toEqual([]);
+  });
+
+  test('filters posts below default threshold (7)', () => {
+    const posts = [
+      { score: 10, title: 'high' },
+      { score: 5, title: 'low' },
+      { score: 7, title: 'at threshold' },
+    ];
+    const result = filterByScore(posts);
+    expect(result).toHaveLength(2);
+    expect(result.map((p) => p.title)).toContain('high');
+    expect(result.map((p) => p.title)).toContain('at threshold');
+  });
+
+  test('respects custom minScore', () => {
+    const posts = [{ score: 20 }, { score: 50 }, { score: 5 }];
+    const result = filterByScore(posts, 25);
+    expect(result).toHaveLength(1);
+    expect(result[0].score).toBe(50);
+  });
+
+  test('keeps all posts if all meet threshold', () => {
+    const posts = [{ score: 100 }, { score: 200 }, { score: 50 }];
+    expect(filterByScore(posts, 7)).toHaveLength(3);
+  });
+
+  test('returns empty array if no posts meet threshold', () => {
+    const posts = [{ score: 1 }, { score: 2 }];
+    expect(filterByScore(posts, 10)).toHaveLength(0);
+  });
+});
+
+// ─── draftComment ─────────────────────────────────────────────────────────
+
+describe('draftComment()', () => {
+  const SAMPLE_POST = {
+    title: 'CEO of AAPL just bought 10,000 shares',
+    selftext: 'I saw in the SEC filing that Tim Cook bought a ton of shares.',
+    subreddit: 'stocks',
+    score: 42,
+  };
+  const SAMPLE_DATA = {
+    ticker: 'AAPL',
+    insider_name: 'Tim Cook',
+    transaction_type: 'purchased',
+    shares: 10000,
+    value_usd: 2255000,
+    date: '2024-01-15',
+  };
+
+  test('returns object with prompt and maxTokens', () => {
+    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
+    expect(result).toHaveProperty('prompt');
+    expect(result).toHaveProperty('maxTokens');
+  });
+
+  test('prompt includes the post title', () => {
+    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
+    expect(result.prompt).toContain(SAMPLE_POST.title);
+  });
+
+  test('prompt includes the insider data', () => {
+    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
+    expect(result.prompt).toContain('Tim Cook');
+    expect(result.prompt).toContain('AAPL');
+  });
+
+  test('prompt cites the subreddit tone', () => {
+    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
+    expect(result.prompt).toContain('stocks');
+  });
+
+  test('prompt contains NO brand names rule', () => {
+    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
+    expect(result.prompt.toUpperCase()).toContain('NO BRAND');
+  });
+
+  test('prompt contains NO links/URLs rule', () => {
+    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
+    expect(result.prompt.toUpperCase()).toContain('NO LINKS');
+  });
+
+  test('maxTokens is within reasonable range (100-300)', () => {
+    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
+    expect(result.maxTokens).toBeGreaterThanOrEqual(100);
+    expect(result.maxTokens).toBeLessThanOrEqual(300);
+  });
+
+  test('handles null post and data gracefully', () => {
+    expect(() => draftComment(null, null)).not.toThrow();
+    const result = draftComment(null, null);
+    expect(result).toHaveProperty('prompt');
+    expect(result).toHaveProperty('maxTokens');
+  });
+});
+
+// ─── validateComment ──────────────────────────────────────────────────────
+
+describe('validateComment()', () => {
+  const VALID_COMMENT =
+    'I checked the SEC filings and noticed some interesting activity. '
+    + 'The director purchased a significant block of shares last week. '
+    + 'That kind of conviction from insiders usually signals something.';
+
+  test('returns { valid: false } for null/empty input', () => {
+    expect(validateComment(null).valid).toBe(false);
+    expect(validateComment('').valid).toBe(false);
+    expect(validateComment(undefined).valid).toBe(false);
+  });
+
+  test('returns { valid: true } for a clean 3-sentence comment', () => {
+    const result = validateComment(VALID_COMMENT);
+    expect(result.valid).toBe(true);
+    expect(result.issues).toHaveLength(0);
+  });
+
+  test('detects URLs / domain names', () => {
+    const result = validateComment('Check out https://example.com for details. It is great. Very useful.');
+    expect(result.valid).toBe(false);
+    expect(result.issues.some((i) => i.toLowerCase().includes('url') || i.toLowerCase().includes('domain'))).toBe(true);
+  });
+
+  test('detects brand name InsiderBuying', () => {
+    const result = validateComment('InsiderBuying tracks this data. It is a site I use. Very handy for research.');
+    expect(result.valid).toBe(false);
+    expect(result.issues.some((i) => i.includes('InsiderBuying'))).toBe(true);
+  });
+
+  test('detects brand name EarlyInsider (case-insensitive)', () => {
+    const result = validateComment('earlyinsider has good data. I use it daily. It tracks SEC filings well.');
+    expect(result.valid).toBe(false);
+    expect(result.issues.some((i) => i.toLowerCase().includes('earlyinsider'))).toBe(true);
+  });
+
+  test('flags comment with fewer than 3 sentences', () => {
+    const result = validateComment('Only one sentence here.');
+    expect(result.valid).toBe(false);
+    expect(result.issues.some((i) => i.toLowerCase().includes('few sentences') || i.toLowerCase().includes('too few'))).toBe(true);
+  });
+
+  test('flags comment with more than 5 sentences', () => {
+    const text =
+      'First sentence. Second sentence. Third sentence. Fourth sentence. Sixth sentence. Seventh sentence.';
+    const result = validateComment(text);
+    expect(result.valid).toBe(false);
+    expect(result.issues.some((i) => i.toLowerCase().includes('many sentences') || i.toLowerCase().includes('too many'))).toBe(true);
+  });
+
+  test('result always has issues array', () => {
+    expect(Array.isArray(validateComment(VALID_COMMENT).issues)).toBe(true);
+    expect(Array.isArray(validateComment(null).issues)).toBe(true);
+  });
+});
+
+// ─── logComment ───────────────────────────────────────────────────────────
+
+describe('logComment()', () => {
+  const URL = 'https://reddit.com/r/stocks/comments/abc123';
+  const SUBREDDIT = 'stocks';
+  const TEXT = 'Interesting insider activity here.';
+  const STATUS = 'posted';
+
+  test('returns flat object — no { fields: {} } wrapper', () => {
+    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
+    expect(record.fields).toBeUndefined();
+  });
+
+  test('includes post_url field', () => {
+    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
+    expect(record.post_url).toBe(URL);
+  });
+
+  test('includes subreddit field', () => {
+    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
+    expect(record.subreddit).toBe(SUBREDDIT);
+  });
+
+  test('includes comment_text field', () => {
+    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
+    expect(record.comment_text).toBe(TEXT);
+  });
+
+  test('includes status field', () => {
+    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
+    expect(record.status).toBe(STATUS);
+  });
+
+  test('posted_at is a valid ISO timestamp', () => {
+    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
+    expect(() => new Date(record.posted_at)).not.toThrow();
+    expect(new Date(record.posted_at).toISOString()).toBe(record.posted_at);
+  });
+
+  test('handles null/missing arguments gracefully', () => {
+    expect(() => logComment(null, null, null, null)).not.toThrow();
+    const record = logComment(null, null, null, null);
+    expect(record.post_url).toBe('');
+    expect(record.subreddit).toBe('');
+  });
+});
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js
index bc352c2..23c86f3 100644
--- a/ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js
@@ -10,8 +10,12 @@ const {
   loadCikTickerMap,
   enrichFiling,
   detectCluster,
+  readMonitorState,
+  writeMonitorState,
 } = require('../../n8n/code/insiderbuying/sec-monitor');
 
+const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
+
 // ─── Shared mock factory ──────────────────────────────────────────────────────
 
 function makeFetch(response) {
@@ -19,7 +23,21 @@ function makeFetch(response) {
     ok: true,
     status: 200,
     json: async () => response,
+    text: async () => JSON.stringify(response),
+  });
+}
+
+function makeFetchSeq(...calls) {
+  const fn = jest.fn();
+  calls.forEach(({ response, ok = true, status = 200 }) => {
+    fn.mockResolvedValueOnce({
+      ok,
+      status,
+      json: async () => response,
+      text: async () => JSON.stringify(response),
+    });
   });
+  return fn;
 }
 
 function makeFailFetch(statusCode) {
@@ -30,62 +48,146 @@ function makeFailFetch(statusCode) {
 
 const noSleep = jest.fn().mockResolvedValue(undefined);
 
+const BASE_ENV = {
+  NOCODB_API_TOKEN: 'test-token',
+  NOCODB_BASE_URL: 'http://localhost:8080',
+  NOCODB_PROJECT_ID: 'proj123',
+  FINANCIAL_DATASETS_API_KEY: 'fd-key',
+  SUPABASE_URL: 'https://test.supabase.co',
+  SUPABASE_SERVICE_ROLE_KEY: 'sb-key',
+};
+
+function makeNocoDB(fetchFn) {
+  return new NocoDB(BASE_ENV.NOCODB_BASE_URL, BASE_ENV.NOCODB_API_TOKEN, BASE_ENV.NOCODB_PROJECT_ID, fetchFn);
+}
+
 // ─────────────────────────────────────────────────────────────────────────────
-describe('section-02: sec-monitor.js', () => {
+describe('section-03: sec-monitor.js', () => {
 
-  // ── 2.0 Pre-load: fetchDedupKeys ──────────────────────────────────────────
+  // ── 3.0 Pre-load: fetchDedupKeys ──────────────────────────────────────────
   describe('fetchDedupKeys()', () => {
     test('returns a Set of strings, not an array', async () => {
       const fetchFn = makeFetch({
-        records: [
-          { fields: { dedup_key: 'AAPL_Tim_Cook_2026-03-25_10000' } },
-          { fields: { dedup_key: 'MSFT_Brad_Smith_2026-03-24_5000' } },
+        list: [
+          { Id: 1, dedup_key: 'AAPL_Tim_Cook_2026-03-25_10000' },
+          { Id: 2, dedup_key: 'MSFT_Brad_Smith_2026-03-24_5000' },
         ],
+        pageInfo: { isLastPage: true },
       });
-      const result = await fetchDedupKeys({
-        baseId: 'appXXX', tableId: 'tblXXX', apiKey: 'key', fetchFn,
-      });
+      const nocodb = makeNocoDB(fetchFn);
+      const result = await fetchDedupKeys({ nocodb });
       expect(result).toBeInstanceOf(Set);
       expect([...result]).toEqual(
         expect.arrayContaining(['AAPL_Tim_Cook_2026-03-25_10000', 'MSFT_Brad_Smith_2026-03-24_5000']),
       );
     });
 
-    test('returns empty Set when Airtable returns no records', async () => {
-      const fetchFn = makeFetch({ records: [] });
-      const result = await fetchDedupKeys({
-        baseId: 'appXXX', tableId: 'tblXXX', apiKey: 'key', fetchFn,
-      });
+    test('returns empty Set when NocoDB returns no records', async () => {
+      const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+      const nocodb = makeNocoDB(fetchFn);
+      const result = await fetchDedupKeys({ nocodb });
       expect(result).toBeInstanceOf(Set);
       expect(result.size).toBe(0);
     });
 
     test('filters out null and undefined dedup_key values', async () => {
       const fetchFn = makeFetch({
-        records: [
-          { fields: { dedup_key: 'AAPL_Cook_2026-03-25_100' } },
-          { fields: {} },
-          { fields: { dedup_key: null } },
-          { fields: { dedup_key: undefined } },
+        list: [
+          { Id: 1, dedup_key: 'AAPL_Cook_2026-03-25_100' },
+          { Id: 2 },
+          { Id: 3, dedup_key: null },
+          { Id: 4, dedup_key: undefined },
         ],
+        pageInfo: { isLastPage: true },
       });
-      const result = await fetchDedupKeys({
-        baseId: 'appXXX', tableId: 'tblXXX', apiKey: 'key', fetchFn,
-      });
+      const nocodb = makeNocoDB(fetchFn);
+      const result = await fetchDedupKeys({ nocodb });
       expect(result.size).toBe(1);
     });
 
-    test('sends Authorization: Bearer header to Airtable', async () => {
-      const fetchFn = makeFetch({ records: [] });
-      await fetchDedupKeys({
-        baseId: 'appXXX', tableId: 'tblXXX', apiKey: 'myToken', fetchFn,
-      });
+    test('sends xc-token header to NocoDB', async () => {
+      const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+      const nocodb = makeNocoDB(fetchFn);
+      await fetchDedupKeys({ nocodb });
       const [, opts] = fetchFn.mock.calls[0];
-      expect(opts.headers['Authorization']).toBe('Bearer myToken');
+      expect(opts.headers['xc-token']).toBe('test-token');
+    });
+
+    test('paginates until pageInfo.isLastPage is true', async () => {
+      const fetchFn = makeFetchSeq(
+        { response: { list: [{ Id: 1, dedup_key: 'KEY_A' }], pageInfo: { isLastPage: false } } },
+        { response: { list: [{ Id: 2, dedup_key: 'KEY_B' }], pageInfo: { isLastPage: true } } },
+      );
+      const nocodb = makeNocoDB(fetchFn);
+      const result = await fetchDedupKeys({ nocodb });
+      expect(fetchFn).toHaveBeenCalledTimes(2);
+      expect(result.has('KEY_A')).toBe(true);
+      expect(result.has('KEY_B')).toBe(true);
+    });
+
+    test('second page call passes incremented offset', async () => {
+      const fetchFn = makeFetchSeq(
+        { response: { list: [{ Id: 1, dedup_key: 'KEY_A' }], pageInfo: { isLastPage: false } } },
+        { response: { list: [{ Id: 2, dedup_key: 'KEY_B' }], pageInfo: { isLastPage: true } } },
+      );
+      const nocodb = makeNocoDB(fetchFn);
+      await fetchDedupKeys({ nocodb });
+      const secondUrl = fetchFn.mock.calls[1][0];
+      expect(secondUrl).toContain('offset=');
+    });
+
+    test('uses NocoDB filter syntax (filing_date,gt,...) not Airtable formula', async () => {
+      const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+      const nocodb = makeNocoDB(fetchFn);
+      await fetchDedupKeys({ nocodb });
+      const [url] = fetchFn.mock.calls[0];
+      expect(url).toContain('filing_date');
+      expect(url).toContain('gt');
+      expect(url).not.toContain('IS_AFTER');
+      expect(url).not.toContain('airtable.com');
+    });
+  });
+
+  // ── 3.0 Monitor_State read/write ─────────────────────────────────────────
+  describe('readMonitorState()', () => {
+    test('calls nocodb.list("Monitor_State") with eq filter and returns record', async () => {
+      const fetchFn = makeFetch({
+        list: [{ Id: 7, name: 'market', last_check_timestamp: '2024-01-15T00:00:00Z' }],
+        pageInfo: { isLastPage: true },
+      });
+      const nocodb = makeNocoDB(fetchFn);
+      const record = await readMonitorState('market', { nocodb });
+      expect(record).not.toBeNull();
+      expect(record.Id).toBe(7);
+      expect(record.last_check_timestamp).toBe('2024-01-15T00:00:00Z');
+      const [url] = fetchFn.mock.calls[0];
+      expect(url).toContain('Monitor_State');
+      expect(url).toContain('market');
+    });
+
+    test('returns null when Monitor_State record not found', async () => {
+      const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+      const nocodb = makeNocoDB(fetchFn);
+      const record = await readMonitorState('market', { nocodb });
+      expect(record).toBeNull();
+    });
+  });
+
+  describe('writeMonitorState()', () => {
+    test('calls nocodb.update("Monitor_State", id, { last_check_timestamp })', async () => {
+      const fetchFn = makeFetch({ Id: 7 });
+      const nocodb = makeNocoDB(fetchFn);
+      await writeMonitorState(7, '2024-01-20T00:00:00Z', { nocodb });
+      const [url, opts] = fetchFn.mock.calls[0];
+      expect(url).toContain('Monitor_State');
+      expect(url).toContain('/7');
+      expect(opts.method).toBe('PATCH');
+      const body = JSON.parse(opts.body);
+      expect(body.last_check_timestamp).toBe('2024-01-20T00:00:00Z');
     });
   });
 
-  // ── 2.0 Pre-load: loadCikTickerMap ────────────────────────────────────────
+  // ── 3.0 Pre-load: loadCikTickerMap ────────────────────────────────────────
   describe('loadCikTickerMap()', () => {
     const SEC_DATA = {
       '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
@@ -132,7 +234,7 @@ describe('section-02: sec-monitor.js', () => {
     });
   });
 
-  // ── 2.1 EDGAR URL Tests ───────────────────────────────────────────────────
+  // ── 3.1 EDGAR URL Tests ───────────────────────────────────────────────────
   describe('buildEdgarUrl()', () => {
     test('includes startdt and enddt params', () => {
       const url = buildEdgarUrl('2026-03-20', '2026-03-27');
@@ -165,7 +267,7 @@ describe('section-02: sec-monitor.js', () => {
     });
   });
 
-  // ── 2.1 EDGAR Parse Tests ─────────────────────────────────────────────────
+  // ── 3.1 EDGAR Parse Tests ─────────────────────────────────────────────────
   describe('parseEdgarResponse()', () => {
     test('extracts entity_name, file_date, accession_number from hits.hits', () => {
       const response = {
@@ -215,7 +317,7 @@ describe('section-02: sec-monitor.js', () => {
     });
   });
 
-  // ── 2.2 Enrichment Tests ──────────────────────────────────────────────────
+  // ── 3.2 Enrichment Tests ──────────────────────────────────────────────────
   describe('enrichFiling()', () => {
     const FD_RESPONSE = {
       insider_trades: [
@@ -338,7 +440,7 @@ describe('section-02: sec-monitor.js', () => {
     });
   });
 
-  // ── 2.3 Dedup Tests ───────────────────────────────────────────────────────
+  // ── 3.3 Dedup Tests ───────────────────────────────────────────────────────
   describe('buildDedupKey()', () => {
     test('returns ticker_name_date_shares format', () => {
       const key = buildDedupKey('AAPL', 'Tim Cook', '2026-03-25', 10000);
@@ -380,7 +482,7 @@ describe('section-02: sec-monitor.js', () => {
     });
   });
 
-  // ── 2.4 Filter Tests ─────────────────────────────────────────────────────
+  // ── 3.4 Filter Tests ─────────────────────────────────────────────────────
   describe('filterBuysOnly()', () => {
     // Test via isBuyTransaction helper
     const { isBuyTransaction } = require('../../n8n/code/insiderbuying/sec-monitor');
@@ -410,7 +512,7 @@ describe('section-02: sec-monitor.js', () => {
     });
   });
 
-  // ── 2.5 Classification Tests ──────────────────────────────────────────────
+  // ── 3.5 Classification Tests ──────────────────────────────────────────────
   describe('classifyInsider()', () => {
     test('Chief Executive Officer -> C-Suite', () => {
       expect(classifyInsider('Chief Executive Officer', false)).toBe('C-Suite');
@@ -469,7 +571,7 @@ describe('section-02: sec-monitor.js', () => {
     });
   });
 
-  // ── 2.6 Cluster Detection Tests ───────────────────────────────────────────
+  // ── 3.6 Cluster Detection Tests ───────────────────────────────────────────
   describe('detectCluster()', () => {
     const SUPA_URL = 'https://abc.supabase.co';
     const SUPA_KEY = 'service_role_key';
@@ -567,7 +669,7 @@ describe('section-02: sec-monitor.js', () => {
     test('detects same-run cluster via sameRunFilings (Supabase empty)', async () => {
       // Supabase returns empty (filing A not written yet), but sameRunFilings has it
       const fetchFn = jest.fn()
-        .mockResolvedValueOnce({ ok: true, json: async () => [] })    // SELECT → empty
+        .mockResolvedValueOnce({ ok: true, json: async () => [] })    // SELECT -> empty
         .mockResolvedValueOnce({ ok: true, json: async () => [] });   // PATCH (no-op, rowsToUpdate=[])
       const filingA = { ticker: 'AAPL', insider_name: 'Jony Ive', transaction_date: '2026-03-25', cluster_id: null, is_cluster_buy: false };
       const sameRunFilings = [filingA];
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/x-auto-post.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/x-auto-post.test.js
new file mode 100644
index 0000000..d26d169
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/x-auto-post.test.js
@@ -0,0 +1,194 @@
+'use strict';
+
+const {
+  generateArticleTweet,
+  generateAlertTweet,
+  postToX,
+  checkDailyLimit,
+  logTweet,
+} = require('../../n8n/code/insiderbuying/x-auto-post');
+
+// ─── generateArticleTweet ──────────────────────────────────────────────────
+
+describe('generateArticleTweet()', () => {
+  test('includes $ticker in output', () => {
+    const tweet = generateArticleTweet({ ticker: 'AAPL', verdict_type: 'bullish', key_takeaways: 'Strong signal.' });
+    expect(tweet).toContain('$AAPL');
+  });
+
+  test('bullish verdict maps to "insiders are loading up"', () => {
+    const tweet = generateArticleTweet({ ticker: 'AAPL', verdict_type: 'bullish', key_takeaways: '' });
+    expect(tweet.toLowerCase()).toContain('loading up');
+  });
+
+  test('bearish verdict maps to "heading for the exits"', () => {
+    const tweet = generateArticleTweet({ ticker: 'TSLA', verdict_type: 'bearish', key_takeaways: '' });
+    expect(tweet.toLowerCase()).toContain('exits');
+  });
+
+  test('mixed verdict maps to "insider signals are mixed"', () => {
+    const tweet = generateArticleTweet({ ticker: 'MSFT', verdict_type: 'mixed', key_takeaways: '' });
+    expect(tweet.toLowerCase()).toContain('mixed');
+  });
+
+  test('result is never longer than 280 characters', () => {
+    const longTakeaway = 'A'.repeat(300);
+    const tweet = generateArticleTweet({ ticker: 'AAPL', verdict_type: 'bullish', key_takeaways: longTakeaway });
+    expect(tweet.length).toBeLessThanOrEqual(280);
+  });
+
+  test('uses first sentence of key_takeaways only', () => {
+    const tweet = generateArticleTweet({
+      ticker: 'AAPL',
+      verdict_type: 'bullish',
+      key_takeaways: 'First sentence. Second sentence. Third sentence.',
+    });
+    expect(tweet).toContain('First sentence');
+    expect(tweet).not.toContain('Second sentence');
+  });
+
+  test('handles missing fields gracefully', () => {
+    expect(() => generateArticleTweet({})).not.toThrow();
+    expect(() => generateArticleTweet({ ticker: 'AAPL' })).not.toThrow();
+  });
+});
+
+// ─── generateAlertTweet ───────────────────────────────────────────────────
+
+describe('generateAlertTweet()', () => {
+  const HIGH_SCORE_ALERT = {
+    ticker: 'AAPL',
+    insider_name: 'Tim Cook',
+    transaction_type: 'bought',
+    shares: 10000,
+    value_usd: 2255000,
+    significance_score: 9,
+  };
+
+  test('returns null for significance_score < 8', () => {
+    expect(generateAlertTweet({ ...HIGH_SCORE_ALERT, significance_score: 7 })).toBeNull();
+    expect(generateAlertTweet({ ...HIGH_SCORE_ALERT, significance_score: 5 })).toBeNull();
+  });
+
+  test('returns null for missing alert', () => {
+    expect(generateAlertTweet(null)).toBeNull();
+    expect(generateAlertTweet(undefined)).toBeNull();
+  });
+
+  test('returns string for significance_score >= 8', () => {
+    const result = generateAlertTweet(HIGH_SCORE_ALERT);
+    expect(typeof result).toBe('string');
+    expect(result.length).toBeGreaterThan(0);
+  });
+
+  test('includes $ticker in output', () => {
+    expect(generateAlertTweet(HIGH_SCORE_ALERT)).toContain('$AAPL');
+  });
+
+  test('includes insider name', () => {
+    expect(generateAlertTweet(HIGH_SCORE_ALERT)).toContain('Tim Cook');
+  });
+
+  test('formats million-dollar value with M suffix', () => {
+    const tweet = generateAlertTweet(HIGH_SCORE_ALERT);
+    expect(tweet).toContain('$2.3M');
+  });
+
+  test('formats thousand-dollar value with K suffix', () => {
+    const tweet = generateAlertTweet({ ...HIGH_SCORE_ALERT, value_usd: 50000 });
+    expect(tweet).toContain('$50K');
+  });
+
+  test('result is never longer than 280 characters', () => {
+    const tweet = generateAlertTweet(HIGH_SCORE_ALERT);
+    expect(tweet.length).toBeLessThanOrEqual(280);
+  });
+
+  test('includes significance score in output', () => {
+    const tweet = generateAlertTweet(HIGH_SCORE_ALERT);
+    expect(tweet).toContain('9');
+  });
+});
+
+// ─── postToX ──────────────────────────────────────────────────────────────
+
+describe('postToX()', () => {
+  test('returns object with method POST', () => {
+    const result = postToX('Hello $AAPL');
+    expect(result.method).toBe('POST');
+  });
+
+  test('targets https://api.twitter.com/2/tweets', () => {
+    const result = postToX('Hello $AAPL');
+    expect(result.url).toBe('https://api.twitter.com/2/tweets');
+  });
+
+  test('body.text matches input text', () => {
+    const result = postToX('Hello $AAPL');
+    expect(result.body.text).toBe('Hello $AAPL');
+  });
+
+  test('includes Content-Type: application/json header', () => {
+    const result = postToX('test');
+    expect(result.headers['Content-Type']).toBe('application/json');
+  });
+});
+
+// ─── checkDailyLimit ──────────────────────────────────────────────────────
+
+describe('checkDailyLimit()', () => {
+  test('returns canPost=true when entries < MAX_DAILY_POSTS', () => {
+    const entries = Array.from({ length: 5 }, (_, i) => ({ id: i }));
+    const result = checkDailyLimit(entries);
+    expect(result.canPost).toBe(true);
+  });
+
+  test('returns canPost=false when entries >= MAX_DAILY_POSTS (10)', () => {
+    const entries = Array.from({ length: 10 }, (_, i) => ({ id: i }));
+    const result = checkDailyLimit(entries);
+    expect(result.canPost).toBe(false);
+  });
+
+  test('postsToday reflects the count of entries passed', () => {
+    const entries = [{ id: 1 }, { id: 2 }, { id: 3 }];
+    const result = checkDailyLimit(entries);
+    expect(result.postsToday).toBe(3);
+  });
+
+  test('handles null/undefined logEntries gracefully', () => {
+    expect(() => checkDailyLimit(null)).not.toThrow();
+    expect(() => checkDailyLimit(undefined)).not.toThrow();
+    expect(checkDailyLimit(null).canPost).toBe(true);
+  });
+});
+
+// ─── logTweet ─────────────────────────────────────────────────────────────
+
+describe('logTweet()', () => {
+  test('returns object with tweet_id field', () => {
+    const record = logTweet('123456', 'test tweet', 'article', '42');
+    expect(record.tweet_id).toBe('123456');
+  });
+
+  test('sets status to "posted"', () => {
+    const record = logTweet('123456', 'test tweet', 'article', '42');
+    expect(record.status).toBe('posted');
+  });
+
+  test('sets posted_at to a valid ISO timestamp', () => {
+    const record = logTweet('123456', 'test tweet', 'article', '42');
+    expect(() => new Date(record.posted_at)).not.toThrow();
+    expect(new Date(record.posted_at).toISOString()).toBe(record.posted_at);
+  });
+
+  test('source_type and source_id match inputs', () => {
+    const record = logTweet('tid', 'text', 'alert', '99');
+    expect(record.source_type).toBe('alert');
+    expect(record.source_id).toBe('99');
+  });
+
+  test('body is flat — no { fields: {} } wrapper', () => {
+    const record = logTweet('tid', 'text', 'article', '1');
+    expect(record.fields).toBeUndefined();
+  });
+});
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/x-engagement.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/x-engagement.test.js
new file mode 100644
index 0000000..407433d
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/x-engagement.test.js
@@ -0,0 +1,152 @@
+'use strict';
+
+const {
+  filterRelevant,
+  draftReply,
+  sendToTelegramReview,
+} = require('../../n8n/code/insiderbuying/x-engagement');
+
+// ─── filterRelevant ───────────────────────────────────────────────────────
+
+describe('filterRelevant()', () => {
+  const OLD_DATE = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days ago
+  const NEW_DATE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago (too new)
+
+  const GOOD_USER = { followers_count: 50, following_count: 50, created_at: OLD_DATE };
+  const BOT_USER_FEW_FOLLOWERS = { followers_count: 5, following_count: 50, created_at: OLD_DATE };
+  const BOT_USER_FEW_FOLLOWING = { followers_count: 50, following_count: 5, created_at: OLD_DATE };
+  const NEW_ACCOUNT = { followers_count: 50, following_count: 50, created_at: NEW_DATE };
+
+  test('returns empty array for null/non-array input', () => {
+    expect(filterRelevant(null)).toEqual([]);
+    expect(filterRelevant(undefined)).toEqual([]);
+    expect(filterRelevant('string')).toEqual([]);
+  });
+
+  test('filters out item with missing user', () => {
+    const items = [{ id: '1', text: 'test' }]; // no .user
+    expect(filterRelevant(items)).toHaveLength(0);
+  });
+
+  test('keeps item with sufficient followers and following', () => {
+    const items = [{ id: '1', text: 'test', user: GOOD_USER }];
+    expect(filterRelevant(items)).toHaveLength(1);
+  });
+
+  test('filters out item with followers < 10', () => {
+    const items = [{ id: '1', text: 'test', user: BOT_USER_FEW_FOLLOWERS }];
+    expect(filterRelevant(items)).toHaveLength(0);
+  });
+
+  test('filters out item with following < 10', () => {
+    const items = [{ id: '1', text: 'test', user: BOT_USER_FEW_FOLLOWING }];
+    expect(filterRelevant(items)).toHaveLength(0);
+  });
+
+  test('filters out account created within last 30 days', () => {
+    const items = [{ id: '1', text: 'test', user: NEW_ACCOUNT }];
+    expect(filterRelevant(items)).toHaveLength(0);
+  });
+
+  test('keeps multiple valid items', () => {
+    const items = [
+      { id: '1', text: 'a', user: GOOD_USER },
+      { id: '2', text: 'b', user: GOOD_USER },
+    ];
+    expect(filterRelevant(items)).toHaveLength(2);
+  });
+});
+
+// ─── draftReply ───────────────────────────────────────────────────────────
+
+describe('draftReply()', () => {
+  const SAMPLE_TWEET = {
+    id: '123456',
+    text: 'What do you think about recent insider buying in AAPL?',
+    user: { screen_name: 'trader_jane' },
+  };
+
+  test('returns object with prompt and maxTokens', () => {
+    const result = draftReply(SAMPLE_TWEET);
+    expect(result).toHaveProperty('prompt');
+    expect(result).toHaveProperty('maxTokens');
+  });
+
+  test('prompt includes the original tweet text', () => {
+    const result = draftReply(SAMPLE_TWEET);
+    expect(result.prompt).toContain(SAMPLE_TWEET.text);
+  });
+
+  test('prompt includes the author handle', () => {
+    const result = draftReply(SAMPLE_TWEET);
+    expect(result.prompt).toContain('trader_jane');
+  });
+
+  test('prompt contains NO links/URLs rule', () => {
+    const result = draftReply(SAMPLE_TWEET);
+    expect(result.prompt.toUpperCase()).toContain('NO LINKS');
+  });
+
+  test('prompt contains NO brand names rule', () => {
+    const result = draftReply(SAMPLE_TWEET);
+    expect(result.prompt.toUpperCase()).toContain('NO BRAND');
+  });
+
+  test('maxTokens is a reasonable number (50-200)', () => {
+    const result = draftReply(SAMPLE_TWEET);
+    expect(result.maxTokens).toBeGreaterThanOrEqual(50);
+    expect(result.maxTokens).toBeLessThanOrEqual(200);
+  });
+
+  test('handles null tweet gracefully', () => {
+    expect(() => draftReply(null)).not.toThrow();
+    const result = draftReply(null);
+    expect(result).toHaveProperty('prompt');
+  });
+});
+
+// ─── sendToTelegramReview ─────────────────────────────────────────────────
+
+describe('sendToTelegramReview()', () => {
+  const ORIGINAL = {
+    id: '789',
+    text: 'Insider data looks bullish on MSFT',
+    user: { screen_name: 'some_trader' },
+  };
+  const DRAFT = 'Great point. Recent filings show strong insider conviction.';
+  const CHAT_ID = '-1001234567890';
+
+  test('returns object with method=sendMessage', () => {
+    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
+    expect(payload.method).toBe('sendMessage');
+  });
+
+  test('chat_id matches provided chatId', () => {
+    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
+    expect(payload.chat_id).toBe(CHAT_ID);
+  });
+
+  test('text includes original tweet content', () => {
+    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
+    expect(payload.text).toContain(ORIGINAL.text);
+  });
+
+  test('text includes draft reply', () => {
+    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
+    expect(payload.text).toContain(DRAFT);
+  });
+
+  test('reply_markup has inline keyboard with Approve, Edit, Skip', () => {
+    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
+    const buttons = payload.reply_markup.inline_keyboard[0].map((b) => b.text);
+    expect(buttons).toContain('Approve');
+    expect(buttons).toContain('Edit');
+    expect(buttons).toContain('Skip');
+  });
+
+  test('callback_data includes tweet id for routing', () => {
+    const payload = sendToTelegramReview(ORIGINAL, DRAFT, CHAT_ID);
+    const approveCb = payload.reply_markup.inline_keyboard[0].find((b) => b.text === 'Approve');
+    expect(approveCb.callback_data).toContain('789');
+  });
+});
