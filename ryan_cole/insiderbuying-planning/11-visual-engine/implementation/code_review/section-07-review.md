# Section 07 Code Review — identity-assets.js Part B (Insider Photos)

Reviewer: Claude Code (Sonnet 4.6)
Date: 2026-03-29
Files reviewed:
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js` (lines 195–342)
- `ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js` (lines 292–560)

---

## What Was Done Well

The 3-tier cascade architecture is clean and correctly isolated — each tier throws on hard failures and returns `null` on soft misses, which is the right contract to make `getInsiderPhoto` composable. The `_cacheSet` try/catch wrapper around every tier is applied consistently, so a NocoDB outage never breaks photo resolution. The existing `_cacheGet` / `_cacheSet` / `_nocoGet` helpers are reused without duplication. The test suite is organized by scenario (cache hit, Wikidata hit, Wikidata miss → KG, KG failures, UI Avatars) and covers the main paths. The `nocoDone` helper and `makeHelpers` sequencing pattern from previous sections are used consistently.

---

## Issues

### CRITICAL

**C1 — SPARQL injection via `fullName` interpolated directly into the query string**

File: `identity-assets.js` line 220

```js
const sparql = `SELECT ?image WHERE { ?entity wdt:P31 wd:Q5 . ?entity rdfs:label "${fullName}"@en . ?entity wdt:P18 ?image . } LIMIT 1`;
```

`fullName` is inserted into the SPARQL literal without escaping. A name containing a double-quote, backslash, or newline breaks the query syntax. A name like `Jensen" } # comment` would close the string early and allow arbitrary SPARQL injection into the endpoint call. While Wikidata's public SPARQL endpoint is read-only and does not expose internal data that could be stolen, the query will either error or silently return wrong results, which is a correctness issue as well as a policy risk (Wikidata's bot policy prohibits malformed automated queries). The fix is a one-line SPARQL string literal escaper applied before interpolation:

```js
// Escape SPARQL string literal: backslash, double-quote, newline, carriage-return, tab
const escaped = fullName.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
const sparql = `SELECT ?image WHERE { ... ?entity rdfs:label "${escaped}"@en ... }`;
```

Action: **Auto-fix** — the escaping is mechanical, the correct output is not ambiguous, and the existing test for `normalizeInsiderName` already strips problematic prefixes but does not prevent injection because the raw `fullName` (not the normalized name) is passed to `_tryWikidata`.

Note: `normalizeInsiderName` output is used only as the cache key. The raw `fullName` goes directly into the SPARQL query. Even after stripping honorifics, names sourced from SEC filings can contain quotes (e.g., `O'Brien`) — an apostrophe is safe in a SPARQL string but a double-quote or backslash is not.

---

### IMPORTANT

**I1 — `_tryWikidata` HEAD verification does not guard against non-Wikimedia URLs in the `?image` binding**

File: `identity-assets.js` lines 232–238

The `?image` variable from Wikidata is expected to be a Wikimedia Commons file path URL. However, Wikidata's P18 property can contain any IRI, including third-party image hosts. The HEAD check verifies content-type and HTTP status, but it makes an outbound request to an arbitrary URL extracted from the SPARQL result. In the current n8n sandbox context this is acceptable (the function is server-side and intentionally does outbound fetches), but there is no domain allowlist or URL scheme check, so a crafted Wikidata record could redirect the HEAD request to an internal network address (SSRF).

For this codebase's risk profile — a Node.js n8n Code node on a VPS — this is a meaningful concern. At minimum, validate that the URL starts with `https://` before making the HEAD request. A stricter fix would also validate the host against a Wikimedia allowlist.

Action: **Auto-fix** — add `if (!imageValue.startsWith('https://')) return null;` before the `?width=300` append. This costs one line and eliminates both SSRF and HTTP downgrade.

**I2 — `_tryGoogleKG` HEAD check throws on 403, but the 403 is not caused by the image URL being invalid — it is caused by hotlink protection. Caching the UI Avatars result as a permanent 30-day entry is incorrect.**

File: `identity-assets.js` lines 250–251 and `getInsiderPhoto` lines 296–314

