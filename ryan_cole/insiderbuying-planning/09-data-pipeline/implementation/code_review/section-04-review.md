# Code Review — Section 04: Finnhub Integration

**File:** `ryan_cole/insiderbuying-site/n8n/code/insiderbuying/dexter-research.js`
**Test file:** `ryan_cole/insiderbuying-site/n8n/tests/dexter-research.test.js`
**Reviewer:** Claude Code (Sonnet 4.6) — 2026-03-29

---

## What Was Done Well

The migration from Financial Datasets API to Finnhub is clean and well-structured. The TokenBucket implementation is correct: immediate resolution for available tokens, queue-based waiting, `unref()` to avoid keeping the Node.js process alive, and proper draining of the wait queue on refill. The `cacheWrites` Promise array pattern with `Promise.allSettled` before return is the right approach for n8n — it prevents cache writes from being abandoned when the Code node exits. The `fetchFn` injection is consistent across all five fetchers. Test coverage is thorough: 56 passing tests cover cache hits/misses, expiry, create-vs-update logic, per-fetcher behavior, and integration paths.

---

## Issues

### Critical

None.

### Important

**1. API key embedded in URL, not in header (all five fetchers)**

All Finnhub fetchers append `&token=${apiKey}` directly to the query string (e.g. line 183: `/api/v1/quote?symbol=...&token=${apiKey}`). Finnhub supports both, but query-string tokens appear verbatim in server access logs, VPS request logs, and any proxy. The standard practice is to pass the key as `X-Finnhub-Token` header instead. With `_httpsRequest`'s `headers` spread, this is a one-line change per fetcher and eliminates the log-exposure risk.

**2. NocoDB filter injection via ticker (readCache / writeCache)**

The `where` clause is built by string interpolation: `(ticker,eq,${ticker})~and(data_type,eq,${dataType})`. The ticker is validated upstream by `validateTicker` (1-5 uppercase letters plus optional dot), so in practice this is safe. However, nothing inside `readCache` or `writeCache` re-validates the ticker before interpolating it. If a caller passes an untrusted value (e.g., from raw webhook input) that bypasses `validateTicker`, the NocoDB filter string becomes attacker-controlled. A guard at the top of `readCache` (`if (!/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(ticker)) return null`) costs nothing and closes this path permanently.

**3. `data_completeness` assertion removed in the success test**

The updated `dexterResearch` success test (line 632-635) drops the assertion `assert.ok(result.data_completeness >= 0.5)` that existed in the old test. The `_computeFinnhubCompleteness` function is tested separately, but the integration path through `dexterResearch` no longer verifies that the completeness check works end-to-end. A malformed `competitorsData` or a silent `safeVal` swallow could return `data_completeness: 0` without the abort branch firing, and no test would catch it. The removed assertion should be restored.

### Suggestions

**4. `getQuote` throws on non-200; other fetchers return null**

`getQuote` throws `new Error('Finnhub quote HTTP ${res.statusCode}')` on non-200, while `getProfile`, `getBasicFinancials`, and `getInsiderTransactions` return `null`. Since all four are called inside `Promise.allSettled`, the behavioral difference is invisible at the call site — both rejected promises and null values collapse to `null` via `safeVal`. But it creates inconsistency: future callers who await `getQuote` directly without `allSettled` will get an exception while expecting a null-on-failure contract. Aligning all fetchers to return `null` on non-200 (and reserving throws for truly exceptional errors like network failure) would make the API surface predictable.

**5. Inline IIFE for the candle fetcher in `fetchFinancialData`**

The stock candle logic is written as an inline async IIFE inside the `Promise.allSettled` array (lines 362-377) rather than a named function like the other four fetchers. This is inconsistent, harder to test in isolation, and the function is not exported. If candle fetch logic ever needs to be mocked or retested independently, it cannot be imported. Extracting it to a named `getStockCandles` function matching the pattern of the other fetchers is the straightforward fix.

---

## Overall Assessment

The implementation is solid. The architectural choices (TokenBucket, cacheWrites array, `Promise.allSettled`, `fetchFn` injection, backward-compatible dual-shape support in `buildPreAnalysisPrompt`) are all correct for the n8n Code node constraint. The two important issues — API key in query string and the removed completeness assertion — are low-effort to fix and should be addressed before this goes to production. The filter injection risk is theoretical given upstream validation but worth closing. The IIFE inconsistency is cosmetic but worth normalizing for maintainability.
