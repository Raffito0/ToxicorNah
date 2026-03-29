# Code Review — Section 04: Article Pipeline E2E
**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/02-article-pipeline.test.js`
**Reviewer**: Claude (Senior Code Reviewer)
**Date**: 2026-03-30

---

## Summary

The implementation covers a subset of what the spec requires. Tests 2.2 and 2.3 are reasonable as standalone unit/integration tests but both deviate significantly from their spec descriptions. Test 2.1 is the most consequential case and has a structural flaw that causes the most critical acceptance criterion to silently pass without actually being tested. Several assertions are either vacuously true, check the wrong thing, or verify a mock artifact rather than production behavior.

Overall quality: **passes mechanically (36 tests pass) but fails the spec intent on 3 of 3 tests**.

---

## CRITICAL

### C1 — Test 2.1 does not test the core chain integration the spec requires

**File**: `02-article-pipeline.test.js`, lines 73-139

The spec's primary requirement for Test 2.1 is:
> "The outline JSON produced by the first Claude call is present in the prompt body of the second Claude call."

This is the acceptance criterion that proves the two-step chain actually works end-to-end. The implementation **does not have a second Claude call at all**. The test calls `generateArticleOutline` (one Claude call), then calls `writeArticle` directly with a hand-crafted fixture object. There is no draft generation step, no `callClaudeToolUse` for the draft, and no assertion that the outline flows into a second Claude prompt.

The spec also requires:
- `qualityGate(draft, ...)` returns `{ valid: true, errors: [] }` — not tested
- The second Claude call's prompt body contains the outline JSON substring — not tested

The test as written proves three completely independent facts: `pickKeyword` reads from NocoDB, `lockKeyword` issues a PATCH, `generateArticleOutline` parses a Claude text response, and `writeArticle` issues a POST. These are already covered by the unit tests in `generate-article.test.js`. The integration value — that the outline flows into the draft prompt — is absent.

**Impact**: The most important acceptance criterion is untested. The chain could break at the outline→draft handoff and this test would still pass.

**Fix**: Add a second `createClaudeClient` + mock call that simulates the draft step. Assert that `JSON.stringify(secondCallBody)` contains a substring of the outline headline or sections. See spec lines 59-65 for the exact assertions expected.

---

### C2 — Test 2.2 does not implement the retry pattern from the spec

**File**: `02-article-pipeline.test.js`, lines 145-198

The spec requires Test 2.2 to prove:
> "When `qualityGate` returns errors, the retry call to `callClaudeToolUse` includes the specific error string in its prompt."

The key assertion is:
```
const retryBody = JSON.parse(draftFetch.mock.calls[1][1].body);
expect(JSON.stringify(retryBody)).toContain(firstErrorMessage);
```

The implementation makes **zero calls to any Claude function**. There are two `qualityGate` calls against static fixtures and no `callClaudeToolUse` call. The test verifies `result.errors` is an array of strings and that those strings could hypothetically be used in a retry prompt — but it does not actually perform the retry call or assert anything about the prompt body.

The spec acceptance criterion `"draft fetchFn called exactly twice"` is also not met — the implementation does not track any fetch mock at the Claude level.

**Impact**: The retry-prompt-contains-error-message behaviour is entirely untested.

**Fix**: Use `makeFetchSeq` with two responses (failing draft, passing draft), perform two `generateArticleOutline` or equivalent calls, and assert that `mock.calls[1][1].body` contains the error string from the first `qualityGate` failure.

---

## HIGH

### H1 — `makeRouter` key `'Keywords'` in Test 2.1 is fragile for `pickKeyword`

**File**: `02-article-pipeline.test.js`, line 77

```javascript
const pickFetchFn = makeRouter({ 'Keywords': { list: [MOCK_KEYWORD] } });
```

The `pickKeyword` function calls `nocodbGet` which builds URL:
```
${baseUrl}/Keywords?where=(status,eq,new)~or(...)&sort=-priority_score&limit=1
```

With `baseUrl = 'https://test-nocodb.example.com'`, the full URL is:
```
https://test-nocodb.example.com/Keywords?where=...
```

`makeRouter` checks `String(url).includes('Keywords')` — this matches. However the route value returned is `{ list: [MOCK_KEYWORD] }` which is the full NocoDB list response body. The production code reads `result.list[0]`. This is correct.

The fragility is that `'Keywords'` as a substring would also match any URL containing the word "Keywords" in a different context (e.g., a hypothetical audit endpoint at `/audit/Keywords/stats`). More defensively the key should be `'/Keywords'` (with leading slash) to reduce collision risk. This is a minor issue in the current codebase but worth noting for consistency.

**Severity**: LOW in isolation, but applying to all e2e tests as a pattern creates maintenance debt.

---

### H2 — Test 2.1 `writeArticle` assertion does not verify `title_text` field name

**File**: `02-article-pipeline.test.js`, lines 134-138

The test asserts:
```javascript
expect(writeBody.slug).toBe(articleToWrite.slug);
expect(writeBody.verdict_type).toBe('BUY');
```

The production `writeArticle` function at line 990 maps `article.title` to `title_text` in the POST body:
```javascript
title_text: article.title,
```

If this mapping were accidentally changed (e.g., to `title:` or `headline:`), the test would not catch it. The test verifies `slug` and `verdict_type` but misses the `title_text` field name mapping which is a non-obvious production detail. The spec does not list this explicitly, but it is a meaningful behavioral contract.

**Fix**: Add `expect(writeBody.title_text).toBe(articleToWrite.title)` to the write assertions.

---

### H3 — Test 2.3 uses the wrong production function

**File**: `02-article-pipeline.test.js`, lines 204-229

The spec says Test 2.3 should test `determineArticleParams` returning a non-`insider_buying` article type when a recent article exists. In the production module, `determineArticleParams(blog)` (line 131) is a **pure function** with no NocoDB call — it returns `{ targetLength, authorName, maxTokens }` with random weighted selection. It has no awareness of content freshness.

The test correctly uses `checkContentFreshness` instead, which is the production function that actually performs the freshness check. However the test therefore proves something different from what the spec describes. The spec's `determineArticleParams` call pattern does not exist as described — the spec was written against an incorrect understanding of the production API.

This is a spec deviation rather than a test bug. The test correctly exercises `checkContentFreshness`, which is the right function to test for this behavior. However:

1. The test file imports `determineArticleParams` via line... wait — it does **not** import `determineArticleParams` at all. The test is internally consistent.
2. The acceptance criterion `"returned articleType is not 'insider_buying'"` is met via `freshness.effectiveArticleType`.

The spec deviation should be documented but the test is functionally sound for what it does test.

---

## MEDIUM

### M1 — `OUTLINE_CLAUDE_BODY` uses `content[0].type: 'text'` but `generateArticleOutline` uses `result.content` from `_parseTextResponse`

**File**: `02-article-pipeline.test.js`, lines 58-62

The mock response is:
```javascript
{ content: [{ type: 'text', text: JSON.stringify(OUTLINE_OBJ) }], usage: { ... } }
```

The `generateArticleOutline` function calls `outlineClient.complete(...)` which calls `_parseTextResponse`. That method (ai-client.js line 153) finds `content.find(b => b.type === 'text')` and returns `b.text`. So `result.content` is the raw JSON string `JSON.stringify(OUTLINE_OBJ)`. Then `parseClaudeJSON(raw)` parses it.

This mock shape is correct. However the `usage` field uses `{ input_tokens: 300, output_tokens: 100 }` (snake_case) which matches the Claude provider's `_normalizeUsage` path — also correct.

No bug here, but worth noting that the mock tightly couples to the Claude provider's response format. If `ai-client.js` is updated to a different provider, this mock will silently break without the test failing (since the test only checks `outline.headline` and `outline.sections`, not usage normalization).

---

### M2 — Test 2.2 second test fixture has `title: 'X'.repeat(50)` (50 chars, below 55) but the word "title" in the error message is capitalized

**File**: `02-article-pipeline.test.js`, lines 182-197

The production error at line 261 is:
```
Title length 50 outside 55-65 range
```

The assertion uses `/title/i` (case-insensitive). This is correct and will pass. Not a bug, but the explicit `i` flag should be kept — removing it would cause a false negative since the production message uses `Title` (capital T).

---

### M3 — Test 2.3 `freshness.lastPublished` type assertion is weak

**File**: `02-article-pipeline.test.js`, lines 217

```javascript
expect(typeof freshness.lastPublished).toBe('string');
```

The production code returns `records[0].published_at` for `lastPublished`. The mock sets `published_at: '2026-02-20T10:00:00Z'`. This assertion is correct but does not verify the value is the expected date. A stronger assertion:
```javascript
expect(freshness.lastPublished).toBe('2026-02-20T10:00:00Z');
```

This would catch a regression where `lastPublished` returns a wrong field (e.g., `records[0].created_at`).

---

### M4 — Test 2.3 does not assert `freshnessFetchFn` URL contains `'Articles'`

**File**: `02-article-pipeline.test.js`, lines 206-218

The test verifies `freshnessFetchFn.mock.calls.length === 1` but does not verify the URL contains `'/Articles'`. The `checkContentFreshness` function queries the Articles table. If the path were accidentally changed (e.g., to `/Keywords`), the test would still pass because `makeFetch` resolves unconditionally regardless of URL.

**Fix**:
```javascript
const freshnessUrl = freshnessFetchFn.mock.calls[0][0];
expect(freshnessUrl).toContain('Articles');
expect(freshnessUrl).toContain('NVDA');
```

---

## LOW

### L1 — `MOCK_KEYWORD.article_type = 'A'` is passed to `generateArticleOutline` as `keyword.article_type`

**File**: `02-article-pipeline.test.js`, lines 100-106

The call is:
```javascript
const outline = await generateArticleOutline(
  keyword.ticker,
  keyword.article_type,
  {},
  claudeFetchFn,
  'test-anthropic-key',
);
```

`keyword.article_type` is `'A'` (a string). The production function uses it in the prompt as `'Article type: ' + (articleType || 'A')`. This is fine. But the test passes the anthropic key as a positional string `'test-anthropic-key'` rather than `BASE_ENV.ANTHROPIC_API_KEY`. This is inconsistent with the pattern used everywhere else in the test suite. Not a bug but a consistency issue.

---

### L2 — `makeNocodbOpts` is redefined locally instead of being imported from helpers

**File**: `02-article-pipeline.test.js`, lines 25-31

The test file defines its own `makeNocodbOpts` at the top level:
```javascript
function makeNocodbOpts(fetchFn) {
  return {
    fetchFn,
    baseUrl: BASE_ENV.NOCODB_BASE_URL,
    token: BASE_ENV.NOCODB_API_TOKEN,
  };
}
```

This is not exported from `helpers.js` (confirmed by inspection of helpers.js lines 144-159), so the local definition is the only option. However if other e2e test files need the same helper, this pattern leads to duplication. The helpers.js spec (section-01) should export this utility. This is a planning gap, not a bug in the current file.

---

### L3 — Test 2.1 `lockKeyword` assertion only checks call count and method, not the URL path

**File**: `02-article-pipeline.test.js`, lines 91-97

The `lockKeyword` call builds URL `${baseUrl}/Keywords/42`. The test asserts `method: 'PATCH'` and `body.status === 'in_progress'` but does not assert that the URL contains `'42'` (the keyword ID). If `lockKeyword` were changed to always patch `/Keywords/0` regardless of input, this test would not catch it.

**Fix**: Add `expect(lockCallArgs[0]).toContain('/42')` or `toContain(String(keyword.id))`.

---

## SUGGESTIONS

### S1 — Consider adding a `writeArticle` assertion for `status: 'enriching'`

Production `writeArticle` always sets `status: 'enriching'` in the POST body (line 1008). This is a meaningful invariant — articles must enter NocoDB in enriching state for the downstream pipeline to pick them up. Adding `expect(writeBody.status).toBe('enriching')` documents this contract.

---

### S2 — Test 2.2 could verify that `BANNED_PHRASES` is a non-empty exported array

The test uses `BANNED_PHRASES[0]` without verifying it is defined. If the export were removed or renamed, the test would throw a confusing `Cannot read properties of undefined` error rather than a clean assertion failure. A `beforeAll` guard like:
```javascript
expect(Array.isArray(BANNED_PHRASES) && BANNED_PHRASES.length > 0).toBe(true);
```
would give a clear failure message.

---

### S3 — Test 2.3 empty-list test does not assert `freshness.lastPublished` is undefined

When no recent article exists, the production code returns `{ fresh: true, effectiveArticleType: 'insider_buying' }` with no `lastPublished` field. The test only checks `fresh` and `effectiveArticleType`. Adding `expect(freshness.lastPublished).toBeUndefined()` would catch any regression that accidentally backfills this field.

---

## Acceptance Criteria Checklist (from spec)

| Criterion | Status |
|-----------|--------|
| File exists | PASS |
| 3 tests, 0 `.skip` or `.todo` | PASS |
| Test 2.1: second Claude call prompt contains outline JSON substring | **FAIL** — no second Claude call exists |
| Test 2.1: `qualityGate` returns `valid: true` | **FAIL** — `qualityGate` is not called |
| Test 2.1: `writeArticle` fetchFn called exactly once | PASS (but checks `mock.calls.length === 1` via implicit assertion) |
| Test 2.2: draft fetchFn called exactly twice | **FAIL** — no draft fetchFn exists |
| Test 2.2: retry prompt body contains `errors[0]` string from first failure | **FAIL** — no retry call made |
| Test 2.3: returned `articleType` is not `'insider_buying'` | PASS (via `effectiveArticleType`) |
| All fetchFns use full Response shape | PASS |
| No real HTTP calls | PASS |
| Each test completes in < 8s | PASS |

**Result: 4 of 10 acceptance criteria pass. The two most important criteria (outline→draft prompt flow, retry prompt injection) are not tested at all.**

---

## What Was Done Well

- Test 2.3 freshness logic is clean and correctly exercises both the stale and fresh paths. The frozen timer reliance is properly documented in the comment.
- The `OUTLINE_CLAUDE_BODY` fixture correctly mirrors the Claude text-response shape (not the tool-use shape), matching the `generateArticleOutline` code path exactly.
- The `OUTLINE_OBJ` satisfies `validateOutline` for ticker `'NVDA'`: headline contains "NVDA", 5 sections present. This prevents the `generateArticleOutline` retry loop from exhausting its 2-attempt budget.
- `lockKeyword` body inspection (`JSON.parse(lockCallArgs[1].body).status === 'in_progress'`) correctly verifies the business-rule payload.
- `makeNocodbOpts` local helper keeps credentials consistent with `BASE_ENV` throughout all stages.
