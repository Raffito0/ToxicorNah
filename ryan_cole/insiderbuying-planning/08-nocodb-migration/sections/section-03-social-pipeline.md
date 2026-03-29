# Section 03: Social Pipeline

## Overview

Migrate four files from Airtable to NocoDB: `sec-monitor.js`, `x-auto-post.js`, `x-engagement.js`, and `reddit-monitor.js`. This section is fully independent from sections 02 and 04 — it can run in parallel once `nocodb-client.js` (section 01) is complete.

**Dependency**: section-01-nocodb-client must be done first. The `NocoDB` class is imported and injected as `opts.nocodb` in every file here.

**Does NOT change**: business logic, SEC API calls, Twitter API calls, Reddit API calls, classification, dedup key computation, any Supabase call.

---

## Files to Modify

```
ryan_cole/insiderbuying-site/n8n/code/insiderbuying/
  sec-monitor.js        <-- migrated
  x-auto-post.js        <-- migrated
  x-engagement.js       <-- migrated
  reddit-monitor.js     <-- migrated

ryan_cole/insiderbuying-site/tests/insiderbuying/
  sec-monitor.test.js   <-- updated mocks
  x-auto-post.test.js   <-- updated mocks
  x-engagement.test.js  <-- updated mocks
  reddit-monitor.test.js <-- updated mocks
```

---

## Key API Translation Rules

These rules apply throughout this section. Memorise them before touching any file.

| Concern | Airtable | NocoDB |
|---------|----------|--------|
| List records | `{ records: [{ id: 'recXXX', fields: { name: 'x' } }], offset: 'cursor' }` | `{ list: [{ Id: 1, name: 'x' }], pageInfo: { isLastPage: true } }` |
| Filter param | `filterByFormula=IS_AFTER({filing_date},'...')` | `where=(filing_date,gt,...)` |
| Sort param | `sort[0][field]=x&sort[0][direction]=desc` | `sort=-x` |
| Pagination | `while (offset)` cursor loop | `while (!pageInfo.isLastPage)` offset loop |
| Count | list + `.length` | `nocodb.count(table, where)` returns integer |
| Auth header | `Authorization: Bearer {key}` | `xc-token: {token}` |
| Record ID | `record.id` (`recXXX` string) | `record.Id` (integer) |
| Request body | `{ fields: { ticker: 'x' } }` | `{ ticker: 'x' }` (flat) |

---

## TDD Cycle for Each File

1. Update `BASE_ENV` in the test file — swap Airtable vars for NocoDB vars
2. Update mock response shapes from Airtable format to NocoDB format
3. Run existing tests — confirm they FAIL (red)
4. Migrate the production file to NocoDB
5. Run tests — confirm they PASS (green)
6. Run `grep -i "airtable" <filename>.js` — confirm 0 matches before moving on

Start with `sec-monitor.js` as it has the most complex migration (pagination + Monitor_State read/write).

---

## sec-monitor.js

### What This File Does

`sec-monitor.js` is the busiest of the four files. It:

1. Reads `Monitor_State` to get the last-processed filing date checkpoint
2. Fetches all `dedup_key` values from `Insider_Alerts` for the last 7 days (paginated) to prevent reprocessing
3. Fetches new SEC filings since the checkpoint
4. For each new filing not in the dedup set, processes it (classification, scoring, persistence)
5. Writes `Monitor_State` back with the new checkpoint on completion

### Tests — Write These First

**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js`

Update `BASE_ENV`:
```js
const BASE_ENV = {
  NOCODB_API_TOKEN: 'test-token',
  NOCODB_BASE_URL: 'http://localhost:8080',
  NOCODB_PROJECT_ID: 'proj123',
  // ... other non-Airtable env vars (SEC_API_KEY, etc.) unchanged
};
```

Remove all `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, and `*_TABLE_ID` keys from `BASE_ENV`.

**Monitor_State read**
```js
// Test: Monitor_State read calls nocodb.list with NocoDB filter syntax
// Expected: nocodb.list('Monitor_State', { where: '(name,eq,market)', limit: 1 })
// Mock returns: { list: [{ Id: 7, name: 'market', last_filing_date: '2024-01-15T00:00:00Z' }], pageInfo: { isLastPage: true } }
```

**Monitor_State write**
```js
// Test: Monitor_State write calls nocodb.update with the Id captured from the read
// Expected: nocodb.update('Monitor_State', 7, { last_filing_date: '2024-01-20T00:00:00Z' })
// The Id (7) comes from the record returned by the list call above
```

