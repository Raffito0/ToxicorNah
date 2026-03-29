# Section 07 Code Review Interview

## Auto-fixes Applied

### Fix C1: SPARQL injection via unescaped `fullName`
- Escaped `\`, `"`, `\n`, `\r`, `\t` in `fullName` before interpolating into SPARQL literal
- **Why**: A name containing `"` or `\` would break the SPARQL string syntax. While Wikidata is read-only and no data is at risk, malformed queries violate Wikidata bot policy and produce wrong results.

### Fix I1: No URL scheme validation before HEAD request to Wikidata image URL
- Added `if (!imageValue.startsWith('https://')) return null;` before constructing the image URL
- **Why**: Wikidata's P18 IRI binding can point to any host. Rejecting non-HTTPS prevents HTTP downgrade and blocks basic SSRF via crafted Wikidata records.
- **Test fixture updated**: `wikidataHit()` default URL changed from `http://` to `https://` to match the new validation.

### Fix I3: Google KG API key exposed in URL query string
- Moved API key from `&key=...` URL parameter to `X-Goog-Api-Key` request header
- **Why**: n8n logs full request URLs in execution history. The key was visible in plaintext to anyone with n8n UI access.

### Fix S2: Missing comment explaining raw `fullName` vs `normalizedName` at API call sites
- Added comment at both Wikidata and KG call sites explaining why `fullName` (not `normalizedName`) is passed to external APIs
- **Why**: Passing the normalized name would strip honorifics before the Wikidata lookup, reducing match accuracy. A future developer could "fix" this and break lookups.

### Fix S3: `encodeURIComponent(firstName + '+' + lastName)` double-encodes the `+`
- Changed to `encodeURIComponent(firstName) + '+' + encodeURIComponent(lastName)`
- **Why**: `encodeURIComponent('+')` produces `%2B`, not a space separator. The previous code worked by accident because UI Avatars decodes `%2B` back to `+`. The fix makes the encoding intent explicit and does not depend on that service-specific quirk.

### Fix S4: `makePhotoHelpers` was a dead pass-through alias for `makeHelpers`
- Removed `makePhotoHelpers` function; replaced all 6 call sites with direct `makeHelpers` calls
- **Why**: The alias added indirection without any value. `makeHelpers` is already the pattern established for the S06 tests.

## Decisions Let Go

### I2: UI Avatars cached at full 30-day TTL after KG 403 hotlink block
- When KG returns a URL that responds with 403 (hotlink protection), the fallback UI Avatars placeholder is cached for 30 days.
- **Decision**: Let go for now. The TTL value is a product decision. Adding a separate `TTL_SECONDS_PHOTO_FALLBACK` (e.g., 86400 = 1 day) is the right long-term fix but requires a spec decision on what constitutes a "temporary" vs "permanent" cache entry. The current behavior is consistent with how S06 logos handle their fallbacks.

### S1: Roman numeral "I" suffix regex edge case
- The regex `/\s+(Jr\.?|Sr\.?|III|IV|II|I)\s*$/i` could strip a single-character last name like "Mao I".
- **Decision**: Let go. The target dataset is SEC insider filings — virtually no US executives have a surname that is exactly the letter "I". Flag for a future cleanup pass if false positives appear.

### S5: No test for `getInsiderPhoto(null, 'CEO', helpers)`
- Null `fullName` produces `normalizedName = ''`, cache key becomes empty string, falls through to UI Avatars with initials `U+I`.
- **Decision**: Let go. The behavior is safe. The input domain (SEC filings) will not produce null names in practice.
