# Section 06: Cost Validation and Documentation

## Overview

This is the final section of the AI Provider Swap plan. It verifies that all three file migrations (generate-article.js, score-alert.js, analyze-alert.js) are complete and correct. It confirms that no direct Anthropic API references remain outside of `ai-client.js`, adds `DEEPSEEK_API_KEY` to the environment validation, writes usage documentation into `ai-client.js`, and spot-checks cost logging output for all three migrated files.

## Dependencies

- **Section 01** (ai-client.js): Must be complete -- the provider abstraction must exist.
- **Section 02** (ai-client.test.js): Must be complete -- all ai-client tests must pass.
- **Section 03** (generate-article.js migration): Must be complete -- no direct Anthropic calls remain.
- **Section 04** (score-alert.js migration): Must be complete -- uses DeepSeek client.
- **Section 05** (analyze-alert.js migration): Must be complete -- uses DeepSeek client.

All five prior sections must be fully implemented and their tests passing before starting this section.

## Tests

Tests validate three things: no leftover direct API references, environment variable registration, and cost logging correctness.

### Codebase grep verification

A test (or manual check) must confirm that no `.js` file under `n8n/code/insiderbuying/` -- except `ai-client.js` itself -- contains direct Anthropic API references. Specifically, search for these patterns across all `.js` files in the directory:

- `api.anthropic.com` -- direct API URL
- `claude-haiku` -- old Haiku model string
- `claude-3` -- old Claude 3.x model references
- `x-api-key` -- Anthropic auth header (only ai-client.js should have this)
- `anthropic-version` -- Anthropic version header (only ai-client.js should have this)

Expected result: zero matches in any file except `ai-client.js`. If any match is found, the corresponding migration section is incomplete.

```javascript
// Test stub: verify no direct Anthropic references outside ai-client.js
test('no direct Anthropic API references outside ai-client.js', () => {
  // Read all .js files in n8n/code/insiderbuying/ except ai-client.js
  // Search for: 'api.anthropic.com', 'claude-haiku', 'claude-3',
  //             'x-api-key', 'anthropic-version'
  // Assert: zero matches in generate-article.js, score-alert.js, analyze-alert.js
});
```

### Environment variable validation

`e2e-monitoring.js` has a `validateEnv()` function that checks for required environment variables at startup. `DEEPSEEK_API_KEY` must be added to this list.

```javascript
// Test stub: DEEPSEEK_API_KEY in validateEnv required list
test('DEEPSEEK_API_KEY is in validateEnv required list', () => {
  // Read e2e-monitoring.js or import validateEnv
  // Call validateEnv with env missing DEEPSEEK_API_KEY
  // Assert: throws or returns error indicating missing DEEPSEEK_API_KEY
});
```

### Cost logging spot checks

Each migrated file should produce the correct cost log format when run. These can be tested by mocking `fetchFn` to return valid provider responses and checking `console.log` output.

```javascript
// Test stub: generate-article produces Claude cost log
test('generate-article cost log shows Claude provider', () => {
  // Mock fetchFn to return valid Claude Tool Use response with usage tokens
  // Run generateArticle() with mocked inputs
  // Assert: console.log was called with string containing 'claude' and '$'
});

// Test stub: score-alert produces DeepSeek cost log
test('score-alert cost log shows DeepSeek provider', () => {
  // Mock fetchFn to return valid DeepSeek response with { score: 7, reasoning: '...' }
  // Run runScoreAlert() with mocked inputs
  // Assert: console.log was called with string containing 'deepseek' and '$'
});

// Test stub: analyze-alert produces DeepSeek cost log
test('analyze-alert cost log shows DeepSeek provider', () => {
  // Mock fetchFn to return valid DeepSeek response with prose text
  // Run analyze() with mocked inputs
  // Assert: console.log was called with string containing 'deepseek' and '$'
});
```

### Documentation presence check