When KG returns an image URL that responds with 403 (hotlink-protected CDN), `_tryGoogleKG` throws `'KG image returned 403'`, which is caught by `getInsiderPhoto`'s outer try/catch at line 312 and falls through to UI Avatars. The UI Avatars result is then cached for 30 days (the full `TTL_SECONDS`). This means that for the next 30 days, every lookup for this insider returns the placeholder avatar, even though Wikidata may have the actual photo and even though the KG result might unblock if the CDN policy changes.

The correct behavior for a KG 403 is a shorter TTL on the fallback (e.g., 24 hours), not 30 days. Alternatively, only cache the UI Avatars result for shorter-lived lookups so the system retries sooner.

This is a business logic issue more than a bug: the photo will be wrong for 30 days per insider affected. Given that this runs for every insider in every alert report, the impact could be large.

Action: **Ask user** — a separate `TTL_SECONDS_PHOTO_FALLBACK` constant (e.g., 86400 = 1 day) for UI Avatars entries is the right fix, but the right TTL value is a product decision.

**I3 — `_tryGoogleKG` includes the API key in the URL, which will appear in n8n execution logs**

File: `identity-assets.js` line 242

```js
const kgUrl = `https://kgsearch.googleapis.com/v1/entities:search?query=...&key=${helpers.env.GOOGLE_KG_API_KEY}&limit=1`;
```

n8n logs full URLs from HTTP requests in its execution history. The `key=` parameter will be visible in plaintext to anyone with access to the n8n UI. The Google Knowledge Graph API key has per-day quota limits but no built-in scope restrictions — a leaked key allows unrestricted KG queries billed to the account.

The standard mitigation is to pass the key as an `X-Goog-Api-Key` header instead of a query parameter. The KG API supports this.

Action: **Auto-fix** — move the key to a header: `headers: { 'X-Goog-Api-Key': helpers.env.GOOGLE_KG_API_KEY }`. Remove `&key=...` from the URL. This is a one-line change with no behavioral difference.

---

### SUGGESTIONS

**S1 — `normalizeInsiderName` suffix regex matches the Roman numeral "I" as a suffix, which will incorrectly strip the last name token of any insider whose last name ends with a standalone "I"**

File: `identity-assets.js` line 210

```js
name = name.replace(/\s+(Jr\.?|Sr\.?|III|IV|II|I)\s*$/i, '');
```

The pattern `I` matches any single uppercase or lowercase "i" at the end of the name after a space. The name "Raj Modi" normalizes to "raj modi" before this regex runs, so `i` at the end does not match. However, the regex runs on the mixed-case intermediate string before `.toLowerCase()`. The name "Joseph Li" would not be affected (the regex is case-insensitive and "li" ends with "i", but the pattern requires a preceding space and the token to be exactly "I" — "li" is two characters). The actual risk is names where the last token is exactly one character: "Mao I" → stripped to "mao", or "Chou Yi" → stripped to "chou". These are uncommon in SEC filing data but not impossible.

A tighter fix is to anchor the suffix list to tokens of at least 2 characters where possible, or require the Roman numeral tokens to be uppercase only (i.e., remove the `i` flag from the suffix regex). Since the input is a proper name from a database, suffixes like "III" will always arrive in title or upper case.

Action: **Let go** for now — the probability of a real insider's last name being exactly "I" (after honorific stripping) is very low in the target dataset. Flag for a future name-normalization cleanup pass if false positives appear in production.

**S2 — `getInsiderPhoto` passes `fullName` (not `normalizedName`) to `_tryWikidata` and `_tryGoogleKG`, which is correct for lookup accuracy but is not documented in the function**

File: `identity-assets.js` lines 276, 297 and JSDoc lines 72–78

The JSDoc says `@param {string} fullName - e.g. "Jensen Huang"` but does not explain the distinction between what is sent to external APIs (raw `fullName`) versus what is used as the cache key (`normalizedName`). A future developer might "fix" this by passing `normalizedName` to the API calls, which would break lookups for names with honorifics (the honorific is stripped before the Wikidata query, making it less likely to match). A one-line comment at each call site would prevent this.

Action: **Auto-fix** — add `// raw fullName preserves honorifics and diacritics that Wikidata/KG need for matching` at lines 276 and 297.