**Dedup key fetch — single page**
```js
// Test: dedup key fetch calls nocodb.list('Insider_Alerts', ...) with NocoDB filter and stable sort
// Expected where: '(filing_date,gt,2024-01-08)'  (7 days before checkpoint)
// Expected sort: '-Id'
// Expected limit: 100 (or whatever the file uses)
// Mock: { list: [{ Id: 1, dedup_key: 'AAPL-smith-2024-01-10' }], pageInfo: { isLastPage: true } }
// Assert: dedup set contains 'AAPL-smith-2024-01-10'
// Assert: field accessed as record.dedup_key (flat), NOT record.fields.dedup_key
```

**Dedup key fetch — multi-page pagination**
```js
// Test: pagination loop uses pageInfo.isLastPage, NOT Airtable cursor
// makeFetchSeq:
//   Page 1: { list: [{dedup_key: 'A'}], pageInfo: { isLastPage: false, totalRows: 2 } }
//   Page 2: { list: [{dedup_key: 'B'}], pageInfo: { isLastPage: true, totalRows: 2 } }
// Assert: nocodb.list called twice
// Assert: second call passes offset = limit (page 1 limit value)
// Assert: final dedup set contains both 'A' and 'B'
// There is NO 'while (offset)' cursor check — the loop condition is 'while (!pageInfo.isLastPage)'
```

**Cluster detection data** (if present in the file)
```js
// Test: any Airtable reads for cluster state replaced by nocodb.list() with NocoDB filter syntax
// Mock response uses NocoDB shape: { list: [...], pageInfo: { isLastPage: true } }
// Fields accessed flat (no .fields. accessor)
```

### Implementation Notes

**Monitor_State read**

Old Airtable filter: `filterByFormula={name}='market'`
New NocoDB where: `(name,eq,market)`

The state record's `Id` field must be captured from the list response and stored in a variable. This integer `Id` is passed to the subsequent `nocodb.update()` call.

```js
// Stub signature
async function readMonitorState(opts) {
  // nocodb.list('Monitor_State', { where: '(name,eq,market)', limit: 1 })
  // return { ...record, Id: record.Id }  <-- Id is NocoDB integer, store it
}
```

**Dedup key pagination**

Old Airtable cursor loop:
```js
let offset;
do {
  const data = await fetchAirtable(..., offset);
  dedupSet.add(...);
  offset = data.offset;
} while (offset);
```

New NocoDB offset loop:
```js
let offset = 0;
let isLastPage = false;
while (!isLastPage) {
  const { list, pageInfo } = await opts.nocodb.list('Insider_Alerts', {
    where: `(filing_date,gt,${cutoffStr})`,
    sort: '-Id',
    fields: 'dedup_key',
    limit,
    offset,
  });
  list.forEach(r => dedupSet.add(r.dedup_key));
  isLastPage = pageInfo.isLastPage;
  offset += limit;
}
```

Use `fields: 'dedup_key'` (comma-separated string) to fetch only the needed column — reduces response size on large tables.

Filter translation: Airtable `IS_AFTER({filing_date}, '...')` → NocoDB `(filing_date,gt,...)`. The date string format is unchanged.

**Monitor_State write**

```js
// Stub signature
async function writeMonitorState(opts, stateId, newDate) {
  // nocodb.update('Monitor_State', stateId, { last_filing_date: newDate })
  // stateId is the integer Id from readMonitorState
}
```

**Environment variables**

Remove from `REQUIRED_ENV`:
- `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID`
- `MONITOR_STATE_TABLE_ID`
- `INSIDER_ALERTS_TABLE_ID`

Add to `REQUIRED_ENV`:
- `NOCODB_API_TOKEN`
- `NOCODB_BASE_URL`
- `NOCODB_PROJECT_ID`

---

## x-auto-post.js

### What This File Does

`x-auto-post.js` fetches approved articles that haven't been posted yet, checks how many posts have been made today (to enforce a daily cap), selects an article to post, calls the Twitter API, and writes a log entry.

### Tests — Write These First

