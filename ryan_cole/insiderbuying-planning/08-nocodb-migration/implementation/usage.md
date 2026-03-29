# EarlyInsider — NocoDB Migration Usage Guide

## What Was Built

Full migration of the EarlyInsider n8n pipeline from Airtable to NocoDB. All persistence calls in the `n8n/code/insiderbuying/` directory now use the shared `NocoDB` client class instead of direct Airtable HTTP calls.

## Files Changed

### New Files
- `n8n/code/insiderbuying/nocodb-client.js` — shared NocoDB REST helper (7 public methods)
- `tests/insiderbuying/nocodb-client.test.js`

### Migrated Production Files
- `n8n/code/insiderbuying/write-persistence.js` — Insider_Alerts, Monitor_State, Cluster_Summaries
- `n8n/code/insiderbuying/score-alert.js` — Insider_History track record lookup (was Supabase, now NocoDB)
- `n8n/code/insiderbuying/deliver-alert.js` — Alert_Delivery_Log
- `n8n/code/insiderbuying/sec-monitor.js` — fetchDedupKeys pagination, readMonitorState/writeMonitorState
- `n8n/code/insiderbuying/send-outreach.js` — GAP 12.14 fix (URL removed from first email prompt)

### New Test Files (pure-function coverage)
- `tests/insiderbuying/write-persistence.test.js`
- `tests/insiderbuying/score-alert.test.js`
- `tests/insiderbuying/analyze-alert.test.js`
- `tests/insiderbuying/deliver-alert.test.js`
- `tests/insiderbuying/sec-monitor.test.js`
- `tests/insiderbuying/x-auto-post.test.js`
- `tests/insiderbuying/x-engagement.test.js`
- `tests/insiderbuying/reddit-monitor.test.js`
- `tests/insiderbuying/send-outreach.test.js`
- `tests/insiderbuying/find-prospects.test.js`

## Running Tests

```bash
cd ryan_cole/insiderbuying-site

# All migration tests (364 tests, ~4s)
npx jest tests/insiderbuying/nocodb-client.test.js \
  tests/insiderbuying/write-persistence.test.js \
  tests/insiderbuying/score-alert.test.js \
  tests/insiderbuying/analyze-alert.test.js \
  tests/insiderbuying/deliver-alert.test.js \
  tests/insiderbuying/sec-monitor.test.js \
  tests/insiderbuying/x-auto-post.test.js \
  tests/insiderbuying/x-engagement.test.js \
  tests/insiderbuying/reddit-monitor.test.js \
  tests/insiderbuying/send-outreach.test.js \
  tests/insiderbuying/find-prospects.test.js

# Quick grep verification (expected: no output)
grep -r "airtable" n8n/code/insiderbuying/ -i --include="*.js"
```

## Environment Variables

### Required (add to VPS .env / Docker Compose)
```
NOCODB_API_TOKEN=<your-nocodb-api-token>
NOCODB_BASE_URL=http://localhost:8080      # or http://nocodb:8080 if separate container
NOCODB_PROJECT_ID=<your-nocodb-project-id>
```

### Remove after confirming NocoDB works
```
AIRTABLE_API_KEY
AIRTABLE_BASE_ID
INSIDER_ALERTS_TABLE_ID
MONITOR_STATE_TABLE_ID
```

## NocoDB Client API

```js
const { NocoDB } = require('./nocodb-client');
const nocodb = new NocoDB(baseUrl, apiToken, projectId, fetchFn);

// List records with optional filtering/sorting/pagination
const { list, pageInfo } = await nocodb.list('TableName', {
  where: '(status,eq,pending)',   // NocoDB filter syntax
  sort: '-created_at',            // leading - = descending
  fields: 'id,name,status',       // comma-separated field names
  limit: 100,
  offset: 0,
});

// Get single record by ID (returns null on 404)
const record = await nocodb.get('TableName', 42);

// Create record (flat body, no { fields: {} } wrapper)
const created = await nocodb.create('TableName', { name: 'x', status: 'pending' });
// created.Id is the new integer record ID

// Update record (partial body only)
await nocodb.update('TableName', 42, { status: 'processed' });

// Delete record
await nocodb.delete('TableName', 42);

// Bulk create (auto-chunked to 500 per request)
const results = await nocodb.bulkCreate('TableName', arrayOfRecords);

// Count records matching filter
const count = await nocodb.count('TableName', '(status,eq,pending)');
```

## Pre-deploy Checklist

Before deploying to production VPS:

1. **NocoDB tables exist** — confirm these tables are created in your NocoDB project with matching column names:
   - `Insider_Alerts`, `Monitor_State`, `Cluster_Summaries`
   - `Alert_Delivery_Log`, `Insider_History`
   - `X_Post_Log`, `X_Engagement_Log`
   - `Reddit_Log`, `Outreach_Prospects`

2. **Monitor_State seeded** — `sec-monitor.js` needs a `name='market'` row in `Monitor_State` with a valid `last_check_timestamp` checkpoint. Without it, first run will reprocess old filings.

3. **Add NocoDB env vars** — set `NOCODB_API_TOKEN`, `NOCODB_BASE_URL`, `NOCODB_PROJECT_ID` in VPS environment.

4. **Deploy new code** — update n8n workflow JSON files with migrated code.

5. **Verify one run** — confirm `sec-monitor.js` runs successfully with NocoDB.

6. **Remove Airtable env vars** — only after confirming NocoDB is working.

## Key Migration Notes

- **Record IDs**: NocoDB uses integer `Id` (not string `recXXX`). All `data.Id` references return integers. Cast to `String(data.Id)` before passing to any system that expects string IDs (e.g., Supabase).
- **Flat bodies**: No `{ fields: { ... } }` wrapper. All request bodies are flat objects.
- **Filter syntax**: `(field,op,value)~and(field2,op2,value2)` not Airtable formula syntax.
- **Pagination**: `while (!pageInfo.isLastPage)` with integer offset, not cursor string.
- **Supabase unchanged**: `insertToSupabase()` in `write-persistence.js` and `fetchEligibleUsers()` in `deliver-alert.js` still call Supabase. These are intentional — auth data stays in Supabase.
