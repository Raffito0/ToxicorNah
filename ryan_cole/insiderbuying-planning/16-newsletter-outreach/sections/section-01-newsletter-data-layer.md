# Section 01 — Newsletter Data Layer

## Overview

Replace the stubbed `gatherWeeklyContent()` function in `weekly-newsletter.js` with real NocoDB queries. Add `computeAlertPerformance()` for Finnhub price lookups and `getUpcomingEarnings()` with Alpha Vantage + NocoDB caching.

**File modified:** `n8n/code/insiderbuying/weekly-newsletter.js`
**Test file:** `tests/insiderbuying/weekly-newsletter.test.js` (Jest format — not `n8n/tests/` which uses node:test)

**Dependencies:** none — this section is the root of the newsletter pipeline and can be implemented in parallel with section-04.

**Blocks:** section-02 (AI generation) cannot start until this section is complete.

---

## Tests First

Add the following tests to `n8n/tests/weekly-newsletter.test.js` before writing any implementation. All tests mock the NocoDB client with `jest.fn()`.

```js
// gatherWeeklyContent — NocoDB table targets and filters
test('gatherWeeklyContent queries Insider_Alerts with score >= 7 and 7-day date range', async () => { /* stub */ });
test('gatherWeeklyContent queries Articles table with 7-day filter', async () => { /* stub */ });
test('gatherWeeklyContent queries Insider_Alerts for 7–14 days ago for performance data', async () => { /* stub */ });
test('gatherWeeklyContent returns all four fields with correct types', async () => { /* stub */ });

// computeAlertPerformance
test('computeAlertPerformance maps alerts to { ticker, return, winner } using mocked Finnhub', async () => { /* stub */ });
test('computeAlertPerformance handles Finnhub failure for one alert gracefully (Promise.allSettled — others still computed)', async () => { /* stub */ });

// getUpcomingEarnings — cache behaviour
test('getUpcomingEarnings returns cached Financial_Cache data when entry is under 24h old', async () => { /* stub */ });
test('getUpcomingEarnings calls Alpha Vantage when cache is missing or stale', async () => { /* stub */ });
test('getUpcomingEarnings writes result to Financial_Cache after fetching from Alpha Vantage', async () => { /* stub */ });
```

Run `npm test` from `insiderbuying-site/` — all tests should fail before implementation.

---

## Background

The current `gatherWeeklyContent(nocodbApi)` returns `{ topAlerts: [], articles: [], performance: [], upcomingEarnings: [] }` unconditionally. The AI generation step (section-02) receives these empty arrays and has no real data to write about. This section wires up the four real data sources.

All timestamps must use UTC throughout. No local time conversions.

`finnhub-client.js` is an existing module built in unit 12. Import it with `require('../finnhub-client')`. Do not reimplement its HTTP logic.

---

## Implementation

### Function: `gatherWeeklyContent(nocodbApi)`

Accepts a NocoDB API client object and returns a Promise that resolves to:

```js
{
  topAlerts,       // array of alert records from Insider_Alerts
  articles,        // array of article records from Articles
  performance,     // array of { ticker, return, winner } objects
  upcomingEarnings // array of earnings events (from cache or Alpha Vantage)
}
```

**Step 1 — Top alerts:**

Query the `Insider_Alerts` NocoDB table:
- Filter: `score >= 7` AND `filing_date >= (now - 7 days UTC)`
- Sort: `score` descending
- Limit: 10 records

Return full records. The fields used downstream are `ticker`, `insider_name`, `total_value`, and `score`.

**Step 2 — Articles:**

Query the `Articles` NocoDB table:
- Filter: `published_at >= (now - 7 days UTC)`
- Sort: `published_at` descending
- Limit: 5 records

**Step 3 — Alert performance (previous week):**

Query `Insider_Alerts`:
- Filter: `filing_date >= (now - 14 days UTC)` AND `filing_date < (now - 7 days UTC)`
- Limit: 5 records

Pass the resulting records to `computeAlertPerformance()`.

**Step 4 — Upcoming earnings:**

Call `getUpcomingEarnings(nocodbApi)`.

**Empty-state guard (critical):**

After all four queries resolve, check `topAlerts.length`. If it is 0, attach a prefix string to the return value:

```js
result.emptyAlertsPrefix = "No major insider moves this week — focus section 2 on macro trends and market context instead of a specific ticker.";
```

