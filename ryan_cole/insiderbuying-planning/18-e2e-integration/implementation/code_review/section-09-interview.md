# Code Review Interview — Section 09: Outreach Pipeline E2E

**Date**: 2026-03-29
**Review file**: section-09-review.md
**Tests before interview**: 87/87 passing
**Tests after interview**: 89/89 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**HIGH: Add Resend postFn call assertion + new-thread payload verification (H-1)**
- Added `expect(postFn).toHaveBeenCalledTimes(1)` in test 7.2
- Added `expect(sentUrl).toBe('https://api.resend.com/emails')`
- Added `expect(JSON.parse(sentOpts.body).to).toBe(prospect.contact_email)`
- Added `expect(JSON.parse(sentOpts.body).headers).toBeUndefined()` — proves FU2 is a new thread (no In-Reply-To)
- Without this: deleting the Resend call from `sendFollowUp` stage 2 would still pass all original assertions

**HIGH: Add format contract comment to `makeValidFu2AiResponse` (H-2)**
- Added JSDoc block explaining the exact line-order format contract
- Documents that format violations produce "FU2 generation failed after 3 attempts" (not a clean assertion failure)
- No code change; documentation-only fix

**HIGH: Add `scraped.url` assertion in test 7.1 (H-3)**
- Added `expect(scraped.url).toBe('https://growthblog.com/article/test')`
- Catches regressions in `urlMod.resolve()` call (relative href → absolute URL)

**MEDIUM: Assert `chat_id` in Telegram POST body (M-1)**
- Added `expect(body.chat_id).toBe(BASE_ENV.TELEGRAM_CHAT_ID)` in test 7.4
- Catches misconfigured `TELEGRAM_CHAT_ID` env var being silently ignored

**MEDIUM: Add test 7.4b — exactly 5% bounce rate does NOT trigger alert (M-2)**
- New test: `bounced_count: 5, sent_count: 100` → `ratio = 0.05`, not `> 0.05` → no Telegram call
- Asserts `expect(telegramFetchFn).not.toHaveBeenCalled()`
- Catches off-by-one: if `>` were changed to `>=`, this test would fail

**MEDIUM: Assert 5 NocoDB writes from `sendInitialOutreach` in test 7.5 (M-3)**
- Added `expect(nocodbApi.updateRecord).toHaveBeenCalledTimes(5)`
- Added specific call check: `expect.objectContaining({ followup_count: 0, sent_at: expect.any(String) })`
- Catches if `updateRecord` call is accidentally removed from `sendInitialOutreach`

**MEDIUM: Add test 7.5b — `getWarmupLimit` tier boundaries (M-4)**
- Day 14 (`2026-02-15`): expects 20 (14-27 tier)
- Day 28 (`2026-02-01`): expects 50 (28+ tier)
- Catches off-by-one errors in tier thresholds

---

### Let-go items

**L-1: Dead `RESEND_API_KEY` save/restore**: `_resendEmailPost` reads `process.env.RESEND_API_KEY` for the Authorization header, but tests replace the entire `postFn` so the header value is not asserted. Save/restore is harmless and correct for completeness — kept.

**L-2: Unused `replied: true` field on test 7.3 prospect**: `cancelFollowUps` ignores the replied field — callers are responsible for checking. Field kept with existing comment for intent clarity.
