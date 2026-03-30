# Section 08: Newsletter Pipeline E2E

## Overview

Create `tests/insiderbuying/e2e/06-newsletter-pipeline.test.js` with 2 tests covering Chain 6: data aggregation → 6 content sections → A/B subject generation → free/pro HTML segmentation → Beehiiv delivery.

**Dependencies**: section-01-helpers-fixtures and section-02-jest-config must be complete before this section can be implemented or run.

**Run command**: `npx jest --selectProjects e2e 06-newsletter-pipeline`

---

## What This Section Tests

The newsletter pipeline takes a batch of recent alerts, articles, and performance records, passes them through an AI content generation step to produce 6 distinct section bodies, generates two A/B subject lines, splits the content into a free-tier and a pro-tier HTML email, then sends each to the Beehiiv API as separate segment sends. The tests verify:

1. The A/B subjects are distinct non-empty strings (subject generation is working and non-deterministic)
2. Free HTML respects the paywall — no more than 3 of the 6 content sections are present
3. Pro HTML contains all 6 content sections
4. Free HTML includes an upgrade CTA keyword (e.g. "upgrade", "pro", "unlock")
5. Pro HTML includes a referral block keyword (e.g. "refer", "share", "invite")
6. Beehiiv is called exactly twice — once per segment (not zero times, not three times)
7. A short AI response (< 1000 words) is rejected with a descriptive error before delivery

---

## Tests

### Test 6.1 — Happy Path

**What it proves**: Full newsletter orchestration flows from mock input data through AI generation, segmentation, and Beehiiv delivery. Verifies field shapes, content gating, and that the correct number of external API calls are made.

**Setup**:
- Use `makeRouter` to cover two URL patterns:
  - `'anthropic'` → returns a mock AI response with 6 labelled section bodies totalling > 1000 words, and two A/B subject lines (`subjectA`, `subjectB`)
  - `'beehiiv'` → returns `MOCK_RESEND_OK` or an equivalent success response shape
- Provide mock input: 5 alert records (each with `ticker`, `significance_score`, `analysis_summary`), 3 article records (each with `headline`, `url`, `published_at`), 2 performance records (each with `ticker`, `return_pct`, `period`)
- Fake timers are already set to `2026-03-01T12:00:00Z` by `setup.js`; no additional timer setup needed for this test

**Call pattern** (pseudocode, not full implementation):
```js
// newsletter orchestrator receives the aggregated input and the router fetchFn
const result = await runNewsletter(mockInput, {
  fetchFn: makeRouter({ 'anthropic': MOCK_NEWSLETTER_AI_RESPONSE, 'beehiiv': MOCK_BEEHIIV_OK }),
  env: BASE_ENV,
  _sleep: noSleep,
});
```

**Assertions**:
- `result.subjectA` is a non-empty string
- `result.subjectB` is a non-empty string
- `result.subjectA !== result.subjectB`
- Count of content section blocks in free HTML is `<= 3`
- Count of content section blocks in pro HTML is exactly `6`
- Free HTML contains at least one of: `/upgrade/i`, `/unlock/i`, `/pro member/i` (upgrade CTA)
- Pro HTML contains at least one of: `/refer/i`, `/share/i`, `/invite/i` (referral block)
- `expectFetchCalledTimes(beehiivFetchFn, 2)` — Beehiiv endpoint was called exactly twice

**Note on counting section blocks**: The test should inspect the HTML string for a reliable structural marker that the newsletter builder emits once per section — for example a CSS class like `newsletter-section`, a `data-section` attribute, or an HTML comment delimiter. Check the actual newsletter builder output format before writing this assertion; if no such marker exists, assert that the free HTML byte count is meaningfully less than the pro HTML byte count as a proxy.

### Test 6.2 — Word Count Gate

**What it proves**: The newsletter pipeline enforces a minimum word count on the AI-generated body before sending to Beehiiv. A short response must be rejected with a clear error rather than delivering a thin email.

**Setup**:
- Mock Anthropic fetchFn to return a newsletter body with < 1000 words (e.g., a 200-word placeholder across all 6 sections)
- Provide the same 5 alerts / 3 articles / 2 performance records as Test 6.1
- Same `BASE_ENV`

**Call pattern**:
```js
await expect(
  runNewsletter(mockInput, {
    fetchFn: makeRouter({ 'anthropic': MOCK_SHORT_NEWSLETTER_RESPONSE, 'beehiiv': MOCK_BEEHIIV_OK }),
    env: BASE_ENV,
    _sleep: noSleep,
  })
).rejects.toThrow(/word count/i);
```

**Assertions**:
- The Promise rejects (does not resolve)
- The rejection error message matches `/word count/i`
- Beehiiv fetchFn is called 0 times (delivery must not proceed on a rejected body)

---

## File to Create

```
ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/06-newsletter-pipeline.test.js
```

### Stub structure

```js
const { makeFetch, makeRouter, makeFetchSeq, noSleep, BASE_ENV,
        expectFetchCalledTimes, MOCK_RESEND_OK } = require('../helpers');

// Local mock constants (defined at top of file)
const MOCK_NEWSLETTER_AI_RESPONSE = makeFetch({ /* ... full AI response shape ... */ });
const MOCK_SHORT_NEWSLETTER_RESPONSE = makeFetch({ /* ... < 1000 word response ... */ });
const MOCK_BEEHIIV_OK = makeFetch({ data: { id: 'send_test123' }, ok: true });

// Import the newsletter orchestrator
const { runNewsletter } = require('../../../../src/insiderbuying/newsletter/orchestrator');

describe('Newsletter Pipeline E2E (Chain 6)', () => {
  const mockInput = {
    alerts: [ /* 5 alert objects */ ],
    articles: [ /* 3 article objects */ ],
    performance: [ /* 2 performance records */ ],
  };

  test('6.1 happy path — A/B subjects, segmentation, Beehiiv called twice', async () => {
    // ... implementation ...
  });

  test('6.2 word count gate — short AI response rejects with error', async () => {
    // ... implementation ...
  });
});
```

