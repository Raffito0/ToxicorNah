
---

# Section 07 — Identity Assets: Insider Photos (identity-assets.js, Part B)

## Overview

Complete `n8n/code/insiderbuying/identity-assets.js` with the insider photo resolution system. Adds `getInsiderPhoto(fullName, title, helpers)` with a 3-tier cascade (Wikidata SPARQL → Google Knowledge Graph → UI Avatars), NocoDB caching, name normalization, and redirect-following HEAD verification.

## Dependencies

- Section 01 (`visual-css.js`) must be complete
- Section 06 (Part A of `identity-assets.js`) must be complete — reuses `_cacheGet` and `_cacheSet` helpers

## File to Extend

```
n8n/code/insiderbuying/identity-assets.js
```

(Add `normalizeInsiderName()` and `getInsiderPhoto()` to the existing file)

## Tests to Add

Add to `tests/insiderbuying/identity-assets.test.js`:

### Photo Cascade Tests

```
# Test: getInsiderPhoto checks NocoDB cache first
# Test: cache hit returns cached URL without calling Wikidata
# Test: Wikidata SPARQL returns image → verifies via HEAD → caches with source 'wikidata'
# Test: Wikidata request includes descriptive User-Agent header
# Test: Wikidata HEAD request uses redirect: 'follow'
# Test: Wikidata SPARQL no image → falls to Google KG
# Test: Wikidata SPARQL timeout → falls to Google KG
# Test: Google KG returns image → verifies via HEAD → caches with source 'google_kg'
# Test: Google KG image URL returns 403 → falls to UI Avatars
# Test: Google KG timeout → falls to UI Avatars
# Test: UI Avatars URL includes firstName+lastName
# Test: UI Avatars result cached with source 'ui_avatars'
```

### Name Normalization Tests

```
# Test: "Dr. Jensen Huang Jr." → "jensen huang"
# Test: "Mr. John Smith III" → "john smith"
# Test: "Elon Musk" → "elon musk"
# Test: "mary-jane o'connor" → "mary-jane o'connor"
# Test: unicode accented names normalized via NFKD
# Test: empty string → empty string
# Test: null/undefined → empty string
```

Run: `npm test -- tests/insiderbuying/identity-assets.test.js`

## Photos Table

**NocoDB table**: `Insider_Photos` (tableId provided via `helpers.env.NOCODB_PHOTOS_TABLE_ID`)

| Field | Type | Notes |
|-------|------|-------|
| `name_normalized` | SingleLineText | Primary key (normalized name) |
| `photo_url` | URL | Direct image URL |
| `source` | SingleLineText | `'wikidata'`, `'google_kg'`, or `'ui_avatars'` |
| `fetched_at` | DateTime | ISO 8601 string |
| `ttl_seconds` | Number | Default 2592000 (30 days) |

## normalizeInsiderName(fullName)

```javascript
/**
 * Normalize a full name for use as a cache key.
 * @param {string|null|undefined} fullName
 * @returns {string} Lowercase normalized name, or '' for null/undefined/empty
 */
function normalizeInsiderName(fullName) { ... }
```

### Normalization Steps (in order)

1. **Null/undefined guard**: if `!fullName` → return `''`
2. **Unicode normalization**: `fullName.normalize('NFKD')` — handles accented characters
3. **Strip honorific prefixes**: remove `Dr.`, `Mr.`, `Mrs.`, `Ms.`, `Prof.` (case-insensitive, with optional trailing period)
4. **Strip generational suffixes**: remove `Jr.`, `Sr.`, `Jr`, `Sr`, `III`, `IV`, `II`, `I` (as standalone tokens, case-insensitive)
5. **Lowercase** and **trim**

### Test Cases

| Input | Expected Output |
|-------|----------------|
| `"Dr. Jensen Huang Jr."` | `"jensen huang"` |
| `"Mr. John Smith III"` | `"john smith"` |
| `"Elon Musk"` | `"elon musk"` |
| `"mary-jane o'connor"` | `"mary-jane o'connor"` |
| `"José García"` | `"jose garcia"` (NFKD strips accents) |
| `""` | `""` |
| `null` | `""` |
| `undefined` | `""` |

