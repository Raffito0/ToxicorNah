# Section 02: Alerts Pipeline Migration

## Overview

Migrate four files from Airtable to NocoDB: `write-persistence.js`, `score-alert.js`, `analyze-alert.js`, and `deliver-alert.js`. This section can run in parallel with sections 03 and 04 but requires section 01 (`nocodb-client.js`) to be complete first.

**Scope**: Pure API client substitution. Business logic (classification, scoring, Anthropic/SEC/Yahoo Finance calls) is unchanged. Only HTTP persistence calls change.

---

## Dependency

**Requires section-01-nocodb-client to be complete.** The `NocoDB` class must exist and its tests must pass before starting this section.

**Does NOT block**: sections 03 and 04 (they are parallel).

**Is blocked by**: nothing except section 01.

---

## Production Files

```
ryan_cole/insiderbuying-site/n8n/code/insiderbuying/write-persistence.js   <-- migrated
ryan_cole/insiderbuying-site/n8n/code/insiderbuying/score-alert.js         <-- migrated
ryan_cole/insiderbuying-site/n8n/code/insiderbuying/analyze-alert.js       <-- migrated
ryan_cole/insiderbuying-site/n8n/code/insiderbuying/deliver-alert.js       <-- migrated
```

## Test Files

```
ryan_cole/insiderbuying-site/tests/insiderbuying/write-persistence.test.js  <-- updated
ryan_cole/insiderbuying-site/tests/insiderbuying/score-alert.test.js        <-- updated
ryan_cole/insiderbuying-site/tests/insiderbuying/analyze-alert.test.js      <-- updated
ryan_cole/insiderbuying-site/tests/insiderbuying/deliver-alert.test.js      <-- updated
```

---

## TDD Cycle (Do This For Each File)

1. Update `BASE_ENV` in the test file — swap Airtable vars for NocoDB vars
2. Update mock response shapes — Airtable `{ records: [...] }` → NocoDB `{ list: [...] }`
3. Run tests — confirm they **FAIL** (red)
4. Migrate the production file
5. Run tests — confirm they **PASS** (green)
6. Run `grep -i "airtable" <file>` — confirm 0 matches remain

---

## Key API Translation Rules

These apply throughout this entire section. Internalize them before touching any file.

| Concept | Airtable | NocoDB |
|---------|----------|--------|
| Auth header | `Authorization: Bearer {key}` | `xc-token: {token}` |
| Request body | `{ fields: { name: "x" } }` | `{ name: "x" }` (flat) |
| List response | `{ records: [{ id: "recXXX", fields: { name: "x" } }], offset: "cursor" }` | `{ list: [{ Id: 1, name: "x" }], pageInfo: { isLastPage: true } }` |
| Record ID | `data.id` → string `"recXXXXXXXXXXXXXX"` | `data.Id` → integer `1` |
| Filter syntax | `filterByFormula=AND({f}='x')` | `where=(f,eq,x)` |
| Sort syntax | `sort[0][field]=x&sort[0][direction]=desc` | `sort=-x` |
| Pagination | cursor string `data.offset` | `pageInfo.isLastPage` boolean + integer offset |

**The most widespread mechanical change**: every `{ fields: { ... } }` body becomes a flat `{ ... }` object. Every `data.id` reference becomes `data.Id`.

---

## Client Instantiation Pattern

In each file's n8n entry block, instantiate the NocoDB client and pass it through `helpers`:

```js
// Entry block (n8n Code node)
const nocodb = new NocoDB(
  env.NOCODB_BASE_URL, env.NOCODB_API_TOKEN, env.NOCODB_PROJECT_ID,
  (url, opts) => fetch(url, opts)
);
const helpers = { fetchFn: (url, opts) => fetch(url, opts), nocodb, _sleep, ... };
```

Functions that need NocoDB receive it via `opts.nocodb`. This mirrors the existing `opts.fetchFn` pattern.

---

## Tests: BASE_ENV Template (All Files in This Section)

Remove from `BASE_ENV`: `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, and any `*_TABLE_ID` Airtable vars.

Add to `BASE_ENV`:
```js
NOCODB_API_TOKEN: 'test-token',
NOCODB_BASE_URL: 'http://localhost:8080',
NOCODB_PROJECT_ID: 'test-project-id',
```

---

## File 1: write-persistence.js

### What This File Does

Main persistence layer for the alerts pipeline. Writes new filings to `Insider_Alerts`, keeps `Monitor_State` current, and creates cluster summary records in `Cluster_Summaries`. Also calls Supabase for `writeSupabaseHistory()` — that call stays in Supabase unchanged.

### Tests to Write First (write-persistence.test.js)

Mock response shape for NocoDB:
```js
// NocoDB create response — flat, integer Id
{ Id: 1, dedup_key: 'AAPL-2024-01-15-JohnSmith', ticker: 'AAPL', status: 'processed' }

