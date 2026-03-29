# Section 04: Outreach Pipeline Migration

## Overview

Migrate `send-outreach.js` and `find-prospects.js` from Airtable to NocoDB. This section also includes a compliance fix (GAP 12.14): remove all URLs from first-email generation, both in the prompt template and in the article context object passed to the LLM.

**Dependency**: Section 01 (`nocodb-client.js`) must be complete before starting this section. The `NocoDB` class imported from that module is what replaces all Airtable HTTP calls here.

**Parallelizable with**: Section 02 (Alerts Pipeline) and Section 03 (Social Pipeline) — these files are fully independent.

---

## Files Changed

### Production files
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/send-outreach.js` — migrated + GAP 12.14 fix
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/find-prospects.js` — migrated

### Test files
- `ryan_cole/insiderbuying-site/tests/insiderbuying/send-outreach.test.js` — mocks updated + GAP 12.14 assertions added
- `ryan_cole/insiderbuying-site/tests/insiderbuying/find-prospects.test.js` — mocks updated

---

## TDD Order

Follow the red-green cycle for each file:

1. Update `BASE_ENV` in the test file — swap Airtable vars for NocoDB vars
2. Update mock response shapes — Airtable `{ records: [...] }` to NocoDB `{ list: [...] }`
3. Run existing tests — confirm they **FAIL** (red)
4. Migrate the production file to NocoDB
5. Run tests again — confirm they **PASS** (green)
6. Run `grep -i "airtable" send-outreach.js find-prospects.js` — confirm 0 matches

---

## Tests: send-outreach.test.js

Write or update these tests **before** touching production code.

### BASE_ENV update

Remove: `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, any `*_TABLE_ID` vars.

Add:
```js
NOCODB_API_TOKEN: 'test-token',
NOCODB_BASE_URL: 'http://localhost:8080',
NOCODB_PROJECT_ID: 'test-project',
```

### Mock response shape

Change from Airtable format:
```js
// OLD
{ records: [{ id: 'recABC', fields: { status: 'pending', score: 90, domain: 'example.com' } }], offset: null }
```

To NocoDB format:
```js
// NEW
{ list: [{ Id: 1, status: 'pending', score: 90, domain: 'example.com' }], pageInfo: { isLastPage: true } }
```

### Test stubs

```js
// selectProspects() — prospect query
test('selectProspects calls nocodb.list with correct params', async () => {
  // assert nocodb.list was called with:
  //   table: 'Outreach_Prospects'
  //   opts: { where: '(status,eq,pending)', sort: '-score', limit: 10 }
});

// status update after sending
test('updates prospect status to sent after email sent', async () => {
  // assert nocodb.update was called with:
  //   table: 'Outreach_Prospects'
  //   id: 1   (integer, the record Id)
  //   data: { status: 'sent' }   // partial body only, not full record
});

// follow-up scheduling
test('schedules follow-up date after send', async () => {
  // assert nocodb.update was called with:
  //   table: 'Outreach_Prospects'
  //   id: 1
  //   data: { followup_due_date: '<date string>' }
});

// GAP 12.14 — prompt template
test('first email prompt template does not contain URL patterns', () => {
  // inspect the prompt template string directly
  // assert it does NOT contain: 'http://', 'https://', '.url', 'href='
  // this is a static assertion on the source string, no fetch needed
});

// GAP 12.14 — LLM context object
test('article context passed to LLM for first email has no url property', async () => {
  // capture the article context object that is passed to the LLM call
  // assert context object does not have a 'url' key
});

// GAP 12.14 — post-generation scrub (optional safety net)
test('post-processing strips any accidentally generated URLs from first email output', async () => {
  // mock LLM to return a string containing 'https://example.com'
  // assert the final stored/sent email does not contain that URL
});
```

---

## Tests: find-prospects.test.js

### BASE_ENV update

Same swap as above: remove Airtable vars, add NocoDB vars.

### Mock response shape

Same NocoDB format: `{ list: [...], pageInfo: { isLastPage: true } }`.

### Test stubs

```js
// duplicate check — domain already exists
test('duplicate check calls nocodb.list and skips creation when domain exists', async () => {
  // mock nocodb.list to return { list: [{ Id: 1, domain: 'example.com' }], ... }
  // assert nocodb.create was NOT called
});