```javascript
// Test stub: ai-client.js has usage documentation at top
test('ai-client.js contains usage documentation comment block', () => {
  // Read ai-client.js file content as string
  // Assert: contains '@example' or 'Usage:' or 'Example:' within first 80 lines
  // Assert: mentions createClaudeClient and createDeepSeekClient
  // Assert: mentions required environment variables
});
```

## Implementation

### Step 1: Add DEEPSEEK_API_KEY to validateEnv()

**File**: `n8n/code/insiderbuying/e2e-monitoring.js`

Locate the `validateEnv()` function. It contains an array of required environment variable names. Add `'DEEPSEEK_API_KEY'` to this array alongside `'ANTHROPIC_API_KEY'`.

After this change, if `DEEPSEEK_API_KEY` is missing from the n8n environment, `validateEnv()` will report it on startup, preventing silent failures in score-alert.js and analyze-alert.js.

### Step 2: Run the codebase grep check

Manually verify or write a script that searches all `.js` files in `n8n/code/insiderbuying/` (excluding `ai-client.js`) for the following strings:

- `api.anthropic.com`
- `claude-haiku`
- `claude-3`
- `x-api-key`
- `anthropic-version`

If any matches are found, go back to the relevant migration section (03, 04, or 05) and remove the leftover references. This check ensures all three migrations are fully complete.

Note: `ai-client.js` will legitimately contain `api.anthropic.com`, `x-api-key`, and `anthropic-version` since it is the single point of Anthropic API access. The grep must exclude this file.

### Step 3: Add usage documentation to ai-client.js

**File**: `n8n/code/insiderbuying/ai-client.js`

Add a multi-line comment block at the top of the file (after any `'use strict'` declaration, before the class definition). The comment block must cover:

1. **Purpose**: Single abstraction for AI provider calls (Claude and DeepSeek)
2. **Creating clients**: Show how to use `createClaudeClient(fetchFn, apiKey)` and `createDeepSeekClient(fetchFn, apiKey)`
3. **Text completion example**: `const result = await client.complete(systemPrompt, userPrompt)`
4. **Cached completion example**: `const result = await client.completeWithCache(systemPrompt, userPrompt)` -- note that caching only benefits calls within a 5-minute window
5. **Tool Use example**: `const result = await client.completeToolUse(systemPrompt, userPrompt, tools, toolChoice, { cache: true })`
6. **Switching providers**: To switch a file from DeepSeek to Claude, change `createDeepSeekClient` to `createClaudeClient` and swap the API key env var -- one line change
7. **Environment variables**: `ANTHROPIC_API_KEY` for Claude, `DEEPSEEK_API_KEY` for DeepSeek
8. **Return shape**: Document the normalized return object (`content`, `toolResult`, `usage`, `cached`, `estimatedCost`)
9. **Cost logging**: Mention that every call logs provider/model/tokens/cost to console automatically
10. **Security note**: State that cost logging never includes prompts, API keys, or response content

Example documentation block structure:

