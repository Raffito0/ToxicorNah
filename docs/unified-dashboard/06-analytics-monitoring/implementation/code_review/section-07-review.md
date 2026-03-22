# Code Review: Section 07 — Live Monitor Frontend

## HIGH SEVERITY

1. **Event feed desyncs** — Backend deque(maxlen=20) evicts old events, breaking count-based `_lastEventCount` tracking. Once saturated at 20, no new events rendered. **FIXED**: Track by last event timestamp.

2. **Elapsed timer stuck at 0** — Backend only sets `elapsed_seconds` at start/completion, not mid-session. Local ticker resets to 0 every poll. **FIXED**: Compute from `started_at` client-side.

## MEDIUM SEVERITY

3. Sequential bot check — acceptable for 1-3 bots. **ACCEPTED**.
4. Phase colors incomplete — only worker lifecycle, no behavioral phases. **FIXED**.
5. No destroy/cleanup — retry chains can duplicate. **FIXED**: `_scheduleRetry` with tracked timeout.
6. No bot name in header — confusing for multi-bot. **FIXED**: `#liveAccountName` span.

## LOW SEVERITY (not fixing)

7. `_liveGaugeMeta` on chart instance — works, low risk
8. `_escapeHtml` DOM creation — negligible at 20 events
9. Chart.js global assumption — verified loaded via CDN in `<head>`

## PLAN COMPLIANCE

| Requirement | Status |
|---|---|
| JsonPoller with visibilitychange | PASS |
| AbortController cleanup | PASS |
| 3 Chart.js doughnut gauges | PASS |
| Smart scroll event feed | PASS (fixed) |
| Phase bar | PASS (fixed) |
| Mood pills with 0.05 tolerance | PASS |
| Elapsed timer with local tick | PASS (fixed) |
| Card hidden by default | PASS |
| CSS dark theme | PASS |
| Responsive layout | PASS |
