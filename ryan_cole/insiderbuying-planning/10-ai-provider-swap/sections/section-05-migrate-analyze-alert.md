# Section 05: Migrate analyze-alert.js to DeepSeek Client

## Overview

This section migrates `analyze-alert.js` from making direct Anthropic API calls (Claude Sonnet) to using the shared `createDeepSeekClient()` abstraction from `ai-client.js`. This is the simplest of the three migrations -- the function returns prose text (not JSON, not Tool Use), so no response parsing changes are needed beyond using `result.content`.

## Dependencies

- **Section 01** (ai-client.js) must be implemented -- provides `createDeepSeekClient()` factory and the `AIClient` class.
- **Section 02** (ai-client.test.js) must pass -- validates the abstraction works correctly for DeepSeek provider.
- `DEEPSEEK_API_KEY` environment variable must be available in the n8n environment (added in Section 04 to `validateEnv()` in `e2e-monitoring.js`).

## Files to Modify

- `n8n/code/insiderbuying/analyze-alert.js` -- main migration target
- `tests/insiderbuying/analyze-alert.test.js` -- update mocks and assertions

## Current State

`analyze-alert.js` exports 4 functions: `buildAnalysisPrompt`, `validateAnalysis`, `callClaude`, and `analyze`.

**`callClaude(prompt, helpers)`** (lines 53-80) makes a direct `fetchFn` POST to `https://api.anthropic.com/v1/messages` with:
- Headers: `Content-Type`, `x-api-key`, `anthropic-version: 2023-06-01`
- Body: `model: 'claude-sonnet-4-6'`, `max_tokens: 1536`, single user message
- Parses `data.content[0].text` from the response
- Throws on non-ok response with the HTTP status attached to the error

**`callWithRetry(prompt, helpers)`** (lines 134-148) wraps `callClaude` with error-specific retry:
- 429 (rate limit): waits 5s via `helpers._sleep(5000)`, retries once
- 500/503 (server error): waits 2s, retries once
- Other errors: throws immediately

**`analyze(filing, helpers)`** (lines 91-128) is the main entry point:
- Score gate: returns `null` if `filing.significance_score < 4`
- Calls `callWithRetry` for the first attempt
- If response fails `validateAnalysis` (< 50 chars or < 2 paragraphs), retries once with direct `callClaude`
- All errors caught, returns `null` on failure (never throws)

**`helpers` object shape (current):**
```javascript
{
  anthropicApiKey: string,   // Anthropic API key
  fetchFn: Function,         // n8n's injected fetch
  _sleep: Function,          // (ms) => Promise<void>
}
```

**Current test file** (`analyze-alert.test.js`, 284 lines) uses `makeFetch()` to mock `fetchFn` returning Claude-format responses (`{ content: [{ type: 'text', text: '...' }] }`). Tests cover: score gate, model string assertion, validation retry, error handling (429, 503, network), prompt quality.

## Tests First

Update `tests/insiderbuying/analyze-alert.test.js`. The test file needs to change from mocking `fetchFn` with Claude-format responses to mocking the `AIClient` returned by `createDeepSeekClient`.

### Mocking approach

The current `makeFetch()` helper returns mock HTTP responses in Claude's response format. After migration, `analyze-alert.js` no longer calls `fetchFn` directly for the AI call -- it delegates to `client.complete()`. The tests should mock `createDeepSeekClient` to return a mock client object.

```javascript
// Mock ai-client module
jest.mock('../../n8n/code/insiderbuying/ai-client', () => ({
  createDeepSeekClient: jest.fn(),
}));

const { createDeepSeekClient } = require('../../n8n/code/insiderbuying/ai-client');
```

Create a helper that builds a mock client:

```javascript
function makeMockClient(responseText) {
  return {
    complete: jest.fn().mockResolvedValue({
      content: responseText,
      toolResult: null,
      usage: { inputTokens: 500, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cached: false,
      estimatedCost: 0.0005,
    }),
  };
}
```

### Test: `analyze()` calls DeepSeek client (not Claude)

Verify that `analyze()` uses the DeepSeek client's `complete()` method. After the call, assert `mockClient.complete` was called. Assert no direct `fetchFn` call to `anthropic.com` exists.

### Test: `analyze()` uses `env.DEEPSEEK_API_KEY`

Pass helpers with `deepSeekApiKey` (the new key name). Verify `createDeepSeekClient` was called with `fetchFn` and the DeepSeek key, not an Anthropic key.

### Test: `result.content` used directly (prose, no JSON parsing)

Verify that the prose text returned by `client.complete()` flows through to the `analyze()` return value unchanged (no JSON.parse, no markdown stripping).

### Test: `buildAnalysisPrompt()` output is unchanged

All existing prompt quality tests remain exactly as-is. `buildAnalysisPrompt` is not modified in this migration. The tests asserting prompt content (generic phrase ban, actual numbers, insider name, track record, cluster info) should pass without changes.

### Test: AI client error causes filing analysis to be skipped gracefully (returns null)