// NocoDB list response
{ list: [{ Id: 42, name: 'market', last_filing_date: '2024-01-01' }], pageInfo: { isLastPage: true } }
```

Write these tests:

- `createNocoRecord()` calls `nocodb.create('Insider_Alerts', flatBody)` — body has no `fields` wrapper
- Body contains expected filing fields: `dedup_key`, `ticker`, `insider_name`, `status: 'processed'`, and others as the filing object specifies
- Function returns `data.Id` — an integer, not an Airtable string
- When the returned ID is passed to `writeSupabaseHistory()`, it is cast: `String(data.Id)` — the raw integer is never passed to Supabase
- `updateMonitorState()` calls `nocodb.update('Monitor_State', id, data)` with only the changed fields (partial body — not a full record spread)
- `createOrUpdateClusterSummary()` calls `nocodb.create('Cluster_Summaries', flatBody)` for new clusters
- `createOrUpdateClusterSummary()` calls `nocodb.update('Cluster_Summaries', id, flatBody)` for existing clusters
- `writeSupabaseHistory()` still calls the Supabase URL — the Supabase `fetchFn` call count is unchanged
- `BASE_ENV` uses NocoDB keys, not Airtable keys

### Implementation Notes

**`createNocoRecord()`**: Replace the Airtable POST:
- Old: `POST api.airtable.com/v0/{base}/Insider_Alerts` with body `{ fields: { ticker, ... } }`
- New: `nocodb.create('Insider_Alerts', { ticker, ... })` — flat body, no wrapper
- Old return: `data.id` (Airtable string)
- New return: `data.Id` (NocoDB integer)

**Supabase type safety — critical**: `writeSupabaseHistory()` receives the record ID and stores it in a Supabase column typed as string (`airtable_record_id`). After migration, the returned `data.Id` is an integer. Cast explicitly before passing: `String(data.Id)`. Do NOT pass the raw integer.

**`updateMonitorState()`**: Replace the Airtable PATCH:
- Old: `PATCH api.airtable.com/...` with `{ fields: { last_filing_date: ... } }`
- New: `nocodb.update('Monitor_State', id, { last_filing_date: ... })`
- The `id` is the NocoDB integer `Id` from the Monitor_State record — the code that reads Monitor_State must capture `record.Id`
- Pass only the fields being changed — do NOT spread the full record object (NocoDB/Postgres fails on system columns like `Id`, `created_at`)

**`createOrUpdateClusterSummary()`**: Same pattern — `nocodb.create(...)` for new, `nocodb.update(...)` for existing.

---

## File 2: score-alert.js

### What This File Does

Scores filing significance by looking up the insider's track record: how many past buys they've made and what the hit rate was. This query currently hits **Supabase** `insider_alerts` via PostgREST. Per the migration plan, it moves to **NocoDB** `Insider_History`. The Supabase call is removed entirely.

### Tests to Write First (score-alert.test.js)

Write these tests:

- Track record lookup calls `nocodb.list('Insider_History', { where, fields, limit })` — Supabase URL is NOT called
- `where` param uses NocoDB syntax: `(insider_name,like,%{encodedName}%)~and(filing_date,gt,{cutoffStr})`
- For an insider name with special chars (e.g. `"Smith, John Jr."`), the `where` string contains the URL-encoded, lowercased form
- `fields` param requests only `ticker`, `filing_date`, `total_value` (not all columns)
- Supabase `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are NOT present in `BASE_ENV` for this file's track record path
- After migration: `BASE_ENV` has no Supabase keys for this file (unless other functions in the file still need them — audit carefully)

### Implementation Notes

**Case sensitivity**: NocoDB supports both `like` (case-sensitive) and `ilike` (case-insensitive). Use `ilike` to preserve the case-insensitive behavior of Supabase's `ilike`. The NocoDB client's `list()` handles URL encoding via `URLSearchParams` — do NOT pre-encode values with `encodeURIComponent()` (that causes double-encoding).

The query construction:
```js
const normalizedName = normalizeInsiderName(insiderName);  // already lowercases
const where = `(insider_name,ilike,%${normalizedName}%)~and(filing_date,gt,${cutoffStr})`;
await opts.nocodb.list('Insider_History', { where, fields: 'ticker,filing_date,total_value', limit: 100 });
```

