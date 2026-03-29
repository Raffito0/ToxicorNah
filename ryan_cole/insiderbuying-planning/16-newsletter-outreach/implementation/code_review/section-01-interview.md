# Code Review Interview — section-01: newsletter-data-layer

## Summary

Reviewed 4 bugs from the code review. All 4 applied. 2 new tests added. 12/12 tests pass.

---

## B-1 — Sequential delay (HIGH) — AUTO-FIX applied

**Finding**: `Promise.allSettled` + `map` with `if (i > 0) await sleepFn(250)` is NOT sequential. All
map callbacks start concurrently; all non-first alerts sleep 250ms and hit Finnhub simultaneously at
T+250ms.

**Fix applied**: Replaced with `for` loop with `await` per iteration + try/catch per alert for graceful
failure. Each alert fires after the previous one completes, enforcing true 250ms sequential gaps.

**Test added (T-1)**: Verifies `sleepFn` is called exactly `n-1` times (2 times for 3 alerts), confirming
sequential execution.

---

## B-2 — Alpha Vantage HTTP status unchecked (MEDIUM) — AUTO-FIX applied

**Finding**: `resp.status` was never checked. A 429 or 500 response body parses as `[]` via `_parseCsv`
(non-CSV → empty array), which then gets upserted to `Financial_Cache`. For 24h all runs silently receive
empty earnings.

**Fix applied**: Added `if (resp.status !== 200) { console.warn(...); return []; }` immediately after
`fetchFn(avUrl)`, before calling `resp.text()`. Cache is NOT written on non-200.

**Test added (T-2)**: Mocks a 429 response and asserts `result === []` AND `db.create`/`db.update` were
never called.

---

## B-3 — `JSON.parse` crash on corrupt cache (MEDIUM) — AUTO-FIX applied

**Finding**: `return JSON.parse(cached.data)` is unwrapped. If `Financial_Cache` contains malformed JSON
in the `data` field, it throws synchronously and crashes the entire `gatherWeeklyContent` call stack.

**Fix applied**: Wrapped in try/catch — `try { return JSON.parse(cached.data); } catch (e) { /* fall
through to fetch */ }`. On parse failure, execution falls through to the Alpha Vantage fetch path.

---

## B-4 — `_parseCsv` breaks on RFC-4180 quoted fields (MEDIUM) — USER DECISION: Option A (fix it)

**Finding**: `_parseCsv` splits every line on `,` unconditionally. Company names with embedded commas
(e.g. `"Alphabet Inc, Class A"`) corrupt the `reportDate` field for that row: the comma inside the
quoted name is treated as a field separator, shifting all subsequent fields one position right.

**User decision**: Option A — add quoted-field handling to `_parseCsv`.

**Fix applied**: Replaced naive `line.split(',')` with a `splitCsvLine()` function that iterates
character-by-character, tracking `inQuotes` state. Escaped double-quotes (`""`) inside quoted fields
are handled. Quoted field content is unquoted before trimming.

---

## Final state

| Bug | Severity | Action | Result |
|-----|----------|--------|--------|
| B-1 sequential delay | HIGH | Auto-fix + T-1 test | Fixed |
| B-2 AV status check | MEDIUM | Auto-fix + T-2 test | Fixed |
| B-3 JSON.parse crash | MEDIUM | Auto-fix | Fixed |
| B-4 RFC-4180 CSV | MEDIUM | Option A (fix) | Fixed |

Tests: 12/12 pass.
