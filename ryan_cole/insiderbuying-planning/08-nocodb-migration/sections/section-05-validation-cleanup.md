# Section 05 — Validation and Environment Cleanup

## Overview

This section runs after sections 02, 03, and 04 are all complete. Its job is to confirm the migration is correct end-to-end: no Airtable references remain in production code, all test suites pass with NocoDB mocks, and every file declares the correct NocoDB env vars in its `REQUIRED_ENV` array.

**This section has no new business logic.** It is purely mechanical verification and cleanup.

**Dependencies**: sections 01, 02, 03, and 04 must all be done before starting this section.

---

## Files Involved

**Production files to audit** (all in `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/`):

- `nocodb-client.js`
- `write-persistence.js`
- `sec-monitor.js`
- `score-alert.js`
- `analyze-alert.js`
- `deliver-alert.js`
- `x-auto-post.js`
- `x-engagement.js`
- `reddit-monitor.js`
- `send-outreach.js`
- `find-prospects.js`

**Test files to audit** (all in `ryan_cole/insiderbuying-site/tests/insiderbuying/`):

- `nocodb-client.test.js`
- `write-persistence.test.js`
- `sec-monitor.test.js`
- `score-alert.test.js`
- `analyze-alert.test.js`
- `deliver-alert.test.js`
- `x-auto-post.test.js`
- `x-engagement.test.js`
- `reddit-monitor.test.js`
- `send-outreach.test.js`
- `find-prospects.test.js`

---

## Tests First

These tests must be written (or confirmed present) before doing any cleanup work in this section. They define the done state.

### Integration Grep Test

In the test runner or as a standalone Jest test, assert that the grep check returns 0 matches:

```js
// Optional: express as a Jest test for traceability
it('no Airtable references remain in production code', () => {
  const { execSync } = require('child_process');
  const result = execSync(
    'grep -r "airtable" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/ --include="*.js" -i -l',
    { encoding: 'utf8', cwd: process.cwd() }
  ).trim();
  expect(result).toBe('');
});
```

If adding a formal test is inconvenient, run the command manually and assert 0 output lines as a manual gate. Either way, this check MUST pass before the section is declared done.

The exact command:
```
grep -r "airtable\|AIRTABLE" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/ -i --include="*.js"
```

Expected output: nothing. Any match is a failure.

### Coverage Check for nocodb-client.test.js

Verify that `nocodb-client.test.js` has test coverage for all 7 public methods (`list`, `get`, `create`, `update`, `delete`, `bulkCreate`, `count`) plus the `_req()` error and retry paths. This was specified in section 01 — this section confirms it is present.

Run:
```
npm test -- --coverage --testPathPattern="nocodb-client"
```

All paths should appear in coverage. No public method should be uncovered.

### GAP 12.14 Confirmation

Confirm `send-outreach.test.js` includes these assertions (added in section 04):

- The first email prompt template string does not contain `http://`, `https://`, `.url`, or `href=`
- The article context object passed to the LLM for email #1 does not include a `url` property

These tests must already exist from section 04. This section just re-runs them and confirms they still pass after cleanup.

### Full Test Suite Pass

Run the full test suite:
```
npm test
```

All 11 test files must pass with 0 failures. Any failing test is a blocker for this section.

---

## Implementation Steps

### Step 1 — Audit REQUIRED_ENV in Every Production File

Open each of the 10 migrated production files (not `nocodb-client.js` itself, which has no `REQUIRED_ENV`). For each file:

**Remove** these keys from `REQUIRED_ENV` (and from any `BASE_ENV` constants in corresponding test files):
- `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID`
- `INSIDER_ALERTS_TABLE_ID`
- `MONITOR_STATE_TABLE_ID`
- Any other `*_TABLE_ID` Airtable variables
- For `score-alert.js` only: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the track record Supabase path was removed in section 02)

**Add** these three keys to `REQUIRED_ENV` if not already present:
- `NOCODB_API_TOKEN`
- `NOCODB_BASE_URL`
- `NOCODB_PROJECT_ID`

Note: `deliver-alert.js` and any other file that still calls Supabase for user/subscription data keeps `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — do not remove those. Only `score-alert.js` loses the Supabase keys.

### Step 2 — Audit BASE_ENV in Every Test File

Open each of the 10 test files. The `BASE_ENV` constant at the top of each file provides the env vars injected during tests.

Apply the same removals and additions as Step 1. `BASE_ENV` must match the production `REQUIRED_ENV` for each corresponding file.

Example before (Airtable):
```js
const BASE_ENV = {
  AIRTABLE_API_KEY: 'test-key',
  AIRTABLE_BASE_ID: 'appXXX',
  INSIDER_ALERTS_TABLE_ID: 'tblXXX',
  // ...
};
```

Example after (NocoDB):
```js
const BASE_ENV = {
  NOCODB_API_TOKEN: 'test-token',
  NOCODB_BASE_URL: 'http://localhost:8080',
  NOCODB_PROJECT_ID: 'test-proj',
  // ... other non-Airtable keys preserved
};
```

### Step 3 — Run the Grep Verification

From the repo root, run:
```
grep -r "airtable\|AIRTABLE" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/ -i --include="*.js"
```

If any matches are returned, open each matched file and remove or replace the reference. Common remaining sources:
- Comments referencing Airtable by name — remove or update the comment
- Old URL strings that weren't caught during migration — replace with NocoDB URL
- Leftover `AIRTABLE_*` env var references in `REQUIRED_ENV` — remove per Step 1
- Variable names like `airtableRecord` — rename to `nocoRecord` or similar

Re-run the grep after each fix until 0 matches.

### Step 4 — Run the Full Test Suite

```
npm test
```

All 11 test files must pass. If any test fails:

1. Read the failure message carefully — it will usually indicate a mock shape mismatch or a URL assertion failure
2. The most common issues at this stage:
   - A test mock still returning Airtable shape `{ records: [...] }` instead of NocoDB shape `{ list: [...], pageInfo: { isLastPage: true } }`
   - A body assertion still checking `body.fields.ticker` instead of `body.ticker`
   - A URL assertion still checking `api.airtable.com` instead of `localhost:8080`
   - `BASE_ENV` still containing Airtable keys that the production code no longer reads (may cause "required env var missing" errors if production code checks for NocoDB keys that aren't in `BASE_ENV`)
3. Fix the failing test, re-run, repeat until green

### Step 5 — Docker Networking Note (VPS Deploy Preparation)

Before deploying to the VPS, confirm the value of `NOCODB_BASE_URL` in the VPS environment:

- If n8n and NocoDB run on the **same host** (or in the same container): `http://localhost:8080`
- If n8n and NocoDB are **separate Docker containers in the same Compose network**: use the service name, e.g. `http://nocodb:8080`