// duplicate check — domain does not exist
test('duplicate check calls nocodb.list with correct where param', async () => {
  // assert nocodb.list called with:
  //   table: 'Outreach_Prospects'
  //   opts: { where: '(domain,eq,example.com)', limit: 1 }
});

// prospect save
test('saves new prospect via nocodb.create with flat body', async () => {
  // mock nocodb.list to return empty list (domain not found)
  // assert nocodb.create was called with:
  //   table: 'Outreach_Prospects'
  //   data: prospectData flat object (no 'fields' wrapper)
});
```

---

## Implementation: send-outreach.js

### Entry block

Instantiate the NocoDB client and pass it via `helpers`:

```js
// In the n8n entry block
const nocodb = new NocoDB(
  env.NOCODB_BASE_URL, env.NOCODB_API_TOKEN, env.NOCODB_PROJECT_ID,
  (url, opts) => fetch(url, opts)
);
const helpers = { fetchFn: (url, opts) => fetch(url, opts), nocodb, _sleep, ... };
```

Functions that need NocoDB receive it via `opts.nocodb`.

### selectProspects()

Replace the Airtable query with:

```js
async function selectProspects(opts) {
  const { nocodb } = opts;
  const result = await nocodb.list('Outreach_Prospects', {
    where: '(status,eq,pending)',
    sort: '-score',
    limit: 10,
  });
  return result.list;
}
```

Key differences from Airtable:
- No `filterByFormula` param — use `where` with NocoDB filter syntax `(field,op,value)`
- No `sort[0][field]` param — use `sort: '-score'` (leading `-` = descending)
- Response is `result.list`, not `result.records`
- Each record's ID is `record.Id` (integer), not `record.id` (string)

### Status update after send

Replace Airtable PATCH with:

```js
await nocodb.update('Outreach_Prospects', prospect.Id, { status: 'sent' });
```

**Critical**: pass only the fields being changed. Do NOT spread the full prospect object — NocoDB/Postgres will error on system-managed columns like `Id` and `created_at`.

### Follow-up scheduling

```js
await nocodb.update('Outreach_Prospects', prospect.Id, { followup_due_date: followupDate });
```

### GAP 12.14 — Zero Links in First Email (two-part fix)

This is a compliance gap: first cold-outreach emails must not contain any links.

**Part 1 — Remove URL from prompt template string.**

Find the prompt template used for first-email generation and delete any interpolation of `ourArticle.url` or any `http://`/`https://` literal. The template string itself must not contain URL patterns.

Before:
```js
// example — actual template string will differ
const prompt = `Write a cold outreach email referencing this article: ${article.title} at ${article.url}...`;
```

After:
```js
const prompt = `Write a cold outreach email referencing this article: ${article.title}...`;
// article.url is not referenced anywhere in the prompt string
```

**Part 2 — Strip `url` from article context object passed to the LLM.**

Even if the prompt template doesn't reference it, passing the URL in the context object risks the LLM reconstructing or hallucinating links. Remove it explicitly:

```js
// Build context without the url field
const articleContext = {
  title: article.title,
  summary: article.summary,
  ticker: article.ticker,
  // do NOT include: url: article.url
};
// pass articleContext to LLM, not the full article object
```

**Optional Part 3 — Post-generation URL scrub (safety net).**

After the LLM returns the email body, before storing or sending, scrub any URL that slipped through:

```js
function scrubUrls(text) {
  return text.replace(/https?:\/\/\S+/g, '').replace(/href=["'][^"']*["']/g, '').trim();
}
const safeEmailBody = scrubUrls(rawEmailBody);
```

This is additive — it does not replace Parts 1 and 2, it guards against edge cases.

### REQUIRED_ENV update

