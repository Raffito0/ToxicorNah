# Section 06 Diff — validation-docs

## Files Changed
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/ai-client.js` (modified — usage docs block expanded)
- `ryan_cole/insiderbuying-site/tests/insiderbuying/ai-provider-validation.test.js` (created)

## Summary of Changes

### ai-client.js
- Expanded top-level JSDoc comment from 6-line stub to 50-line usage documentation
- Added: env var requirements (ANTHROPIC_API_KEY, DEEPSEEK_API_KEY)
- Added: text/cached/tool-use examples with result field access
- Added: provider switching note ("change one line")
- Added: normalized return shape documentation (content, toolResult, usage, cached, estimatedCost)
- Added: cost logging and security note (logs never include prompts/keys/content)
- Added: monthly cost projection (~$13-17/month vs ~$45/month pre-migration)

### ai-provider-validation.test.js (new — 29 tests)
- `no direct Anthropic references outside ai-client.js`: 15 tests (5 patterns × 3 files)
- `migrated files import from ai-client`: 3 tests
- `environment variable registration`: 2 tests (DEEPSEEK_API_KEY + ANTHROPIC_API_KEY in REQUIRED_N8N_ENV_VARS)
- `ai-client.js documentation`: 6 tests (factory mentions, env vars, return shape, security note)
- `cost logging format`: 3 tests (Claude logs with provider+cost, DeepSeek logs with provider+cost, no prompts/keys in logs)
