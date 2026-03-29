# Code Review — Sections 01 & 02: Helpers, Fixtures, Jest Config

**Reviewer**: Senior Code Reviewer
**Date**: 2026-03-30
**Files reviewed**:
- `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/setup.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/helpers.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/helpers.test.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/fixtures/` (4 files)
- `ryan_cole/insiderbuying-site/package.json`

**Test result**: 25/25 passing via `npx jest --selectProjects e2e tests/insiderbuying/e2e/helpers.test.js`

---

## Summary

The implementation is correct and solid. The foundational infrastructure is well-designed. All planned functionality has been delivered and all 25 tests pass. There are three issues worth addressing before later sections build on this foundation: one MEDIUM (a key name mismatch between BASE_ENV and what production code reads), one LOW (a `noSleep` shared-state leak across tests), and two SUGGESTIONS (missing keys in BASE_ENV and a spec wording correction). No HIGH issues were found.

---

## What Was Done Well

**Jest projects split is correct.** The unit project excludes `/tests/insiderbuying/e2e/` via `testPathIgnorePatterns`, and the e2e project has a specific `testMatch` targeting only that folder. There is no double-run risk and no leakage of the e2e globals into unit tests.

**`setupFilesAfterEnv` vs `setupFilesAfterFramework`.** The spec erroneously named the key `setupFilesAfterFramework`. The implementation correctly uses `setupFilesAfterEnv`, which is the valid Jest v30 key. This is a justified and correct deviation from the spec. The comment in the spec's own reasoning block (`note: this is the correct key for the Jest v30 API`) acknowledges the discrepancy, and the implementation chose the correct behavior over the incorrect spec wording.

**`clearMocks: true` vs `resetMocks`.** The spec and the implementation both use `clearMocks`, with a precise explanation of why `resetMocks` would break `beforeEach`-configured `mockResolvedValue` setups. This is correct.

**`maxWorkers: 1` rationale is sound.** The cross-chain tests (section 10) rely on capturing in-memory mock state from one chain and replaying it into another. Parallel workers would run each test file in an isolated VM context, silently breaking that pattern. Forcing sequential execution via `maxWorkers: 1` is the right call.

**`makeFetchSeq` error-first then once pattern.** The implementation sets the fallback rejection first via `mockImplementation`, then overlays the expected responses via `mockResolvedValueOnce`. This is the correct order: Jest processes `mockResolvedValueOnce` calls before falling back to `mockImplementation`. The extra-call detection is therefore reliable.

**`makeRouter` throws on no match.** Failing loudly with the URL and list of known routes is far better than returning `undefined`, which would cause confusing `Cannot read properties of undefined` errors two frames later in the test.

**Fixture word count test.** Counting actual words in the analysis fixture text rather than checking a static `output_tokens` value is correct — the word count is what downstream modules actually care about.

---

## Issues

### MEDIUM — `NOCODB_API_KEY` in BASE_ENV does not match the key name used in production code

**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/helpers.js`, line 110

**Problem**: `BASE_ENV` exports `NOCODB_API_KEY: 'test-nocodb-key-000'`. Every production module that reads NocoDB credentials reads `env.NOCODB_API_TOKEN`, not `env.NOCODB_API_KEY`. Verified in:

- `score-alert.js` line 597: `if (!env.NOCODB_BASE_URL || !env.NOCODB_API_TOKEN)`
- `score-alert.js` line 604: `env.NOCODB_API_TOKEN`
- `nocodb-client.js` line 7: `env.NOCODB_API_TOKEN`
- `generate-article.js` line 1132: `token: env.NOCODB_API_TOKEN`
- `generate-image.js` line 312: `token: env.NOCODB_API_TOKEN`
- `finnhub-client.js` line 95: `headers: { 'xc-token': env.NOCODB_API_TOKEN }`
- `cross-link.js` line 237: `const token = env.NOCODB_API_TOKEN`
- `identity-assets.js` lines 45, 181: `helpers.env.NOCODB_API_TOKEN`

When a later section test spreads `BASE_ENV` into its `opts.env` and calls any production function that reads `env.NOCODB_API_TOKEN`, the value will be `undefined`. Depending on whether the module guards for that case, this will either silently skip the NocoDB call or throw a TypeError. The alert pipeline (section 03) exercises `score-alert.js` which explicitly checks `env.NOCODB_API_TOKEN` and bails out early — meaning the track record enrichment step will be skipped in every test that uses `BASE_ENV` directly, undermining those tests.

**Fix**: Rename the key in `BASE_ENV` from `NOCODB_API_KEY` to `NOCODB_API_TOKEN`. The spec's required-keys list in section 01 spells it as `NOCODB_API_KEY`, which is itself incorrect. The spec should also be updated to match production. The `helpers.test.js` BASE_ENV coverage test at line 143 checks for `'NOCODB_API_KEY'` — that line must also be updated to `'NOCODB_API_TOKEN'`.

---

### MEDIUM — `ONESIGNAL_API_KEY` in BASE_ENV does not match the key name used in production code

**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/helpers.js`, line 105

