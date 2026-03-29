# Section 03 Code Review Interview

## Auto-fixes Applied (no user input needed)

### Fix 1 — Critical: Infinite loop guard in `fetchDedupKeys` (sec-monitor.js)
**Problem:** `isLastPage = pageInfo && pageInfo.isLastPage` evaluates to `null` when `pageInfo` is missing, keeping the while loop running forever.
**Fix:** `isLastPage = !pageInfo || pageInfo.isLastPage === true;` — treats missing `pageInfo` as last page.
**Verified:** New test "treats missing pageInfo as last page" passes (1 API call, correct result).

### Fix 2 — Important: `writeMonitorState` test flat-body assertion (sec-monitor.test.js)
**Problem:** Test verified timestamp value but not that `body.fields` was absent — missing the key NocoDB migration guard.
**Fix:** Added `expect(body.fields).toBeUndefined();` to writeMonitorState test.

### Fix 3 — Important: Missing `pageInfo` absence edge-case test (sec-monitor.test.js)
**Problem:** No test covered the exact condition that would trigger the infinite loop.
**Fix:** Added test: `makeFetch({ list: [...] })` (no pageInfo key) → assert `fetchFn` called exactly once.

### Fix 4 — Suggestion: `readMonitorState` filter syntax assertions (sec-monitor.test.js)
**Problem:** URL check only verified `'market'` was present, not that NocoDB operator was used.
**Fix:** Added `expect(url).toContain('eq')` and `expect(url).not.toContain('filterByFormula')`.

## Let Go

- **Issue 2** (unquoted filter value): Safe for fixed `'market'` — no real risk, noted as convention.
- **Issue 6** (boundary test at 10): Nice-to-have; existing tests adequately cover the logic.

## Final Test Count: 157 (156 previous + 1 new edge-case test)
