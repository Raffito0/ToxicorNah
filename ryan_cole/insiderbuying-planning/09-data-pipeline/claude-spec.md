# Complete Specification: 09-data-pipeline

## Purpose

Replace the paid Financial Datasets API with three free data sources:
- **SEC EDGAR** (direct XML Form 4 parsing) — primary Form 4 source
- **Finnhub free tier** — real-time quotes, company profile, basic financial metrics, earnings calendar, stock candles
- **Alpha Vantage free tier** — batch earnings calendar (single daily call)

Create a new module `edgar-parser.js` as the core Form 4 parsing engine. Rewrite the enrichment layer in `sec-monitor.js` and the financial data layer in `dexter-research.js` to use the new stack.

## Files Affected

| File | Action |
|------|--------|
| `n8n/code/insiderbuying/edgar-parser.js` | CREATE — SEC EDGAR RSS + XML Form 4 parser |
| `n8n/code/insiderbuying/sec-monitor.js` | MODIFY — replace Financial Datasets enrichment → edgar-parser |
| `n8n/code/insiderbuying/dexter-research.js` | MODIFY — replace Financial Datasets financial data → Finnhub + AV |
| `tests/insiderbuying/edgar-parser.test.js` | CREATE — Jest tests with 5 fixture XML files |
| `tests/insiderbuying/sec-monitor.test.js` | MODIFY — update mocks for EDGAR-based enrichment |
| `n8n/tests/dexter-research.test.js` | MODIFY — add Finnhub/AV mock tests |

## Architecture Decisions (from interview)

### Multi-transaction handling
One alert per **transaction** (not per filing). A single Form 4 XML may contain multiple `<nonDerivativeTransaction>` elements (e.g., 3-day purchase spread). Each transaction gets its own dedup key, cluster check, and Airtable alert record. This matches how SEC data actually works and is more granular than the previous single-transaction-per-filing approach.

### Dedup key change
New key: **EDGAR accessionNumber** (e.g., `0001234567-25-000001`) + transaction index for multi-transaction filings: `{accessionNumber}_{txIndex}`.
Old key: `{ticker}_{insider_name}_{transaction_date}_{shares}`.
Migration: accept tolerable one-time duplication for the 7-day lookback window when switching.

### NocoDB cache location
Finnhub fetch + NocoDB cache read/write implemented **inside dexter-research.js** (not via separate n8n HTTP nodes). This makes the code node self-contained and testable. Cache operations use the existing `NOCODB_BASE_URL` / `NOCODB_API_TOKEN` env vars.

### Financial data coverage and scoring weights
Old weights (Financial Datasets): income_statements=0.25, stock_prices=0.25, balance_sheets=0.10, cash_flow=0.10, ratios=0.10, insider_trades=0.10, competitors=0.10

