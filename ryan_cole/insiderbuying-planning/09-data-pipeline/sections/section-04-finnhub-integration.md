# Section 04: Finnhub Integration

## Overview

This section adds Finnhub as the new financial data source in `dexter-research.js`, replacing the paid Financial Datasets API calls. It introduces a `TokenBucket` rate limiter, a NocoDB cache layer, and four Finnhub fetcher functions. It also updates `fetchFinancialData()` with a new `DATA_WEIGHTS` object whose values sum to exactly 1.0.

**File modified:** `n8n/code/insiderbuying/dexter-research.js`
**Test file:** `n8n/tests/dexter-research.test.js` (Node.js native runner — `node:test`, not Jest)

**Dependencies:** None — this section is parallelizable with section-01. It does not depend on `edgar-parser.js`.

**Blocked by this section:** section-05 (Alpha Vantage + sec-monitor rewrite depends on the updated `fetchFinancialData()` structure).

---

## Background

`dexter-research.js` is an n8n Code node that assembles financial context for the Dexter AI research analysis. Previously it called Financial Datasets API (`financialdatasets.ai`) for quotes, profile data, basic metrics, and insider trades. That paid dependency is being removed entirely.

Finnhub free tier provides all four data types via REST endpoints (JSON). The free plan allows 60 API calls per minute. A `TokenBucket` class (no external dependencies) enforces this limit. All four Finnhub fetchers share a single module-level bucket instance.

A NocoDB `Financial_Cache` table stores responses for 24 hours, so repeated `dexterResearch()` calls for the same ticker within a day make zero Finnhub API calls.

**Important n8n Code node constraint:** All async operations must be fully awaited before the node function returns. The n8n Code node process terminates immediately after the function resolves — background (`fire-and-forget`) promises are killed silently. Cache writes must therefore be collected and awaited via `Promise.allSettled(cacheWrites)` before the function returns, not fire-and-forgotten.

---

## Environment Variables

These three variables must be present in the n8n Code node environment:

| Variable | Purpose |
|---|---|
| `FINNHUB_API_KEY` | Finnhub REST API key (NEW) |
| `NOCODB_FINANCIAL_CACHE_TABLE_ID` | NocoDB table ID for `Financial_Cache` (NEW) |
| `NOCODB_BASE_URL` | NocoDB instance base URL (EXISTING) |
| `NOCODB_API_TOKEN` | NocoDB `xc-token` auth header (EXISTING) |

Remove `FINANCIAL_DATASETS_API_KEY` — it is unused after this section.

---

## Tests First

**Test file:** `n8n/tests/dexter-research.test.js`
**Run with:** `node n8n/tests/dexter-research.test.js`

Use Node.js native test runner (`node:test`) with `assert.deepStrictEqual()`, `assert.equal()`, `assert.ok()`. Mock `fetchFn` using factory functions that return promises. Inline all fixture data — no separate fixture files.

### TokenBucket Tests

```
// Describe: TokenBucket rate limiter
//
// Test: capacity=5 — acquire() called 5 times in sequence → all 5 resolve
//       immediately (no delay), verified by measuring elapsed time < 50ms total
//
// Test: capacity=5 — acquire() called 6 times → first 5 resolve immediately,
//       6th resolves only after the refill interval elapses (5000ms for a
//       bucket with refillInterval=5000). Verify 6th call elapsed >= 4900ms.
//       (Use a short refillInterval like 50ms in tests to avoid slow tests.)
```

### NocoDB Cache Layer Tests

```
// Describe: NocoDB cache layer
//
// Test: readCache — nocoClient returns a record where expires_at is
//       Date.now() + 86400000 (24h in future) and data_json is
//       JSON.stringify({c: 100}) → readCache returns {c: 100} (parsed object)
//
// Test: readCache — record returned with expires_at = Date.now() - 1000
//       (1 second in the past) → readCache returns null (expired)
//
// Test: readCache — nocoClient returns empty list (no matching record) →
//       readCache returns null
//
// Test: writeCache — nocoClient search returns empty list (no existing record)
//       → POST is called with correct fields: ticker, data_type, data_json
//       (stringified), and expires_at roughly equal to Date.now() + 86400000
//       (±5000ms tolerance). PATCH must NOT be called.
//
// Test: writeCache — nocoClient search returns 1 existing record with an id
//       → PATCH is called with updated data_json and new expires_at.
//       POST must NOT be called.
//
// Test: writeCache — expires_at written to NocoDB equals Date.now() + 86400000
//       within ±5000ms tolerance (verify the value, not just that it was called)
```

