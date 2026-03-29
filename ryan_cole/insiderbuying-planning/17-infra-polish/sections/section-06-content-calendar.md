# Section 06: content-calendar.js -- Shared Content Utility Module

## Overview

Create `n8n/code/insiderbuying/content-calendar.js` as a shared utility module that other content workflows import. It is **not** a standalone n8n workflow -- it exports async helper functions consumed by article generators, competitor monitors, and the earnings-driven scheduler.

**Dependencies:**
- Pre-flight manual step: NocoDB tables `Content_Calendar`, `Competitor_Intel`, and `SEO_State` must exist before this module is used. Create them in the NocoDB UI (see schema below).
- `fast-xml-parser` npm package must be available in the n8n Code node environment. Verify on the VPS: `node -e "require('fast-xml-parser')"` -- if it throws, install via `npm install fast-xml-parser` in the n8n container before deploying.
- Alpha Vantage earnings helper from unit 09 module (imported for the earnings calendar integration function).
- Existing NocoDB HTTP helpers: `nocodbGet`, `nocodbPost`, `nocodbPatch` (injected via `opts`).

**No new environment variables are required** -- uses existing `NOCODB_BASE_URL`, `NOCODB_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

---

## Pre-flight: NocoDB Table Schemas

These tables must be created manually in the NocoDB UI before first use. Column names must match exactly.

**Content_Calendar**
| Column | Type |
|--------|------|
| id | Auto-number |
| ticker_or_topic | Single line text |
| content_type | Single select: `article`, `reddit_dd`, `x_thread`, `report` |
| planned_date | Date |
| status | Single select: `planned`, `published`, `skipped` |
| channel | Single line text |
| notes | Long text |

**Competitor_Intel**
| Column | Type |
|--------|------|
| id | Auto-number |
| feed_url | Single line text |
| item_title | Single line text |
| item_url | Single line text |
| item_date | DateTime |
| ticker_mentioned | Single line text |
| covered_by_us | Checkbox |
| created_at | DateTime |

**SEO_State** (also used by Section 02 -- may already exist)
| Column | Type |
|--------|------|
| id | Auto-number |
| key | Single line text (unique, e.g. `"ubersuggest_quota"`) |
| date | Date |
| count | Number |

---

## Tests First

**File:** `n8n/tests/content-calendar.test.js`

Run with: `node --test n8n/tests/content-calendar.test.js`

All external I/O (NocoDB, Telegram, RSS, Alpha Vantage) is mocked by stub functions passed in via `opts`. No real HTTP calls in tests.

### addToCalendar

```javascript
// Test: calls nocodbPost('Content_Calendar', ...) with correct fields
// Test: status defaults to 'planned'
// Test: missing optional `notes` field -> no error, field omitted from POST body
```

Stubs needed:
- `opts.nocodb.post(table, body)` -> returns `{ id: 1, ...body }`

### getCalendarForDate

```javascript
// Test: constructs NocoDB `where` filter:
//       `(planned_date,eq,<date>)~and(status,eq,planned)`
// Test: returns array from NocoDB response
// Test: empty NocoDB response -> returns []
```

Stubs needed:
- `opts.nocodb.get(table, params)` -> returns `{ list: [...] }` or `{ list: [] }`

### checkContentFreshness

```javascript
// Test: ticker with article published 10 days ago -> { fresh: true, lastPublished: <date> }
// Test: ticker with no articles -> { fresh: false, lastPublished: null }
// Test: ticker with article published 31 days ago -> { fresh: false, lastPublished: null }
```

Stubs needed:
- `opts.nocodb.get('Articles', params)` filtered by ticker + date range

### checkCompetitorFeeds

```javascript
// Test: successful fetch of mock RSS -> parses items and checks tickers
// Test: ticker in RSS not covered in 30 days -> writes Competitor_Intel + sends Telegram alert
// Test: ticker in RSS already covered in 30 days -> no record, no alert
// Test: one feed fails, one succeeds -> continues processing, no error thrown
// Test: all feeds fail -> sends ONE Telegram error message (not one per feed)
// Test: RSS contains CDATA block <![CDATA[...]]> -> fast-xml-parser handles correctly
// Test: ticker extraction doesn't match stop-words ("AND", "THE", "FOR")
// Test: ticker extraction ignores non-ticker uppercase tokens ("NYSE", "SEC", "CEO", "IPO")
```

Stubs needed:
- `opts.fetchRSS(url)` -> returns RSS XML string (or throws on failure)
- `opts.nocodb.post('Competitor_Intel', body)`
- `opts.telegram.send(message)`

### checkContentSimilarity (optional, D4.2)

```javascript
// Test: identical text -> { similar: true, match: articleId }
// Test: completely different text -> { similar: false, match: null }
// Test: similarity exactly at 0.85 -> { similar: true } (threshold is inclusive)
// Test: no existing articles for ticker -> { similar: false, match: null }
// Test: articles truncated to 2,000 words before TF-IDF computation
```

Stubs needed:
- `opts.nocodb.get('Articles', params)` -> returns last 10 articles for ticker

### Earnings Calendar Integration (D7.3)

```javascript
// Test: ticker in both earnings list AND Insider_Alerts ->
//       calls addToCalendar() with planned_date = earnings_date minus 3 days
// Test: ticker in earnings but NOT in Insider_Alerts -> does NOT call addToCalendar()
// Test: Alpha Vantage delay -- verify delay helper is called between ticker lookups
```

Stubs needed:
- Unit 09 earnings fetch function (mock, returns array of `{ ticker, reportDate }`)
- `opts.nocodb.get('Insider_Alerts', params)` -> filtered by ticker
- `opts.delay(ms)` -- mockable timer so tests don't actually wait 12 seconds

---

## Implementation

**File to create:** `n8n/code/insiderbuying/content-calendar.js`

### Module structure

```javascript
'use strict';

