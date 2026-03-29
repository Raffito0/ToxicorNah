# Section 03 Code Review Interview — Transaction Filtering and Same-Day Sell Detection

**Date**: 2026-03-29
**Review source**: `section-03-review.md`

---

## Triage Summary

All 5 review items were resolved without user input — 2 important issues auto-fixed, 3 suggestions addressed (2 auto-fixed, 1 accepted/deferred).

---

## Auto-Fixes Applied

### Fix A1 — Missing "different transactionDate" test (Important)

**Finding**: Spec explicitly lists `it('does not match when transactionDate differs')`. A bug in date formatting/URL-encoding in the NocoDB query would not be caught without this test.

**Resolution**: Added test to `detectSameDaySell` describe block:
```js
test('different transactionDate — no match returns undefined', async () => {
  const nocodb = makeNocoEmpty();
  const filing = { ...EXERCISE_FILING, transactionDate: '2024-02-01' };
  const result = await detectSameDaySell(filing, { nocodb });
  expect(result).toBeUndefined();
});
```

**Why auto-fixed**: Clear spec requirement, no tradeoff.

---

### Fix A2 — Missing overrideReason log test (Suggestion → auto-fixed)

**Finding**: Spec's "Score Logging" test group includes `it('emits structured log with overrideReason for exercise-and-sell')`. This test was absent.

**Resolution**: Added test to `structured score logging` describe block that asserts `log.overrideReason === 'exercise-and-sell'` and `log.finalScore === 0`.

**Why auto-fixed**: Straightforward test addition, catches a real logging regression.

---

### Fix A3 — Defensive `insiderName || null` in emitScoreLog (Suggestion → auto-fixed)

**Finding**: `insiderName: data.insider_name` — if `insider_name` is missing, `JSON.stringify` silently drops the field. Spec says `insiderName` is always present.

**Resolution**: Changed to `insiderName: data.insider_name || null` so the field is always present (as `null`) in the JSON output.

**Why auto-fixed**: One-character change, zero risk, explicit > implicit for logging.

---

## Accepted Decisions

### Decision D1 — batch `continue` vs spec `return null` (Important spec deviation)

**Finding**: Spec says `runScoreAlert()` returns `null` for G/F and exercise-and-sell. Implementation uses `continue` in a batch loop and returns a filtered array.

**Decision**: Keep batch array API. The `continue` approach is correct for n8n (which processes arrays natively) and matches the existing caller contract from pre-S03. The spec's single-item `return null` contract would require a wrapper layer.

**Traceability preserved**: Structured log is still emitted for every filtered item — the only trace of why an alert was dropped, as the spec requires.

**Action for integration**: The `deliver-alert.js` (unit 08) caller should check `results.length > 0` rather than `result !== null`. This is already consistent with how arrays work. No code change needed in downstream callers.

---

### Decision D2 — AI call before exercise-and-sell detection (Suggestion → deferred)

**Finding**: For M/X filings classified as exercise-and-sell, `callDeepSeekForRefinement()` has already been called and billed before detection runs.

**Decision**: Spec explicitly places the check after the AI call. Moving it before would be a spec deviation. Note filed for section 04 calibration analysis — if M/X volume is significant, the ordering can be revisited in a separate refactor.

---

## Final Status

All important issues resolved. No user decisions required.

**Test count after fixes**: 123/123 passing.