---

## Mock Data Shapes

### mockInput.alerts (5 items, each needs at minimum)
```js
{
  ticker: 'NVDA',
  significance_score: 9,
  analysis_summary: 'CEO purchased $5M in shares...',
  filing_date: '2026-02-25',
}
```

### mockInput.articles (3 items, each needs at minimum)
```js
{
  headline: 'Why Insider Buying at NVDA Signals Undervaluation',
  url: 'https://earlyinsider.com/articles/nvda-insider-buying',
  published_at: '2026-02-28',
}
```

### mockInput.performance (2 items, each needs at minimum)
```js
{
  ticker: 'META',
  return_pct: 18.4,
  period: '30d',
}
```

### MOCK_NEWSLETTER_AI_RESPONSE content shape

The AI response body must contain:
- `subjectA`: non-empty string, e.g. `"The CEOs buying their own stock this week"`
- `subjectB`: different non-empty string, e.g. `"5 insider buys you missed — one is up 18%"`
- 6 section bodies labelled or keyed so the pipeline can distinguish free-tier sections from pro-tier sections
- Total word count across all sections > 1000 words
- The free sections must contain an upgrade CTA phrase
- The pro sections must contain a referral phrase

The exact structure depends on what the newsletter orchestrator expects from the AI call. Inspect `src/insiderbuying/newsletter/orchestrator.js` (or equivalent) to see how it parses the AI response before writing this mock.

### MOCK_SHORT_NEWSLETTER_RESPONSE content shape

Same keys as above but each section body is a single short sentence. Total word count < 1000. `subjectA` and `subjectB` may be present or absent — either way the orchestrator should reject before using them.

---

## Key Constraints

- `expectFetchCalledTimes(beehiivFetchFn, 2)` must pass — not 1, not 3. If the newsletter segments are free + pro, this means one POST per segment. If Beehiiv uses a different send API shape (one call with two audiences), update the assertion to `1` and document why.
- The Beehiiv fetchFn must be separate from the Anthropic fetchFn so call counts can be asserted independently. Use `makeRouter` with distinct URL substrings: `'anthropic.com'` and `'beehiiv.com'`.
- Do not use `makeFetchSeq` for this test — the newsletter orchestrator may call Anthropic multiple times (once per section) and `makeFetchSeq` would require knowing the exact call order. Use `makeRouter` instead so all Anthropic calls get the same canned response.
- Both tests must complete within 8 seconds (enforced by `jest.setTimeout(8000)` in `setup.js`). The newsletter has 6 sections which could mean up to 6 sequential AI calls; `noSleep` eliminates wait time but AI call stubs must be synchronous-fast. Using `makeRouter` (jest.fn with mockResolvedValue) guarantees this.

---

## Dependencies on Other Sections

- **section-01-helpers-fixtures**: Provides `helpers.js` (makeFetch, makeRouter, expectFetchCalledTimes, BASE_ENV, noSleep) and `setup.js` (global fetch trap, fake timers). Both must exist before this file can run.
- **section-02-jest-config**: The e2e Jest project config must be in place so `npx jest --selectProjects e2e` picks up this file.
- No dependency on section-03 through section-07 or section-09/10.

---

## Definition of Done for This Section

- `06-newsletter-pipeline.test.js` exists at the path above
- `npx jest --selectProjects e2e 06-newsletter-pipeline` exits with 0 failures
- Both tests run (no `.skip`, no `.todo`)
- Each test completes in < 8 seconds
- Zero real network calls (global fetch trap in `setup.js` ensures this — any bypass throws immediately)
- `expectFetchCalledTimes(beehiivFetchFn, 2)` passes in Test 6.1
- Test 6.2 rejects with a `/word count/i` error before any Beehiiv call

## Actual Implementation Notes

**File created**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/06-newsletter-pipeline.test.js`

**Tests**: 13 tests in 4 describes (1 fixture pre-check + 3 chain test groups) — 82 total passing after this section.

**Key deviations from spec**:

1. **`_aiClient.complete()` not fetchFn**: Production `generateNewsletter` uses `_opts._aiClient.complete()` (not a fetch-based AI call). Tests use `{ _aiClient: { complete: jest.fn() } }` injection — no `makeRouter`/`makeFetchSeq` needed for AI calls.

2. **`_postFn(url, headers, bodyStr)` not fetchFn**: `sendViaBeehiiv` uses `_opts._postFn` with a 3-arg positional signature, not the standard `fetch(url, options)`. Tests use `jest.fn()` directly.

3. **Section names in upgrade CTA**: `assembleFreeHtml` mentions "Pattern Recognition" and "What I'm Watching" in the upgrade CTA text. Assertion changed from `.not.toContain('Pattern Recognition')` to `.not.toContain('<h2>Pattern Recognition</h2>')` + `.not.toContain('S4SENTINEL')` (sentinel content check).

4. **`makeSections` uses per-section sentinels**: Each section key gets a unique sentinel string (S1SENTINEL, S4SENTINEL, etc.) so content leakage between tiers is detectable even without structural markers.

5. **`sendWeeklyNewsletter` added to exports**: Added to the destructured import to enable orchestrator-level Tests 6.2 and 6.3. The function accepts `_gatherFn` for bypassing NocoDB content collection.

6. **Code review additions**: Beehiiv failure path test (H2), full URL + Authorization header assertions (M4, M5), `sendWeeklyNewsletter` happy-path test (M6).