Note on `"mary-jane o'connor"`: the hyphen and apostrophe are preserved — only honorifics and generational suffixes are stripped, not punctuation.

## getInsiderPhoto(fullName, title, helpers)

```javascript
/**
 * Resolve an insider/executive photo URL with 3-tier cascade.
 * @param {string} fullName - e.g. "Jensen Huang"
 * @param {string} title - e.g. "CEO" — used for KG query and UI Avatars name
 * @param {object} helpers - { fetchFn, env, _sleep }
 * @returns {Promise<string>} Always returns a URL (never null)
 */
async function getInsiderPhoto(fullName, title, helpers) { ... }
```

### Step 1: Check NocoDB Cache

```javascript
const normalizedName = normalizeInsiderName(fullName);
const cached = await _cacheGet(
  helpers.env.NOCODB_PHOTOS_TABLE_ID,
  'name_normalized', normalizedName, helpers
);
if (cached) return cached.photo_url;
```

### Step 2: Wikidata SPARQL (Tier 1)

SPARQL query to find a person's image (P18 property):

```sparql
SELECT ?image WHERE {
  ?entity wdt:P31 wd:Q5 .
  ?entity rdfs:label "{fullName}"@en .
  ?entity wdt:P18 ?image .
}
LIMIT 1
```

POST to `https://query.wikidata.org/sparql`:
- Body: `query={SPARQL_QUERY}`
- Headers:
  - `Accept: application/sparql-results+json`
  - `User-Agent: EarlyInsiderBot/1.0 (contact@earlyinsider.com)` — **REQUIRED**. Wikimedia blocks requests without a descriptive User-Agent.
  - `Content-Type: application/x-www-form-urlencoded`

Parse response: `data.results.bindings[0]?.image?.value` → Wikimedia Commons file URL (e.g. `http://commons.wikimedia.org/wiki/Special:FilePath/Jensen_Huang.jpg`)

**Construct direct image URL**: Append `?width=300` to get a sized version: `{commonsUrl}?width=300`

**HEAD verification**:
```javascript
const headResponse = await helpers.fetchFn(imageUrl, {
  method: 'HEAD',
  redirect: 'follow',   // REQUIRED — Special:FilePath returns 301/302
});
if (headResponse.ok && headResponse.headers.get('content-type')?.startsWith('image/')) {
  // valid image
}
```

If valid:
```javascript
await _cacheSet(photosTableId, 'name_normalized', normalizedName, {
  name_normalized: normalizedName, photo_url: imageUrl, source: 'wikidata',
  fetched_at: new Date().toISOString(), ttl_seconds: 2592000
}, helpers);
return imageUrl;
```

If SPARQL returns no image, times out, or HEAD fails → fall through to Tier 2.

### Step 3: Google Knowledge Graph (Tier 2)

```javascript
const kgUrl = `https://kgsearch.googleapis.com/v1/entities:search?query=${encodeURIComponent(fullName + ' ' + title)}&types=Person&key=${helpers.env.GOOGLE_KG_API_KEY}&limit=1`;
const response = await helpers.fetchFn(kgUrl);
```

Parse: `data.itemListElement?.[0]?.result?.image?.contentUrl`

**HEAD verification with 403 fallthrough**:
```javascript
const headResponse = await helpers.fetchFn(imageUrl, { method: 'HEAD', redirect: 'follow' });
if (headResponse.status === 403) {
  // KG image is encrypted/blocked — fall through to Tier 3, do NOT cache
  throw new Error('KG image returned 403');
}
if (!headResponse.ok || !headResponse.headers.get('content-type')?.startsWith('image/')) {
  throw new Error('KG image verification failed');
}
```

If valid → cache with `source: 'google_kg'`, return URL.

If 403, timeout, or parse error → fall through to Tier 3.

### Step 4: UI Avatars (Tier 3, always succeeds)

```javascript
const nameParts = normalizedName.split(' ');
const firstName = nameParts[0] || 'U';
const lastName = nameParts[1] || 'I';
const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + '+' + lastName)}&background=0A1128&color=fff&size=128&bold=true&rounded=true`;

await _cacheSet(photosTableId, 'name_normalized', normalizedName, {
  name_normalized: normalizedName, photo_url: uiAvatarsUrl, source: 'ui_avatars',
  fetched_at: new Date().toISOString(), ttl_seconds: 2592000
}, helpers);
return uiAvatarsUrl;
```

