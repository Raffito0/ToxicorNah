# Section 03: Alert Pipeline E2E

## Overview

Create `tests/insiderbuying/e2e/01-alert-pipeline.test.js` — the integration test file for Chain 1, the alert pipeline.

**Chain under test**: `sec-monitor` → `score-alert` → `analyze-alert` → `deliver-alert` → `write-persistence` → `x-auto-post`

**What these tests prove**: A CEO purchase of $5M flows from EDGAR ingestion through scoring, analysis writing, email delivery, and triggers an X post — all using mocked external I/O, proving data shape compatibility between every stage of the pipeline.

---

## Dependencies

- **section-01-helpers-fixtures** must be completed first: `helpers.js`, `setup.js`, and all 4 fixture JSON files must exist before writing this file.
- **section-02-jest-config** must be completed first: the Jest `e2e` project config must be in place so the test runner picks up this file.

---

## File to Create

**Path**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/01-alert-pipeline.test.js`

---

## Background: Dependency Injection Pattern

Every async module in this codebase accepts an `opts` object:

```javascript
async function enrichFiling(filing, opts)
// opts = { fetchFn, env, _sleep }
// fetchFn: injectable fetch — this is the only HTTP boundary
// env: environment variables (avoids process.env coupling)
// _sleep: injectable timer (avoids real delays in tests)
```

HTTP mocking requires no external libraries. Pass a `jest.fn()` as `fetchFn` — the module calls it instead of real HTTP. `setup.js` overwrites `global.fetch` with a function that throws immediately, so any module that bypasses `opts.fetchFn` will fail fast with a clear error.

---

## Imports

The test file imports the following production modules. Exact import paths must be verified against the actual file layout in `ryan_cole/insiderbuying-site/`:

- `parseEdgarResponse`, `buildEdgarUrl` from the sec-monitor module
- `enrichFiling` from the enrichment module
- `runScoreAlert` from the score-alert module
- `isBuyTransaction` from the filtering/guard module
- `analyze` from the analyze-alert module
- `deliverAlert` from the deliver-alert module
- `generateAlertTweet` from the x-auto-post module

It also imports from the shared test helpers:

```javascript
const { makeRouter, makeFetch, noSleep, BASE_ENV,
        MOCK_EDGAR_RSS, MOCK_SCORE_RESPONSE, MOCK_ANALYSIS_RESPONSE,
        MOCK_RESEND_OK, MOCK_ONESIGNAL_OK, MOCK_SUPABASE_USERS,
        expectFetchCalledTimes } = require('./helpers');
```

---

## Tests

### Test 1.1 — Happy path: full chain EDGAR → delivery

**Purpose**: Prove that a high-value CEO buy filing flows through every stage and produces a delivered alert with a valid analysis body.

**Setup**: Create a `makeRouter`-based `fetchFn` for each stage, routing by URL substring:

- `enrichFiling` router: `{ 'financialdatasets': MOCK_FINANCIAL_DATA, 'supabase.co': MOCK_SUPABASE_DEDUP }`
- `runScoreAlert` router: `{ 'anthropic': MOCK_SCORE_RESPONSE, 'supabase.co/rest': MOCK_TRACK_RECORD }`
- `analyze` router: `{ 'anthropic': MOCK_ANALYSIS_RESPONSE }`
- `deliverAlert` router: `{ 'resend.com': MOCK_RESEND_OK, 'onesignal': MOCK_ONESIGNAL_OK, 'supabase.co': MOCK_SUPABASE_USERS }`

**Execution** (sequential, each stage receives prior stage's output):

```
1. buildEdgarUrl(lastCheckDate, today)
   + parseEdgarResponse(MOCK_EDGAR_RSS_BODY)
   → rawFiling

2. enrichFiling(rawFiling, { fetchFn: enrichFetchFn, env: BASE_ENV, _sleep: noSleep })
   → enrichedFiling

3. runScoreAlert([enrichedFiling], { fetchFn: scoreFetchFn, env: BASE_ENV, _sleep: noSleep })
   → scoredFiling

4. analyze(scoredFiling, { fetchFn: analyzeFetchFn, env: BASE_ENV, _sleep: noSleep })
   → analysisResult

5. deliverAlert(analysisResult, { fetchFn: deliverFetchFn, env: BASE_ENV })
   → deliveryResult