```javascript
/**
 * ai-client.js -- Unified AI Provider Abstraction
 *
 * Routes AI calls to Claude (Anthropic) or DeepSeek via a single interface.
 * Handles request formatting, response parsing, retry with backoff, prompt
 * caching (Claude only), and per-call cost logging.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  -- required for Claude calls
 *   DEEPSEEK_API_KEY   -- required for DeepSeek calls
 *
 * Usage:
 *
 *   const { createClaudeClient, createDeepSeekClient } = require('./ai-client');
 *
 *   // Text completion (DeepSeek)
 *   const ds = createDeepSeekClient(fetchFn, env.DEEPSEEK_API_KEY);
 *   const result = await ds.complete(systemPrompt, userPrompt);
 *   console.log(result.content);       // prose text
 *   console.log(result.estimatedCost); // USD
 *
 *   // Cached completion (Claude) -- saves 90% on repeated system prompts
 *   // Note: cache TTL is 5 minutes. Only beneficial for batch processing.
 *   const claude = createClaudeClient(fetchFn, env.ANTHROPIC_API_KEY);
 *   const result = await claude.completeWithCache(systemPrompt, userPrompt);
 *
 *   // Tool Use (Claude) -- structured output via tools
 *   const result = await claude.completeToolUse(
 *     systemPrompt, userPrompt, tools, toolChoice, { cache: true }
 *   );
 *   console.log(result.toolResult); // parsed tool input object
 *
 *   // Switching providers: change one line
 *   // createDeepSeekClient(fetchFn, env.DEEPSEEK_API_KEY)
 *   //   --> createClaudeClient(fetchFn, env.ANTHROPIC_API_KEY)
 *
 * Return shape (all methods):
 *   {
 *     content: string,           // text response (null for tool use)
 *     toolResult: object | null, // tool use input (only completeToolUse)
 *     usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
 *     cached: boolean,           // true if cache_read > 0
 *     estimatedCost: number,     // USD
 *   }
 *
 * Cost logging: every call logs provider/model/tokens/cost to console.
 * Security: logs NEVER include prompts, API keys, or response content.
 */
```

### Step 4: Verify cost logging output

Run each of the three migrated files with mocked inputs (via Jest tests or n8n test execution) and confirm the console output matches the expected format:

**generate-article.js** (Claude):
```
[ai-client] claude sonnet-4 | in:2450 out:830 cache:1800r | $0.0087
```

**score-alert.js** (DeepSeek):
```
[ai-client] deepseek chat | in:450 out:120 | $0.0003
```

**analyze-alert.js** (DeepSeek):
```
[ai-client] deepseek chat | in:800 out:350 | $0.0006
```

Verify each line shows:
- Correct provider name (`claude` or `deepseek`)
- Correct model name
- Token counts (input, output, and cache read/write for Claude)
- Estimated cost in USD (reasonable magnitude)
- No prompt text, no API keys, no response content

### Step 5: Monthly cost projection validation

Review the expected monthly costs against the pricing constants in ai-client.js:

**Claude** (generate-article.js only):
- Volume: ~30 articles/day = ~900/month
- Per article: ~2500 input tokens + ~2000 output tokens
- Uncached: (2500 * $3 + 2000 * $15) / 1M = $0.0375/article = $33.75/month
- Cached (assuming batch processing, ~80% cache hit): ~$11/month
- Monitor cache hit rate in first week. If consistently below 50%, disable caching

**DeepSeek** (score-alert.js + analyze-alert.js):
- Score: ~100/day * ~500 tokens each = 50K tokens/day
- Analysis: ~50/day * ~1000 tokens each = 50K tokens/day
- Total: ~100K tokens/day * 30 = 3M tokens/month
- Cost: (3M * $0.27 + 1.5M * $1.10) / 1M = $0.81 + $1.65 = ~$2.46/month

Total projected: ~$13-14/month (down from ~$45/month pre-migration).

These numbers should be documented as a comment in the project's deployment notes or in the ai-client.js header for future reference.

## Checklist

After completing all steps, verify:

- [x] `DEEPSEEK_API_KEY` added to `REQUIRED_N8N_ENV_VARS` in `e2e-monitoring.js` (done in S04)
- [x] Grep confirms zero direct Anthropic references outside `ai-client.js`
- [x] Usage documentation block added to top of `ai-client.js`
- [x] Documentation covers: client creation, text/cached/tool-use examples, provider switching, env vars, return shape, cost logging, security
- [x] Cost log spot-check: Claude client logs [ai-client] with provider name and cost
- [x] Cost log spot-check: DeepSeek client logs [ai-client] with provider name and cost
- [x] No prompts, API keys, or response content in any cost log output
- [x] All tests pass: 29/29 (ai-provider-validation.test.js)

## Code Review Findings

No issues requiring fixes. One cosmetic observation (cost projection may drift over time) — let go.
