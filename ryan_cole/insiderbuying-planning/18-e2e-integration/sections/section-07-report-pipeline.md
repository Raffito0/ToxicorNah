# Section 07: Report Pipeline E2E

## Overview

Create `tests/insiderbuying/e2e/05-report-pipeline.test.js` with 3 tests covering Chain 5 (the report pipeline).

**Chain 5**: 9x `buildReportPrompt` → `buildReportHTML` → `buildReportRecord`

**What this test proves**: Reports are built by calling `buildReportPrompt` nine times, each call receiving the accumulated output of all prior calls in a growing context object. The tests verify that this sequential data-threading is wired correctly, that the bear case section retries when authenticity is too low, and that the final assembled record has the correct shape and status.

---

## Dependencies

- **section-01-helpers-fixtures** must be complete: `helpers.js`, `setup.js`, and all fixtures must exist.
- **section-02-jest-config** must be complete: the Jest `e2e` project must be configured so this file is picked up by `npx jest --selectProjects e2e`.

---

## Tests

### Test 5.1 — Sequential context accumulation

**What it verifies**: Each `buildReportPrompt` call receives a context object that contains the output of every prior call. By the time section 9 is generated, its context must contain the named outputs of sections 1–8.

**Setup**: Prepare a `makeRouter` that matches the Anthropic URL and returns a short mock text body (e.g. `{ content: [{ text: 'mock section text' }] }`) for every call. This removes Claude API dependency while keeping the full orchestration logic running.

**Test body** (prose, not full code):
- Call `buildReportPrompt(filing, context)` 9 times in a loop, each time:
  - passing the current accumulated `context` object into the call
  - capturing the returned section text
  - merging the returned section text into `context` under the section's key name (e.g. `context.section_1`, `context.section_2`, etc.)

**Assertions**:
- The context argument passed into the first call has no section keys (it is the initial empty object)
- The context argument passed into the third call contains keys `section_1` and `section_2`
- The context argument passed into the ninth call contains all eight prior section keys

**Why this test is important**: If the orchestrator ever stops threading context (e.g. passes a stale snapshot instead of the live accumulator), sections 3–9 would all receive the same empty context. This test catches that silently broken wiring.

**Stub signature**:

```js
test('sequential context accumulation: each section receives all prior sections', async () => {
  // arrange
  const fetchFn = makeRouter({ 'anthropic.com': MOCK_SECTION_RESPONSE })
  const filing = { ticker: 'NVDA', insider_name: 'Jensen Huang', total_value: 5000000, significance_score: 9 }
  const context = {}

  // act: call buildReportPrompt 9 times, accumulating context
  for (let i = 1; i <= 9; i++) {
    // capture context snapshot BEFORE the call for assertion
    // call buildReportPrompt(filing, context, { fetchFn, env: BASE_ENV, _sleep: noSleep })
    // merge result into context
  }

  // assert
  // section 1: context before call was empty
  // section 3: context before call had section_1, section_2
  // section 9: context before call had section_1 through section_8
})
```

---

### Test 5.2 — Bear case authenticity retry

**What it verifies**: The bear case section has a quality gate on `authenticity`. If the first Claude response returns `authenticity: 4` (below threshold), the module must call Claude a second time and the second call's prompt must contain a rewrite instruction.

**Setup**: Use `makeFetchSeq` with two responses:
- First response body: Claude response where the content includes `"authenticity": 4`
- Second response body: Claude response where the content includes `"authenticity": 8`

**Assertions**:
- The bear case `fetchFn` is called exactly twice (`expectFetchCalledTimes(fetchFn, 2)`)
- The body of the second fetch call (accessible via `fetchFn.mock.calls[1][1].body`) contains a rewrite instruction string (e.g. `"rewrite"`, `"authenticity"`, or `"too low"` — check the actual production prompt to find the exact keyword)

**Stub signature**:

```js
test('bear case authenticity below threshold triggers single retry with rewrite prompt', async () => {
  const fetchFn = makeFetchSeq(
    { content: [{ text: JSON.stringify({ text: 'bear case text', authenticity: 4 }) }] },
    { content: [{ text: JSON.stringify({ text: 'improved bear case', authenticity: 8 }) }] }
  )

  // call the bear case build function or the full buildReportPrompt for section 8 (bear case)
  // await buildReportPrompt(filing, context, { fetchFn, env: BASE_ENV, _sleep: noSleep })

  expectFetchCalledTimes(fetchFn, 2)
  const secondCallBody = JSON.parse(fetchFn.mock.calls[1][1].body)
  // assert secondCallBody prompt/messages contains the rewrite instruction keyword
})
```

**Note**: Identify which section index (1–9) corresponds to "bear case" by reading the production `buildReportPrompt` module. Pass that section index (or section name) so the retry logic fires. The `makeFetchSeq` guard will surface any unexpected third call automatically.

---

### Test 5.3 — Report record status after assembly

**What it verifies**: After all 9 sections are assembled, `buildReportRecord` produces an object with the correct shape and `status: 'published'`.

