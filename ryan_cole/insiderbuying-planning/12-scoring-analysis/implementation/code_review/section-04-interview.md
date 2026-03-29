# Section 04 Code Review Interview — Weekly Score Calibration

**Date**: 2026-03-29
**Review source**: `section-04-review.md`

---

## Triage Summary

All 6 review items resolved without user input — 3 important issues auto-fixed, 3 suggestions addressed (2 auto-fixed, 1 accepted/deferred).

---

## Auto-Fixes Applied

### Fix A1 — Guard `nocodb.create()` with try/catch (Important)

**Finding**: The NocoDB calibration write was unguarded. A 4xx response (table not found, column type mismatch) would throw through `await` and surface as an unhandled rejection in n8n, failing the execution.

**Resolution**: Wrapped `await nocodb.create(CALIB_TABLE, ...)` in try/catch that logs the error and allows the function to still return `{ total, buckets, flagged }`, consistent with how Telegram failure is handled.

**Why auto-fixed**: Clear correctness issue, zero tradeoff — matches existing Telegram pattern.

---

### Fix A2 — Document `sleep` dep as unused (Important)

**Finding**: `deps = { fetchFn, sleep, env }` — `sleep` is accepted but never destructured or used. Spec lists it as a named dep key.

**Resolution**: Added comment at destructure site: `// sleep: accepted for dep-injection consistency with other functions; unused here`.

**Why auto-fixed**: One-line doc comment, no behavior change, makes the contract explicit.

---

### Fix A3 — Check Telegram `res.ok` (Suggestion → auto-fixed)

**Finding**: A non-throwing 4xx from Telegram (e.g., bad chat ID) would be silently swallowed with no log. The rest of the file follows a defensive `if (!res.ok)` pattern.

**Resolution**: Added `if (!res.ok) { console.error(...) }` check after the Telegram `fetchFn` call inside the try block.

**Why auto-fixed**: One-line addition, zero risk, matches project-wide defensive pattern.

---

### Fix A4 — Add boundary test `pct_8_10 === 25` (Suggestion → auto-fixed)

**Finding**: No test exercised the `pct_8_10 > 25` boundary exactly. 25% should be healthy (not flagged).

**Resolution**: Added test with 20 scores: 3 in 1-3, 4 in 4-5, 8 in 6-7, 5 in 8-10 = exactly 25%. Asserts `flagged = false`. (First attempt had incorrect score counts in comment — corrected to verify counts manually before committing.)

**Why auto-fixed**: Boundary test, clear spec requirement.

---

### Fix A5 — Add missing-env guard test (Suggestion → auto-fixed)

**Finding**: No test covered the guard path when `NOCODB_BASE_URL` is absent. If misconfigured, the function silently returns `null`.

**Resolution**: Added test passing `env: { NOCODB_API_TOKEN: 'tok', ... }` (no `NOCODB_BASE_URL`). Asserts `result === null` and `fetchFn` was never called.

**Why auto-fixed**: Single test, covers a real deployment misconfiguration scenario.

---

## Accepted Decisions

### Decision D1 — Spec env key `NOCODB_API_URL` vs implementation `NOCODB_BASE_URL` (Important spec deviation)

**Finding**: Spec function-signature comment says `NOCODB_API_URL`; implementation uses `NOCODB_BASE_URL` throughout (consistent with NocoDB client's `baseUrl` param and the rest of the codebase).

**Decision**: Update the spec comment to read `NOCODB_BASE_URL`. The implementation is canonically correct — `NOCODB_BASE_URL` aligns with `nocodb-client.js` constructor terminology and the env key pattern used in `runScoreAlert`'s deployment block. Changing the implementation to `NOCODB_API_URL` would break consistency with the rest of the file.

**Action**: Update section-04-weekly-calibration.md function-signature comment. No code change.

---

## Final Status

All important issues resolved. No user decisions required.

**Test count after fixes**: 138/138 passing.
