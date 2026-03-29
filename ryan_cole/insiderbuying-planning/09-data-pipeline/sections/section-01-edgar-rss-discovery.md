# Section 01: EDGAR RSS Feed Discovery

## Overview

Create the `edgar-parser.js` module (CommonJS, no external dependencies) and implement the EDGAR EFTS filing discovery layer. This section provides `sec-monitor.js` with a structured list of new Form 4 filings, deduplication against the last processed timestamp, and all metadata required for XML parsing in Section 02.

This section is parallelizable with Section 04 (Finnhub integration). It blocks Sections 02, 03, and 05.

---

## File to Create

```
n8n/code/insiderbuying/edgar-parser.js   ← NEW (this section creates the file skeleton + Section 1 functions)
tests/insiderbuying/edgar-parser.test.js  ← NEW (this section's tests go here first)
```

Sections 02 and 03 will add more functions to both files. Write the module skeleton now with module-level rate limiter state so later sections can extend without restructuring.

---

## Tests First

**Test file:** `tests/insiderbuying/edgar-parser.test.js`

Framework: Jest (CommonJS). Run with `npm test`. All `fetchFn` mocks use `jest.fn().mockResolvedValue({...})`. Fixtures are inline — no separate fixture files.

Write and pass all tests below before implementing.

```javascript
// --- buildEdgarRssUrl ---

// Test: hours=6 produces URL whose startdt is now minus 6 hours (±30s tolerance)
// Test: URL includes forms=4, dateRange=custom, size=2000
// Test: URL host is efts.sec.gov

// --- fetchRecentFilings ---

// Test: EFTS response with 2 valid hits → returns array of length 2 with correct fields
//   Each item must have: { accessionNumber, filedAt, issuerName, issuerCik, ticker }
//   display_names[0] example: 'NVIDIA CORP (NVDA) (CIK 0001045810)'
//   → ticker='NVDA', issuerCik='0001045810'

// Test: display_names[0] WITHOUT ticker (fund/trust case):
//   e.g., 'Vanguard Total Stock Market Index Fund (CIK 0000732834)'
//   → ticker=null, issuerCik='0000732834'

// Test: EFTS returns empty hits array → returns []

// Test: fetchFn rejects with network error → returns [], failureCount incremented
//   (failureCount is module-level; reset it before this test)

// Test: EFTS returns unexpected JSON shape (missing 'hits' key entirely) → returns [], no throw

// --- deduplicateFilings ---

// Test: filedAt <= lastCheckTimestamp (boundary: exact match) → filing excluded
// Test: filedAt > lastCheckTimestamp → filing included
// Test: lastCheckTimestamp is null → all filings returned unchanged
// Test: lastCheckTimestamp is undefined → all filings returned unchanged
// Test: empty filings array → empty array returned
```

---

## Rate Limiting (module-level, shared by all EDGAR requests)

Every EDGAR HTTP call in `edgar-parser.js` — both EFTS requests and Form 4 XML fetches (added in Section 02) — must go through the same two-tier rate limiter defined at module scope:

**Tier 1 — minimum inter-request delay:** 110ms sleep after every EDGAR request.

**Tier 2 — minute-level token bucket:**

```javascript
// TokenBucket config for EDGAR (module-level singleton)
// capacity: 58
// refillRate: 58 tokens per refillInterval
// refillInterval: 60000ms (1 minute)
// acquire() resolves when a token is available; if bucket empty, waits for next refill
```

The token bucket implementation is internal to this module (no npm package). A simple `TokenBucket` class using `setTimeout` for deferred resolve is sufficient. Every EDGAR call acquires a token before executing, then sleeps 110ms after receiving the response.

**User-Agent header** — required on all EDGAR requests:

```
User-Agent: EarlyInsider/1.0 (contact@earlyinsider.com)
```

Omitting this causes 403s or silently truncated results from the SEC fair access policy enforcement.

---

## HTTP Helper

All HTTP calls in `edgar-parser.js` use `require('https')` directly — no external HTTP library. Write a shared internal helper (not exported) that:

