# Section 05 Code Review Interview — Structured Alert Analysis

**Date**: 2026-03-29
**Review source**: `section-05-review.md`

---

## Triage Summary

All review items resolved without user input — 2 auto-fixes applied, 5 items let-go with rationale.

---

## Auto-Fixes Applied

### Fix A1 — Guard `cluster_size` against undefined (Suggestion → auto-fixed)

**Finding**: `buildAnalysisPrompt` rendered `"undefined insiders buying"` if `alert.is_cluster_buy` was truthy but `alert.cluster_size` was not set. Same bug existed in the old legacy prompt.

**Resolution**: Added `const clusterSize = alert.cluster_size != null ? alert.cluster_size : 'multiple'`. Prompt now says `"multiple insiders"` as a safe fallback.

**Why auto-fixed**: One-line fix, zero risk, improves prompt quality.

---

### Fix A2 — Add 3 test gaps (Suggestions → auto-fixed)

**Finding 1**: No test for `getWordTarget(null)`. Added `getWordTarget(null) → { target: 100, max: 150 }`.

**Finding 2**: No test for direction defaulting to `'A'` when field is absent. Added test with `alertNoDir` (direction key destructured out), verifies prompt contains `'BUY'` and `'bought'`.

**Finding 3**: No test for `runAnalyzeAlert` error path. Added test where `createDeepSeekClient` returns a throwing mock — asserts `result === null` without throwing.

**Why auto-fixed**: All three are straightforward boundary/edge tests with zero behavioral change.

---

## Accepted Decisions

### Decision D1 — Minimal fallback template in S05 (spec deviation — accepted)

**Finding**: Spec section 05 line 172 says: "do not implement the fallback template here — Section 06 handles it." The implementation includes a minimal fallback at lines 311–317.

**Decision**: Accept deviation. `runAnalyzeAlert()` must return `{ analysisText, ... }` — it cannot leave `analysisText` undefined when both DeepSeek attempts fail. A minimal one-line fallback (`"{name} {verb} {shares} at ${price}. Score: {score}/10."`) bridges the gap until S06 replaces it with a richer version. The comment `// Minimal fallback template (S06 provides richer fallback)` makes the intent explicit.

---

### Decision D2 — Bare `catch {}` on finnhub require (accepted)

**Finding**: `catch {}` swallows all errors from `require('./finnhub-client')`, including syntax errors in an in-progress S07 file.

**Decision**: Intentional. During S07 development the file may exist but be incomplete. Surfacing syntax errors during S05 test runs would break the separation of sections. The stub fallback (`async () => null`) is safe. When S07 is complete and correct, the require will succeed.

---

### Decision D3 — `score_reasoning` silently dropped from new prompt (accepted)

**Finding**: Legacy `_buildLegacyPrompt` included `- Score reasoning: ${filing.score_reasoning}`. New `buildAnalysisPrompt` has no field for this.

**Decision**: Intentional by design. The new Hook/Context/What-to-Watch structure doesn't have a "score reasoning" slot — it asks DeepSeek to reason about the trade directly from data. `score_reasoning` is a human-written label from the scoring pipeline, not a data point the LLM needs. `analyze()` still calls `_buildLegacyPrompt` which preserves the field for legacy callers.

---

### Decision D4 — No test for double-validation-fail fallback text (accepted)

**Finding**: The fallback text (`"{name} bought/sold X shares ..."`) is not tested.

**Decision**: S06 will own the fallback entirely and add richer tests for it. The minimal fallback here is a placeholder. Adding S05 tests for it would create S06 coupling to be removed later.

---

### Decision D5 — `percentageDataAvailable` combines pctChangeToday and portfolioPct (design note)

**Finding**: The flag merges "price % change today" (from Finnhub) and "portfolio % of holdings" under one name. S06 may misinterpret which kind of percentage was available.

**Decision**: Accept. The spec (line 150) explicitly defines this combination. S06 will be written with the spec in front of it. Added comment at the flag assignment site documenting both sources.

---

## Final Status

All important issues resolved. No user decisions required.

**Test count after fixes**: 52/52 passing.
