
---

# Section 08 — NocoDB Table Setup + Integration Wiring

## Overview

Final section. Create NocoDB tables (`Logo_Cache`, `Insider_Photos`) via REST API or manually in the UI, create `visual-engine.js` as a unified export, run the full Jest suite, fix any cross-module issues, and perform a smoke test with NVDA logo + Jensen Huang photo.

## Dependencies

All previous sections must be complete:
- Section 01: `visual-css.js`
- Section 02: `generate-chart.js`
- Section 03 + 04: `visual-templates.js`
- Section 05: `report-covers.js`
- Section 06 + 07: `identity-assets.js`

## Files to Create

```
n8n/code/insiderbuying/visual-engine.js
```

## Tests (Cache Helpers + Integration Wiring)

Add to `tests/insiderbuying/identity-assets.test.js`:

### Cache Helper Tests (internal functions, tested via identity-assets)

```
# Test: _cacheGet returns null for non-existent key
# Test: _cacheGet returns null for expired entry (age > ttl_seconds)
# Test: _cacheGet returns data for valid entry
# Test: _cacheSet creates new row (POST) when key doesn't exist
# Test: _cacheSet updates existing row (PATCH) when key exists
# Test: _cacheSet handles NocoDB 429 with retry
# Test: NocoDB fetchFn includes xc-token header
```

### Integration Wiring Tests

```
# Test: visual-engine.js exports charts, templates, covers, identity modules
# Test: each module's functions accept (data, helpers) signature
# Test: uploadChart key pattern includes random suffix
```

Run the full test suite: `npm test -- tests/insiderbuying/`

## NocoDB Table Setup

### Option A — Create via REST API (Automated)

Tables can be created via NocoDB REST API. This is optional — the tables can also be created manually via the NocoDB UI (Option B).

Use the NocoDB meta API:

**Create Logo_Cache table**:
```
POST {NOCODB_API_URL}/api/v2/meta/tables
Header: xc-token: {NOCODB_API_TOKEN}
Body: {
  "title": "Logo_Cache",
  "columns": [
    { "title": "domain", "uidt": "SingleLineText" },
    { "title": "logo_url", "uidt": "URL" },
    { "title": "source", "uidt": "SingleLineText" },
    { "title": "fetched_at", "uidt": "DateTime" },
    { "title": "ttl_seconds", "uidt": "Number" }
  ]
}
```

**Create Insider_Photos table**:
```
POST {NOCODB_API_URL}/api/v2/meta/tables
Body: {
  "title": "Insider_Photos",
  "columns": [
    { "title": "name_normalized", "uidt": "SingleLineText" },
    { "title": "photo_url", "uidt": "URL" },
    { "title": "source", "uidt": "SingleLineText" },
    { "title": "fetched_at", "uidt": "DateTime" },
    { "title": "ttl_seconds", "uidt": "Number" }
  ]
}
```

After creation, note the `tableId` values returned by the API and set them as environment variables:
- `NOCODB_LOGO_TABLE_ID` — tableId for Logo_Cache
- `NOCODB_PHOTOS_TABLE_ID` — tableId for Insider_Photos

### Option B — Create Manually in NocoDB UI

1. Open NocoDB at `{NOCODB_API_URL}` in the browser
2. Select the EarlyInsider base
3. Create table "Logo_Cache" with columns: `domain` (Text), `logo_url` (URL), `source` (Text), `fetched_at` (Date), `ttl_seconds` (Number)
4. Create table "Insider_Photos" with columns: `name_normalized` (Text), `photo_url` (URL), `source` (Text), `fetched_at` (Date), `ttl_seconds` (Number)
5. In each table, note the tableId from the URL (e.g. `tbl_abc123`)
6. Set `NOCODB_LOGO_TABLE_ID` and `NOCODB_PHOTOS_TABLE_ID` in the n8n Docker environment

### VPS Environment Variables

Add to `n8n` Docker environment (in `/docker/n8n/docker-compose.yml`):

```yaml
environment:
  - NOCODB_LOGO_TABLE_ID=tbl_xxxxx
  - NOCODB_PHOTOS_TABLE_ID=tbl_yyyyy
```

No other new environment variables needed — `R2_*`, `NOCODB_API_URL`, `NOCODB_API_TOKEN`, and `GOOGLE_KG_API_KEY` all already exist.

## visual-engine.js — Unified Export

Create the optional index file that lets callers import everything from one place:

```javascript
'use strict';

/**
 * Visual Engine — unified export for all EarlyInsider visual generation modules.
 *
 * Usage from n8n Code nodes:
 *   const { charts, templates, covers, identity } = require('./visual-engine');
 *   const buffer = await charts.renderBarChart(opts, helpers);
 *   const url = await templates.renderTemplate(1, data, { upload: true }, helpers);
 *   const logoUrl = await identity.getCompanyLogo('nvidia.com', 'NVDA', helpers);
 */
module.exports = {
  charts:    require('./generate-chart'),
  templates: require('./visual-templates'),
  covers:    require('./report-covers'),
  identity:  require('./identity-assets'),
};
```

All callers can import individual modules directly or via the unified export.

## Full Jest Suite

Run the complete test suite:

```bash
npm test -- tests/insiderbuying/
```

