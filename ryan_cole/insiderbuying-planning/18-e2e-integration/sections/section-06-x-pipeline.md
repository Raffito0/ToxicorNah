# Section 06: X Pipeline E2E Tests (Chain 4)

## Overview

This section creates `tests/insiderbuying/e2e/04-x-pipeline.test.js` — 3 tests covering the X (Twitter) pipeline chain end-to-end.

**Chain**: `filterRelevant` → `draftReply` → `sendToTelegramReview` / `postToX`

**What the tests prove**:
- A tweet mentioning a known ticker flows through filtering and reply drafting, producing a cashtag-containing reply within the required character range
- A tweet for a ticker with no known filing is correctly skipped with no downstream calls
- `postToX` calls the Twitter API exactly once and surfaces a posted tweet ID

---

## Dependencies

- **section-01-helpers-fixtures** must be complete first. All tests import from `helpers.js` and rely on `setup.js` for the global fetch trap, fake timers, and `jest.setTimeout(8000)`.
- **section-02-jest-config** must be complete. The e2e Jest project must be configured for this file to be discovered and run.
- No dependency on sections 03, 04, 05, 07, 08, or 09. This file is fully independent of all other chain test files and can be implemented in parallel with them.

---

## File to Create

```
ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/04-x-pipeline.test.js
```

---

## Background: The Dependency Injection Pattern

Every module in this codebase accepts an `opts` object:

```javascript
async function postToX(tweet, opts)
// opts = { fetchFn, env, _sleep }
// fetchFn: injectable fetch — the only HTTP boundary
// env: environment variables
// _sleep: injectable timer
```

`setup.js` overwrites `global.fetch` with a function that throws immediately. Any module that bypasses `opts.fetchFn` and calls `global.fetch` directly will fail the test with a clear error rather than silently calling a production API.

---

## Mock Helpers Available (from helpers.js)

```javascript
const { makeFetch, makeRouter, makeFetchSeq, noSleep, expectFetchCalledTimes, BASE_ENV, MOCK_X_OK } = require('./helpers');
```

- `makeRouter(routes)` — returns a `jest.fn(url, opts)` that matches URL substrings to response bodies
- `makeFetch(body, ok, status)` — returns a single-response `jest.fn()`
- `makeFetchSeq(...bodies)` — returns a `jest.fn()` that resolves each body in turn; throws on unexpected extra calls
- `noSleep` — `jest.fn().mockResolvedValue(undefined)` for all `_sleep` params
- `BASE_ENV` — frozen object with all required env var keys; spread for per-test overrides
- `MOCK_X_OK` — pre-built Response stub for successful Twitter API response; shape: `{ data: { id: '123456', text: '...' } }`

All mock response bodies are wrapped in the full Response shape:

```javascript
{
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
  headers: { get: (key) => null }
}
```

---

## Tests

### Test 4.1 — Happy path: filter → draft → reply contains cashtag and length check

**What it proves**: A tweet mentioning `$NVDA` passes `filterRelevant`, and `draftReply` returns a string that contains the `$NVDA` cashtag and is between 150 and 220 characters long.

**Setup**:
- Construct a mock tweet object: `{ id: 'tweet_001', text: 'Just saw $NVDA insider activity, what do you all think?', author: { username: 'someuser' } }`
- No fetchFn needed for `filterRelevant` and `draftReply` if they perform local logic; use `makeRouter` if they call any external API for filing lookup

**Test stub**:

```javascript
it('returns a cashtag reply within 150–220 chars for a known ticker tweet', async () => {
  const tweet = { id: 'tweet_001', text: '...', /* ... */ };

  const relevant = await filterRelevant([tweet], { env: BASE_ENV, _sleep: noSleep });
  // relevant is non-empty — the tweet was not filtered out

  const reply = await draftReply(relevant[0], { fetchFn: /* makeRouter for filing lookup if needed */, env: BASE_ENV, _sleep: noSleep });

  expect(reply).toMatch(/\$[A-Z]+/);
  expect(reply.length).toBeGreaterThanOrEqual(150);
  expect(reply.length).toBeLessThanOrEqual(220);
});
```

**Assertions**:
- `filterRelevant([tweet])` returns an array containing the original tweet (not empty)
- `reply` matches regex `/\$[A-Z]+/` (contains at least one cashtag)
- `reply.length >= 150`
- `reply.length <= 220`

---

### Test 4.2 — No matching filing → skip

**What it proves**: When a tweet mentions a ticker for which no known filing exists in the data source, either `filterRelevant` excludes it from the output or `draftReply` returns `null` — and no send-related fetchFn is called.

**Setup**:
- Construct a mock tweet mentioning a ticker with no active filing: e.g. `{ id: 'tweet_002', text: 'What is going on with $ZZZZZ today?', author: { username: 'anotheruser' } }`
- If `filterRelevant` queries a database or API, use `makeFetch({ data: [] })` to return an empty result set
- Track a separate `sendFetchFn = jest.fn()` that should never be called

**Test stub**:

