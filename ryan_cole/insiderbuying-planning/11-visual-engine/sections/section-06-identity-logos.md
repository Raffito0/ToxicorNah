---

# Section 06 — Identity Assets: Company Logos (identity-assets.js, Part A)

## Overview

Create `n8n/code/insiderbuying/identity-assets.js` — the logo resolution system. Provides `getCompanyLogo(domain, tickerAbbrev, helpers)` with a 2-tier cascade (Brandfetch → UI Avatars), NocoDB caching with 30-day TTL, SVG rasterization, and batch prefetching with domain deduplication.

Section 07 will add `getInsiderPhoto()` to the same file.

## Dependency

Requires Section 01 (`visual-css.js`) to be complete first.

## File to Create

```
n8n/code/insiderbuying/identity-assets.js
```

## Test File

```
tests/insiderbuying/identity-assets.test.js
```

## Tests to Write First

### Logo Cascade Tests

```
# Test: getCompanyLogo checks NocoDB cache first
# Test: cache hit (valid TTL) returns cached URL without calling Brandfetch
# Test: cache expired re-fetches from Brandfetch
# Test: Brandfetch 200 + image/png content-type → uploads to R2, caches, returns R2 URL
# Test: Brandfetch 200 + image/svg+xml → rasterizes via screenshot server then uploads PNG
# Test: Brandfetch 404 → falls through to UI Avatars
# Test: Brandfetch timeout → falls through to UI Avatars
# Test: Brandfetch response > 500KB → rejected, falls through to UI Avatars
# Test: UI Avatars URL returned contains tickerAbbrev
# Test: UI Avatars result cached in NocoDB with source 'ui_avatars'
# Test: NocoDB PATCH called on cache update (not duplicate POST)
```

### Batch Prefetch Tests

```
# Test: prefetchLogos deduplicates input array (['nvidia.com', 'nvidia.com'] → 1 fetch)
# Test: prefetchLogos skips already-cached domains
# Test: prefetchLogos fetches missing domains in parallel
# Test: prefetchLogos limits concurrency to 3
```

Write the test file first, then implement. Run: `npm test -- tests/insiderbuying/identity-assets.test.js`

## NocoDB Cache Helpers

Two internal helpers shared between logo and photo functions (Section 07 reuses them):

### `_cacheGet(tableId, keyField, keyValue, helpers)` → `object | null`

Fetches a row from NocoDB and applies TTL check:

1. GET `/api/v2/tables/{tableId}/records?where=(${keyField},eq,${keyValue})&limit=1`
   - Header: `xc-token: {helpers.env.NOCODB_API_TOKEN}`
   - URL base: `helpers.env.NOCODB_API_URL`
2. If no record found → return `null`
3. If record found: check `fetched_at + ttl_seconds > now`
   - Within TTL → return the record object
   - Expired → return `null` (let caller re-fetch)

### `_cacheSet(tableId, keyField, keyValue, data, helpers)`

Upserts a row in NocoDB:

1. First call `_cacheGet` to check if row exists
2. If NOT exists → POST `/api/v2/tables/{tableId}/records` with `data`
3. If EXISTS → PATCH `/api/v2/tables/{tableId}/records/{rowId}` with `data`
   - Never call POST twice for the same key — always check first

NocoDB rate limit is ~5 req/s. No explicit retry needed for Section 06, but Section 08 tests `_cacheSet` handles NocoDB 429.

## Logo Table

**NocoDB table**: `Logo_Cache` (tableId provided via `helpers.env.NOCODB_LOGO_TABLE_ID`)

| Field | Type | Notes |
|-------|------|-------|
| `domain` | SingleLineText | Primary key |
| `logo_url` | URL | R2 URL or UI Avatars URL |
| `source` | SingleLineText | `'brandfetch'` or `'ui_avatars'` |
| `fetched_at` | DateTime | ISO 8601 string |
| `ttl_seconds` | Number | Default 2592000 (30 days) |

## getCompanyLogo(domain, tickerAbbrev, helpers)

```javascript
/**
 * Resolve a company logo URL with caching.
 * @param {string} domain - e.g. "nvidia.com"
 * @param {string} tickerAbbrev - e.g. "NVDA" — used for UI Avatars fallback
 * @param {object} helpers - { fetchFn, env, _sleep }
 * @returns {Promise<string>} Always returns a URL (never null)
 */
async function getCompanyLogo(domain, tickerAbbrev, helpers) { ... }
```

### Step 1: Check NocoDB Cache

```javascript
const cached = await _cacheGet(
  helpers.env.NOCODB_LOGO_TABLE_ID,
  'domain', domain, helpers
);
if (cached) return cached.logo_url;
```

### Step 2: Try Brandfetch CDN

