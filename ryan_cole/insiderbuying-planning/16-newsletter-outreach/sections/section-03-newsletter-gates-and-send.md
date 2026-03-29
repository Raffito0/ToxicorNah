# Section 03 — Newsletter Quality Gates, Segmentation, and Send

## Overview

This section is the final stage of the `weekly-newsletter.js` pipeline. It receives the AI-generated content object from Section 02 (the DeepSeek output with 6 sections and two subject lines), enforces quality gates, assembles two distinct HTML email versions (Free and Pro), sends them via Beehiiv, and falls back to Resend if needed.

**File:** `n8n/code/insiderbuying/weekly-newsletter.js`
**Test file:** `n8n/tests/weekly-newsletter.test.js`

**Dependencies:**
- Requires Section 01 (`gatherWeeklyContent`) to have run — needs `topAlerts` array for the alert table
- Requires Section 02 (`generateNewsletter`) to have run — needs the AI content object with `sections` and subject lines

---

## Tests First

Extend `n8n/tests/weekly-newsletter.test.js`. Write all tests below before implementing.

### Word Count Gate

```js
describe('word count gate', () => {
  test('throws when plain text word count is below 1000', async () => {
    // mock AI output where joining all section strings produces 800 words
    // assert throws with the actual count in the error message
  });

  test('passes when word count is 1200', async () => {
    // assert no error thrown
  });

  test('throws when word count is 1500', async () => {
    // assert throws
  });
});
```

Key detail: word count is computed on **plain text** (strip HTML tags before counting), not on raw HTML. This prevents tag inflation from inflating the count.

### Link Count Gate

```js
describe('link count gate', () => {
  test('throws when assembled HTML contains 8 <a href occurrences', async () => {
    // each variant is checked independently
  });

  test('passes when HTML contains exactly 7 links', async () => {
    // assert no error
  });
});
```

Each HTML variant (Free and Pro) is evaluated independently — one can fail while the other passes.

### Free Version HTML

```js
describe('Free version HTML', () => {
  test('contains s1, s2, s3 content', () => { ... });
  test('does NOT contain s4 or s5 content', () => { ... });
  test('contains upgrade CTA block', () => { ... });
  test('does NOT contain {{rp_refer_url}}', () => { ... });
  test('contains top-3 alert table with ticker, insider_name, total_value, score columns', () => { ... });
  test('contains <meta name="viewport"', () => { ... });
  test('contains @media (max-width: 480px) CSS', () => { ... });
  test('contains List-Unsubscribe link', () => { ... });
});
```

### Pro Version HTML

```js
describe('Pro version HTML', () => {
  test('contains all 6 sections: s1–s6_pro', () => { ... });
  test('does NOT contain upgrade CTA block', () => { ... });
  test('contains {{rp_refer_url}} in referral block', () => { ... });
  test('contains "5 more alerts" link block', () => { ... });
  test('contains top-3 alert table', () => { ... });
  test('contains @media (max-width: 480px) CSS', () => { ... });
});
```

### Subject Line and Send

```js
describe('Beehiiv send', () => {
  test('sends with email_settings.email_subject_line = subjectA (not subjectB)', () => { ... });

  test('triggers Resend fallback when Beehiiv response has status: "draft"', async () => {
    // mock Beehiiv returning 201 with { data: { status: 'draft' } }
    // assert Resend batch function called
  });

  test('triggers Resend fallback when Beehiiv returns 403', async () => {
    // mock Beehiiv throwing HTTP 403
    // assert Resend batch function called
  });

  test('Resend fallback is called with batches of max 500 recipients', async () => {
    // mock subscriber list with 1100 entries
    // assert Resend called 3 times (500 + 500 + 100)
  });

  test('logs subjectA and subjectB to NocoDB after send', async () => {
    // assert NocoDB write called with both subjects and send timestamp
  });
});
```

---

## Implementation

### 1. Word Count Gate — `checkWordCount(sections)`

Accepts the AI `sections` object. Joins `s1 + s2 + s3 + s4 + s5 + s6_free` (or `s6_pro` for Pro — use the longer variant). Strips all HTML tags from the joined string before counting (split on whitespace). Throws if word count is outside `[1000, 1400]`.

```js
function checkWordCount(sections) {
  // join all section strings
  // strip HTML tags: text.replace(/<[^>]+>/g, ' ')
  // count words: text.trim().split(/\s+/).filter(Boolean).length
  // throw if count < 1000 or count > 1400
}
```

Error message must include the actual count: `"Word count out of range: 850 (expected 1000–1400)"`.

### 2. Link Count Gate — `checkLinkCount(html, label)`