- Sets `Accept-Encoding: gzip, deflate` and decompresses via `require('zlib').createGunzip()` pipe when response has `Content-Encoding: gzip`
- Follows redirects (3xx responses) up to 3 hops
- Enforces a request timeout via `req.destroy()` (use `req.setTimeout(10000, () => req.destroy())`)
- Returns a `Promise<string>` of the full response body, or rejects on error / non-2xx status

This helper is used by `fetchRecentFilings` in this section and by `fetchForm4Xml` in Section 02.

---

## Function: `buildEdgarRssUrl(opts)`

Exported. Pure (no side effects, no network).

```javascript
/**
 * @param {object} opts
 * @param {number} [opts.hours=6] - How many hours back to search
 * @returns {string} - EFTS search URL
 */
function buildEdgarRssUrl(opts) { ... }
```

**URL target:** `https://efts.sec.gov/LATEST/search-index`

**Query parameters:**
- `forms=4`
- `dateRange=custom`
- `startdt` — ISO 8601 datetime string for `now - hours`
- `enddt` — ISO 8601 datetime string for `now`
- `size=2000` — overrides EFTS default of 100 results per page

The `hours` default is 6. `startdt`/`enddt` must be ISO 8601 format accepted by EFTS (e.g., `2025-01-15T10:00:00`).

---

## Function: `fetchRecentFilings(hours, fetchFn)`

Exported. Async.

```javascript
/**
 * @param {number} hours - How many hours back to search
 * @param {Function} [fetchFn] - Optional HTTP override for testing. Defaults to internal HTTPS helper.
 * @returns {Promise<Array<{accessionNumber, filedAt, issuerName, issuerCik, ticker}>>}
 *   Returns [] on any failure; never rejects.
 */
async function fetchRecentFilings(hours, fetchFn) { ... }
```

**Steps:**
1. Call `buildEdgarRssUrl({ hours })`
2. Acquire rate limit token, call `fetchFn` (or internal HTTPS helper), sleep 110ms
3. Parse JSON response body
4. Map `hits.hits[].source` (note: field is `_source` in EFTS response) to structured Filing objects

**Field mapping from `_source`:**

| EFTS field | Output field | Notes |
|---|---|---|
| `file_num` | `accessionNumber` | Preserve dashes as returned (e.g. `0001234567-25-000001`) |
| `file_date` | `filedAt` | ISO date string |
| `entity_name` | `issuerName` | String |
| `display_names[0]` | `ticker`, `issuerCik` | Parsed via regex (see below) |

**Ticker/CIK regex extraction from `display_names[0]`:**

```javascript
const match = displayName.match(/\(([A-Z]{1,5})\)\s+\(CIK (\d+)\)/);
// match[1] → ticker, match[2] → issuerCik
// No match → ticker: null; CIK: try secondary regex /\(CIK (\d+)\)/ for CIK only
```

