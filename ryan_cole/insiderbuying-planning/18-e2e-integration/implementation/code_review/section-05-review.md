# Code Review — Section 05: Reddit Pipeline E2E

**File reviewed**: `ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/03-reddit-pipeline.test.js`
**Spec**: `section-05-reddit-pipeline.md`
**Reviewer**: Senior Code Reviewer
**Date**: 2026-03-30

---

## Summary

The implementation correctly adapts to three real deviations from the spec (the `draftComment` → prompt-builder reality, the `validateComment` → object reality, and the word-limit verification strategy), and all 40 tests reportedly pass. The test structure is clean, the afterEach reset is correct, and the three scenarios from the spec are covered. However, there are three issues that will cause silent test invalidity or actual failures under specific conditions, plus several lower-priority items worth addressing.

---

## What Was Done Well

- The three spec scenarios are all present with no `.skip` or `.todo` markers.
- The `_setDeps` / `afterEach(_setDeps(null))` pattern is correct and consistently applied.
- The decision to verify word-limit strings in the Claude system prompt (Test 3.2) rather than mock output length is a sound engineering judgment given that word count is controlled by the model, not the caller. The deviation from spec is justified and documented in the context notes.
- The `VALID_COMMENT` and `VALID_COMMENT_LONG` fixtures are carefully constructed to satisfy `validateComment`'s actual rules (no URLs, no brand names, 3-5 sentences by `. ` split), demonstrating the author read the validator source before writing the fixtures.
- The `makeClaudeResponse` factory correctly mirrors the `{ content: [{ type, text }], usage }` shape that `_callClaude` reads synchronously via `res.json()`.

---

## Issues

### CRITICAL

**C-1: `res.json()` mock returns a plain object, not a Promise — but this is correct for production code**

`_callClaude` (line 763 of `reddit-monitor.js`) calls `res.json()` *synchronously* — it does not `await` the result. The test mocks implement `json` as `function() { return body; }` (synchronous), which is correct. The `helpers.js` `makeFetch`/`makeRouter` utilities implement `json` as `async () => body` (returns a Promise). This means the test file's hand-rolled mocks are actually more correct than the shared helpers for this module.

This is not a bug in the test, but it is a significant architectural trap: any future refactor that switches to `makeRouter` or `makeFetch` from `helpers.js` for this module will silently break — `data.content` will be a Promise, `data.content[0]` will be `undefined`, and `_callClaude` will return an empty string without throwing. The test for `buildCommentPrompt` would then fail with `expect(typeof comment).toBe('string')` passing (empty string is a string) but `expect(comment.length).toBeGreaterThan(0)` failing — an obscure failure that does not point to the real cause.

**Recommendation**: Add a comment block above `makeDepsFetch` explicitly calling out that `json()` must be synchronous because `_callClaude` does not `await res.json()`, and that `makeRouter`/`makeFetch` from `helpers.js` are NOT safe substitutes for this module. This prevents the next developer from "simplifying" the mock and introducing a silent breakage.

```javascript
// IMPORTANT: json() must be synchronous (not async).
// _callClaude in reddit-monitor.js calls res.json() without await (line 763).
// helpers.js makeRouter/makeFetch use async json() and are NOT compatible
// with this module for Claude API mocks.
function makeDepsFetch(claudeText) { ... }
```

---

### HIGH

**H-1: Test 3.3 date mismatch — the cap filter will silently pass even when it should fail**

`checkDailyCommentLimit` calls `getESTDateString(_now())` to get today's EST date string (format `YYYY-MM-DD`), then passes it to `getRedditLog`, which builds a NocoDB URL with a `where` filter for that date. The NocoDB mock returns `logResponse` regardless of the URL content, so the mock correctly returns the 10 logs. However, the `posted_at` values in the 10 mock logs are hardcoded to `2026-03-01T...`.

The production `checkDailyCommentLimit` does not re-filter the returned logs by date — it trusts that NocoDB filtered them server-side. The mock bypasses that filtering entirely and always returns all 10 logs. This means the test passes today, but it also means the test would pass even if `checkDailyCommentLimit` called NocoDB with a completely wrong date (e.g., `undefined`). The test does not verify that the NocoDB URL contains today's date.

