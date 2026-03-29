# Section 08 Code Review — 429 retry, visual-engine export, integration tests

Reviewer: Claude Sonnet 4.6
Date: 2026-03-29
Files reviewed:
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js` (lines 11–43)
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-engine.js` (new file)
- `ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js` (lines 558–662, S08 block)
- `ryan_cole/insiderbuying-site/tests/insiderbuying/visual-engine.test.js` (new file)

---

## What Was Done Well

The `_nocoGet` signature extension is backward-compatible: `_sleep` is optional and falls back to `new Promise(r => setTimeout(r, 1000))`, so any existing call site that does not pass the argument continues to work correctly. Both `_cacheGet` and `_cacheSet` are updated to forward `helpers._sleep`, and the existing `makeHelpers` factory in the test file already includes `_sleep: jest.fn()`, so all 15 pre-existing tests continue to compile and run without modification.

The `visual-engine.js` barrel file is minimal and correct. No business logic is placed there. Node.js's module cache means the four `require()` calls resolve each module once and the same instance is shared across all consumers — this is the right architecture for a shared utility namespace.

The 429 test in the S08 block is the most valuable test added in this section: it verifies that `sleepFn` is called with exactly `1000` and that the retry fetch sequence proceeds correctly after the rate-limited response. The `fetchFn.mock.calls.find(...)` pattern for POST/PATCH assertion is consistent with the rest of the test file.

---

## Issues

### Critical (must fix)

**C1 — `prefetchLogos` calls `_nocoGet` without passing `_sleep` — rate-limit retry is silently disabled for batch prefetch**

File: `identity-assets.js` line 181

```js
const body = await _nocoGet(batchUrl, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn);
```

This is the only `_nocoGet` call in the file that does not forward `helpers._sleep`. When the batch query hits a 429, `_sleep` is `undefined`, the fallback `new Promise(r => setTimeout(r, 1000))` fires correctly for the wait — but if `helpers._sleep` is a Jest mock that was specifically passed to make waits instant in test context, the fallback `setTimeout` is NOT mocked. In production this is merely inconsistent. In tests, this means any future test that exercises `prefetchLogos` with a 429 batch response will incur a real 1-second wait per call, slowing the suite.

More importantly, this is a logic gap: the S08 change was specifically to make all NocoDB GET paths retry-aware. Leaving line 181 unchanged means `prefetchLogos` is the only public entry point where 429 does not benefit from the injected sleep abstraction.

Fix: Add `helpers._sleep` as the fourth argument at line 181.

```js
const body = await _nocoGet(batchUrl, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn, helpers._sleep);
```

Action: **Auto-fix**

---

**C2 — The retry loop terminates after one retry with no mechanism for the retry also returning 429 — caller receives an error instead of a safe fallback**

File: `identity-assets.js` lines 13–17

```js
if (res.status === 429) {
    await (_sleep ? _sleep(1000) : new Promise(r => setTimeout(r, 1000)));
    res = await fetchFn(url, { headers: { 'xc-token': token } });
}
if (!res.ok) throw new Error(`NocoDB GET failed: ${res.status}`);
```

If the retry response is also 429, execution falls through to `if (!res.ok)` and throws `NocoDB GET failed: 429`. This error propagates through `_cacheGet` / `_cacheSet` and into the public API (`getCompanyLogo`, `getInsiderPhoto`). For `getCompanyLogo`, the outer logic does not try/catch the `_cacheGet` call at the top of the function — the 429 error escapes to the n8n Code node caller, which will log a failed execution rather than gracefully serving a placeholder.

Whether one retry is the right policy is a product decision (see the Ask User note below), but the current code has an undocumented and untested failure mode: double-429 raises an exception rather than falling through to a cache miss or fallback. There is no test covering this case.

The minimum safe fix is to ensure the second 429 is treated the same as any other `!ok` error — which it already is, since the throw will be caught by the outer try/catch in `getCompanyLogo`. But this is not obvious from reading `_nocoGet` alone, and it is not tested.

Action: **Ask user** — decide whether the right policy is: (a) one retry at 1s as currently implemented, (b) exponential backoff for N retries, or (c) treat 429 as a cache miss rather than an error. Until decided, add a comment and a test case for the double-429 path so the behavior is documented.

---

### Important (should fix)

**I1 — The `brandfetchHit` call inside the 429 retry test is incorrect — it passes the result object directly instead of a resolved promise**

File: `identity-assets.test.js` line 141

```js
.mockResolvedValueOnce(brandfetchHit('image/png'))
```

`brandfetchHit()` returns a plain object (`{ status: 200, headers: {...}, buffer: async () => buf }`), not a response that `.ok` resolves to `true`. The `brandfetchHit` factory was designed to be passed to `makeHelpers()` which wraps it in `mockResolvedValueOnce`. When called with `mockResolvedValueOnce(brandfetchHit(...))`, the resolved value is the object itself — which is correct.