### Finnhub Fetcher Tests

```
// Describe: finnhub.getQuote
//
// Test: NocoDB returns null (cache miss) → fetchFn called with Finnhub
//       /api/v1/quote URL including ticker and apiKey query params.
//       Finnhub response { c: 150, h: 155, l: 148, o: 149, pc: 147, d: 3, dp: 2.04 }
//       → function returns that object. writeCache called with data_type='quote'.
//
// Test: NocoDB returns valid unexpired record for (ticker='AAPL', data_type='quote')
//       → fetchFn (Finnhub) is NOT called. Cached object returned directly.
//
// Test: fetchFn rejects with HTTP 429 → error propagates out of getQuote
//       (it is NOT silently swallowed). Caller receives a rejected promise.

// Describe: finnhub.getProfile
//
// Test: cache miss → Finnhub /api/v1/stock/profile2 fetched.
//       Response includes { name, marketCapitalization, exchange, finnhubIndustry,
//       country, currency } → function returns object with those same fields.
//
// Test: Finnhub response missing 'finnhubIndustry' key entirely →
//       returned object has finnhubIndustry: null (not undefined, not crash)

// Describe: finnhub.getBasicFinancials
//
// Test: cache miss → Finnhub /api/v1/stock/metric?metric=all fetched.
//       Response metric object contains peBasicExclExtraTTM, epsBasicExclExtraAnnual,
//       revenueGrowth3Y, grossMarginTTM → all present in return value.
//
// Test: metric field 'revenueGrowth3Y' absent in response → value is null
//       (defensive ?? null access, no crash, no undefined)
//
// Test: cache hit → Finnhub NOT called

// Describe: finnhub.getInsiderTransactions
//
// Test: cache miss → Finnhub /api/v1/stock/insider-transactions fetched.
//       Response { data: [{ name, share, change, transactionDate, transactionPrice }] }
//       → returned as-is (or the data array — verify which shape the function returns)
```

### fetchFinancialData Integration Tests

```
// Describe: fetchFinancialData (updated)
//
// Test: DATA_WEIGHTS values sum to exactly 1.0
//       Compute: Object.values(DATA_WEIGHTS).reduce((a, b) => a + b, 0)
//       assert.equal(sum, 1.0) — use toFixed(10) or exact arithmetic check
//
// Test: All 4 Finnhub fetchers invoked in parallel via Promise.allSettled.
//       Use a spy/counter on fetchFn to verify all 4 Finnhub URLs are hit
//       in a single fetchFinancialData() call. (They should all start before
//       any resolves — i.e., not sequential await chains.)
//
// Test: cacheWrites array is awaited before function returns.
//       Mock writeCache to capture the NocoDB POST calls; after
//       fetchFinancialData() resolves, assert that all expected POST calls
//       have been made (not just scheduled).
//
// Test: all 5 data types present (quote_profile, basic_metrics, stock_prices,
//       competitors, insider_trades each non-null) → data_completeness === 1.0
//
// Test: 2 out of 5 data types are null → data_completeness < 1.0 and equals
//       the sum of weights for the 3 present data types
```

---

## Implementation

### 1. TokenBucket Class

Add at module top level in `dexter-research.js`. No external dependencies — uses `setTimeout` internally.

```javascript
// Stub signature — implement as a class with these characteristics:
class TokenBucket {
  constructor({ capacity, refillRate, refillInterval })
  // capacity: max tokens (e.g. 5)
  // refillRate: tokens added per refillInterval (e.g. 5)
  // refillInterval: ms between refills (e.g. 5000)

  async acquire()
  // Returns a Promise that resolves when a token is available.
  // If a token is available immediately, resolves synchronously (next tick).
  // If no tokens, enqueues the caller; when refill fires, dequeues in order.
}
```

Module-level instance shared by all four Finnhub fetchers:

```javascript
const finnhubBucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 5000 });
```

This gives 60 calls per minute (5 tokens refilled every 5 seconds) without bursting more than 5 concurrent requests.

### 2. HTTP Helper

