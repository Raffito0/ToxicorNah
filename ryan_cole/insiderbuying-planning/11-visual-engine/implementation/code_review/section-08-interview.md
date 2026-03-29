# Section 08 Code Review Interview

## Auto-fixes Applied

### Fix C1: `prefetchLogos` missing `helpers._sleep` in `_nocoGet` call
- Added `helpers._sleep` as fourth argument to `_nocoGet` in `prefetchLogos` (line 181)
- **Why**: The 429 retry logic uses `_sleep` for the delay. Without it, `prefetchLogos` would incur a real 1s `setTimeout` in tests rather than using the mock, and the sleep injection pattern would be inconsistently applied.

### Fix I2: `visual-engine.test.js` missing `prefetchLogos` and `normalizeInsiderName` assertions
- Added `typeof engine.identity.prefetchLogos` and `typeof engine.identity.normalizeInsiderName` assertions
- **Why**: The `identity` namespace test was incomplete — 2 of 4 exported functions were not verified.

### Added C2 test: double-429 behavior documented
- Added test `double-429 (retry also fails) — error propagates to caller`
- **Policy decision**: One retry is the maximum. If the second attempt also returns 429, `_nocoGet` throws `NocoDB GET failed: 429`. This propagates out of `_cacheGet` and from there out of `getCompanyLogo` / `getInsiderPhoto`. Callers that need uptime resilience should add their own try/catch.
- This is the simplest defensible policy for a rate limit of ~5 req/s on a low-volume reporting tool. A production-hardening pass could add exponential backoff if needed.

## Decisions Let Go

### I1: `brandfetchHit` mock lacks `ok` property
- Harmless — production code uses `res.status === 200` not `res.ok` for Brandfetch. Low risk.

### S1: S08 `_cacheGet`/`_cacheSet` tests duplicate S06 coverage
- The 429 retry and header tests are genuinely new. The other cache tests provide explicit scenario labels that serve as documentation.

### S2: `xc-token` header assertion has redundant case-insensitive fallback
- Cosmetic; not worth a commit.

### S3: `visual-engine.js` JSDoc example uses literal `1` as template ID
- Template ID convention documented elsewhere. Update when settled.