New weights (Finnhub-based), proportionally redistributed:
- `quote_profile`: 0.25 (real-time price, company name, market cap, sector — replaces income_statements proxy)
- `basic_metrics`: 0.25 (PE, EPS, revenue, margins, 52-week high/low — replaces ratios + balance_sheets + cash_flow)
- `stock_prices`: 0.25 (1-year candle history, same as before)
- `competitors`: 0.10 (fetched externally by n8n, unchanged)
- `insider_trades`: 0.15 (Finnhub `/stock/insider-transactions` replaces Financial Datasets insider_trades; weight bumped from 0.10 since it's still available free)

Total: 1.0. `insider_trades` is no longer fetched in dexter-research.js's enrichment call (was 50 records from Financial Datasets) — replaced by Finnhub's endpoint at the lower weight.

### Filing index discovery
Try predictable URL patterns first: `{accessionNoDash}/{accessionNoDash}.xml`. Fall back to fetching `index.json` if the predictable path returns 404. This minimizes EDGAR calls in the happy path while remaining reliable.

### Historical insider trades in dexter-research.js
Drop. The live EDGAR monitoring via sec-monitor.js already captures this. Reduces Finnhub quota usage.

## Constraints

- **CommonJS only**: `require('https')`, `require('url')`, `require('zlib')` — no external HTTP libraries
- **EDGAR rate limit**: 10 req/s per IP; 110ms minimum delay between requests
- **EDGAR User-Agent**: `EarlyInsider/1.0 (contact@earlyinsider.com)` — required by SEC fair access policy
- **Finnhub rate limit**: 60 calls/min; token bucket guard; 429 retry with exponential backoff
- **Alpha Vantage rate limit**: 25 calls/day; called ONCE daily for full earnings calendar batch, cached in NocoDB
- **NocoDB cache TTL**: 24h for all Finnhub data; 24h for earnings calendar
- **NocoDB v2 API**: uses tableId (not table name), `xc-token` auth, PATCH body requires `Id` field
- **Jest for new tests**: edgar-parser.test.js and sec-monitor.test.js changes use Jest (matching existing `tests/insiderbuying/` convention)
- **No changes to cluster detection logic**: preserve exactly as-is

## Detailed Functional Specification

### Module 1: edgar-parser.js (new file)

#### Section 1 — EDGAR RSS Feed Discovery

`buildEdgarRssUrl(opts)`:
- Constructs EFTS search URL: `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt={date}&enddt={today}`
- Default window: last 6 hours
- Returns URL string

`fetchRecentFilings(hours, fetchFn)`:
- Calls buildEdgarRssUrl, fetches JSON from EFTS
- Parses `hits.hits[]._source` for each result:
  - `file_num` → accessionNumber (as-is with dashes)
  - `file_date` → filedAt (ISO date)
  - `entity_name` → issuerName
  - `display_names[0]` → parse ticker with regex `/\(([A-Z]+)\) \(CIK (\d+)\)/` → ticker + issuerCik
- Returns `Array<{ accessionNumber, filedAt, issuerName, issuerCik, ticker }>`

`deduplicateFilings(filings, lastProcessedAccession)`:
- Returns only filings with accessionNumber > lastProcessedAccession (lexicographic sort is valid since accession numbers are chronological)

#### Section 2 — Form 4 XML Parser

`fetchForm4Xml(issuerCik, accessionNumber, fetchFn)`:
- Build URL: `https://www.sec.gov/Archives/edgar/data/{cik}/{accNoDash}/{accNoDash}.xml`
- Attempt fetch with 10s timeout
- If 404: fetch `index.json` from same base path, parse `directory.item[]` to find `.xml` file, retry
- Returns raw XML string

`parseForm4Xml(xmlString)`:
- Uses `extractValue(xml, tagName)` + `extractBlocks(xml, tagName)` regex helpers (no XML library)
- Extracts:
  - `documentType` (from `<documentType>`) — '4' or '4/A'
  - `issuerCik`, `issuerName`, `issuerTicker`
  - `ownerName`, `ownerCik`, `isOfficer` (bool), `isDirector` (bool), `officerTitle`
  - `nonDerivativeTransactions[]`: each with `transactionDate`, `shares`, `pricePerShare`, `acquiredDisposed`, `transactionCode`, `sharesAfter`
  - `derivativeTransactions[]`: each with above plus `exercisePrice`, `expirationDate`, `underlyingSecurityTitle`
  - `isAmendment` (bool) = documentType === '4/A'
- Returns structured object; malformed XML returns `null` (never throws)

#### Section 3 — Transaction Classification

`classifyTransaction(transaction)`:
- Returns type string based on `transactionCode`:
  - P → `purchase`, S → `sale`, G → `gift`, F → `tax_withholding`, M/X → `option_exercise`, A → `award`, D → `disposition`, default → `other`

`classifyInsiderRole(officerTitle)`:
- Returns canonical role: `CEO | CFO | President | COO | Director | VP | Other`
- Handle aliases: "Chief Executive Officer" → CEO, "Principal Financial Officer" → CFO, "EVP" / "Executive Vice President" → VP, etc.
- 20+ title variation mappings

`filterScorable(transactions)`:
- Remove G (gift) and F (tax withholding) from scoring pipeline
- Returns filtered array

`calculate10b5Plan(xmlBlock)`:
- Detects `<rule10b5One>1</rule10b5One>` flag in `<transactionCoding>` element
- Returns bool

#### Section 4 — Finnhub Integration (in dexter-research.js)

Implement four Finnhub fetchers, each wrapping `fetchFn` (injectable):

`finnhub.getQuote(ticker, apiKey, fetchFn)`:
- `GET /api/v1/quote?symbol={ticker}&token={apiKey}`
- Returns `{ c, h, l, o, pc, d, dp }` (current, high, low, open, prev_close, change, change_pct)

`finnhub.getProfile(ticker, apiKey, fetchFn)`:
- `GET /api/v1/stock/profile2?symbol={ticker}&token={apiKey}`
- Returns `{ name, marketCapitalization, exchange, finnhubIndustry, country, currency }`

`finnhub.getBasicFinancials(ticker, apiKey, fetchFn)`:
- `GET /api/v1/stock/metric?symbol={ticker}&metric=all&token={apiKey}`
- Returns `{ metric: { peBasicExclExtraTTM, epsBasicExclExtraAnnual, revenueGrowth3Y, ... } }`

`finnhub.getEarningsCalendar(ticker, apiKey, fetchFn)`:
- `GET /api/v1/calendar/earnings?symbol={ticker}&token={apiKey}`
- Returns next earnings date from `earningsCalendar[0].date`

Rate limit guard: `TokenBucket({ capacity: 60, refillRate: 60, refillInterval: 60000 })`. All four Finnhub calls share one bucket. Each call acquires a token before executing.

NocoDB cache: Before each Finnhub call, check `Financial_Cache` for `(ticker, data_type)` pair where `expires_at > NOW()`. If cache hit, return `JSON.parse(data_json)`. On cache miss: fetch from Finnhub, then upsert NocoDB record (search-then-create-or-update).

**New DATA_WEIGHTS** (replaces old):
```javascript
const DATA_WEIGHTS = {
  quote_profile:   0.25,
  basic_metrics:   0.25,
  stock_prices:    0.25,
  competitors:     0.10,
  insider_trades:  0.15,
};
```

#### Section 5 — Alpha Vantage Earnings + sec-monitor Rewrite

Alpha Vantage in `dexter-research.js`:

`alphaVantage.getEarningsCalendar(apiKey, fetchFn)`:
- `GET /query?function=EARNINGS_CALENDAR&horizon=3month&apikey={apiKey}`
- Response is CSV — parse with `split('\n').slice(1).map(line => ...)`
- Returns `Map<ticker, { reportDate, fiscalDateEnding, estimate }>`

`getNextEarningsDate(ticker, calendarMap)`:
- Pure lookup from the cached calendar map
- Returns ISO date string or null

NocoDB cache for earnings calendar: store entire calendar as single record (`data_type='earnings_calendar_all'`), daily TTL. One Alpha Vantage call per day maximum.

**sec-monitor.js rewrite:**

Replace Financial Datasets enrichment call with EDGAR XML fetch + parse:
1. `fetchRecentFilings(6, fetchFn)` via edgar-parser — returns recent Form 4s with EFTS metadata
2. For each filing: `fetchForm4Xml(issuerCik, accessionNumber, fetchFn)` → `parseForm4Xml(xml)`
3. `filterScorable(transactions)` — remove G and F codes
4. For each remaining transaction: create alert record (one per transaction, not one per filing)
5. New dedup key: `{accessionNumber}_{transactionIndex}`
6. `Monitor_State` stores `lastAccessionNumber` instead of Airtable record ID

Remove: `FINANCIAL_DATASETS_API_KEY` env var usage. All Financial Datasets endpoints.

Preserve: cluster detection logic, error alerting to Telegram, Monitor_State timestamp management + rollback logic, `classifyInsiderRole()` (extend with new title aliases from edgar-parser).

## Environment Variables

| Variable | Used By | Status |
|----------|---------|--------|
| `FINNHUB_API_KEY` | dexter-research.js | NEW |
| `ALPHA_VANTAGE_API_KEY` | dexter-research.js | NEW |
| `FINANCIAL_DATASETS_API_KEY` | sec-monitor.js, dexter-research.js | REMOVE |
| `NOCODB_BASE_URL` | dexter-research.js | EXISTING |
| `NOCODB_API_TOKEN` | dexter-research.js | EXISTING |
| `AIRTABLE_API_KEY` | sec-monitor.js | UNCHANGED |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | sec-monitor.js | UNCHANGED |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | sec-monitor.js | UNCHANGED |

## Definition of Done

1. `grep -r "financial-datasets\|FINANCIAL_DATASETS" n8n/code/insiderbuying/ -i --include="*.js"` returns 0 matches
2. `edgar-parser.js` handles all 5 Form 4 variants (standard buy, Form 4/A, gift, option exercise, multi-transaction) without throwing
3. All Jest and native-runner tests pass
4. `FINNHUB_API_KEY` and `ALPHA_VANTAGE_API_KEY` documented in env var list
5. NocoDB cache in dexter-research.js: single Finnhub call per ticker per 24h under normal conditions
6. Cluster detection tests pass (no regression)

## Test Plan

| Test file | Framework | Key scenarios |
|-----------|-----------|---------------|
| `edgar-parser.test.js` | Jest | 5 XML fixtures: standard buy, 4/A amendment, gift ($0 price), option exercise (M code), 3-transaction cluster buy |
| `edgar-parser.test.js` | Jest | `classifyInsiderRole`: 20 title variation inputs |
| `edgar-parser.test.js` | Jest | `filterScorable`: verify G and F codes excluded |
| `sec-monitor.test.js` | Jest | End-to-end mock: EDGAR EFTS JSON → fetchForm4Xml → parseForm4Xml → filterScorable → alert creation |
| `sec-monitor.test.js` | Jest | Dedup using accessionNumber key |
| `sec-monitor.test.js` | Jest | Cluster detection (no regression — reuse existing test structure) |
| `dexter-research.test.js` | Node native | Finnhub mock: 4 endpoints return correct shapes |
| `dexter-research.test.js` | Node native | AV earnings calendar CSV parse |
| `dexter-research.test.js` | Node native | NocoDB cache: cache hit skips Finnhub call; cache miss triggers Finnhub + upsert |
| `dexter-research.test.js` | Node native | New DATA_WEIGHTS sum to 1.0; data_completeness calculation |
