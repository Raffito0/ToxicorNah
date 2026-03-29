# Section 03 Diff — Transaction Filtering and Same-Day Sell Detection

**Files modified**:
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/score-alert.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/score-alert.test.js`

---

## score-alert.js — Section 03 changes

```diff
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
+    insiderName: data.insider_name,
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
```

### runScoreAlert() integration changes

```diff
 async function runScoreAlert(filings, helpers = {}) {
   const { nocodb, fetchFn, deepseekApiKey } = helpers;
   const deepseek = createDeepSeekClient(fetchFn, deepseekApiKey);
   if (!filings || filings.length === 0) return [];
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
       nocodb,
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

   return results;
 }
```

### Exports

```diff
 module.exports = {
   ...
+  detectSameDaySell,
+  emitScoreLog,
 };
```

---

## score-alert.test.js — Section 03 additions

### New imports

```diff
 const {
   ...
+  detectSameDaySell,
 } = require('../../n8n/code/insiderbuying/score-alert');
```

### detectSameDaySell tests (6 tests)

```js
describe('detectSameDaySell', () => {
  const FILING = {
    insiderCik: 'CIK123',
    transactionDate: '2026-01-15',
    sharesExercised: 1000,
  };

  test('returns 0 for full exercise-and-sell (>=80% sold)', async () => {
    const nocodb = { list: jest.fn().mockResolvedValue({ list: [{ transactionShares: 800 }] }) };
    const result = await detectSameDaySell(FILING, { nocodb });
    expect(result).toBe(0);
  });

  test('returns undefined for partial sell (30% sold)', async () => {
    const nocodb = { list: jest.fn().mockResolvedValue({ list: [{ transactionShares: 300 }] }) };
    const result = await detectSameDaySell(FILING, { nocodb });
    expect(result).toBeUndefined();
  });

  test('returns undefined when no same-day sell found', async () => {
    const nocodb = { list: jest.fn().mockResolvedValue({ list: [] }) };
    const result = await detectSameDaySell(FILING, { nocodb });
    expect(result).toBeUndefined();
  });

  test('returns undefined when insiderCik missing', async () => {
    const nocodb = { list: jest.fn() };
    const result = await detectSameDaySell({ transactionDate: '2026-01-15' }, { nocodb });
    expect(result).toBeUndefined();
    expect(nocodb.list).not.toHaveBeenCalled();
  });

  test('returns undefined and logs WARN on NocoDB failure', async () => {
    const nocodb = { list: jest.fn().mockRejectedValue(new Error('network')) };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await detectSameDaySell(FILING, { nocodb });
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('detectSameDaySell failed'));
    warnSpy.mockRestore();
  });

  test('returns undefined when nocodb dep missing', async () => {
    const result = await detectSameDaySell(FILING, {});
    expect(result).toBeUndefined();
  });
});
```

### runScoreAlert filtering chain tests (5 tests)

```js
describe('runScoreAlert filtering chain', () => {
  const BASE_FILING = {
    ticker: 'AAPL', insider_name: 'Timothy D. Cook',
    transactionCode: 'P', direction: 'A',
    transactionValue: 5_000_000, canonicalRole: 'CEO',
    marketCapUsd: 3_000_000_000,
  };
  const makeDeepseek = () => ({
    complete: jest.fn().mockResolvedValue({ content: '{"adjustment": 0, "reason": "ok"}' }),
  });

  test('skips G filings and excludes from results', async () => {
    const results = await runScoreAlert(
      [{ ...BASE_FILING, transactionCode: 'G' }],
      { fetchFn: jest.fn(), deepseekApiKey: 'x', nocodb: { list: jest.fn().mockResolvedValue({ list: [] }) } }
    );
    expect(results).toHaveLength(0);
  });

  test('skips F filings and excludes from results', async () => {
    const results = await runScoreAlert(
      [{ ...BASE_FILING, transactionCode: 'F' }],
      { fetchFn: jest.fn(), deepseekApiKey: 'x', nocodb: { list: jest.fn().mockResolvedValue({ list: [] }) } }
    );
    expect(results).toHaveLength(0);
  });

  test('allows S filings through to results', async () => {
    // ... test that sale filings produce a result
  });

  test('allows P filings through to results', async () => {
    // ... test that purchase filings produce a result
  });

  test('routes M filings to detectSameDaySell and skips if exercise-and-sell', async () => {
    const nocodb = { list: jest.fn().mockResolvedValue({ list: [{ transactionShares: 900 }] }) };
    const results = await runScoreAlert(
      [{ ...BASE_FILING, transactionCode: 'M', sharesExercised: 1000, insiderCik: 'CIK1', transactionDate: '2026-01-15' }],
      { fetchFn: jest.fn(), deepseekApiKey: 'x', nocodb }
    );
    expect(results).toHaveLength(0);
  });
});
```

### Structured logging tests (2 tests)

```js
describe('structured score logging', () => {
  test('emits log with baseScore/aiAdjustment/finalScore for scored alert', async () => { ... });
  test('emits log with skipReason for G/F skipped alert', async () => { ... });
  test('emits log with overrideReason for exercise-and-sell', async () => { ... });
});
```