The UI Avatars URL includes `firstName+lastName` (e.g., `name=Jensen+Huang`).

## Error Isolation

Each tier is in a try/catch:

```javascript
// Tier 1
try {
  const url = await _tryWikidata(fullName, helpers);
  if (url) { /* cache + return */ }
} catch (err) {
  console.warn(`[identity-assets] Wikidata failed for "${fullName}": ${err.message}`);
}

// Tier 2
try {
  const url = await _tryGoogleKG(fullName, title, helpers);
  if (url) { /* cache + return */ }
} catch (err) {
  console.warn(`[identity-assets] Google KG failed for "${fullName}": ${err.message}`);
}

// Tier 3 — no try/catch, always works
return _fallbackUIAvatars(normalizedName, helpers);
```

A timeout on Wikidata does NOT prevent the Google KG attempt. A 403 from Google KG falls to UI Avatars.

## Updated Module Exports

```javascript
module.exports = {
  // From Section 06
  getCompanyLogo,
  prefetchLogos,
  // Added in this section
  getInsiderPhoto,
  normalizeInsiderName,  // exported for testing
};
```

## Mock Pattern for Tests

```javascript
// Cache miss for photos:
mockHelpers.fetchFn
  .mockResolvedValueOnce({ ok: true, json: async () => ({ list: [] }) })  // NocoDB miss
  .mockResolvedValueOnce({  // Wikidata SPARQL response
    ok: true,
    json: async () => ({
      results: { bindings: [{ image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/JensenHuang.jpg' } }] }
    })
  })
  .mockResolvedValueOnce({  // HEAD verification
    ok: true, status: 200,
    headers: { get: () => 'image/jpeg' }
  });
```

## Acceptance Criteria

- [x] All test stubs above pass
- [x] `normalizeInsiderName("Dr. Jensen Huang Jr.")` returns `"jensen huang"`
- [x] `normalizeInsiderName(null)` returns `""`
- [x] Wikidata SPARQL request has `User-Agent: EarlyInsiderBot/1.0 ...` header
- [x] Wikidata HEAD request has `redirect: 'follow'`
- [x] Google KG 403 response → falls to UI Avatars (not cached)
- [x] `getInsiderPhoto` always returns a URL string (never null)
- [x] UI Avatars URL contains `name=Jensen+Huang` format (first+last from normalized name)
- [x] Cache miss → Wikidata success → NocoDB write with `source: 'wikidata'`

## Implementation Notes (Actual)

- File extended: `n8n/code/insiderbuying/identity-assets.js` (added `normalizeInsiderName`, `_tryWikidata`, `_tryGoogleKG`, `getInsiderPhoto`)
- Test file extended: `tests/insiderbuying/identity-assets.test.js` (added 18 tests: 8 normalizeInsiderName + 12 getInsiderPhoto cascade)
- `normalizeInsiderName`: NFKD + strip combining chars + regex for honorific prefixes + suffix tokens + lowercase/trim
- `_tryWikidata` / `_tryGoogleKG`: internal helpers keep `getInsiderPhoto` clean; each returns URL or null (soft miss) or throws (hard failure)
- Code review auto-fixes: SPARQL injection escaping added; HTTPS-only validation for Wikidata image URL (SSRF prevention); KG API key moved to `X-Goog-Api-Key` header; `encodeURIComponent` double-encoding fixed for UI Avatars name param; `makePhotoHelpers` dead alias removed from tests; raw `fullName` usage documented with comments
- `wikidataHit()` test fixture URL updated to `https://` to match the new HTTPS-only validation
- 33/33 tests pass (15 S06 + 18 S07)
