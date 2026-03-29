# Unit 12 — Scoring & Analysis — Usage Guide

All 7 sections implemented and committed. This guide covers what was built and how to use it.

---

## Files Created / Modified

| File | Description |
|------|-------------|
| `n8n/code/insiderbuying/score-alert.js` | S01–S04: score computation, AI refinement, transaction filtering, weekly calibration |
| `n8n/code/insiderbuying/analyze-alert.js` | S05–S06: structured analysis prompt, validation + retry |
| `n8n/code/insiderbuying/finnhub-client.js` | S07: real-time quote cache + NocoDB earnings lookup |
| `tests/insiderbuying/score-alert.test.js` | S01–S04 tests |
| `tests/insiderbuying/analyze-alert.test.js` | S05–S06 tests (90 tests) |
| `tests/insiderbuying/finnhub-client.test.js` | S07 tests (17 tests) |

---

## score-alert.js API

### `computeBaseScore(filing)`
Deterministic 5-factor score → `[1, 10]` clamped, 1 decimal.

```js
const { computeBaseScore } = require('./score-alert');
const score = computeBaseScore({
  transactionValue: 500000,
  insiderRole: 'CEO',
  marketCap: 2000000000,
  clusterSignal: true,
  trackRecord: 0.7,
});
// → e.g. 7.4
```

### `runScoreAlert(filings, helpers)`
Filters, scores, AI-refines, and logs each filing. Returns array of scored filings.

```js
const { runScoreAlert } = require('./score-alert');
const scored = await runScoreAlert(filings, {
  fetchFn,          // injected HTTP client
  sleep,            // injected sleep (or () => Promise.resolve())
  env: {
    DEEPSEEK_API_KEY: '...',
    NOCODB_API_URL: '...',
    NOCODB_API_TOKEN: '...',
    NOCODB_PROJECT_ID: '...',
    NOCODB_TABLE_ID: '...',
  },
});
```

**Note**: `runScoreAlert` uses a batch-array contract — filtered filings are excluded from the array, not returned as null. Consumers (e.g., unit 08 deliver-alert.js) must iterate the returned array directly.

### `runWeeklyCalibration(helpers)`
Query last-7-days scored alerts, bucket, and fire Telegram if distribution is off.

```js
await runWeeklyCalibration({ fetchFn, sleep, env });
```

---

## analyze-alert.js API

### `runAnalyzeAlert(alert, helpers)`
Generates a structured narrative analysis for a scored alert. Retries once with validation errors appended to prompt. Falls back to a minimal template on double failure.

```js
const { runAnalyzeAlert } = require('./analyze-alert');
const result = await runAnalyzeAlert(alert, {
  fetchFn,
  sleep: () => Promise.resolve(),
  env: {
    DEEPSEEK_API_KEY: '...',
    FINNHUB_API_KEY: '...',    // optional — omit to skip quote data
    NOCODB_API_URL: '...',     // optional — omit to skip earnings data
    NOCODB_API_TOKEN: '...',
    NOCODB_PROJECT_ID: '...',
    NOCODB_EARNINGS_TABLE_ID: '...',
  },
});
// result.analysisText — the narrative (or fallback template)
// result.attemptCount — 1 or 2 (which attempt succeeded)
// result.percentageDataAvailable — was % data injected into prompt
```

### `validateAnalysis(text, score, direction, percentageDataAvailable)`
Pure sync function. Returns `{ valid: boolean, errors: string[] }`.

Five rules: word count (skipped if `score == null`), banned phrases, dollar amount, conditional percentage, cautionary language.

---

## finnhub-client.js API

### `getQuote(ticker, fetchFn, env, nowFn?)`
Returns `{ c, dp, h, l, o, pc }` or `null`. TTL: 60s market-open, 4h otherwise.

### `getNextEarningsDate(ticker, fetchFn, env, nowFn?)`
Returns ISO date string (within 90 days, not in the past) or `null`.

```js
const { getQuote, getNextEarningsDate } = require('./finnhub-client');

const quote = await getQuote('AAPL', fetchFn, env);
// → { c: 195.20, dp: 1.5, h: 196.00, l: 194.50, o: 194.80, pc: 193.54 } or null

const earnings = await getNextEarningsDate('AAPL', fetchFn, env);
// → "2026-04-25" or null
```

---

## Running Tests

```bash
cd ryan_cole/insiderbuying-site

# All unit 12 tests
npx jest --testPathPatterns="score-alert|analyze-alert|finnhub-client"

# Individual suites
npx jest --testPathPatterns="score-alert"      # S01–S04
npx jest --testPathPatterns="analyze-alert"    # S05–S06
npx jest --testPathPatterns="finnhub-client"   # S07
```

---

## Section Completion Summary

| Section | Tests | Commit |
|---------|-------|--------|
| S01 compute-base-score | ✓ | 5d33c20 |
| S02 ai-refinement | ✓ | 8547866 |
| S03 transaction-filtering | ✓ | 8547866 |
| S04 weekly-calibration | ✓ | 9c052e4 |
| S05 structured-analysis | ✓ | 2b38cbb |
| S06 analysis-validation | ✓ 90/90 | 61766c5 |
| S07 finnhub-client | ✓ 17/17 | 287f696 |
