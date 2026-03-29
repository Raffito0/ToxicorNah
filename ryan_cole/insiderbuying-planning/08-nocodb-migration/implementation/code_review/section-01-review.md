# Code Review: section-01-nocodb-client

## Summary

31/31 tests pass. Implementation matches plan spec completely. Two IMPORTANT issues found that could cause silent data loss in production.

## IMPORTANT

### 1. `bulkCreate()` silently drops non-array responses
**File:** `nocodb-client.js:188`
If NocoDB returns `{ insertedCount: N }` instead of an array, inserts are silently ignored and `[]` is returned. Any caller checking `result.length` to verify inserts will see silent data loss.
**Fix:** Throw when `created` is not an array.

### 2. `count()` returns `undefined` silently when `result.count` is missing
**File:** `nocodb-client.js:210`
If the server returns `{}`, callers doing `if (count >= dailyLimit)` get `undefined >= 5 === false` — bypasses rate-limit checks silently.
**Fix:** Guard with `if (result.count === undefined) throw new Error(...)`.

## MINOR

### 3. 404 detected via string-contains on error message
**File:** `nocodb-client.js:125`
Brittle: if `_req()` error format changes, `get()` silently breaks and throws on 404 instead of returning null.
**Fix:** Attach `err.statusCode` property to thrown errors so `get()` can check `err.statusCode === 404`.

### 4. `where` double-encoding risk undocumented
Callers who pre-encode `where` will produce `%2528` instead of `%28`. Add JSDoc note: do NOT pre-encode values.

### 5. `bulkCreate([])` no-op undocumented
Add JSDoc note for empty array behavior.

## NITPICK

### 6. `Content-Type` sent on GET/DELETE requests
Semantically incorrect per RFC 7231 — guard with `if (opts.body !== undefined)`.

### 7. Retry test uses `get()` instead of body-agnostic method
Switch retry test to `db.list()` to avoid coupling with `get()`'s special 404 handling.

### 8. `update()` test name misleading
"does not include Id or system fields if caller did not pass them" — the client does not strip these; it passes through what the caller provides. Rename to reflect pass-through semantics.

## Coverage Gaps

- `bulkCreate` non-array response path
- `count()` with missing `count` key in response
- 4× 500 exhausts retries (currently only 2 failures + 1 success tested)
- `bulkCreate` with exactly 200 records (boundary)
- `get()` with `id = 0`