**Setup**: Construct a `mockReportData` object that represents the assembled report — a plain object containing all 9 section texts plus metadata fields (`ticker`, `headline`, etc.). No fetch mock is needed if `buildReportRecord` is a pure transformation function. If it persists to NocoDB, provide a `makeRouter` for the NocoDB URL.

**Assertions**:
- `result.status === 'published'`
- `result.headline` is a non-empty string
- `result.body_html` is a non-empty string
- `result.ticker` is a non-empty string
- `result.published_at` is a non-empty string (ISO date)

**Stub signature**:

```js
test('buildReportRecord returns published status with all required fields', async () => {
  const mockReportData = {
    ticker: 'NVDA',
    headline: 'Jensen Huang Buys $5M in NVDA',
    sections: { section_1: 'text...', /* ... section_2 through section_9 */ },
    significance_score: 9,
  }

  const result = await buildReportRecord(mockReportData, { fetchFn: makeRouter({ 'nocodb': MOCK_AIRTABLE_RECORD }), env: BASE_ENV })

  expect(result.status).toBe('published')
  expect(result.headline).toBeTruthy()
  expect(result.body_html).toBeTruthy()
  expect(result.ticker).toBeTruthy()
  expect(result.published_at).toBeTruthy()
})
```

---

## File to Create

**Path**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/05-report-pipeline.test.js`

**Top-of-file imports** (adjust paths to match actual module locations):

```js
const { makeFetch, makeRouter, makeFetchSeq, expectFetchCalledTimes, BASE_ENV, noSleep, MOCK_AIRTABLE_RECORD } = require('../helpers')
const { buildReportPrompt } = require('../../../../src/insiderbuying/report/buildReportPrompt')
const { buildReportRecord } = require('../../../../src/insiderbuying/report/buildReportRecord')
```

Adjust the `require` paths to match where the production modules actually live. Check existing unit test files for the correct relative paths.

---

## Mock Response Shape Needed

For Test 5.1, define a `MOCK_SECTION_RESPONSE` constant at the top of the test file (or import from helpers if added there):

```js
const MOCK_SECTION_RESPONSE = {
  id: 'msg_test',
  model: 'claude-haiku-20240307',
  usage: { input_tokens: 100, output_tokens: 50 },
  content: [{ type: 'text', text: 'Mock section content for testing.' }]
}
```

For Test 5.2, the two `makeFetchSeq` responses should wrap the bear case content in the same full Anthropic response shape (with `id`, `model`, `usage`, `content[0].text`).

---

## Checklist

- [x] `05-report-pipeline.test.js` created at the correct path
- [x] All tests pass: `npx jest --selectProjects e2e 05-report-pipeline` — 69/69 total
- [x] Test 5.1 verifies context keys for calls 1, 2, and 3 (first empty, then accumulating)
- [x] Test 5.2 uses `makeFetchSeq` and asserts exactly 3 calls (section + review + retry)
- [x] Test 5.3 asserts all required fields on the returned record
- [x] No `.skip` or `.todo` markers
- [x] All tests complete under 8s
- [x] No calls to `global.fetch`

## Actual Implementation Notes

**File created**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/05-report-pipeline.test.js`

**Tests**: 14 tests in 5 describes (1 fixture pre-check + 4 chain test groups) — 69 total passing

**Key deviations from spec**:

1. **`buildReportPrompt` is not the section generator**: Spec described calling `buildReportPrompt` 9 times in a loop. Production reality: `buildReportPrompt(data, reportType)` is a legacy single-call prompt builder. The actual section generator is `generateReportSection(sectionId, wordTarget, completedSections, data, fetchFn)`. Tests use the real production function.

2. **Context is `completedSections` array, not object**: Spec described a `context` object where keys like `section_1`, `section_2` accumulate. Production uses `completedSections: Array<{id, wordTarget, text}>` which is serialized to `<prior_sections>` XML by `buildPriorSectionsXml()`. Test 5.1 verifies the XML is present in call bodies.

3. **`buildReportRecord` returns `status: 'delivered'`**: Spec asserts `status: 'published'`. Actual production returns `'delivered'`. Test adapts to match actual behavior.

4. **Word-count gate requires section-specific mock text**: Each `generateReportSection` call checks if the response falls in `[0.8*wordTarget, 1.2*wordTarget]`. Used TEXT_400/TEXT_500/TEXT_700 fixtures sized to pass each section's specific gate without triggering retries.

5. **Bear case retry tested as 3-call sequence** (section + review + retry), not the simpler 2-call pattern the spec showed. The `reviewBearCaseAuthenticity` function is a separate Claude call.

6. **Added `generateReport` full orchestration test (H1 from code review)**: 11-call `makeFetchSeq` covering all 9 sections + 1 bear_case review + 1 exec_summary. Verifies integration of all functions inside the orchestrator.

7. **Code review additions**: bear_case system prompt assertion (H3), parse-failure fallback test (H2), word-count retry test (M5).