```javascript
test('AI client error returns null (no throw)', async () => {
  const mockClient = makeMockClient('');
  mockClient.complete.mockRejectedValue(new Error('DeepSeek API error'));
  // ... setup createDeepSeekClient to return mockClient
  const result = await analyze(SAMPLE_FILING, helpers);
  expect(result).toBeNull();
});
```

### Test: network error causes filing analysis to be skipped gracefully

```javascript
test('network error returns null (no throw)', async () => {
  const mockClient = makeMockClient('');
  mockClient.complete.mockRejectedValue(new Error('ECONNRESET'));
  // ... setup
  const result = await analyze(SAMPLE_FILING, helpers);
  expect(result).toBeNull();
});
```

### Test: no direct fetchFn call to anthropic.com in analyze-alert.js

Verify that after calling `analyze()`, there are zero calls to `fetchFn` with a URL containing `anthropic.com`. The AI call goes through the client abstraction, not direct HTTP.

### Test: no `claude-sonnet` model strings in analyze-alert.js

This is a static code check. Read the source file and assert it does not contain `claude-sonnet` anywhere. Can be done as a grep assertion or by checking the module's exported function source.

### Test: validation retry still works with ai-client response format

The validation retry (short response or single paragraph triggers one retry) needs to work with the new client. The retry logic stays in `analyze()`, not in `ai-client`:
- First call returns short text -> `validateAnalysis` fails -> retry by calling `client.complete()` again
- Second call returns good text -> return it

```javascript
test('validation failure triggers one retry via client.complete', async () => {
  const mockClient = makeMockClient('');
  mockClient.complete
    .mockResolvedValueOnce({ content: 'Too short.', /* ... */ })
    .mockResolvedValueOnce({ content: GOOD_ANALYSIS, /* ... */ });
  // ...
  const result = await analyze(SAMPLE_FILING, helpers);
  expect(mockClient.complete).toHaveBeenCalledTimes(2);
  expect(result).toBe(GOOD_ANALYSIS);
});
```

### Test: score-alert does NOT have its own retry loop

Verify `callWithRetry` is removed. The `ai-client` handles retries internally. `analyze()` only retries on validation failure (business logic), not on HTTP errors.

### Tests to remove or update

- **Remove**: `test('analyze() uses model claude-sonnet-4-6')` -- model is now configured inside `ai-client`, not in `analyze-alert.js`
- **Remove**: `test('429 rate limit waits 5s and retries once')` -- retry is delegated to `ai-client`
- **Remove**: `test('429 twice returns null')` -- retry is delegated to `ai-client`
- **Remove**: `test('500/503 retries once after 2s delay')` -- retry is delegated to `ai-client`
- **Keep (unchanged)**: all `validateAnalysis` unit tests
- **Keep (unchanged)**: all `buildAnalysisPrompt` tests
- **Keep (update mock)**: validation retry tests, network error test, score gate tests

## Implementation

### Step 1: Update `helpers` object shape

The `helpers` object changes from expecting `anthropicApiKey` to `deepSeekApiKey`:

```javascript
// Old
{ anthropicApiKey, fetchFn, _sleep }

// New
{ deepSeekApiKey, fetchFn, _sleep }
```

The `_sleep` dependency can be removed from `helpers` since `ai-client` handles retry delays internally. However, keep it if `analyze()` needs it for non-retry purposes (currently it does not -- `_sleep` is only used in `callWithRetry`, which is being removed).

### Step 2: Import `createDeepSeekClient`

At the top of `analyze-alert.js`:

```javascript
const { createDeepSeekClient } = require('./ai-client');
```

### Step 3: Replace `callClaude()` and `callWithRetry()`

Remove both `callClaude()` and `callWithRetry()` functions entirely. The `ai-client` handles:
- Request formatting (DeepSeek endpoint, headers, body)
- Retry logic (429, 500, 503 with exponential backoff + jitter)
- Response parsing (`choices[0].message.content`)

### Step 4: Update `analyze()` function

The core logic stays the same. The only change is how the AI call is made:

```javascript
async function analyze(filing, helpers) {
  if (filing.significance_score < 4) {
    return null;
  }

  const prompt = buildAnalysisPrompt(filing);
  const client = createDeepSeekClient(helpers.fetchFn, helpers.deepSeekApiKey);

  try {
    let result = await client.complete(null, prompt);
    let text = result.content;

    if (validateAnalysis(text)) {
      return text;
    }

    // One retry on validation failure
    console.warn(
      `[analyze-alert] Validation failed for ${filing.dedup_key}, retrying. ` +
      `Response: ${(text || '').slice(0, 200)}`
    );
    result = await client.complete(null, prompt);
    text = result.content;

    if (validateAnalysis(text)) {
      return text;
    }

    console.warn(
      `[analyze-alert] Retry also failed validation for ${filing.dedup_key}. ` +
      `Response: ${(text || '').slice(0, 200)}`
    );
    return null;
  } catch (err) {
    console.warn(`[analyze-alert] Error for ${filing.dedup_key}: ${err.message}`);
    return null;
  }
}
```

