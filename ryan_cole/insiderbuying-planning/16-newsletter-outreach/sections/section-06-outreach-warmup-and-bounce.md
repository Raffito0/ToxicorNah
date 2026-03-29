# Section 06 — Outreach Warm-Up, Email Verification, and Bounce Monitoring

## Overview

This section adds three protective layers to `send-outreach.js` that must be in place before any real outreach begins:

1. **Domain warm-up ramp** — `earlyinsider.com` is a new sending domain. Sending too many emails on day one will damage deliverability permanently. A tiered daily cap (5 → 20 → 50) enforced across all cron runs prevents this.
2. **Email verification** — sending to invalid addresses raises hard-bounce rates and triggers ISP throttling. Each prospect is verified against QuickEmailVerification before the first send.
3. **Async bounce monitoring** — bounces are reported hours after delivery, not at send time. A daily polling job reads Resend's per-email status endpoint to catch bounces and alert when the rate exceeds 5%.

**Dependencies:** Section 04 must be complete. The `Outreach_Prospects` table with `last_resend_id` (added in section 05) is read by the bounce poller here. This section can be implemented in parallel with section 05 as long as `last_resend_id` is already present in the schema.

**File:** `n8n/code/insiderbuying/send-outreach.js`
**Test file:** `n8n/tests/send-outreach.test.js`

---

## Tests First

Add these tests to `n8n/tests/send-outreach.test.js` before writing any implementation.

### Warm-up limit tests

```js
describe('getWarmupLimit', () => {
  test('returns 5 when days < 14 (day 0)', () => { /* ... */ });
  test('returns 5 when days < 14 (day 13)', () => { /* ... */ });
  test('returns 20 when days >= 14 and < 28 (day 14)', () => { /* ... */ });
  test('returns 20 when days >= 14 and < 28 (day 27)', () => { /* ... */ });
  test('returns 50 when days >= 28 (day 28)', () => { /* ... */ });
  test('returns 50 when days >= 28 (day 60)', () => { /* ... */ });
  test('throws a startup error when DOMAIN_SETUP_DATE env var is missing', () => { /* ... */ });
});
```

The `DOMAIN_SETUP_DATE` missing case must throw at startup (i.e., when the module is first called / the function is first invoked), not silently default. Verify the thrown message identifies the missing env var by name.

### Send time window tests

Mock `Intl.DateTimeFormat` (or use a time-injection pattern) to simulate different Eastern Time instants.

```js
describe('isValidSendTime', () => {
  test('Tuesday 10 AM Eastern → true', () => { /* ... */ });
  test('Wednesday 9 AM Eastern → true', () => { /* ... */ });
  test('Thursday 11 AM Eastern → true', () => { /* ... */ });
  test('Monday 10 AM Eastern → false', () => { /* ... */ });
  test('Friday 10 AM Eastern → false', () => { /* ... */ });
  test('Saturday 10 AM Eastern → false', () => { /* ... */ });
  test('Wednesday 8 AM Eastern → false', () => { /* ... */ });
  test('Wednesday 12 PM (noon) Eastern → false', () => { /* ... */ });
});
```

Valid window: **Tuesday, Wednesday, Thursday**, hours **9, 10, 11** (Eastern, DST-correct).

### Daily send counter tests

```js
describe('daily send counter', () => {
  test('getDailySentCount queries Outreach_Daily_Stats for today UTC date', () => { /* ... */ });
  test('getDailySentCount returns sent_count from record', () => { /* ... */ });
  test('send loop stops when sent_count >= warmup limit for today', () => { /* ... */ });
  test('sent_count incremented by actual number sent after batch', () => { /* ... */ });
});
```

### Email verification tests

```js
describe('verifyEmail', () => {
  test('returns true when QuickEmailVerification result is "valid" → send proceeds', () => { /* ... */ });
  test('returns false when result is "invalid" → updates prospect status="invalid", skips send', () => { /* ... */ });
  test('returns true when API returns error → proceed (do not block on unknown)', () => { /* ... */ });
  test('returns true when result is "unknown" → proceed', () => { /* ... */ });
  test('throws at startup when QUICKEMAIL_API_KEY is missing', () => { /* ... */ });
});
```

### Bounce monitoring tests

```js
describe('bounce monitoring', () => {
  test('daily poller: Resend GET returning last_event="bounced" → updates status="bounced" and followup_count=99', () => { /* ... */ });
  test('daily poller: Resend GET returning last_event="delivered" → no update', () => { /* ... */ });
  test('bounce rate alert: sent_count=100 bounced_count=6 → Telegram API called', () => { /* ... */ });
  test('bounce rate alert: sent_count=100 bounced_count=4 → Telegram NOT called', () => { /* ... */ });
  test('bounce rate alert: sent_count=0 → no division-by-zero, Telegram NOT called', () => { /* ... */ });
});
```

