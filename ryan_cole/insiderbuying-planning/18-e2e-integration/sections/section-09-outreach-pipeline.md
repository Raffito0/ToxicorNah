# Section 09: Outreach Pipeline E2E

## Overview

Create `tests/insiderbuying/e2e/07-outreach-pipeline.test.js` with 5 tests covering Chain 7 — the outreach pipeline that scrapes prospect articles, drafts personalized emails, manages the follow-up lifecycle, monitors bounce rates, and enforces domain warm-up sending limits.

## Dependencies

- **section-01-helpers-fixtures** must be complete: `helpers.js`, `setup.js`, and fixture files must exist before writing this test file.
- **section-02-jest-config** must be complete: the Jest `e2e` project config must point to `setup.js` and include `clearMocks: true` and `maxWorkers: 1`.

## File to Create

```
ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/07-outreach-pipeline.test.js
```

## Chain Description

**Chain 7 — Outreach Pipeline**:

```
Cheerio HTML scrape (prospect's recent article)
  → personalized email draft (AI call with article context)
  → send (email API call)
  → follow-up lifecycle management (followup_count tracking, replied guard, new-thread framing)
  → bounce rate monitoring (metrics fetch → Telegram alert if > 5%)
  → domain warm-up enforcement (limit sends/day by age of domain)
```

This chain is stateful: each test constructs a prospect object with specific state fields (`followup_count`, `replied`, `sent_at`) and verifies that the pipeline transitions that state correctly.

## Fake Timers Requirement

All 5 tests require fake timers. The `setup.js` global already calls `jest.useFakeTimers()` once before all e2e tests. Each test in this file must call:

```javascript
jest.setSystemTime(new Date('2026-03-01T12:00:00Z'));
```

in a `beforeEach` block so the baseline "current date" is deterministic. Individual tests that need to simulate time passing (e.g., 10 days later) call `jest.advanceTimersByTime(ms)` or `jest.setSystemTime(laterDate)` inside the test body itself after setting the baseline.

## Tests

---

### Test 7.1 — Happy path: article scrape → personalized email with `?` subject

**Purpose**: Verify that the prospect's recent article title is fetched, passed into the AI prompt as context, and the resulting email has a subject line ending with `?` and a body containing no URLs.

**Setup**:
- A mock prospect object with a `recent_article_url` field set to a test URL.
- A `cheerioFetchFn` (built with `makeFetch`) returning HTML that includes an `<h1>` or `<title>` element containing a recognizable article title string (e.g., `"How We Grew MRR 3x in Six Months"`).
- An `aiFetchFn` (built with `makeFetch`) returning an email object with a subject ending in `?` (e.g., `"Quick question about your growth post?"`).

**Test body**: Call the outreach send function, passing both fetch mocks.

**Assertions**:
1. The AI fetch was called at least once.
2. Capture the request body from `aiFetchFn.mock.calls[0][1].body` (or equivalent argument). Parse it and assert the prompt string contains the article title text that was in the scraped HTML.
3. The returned (or persisted) email's subject field ends with `?`.
4. The returned email body does not match `/https?:\/\//` — no raw URLs in the body text.

---

### Test 7.2 — Follow-up day 10: new thread, followup_count incremented to 2

**Purpose**: Verify that a prospect on their second follow-up (10 days after the first) gets a "new thread" email (new subject, not `Re:` prefix) and the persistence layer is called with `followup_count: 2`.

**Setup**:
- A prospect object with:
  - `followup_count: 1`
  - `sent_at: '2026-02-19T12:00:00Z'` (10 days before the baseline `2026-03-01T12:00:00Z`)
  - `replied: false`
- An `aiFetchFn` returning a follow-up email object. The subject must NOT start with `Re:`.
- A `persistFetchFn` (built with `makeFetch`) for the NocoDB/Airtable PATCH call that updates the prospect record.

**Test body**: Call the follow-up scheduler function.

