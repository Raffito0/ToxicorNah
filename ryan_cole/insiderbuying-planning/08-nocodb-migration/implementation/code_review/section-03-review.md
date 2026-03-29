# Section 03 Code Review

## Summary

Migration is correct and complete for the normal path. One Critical issue (infinite loop risk) must be fixed before merge. Two Important issues (missing flat-body assertion, missing edge-case test) are paired with the Critical fix.

## Issues

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 1 | Critical | `sec-monitor.js` line 190 | `isLastPage = pageInfo && pageInfo.isLastPage` evaluates to falsy (not `false`) when `pageInfo` is null — infinite loop on malformed response |
| 2 | Important | `sec-monitor.js` line 211 | NocoDB string filter value unquoted — safe for `'market'` but fragile pattern |
| 3 | Important | `sec-monitor.test.js` writeMonitorState test | Does not assert `body.fields` is absent (Airtable wrapper regression guard missing) |
| 4 | Important | `sec-monitor.test.js` | No test for missing `pageInfo` — the exact condition that triggers Issue 1 |
| 5 | Suggestion | `sec-monitor.test.js` readMonitorState test | Should assert `eq` operator present and `filterByFormula` absent |
| 6 | Suggestion | `x-engagement.test.js` | Bot filter threshold not tested at the exact boundary (10) |

## Airtable Remnants

None found. Migration is clean.

## Detail

**Issue 1 (Critical):** `isLastPage = pageInfo && pageInfo.isLastPage` — if `pageInfo` is `undefined` or `null`, this evaluates to `null` (falsy, not `false`), causing the while loop to run forever. Fix: `isLastPage = !pageInfo || pageInfo.isLastPage === true;`

**Issue 3 (Important):** `writeMonitorState` test asserts the timestamp value is correct but not that `body.fields` is absent. All other persistence tests in the suite have this guard. Add: `expect(body.fields).toBeUndefined();`

**Issue 4 (Important):** No test covers the missing-`pageInfo` case. Add a test with a response that omits `pageInfo` entirely and assert `fetchFn` was called exactly once.

**Issue 2 (Important):** NocoDB string filter `(name,eq,${stateName})` — currently safe for the fixed value `'market'` but fragile if state names ever contain commas or parentheses. Low risk, document as convention.

**Issues 5 & 6 (Suggestions):** Minor — boundary testing and filter syntax assertion. Nice to have.
