# Section 04 Code Review — Weekly Score Calibration

**Files reviewed**:
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/score-alert.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/score-alert.test.js`

**Spec**: `ryan_cole/insiderbuying-planning/12-scoring-analysis/sections/section-04-weekly-calibration.md`

---

## Summary

The implementation is correct in its core logic and faithfully covers the six-step pipeline described in the spec. All critical behaviors are present: the NocoDB query with the right filter, the empty-week guard, four-bucket percentage computation, the three flagging conditions, Telegram isolation from the NocoDB write, and unconditional calibration record persistence.

There is one substantive spec deviation that affects production correctness: the spec defines the env key as `NOCODB_API_URL`, but the implementation uses `NOCODB_BASE_URL` throughout. This mismatch does not surface in tests because the test ENV object uses `NOCODB_BASE_URL` as well. In an n8n deployment where env vars are configured from the spec's documentation, the guard will immediately return `null` and the function will silently never run. There are also two minor behavioral gaps: the NocoDB write is unguarded (a failure there will surface as an unhandled rejection to n8n), and the `sleep` parameter is unused.

---

## What Was Done Well

**Correct bucketing logic.** The `if score <= 3 / <= 5 / <= 7 / else` chain correctly implements the four spec ranges with no off-by-one errors.

**Percentage rounding.** `parseFloat((count / total * 100).toFixed(1))` correctly rounds to one decimal and strips trailing zero noise.

**Correct flag logic order.** `pct_8_10 > 25` runs first, `< 5` second, empty-bucket check third. If `pct_8_10 === 0`, it triggers `< 5` rather than empty-bucket — more informative `flagReason`.

**Telegram is correctly isolated from the write.** The Telegram call is inside a `try/catch` and the NocoDB write always executes regardless.

**Early return is spec-compliant.** Zero alerts returns `{ message: 'no alerts this week' }` and exits before any Telegram call or calibration write.

**Clean NocoDB query.** `(created_at,gte,...)~and(final_score,isnot,null)` correctly excludes nulled-out records. `fields: 'final_score'` minimizes response size.

**Telegram message content.** The message includes header with date, all four buckets with percentages, total count, and the specific flag reason.

---

## Issues

### Important

**I1 — Env key mismatch: spec says `NOCODB_API_URL`, implementation uses `NOCODB_BASE_URL`**

Spec function-signature comment: `env keys: NOCODB_API_URL, NOCODB_API_TOKEN, ...`. Implementation uses `NOCODB_BASE_URL` everywhere, consistent with the NocoDB client's `baseUrl` terminology and the rest of the codebase. The correct resolution is to update the spec comment to match the implementation (not vice versa — `NOCODB_BASE_URL` is the correct canonical name for this codebase).

**I2 — `nocodb.create(CALIB_TABLE, ...)` is unguarded — can surface as unhandled rejection**

If the table doesn't exist or a column type mismatches, `nocodb.create()` throws synchronously through `await`. In an n8n scheduled workflow, an unhandled rejection marks the execution as failed. The Telegram path is already safely try-caught — the NocoDB write should receive the same treatment.

**I3 — `sleep` dep is accepted but never used**

`deps = { fetchFn, sleep, env }` — `sleep` is never destructured or consumed. Either use it (e.g., for a Telegram retry delay) or document it as intentionally unused in the JSDoc to make the contract explicit.

### Suggestions

**S1 — Telegram response `res.ok` not checked**

A non-throwing 4xx from Telegram (e.g., bad chat ID) would be silently swallowed. Adding `if (!res.ok) throw new Error(...)` inside the try block would match the defensive pattern used elsewhere in the file.

**S2 — No test for `pct_8_10 === 25` boundary**

The spec flags when `pct_8_10 > 25`, meaning 25% exactly is healthy. No test exercises this boundary.

**S3 — No test for missing env vars guard path**

The guard at the top returns `null` when `NOCODB_BASE_URL` or `NOCODB_API_TOKEN` is absent. This path is untested.

---

## Spec Deviations

| # | Spec Requirement | Implementation | Verdict |
|---|---|---|---|
| D1 | env key: `NOCODB_API_URL` | Uses `NOCODB_BASE_URL` | Update spec comment to match — implementation is canonically correct |
| D2 | Step 6: "always write" | Write is unguarded; 4xx throws | Add try/catch to match Telegram pattern |
| D3 | `sleep` is a named dep | `sleep` accepted but never used | Document as unused or use for Telegram retry |

---

## Action Items

| Priority | Item | Action |
|---|---|---|
| Important | Fix spec env key name | Update spec comment `NOCODB_API_URL` → `NOCODB_BASE_URL` |
| Important | Guard NocoDB calibration write | Wrap `nocodb.create(CALIB_TABLE, ...)` in try/catch, log error, return result anyway |
| Important | Address unused `sleep` dep | Add JSDoc note: `sleep` accepted for dep-injection consistency, unused in this function |
| Suggestion | Check Telegram `res.ok` | After `await fetchFn(tgUrl, ...)`, check response and log warning if not ok |
| Suggestion | Add boundary test `pct_8_10 === 25` | Add test: 5/20 scores in 8-10 → `flagged = false` |
| Suggestion | Add missing-env guard test | Add test: `env: {}` → returns `null` |
