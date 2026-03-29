# Section 07: finnhub-client.js (Shared Module)

## Overview

Create `n8n/code/insiderbuying/finnhub-client.js` — a new, self-contained module that wraps Finnhub API calls with in-memory TTL caching. It is the authoritative source of real-time quote data and upcoming earnings dates for the entire InsiderBuying pipeline. `analyze-alert.js` (section 05) depends on it, and future units (newsletter, articles) will use it too.

This section has **no dependencies** on sections 01–06 and can be implemented in parallel with sections 01 and 05.

---

## Tests First

**File**: `n8n/tests/finnhub-client.test.js` (new file)

Write all tests below before writing any implementation. Run with:

```
npm test -- --testPathPattern="finnhub-client"
```

All external calls are intercepted via the `fetchFn` parameter (dependency injection). No real HTTP calls in tests. Pass `sleep` as `() => Promise.resolve()`.

### getQuote()

- **Field mapping**: mock `fetchFn` returning a valid Finnhub quote JSON body `{ c: 45.20, dp: 1.5, h: 46.00, l: 44.50, o: 44.80, pc: 44.54 }`. Assert the returned object has exactly those keys with those values.
- **Cache hit**: call `getQuote('AAPL', ...)` twice in quick succession (within TTL). Assert `fetchFn` is called exactly once — second call is a cache hit.
- **Cache miss after TTL**: add an entry to the cache with an expired timestamp, then call `getQuote()`. Assert `fetchFn` is called (cache miss). Assert the stale entry is no longer in the cache after the call.
- **HTTP 429 (rate limit)**: mock `fetchFn` returning `{ status: 429 }`. Assert `getQuote` returns `null`. Assert a warning is logged.
- **HTTP 500**: mock `fetchFn` returning `{ status: 500 }`. Assert `getQuote` returns `null`. Assert a warning is logged.
- **Network error (fetchFn throws)**: mock `fetchFn` throwing `new Error('ECONNRESET')`. Assert `getQuote` returns `null`. Assert a warning is logged.

### Market Hours + Timezone

These tests inject a `nowFn` parameter (or equivalent) so the current time can be controlled.

- **Market open, weekday**: force current time to 14:00 ET on a Tuesday. Assert TTL returned is 60 seconds.
- **Market closed, after hours**: force current time to 17:00 ET on a Tuesday. Assert TTL is 4 hours (14400 seconds).
- **Weekend (Saturday)**: force current time to Saturday 12:00 ET. Assert TTL is 4 hours.
- **DST spring-forward boundary**: force current time to 2026-03-08 (DST change day) at 02:30 ET. Assert `isMarketOpen()` does not throw, and returns a boolean.

### getNextEarningsDate()

- **Upcoming earnings within 90 days**: mock NocoDB (via `fetchFn`) returning a record with `earnings_date = "2026-04-25"` (within 90 days of a known reference date). Assert the function returns `"2026-04-25"`.
- **Earnings date more than 90 days away**: mock NocoDB returning `"2027-01-15"`. Assert `null` is returned.
- **Empty NocoDB result**: mock NocoDB returning an empty list. Assert `null` is returned.
- **NocoDB query fails**: mock `fetchFn` throwing. Assert `null` is returned and a warning is logged.

### Cache Cleanup (Lazy TTL)

- **Expired entry deleted on read**: manually insert an entry into the module's internal cache with a past `expiresAt`. Call `getQuote()` for that ticker. Assert the old entry is gone and `fetchFn` was called.
- **Fresh entry retained**: manually insert an entry with a future `expiresAt`. Call `getQuote()`. Assert `fetchFn` is NOT called.

---

## Implementation

**File to create**: `n8n/code/insiderbuying/finnhub-client.js`

### Module Shape

```javascript
'use strict';
// No top-level require — all dependencies injected via parameters for testability.
// Exception: require('https') is only used if a built-in makeRequest helper is needed.

const _quoteCache = new Map(); // key: ticker (uppercase), value: { data, expiresAt }

function isMarketOpen(nowMs) { ... }
// Returns true if nowMs (UTC epoch ms) falls within Mon–Fri 09:30–16:00 ET.
// Use Intl.DateTimeFormat to convert UTC → ET — n8n runs in UTC.

function getCacheTtlMs(nowMs) { ... }
// Returns 60_000 (1 min) if market is open, 14_400_000 (4 h) otherwise.

async function getQuote(ticker, fetchFn, env, nowFn) { ... }
// nowFn defaults to () => Date.now() — injectable for testing.
// Returns { c, dp, h, l, o, pc } or null on any error.

async function getNextEarningsDate(ticker, fetchFn, env) { ... }
// Queries NocoDB earnings_calendar table for the ticker.
// Returns ISO date string within 90 days, or null.

module.exports = { getQuote, getNextEarningsDate };
```

### getQuote() Logic

1. Normalize `ticker` to uppercase.
2. Check `_quoteCache.get(ticker)`. If the entry exists and `entry.expiresAt > nowFn()`, return `entry.data` immediately (cache hit).
3. If the entry exists but is expired, delete it from the map (lazy cleanup).
4. Call Finnhub: `GET https://finnhub.io/api/v1/quote?symbol={ticker}&token={env.FINNHUB_API_KEY}` via `fetchFn`.
5. If HTTP status is not 200 (e.g., 429, 500), log a warning with the status code, return `null`.
6. If `fetchFn` throws, log a warning with the error message, return `null`.
7. Extract `{ c, dp, h, l, o, pc }` from the response body. Store in `_quoteCache` with `expiresAt = nowFn() + getCacheTtlMs(nowFn())`.
8. Return the data object.

