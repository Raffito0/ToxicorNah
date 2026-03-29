# TDD Plan: 09-data-pipeline

## Testing Framework Context

- **edgar-parser.test.js** and **sec-monitor.test.js**: Jest (CommonJS), in `tests/insiderbuying/`
  - Run with: `npm test`
  - Mock pattern: `jest.fn().mockResolvedValue({...})` for `fetchFn`
  - Fixtures: hardcoded inline (no separate fixture files)
- **dexter-research.test.js**: Node.js native test runner (`node:test`), in `n8n/tests/`
  - Run with: `node n8n/tests/dexter-research.test.js`
  - Mock pattern: custom fetch factory functions returning promises
  - Uses `assert.deepStrictEqual()`, `assert.equal()`, `assert.ok()`

---

## Section 1: EDGAR RSS Feed Discovery

**Test file:** `tests/insiderbuying/edgar-parser.test.js`

Write these tests BEFORE implementing:

```
// buildEdgarRssUrl
// Test: hours=6 produces URL with correct startdt (now minus 6h) and enddt (now)
// Test: URL includes forms=4, dateRange=custom, size=2000

// fetchRecentFilings
// Test: EFTS response with 2 valid hits → returns 2-item array with correct fields
// Test: display_names[0] with ticker "(AAPL) (CIK 0000320193)" → ticker='AAPL', issuerCik='0000320193'
// Test: display_names[0] WITHOUT ticker (fund case) → ticker=null, issuerCik still parsed
// Test: EFTS returns empty hits array → returns []
// Test: fetchFn rejects (network error) → returns [], failureCount incremented
// Test: EFTS returns unexpected JSON shape (no 'hits' key) → returns [], no throw

// deduplicateFilings
// Test: filters filings where filedAt <= lastCheckTimestamp (inclusive boundary)
// Test: filters filings where filedAt > lastCheckTimestamp → all returned
// Test: lastCheckTimestamp is null/undefined → all filings returned unchanged
// Test: empty filings array → empty array returned
```

---

## Section 2: Form 4 XML Parser

**Test file:** `tests/insiderbuying/edgar-parser.test.js`

Write these tests BEFORE implementing:

```
// buildForm4XmlUrl
// Test: CIK '0000320193', accession '0001193125-25-123456' →
//       correct primary URL with dashes stripped

// fetchForm4Xml
// Test: predictable URL returns 200 → returns XML string, index.json NOT called
// Test: predictable URL returns 404 → index.json fetched, .xml file found → returns XML
// Test: predictable URL returns 404, index.json has no .xml file → returns null
// Test: both predictable URL and index.json fetch fail → returns null, no throw

// parseForm4Xml — 5 fixture XML strings (inline in test file)
// Fixture 1 (standard buy):
//   Test: documentType='4', isAmendment=false
//   Test: issuerTicker='NVDA', issuerName='NVIDIA CORP'
//   Test: ownerName='Jensen Huang', isOfficer=true, officerTitle='President and CEO'
//   Test: nonDerivativeTransactions has 1 item, code='P', shares=100000, price=145.23
//   Test: pricePerShare is a number (not null)
//
// Fixture 2 (Form 4/A amendment):
//   Test: documentType='4/A', isAmendment=true
//
// Fixture 3 (gift, no price element):
//   Test: nonDerivativeTransactions[0].transactionCode='G'
//   Test: pricePerShare is null (not 0, not NaN)
//
// Fixture 4 (option exercise, derivative table):
//   Test: derivativeTransactions has 1 item, transactionCode='M'
//   Test: nonDerivativeTransactions is empty array
//
// Fixture 5 (multi-transaction):
//   Test: nonDerivativeTransactions.length === 3
//
// Edge cases:
// Test: XML with &amp; entity in issuerName → decoded to '&' in output
// Test: XML with namespace prefix <edgar:transactionDate> → still parsed correctly
// Test: XML missing <issuerTradingSymbol> → returns null (not partial object)
// Test: malformed/empty XML string → returns null, no throw
// Test: shares value '1,000' (with comma) → parsed as 1000
```

---

## Section 3: Transaction Filtering and Classification

**Test file:** `tests/insiderbuying/edgar-parser.test.js`

Write these tests BEFORE implementing:

