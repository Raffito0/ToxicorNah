diff --git a/insiderbuying-site/n8n/code/insiderbuying/score-alert.js b/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
index 78f5a70..a368e5a 100644
--- a/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
+++ b/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
@@ -3,12 +3,12 @@
 // ─── score-alert.js ─────────────────────────────────────────────────────────
 // Significance scoring node for the W4 InsiderBuying.ai pipeline.
 // Runs after sec-monitor.js, before analyze-alert.js.
-// Computes a 1-10 significance score using Claude Haiku plus insider track
+// Computes a 1-10 significance score using DeepSeek plus insider track
 // record from NocoDB Insider_History and Yahoo Finance 30-day price returns.
 // ────────────────────────────────────────────────────────────────────────────
 
-const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
-const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
+const { createDeepSeekClient } = require('./ai-client');
+
 const YAHOO_API = 'https://query1.finance.yahoo.com/v8/finance/chart';
 const HISTORY_MONTHS = 24;
 
@@ -127,6 +127,76 @@ async function computeTrackRecord(insiderName, nocodb, { fetchFn } = {}) {
   return { past_buy_count: rows.length, hit_rate, avg_gain_30d };
 }
 
+// ─── computeBaseScore ────────────────────────────────────────────────────────
+
+const ROLE_WEIGHT = {
+  'ceo': 2.5, 'chief executive officer': 2.5,
+  'cfo': 2.0, 'chief financial officer': 2.0,
+  'president': 2.0,
+  'coo': 1.8, 'chief operating officer': 1.8,
+  'director': 1.0,
+};
+
+/**
+ * Deterministic 5-factor weighted base score for a filing.
+ * Returns 0 for excluded transaction codes (G/F).
+ * Returns a number in [1, 10] rounded to one decimal.
+ * Never throws — null fields are skipped gracefully.
+ */
+function computeBaseScore(filing) {
+  if (!filing) return 1;
+
+  const {
+    transactionValue, transactionCode, canonicalRole,
+    marketCapUsd, clusterCount7Days, clusterCount14Days,
+    historicalAvgReturn, historicalCount,
+  } = filing;
+
+  if (transactionCode === 'G' || transactionCode === 'F') return 0;
+
+  let score = 5.0;
+
+  // Factor 1 — Transaction Value (~30%)
+  if (transactionValue != null && transactionValue > 0) {
+    if (transactionValue >= 10_000_000)      score += 3.0;
+    else if (transactionValue >= 5_000_000)  score += 2.4;
+    else if (transactionValue >= 2_500_000)  score += 1.9;
+    else if (transactionValue >= 1_000_000)  score += 1.5;
+    else if (transactionValue >= 500_000)    score += 1.2;
+    else if (transactionValue >= 250_000)    score += 0.9;
+    else if (transactionValue >= 100_000)    score += 0.6;
+    else                                     score -= 1.0;
+  }
+
+  // Factor 2 — Insider Role (~25%)
+  const roleKey = (canonicalRole || '').toLowerCase().trim();
+  score += ROLE_WEIGHT[roleKey] ?? 0.5;
+
+  // Factor 3 — Market Cap (~20%)
+  if (marketCapUsd == null) {
+    console.warn('[score-alert] marketCapUsd null — skipping market cap factor');
+  } else if (marketCapUsd >= 100_000_000_000) score += 0.6;   // mega-cap >= $100B
+  else if (marketCapUsd >= 10_000_000_000)    score += 0.8;   // large-cap $10B-$100B
+  else if (marketCapUsd >= 2_000_000_000)     score += 1.0;   // mid-cap $2B-$10B
+  else                                        score += 1.5;   // small/micro-cap < $2B
+
+  // Factor 4 — Cluster Signal (~15%)
+  if (clusterCount7Days != null) {
+    if (clusterCount7Days >= 3)      score += 0.5;
+    else if (clusterCount7Days >= 2) score += 0.3;
+  } else if (clusterCount14Days != null) {
+    if (clusterCount14Days >= 3) score += 0.2;
+  }
+
+  // Factor 5 — Track Record (~5%)
+  if (historicalAvgReturn != null && historicalCount != null && historicalCount >= 2) {
+    if (historicalAvgReturn > 20 && historicalCount >= 3) score += 0.5;
+    else if (historicalAvgReturn > 10)                    score += 0.3;
+  }
+
+  return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
+}
+
 // ─── 3.2 buildHaikuPrompt ───────────────────────────────────────────────────
 
 /**
@@ -237,62 +307,37 @@ function parseHaikuResponse(rawText) {
 const HAIKU_DEFAULT = { score: 5, reasoning: 'Scoring unavailable' };
 
 /**
- * Calls Anthropic Haiku API with prompt. Retries up to 2 times on failure.
- * Returns { score, reasoning } or default { score: 5, ... } on exhausted retries.
+ * Calls DeepSeek via ai-client with prompt.
+ * Returns { score, reasoning } or HAIKU_DEFAULT on any error.
+ * Retry logic is delegated to the ai-client layer.
+ *
+ * @param {string} prompt
+ * @param {object} deepseekClient - AIClient instance from createDeepSeekClient()
  */
