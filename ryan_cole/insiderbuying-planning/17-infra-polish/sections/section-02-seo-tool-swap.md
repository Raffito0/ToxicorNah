# Section 02: SEO Tool Swap (DataForSEO -> Keywords Everywhere Bronze)

## Overview

Replace the DataForSEO HTTP calls in `select-keyword.js` with **Keywords Everywhere Bronze** as the
primary SEO data source. DataForSEO is retained as a named fallback -- its env vars must NOT be
removed.

**Why this change:** The prior plan referenced Ahrefs (no free tier, paid plan ~hundreds/month) and
Ubersuggest (confirmed: no public API exists -- their own FAQ states this explicitly). Keywords
Everywhere Bronze provides KD + volume + CPC in a single call for $1.75/month (100,000
credits/year). At 300 keywords/month the usage is ~3.6% of quota -- no quota guard needed.

**No SEO_State NocoDB table required** -- the old Ubersuggest quota guard is dropped entirely.

**Dependencies:** No other sections block this one. No pre-flight NocoDB table creation needed.

---

## Tests First

Test file: `n8n/tests/select-keyword.test.js` (update existing or create new)

Run with: `node --test n8n/tests/*.test.js`

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
```

All external HTTP calls (KWE, NocoDB) are mocked via stub functions passed through `opts`.

### Test stubs to implement

**fetchKWEKeywords -- happy path:**
- Given a mock 200 response with 2 keyword objects, returns an array of
  `{ keyword, kd, volume, cpc }` objects (4 fields, no extras)
- `kd` is mapped from `data[n].seo_difficulty` (falls back to `data[n].on_page_difficulty` if
  `seo_difficulty` is absent)
- `volume` is mapped from `data[n].vol`
- `cpc` is mapped from `data[n].competition.value` (PPC competition 0-1 float)

**fetchKWEKeywords -- request shape:**
- Request method is `POST` to `https://api.keywordseverywhere.com/v1/get_keyword_data`
- Request body contains `{ country: 'us', currency: 'usd', dataSource: 'gkp', 'kw[]': [...] }`
- Request header contains `Authorization: Bearer <KWE_API_KEY>`

**fetchKWEKeywords -- edge cases:**
- Empty keyword list passed to function -> returns `[]` without making an HTTP call
- KWE returns HTTP 5xx -> function throws a descriptive error (not a silent empty array)
- KWE returns HTTP 429 (over rate limit) -> function throws with message including "429"

**computePriorityScore:**
- Accepts `{ kd, volume }` field names and returns a numeric score
- Low-kd, high-volume keyword scores higher than high-kd, low-volume keyword
- DataForSEO field names (`competition_index`, `search_volume`) must NOT appear in the function
  signature or body

**DataForSEO fallback (static check):**
- `grep -ri "dataforseo" n8n/code/insiderbuying/select-keyword.js` returns 0 matches for any
  active call paths -- DataForSEO references only appear inside the named fallback function
  `fetchDataForSEOFallback()` and its associated comment block

**classifyIntent -- regression guard:**
- Classification results for a known set of keywords are unchanged from pre-refactor (intent is
  API-agnostic and must not regress)

---

## Implementation

**File to modify:** `n8n/code/insiderbuying/select-keyword.js`

### What to remove

Remove both DataForSEO active call functions (`fetchSearchVolume` and `fetchRelatedKeywords`) and
any logic that constructs the DataForSEO Basic Auth header (Base64 `login:password`). Do NOT
delete the file's DataForSEO credential references from `.env.example` -- they are kept for the
fallback function below.

Before modifying, grep to confirm no other `n8n/code/insiderbuying/` files call those two
functions by name:
```
grep -ri "fetchSearchVolume\|fetchRelatedKeywords" n8n/code/insiderbuying/
```
If callers exist outside `select-keyword.js`, coordinate before removing.

### fetchKWEKeywords(keywords, opts)

New primary fetch function. Replaces both old DataForSEO functions. Signature:

```javascript
async function fetchKWEKeywords(keywords, opts) { /* ... */ }
```

- Method: `POST https://api.keywordseverywhere.com/v1/get_keyword_data`
- Headers: `Authorization: Bearer ${process.env.KWE_API_KEY}`, `Accept: application/json`
- Body (JSON): `{ country: 'us', currency: 'usd', dataSource: 'gkp', 'kw[]': keywords }`
  (max 100 keywords per request -- callers must not exceed this)
- On success: map each item in `data` array to:
  ```javascript
  {
    keyword: item.keyword,
    kd: item.seo_difficulty ?? item.on_page_difficulty ?? 50,
    volume: item.vol ?? 0,
    cpc: item.competition?.value ?? null
  }
  ```
- On non-200 response: throw `new Error(\`KWE API error \${status}\`)` -- do not return empty array
- On network error: throw -- let caller decide whether to fall back

### fetchDataForSEOFallback(keywords, opts)

Named fallback, called only when `fetchKWEKeywords` throws. This is the preserved DataForSEO
integration. It calls `dataforseo_labs/google/keyword_overview/live` (not the old
`keywords_data/google_ads/` endpoints). Signature:

```javascript
async function fetchDataForSEOFallback(keywords, opts) { /* ... */ }
```

