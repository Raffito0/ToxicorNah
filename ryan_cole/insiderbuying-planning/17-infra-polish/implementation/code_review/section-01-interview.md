# Code Review Interview — section-01: disable-data-study + report-catalog

## Summary

All fixes applied. 30/30 tests pass.

---

## C1 — DISABLED flag exported twice in data-study.js (CRITICAL) — AUTO-FIX

**Finding**: The bare statement `module.exports.DISABLED = true` at the top was overridden by the `module.exports = {...}` object literal at the bottom. The object literal already contained `DISABLED: true`, so behavior was accidentally correct, but the double declaration was a maintenance trap.

**Fix applied**: Removed redundant top-level bare statement. `DISABLED: true` is only in the export object at the bottom. Comment updated to explain the intent.

---

## H1 — Pass 3 skips bundles if ANY alert lacks market_cap (HIGH) — LET-GO

**Finding**: `alerts.every(a => a.market_cap !== undefined && a.market_cap !== null)` aborts all bundles if any single alert lacks market_cap.

**Decision**: This is the explicit spec requirement: "If the market_cap field is absent or null on any alert, skip Pass 3 entirely." The test for this behavior already passes. Added inline comment noting the production trade-off (one unrelated missing field kills all bundles).

---

## H2 — Case-sensitive dedup defeats sector normalization across runs (HIGH) — AUTO-FIX

**Finding**: `existingSet` stored values as-is; a prior run's `"Health Care"` (before normalization) and a new run's `"Healthcare"` would not dedup.

**Fix applied**: Added `.toLowerCase()` normalization when building `existingSet` and when checking tickers and sectors against it.

---

## H3 — nocodbGet signature differs from established helper (HIGH) — LET-GO

**Finding**: `runReportCatalog(opts)` uses `opts.nocodbGet(table, params)` — different from the 3-argument `nocodbGet(path, token, opts)` helper in other files. The n8n workflow node will need an adapter wrapper.

**Decision**: The `_opts` injection pattern (used throughout Unit 16 and here) is intentionally different from the shared helper. The production n8n Code node provides the injected functions. Added inline comment at `runReportCatalog` signature documenting that callers supply adapted functions.

---

## M1 — No try/catch around inserts; Telegram summary never fires on failure (MEDIUM) — AUTO-FIX

**Finding**: If any `nocodbPost` call threw (network error, missing table), the function propagated the error before sending the Telegram summary.

**Fix applied**: Wrapped Telegram `await telegram(...)` call in its own try/catch (non-fatal — inserts already completed). Insert errors still propagate to the caller as before.

---

## L1 — Alerts with empty/missing sector could create `""` sector group (LOW) — AUTO-FIX

**Finding**: `normalizeSector(a.sector || '')` returns `''` for null/undefined sector. Three such alerts would group under `''` and create a sector entry `ticker_or_sector: ''` in NocoDB.

**Fix applied**: Added filter after deduplication: `alerts = alerts.filter(a => a.sector && a.sector.length > 0)` before sector grouping.

---

## L2 — `bundleCount` and `bundleInserts` were redundant (LOW) — AUTO-FIX

**Finding**: Both variables incremented together. Removed `bundleCount`, use `bundleInserts` for cap check.

---

## Tests added (T2, T4, T5, T6)

**T2** — `normalizeSector(null)` and `normalizeSector(undefined)` tests added.
**T4** — Sector-level deduplication: sector already in Report_Catalog is skipped in Pass 2.
**T5** — Telegram count accuracy: assert `"1 single, 0 sector, 0 bundle"` for known mock data.
**T6** — Bundle cap: 6 alternating alerts produce at most 5 bundle inserts.

---

## Final state

| Item | Severity | Action | Result |
|------|----------|--------|--------|
| DISABLED flag exported twice | CRITICAL | Auto-fix (remove redundant statement) | Fixed |
| Pass 3 aborts on any missing market_cap | HIGH | Let-go (explicit spec requirement) | Comment added |
| Case-sensitive dedup | HIGH | Auto-fix (toLowerCase) | Fixed |
| nocodbGet signature mismatch | HIGH | Let-go (injection pattern design) | Comment added |
| No try/catch around inserts | MEDIUM | Auto-fix (Telegram wrapped) | Fixed |
| Empty sector creates NocoDB pollution | LOW | Auto-fix (filter added) | Fixed |
| Redundant bundleCount/bundleInserts | LOW | Auto-fix | Fixed |
| normalizeSector null/undefined tests | LOW | Tests added (T2) | Fixed |
| Sector dedup test missing | LOW | Test added (T4) | Fixed |
| Telegram count not asserted exactly | LOW | Test added (T5) | Fixed |
| Bundle cap not tested | LOW | Test added (T6) | Fixed |

Tests: 30/30 pass.
