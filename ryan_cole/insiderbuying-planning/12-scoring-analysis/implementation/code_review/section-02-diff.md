diff --git a/insiderbuying-site/n8n/code/insiderbuying/score-alert.js b/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
index 60bddf6..434bf71 100644
--- a/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
+++ b/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
@@ -198,6 +198,115 @@ function computeBaseScore(filing) {
   return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
 }
 
+// ─── callDeepSeekForRefinement ───────────────────────────────────────────────
+
+const REFINEMENT_FALLBACK_REASON = 'AI refinement failed after 2 attempts — using base score';
+
+/**
+ * Builds direction-aware refinement prompt for the AI ±1 adjustment layer.
+ * @internal
+ */
+function _buildRefinementPrompt(filing, baseScore) {
+  const direction = filing.direction === 'D' ? 'sell' : 'buy';
+  const ticker = filing.ticker || 'unknown';
+  const name = filing.insider_name || 'insider';
+  const value = filing.transactionValue ? `$${(filing.transactionValue / 1_000_000).toFixed(1)}M` : 'unknown value';
+
+  let factors;
+  if (direction === 'buy') {
+    factors = `1. Is this the insider's first purchase in 2+ years after a long period of no buying?
+2. Did the insider buy into a recent earnings miss or analyst downgrade (buying a dip)?
+3. Did the insider significantly increase their position size vs. their typical trade size?
+4. Is there an unusual timing signal (bought right before a product launch or deal announcement window)?`;
+  } else {
+    factors = `1. Is this the insider's first sale in 2+ years after a long period of no selling?
+2. Did the insider sell into strength (stock near all-time highs) suggesting bearish conviction?
+3. Is the sell size unusually large relative to their typical sale history?
+4. Is there a timing signal suggesting informed selling rather than routine tax planning?`;
+  }
+
+  return `You are evaluating an insider ${direction} trade for ${name} at ${ticker} (${value}).
+The deterministic base score is ${baseScore} / 10.
+
+Assess only the following qualitative factors (answer YES/NO mentally, do not state them):
+${factors}
+
+Based on these factors, apply a constrained adjustment:
+- +1 if 2 or more factors clearly indicate exceptional conviction
+- -1 if 2 or more factors clearly indicate this is routine / low-conviction
+- 0 otherwise
+
+Respond with ONLY a JSON object, no prose, no markdown:
+{"adjustment": 0, "reason": "one sentence explanation"}`;
+}
+
+/**
+ * Strips markdown code fences from a string.
+ * @internal
+ */
+function _stripFences(text) {
+  return text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
+}
+
+/**
+ * Calls DeepSeek for a constrained ±1 AI adjustment to the base score.
+ *
+ * @param {object} filing   - Filing object (needs: is10b5Plan, direction, ticker, insider_name, transactionValue)
+ * @param {number} baseScore - Score from computeBaseScore(), e.g. 7.3
+ * @param {object} deps     - { client: AIClient, sleep: fn }
+ * @returns {{ base_score, ai_adjustment, ai_reason, final_score }}
+ */
+async function callDeepSeekForRefinement(filing, baseScore, deps = {}) {
+  const { client, sleep } = deps;
+
+  // 10b5-1 plan: skip AI entirely, apply cap
+  if (filing.is10b5Plan) {
+    const final_score = parseFloat(Math.min(baseScore, 5).toFixed(1));
+    return {
+      base_score: baseScore,
+      ai_adjustment: 0,
+      ai_reason: '10b5-1 plan — cap applied, refinement skipped',
+      final_score,
+    };
+  }
+
+  const prompt = _buildRefinementPrompt(filing, baseScore);
+
+  let rawText = null;
+  let parsed = null;
+
+  for (let attempt = 0; attempt < 2; attempt++) {
+    try {
+      if (attempt > 0 && sleep) await sleep(2000);
+      const response = await client.complete(null, prompt, { temperature: 0.0 });
+      rawText = _stripFences((response.content || '').trim());
+      if (!rawText) continue; // treat empty as invalid, retry
+      parsed = JSON.parse(rawText);
+      break;
+    } catch {
+      rawText = null;
+      parsed = null;
+    }
+  }
+
+  if (!parsed || typeof parsed.adjustment !== 'number') {
+    console.warn('[score-alert] ' + REFINEMENT_FALLBACK_REASON);
+    const final_score = parseFloat(Math.min(10, Math.max(1, baseScore)).toFixed(1));
+    return { base_score: baseScore, ai_adjustment: 0, ai_reason: REFINEMENT_FALLBACK_REASON, final_score };
+  }
+
+  // Clamp adjustment to valid range
+  const ai_adjustment = Math.max(-1, Math.min(1, Math.round(parsed.adjustment)));
+  const ai_reason = (parsed.reason && typeof parsed.reason === 'string' && parsed.reason.trim())
+    ? parsed.reason.trim()
+    : 'No reason provided';
+
+  const raw = baseScore + ai_adjustment;
+  const final_score = parseFloat(Math.min(10, Math.max(1, raw)).toFixed(1));
+
+  return { base_score: baseScore, ai_adjustment, ai_reason, final_score };
+}
+
 // ─── 3.2 buildHaikuPrompt ───────────────────────────────────────────────────
 
 /**
@@ -405,4 +514,5 @@ module.exports = {
   callHaiku,
   runScoreAlert,
   computeBaseScore,
+  callDeepSeekForRefinement,
 };
diff --git a/insiderbuying-site/tests/insiderbuying/score-alert.test.js b/insiderbuying-site/tests/insiderbuying/score-alert.test.js
index 6358543..40bcff1 100644
--- a/insiderbuying-site/tests/insiderbuying/score-alert.test.js
+++ b/insiderbuying-site/tests/insiderbuying/score-alert.test.js
@@ -17,6 +17,7 @@ const {
   callHaiku,
   runScoreAlert,
   computeBaseScore,
+  callDeepSeekForRefinement,
 } = require('../../n8n/code/insiderbuying/score-alert');
 
 const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
@@ -795,3 +796,170 @@ describe('computeBaseScore', () => {
     });
   });
 });
+
+// ─── callDeepSeekForRefinement ───────────────────────────────────────────────
+
+describe('callDeepSeekForRefinement', () => {
+  const sleep = jest.fn().mockResolvedValue(undefined);
+
+  function makeClient(responses) {
+    let i = 0;
+    return {
+      complete: jest.fn().mockImplementation(() => {
+        const r = responses[i++];
+        if (r instanceof Error) return Promise.reject(r);
+        return Promise.resolve({ content: r });
+      }),
+    };
+  }
+
+  const BASE_FILING = {
+    direction: 'A', is10b5Plan: false,
+    ticker: 'NVDA', insider_name: 'Jensen Huang',
+    transactionValue: 5_000_000,
+  };
+
+  // ─ Response parsing ─
+  describe('response parsing', () => {
+    test('adjustment +1 — applied correctly', async () => {
+      const client = makeClient(['{"adjustment": 1, "reason": "first buy in years"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 7.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(1);
+      expect(result.final_score).toBe(8.0);
+      expect(result.base_score).toBe(7.0);
+    });
+
+    test('adjustment 0 — score unchanged', async () => {
+      const client = makeClient(['{"adjustment": 0, "reason": "routine cluster trade"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 6.5, { client, sleep });
+      expect(result.ai_adjustment).toBe(0);
+      expect(result.final_score).toBe(6.5);
+    });
+
+    test('adjustment -1 — applied correctly', async () => {
+      const client = makeClient(['{"adjustment": -1, "reason": "heavy selling context"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(-1);
+      expect(result.final_score).toBe(4.0);
+    });
+
+    test('JSON wrapped in markdown fences — stripped and parsed', async () => {
+      const client = makeClient(['```json\n{"adjustment": 0, "reason": "ok"}\n```']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(0);
+    });
+
+    test('out-of-range adjustment +2 — clamped to +1', async () => {
+      const client = makeClient(['{"adjustment": 2, "reason": "very high"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(1);
+      expect(result.final_score).toBe(6.0);
+    });
+
+    test('out-of-range adjustment -2 — clamped to -1', async () => {
+      const client = makeClient(['{"adjustment": -2, "reason": "very low"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(-1);
+      expect(result.final_score).toBe(4.0);
+    });
+  });
+
+  // ─ Retry and fallback ─
+  describe('retry and fallback', () => {
+    test('invalid JSON on first call, valid on second — uses second result', async () => {
+      const client = makeClient(['not-json', '{"adjustment": 1, "reason": "retry worked"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(1);
+      expect(client.complete).toHaveBeenCalledTimes(2);
+    });
+
+    test('empty string on first call, valid on second — triggers retry', async () => {
+      const client = makeClient(['', '{"adjustment": 0, "reason": "ok"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(0);
+      expect(client.complete).toHaveBeenCalledTimes(2);
+    });
+
+    test('both calls return invalid JSON — fallback (adjustment=0)', async () => {
+      const client = makeClient(['bad', 'also-bad']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(0);
+      expect(result.final_score).toBe(5.0);
+      expect(result.ai_reason).toMatch(/failed/i);
+    });
+
+    test('network error on first call, valid on second — recovers', async () => {
+      const client = makeClient([new Error('network'), '{"adjustment": 1, "reason": "ok"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(1);
+    });
+
+    test('network error on both calls — fallback (adjustment=0)', async () => {
+      const client = makeClient([new Error('network'), new Error('network again')]);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 5.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(0);
+      expect(result.final_score).toBe(5.0);
+    });
+  });
+
+  // ─ 10b5-1 plan cap ─
+  describe('10b5-1 plan handling', () => {
+    test('is10b5Plan=true — DeepSeek never called', async () => {
+      const client = makeClient([]);
+      const filing = { ...BASE_FILING, is10b5Plan: true };
+      await callDeepSeekForRefinement(filing, 7.0, { client, sleep });
+      expect(client.complete).not.toHaveBeenCalled();
+    });
+
+    test('is10b5Plan=true, base_score=4 — untouched (under cap)', async () => {
+      const client = makeClient([]);
+      const filing = { ...BASE_FILING, is10b5Plan: true };
+      const result = await callDeepSeekForRefinement(filing, 4.0, { client, sleep });
+      expect(result.final_score).toBe(4.0);
+    });
+
+    test('is10b5Plan=true, base_score=5 — exactly at cap (untouched)', async () => {
+      const filing = { ...BASE_FILING, is10b5Plan: true };
+      const result = await callDeepSeekForRefinement(filing, 5.0, { client: makeClient([]), sleep });
+      expect(result.final_score).toBe(5.0);
+    });
+
+    test('is10b5Plan=true, base_score=7 — capped to 5', async () => {
+      const filing = { ...BASE_FILING, is10b5Plan: true };
+      const result = await callDeepSeekForRefinement(filing, 7.0, { client: makeClient([]), sleep });
+      expect(result.final_score).toBe(5.0);
+      expect(result.ai_adjustment).toBe(0);
+    });
+
+    test('is10b5Plan=false, +1 at score 10 — clamped to 10', async () => {
+      const client = makeClient(['{"adjustment": 1, "reason": "high"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 10.0, { client, sleep });
+      expect(result.final_score).toBe(10);
+    });
+  });
+
+  // ─ Output shape ─
+  describe('output shape', () => {
+    test('result always has base_score, ai_adjustment, ai_reason, final_score', async () => {
+      const client = makeClient(['{"adjustment": 0, "reason": "ok"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 6.0, { client, sleep });
+      expect(result).toHaveProperty('base_score');
+      expect(result).toHaveProperty('ai_adjustment');
+      expect(result).toHaveProperty('ai_reason');
+      expect(result).toHaveProperty('final_score');
+    });
+
+    test('on success, ai_reason contains DeepSeek reason string', async () => {
+      const client = makeClient(['{"adjustment": 1, "reason": "first buy in years"}']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 6.0, { client, sleep });
+      expect(result.ai_reason).toBe('first buy in years');
+    });
+
+    test('on fallback, ai_adjustment=0 and ai_reason is a non-empty explanation', async () => {
+      const client = makeClient(['bad', 'also-bad']);
+      const result = await callDeepSeekForRefinement(BASE_FILING, 6.0, { client, sleep });
+      expect(result.ai_adjustment).toBe(0);
+      expect(result.ai_reason.length).toBeGreaterThan(0);
+    });
+  });
+});