- Endpoint: `POST https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live`
- Auth: Basic HTTP -- Base64(`DATAFORSEO_LOGIN:DATAFORSEO_PASSWORD`)
- Body: array of `{ keywords: [...], language_code: 'en', location_code: 2840 }` (one task)
- Returns same shape as `fetchKWEKeywords`: `{ keyword, kd, volume, cpc }`
  - Map from: `keyword_info.search_volume` -> `volume`, `keyword_properties.keyword_difficulty`
    -> `kd`, `keyword_info.cpc` -> `cpc`
- This function is **never called directly** -- only invoked inside the combined fetch wrapper

### Combined fetch wrapper (replaces direct DataForSEO calls at call site)

```javascript
async function fetchKeywordData(keywords, opts) {
  try {
    return await fetchKWEKeywords(keywords, opts);
  } catch (err) {
    console.warn('[SEO] KWE failed, falling back to DataForSEO:', err.message);
    return await fetchDataForSEOFallback(keywords, opts);
  }
}
```

This is the only function callers inside `select-keyword.js` should use. One call, two providers,
transparent fallback.

### computePriorityScore update

`computePriorityScore()` currently accepts DataForSEO-specific field names. Update signature to:

```javascript
function computePriorityScore({ kd, volume }) { /* ... */ }
```

`traffic` (Ahrefs-specific organic visitor count) is not available from KWE. Remove it from the
scoring formula. The scoring should use `kd` and `volume` only:

```
score = (volume / 1000) * (1 - kd / 100)
```

This gives higher scores to high-volume, low-competition keywords. Cap `kd` at 100 before the
calculation to prevent negative scores from malformed data.

`classifyIntent()` is unchanged -- it operates on keyword text only.

### Overall flow in select-keyword.js

1. Call `fetchKeywordData(seedKeywords, opts)` -- returns KWE data or DataForSEO fallback
2. If result is empty -> send Telegram notification and return early (no scoring)
3. Score all candidates using `computePriorityScore({ kd, volume })`
4. Return ranked list to caller -- no secondary "exactVolume" enrichment needed (KWE already
   returns exact integers, not ranges)

No NocoDB quota guard. No SEO_State table. No sequential processing constraint.

### Environment variables

Update `.env.example`:

**Add:**
```
KWE_API_KEY=         # Keywords Everywhere API key (Bronze plan, $1.75/month)
```

**Keep (fallback -- do NOT remove):**
```
DATAFORSEO_LOGIN=    # DataForSEO fallback for keyword overview
DATAFORSEO_PASSWORD= # DataForSEO fallback for keyword overview
```

**Remove (no longer used anywhere):**
```
AHREFS_API_KEY=      # REMOVE -- Ahrefs dropped (no free tier)
UBERSUGGEST_API_KEY= # REMOVE -- Ubersuggest has no public API
```

---

## Definition of Done

- [x] `fetchKWEKeywords` calls `POST https://api.keywordseverywhere.com/v1/get_keyword_data` with
  `Authorization: Bearer KWE_API_KEY` and body containing `kw[]` array
- [x] `fetchDataForSEOFallback` exists as a named fallback and is only invoked inside
  `fetchKeywordData` wrapper (never called directly by scoring logic)
- [x] `computePriorityScore` accepts `{ kd, volume }` -- no `competition_index`, `search_volume`,
  or `traffic` field names remain in its signature or body
- [ ] Empty response from `fetchKeywordData` -> early return with Telegram notification
  **NOTE**: `runKeywordPipeline` is a pure data function with no Telegram access. Logs `console.warn`
  and falls back to seeds-only. Telegram alert is caller's responsibility in the n8n Code node.
- [x] `KWE_API_KEY` added to `.env.example`; `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` remain;
  `AHREFS_API_KEY` and `UBERSUGGEST_API_KEY` removed (were never in .env.example)
- [x] No `SEO_State` NocoDB table created or referenced (quota guard removed)
- [x] `classifyIntent()` behavior is unchanged (regression guard test passes)
- [x] All test stubs in `n8n/tests/select-keyword.test.js` pass

## Deviations from Plan

1. **INTENT_MULTIPLIERS not applied in computePriorityScore (D1)**: Spec explicitly said "Remove it
   from the scoring formula. The scoring should use `kd` and `volume` only." `INTENT_MULTIPLIERS`
   constant kept for reference but not applied. Comment added to document this.

2. **kd=50 fallback is named constant KWE_UNKNOWN_KD (D2)**: Code review finding M4. Hardcoded `50`
   replaced with `var KWE_UNKNOWN_KD = 50` with 4-line rationale comment.

3. **fetchKWEKeywords includes 100-keyword slice guard (D3)**: Code review finding H3. Spec noted
   the 100-keyword limit but said "callers must not exceed this" without enforcement. Guard added
   inside `fetchKWEKeywords` itself (slice to 100 + console.warn) for defense in depth.

4. **Both-providers-failed throws with combined message (D4)**: Code review finding H1.
   `fetchKeywordData` has nested try/catch: DataForSEO failure re-throws as
   `"[SEO] BOTH providers failed. KWE: ... | DataForSEO: ..."` for immediate diagnosability.

5. **KWE_API_KEY and DataForSEO credentials guarded (D5)**: Code review findings H2/M2. Early
   throws added when env vars are missing rather than producing opaque HTTP 401 errors.

6. **Test count**: 40 tests (39 original + 1 new `fetchKeywordData fallback chain` test).
   Run: `node --test n8n/tests/select-keyword.test.js`
