# Section 02: Form 4 XML Parser

## Overview

Add `fetchForm4Xml()` and `parseForm4Xml()` to the existing `edgar-parser.js` module created in section 01. This section implements the full XML fetch and parse pipeline: finding the right URL for each filing's XML document, downloading it (with gzip handling), and extracting all issuer, owner, and transaction data into a structured object.

**Depends on:** section-01-edgar-rss-discovery (requires the module to exist, the shared dual-rate limiter, and the HTTPS helper with gzip support)

**Blocks:** section-03-transaction-classification, section-05-alphavantage-secmonitor-rewrite

---

## File to Modify

```
n8n/code/insiderbuying/edgar-parser.js    ← add new functions to existing module
tests/insiderbuying/edgar-parser.test.js  ← add new tests to existing test file
```

---

## Tests First

**Test file:** `tests/insiderbuying/edgar-parser.test.js`
**Framework:** Jest (CommonJS), `jest.fn()` for `fetchFn`

Write all tests below before implementing. Tests should be added to the same `describe` blocks or new ones within the existing file from section 01.

### buildForm4XmlUrl

```
// Test: CIK '0000320193', accession '0001193125-25-123456' →
//       primary URL is https://www.sec.gov/Archives/edgar/data/0000320193/000119312525123456/000119312525123456.xml
//       (dashes stripped from accession for both path segment and filename)
// Test: returned object has both primaryUrl and indexUrl properties
//       indexUrl: https://www.sec.gov/Archives/edgar/data/0000320193/000119312525123456/index.json
```

### fetchForm4Xml

```
// Test: predictable URL returns HTTP 200 with XML body → returns XML string, index.json NOT called
// Test: predictable URL returns HTTP 404 → index.json fetched;
//       index.json contains item with name ending in '.xml' and type '4' → that XML URL fetched, XML string returned
// Test: predictable URL returns 404, index.json has no item with .xml extension → returns null
// Test: predictable URL returns 404, index.json fetch itself fails (network error) → returns null, no throw
// Test: both fetches fail → returns null, no throw
// Test: User-Agent header 'EarlyInsider/1.0 (contact@earlyinsider.com)' present on all requests
```

### parseForm4Xml — 5 inline fixture XML strings

Define fixtures inline at the top of the test describe block. Each is a minimal but valid-structure Form 4 XML string with only the fields needed for that test.

**Fixture 1 — Standard buy (use for most field extraction tests):**

```
// documentType: '4', isAmendment: false
// issuer.ticker: 'NVDA', issuer.name: 'NVIDIA CORP', issuer.cik present
// owner.name: 'Jensen Huang', owner.isOfficer: true, owner.officerTitle: 'President and CEO'
// nonDerivativeTransactions: array of length 1
//   [0].transactionCode: 'P'
//   [0].shares: 100000
//   [0].pricePerShare: 145.23  (a number, not null)
//   [0].acquiredDisposed: 'A'
//   [0].directOwnership: 'D'
// derivativeTransactions: empty array
```

**Fixture 2 — Form 4/A amendment:**

```
// documentType: '4/A'
// isAmendment: true
```

**Fixture 3 — Gift, no pricePerShare element:**

```
// nonDerivativeTransactions[0].transactionCode: 'G'
// nonDerivativeTransactions[0].pricePerShare: null  ← NOT 0, NOT NaN — element is absent from XML
```

**Fixture 4 — Option exercise (derivative transaction):**

```
// derivativeTransactions has 1 item
// derivativeTransactions[0].transactionCode: 'M'
// nonDerivativeTransactions: empty array
```

**Fixture 5 — Multi-transaction filing:**

```
// nonDerivativeTransactions.length === 3
// (three separate <nonDerivativeTransaction> blocks in XML)
```

**Edge case tests (inline XML snippets):**

```
// Entity encoding: issuerName in XML is 'AT&amp;T INC' → parsed result is 'AT&T INC'
// Namespace prefix: use <edgar:transactionDate>2025-01-15</edgar:transactionDate> →
//   transactionDate still correctly extracted as '2025-01-15'
// Missing issuerTradingSymbol element → parseForm4Xml returns null (not partial object)
// Malformed XML (empty string '') → returns null, no throw
// Malformed XML (truncated mid-tag) → returns null, no throw
// Comma-formatted share count: <transactionShares><value>1,000</value> → shares parsed as 1000
```

---

## Implementation Details

### buildForm4XmlUrl(issuerCik, accessionNumber)

Constructs two URLs:

- **Primary URL** (`primaryUrl`): Strip all dashes from `accessionNumber` to get `accNoDash`. Then:
  `https://www.sec.gov/Archives/edgar/data/{issuerCik}/{accNoDash}/{accNoDash}.xml`
- **Index URL** (`indexUrl`):
  `https://www.sec.gov/Archives/edgar/data/{issuerCik}/{accNoDash}/index.json`

Return both as an object `{ primaryUrl, indexUrl }`.

### fetchForm4Xml(issuerCik, accessionNumber, fetchFn)

Async. Never throws. Returns raw XML string or `null`.