The test also does not use `_setNow` to pin the clock, which means the URL that gets built contains the actual current date. If the test is run in a UTC+N timezone close to midnight where EST is still the previous day, the constructed date string will differ from what any hardcoded expectation would use — though this is only relevant if date verification is added.

**Recommendation**: Add an assertion on the NocoDB call URL to confirm the date is not empty and not `undefined`:

```javascript
const nocoCall = depsFetch.mock.calls[0];
expect(nocoCall[0]).toContain('Reddit_Log');
expect(nocoCall[0]).toMatch(/\d{4}-\d{2}-\d{2}/); // date is present in the URL
```

This does not require pinning the clock but does confirm the function is building a real date-scoped query rather than a degenerate one.

**H-2: Test 3.1 does not verify the `validateComment` result against the actual comment returned by the mock**

The test calls `buildCommentPrompt` which is mocked to return `VALID_COMMENT`, then calls `validateComment(comment)` on that string. `VALID_COMMENT` was carefully crafted to pass validation, so this will always pass. But the test does not assert *what* `comment` contains — only that it is a non-empty string. If the mock were accidentally returning an empty string or `null`, the test would fail at `comment.length > 0` before reaching `validateComment`, which is fine.

The deeper issue: the happy-path chain test is effectively testing that `VALID_COMMENT` passes `validateComment`, not that the pipeline stages are wired together. The chain assertion (`typeof comment === 'string' && comment.length > 0 → validateComment(comment)`) has no content-level linkage between the three stages. Stage 1 (`buildSearchQueries`) result is never passed to Stage 2 (`buildCommentPrompt`). The spec calls this out explicitly: "The three functions in the chain call *in sequence*."

`buildSearchQueries` returns an array of search query strings; those strings are not inputs to `buildCommentPrompt`. So structural sequencing here is impossible — but the test should at minimum verify that the `queries` array contains an entry for `NVDA` (which it does, line 112) AND that the `comment` string returned by Stage 2 is the exact mock value, confirming the mock is wired correctly:

```javascript
expect(comment).toBe(VALID_COMMENT); // or at least contains the key NVDA fact
```

Without this, a regression where `buildCommentPrompt` silently returns a different text would not be caught.

---

### MEDIUM

**M-1: Test 3.2 word-limit string matching is fragile to format changes**

The assertions check for `'50-100 words'` and `'150-200 words'` as literal substrings in the system prompt. These strings are constructed in `buildCommentPrompt` at line 1263:

```javascript
var wordRange = cfg.wordLimit ? (cfg.wordLimit[0] + '-' + cfg.wordLimit[1] + ' words') : '100-150 words';
```

The test also verifies `SUBREDDIT_TONE_MAP.wallstreetbets.wordLimit[1] <= 100` and `SUBREDDIT_TONE_MAP.ValueInvesting.wordLimit[0] >= 150` as cross-checks. This is good defensive testing. However, if the format string ever changes (e.g., to `"50 to 100 words"` or `"50–100 words"` with an en-dash), the test fails with no indication of why. The assertion error message will be `expected string to contain "50-100 words"` — not immediately obvious.

**Recommendation**: Extract the expected format into a helper derived from the actual `SUBREDDIT_TONE_MAP` value:

```javascript
const wsbRange = SUBREDDIT_TONE_MAP.wallstreetbets.wordLimit;
const viRange  = SUBREDDIT_TONE_MAP.ValueInvesting.wordLimit;
expect(wsbSystem).toContain(wsbRange[0] + '-' + wsbRange[1] + ' words');
expect(viSystem).toContain(viRange[0]  + '-' + viRange[1]  + ' words');
```

This makes the test self-consistent with the data and immune to numeric value changes.

**M-2: `makeNoSleep` is imported but never used**

Line 103 calls `const noSleep = makeNoSleep()` in Test 3.1, but `noSleep` is never passed to any function call. The test functions (`buildSearchQueries`, `buildCommentPrompt`, `validateComment`) do not accept a `_sleep` argument, so this is harmless, but it is noise that may confuse future maintainers into thinking a `_sleep` injection point exists in these functions.

**Recommendation**: Remove the `noSleep` declaration from Test 3.1, and remove `makeNoSleep` from the import line if it is unused elsewhere in the file.

