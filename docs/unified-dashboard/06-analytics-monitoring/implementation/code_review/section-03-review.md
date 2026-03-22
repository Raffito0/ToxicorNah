# Section 03 Code Review

## Issues Found & Resolution

### AUTO-FIXED
1. **Broken resize handler** — `window.dashboard` was undefined. Fixed: assign `new AnalyticsDashboard()` to `window.dashboard`.
2. **Dark theme not applied to existing charts** — `updateDailyActivityChart` and `updateFollowSuccessChart` had hardcoded light-theme colors. Fixed: spread `DARK_CHART_DEFAULTS` into both.
3. **Gemini bot_id filter missing** — `loadGeminiAnalytics()` only sent `days`. Fixed: added `bot_id` param.
4. **Empty state canvas issues** — `_emptyCanvas` didn't destroy existing Chart.js instances. Fixed: finds and destroys chart, uses `getBoundingClientRect()` for correct coordinates.

### LET GO
- **Per-phone grouping in Videos Posted** — Spec says "Grouped by phone" but current sum-by-date is cleaner for the dashboard view. Per-phone separation would need separate datasets per phone which clutters the chart.
- **Date adapter reliability** — The CDN bundle is self-contained and works.
- **CSS minor alignment** — Consistent enough for MVP.