**Assertions**:
1. The AI fetch was called (a new draft was generated, not skipped).
2. Capture the AI prompt from `aiFetchFn.mock.calls[0][1].body`. Assert it contains the string `"new thread"` or equivalent framing keyword (not `"Re:"`).
3. Capture the persistence PATCH body from `persistFetchFn.mock.calls[0][1].body`. Parse it and assert it contains `followup_count: 2`.

---

### Test 7.3 — Replied prospect cancels all follow-ups

**Purpose**: Verify that a prospect who has already replied receives no new email and is marked with `followup_count: 99` (the sentinel value that permanently stops follow-ups).

**Setup**:
- A prospect object with `replied: true`.
- An `emailSendFetchFn` (to assert it is never called).
- A `persistFetchFn` for the PATCH call.

**Test body**: Call the follow-up scheduler function.

**Assertions**:
1. `emailSendFetchFn` was never called: `expect(emailSendFetchFn).not.toHaveBeenCalled()`.
2. `persistFetchFn` was called exactly once.
3. Capture the PATCH body. Assert it contains `followup_count: 99`.

---

### Test 7.4 — Bounce rate > 5% triggers Telegram alert

**Purpose**: Verify the monitoring check fires a Telegram message when the bounce rate exceeds 5%.

**Setup**:
- A `metricsFetchFn` returning `{ bounces: 6, total: 100 }`.
- A `telegramFetchFn` for the Telegram Bot API send message call.

**Test body**: Call the monitoring check function.

**Assertions**:
1. `telegramFetchFn` was called at least once.
2. Capture the request body from `telegramFetchFn.mock.calls[0][1].body`. Parse it and assert the `text` field contains either `"6%"` or `"0.06"` (the bounce rate expressed as percentage or decimal).

---

### Test 7.5 — Domain warm-up: 5-send limit on day 7

**Purpose**: Verify that when the sending domain is only 7 days old, the warm-up logic caps outgoing sends at 5 per day — even if 10 prospects are queued.

**Setup**:
- Set `DOMAIN_SETUP_DATE` to `2026-02-22T12:00:00Z` (7 days before the baseline `2026-03-01T12:00:00Z`). Pass this via the `env` spread from `BASE_ENV`: `{ ...BASE_ENV, DOMAIN_SETUP_DATE: '2026-02-22T12:00:00Z' }`.
- An array of 10 mock prospect objects, all with `followup_count: 0` and `replied: false`.
- A `sendFetchFn` (built with `makeFetch`) for the email send API.

**Test body**: Call the send loop function with all 10 prospects.

**Assertions**:
1. `sendFetchFn` was called exactly 5 times: `expectFetchCalledTimes(sendFetchFn, 5, 'warm-up day-7 send limit')`.

---

## Import Pattern

The test file should import the outreach module functions under test and the helpers:

```javascript
const { makeFetch, makeRouter, makeFetchSeq, BASE_ENV, noSleep, expectFetchCalledTimes } = require('../helpers');
// Import production functions — exact names depend on the outreach module's exports:
// const { sendOutreachEmail, scheduleFollowUp, checkBounceRate, runSendLoop } = require('../../../../src/outreach/...');
```

The exact import paths depend on where the outreach pipeline modules live in the source tree. Resolve them by checking:
```
ryan_cole/insiderbuying-site/src/
```
for the outreach-related module files.

## Test File Skeleton