**Problem**: `BASE_ENV` exports `ONESIGNAL_API_KEY: 'test-onesignal-key-000'`. The only production module that reads the OneSignal REST key is `deliver-alert.js` line 199:

```
Authorization: `Basic ${env.ONESIGNAL_REST_API_KEY}`
```

The key name in production is `ONESIGNAL_REST_API_KEY`. A test spreading `BASE_ENV` and calling `deliverAlert` will produce `Authorization: Basic undefined` in the OneSignal request, which the mock will not catch but the assertion on the authorization header would fail in any future test that inspects request bodies.

**Fix**: Rename `ONESIGNAL_API_KEY` to `ONESIGNAL_REST_API_KEY` in `BASE_ENV`. Update the coverage test in `helpers.test.js` line 141 accordingly. If backwards compatibility with the spec wording matters, note the discrepancy in a comment.

---

### LOW — `noSleep` is a module-level singleton jest.fn() — shared call state accumulates across tests

**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/helpers.js`, line 77

**Problem**: `noSleep` is declared at module scope:

```js
const noSleep = jest.fn().mockResolvedValue(undefined);
```

`clearMocks: true` in the Jest config resets mock call counts between tests within the same project. However, `noSleep` is a shared reference exported from a module. Because Node.js caches module exports, every test file that imports `helpers.js` receives the same `noSleep` instance. `clearMocks: true` clears state on mocks that are registered with Jest's mock registry, but module-level `jest.fn()` instances created outside of `jest.mock()` calls are not guaranteed to be in that registry.

In practice this means: if Test A calls `noSleep` three times and Test B asserts `noSleep.mock.calls.length === 2`, Test B may see 5 calls (3 from A + 2 from B) rather than 2, making the count assertion unreliable. The current `helpers.test.js` does not assert on `noSleep`'s call count, so the 25 tests pass today — but a later section test that writes `expectFetchCalledTimes(noSleep, N)` will see accumulated counts.

**Fix**: Export a factory function `makeNoSleep()` that returns a fresh `jest.fn().mockResolvedValue(undefined)` on each call, instead of a single shared instance. Test files create their own instance per test or `beforeEach` block. Alternatively, call `noSleep.mockClear()` in a global `afterEach` in `setup.js`, but this is fragile if a test file imports `noSleep` under a different binding name. The factory approach is more explicit.

---

## Suggestions

### SUGGESTION — BASE_ENV is missing keys used by pipeline chains in sections 05–09

**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/helpers.js`, lines 98–117

Several production modules in the e2e suite require keys that `BASE_ENV` does not include. These will not block sections 01–04 but will cause later section tests to fail with `undefined` values unless each test adds the missing keys via spread:

| Missing key | Production module and location |
|---|---|
| `NOCODB_API_TOKEN` | `score-alert.js:597`, `nocodb-client.js:7`, `generate-article.js:1132`, `finnhub-client.js:95`, `identity-assets.js:45` |
| `FINNHUB_API_KEY` | `finnhub-client.js:60`, `dexter-research.js:740` |
| `NOCODB_PROJECT_ID` | `score-alert.js:589`, `finnhub-client.js:89` |
| `NOCODB_API_URL` | `finnhub-client.js:89`, `identity-assets.js:27` |
| `R2_ACCOUNT_ID` | `generate-article.js:1320`, `generate-image.js:165` |
| `R2_ACCESS_KEY_ID` | `generate-article.js:1321`, `generate-image.js:209` |
| `R2_SECRET_ACCESS_KEY` | `generate-article.js:1322`, `generate-image.js:203` |
| `R2_PUBLIC_URL` | `generate-article.js:1323`, `generate-image.js:237` |
| `BEEHIIV_PUBLICATION_ID` | Present in BASE_ENV, but note the spec lists it as `BEEHIIV_PUBLICATION_ID` and the key in BASE_ENV matches — this one is correct |

Adding placeholder values for at least `NOCODB_API_TOKEN`, `FINNHUB_API_KEY`, and the R2 group to `BASE_ENV` now will reduce per-test boilerplate in sections 05–09 and make the shared baseline more complete. Each later section will still be able to override specific values via spread if needed.

