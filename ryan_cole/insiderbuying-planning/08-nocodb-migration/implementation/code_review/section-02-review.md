# Section 02 Code Review — Alerts Pipeline Migration (Airtable → NocoDB)

**Reviewer**: Senior Code Reviewer
**Date**: 2026-03-29
**Scope**: `write-persistence.js`, `score-alert.js`, `deliver-alert.js` + their test files
**Tests reported**: 112/112 passing

---

## Summary

This is a clean, well-scoped API client substitution. The mechanical translation from Airtable REST calls to `nocodb.*` client methods is correct in every case. The flat-body convention, `Id` (capital I) integer keys, and `list` response shape are all applied consistently. Business logic is untouched. The tests are meaningfully updated and not just renamed.

There are no critical correctness bugs. There are two important issues and several minor/nitpick items worth addressing before the section closes.

---

## What Was Done Well

- **Flat body applied everywhere**: every `{ fields: { ... } }` wrapper was correctly removed. No instance missed.
- **`Id` vs `id` casing**: correctly updated in all create/update checks, all test assertions, and all cross-reference passes.
- **Response shape access**: `result.list` (not `result.records`) is consistently applied across Monitor_State lookup, cluster search, and Insider_History query.
- **`existing.significance_score` / `existing.cluster_size`**: the `existing.fields.*` nesting was correctly removed on both read paths in `createOrUpdateClusterSummary`.
- **patchAirtableRecord simplification**: the old implementation had a manual `res.ok` check with a `res.text()` error body. That was removed and replaced with a one-liner `nocodb.update(...)`. This is correct because the NocoDB client from section 01 is expected to throw on non-2xx responses — error propagation is preserved.
- **Test mocks are honest**: mocks now return `{ list: [...], pageInfo: { isLastPage: true } }` which accurately reflects the real NocoDB client response structure rather than the raw HTTP response. The `makeNocoDB(fetchFn)` helper pattern is clean and reduces boilerplate correctly.
- **Supabase code unchanged**: `insertToSupabase` was deliberately left alone. This is correct — Supabase is not being migrated in this section.

---

## IMPORTANT Issues

### 1. Dead-letter path uses stale `airtable_record_id` field name — integer vs string type mismatch will silently succeed but log wrong value

**File**: `write-persistence.js`, `runPostProcessing`, line ~346 in diff

```js
// In runPostProcessing (unchanged from before migration):
if (f.retry_count && f.retry_count > 3 && f.airtable_record_id) {
  await handleDeadLetter(f, f.airtable_record_id, workflowName, opts);
}
```

The `failedFilings` array is populated in `writeFilingPersistence` at this line (post-migration):

```js
ctx.failedFilings.push({ ...filing, airtable_record_id: nocoRecordId, _lastError: err.message });
```

So `f.airtable_record_id` now carries a NocoDB integer `Id`, not an Airtable string. The field is named `airtable_record_id` but holds a NocoDB integer. This works mechanically — the dead-letter path reads `f.airtable_record_id` and passes it to `handleDeadLetter`, which now calls `nocodb.update(...)` with that value — so the PATCH itself is correct.

However, `successfulFilings` has the same stale field name problem:

```js
ctx.successfulFilings.push({ ...filing, airtable_record_id: nocoRecordId, supabase_id: supabaseId });
```

The `successfulFilings` array flows downstream to `deliver-alert.js`, which reads `alertData.nocodb_record_id` (correctly renamed). If any downstream node reads `airtable_record_id` from the `successfulFilings` output — which is likely since the pipeline stages are chained — it will find the right integer value but under the wrong key name. This is a latent rename that was half-completed.

**The correct fix is**: rename `airtable_record_id` to `nocodb_record_id` everywhere it appears as a field being written into `ctx.failedFilings`, `ctx.successfulFilings`, and the `runPostProcessing` dead-letter check guard (`f.airtable_record_id`). The diff only renamed it in the `deliverAlert` return object (`alertData.nocodb_record_id`), not in the persistence context objects.

**The test at line 1460** accidentally confirms this inconsistency rather than catching it:
```js
expect(ctx.successfulFilings[0].airtable_record_id).toBe(1);
```
The test asserts the stale name is present, which means this will pass but downstream consumers reading `nocodb_record_id` will get `undefined`.

---

### 2. NocoDB `like` operator is case-sensitive — the encoding does not fully protect against multi-word names with uppercase letters mid-word

**File**: `score-alert.js`, `computeTrackRecord`

```js
const normalizedName = normalizeInsiderName(insiderName);
const encodedName = encodeURIComponent(normalizedName.toLowerCase());
const where = `(insider_name,like,%${encodedName}%)~and(filing_date,gt,${cutoffStr})`;
```

`normalizeInsiderName` already lowercases the input (based on the test `strips middle initial and lowercases`), so `.toLowerCase()` here is redundant but harmless for the search value.

The real issue is that `insider_name` in the database may have been stored with mixed case (e.g. "Timothy D. Cook"). The NocoDB `like` operator is case-sensitive. The search value is lowercased, but the column value is not. This means `(insider_name,like,%timothy%cook%)` will match zero rows if the stored name is "Timothy D. Cook".

The old Supabase `ilike` was case-insensitive — this is a functional regression. The track record will silently return `{ past_buy_count: 0, hit_rate: null, avg_gain_30d: null }` for every insider whose name is stored in mixed case, which is all of them.