---

## Implementation

### NocoDB Schema — New Table

Before implementing, add the `Outreach_Daily_Stats` table. This tracks sent and bounced counts across multiple cron runs on the same day. The primary key is the UTC date string.

```sql
CREATE TABLE Outreach_Daily_Stats (
  date DATE PRIMARY KEY,
  sent_count INTEGER DEFAULT 0,
  bounced_count INTEGER DEFAULT 0,
  updated_at DATETIME
);
```

If `Outreach_Prospects.last_resend_id` is not already present (added in section 05), add it now — the bounce poller depends on it:

```sql
ALTER TABLE Outreach_Prospects
  ADD COLUMN IF NOT EXISTS last_resend_id VARCHAR(255);
```

### New Env Vars

Add to `.env.example`:

```
DOMAIN_SETUP_DATE=        # Required. YYYY-MM-DD, the date of first outreach send
QUICKEMAIL_API_KEY=       # Required. From quickemailverification.com free tier
```

Both must be validated at startup with a clear thrown error. Do not default `DOMAIN_SETUP_DATE` to today — that would silently reset the warm-up counter on every container restart.

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are already in use elsewhere; reuse them for the bounce alert.

---

### `getWarmupLimit(daysSinceDomainSetup)`

Reads `DOMAIN_SETUP_DATE` from `process.env`. Compute `daysSinceDomainSetup` as the integer number of days between `DOMAIN_SETUP_DATE` and today's UTC date. Throw if the env var is not set.

Tiered return values:
- Days 0–13: return `5`
- Days 14–27: return `20`
- Days 28+: return `50`

This function is called once per send run. The caller combines it with `getDailySentCount()` to compute how many sends remain for today.

---

### Daily Send Counter — `getDailySentCount()` and `incrementDailySentCount(n)`

**`getDailySentCount(nocodbApi)`**

Query `Outreach_Daily_Stats` for a record where `date = TODAY_UTC` (ISO date string, e.g. `"2026-03-28"`). Return `sent_count` if found, or `0` if no record exists yet.

**`incrementDailySentCount(nocodbApi, n)`**

Upsert the record for today: if it exists, increment `sent_count` by `n` and update `updated_at`. If it does not exist, insert `{ date, sent_count: n, bounced_count: 0, updated_at }`.

**Send loop guard:** Before sending any prospect, compute:

```js
const remaining = Math.min(getWarmupLimit(days), 100) - await getDailySentCount(nocodbApi);
if (remaining <= 0) {
  // log and return early — skip all sends for today
}
```

Cap the total at 100 regardless of warm-up tier (a hard safety ceiling). After sending the batch, call `incrementDailySentCount(nocodbApi, actualSentCount)`.

---

### `isValidSendTime()`

Use `Intl.DateTimeFormat` to get the current weekday and hour in Eastern Time. This approach handles DST automatically — do not use a fixed UTC offset.

```js
function isValidSendTime() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'narrow',
    hour: 'numeric',
    hour12: false
  });
  // Extract day letter (M/T/W/R/F/S/U) and hour (0-23)
  // Valid: day in ['T', 'W', 'R'] (Tue, Wed, Thu) AND hour in [9, 10, 11]
}
```

Note: `Intl.DateTimeFormat` with `weekday: 'narrow'` returns single characters. In `en-US`, Tuesday = `"T"`, Thursday = `"T"` as well — use `weekday: 'short'` instead (`"Tue"`, `"Wed"`, `"Thu"`) to avoid the Tuesday/Thursday collision.

Return `true` only if day is `"Tue"`, `"Wed"`, or `"Thu"` AND hour is `9`, `10`, or `11`.

---

### `verifyEmail(email, nocodbApi, prospectId)`

Call QuickEmailVerification's free-tier endpoint via `require('https')` (no npm modules):

```
GET https://api.quickemailverification.com/v1/verify?email={email}&apikey={QUICKEMAIL_API_KEY}
```

Parse the JSON response. Decision logic:

| `result` value | Action |
|----------------|--------|
| `"valid"` | return `true` — proceed with send |
| `"invalid"` | update `Outreach_Prospects` record `status = 'invalid'` via NocoDB PATCH; return `false` — skip send |
| `"unknown"` or any API error | return `true` — do not block on uncertainty |

If `QUICKEMAIL_API_KEY` is not set, throw at call time (startup validation). Do not allow the module to proceed without it.

---

### Async Bounce Polling — `pollBounces(nocodbApi)`