All code in `dexter-research.js` is CommonJS. HTTP calls use `require('https')` with a lightweight helper — no `fetch`, no `axios`. The helper must handle:
- `Accept-Encoding: gzip, deflate` request header
- gzip decompression via `zlib.createGunzip()` pipe
- Timeout via `req.destroy()` (not `AbortController`)
- Redirects (follow up to 3 hops)
- JSON response parsing

Signature:

```javascript
function httpsGet(url, headers = {})
// Returns Promise<{ statusCode, body }>
// body is already parsed JSON if Content-Type is application/json
// Rejects on network error or timeout
```

The `fetchFn` parameter in tests is a drop-in mock for `httpsGet`.

### 3. NocoDB Client Helper

Build a minimal NocoDB client inside `dexter-research.js`. Uses `xc-token` header, base URL from env, and table ID from env.

```javascript
function makeNocoClient({ baseUrl, token, tableId })
// Returns an object with:
//   .search(where) → Promise<Array<record>>
//   .create(fields) → Promise<record>
//   .update(rowId, fields) → Promise<record>
```

All three methods call the NocoDB REST API using `httpsGet` (with appropriate method override for POST/PATCH — or a separate `httpsPost`/`httpsPatch` helper).

### 4. Cache Helpers

```javascript
async function readCache(ticker, dataType, nocoClient)
// Queries Financial_Cache with:
//   where=(ticker,eq,{ticker})~and(data_type,eq,{dataType})
// If record found and record.expires_at > Date.now(): return JSON.parse(record.data_json)
// Otherwise: return null

async function writeCache(ticker, dataType, data, nocoClient)
// Search for existing record (same where clause as readCache)
// If found: PATCH with { data_json: JSON.stringify(data), expires_at: Date.now() + 86400000 }
// If not found: POST with { ticker, data_type: dataType, data_json: JSON.stringify(data), expires_at: Date.now() + 86400000 }
// Returns Promise (caller awaits via Promise.allSettled)
```

**Critical:** `writeCache` must return a Promise that callers can await. It must NOT be fire-and-forget. The n8n Code node process terminates when the main function resolves.

### 5. Finnhub Fetcher Functions

Group these in an `finnhub` object or as named functions. Each follows the same pattern:

1. Check cache via `readCache(ticker, dataType, nocoClient)`
2. If cache hit: return cached data immediately (no rate limit token consumed)
3. If cache miss: `await finnhubBucket.acquire()`, call Finnhub, push `writeCache(...)` to `cacheWrites[]`, return data

```javascript
async function getQuote(ticker, apiKey, fetchFn, nocoClient, cacheWrites)
// URL: https://api.finnhub.io/api/v1/quote?symbol={ticker}&token={apiKey}
// Returns: { c, h, l, o, pc, d, dp }  (current price, high, low, open, prev close, delta, delta%)
// data_type for cache: 'quote'

async function getProfile(ticker, apiKey, fetchFn, nocoClient, cacheWrites)
// URL: https://api.finnhub.io/api/v1/stock/profile2?symbol={ticker}&token={apiKey}
// Returns: { name, marketCapitalization, exchange, finnhubIndustry, country, currency }
// All fields accessed defensively: response.finnhubIndustry ?? null
// data_type for cache: 'profile'

async function getBasicFinancials(ticker, apiKey, fetchFn, nocoClient, cacheWrites)
// URL: https://api.finnhub.io/api/v1/stock/metric?symbol={ticker}&metric=all&token={apiKey}
// Returns: { metric: { peBasicExclExtraTTM, epsBasicExclExtraAnnual, revenueGrowth3Y, grossMarginTTM, ... } }
// Every metric field accessed with ?? null (Finnhub omits fields for thinly-traded stocks)
// data_type for cache: 'basic_financials'

async function getInsiderTransactions(ticker, apiKey, fetchFn, nocoClient, cacheWrites)
// URL: https://api.finnhub.io/api/v1/stock/insider-transactions?symbol={ticker}&token={apiKey}
// Returns the response object (or response.data array — normalize to consistent shape)
// data_type for cache: 'insider_transactions'
```

Note: `getEarningsCalendar` is NOT part of this section. Earnings calendar is provided exclusively by Alpha Vantage in section-05.

### 6. Updated fetchFinancialData()

