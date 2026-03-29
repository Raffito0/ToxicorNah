# Code Review — section-01: newsletter-data-layer

## Overall Assessment

Implementation is well-structured. All 10 tests pass. Dependency injection pattern is correct and consistent. Three behavioral bugs found (one critical, two medium), one design concern to discuss.

---

## Issues

### [HIGH] B-1 — Sequential 250ms delay is not actually sequential — AUTO-FIX
`Promise.allSettled` + `map` with `if (i > 0) await sleepFn(250)` does NOT produce sequential 250ms gaps. All map callbacks start concurrently. Alert index 1, 2, 3, 4 all sleep 250ms and then hit Finnhub simultaneously at T+250ms. Fix: replace with a `for` loop with `await` per iteration + try/catch for graceful failure.

### [MEDIUM] B-2 — Alpha Vantage HTTP error status never checked — AUTO-FIX
`resp.status` is never checked. A 429/500 response parses as `[]` (non-CSV → `_parseCsv` returns []), which then gets upserted to `Financial_Cache`. For 24h all runs silently receive empty earnings. Fix: guard `if (resp.status !== 200) return []` without touching cache.

### [MEDIUM] B-3 — `JSON.parse(cached.data)` can crash on corrupt cache entry — AUTO-FIX
If `Financial_Cache` has malformed JSON in `data`, `JSON.parse` throws synchronously, propagating up and crashing the entire `gatherWeeklyContent` call. Fix: wrap in try/catch, fallthrough to Alpha Vantage on parse failure.

### [MEDIUM] B-4 — `_parseCsv` breaks on RFC-4180 quoted fields — DISCUSS
Company names with commas (e.g., `"Alphabet Inc, Class A"`) will corrupt the `reportDate` field for that row. Whether this fires depends on Alpha Vantage's actual response format. Low-cost fix: handle double-quoted fields in `_parseCsv`.

---

## Test Gaps (auto-fix with B-1/B-2)

- **T-1**: No test verifying `sleepFn` called n-1 times (sequential enforcement)
- **T-2**: No test for Alpha Vantage non-200 response → cache not written
- **T-3** (suggestion): No test for corrupt cache recovery
- **T-4** (suggestion): No test asserting `emptyAlertsPrefix` absent when alerts present

---

## Plan Alignment

| Requirement | Status |
|---|---|
| Insider_Alerts query (score>=7, 7-day window) | PASS |
| Articles query (7-day window) | PASS |
| Prev-week alerts query (7–14 days) | PASS |
| Promise.allSettled graceful failure | PASS (structure correct) |
| 250ms sequential delay | FAIL — concurrent, not sequential (B-1) |
| Cache-first 24h TTL | PASS |
| Alpha Vantage CSV fallback | PASS (no status check — B-2) |
| NocoDB upsert after fetch | PASS |
| emptyAlertsPrefix on empty alerts | PASS |
| 10/10 tests pass | PASS |