**S3 — UI Avatars URL uses `encodeURIComponent(firstName + '+' + lastName)` which double-encodes the `+` separator**

File: `identity-assets.js` line 320

```js
const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + '+' + lastName)}&...`;
```

`encodeURIComponent('+')` produces `%2B`. UI Avatars interprets `name=jensen%2Bhuang` as a literal `+` in the name parameter, which it treats as a space separator — so this actually works correctly by accident. But the intent is to use `+` as a space character in the query string (the `application/x-www-form-urlencoded` convention), which requires passing `firstName+lastName` without encoding the `+`. The more readable and correct form is:

```js
const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&...`;
```

The current code produces correct output because UI Avatars decodes `%2B` back to `+` and then re-treats it as a space. This is relying on a quirk of one external service. Using explicit `+` between separately encoded parts is semantically correct and does not depend on that quirk.

Action: **Auto-fix** — low risk, makes the encoding intent explicit.

**S4 — Test: `makePhotoHelpers` is a pass-through alias for `makeHelpers` that adds no value**

File: `identity-assets.test.js` line 390

```js
function makePhotoHelpers(fetchMocks) {
  return makeHelpers(fetchMocks);
}
```

This function exists only in the diff. It is a one-liner that adds a name but no behavior. All test calls to `makePhotoHelpers` could be replaced with direct `makeHelpers` calls, consistent with how `prefetchLogos` tests use `makeHelpers` directly. The alias adds indirection without clarity.

Action: **Auto-fix** — remove `makePhotoHelpers` and use `makeHelpers` directly at the 6 call sites. This is a test-only change with no production impact.

**S5 — Test: no test covers the case where `normalizedName` is empty (i.e., `fullName` is null/undefined passed to `getInsiderPhoto`)**

File: `identity-assets.test.js`

`normalizeInsiderName(null)` returns `''`. If `getInsiderPhoto` is called with `null` as `fullName`, `normalizedName` is `''`, the cache key becomes an empty string, `_cacheGet` queries NocoDB with `name_normalized eq ''`, the UI Avatars URL becomes `name=U%2BI` (the fallback initials), and it all succeeds silently. The behavior is defined but untested. A test asserting that `getInsiderPhoto(null, 'CEO', helpers)` returns a UI Avatars URL without throwing would document this contract.

Action: **Let go** for now — the behavior is safe and the input domain (SEC filings) is unlikely to produce null names. Add if defensive coverage becomes a priority.

**S6 — Test: `head403()` sets `ok: false` but `_tryGoogleKG` checks `head.status === 403` before checking `!head.ok`. The order is correct in production code, but the test mock conflates the two conditions.**

File: `identity-assets.test.js` line 365 and `identity-assets.js` line 250

The production check is:
```js
if (head.status === 403) throw new Error('KG image returned 403');
if (!head.ok || ...) throw new Error('KG image verification failed');
```

The test mock sets both `ok: false` and `status: 403`. This means the test does not distinguish the 403 branch from the generic `!head.ok` branch — both would throw, just with a different message. The test verifies the end behavior (falls to UI Avatars) correctly, but does not verify that the KG-specific 403 message is thrown versus the generic failure message. This is fine for integration coverage, but the comment in the test says "HEAD returns 403 — blocked image", which is accurate.

Action: **Let go** — the distinction between the two throw messages matters only if there are monitoring/alerting rules keyed on those specific log strings. If that is the case, add a `console.warn` spy to verify the correct message. Not necessary today.

---

## Summary Table

