# Spec: 09-data-pipeline

## Purpose
Replace the paid Financial Datasets API with free data sources: SEC EDGAR (direct XML parsing), Finnhub free tier (quotes, market cap, earnings dates), and Alpha Vantage free tier (earnings calendar). Create `edgar-parser.js` as the core Form 4 parsing module. Update `sec-monitor.js` and `dexter-research.js` to use the new stack.

## Scope
**Files modified**: sec-monitor.js, dexter-research.js
**Files created**: `edgar-parser.js` — SEC EDGAR RSS + XML Form 4 parser
**Tests created**: edgar-parser.test.js

## Constraints
- EDGAR API: no auth required, User-Agent header MUST be `EarlyInsider/1.0 (contact@earlyinsider.com)` per SEC fair access policy
- Finnhub free: 60 API calls/minute. Use for: real-time quote, market cap, basic financials, earnings calendar
- Alpha Vantage free: 25 calls/day (premium 500/day). Use for: earnings calendar (batch, once daily)
- CommonJS only, `require('https')` for HTTP calls
- EDGAR rate limit: max 10 req/sec. Build in 100ms delays between requests
- Form 4 edge cases to handle: amended filings (Form 4/A), derivative transactions, $0 price (gifts/options exercise), multiple transactions per filing XML, non-standard issuer names

## Sections

### Section 1: EDGAR RSS Feed Discovery
In `edgar-parser.js`:
- `buildEdgarRssUrl(opts)` — constructs EDGAR full-text search RSS URL for Form 4 filings
  - Filter: `type=4` (Form 4), last N hours (default 6h), sort by filed date
  - URL: `https://efts.sec.gov/LATEST/search-index?q=%22form+4%22&dateRange=custom&startdt={date}&forms=4`
- `fetchRecentFilings(hours)` — fetches RSS, returns array of `{accessionNumber, filedAt, issuerName, issuerCik}`
- `deduplicateFilings(filings, lastProcessedId)` — filter only new since last run
- Test with mocked HTTPS response of real EDGAR RSS XML

### Section 2: Form 4 XML Parser
In `edgar-parser.js`:
- `fetchForm4Xml(accessionNumber)` — builds primary document URL, fetches XML
  - URL pattern: `https://www.sec.gov/Archives/edgar/data/{cik}/{accession-formatted}/{accession}-index.htm` → find primary XML document
- `parseForm4Xml(xmlString)` — extract all fields:
  - Issuer: CIK, name, ticker
  - Reporting owner: CIK, name, title (CEO/CFO/Director/etc.)
  - Is director, is officer, is 10% owner flags
  - Officer title string (parse to canonical role)
  - Transactions array: date, shares, pricePerShare, acquiredDisposed (A/D), transactionCode (P/S/G/F/M/X)
  - Derivative vs non-derivative table distinction
  - Relationship to issuer changes
- Handle Form 4/A (amended): detect `<amendmentType>A</amendmentType>`, mark as amendment
- Handle $0 price: gifts (code G), option exercises (code M/X) — do NOT exclude, flag differently
- Handle multiple transactions: return array, not single transaction
- Test with 5 real Form 4 XML samples: standard buy, amended, gift, option exercise, cluster buy

### Section 3: Transaction Filtering + Classification
In `edgar-parser.js`:
- `classifyTransaction(transaction)` — returns type: `purchase` | `sale` | `gift` | `option_exercise` | `tax_withholding` | `other`
  - P = purchase, S = sale, G = gift, F = tax withholding (exclude from scoring), M/X = option exercise
- `classifyInsiderRole(officerTitle)` — returns canonical role: `CEO` | `CFO` | `President` | `COO` | `Director` | `VP` | `Other`
  - Handle aliases: "Chief Executive Officer", "Chief Executive", "CEO" → CEO
  - Handle: "Principal Financial Officer" → CFO
- `filterScorable(transactions)` — remove Gift (G) and Tax withholding (F) from scoring pipeline
- `calculate10b5Plan(transaction)` — detect 10b5-1 plan flag in XML `<transactionCoded>` element
- Tests: role classification for 20 common title variations

