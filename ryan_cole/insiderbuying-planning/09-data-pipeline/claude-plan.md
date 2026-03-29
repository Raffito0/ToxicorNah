# Implementation Plan: 09-data-pipeline

## Background and Goals

The EarlyInsider insider-buying alert system currently relies on the paid Financial Datasets API (financialdatasets.ai) for two purposes: (1) discovering new Form 4 insider-trade filings and enriching them with structured insider/transaction data, and (2) fetching company financial fundamentals (income statements, stock prices, ratios, etc.) for the Dexter research analysis. This plan replaces both paid usages with three free public sources: SEC EDGAR direct XML parsing, Finnhub free tier, and Alpha Vantage free tier.

The implementation introduces one new module (`edgar-parser.js`) and modifies two existing ones (`sec-monitor.js`, `dexter-research.js`). The cluster detection logic, Telegram alerting, Monitor_State persistence, and Airtable/Supabase writes in `sec-monitor.js` are preserved unchanged. The data completeness scoring model in `dexter-research.js` is recalibrated for the new data sources.

All code is CommonJS Node.js with no external dependencies added. All HTTP calls use `require('https')` with a lightweight internal helper that handles gzip decompression, redirects, and timeout via `req.destroy()`. Tests use Jest for `edgar-parser.test.js` and `sec-monitor.test.js`; `dexter-research.test.js` uses Node.js native test runner (`node:test`).

---

## Section 1: EDGAR RSS Feed Discovery

**Goal:** Implement the filing discovery layer in `edgar-parser.js` that provides sec-monitor.js with a structured list of new Form 4 filings, deduplication against the last processed timestamp, and all the metadata needed for XML parsing.

**Context:** `sec-monitor.js` already queries EFTS to get recent Form 4 filings. The new design makes `edgar-parser.js` responsible for this step. `sec-monitor.js` calls `fetchRecentFilings()` and iterates the returned array, passing each filing to the XML parser.

### Rate Limiting

All EDGAR requests share a single module-level dual-rate limiter: a per-request minimum delay of 110ms AND a minute-level `TokenBucket({ capacity: 58, refillRate: 58, refillInterval: 60000 })`. Every EDGAR HTTP call (both EFTS and XML fetches) acquires a token from the minute bucket before executing, and a 110ms sleep after. This ensures the system stays within both the 10 r/s and 60 r/min SEC limits.

All EDGAR requests include `User-Agent: EarlyInsider/1.0 (contact@earlyinsider.com)` — required by SEC fair access policy. Omitting it causes 403 or silently truncated results.

### Functions in edgar-parser.js

**`buildEdgarRssUrl(opts)`**

Constructs the EFTS search URL. The `opts` object accepts `hours` (default 6). When `hours` is specified, computes `startDate` as `now - hours` and `endDate` as now. Returns URL string targeting `https://efts.sec.gov/LATEST/search-index` with `forms=4`, `dateRange=custom`, the date range, and `size=2000` (the EFTS default page size is 100; bursts of up to 2000 filings per 6-hour window are handled).

**`fetchRecentFilings(hours, fetchFn)`**

Calls `buildEdgarRssUrl`, fetches the JSON response via `fetchFn`, and parses `hits.hits[]._source`:
- `file_num` → accessionNumber (with dashes)
- `file_date` → filedAt (ISO date string)
- `entity_name` → issuerName
- `display_names[0]` → parse with regex `/\(([A-Z]+)\) \(CIK (\d+)\)/` to extract `ticker` and `issuerCik`

When the `display_names` regex does not find a ticker (foreign issuers, trusts, funds), set `ticker: null`. The caller will later extract the ticker from the Form 4 XML's `<issuerTradingSymbol>` element. If CIK is also unavailable, skip the filing entirely.

Returns `Array<{ accessionNumber, filedAt, issuerName, issuerCik, ticker }>`. On any failure (network error, malformed JSON), returns `[]` and logs the error (also increments `failureCount` so the Telegram alert threshold is not bypassed).

**`deduplicateFilings(filings, lastCheckTimestamp)`**

