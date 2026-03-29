# Research: 09-data-pipeline

## Codebase Research

### Current sec-monitor.js Architecture

**Form 4 Polling (current two-step approach):**

1. **SEC EDGAR EFTS Search** (already free, already in use):
   - `https://efts.sec.gov/LATEST/search-index` with `q="form 4"`, `forms=4`, date range
   - Returns basic filing metadata: entity name, file date, accession number, CIK
   - Filtered by `lastCheckDate` to today
   - Constant: `SEC_USER_AGENT = 'EarlyInsider.com (alerts@earlyinsider.com)'`

2. **Financial Datasets API** (paid, to be replaced):
   - `https://api.financialdatasets.ai/insider-trades?ticker=...&filing_date_gte=...`
   - Returns: insider name, title, transaction type/date/shares/price, market cap, sector
   - Rate limiting: 100ms delay between calls, 3-retry exponential backoff on 429/500 (1s, 3s, 9s)
   - Non-fatal on empty results (no coverage = returns null without incrementing failure counter)

**Deduplication:**
- Key format: `{ticker}_{insider_name_underscored}_{transaction_date}_{shares}`
- Storage: Airtable `Insider_Alerts` table, 7-day lookback window
- Fetched at runtime (paginated), stored as `Set<string>` for O(1) lookups
- `passesDedup()` adds to Set immediately (within-run dedup)

**Cluster Detection (CRITICAL — must be preserved exactly):**
- **Supabase query**: `insider_alerts` table, same ticker, same transaction_date range (7 days), excluding current insider
- **In-memory same-run detection**: checks `sameRunFilings` array for filings processed earlier in same run
- **Cluster assignment**: reuses existing `cluster_id` or generates new UUID; cluster size = prior insiders + current
- **Retroactive updates**: PATCH Supabase rows without cluster_id; mutate `sameRunFilings` entries retroactively
- Uses `detectCluster(ticker, transactionDate, currentInsiderName, opts)` function