Key differences from current code:
- `createDeepSeekClient(helpers.fetchFn, helpers.deepSeekApiKey)` replaces direct `fetchFn` calls
- `client.complete(null, prompt)` replaces `callWithRetry(prompt, helpers)` and `callClaude(prompt, helpers)`
- System prompt is `null` (the full prompt is passed as user message, matching current behavior where everything is in a single user message)
- `result.content` gives the prose text directly
- No `callWithRetry` -- `ai-client` handles HTTP retries internally
- Validation retry stays in `analyze()` (this is business logic, not HTTP retry)

### Step 5: Update n8n Code node wrapper comment

Update the commented usage example at the bottom of the file:

```javascript
// Usage inside an n8n Code node:
//
//   const helpers = {
//     deepSeekApiKey: $env.DEEPSEEK_API_KEY,
//     fetchFn: (url, opts) => fetch(url, opts),
//   };
//   for (const item of $input.all()) {
//     item.json.ai_analysis = await analyze(item.json, helpers);
//   }
//   return $input.all();
```

Note: `_sleep` removed from helpers since retry is internal to `ai-client`.

### Step 6: Update exports

Remove `callClaude` from exports (function no longer exists):

```javascript
module.exports = {
  buildAnalysisPrompt,
  validateAnalysis,
  analyze,
};
```

## Prompt Preservation

`buildAnalysisPrompt(filing)` is NOT modified. It generates the same prompt text asking for 2-3 paragraphs of analysis prose. This prompt works identically with DeepSeek -- it asks for prose output (not JSON), so there are no DeepSeek-specific parsing concerns (no markdown fence stripping needed).

The prompt includes:
- Filing data (company, insider, transaction details)
- Three analysis angles (trade signal, historical context, risk factors)
- Tone guidance (informative, not alarmist)
- Anti-generic-phrase instruction

All of this transfers to DeepSeek without modification.

## Error Behavior

After migration, error handling remains identical from the caller's perspective:

| Scenario | Before (Claude direct) | After (DeepSeek via ai-client) |
|----------|----------------------|-------------------------------|
| API error (4xx, 5xx) | `callWithRetry` retries, then `analyze` catches and returns `null` | `ai-client` retries internally, then `analyze` catches and returns `null` |
| Network error | Caught by `analyze`, returns `null` | `ai-client` retries, then caught by `analyze`, returns `null` |
| Validation failure | Retries once via direct `callClaude`, returns `null` if still bad | Retries once via `client.complete`, returns `null` if still bad |
| Score < 4 | Returns `null` immediately, no API call | Returns `null` immediately, no API call |

## Risk Mitigation

DeepSeek prose quality for financial analysis is untested. The abstraction makes switching back trivial:

```javascript
// To revert to Claude:
// 1. Change import:
const { createClaudeClient } = require('./ai-client');
// 2. Change client creation:
const client = createClaudeClient(helpers.fetchFn, helpers.anthropicApiKey);
// 3. Change helpers key back to anthropicApiKey
```

Recommend manual quality review of the first ~20 analyses after deployment. Compare DeepSeek output against the three required angles (trade signal, historical context, risk factors) and verify it references actual filing numbers rather than generic statements.

## Checklist

- [x] Import `createDeepSeekClient` from `./ai-client`
- [x] Remove `callClaude()` function
- [x] Remove `callWithRetry()` function
- [x] Update `analyze()` to use `client.complete(null, prompt)` with `result.content`
- [x] Change `helpers.anthropicApiKey` to `helpers.deepSeekApiKey`
- [x] Remove `_sleep` from helpers (now internal to ai-client)
- [x] Remove `callClaude` from `module.exports`
- [x] Update n8n Code node wrapper comment
- [x] Update all test mocks from `makeFetch` (Claude format) to mock `createDeepSeekClient`
- [x] Remove HTTP-retry tests (429, 503 -- delegated to ai-client)
- [x] Remove model string assertion test
- [x] Add test: `analyze()` calls DeepSeek client
- [x] Add test: no direct anthropic.com calls
- [x] Add test: no claude-sonnet strings in source
- [x] Verify all existing prompt quality tests pass unchanged
- [x] Verify all `validateAnalysis` unit tests pass unchanged
- [x] Run full test suite: 26/26 pass

## Deviations from Plan

None. Implementation matches the spec exactly. Score gate confirmed to fire before `createDeepSeekClient` is called (test coverage added for this).

## Code Review Findings

- Issue 1 (let go): Client instantiated per-call — plan-aligned, factory is cheap
- Issue 2 (let go): No null guard on `result` — ai-client guarantees non-null on resolve, consistent with S04 decision
- Issue 3 (auto-fixed): Added `expect(createDeepSeekClient).not.toHaveBeenCalled()` to both score gate tests
- Issue 4 (cosmetic/let go): `makeMockClient` has asymmetric throws parameter