```

**Assertions**:
- `scoredFiling.significance_score >= 8`
- `analysisResult.text` matches `/bought|purchased/i`
- `analysisResult.text` matches `/last time|previous|track record/i`
- `analysisResult.text` matches `/earnings|watch|catalyst/i`
- `analysisResult.text.split(/\s+/).length > 150`
- `enrichFetchFn` called at least 1 time (Financial Datasets API was invoked)
- `deliverFetchFn` called at least 2 times (Resend + OneSignal, i.e. `expectFetchCalledTimes(deliverFetchFn, 2)` or `>= 2`)

---

### Test 1.2 — Gift transaction excluded

**Purpose**: Verify the pipeline guard filters gift filings before they reach `enrichFiling`, preventing wasted API calls on non-buy transactions.

**Setup**: No `fetchFn` setup needed — the guard fires before any HTTP call.

**Execution**:

```
1. call isBuyTransaction('G')
   → assert false

2. simulate guard behavior: only pass filings where isBuyTransaction returns true
   to enrichFiling. A gift filing (transaction_code: 'G') must not reach enrichFiling.
   → assert enrichFiling fetchFn call count = 0
```

**Assertions**:
- `isBuyTransaction('G')` returns `false`
- `enrichFiling` fetchFn call count is 0 when the input is a gift filing

---

### Test 1.3 — 10b5-1 hard cap

**Purpose**: Verify that a pre-planned trading program (10b5-1) filing cannot receive a score above 5, regardless of what the Anthropic API returns.

**Setup**: Configure the Anthropic `fetchFn` to return `MOCK_SCORE_RESPONSE` (which contains a high score). Construct the input filing with:
- `is_10b5_plan: true`
- `total_value: 10000000`
- `insider_category: 'CEO'`

**Execution**:

```
1. runScoreAlert([enrichedFiling], { fetchFn: scoreFetchFn, env: BASE_ENV, _sleep: noSleep })
   → scoredFiling
```

**Assertions**:
- `scoredFiling.significance_score <= 5`

---

### Test 1.4 — High-score triggers X auto-post

**Purpose**: Verify that a high-significance scored filing produces a valid X post string with a cashtag, bridging Chain 1 to the X auto-post module.

**Setup**: Have a scored filing object in scope (either from Test 1.1 or constructed inline) with `significance_score: 9`.

**Execution**:

```
1. generateAlertTweet(scoredFiling)
   → tweetText
```

**Assertions**:
- `tweetText` matches `/\$[A-Z]+/` (contains a cashtag like `$AAPL`)

---

## Key Data Shapes

The fixtures produced by `helpers.js` and the JSON fixture files must supply the following fields that the chain stages read. Verify these are present in your fixtures before running the tests.

**`MOCK_EDGAR_RSS` / `edgar-rss-response.json`** must include:
- `ticker`, `company_name`, `insider_name`, `insider_title`
- `transaction_type` (use `'P'` for a purchase)
- `shares`, `price_per_share`, `total_value` (set to `5000000` for the happy path)
- `filing_date`, `cik`

**`MOCK_SCORE_RESPONSE` / `claude-score-response.json`** must include:
- `id` (string), `model` (string)
- `usage.input_tokens` (int), `usage.output_tokens` (int)
- `content[0].text` containing JSON with `score` (number ≥ 8) and `reasoning` (string)

**`MOCK_ANALYSIS_RESPONSE` / `claude-analysis-response.json`** must include:
- Full Anthropic response shape (same `id`, `model`, `usage` fields)
- `content[0].text` with at least 2 paragraphs (150+ words), containing the words "bought/purchased", "last time/previous/track record", and "earnings/watch/catalyst"

---

## Stub Signatures

These are the function signatures the test file calls. Do not implement them here — they are production code. The stubs below show what the test expects to be importable:

```javascript
// sec-monitor
buildEdgarUrl(lastCheckDate: Date, today: Date): string
parseEdgarResponse(body: object): FilingObject

// enrichment
enrichFiling(filing: FilingObject, opts: { fetchFn, env, _sleep }): Promise<EnrichedFiling>

// score-alert
runScoreAlert(filings: EnrichedFiling[], opts: { fetchFn, env, _sleep }): Promise<ScoredFiling>
isBuyTransaction(transactionCode: string): boolean

// analyze-alert
analyze(filing: ScoredFiling, opts: { fetchFn, env, _sleep }): Promise<AnalysisResult>

// deliver-alert
deliverAlert(analysis: AnalysisResult, opts: { fetchFn, env }): Promise<DeliveryResult>

// x-auto-post
generateAlertTweet(filing: ScoredFiling): string
```

---

## Test File Skeleton

```javascript
// tests/insiderbuying/e2e/01-alert-pipeline.test.js
const { makeRouter, noSleep, BASE_ENV, expectFetchCalledTimes,
        MOCK_SCORE_RESPONSE, MOCK_ANALYSIS_RESPONSE,
        MOCK_RESEND_OK, MOCK_ONESIGNAL_OK, MOCK_SUPABASE_USERS } = require('./helpers');

