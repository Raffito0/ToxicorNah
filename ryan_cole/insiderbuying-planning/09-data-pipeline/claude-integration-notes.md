# Integration Notes: External LLM Review Feedback

## Reviews Received
- OpenAI o3
- Gemini gemini-3-pro-preview

Both reviews were high-quality and in strong agreement on the critical issues. Below is my decision on each point.

---

## INTEGRATING

### 1. EDGAR accession number ordering is NOT chronological [CRITICAL — both reviewers]

**Issue:** The plan stated "lexicographic comparison is valid because EDGAR accession numbers are formatted chronologically." This is false. The first 10 digits are the filer's CIK, not a timestamp. Filings from different companies sorted lexicographically would group by company, not by time. `lastAccessionNumber` as the Monitor_State watermark would break.

**Fix:** Replace `lastAccessionNumber` with `lastCheckTimestamp` (revert to the existing approach). `deduplicateFilings()` filters by `filedAt` timestamp rather than accession number string comparison.

The dedup *key* for individual alert records still uses `{accessionNumber}_{txIndex}` — this is fine. Only the watermark/ordering logic is fixed.

---

### 2. Form 4/A amendments create new accession numbers — dedup bypassed [CRITICAL — both reviewers]

**Issue:** A Form 4/A amendment gets a brand new accession number. The key `{accessionNumber}_{txIndex}` would not match the original filing, producing duplicate alerts for the same trades.

**Fix:** Two-part solution:
1. For `isAmendment === true` filings: skip or flag (do not create a new alert). Log at INFO level. This is the simplest correct behavior — amendments correct the record but the trade already exists.
2. The semantic dedup key `{ticker}_{ownerName}_{transactionDate}_{shares}` is preserved as a secondary dedup check alongside the accession-based key. If either key matches, skip the record.

---

### 3. Alpha Vantage CSV has quoted commas in company names [CRITICAL — Gemini]

**Issue:** Naive `line.split(',')` breaks when company names contain commas (e.g., "Apple, Inc."). Column values would shift.

**Fix:** Use a regex-based CSV split that respects double-quoted fields: `,(?=(?:(?:[^"]*"){2})*[^"]*$)`. Or, since ticker and date columns are at predictable positions from the boundaries (ticker = first, reportDate = third, estimate = fifth), map by column index with explicit bounds checking.

---

### 4. `filterScorable` should be a whitelist, not a blacklist [IMPORTANT — Gemini]

**Issue:** The blacklist `['G', 'F']` passes option exercises (M), awards (A), dispositions (D), and other non-voluntary transactions. These would create false-positive "insider buying" alerts.

**Fix:** Change `filterScorable` to a whitelist: only retain transactions with code `P` (purchase) or `S` (sale). All other codes — G, F, M, X, A, D, J, and any unknown code — are excluded from the scoring pipeline. Dedup keys are still stored for ALL transaction codes (see point 8 below).

---

### 5. Cache writes must be awaited before n8n Code node exits [IMPORTANT — Gemini]

**Issue:** Fire-and-forget cache writes to NocoDB will be killed mid-flight if the n8n Code node process terminates before the pending promises settle.

**Fix:** Collect all NocoDB write promises in an array (`const cacheWrites = []`) and `await Promise.allSettled(cacheWrites)` at the end of `fetchFinancialData()` before returning. Cache write failures are logged but do not abort the main flow.

---

### 6. EDGAR needs both 10 r/s AND 60 r/min rate limits [IMPORTANT — OpenAI]

**Issue:** 110ms delay = 9.09 r/s, but 50 filings × 2 requests = 100 requests in ~11 seconds = 100 r/min, which exceeds the 60 r/min limit.

**Fix:** Add a minute-level EDGAR rate limiter in addition to the per-request 110ms delay. Use a separate `TokenBucket({ capacity: 58, refillRate: 58, refillInterval: 60000 })` (leaving 2 tokens of headroom) for EDGAR requests. Both the EFTS call and each XML fetch acquire from this bucket.

---

### 7. 10b5-1 detection must handle both legacy and modern XML schema [IMPORTANT — Gemini]

