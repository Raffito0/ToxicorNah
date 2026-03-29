# Code Review — Section 01: computeBaseScore

Reviewer: Claude Sonnet 4.6
Date: 2026-03-29

---

## Overall Assessment

The implementation is solid. The 5-factor formula is correctly structured, null handling is present and safe, and test coverage is thorough. There are two correctness issues — one in the market cap brackets and one in Factor 5 logic — plus a few secondary gaps worth addressing before section 02 builds on this output.

---

## Issues Found

### 1. Market Cap Bracket Boundary is Wrong (Important)

**Spec** defines mega-cap as `>= $200B`. The implementation uses `>= $100B`.

```javascript
// Implementation (line 73 of diff)
else if (marketCapUsd >= 100_000_000_000) score += 0.6;   // mega-cap >= $100B

// Spec:
// Mega-cap (>= $200B) → +0.6
// Large-cap ($10B – $200B) → +0.8
```

Companies in the $100B–$200B range (e.g., many mid-tier S&P 500 names) will be scored as mega-cap (`+0.6`) instead of large-cap (`+0.8`). The test for this case uses `$100B` as its fixture, which happens to hit the wrong boundary and still passes — masking the bug.

The `mega-cap` test at line 542 of the diff passes only because the test input is exactly `$100B`, which satisfies the incorrect `>= $100B` threshold. A filing with `marketCapUsd = 150_000_000_000` would receive `+0.6` instead of `+0.8` under the current code.

**Fix**: Change the mega-cap threshold to `200_000_000_000`.

---

### 2. Factor 5 Track Record — Condition for Second Tier is Incomplete (Important)

**Spec** states the second tier requires `historicalAvgReturn > 10 && historicalCount >= 2`. The implementation omits the `historicalCount >= 2` guard on the second tier:

```javascript
// Implementation (line 88–89 of diff)
if (historicalAvgReturn > 20 && historicalCount >= 3) score += 0.5;
else if (historicalAvgReturn > 10)                    score += 0.3;  // missing count guard
```

The outer guard (`historicalCount >= 2`) does protect both branches at the moment because of the wrapping condition on line 87: `historicalCount != null && historicalCount >= 2`. So the second branch is currently safe in practice.

However, the outer guard checks `historicalCount >= 2` AND the spec says the `+0.3` tier explicitly requires `historicalCount >= 2`. If the outer guard were ever relaxed in a future edit (e.g., to allow count=1 for the `+0.5` tier with different logic), the second tier's implicit reliance on the outer guard would silently produce incorrect output. The spec's intent is that both conditions are explicit per-tier.

**Fix**: Make the second-tier condition explicit: `else if (historicalAvgReturn > 10 && historicalCount >= 2)`.

---

### 3. Fixture 8 Test Assertion is Too Weak (Suggestion)

The spec says Fixture 8 should produce `1 or 2` (small value penalty dominates). The test asserts only `<= 7`, which is true but does not verify the spec's intended outcome.

```
// Fixture 8 actual score: 5.0 - 1.0 (small value) + 1.0 (Director) + 0.8 (large-cap) = 5.8
// Test asserts: score <= 7   (passes, but not specific)
// Spec says: "1 or 2 (small value penalty dominates)"
```

The spec's description "1 or 2" is itself inaccurate given the formula — Director role at `+1.0` and large-cap at `+0.8` more than offset the `-1.0` penalty. But the test should either be tightened to `<= 6` or the spec expectation should be corrected. As written, the test cannot catch a regression that produces a score of `6.9`.

---

### 4. Fixture 10 Upper Bound Allows Scores That Contradict "All Minimum Values" Intent (Suggestion)

The spec says Fixture 10 should produce `1 (clamped)`. The test asserts `>= 1 && <= 6`.

With `value=$1K` (`-1.0`), unknown role (`+0.5`), null market cap (`0`), null cluster (`0`), null track record (`0`): score = `5.0 - 1.0 + 0.5 = 4.5`. The test correctly passes, but the range `<= 6` is too wide to catch a regression. Tighten to `<= 5` to match actual formula output.

---

### 5. Fixture 6 Spec Says "~4.x" but Test Allows Up to 8 (Suggestion)

The spec fixture table states: "Unknown role, $100K purchase, mega-cap → ~4.x". The test asserts `>= 4 && <= 8`.

With the corrected mega-cap threshold (`$500B`): score = `5.0 + 0.6 + 0.5 + 0.6 = 6.7`. Even without the threshold fix, at `$500B` (mega-cap) the score is `6.7`. The upper bound `<= 8` would not catch a regression producing `7.5`. The bound should be tightened to `<= 7`.

---

### 6. Negative `transactionValue` Edge Case Behavior Not Documented in Spec (Suggestion)

The implementation guards Factor 1 with `transactionValue > 0`, which means negative values are silently skipped. This is sensible defensive behavior. However, the spec does not specify this case, and the test at line 747 asserts a specific output of `5.5` (no adjustment).

This is fine as-is, but the decision should be made explicit in a code comment: `// negative values treated as missing data — skip factor without penalty`. Currently the comment says nothing about why `> 0` is used rather than `!= null`.

---

## What Was Done Well

- The core formula (`start at 5.0, accumulate, clamp/round`) matches the spec exactly.
- All five factors are implemented in the correct order with the correct anchor values.
- Null handling for `marketCapUsd`, `historicalAvgReturn`, and cluster counts is correct and covers all paths specified.
- The `console.warn` for null `marketCapUsd` uses exactly the string specified in the spec.
- Early exit for G/F transaction codes returns `0` before any accumulation.
- The `ROLE_WEIGHT` map correctly normalizes to lowercase.
- The `!filing` guard returning `1` is a clean defensive pattern.
- Factor 4 fallback from 7-day to 14-day cluster is correctly implemented.
- Test structure is excellent: factor isolation fixtures use a NEUTRAL base object that makes arithmetic easy to verify by hand.
- The `computeBaseScore` export is present and correct.

---

## Summary Table

| # | Finding | Category |
|---|---------|----------|
| 1 | Mega-cap threshold is `$100B` instead of spec's `$200B` | Important |
| 2 | Factor 5 second tier missing explicit `historicalCount >= 2` guard | Important |
| 3 | Fixture 8 assertion `<= 7` should be `<= 6` to match formula output | Suggestion |
| 4 | Fixture 10 upper bound `<= 6` should be `<= 5` | Suggestion |
| 5 | Fixture 6 upper bound `<= 8` should be `<= 7` | Suggestion |
| 6 | Add comment explaining `transactionValue > 0` guard intent | Suggestion |
