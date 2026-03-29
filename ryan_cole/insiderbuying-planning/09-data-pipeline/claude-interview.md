# Interview Transcript: 09-data-pipeline

## Q1: Financial Data Coverage Gap (Finnhub free vs Financial Datasets)

**Question:** The current dexter-research.js fetches income statements, balance sheets, cash flow, ratios, and stock prices via Financial Datasets API — but Finnhub free tier doesn't include financial statements (those are paid). Finnhub free has: quote, profile, basic metrics, earnings calendar, and stock candles (price history). What should happen to the data_completeness score when income_statements/balance_sheets/cash_flow are no longer available?

**Answer:** Reweight the scoring model — redistribute the weights so Finnhub-available data totals 1.0. Financial statements weight absorbed by what's available.

---

## Q2: Multi-transaction Filings

**Question:** Currently sec-monitor.js uses trades[0] — only the FIRST transaction from a Financial Datasets API response. When we switch to edgar-parser.js, a single Form 4 XML can contain multiple transactions. Should edgar-parser produce one alert per transaction, or one alert per filing?

**Answer:** One alert per transaction (recommended) — more granular. Each transaction row gets its own alert, dedup key, and cluster consideration. Matches how SEC data actually works.

---

## Q3: NocoDB Cache Location

**Question:** The spec says to cache Finnhub results in NocoDB Financial_Cache with 24h TTL. Research found that current cache functions are DEFINED but not actually used in the code node — caching is done via separate n8n HTTP nodes. Should the new Finnhub/AV cache logic live IN the JavaScript code node, or maintain the existing n8n HTTP node pattern?

**Answer:** In the JS code node (as spec says) — Finnhub fetch + NocoDB cache read/write all happen inside dexter-research.js. Self-contained, easier to test.

---

## Q4: Dedup Key Migration

**Question:** The new dedup key will be the EDGAR accessionNumber instead of the current '{ticker}_{insider}_{date}_{shares}' format. Existing Airtable records use the old format. What should happen with old filings in the 7-day lookback window?

**Answer:** Tolerate re-insertion of old filings — accept that filings from the past 7 days may get re-inserted with a new accession-based dedup key. Small one-time duplication is acceptable.

---

## Q5: Filing Index Discovery

**Question:** When edgar-parser.js needs to find the primary XML document for a Form 4 filing, it must either fetch index.json (extra HTTP call) or try predictable URL patterns first. How should we handle this?

**Answer:** Try predictable URL patterns first — try `{accession_nodash}/{accession_nodash}.xml`, fall back to index.json fetch if 404. Faster in happy path.

---

## Q6: Historical Insider Trades in dexter-research.js

**Question:** The current dexter-research.js fetches 50 insider trades records for context. With new edgar-parser.js pulling filings from EDGAR, should dexter-research.js still fetch historical Form 4 data?

**Answer:** Drop insider_trades from dexter-research.js — live monitoring from sec-monitor.js already captures this data. Reduces Finnhub quota usage.

---

## Q7: Score Weight Redistribution

**Question:** For the scoring model reweight (income_statements=0.25, balance_sheets=0.10, cash_flow=0.10 going away), what should replace these weights?

**Answer:** Redistribute proportionally to available data. Target: quote+profile (~0.25), basic_metrics (~0.25), prices (0.25), competitors (0.10), insider_data (0.15). Recalculate so weights sum to 1.0.