When the regex finds no ticker (foreign issuers, funds, trusts), set `ticker: null`. The caller (Section 02's XML parser) will later extract the ticker from `<issuerTradingSymbol>` in the Form 4 XML.

If CIK is also unavailable after the secondary regex, skip the filing entirely (do not include it in the output array).

**Error handling:**
- Wrap the entire function body in try/catch
- On any error: log the error, increment the module-level `failureCount`, return `[]`
- This ensures the Telegram alert threshold logic in `sec-monitor.js` still sees accumulated failures

---

## Function: `deduplicateFilings(filings, lastCheckTimestamp)`

Exported. Synchronous, pure.

```javascript
/**
 * @param {Array<{filedAt: string, ...}>} filings
 * @param {string|null|undefined} lastCheckTimestamp - ISO date string from Monitor_State
 * @returns {Array} - Only filings where filedAt > lastCheckTimestamp
 */
function deduplicateFilings(filings, lastCheckTimestamp) { ... }
```

**Behavior:**
- If `lastCheckTimestamp` is null or undefined, return `filings` unchanged (first run case)
- Otherwise return only filings where `filedAt > lastCheckTimestamp` (strict greater than; boundary is excluded)
- Use string comparison (ISO 8601 lexicographic order is correct for date comparison)

**Important architectural note — why NOT accession number ordering:**

EDGAR accession numbers have the format `{XXXXXXXXXX}-{YY}-{NNNNNN}` where the first 10 digits are the filer's CIK (not a timestamp). They are NOT sortable by time and MUST NOT be used as a watermark. The `lastCheckTimestamp` from Monitor_State is the only correct ordering signal.

---

## Module Skeleton

Start `edgar-parser.js` with this structure so Sections 02 and 03 can extend cleanly:

```javascript
'use strict';

const https = require('https');
const zlib = require('zlib');

// ─── Rate Limiter ──────────────────────────────────────────────────────────────

/** @type {number} */
let failureCount = 0;

class TokenBucket {
  /** capacity, refillRate, refillInterval */
  constructor(opts) { ... }
  /** @returns {Promise<void>} resolves when token acquired */
  async acquire() { ... }
}

const edgarBucket = new TokenBucket({ capacity: 58, refillRate: 58, refillInterval: 60000 });
const EDGAR_REQUEST_DELAY_MS = 110;
const EDGAR_USER_AGENT = 'EarlyInsider/1.0 (contact@earlyinsider.com)';

// ─── Internal HTTP Helper ──────────────────────────────────────────────────────

/**
 * @param {string} url
 * @param {object} [headers]
 * @returns {Promise<string>}
 */
async function httpsGet(url, headers = {}) { ... }

// ─── Section 1: EDGAR RSS Feed Discovery ──────────────────────────────────────

function buildEdgarRssUrl(opts) { ... }

async function fetchRecentFilings(hours, fetchFn) { ... }

function deduplicateFilings(filings, lastCheckTimestamp) { ... }

// ─── Section 2: Form 4 XML Parser (placeholder, added in Section 02) ──────────

// ─── Section 3: Classification (placeholder, added in Section 03) ─────────────

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Section 1
  buildEdgarRssUrl,
  fetchRecentFilings,
  deduplicateFilings,
  // Expose failureCount reset for tests
  _resetFailureCount: () => { failureCount = 0; },
  _getFailureCount: () => failureCount,
};
```

Export `_resetFailureCount` and `_getFailureCount` as test helpers (prefix `_` signals internal use).

---

## EFTS Response Shape

The EFTS endpoint returns JSON. The relevant path is `hits.hits[i]._source`. A representative partial response:

```json
{
  "hits": {
    "total": { "value": 47 },
    "hits": [
      {
        "_source": {
          "file_num": "0001234567-25-000001",
          "file_date": "2025-04-15",
          "entity_name": "NVIDIA CORP",
          "display_names": ["Jensen Huang (NVDA) (CIK 0001045810)"]
        }
      },
      {
        "_source": {
          "file_num": "0009876543-25-000002",
          "file_date": "2025-04-15",
          "entity_name": "Vanguard 500 Index Fund",
          "display_names": ["Vanguard Advisers Inc (CIK 0000732834)"]
        }
      }
    ]
  }
}
```

The second hit has no ticker in `display_names[0]` — the ticker regex will not match, so `ticker: null`. The CIK secondary regex will still extract `0000732834`.

---

## EFTS URL Example

For `hours=6` called at `2025-04-15T14:00:00Z`:

```
https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=2025-04-15T08:00:00&enddt=2025-04-15T14:00:00&size=2000
```

---

## Dependencies

- **Sections blocked by this section:** 02 (Form 4 XML Parser), 03 (Transaction Classification), 05 (sec-monitor rewrite)
- **Sections this section depends on:** none
- **External npm packages added:** none (uses only Node built-ins: `https`, `zlib`)
- **Environment variables:** none (this section has no API keys)

---

## Definition of Done

- [ ] `tests/insiderbuying/edgar-parser.test.js` exists with all Section 1 test stubs written
- [ ] All Section 1 tests pass (`npm test`)
- [ ] `n8n/code/insiderbuying/edgar-parser.js` exports `buildEdgarRssUrl`, `fetchRecentFilings`, `deduplicateFilings`
- [ ] `failureCount` increments on network error in `fetchRecentFilings`
- [ ] `deduplicateFilings` returns all filings when `lastCheckTimestamp` is null/undefined
- [ ] Module-level `TokenBucket` instance named `edgarBucket` is ready for Section 02 to use
- [ ] No external npm packages introduced