**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/x-auto-post.test.js`

Update `BASE_ENV`: remove Airtable vars, add `NOCODB_API_TOKEN`, `NOCODB_BASE_URL`, `NOCODB_PROJECT_ID`.

**Article fetch**
```js
// Test: article fetch calls nocodb.list('Articles', ...) — not Airtable
// Mock: { list: [{ Id: 5, title: 'Test', url: 'https://...', status: 'approved' }], pageInfo: { isLastPage: true } }
// Assert: fetchFn (or nocodb mock) called with NocoDB URL, not api.airtable.com
```

**Daily post count check**
```js
// Test: daily post count check calls nocodb.count('X_Post_Log', '(posted_date,eq,2024-01-15)')
// Mock: count returns integer 2
// Assert: the integer is compared against the daily cap (not list.length)
```

**Post count at cap**
```js
// Test: when count >= daily cap, no post is made and no create is called
```

**Post log write**
```js
// Test: post log write calls nocodb.create('X_Post_Log', { tweet_id, content, posted_date })
// Assert: body is flat — no { fields: {} } wrapper
// Assert: body.tweet_id matches the Twitter API response tweet ID
```

### Implementation Notes

**Article fetch**

```js
// Stub signature
async function fetchArticlesToPost(opts) {
  // nocodb.list('Articles', {
  //   where: '(status,eq,approved)~and(x_posted,eq,false)',  // adjust field names to match schema
  //   sort: '-published_date',
  //   limit: 10
  // })
  // returns flat record array: record.title, record.url, record.Id
}
```

The filter condition must match the existing logic's intent — only approved, unposted articles. Use the exact field names from the NocoDB schema (which match Airtable field names).

**Daily count check**

Old pattern (Airtable): `list(...).records.length` as a count proxy.
New pattern (NocoDB): `nocodb.count('X_Post_Log', '(posted_date,eq,{today})')` returns an integer directly.

```js
// Stub signature
async function getDailyPostCount(opts, today) {
  // return await opts.nocodb.count('X_Post_Log', `(posted_date,eq,${today})`)
}
```

**Post log write**

```js
// Stub signature
async function writePostLog(opts, tweetId, content, postedDate) {
  // await opts.nocodb.create('X_Post_Log', { tweet_id: tweetId, content, posted_date: postedDate })
}
```

**Environment variables**: same removal/addition pattern as sec-monitor.js.

---

## x-engagement.js

### What This File Does

`x-engagement.js` processes incoming tweet mentions or replies. For each tweet, it checks whether the bot has already replied (dedup), then calls the Twitter API to reply, and writes an engagement log entry.

### Tests — Write These First

**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/x-engagement.test.js`

Update `BASE_ENV`: remove Airtable vars, add NocoDB vars.

**Replied check — already replied**
```js
// Test: replied check calls nocodb.list('X_Engagement_Log', {
//   where: '(tweet_id,eq,12345)~and(replied,eq,true)',
//   limit: 1
// })
// Mock: { list: [{ Id: 3, tweet_id: '12345', replied: true }], pageInfo: { isLastPage: true } }
// Assert: function returns truthy / skips reply when list.length > 0
```

**Replied check — not yet replied**
```js
// Test: when list is empty, proceeds to reply
// Mock: { list: [], pageInfo: { isLastPage: true } }
// Assert: Twitter API is called, then nocodb.create is called
```

**Engagement write**
```js
// Test: engagement write calls nocodb.create('X_Engagement_Log', data)
// Assert: body is flat — no { fields: {} } wrapper
// Assert: body.tweet_id is the correct tweet ID
// Assert: body.replied is true
```

**No Airtable call**
```js
// Test: no call to api.airtable.com in any path
```

### Implementation Notes

**Replied check**

```js
// Stub signature
async function hasAlreadyReplied(opts, tweetId) {
  // const { list } = await opts.nocodb.list('X_Engagement_Log', {
  //   where: `(tweet_id,eq,${encodeURIComponent(tweetId)})~and(replied,eq,true)`,
  //   limit: 1,
  // });
  // return list.length > 0;
}
```

Note: `tweet_id` values are typically numeric strings. Wrap in `encodeURIComponent()` as a precaution even if no special characters are expected — this is consistent with the codebase-wide encoding rule.

**Engagement write**

```js
// Stub signature
async function writeEngagementLog(opts, data) {
  // await opts.nocodb.create('X_Engagement_Log', data)
  // data is flat: { tweet_id, reply_id, content, replied: true, engaged_at }
}
```

**Environment variables**: same removal/addition pattern as sec-monitor.js.

---

## reddit-monitor.js

### What This File Does

`reddit-monitor.js` monitors Reddit for threads matching EarlyInsider topics, enforces a daily comment cap, checks whether a thread has already been commented on, posts a comment via the Reddit API, and writes a log entry.

### Tests — Write These First

**File**: `ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js`

Update `BASE_ENV`: remove Airtable vars, add NocoDB vars.

**Daily comment limit check**
```js
// Test: daily comment limit check calls nocodb.count('Reddit_Log', '(comment_date,eq,2024-01-15)')
// Mock: count returns integer 3
// Assert: integer compared against daily cap constant
```

**Daily cap reached**
```js
// Test: when count >= cap, no comment is posted and no create is called
```