**Remove Supabase from this function**: After replacing the PostgREST call, remove `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from this function's `opts` destructuring and from `BASE_ENV` if no other function in the file uses them. Do not remove blindly — audit all functions first.

---

## File 3: analyze-alert.js

### What This File Does

Runs AI analysis (Claude/Anthropic) on a filing and saves the result. May also do Airtable lookups for context before calling the LLM.

### Tests to Write First (analyze-alert.js)

Audit the file for Airtable calls before writing tests. Write these:

- Any Airtable lookup calls are replaced by `nocodb.list()` or `nocodb.get()` with equivalent filters in NocoDB syntax
- Analysis save calls `nocodb.create()` or `nocodb.update()` with a flat body (no `fields` wrapper)
- Mock responses use NocoDB shape: `{ Id: N, ...fields }` not `{ id: 'recXXX', fields: {...} }`
- `BASE_ENV` uses NocoDB keys

### Implementation Notes

Business logic and prompt building are unchanged. Only the persistence calls (fetch-before-analyze and save-after-analyze) change.

Apply the same mechanical substitutions:
- `{ fields: { ... } }` body → flat `{ ... }`
- `data.id` → `data.Id`
- Airtable URL → `nocodb.list()` / `nocodb.create()` / `nocodb.update()`
- Filter syntax: Airtable formula → NocoDB `(field,op,value)~and(...)` syntax

---

## File 4: deliver-alert.js

### What This File Does

Delivers scored alerts to eligible users. Fetches users from Supabase (auth data — this stays in Supabase). Writes delivery log entries to `Alert_Delivery_Log` — this migrates to NocoDB.

### Tests to Write First (deliver-alert.test.js)

Write these tests:

- `fetchEligibleUsers()` still calls the Supabase URL — the Supabase mock call count is unchanged
- `updateDeliveryLog()` calls `nocodb.create('Alert_Delivery_Log', flatData)` — flat body, no `fields` wrapper
- If there is a status-update path in `updateDeliveryLog()`, it calls `nocodb.update('Alert_Delivery_Log', id, { status: 'delivered' })` with partial body
- No Airtable URL appears in any test scenario
- `BASE_ENV` has NocoDB keys; Airtable keys removed; Supabase keys remain (used by `fetchEligibleUsers()`)

### Implementation Notes

**`fetchEligibleUsers()` stays in Supabase** — users are auth data and the Supabase boundary is not crossed for auth. Do not move this call.

**`updateDeliveryLog()` migrates**:
- Old: Airtable POST/PATCH to `Alert_Delivery_Log`
- New: `nocodb.create('Alert_Delivery_Log', { ...data })` for new entries, `nocodb.update('Alert_Delivery_Log', id, { status })` for status updates

The `subscription_tier` field name is identical in NocoDB — no field name mapping needed for this table.

---

## What Was Actually Built

**Files migrated**: `write-persistence.js`, `score-alert.js`, `analyze-alert.js` (no-op — had no Airtable calls), `deliver-alert.js`

**Key deviations from plan**:
- `analyze-alert.js` had no Airtable calls — confirmed by audit, no changes needed
- `createAirtableRecord` renamed to `createNocoRecord`, `patchAirtableRecord` → `patchNocoRecord`
- `airtable_record_id` field in ctx objects renamed to `nocodb_record_id` (was a latent bug: deliver-alert read `nocodb_record_id` but write-persistence stored `airtable_record_id`)
- `score-alert.js` uses `ilike` (not `like`) for case-insensitive insider name matching — preserves Supabase `ilike` behavior; pre-encoding with `encodeURIComponent()` was removed (client handles encoding)
- `encodeURIComponent()` removed from `updateMonitorState` and `createOrUpdateClusterSummary` where values — NocoDB client auto-encodes via `URLSearchParams`
- Supabase calls in `insertToSupabase()` and `fetchEligibleUsers()` intentionally unchanged

**Test results**: 550/551 pass. 1 pre-existing failure in `seo-config.test.js` (unrelated to migration).

## Definition of Done — Verified

1. ✅ All section 02 test files pass with NocoDB mocks
2. ✅ Zero Airtable API URLs in migrated files
3. ✅ `insertToSupabase()` in `write-persistence.js` still calls Supabase
4. ✅ `fetchEligibleUsers()` in `deliver-alert.js` still calls Supabase
5. ✅ `score-alert.js` track record lookup calls NocoDB `Insider_History` with `ilike`
6. ✅ No `{ fields: { ... } }` wrappers remain in any request body
