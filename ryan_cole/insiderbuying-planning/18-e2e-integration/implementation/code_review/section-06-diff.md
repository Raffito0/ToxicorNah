# Section 06 Diff — X Pipeline E2E

## File Created
`ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/04-x-pipeline.test.js`

## Summary
10 tests in 4 describes (1 fixture pre-check + 3 chain tests) — 50 total passing after this section.

## Key deviations from spec
1. `filterRelevant` is synchronous — no fetchFn needed
2. `draftReply` is a sync prompt builder returning `{ prompt, maxTokens }` — NOT an AI caller
3. `buildReplyPrompt(archetype, tweet, filingContext, helpers)` is the actual AI caller
4. `postToX(text)` is a sync payload builder — no HTTP calls; tested as payload structure
5. `selectArchetype(null, () => 0)` deterministically returns `'data_bomb'` for test stability
6. Added fixture pre-check describe block to catch VALID_REPLY length regressions early
