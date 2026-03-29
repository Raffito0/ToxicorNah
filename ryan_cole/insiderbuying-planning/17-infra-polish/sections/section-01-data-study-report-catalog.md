# Section 01: Disable Data Study + Create Report Catalog (A1 + A2)

## Overview

This section covers two closely related tasks:

- **A1**: Disable `data-study.js` (W3) with a single-line guard at the top of the file, plus a manual n8n step.
- **A2**: Create `report-catalog.js`, a new W17 workflow that runs twice weekly (Monday + Thursday). It scans recent Insider_Alerts data and produces a prioritized list of report candidates written to NocoDB, with a Telegram summary.

**Pre-flight required:** The `Report_Catalog` NocoDB table must exist before any code in this section can run. See the Pre-flight checklist below.

---

## Pre-flight: Create NocoDB Table

Manually create the following table in the NocoDB UI before running this section. The code will fail with an HTTP error if the table does not exist.

**Report_Catalog**

| Column | Type |
|--------|------|
| id | Auto-number |
| ticker_or_sector | Single line text |
| report_type | Single select: `single`, `sector`, `bundle` |
| priority_score | Number (decimal) |
| status | Single select: `pending`, `generating`, `published` |
| created_at | DateTime |

---

## Tests First

**Test file:** `n8n/tests/report-catalog.test.js`

Run with: `node --test n8n/tests/report-catalog.test.js`

### A1 Tests (data-study.js)

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('data-study.js disabled flag', () => {
  it('module.exports.DISABLED is strictly true (not just truthy)', () => {
    const mod = require('../code/insiderbuying/data-study.js');
    assert.strictEqual(mod.DISABLED, true);
  });

  it('other existing exports on the module are still accessible', () => {
    const mod = require('../code/insiderbuying/data-study.js');
    // Verify the module did not lose its other exports -- pick any known helper
    // e.g., assert.ok(typeof mod.someHelper === 'function');
    // Adapt to whatever exports data-study.js currently has.
  });
});
```

### A2 Tests (report-catalog.js)

The module under test exports a main entry function (e.g., `runReportCatalog(opts)`) and the helper `normalizeSector(s)`. All NocoDB and Telegram calls are injected via `opts.nocodb*` and `opts.telegram`.

```javascript
describe('normalizeSector', () => {
  it('maps "Tech" -> "Technology"', () => { /* ... */ });
  it('maps "Information Technology" -> "Technology"', () => { /* ... */ });
  it('unknown sector passes through unchanged', () => { /* ... */ });
});

describe('report-catalog query and filtering', () => {
  it('empty Insider_Alerts response -> sends Telegram "0 candidates", writes nothing', async () => {
    // Mock: nocodbGet for Insider_Alerts returns [], nocodbGet for Report_Catalog returns []
    // Mock: telegram spy
    // Assert: telegram called with message containing "0 candidates"
    // Assert: nocodbPost never called
  });

  it('alerts with clusters < 3 are excluded from all passes', async () => { /* ... */ });
  it('alerts with score < 8 are excluded from all passes', async () => { /* ... */ });

  it('deduplication: tickers already in Report_Catalog (last 30 days) are filtered out', async () => {
    // Mock Report_Catalog returns [{ ticker_or_sector: 'AAPL', created_at: <7 days ago> }]
    // Mock Insider_Alerts includes AAPL -- it must NOT appear in inserts
  });
});

describe('Pass 1 -- Single-stock', () => {
  it('selects top 5 by score when > 5 candidates exist', async () => { /* ... */ });
  it('selects all available when fewer than 5 candidates (no crash)', async () => { /* ... */ });
  it('each insert has report_type = "single"', async () => { /* ... */ });
});

describe('Pass 2 -- Sector', () => {
  it('sector with exactly 3 alerts -> one sector entry created', async () => { /* ... */ });
  it('sector with 2 alerts -> no sector entry', async () => { /* ... */ });
  it('sector entry has report_type = "sector"', async () => { /* ... */ });
});

describe('Pass 3 -- Bundle', () => {
  it('same sector + one ticker >= $10B + one < $10B + both score >= 8 -> bundle created', async () => { /* ... */ });
  it('same sector but both same market cap tier -> no bundle', async () => { /* ... */ });
  it('no market_cap field in alerts -> pass 3 skipped, 0 bundles, no error', async () => { /* ... */ });
});

describe('Telegram summary', () => {
  it('counts reflect actual inserted record counts, not hardcoded values', async () => {
    // Run with known mock data producing 2 single + 1 sector + 1 bundle
    // Assert telegram message contains "2 single, 1 sector, 1 bundle"
  });
});
```

---

## Implementation Details

### A1 -- Disable data-study.js

**File to modify:** `n8n/code/insiderbuying/data-study.js`

Add the following two lines at the very top of the file, before any existing code:

```javascript
// DISABLED: superseded by the monthly backtest lead magnet (unit 17 A1).
module.exports.DISABLED = true;
```

This is the entire code change. The rest of the file stays intact -- helper functions may be reused in the future.

**Manual n8n step (not automated):** In the n8n UI, set W3 (the data-study workflow) to **Inactive**.

### A2 -- report-catalog.js (New W17 Workflow)

**File to create:** `n8n/code/insiderbuying/report-catalog.js`

**n8n schedule:** Twice weekly -- Monday and Thursday. Set in the n8n UI Schedule Trigger node.

**Environment variables used (no new ones):**
- `NOCODB_BASE_URL`
- `NOCODB_API_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