```
// classifyTransaction
// Test: each code maps to correct type: P→purchase, S→sale, G→gift,
//       F→tax_withholding, M→option_exercise, X→option_exercise,
//       A→award, D→disposition, J→other, '?'→other

// classifyInsiderRole — 20 title inputs
// Test: "Chief Executive Officer" → "CEO"
// Test: "Principal Executive Officer" → "CEO"
// Test: "CEO" → "CEO"
// Test: "Chief Financial Officer" → "CFO"
// Test: "Principal Financial Officer" → "CFO"
// Test: "CFO" → "CFO"
// Test: "President" → "President"
// Test: "Co-President" → "President"
// Test: "Chief Operating Officer" → "COO"
// Test: "COO" → "COO"
// Test: "Director" → "Director"
// Test: "Board Member" → "Director"
// Test: "Independent Director" → "Director"
// Test: "Non-Executive Director" → "Director"
// Test: "Vice President" → "VP"
// Test: "VP" → "VP"
// Test: "Senior Vice President" → "VP"
// Test: "SVP" → "VP"
// Test: "EVP" → "VP"
// Test: "Executive Vice President" → "VP"
// Test: "Treasurer" (unknown) → "Other"

// filterScorable
// Test: [P, S, G, F, M, X, A, D] input → only [P, S] returned (whitelist)
// Test: empty array → empty array returned
// Test: all G/F codes → empty array (not P/S → all filtered)

// calculate10b5Plan
// Test: legacy element <rule10b5One><value>1</value> → true
// Test: modern element <rule10b51Transaction><value>true</value> → true
// Test: modern element with <value>1</value> → true (numeric form)
// Test: neither element present → false
// Test: element present but value is '0' → false
```

---

## Section 4: Finnhub Integration

**Test file:** `n8n/tests/dexter-research.test.js` (Node native runner)

Write these tests BEFORE implementing:

```
// TokenBucket rate limiter
// Test: capacity=5, acquire() x5 resolves immediately
// Test: capacity=5, acquire() x6 — 6th resolves only after refill interval

// NocoDB cache layer
// Test: readCache — valid unexpired record → returns parsed JSON
// Test: readCache — expired record (expires_at in past) → returns null
// Test: readCache — no matching record → returns null
// Test: writeCache — no existing record → POST called with correct fields
// Test: writeCache — existing record found → PATCH called, not POST
// Test: writeCache sets expires_at to Date.now() + 24h (±5s tolerance)

// finnhub.getQuote
// Test: cache miss → Finnhub fetched, returns {c, h, l, o, pc, d, dp}
// Test: cache hit → Finnhub NOT called, cached data returned
// Test: Finnhub returns 429 → error propagated (not silently swallowed)

// finnhub.getProfile
// Test: returns {name, marketCapitalization, exchange, finnhubIndustry, country, currency}
// Test: any field absent in response → null (defensive access)

// finnhub.getBasicFinancials
// Test: returns metric object; missing fields return null (defensive ??)
// Test: cache hit prevents API call

// finnhub.getInsiderTransactions
// Test: returns transactions array with correct shape

// fetchFinancialData (updated)
// Test: DATA_WEIGHTS values sum to exactly 1.0
// Test: all 4 Finnhub calls made in parallel (Promise.allSettled)
// Test: cacheWrites array awaited via Promise.allSettled before function returns
//       (verify NocoDB write called, not fire-and-forget — check timing)
// Test: data_completeness for all 5 data types present = 1.0
// Test: data_completeness when 2 out of 5 data types are null < threshold
```

---

## Section 5: Alpha Vantage Earnings + sec-monitor Rewrite

### Alpha Vantage tests (dexter-research.test.js)

```
// alphaVantage.getEarningsCalendar
// Test: standard CSV (no commas in names) → Map with correct entries
// Test: CSV with quoted company name containing comma → correctly parsed
//       (e.g., 'AAPL,"Apple, Inc.",2025-04-30,...' → reportDate correct)
// Test: estimate column empty string → stored as null
// Test: NocoDB cache hit for '__all__' → AV API NOT called
// Test: NocoDB cache miss → AV API called, result cached under ticker='__all__'

// getNextEarningsDate
// Test: ticker in map → returns reportDate string
// Test: ticker not in map → returns null
```

### sec-monitor.js tests (sec-monitor.test.js)

```
// End-to-end enrichment pipeline
// Test: EFTS returns 2 filings:
//   - Filing 1: fetchForm4Xml returns standard-buy XML → 1 alert created
//   - Filing 2: fetchForm4Xml returns null (404) → skipped, failureCount++
//   Expected: 1 alert, failureCount=1, no throw

// Amendment handling
// Test: EFTS returns 1 filing where parseForm4Xml gives isAmendment=true
//   Expected: 0 alerts created, INFO log emitted, failureCount unchanged

// filterScorable whitelist in pipeline
// Test: XML with 3 nonDerivativeTxs (2×P, 1×G) → 2 alerts, 3 dedup keys stored

// Dual dedup key
// Test: filing with P transaction already in Airtable under semantic key
//       {ticker}_{ownerName}_{date}_{shares} → skipped even with new accession number

// Monitor_State timestamp watermark
// Test: deduplicateFilings called with lastCheckTimestamp from Monitor_State
// Test: after successful run, last_check_timestamp updated to now

// Cluster detection regression tests (all existing)
// All currently passing cluster tests must still pass with no modifications
```

---

## Test Execution Order

Implement and pass tests for each section before coding the next:
1. `edgar-parser.test.js` — Sections 1, 2, 3 (one file, run after each section)
2. `dexter-research.test.js` — Section 4 (add new describes, don't break existing)
3. `dexter-research.test.js` — Section 5 Alpha Vantage
4. `sec-monitor.test.js` — Section 5 sec-monitor rewrite

Full suite passes before claiming Section done.
