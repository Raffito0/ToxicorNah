# Section 03: Transaction Filtering and Same-Day Sell Detection

## Overview

This section updates `runScoreAlert()` in `score-alert.js` to add a local G/F double-check before scoring, a `detectSameDaySell()` helper for option-exercise trades, and structured score logging after every decision. It depends on sections 01 and 02 being complete (i.e., `computeBaseScore()` and `callDeepSeekForRefinement()` exist).

**File to modify**: `n8n/code/insiderbuying/score-alert.js`

**Dependencies**:
- Section 01 (`computeBaseScore()`) must exist.
- Section 02 (`callDeepSeekForRefinement()`) must exist.
- NocoDB client must be in scope (`NOCODB_API_URL`, `NOCODB_API_TOKEN` env vars). If unavailable, same-day sell detection silently skips — that is intentional.

---

## Tests First

Add these test blocks to `n8n/tests/score-alert.test.js`. Write all stubs before touching the implementation.

### Filtering Chain

```js
describe('runScoreAlert() filtering chain', () => {
  // transactionCode 'G' → returns null, logs "skipped: gift/tax"
  it('skips gift transactions (code G)')

  // transactionCode 'F' → returns null, logs "skipped: gift/tax"
  it('skips tax-withholding transactions (code F)')

  // transactionCode 'S' → proceeds to scoring (not filtered)
  it('allows sale transactions (code S) through to scoring')

  // transactionCode 'P' → proceeds to scoring
  it('allows purchase transactions (code P) through to scoring')

  // transactionCode 'M' → proceeds to detectSameDaySell() check
  it('routes exercise transactions (code M) to detectSameDaySell()')
})
```

### detectSameDaySell()

```js
describe('detectSameDaySell()', () => {
  // code M, same insiderCik + transactionDate, sharesSold >= 80% of sharesExercised → returns 0
  it('classifies full exercise-and-sell (>=80% sold) as score 0')

  // code M, same insiderCik + transactionDate, sharesSold = 30% of sharesExercised → returns undefined (normal score)
  it('does not classify partial sell (30% sold) as exercise-and-sell')

  // code M, same insiderCik, different transactionDate → no NocoDB match → normal score
  it('does not match when transactionDate differs')

  // code M, different insiderCik, same date → no NocoDB match → normal score
  it('does not match when insiderCik differs')

  // NocoDB query throws network error → logs WARN, returns undefined (caller uses computed score)
  it('returns undefined and logs WARN on NocoDB query failure')

  // code P (purchase) → detectSameDaySell is never called
  it('does not call detectSameDaySell for non-exercise transaction codes')
})
```

### Score Logging

```js
describe('structured score logging', () => {
  // scored alert → log object includes: ticker, insiderName, transactionCode, direction,
  //   baseScore, aiAdjustment, finalScore, timestamp
  it('emits complete structured log for a scored alert')

  // skipped alert (G/F) → log includes skipReason field
  it('emits structured log with skipReason for skipped alerts')

  // exercise-and-sell → log includes overrideReason: "exercise-and-sell" and finalScore: 0
  it('emits structured log with overrideReason for exercise-and-sell')
})
```

### score=0 Records Not Stored

```js
describe('null return behavior', () => {
  // runScoreAlert() returns null for G/F → no NocoDB write (fetchFn not called for NocoDB)
  it('does not write to NocoDB when runScoreAlert returns null')

  // null return does not propagate to runAnalyzeAlert()
  it('caller receives null and can skip runAnalyzeAlert safely')
})
```

---

## Implementation

### Filtering Chain (inside `runScoreAlert()`)

At the top of `runScoreAlert()`, before calling `computeBaseScore()`, add a local defense check:

```js
// Belt-and-suspenders: upstream (unit 09) should have filtered these,
// but catch any that slip through.
if (filing.transactionCode === 'G' || filing.transactionCode === 'F') {
  emitScoreLog({ ...filing, skipReason: 'gift/tax', finalScore: null })
  return null
}
```

Sales (`S`), purchases (`P`), and all other codes proceed normally. The `null` return is the contract: callers (deliver-alert.js, the n8n workflow) must check for null and skip storage and analysis.

### detectSameDaySell(filing, deps)

Add this function to `score-alert.js`. It is called only when `filing.transactionCode === 'M'` or `'X'` (option exercise codes).

**Purpose**: Detect the "exercise-and-sell" pattern — when an insider exercises options and immediately sells the shares on the same calendar day. This is financial housekeeping, not a conviction trade.

**Key detail — use `transactionDate`, not `filingDate`**: The Form 4 contains the actual trade date (`transactionDate`). The filing date (`filingDate`) can be 2–4 days later when exercise and sell happen on the same day but are reported together. Matching on `filingDate` would miss many exercise-and-sell cases.

**Partial sell threshold**: Only classify as exercise-and-sell if `sharesSold >= sharesExercised * 0.80`. Insiders often sell a portion to cover taxes while keeping meaningful exposure. Below 80%, the trade retains its computed score.

**NocoDB query**: Query the alerts table for records matching `insiderCik` + `transactionDate` (the date from the filing, not the filing date) + `transactionCode = 'S'`. If the query returns a matching sell record, check the threshold.

