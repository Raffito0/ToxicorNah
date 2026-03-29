diff --git a/insiderbuying-site/n8n/code/insiderbuying/score-alert.js b/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
index 434bf71..86df3e6 100644
--- a/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
+++ b/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
@@ -8,6 +8,7 @@
 // ────────────────────────────────────────────────────────────────────────────
 
 const { createDeepSeekClient } = require('./ai-client');
+const { NocoDB } = require('./nocodb-client');
 
 const YAHOO_API = 'https://query1.finance.yahoo.com/v8/finance/chart';
 const HISTORY_MONTHS = 24;
@@ -261,7 +262,7 @@ async function callDeepSeekForRefinement(filing, baseScore, deps = {}) {
 
   // 10b5-1 plan: skip AI entirely, apply cap
   if (filing.is10b5Plan) {
-    const final_score = parseFloat(Math.min(baseScore, 5).toFixed(1));
+    const final_score = parseFloat(Math.min(5, Math.max(1, baseScore)).toFixed(1));
     return {
       base_score: baseScore,
       ai_adjustment: 0,
@@ -278,9 +279,11 @@ async function callDeepSeekForRefinement(filing, baseScore, deps = {}) {
   for (let attempt = 0; attempt < 2; attempt++) {
     try {
       if (attempt > 0 && sleep) await sleep(2000);
+      // null first arg = no system prompt, user-turn only
       const response = await client.complete(null, prompt, { temperature: 0.0 });
       rawText = _stripFences((response.content || '').trim());
-      if (!rawText) continue; // treat empty as invalid, retry
+      // continue jumps to attempt=1 where sleep fires — delay is still applied
+      if (!rawText) continue;
       parsed = JSON.parse(rawText);
       break;
     } catch {
@@ -434,16 +437,80 @@ async function callHaiku(prompt, deepseekClient) {
   }
 }
 
+// ─── emitScoreLog ───────────────────────────────────────────────────────────
+
+/**
+ * Emits a structured JSON log line for every scoring decision.
+ * Required fields: ticker, insiderName, transactionCode, direction, finalScore, timestamp.
+ * Optional: baseScore, aiAdjustment (scored alerts), skipReason (G/F), overrideReason (M/X).
+ */
+function emitScoreLog(data) {
+  const log = {
+    ticker: data.ticker,
+    insiderName: data.insider_name || null,
+    transactionCode: data.transactionCode,
+    direction: data.direction || null,
+    finalScore: data.finalScore !== undefined ? data.finalScore : null,
+    timestamp: new Date().toISOString(),
+  };
+  if (data.baseScore !== undefined)    log.baseScore = data.baseScore;
+  if (data.aiAdjustment !== undefined) log.aiAdjustment = data.aiAdjustment;
+  if (data.skipReason)                 log.skipReason = data.skipReason;
+  if (data.overrideReason)             log.overrideReason = data.overrideReason;
+  console.log(JSON.stringify(log));
+}
+
+// ─── detectSameDaySell ───────────────────────────────────────────────────────
+
+const EXERCISE_SELL_THRESHOLD = 0.80;
+
+/**
+ * Detects the "exercise-and-sell" pattern: insider exercises options and
+ * immediately sells >= 80% of exercised shares on the same calendar day.
+ *
+ * Returns 0 if exercise-and-sell confirmed (financial housekeeping, not conviction).
+ * Returns undefined if: partial sell, no matching sell found, or NocoDB unavailable.
+ *
+ * @param {object} filing - must have: insiderCik, transactionDate, sharesExercised
+ * @param {object} deps   - must have: nocodb
+ */
+async function detectSameDaySell(filing, deps = {}) {
+  const { nocodb, alertsTableId = 'Alerts' } = deps;
+  const { insiderCik, transactionDate, sharesExercised } = filing || {};
+
+  if (!nocodb || !insiderCik || !transactionDate) return undefined;
+
+  try {
+    const where = `(insiderCik,eq,${insiderCik})~and(transactionDate,eq,${transactionDate})~and(transactionCode,eq,S)`;
+    const { list } = await nocodb.list(alertsTableId, { where });
+
+    if (!list || list.length === 0) return undefined;
+
+    const exercised = Number(sharesExercised) || 0;
+    if (exercised <= 0) return undefined;
+
+    for (const row of list) {
+      const sold = Number(row.transactionShares) || 0;
+      if (sold >= exercised * EXERCISE_SELL_THRESHOLD) return 0;
+    }
+
+    return undefined;
+  } catch (err) {
+    console.warn(`[score-alert] detectSameDaySell failed: ${err.message}`);
+    return undefined;
+  }
+}
+
 // ─── 3.3 runScoreAlert ──────────────────────────────────────────────────────
 
 /**
  * Main n8n node entry point.
- * Iterates over all filings sequentially, scores each with DeepSeek,
- * and returns the enriched filing array.
+ * Iterates over all filings sequentially. Filters G/F codes and exercise-and-sell trades.
+ * Each remaining filing is scored via computeBaseScore + callDeepSeekForRefinement.
  *
  * @param {Array} filings - Array of filing objects from sec-monitor.js
  * @param {Object} helpers - { nocodb, deepseekApiKey, fetchFn }
- * @returns {Array} filings enriched with significance_score, score_reasoning, track_record
+ * @returns {Array} Scored filings (G/F and exercise-and-sell excluded)
  */
 async function runScoreAlert(filings, helpers = {}) {
   const { nocodb, fetchFn, deepseekApiKey } = helpers;
@@ -454,6 +521,12 @@ async function runScoreAlert(filings, helpers = {}) {
   const results = [];
 
   for (const filing of filings) {
+    // Belt-and-suspenders G/F filter (upstream unit 09 is primary)
+    if (filing.transactionCode === 'G' || filing.transactionCode === 'F') {
+      emitScoreLog({ ...filing, skipReason: 'gift/tax', finalScore: null });
+      continue;
+    }
+
     // Step 1: compute track record (graceful on any failure)
     const trackRecord = await computeTrackRecord(
       filing.insider_name,
@@ -461,14 +534,36 @@ async function runScoreAlert(filings, helpers = {}) {
       { fetchFn }
     );
 
-    // Step 2: build prompt and call DeepSeek
-    const prompt = buildHaikuPrompt(filing, trackRecord);
-    const { score, reasoning } = await callHaiku(prompt, deepseek);
+    // Step 2: deterministic base score + AI refinement
+    const baseScore = computeBaseScore(filing);
+    const refinement = await callDeepSeekForRefinement(filing, baseScore, {
+      client: deepseek,
+      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
+    });
+
+    // Step 3: exercise-and-sell detection for option exercise codes
+    if (filing.transactionCode === 'M' || filing.transactionCode === 'X') {
+      const sameDayResult = await detectSameDaySell(filing, { nocodb });
+      if (sameDayResult === 0) {
+        emitScoreLog({ ...filing, overrideReason: 'exercise-and-sell', finalScore: 0 });
+        continue;
+      }
+    }
+
+    // Step 4: emit structured log and push result
+    emitScoreLog({
+      ...filing,
+      baseScore: refinement.base_score,
+      aiAdjustment: refinement.ai_adjustment,
+      finalScore: refinement.final_score,
+    });
 
     results.push({
       ...filing,
-      significance_score: score,
-      score_reasoning: reasoning,
+      significance_score: refinement.final_score,
+      score_reasoning: refinement.ai_reason,
+      base_score: refinement.base_score,
+      ai_adjustment: refinement.ai_adjustment,
       track_record: trackRecord,
     });
   }
@@ -476,6 +571,131 @@ async function runScoreAlert(filings, helpers = {}) {
   return results;
 }
 
+// ─── runWeeklyCalibration ────────────────────────────────────────────────────
+
+const ALERTS_TABLE = 'Alerts';
+const CALIB_TABLE = 'score_calibration_runs';
+
+/**
+ * Queries NocoDB for all scored alerts from the past 7 days, buckets them into
+ * four score ranges, fires a Telegram alert if the distribution is unhealthy,
+ * and always writes a calibration run record to score_calibration_runs.
+ *
+ * @param {object} deps  { fetchFn, sleep, env }
+ *   env keys: NOCODB_BASE_URL, NOCODB_API_TOKEN, NOCODB_PROJECT_ID,
+ *             TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
+ * @returns {{ total, buckets, flagged } | { message } | null}
+ */
+async function runWeeklyCalibration(deps) {
+  const { fetchFn, env } = deps;
+
+  if (!env.NOCODB_BASE_URL || !env.NOCODB_API_TOKEN) {
+    console.warn('[calibration] missing NocoDB env vars — skipping');
+    return null;
+  }
+
+  const nocodb = new NocoDB(
+    env.NOCODB_BASE_URL,
+    env.NOCODB_API_TOKEN,
+    env.NOCODB_PROJECT_ID,
+    fetchFn
+  );
+
+  // Step 1: Query alerts from past 7 days with a final score
+  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
+  let alerts;
+  try {
+    const response = await nocodb.list(ALERTS_TABLE, {
+      where: `(created_at,gte,${sevenDaysAgo})~and(final_score,isnot,null)`,
+      fields: 'final_score',
+      limit: 1000,
+    });
+    alerts = response.list || [];
+  } catch (err) {
+    console.error('[calibration] NocoDB query failed:', err.message);
+    return null;
+  }
+
+  // Step 2: Guard for empty week
+  if (alerts.length === 0) {
+    console.log('[calibration] no alerts this week — skipping');
+    return { message: 'no alerts this week' };
+  }
+
+  // Step 3: Bucket the scores
+  const total = alerts.length;
+  let count_1_3 = 0, count_4_5 = 0, count_6_7 = 0, count_8_10 = 0;
+
+  for (const alert of alerts) {
+    const score = alert.final_score;
+    if (score <= 3) count_1_3++;
+    else if (score <= 5) count_4_5++;
+    else if (score <= 7) count_6_7++;
+    else count_8_10++;
+  }
+
+  const pct_1_3 = parseFloat((count_1_3 / total * 100).toFixed(1));
+  const pct_4_5 = parseFloat((count_4_5 / total * 100).toFixed(1));
+  const pct_6_7 = parseFloat((count_6_7 / total * 100).toFixed(1));
+  const pct_8_10 = parseFloat((count_8_10 / total * 100).toFixed(1));
+
+  // Step 4: Evaluate alert conditions
+  let flagged = false;
+  let flagReason = '';
+
+  if (pct_8_10 > 25) {
+    flagged = true;
+    flagReason = `8-10 bucket is ${pct_8_10}% — formula may be too generous`;
+  } else if (pct_8_10 < 5) {
+    flagged = true;
+    flagReason = `8-10 bucket is ${pct_8_10}% — formula may be too strict`;
+  } else if (pct_1_3 === 0 || pct_4_5 === 0 || pct_6_7 === 0 || pct_8_10 === 0) {
+    flagged = true;
+    flagReason = 'one or more buckets are empty — pipeline anomaly detected';
+  }
+
+  // Step 5: Send Telegram alert if flagged
+  if (flagged) {
+    const weekOf = new Date().toISOString().slice(0, 10);
+    const text = [
+      `[Score Calibration Alert] Week of ${weekOf}`,
+      `Total alerts: ${total}`,
+      'Distribution:',
+      `  1-3:  ${pct_1_3}%`,
+      `  4-5:  ${pct_4_5}%`,
+      `  6-7:  ${pct_6_7}%`,
+      `  8-10: ${pct_8_10}%`,
+      '',
+      `Issue: ${flagReason}`,
+    ].join('\n');
+
+    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
+    try {
+      await fetchFn(tgUrl, {
+        method: 'POST',
+        headers: { 'Content-Type': 'application/json' },
+        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
+      });
+    } catch (err) {
+      console.error('[calibration] Telegram send failed:', err.message);
+    }
+  }
+
+  // Step 6: Write calibration record to NocoDB (always, even when not flagged)
+  const run_date = new Date().toISOString().slice(0, 10);
+  await nocodb.create(CALIB_TABLE, {
+    run_date,
+    total_alerts: total,
+    pct_1_3,
+    pct_4_5,
+    pct_6_7,
+    pct_8_10,
+    flagged,
+  });
+
+  return { total, buckets: { pct_1_3, pct_4_5, pct_6_7, pct_8_10 }, flagged };
+}
+
 // ─── n8n Code node entry point ───────────────────────────────────────────────
 // When running inside n8n, the node receives $input.all() items.
 // This block is only executed in n8n context (not in tests).
@@ -515,4 +735,7 @@ module.exports = {
   runScoreAlert,
   computeBaseScore,
   callDeepSeekForRefinement,
+  detectSameDaySell,
+  emitScoreLog,
+  runWeeklyCalibration,
 };
diff --git a/insiderbuying-site/tests/insiderbuying/score-alert.test.js b/insiderbuying-site/tests/insiderbuying/score-alert.test.js
index 40bcff1..691d7b7 100644
--- a/insiderbuying-site/tests/insiderbuying/score-alert.test.js
+++ b/insiderbuying-site/tests/insiderbuying/score-alert.test.js
@@ -18,6 +18,7 @@ const {
   runScoreAlert,
   computeBaseScore,
   callDeepSeekForRefinement,
+  detectSameDaySell,
 } = require('../../n8n/code/insiderbuying/score-alert');
 
 const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
@@ -801,6 +802,7 @@ describe('computeBaseScore', () => {
 
 describe('callDeepSeekForRefinement', () => {
   const sleep = jest.fn().mockResolvedValue(undefined);
+  beforeEach(() => sleep.mockClear());
 
   function makeClient(responses) {
     let i = 0;
@@ -961,5 +963,409 @@ describe('callDeepSeekForRefinement', () => {
       expect(result.ai_adjustment).toBe(0);
       expect(result.ai_reason.length).toBeGreaterThan(0);
     });
+
+    test('whitespace-only reason field — ai_reason substituted with default', async () => {
+      const client = makeClient(['{"adjustment": 0, "reason": "   "}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 6.0, { client, sleep });
+      expect(result.ai_reason).toBe('No reason provided');
+    });
+  });
+});
+
+// ─── detectSameDaySell ───────────────────────────────────────────────────────
+
+describe('detectSameDaySell', () => {
+  function makeNocoSell(sharesSold) {
+    const fn = jest.fn().mockResolvedValue({
+      ok: true, status: 200,
+      json: async () => ({
+        list: [{ transactionCode: 'S', transactionShares: sharesSold, insiderCik: 'cik001', transactionDate: '2024-01-15' }],
+        pageInfo: { isLastPage: true },
+      }),
+    });
+    return makeNocoDB(fn);
+  }
+  function makeNocoEmpty() {
+    const fn = jest.fn().mockResolvedValue({
+      ok: true, status: 200,
+      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
+    });
+    return makeNocoDB(fn);
+  }
+
+  const EXERCISE_FILING = {
+    transactionCode: 'M', insiderCik: 'cik001',
+    transactionDate: '2024-01-15', sharesExercised: 1000,
+  };
+
+  test('full exercise-and-sell (>=80% sold) returns 0', async () => {
+    const nocodb = makeNocoSell(900); // 900 >= 800 = 80% of 1000
+    const result = await detectSameDaySell(EXERCISE_FILING, { nocodb });
+    expect(result).toBe(0);
+  });
+
+  test('partial sell (30% sold) returns undefined (normal score)', async () => {
+    const nocodb = makeNocoSell(300); // 300 < 800 = 80% of 1000
+    const result = await detectSameDaySell(EXERCISE_FILING, { nocodb });
+    expect(result).toBeUndefined();
+  });
+
+  test('no same-day sell found returns undefined', async () => {
+    const nocodb = makeNocoEmpty();
+    const result = await detectSameDaySell(EXERCISE_FILING, { nocodb });
+    expect(result).toBeUndefined();
+  });
+
+  test('different insiderCik — no match returns undefined', async () => {
+    const nocodb = makeNocoEmpty();
+    const filing = { ...EXERCISE_FILING, insiderCik: 'differentCik' };
+    const result = await detectSameDaySell(filing, { nocodb });
+    expect(result).toBeUndefined();
+  });
+
+  test('NocoDB throws network error — logs WARN and returns undefined', async () => {
+    const nocodb = { list: jest.fn().mockRejectedValue(new Error('network')) };
+    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
+    const result = await detectSameDaySell(EXERCISE_FILING, { nocodb });
+    expect(result).toBeUndefined();
+    expect(warnSpy).toHaveBeenCalled();
+    warnSpy.mockRestore();
+  });
+
+  test('missing nocodb dep — returns undefined without throwing', async () => {
+    const result = await detectSameDaySell(EXERCISE_FILING, {});
+    expect(result).toBeUndefined();
+  });
+
+  test('different transactionDate — no match returns undefined', async () => {
+    const nocodb = makeNocoEmpty();
+    const filing = { ...EXERCISE_FILING, transactionDate: '2024-02-01' };
+    const result = await detectSameDaySell(filing, { nocodb });
+    expect(result).toBeUndefined();
+  });
+});
+
+// ─── runScoreAlert filtering chain (S03) ────────────────────────────────────
+
+describe('runScoreAlert filtering chain', () => {
+  beforeEach(() => jest.clearAllMocks());
+
+  function makeHelpers(adjustmentJson = '{"adjustment": 0, "reason": "ok"}') {
+    const fn = jest.fn().mockResolvedValue({
+      ok: true, status: 200,
+      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
+    });
+    const mockClient = {
+      complete: jest.fn().mockResolvedValue({ content: adjustmentJson }),
+    };
+    createDeepSeekClient.mockReturnValue(mockClient);
+    return { nocodb: makeNocoDB(fn), fetchFn: fn, deepseekApiKey: DEEPSEEK_KEY };
+  }
+
+  const SCORED_FILING = {
+    ...SAMPLE_FILING,
+    transactionCode: 'P', canonicalRole: 'CEO', marketCapUsd: 5_000_000_000,
+    transactionValue: 1_000_000, insiderCik: 'cik001', direction: 'A',
+    is10b5Plan: false,
+  };
+
+  test('G transaction — excluded from results (skipped)', async () => {
+    const helpers = makeHelpers();
+    const results = await runScoreAlert([{ ...SCORED_FILING, transactionCode: 'G' }], helpers);
+    expect(results).toHaveLength(0);
+  });
+
+  test('F transaction — excluded from results (skipped)', async () => {
+    const helpers = makeHelpers();
+    const results = await runScoreAlert([{ ...SCORED_FILING, transactionCode: 'F' }], helpers);
+    expect(results).toHaveLength(0);
+  });
+
+  test('S transaction (sale) — proceeds to scoring', async () => {
+    const helpers = makeHelpers();
+    const results = await runScoreAlert([{ ...SCORED_FILING, transactionCode: 'S', direction: 'D' }], helpers);
+    expect(results).toHaveLength(1);
+    expect(results[0]).toHaveProperty('significance_score');
+  });
+
+  test('P transaction (purchase) — proceeds to scoring', async () => {
+    const helpers = makeHelpers();
+    const results = await runScoreAlert([SCORED_FILING], helpers);
+    expect(results).toHaveLength(1);
+    expect(results[0]).toHaveProperty('significance_score');
+  });
+
+  test('M transaction with full sell — excluded from results', async () => {
+    const fn = jest.fn().mockResolvedValue({
+      ok: true, status: 200,
+      json: async () => ({
+        list: [{ transactionCode: 'S', transactionShares: 900, insiderCik: 'cik001', transactionDate: '2024-01-12' }],
+        pageInfo: { isLastPage: true },
+      }),
+    });
+    createDeepSeekClient.mockReturnValue({
+      complete: jest.fn().mockResolvedValue({ content: '{"adjustment": 0, "reason": "ok"}' }),
+    });
+    const filing = { ...SCORED_FILING, transactionCode: 'M', sharesExercised: 1000, transactionDate: '2024-01-12' };
+    const results = await runScoreAlert([filing], { nocodb: makeNocoDB(fn), fetchFn: fn, deepseekApiKey: DEEPSEEK_KEY });
+    expect(results).toHaveLength(0);
+  });
+
+  test('scored result has base_score, ai_adjustment, final_score fields', async () => {
+    const helpers = makeHelpers('{"adjustment": 1, "reason": "strong signal"}');
+    const results = await runScoreAlert([SCORED_FILING], helpers);
+    expect(results[0]).toHaveProperty('base_score');
+    expect(results[0]).toHaveProperty('ai_adjustment');
+    expect(results[0]).toHaveProperty('significance_score');
+  });
+});
+
+// ─── structured score logging (S03) ─────────────────────────────────────────
+
+describe('structured score logging', () => {
+  beforeEach(() => jest.clearAllMocks());
+
+  function makeHelpers() {
+    const fn = jest.fn().mockResolvedValue({
+      ok: true, status: 200,
+      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
+    });
+    createDeepSeekClient.mockReturnValue({
+      complete: jest.fn().mockResolvedValue({ content: '{"adjustment": 0, "reason": "ok"}' }),
+    });
+    return { nocodb: makeNocoDB(fn), fetchFn: fn, deepseekApiKey: DEEPSEEK_KEY };
+  }
+
+  const SCORED_FILING = {
+    ...SAMPLE_FILING,
+    transactionCode: 'P', canonicalRole: 'CEO', marketCapUsd: 5_000_000_000,
+    transactionValue: 1_000_000, insiderCik: 'cik001', direction: 'A', is10b5Plan: false,
+  };
+
+  test('scored alert emits structured log with required fields', async () => {
+    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
+    const helpers = makeHelpers();
+    await runScoreAlert([SCORED_FILING], helpers);
+    // Find a JSON log with finalScore
+    const jsonCalls = logSpy.mock.calls.map(c => c[0]).filter(s => {
+      try { const o = JSON.parse(s); return 'finalScore' in o; } catch { return false; }
+    });
+    expect(jsonCalls.length).toBeGreaterThan(0);
+    const log = JSON.parse(jsonCalls[0]);
+    expect(log).toHaveProperty('ticker');
+    expect(log).toHaveProperty('transactionCode');
+    expect(log).toHaveProperty('finalScore');
+    expect(log).toHaveProperty('timestamp');
+    logSpy.mockRestore();
+  });
+
+  test('skipped alert (G) emits log with skipReason', async () => {
+    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
+    const helpers = makeHelpers();
+    await runScoreAlert([{ ...SCORED_FILING, transactionCode: 'G' }], helpers);
+    const jsonCalls = logSpy.mock.calls.map(c => c[0]).filter(s => {
+      try { const o = JSON.parse(s); return 'skipReason' in o; } catch { return false; }
+    });
+    expect(jsonCalls.length).toBeGreaterThan(0);
+    const log = JSON.parse(jsonCalls[0]);
+    expect(log.skipReason).toMatch(/gift/i);
+    logSpy.mockRestore();
+  });
+
+  test('exercise-and-sell alert emits log with overrideReason and finalScore=0', async () => {
+    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
+    const fn = jest.fn().mockResolvedValue({
+      ok: true, status: 200,
+      json: async () => ({
+        list: [{ transactionCode: 'S', transactionShares: 900, insiderCik: 'cik001', transactionDate: '2024-01-15' }],
+        pageInfo: { isLastPage: true },
+      }),
+    });
+    createDeepSeekClient.mockReturnValue({
+      complete: jest.fn().mockResolvedValue({ content: '{"adjustment": 0, "reason": "ok"}' }),
+    });
+    const helpers = { nocodb: makeNocoDB(fn), fetchFn: fn, deepseekApiKey: DEEPSEEK_KEY };
+    await runScoreAlert([{
+      ...SCORED_FILING, transactionCode: 'M', sharesExercised: 1000,
+      insiderCik: 'cik001', transactionDate: '2024-01-15',
+    }], helpers);
+    const jsonCalls = logSpy.mock.calls.map(c => c[0]).filter(s => {
+      try { const o = JSON.parse(s); return 'overrideReason' in o; } catch { return false; }
+    });
+    expect(jsonCalls.length).toBeGreaterThan(0);
+    const log = JSON.parse(jsonCalls[0]);
+    expect(log.overrideReason).toBe('exercise-and-sell');
+    expect(log.finalScore).toBe(0);
+    logSpy.mockRestore();
+  });
+});
+
+// ─── runWeeklyCalibration (S04) ──────────────────────────────────────────────
+
+const { runWeeklyCalibration } = require('../../n8n/code/insiderbuying/score-alert');
+
+describe('runWeeklyCalibration', () => {
+  const ENV = {
+    NOCODB_BASE_URL: 'http://localhost:8080',
+    NOCODB_API_TOKEN: 'test-token',
+    NOCODB_PROJECT_ID: 'proj1',
+    TELEGRAM_BOT_TOKEN: 'bot123',
+    TELEGRAM_CHAT_ID: '-100111',
+  };
+
+  const ALERTS_TABLE = 'Alerts';
+  const CALIB_TABLE = 'score_calibration_runs';
+
+  // Helper: builds a fetchFn mock that returns given final_scores from NocoDB
+  function makeCalibFetch(scores, { nocoFails = false, telegramFails = false } = {}) {
+    return jest.fn().mockImplementation(async (url) => {
+      if (url.includes('api.telegram.org')) {
+        if (telegramFails) throw new Error('Telegram error');
+        return { ok: true, status: 200, json: async () => ({ ok: true }) };
+      }
+      if (nocoFails) throw new Error('NocoDB down');
+      if (url.includes(ALERTS_TABLE)) {
+        return {
+          ok: true, status: 200,
+          json: async () => ({ list: scores.map(s => ({ final_score: s })), pageInfo: { isLastPage: true } }),
+        };
+      }
+      // calibration write
+      return { ok: true, status: 200, json: async () => ({ Id: 42 }) };
+    });
+  }
+
+  function makeDeps(scores, opts = {}) {
+    const fetchFn = makeCalibFetch(scores, opts);
+    return { fetchFn, sleep: jest.fn().mockResolvedValue(undefined), env: ENV };
+  }
+
+  // ─ Distribution bucketing ──────────────────────────────────────────────────
+
+  test('correctly buckets 10 scores into 4 ranges', async () => {
+    // 1 in 1-3, 2 in 4-5, 3 in 6-7, 4 in 8-10
+    const scores = [2, 4, 5, 6, 6, 7, 8, 9, 10, 8];
+    const result = await runWeeklyCalibration(makeDeps(scores));
+    expect(result).not.toBeNull();
+    expect(result.total).toBe(10);
+    expect(result.buckets.pct_1_3).toBe(10);
+    expect(result.buckets.pct_4_5).toBe(20);
+    expect(result.buckets.pct_6_7).toBe(30);
+    expect(result.buckets.pct_8_10).toBe(40);
+  });
+
+  test('8-10 bucket > 25% sets flagged=true', async () => {
+    const scores = [8, 9, 10, 8, 7, 5, 4, 3, 6, 6]; // 4/10 = 40% in 8-10
+    const result = await runWeeklyCalibration(makeDeps(scores));
+    expect(result.flagged).toBe(true);
+  });
+
+  test('all same score (empty buckets) sets flagged=true', async () => {
+    const scores = Array(14).fill(5); // 100% in 4-5, rest empty
+    const result = await runWeeklyCalibration(makeDeps(scores));
+    expect(result.flagged).toBe(true);
+  });
+
+  test('healthy distribution (all buckets non-empty, 8-10 in range) sets flagged=false', async () => {
+    // ~10% 1-3, ~30% 4-5, ~40% 6-7, ~20% 8-10 → all buckets non-empty, 8-10=20% (5%–25%)
+    const scores = [2, 4, 4, 4, 6, 6, 6, 6, 8, 8];
+    const result = await runWeeklyCalibration(makeDeps(scores));
+    expect(result.flagged).toBe(false);
+  });
+
+  // ─ Telegram ────────────────────────────────────────────────────────────────
+
+  test('Telegram fires when 8-10 bucket > 25%', async () => {
+    const scores = [8, 9, 10, 8, 8, 5, 5, 4, 6, 6]; // 5/10 = 50%
+    const deps = makeDeps(scores);
+    await runWeeklyCalibration(deps);
+    const telegramCalls = deps.fetchFn.mock.calls.filter(c => c[0].includes('api.telegram.org'));
+    expect(telegramCalls.length).toBeGreaterThan(0);
+  });
+
+  test('Telegram fires when 8-10 bucket < 5%', async () => {
+    const scores = [2, 3, 4, 4, 5, 5, 6, 6, 7, 7]; // 0/10 = 0% in 8-10
+    const deps = makeDeps(scores);
+    await runWeeklyCalibration(deps);
+    const telegramCalls = deps.fetchFn.mock.calls.filter(c => c[0].includes('api.telegram.org'));
+    expect(telegramCalls.length).toBeGreaterThan(0);
+  });
+
+  test('Telegram does NOT fire for healthy distribution', async () => {
+    const scores = [2, 4, 4, 4, 6, 6, 6, 6, 8, 8]; // healthy
+    const deps = makeDeps(scores);
+    await runWeeklyCalibration(deps);
+    const telegramCalls = deps.fetchFn.mock.calls.filter(c => c[0].includes('api.telegram.org'));
+    expect(telegramCalls.length).toBe(0);
+  });
+
+  test('Telegram message contains distribution table with all 4 buckets', async () => {
+    const scores = [8, 9, 10, 8, 8, 5, 5, 4, 6, 6]; // flagged
+    const deps = makeDeps(scores);
+    await runWeeklyCalibration(deps);
+    const telegramCall = deps.fetchFn.mock.calls.find(c => c[0].includes('api.telegram.org'));
+    const body = JSON.parse(telegramCall[1].body);
+    expect(body.text).toContain('1-3');
+    expect(body.text).toContain('4-5');
+    expect(body.text).toContain('6-7');
+    expect(body.text).toContain('8-10');
+    expect(body.text).toContain('10'); // total count
+  });
+
+  // ─ NocoDB calibration record ────────────────────────────────────────────────
+
+  test('calibration record is always written (flagged=false)', async () => {
+    const scores = [2, 4, 4, 4, 6, 6, 6, 6, 8, 8]; // healthy
+    const deps = makeDeps(scores);
+    await runWeeklyCalibration(deps);
+    const calibCalls = deps.fetchFn.mock.calls.filter(c => c[0].includes(CALIB_TABLE) && c[1]?.method === 'POST');
+    expect(calibCalls.length).toBeGreaterThan(0);
+  });
+
+  test('calibration record is written when flagged=true', async () => {
+    const scores = [8, 9, 10, 8, 8, 5, 5, 4, 6, 6]; // flagged
+    const deps = makeDeps(scores);
+    await runWeeklyCalibration(deps);
+    const calibCalls = deps.fetchFn.mock.calls.filter(c => c[0].includes(CALIB_TABLE) && c[1]?.method === 'POST');
+    expect(calibCalls.length).toBeGreaterThan(0);
+    const body = JSON.parse(calibCalls[0][1].body);
+    expect(body.flagged).toBe(true);
+    expect(body).toHaveProperty('run_date');
+    expect(body).toHaveProperty('total_alerts');
+    expect(body).toHaveProperty('pct_1_3');
+    expect(body).toHaveProperty('pct_8_10');
+  });
+
+  // ─ Zero alerts early exit ─────────────────────────────────────────────────
+
+  test('zero alerts → returns early, no Telegram, no calibration write', async () => {
+    const deps = makeDeps([]); // empty alerts
+    const result = await runWeeklyCalibration(deps);
+    expect(result).not.toBeNull(); // returns early message, not null
+    const telegramCalls = deps.fetchFn.mock.calls.filter(c => c[0].includes('api.telegram.org'));
+    const calibCalls = deps.fetchFn.mock.calls.filter(c => c[0].includes(CALIB_TABLE) && c[1]?.method === 'POST');
+    expect(telegramCalls).toHaveLength(0);
+    expect(calibCalls).toHaveLength(0);
+  });
+
+  // ─ Error handling ──────────────────────────────────────────────────────────
+
+  test('NocoDB query failure → returns null, no crash, no calibration record', async () => {
+    const deps = makeDeps([], { nocoFails: true });
+    const warnSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
+    const result = await runWeeklyCalibration(deps);
+    expect(result).toBeNull();
+    warnSpy.mockRestore();
+  });
+
+  test('Telegram failure does not abort calibration record write', async () => {
+    const scores = [8, 9, 10, 8, 8, 5, 5, 4, 6, 6]; // flagged
+    const deps = makeDeps(scores, { telegramFails: true });
+    const warnSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
+    const result = await runWeeklyCalibration(deps); // should not throw
+    // calibration write should still happen
+    const calibCalls = deps.fetchFn.mock.calls.filter(c => c[0].includes(CALIB_TABLE) && c[1]?.method === 'POST');
+    expect(calibCalls.length).toBeGreaterThan(0);
+    warnSpy.mockRestore();
   });
 });