```javascript
const brandfetchUrl = `https://cdn.brandfetch.io/${domain}/w/200/h/200`;
// GET with 5s timeout (helpers.fetchFn supports AbortController or signal option)
```

Validation checks (all must pass to use the logo):
1. `response.status === 200`
2. `response.headers.get('content-type')` starts with `'image/'`
3. Content-Length (or actual body size) ≤ 500KB (500 * 1024 bytes)

**SVG handling** — if Content-Type is `image/svg+xml`:
- Get SVG buffer → base64-encode
- Build HTML: `<html><body style="margin:0"><img src="data:image/svg+xml;base64,{b64}" width="200" height="200"></body></html>`
- POST to screenshot server: `{ html, viewport: { width: 200, height: 200 }, format: 'png' }`
- Use the resulting PNG buffer (not the original SVG)

**If checks pass** (PNG or rasterized SVG):
```javascript
const buffer = await response.buffer(); // or the rasterized PNG
const key = `earlyinsider/logos/${domain}_${Date.now()}.png`;
const r2Url = await uploadToR2(buffer, key);
await _cacheSet(tableId, 'domain', domain, {
  domain, logo_url: r2Url, source: 'brandfetch',
  fetched_at: new Date().toISOString(), ttl_seconds: 2592000
}, helpers);
return r2Url;
```

**If any check fails** (404, timeout, too large, non-image): catch the error, log a warning, fall through to Step 3.

### Step 3: UI Avatars Fallback (always succeeds)

```javascript
const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(tickerAbbrev)}&background=1A2238&color=4A9EFF&size=200&bold=true`;
await _cacheSet(tableId, 'domain', domain, {
  domain, logo_url: uiAvatarsUrl, source: 'ui_avatars',
  fetched_at: new Date().toISOString(), ttl_seconds: 2592000
}, helpers);
return uiAvatarsUrl;
```

## prefetchLogos(domains, helpers)

Batch-fetch logos for an array of domains (used by report generators to prefill the cache before render):

```javascript
/**
 * Prefetch and cache logos for multiple domains.
 * @param {string[]} domains - May contain duplicates
 * @param {object} helpers
 */
async function prefetchLogos(domains, helpers) { ... }
```

### Implementation

1. **Deduplicate** in memory FIRST:
   ```javascript
   const uniqueDomains = [...new Set(domains)];
   ```
   This prevents race conditions where two parallel requests for the same domain both miss the cache and both try to POST to NocoDB.

2. **Batch cache check**: For all unique domains, do a single NocoDB query using `~or` filter:
   ```
   where=(domain,eq,nvidia.com)~or(domain,eq,apple.com)~or(...)
   ```

3. **Find missing**: domains not in the cache response.

4. **Parallel fetch with concurrency limit of 3**:
   - Process missing domains in chunks of 3
   - For each chunk, call `getCompanyLogo(domain, domain.split('.')[0].toUpperCase(), helpers)` in parallel
   - `await Promise.all(chunk.map(...))`

## Error Isolation

Each step is in a `try/catch`. A Brandfetch timeout or 404 is logged as `console.warn`, not thrown. The function always returns a URL.

```javascript
try {
  // Brandfetch fetch + validate + upload
} catch (err) {
  console.warn(`[identity-assets] Brandfetch failed for ${domain}: ${err.message}`);
}
// fall through to UI Avatars
```

## R2 Upload

Uses the `uploadToR2` function from `render-pdf.js`:
```javascript
const { uploadToR2 } = require('./render-pdf');
```

## Module Structure (Part A)

```javascript
'use strict';
const { uploadToR2 } = require('./render-pdf');

// Internal helpers (not exported)
async function _cacheGet(tableId, keyField, keyValue, helpers) { ... }
async function _cacheSet(tableId, keyField, keyValue, data, helpers) { ... }

// Public API
async function getCompanyLogo(domain, tickerAbbrev, helpers) { ... }
async function prefetchLogos(domains, helpers) { ... }

// Section 07 will add: getInsiderPhoto(), normalizeInsiderName()

module.exports = {
  getCompanyLogo,
  prefetchLogos,
  // getInsiderPhoto added in Section 07
};
```

## Mock Pattern for Tests

```javascript
const mockHelpers = {
  fetchFn: jest.fn(),
  env: {
    NOCODB_API_URL: 'http://nocodb.test',
    NOCODB_API_TOKEN: 'test-token',
    NOCODB_LOGO_TABLE_ID: 'tbl_logos_test',
  },
  _sleep: jest.fn(),
};

// Cache miss:
mockHelpers.fetchFn
  .mockResolvedValueOnce({ ok: true, json: async () => ({ list: [] }) })  // NocoDB miss
  .mockResolvedValueOnce({ status: 200, headers: { get: () => 'image/png' }, buffer: async () => Buffer.alloc(100) });  // Brandfetch hit
```

## Acceptance Criteria

- [x] All test stubs above pass
- [x] `getCompanyLogo` with cached TTL-valid entry returns immediately without calling Brandfetch
- [x] `getCompanyLogo` with expired cache re-fetches
- [x] `getCompanyLogo` when Brandfetch returns SVG → POSTs to screenshot server
- [x] `getCompanyLogo` when Brandfetch returns > 500KB → falls to UI Avatars
- [x] `getCompanyLogo` always returns a URL string (never null/undefined)
- [x] `prefetchLogos(['nvidia.com', 'nvidia.com'])` only calls Brandfetch once
- [x] NocoDB PATCH (not POST) used when updating an existing cache entry

## Implementation Notes (Actual)

- Files created: `n8n/code/insiderbuying/identity-assets.js`, `tests/insiderbuying/identity-assets.test.js`
- `_cacheGet` / `_cacheSet` internal helpers share NocoDB fetch logic; `_cacheSet` does its own existence check (ignoring TTL) to decide POST vs PATCH
- `prefetchLogos` uses URL-routing mock in tests (smart mock by URL pattern) instead of sequential mocks — more robust for parallel execution
- Code review auto-fixes: `_nocoGet` now checks `res.ok`; SVG rasterization HTML includes CSP meta tag; `_cacheSet` calls wrapped in try/catch to preserve URL return on NocoDB write failure; correct MIME type passed to `uploadToR2` for non-SVG images; domain sanitized in R2 key
- 15/15 tests pass