**Issue:** The SEC updated the Form 4 XML schema in April 2023. Modern filings use `<rule10b51Transaction>` while legacy filings use `<rule10b5One>`. Both must be checked.

**Fix:** `calculate10b5Plan()` checks for BOTH elements, accepting `1` or `true` (case-insensitive) as affirmative.

---

### 8. Dedup keys must be stored for ALL transactions, including non-scorable [IMPORTANT — OpenAI]

**Issue:** If G and F codes are excluded from dedup, the same gift or withholding would be reprocessed on every run, burning EDGAR quota.

**Fix:** `sec-monitor.js` stores dedup keys for ALL transactions parsed from a filing (before filterScorable). Only alert creation is gated by filterScorable. Dedup uses the full transaction set.

---

### 9. Remove `finnhub.getEarningsCalendar` — contradictory with Alpha Vantage [IMPORTANT — Gemini]

**Issue:** Section 4 added `finnhub.getEarningsCalendar` and Section 5 added `alphaVantage.getEarningsCalendar`. These are redundant and the plan contradicts itself.

**Fix:** Remove `finnhub.getEarningsCalendar` entirely. Alpha Vantage's batch call is strictly superior for a free tier (one call covers all tickers vs. one call per ticker on Finnhub).

---

### 10. EFTS ticker-missing handling for funds/trusts [MEDIUM — both reviewers]

**Issue:** Foreign issuers, trusts, and funds may not have a ticker in `display_names`, causing the regex to return null.

**Fix:** When `display_names` regex fails to find a ticker, fall back to null. When `parseForm4Xml` runs on that filing's XML, extract `<issuerTradingSymbol>` directly. If still null, the filing is skipped (no ticker = cannot score).

---

### 11. Finnhub token bucket burst capacity [MEDIUM — Gemini]

**Issue:** `capacity: 60` allows all 60 tokens to burst at T=0, which may trigger Finnhub's concurrent-connection limit.

**Fix:** Lower capacity to `5` with `refillRate: 5` per 5 seconds (`refillInterval: 5000`). This gives a steady 60 calls/minute without bursting more than 5 at once.

---

### 12. Add XML entity decoding to `extractValue` [MEDIUM — Gemini]

**Issue:** SEC XML may contain HTML entities (`&amp;`, `&lt;`, `&#x20;`) in company/owner name fields. These would appear as raw escape sequences in the parsed output.

**Fix:** Add an entity decode step in `extractValue`: replace common entities after extraction (`&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`, `&apos;` → `'`, `&quot;` → `"`).

---

## NOT INTEGRATING

### NR1. Use xml2js or external XML library

Both reviewers suggested using xml2js. **Not integrating** — the spec explicitly requires CommonJS `require('https')` only with no external dependencies. The regex approach is sufficient when entity decoding is added (see point 12). The test fixtures are curated real-world samples that validate the approach.

### NR2. Token bucket shared via Redis across n8n executions

OpenAI suggested sharing the Finnhub token bucket via Redis because n8n may spawn concurrent executions. **Not integrating** — n8n Code nodes execute sequentially within a workflow run. Adding Redis would be significant operational overhead for a system that runs every 30 minutes. The current token bucket prevents intra-execution bursting, which is the actual problem.

### NR3. Add Snyk licence scan

Out of scope for this implementation plan.

### NR4. Make dedup key unforgeable for 4/A with SHA-1

OpenAI suggested `{accessionNumber}_{txIndex}_A{amendmentIndex}`. Not integrating — instead we skip 4/A filings entirely (see point 2), which is simpler and correct.

### NR5. Keep `lastCheckTimestamp` AND `lastAccessionNumber` in Monitor_State

OpenAI suggested two independent watermarks create confusion. **Not integrating in full** — we're reverting to `lastCheckTimestamp` only (point 1), which resolves the concern.

### NR6. Track Finnhub monthly quota in Monitor_State

The Finnhub free tier has a monthly API call limit. OpenAI suggested tracking this in Monitor_State. **Not integrating now** — this is an operational concern, not a code correctness issue. Can be added later if Finnhub rate limits are hit.
