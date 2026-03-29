# Section 03 Code Review — Transaction Filtering and Same-Day Sell Detection

**Files reviewed**:
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/score-alert.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/score-alert.test.js`

**Spec**: `ryan_cole/insiderbuying-planning/12-scoring-analysis/sections/section-03-transaction-filtering.md`

---

## Summary

The implementation is correct, well-structured, and passes all behavioral requirements. The three core deliverables — `emitScoreLog()`, `detectSameDaySell()`, and the `runScoreAlert()` integration — are all present and working correctly. Test coverage is thorough for the happy path and most error branches.

There are no critical bugs. The issues below are a mix of Important gaps (one significant spec deviation in how `runScoreAlert` signals filtered results to callers, and one missing test scenario) and a handful of Suggestions (code quality and traceability).

---

## What Was Done Well

**Correctness of `detectSameDaySell()`**: The function uses `transactionDate` (not `filingDate`) as the spec requires. The 80% threshold constant (`EXERCISE_SELL_THRESHOLD = 0.80`) is properly named and placed at module scope rather than buried in the comparison. The graceful failure path — catch block returns `undefined`, logs a WARN — matches the spec contract exactly.

**`emitScoreLog()` conditional fields**: The pattern of only attaching optional fields (`baseScore`, `aiAdjustment`, `skipReason`, `overrideReason`) when they are defined is implemented correctly. This means log consumers parsing the JSON won't receive spurious null keys on skipped alerts, which is good for downstream parsing.

**G/F filter placement**: The filter is correctly placed before `computeBaseScore()`, not after it, which saves both computation and a spurious AI call on every gift/tax filing.

**M/X detection placement**: The exercise-and-sell check fires after `computeBaseScore()` and `callDeepSeekForRefinement()` have already run — which is what the spec specifies. This means we've paid the AI call cost before knowing the filing is a housekeeping exercise, but that is a deliberate trade-off documented in the spec.

**Test infrastructure**: The `detectSameDaySell` test suite uses a real `NocoDB` client wrapper (via `makeNocoDB`) rather than a raw mock, which means the NocoDB query-string construction is actually exercised.

**`emitScoreLog` exported**: Both `detectSameDaySell` and `emitScoreLog` are exported in `module.exports`, making them individually testable and usable downstream.

---

## Issues

### Important

**Issue 1: `continue` vs `return null` — spec contract broken for single-item callers**

The spec states:

> `runScoreAlert()` returns `null` in three cases [G/F skip, exercise-and-sell, score=0]. A `null` return means: do NOT write to NocoDB, do NOT call `runAnalyzeAlert()`.

The spec's pseudocode in the "Integration" section also uses `return null` for both the G/F case and the M/X case.

The implementation instead uses `continue` (skipping the item within a batch loop) and returns the results array at the end, with filtered items simply absent. This makes the function behave as a batch filter rather than a per-item nullable scorer.

This is a meaningful deviation. The spec's intended contract is single-item: one filing in, one result or null out. The implementation's contract is batch: N filings in, M <= N results out (no nulls, filtered items just disappear silently).

The downstream implication is real: the spec says "the structured score log is the only trace of why the alert was dropped." With `continue`, the log is still emitted, so traceability is preserved. But a caller who passes a single filing and checks `result.length > 0` has a different API surface than one checking `result !== null`. The n8n wiring and `deliver-alert.js` need to be built against whichever contract this function actually exposes.

The batch `continue` approach is arguably more practical for n8n (which processes arrays natively), but it must be treated as a deliberate deviation from the spec's `return null` contract, not an incidental one. The spec's "null return behavior" test group (which checks that callers receive null and can safely skip `runAnalyzeAlert()`) is not implemented in the test file — and cannot be implemented correctly as written, because the current API never returns null.

**Action required**: Either (a) update the spec to reflect the batch-array API and remove the `return null` test group from the spec checklist, or (b) change the implementation to match the `return null` spec. The choice affects `deliver-alert.js` (unit 08) which was built against the spec's null-return contract. This needs a decision before unit 08 integration.

---

**Issue 2: Missing test — "different transactionDate, no match" scenario**

The spec explicitly lists this test case:

> `it('does not match when transactionDate differs')`

The test file has no test covering this scenario. The four `detectSameDaySell` tests cover: full sell (>=80%), partial sell (30%), no sell found, different insiderCik, NocoDB failure, and missing nocodb dep. The different-date case is absent.

This matters because the date is one of the three filter columns in the NocoDB `where` clause. A bug in how `transactionDate` is formatted or URL-encoded in the query string would not be caught.

**Action required**: Add a test that supplies a filing with a different `transactionDate` from what the mock returns and asserts `undefined`.

---

### Suggestions

**Suggestion 1: `emitScoreLog()` does not check for `insiderName` when `insider_name` is missing**

The spec requires `insiderName` to be present in the log for every scored alert ("Required fields: ... insiderName ... always"). The implementation reads `data.insider_name` (the raw filing field name) and maps it to `insiderName` in the log object. If a filing has no `insider_name`, the log will contain `insiderName: undefined`, which JSON.stringify silently drops. The resulting log would be missing a required field with no warning.

A defensive `insiderName: data.insider_name || null` would make the missing-field case explicit rather than silently absent.

---

**Suggestion 2: The AI call runs before exercise-and-sell detection (wasted cost on M/X filings)**

When `transactionCode` is `M` or `X` and the filing turns out to be an exercise-and-sell, `callDeepSeekForRefinement()` has already been called and billed. For high-volume M/X filings, moving `detectSameDaySell()` to run immediately after the G/F filter (before the AI call) would reduce AI spend.

This is a cost optimization, not a correctness issue. The spec explicitly places the check "after computeBaseScore() and callDeepSeekForRefinement() have run", so this would be a spec deviation. Raising it here as a flag for the next calibration cycle.

---

**Suggestion 3: `detectSameDaySell` does not log WARN when `insiderCik` or `transactionDate` is missing**

The function returns `undefined` silently when `insiderCik` or `transactionDate` is falsy (line: `if (!nocodb || !insiderCik || !transactionDate) return undefined`). If these fields are missing due to a upstream parsing bug, the exercise-and-sell detection will silently be skipped for every M/X filing, with no diagnostic trace.

A `console.warn` on the missing-field branch (not on the nocodb-missing branch, which is intentional) would make this failure mode visible.

---

**Suggestion 4: The "overrideReason" log for exercise-and-sell does not include `baseScore` or `aiAdjustment`**

When an M/X filing is classified as exercise-and-sell, the log is emitted as:

```js
emitScoreLog({ ...filing, overrideReason: 'exercise-and-sell', finalScore: 0 })
```

At this point in the code, `refinement` has already been computed. The `baseScore` and `aiAdjustment` from the refinement are available but not passed to `emitScoreLog`. The spec's "Required fields" table marks `baseScore` and `aiAdjustment` as present "scored alerts" only — so this is technically compliant. But for the weekly calibration function (section 04), having the base score in the override log would let analysts see whether high-scoring options were being suppressed. Low cost to add; worth considering for section 04.

---

**Suggestion 5: No test for the structured log's `overrideReason` field**

The spec's "Score Logging" test group includes:

> `it('emits structured log with overrideReason for exercise-and-sell')`

The test file's `structured score logging` describe block only tests the scored-alert log and the G/F skip log. The exercise-and-sell override log test is absent. This is the third test from the spec's logging group.

---

## Spec Deviations

| # | Spec Requirement | Implementation | Severity |
|---|---|---|---|
| 1 | G/F filter uses `return null` (single-item API contract) | Uses `continue` (batch API — filtered items absent from results array, no null returned) | Important — affects downstream `deliver-alert.js` wiring |
| 2 | M/X filter uses `return null` on exercise-and-sell | Uses `continue` (same batch pattern) | Same as above |
| 3 | `null return behavior` test group (spec checklist item) | Not implemented — API never returns null, so these tests cannot be written as specified | Follows from deviation #1 |
| 4 | "different transactionDate" detectSameDaySell test | Missing from test file | Important test gap |
| 5 | "overrideReason for exercise-and-sell" log test | Missing from test file | Minor — one test case |

---

## Action Items

| # | Priority | Action | Owner |
|---|---|---|---|
| 1 | Important | Decide: batch-array API (`continue`) vs single-item API (`return null`). Update spec or implementation to align. Coordinate with `deliver-alert.js` (unit 08) before integration. | Dev |
| 2 | Important | Add `detectSameDaySell` test for "different `transactionDate` — no match — returns `undefined`". | Dev |
| 3 | Suggestion | Add `emitScoreLog` test for exercise-and-sell override log (check `overrideReason: 'exercise-and-sell'` and `finalScore: 0`). | Dev |
| 4 | Suggestion | Defensively coerce `insiderName` in `emitScoreLog` to `null` when `insider_name` is missing, so the field is always present in the JSON output. | Dev |
| 5 | Suggestion | For section 04 calibration logging, consider passing `baseScore`/`aiAdjustment` from `refinement` into the exercise-and-sell override log. | Dev (section 04) |