Counts `<a href` occurrences in the assembled HTML string. `label` is `'free'` or `'pro'` for the error message. Throws if count exceeds 7.

```js
function checkLinkCount(html, label) {
  // const count = (html.match(/<a href/gi) || []).length;
  // if (count > 7) throw new Error(`Link count exceeded for ${label}: ${count} (max 7)`);
}
```

### 3. HTML Assembly

Two functions: `assembleFreeHtml(sections, topAlerts, subjectA)` and `assembleProHtml(sections, topAlerts, subjectA)`.

**Alert table:** both versions include a table of the top 3 alerts from `topAlerts`. Columns: Ticker, Insider, Value (formatted as USD currency, e.g. `$1,234,567`), Score (`${score}/10`). If `topAlerts` has fewer than 3 entries, render as many as exist.

Currency formatting: `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(total_value)`.

**CSS requirements (both versions):**
- `font-family: 'Inter', sans-serif` with `@import` from Google Fonts
- Container max-width 600px, centered
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Mobile breakpoint:
  ```css
  @media (max-width: 480px) {
    .container { padding: 16px !important; }
  }
  ```

**Free version structure:**
1. Header with logo/title
2. s1 (Opening Hook)
3. s2 (Move of the Week)
4. s3 (Scorecard)
5. Top-3 alert table
6. Upgrade CTA block — plain text call to action inviting free subscribers to upgrade for the full analysis (sections 4–6)
7. s6_free (The Wrap P.S.)
8. Footer with visible unsubscribe link and `List-Unsubscribe` header instruction (note: the header itself is set at send time, not in HTML — the visible link is for CAN-SPAM compliance)

