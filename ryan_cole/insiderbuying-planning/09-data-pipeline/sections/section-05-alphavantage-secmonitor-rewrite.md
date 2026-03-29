# Section 05: Alpha Vantage Earnings + sec-monitor Rewrite

## Overview

This is the final integration section. It has two deliverables:

1. **Alpha Vantage earnings calendar** — a new fetcher in `dexter-research.js` that downloads the SEC earnings calendar CSV, parses it, and caches the full result in NocoDB as a single `__all__` record (one API call per day maximum).
2. **sec-monitor.js enrichment pipeline rewrite** — replace all Financial Datasets API calls with the new `edgar-parser.js` XML flow (implemented in Sections 01–03). One alert record per scorable transaction, whitelist-based dedup storage, amendment skip logic, and timestamp-based Monitor_State watermark.

## Dependencies

This section depends on all four prior sections being complete:
- **Section 01** (`edgar-parser.js` — `fetchRecentFilings`, `deduplicateFilings`, rate limiter)
- **Section 02** (`edgar-parser.js` — `fetchForm4Xml`, `parseForm4Xml`)
- **Section 03** (`edgar-parser.js` — `filterScorable`, `classifyTransaction`, `classifyInsiderRole`, `calculate10b5Plan`)
- **Section 04** (`dexter-research.js` — `TokenBucket`, NocoDB cache helpers, Finnhub fetchers, updated `DATA_WEIGHTS`)

Do not start this section until all four prior sections have passing tests.

## Files to Create / Modify

```
n8n/code/insiderbuying/sec-monitor.js     ← MODIFY (significant rewrite of enrichment pipeline)
n8n/code/insiderbuying/dexter-research.js ← MODIFY (add Alpha Vantage functions)

tests/insiderbuying/sec-monitor.test.js   ← MODIFY (add new pipeline tests)
n8n/tests/dexter-research.test.js         ← MODIFY (add Alpha Vantage tests)
```

---

## Tests First

### Alpha Vantage tests — `n8n/tests/dexter-research.test.js`

Add these test cases to the existing file (using Node.js native test runner, `node:test`). Do not break any existing `describe` blocks.

```
// alphaVantage.getEarningsCalendar

// Test: standard CSV with no commas in company names
// Input: mock AV response CSV:
//   symbol,name,reportDate,fiscalDateEnding,estimate,currency
//   AAPL,Apple Inc,2025-04-30,2025-03-31,1.65,USD
//   MSFT,Microsoft Corp,2025-04-25,2025-03-31,3.12,USD
// Expected: Map with AAPL → { reportDate: '2025-04-30', fiscalDateEnding: '2025-03-31', estimate: '1.65' }
//           Map with MSFT → { reportDate: '2025-04-25', ... }

// Test: CSV with quoted company name containing a comma
// Input row: AAPL,"Apple, Inc.",2025-04-30,2025-03-31,1.65,USD
// Expected: reportDate for AAPL is still '2025-04-30' (comma inside quotes does not split)

// Test: estimate column is empty string
// Input row: XYZ,Some Co,2025-05-01,2025-03-31,,USD
// Expected: estimate stored as null, not empty string

// Test: NocoDB cache hit for ticker='__all__', data_type='earnings_calendar', not expired
// Expected: Alpha Vantage API NOT called, cached Map returned

// Test: NocoDB cache miss (no record found)
// Expected: Alpha Vantage API called once, result written to NocoDB under ticker='__all__'

// getNextEarningsDate (pure function, no mocks needed)

// Test: ticker present in Map → returns reportDate string
// Test: ticker absent from Map → returns null
// Test: null/undefined Map → returns null without throw
```

### sec-monitor.js tests — `tests/insiderbuying/sec-monitor.test.js`

Add these test cases to the existing Jest test file. All existing cluster detection tests must remain in place and still pass — do not modify them.

```
// End-to-end enrichment pipeline

// Test: EFTS returns 2 filings; Filing 1 is valid buy; Filing 2 returns null from fetchForm4Xml
// Setup:
//   edgar-parser.fetchRecentFilings mock → 2 Filing objects
//   fetchForm4Xml mock:
//     call 1 → valid standard-buy XML string (1 nonDerivativeTransaction, code P)
//     call 2 → null (simulates 404 for both primary and index fallback)
// Expected:
//   1 alert created (Airtable write called once)
//   failureCount incremented by 1 (for the null-fetch filing)
//   no throw

// Test: Amendment handling
// Setup:
//   fetchRecentFilings mock → 1 Filing
//   parseForm4Xml mock → returns object with isAmendment=true
// Expected:
//   0 alerts created (Airtable write NOT called)
//   INFO log emitted (check console.log or logger mock)
//   failureCount unchanged (amendment skip is NOT a failure)

// Test: filterScorable whitelist in pipeline
// Setup:
//   fetchRecentFilings → 1 Filing
//   parseForm4Xml → { isAmendment: false, nonDerivativeTransactions: [
//     { transactionCode: 'P', ... },
//     { transactionCode: 'P', ... },
//     { transactionCode: 'G', ... },   ← gift, should NOT generate alert
//   ]}
// Expected:
//   2 alerts created (only P transactions)
//   3 dedup keys stored (ALL 3 transactions, including the gift)

// Test: Dual dedup key — semantic match blocks re-alert
// Setup:
//   Airtable passesDedup mock returns false for semantic key
//     {ticker}_{ownerName}_{transactionDate}_{shares}
// Expected:
//   0 alerts created (skipped by semantic dedup)
//   No failureCount increment (dedup skip is not a failure)

// Test: Monitor_State timestamp watermark
// Verify that deduplicateFilings is called with lastCheckTimestamp from Monitor_State
// Verify that after a successful run, last_check_timestamp updated to ~Date.now()

// Cluster detection regression
// All existing cluster detection tests must pass with no modifications
```