```javascript
it('skips tweet when no filing exists for the ticker', async () => {
  const tweet = { id: 'tweet_002', text: '...', /* ... */ };
  const emptyFilingFetch = makeFetch({ data: [] });

  const relevant = await filterRelevant([tweet], { fetchFn: emptyFilingFetch, env: BASE_ENV, _sleep: noSleep });

  if (relevant.length === 0) {
    // filterRelevant excluded it — test complete
    expect(relevant).toHaveLength(0);
    return;
  }

  // Alternatively draftReply returns null
  const reply = await draftReply(relevant[0], { fetchFn: emptyFilingFetch, env: BASE_ENV, _sleep: noSleep });
  expect(reply).toBeNull();
});
```

**Assertions**:
- Either `filterRelevant` returns an empty array, OR `draftReply` returns `null` — the tweet does not proceed to posting
- No fetchFn calls to any Twitter/send endpoint

---

### Test 4.3 — X API called exactly once with tweet body; result contains tweet ID

**What it proves**: `postToX` calls `api.twitter.com` exactly once, passing the reply text in the request body, and the return value contains a tweet ID.

**Setup**:
- A `tweetText` string (e.g. the reply from Test 4.1, or a static `'$NVDA insider bought $5M — here is what the data says'`)
- `makeRouter({ 'api.twitter.com': { data: { id: '987654321', text: tweetText } } })` as the fetchFn

**Test stub**:

```javascript
it('calls Twitter API once with tweet body and returns a posted tweet ID', async () => {
  const tweetText = '$NVDA insider bought $5M — here is what the data says';
  const xFetchFn = makeRouter({ 'api.twitter.com': { data: { id: '987654321', text: tweetText } } });

  const result = await postToX(tweetText, { fetchFn: xFetchFn, env: BASE_ENV, _sleep: noSleep });

  expectFetchCalledTimes(xFetchFn, 1, 'postToX');

  const callBody = JSON.parse(xFetchFn.mock.calls[0][1].body);
  expect(callBody.text || callBody.tweet || callBody.status).toBe(tweetText);

  expect(result.id || result.data?.id).toBeTruthy();
});
```

**Assertions**:
- `xFetchFn` called exactly once
- The request body passed to the Twitter API contains the tweet text
- The return value has an `id` field (direct or nested under `data`) with a truthy value

---

## Implementation Notes

- The `filterRelevant` function may be synchronous (pure filter on in-memory data) or may query NocoDB/Supabase to look up active filings by ticker. If it makes HTTP calls, wrap those in `makeRouter`; if it is pure, no fetchFn is needed.
- The `draftReply` function is expected to call an AI/LLM API (Anthropic) to generate the reply. If so, the happy-path test (4.1) needs an additional `makeRouter` entry for `'anthropic.com'` returning a mock Anthropic response whose `content[0].text` contains `$NVDA` and is 150–220 chars.
- The character-length assertion (150–220) applies to the final reply string, not the Anthropic response body. Confirm which function trims or formats the string before asserting length.
- `sendToTelegramReview` is part of the chain description but not directly tested here — its behavior (sending for human review) is out of scope for the automated e2e assertion, which focuses on the deterministic `postToX` path.
- If `postToX` is not yet implemented and the production module only has `sendToTelegramReview`, adapt Test 4.3 to target whichever function makes the HTTP call to Twitter.

---

## Run Command

```bash
npx jest --selectProjects e2e tests/insiderbuying/e2e/04-x-pipeline.test.js
```

Or run the full e2e suite:

```bash
npx jest --selectProjects e2e
```

## Actual Implementation Notes

**File created**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/04-x-pipeline.test.js`

**Tests**: 15 tests in 4 describes (fixture pre-check + 3 chain tests) — 55 total passing

**Key deviations from spec**:

1. **`filterRelevant` is synchronous**: No fetchFn needed. Filters purely on `user.followers_count >= 10`, `user.following_count >= 10`, `user.created_at` age >= 30 days. Fake timers frozen at 2026-03-01T12:00:00Z: `created_at` must be before 2026-01-30.

2. **`draftReply` is a sync prompt builder**: Returns `{ prompt, maxTokens }` — NOT an AI caller. Test 4.1 asserts prompt contains tweet text and author handle.

3. **`buildReplyPrompt(archetype, tweet, filingContext, helpers)` is the actual AI caller**: Takes `helpers.fetchFn` and `helpers.anthropicApiKey`. The `makeRouter({'anthropic': ...})` mock routes by URL substring to `https://api.anthropic.com/v1/messages`. Uses `await res.json()` (async) — compatible with shared helpers.

4. **`postToX(text)` is a sync payload builder**: Returns `{ method, url, headers, body }` — does NOT make HTTP calls. Test 4.3 asserts the payload structure.

5. **Added fixture pre-check describe**: `validateReply(VALID_REPLY).valid === true` asserted before the main tests to catch any VALID_REPLY string length regressions.

6. **Code review fixes applied**: `following_count < 10` test (C1), request body AI assertions (H1), URL and AI-refusal `validateReply` tests (H2), `contrarian`/`pattern` archetype branch tests (M2), `expectFetchCalledTimes` on the AI call.