The `fetchFn` signature follows the project pattern: `fetchFn(url, options)` returns a promise resolving to `{ status, json() }`.

### isMarketOpen() Logic

Market hours are Mon–Fri 09:30–16:00 ET (America/New_York). Use `Intl.DateTimeFormat` to extract the ET hour, minute, and weekday from `nowMs`:

```javascript
function getEtParts(nowMs) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', weekday: 'short',
    hour12: false
  });
  // parse the formatted string to extract weekday, hour, minute
}
```

Weekdays Sat/Sun → closed. Any weekday outside 09:30–16:00 ET → closed. This correctly handles both EST (UTC-5) and EDT (UTC-4) because `Intl.DateTimeFormat` applies the IANA tz database automatically.

### getNextEarningsDate() Logic

1. Query NocoDB `earnings_calendar` table filtering by `ticker = ticker` and `earnings_date >= today`.
2. Sort ascending, take the first record.
3. If `earnings_date` is more than 90 days from today, return `null`.
4. If the query throws or returns empty, return `null` (logged as warning if error).

NocoDB query via `fetchFn`:
- `GET {env.NOCODB_API_URL}/api/v1/db/data/noco/{projectId}/{tableId}?where=(ticker,eq,{ticker})&sort=earnings_date&limit=1`
- Auth: `xc-token` header from `env.NOCODB_API_TOKEN`.

### n8n Compatibility Notes

- n8n Code Nodes have no global `fetch`. All HTTP is done via the injected `fetchFn` parameter.
- The `_quoteCache` Map is module-level. Because n8n Code Nodes run inside a persistent Node.js process, the cache survives between pipeline executions within the same n8n session. On n8n restart, the cache starts cold — this is acceptable.
- Do NOT use `setTimeout` or `setInterval` for cache cleanup. Use lazy TTL cleanup on every read (step 3 above). This keeps the Map bounded to active tickers without side effects.
- Export only `{ getQuote, getNextEarningsDate }`. Internal helpers (`isMarketOpen`, `getCacheTtlMs`, `_quoteCache`) are module-private.

---

## How analyze-alert.js Uses This Module

Section 05 (structured analysis) calls these functions before building the DeepSeek prompt:

```javascript
const { getQuote, getNextEarningsDate } = require('./finnhub-client');

const quote = await getQuote(ticker, fetchFn, env);
// quote may be null — omit price fields from prompt if so

const earningsDate = await getNextEarningsDate(ticker, fetchFn, env);
// earningsDate may be null — omit earnings sentence from prompt if so
```

Both calls are independently nullable. A null from either one causes that piece of data to be silently omitted from the prompt — the analysis continues without it. The `finnhub-client` module never throws to its callers; all errors are caught internally and return null.

---

## Dependencies

| Dependency | What Is Needed | If Not Available |
|---|---|---|
| `env.FINNHUB_API_KEY` | Finnhub API key (free tier: 60 calls/min) | `getQuote` returns null immediately |
| `env.NOCODB_API_URL` + `env.NOCODB_API_TOKEN` | NocoDB connection for earnings lookup | `getNextEarningsDate` returns null |
| Unit 09 (data-pipeline) | NocoDB `earnings_calendar` table populated daily | `getNextEarningsDate` returns null (empty table) |

No dependency on sections 01–06. This section is independently testable and implementable.

---

## Acceptance Criteria

- [x] `finnhub-client.test.js` exists with all tests listed above and all pass.
- [x] `getQuote()` returns the correct `{c, dp, h, l, o, pc}` shape on a valid API response.
- [x] Two calls within TTL result in exactly one `fetchFn` invocation (cache works).
- [x] Expired cache entries are deleted on the next read (lazy cleanup confirmed by test).
- [x] HTTP 429 and 500 both return `null` — no throw propagates to the caller.
- [x] `isMarketOpen()` returns the correct boolean for all four market-hours test cases including the DST boundary.
- [x] `getNextEarningsDate()` returns null for dates >90 days away and for empty/error NocoDB responses.
- [x] Module exports only `{ getQuote, getNextEarningsDate }`.
- [x] No `require()` at the top level except `require('https')` if used internally for the built-in fetch helper (all other dependencies injected).

---

## Implementation Notes (Actual)

- **Files created**: `n8n/code/insiderbuying/finnhub-client.js`, `tests/insiderbuying/finnhub-client.test.js`
  - Note: test path is `tests/insiderbuying/` (consistent with all other module tests), not `n8n/tests/` as written in spec.
- **`_quoteCache` export**: Exported conditionally under `process.env.NODE_ENV === 'test'` (Jest sets this automatically). Production callers get the clean `{ getQuote, getNextEarningsDate }` contract. Test file imports `_quoteCache` for `beforeEach(() => _quoteCache.clear())`.
- **`hourCycle: 'h23'`** added to `Intl.DateTimeFormat` options alongside `hour12: false` — guards against midnight reporting as `24` on some implementations.
- **`getNextEarningsDate` signature**: Added `nowFn` as 4th parameter (spec omitted it). Required for deterministic 90-day window tests. Spec omission was an oversight.
- **NocoDB query** includes `~and(earnings_date,gte,${todayIso})` per spec. Past-date guard added on client side too: `if (diffDays < 0 || diffDays > 90) return null`.
- **HTTP status guard** added to `getNextEarningsDate` (mirrors `getQuote`) — prevents `resp.json()` from throwing on non-200 NocoDB responses.
- **17/17 tests pass** (16 spec tests + 1 added for past-date guard).