---

### SUGGESTION — The spec's `section-02-jest-config.md` contains a self-contradicting comment about the config key

**File**: `ryan_cole/insiderbuying-planning/18-e2e-integration/sections/section-02-jest-config.md`, line 65

The spec's "Why Each Option Was Chosen" block reads:

> `setupFilesAfterFramework` (note: this is the correct key for the Jest v30 API — some older docs show `setupFilesAfterFramework`)

The note says the same word twice, which makes it nonsensical. The correct key is `setupFilesAfterEnv`. This does not affect the implementation (which already uses the correct key), but the spec document contains misleading text that could confuse the next person reading it. Update the spec comment to: "The correct Jest v30 key is `setupFilesAfterEnv`. Some older documentation and earlier spec drafts used the incorrect name `setupFilesAfterFramework`."

---

## Fixture Correctness

All four fixture files match their spec exactly. Specific verifications:

**`edgar-rss-response.json`**: Contains all 10 required fields checked in the test. Also contains `insider_category`, `is_10b5_plan`, and `form_type` which the spec requires for downstream module compatibility but which the test does not assert. These extra fields are beneficial and correct.

**`claude-score-response.json`**: `score: 9` in the embedded JSON text clears the `>= 8` significance threshold that the alert pipeline tests depend on. The `model: "claude-haiku-20240307"` matches the Haiku scoring model referenced in the codebase.

**`claude-analysis-response.json`**: The text in the implementation file (171 words) is longer than the text shown in the spec (139 words). Both clear the 150-word minimum test. The implementation file passes the word count test.

**`claude-article-outline.json`**: `content[0].type === 'tool_use'` and `content[0].input` is a non-null object. Both conditions pass.

---

## Jest Config Verification

**Unit project `testPathIgnorePatterns`**: The pattern `/tests/insiderbuying/e2e/` uses a forward-slash prefix which Jest interprets as a regex. On Windows paths with backslashes this could theoretically fail to match. In practice Jest normalizes path separators before applying these patterns, so this works correctly on Windows. No change needed.

**`runner: "jest-runner"`**: Explicit default runner declaration. This is harmless and provides forward compatibility insurance if the root config is ever extended with a different runner.

**e2e project does not set `testTimeout`**: The `jest.setTimeout(8000)` in `setup.js` sets the timeout imperatively after the framework loads, which is equivalent to setting `testTimeout: 8000` in the config. Both approaches work. The imperative approach in `setup.js` is slightly more visible because it lives alongside the other global configuration (fetch trap, fake timers).

**`clearMocks` scope**: `clearMocks: true` is set at the project level (inside the e2e project object in the `projects` array), not at the root level. This means unit tests are not affected by e2e's `clearMocks` preference. This is the correct scoping.

---

## Plan Alignment

Section 01 spec called for 13+ test cases. The implementation delivers 25 tests across 7 describe groups. All test groups required by the spec are present. The additional tests (extra `makeFetch` shape checks, second `noSleep` test, second `BASE_ENV` test, second fake-timers test) are additive and do not conflict with any spec requirement.

Section 02 spec called for a single `package.json` modification. The implementation makes exactly that change and nothing else. The spec key name error (`setupFilesAfterFramework`) was correctly overridden in the implementation.

---

## Action Items for Implementing Agent

| Priority | File | Action |
|---|---|---|
| MEDIUM | `helpers.js` line 110 | Rename `NOCODB_API_KEY` to `NOCODB_API_TOKEN` |
| MEDIUM | `helpers.test.js` line 143 | Update required-key list: `'NOCODB_API_KEY'` → `'NOCODB_API_TOKEN'` |
| MEDIUM | `helpers.js` line 105 | Rename `ONESIGNAL_API_KEY` to `ONESIGNAL_REST_API_KEY` |
| MEDIUM | `helpers.test.js` line 141 | Update required-key list: `'ONESIGNAL_API_KEY'` → `'ONESIGNAL_REST_API_KEY'` |
| LOW | `helpers.js` line 77 | Replace `noSleep` singleton with `makeNoSleep()` factory function; update `noSleep` tests in `helpers.test.js` accordingly |
| SUGGESTION | `helpers.js` lines 98–117 | Add `NOCODB_API_TOKEN`, `FINNHUB_API_KEY`, `NOCODB_PROJECT_ID`, `NOCODB_API_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` placeholder values to `BASE_ENV` |
| SUGGESTION | `section-02-jest-config.md` line 65 | Fix self-referencing comment about `setupFilesAfterEnv` vs `setupFilesAfterFramework` |
