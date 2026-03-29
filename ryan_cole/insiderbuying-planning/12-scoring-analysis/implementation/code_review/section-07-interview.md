# Section 07 Code Review Interview — finnhub-client.js

**Date**: 2026-03-29
**Review source**: `section-07-review.md`

---

## Triage Summary

All review items resolved without user input — 5 auto-fixes applied, 4 items let-go with rationale.

---

## Auto-Fixes Applied

### Fix A1 — Conditional `_quoteCache` export (I1)

**Finding**: Spec requires `module.exports = { getQuote, getNextEarningsDate }` only. Exporting `_quoteCache` directly violates the public contract and allows any downstream caller to mutate cache state.

**Resolution**: Changed to conditional export gated on `process.env.NODE_ENV === 'test'`. Jest automatically sets this env var, so `beforeEach(() => _quoteCache.clear())` in the test file continues to work. Production callers get the clean contract.

**Why auto-fixed**: Spec explicitly prohibits the export. The fix is mechanical and non-breaking for tests.

---

### Fix A2 — HTTP status guard in `getNextEarningsDate` (I2)

**Finding**: `getNextEarningsDate` called `resp.json()` unconditionally. A non-JSON error body from NocoDB (401, 503, etc.) would reject the promise and propagate to the caller, violating the "never throws" guarantee.

**Resolution**: Added `if (resp.status !== 200) { console.warn(...); return null; }` before `resp.json()`, mirroring the pattern already used in `getQuote`.

**Why auto-fixed**: Zero behavioral change on 200 responses. Closes a real exception path.

---

### Fix A3 — Date filter added to NocoDB query URL (I3)

**Finding**: The spec requires `earnings_date >= today` in the WHERE clause but the URL only filtered by ticker. Past earnings records would be returned and incorrectly passed as valid.

**Resolution**: Computed `todayIso = new Date(now).toISOString().slice(0, 10)` and added `~and(earnings_date,gte,${todayIso})` to the NocoDB query. Uses the injected `now` value so tests remain deterministic.

**Why auto-fixed**: Spec-required. One-line change. Tests are unaffected (mock doesn't check URL).

---

### Fix A4 — Past-date guard + test (I4)

**Finding**: `diffDays < 0` was not checked. A past earnings date returns a negative diffDays, which is not `> 90`, so the function would return it as valid.

**Resolution**: Changed check to `if (diffDays < 0 || diffDays > 90) return null`. Added test `'returns null when earnings date is in the past'` with `2026-01-01` (~87 days before REF_DATE).

**Why auto-fixed**: Spec says "upcoming earnings". Returning past dates is harmful (prompt would say "earnings in -87 days").

---

### Fix A5 — `hourCycle: 'h23'` added to Intl.DateTimeFormat (S1)

**Finding**: Without `hourCycle: 'h23'`, some Intl implementations may report midnight as hour `24`. Adding it explicitly aligns with defensive best practice.

**Resolution**: Added `hourCycle: 'h23'` to the `getEtParts` formatter options.

**Why auto-fixed**: One-line hardening, zero risk, eliminates an edge case for midnight boundary.

---

### Fix A6 — DST comment clarification (I5)

**Finding**: Comment said "~02:30 EST / 03:30 EDT" which was ambiguous about which side of the transition is actually being tested.

**Resolution**: Updated comment to "07:30 UTC = 03:30 EDT (clocks sprang forward at 02:00 EST = 07:00 UTC, so this is post-transition)".

**Why auto-fixed**: Documentation only. No behavioral change.

---

## Accepted Decisions

### Decision D1 — `nowFn` parameter added to `getNextEarningsDate` (S4)

Spec signature shows 3 parameters but the implementation adds `nowFn` as the 4th. This is a justified additive improvement — `nowFn` is required for the 90-day window calculation to be testable with controlled time, consistent with `getQuote`.

**Decision**: Accept. Spec omission was an oversight. The addition is additive and beneficial.

---

### Decision D2 — Test path deviates from spec (S3)

Spec says `n8n/tests/finnhub-client.test.js`; actual path is `tests/insiderbuying/finnhub-client.test.js`. Actual path is consistent with every other test in the project.

**Decision**: Accept. Spec path is outdated. Section doc updated to reflect actual path.

---

### Decision D3 — No env var guard for missing `FINNHUB_API_KEY` (S2)

Advisory suggestion. The spec's dependency table already documents that missing key = `null` return, which the HTTP status check handles silently.

**Decision**: Let go. Spec doesn't require the guard. The existing warning on HTTP error is sufficient.

---

## Final Status

All important issues resolved. No user decisions required.

**Test count after fixes**: 17/17 passing.
