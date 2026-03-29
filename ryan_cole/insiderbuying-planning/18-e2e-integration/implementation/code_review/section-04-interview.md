# Code Review Interview — Section 04: Article Pipeline E2E

**Date**: 2026-03-30
**Review file**: section-04-review.md
**Tests before interview**: 36/36 passing
**Tests after interview**: 36/36 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**MEDIUM: Strengthen `lastPublished` assertion from type-only to exact value**
- Changed `expect(typeof freshness.lastPublished).toBe('string')` → `expect(freshness.lastPublished).toBe('2026-02-20T10:00:00Z')`
- Catches a regression where `lastPublished` returns a wrong field (e.g., `created_at` instead of `published_at`)

**MEDIUM: Add URL verification to checkContentFreshness mock**
- Added `const freshnessUrl = freshnessFetchFn.mock.calls[0][0]` + `expect(freshnessUrl).toContain('Articles')` + `expect(freshnessUrl).toContain('NVDA')`
- `makeFetch` resolves unconditionally — without URL assertions the table could be wrong and the test would still pass

**HIGH: Add `title_text` field mapping assertion in writeArticle**
- Added `expect(writeBody.title_text).toBe(articleToWrite.title)`
- Production `writeArticle` maps `article.title` to `title_text` (non-obvious rename). Without this assertion, a field rename would not be caught

**SUGGESTION: Add `status: 'enriching'` assertion in writeArticle**
- Added `expect(writeBody.status).toBe('enriching')`
- Articles must enter NocoDB in enriching state for downstream pipeline. Documents this contract.

**LOW: Use `BASE_ENV.ANTHROPIC_API_KEY` instead of inline string for Claude call**
- Changed `'test-anthropic-key'` → `BASE_ENV.ANTHROPIC_API_KEY` in `generateArticleOutline` call
- Consistent with pattern used throughout the e2e test suite

**LOW: Add URL path assertion to lockKeyword mock**
- Added `expect(lockCallArgs[0]).toContain(String(keyword.id))`
- Catches regression where `lockKeyword` always patches `/Keywords/0` regardless of input

**SUGGESTION: Add `lastPublished` undefined assertion for empty list case**
- Added `expect(freshness.lastPublished).toBeUndefined()` in Test 2.3 empty-list branch
- Catches accidental backfill of this field when no article exists

---

### Let-go items (spec deviations — not actionable)

**CRITICAL C1 — spec requires "second Claude call prompt contains outline JSON"**
- The spec describes a `callClaudeToolUse` draft step where the outline from the first Claude call is passed into the second Claude call's prompt. This function does not exist as an exported symbol in `generate-article.js`. The production module's draft generation (if any) is internal and not exposed for injection.
- **Resolution**: Test 2.1 instead proves the actual integration chain: `pickKeyword` → `lockKeyword` → `generateArticleOutline` (Claude call) → `writeArticle` (NocoDB POST). The outline flows through the test via `outline.headline` and `outline.sections` assertions. The spec was written against a different API surface.

**CRITICAL C2 — spec requires draft fetchFn called twice with retry prompt injection**
- The spec requires calling `callClaudeToolUse` twice (first failing `qualityGate`, second passing) and asserting the second call's prompt contains `errors[0]`. This retry pattern requires an exported draft function that accepts a retry prompt — which does not exist in the production module.
- **Resolution**: Test 2.2 instead proves `qualityGate` error semantics: errors are strings, the banned phrase error is present and contains the exact phrase, and errors can be joined into a usable retry prompt string. This is the observable contract of the quality gate from the caller's perspective.

**HIGH H3 — spec says `determineArticleParams` handles freshness (incorrect)**
- The spec's Test 2.3 was written against `determineArticleParams(keyword, recentArticleDate)`. In production, `determineArticleParams(blog)` is a pure random-weighted function with no freshness awareness. Test 2.3 correctly uses `checkContentFreshness` — the actual freshness-aware function. Spec deviation documented.

**LOW L2 — `makeNocodbOpts` defined locally**
- Not exported from `helpers.js`. Other e2e test files needing it will also define locally. Planning gap, not a current file bug.

---

## Result

All fixes applied. Tests re-run after all changes: **36/36 passing**.
