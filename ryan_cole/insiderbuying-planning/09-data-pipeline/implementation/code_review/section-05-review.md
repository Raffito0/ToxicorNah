# Code Review: Section 05 — sec-monitor.js Enrichment Pipeline Rewrite (Part B)

**Reviewer:** Senior Code Reviewer
**Date:** 2026-03-29
**Files reviewed:**
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js`
- `ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js`
- `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/edgar-parser.js` (interface reference)
- `ryan_cole/insiderbuying-planning/09-data-pipeline/sections/section-05-alphavantage-secmonitor-rewrite.md` (spec)
**Test status:** 76/76 passing

---

## Summary

The rewrite is well-executed overall. The core pipeline flow is correct, the injection pattern is clean, and all five mandatory spec behaviors are correctly implemented. There are three issues worth addressing before this is considered production-ready.

---

## What Was Done Well

The architectural shift from a two-API flow (EDGAR EFTS + Financial Datasets) to a single-source-of-truth XML pipeline is a clear improvement. The implementation follows the spec's step ordering precisely: fetch XML, parse, amendment check, dedup all transactions, filter scorable, cluster, emit. This ordering is not trivially obvious and getting it right matters.

The `_edgarParser` injection pattern (`(helpers && helpers._edgarParser) || _defaultEdgarParser`) is the correct approach for this codebase style. It keeps the production `require('./edgar-parser')` path working in n8n while giving tests full mock control over every I/O boundary without `jest.mock()` patching at module level.

The amendment skip path is correctly not incrementing `failureCount`. Amendments are expected, routine SEC filings and treating them as failures would corrupt the Telegram alert threshold. The spec is explicit on this point and the implementation honours it. The test for this case (`filterScorable must NOT be called for amendments`) provides the right assertion level.

The dual dedup key design — primary `{accessionNumber}_{index}` plus secondary semantic `{ticker}_{ownerName}_{transactionDate}_{shares}` — is sound. Primary keys are stable across runs for the same filing. Secondary keys catch semantic duplicates that arrive via a different accession number (e.g., a re-submission or a same-day filing from a different platform).

The per-transaction result object shape is consistent with the existing `score-alert.js` contract: all field names are preserved from the old pipeline.

---

## Issues Found

### Critical

None.

---

### Important

**1. `passesDedup` side-effect on secondary key poisons the Set when primary already fails**

File: `sec-monitor.js`, lines 511-514

```javascript
const primaryPasses = passesDedup(primaryKey, existingDedupKeys);
const secondaryPasses = passesDedup(secondaryKey, existingDedupKeys);
if (primaryPasses && secondaryPasses) {
  dedupPassedTxs.push(tx);
}
```

`passesDedup` is not a pure predicate. Its contract (line 86-90 in the same file) is: if the key is new, add it to the Set immediately and return true. This means both calls execute regardless of the first result, and both keys are added to the Set unconditionally.

The consequence: if `primaryPasses` is false (primary key already in the set, meaning this transaction was seen before), `passesDedup(secondaryKey, ...)` still runs and inserts the secondary key into `existingDedupKeys`. On a second run in the same process (unlikely in production, but possible in tests that share module-level state), the secondary key is now "already seen" from a transaction that was correctly blocked — this could cause a genuinely new transaction with matching semantic attributes to be silently dropped.

More concretely, in the test `dedup: semantic key already in existingDedupKeys`, the test loads only the secondary key into the NocoDB mock. It does not test the reverse scenario: primary key already present, secondary key new. In that scenario the current code would add the secondary key to the Set as a side effect of the check even though the transaction was rejected. The spec says "if EITHER key matches an existing record, skip" — the current code reads more like "if BOTH keys pass, proceed" with the Set mutation happening as a side effect of the check, which is semantically different.

The correct guard is short-circuit evaluation before the Set mutation:

```javascript
const primaryPasses = !existingDedupKeys.has(primaryKey);
const secondaryPasses = !existingDedupKeys.has(secondaryKey);
if (primaryPasses && secondaryPasses) {
  existingDedupKeys.add(primaryKey);
  existingDedupKeys.add(secondaryKey);
  dedupPassedTxs.push(tx);
}
```

This stores both keys only when the transaction passes both checks, which is the intent stated in the spec ("Store dedup keys for ALL transactions... BEFORE calling filterScorable"). Note: the spec says "store dedup keys for all transactions including gifts", meaning keys should be stored even for non-scorable transactions that pass dedup. The current code does store them before `filterScorable` is called, which is correct — the issue is only the unconditional Set mutation during the predicate check.

**Severity:** Important. The scenario where this triggers in production is when two accession numbers contain transactions with overlapping semantic keys (same insider, same date, same share count). This is a known SEC edge case (split transactions, amended re-filings). The current code would lose the second transaction permanently.

---

**2. Telegram alert path silently removed — spec says "preserve unchanged"**

File: `sec-monitor.js` (current state, post-diff)

The spec explicitly states under "What to Preserve Unchanged": "Telegram error alerting (failure threshold, message format)." The old pipeline included:

```javascript
if (failureCount > 5 && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
  // send alert
}
```

This block was removed in the rewrite. `failureCount` is tracked (incremented for null XML and null parse results) but the threshold check and Telegram POST are gone. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are not in `REQUIRED_ENV` (correct — they are optional), but the alerting code that consumes them has been dropped.

In production this means: if EDGAR returns 10+ null XML responses in a single run (e.g., CIK mismatch bug, CDN outage, rate limit 429 across the board), the operator gets no notification. The `failureCount` variable becomes dead state.

The Telegram block should be restored after the filing loop, verbatim from the old code. The `firstError` variable it depended on is also gone and needs to be restored alongside it.

**Severity:** Important. This is a regression against the spec's explicit preservation requirement.

---

### Suggestions

**3. `classifyInsiderRole` call passes `isDirector` as a second argument that edgar-parser ignores**

File: `sec-monitor.js`, lines 523-526

```javascript
const insiderCategory = ep.classifyInsiderRole(
  (parsed.reportingOwner && parsed.reportingOwner.officerTitle) || '',
  !!(parsed.reportingOwner && parsed.reportingOwner.isDirector),
);
```

`edgar-parser.classifyInsiderRole` (line 471 in `edgar-parser.js`) accepts only one argument: `officerTitle`. The `isDirector` boolean passed as a second argument is silently ignored. The old local `classifyInsider` function accepted `(title, isBoardDirector)` and used the second argument to override ambiguous titles — `edgar-parser`'s version does not include this logic.

This means that an insider who is registered as a board director in the XML's `<isDirector>1</isDirector>` tag but whose `officerTitle` is empty or ambiguous will be classified as `'Other'` rather than `'Director'`. The old code would have returned `'Board'`.

This is not a bug introduced by the diff — it reflects a design difference between `classifyInsider` and `classifyInsiderRole`. But it is a behavioral change that should be acknowledged. If the edgar-parser function is the canonical implementation, the second argument should simply be removed from the call site to avoid confusion. If board director override is still desired, the edgar-parser function needs to be updated.

**Severity:** Suggestion. Board directors with empty title strings will be miscategorized in the output, but this affects downstream scoring only, not correctness of the dedup or alert pipeline.

---

**4. Dead code: `FD_BASE_URL`, `loadCikTickerMap`, `enrichFiling`, `isBuyTransaction` remain in the file**

File: `sec-monitor.js`, lines 20, 97, 242, 276

The constants `FD_BASE_URL` (line 20), the functions `isBuyTransaction` (line 95), `loadCikTickerMap` (line 242), and `enrichFiling` (line 276) are all still present in the file and still exported. They are unreachable from `runSecMonitor` in its current form.

The spec says "Remove: any function that calls `https://api.financialdatasets.ai/`". This was partially done (the `FINANCIAL_DATASETS_API_KEY` env var was removed from `REQUIRED_ENV`, and all calls were removed from `runSecMonitor`) but the function bodies themselves and their exports were not cleaned up.

