# Code Review — Section 07: finnhub-client.js

**Reviewer**: Senior Code Reviewer (Claude Sonnet 4.6)
**Date**: 2026-03-29
**Files reviewed**:
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/finnhub-client.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/finnhub-client.test.js`
**Reference spec**: `ryan_cole/insiderbuying-planning/12-scoring-analysis/sections/section-07-finnhub-client.md`

---

## Summary

**Verdict: Needs Changes (minor blockers)**

The implementation is well-structured and covers the bulk of the spec correctly. The TTL cache logic, market hours detection via `Intl.DateTimeFormat`, and dependency injection pattern are all sound. The test suite is comprehensive and mirrors the spec's test list exactly.

Two issues require fixes before this is shippable: a public API contract violation (exporting `_quoteCache`) and a missing HTTP error guard in `getNextEarningsDate` that can cause an unhandled exception. Everything else is minor or advisory.

---

## Issues

### I1 — `_quoteCache` exported in `module.exports` violates the spec's public API contract
**Severity**: Major

The spec states explicitly:

> "Export only `{ getQuote, getNextEarningsDate }`. Internal helpers (`isMarketOpen`, `getCacheTtlMs`, `_quoteCache`) are module-private."

The acceptance criteria repeats this:

> "Module exports only `{ getQuote, getNextEarningsDate }`."

The implementation exports `_quoteCache` at line 117:

```js
module.exports = { getQuote, getNextEarningsDate, _quoteCache };
```

The underscore prefix and the comment calling it a "test utility" soften the violation but do not eliminate it. Any downstream caller of `finnhub-client` (e.g., `analyze-alert.js`, future newsletter modules) can now write to the cache directly, bypassing TTL logic and corrupting state. The test framework has `require()` access to the module's internal exports regardless — the test file already acknowledges it is using `_quoteCache` as a test-only handle, but that awareness lives in the test, not in the contract enforced by the module boundary.

**Recommended fix**: Remove `_quoteCache` from `module.exports` and instead expose a dedicated test-only reset function that is clearly walled off:

```js
// At the bottom of finnhub-client.js:
module.exports = { getQuote, getNextEarningsDate };

// Test-only escape hatch — never call this in production code.
if (process.env.NODE_ENV === 'test') {
  module.exports._quoteCache = _quoteCache;
}
```

This keeps the public contract clean while still giving tests the direct Map access they need for `beforeEach(() => _quoteCache.clear())`.

---

### I2 — `getNextEarningsDate` does not guard against non-200 HTTP status
**Severity**: Major

`getQuote` correctly checks `resp.status !== 200` before calling `resp.json()`. `getNextEarningsDate` does not. If NocoDB returns a 401, 403, or 500, `resp.json()` is called unconditionally on line 100, and the error body may not parse as `{ list: [...] }`. In the best case, `(body && body.list) || []` catches this silently. In the worst case — if the error response is not valid JSON — `resp.json()` rejects and the `await` on line 100 throws an uncaught exception that propagates to the caller as a rejected promise, breaking the "never throws to callers" guarantee stated in the spec.

The try/catch on line 96 only wraps `fetchFn(url, ...)`, not `resp.json()`, so the second await is outside error protection.

**Recommended fix**:

```js
if (!resp || resp.status !== 200) {
  console.warn(`[finnhub-client] getNextEarningsDate HTTP ${resp && resp.status} for ${key}`);
  return null;
}
const body = await resp.json();
```

This mirrors the pattern already used in `getQuote` and closes the gap.

---

### I3 — NocoDB query does not filter out past earnings dates
**Severity**: Minor

The spec says:

> "Query NocoDB `earnings_calendar` table filtering by `ticker = ticker` and `earnings_date >= today`."

The implemented URL query is:

```
?where=(ticker,eq,${key})&sort=earnings_date&limit=1
```

There is no `earnings_date >= today` filter. NocoDB will return the earliest record for that ticker regardless of date. If the earnings table contains past records (last quarter's report date), the query will return a stale date. The 90-day window check on line 110 partially compensates — a past date yields a negative `diffDays`, which is less than 90, so it would be returned as valid. This means `getNextEarningsDate` can return a date that already passed, silently injecting stale data into the scoring prompt.

**Recommended fix**: Add a date filter to the NocoDB query. NocoDB supports `gte` comparisons:

```js
const todayIso = new Date(now).toISOString().slice(0, 10); // "YYYY-MM-DD"
const url =
  `${env.NOCODB_API_URL}/api/v1/db/data/noco/${env.NOCODB_PROJECT_ID}` +
  `/${env.NOCODB_EARNINGS_TABLE_ID}` +
  `?where=(ticker,eq,${key})~and(earnings_date,gte,${todayIso})` +
  `&sort=earnings_date&limit=1`;