Remove: `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, any `*_TABLE_ID` vars.

Add:
```js
const REQUIRED_ENV = [
  // ...existing vars...
  'NOCODB_API_TOKEN',
  'NOCODB_BASE_URL',
  'NOCODB_PROJECT_ID',
];
```

---

## Implementation: find-prospects.js

### Entry block

Same NocoDB instantiation pattern as send-outreach.js above.

### Duplicate check before saving

Before creating a new prospect, check if the domain already exists:

```js
async function isDuplicateDomain(domain, opts) {
  const { nocodb } = opts;
  const encoded = encodeURIComponent(domain);
  const result = await nocodb.list('Outreach_Prospects', {
    where: `(domain,eq,${encoded})`,
    limit: 1,
  });
  return result.list.length > 0;
}
```

If the domain exists, skip creation and return early. Do not create a duplicate record.

**Encoding note**: domains can contain dots and hyphens which are safe, but always pass dynamic values through `encodeURIComponent()` for consistency and to handle edge cases.

### Prospect save

Replace the Airtable POST with:

```js
async function saveProspect(prospectData, opts) {
  const { nocodb } = opts;
  const created = await nocodb.create('Outreach_Prospects', prospectData);
  return created; // created.Id is the new integer record ID
}
```

`prospectData` is a flat object — no `{ fields: {...} }` wrapper.

### REQUIRED_ENV update

Same as send-outreach.js: remove Airtable vars, add NocoDB vars.

---

## Key API Translation Reference

| Concern | Airtable | NocoDB |
|---------|----------|--------|
| Request body | `{ fields: { status: 'pending' } }` | `{ status: 'pending' }` (flat) |
| List response | `{ records: [{ id: 'recABC', fields: {...} }], offset: null }` | `{ list: [{ Id: 1, ...fields }], pageInfo: { isLastPage: true } }` |
| Record ID | `record.id` (string `recXXX`) | `record.Id` (integer) |
| Filter | `filterByFormula=AND({status}='pending')` | `where=(status,eq,pending)` |
| Sort descending | `sort[0][field]=score&sort[0][direction]=desc` | `sort=-score` |
| Auth header | `Authorization: Bearer {key}` | `xc-token: {token}` |

---

## Definition of Done for This Section

- [ ] `grep -i "airtable" send-outreach.js find-prospects.js` returns 0 matches
- [ ] `send-outreach.test.js` passes — all NocoDB mock assertions green
- [ ] `find-prospects.test.js` passes — all NocoDB mock assertions green
- [ ] GAP 12.14: first email prompt template contains no `http://`, `https://`, `.url`, or `href=`
- [ ] GAP 12.14: article context object passed to LLM for email #1 does not include a `url` property
- [ ] `NOCODB_API_TOKEN`, `NOCODB_BASE_URL`, `NOCODB_PROJECT_ID` present in `REQUIRED_ENV` of both files
- [ ] No Airtable env vars remain in either file

---

## What Was Actually Built

**Files migrated**: Neither `send-outreach.js` nor `find-prospects.js` had Airtable calls — both are pure helper function modules. No NocoDB migration was needed.

**Production change**: GAP 12.14 fix in `send-outreach.js` (`buildEmailPrompt`):
- Part 1: Removed `ourArticle.url` from prompt template string
- Part 2: Destructured only `title`/`summary` from `ourArticle` — URL can never leak into prompt even if caller passes full article object

**New test files**: `send-outreach.test.js` (59 tests) and `find-prospects.test.js` (19 tests) — first-ever test coverage for these modules.

**Deferred**: GAP 12.14 Part 3 (`scrubUrls` post-generation safety net) — spec marked optional, deferred.

**Key deviation from plan**: "NOCODB_API_TOKEN etc. present in REQUIRED_ENV" criterion waived — neither file has a `REQUIRED_ENV` block (pure helpers, no n8n entry block).

## Definition of Done — Verified

1. ✅ Zero Airtable references in both files
2. ✅ GAP 12.14: prompt template contains no URL patterns
3. ✅ GAP 12.14: url property never forwarded to LLM (destructuring fix + test)
4. ✅ 59/59 tests pass for send-outreach; 19/19 for find-prospects
