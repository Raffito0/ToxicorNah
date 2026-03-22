# Section 05: Content Stock Frontend

## Overview
Content Library Stock card on analytics page. Grid: Phone × Platform with pending count and days of stock. Color-coded: red (<7 days), yellow (<14), green (>=14). Refresh button with loading state.

## Dependencies
- Section 04 (content stock API). No blocks.

## Files to Modify
| File | Action |
|------|--------|
| `app/templates/analysis.html` | Add content stock card HTML after overview cards |
| `app/static/js/analysis.js` | Add loadContentStock() and refreshContentStock() methods |
| `app/static/css/analysis.css` | Add content-stock-card, stock-cell, color classes |

## HTML Structure
Card with chart-header (title + refresh button), grid container, stale warning div (hidden by default).

## Grid Layout
```
| Phone Name  | TikTok         | Instagram      |
|-------------|----------------|----------------|
| Phone 1     | 3 (1.5 days)   | 3 (1.5 days)   |
```
CSS grid: `200px 1fr 1fr`. Column headers: uppercase, small, muted.

## Color Coding
- `.stock-red` — background rgba(239,68,68,0.15), border-left 3px solid #ef4444 (< 7 days)
- `.stock-yellow` — rgba(245,158,11,0.15), #f59e0b (< 14 days)
- `.stock-green` — rgba(34,197,94,0.15), #22c55e (>= 14 days)

## JavaScript
- `loadContentStock()` — GET /api/content/stock, render grid, update timestamp, show/hide stale warning
- `refreshContentStock()` — disable button + fa-spin, POST /api/content/stock/refresh, re-render
- Called from `updateDashboard()`. Store `window.dashboard` reference for onclick.
- Days display: `toFixed(1)` format. Null days → show "N/A".

## Tests (visual)
- Grid renders per phone/platform
- Colors match thresholds
- Refresh button disables during API call
- Stale warning shown when cache_stale=true
- Empty state: "No content data"

## Implementation Notes
- Card placed between Phase+Follow-Back row and Gemini Usage row in analysis.html
- `loadContentStock()` called from `updateCharts()` alongside TikTok and Gemini analytics
- `_escapeHtml()` helper added to prevent XSS from Airtable phone names
- `refreshContentStock()` shows stale warning on error (not silent failure)
- Responsive: grid columns shrink at 1200px (140px) and 768px (100px) breakpoints
- `parseInt(pending) || 0` sanitizes pending count in innerHTML