#### Module structure

The module exports a single entry function `runReportCatalog(opts)` and exposes `normalizeSector` for testing.

```javascript
module.exports = { runReportCatalog, normalizeSector };
```

#### normalizeSector(s)

Maps inconsistent sector names from Insider_Alerts to canonical names. Implement as a lookup object with 20-30 common variants. Examples:

```javascript
const SECTOR_MAP = {
  'Tech': 'Technology',
  'Information Technology': 'Technology',
  'IT': 'Technology',
  'Financials': 'Finance',
  'Financial Services': 'Finance',
  // ... (add other known variants)
};

function normalizeSector(s) {
  return SECTOR_MAP[s] || s;
}
```

Unknown strings pass through unchanged.

#### Pre-flight deduplication

At the start of `runReportCatalog`, query `Report_Catalog` for all records created in the last 30 days:

```javascript
// nocodbGet('Report_Catalog', { where: '(created_at,gt,<30daysAgo>)' })
```

Extract all `ticker_or_sector` values into a `Set<string>`. All subsequent passes filter against this Set before inserting.

#### Data query

Query `Insider_Alerts` for the last 30 days, filtering for `clusters >= 3` AND `score >= 8`. Apply sector normalization to each row's `sector` field immediately after fetching. Then apply the deduplication filter.

If the filtered set is empty: send Telegram "Report catalog updated: 0 candidates." and return without writing anything.

#### Pass 1 -- Single-stock reports

Sort filtered alerts by `score` descending. Take up to 5. For each, write a `Report_Catalog` record:

```javascript
{
  ticker_or_sector: alert.ticker,
  report_type: 'single',
  priority_score: alert.score,
  status: 'pending',
  created_at: new Date().toISOString(),
}
```

#### Pass 2 -- Sector report

Group filtered alerts by normalized sector. For any sector with 3 or more qualifying alerts, write one record:

```javascript
{
  ticker_or_sector: sectorName,
  report_type: 'sector',
  priority_score: averageScore, // or max -- choose one and be consistent
  status: 'pending',
  created_at: new Date().toISOString(),
}
```

Only one record per qualifying sector.

#### Pass 3 -- Bundle candidates

Find pairs of tickers where both conditions hold:
1. Same normalized sector
2. Different market cap tiers: one ticker has `market_cap >= 10_000_000_000` (i.e., $10B), the other has `market_cap < 10_000_000_000`
3. Both tickers have `score >= 8`

**Important:** If the `market_cap` field is absent or null on any alert, skip Pass 3 entirely -- write 0 bundles and do not throw an error.

Cap at 5 bundle candidates. Write each qualifying pair as one record:

```javascript
{
  ticker_or_sector: `${tickerA}+${tickerB}`, // e.g. "AAPL+SMCI"
  report_type: 'bundle',
  priority_score: Math.min(scoreA, scoreB), // conservative
  status: 'pending',
  created_at: new Date().toISOString(),
}
```

#### Telegram summary

After all inserts complete, count actual inserted records per type (from the insert results, not from input arrays). Send:

```
Report catalog updated: N single, N sector, N bundle candidates.
```

Use the real counts. Do not hardcode values.

---

## Dependency Notes

- This section depends on the `Report_Catalog` NocoDB table existing (manual pre-flight).
- No dependency on any other section in this unit.
- The existing `nocodbGet`, `nocodbPost`, `nocodbPatch` helpers and `TELEGRAM_*` env vars are assumed to be available in the codebase (established in prior units).

---

## Deviations from Plan

1. **DISABLED flag placement (C1)**: Plan said "add two lines at very top of file". Implementation puts `DISABLED: true` inside the `module.exports = {...}` object at the bottom. The top-level bare statement was removed as it was overridden by the object literal (maintenance trap).

2. **Lowercase dedup (H2)**: Plan was silent. Code review finding — `existingSet` normalizes values to lowercase before storage and comparison, so cross-run sector name variants don't defeat deduplication.

3. **Empty sector filter (L1)**: Plan was silent. Added filter to exclude alerts with null/empty sector before Pass 2 grouping, preventing `""` NocoDB entries.

4. **Telegram wrapped in try/catch (M1)**: Plan was silent. Telegram `await` is wrapped so insert errors don't also swallow the summary notification.

5. **Test file location**: `n8n/tests/report-catalog.test.js`. Run: `node --test n8n/tests/report-catalog.test.js`. 30 tests total.

6. **SECTOR_MAP size**: 35 variants (spec required >= 20).

---

## Definition of Done

- [x] `data-study.js` has `DISABLED: true` in module.exports
- [ ] W3 is set to Inactive in the n8n UI
- [ ] `report-catalog.js` exists at `n8n/code/insiderbuying/report-catalog.js`
- [ ] `normalizeSector()` exported and maps at least 20 known variants
- [ ] All three passes (single, sector, bundle) implemented with deduplication
- [ ] Bundle pass is fully skipped (no error) when `market_cap` is missing
- [ ] Telegram summary uses actual inserted counts
- [ ] W17 Schedule Trigger configured in n8n (Monday + Thursday)
- [ ] All tests in `n8n/tests/report-catalog.test.js` pass: `node --test n8n/tests/report-catalog.test.js`