Leaving them in the exports table means:
- Any caller that imports `enrichFiling` from this module gets a function that will fail at runtime with a missing `apiKey` (since `FINANCIAL_DATASETS_API_KEY` no longer exists in the env).
- The file header JSDoc comment still references the old Financial Datasets enrichment flow (it was updated in the `runSecMonitor` JSDoc but the top-of-file module description at line 1-9 still mentions "enriches via Financial Datasets").

This is not urgent since `runSecMonitor` is the only external entry point that n8n actually calls, but it is misleading and should be cleaned up.

**Severity:** Suggestion. Low risk for production, but creates confusion during future maintenance.

---

**5. Test coverage gap: primary-key-fails, secondary-key-new scenario not tested**

File: `tests/insiderbuying/sec-monitor.test.js`, section-05 describe block

The four dedup test cases cover:
- Semantic key already in existing → 0 results (test 4)
- Fresh keys → pass (tested implicitly by test 1 and 3)

There is no test for the scenario where the primary accession-number key is already in the Set but the secondary semantic key is not. This is the exact edge case where the `passesDedup` side-effect bug in Issue 1 surfaces. A test for this would be:

```
// Pre-load primaryKey = `${accessionNumber}_0` into NocoDB dedup keys
// Expected: 0 results (primary key blocks it)
// AND: verify that secondary key is NOT added to the set as a side effect
```

Without this test, the bug in Issue 1 cannot be detected by the test suite.

---

## Plan Alignment Assessment

The diff is aligned with the spec on all required behaviors:

| Spec requirement | Status |
|---|---|
| Remove `FINANCIAL_DATASETS_API_KEY` from `REQUIRED_ENV` | Done |
| edgar-parser injection pattern | Done |
| Fetch XML → parse → amendment check → dedup all txs → filterScorable → cluster | Done, correct order |
| Amendment skip: INFO log, no failureCount increment | Done |
| Primary key `{accessionNumber}_{index}`, secondary key semantic | Done |
| Both keys fail → skip (not a failure) | Partially done — see Issue 1 |
| Monitor_State watermark updated after run | Done |
| Cluster detection preserved unchanged | Done |
| Telegram alerting preserved | Missing — see Issue 2 |
| Dead FD functions removed | Not done — see Issue 4 |

The 76/76 test pass count is verified. All five existing cluster detection test groups remain intact with no modifications.

---

## Required Actions Before Production

1. Fix `passesDedup` call site to short-circuit properly — do not call `passesDedup` for the secondary key if the primary already fails (Issue 1).
2. Restore the Telegram `failureCount > 5` alert block after the filing loop (Issue 2).
3. (Optional cleanup) Remove `FD_BASE_URL`, `loadCikTickerMap`, `enrichFiling`, `isBuyTransaction` from the file and from `module.exports`, and update the module-level JSDoc comment (Issue 4).