```javascript
const { makeFetch, makeRouter, BASE_ENV, noSleep, expectFetchCalledTimes } = require('../helpers');

// TODO: replace with actual import paths
// const { sendOutreachEmail } = require('../../../../src/outreach/send');
// const { scheduleFollowUp } = require('../../../../src/outreach/followup');
// const { checkBounceRate } = require('../../../../src/outreach/monitor');
// const { runSendLoop } = require('../../../../src/outreach/sendLoop');

describe('Chain 7: Outreach Pipeline', () => {
  beforeEach(() => {
    jest.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  });

  test('7.1 — article scrape → personalized email, subject ends with ?', async () => {
    // ...
  });

  test('7.2 — follow-up day 10: new thread framing, followup_count updated to 2', async () => {
    // ...
  });

  test('7.3 — replied prospect: no email sent, followup_count set to 99', async () => {
    // ...
  });

  test('7.4 — bounce rate > 5% triggers Telegram alert', async () => {
    // ...
  });

  test('7.5 — warm-up day 7: send loop capped at 5 of 10 prospects', async () => {
    // ...
  });
});
```

## Key Implementation Notes

- **Fake timer interaction**: `jest.advanceTimersByTime()` only advances Jest fake timers; it does NOT move `Date.now()` unless you also call `jest.setSystemTime()`. For test 7.2, use `jest.setSystemTime(new Date('2026-03-01T12:00:00Z'))` in `beforeEach` and make the prospect's `sent_at` be 10 days earlier — no need to advance timers, just set the baseline and construct the prospect accordingly.
- **`followup_count: 99` sentinel**: This is a hard-coded signal in the pipeline meaning "permanently suppressed." Any value of 99 must bypass all follow-up generation regardless of other fields.
- **Bounce rate formula**: `bounces / total`. The test supplies `6 / 100 = 0.06`. The Telegram message may format this as either `6%` or `0.06` — assert for both alternatives with a regex like `/(6%|0\.06)/.test(message)`.
- **Warm-up curve**: The send limit on day 7 is 5. The exact curve (day 1 = 2, day 7 = 5, day 14 = 10, etc.) is defined in the outreach module's warm-up config. Do not hardcode the formula in the test — test only that the result is 5 for day 7.
- **URL-free body check**: Use `/https?:\/\//.test(emailBody)` — assert `false`. This is a deliverability requirement (links in cold outreach reduce open rates).
- **`clearMocks: true` in Jest config**: Between tests, mock call counts are cleared automatically. You do not need `mockFn.mockClear()` in `beforeEach`.

## Actual Implementation Notes

**File created**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/07-outreach-pipeline.test.js`

**Tests**: 7 tests in 1 describe — 89 total passing after this section.

**Key deviations from spec**:

1. **`_aiClient.call(messages)` not fetchFn**: `generateEmail` and `sendFollowUp` use `_aiClient.call(messages)`, not a fetch mock. Tests inject `{ _aiClient: { call: jest.fn() } }`.

2. **`_resendEmailPost` postFn signature**: `sendInitialOutreach` and `sendFollowUp` use `postFn(url, {method,headers,body}) -> {status, json(), text()}`. Tests use `jest.fn().mockResolvedValue({status:200, json:..., text:...})` directly.

3. **`process.env` save/restore**: `checkBounceRateAlert` and `getWarmupLimit` read env vars directly. Module-level `ORIG_*` constants + `beforeEach`/`afterEach` restore pattern used.

4. **No exported send loop**: `runSendLoop` from spec doesn't exist. Test 7.5 orchestrates manually: `getWarmupLimit()` → `selectProspects(prospects, limit)` → loop `sendInitialOutreach()`.

5. **FU2 new-thread verification**: `buildFu2Payload` (used for stage 2) omits `In-Reply-To`/`References`. Test 7.2 asserts `JSON.parse(sentOpts.body).headers` is `undefined` to prove new-thread behavior.

6. **Bounce rate format**: Production uses `(ratio*100).toFixed(1)` — message contains "6.0%", not "6%". Test asserts `/6\.0%/` regex.

7. **Code review additions**: Resend call assertion in 7.2 (H-1), `scraped.url` assertion (H-3), `chat_id` assertion in 7.4 (M-1), boundary test 7.4b (exactly 5% = no alert), 5× NocoDB write assertion in 7.5 (M-3), tier boundary test 7.5b (day-14→20, day-28→50).
