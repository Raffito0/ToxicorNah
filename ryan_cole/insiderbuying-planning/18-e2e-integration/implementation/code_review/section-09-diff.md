# Section 09 Diff — Outreach Pipeline E2E

## File Created
`ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/07-outreach-pipeline.test.js`

## Summary
7 tests in 1 describe — 89 total passing after this section.

## Key deviations from spec

1. **`_aiClient.call(messages)` not fetchFn**: AI calls in `generateEmail` and `sendFollowUp` use `_aiClient.call(messages)`, not a fetch-based mock. Tests use `{ _aiClient: { call: jest.fn() } }` injection.

2. **`_resendEmailPost` uses `postFn(url, {method,headers,body})` not standard fetch**: `sendFollowUp` and `sendInitialOutreach` use `_resendEmailPost(payload, postFn)` where postFn signature is `(url, opts) -> {status, json(), text()}`. Tests use `jest.fn().mockResolvedValue({status:200, json:..., text:...})` directly, not `makeFetch`.

3. **`checkBounceRateAlert`/`getWarmupLimit` read `process.env` directly**: Both functions read env vars without injection. Tests use `beforeEach`/`afterEach` save/restore pattern with module-level `ORIG_*` constants.

4. **No batch send loop exported**: `runSendLoop` from spec doesn't exist. Test 7.5 orchestrates the warm-up limit test manually: `getWarmupLimit()` → `selectProspects(prospects, limit)` → loop `sendInitialOutreach()`.

5. **`cancelFollowUps` takes `prospectId`, not `prospect` object**: The replied-prospect test calls `cancelFollowUps(prospect.id, nocodbApi)` directly, not via a scheduler. The `replied` field on the prospect object is documented as caller-responsibility (production relies on NocoDB query filter `replied,eq,false`).

6. **FU2 `buildFu2Payload` has no `headers` property**: Verified that FU2 (stage 2) uses `buildFu2Payload` which omits `In-Reply-To`/`References`. Test 7.2 asserts `JSON.parse(sentOpts.body).headers` is `undefined`.
