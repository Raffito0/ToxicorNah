# Section 03: Transaction Filtering and Classification

## Overview

This section adds four pure classification/filtering functions to `edgar-parser.js`. They have no network I/O, no external dependencies, and no side effects — every function is deterministic given its inputs.

**Depends on:** section-02 (the `Transaction` objects produced by `parseForm4Xml` are the inputs here)

**Blocks:** section-05 (`sec-monitor.js` rewrite calls `filterScorable` and `classifyInsiderRole`)

**File to modify:** `n8n/code/insiderbuying/edgar-parser.js`
**Test file:** `tests/insiderbuying/edgar-parser.test.js`

---

## Tests First

Add the following test suite to `tests/insiderbuying/edgar-parser.test.js`. These tests must be written and run (failing) before any implementation code is added.

```
// classifyTransaction
// Test: 'P' → 'purchase'
// Test: 'S' → 'sale'
// Test: 'G' → 'gift'
// Test: 'F' → 'tax_withholding'
// Test: 'M' → 'option_exercise'
// Test: 'X' → 'option_exercise'
// Test: 'A' → 'award'
// Test: 'D' → 'disposition'
// Test: 'J' → 'other'
// Test: '?' (unknown code) → 'other'

// classifyInsiderRole — exactly 20 title inputs
// Test: "Chief Executive Officer"     → "CEO"
// Test: "Principal Executive Officer" → "CEO"
// Test: "CEO"                         → "CEO"
// Test: "Chief Financial Officer"     → "CFO"
// Test: "Principal Financial Officer" → "CFO"
// Test: "CFO"                         → "CFO"
// Test: "President"                   → "President"
// Test: "Co-President"                → "President"
// Test: "Chief Operating Officer"     → "COO"
// Test: "COO"                         → "COO"
// Test: "Director"                    → "Director"
// Test: "Board Member"                → "Director"
// Test: "Independent Director"        → "Director"
// Test: "Non-Executive Director"      → "Director"
// Test: "Vice President"              → "VP"
// Test: "VP"                          → "VP"
// Test: "Senior Vice President"       → "VP"
// Test: "SVP"                         → "VP"
// Test: "EVP"                         → "VP"
// Test: "Executive Vice President"    → "VP"
// Test: "Treasurer" (unknown title)   → "Other"

// filterScorable
// Test: [P, S, G, F, M, X, A, D] → only [P, S] returned (whitelist, not blacklist)
// Test: empty array → empty array returned
// Test: array where all codes are G and F → empty array (no P/S → all filtered)

// calculate10b5Plan
// Test: legacy element <rule10b5One><value>1</value> → true
// Test: modern element <rule10b51Transaction><value>true</value> → true
// Test: modern element with <value>1</value> (numeric form) → true
// Test: neither element present → false
// Test: element present but value is '0' → false
```

Run the tests with `npm test` — expect all to fail before implementation.

---

## Background and Design Decisions

### Why a whitelist for filterScorable

The previous approach in `sec-monitor.js` used a blacklist (exclude specific unwanted codes). The new design uses a whitelist: **only transaction codes `P` (open-market purchase) and `S` (open-market sale) pass through.** All other codes — G, F, M, X, A, D, J, and any future unknown codes — are rejected.

This matters because:
- Option exercises (M/X) inflate the share count without market-price conviction.
- Compensation awards (A) are not voluntary buying signals.
- A blacklist would silently pass any new transaction code the SEC might add in future; a whitelist fails safe.

### Where filterScorable fits in the pipeline

In `sec-monitor.js`, deduplication keys must be stored for **every** transaction in a filing (including G/F/M/A), regardless of whether that transaction is scorable. Only **alert record creation** is gated by `filterScorable`. This prevents non-scorable transactions from generating false alarms on the next run when they are re-encountered.

The correct call sequence in `sec-monitor.js` (implemented in section-05) is:

```
const allTransactions = parsed.nonDerivativeTransactions;
// Store dedup keys for ALL transactions first:
for (const tx of allTransactions) { storeDedup(tx); }
// Then only create alerts for scorable ones:
const scorable = filterScorable(allTransactions);
for (const tx of scorable) { createAlert(tx); }
```

### The 10b5-1 plan dual schema

SEC Form 4 filings updated their schema in April 2023. Both the pre-2023 (legacy) and post-2023 (modern) element names must be checked:

- **Legacy** (pre-April 2023): `<rule10b5One><value>1</value></rule10b5One>`
- **Modern** (post-April 2023): `<rule10b51Transaction><value>1</value></rule10b51Transaction>` or `<rule10b51Transaction><value>true</value></rule10b51Transaction>`

Matching is case-insensitive. Return `true` if either form is found with a truthy value (`1`, `true`). Return `false` if the element is present but the value is `0` or `false`, and also `false` if the element is entirely absent.