const EDGAR_RSS_FIXTURE = require('./fixtures/edgar-rss-response.json');

// Import production modules (resolve paths relative to project root)
const { buildEdgarUrl, parseEdgarResponse } = require('../../sec-monitor'); // adjust path
const { enrichFiling } = require('../../enrich-filing');                     // adjust path
const { runScoreAlert, isBuyTransaction } = require('../../score-alert');    // adjust path
const { analyze } = require('../../analyze-alert');                          // adjust path
const { deliverAlert } = require('../../deliver-alert');                     // adjust path
const { generateAlertTweet } = require('../../x-auto-post');                 // adjust path

describe('Alert Pipeline E2E (Chain 1)', () => {

  describe('Test 1.1 - Happy path: EDGAR → delivery', () => {
    it('flows a CEO $5M buy through scoring, analysis, and delivery', async () => {
      // ... makeRouter setup per stage
      // ... sequential chain calls
      // ... assertions on score, analysis text patterns, fetchFn call counts
    });
  });

  describe('Test 1.2 - Gift transaction excluded', () => {
    it('isBuyTransaction returns false for gift code G', () => {
      // ...
    });

    it('gift filing never reaches enrichFiling', async () => {
      // ...
    });
  });

  describe('Test 1.3 - 10b5-1 hard cap', () => {
    it('10b5-1 filing is capped at significance_score <= 5', async () => {
      // ...
    });
  });

  describe('Test 1.4 - High-score triggers X auto-post', () => {
    it('generateAlertTweet returns a string with a cashtag', () => {
      // ...
    });
  });

});
```

---

## Definition of Done

- [x] File `tests/insiderbuying/e2e/01-alert-pipeline.test.js` created
- [x] 5 tests pass under `npx jest --selectProjects e2e` (1.2 split into two `it` blocks + extra gift-runScoreAlert sub-test added)
- [x] No `.skip` or `.todo` markers
- [x] No real network calls (global fetch trap in `setup.js` guarantees this)
- [x] Each test completes in < 8s
- [x] All `fetchFn` mocks use the full `{ ok, status, json(), text(), headers }` Response shape (supplied by `makeRouter` / `makeFetch` from helpers)
- [x] `expectFetchCalledTimes` used to assert delivery call counts and 10b5 DeepSeek bypass

## Actual Implementation Notes

**File created**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/01-alert-pipeline.test.js`

**Tests**: 6 tests in 4 describes (31 total suite tests including helpers.test.js = 31 passing)

**Key deviations from spec**:

1. **`enrichFiling` signature**: Spec assumed `enrichFiling(filing, opts)` but actual production signature is `enrichFiling(ticker, filingDate, opts)`. Test calls it as `enrichFiling(EDGAR_FIXTURE.ticker, EDGAR_FIXTURE.filing_date, opts)`.

2. **`generateAlertTweet` → `buildBreakingAlert`**: The x-auto-post module exports `buildBreakingAlert(data, helpers)`, not `generateAlertTweet`. Test uses `buildBreakingAlert` with the correct `{ fetchFn, deepseekApiKey }` helpers signature (DeepSeek generates the tweet text).

3. **`analyze()` return type**: Returns a plain string (not `{ text: string }`). Assertions use `analysisText` directly, not `analysisText.text`.

4. **`noSleep` factory**: Spec used `noSleep` singleton import but implementation uses `makeNoSleep()` factory per test instance.

5. **`DEEPSEEK_REFINEMENT` mock**: score-alert.js calls DeepSeek for refinement (not Anthropic), so the router key is `'deepseek.com'`.

6. **NocoDB mock required for `runScoreAlert`**: `runScoreAlert` calls `computeTrackRecord` which uses `nocodb.list`. A `makeMockNocodb()` helper is defined inline.

7. **10b5 path skips DeepSeek entirely**: `expectFetchCalledTimes(scoreFetchFn, 0, '10b5-no-ai')` confirmed that the 10b5 cap is applied during base scoring, before the DeepSeek refinement call.

8. **Extra sub-test added**: Test 1.2 has a third `it` block — `'gift filing is filtered out by runScoreAlert'` — verifying `runScoreAlert` returns an empty array for `transactionCode: 'G'`.

9. **`deliveryResult.status` assertion**: `expect(deliveryResult.status).toBe('delivered')` confirmed deliver-alert.js returns a status field.
