<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npm test
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-edgar-rss-discovery
section-02-form4-xml-parser
section-03-transaction-classification
section-04-finnhub-integration
section-05-alphavantage-secmonitor-rewrite
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-edgar-rss-discovery | — | 02, 05 | Yes (with 04) |
| section-02-form4-xml-parser | 01 | 03, 05 | No |
| section-03-transaction-classification | 02 | 05 | No |
| section-04-finnhub-integration | — | 05 | Yes (with 01) |
| section-05-alphavantage-secmonitor-rewrite | 01, 02, 03, 04 | — | No |

## Execution Order

1. **section-01** + **section-04** in parallel (no dependencies)
2. **section-02** (after section-01)
3. **section-03** (after section-02)
4. **section-05** (after all of 01, 02, 03, 04)

## Section Summaries

### section-01-edgar-rss-discovery
Create `edgar-parser.js` module with the EDGAR EFTS feed discovery layer. Implements `buildEdgarRssUrl()`, `fetchRecentFilings()`, and `deduplicateFilings()` (timestamp-based). Includes the shared dual-rate limiter (110ms delay + 60-r/min token bucket) used by all EDGAR requests. Tests mock EFTS JSON responses including missing-ticker edge case.

### section-02-form4-xml-parser
Add `fetchForm4Xml()` and `parseForm4Xml()` to `edgar-parser.js`. Implements predictable-URL-first index discovery strategy with fallback to `index.json`. Regex-based XML parsing with entity decoding and namespace-prefix support. Tests use 5 inline fixture XML strings: standard buy, Form 4/A, gift (null price), option exercise, multi-transaction.

### section-03-transaction-classification
Add classification and filtering functions to `edgar-parser.js`: `classifyTransaction()`, `classifyInsiderRole()` (20 title variants), `filterScorable()` (P/S whitelist), and `calculate10b5Plan()` (dual legacy/modern schema detection). Tests verify all 20 title mappings, whitelist behavior, and 10b5 flag detection.

### section-04-finnhub-integration
Add Finnhub data layer to `dexter-research.js`: `TokenBucket` rate limiter (5-token steady drip), NocoDB cache read/write helpers, four Finnhub fetchers (`getQuote`, `getProfile`, `getBasicFinancials`, `getInsiderTransactions`). Update `fetchFinancialData()` with new `DATA_WEIGHTS` (sum to 1.0). Cache writes collected and awaited via `Promise.allSettled` before function returns. Tests use Node native runner.

### section-05-alphavantage-secmonitor-rewrite
Final integration section: (a) Add Alpha Vantage earnings calendar to `dexter-research.js` with quoted-comma CSV parsing and daily NocoDB cache. (b) Rewrite `sec-monitor.js` enrichment pipeline: replace Financial Datasets calls with `edgar-parser` XML flow, one-alert-per-transaction, whitelist dedup storage, amendment skip logic, timestamp-based Monitor_State watermark. Remove all `FINANCIAL_DATASETS_API_KEY` references. Verify cluster detection regression tests still pass.
