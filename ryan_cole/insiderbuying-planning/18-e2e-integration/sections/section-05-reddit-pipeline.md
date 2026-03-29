# Section 05: Reddit Pipeline E2E

## Overview

Create `tests/insiderbuying/e2e/03-reddit-pipeline.test.js` — the E2E integration test for the Reddit pipeline (Chain 3).

**Chain**: `buildSearchQueries` → `draftComment` → `validateComment`

**What this file proves**: Search query construction, comment drafting with subreddit-specific tone, comment validation, and the daily cap guard all work in sequence with mocked external I/O.

---

## Dependencies

This section depends on:

- **section-01-helpers-fixtures** — `helpers.js`, `setup.js`, and fixtures must exist before this file can run.
- **section-02-jest-config** — Jest projects config must be updated so `npx jest --selectProjects e2e` discovers this file.

This section does **not** block any other section except section-10-cross-chain, which requires all 7 chain test files.

---

## File to Create

```
ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/03-reddit-pipeline.test.js
```

---

## Tests (TDD — write these first)

### Test 3.1 — Happy path: search → draft → validate chain

**Goal**: The three functions in the chain call in sequence and each returns a non-empty, valid result.

Setup:
- Construct a `mockPost` object representing a Reddit post about a stock discussion. It should include at minimum: `subreddit` (string), `title` (string), `body` (string), and a ticker reference.
- No `fetchFn` mock is required unless `draftComment` makes an external call (e.g., to an AI API). If it does, use `makeRouter({'anthropic': MOCK_ANALYSIS_RESPONSE})` from `helpers.js`.

Test steps:
1. Call `buildSearchQueries()` — assert the result is a non-empty array.
2. Call `draftComment(mockPost, { fetchFn, env: BASE_ENV, _sleep: noSleep })` — assert the result is a non-empty string.
3. Call `validateComment(comment)` — assert the result is `true`.

Assertions:
- `queries.length > 0`
- `typeof comment === 'string' && comment.length > 0`
- `validateComment(comment) === true`

---

### Test 3.2 — Subreddit tone difference: WSB shorter than ValueInvesting

**Goal**: The same underlying ticker data produces a shorter, more casual comment for WSB-context posts and a longer, more detailed comment for ValueInvesting-context posts.

Setup:
- Create two mock post objects with identical ticker data (same company, same filing details) but different `subreddit` fields: one set to a WSB-style context, one to a ValueInvesting-style context.
- Both posts use the same `fetchFn` mock (or `noSleep` if no external calls).

Test steps:
1. Call `draftComment(wsbPost, opts)` → `wsbComment`.
2. Call `draftComment(viPost, opts)` → `viComment`.

Assertions:
- `wsbComment.split(/\s+/).length <= 100`
- `viComment.split(/\s+/).length >= 150`

This verifies that the tone-routing logic (`subreddit` → comment style) is wired correctly end-to-end, not just in unit isolation.

---

### Test 3.3 — Daily cap enforcement: cap reached → no new draft generated

**Goal**: When the daily comment count for a subreddit is at or above the maximum, the pipeline guard returns early without calling any Reddit API or AI API.

Setup:
- Mock the comment count tracker (however it is implemented — in-memory store, NocoDB fetch, or Redis call) to return the daily maximum value.
- Use a `fetchFn` spy (plain `jest.fn()` — not a `makeRouter`) so you can assert it was never called.

Test steps:
1. Trigger the draft flow (call the orchestrator or guard function responsible for checking the cap before calling `draftComment`).

Assertions:
- `fetchFn.mock.calls.length === 0` — no Reddit API call was made.
- No new comment string was returned (result is `null`, `undefined`, or an explicit "cap reached" signal — match the actual return shape of the production function).

Use `expectFetchCalledTimes(fetchFn, 0)` from `helpers.js` to get a descriptive failure message if this assertion fails.

---

## Implementation Notes

### What functions to import

Import from the actual Reddit pipeline source modules. Locate these under `ryan_cole/insiderbuying-site/src/` or the equivalent pipeline path:

- `buildSearchQueries` — constructs an array of Reddit search query strings based on configured niches/tickers.
- `draftComment` — takes a Reddit post object and returns a comment string. Likely accepts `opts` with `fetchFn` and `env`.
- `validateComment` — synchronous validator; returns `true` if the comment meets content rules (non-empty, within character limit, no banned phrases).

The comment count tracker/cap guard — wherever the daily limit check lives — may be a separate function or a check inside the orchestrator. Locate it before writing Test 3.3.

### opts pattern