**Error Alerting to Telegram:**
```javascript
if (failureCount > 5 && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
  const msg = encodeURIComponent(`⚠️ sec-monitor: ${failureCount} enrichment failures\nFirst error: ${firstError}`);
  await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${env.TELEGRAM_CHAT_ID}&text=${msg}`).catch(() => {});
}
```

**Monitor_State Table (Airtable):**
- Fields: `name` (workflow identifier), `last_check_timestamp` (ISO), `last_run_status`, `last_run_error`
- Status values: 'success', 'error'
- Rollback logic: on partial failure, timestamp rolls back to `min(failed_filing.filing_date)` if `retry_count <= 3`; advances if all failures are dead-lettered (retry_count > 3)

**Insider Classification (currently in sec-monitor.js, lines 104–137):**
- 5 categories: C-Suite, VP, Board, 10% Owner, Officer
- VP takes precedence over C-Suite (parsed first)
- Board director flag only overrides for ambiguous titles

**Required env vars:**
```
AIRTABLE_API_KEY, AIRTABLE_BASE_ID, INSIDER_ALERTS_TABLE_ID, MONITOR_STATE_TABLE_ID
FINANCIAL_DATASETS_API_KEY  ← TO BE REMOVED
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
TELEGRAM_BOT_TOKEN (optional), TELEGRAM_CHAT_ID (optional)
```

---

### Current dexter-research.js Architecture

**fetchFinancialData() — current implementation:**
- Fetches 7 data types in parallel via `Promise.allSettled()`
- All calls use Financial Datasets API with `X-API-Key` header

**Data fetched (all to be replaced):**
1. `income_statements` (quarterly, 4 records)
2. `income_statements_annual` (3 records)
3. `balance_sheets` (quarterly, 1 record)
4. `cash_flow_statements` (quarterly, 4 records)
5. `financial_ratios` (quarterly, 12 records) — PE, PB, PS, etc.
6. `insider_trades` (50 records)
7. `stock_prices` (daily, 252 records — 1 year OHLCV)

**Data weights for completeness scoring:**
```javascript
const DATA_WEIGHTS = {
  income_statements: 0.25,
  stock_prices: 0.25,
  balance_sheets: 0.10,
  cash_flow: 0.10,
  ratios: 0.10,
  insider_trades: 0.10,
  competitors: 0.10,  // fetched externally by n8n
};
```

**Abort threshold:** `data_completeness < 0.5`

**NocoDB Financial_Cache — current state:**
- Schema: `ticker` (String), `data_type` (String), `expires_at` (DateTime), `data_json` (Long Text)
- TTL: 24h (`CACHE_TTL_MS = 24 * 60 * 60 * 1000`)
- Cache functions (`buildCacheKey`, `isCacheValid`, `buildCacheExpiry`) are DEFINED but NOT actively used in the code node
- Comment at line 384: "cache check would happen here in n8n" — caching done via separate n8n HTTP nodes

**fetchWithRetry() (already exists in dexter-research.js):**
- Retries on 429, exponential backoff: `baseDelay * Math.pow(2, attempt)` → 1s, 2s, 4s
- Default: 3 retries; returns last response after exhausting (doesn't throw)

---

### NocoDB Usage Patterns

- **Auth**: Bearer token via `NOCODB_API_TOKEN` env var; header `xc-token: {token}`
- **Base URL**: Set via `NOCODB_BASE_URL` env var
- **Filter syntax**: `(field,operator,value)~and(...)` — e.g., `(blog,eq,insiderbuying)~and(status,eq,published)`
- **No native upsert**: Use search-then-create-or-update pattern (see NocoDB section below)

---

### Test Setup

**sec-monitor.test.js**: Jest (CommonJS), `tests/insiderbuying/sec-monitor.test.js`
- Mock factory: `makeFetch(response)` → `jest.fn().mockResolvedValue(...)`
- `noSleep = jest.fn().mockResolvedValue(undefined)` for timing injection
- Fixtures hardcoded in test files (no separate fixture directory)
- Run with: `npm test`

**dexter-research.test.js**: Node.js native test runner (`require('node:test')`, `require('node:assert/strict')`)
- Location: `n8n/tests/dexter-research.test.js`
- Uses `describe()`, `it()`, `assert.deepStrictEqual()`

**New test file to create**: `tests/insiderbuying/edgar-parser.test.js` — use **Jest** (matching sec-monitor convention since this is a new file in `tests/insiderbuying/`)

---

### Project Structure Notes

- **CommonJS throughout** — `require()`/`module.exports` pattern, no ESM
- **No shared HTTP utility** — each module uses injected `fetchFn` parameter for testability
- **25 JS files** in `n8n/code/insiderbuying/`; `edgar-parser.js` is a new addition
- **JSDoc** on all exported functions with `@param`/`@return` tags
- All HTTP via `fetchFn` injection pattern — makes mocking trivial in tests

---

## Web Research

### SEC EDGAR Form 4 XML Parsing

**Three API tiers for Form 4 discovery:**

1. **EFTS Search** (already used by sec-monitor.js):
   ```
   GET https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=YYYY-MM-DD&enddt=YYYY-MM-DD
   ```
   - Returns JSON with `hits.hits[]._source.file_num` (accession number) and `display_names` (contains ticker + CIK)
   - Parse `display_names[0]` with regex: `/^(.+?)\s+\(([A-Z]+)\)\s+\(CIK\s+(\d+)\)/`
   - Paginated at 50 results/page via `from` offset parameter

2. **Submissions API** (best for per-company Form 4 history):
   ```
   GET https://data.sec.gov/submissions/CIK{padded_10_digits}.json
   ```
   - Returns columnar arrays in `filings.recent` — transform with `Object.keys(recent).map(k => ...)`
   - Filter: `form === '4' || form === '4/A'`

3. **Ticker Lookup**:
   ```
   GET https://www.sec.gov/files/company_tickers.json
   ```
   - Returns `{ "0": { cik_str, ticker, title }, ... }` — use `Object.values()` to iterate

**Accession number URL construction:**
```javascript
function buildForm4Url(issuerCik, accessionNumber, primaryDoc) {
  const noHyphens = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${noHyphens}/${primaryDoc}`;
}
// Index JSON: same base URL + /index.json (lists all files in filing)
```

**Key gotcha**: CIK in path is the **issuer's** CIK (company being reported on), NOT the filing agent CIK from the accession number prefix.

**Form 4 XML parsing (no-dependency regex approach):**
```javascript
function extractValue(xml, tagName) {
  const outer = xml.match(new RegExp(`<${tagName}>[\\s\\S]*?<\\/\\s*${tagName}>`, 'i'));
  if (!outer) return null;
  const inner = outer[0].match(/<value>([\s\S]*?)<\/value>/i);
  return inner ? inner[1].trim() : null;
}

function extractBlocks(xml, tagName) {
  const blocks = [];
  const re = new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[0]);
  return blocks;
}
```

**Key XML fields:**
- Issuer: `<issuerCik>`, `<issuerName>`, `<issuerTradingSymbol>`
- Owner: `<rptOwnerName>`, `<rptOwnerCik>`, `<isOfficer>` (1/0), `<isDirector>` (1/0), `<officerTitle>`
- Amendment: `<documentType>` = `4/A`
- Transactions: in `<nonDerivativeTable>` and `<derivativeTable>`
- Per-transaction: `<transactionCode>` (P/S/G/F/M/X/A/D), `<transactionShares>`, `<transactionPricePerShare>`, `<transactionAcquiredDisposedCode>` (A/D)

**Edge case handling:**
- **$0 price**: Legitimate for awards (A), tax withholding (F), option exercises (M/X). `price === null` when element absent (different from `price === 0`)
- **Form 4/A**: `documentType === '4/A'` — amendment supersedes original
- **Multiple transactions**: `extractBlocks(xml, 'nonDerivativeTransaction')` → array
- **Derivative table**: Additional fields `conversionOrExercisePrice`, `expirationDate`, `underlyingSecurityTitle`
- **Holdings** (no transaction): `<nonDerivativeHolding>` has no `transactionCode` — filter by tag name

**Rate limits & User-Agent:**
- Hard limit: **10 requests/second per IP** (applies to all EDGAR servers)
- User-Agent REQUIRED: `"AppName contact@domain.com"` — IP-blocked without it
- Add 110ms minimum between requests for buffer

---

### Finnhub + Alpha Vantage Free Tier

**Finnhub free tier:**
- Rate limit: **60 calls/minute** (hard), 30 calls/second burst ceiling
- Status code `429` on breach
- Free endpoints: `/quote`, `/stock/profile2`, `/stock/metric`, `/stock/candle`, `/calendar/earnings`, `/stock/insider-transactions`
- Paid-only: `financials-reported` (as-reported data), international exchanges

**Finnhub gotchas:**
- `/stock/metric` returns restated (not "as-reported") financial data
- `/stock/insider-sentiment` has missing months — null-handle, don't assume zero
- `/stock/candle` uses Unix timestamps for `from`/`to` params, not dates
- Key passed as query param `token=...` OR `X-Finnhub-Token` header

**Alpha Vantage free tier:**
- Rate limit: **25 requests/day** (hard cap), 5 requests/minute soft limit
- `EARNINGS_CALENDAR` endpoint — **one call covers all tickers** (batch, not per-ticker):
  ```
  GET https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={KEY}
  ```
- **Response is CSV** (not JSON) — unique among AV endpoints

**CSV parsing (no deps):**
```javascript
function parseEarningsCalendarCsv(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    return headers.reduce((obj, h, i) => {
      obj[h.trim()] = vals[i]?.trim() ?? null;
      return obj;
    }, {});
  });
}
// Fields: symbol, name, reportDate, fiscalDateEnding, estimate, currency
// estimate can be empty string — coerce with parseFloat(x) || null
```

**Rate limit guard (token bucket, no dependencies):**
```javascript
class TokenBucket {
  constructor({ capacity, refillRate, refillInterval = 1000 }) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillInterval = refillInterval;
    this.lastRefill = Date.now();
    this.queue = [];
    this.processing = false;
  }
  acquire() {
    return new Promise(resolve => { this.queue.push(resolve); this._processQueue(); });
  }
  _refill() {
    const now = Date.now();
    const intervals = Math.floor((now - this.lastRefill) / this.refillInterval);
    if (intervals > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + intervals * this.refillRate);
      this.lastRefill += intervals * this.refillInterval;
    }
  }
  _processQueue() {
    if (this.processing) return;
    this.processing = true;
    const tick = () => {
      this._refill();
      while (this.queue.length > 0 && this.tokens >= 1) {
        this.tokens -= 1;
        this.queue.shift()();
      }
      if (this.queue.length > 0) {
        setTimeout(tick, Math.max(1, this.refillInterval - (Date.now() - this.lastRefill)));
      } else { this.processing = false; }
    };
    tick();
  }
}
// const finnhubLimiter = new TokenBucket({ capacity: 60, refillRate: 60, refillInterval: 60000 });
```

---

### CommonJS HTTPS Without Dependencies

**Production-grade request wrapper (require('https') only):**
```javascript
const https = require('https');
const http  = require('http');
const zlib  = require('zlib');
const { URL } = require('url');

function request(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body = null, timeout = 10000,
            maxRedirects = 5, redirectCount = 0 } = options;
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'Accept-Encoding': 'gzip, deflate', ...headers },
    }, (res) => {
      // Redirect handling
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirectCount >= maxRedirects) return reject(new Error('Too many redirects'));
        const location = res.headers['location'];
        res.resume();
        return request(location.startsWith('http') ? location : `${parsed.origin}${location}`,
          { ...options, redirectCount: redirectCount + 1 }).then(resolve, reject);
      }
      // Decompress
      const enc = res.headers['content-encoding'];
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      if (enc === 'deflate') stream = res.pipe(zlib.createInflate());

      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('error', reject);
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          const err = Object.assign(new Error(`HTTP ${res.statusCode}`), { statusCode: res.statusCode, body: raw });
          return reject(err);
        }
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (ct.includes('json')) {
          try { resolve({ statusCode: res.statusCode, data: JSON.parse(raw), raw }); }
          catch { resolve({ statusCode: res.statusCode, data: null, raw }); }
        } else {
          resolve({ statusCode: res.statusCode, data: raw, raw });
        }
      });
    });

    const timer = setTimeout(() => req.destroy(new Error(`Timeout: ${urlStr}`)), timeout);
    req.on('error', err => { clearTimeout(timer); reject(err); });
    req.on('close', () => clearTimeout(timer));
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
```

**Critical rules:**
- Use `req.destroy()` for timeout (not deprecated `req.abort()`)
- Always drain `res.resume()` on redirects (prevents socket leaks)
- `Buffer.concat(chunks)` not string concat (handles multi-byte UTF-8)
- Check `Content-Type` before `JSON.parse()` — Alpha Vantage returns `text/csv`
- EDGAR sends gzip — `Accept-Encoding: gzip` + zlib pipeline handles it

---

### NocoDB v2 Caching Patterns

**API basics:**
- **Auth**: `xc-token: {token}` header (permanent API token from Account Settings)
- **Endpoint pattern**: `GET/POST/PATCH /api/v2/tables/{tableId}/records`
- **tableId** looks like `md_xxxxx` — NOT the human-readable table name (v1 vs v2 change)
- **Rate limit**: 5 req/s per user

**Bulk update body format**: Must be array `[{ Id: 1, field: 'val' }]` — `Id` required per row.

**WHERE clause**: `(field,eq,value)~and(...)`. No native IN — chain with `~or`: `(f,eq,a)~or(f,eq,b)`. Chunk large batches.

**No native upsert** (as of 2025): Use search-then-create-or-update:
```javascript
async function upsertCache(db, tableId, ticker, dataType, data) {
  const where = `(ticker,eq,${ticker})~and(data_type,eq,${dataType})`;
  const result = await db.listRecords(tableId, where, 1);
  const fields = {
    ticker,
    data_type: dataType,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    data_json: JSON.stringify(data),
  };
  if (result.list && result.list.length > 0) {
    await db.patchRecord(tableId, result.list[0].Id, fields);
  } else {
    await db.createRecord(tableId, fields);
  }
}
```

**TTL check pattern (already established in dexter-research.js):**
```javascript
function isCacheValid(entry) {
  if (!entry || !entry.expires_at) return false;
  return new Date(entry.expires_at).getTime() > Date.now();
}
```

**Key NocoDB gotchas:**
- v2 uses `tableId` (not table name) — most common migration mistake
- `404 on PATCH` bug (issue #11722): use `parseInt(row.Id)` before sending
- `429` at 5 req/s: add 200ms delay between batches in bulk operations
- `xc-token` for automation (permanent); `xc-auth` is JWT (short-lived, avoid for server-side)

---

## Testing Strategy

- **edgar-parser.test.js**: Jest (matches `tests/insiderbuying/` convention), 5 fixture XML files (standard buy, Form 4/A amendment, gift, option exercise, multi-transaction cluster buy)
- **sec-monitor.test.js**: Extend existing Jest file — replace Financial Datasets mock with EDGAR XML mock; update dedup key from `{ticker}_{name}_{date}_{shares}` to accession number; preserve cluster detection tests
- **dexter-research.test.js**: Extend existing Node.js native test runner file — add Finnhub mock for 4 endpoints, Alpha Vantage CSV mock
- **Test run commands**: `npm test` (Jest suite); `node n8n/tests/dexter-research.test.js` (native runner)

---

## Quick Reference

```
EDGAR Rate:         10 req/s | User-Agent: "AppName contact@domain.com" | 110ms delay
Finnhub Free:       60 req/min | 429 on breach | key in query param OR header
Alpha Vantage Free: 25 req/day | 5 req/min | EARNINGS_CALENDAR returns CSV
NocoDB Rate:        5 req/s | auth: xc-token | v2 uses tableId not table name

EFTS Search:        efts.sec.gov/LATEST/search-index?forms=4&startdt=...
Submissions:        data.sec.gov/submissions/CIK0000000000.json
Form 4 XML URL:     www.sec.gov/Archives/edgar/data/{cik}/{accessionNoDash}/{primaryDoc}
Index JSON:         www.sec.gov/Archives/edgar/data/{cik}/{accessionNoDash}/index.json
```