However, the sequence in this test is:

1. `mockResolvedValueOnce({ ok: true, json: async () => ({ list: [] }) })` — initial `_cacheGet`: OK
2. `mockResolvedValueOnce(brandfetchHit('image/png'))` — Brandfetch: this object does NOT have an `ok` property

The Brandfetch path in `getCompanyLogo` does NOT call `res.ok` — it checks `res.status === 200`. The `brandfetchHit` factory sets `status: 200`, so this actually works. But the object also lacks `ok: true`, which means if any code path between the 429 test and the final POST checks `res.ok` on the brandfetch response, it would fail silently. The test passes because the live code does not call `.ok` on the Brandfetch response, but the inconsistency makes the test fragile and harder to read.

This is not a production bug — it is a test readability / fragility issue.

Action: **Let go** — the test passes and the factory design is consistent with prior sections. Fixing it would require modifying `brandfetchHit` to also expose `ok: true`, which is a wider test refactor.

---

**I2 — `visual-engine.test.js` tests are entirely structural (export shape) — they provide zero behavioral coverage and will not catch regressions in the barrel file**

File: `visual-engine.test.js` lines 36–80

Every test in this file follows the pattern:
```js
expect(engine.charts).toBeDefined();
expect(typeof engine.charts.renderBarChart).toBe('function');
```

Because all four child modules are fully mocked at the top of the file (`jest.mock(...)`), these tests verify only that `visual-engine.js` passes through the mock objects. They would pass even if `visual-engine.js` were:
```js
module.exports = { charts: {renderBarChart: ()=>{}}, templates: {...}, ... };
```