---

## Implementation Details

### Part A: Alpha Vantage Earnings Calendar (`dexter-research.js`)

**New environment variable:** `ALPHA_VANTAGE_API_KEY` — add to `.env` and document in env var table.

**`alphaVantage.getEarningsCalendar(apiKey, fetchFn)`**

Fetches `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={apiKey}`. The response content type is `text/csv`.

Cache strategy:
1. Call `readCache('__all__', 'earnings_calendar', nocoClient)` — if unexpired hit exists, parse `data_json` (stored as JSON string of the Map entries array) and return the reconstituted Map.
2. On cache miss: fetch from Alpha Vantage, parse the CSV, write to NocoDB under `ticker='__all__'` and `data_type='earnings_calendar'`.

CSV parsing — use a regex-based split that respects quoted fields containing commas:
```javascript
// Split pattern that ignores commas inside double quotes:
const splitCsvLine = (line) => line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
```
Strip surrounding quotes from each field after splitting. Skip the header row (first line). Build a `Map<string, { reportDate, fiscalDateEnding, estimate }>` where `estimate` is `null` if the CSV field is an empty string.

Returns the Map on success. Returns empty Map (not null) on any failure — callers treat missing earnings date as `null` and that is acceptable.

**NocoDB serialization note:** A JS `Map` cannot be JSON-stringified directly. Serialize as `JSON.stringify([...map.entries()])` when writing cache. Deserialize with `new Map(JSON.parse(str))` when reading.

**`getNextEarningsDate(ticker, calendarMap)`**

Pure function. Returns `calendarMap.get(ticker)?.reportDate ?? null`. Handles null/undefined `calendarMap` by returning `null`.

---

### Part B: sec-monitor.js Enrichment Pipeline Rewrite

**Goal:** Remove all calls to Financial Datasets API and replace with the `edgar-parser.js` XML flow.

#### What to Import

At the top of `sec-monitor.js`, add:
```javascript
const {
  fetchRecentFilings,
  deduplicateFilings,
  fetchForm4Xml,
  parseForm4Xml,
  filterScorable,
  classifyInsiderRole,
} = require('./edgar-parser');
```

Remove: all `FINANCIAL_DATASETS_API_KEY` usage, the Financial Datasets fetch call, and any helper that wraps it.

#### New Enrichment Pipeline Flow

Replace the old "EFTS → Financial Datasets" flow with:

```
1. edgar-parser.fetchRecentFilings(6, fetchFn)
     → Filing[]  (each has: accessionNumber, filedAt, issuerName, issuerCik, ticker)

2. deduplicateFilings(filings, monitor_state.last_check_timestamp)
     → only filings newer than the last watermark

3. For each filing:
   a. If isAmendment:
        - log at INFO level: "Skipping 4/A amendment: {accessionNumber}"
        - continue (no failureCount increment)

   b. fetchForm4Xml(issuerCik, accessionNumber, fetchFn)
        - On null: failureCount++, continue

   c. parseForm4Xml(xmlString)
        - On null: failureCount++, continue

   d. Store dedup keys for ALL transactions in the parsed object
        (nonDerivativeTransactions + derivativeTransactions combined)
        BEFORE calling filterScorable.
        Dedup key format: "{accessionNumber}_{index}" (primary)
        Secondary key: "{ticker}_{ownerName}_{transactionDate}_{shares}"

   e. filterScorable(allTransactions)
        → only P and S codes proceed to alert creation

   f. For each scorable transaction:
        - If either dedup key matches existing Airtable record → skip (not a failure)
        - Otherwise: create one alert record
```

**Amendment detection:** `parseForm4Xml` returns `isAmendment` bool. Check this BEFORE calling `fetchForm4Xml` — wait, amendment detection requires parsing the XML first. The check is: after `parseForm4Xml`, if `result.isAmendment === true`, log and skip without writing alert or dedup keys. The `isAmendment` field is only available after parsing.

Correct order:
1. Fetch XML
2. Parse XML (`parseForm4Xml`)
3. Check `isAmendment` → if true, log INFO and `continue`
4. Store dedup keys
5. `filterScorable`
6. Create alerts