**Comment existence check**
```js
// Test: comment existence check calls nocodb.list('Reddit_Log', {
//   where: '(thread_id,eq,t3_abc123)',
//   limit: 1
// })
// Mock: { list: [{ Id: 9, thread_id: 't3_abc123' }], pageInfo: { isLastPage: true } }
// Assert: thread is skipped when list.length > 0
```

**Comment existence check — new thread**
```js
// Test: when list is empty, proceeds to post comment
// Assert: Reddit API called, then nocodb.create called
```

**Log write**
```js
// Test: log write calls nocodb.create('Reddit_Log', data) with flat body
// Assert: body.thread_id matches the thread being processed
// Assert: body.comment_date matches today's date string
```

### Implementation Notes

**Daily count check**

```js
// Stub signature
async function getDailyCommentCount(opts, today) {
  // return await opts.nocodb.count('Reddit_Log', `(comment_date,eq,${today})`)
}
```

**Thread existence check**

```js
// Stub signature
async function hasCommentedOnThread(opts, threadId) {
  // const { list } = await opts.nocodb.list('Reddit_Log', {
  //   where: `(thread_id,eq,${encodeURIComponent(threadId)})`,
  //   limit: 1,
  // });
  // return list.length > 0;
}
```

**Log write**

```js
// Stub signature
async function writeCommentLog(opts, threadId, commentId, commentDate) {
  // await opts.nocodb.create('Reddit_Log', {
  //   thread_id: threadId,
  //   comment_id: commentId,
  //   comment_date: commentDate,
  // })
}
```

**Environment variables**: same removal/addition pattern as sec-monitor.js.

---

## Environment Variables Summary

All four files in this section must have these changes applied to `REQUIRED_ENV`:

**Remove**:
- `AIRTABLE_API_KEY`
- `AIRTABLE_BASE_ID`
- Any `*_TABLE_ID` Airtable variable specific to the file (e.g. `MONITOR_STATE_TABLE_ID`, `X_POST_LOG_TABLE_ID`, etc.)

**Add**:
- `NOCODB_API_TOKEN`
- `NOCODB_BASE_URL`
- `NOCODB_PROJECT_ID`

**Docker networking note**: `NOCODB_BASE_URL` should be `http://localhost:8080` if n8n and NocoDB run on the host or in the same container. If they are separate Docker containers in the same Compose network, use `http://nocodb:8080`. The env var abstracts this — do not hardcode either form in the code.

---

## Verification Checklist

After completing all four files in this section, run:

```bash
grep -i "airtable" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js
grep -i "airtable" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/x-auto-post.js
grep -i "airtable" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/x-engagement.js
grep -i "airtable" ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js
```

Each must return 0 matches. Then run the test suite:

```bash
npm test -- --testPathPattern="sec-monitor|x-auto-post|x-engagement|reddit-monitor"
```

All tests must pass before handing off to section 05 (validation cleanup).

---

## What Was Actually Built

**Files migrated**: `sec-monitor.js` (production migration). `x-auto-post.js`, `x-engagement.js`, `reddit-monitor.js` were audited and confirmed to have ZERO Airtable calls — they are pure helper function modules. No production migration was needed for those three.

**New test files created**: `x-auto-post.test.js`, `x-engagement.test.js`, `reddit-monitor.test.js` — all new files testing pure functions.

**Key deviations from plan**:
- `x-auto-post.js`, `x-engagement.js`, `reddit-monitor.js` had no Airtable calls — confirmed by `grep -i "airtable"` returning 0 matches. Only test files were created (no production migration).
- `readMonitorState` and `writeMonitorState` extracted as standalone helpers (not just internal to `runSecMonitor`) for testability — mirrors the `updateMonitorState` pattern from section-02.
- Pagination loop guard strengthened: `isLastPage = !pageInfo || pageInfo.isLastPage === true` (not `pageInfo && pageInfo.isLastPage`) to prevent infinite loop on malformed response — caught in code review.

**Test results**: 157/157 pass. 1 test added during code review (pageInfo absence edge case).

## Definition of Done — Verified

1. ✅ All section-03 test files pass with NocoDB mocks (157/157)
2. ✅ Zero Airtable references in `sec-monitor.js`
3. ✅ `x-auto-post.js`, `x-engagement.js`, `reddit-monitor.js` confirmed pure (no migration needed)
4. ✅ Pagination loop safe against missing `pageInfo`
5. ✅ `writeMonitorState` uses flat body (no `{ fields: {} }` wrapper)
6. ✅ `readMonitorState` uses NocoDB filter syntax (`eq` operator, no `filterByFormula`)