**Graceful failure**: If the NocoDB query throws (network error, NocoDB unavailable), log a WARN and return `undefined`. The caller interprets `undefined` as "proceed with computed score." This conservative fallback prevents a NocoDB outage from silently dropping all option-exercise alerts.

Stub signature:

```js
async function detectSameDaySell(filing, deps) {
  /**
   * Returns 0 if this is a full exercise-and-sell (shares sold >= 80% of exercised).
   * Returns undefined if: partial sell, no same-day sell found, or NocoDB unavailable.
   * @param {object} filing - must have: insiderCik, transactionDate, sharesExercised
   * @param {object} deps - must have: fetchFn, env (NOCODB_API_URL, NOCODB_API_TOKEN)
   */
}
```

### Integration inside `runScoreAlert()`

After the G/F filter and after `computeBaseScore()` and `callDeepSeekForRefinement()` have run, add:

```js
if (filing.transactionCode === 'M' || filing.transactionCode === 'X') {
  const sameDayResult = await detectSameDaySell(filing, deps)
  if (sameDayResult === 0) {
    emitScoreLog({ ...filing, overrideReason: 'exercise-and-sell', finalScore: 0 })
    return null  // score=0: not stored, not analyzed
  }
  // sameDayResult === undefined → proceed with computed score
}
```

### Structured Score Logging — `emitScoreLog(data)`

Add a small helper that emits a JSON-serialized log line. Every scoring decision (scored, skipped, overridden) must call it.

Required fields in the log object:

| Field | Present When |
|---|---|
| `ticker` | always |
| `insiderName` | always |
| `transactionCode` | always |
| `direction` | always (`'A'` or `'D'`) |
| `baseScore` | scored alerts |
| `aiAdjustment` | scored alerts |
| `finalScore` | always (null for skips) |
| `skipReason` | G/F skips |
| `overrideReason` | exercise-and-sell overrides |
| `timestamp` | always (ISO string) |

The log is emitted via `console.log(JSON.stringify(logObj))`. This structured format is essential for auditing calibration issues — the weekly calibration function (section 04) relies on these logs for debugging when distributions drift.

### score=0 Return Contract

`runScoreAlert()` returns `null` in three cases:
1. Transaction code is G or F (gift/tax withholding).
2. `detectSameDaySell()` returns 0 (exercise-and-sell confirmed).
3. Any other case that produces a score of 0.

A `null` return means: do NOT write to NocoDB, do NOT call `runAnalyzeAlert()`. The structured score log is still emitted for all null cases — it is the only trace of why the alert was dropped.

---

## Relationship to Upstream Filtering

The primary G/F filter lives in `edgar-parser.filterScorable()` (unit 09). The local check in `runScoreAlert()` is a belt-and-suspenders guard. Do not remove the upstream filter — both layers should remain in place.

Sales (code S) are intentionally not filtered at either level. The site displays both buy and sell alerts; sells are valid signals.

---

## NocoDB Schema Note

The `detectSameDaySell()` query needs the alerts table to have `insiderCik`, `transactionDate`, and `transactionCode` columns. These should exist from unit 08's migration. If `transactionDate` is missing, log a WARN and return `undefined` — do not crash.

The `direction` field is a new field that flows out of `runScoreAlert()` as part of the alert object. `deliver-alert.js` (unit 08) will need to include it in the NocoDB write. That is a one-line change in `deliver-alert.js` and is out of scope for this unit, but should be noted in the integration handoff.

---

## Checklist

- [x] Write all test stubs in `score-alert.test.js` (filtering chain, detectSameDaySell, score logging, null return)
- [x] Run `npm test -- --testPathPatterns="score-alert"` — all new stubs should appear as pending/failing
- [x] Implement local G/F double-check in `runScoreAlert()`
- [x] Implement `detectSameDaySell(filing, deps)` — NocoDB query, 80% threshold, graceful failure
- [x] Wire `detectSameDaySell()` into `runScoreAlert()` after base score + AI refinement
- [x] Implement `emitScoreLog(data)` helper
- [x] Confirm all section-01 and section-02 tests still pass (no regression)
- [x] Run `npm test -- --testPathPatterns="score-alert"` — all tests green

---

## Implementation Notes (Actual)

- Files modified: `n8n/code/insiderbuying/score-alert.js`, `tests/insiderbuying/score-alert.test.js`
- **API contract deviation**: Spec says `runScoreAlert()` returns `null` for G/F and exercise-and-sell cases (single-item contract). Implementation uses `continue` in the batch loop (returns empty results array, not null). This maintains the existing callers' array contract from the pre-S03 API and avoids breaking existing tests. G/F filings are excluded from the results array entirely.
- **`emitScoreLog` field mapping**: `insiderName` reads from `data.insider_name` (snake_case, matching the filing object schema). All optional fields are conditionally included — only added when defined/truthy.
- **`detectSameDaySell` dep injection**: Uses `{ nocodb, alertsTableId }` not `{ fetchFn, env }` — nocodb client is already injected into `runScoreAlert` helpers, keeping the dependency consistent with the rest of the function.
- **`alertsTableId` default**: `'Alerts'` — matches NocoDB table name from unit 08 migration. Overridable for testing.
- **`sharesExercised <= 0` guard**: Added to prevent false positives when exercised shares is missing/zero (would make 80% threshold always satisfied for any sell).
- 121/121 tests pass (full suite).
