# Section 02 — Newsletter AI Generation

## Overview

Add `generateNewsletter(data, _opts)` to `weekly-newsletter.js`. Uses Claude Opus via `ai-client.js` (see Deviations below) for a single call that produces all six newsletter sections plus two subject-line variants. Adds a retry loop that re-prompts with constraint feedback on failure. Enforces token budget before calling. Handles empty alert states explicitly.

**File:** `n8n/code/insiderbuying/weekly-newsletter.js`
**Test file:** `tests/insiderbuying/weekly-newsletter.test.js` (Jest format)

**Depends on:** section-01-newsletter-data-layer (provides the `{ topAlerts, articles, performance, upcomingEarnings }` data object)
**Blocks:** section-03-newsletter-gates-and-send (consumes the AI output shape)

---

## Tests First

Extend `n8n/tests/weekly-newsletter.test.js`. Write all of the following test stubs before touching the implementation.

```js
describe('generateNewsletter', () => {
  /**
   * Assert DeepSeek is called exactly once and all four data inputs are
   * present in the prompt string: alerts, articles, performance, upcomingEarnings.
   */
  it('calls DeepSeek exactly once with all 4 data inputs injected into prompt');

  /**
   * Mock DeepSeek to return a response wrapped in ```json ... ``` code fences.
   * Assert the result parses successfully (fences stripped before JSON.parse).
   */
  it('strips markdown code fences before JSON.parse');

  /**
   * Assert the resolved value has the shape:
   *   { sections: { s1, s2, s3, s4, s5, s6_free, s6_pro }, subjectA, subjectB }
   * All values non-empty strings.
   */
  it('returns all required section keys and both subject lines');

  /**
   * Mock DeepSeek: first call returns invalid JSON, second returns valid.
   * Assert the function retried and resolved with the valid response.
   */
  it('retries on malformed AI JSON and resolves on second attempt');

  /**
   * Mock DeepSeek: returns { sections: { s1: 'ok' } } (missing s2–s6_pro).
   * Assert the function detects missing keys and retries.
   */
  it('retries when response is missing required section keys');

  /**
   * Mock DeepSeek to fail all 3 attempts.
   * Assert Telegram alert is sent and the function throws a descriptive error.
   */
  it('sends Telegram alert and throws after 3 consecutive AI failures');

  /**
   * Pass topAlerts = [] into generateNewsletter.
   * Assert the prompt contains the empty-state prefix instruction about macro trends.
   */
  it('injects empty-state prefix instruction when topAlerts is empty');

  /**
   * Pass topAlerts with 8 items and upcomingEarnings with 15 items.
   * Assert the prompt injected contains at most 5 alerts and at most 10 earnings.
   */
  it('prunes alerts to max 5 and earnings to max 10 before sending to AI');
});
```

Run `npm test` from `insiderbuying-site/` to confirm all stubs are red before implementing.

---

## Implementation

### Function Signature

```js
/**
 * Generate all six newsletter sections and two subject lines in one DeepSeek call.
 *
 * @param {object} data - Output of gatherWeeklyContent():
 *   { topAlerts: Array, articles: Array, performance: Array, upcomingEarnings: Array }
 * @returns {Promise<{
 *   sections: { s1, s2, s3, s4, s5, s6_free, s6_pro },
 *   subjectA: string,
 *   subjectB: string
 * }>}
 * @throws if AI fails after maxRetries or Telegram alert fails to send
 */
async function generateNewsletter(data) {}
```

### Token Budget Enforcement

Before constructing the prompt, clamp the input data:

```js
const alerts   = (data.topAlerts       || []).slice(0, 5);
const earnings = (data.upcomingEarnings || []).slice(0, 10);
```

This prevents exceeding the model's context window. Silently slice — do not warn or throw.

### Empty-State Prefix

If `alerts.length === 0`, prepend this exact instruction to the prompt before the section descriptions:

```
IMPORTANT: No major insider moves this week. For section s2, write about macro market trends and broader market context instead of a specific ticker. Do not reference or imply any specific insider trade.
```

Never pass an empty alerts array without this instruction — the model will hallucinate tickers.

### Prompt Structure

Build a single string that includes (in order):

1. The empty-state prefix (if applicable)
2. The full data context: `topAlerts`, `articles`, `performance`, `upcomingEarnings` serialized as compact JSON
3. Section descriptions (see below)
4. The required response shape as a JSON schema comment

**Section descriptions to include verbatim in the prompt:**

- **s1 — Opening Hook:** Personal first-person observation, 100–150 words, no data yet. Set the tone.
- **s2 — Move of the Week:** Deep dive on `topAlerts[0]` (or macro context if no alerts), 200–250 words.
- **s3 — Scorecard:** Last week's performance. Include winners AND losers with percentage returns, 150–200 words.
- **s4 — Pattern Recognition:** Sector rotation or pre-earnings patterns visible in the data, 150–200 words.
- **s5 — What I'm Watching:** 3–4 specific upcoming events with dates from `upcomingEarnings`, 100–150 words.
- **s6_free — The Wrap P.S.:** Invite free subscribers to upgrade. One short paragraph.
- **s6_pro — The Wrap P.S.:** Referral ask. Must contain the exact merge tag `{{rp_refer_url}}` (Beehiiv replaces per-subscriber).