**Correct approaches (in order of preference)**:
1. Use NocoDB's `like` on a lowercased computed column (requires DB schema change, not in scope for section 02).
2. Use `(insider_name,ilike,%timothy%cook%)` if NocoDB supports `ilike` — check the NocoDB operator list. Some builds support it.
3. Store `insider_name_lower` as a separate column and query that.
4. Fetch all rows for the date range and filter client-side (expensive but correct for small datasets).

The test at line 795 does not catch this because it only verifies the URL contains `insider_name`, `like`, `john`, and `smith` — it does not verify that a query against a mixed-case stored value would succeed.

---

## Minor Issues

### 3. `encodeURIComponent` on the `clusterId` filter may double-encode special characters

**File**: `write-persistence.js`, `createOrUpdateClusterSummary`

```js
const where = `(transaction_type,eq,cluster)~and(cluster_id,eq,${encodeURIComponent(clusterId)})`;
```

If `clusterId` is a plain string like `"cluster-1"`, `encodeURIComponent("cluster-1")` = `"cluster-1"` (hyphen is safe). But if `clusterId` contains characters like `&`, `=`, or `+`, encoding is correct. However, the NocoDB client itself likely calls `encodeURIComponent` again on the `where` parameter when building the URL query string. This would produce `%252D` instead of `%2D` for a hyphen — double-encoding.

Check whether the section 01 NocoDB client passes `where` through an additional `URLSearchParams` or `encodeURIComponent` call. If it does, the `encodeURIComponent` calls on the caller side in this file should be removed.

The same concern applies to `updateMonitorState`:
```js
const where = `(name,eq,${encodeURIComponent(workflowName)})`;
```

---

### 4. `createAirtableRecord` function is not renamed

**File**: `write-persistence.js`

The function that creates a NocoDB record is still named `createAirtableRecord`. Same for `patchAirtableRecord`. This is a naming inconsistency that will confuse future maintainers. The diff renames variables (`airtableRecordId` → `nocoRecordId`) but leaves the function names unchanged.

This is low risk — the functions are module-private — but it is a missed rename.

---

### 5. `patchAirtableRecord` lost its error propagation check

**File**: `write-persistence.js`

Before migration:
```js
if (res && !res.ok) {
  const errBody = await res.text().catch(() => '');
  throw new Error(`Airtable PATCH failed (${res.status}): ${errBody}`);
}
```

After migration:
```js
await nocodb.update('Insider_Alerts', recordId, fields);
```

This is only correct if the NocoDB client (section 01) throws on non-2xx responses. If the client swallows errors or returns a result object without throwing, the callers of `patchAirtableRecord` would silently succeed when the update failed.

This was flagged in the section 01 review context — verify the NocoDB client throws on HTTP errors before closing this section. The test mocks return `{ Id: 1 }` which always succeeds; there is no test for the path where `nocodb.update` throws.

---

### 6. `deliver-alert.js` test for `updateDeliveryStatus` passes `fetchFn` and `env` to opts but the function no longer uses them

**File**: `tests/insiderbuying/deliver-alert.test.js`, line ~586

```js
await updateDeliveryStatus(1, {
  status: 'delivered',
  ...
}, { fetchFn, env: BASE_ENV, nocodb });
```

After migration, `updateDeliveryStatus` only reads `opts.nocodb`. The `fetchFn` and `env` being passed in the test are dead parameters. This is harmless but slightly misleading — a reader of the test may think those parameters are still required.

---

## Nitpicks

- **Comment block at line 47 in diff**: `// Step 2: Insert to Supabase (cast integer Id to string for Supabase column)` — the comment mentions a cast but no cast is visible in the diff. If the Supabase `analysis_results` column expects a string for the NocoDB record ID, the cast should be explicit. If the column is an integer, the comment is wrong. Either way the comment is misleading.

- **`score-alert.js` n8n usage comment** correctly shows `NocoDB` instantiation in the entry block, which is good documentation. However it shows `$env.NOCODB_PROJECT_ID` — verify that NocoDB `xc-token` authentication is project-scoped in the client, or whether `NOCODB_PROJECT_ID` is needed at all for token auth (tokens are usually global in NocoDB).

- **Test comment on line 810**: `expect(decoded.toLowerCase()).toContain('john')` — the test lowercases the decoded URL before checking for `john`. Since the search term should already be lowercased, this masks whether the actual query has the correct case. The assertion should check `decoded` (without `.toLowerCase()`) to verify the encoding is being applied.

---

## Test Coverage Gaps

1. **No test for `updateDeliveryStatus` throwing**: `deliver-alert.js` wraps `updateDeliveryStatus` in a try/catch and logs a warning on failure. There is no test that verifies the warning is logged and execution continues when `nocodb.update` throws.

2. **No test for NocoDB `like` returning zero rows due to case mismatch**: The test suite does not exercise the case-sensitivity issue identified in Important Issue #2. A test should be added with a stored name in mixed case to confirm the behavior.

3. **No test for `createOrUpdateClusterSummary` when NocoDB create returns `data.Id === 0` or `undefined`**: The check `if (supabaseId && createData.Id)` would skip the supabase_id patch in those cases. Test that the flow continues gracefully.

4. **No test for `patchAirtableRecord` failure path**: The callers catch errors from this function but there is no test that exercises the throw → catch → warn/continue path with the new NocoDB client.

---

## Verdict

The migration is mechanically correct and the 112-test pass count is credible given the quality of the test updates. The two important issues — the stale `airtable_record_id` field name in context objects, and the case-sensitivity regression in the insider name lookup — should be fixed before this section is considered done. The case-sensitivity issue is a functional regression that will silently produce wrong track record data for every insider query.

The minor issues can be addressed in the same pass or deferred to a polish section.