**M-3: Test 3.3 "under cap" case does not assert the `allowed` response shape fully**

The second `it` block in Test 3.3 (line 216) asserts `result.allowed === true` but does not assert the absence of a `reason` field. `checkDailyCommentLimit` returns `{ allowed: true }` with no `reason` when allowed. If a future refactor accidentally adds `reason: undefined` to the allowed path, the test still passes. This is minor but worth a defensive assertion:

```javascript
expect(result.reason).toBeUndefined();
```

---

### LOW

**L-1: `callBodies` index-based mock response selection is fragile**

In Test 3.2, the mock uses `const idx = callBodies.length - 1` at the point where `callBodies.push(...)` has just occurred, meaning `idx` is always `0` for the first call and `1` for the second. This works correctly but is subtly dependent on the push-then-index ordering within a single synchronous block. If an NocoDB call happened to hit the `anthropic.com` branch (it does not, but if the URL routing changed), `callBodies` would accumulate extra entries and the index logic would break silently.

**Recommendation**: Use `callBodies.length === 1 ? VALID_COMMENT : VALID_COMMENT_LONG` for clarity, or better, use the two-call sequential mock pattern from `makeFetchSeq` in `helpers.js` (adapted for the synchronous `json()` requirement noted in C-1).

**L-2: Missing `_setNow` reset in `afterEach`**

`afterEach` resets `_deps` via `_setDeps(null)` but does not reset the clock override via `_setNow(null)`. None of the current tests call `_setNow`, so this is not a current problem. However, since `_setNow` is exported and other e2e test files could set a clock, a shared module-level clock override would leak into this test file if a future test sets it. The established pattern (from section-01 helpers convention) is to reset all test seams in `afterEach`.

**Recommendation**: Add `_setNow` to the import and include `_setNow(null)` in `afterEach`.

---

### SUGGESTION

**S-1: The spec's `validateComment(comment) === true` assertion shape is now tested as `validation.valid === true` — a note in the test would help**

The spec boilerplate assumed `validateComment` returns a boolean. The implementation tests `validation.valid` and `validation.issues`. A one-line comment above the Stage 3 block explaining the deviation helps future readers understand why the test diverges from the spec boilerplate:

```javascript
// validateComment returns { valid, issues }, not a boolean — spec boilerplate was written
// before the production implementation was read.
const validation = validateComment(comment);
```

**S-2: `MOCK_POST.selftext` uses "CEO" without aligning with `MOCK_INSIDER_DATA.role`**

`MOCK_POST.selftext` says "CEO seems bullish" and `MOCK_INSIDER_DATA.role` is `'CEO'`. This is consistent, which is good. However, `MOCK_POST.title` says "anyone tracking insiders?" while `MOCK_INSIDER_DATA.insider_name` is `'Jensen Huang'`. The mismatch is fine for test purposes, but using the same name in both would make Test 3.1's chain more obviously self-consistent from a readability standpoint.

---

## Acceptance Criteria Check

| Criterion | Status |
|---|---|
| File exists | PASS |
| All 3 tests pass (reported) | PASS |
| No `.skip` or `.todo` | PASS |
| Each test < 8 seconds | PASS (no I/O, all synchronous mocks) |
| `fetchFn` mocks use full `{ ok, status, json(), text(), headers }` shape | PASS (hand-rolled mocks cover all fields) |
| Test 3.3 uses `expectFetchCalledTimes` | PASS (line 213) |
| Zero real network calls | PASS (`_setDeps` routes all fetch through mock) |

---

## Required Actions Before Sign-Off

1. **C-1**: Add the synchronous-`json()` warning comment above `makeDepsFetch`. Prevents future regression.
2. **H-1**: Add URL content assertion in Test 3.3 to confirm NocoDB is called with a valid date string.
3. **H-2**: Add `expect(comment).toBe(VALID_COMMENT)` in Test 3.1 to confirm Stage 2 mock is actually wired and returning the expected value.
4. **M-1**: Derive word-limit strings from `SUBREDDIT_TONE_MAP` values rather than hardcoding `'50-100 words'`.
5. **M-2**: Remove the unused `noSleep` variable from Test 3.1.

Items M-3, L-1, L-2, S-1, S-2 are improvements but do not block sign-off.