const XMLParser = require('fast-xml-parser').XMLParser;
// Import unit 09 Alpha Vantage earnings helper:
const { fetchEarningsCalendar } = require('./earnings-alerts'); // adjust path to actual unit 09 file

const COMPETITOR_RSS_FEEDS = [
  // Add competitor RSS feed URLs here
  // e.g. 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL&region=US&lang=en-US'
];

// Uppercase tokens that are NOT ticker symbols
const TICKER_STOP_WORDS = new Set([
  'THE', 'AND', 'FOR', 'FROM', 'WITH', 'THAT', 'THIS', 'ARE', 'ITS',
  'NYSE', 'SEC', 'CEO', 'CFO', 'COO', 'IPO', 'ETF', 'GDP', 'CPI',
  'USD', 'EUR', 'GBP', 'YOY', 'QOQ', 'EPS', 'TTM', 'YTD', 'ALL',
  // add more as encountered in feeds
]);

const ALPHA_VANTAGE_DELAY_MS = 12000; // 5 calls/min free tier -> 12s gap

module.exports = {
  addToCalendar,
  getCalendarForDate,
  checkContentFreshness,
  checkCompetitorFeeds,
  checkContentSimilarity,   // optional
  scheduleFromEarnings,     // D7.3
};
```

### addToCalendar(entry, opts)

Signature: `async function addToCalendar(entry, opts)`

- `entry` shape: `{ ticker, type, date, channel, notes? }`
- Posts to `Content_Calendar` NocoDB table with `status: 'planned'`
- `notes` is optional -- omit from POST body if not provided (do not send `null`)
- Returns the created NocoDB record

### getCalendarForDate(date, opts)

Signature: `async function getCalendarForDate(date, opts)`

- `date`: ISO date string (`YYYY-MM-DD`)
- Calls `nocodbGet('Content_Calendar', { where: '(planned_date,eq,<date>)~and(status,eq,planned)' })`
- Returns array of records; empty array if none found

### checkContentFreshness(ticker, opts)

Signature: `async function checkContentFreshness(ticker, opts)`

- Queries `Articles` NocoDB table: `ticker = ticker` AND `published_at >= (today - 30 days)`
- Returns `{ fresh: boolean, lastPublished: string | null }`
- `fresh: true` if any article found within 30 days
- `lastPublished`: ISO date string of most recent article, or `null`
- **Note:** If this logic already exists in `generate-article.js`, extract it here and update `generate-article.js` to import from this module.

### checkCompetitorFeeds(opts)

Signature: `async function checkCompetitorFeeds(opts)`

**RSS parsing approach:** Use `fast-xml-parser` (not regex). Configure the parser to handle CDATA:

```javascript
const parser = new XMLParser({
  ignoreAttributes: false,
  cdataPropName: '__cdata',
  // additional options as needed
});
```

**Flow per feed:**
1. Fetch RSS XML (via `opts.fetchRSS(url)` in tests; raw `https` in production)
2. Parse with `fast-xml-parser`
3. For each `<item>`: extract ticker symbols from title + description
4. For each ticker: call `checkContentFreshness(ticker, opts)`
5. If not fresh: POST a `Competitor_Intel` record + send Telegram alert

**Ticker extraction helper** (internal):
```javascript
function extractTickers(text) {
  // Match 2-5 uppercase letter sequences, filter stop words
  // Returns string[]
}
```

**Failure handling:**
- Single feed error: log, skip, continue
- All feeds errored: send exactly ONE Telegram error message
- Never throw from `checkCompetitorFeeds` -- caller should not crash

**Competitor_Intel record shape:**
```javascript
{
  feed_url: feedUrl,
  item_title: item.title,
  item_url: item.link,
  item_date: item.pubDate,
  ticker_mentioned: ticker,
  covered_by_us: false,
  created_at: new Date().toISOString(),
}
```

### checkContentSimilarity(newArticleText, ticker, opts) -- optional (D4.2)

Signature: `async function checkContentSimilarity(newArticleText, ticker, opts)`

- Fetches last 10 published articles for `ticker` from NocoDB
- Pre-truncates each article to 2,000 words before computing similarity
- Removes stop-words before building term vectors (common English + financial: "the", "a", "stock", "company", "shares", "insider", "buy", etc.)
- Computes TF-IDF cosine similarity using a pure JS implementation (~50 lines, no npm)
- Returns `{ similar: boolean, match: string | null }` -- `match` is the `articleId` of the most similar article if threshold is met
- Threshold: 0.85 (inclusive -- score >= 0.85 returns `similar: true`)
- Called by content generators before starting a new article

**TF-IDF cosine similarity sketch** (implement inline, no library):
```javascript
function tfidfCosine(textA, textB, corpus) {
  // 1. Tokenize and remove stop-words
  // 2. Build term frequency map for each text
  // 3. Compute IDF from corpus
  // 4. Build TF-IDF vectors
  // 5. Compute cosine similarity: dot(a, b) / (|a| * |b|)
}
```

### scheduleFromEarnings(opts) -- D7.3

Signature: `async function scheduleFromEarnings(opts)`

- Calls imported `fetchEarningsCalendar({ weeks: 4 })` from unit 09 module
- For each earnings ticker, queries `Insider_Alerts` (last 30 days) for any matching insider activity
- If match found: calls `addToCalendar({ ticker, type: 'article', date: earningsDate - 3days, channel: 'blog' }, opts)`
- Adds 12-second delay between Alpha Vantage calls to stay within free tier (5 calls/minute)
- Use a `delay(ms)` helper:
  ```javascript
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  ```
  Make it mockable in tests by accepting `opts.delay` with fallback to the real implementation.

---

## Dependency Notes

- **No circular imports:** `content-calendar.js` imports from unit 09 (`earnings-alerts.js`). Unit 09 must NOT import from `content-calendar.js`.
- **Dependency injection pattern:** All NocoDB/Telegram access is via `opts.nocodb.*` and `opts.telegram.*` -- same pattern used throughout the existing codebase. Do not call HTTP directly inside module functions (except RSS fetching, which can use a built-in `https` polyfill in production but must accept `opts.fetchRSS` override for tests).
- **No new env vars** -- existing `NOCODB_BASE_URL`, `NOCODB_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` cover all needs.

---

## Deviations from Plan

1. **checkContentFreshness not extracted from generate-article.js (D1)**: The spec says to extract
   it if it exists. It does exist in generate-article.js but with INVERTED semantics:
   generate-article.js `fresh: true` = no recent articles (OK to write); content-calendar.js
   `fresh: true` = has recent coverage. Extracting would require changing all callers in
   generate-article.js — out of scope. Both implementations coexist with different semantics.

2. **earnings-alerts.js does not exist (D2)**: Unit 09 module not present. scheduleFromEarnings
   handles missing module with try/catch and accepts opts.fetchEarnings injection for tests.

3. **Smooth IDF formula (D3)**: Standard IDF collapses to 0 with small corpus when all terms
   appear in all docs. Used smooth IDF: `log((N+1)/(df+1)) + 1` to prevent zero vectors.

4. **fast-xml-parser installed as npm dep (D4)**: Package installed locally for development.
   On VPS n8n container, must add NODE_FUNCTION_ALLOW_EXTERNAL=fast-xml-parser (documented in
   .env.example A9 block from section 05).

5. **Test count 26**: All 6 describes passing: 3+3+3+8+5+4 tests. Added test for M1 date filter (Insider_Alerts 30-day window).

6. **checkContentSimilarity query format (D5)**: Code review found the Articles query used raw `{ ticker, limit }` params instead of NocoDB `where` filter. Fixed to use `(ticker,eq,X)~and(status,eq,published)` consistent with all other queries.

7. **checkContentFreshness extraction waived (D6)**: Definition of Done item "extract if it exists in generate-article.js" is intentionally waived due to inverted semantics (see D1). Both implementations coexist with different boolean meanings.

## Definition of Done

- `n8n/code/insiderbuying/content-calendar.js` exports all 5 functions (6 including `scheduleFromEarnings`)
- `fast-xml-parser` is verified available in the VPS n8n environment
- `checkCompetitorFeeds` uses `fast-xml-parser` -- no regex RSS parsing
- All tests in `n8n/tests/content-calendar.test.js` pass: `node --test n8n/tests/content-calendar.test.js`
- `checkContentFreshness` logic is not duplicated: if it exists in `generate-article.js`, it is extracted here and `generate-article.js` imports it
- `scheduleFromEarnings` adds a 12-second delay between Alpha Vantage calls (mockable via `opts.delay`)
- No real HTTP calls in tests -- all external I/O is stubbed via `opts`