```

---

### I4 — Earnings date 90-day filter does not account for past dates (test gap)
**Severity**: Minor

Related to I3. No test verifies that a past earnings date (e.g., `diffDays = -5`) is handled correctly. Given the current code, `(-5) > 90` is false, so the function would return the past date as valid. The spec does not explicitly say past dates should be rejected (it only says "upcoming"), but returning a stale past date to `analyze-alert.js` is harmful — the prompt would say "earnings in N days" where N is negative.

**Recommended fix**: Add a lower bound to the diffDays check:

```js
if (diffDays < 0 || diffDays > 90) return null;
```

And add a test case:

```js
test('returns null when earnings date is in the past', async () => {
  // 2026-01-01 is ~87 days before REF_DATE (2026-03-29) — past date
  const fetchFn = makeNocoFetch('2026-01-01');
  const result = await getNextEarningsDate('AAPL', fetchFn, MOCK_ENV, () => REF_DATE_UTC);
  expect(result).toBeNull();
});
```

---

### I5 — DST test spec says "02:30 ET" but the constant is labeled "07:30 UTC = ~03:30 EDT"
**Severity**: Minor (documentation inconsistency, not a runtime bug)

The spec says: "force current time to 2026-03-08 (DST change day) at **02:30 ET**."

The test constant is:

```js
// 2026-03-08 (Sunday, DST spring-forward day) 07:30 UTC = ~02:30 EST / 03:30 EDT
const DST_SPRING_UTC = Date.UTC(2026, 2, 8, 7, 30, 0);
```

2026-03-08 07:30 UTC corresponds to 02:30 EST (before DST kicks in) or 03:30 EDT (after). The clocks spring forward at 02:00 local, so 07:30 UTC is actually 03:30 EDT — the comment "~02:30 EST / 03:30 EDT" is technically correct in presenting both sides, but the spec asked for 02:30 ET and the constant lands 60 minutes after that. The `isMarketOpen` result is unchanged (still closed at either time), so there is no behavioral difference. The comment should be made unambiguous so future readers understand which side of the transition is being tested.

**Recommended fix**: Update the comment to clearly state which offset applies at the exact instant being tested:

```js
// 2026-03-08 (Sunday, DST spring-forward day)
// 07:30 UTC = 03:30 EDT (clocks already sprang forward at 02:00 EST = 07:00 UTC)
// Market is closed (Sunday). Tests that Intl.DateTimeFormat handles the transition without throwing.
const DST_SPRING_UTC = Date.UTC(2026, 2, 8, 7, 30, 0);
```

---

## Suggestions

### S1 — The `hour12: false` option inconsistency vs. `market-hours-guard.js`
**Severity**: Nitpick

`market-hours-guard.js` (the existing market-hours utility in the same codebase) uses `hourCycle: 'h23'` alongside `hour12: false`. `finnhub-client.js` uses only `hour12: false`. On some `Intl` implementations, midnight may be reported as `24` instead of `0` when `hour12: false` is used without `hourCycle: 'h23'`. Adding `hourCycle: 'h23'` is a one-line hardening measure and aligns the two modules:

```js
new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
  hourCycle: 'h23',   // add this
})
```

---

### S2 — No guard for missing `env.FINNHUB_API_KEY` or missing NocoDB env vars
**Severity**: Nitpick

If `env.FINNHUB_API_KEY` is undefined, the constructed URL becomes `...&token=undefined`, which Finnhub accepts but returns an auth error (likely 401 or 403). This silently returns null via the HTTP status check — acceptable behavior per the dependency table in the spec. However, logging a more informative warning ("missing FINNHUB_API_KEY") at the guard point would be more debuggable than the generic "HTTP 401" warning logged later.

This is advisory only — the spec does not require this guard — but it would reduce "why is my quote always null?" confusion during setup.

---

### S3 — Test file path deviates from spec
**Severity**: Nitpick

The spec specifies: `n8n/tests/finnhub-client.test.js`

The actual path is: `tests/insiderbuying/finnhub-client.test.js`

This is consistent with every other test in the project (the `tests/insiderbuying/` directory contains all module tests, not `n8n/tests/`), so the deviation is intentional and correct. The spec's stated path is simply outdated. No action needed on the implementation side, but the spec could be updated for accuracy.

---

### S4 — `getNextEarningsDate` accepts a `nowFn` parameter not mentioned in the spec signature
**Severity**: Nitpick

The spec's module shape shows:

```js
async function getNextEarningsDate(ticker, fetchFn, env) { ... }
```

The implementation adds a `nowFn` parameter (line 82), which is used for the 90-day window calculation. This is a strictly additive and beneficial change — it makes the function fully testable with controlled time, consistent with `getQuote`. The spec's omission of this parameter appears to be an oversight. The deviation is a justified improvement.

---

## Acceptance Criteria Checklist

| Criterion | Status |
|---|---|
| `finnhub-client.test.js` exists with all spec tests and passes | Pass |
| `getQuote()` returns `{c, dp, h, l, o, pc}` shape | Pass |
| Two calls within TTL → one `fetchFn` invocation | Pass |
| Expired entries deleted on next read | Pass |
| HTTP 429 and 500 → null, no throw | Pass |
| `isMarketOpen()` correct for all four cases including DST | Pass |
| `getNextEarningsDate()` returns null for >90 days / empty / error | Pass (with I2 caveat on error path) |
| Module exports only `{ getQuote, getNextEarningsDate }` | **FAIL** (I1) |
| No top-level `require()` except optional `https` | Pass |

Two criteria fail or have issues: the export contract (I1) and the earnings HTTP error guard (I2). Both are fixable with small, contained changes.