| ID | Severity | Description | Action |
|----|----------|-------------|--------|
| C1 | Critical | SPARQL injection via unescaped `fullName` in query literal | Auto-fix |
| I1 | Important | No URL scheme or host validation before HEAD request to Wikidata image URL (SSRF) | Auto-fix |
| I2 | Important | UI Avatars cached at full 30-day TTL after KG 403 (hotlink block) | Ask user |
| I3 | Important | Google KG API key exposed in URL (visible in n8n logs) | Auto-fix |
| S1 | Suggestion | Roman numeral "I" suffix regex could strip single-char last names | Let go |
| S2 | Suggestion | Missing comment explaining why raw `fullName` is used for API calls | Auto-fix |
| S3 | Suggestion | `encodeURIComponent(firstName + '+' + lastName)` double-encodes `+` | Auto-fix |
| S4 | Suggestion | `makePhotoHelpers` is a dead alias; use `makeHelpers` directly | Auto-fix |
| S5 | Suggestion | No test for `getInsiderPhoto(null, ...)` null name path | Let go |
| S6 | Suggestion | `head403()` mock cannot distinguish 403 branch from generic !ok branch | Let go |

---

## Answers to Specific Review Questions

**1. Security issues (SPARQL injection, URL validation)**
SPARQL injection is present and must be fixed (C1). URL validation is absent for the Wikidata image URL before the HEAD call (I1). The KG API key in the URL is a credential exposure issue (I3).

**2. Correctness of the 3-tier cascade**
The cascade is structurally correct. Each tier is wrapped in its own try/catch in `getInsiderPhoto`. A thrown error in any tier falls through to the next. A `null` return (soft miss) also falls through correctly because of the `if (url)` guard. The "always returns a URL" contract is maintained: the UI Avatars URL is constructed from deterministic inputs that cannot fail, and it is returned unconditionally after the outer try/catch for the cache write.

**3. Error isolation — does a Wikidata timeout correctly fall through to KG?**
Yes. The `await _tryWikidata(...)` call is inside a try/catch. Any rejection (network timeout, abort, DNS failure) is caught, logged as a warning, and execution continues into the KG block. The test at line 483 (`'Wikidata timeout → falls to Google KG'`) covers this path. The fallthrough is correct.

**4. `normalizeInsiderName` regex correctness**
The honorific prefix regex `/^\s*(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i` is correct for the common cases. The NFKD + combining-character strip is correct for accented Latin characters. The suffix regex `/(Jr\.?|Sr\.?|III|IV|II|I)\s*$/i` has the edge case described in S1 (standalone "I" could strip a legitimate name token) but this is low risk in the target dataset. The `.trim()` at the end handles any trailing whitespace left by the prefix strip. One unhandled case: a non-ASCII honorific or suffix (e.g., Cyrillic or CJK prefixes). These will pass through unmodified, which is the safe behavior.

**5. HEAD verification — is `redirect: 'follow'` correct?**
Yes. Wikimedia Commons image URLs (the `Special:FilePath/` pattern) redirect to the actual CDN URL. Without `redirect: 'follow'`, the HEAD would receive a 301/302 and `res.ok` would be false, causing valid images to be dropped. The test at line 443 explicitly verifies this option is set.

**6. KG 403 handling — does it correctly NOT cache and fall through?**
Yes. `_tryGoogleKG` throws on 403. The throw is caught by the outer try/catch in `getInsiderPhoto` (line 312). The code then falls through to UI Avatars, which is cached. So 403 is not cached as a KG result. However, the UI Avatars fallback IS cached at full TTL — see I2 above.

**7. `_cacheSet` try/catch — is the "always returns URL" contract maintained?**
Yes, at all three tiers. The pattern is:
```
try { await _cacheSet(...) } catch (err) { console.warn(...) }
return url;
```
The `return url` is outside the inner try/catch, so a cache write failure never prevents the URL from being returned. The contract is maintained.

**8. Missed edge cases in test helpers**
- `head403()` sets `ok: false` and `status: 403` — both conditions are true, so the test cannot distinguish the 403 branch from `!head.ok` (S6, let go).
- No test helper for a HEAD response where `ok: true` but `content-type` is not `image/*` (e.g., `text/html`). This path (returns `null` from `_tryWikidata`) is not directly tested — only the SPARQL no-results path is tested as a "miss". Minor gap, safe to let go.
- `wikidataHit()` default URL uses `http://` (not `https://`). After auto-fixing I1 (reject non-https), this test would fail. The test fixture URL must be updated to `https://` when I1 is fixed.