The code itself does not hardcode either value — the env var abstracts this. Confirm the correct value is set in the VPS `.env` or Docker Compose environment before the first live run.

### Step 6 — Deployment Order (Pre-deploy Checklist)

Before deploying the migrated code to production, complete in this order:

1. **Verify NocoDB schema** — confirm these tables exist in NocoDB with column names matching the Airtable field names:
   - `Insider_Alerts`
   - `Monitor_State`
   - `Cluster_Summaries`
   - `Alert_Delivery_Log`
   - `Insider_History`
   - `Articles`
   - `X_Post_Log`
   - `X_Engagement_Log`
   - `Reddit_Log`
   - `Outreach_Prospects`

2. **Data backfill** (if applicable) — the `Monitor_State` table must have a `name='market'` row with a valid `last_filing_date` checkpoint before the first run of `sec-monitor.js`. Any recent `Insider_Alerts` needed for dedup should also be present. Without this, `sec-monitor.js` will reprocess old filings on first run.

3. **Update env vars on VPS** — add `NOCODB_API_TOKEN`, `NOCODB_BASE_URL`, `NOCODB_PROJECT_ID` to the environment. Do NOT remove Airtable vars until step 4 is confirmed working.

4. **Deploy new code** — merge and deploy the migrated workflow files.

5. **Remove Airtable env vars** — only after confirming the new code is running correctly.

---

## Definition of Done for This Section

All five conditions must be true simultaneously:

1. `grep -r "airtable\|AIRTABLE" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/ -i --include="*.js"` returns **0 matches**
2. `npm test` runs all 11 test files and reports **0 failures**
3. Every migrated production file has `NOCODB_API_TOKEN`, `NOCODB_BASE_URL`, `NOCODB_PROJECT_ID` in its `REQUIRED_ENV` array, and no `AIRTABLE_*` vars
4. `send-outreach.test.js` includes GAP 12.14 assertions: no URL in first email template, no `url` property in LLM context for email #1
5. `nocodb-client.test.js` covers all 7 public methods and the `_req()` retry/error paths

---

## Key Mechanical Translation Reference

For any stray Airtable pattern found during the grep cleanup, use this translation table:

| Airtable pattern | NocoDB replacement |
|---|---|
| `api.airtable.com/v0/{base}/{table}` | `http://localhost:8080/api/v1/db/data/noco/{projectId}/{table}` |
| `Authorization: Bearer {key}` | `xc-token: {token}` |
| `{ fields: { name: "x" } }` request body | `{ name: "x" }` (flat, no wrapper) |
| `data.id` (Airtable string `recXXX`) | `data.Id` (NocoDB integer) |
| `record.fields.ticker` | `record.ticker` |
| `{ records: [...], offset: "cursor" }` response | `{ list: [...], pageInfo: { isLastPage: true } }` |
| `filterByFormula=AND({f}='x')` | `where=(f,eq,x)` |
| `sort[0][field]=x&sort[0][direction]=desc` | `sort=-x` |
| Airtable cursor pagination (`while (offset)`) | NocoDB offset pagination (`while (!pageInfo.isLastPage)`) |
| No count endpoint (list + `.length`) | `nocodb.count(table, where)` returns integer directly |

---

## What Was Actually Built

**Grep verification**: `grep -r "airtable\|AIRTABLE" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/ -i --include="*.js"` → **0 matches**

**REQUIRED_ENV audit**: Only `sec-monitor.js` has a `REQUIRED_ENV` block (it is the only n8n Code node entry point). All other files are pure helpers with no env var declarations. `sec-monitor.js` correctly declares `NOCODB_API_TOKEN`, `NOCODB_BASE_URL`, `NOCODB_PROJECT_ID` and no Airtable vars.

**Full migration test run**: 11 target test files, **364/364 tests pass**.

**Pre-existing failure**: `tests/insiderbuying/seo-config.test.js` (1 test) fails with "Expected page.tsx to contain 'metadata'" — this failure existed before the migration and is unrelated to NocoDB. Documented in section-02 completion notes.

## Definition of Done — Verified

1. ✅ Zero Airtable references in all production files
2. ✅ 364/364 migration tests pass (11 test files)
3. ✅ `sec-monitor.js` REQUIRED_ENV has NocoDB keys, no Airtable keys
4. ✅ `send-outreach.test.js` has GAP 12.14 assertions (no URL in prompt, no url in LLM context)
5. ✅ `nocodb-client.test.js` covers all 7 public methods and retry/error paths