Expected test files:
- `tests/insiderbuying/visual-css.test.js`
- `tests/insiderbuying/generate-chart.test.js`
- `tests/insiderbuying/visual-templates.test.js`
- `tests/insiderbuying/report-covers.test.js`
- `tests/insiderbuying/identity-assets.test.js`

**Fix any cross-module issues** found when all tests run together. Common issues to watch for:
- Circular requires between modules
- `require('./render-pdf')` path resolution (may need `path.join(__dirname, '..', 'render-pdf')`)
- `uploadToR2` export name — verify it matches what `render-pdf.js` actually exports
- Jest `testEnvironment: 'node'` — confirm in `jest.config.js`

## Smoke Test (Manual, Optional)

After NocoDB tables are created and env vars set, run a quick manual verification with real APIs:

```javascript
// smoke-test.js (temporary, run once, then delete)
const { identity, charts } = require('./visual-engine');

const helpers = {
  fetchFn: require('node-fetch'),
  env: process.env,
  _sleep: (ms) => new Promise(r => setTimeout(r, ms)),
};

async function main() {
  // Test 1: Known company logo
  const logoUrl = await identity.getCompanyLogo('nvidia.com', 'NVDA', helpers);
  console.log('NVDA logo:', logoUrl);
  // Expected: R2 URL (Brandfetch hit) or UI Avatars URL

  // Test 2: Known insider photo
  const photoUrl = await identity.getInsiderPhoto('Jensen Huang', 'CEO', helpers);
  console.log('Jensen Huang photo:', photoUrl);
  // Expected: Wikidata URL, Google KG URL, or UI Avatars URL

  // Test 3: Unknown company (UI Avatars fallback)
  const fallbackLogo = await identity.getCompanyLogo('xyznonexistent-abc.com', 'XYZ', helpers);
  console.log('Unknown logo fallback:', fallbackLogo);
  // Expected: UI Avatars URL

  // Test 4: Unknown person (UI Avatars fallback)
  const fallbackPhoto = await identity.getInsiderPhoto('John Q. Nobody', 'VP', helpers);
  console.log('Unknown photo fallback:', fallbackPhoto);
  // Expected: UI Avatars URL containing "John+Nobody"
}

main().catch(console.error);
```

Run from `n8n/code/insiderbuying/`: `node smoke-test.js`

All 4 tests should return valid URLs (never `null` or `undefined`).

## Dependency Graph Verification

Before declaring this section done, verify the module dependencies are correct:

```
visual-css.js          <- no dependencies
generate-chart.js      <- visual-css.js, render-pdf.js
visual-templates.js    <- visual-css.js
report-covers.js       <- visual-css.js, generate-chart.js
identity-assets.js     <- render-pdf.js (for uploadToR2)
visual-engine.js       <- all above
```

Check that `render-pdf.js` is a sibling in `n8n/code/insiderbuying/` and exports `uploadToR2`. If the path is different, adjust the `require()` paths in `generate-chart.js` and `identity-assets.js`.

## VPS Deployment Notes

Since all rendering goes through the existing screenshot server (no new native deps):

1. **No VPS native deps needed** — no Cairo, Pango, or build-essential changes
2. **No font installation** — Inter fonts are base64-embedded in `visual-css.js`
3. **No new npm packages** — Chart.js loads via CDN in HTML pages
4. **Only action required on VPS**: Create NocoDB tables + set env vars (see above)

When deploying the code:
- Copy the 5 new files to `/docker/n8n/n8n-data/custom/nodes/insiderbuying/` (or wherever n8n Code nodes are stored)
- Restart n8n to pick up the new env vars: `docker compose restart n8n`

## Acceptance Criteria

- [x] All 5 test files pass: `npm test -- tests/insiderbuying/`
- [x] `visual-engine.js` exports `charts`, `templates`, `covers`, `identity`
- [x] `require('./visual-engine').charts.renderBarChart` is a function
- [x] `require('./visual-engine').identity.getCompanyLogo` is a function
- [ ] NocoDB `Logo_Cache` table exists with correct columns (manual step on VPS)
- [ ] NocoDB `Insider_Photos` table exists with correct columns (manual step on VPS)
- [ ] `NOCODB_LOGO_TABLE_ID` and `NOCODB_PHOTOS_TABLE_ID` env vars set in n8n Docker (manual step on VPS)
- [ ] Smoke test: all 4 URLs returned are non-null strings (manual step)
- [x] No circular require errors in Node.js

## Implementation Notes (Actual)

- Files created: `n8n/code/insiderbuying/visual-engine.js`, `tests/insiderbuying/visual-engine.test.js`
- File extended: `n8n/code/insiderbuying/identity-assets.js` (429 retry in `_nocoGet`), `tests/insiderbuying/identity-assets.test.js` (S08 cache helper tests)
- `_nocoGet` now accepts optional `_sleep` parameter for injectable delay; all 4 call sites updated to pass `helpers._sleep`
- Code review auto-fixes: `prefetchLogos` call updated to pass `helpers._sleep`; visual-engine test missing `prefetchLogos`/`normalizeInsiderName` assertions added
- C2 policy: one retry max on 429; double-429 propagates to caller (test documents this contract)
- 53/53 tests pass (33 identity-assets + 13 visual-engine = 46, plus 7 more S08 cache helper tests in identity-assets)
- Full suite (insiderbuying/): 1112 pass, 2 pre-existing failures in workflow-config/seo-config (unrelated)