Filters to only filings where `filedAt > lastCheckTimestamp`. The `lastCheckTimestamp` is an ISO date string stored in Monitor_State. This replaces the previously considered lexicographic accession number comparison — EDGAR accession numbers are NOT sortable by time (the first 10 digits are the filer's CIK, not a timestamp).

### Testing

- Mock EFTS JSON with two filings: standard ticker extraction, and one with missing ticker (fund/trust)
- Verify `fetchRecentFilings` returns correct structured array; ticker is null for fund case
- Verify `deduplicateFilings` filters by timestamp correctly
- Verify malformed EFTS response (unexpected JSON shape) returns empty array without throwing

---

## Section 2: Form 4 XML Parser

**Goal:** Fetch and parse a Form 4 XML document from SEC EDGAR into a structured object containing issuer, reporting owner, and all transactions. Handle the full range of Form 4 variants including amendments, multiple transactions, and missing fields.

### Filing Index Discovery Strategy

Most Form 4 XML documents follow the pattern `{accessionNoDash}/{accessionNoDash}.xml` at `https://www.sec.gov/Archives/edgar/data/{issuerCik}/`. Attempt this URL first. On 404, fall back to fetching `{accessionNoDash}/index.json`, filtering `directory.item[]` by `name` ending in `.xml` and `<Type>4</Type>` (to avoid picking up combined filings), and retrying. All requests include the EDGAR User-Agent header and use the shared dual-rate limiter from Section 1.

EDGAR XML responses are often gzip-compressed. The HTTPS helper (from `require('https')` + `require('zlib')`) handles `Accept-Encoding: gzip, deflate` and decompresses via `zlib.createGunzip()` pipe.

### XML Parsing Approach

The parser uses two internal regex helpers — no XML library dependency. After extraction, all string values run through `decodeXmlEntities()` which replaces `&amp;`, `&lt;`, `&gt;`, `&apos;`, `&quot;` and numeric entities (`&#xNN;`). This handles company and person names that contain encoded special characters.

Namespace-prefixed tags (e.g., `<edgar:transactionDate>`) are handled by using a looser regex: `/<(?:\w+:)?tagName>[\s\S]*?<\/(?:\w+:)?tagName>/i`.

### Functions in edgar-parser.js

**`buildForm4XmlUrl(issuerCik, accessionNumber)`**

Returns both the predictable primary URL (`{accNoDash}.xml`) and fallback index URL.

**`fetchForm4Xml(issuerCik, accessionNumber, fetchFn)`**

Fetches via the predictable URL. On 404, fetches index.json, finds the `.xml` file with `<Type>4</Type>`, and retries. Returns raw XML string, or `null` on failure.

**`parseForm4Xml(xmlString)`**

Returns a structured object or `null` on parse failure (never throws):

```
{
  documentType,       // '4' or '4/A'
  isAmendment,        // bool
  periodOfReport,     // 'YYYY-MM-DD'
  issuer: { cik, name, ticker },
  owner: { cik, name, isOfficer, isDirector, officerTitle },
  nonDerivativeTransactions: Transaction[],
  derivativeTransactions: Transaction[],
}
```

Each `Transaction`:
```
{
  transactionDate,    // 'YYYY-MM-DD'
  transactionCode,    // 'P','S','G','F','M','X','A','D','J'
  shares,             // number
  pricePerShare,      // number | null (null when element absent, not 0)
  acquiredDisposed,   // 'A' or 'D'
  sharesAfter,        // number
  directOwnership,    // 'D' or 'I'
  is10b5Plan,         // bool (see Section 3)
}
```

`pricePerShare` is `null` (not `0`) when the XML element is absent. `parseFloat` with `Number.isFinite` guard handles numeric strings including comma-formatted values (`"1,000"` → strip commas first).

### Testing

Five fixture XML strings in `edgar-parser.test.js`:
1. **Standard buy** — single `<nonDerivativeTransaction>`, code P, price $145.23
2. **Form 4/A amendment** — `<documentType>4/A</documentType>`, `isAmendment` must be true
3. **Gift ($0 price)** — code G, `<transactionPricePerShare>` element absent → `pricePerShare: null`
4. **Option exercise** — code M, `<derivativeTransaction>` block
5. **Multi-transaction cluster buy** — three `<nonDerivativeTransaction>` blocks; array length 3

Additional: entity-encoded company name (`&amp;` in issuerName), namespace-prefixed tags.

---

## Section 3: Transaction Filtering and Classification

**Goal:** Provide the classification and filtering layer so sec-monitor.js receives correctly typed, properly filtered transaction records.

### Functions in edgar-parser.js

**`classifyTransaction(transaction)`**

Maps `transactionCode` to a semantic type:
- P → `purchase`, S → `sale`, G → `gift`, F → `tax_withholding`, M/X → `option_exercise`, A → `award`, D → `disposition`, J → `other`, default → `other`

**`classifyInsiderRole(officerTitle)`**

Case-insensitive mapping to canonical role: `CEO | CFO | President | COO | Director | VP | Other`. Covers at minimum 20 known title variants:
- CEO: "Chief Executive Officer", "Principal Executive Officer", "CEO", "Chief Executive"
- CFO: "Chief Financial Officer", "Principal Financial Officer", "CFO"
- President: "President", "Co-President"
- COO: "Chief Operating Officer", "COO"
- Director: "Director", "Board Member", "Board Director", "Independent Director", "Non-Executive Director"
- VP: "Vice President", "VP", "Senior Vice President", "SVP", "EVP", "Executive Vice President", "Group Vice President"

**`filterScorable(transactions)`**

**Whitelist-based** (not blacklist): returns only transactions with `transactionCode === 'P'` (open-market purchase) or `transactionCode === 'S'` (open-market sale). All other codes — G, F, M, X, A, D, J, and unknowns — are excluded. This prevents option exercises (M/X) and compensation awards (A) from generating false-positive insider buying alerts.

Important: `sec-monitor.js` stores dedup keys for ALL transactions from a filing BEFORE calling `filterScorable`. Only alert record creation is gated by `filterScorable`. This prevents non-scorable transactions from being reprocessed on the next run.

**`calculate10b5Plan(xmlBlock)`**

Checks for **both** the legacy schema (`<rule10b5One><value>1</value>`) and the modern schema updated in April 2023 (`<rule10b51Transaction><value>1</value>` or `true`). Returns `true` if either is found (case-insensitive).

### Testing

- `classifyInsiderRole`: 20 inputs → expected canonical outputs. Unknown title → `Other`
- `filterScorable`: array with codes G, F, P, S, M, A → only P and S returned
- `calculate10b5Plan`: legacy element with `1`, modern element with `true`, absent element
- `classifyTransaction`: all 8+ codes mapped correctly

---

## Section 4: Finnhub Integration

**Goal:** Add Finnhub as the new financial data source in `dexter-research.js`, with a NocoDB cache layer (implemented inside the code node) and a rate limiter.

**Context:** `dexter-research.js` currently calls Financial Datasets API for all financial data. The new design adds four Finnhub fetchers and replaces the existing `fetchFinancialData()` parallel structure.

### Rate Limiter

A `TokenBucket` class (no external dependencies) with `capacity: 5`, `refillRate: 5`, `refillInterval: 5000ms` (provides 60 calls/minute without bursting more than 5 concurrent connections at once). All four Finnhub fetchers share one module-level bucket. Token acquired before initiating each request.

### NocoDB Cache Layer

Two internal helpers:

**`readCache(ticker, dataType, nocoClient)`**: Queries `Financial_Cache` with `where=(ticker,eq,{ticker})~and(data_type,eq,{dataType})`. Returns parsed `data_json` if record exists and `expires_at > Date.now()`. Returns `null` on miss or expiry.

**`writeCache(ticker, dataType, data, nocoClient)`**: Search-then-upsert. Queries for existing record, PATCH with updated `data_json` and new `expires_at = now + 24h` if found, POST new record if not. Cache writes are collected in `cacheWrites[]` and awaited via `Promise.allSettled(cacheWrites)` at the end of `fetchFinancialData()` — NOT fire-and-forget (n8n Code node process terminates before background promises settle).

NocoDB client uses `xc-token` header from `process.env.NOCODB_API_TOKEN`, base URL from `process.env.NOCODB_BASE_URL`, table ID from `process.env.NOCODB_FINANCIAL_CACHE_TABLE_ID`.

### Finnhub Fetchers

Four functions, each following the cache-check-then-fetch pattern. Each returns cached data if available; otherwise acquires rate limit token, fetches from Finnhub, writes cache, and returns data.

**`finnhub.getQuote(ticker, apiKey, fetchFn)`** — `/api/v1/quote`. Returns `{ c, h, l, o, pc, d, dp }`.

**`finnhub.getProfile(ticker, apiKey, fetchFn)`** — `/api/v1/stock/profile2`. Returns `{ name, marketCapitalization, exchange, finnhubIndustry, country, currency }`.

**`finnhub.getBasicFinancials(ticker, apiKey, fetchFn)`** — `/api/v1/stock/metric?metric=all`. Returns `{ metric: { peBasicExclExtraTTM, epsBasicExclExtraAnnual, revenueGrowth3Y, grossMarginTTM, ... } }`. All fields accessed defensively with `?? null`.

**`finnhub.getInsiderTransactions(ticker, apiKey, fetchFn)`** — `/api/v1/stock/insider-transactions`. Returns recent insider trade list for historical context.

Note: `finnhub.getEarningsCalendar` is NOT included — earnings calendar is provided exclusively by Alpha Vantage batch call (see Section 5).

### Updated fetchFinancialData and DATA_WEIGHTS

Four calls in parallel via `Promise.allSettled()`:

```
const DATA_WEIGHTS = {
  quote_profile:   0.25,
  basic_metrics:   0.25,
  stock_prices:    0.25,
  competitors:     0.10,
  insider_trades:  0.15,
};
```

`stock_prices` continues via Finnhub stock candles (`/api/v1/stock/candle`), 252 trading days of OHLCV. `competitors` fetched externally by n8n (unchanged). `insider_trades` from Finnhub at `0.15` weight.

Financial statements (`income_statements`, `balance_sheets`, `cash_flow`) and their combined 0.45 weight are dropped. Remaining sources are reweighted to sum to 1.0.

### Testing

- Mock all four Finnhub endpoints; verify correct return shapes
- Cache hit: mock NocoDB returning valid unexpired record → Finnhub NOT called
- Cache miss: mock NocoDB returning empty → Finnhub IS called, writeCache triggered
- Verify `Promise.allSettled(cacheWrites)` is awaited before function returns
- `DATA_WEIGHTS` values sum to exactly 1.0

---

## Section 5: Alpha Vantage Earnings + sec-monitor Rewrite

### Alpha Vantage Earnings Calendar (in dexter-research.js)

**`alphaVantage.getEarningsCalendar(apiKey, fetchFn)`**

Fetches `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={apiKey}`. Response is `text/csv`. Parse using a regex-based CSV split that respects quoted commas: `/,(?=(?:(?:[^"]*"){2})*[^"]*$)/`. Fields: `symbol`, `name`, `reportDate`, `fiscalDateEnding`, `estimate`, `currency`. `estimate` may be empty string → store as `null`.

Returns `Map<string, { reportDate, fiscalDateEnding, estimate }>` keyed by ticker symbol.

**Cache strategy:** Store entire calendar as single NocoDB record with `ticker='__all__'` and `data_type='earnings_calendar'`. TTL: 24h. The `data_json` field must be `LONGTEXT` or `JSON` type in NocoDB (not VARCHAR) to handle the full CSV converted to JSON. One Alpha Vantage call per day maximum.

**`getNextEarningsDate(ticker, calendarMap)`** — pure lookup, returns `reportDate` or `null`.

### sec-monitor.js Rewrite

**Enrichment pipeline replacement:**

Old flow: EDGAR EFTS → list of accession numbers → Financial Datasets `/insider-trades?ticker=X`

New flow:
1. `edgar-parser.fetchRecentFilings(6, fetchFn)` → `{ accessionNumber, filedAt, issuerName, issuerCik, ticker }[]`
2. `deduplicateFilings(filings, lastCheckTimestamp)` — filter to new filings only
3. For each filing where `isAmendment === false`:
   a. `fetchForm4Xml(issuerCik, accessionNumber, fetchFn)` → raw XML
   b. `parseForm4Xml(xml)` → structured object (skip if null)
   c. Store dedup keys for ALL transactions (including G/F/M/A) before filterScorable
   d. `filterScorable(transactions)` → only P and S codes
   e. For each scorable transaction: create one alert record
4. For `isAmendment === true` filings: log at INFO level, skip (amendment is not a new trade signal)

**Alert record dedup key (per-transaction):**

Primary key: `{accessionNumber}_{transactionIndex}` (e.g., `0001234567-25-000001_0`)
Secondary semantic key: `{ticker}_{ownerName}_{transactionDate}_{shares}` (preserved as fallback)

If EITHER key matches an existing Airtable record in the 7-day window, skip the transaction. This catches both the normal case (same accession number on rerun) and edge cases (data pipeline reprocessing old data with semantic matches).

**Monitor_State update:**

Revert to timestamp-based watermark only. After a successful run: update `last_check_timestamp` to current time. Rollback logic on partial failures is preserved unchanged.

Remove `lastAccessionNumber` concept entirely. The previous plan's use of accession numbers for ordering was architecturally wrong (CIK-prefix, not timestamp-prefix).

**Remove:** All `FINANCIAL_DATASETS_API_KEY` references.

**Preserve unchanged:** `detectCluster()`, `passesDedup()`, Telegram error alerting, Monitor_State rollback logic, Airtable/Supabase write patterns, `classifyInsiderRole()` (migrate to edgar-parser.js import).

### Testing

**End-to-end sec-monitor with EDGAR:**
- Mock EFTS returns 2 filings; first is a standard buy XML; second returns 404 on XML fetch
- Verify: 1 alert created for first filing; second filing skipped; `failureCount` incremented
- Verify: dedup keys stored for ALL transactions; alert only for scorable (P/S codes)

**Amendment handling:**
- Mock EFTS returns a `4/A` filing
- Verify: `isAmendment === true` → filing logged and skipped, no alert, no failureCount increment

**Multi-transaction filing:**
- XML with 3 `nonDerivativeTransactions` (2 P, 1 G) → 2 alerts (not 3), 3 dedup keys stored

**Cluster detection (regression):**
- All existing cluster detection test cases must pass without modification

---

## File Structure

```
n8n/code/insiderbuying/
  edgar-parser.js          ← NEW: Sections 1-3
  sec-monitor.js           ← MODIFIED: Section 5
  dexter-research.js       ← MODIFIED: Sections 4-5

tests/insiderbuying/
  edgar-parser.test.js     ← NEW: Sections 1-3 tests
  sec-monitor.test.js      ← MODIFIED: Section 5 tests

n8n/tests/
  dexter-research.test.js  ← MODIFIED: Sections 4-5 tests
```

---

## API Contracts

### edgar-parser.js exports

```javascript
// Fetchers
buildEdgarRssUrl(opts)                     → string
fetchRecentFilings(hours, fetchFn)          → Promise<Filing[]>
deduplicateFilings(filings, lastTimestamp)  → Filing[]
fetchForm4Xml(cik, accession, fetchFn)      → Promise<string|null>
parseForm4Xml(xmlString)                   → ParsedForm4|null

// Classification (pure)
classifyTransaction(tx)                    → string
classifyInsiderRole(title)                 → string
filterScorable(transactions)               → Transaction[]
calculate10b5Plan(xmlBlock)                → boolean
```

### Filing type

```
{ accessionNumber, filedAt, issuerName, issuerCik, ticker }
// ticker may be null for foreign/fund issuers
```

### Transaction type

```
{ transactionDate, transactionCode, shares, pricePerShare,
  acquiredDisposed, sharesAfter, directOwnership, is10b5Plan }
// pricePerShare: number | null (null = element absent in XML)
```

---

## Environment Variables

| Variable | Module | Status |
|----------|--------|--------|
| `FINNHUB_API_KEY` | dexter-research.js | NEW |
| `ALPHA_VANTAGE_API_KEY` | dexter-research.js | NEW |
| `NOCODB_FINANCIAL_CACHE_TABLE_ID` | dexter-research.js | NEW |
| `FINANCIAL_DATASETS_API_KEY` | both | REMOVE |
| `NOCODB_BASE_URL` | dexter-research.js | EXISTING |
| `NOCODB_API_TOKEN` | dexter-research.js | EXISTING |
| `AIRTABLE_*`, `SUPABASE_*`, `TELEGRAM_*` | sec-monitor.js | UNCHANGED |

---

## Definition of Done

1. `grep -r "financial-datasets\|FINANCIAL_DATASETS" n8n/code/insiderbuying/ -i --include="*.js"` = 0 matches
2. `edgar-parser.js` handles all 5 Form 4 variants without throwing
3. All Jest tests pass (`npm test`)
4. All native-runner tests pass (`node n8n/tests/dexter-research.test.js`)
5. `FINNHUB_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `NOCODB_FINANCIAL_CACHE_TABLE_ID` documented in env var list
6. NocoDB cache operational: second `dexterResearch()` call for same ticker within 24h = zero Finnhub calls
7. All existing cluster detection tests pass (no regression)
8. Amendment filings (4/A) are skipped with INFO log and no alert created

---

## Risk Notes

**EDGAR XML schema variance:** All modern Form 4s (post-2004) use the v3 schema. Polling only recent filings (6-hour window) means this is not a risk.

**Alpha Vantage CSV company name commas:** Handled by the regex-based CSV split. Tested with fixture data.

**One-time dedup duplication on cutover:** The 7-day Airtable lookback will not match new-format dedup keys for old filings. Tolerated — self-resolves within 7 days.

**NocoDB LONGTEXT field:** The `data_json` column in the `earnings_calendar` row stores the full 3-month CSV as JSON. Must be configured as LONGTEXT/JSON in NocoDB (not VARCHAR which has a 255-char limit).

**filterScorable whitelist change:** The existing sec-monitor.js code uses a blacklist approach. Changing to whitelist means any future transaction codes (e.g., hypothetical future SEC codes) are excluded by default — a conservative choice that is correct for this use case.
