# Code Review Interview -- section-03: x-polling

## Summary

Auto-fixes applied: H2 (try/finally), M1 (runEngagement throws test), M2 (null state tests).
100/100 tests pass.

---

## H1 -- toLocaleString vs Intl.DateTimeFormat (HIGH) -- LET-GO

**Finding**: Codebase has other files using `Intl.DateTimeFormat('en-US', { timeZone }).formatToParts()`
(market-hours-guard.js, finnhub-client.js, send-outreach.js). The `toLocaleString` approach is less
strictly spec-compliant.

**Decision**: Let-go. The spec (section-03-x-polling.md) explicitly prescribes
`now.toLocaleString('en-US', { timeZone: 'America/New_York' })`. Spec takes precedence over style
consistency. Both approaches work correctly on the VPS's V8/full-ICU build.

---

## H2 -- runEngagement throw leaves polling_interval unpatched (HIGH) -- AUTO-FIX

**Finding**: If `runEngagement` throws, `last_run` is already patched (re-entry prevention works)
but `polling_interval` is never patched, leaving a stale value in X_State.

**Fix applied**: Wrapped `runEngagement()` in `try/finally` so `polling_interval` is always patched
regardless of engagement outcome.

---

## M1 -- Missing test: runEngagement throws (MEDIUM) -- AUTO-FIX

**Finding**: No test verified the try/finally behavior.

**Fix applied**: Added test `runEngagement throws -> polling_interval is still patched (try/finally)`.
Uses `assert.rejects` to verify the error propagates AND the polling_interval patch still fires.

---

## M2 -- Missing test: null nocodbGetState return (MEDIUM) -- AUTO-FIX

**Finding**: No test for first-run behavior (null state or missing last_run field).

**Fix applied**: Added two tests:
- `nocodbGetState returns null -> first-run behavior (skipped=false)`
- `nocodbGetState returns object with no last_run -> first-run behavior`
Both verify that `lastRun = 0` → `elapsed = nowMs >> interval` → engagement is called.

---

## M3 -- last_run=0 first-run edge case undocumented (MEDIUM) -- LET-GO

**Finding**: `(state && state.last_run) ? Number(state.last_run) : 0` treats falsy last_run as 0
(first-run). No comment.

**Decision**: Let-go. M2 tests document this behavior. A comment would be minor value-add only.

---

## L1 -- Test file location (LOW) -- LET-GO

**Finding**: Reviewer noted possible mismatch between `n8n/tests/` and `tests/insiderbuying/`.

**Decision**: Let-go. All existing x-engagement tests are already in `n8n/tests/`. The project test
command (`node --test n8n/tests/*.test.js`) confirms this is the canonical location.

---

## L2 -- 9:00 vs 9:30 market open boundary (LOW) -- LET-GO

**Finding**: NYSE opens at 9:30. Code uses 9:00.

**Decision**: Let-go. Spec explicitly states "9:00-15:59 NY". Pre-market polling at 5-min intervals
is intentional.

---

## L3/L4 -- Duplicate test, var vs const style (LOW) -- LET-GO

Both harmless. L3 (duplicate test) adds clarity. L4 (var style) is correct CommonJS idiom.

---

## Final state

| Finding | Severity | Action | Result |
|---------|----------|--------|--------|
| toLocaleString vs Intl.DateTimeFormat | HIGH | Let-go (spec-prescribed) | Noted |
| runEngagement throw leaves state half-written | HIGH | Auto-fix (try/finally) | Fixed |
| Missing test: runEngagement throws | MEDIUM | Auto-fix | Fixed |
| Missing test: null nocodbGetState | MEDIUM | Auto-fix | Fixed |
| last_run=0 undocumented | MEDIUM | Let-go | Noted |
| indexOf correctness | MEDIUM | Let-go | Confirmed correct |
| Test file location | LOW | Let-go (n8n/tests is canonical) | Confirmed |
| 9:00 vs 9:30 boundary | LOW | Let-go (spec says 9:00) | Noted |
| Duplicate test | LOW | Let-go | Harmless |
| var vs const style | LOW | Let-go | Correct ES5 |

Tests: 100/100 pass.
