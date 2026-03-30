# Code Review Interview — Section 10: Cross-Chain Integration Tests

**Date**: 2026-03-29
**Review file**: section-10-review.md
**Tests before interview**: 94/94 passing
**Tests after interview**: 94/94 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**CRITICAL: Strengthen alertDigest assertion in test 8.3 (C1)**
- Changed `expect(summaries.alertDigest).toContain('1')` to `expect(summaries.alertDigest).toBe('This week saw 1 significant insider transactions.')`
- Why: `toContain('1')` would pass for any string containing the digit 1, including totals like 10 or 11. `toBe` pins the exact contract so a phrasing change in the newsletter template is caught.
- How to apply: direct edit to test 8.3 assertion block.

**CRITICAL: Add teaser field assertion in test 8.4 (C2)**
- Added `expect(summaries.articleTeasers[0].teaser).toBeTruthy()` after the ticker assertion.
- Why: `teaser` is populated from `meta_description` in `generateSummaries`. Without asserting it, a silent `meta_description` drop in the NocoDB write payload would not be detected by this cross-chain test.
- How to apply: append assertion after existing articleTeasers[0] block.
- Verified: `generateSummaries` sets `teaser: a.meta_description || ...` and `capturedBody.meta_description` is `'CEO Jensen Huang purchased $5M worth of NVDA shares.'` — assertion passes.

**IMPORTANT: Add created_at field assertion in test 8.5 (I3)**
- Added `expect(record.created_at).toContain('2026-03-01')` after the `generated_at` assertion.
- Why: `buildReportRecord` returns both `generated_at` and `created_at`. Both are set from `new Date().toISOString()` under fake timers. The spec explicitly noted `generated_at` but `created_at` is equally important as a downstream consumer timestamp. Not asserting it allows silent removal.
- Confirmed: `generate-report.js:334` has `created_at: new Date().toISOString()`.

---

### Let-go items

**I1: Test 8.1 constructs transactionValue manually rather than capturing it from payload**
- The `$` + `(capturedBody.total_value / 1_000_000).toFixed(1)` + `M` construction in the test body is exactly the integration layer transformation. Testing that transformation directly is more valuable than testing that the captured value passes through unchanged. Let go — no change needed.

**I2: Test 8.2 `postToX` is trivially verified**
- `postToX` is a pure payload builder. Asserting `method: 'POST'` and `body.text` containing the title and slug is the right contract test. The URL construction being the "real" contract is already verified through those assertions. Let go.

**I4: No test for insertToSupabase dedup/conflict path**
- The cross-chain test suite focuses on wire-format compatibility, not individual chain error paths. Dedup/conflict scenarios belong in the alert-pipeline unit tests (section 03). Let go.

**S1-S4: Suggestions**
- S1 (shared supabaseOpts factory): Not enough repetition (only 2 tests use it) to warrant a helper.
- S2 (shared nocodbOpts refactor): Already extracted as `makeNocodbOpts()`.
- S3 (more ticker variety): Fixture variation would dilute the NVDA→NVDA cross-chain signal; single ticker is intentional.
- S4 (TSDoc): Out of scope for e2e test files.