All async functions in this codebase accept:
```javascript
{ fetchFn, env, _sleep }
```
Use `BASE_ENV` and `noSleep` from `helpers.js` for all calls. Spread `BASE_ENV` if you need per-test overrides: `{ ...BASE_ENV, REDDIT_DAILY_CAP: '3' }`.

### No real network calls

`setup.js` overwrites `global.fetch` with a function that throws `'Unexpected real fetch — use opts.fetchFn'`. If any module bypasses `opts.fetchFn` and calls `global.fetch` directly, the test will fail immediately with that message. This is a feature, not a bug — fix the module to use `opts.fetchFn`.

### fetchFn for AI calls in draftComment

If `draftComment` calls an AI API (Anthropic), use:
```javascript
const fetchFn = makeRouter({ 'anthropic': MOCK_ANALYSIS_RESPONSE });
```
`MOCK_ANALYSIS_RESPONSE` is exported from `helpers.js` and wraps the `claude-analysis-response.json` fixture. You do not need to define it inline.

---

## Boilerplate Structure

```javascript
// tests/insiderbuying/e2e/03-reddit-pipeline.test.js

const { buildSearchQueries, draftComment, validateComment } = require('../../../src/reddit-pipeline'); // adjust path
const { makeFetch, makeRouter, BASE_ENV, noSleep, expectFetchCalledTimes, MOCK_ANALYSIS_RESPONSE } = require('./helpers');

describe('Reddit Pipeline E2E (Chain 3)', () => {

  describe('Test 3.1 — happy path: search → draft → validate', () => {
    it('chains buildSearchQueries → draftComment → validateComment', async () => {
      // ... stub implementation
    });
  });

  describe('Test 3.2 — subreddit tone difference', () => {
    it('WSB comment is shorter than ValueInvesting comment', async () => {
      // ... stub implementation
    });
  });

  describe('Test 3.3 — daily cap enforcement', () => {
    it('returns without drafting when cap is reached', async () => {
      // ... stub implementation
    });
  });

});
```

Adjust the `require` path to match the actual module location. All test logic lives inside `it()` blocks — no shared state between tests (the `clearMocks: true` in the Jest e2e project config resets mock call counts between tests automatically).

---

## Acceptance Criteria

This section is complete when:

- [x] `tests/insiderbuying/e2e/03-reddit-pipeline.test.js` exists
- [x] 4 tests (3 + 1 bonus allowed:true case) pass under `npx jest --selectProjects e2e`
- [x] No `.skip` or `.todo` markers
- [x] Test 3.3 asserts 1 fetch call (log query only) using `expectFetchCalledTimes`
- [x] Zero real network calls
- [x] 40/40 tests passing

## Actual Implementation Notes

**File created**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/03-reddit-pipeline.test.js`

**Tests**: 4 tests in 3 describes (40 total passing)

**Key deviations from spec**:

1. **`draftComment` is a prompt builder, not AI caller**: Spec assumed `draftComment(post, insiderData)` returns a comment string via AI. Production returns `{ prompt, maxTokens }` synchronously. Test 3.1 uses `buildCommentPrompt(post, insiderData, subreddit, structure)` — the actual Claude-calling function — for the chain test.

2. **`validateComment` returns object, not boolean**: Returns `{ valid: bool, issues: string[] }`. Assertions use `validation.valid`.

3. **Test 3.2 inspects system prompt, not output length**: Claude's response length is controlled by our mock. Word count in mock output is irrelevant. Instead, assert that `buildCommentPrompt` sends a system prompt containing the correct word-limit range (derived from `SUBREDDIT_TONE_MAP`) for each subreddit.

4. **`_setDeps` injection used instead of `opts.fetchFn`**: `reddit-monitor.js` uses a module-level `_deps.fetch` (not opts-based injection). `_setDeps({ fetch })` is the test seam. `afterEach` calls `_setDeps(null)` to reset.

5. **`makeDepsFetch` MUST return sync `json()`, NOT a Promise**: `_callClaude` calls `res.json()` synchronously. Shared helpers' `makeFetch`/`makeRouter` return Promises from `json()` and would cause silent failures.

6. **Test 3.3 asserts 1 fetch call** (the NocoDB log query): spec said "0 fetch calls" but `checkDailyCommentLimit` always queries the NocoDB log first. "0 Reddit API calls" is the correct contract — verified by `expect(calledUrl).not.toContain('reddit.com')`.

7. **Code review fixes applied**: `makeDepsFetch` comment, exact comment value assertion, URL date check (frozen to 2026-03-01), word limit strings derived from SUBREDDIT_TONE_MAP.
