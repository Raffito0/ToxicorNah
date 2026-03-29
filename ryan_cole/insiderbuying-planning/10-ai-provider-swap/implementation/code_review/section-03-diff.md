# Section 03 Diff — migrate-generate-article

## Files Changed
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-article.js` (modified)
- `ryan_cole/insiderbuying-site/tests/insiderbuying/generate-article.test.js` (created)

## Summary of Changes

### generate-article.js
- Added `const { createClaudeClient } = require('./ai-client');` at top
- Deleted `extractToolResult()` function (11 lines) — redundant, now handled by `completeToolUse`
- Deleted `callClaudeToolUse()` function (36 lines) — replaced by ai-client abstraction
- In `generateArticle()`: added `const claude = createClaudeClient(fetchFn, env.ANTHROPIC_API_KEY)`
- Replaced `callClaudeToolUse(prompt, opts) + extractToolResult(response)` with:
  - `claude.completeToolUse(prompt, 'Generate the article now.', [buildToolSchema()], {type:'tool',name:'generate_article'}, {temperature:0.6, maxTokens, cache:true})`
  - Wrapped in try/catch: on error → updateKeywordStatus('skipped') + return skipped
  - Uses `result.toolResult` directly (no extraction needed)
- Removed `extractToolResult` and `callClaudeToolUse` from `module.exports`

### generate-article.test.js (new)
- 15 tests covering:
  - Source code checks (no anthropic.com URL, no x-api-key header, imports createClaudeClient)
  - completeToolUse call contract (temperature, cache, tools array, tool_choice, user prompt)
  - Safety refusal → returns skipped status
  - buildToolSchema unit tests
  - qualityGate unit tests
- Smart fetchFn mock: returns `{list:[SAMPLE_KEYWORD]}` for Keywords URLs, `{income_statements:[...]}` for financialdatasets.ai
- env passed in `helpers.env` (matches how generateArticle reads it)
