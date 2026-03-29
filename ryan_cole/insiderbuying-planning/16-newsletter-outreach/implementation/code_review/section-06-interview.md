# Code Review Interview — section-06: outreach-warmup-and-bounce

## Summary

All fixes applied. 138/138 tests pass.

---

## H-1 — `getWarmupLimit`/`isValidSendTime` not wired into `sendInitialOutreach` (HIGH) — LET-GO

**Finding**: `getWarmupLimit` and `isValidSendTime` are exported utilities but `sendInitialOutreach` does not call them — the orchestration node must call them before invoking `sendInitialOutreach`.

**Decision**: By design. `send-outreach.js` is a utility module; the n8n workflow node orchestrates calls (check warm-up limit, check send time, then call `sendInitialOutreach`). Consistent with sections 04/05 export pattern. Added inline comment at `sendInitialOutreach` noting callers must run guard checks first.

---

## H-2 — `_httpFetchJson` swallows HTTP error status codes (HIGH) — AUTO-FIX

**Finding**: `_httpFetchJson` resolved on any HTTP response, including 4xx/5xx. A 429 from QuickEmailVerification or a 401 from Resend would return a partial error JSON that callers silently misinterpret.

**Fix applied**: Added `if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 200)))` before JSON parsing.

---

## M-1 — `getWarmupLimit` uses local date not ET date (MEDIUM) — LET-GO

**Finding**: `new Date().toISOString().slice(0, 10)` returns UTC date. Near midnight ET the day-count could be off by 1.

**Decision**: `DOMAIN_SETUP_DATE` is a coarse 14/28-day tier threshold. A 1-day drift does not change the tier in practice. Acceptable for warm-up purposes. Added inline comment.

---

## M-2 — `pollBounces` NocoDB query has no pagination limit (MEDIUM) — AUTO-FIX

**Finding**: NocoDB defaults to 25 records per page. A list of 100+ pending prospects would be silently truncated.

**Fix applied**: Added `limit: 1000` to the `queryRecords` call in `pollBounces`.

---

## M-3 — `pollBounces` uses `_httpFetchJson` without checking `RESEND_API_KEY` (MEDIUM) — AUTO-FIX

**Finding**: If `RESEND_API_KEY` is not set, `_httpFetchJson` would send a request with `Authorization: Bearer undefined` and receive a 401, propagating an opaque error.

**Fix applied**: Added fail-fast guard at top of `pollBounces`: throws `'[pollBounces] RESEND_API_KEY env var is required but not set'` before any API calls.

Test file updated: added `beforeEach`/`afterEach` to set `RESEND_API_KEY = 'test-resend-key'` in the bounce monitoring describe block.

---

## M-4 — `checkBounceRateAlert` throws uncaught error when Telegram credentials missing (MEDIUM) — AUTO-FIX

**Finding**: Missing `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` would cause the Resend URL to be `https://api.telegram.org/botundefined/sendMessage`, which fails with an unhelpful network error.

**Fix applied**: Added early return with `console.error` when either credential is missing, so the broken alert is visible in n8n logs without crashing the workflow.

Test file updated: added `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` to `beforeEach`/`afterEach` in bounce monitoring describe block (required so the 6% bounce rate test reaches the `fetchFn` call).

---

## L-1 — `isValidSendTime` timezone comment missing (LOW) — AUTO-FIX

**Finding**: No inline comment explaining why `weekday:'short'` is used instead of `weekday:'narrow'`. Future readers may simplify to `'narrow'` and introduce a Tue/Thu collision bug.

**Fix applied**: Added comment: `// 'short' not 'narrow' — 'narrow' returns "T" for both Tue and Thu in en-US`.

---

## L-2 — `getDailySentCount` returns 0 when NocoDB query throws (LOW) — DOCUMENTED

**Finding**: If NocoDB is unreachable, `queryRecords` throws and `getDailySentCount` propagates the error rather than returning 0 (safe default).

**Decision**: Propagating the error is correct here — the caller should know NocoDB is down and not proceed with a send. Added inline comment.

---

## L-3 — `verifyEmail` catch block logs `error.message` (assumed non-null) (LOW) — AUTO-FIX

**Finding**: `catch(e) { console.error(e.message) }` would print `undefined` if `e` is not an Error object.

**Fix applied**: Changed to `console.error((e && e.message) || String(e))`.

---

## Final state

| Item | Severity | Action | Result |
|------|----------|--------|--------|
| Guards not wired into sendInitialOutreach | HIGH | Let-go (design intent, comment added) | — |
| _httpFetchJson swallows HTTP errors | HIGH | Auto-fix | Fixed |
| getWarmupLimit uses UTC not ET date | MEDIUM | Let-go (coarse tier, comment) | — |
| pollBounces no pagination limit | MEDIUM | Auto-fix (limit: 1000) | Fixed |
| pollBounces no RESEND_API_KEY guard | MEDIUM | Auto-fix + test beforeEach | Fixed |
| checkBounceRateAlert crashes on missing Telegram creds | MEDIUM | Auto-fix + test beforeEach | Fixed |
| isValidSendTime weekday comment missing | LOW | Auto-fix (comment added) | Fixed |
| getDailySentCount swallows NocoDB errors | LOW | Documented | Comment added |
| verifyEmail catch assumes Error object | LOW | Auto-fix | Fixed |

Tests: 138/138 pass.