Replace the existing `fetchFinancialData()` parallel structure with:

```javascript
const DATA_WEIGHTS = {
  quote_profile:   0.25,
  basic_metrics:   0.25,
  stock_prices:    0.25,
  competitors:     0.10,
  insider_trades:  0.15,
};
// sum = 1.0 exactly
```

The function:

1. Creates a `cacheWrites = []` array to collect all pending cache write promises
2. Fires all four Finnhub calls in parallel via `Promise.allSettled([getQuote(...), getProfile(...), getBasicFinancials(...), getInsiderTransactions(...)])` — passing the same `cacheWrites` array to each
3. `stock_prices` continues using Finnhub stock candles: `/api/v1/stock/candle?symbol={ticker}&resolution=D&count=252&token={apiKey}` — 252 trading days of OHLCV. Treat as a fifth parallel call and add its `writeCache` to `cacheWrites` as well
4. `competitors` data is fetched externally by n8n (passed in as existing context — unchanged)
5. After `Promise.allSettled` for all data calls resolves, awaits `await Promise.allSettled(cacheWrites)` before returning
6. Computes `data_completeness` score as: sum of `DATA_WEIGHTS[key]` for each data type that is non-null

```javascript
// Stub signature:
async function fetchFinancialData(ticker, context, fetchFn)
// context includes: apiKey (Finnhub), nocoClient, competitorsData (from n8n)
// Returns: { quote, profile, basicFinancials, insiderTransactions, stockPrices, data_completeness }
```

**Financial statements dropped:** `income_statements`, `balance_sheets`, and `cash_flow` — along with their combined 0.45 weight from the old `DATA_WEIGHTS` — are removed. The five remaining data types are reweighted to sum to 1.0 as shown above.

---

## Key Implementation Notes

**No external npm dependencies.** All logic is implemented with Node.js built-ins only: `https`, `zlib`, `url`. The `TokenBucket` is hand-written.

**Comma-formatted numbers:** Finnhub does not use comma-formatted numbers in API responses. No stripping needed (unlike EDGAR XML in sections 1–3).

**NocoDB `Financial_Cache` table schema** (must exist before this section is testable):

| Column | Type | Notes |
|---|---|---|
| `ticker` | Text | e.g. `'AAPL'` |
| `data_type` | Text | e.g. `'quote'`, `'profile'`, `'basic_financials'`, `'insider_transactions'`, `'stock_prices'` |
| `data_json` | LONGTEXT or JSON | Stringified response object — must be LONGTEXT, not VARCHAR |
| `expires_at` | Number | Unix ms timestamp (`Date.now() + 86400000`) |

The `readCache` expiry check uses `record.expires_at > Date.now()` — both stored and compared as Unix milliseconds.

**Rate limiter configuration rationale:** capacity=5, refillRate=5, refillInterval=5000ms gives exactly 1 token per 1000ms on average (60/min), but allows short bursts of up to 5 concurrent requests. This matches Finnhub's free tier limit of 60 calls/minute.

**Why `Promise.allSettled` and not `Promise.all`:** If one Finnhub endpoint fails (e.g. rate limit on `getProfile`), the other three results are still usable. `Promise.allSettled` ensures all settled results (fulfilled or rejected) are available. The caller checks `.status === 'fulfilled'` before using `.value`.

---

## Definition of Done for This Section

1. All tests in the `Section 4: Finnhub Integration` describe block pass: `node n8n/tests/dexter-research.test.js`
2. `DATA_WEIGHTS` values sum to exactly `1.0` (verified by test)
3. Second `fetchFinancialData()` call for same ticker within 24h makes zero Finnhub HTTP calls (NocoDB cache operational — verified by test)
4. `cacheWrites` are awaited before function returns (verified by test — not fire-and-forget)
5. `FINANCIAL_DATASETS_API_KEY` has zero references in `dexter-research.js`: `grep -i "FINANCIAL_DATASETS" n8n/code/insiderbuying/dexter-research.js` = 0 matches
6. `FINNHUB_API_KEY` and `NOCODB_FINANCIAL_CACHE_TABLE_ID` documented in the env var table at top of file
7. No external npm packages imported — only `require('https')`, `require('zlib')`, `require('url')`
8. Existing tests in `dexter-research.test.js` (cluster detection, etc.) continue to pass — no regression