**Required response JSON shape (include in prompt):**

```json
{
  "sections": {
    "s1": "string",
    "s2": "string",
    "s3": "string",
    "s4": "string",
    "s5": "string",
    "s6_free": "string",
    "s6_pro": "string"
  },
  "subjectA": "curiosity-gap subject line (always sent)",
  "subjectB": "number-specific subject line (logged only)"
}
```

Instruct the model to respond with raw JSON only, no markdown fences, no preamble.

### DeepSeek Call

Use the same HTTPS pattern as `analyze-alert.js` in the same directory — plain `require('https')` call to the DeepSeek API. Do not introduce new modules.

Model: use whatever model is configured in the existing DeepSeek client. Temperature: 0.7 is appropriate for creative editorial copy.

### Retry Loop

```js
const MAX_RETRIES = 3;
const REQUIRED_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6_free', 's6_pro'];

let lastError = '';
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  // If retrying, append constraint feedback to prompt
  // Call DeepSeek
  // Strip code fences: raw.replace(/^```json\s*/,'').replace(/```\s*$/,'')
  // JSON.parse
  // Validate all REQUIRED_KEYS present in parsed.sections
  // Validate subjectA and subjectB are non-empty strings
  // If valid: return parsed result
  // If invalid: capture error message, continue loop
}
// After loop: send Telegram alert, then throw
```

**Code fence stripping regex:**

```js
const stripped = raw
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/```\s*$/, '')
  .trim();
```

Apply this before every `JSON.parse()` call — the model will occasionally wrap the response even when instructed not to.

**Constraint feedback on retry:** append to the prompt string before the next attempt:

```
Previous attempt failed: {lastError}. Fix the issue and return valid JSON only.
```

### Telegram Alert on Total Failure

When all 3 attempts fail, send a Telegram message via `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` before throwing. Message format:

```
[EarlyInsider] Newsletter AI generation failed after 3 attempts.
Last error: {lastError}
```

Use the same `require('https')` Telegram send pattern as other modules. After sending the alert, throw:

```js
throw new Error(`generateNewsletter failed after ${MAX_RETRIES} attempts: ${lastError}`);
```

---

## Key Invariants

- `subjectA` is always the curiosity-gap line. It is the one passed to Beehiiv for sending. `subjectB` is the number-specific alternative logged to NocoDB only. The AI decides which is which — include this distinction explicitly in the prompt.
- The `{{rp_refer_url}}` merge tag in `s6_pro` must not be escaped or modified. The prompt must instruct the model to use it literally.
- `generateNewsletter` does not call `gatherWeeklyContent`. It receives already-fetched data. Keep responsibilities separated.
- Do not add any HTML assembly in this function. HTML wrapping is section 03's job. This function returns raw text strings only.

---

## Integration Point

`generateNewsletter(data)` is called by the outer `runWeeklyNewsletter()` orchestrator:

```js
const data   = await gatherWeeklyContent(nocodbApi);  // section 01
const result = await generateNewsletter(data);         // section 02 (this section)
await sendNewsletter(result, data);                    // section 03
```

The `result` object passes through unchanged to section 03. Do not mutate it after returning.

---

## Acceptance Criteria

All 20 tests pass (8 new + 12 existing). Section-02 criteria:

1. AI client called exactly once per non-retried invocation
2. Code fences stripped successfully (handles leading whitespace + `\`\`\`json` and bare `\`\`\`` variants)
3. Return value matches the required shape with all 7 section keys + subjectA + subjectB
4. Retry on malformed JSON resolves without throwing on second attempt
5. Retry on missing section keys resolves without throwing; constraint feedback appears in retry prompt
6. Telegram alert sent and error thrown after 3 failures
7. Empty-state prefix appears in prompt when `topAlerts = []`
8. Alert and earnings arrays clamped to 5 and 10 respectively before prompt injection

## Deviations from Plan

1. **AI provider: Claude Opus instead of DeepSeek**: Plan specified "plain `require('https')` call to the DeepSeek API". `analyze-alert.js` (the module the plan cited as the pattern) already uses `require('./ai-client')`, not raw DeepSeek. The entire codebase migrated to `ai-client.js` for all AI calls. Using `createOpusClient` (Opus via kie.ai) produces better editorial prose and is consistent with all other human-facing content generation.

2. **`_opts._aiClient` injection for testability**: Plan showed `generateNewsletter(data)`. Extended to `generateNewsletter(data, _opts)` with `_aiClient`, `_telegramFn`, and `_env` injection — consistent with the `_opts` pattern established in section-01.

3. **`_httpsGet` passed to `createOpusClient`**: The n8n sandbox has no global `fetch`; passing `undefined` as `fetchFn` would crash at runtime. The `_httpsGet` helper already defined in the module is passed instead.

4. **Code-fence regex hardened**: Plan regex `/^```(?:json)?\s*/i` does not handle leading whitespace before the fence. Upgraded to `/^\s*```(?:json)?\s*/i` to avoid burning a retry when the AI emits a leading newline.

5. **Telegram `resolve()` timing**: Resolves immediately in response callback instead of waiting for `'end'` event to avoid timing dependency on stream state.