The `is10b5Plan` field on each `Transaction` (populated during `parseForm4Xml` in section-02) calls `calculate10b5Plan` on the per-transaction XML block, not the full document.

---

## Implementation Details

### `classifyTransaction(transaction)`

A simple lookup from `transaction.transactionCode` to a semantic string. The transaction object comes from the `Transaction` type defined in section-02.

Signature:
```javascript
/**
 * @param {{ transactionCode: string }} transaction
 * @returns {string} one of: 'purchase' | 'sale' | 'gift' | 'tax_withholding' |
 *                           'option_exercise' | 'award' | 'disposition' | 'other'
 */
function classifyTransaction(transaction) { ... }
```

Code mapping:
- `P` → `purchase`
- `S` → `sale`
- `G` → `gift`
- `F` → `tax_withholding`
- `M` → `option_exercise`
- `X` → `option_exercise`
- `A` → `award`
- `D` → `disposition`
- `J` → `other`
- any other code → `other`

### `classifyInsiderRole(officerTitle)`

Maps a raw SEC officer title string to a canonical role. The mapping is case-insensitive.

Signature:
```javascript
/**
 * @param {string|null|undefined} officerTitle — raw string from Form 4 XML
 * @returns {'CEO'|'CFO'|'President'|'COO'|'Director'|'VP'|'Other'}
 */
function classifyInsiderRole(officerTitle) { ... }
```

Title groups (cover at minimum these 20 variants):

| Input title | Returns |
|---|---|
| "Chief Executive Officer", "Principal Executive Officer", "CEO", "Chief Executive" | `CEO` |
| "Chief Financial Officer", "Principal Financial Officer", "CFO" | `CFO` |
| "President", "Co-President" | `President` |
| "Chief Operating Officer", "COO" | `COO` |
| "Director", "Board Member", "Board Director", "Independent Director", "Non-Executive Director" | `Director` |
| "Vice President", "VP", "Senior Vice President", "SVP", "EVP", "Executive Vice President", "Group Vice President" | `VP` |
| Anything else (null, empty, "Treasurer", "General Counsel", etc.) | `Other` |

Implementation note: normalize input with `.trim().toLowerCase()` and do substring or exact-match checking. The "Group Vice President" variant should match via substring `vice president`. Null or undefined input → `Other`.

### `filterScorable(transactions)`

Whitelist filter. Only keeps transactions where `transactionCode === 'P'` or `transactionCode === 'S'`.

Signature:
```javascript
/**
 * @param {Transaction[]} transactions
 * @returns {Transaction[]} only open-market purchases (P) and sales (S)
 */
function filterScorable(transactions) { ... }
```

A one-liner using `Array.prototype.filter`. Never mutates the input array.

### `calculate10b5Plan(xmlBlock)`

Checks a raw XML string (the per-transaction XML block) for either schema variant of the 10b5-1 plan flag.

Signature:
```javascript
/**
 * @param {string} xmlBlock — raw XML string of a single <nonDerivativeTransaction>
 *                            or <derivativeTransaction> block
 * @returns {boolean}
 */
function calculate10b5Plan(xmlBlock) { ... }
```

Implementation approach: use two regexes — one for each schema — both case-insensitive. Extract the `<value>` content inside the matching element and check if it equals `'1'` or `'true'` (after trimming). If either regex finds a truthy value, return `true`. Otherwise return `false`.

Example patterns to detect:
```
/<rule10b5One>[\s\S]*?<value>(.*?)<\/value>/i         — legacy
/<rule10b51Transaction>[\s\S]*?<value>(.*?)<\/value>/i — modern
```

---

## Exports

Add all four functions to `module.exports` at the bottom of `edgar-parser.js`:

```javascript
module.exports = {
  // Section 1 exports (already present)
  buildEdgarRssUrl,
  fetchRecentFilings,
  deduplicateFilings,
  // Section 2 exports (already present)
  buildForm4XmlUrl,
  fetchForm4Xml,
  parseForm4Xml,
  // Section 3 exports (add these)
  classifyTransaction,
  classifyInsiderRole,
  filterScorable,
  calculate10b5Plan,
};
```

---

## Definition of Done for This Section

1. All 38 new test cases pass (`npm test` green).
2. No existing section-01 or section-02 tests are broken.
3. `classifyInsiderRole` handles all 20 listed title variants plus null/undefined input.
4. `filterScorable` is whitelist-based: an unknown future code like `'Z'` is excluded (not passed through).
5. `calculate10b5Plan` correctly handles both the legacy (`rule10b5One`) and modern (`rule10b51Transaction`) element names, as well as value `'1'` and value `'true'` (both should return `true`), and value `'0'` (should return `false`).
6. All four functions are exported in `module.exports`.