-async function callHaiku(prompt, anthropicApiKey, { fetchFn, _sleep } = {}) {
-  const body = JSON.stringify({
-    model: HAIKU_MODEL,
-    max_tokens: 256,
-    messages: [{ role: 'user', content: prompt }],
-  });
-
-  const headers = {
-    'Content-Type': 'application/json',
-    'x-api-key': anthropicApiKey,
-    'anthropic-version': '2023-06-01',
-  };
-
-  for (let attempt = 0; attempt <= 2; attempt++) {
-    try {
-      if (attempt > 0 && _sleep) await _sleep(1000 * attempt);
-
-      const resp = await fetchFn(ANTHROPIC_API, { method: 'POST', headers, body });
-
-      if (!resp.ok) {
-        if (attempt === 2) return { ...HAIKU_DEFAULT };
-        continue;
-      }
-
-      const data = await resp.json();
-      const rawText = data?.content?.[0]?.text;
-      if (!rawText) {
-        if (attempt === 2) return { ...HAIKU_DEFAULT };
-        continue;
-      }
-
-      return parseHaikuResponse(rawText);
-    } catch {
-      if (attempt === 2) return { ...HAIKU_DEFAULT };
-    }
+async function callHaiku(prompt, deepseekClient) {
+  try {
+    const result = await deepseekClient.complete(null, prompt, { temperature: 0.3 });
+    return parseHaikuResponse(result.content);
+  } catch (err) {
+    console.log(`[score-alert] scoring failed: ${err.message}`);
+    return { ...HAIKU_DEFAULT };
   }
-
-  return { ...HAIKU_DEFAULT };
 }
 
 // ─── 3.3 runScoreAlert ──────────────────────────────────────────────────────
 
 /**
  * Main n8n node entry point.
- * Iterates over all filings sequentially, scores each with Haiku,
+ * Iterates over all filings sequentially, scores each with DeepSeek,
  * and returns the enriched filing array.
  *
  * @param {Array} filings - Array of filing objects from sec-monitor.js
- * @param {Object} helpers - { nocodb, anthropicApiKey, fetchFn, _sleep }
+ * @param {Object} helpers - { nocodb, deepseekApiKey, fetchFn }
  * @returns {Array} filings enriched with significance_score, score_reasoning, track_record
  */
 async function runScoreAlert(filings, helpers = {}) {
-  const { nocodb, anthropicApiKey, fetchFn, _sleep } = helpers;
+  const { nocodb, fetchFn, deepseekApiKey } = helpers;
+  const deepseek = createDeepSeekClient(fetchFn, deepseekApiKey);
 
   if (!filings || filings.length === 0) return [];
 
@@ -306,9 +351,9 @@ async function runScoreAlert(filings, helpers = {}) {
       { fetchFn }
     );
 
-    // Step 2: build prompt and call Haiku
+    // Step 2: build prompt and call DeepSeek
     const prompt = buildHaikuPrompt(filing, trackRecord);
-    const { score, reasoning } = await callHaiku(prompt, anthropicApiKey, { fetchFn, _sleep });
+    const { score, reasoning } = await callHaiku(prompt, deepseek);
 
     results.push({
       ...filing,
@@ -342,9 +387,8 @@ async function runScoreAlert(filings, helpers = {}) {
 //   );
 //   const helpers = {
 //     nocodb,
-//     anthropicApiKey: $env.ANTHROPIC_API_KEY,
+//     deepseekApiKey: $env.DEEPSEEK_API_KEY,
 //     fetchFn: (url, opts) => fetch(url, opts),
-//     _sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
 //   };
 //   const results = await runScoreAlert(filings, helpers);
 //   return results.map(item => ({ json: item }));
@@ -359,4 +403,5 @@ module.exports = {
   parseHaikuResponse,
   callHaiku,
   runScoreAlert,
+  computeBaseScore,
 };
diff --git a/insiderbuying-site/tests/insiderbuying/score-alert.test.js b/insiderbuying-site/tests/insiderbuying/score-alert.test.js
index da0984c..807cdaa 100644
--- a/insiderbuying-site/tests/insiderbuying/score-alert.test.js
+++ b/insiderbuying-site/tests/insiderbuying/score-alert.test.js
@@ -1,5 +1,14 @@
 'use strict';
 
+// ---------------------------------------------------------------------------
+// Mock ai-client BEFORE requiring score-alert
+// ---------------------------------------------------------------------------
+jest.mock('../../n8n/code/insiderbuying/ai-client', () => ({
+  createDeepSeekClient: jest.fn(),
+}));
+
+const { createDeepSeekClient } = require('../../n8n/code/insiderbuying/ai-client');
+
 const {
   normalizeInsiderName,
   computeTrackRecord,
@@ -7,6 +16,7 @@ const {
   parseHaikuResponse,
   callHaiku,
   runScoreAlert,
+  computeBaseScore,
 } = require('../../n8n/code/insiderbuying/score-alert');
 
 const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
@@ -34,7 +44,19 @@ const noSleep = jest.fn().mockResolvedValue(undefined);
 const NOCODB_BASE_URL = 'http://localhost:8080';
 const NOCODB_TOKEN = 'test-token';
 const NOCODB_PROJECT_ID = 'test-project-id';
-const ANTHROPIC_KEY = 'test-anthropic';
+const DEEPSEEK_KEY = 'test-deepseek';
+
+function makeMockDeepSeekClient(content = null, throws = null) {
+  const complete = throws
+    ? jest.fn().mockRejectedValue(throws)
+    : jest.fn().mockResolvedValue({
+        content: content || '{"score": 8, "reasoning": "Large C-Suite purchase signals confidence."}',
+        usage: { inputTokens: 200, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
+        cached: false,
+        estimatedCost: 0.0001,
+      });
+  return { complete };
+}
 
 function makeNocoDB(fetchFn) {
   return new NocoDB(NOCODB_BASE_URL, NOCODB_TOKEN, NOCODB_PROJECT_ID, fetchFn);
@@ -333,73 +355,110 @@ describe('score clamping and rounding', () => {
   });
 });
 
+// ─── source code checks ─────────────────────────────────────────────────────
+
+const path = require('path');
+const fs = require('fs');
+const srcPath = path.resolve(__dirname, '../../n8n/code/insiderbuying/score-alert.js');
+const src = fs.readFileSync(srcPath, 'utf8');
+
+describe('source code checks', () => {
+  test('no anthropic.com URL in source', () => {
+    expect(src).not.toContain('anthropic.com');
+  });
+
+  test('no claude-haiku model string in source', () => {
+    expect(src).not.toContain('claude-haiku');
+  });
+
+  test('no x-api-key header in source', () => {
+    expect(src).not.toContain('x-api-key');
+  });
+
+  test('imports createDeepSeekClient from ai-client', () => {
+    expect(src).toContain("require('./ai-client')");
+    expect(src).toContain('createDeepSeekClient');
+  });
+});
+
 // ─── 3.2 callHaiku ──────────────────────────────────────────────────────────────
 
 describe('callHaiku', () => {
-  test('calls Anthropic messages endpoint with correct model', async () => {
-    const fetchFn = makeFetch({
-      content: [{ type: 'text', text: HAIKU_JSON_RESPONSE }],
-    });
-    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
-    const [url, opts] = fetchFn.mock.calls[0];
-    expect(url).toContain('anthropic.com');
-    expect(JSON.parse(opts.body).model).toContain('haiku');
-  });
+  beforeEach(() => jest.clearAllMocks());
 
-  test('returns parsed score and reasoning on success', async () => {
-    const fetchFn = makeFetch({
-      content: [{ type: 'text', text: HAIKU_JSON_RESPONSE }],
-    });
-    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
+  test('calls deepseekClient.complete with prompt and returns parsed score', async () => {
+    const client = makeMockDeepSeekClient('{"score": 8, "reasoning": "Large C-Suite purchase."}');
+    const result = await callHaiku('test prompt', client);
+    expect(client.complete).toHaveBeenCalledWith(null, 'test prompt', { temperature: 0.3 });
     expect(result.score).toBe(8);
     expect(result.reasoning).toContain('C-Suite');
   });
 
-  test('retries on 429 and succeeds on 2nd attempt', async () => {
-    const fetchFn = jest.fn()
-      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
-      .mockResolvedValueOnce({
-        ok: true, status: 200,
-        json: async () => ({ content: [{ type: 'text', text: HAIKU_JSON_RESPONSE }] }),
-      });
-    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
-    expect(result.score).toBe(8);
-    expect(fetchFn).toHaveBeenCalledTimes(2);
+  test('handles markdown-fenced JSON from DeepSeek', async () => {
+    const fenced = '```json\n{"score": 7, "reasoning": "Solid signal."}\n```';
+    const client = makeMockDeepSeekClient(fenced);
+    const result = await callHaiku('prompt', client);
+    expect(result.score).toBe(7);
+    expect(result.reasoning).toContain('Solid');
+  });
+
+  test('returns HAIKU_DEFAULT on client error', async () => {
+    const client = makeMockDeepSeekClient(null, new Error('API failure'));
+    const result = await callHaiku('prompt', client);
+    expect(result).toEqual({ score: 5, reasoning: 'Scoring unavailable' });
   });
 
-  test('defaults to score=5 after 2 retries exhausted', async () => {
-    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
-    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
+  test('returns HAIKU_DEFAULT on network error', async () => {
+    const client = makeMockDeepSeekClient(null, new Error('ECONNRESET'));
+    const result = await callHaiku('prompt', client);
     expect(result).toEqual({ score: 5, reasoning: 'Scoring unavailable' });
-    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
   });
 
-  test('defaults to score=5 on network error after retries', async () => {
-    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
-    const result = await callHaiku('test prompt', ANTHROPIC_KEY, { fetchFn, _sleep: noSleep });
+  test('returns HAIKU_DEFAULT on invalid JSON response', async () => {
+    const client = makeMockDeepSeekClient('not valid json at all');
+    const result = await callHaiku('prompt', client);
     expect(result).toEqual({ score: 5, reasoning: 'Scoring unavailable' });
   });
+
+  test('complete() called exactly once per callHaiku() call (no internal retry loop)', async () => {
+    const client = makeMockDeepSeekClient('{"score": 6, "reasoning": "Test."}');
+    await callHaiku('prompt', client);
+    expect(client.complete).toHaveBeenCalledTimes(1);
+  });
 });
 
 // ─── 3.3 runScoreAlert integration ──────────────────────────────────────────────
 
 describe('runScoreAlert', () => {
-  test('returns scored filing with significance_score, score_reasoning, track_record', async () => {
-    const nocodbFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) });
-    const nocodb = makeNocoDB(nocodbFn);
+  beforeEach(() => {
+    jest.clearAllMocks();
+  });
 
-    const haikuFn = jest.fn().mockResolvedValue({
+  function makeRunHelpers(completeContent = '{"score": 7, "reasoning": "Good signal."}') {
+    const nocodbFn = jest.fn().mockResolvedValue({
       ok: true, status: 200,
-      json: async () => ({ content: [{ type: 'text', text: '{"score": 7, "reasoning": "Good signal."}' }] }),
+      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
     });
+    const nocodb = makeNocoDB(nocodbFn);
+    const mockClient = makeMockDeepSeekClient(completeContent);
+    createDeepSeekClient.mockReturnValue(mockClient);
+    return { nocodb, nocodbFn, mockClient };
+  }
 
+  test('calls createDeepSeekClient with fetchFn and deepseekApiKey', async () => {
+    const { nocodb } = makeRunHelpers();
+    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) });
+    await runScoreAlert([SAMPLE_FILING], { nocodb, fetchFn, deepseekApiKey: DEEPSEEK_KEY });
+    expect(createDeepSeekClient).toHaveBeenCalledWith(fetchFn, DEEPSEEK_KEY);
+  });
+
+  test('returns scored filing with significance_score, score_reasoning, track_record', async () => {
+    const { nocodb } = makeRunHelpers();
     const result = await runScoreAlert([SAMPLE_FILING], {
       nocodb,
-      anthropicApiKey: ANTHROPIC_KEY,
-      fetchFn: haikuFn,
-      _sleep: noSleep,
+      fetchFn: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) }),
+      deepseekApiKey: DEEPSEEK_KEY,
     });
-
     expect(result).toHaveLength(1);
     expect(result[0]).toMatchObject({
       ticker: 'AAPL',
@@ -411,42 +470,24 @@ describe('runScoreAlert', () => {
 
   test('processes multiple filings sequentially', async () => {
     const filing2 = { ...SAMPLE_FILING, ticker: 'MSFT', insider_name: 'Satya Nadella' };
-    const nocodbFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) });
-    const nocodb = makeNocoDB(nocodbFn);
-
-    const haikuFn = jest.fn().mockResolvedValue({
-      ok: true, status: 200,
-      json: async () => ({ content: [{ type: 'text', text: '{"score": 6, "reasoning": "Moderate."}' }] }),
-    });
-
+    const { nocodb } = makeRunHelpers('{"score": 6, "reasoning": "Moderate."}');
     const results = await runScoreAlert([SAMPLE_FILING, filing2], {
       nocodb,
-      anthropicApiKey: ANTHROPIC_KEY,
-      fetchFn: haikuFn,
-      _sleep: noSleep,
+      fetchFn: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) }),
+      deepseekApiKey: DEEPSEEK_KEY,
     });
-
     expect(results).toHaveLength(2);
     expect(results[0].ticker).toBe('AAPL');
     expect(results[1].ticker).toBe('MSFT');
   });
 
   test('preserves all original filing fields in output', async () => {
-    const nocodbFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) });
-    const nocodb = makeNocoDB(nocodbFn);
-
-    const haikuFn = jest.fn().mockResolvedValue({
-      ok: true, status: 200,
-      json: async () => ({ content: [{ type: 'text', text: '{"score": 5, "reasoning": "Test."}' }] }),
-    });
-
+    const { nocodb } = makeRunHelpers('{"score": 5, "reasoning": "Test."}');
     const results = await runScoreAlert([SAMPLE_FILING], {
       nocodb,
-      anthropicApiKey: ANTHROPIC_KEY,
-      fetchFn: haikuFn,
-      _sleep: noSleep,
+      fetchFn: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) }),
+      deepseekApiKey: DEEPSEEK_KEY,
     });
-
     expect(results[0].is_cluster_buy).toBe(false);
     expect(results[0].cluster_id).toBeNull();
     expect(results[0].transaction_type).toBe('P - Purchase');
@@ -455,10 +496,302 @@ describe('runScoreAlert', () => {
   test('handles empty filings array', async () => {
     const results = await runScoreAlert([], {
       nocodb: makeNocoDB(jest.fn()),
-      anthropicApiKey: ANTHROPIC_KEY,
       fetchFn: jest.fn(),
-      _sleep: noSleep,
+      deepseekApiKey: DEEPSEEK_KEY,
     });
     expect(results).toEqual([]);
   });
 });
+
+// ─── computeBaseScore ────────────────────────────────────────────────────────
+
+describe('computeBaseScore', () => {
+  // Neutral base: unknown role (+0.5), null market cap (skip), no cluster, no track record
+  const NEUTRAL = {
+    transactionCode: 'P',
+    canonicalRole: 'Unknown',
+    marketCapUsd: null,
+    clusterCount7Days: null,
+    clusterCount14Days: null,
+    historicalAvgReturn: null,
+    historicalCount: null,
+  };
+
+  // ─ Early exit ─
+  test('returns 0 for gift (G) transaction code', () => {
+    expect(computeBaseScore({ ...NEUTRAL, transactionValue: 5_000_000, transactionCode: 'G' })).toBe(0);
+  });
+
+  test('returns 0 for tax withholding (F) transaction code', () => {
+    expect(computeBaseScore({ ...NEUTRAL, transactionValue: 5_000_000, transactionCode: 'F' })).toBe(0);
+  });
+
+  test('sale (S) is not excluded — scores normally', () => {
+    const score = computeBaseScore({ ...NEUTRAL, transactionValue: 5_000_000, transactionCode: 'S' });
+    expect(score).toBeGreaterThan(0);
+  });
+
+  // ─ Factor 1: Transaction Value ─
+  describe('Factor 1 — Transaction Value', () => {
+    test('>= $10M → adjustment +3.0 (base 5.0 + 3.0 + 0.5 unknown = 8.5)', () => {
+      expect(computeBaseScore({ ...NEUTRAL, transactionValue: 10_000_000 })).toBe(8.5);
+    });
+
+    test('$5M → adjustment +2.4 (5.0 + 2.4 + 0.5 = 7.9)', () => {
+      expect(computeBaseScore({ ...NEUTRAL, transactionValue: 5_000_000 })).toBe(7.9);
+    });
+
+    test('$100K → adjustment +0.6 (5.0 + 0.6 + 0.5 = 6.1)', () => {
+      expect(computeBaseScore({ ...NEUTRAL, transactionValue: 100_000 })).toBe(6.1);
+    });
+
+    test('$50K (below threshold) → adjustment -1.0 (5.0 - 1.0 + 0.5 = 4.5)', () => {
+      expect(computeBaseScore({ ...NEUTRAL, transactionValue: 50_000 })).toBe(4.5);
+    });
+  });
+
+  // ─ Factor 2: Insider Role ─
+  // Isolate with $100K (+0.6), null market cap
+  describe('Factor 2 — Insider Role', () => {
+    const f1 = { ...NEUTRAL, transactionValue: 100_000 }; // 5.0 + 0.6 = 5.6 before F2
+
+    test('CEO → adjustment +2.5 (5.6 + 2.5 = 8.1)', () => {
+      expect(computeBaseScore({ ...f1, canonicalRole: 'CEO' })).toBe(8.1);
+    });
+
+    test('Director → adjustment +1.0 (5.6 + 1.0 = 6.6)', () => {
+      expect(computeBaseScore({ ...f1, canonicalRole: 'Director' })).toBe(6.6);
+    });
+
+    test('unknown title → adjustment +0.5 default (5.6 + 0.5 = 6.1)', () => {
+      expect(computeBaseScore({ ...f1, canonicalRole: 'VP of Snacks' })).toBe(6.1);
+    });
+  });
+
+  // ─ Factor 3: Market Cap ─
+  // Isolate with $100K (+0.6), Director (+1.0) → 5.0+0.6+1.0 = 6.6 before F3
+  describe('Factor 3 — Market Cap', () => {
+    const f1f2 = { ...NEUTRAL, transactionValue: 100_000, canonicalRole: 'Director' };
+
+    test('small-cap $500M → adjustment +1.5 (6.6 + 1.5 = 8.1)', () => {
+      expect(computeBaseScore({ ...f1f2, marketCapUsd: 500_000_000 })).toBe(8.1);
+    });
+
+    test('mega-cap $100B → adjustment +0.6 (6.6 + 0.6 = 7.2)', () => {
+      expect(computeBaseScore({ ...f1f2, marketCapUsd: 100_000_000_000 })).toBe(7.2);
+    });
+
+    test('null marketCapUsd → factor skipped, no throw, no adjustment', () => {
+      expect(() => computeBaseScore({ ...f1f2, marketCapUsd: null })).not.toThrow();
+      expect(computeBaseScore({ ...f1f2, marketCapUsd: null })).toBe(6.6);
+    });
+
+    test('null marketCapUsd → emits console.warn', () => {
+      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
+      computeBaseScore({ ...f1f2, marketCapUsd: null });
+      expect(spy).toHaveBeenCalledWith(expect.stringContaining('marketCapUsd null'));
+      spy.mockRestore();
+    });
+  });
+
+  // ─ Factor 4: Cluster Signal ─
+  // Isolate with $100K (+0.6), Director (+1.0), null market cap → base 6.6
+  describe('Factor 4 — Cluster Signal', () => {
+    const f1f2f3 = { ...NEUTRAL, transactionValue: 100_000, canonicalRole: 'Director' };
+
+    test('clusterCount7Days >= 3 → adjustment +0.5 (6.6 + 0.5 = 7.1)', () => {
+      expect(computeBaseScore({ ...f1f2f3, clusterCount7Days: 3 })).toBe(7.1);
+    });
+
+    test('clusterCount7Days = 2 → adjustment +0.3 (6.6 + 0.3 = 6.9)', () => {
+      expect(computeBaseScore({ ...f1f2f3, clusterCount7Days: 2 })).toBe(6.9);
+    });
+
+    test('null 7-day, clusterCount14Days >= 3 → adjustment +0.2 (6.6 + 0.2 = 6.8)', () => {
+      expect(computeBaseScore({ ...f1f2f3, clusterCount7Days: null, clusterCount14Days: 3 })).toBe(6.8);
+    });
+
+    test('both cluster counts null → no adjustment (6.6)', () => {
+      expect(computeBaseScore({ ...f1f2f3, clusterCount7Days: null, clusterCount14Days: null })).toBe(6.6);
+    });
+  });
+
+  // ─ Factor 5: Track Record ─
+  // Isolate with $100K (+0.6), Director (+1.0), null market cap, no cluster → base 6.6
+  describe('Factor 5 — Track Record', () => {
+    const f1f2f3f4 = { ...NEUTRAL, transactionValue: 100_000, canonicalRole: 'Director' };
+
+    test('avgReturn=25, count=4 → adjustment +0.5 (6.6 + 0.5 = 7.1)', () => {
+      expect(computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: 25, historicalCount: 4 })).toBe(7.1);
+    });
+
+    test('avgReturn=15, count=2 → adjustment +0.3 (6.6 + 0.3 = 6.9)', () => {
+      expect(computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: 15, historicalCount: 2 })).toBe(6.9);
+    });
+
+    test('avgReturn=15, count=1 → 0 bonus (below 2-trade minimum, stays at 6.6)', () => {
+      expect(computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: 15, historicalCount: 1 })).toBe(6.6);
+    });
+
+    test('null historicalAvgReturn → factor skipped, no throw (6.6)', () => {
+      expect(() => computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: null })).not.toThrow();
+      expect(computeBaseScore({ ...f1f2f3f4, historicalAvgReturn: null })).toBe(6.6);
+    });
+  });
+
+  // ─ Clamping and output format ─
+  describe('Clamping and output format', () => {
+    test('score exceeding 10 is clamped to 10', () => {
+      // CEO+$10M+micro-cap+cluster3 = 5+3+2.5+1.5+0.5 = 12.5 → 10
+      expect(computeBaseScore({
+        transactionCode: 'P', transactionValue: 10_000_000, canonicalRole: 'CEO',
+        marketCapUsd: 200_000_000, clusterCount7Days: 3,
+        clusterCount14Days: null, historicalAvgReturn: null, historicalCount: null,
+      })).toBe(10);
+    });
+
+    test('output has at most one decimal place', () => {
+      const score = computeBaseScore({ ...NEUTRAL, transactionValue: 500_000, canonicalRole: 'Director', marketCapUsd: null });
+      expect(score.toString()).toMatch(/^\d+(\.\d)?$/);
+    });
+
+    test('output is always a number (never NaN, never null)', () => {
+      const score = computeBaseScore({ ...NEUTRAL, transactionValue: 100_000 });
+      expect(typeof score).toBe('number');
+      expect(isNaN(score)).toBe(false);
+    });
+  });
+
+  // ─ Fixture filings ─
+  describe('Fixture filings', () => {
+    test('Fixture 1: CEO, $5M purchase, mid-cap, no cluster → >= 8', () => {
+      const score = computeBaseScore({
+        transactionCode: 'P', transactionValue: 5_000_000, canonicalRole: 'CEO',
+        marketCapUsd: 5_000_000_000, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(score).toBeGreaterThanOrEqual(8);
+    });
+
+    test('Fixture 2: Director, $100K purchase, small-cap, no cluster → >= 5', () => {
+      const score = computeBaseScore({
+        transactionCode: 'P', transactionValue: 100_000, canonicalRole: 'Director',
+        marketCapUsd: 500_000_000, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(score).toBeGreaterThanOrEqual(5);
+    });
+
+    test('Fixture 3: CFO, $1M purchase, large-cap, cluster 3 in 7 days → >= 7', () => {
+      const score = computeBaseScore({
+        transactionCode: 'P', transactionValue: 1_000_000, canonicalRole: 'CFO',
+        marketCapUsd: 50_000_000_000, clusterCount7Days: 3, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(score).toBeGreaterThanOrEqual(7);
+    });
+
+    test('Fixture 4: CEO, $3M sale, small-cap → >= 7 (sells score same as buys)', () => {
+      const score = computeBaseScore({
+        transactionCode: 'S', transactionValue: 3_000_000, canonicalRole: 'CEO',
+        marketCapUsd: 500_000_000, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(score).toBeGreaterThanOrEqual(7);
+    });
+
+    test('Fixture 5: President, $500K, micro-cap, track record 25% over 3 trades → >= 8', () => {
+      const score = computeBaseScore({
+        transactionCode: 'P', transactionValue: 500_000, canonicalRole: 'President',
+        marketCapUsd: 100_000_000, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: 25, historicalCount: 3,
+      });
+      expect(score).toBeGreaterThanOrEqual(8);
+    });
+
+    test('Fixture 6: Unknown role, $100K, mega-cap → between 4 and 8', () => {
+      const score = computeBaseScore({
+        transactionCode: 'P', transactionValue: 100_000, canonicalRole: 'Unknown Title',
+        marketCapUsd: 500_000_000_000, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(score).toBeGreaterThanOrEqual(4);
+      expect(score).toBeLessThanOrEqual(8);
+    });
+
+    test('Fixture 7: CEO, $10M, micro-cap, cluster 3+ → 10 (capped at max)', () => {
+      const score = computeBaseScore({
+        transactionCode: 'P', transactionValue: 10_000_000, canonicalRole: 'CEO',
+        marketCapUsd: 100_000_000, clusterCount7Days: 3, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(score).toBe(10);
+    });
+
+    test('Fixture 8: Director, $50K, large-cap → small score (penalty dominates) <= 7', () => {
+      const score = computeBaseScore({
+        transactionCode: 'P', transactionValue: 50_000, canonicalRole: 'Director',
+        marketCapUsd: 50_000_000_000, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(score).toBeLessThanOrEqual(7);
+    });
+
+    test('Fixture 9: CEO, $5M, all enriched null fields — does not throw', () => {
+      expect(() => computeBaseScore({
+        transactionCode: 'P', transactionValue: 5_000_000, canonicalRole: 'CEO',
+        marketCapUsd: null, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      })).not.toThrow();
+    });
+
+    test('Fixture 9: CEO, $5M, null fields → lower than Fixture 1 (no market cap bonus)', () => {
+      const withCap = computeBaseScore({
+        transactionCode: 'P', transactionValue: 5_000_000, canonicalRole: 'CEO',
+        marketCapUsd: 5_000_000_000, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      const withoutCap = computeBaseScore({
+        transactionCode: 'P', transactionValue: 5_000_000, canonicalRole: 'CEO',
+        marketCapUsd: null, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(withoutCap).toBeLessThanOrEqual(withCap);
+    });
+
+    test('Fixture 10: all minimum values → between 1 and 6', () => {
+      const score = computeBaseScore({
+        transactionCode: 'P', transactionValue: 1_000, canonicalRole: 'Unknown Role',
+        marketCapUsd: null, clusterCount7Days: null, clusterCount14Days: null,
+        historicalAvgReturn: null, historicalCount: null,
+      });
+      expect(score).toBeGreaterThanOrEqual(1);
+      expect(score).toBeLessThanOrEqual(6);
+    });
+  });
+
+  // ─ Edge cases (guard fixes) ─
+  describe('Edge cases', () => {
+    test('null filing returns 1 without throwing', () => {
+      expect(() => computeBaseScore(null)).not.toThrow();
+      expect(computeBaseScore(null)).toBe(1);
+    });
+
+    test('undefined filing returns 1 without throwing', () => {
+      expect(() => computeBaseScore(undefined)).not.toThrow();
+      expect(computeBaseScore(undefined)).toBe(1);
+    });
+
+    test('negative transactionValue — Factor 1 skipped (no bonus, no penalty)', () => {
+      // negative value = bad data, not a real purchase. Should not penalize.
+      const score = computeBaseScore({ ...NEUTRAL, transactionValue: -500_000 });
+      // Base 5.0 + unknown role 0.5 + null cap skipped = 5.5
+      expect(score).toBe(5.5);
+    });
+
+    test('zero transactionValue — Factor 1 skipped (no bonus, no penalty)', () => {
+      const score = computeBaseScore({ ...NEUTRAL, transactionValue: 0 });
+      expect(score).toBe(5.5);
+    });
+  });
+});
