# Section 04 Diff — migrate-score-alert

## Files Changed
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/score-alert.js` (modified)
- `ryan_cole/insiderbuying-site/tests/insiderbuying/score-alert.test.js` (modified)
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/e2e-monitoring.js` (modified)

## Summary of Changes

### score-alert.js
- Added `const { createDeepSeekClient } = require('./ai-client');`
- Removed `HAIKU_MODEL` and `ANTHROPIC_API` constants
- Rewrote `callHaiku(prompt, anthropicApiKey, {fetchFn, _sleep})` → `callHaiku(prompt, deepseekClient)`
  - Old: 40-line retry loop calling Anthropic directly via fetchFn
  - New: 5-line wrapper — `deepseekClient.complete(null, prompt, {temperature:0.3})` + `parseHaikuResponse(result.content)` + HAIKU_DEFAULT catch
  - Retry logic delegated to ai-client layer
- Updated `runScoreAlert()`: added `deepseekApiKey` param, creates `const deepseek = createDeepSeekClient(fetchFn, deepseekApiKey)`, passes `deepseek` to `callHaiku`
- Updated n8n deployment comment to use `deepseekApiKey: $env.DEEPSEEK_API_KEY`
- `HAIKU_DEFAULT` and `parseHaikuResponse` unchanged

### score-alert.test.js
- Added `jest.mock('../../n8n/code/insiderbuying/ai-client', ...)` at top
- Added `makeMockDeepSeekClient()` helper
- Replaced `callHaiku` describe block (5 Anthropic-specific tests) with 6 DeepSeek-aware tests
- Replaced `runScoreAlert` describe block: `anthropicApiKey` → `deepseekApiKey`, mock at ai-client level
- Added `source code checks` describe block (4 tests: no anthropic.com, no claude-haiku, no x-api-key, imports createDeepSeekClient)

### e2e-monitoring.js
- Added `'DEEPSEEK_API_KEY'` to `REQUIRED_N8N_ENV_VARS` list