They do not verify: (a) that the `require()` paths in `visual-engine.js` are correct (Jest's module resolver would catch a wrong path at test time, but only if the module is NOT mocked — here all four are mocked so a wrong path would not be caught), (b) that `identity.normalizeInsiderName` and `identity.prefetchLogos` are exported (both are absent from the mock in lines 25–30, and absent from the assertions), (c) any integration between modules.

The one genuine value these tests provide is as a smoke check: if `visual-engine.js` is deleted or its `module.exports` is accidentally cleared, the tests fail. That is a valid contract test for a barrel file.

However, two specific exports are missing from both the mock and the assertions:
- `identity.normalizeInsiderName`
- `identity.prefetchLogos`

Both are exported from `identity-assets.js` and should be accessible via `engine.identity`. Their absence from the test makes the contract incomplete.

Action: **Auto-fix** — add `normalizeInsiderName: jest.fn()` and `prefetchLogos: jest.fn()` to the `jest.mock` for `identity-assets`, and add two corresponding `typeof` assertions. This is a 4-line change.

---

### Suggestions

**S1 — The `_cacheGet` behavior tests (lines 73–106) duplicate scenario coverage that already exists in the S06 test block**

The three tests in `describe('_cacheGet behavior (via getCompanyLogo)')` — cache miss triggers cascade, expired entry triggers re-fetch, valid TTL entry returns cached URL — are functionally identical to the tests in the existing S06 blocks `'getCompanyLogo — cache hit'`, `'getCompanyLogo — Brandfetch PNG hit'`, and `'getCompanyLogo — cache expiry'`. The only differences are the domain name (`example.com` vs `nvidia.com`) and the describe block label. The call counts and assertions are the same.

Similarly, the `_cacheSet` POST/PATCH tests (lines 108–133) are structurally identical to `'getCompanyLogo — cache expiry' → 'NocoDB PATCH called when row already exists'` (line 220–232 of the existing file) and `'getCompanyLogo — Brandfetch PNG hit' → 'NocoDB POST called to cache logo'` (line 113–123).

This duplication does not cause any harm — the tests still pass and the coverage is real. But it does inflate the test count without adding new coverage.

The one genuinely new test is the 429 retry test at line 135 (`retries once on NocoDB 429 response`), which tests new behavior introduced in S08. The `xc-token` header test at line 152 is also new and tests a property of the NocoDB request construction that was not previously asserted explicitly.

Action: **Let go** — the duplication is harmless and the new tests are valuable. Removing the duplicates would require a S06 test refactor that is not worth the churn.

---

**S2 — The `xc-token` header assertion uses a case-insensitive check (`headers['xc-token'] || headers['xc-Token']`) that is inconsistent with how the production code sets the header**

File: `identity-assets.test.js` lines 166–168

```js
expect(headers && (headers['xc-token'] || headers['xc-Token'])).toBe('test-token');
```

The production code always sets `'xc-token'` (lowercase). The `|| headers['xc-Token']` fallback is defensive but implies uncertainty about the production code's behavior. Since the test controls the fetch mock and the production code uses a string literal key, the correct assertion is:

```js
expect(headers && headers['xc-token']).toBe('test-token');
```

Action: **Let go** — harmless defensive check. Not worth a separate commit.

---

**S3 — `visual-engine.js` comment says `renderTemplate(1, data, ...)` but `visual-templates.js` exports `renderTemplate(templateId, data, options, helpers)` — the argument order and count are correct, but passing a literal `1` as `templateId` is only valid if template IDs are integers, which should be documented**

File: `visual-engine.js` line 9

The JSDoc example uses `renderTemplate(1, data, { upload: true }, helpers)`. If template IDs are strings (e.g., `'alert_summary'`) in the actual `visual-templates.js` implementation, the comment would be misleading for the first developer to use the barrel. This is a documentation concern, not a code bug.

Action: **Let go** — update the comment when the actual template ID convention is established.

---

## Summary Table

| ID | Severity | Description | Action |
|----|----------|-------------|--------|
| C1 | Critical | `prefetchLogos` calls `_nocoGet` without `helpers._sleep` — rate-limit retry is silently disabled for batch prefetch | Auto-fix |
| C2 | Critical | Retry terminates after one attempt — double-429 throws instead of graceful fallback; behavior undocumented and untested | Ask user |
| I1 | Important | `brandfetchHit` mock in 429 test lacks `ok` property — fragile test that works only because production code does not check `res.ok` on Brandfetch | Let go |
| I2 | Important | `visual-engine.test.js` missing `normalizeInsiderName` and `prefetchLogos` in mock and assertions — contract is incomplete | Auto-fix |
| S1 | Suggestion | S08 `_cacheGet`/`_cacheSet` scenario tests duplicate S06 coverage — new 429 test and header test are the only genuinely new cases | Let go |
| S2 | Suggestion | `xc-token` header assertion uses unnecessary case-insensitive fallback | Let go |
| S3 | Suggestion | JSDoc example in `visual-engine.js` uses integer `1` as template ID without documenting the ID convention | Let go |

---

## Answers to the Specific Review Questions

**1. Is the 429 retry logic correct?**

Mostly yes. The wait uses `_sleep` when provided and falls back to a real `setTimeout` when not, which is the right pattern for testability. The `let res` reassignment is correct — the retry overwrites the 429 response before the `if (!res.ok)` check. The one-retry policy is simple but sufficient for NocoDB's rate limiting in a low-volume n8n context.

The open issue is what happens if the retry also returns 429 (see C2). Currently it throws `NocoDB GET failed: 429`. For `_cacheGet` this throw propagates out of `getCompanyLogo` directly because `_cacheGet` is called without a try/catch at lines 90–91. The outer caller (n8n Code node) will see an unhandled error. This should be documented or handled.

**2. Are all `_nocoGet` callers correctly updated to pass `helpers._sleep`?**

No. Three of four call sites were updated (`_cacheGet` at line 28, `_cacheSet` at line 43, and implicitly via those two in `getCompanyLogo` and `getInsiderPhoto`). The fourth call site — `prefetchLogos` at line 181 — was missed. This is C1 above.

**3. Is `visual-engine.js` correct — no circular deps, correct `require()` paths?**

Yes. None of the four required modules (`generate-chart`, `visual-templates`, `report-covers`, `identity-assets`) require `visual-engine` back — confirmed by grep. The require paths are correct relative to the file's location in `n8n/code/insiderbuying/`. Node.js module caching means requiring the same module through `visual-engine` and directly produces the same object reference, so there are no issues with shared state or double-initialization.

**4. Are the cache helper tests meaningful (or do they just duplicate existing S06 coverage)?**

They are partially duplicative of S06. The three `_cacheGet behavior` tests and two of the four `_cacheSet behavior` tests cover scenarios already tested by name in the S06 block. The genuinely new tests are the 429 retry test and the `xc-token` header assertion. Both add real value. The duplication is harmless (see S1).

**5. Are the visual-engine tests meaningful (or just trivial export checks)?**

They are trivial export checks, which is appropriate for a barrel file. The value is as a contract smoke test: if `visual-engine.js` is removed or misconfigured, these tests fail. The gap is that `normalizeInsiderName` and `prefetchLogos` are not included in the mock or assertions, leaving part of the `identity` namespace contract unchecked (see I2).

**6. Any edge cases in the retry logic (what if the retry also returns 429)?**

Yes — this is C2. If the retry returns 429, `res.ok` is false and `_nocoGet` throws `NocoDB GET failed: 429`. For `_cacheSet` callers, this throw is caught by the try/catch wrapper in `getCompanyLogo` and `getInsiderPhoto` (each cache write is wrapped in try/catch). For `_cacheGet` callers, the throw is NOT caught — it propagates out of `getCompanyLogo` and `getInsiderPhoto` to the n8n Code node. The existing test suite has no test for this path. The correct action is to document the behavior and add a test so that the double-429 failure mode is explicit and observable.