This is a **separate daily cron job** — not called in the main send path. Register it as a separate n8n Schedule Trigger (e.g., runs once per day at 10 AM UTC).

**Logic:**

1. Query `Outreach_Prospects` in NocoDB for records where `last_resend_id IS NOT NULL` and `status NOT IN ('bounced', 'invalid')` and `sent_at` is between 24 and 48 hours ago.
2. For each matching prospect, call `GET https://api.resend.com/emails/{last_resend_id}` with `Authorization: Bearer {RESEND_API_KEY}` header.
3. If `last_event === 'bounced'`:
   - PATCH `Outreach_Prospects`: `status = 'bounced'`, `followup_count = 99`
   - Increment `bounced_count` in today's `Outreach_Daily_Stats` record
4. If `last_event === 'delivered'` or any other value: no update.

**Bounce rate alert** (called after the polling loop):

```js
async function checkBounceRateAlert(nocodbApi) {
  const stats = await getDailyStats(nocodbApi, todayUTC());
  if (!stats || stats.sent_count === 0) return;
  const ratio = stats.bounced_count / stats.sent_count;
  if (ratio > 0.05) {
    await sendTelegramAlert(
      `Bounce rate alert: ${stats.bounced_count}/${stats.sent_count} emails bounced today (${(ratio * 100).toFixed(1)}%). Consider pausing outreach sends.`
    );
  }
}
```

Send the Telegram message via `POST https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage` with `chat_id = TELEGRAM_CHAT_ID`. Use `require('https')`. This reuses the same pattern already in the codebase for other alerts.

---

## Integration Points

- **Section 04 dependency:** `verifyEmail()` is called in the main send loop added in section 04, before `buildEmailPrompt()`. If `verifyEmail` returns `false`, skip the prospect entirely.
- **Section 05 dependency:** `pollBounces()` reads `last_resend_id` which is stored by section 05's initial send logic. Both sections write to `Outreach_Prospects` — ensure PATCH calls use the correct NocoDB record ID, not `email` as the key.
- **`isValidSendTime()`** is checked at the top of the main outreach send function. If it returns `false`, the function logs "Outside send window" and returns without sending anything.
- **Send loop order:** `isValidSendTime()` → `getWarmupLimit()` + `getDailySentCount()` → for each prospect: `verifyEmail()` → send → `incrementDailySentCount()`.

---

## Key Correctness Notes

- `DOMAIN_SETUP_DATE` must never default. A container restart must not reset the warm-up tier to day 0. Always read the date from the env var and throw if missing.
- `Intl.DateTimeFormat` with `weekday: 'narrow'` conflates Tuesday and Thursday (both return `"T"` in en-US). Use `weekday: 'short'` to get `"Tue"` and `"Thu"` distinctly.
- Bounce detection is asynchronous. Do not attempt to detect bounces from the send response — the Resend API send response only confirms the message was queued. The 24–48 hour polling window is intentional.
- When `sent_count === 0`, skip the bounce rate ratio check entirely (no division-by-zero).
- The `bounced_count` field in `Outreach_Daily_Stats` is incremented by the polling cron on the day the bounce is detected, not the day the email was sent. This is by design — it tracks the current state of the pipeline's health, not historical attribution.

---

## Deviations from Plan

1. **`_httpFetchJson` HTTP error handling (H-2)**: Plan was silent. Code review finding — added `if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode + '...'))` before JSON parsing so API errors surface rather than returning a malformed object.

2. **`pollBounces` pagination (M-2)**: Plan did not specify. Code review finding — added `limit: 1000` to `queryRecords` call to prevent silent truncation at NocoDB's default 25-record page size.

3. **`pollBounces` RESEND_API_KEY guard (M-3)**: Plan was silent. Code review finding — added fail-fast throw when `RESEND_API_KEY` is not set, consistent with other API key guards in the module.

4. **`checkBounceRateAlert` Telegram credential guard (M-4)**: Plan was silent. Code review finding — added early return with `console.error` when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are missing.

5. **`isValidSendTime` weekday comment**: Added inline comment explaining `'short'` vs `'narrow'` to prevent future regression.

6. **Test file location**: Tests in `tests/insiderbuying/send-outreach.test.js` (138 total — sections 01-06).

7. **Test beforeEach for Telegram env vars**: Test describe block sets `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` in `beforeEach` (required after M-4 fix) alongside `RESEND_API_KEY`.

8. **Functions exported**: `getWarmupLimit`, `isValidSendTime`, `getDailySentCount`, `incrementDailySentCount`, `verifyEmail`, `pollBounces`, `checkBounceRateAlert`.