**Pro version structure:**
1. Header with logo/title
2. s1 (Opening Hook)
3. s2 (Move of the Week)
4. s3 (Scorecard)
5. s4 (Pattern Recognition)
6. s5 (What I'm Watching)
7. Top-3 alert table
8. "5 more alerts" link block — a small block pointing to the full alerts list on the site
9. Referral block containing `{{rp_refer_url}}` — Beehiiv replaces this per-subscriber with the unique referral URL
10. s6_pro (The Wrap P.S.)
11. Footer

### 4. Beehiiv Send — `sendViaBeehiiv(html, subjectA, tier)`

- `tier`: `'free'` or `'pro'`
- Endpoint: `POST https://api.beehiiv.com/v2/publications/{BEEHIIV_PUBLICATION_ID}/posts`
- Auth: `Authorization: Bearer ${BEEHIIV_API_KEY}`
- Payload shape:
  ```js
  {
    email_subject_line: subjectA,
    content_html: html,
    status: 'confirmed',  // request send, not draft
    // only for Pro:
    tier_ids: process.env.BEEHIIV_PREMIUM_TIER_IDS.split(',')
  }
  ```
- On 201 response: parse response body. If `data.status !== 'confirmed'`, the post was drafted only (non-Enterprise plan behavior) — trigger `sendViaResend(html, subjectA, tier)` fallback.
- On any non-2xx response: trigger `sendViaResend(html, subjectA, tier)` fallback.
- Log which path was used and why.

### 5. Resend Fallback — `sendViaResend(html, subjectA, tier)`

Fetch subscriber list from NocoDB filtered by tier (`free` or `pro`). Chunk at 500 recipients per request (Resend batch limit).

Resend batch endpoint: `POST https://api.resend.com/emails/batch`
Auth: `Authorization: Bearer ${RESEND_API_KEY}`

Each item in the batch:
```js
{
  from: 'Ryan from EarlyInsider <ryan@earlyinsider.com>',
  to: [recipientEmail],
  subject: subjectA,
  html: html,
  headers: {
    'List-Unsubscribe': `<mailto:unsubscribe@earlyinsider.com?subject=unsubscribe>`
  }
}
```

Log total recipients sent and number of chunks.

### 6. NocoDB Logging — after successful send

After both Free and Pro versions have been sent (or attempted), write a record to NocoDB with:

```js
{
  sent_at: new Date().toISOString(),
  subject_a: subjectA,
  subject_b: subjectB,
  send_path: 'beehiiv' | 'resend',
  word_count: <actual count>,
  free_link_count: <count>,
  pro_link_count: <count>
}
```

### 7. Top-level Orchestration — `sendWeeklyNewsletter(nocodbApi)`

This is the main exported function that wires Sections 01 + 02 + 03 together:

```js
async function sendWeeklyNewsletter(nocodbApi) {
  // 1. Gather content (Section 01)
  const content = await gatherWeeklyContent(nocodbApi);

  // 2. Generate AI sections (Section 02)
  const aiResult = await generateNewsletter(content);
  const { sections, subjectA, subjectB } = aiResult;

  // 3. Quality gates
  checkWordCount(sections);

  // 4. Assemble HTML variants
  const freeHtml = assembleFreeHtml(sections, content.topAlerts, subjectA);
  const proHtml = assembleProHtml(sections, content.topAlerts, subjectA);
  checkLinkCount(freeHtml, 'free');
  checkLinkCount(proHtml, 'pro');

  // 5. Send
  await Promise.all([
    sendViaBeehiiv(freeHtml, subjectA, 'free'),
    sendViaBeehiiv(proHtml, subjectA, 'pro')
  ]);

  // 6. Log
  await logSendToNocodb(nocodbApi, { subjectA, subjectB, ... });
}

module.exports = { sendWeeklyNewsletter, checkWordCount, checkLinkCount, assembleFreeHtml, assembleProHtml };
```

---

## Environment Variables Required

These must be present at runtime. The module should throw a clear startup error if any are missing:

| Variable | Description |
|----------|-------------|
| `BEEHIIV_API_KEY` | Beehiiv v2 API key |
| `BEEHIIV_PUBLICATION_ID` | Beehiiv publication ID |
| `BEEHIIV_PREMIUM_TIER_IDS` | Comma-separated premium tier IDs for Pro sends |
| `RESEND_API_KEY` | Resend API key for fallback batch sends |
| `NOCODB_API_URL` | NocoDB base URL |
| `NOCODB_API_TOKEN` | NocoDB auth token |
| `TELEGRAM_BOT_TOKEN` | For error alerts |
| `TELEGRAM_CHAT_ID` | For error alerts |

---

## Key Constraints and Edge Cases

- **Beehiiv draft-only behavior:** On non-Enterprise plans, the API accepts the request and returns 201, but `data.status` will be `'draft'` rather than `'confirmed'`. Always check `data.status` — do not assume a 201 means the email was sent.
- **Empty topAlerts:** If the array has fewer than 3 entries, render the table with however many exist (1 or 2 rows). Do not crash if the array is empty — render the table section with a "No major moves this week" placeholder row.
- **`{{rp_refer_url}}` is a Beehiiv merge tag:** Do not attempt to replace it in code. It must appear literally in the HTML sent to Beehiiv; Beehiiv's sending infrastructure replaces it per-subscriber. It will appear as-is in the Resend fallback path — this is acceptable since the fallback is a degraded path.
- **List-Unsubscribe:** The `List-Unsubscribe` header is set at the HTTP transport layer in the Resend fallback. The visible unsubscribe link in the Free version HTML footer covers the CAN-SPAM visible opt-out requirement for both paths.
- **Currency formatting server-side:** `Intl.NumberFormat` is available in Node.js without any polyfill.
- **Concurrent Free + Pro send:** Use `Promise.all` so both sends happen in parallel. If one fails (and falls back to Resend), the other still proceeds.

---

## Deviations from Plan

1. **`_opts` injection pattern**: Plan showed `sendViaBeehiiv(html, subjectA, tier)`. Extended to `sendViaBeehiiv(html, subjectA, tier, _opts)` with `_postFn`, `_resendFn`, `_env` injection — consistent with the `_opts` pattern from sections 01-02.

2. **`sendWeeklyNewsletter` also takes `_opts`**: Plan showed `sendWeeklyNewsletter(nocodbApi)`. Extended to `sendWeeklyNewsletter(nocodbApi, _opts)` with `_gatherFn`, `_aiClient`, `_telegramFn`, `_postFn`, `_env` injection — required for testability without module-level mocks.

3. **AI section content escaped**: Plan was silent on this. User decided during code review to apply `escapeHTML()` to all AI-generated section text before insertion into HTML wrappers.

4. **`sendViaBeehiiv` throws when `resendFn` is null and fallback needed**: Code review finding — original silently swallowed the failure. Fixed to throw.

5. **`sendViaResend` checks HTTP response status**: Code review finding — original discarded the response. Fixed to throw on non-2xx with status code and body.

6. **`_httpsPost.json()` handles non-JSON bodies**: Code review finding — wrapped `JSON.parse` in try/catch, returns `{ _raw: data }` on failure.

7. **Test file location**: Plan referenced `n8n/tests/weekly-newsletter.test.js`. Tests live in `tests/insiderbuying/weekly-newsletter.test.js` (Jest, not node:test — consistent with project test setup).

8. **Final test count**: 44 total (20 from sections 01-02, 24 from section 03).