**Strategy:**
1. Call `buildForm4XmlUrl(issuerCik, accessionNumber)` to get both URLs.
2. Try `primaryUrl` using the shared HTTPS helper (with `User-Agent` header and rate limiter from section 01). If successful (HTTP 200), return XML string.
3. If 404: fetch `indexUrl`. Parse the JSON response. Look in `directory.item[]` for an item where `name` ends with `.xml`. Among `.xml` items, prefer one where `type === '4'` (to avoid combined filings). If found, construct the full URL (`https://www.sec.gov/Archives/edgar/data/{issuerCik}/{accNoDash}/{item.name}`) and fetch it. Return XML string.
4. If no `.xml` item found in index, or any fetch fails: return `null`.

All requests must include `User-Agent: EarlyInsider/1.0 (contact@earlyinsider.com)`. All requests acquire a token from the shared dual-rate limiter (module-level, defined in section 01) before executing.

EDGAR XML responses are often gzip-compressed. The HTTPS helper (already built in section 01) handles `Accept-Encoding: gzip, deflate` and decompresses via `zlib.createGunzip()` pipe.

### parseForm4Xml(xmlString)

Pure function (no I/O). Never throws. Returns a structured object or `null` on any parse failure.

**Return type:**

```javascript
{
  documentType,                  // '4' or '4/A'
  isAmendment,                   // bool: documentType === '4/A'
  periodOfReport,                // 'YYYY-MM-DD'
  issuer: {
    cik,                         // string
    name,                        // string, entity-decoded
    ticker,                      // string or null if element absent
  },
  owner: {
    cik,                         // string
    name,                        // string, entity-decoded
    isOfficer,                   // bool
    isDirector,                  // bool
    officerTitle,                // string or null
  },
  nonDerivativeTransactions,     // Transaction[] (may be empty array)
  derivativeTransactions,        // Transaction[] (may be empty array)
}
```

Each `Transaction`:

```javascript
{
  transactionDate,    // 'YYYY-MM-DD'
  transactionCode,    // 'P','S','G','F','M','X','A','D','J'
  shares,             // number
  pricePerShare,      // number | null  — null when XML element is absent, NOT 0
  acquiredDisposed,   // 'A' or 'D'
  sharesAfter,        // number
  directOwnership,    // 'D' or 'I'
  is10b5Plan,         // bool (see Section 3 for calculate10b5Plan logic)
}
```

**Implementation notes:**

- Use two internal regex helpers — no XML library dependency:
  1. `extractTag(xml, tagName)` → extracts the text content of `<tagName>...</tagName>`. Must handle namespace-prefixed variants: use the pattern `/<(?:\w+:)?tagName>[\s\S]*?<\/(?:\w+:)?tagName>/i`.
  2. `extractAllBlocks(xml, blockName)` → returns array of raw XML substrings for each `<blockName>...</blockName>` occurrence. Used for multi-transaction extraction.

- All extracted string values pass through `decodeXmlEntities(str)` which replaces:
  - `&amp;` → `&`
  - `&lt;` → `<`
  - `&gt;` → `>`
  - `&apos;` → `'`
  - `&quot;` → `"`
  - Numeric hex entities `&#xNN;` → corresponding character

- For numeric fields (`shares`, `pricePerShare`, `sharesAfter`): strip commas from the string before `parseFloat`. Validate with `Number.isFinite()`. If not finite, use `null` for `pricePerShare` or `0` for counts.

- `pricePerShare` is `null` (not `0`) when the `<transactionPricePerShare>` element is entirely absent from the XML block. Check for element presence before parsing.

- If `<issuerTradingSymbol>` element is absent from the XML, return `null` from the whole function (not a partial object). The ticker is a required field for downstream processing.

- Extract `nonDerivativeTransactions` by calling `extractAllBlocks(xml, 'nonDerivativeTransaction')` and mapping each block through a transaction parser sub-function. Same for `derivativeTransactions` with block name `'derivativeTransaction'`. Return empty arrays if no blocks found.

- Wrap the entire function body in `try/catch`. On any exception, log the error and return `null`.

---

## Key Constraints

- **No XML library**: regex-only parsing. This is intentional — no additional npm dependencies.
- **No throws**: `parseForm4Xml` and `fetchForm4Xml` must catch all errors internally and return `null`.
- **pricePerShare null vs 0**: this distinction is critical. Gifts and awards have absent price elements; downstream scoring must not treat them as $0 purchases.
- **gzip handling**: reuse the HTTPS helper from section 01 — do not add a second implementation.
- **Rate limiter**: reuse the module-level dual-rate limiter from section 01 — both EFTS and XML fetches share the same 58-r/min budget.

---

## Exported API (additions to edgar-parser.js)

```javascript
// Add to module.exports in edgar-parser.js:
module.exports = {
  // ... existing section-01 exports ...
  buildForm4XmlUrl,     // (issuerCik, accessionNumber) → { primaryUrl, indexUrl }
  fetchForm4Xml,        // (issuerCik, accessionNumber, fetchFn) → Promise<string|null>
  parseForm4Xml,        // (xmlString) → ParsedForm4|null
};
```

---

## Definition of Done for This Section

1. All tests described above pass (`npm test`)
2. `parseForm4Xml` handles all 5 fixture variants without throwing
3. `pricePerShare` is `null` (not `0`, not `NaN`) for the gift fixture
4. Entity-encoded names decoded correctly (`&amp;` → `&`)
5. Namespace-prefixed tags parsed correctly
6. `fetchForm4Xml` falls back to `index.json` on 404 and returns `null` (not throw) on all failure paths
7. All EDGAR requests include the required `User-Agent` header