### Section 4: Finnhub Integration
In `dexter-research.js`:
- Replace `fetchFinancialData()` Financial Datasets calls → Finnhub free API
- `finnhub.getQuote(ticker)` — current price, change%, high/low. Endpoint: `GET /quote?symbol={ticker}`
- `finnhub.getProfile(ticker)` — company name, market cap, sector, industry. Endpoint: `GET /stock/profile2?symbol={ticker}`
- `finnhub.getBasicFinancials(ticker)` — P/E, EPS, revenue, margins. Endpoint: `GET /stock/metric?symbol={ticker}&metric=all`
- `finnhub.getEarningsCalendar(ticker)` — next earnings date. Endpoint: `GET /calendar/earnings?symbol={ticker}`
- Rate limit guard: track calls/minute, sleep if approaching 60/min
- Cache results in NocoDB `Financial_Cache` with 24h TTL (existing pattern)
- Env var: `FINNHUB_API_KEY`
- Tests: mock Finnhub responses for all 4 endpoints

### Section 5: Alpha Vantage Earnings + sec-monitor Rewrite
Alpha Vantage in `dexter-research.js`:
- `alphaVantage.getEarningsCalendar()` — batch fetch all upcoming earnings (3 months). Endpoint: `GET /query?function=EARNINGS_CALENDAR&horizon=3month`
- Returns CSV — parse with split/map
- Cache full calendar in NocoDB daily (single call for all tickers, not per-ticker)
- `getNextEarningsDate(ticker)` — lookup from cached calendar

sec-monitor.js rewrite:
- Replace Financial Datasets Form 4 polling → EDGAR RSS via `edgar-parser.fetchRecentFilings()`
- Replace raw record creation → `edgar-parser.parseForm4Xml()` + `classifyTransaction()` + `filterScorable()`
- Remove Financial Datasets dedup logic → use EDGAR `accessionNumber` as dedup key
- Update Monitor_State to store `lastAccessionNumber` instead of Airtable record ID
- Preserve: cluster detection logic (compare last 7 days + 14 days in NocoDB), error alerting to Telegram
- Remove: `FINANCIAL_DATASETS_API_KEY` env var reference

## Technical Reference

### EDGAR XML Structure (Form 4)
```xml
<ownershipDocument>
  <issuer>
    <issuerCik>0001045810</issuerCik>
    <issuerName>NVIDIA CORP</issuerName>
    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerName>Jensen Huang</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isOfficer>1</isOfficer>
      <officerTitle>President and CEO</officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2024-11-15</value></transactionDate>
      <transactionAmounts>
        <transactionShares><value>100000</value></transactionShares>
        <transactionPricePerShare><value>145.23</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <transactionCoding>
        <transactionCode>P</transactionCode>
      </transactionCoding>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>
```

### Free API Limits
| API | Free Limit | Usage Plan |
|-----|-----------|-----------|
| SEC EDGAR | Unlimited (10 req/sec) | Primary data source |
| Finnhub | 60 calls/min | Quote + profile + financials per alert |
| Alpha Vantage | 25 calls/day | 1 daily batch for earnings calendar |

## Test Requirements
- edgar-parser.test.js: 5 fixture XML files (standard, amended, gift, option, multi-transaction)
- classifyInsiderRole: 20 title variation inputs, correct canonical output
- filterScorable: verify G and F codes excluded
- Finnhub mock: all 4 endpoints return correct shapes
- sec-monitor.test.js: end-to-end mock from EDGAR RSS → parsed filing ready for scoring

## Definition of Done
- `grep -r "financial-datasets\|FINANCIAL_DATASETS" n8n/code/insiderbuying/ -i --include="*.js"` = 0 matches
- `edgar-parser.js` handles all 5 Form 4 variants without throwing
- All tests pass
- `FINNHUB_API_KEY` and `ALPHA_VANTAGE_API_KEY` documented in env var list