Section-02 must inject this prefix into the AI prompt. Never pass an empty alerts array silently — the AI will hallucinate tickers.

---

### Function: `computeAlertPerformance(alerts, finnhubClient)`

Accepts an array of alert records and a Finnhub client. Returns an array of `{ ticker, return: string, winner: bool }`.

- For each alert, call `finnhubClient.getQuote(ticker)` to get the current price.
- Compute percentage return: `(currentPrice - filingPrice) / filingPrice * 100`, formatted as `"+12.3%"` or `"-4.1%"`.
- `winner: true` if return > 0.
- Add a **250 ms delay** between each Finnhub call (`await sleep(250)`). Finnhub free tier rate-limits aggressively.
- Wrap the entire map in `Promise.allSettled` so a single failed lookup does not abort the rest. For rejected entries, return `{ ticker, return: 'N/A', winner: false }`.

---

### Function: `getUpcomingEarnings(nocodbApi)`

Cache key: `earnings_next14_YYYY-MM-DD` where the date is today's UTC date.

**Cache hit path:**
1. Query `Financial_Cache` for a record with this key.
2. Check `updated_at` — if under 24 hours old, return `record.data` parsed from JSON.

**Cache miss / stale path:**
1. Call Alpha Vantage earnings calendar endpoint for the next 14 days. Use plain HTTPS (`require('https')`) — no npm client. Endpoint: `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={ALPHA_VANTAGE_API_KEY}`. The response is CSV; parse it and filter to events within the next 14 days.
2. Write the result to `Financial_Cache` (upsert by key, set `updated_at = now()`).
3. Return the parsed data.

---

## Environment Variables Required

These must already exist in `.env` (all are used by other modules):

- `NOCODB_API_URL`
- `NOCODB_API_TOKEN`
- `FINNHUB_API_KEY`
- `ALPHA_VANTAGE_API_KEY`

No new env vars are introduced in this section.

---

## NocoDB Table Assumptions

| Table | Key Fields Used |
|-------|----------------|
| `Insider_Alerts` | `ticker`, `insider_name`, `total_value`, `score`, `filing_date` |
| `Articles` | `published_at` |
| `Financial_Cache` | `key` (string), `data` (JSON text), `updated_at` (datetime) |

If `Financial_Cache` does not exist, it must be created before deploying this section. Minimal schema:

```sql
CREATE TABLE Financial_Cache (
  key VARCHAR(255) PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at DATETIME NOT NULL
);
```

---

## Acceptance Criteria

- `gatherWeeklyContent` resolves with all four keys populated (arrays, possibly empty).
- When `topAlerts` is empty, `result.emptyAlertsPrefix` is set to the correct string.
- `computeAlertPerformance` processes alerts sequentially (for loop + await), never throws — all Finnhub failures caught per-alert.
- `getUpcomingEarnings` checks HTTP status before parsing; skips cache write on non-200. Corrupt cache JSON falls through to fetch.
- `_parseCsv` handles RFC-4180 quoted fields (company names with commas).
- All 12 tests pass.

## Deviations from Plan

1. **Test file location**: Moved from `n8n/tests/weekly-newsletter.test.js` to `tests/insiderbuying/weekly-newsletter.test.js`. The `n8n/tests/` directory uses `node:test` format, which Jest cannot run. All new tests written in Jest format.

2. **`computeAlertPerformance` — sequential for loop**: The plan called for `Promise.allSettled` + map. Code review (B-1) found this is not actually sequential — all non-first callbacks start concurrently and sleep 250ms in parallel. Replaced with `for` loop + `await` per iteration + per-alert try/catch.

3. **Alpha Vantage HTTP status check (B-2)**: Plan did not specify error handling. Added `if (resp.status !== 200) return []` to prevent empty array being cached on 429/500.

4. **JSON.parse try/catch (B-3)**: Wrap `JSON.parse(cached.data)` — corrupt DB entry no longer crashes `gatherWeeklyContent`.

5. **RFC-4180 CSV parser (B-4)**: Plan used naive comma split. Replaced `_parseCsv` with character-by-character parser that handles quoted fields with embedded commas (e.g. `"Alphabet Inc, Class A"`).

6. **12 tests instead of 9**: Added T-1 (sleepFn called n-1 times) and T-2 (AV non-200 → no cache write), plus `emptyAlertsPrefix` test.