#### Alert Record Shape

Each alert record corresponds to one scorable transaction, not one filing. The `transactionIndex` is the zero-based position within the filing's combined `nonDerivativeTransactions` + `derivativeTransactions` array.

**Primary dedup key:** `{accessionNumber}_{transactionIndex}` (e.g., `0001234567-25-000001_0`)

**Secondary semantic dedup key:** `{ticker}_{ownerName}_{transactionDate}_{shares}`

If EITHER key matches an existing Airtable record in the 7-day lookback window, skip this transaction. This is not a failure.

#### Monitor_State Watermark

After a successful run (all filings processed, even if some failed individually):
- Update `last_check_timestamp` to `new Date().toISOString()`

On partial failure (some filings failed to fetch/parse but the run did not abort):
- Still update the watermark to prevent permanent retry of unfetchable filings

The existing rollback logic on catastrophic failure (e.g., Airtable write fails completely) is preserved unchanged.

#### What to Preserve Unchanged

- `detectCluster()` — do not touch
- `passesDedup()` — do not touch (it already handles both key formats if you pass both)
- Telegram error alerting (failure threshold, message format)
- Monitor_State rollback logic
- All Airtable write helpers
- All Supabase write helpers
- `classifyInsiderRole()` — this function moves to `edgar-parser.js` (Section 03 already did this). Import it from there instead of keeping a local copy.

#### Remove

- `FINANCIAL_DATASETS_API_KEY` — remove from all `process.env` reads
- Any function that calls `https://api.financialdatasets.ai/`
- `lastAccessionNumber` — remove entirely. Accession numbers are CIK-prefixed, not timestamp-sortable. Timestamp watermark is the only correct ordering mechanism.

---

## Environment Variables

New variables introduced in this section:

| Variable | Module | Notes |
|---|---|---|
| `ALPHA_VANTAGE_API_KEY` | `dexter-research.js` | Free tier, 25 calls/day |

Variables to remove:

| Variable | Module | Action |
|---|---|---|
| `FINANCIAL_DATASETS_API_KEY` | `sec-monitor.js`, `dexter-research.js` | Delete all references |

Variables that are unchanged (already in place from prior sections):

| Variable | Module |
|---|---|
| `FINNHUB_API_KEY` | `dexter-research.js` |
| `NOCODB_FINANCIAL_CACHE_TABLE_ID` | `dexter-research.js` |
| `NOCODB_BASE_URL` | `dexter-research.js` |
| `NOCODB_API_TOKEN` | `dexter-research.js` |
| `AIRTABLE_*`, `SUPABASE_*`, `TELEGRAM_*` | `sec-monitor.js` |

---

## Key Edge Cases

**Quoted commas in CSV:** Company names like `"Apple, Inc."` will break a naive `.split(',')`. Use the regex-based split shown above. Test this explicitly with a fixture row containing a quoted comma.

**`estimate` field as empty string:** The AV CSV omits estimate when unavailable, leaving `,,` in the row. After splitting, the field is `""` (empty string). Store as `null`, not `""`.

**Map serialization in NocoDB:** `JSON.stringify(new Map(...))` produces `{}`. Always use `JSON.stringify([...map.entries()])` and `new Map(JSON.parse(str))` for round-tripping.

**NocoDB `data_json` field size:** The full 3-month earnings calendar serialized to JSON can be large. Ensure the `data_json` column in the `Financial_Cache` NocoDB table is `LONGTEXT` or `JSON` type, not `VARCHAR(255)`.

**Amendment is not a failure:** When `isAmendment === true`, emit an INFO log and skip. Do NOT increment `failureCount`. Amendments are expected and normal; they should not trigger Telegram alerts.

**filterScorable stores ALL dedup keys first:** The dedup key for a gift transaction (code G) must be stored even though no alert is created for it. This prevents the gift transaction from being reprocessed on the next run as though it were new.

**`lastAccessionNumber` removal:** The old Monitor_State schema may have this field. It is safe to leave it in existing NocoDB records (ignored) but the new code must not write it or read it. Only `last_check_timestamp` is used for ordering.

---

## Definition of Done for This Section

1. `grep -r "financial-datasets\|FINANCIAL_DATASETS" n8n/code/insiderbuying/ -i --include="*.js"` returns 0 matches.
2. Alpha Vantage CSV parsing test passes with a quoted-comma company name fixture.
3. `getNextEarningsDate` returns `null` for unknown tickers.
4. sec-monitor.js enrichment pipeline: 2-filing EFTS mock test passes (1 alert, 1 failure count).
5. Amendment filing (4/A) skipped with INFO log, zero alerts, zero failureCount increment.
6. Multi-transaction filing: 3 transactions (2×P, 1×G) → 2 alerts, 3 dedup keys stored.
7. All existing cluster detection tests pass (zero regressions).
8. Full test suite passes: `npm test` (Jest) + `node n8n/tests/dexter-research.test.js` (native runner).
