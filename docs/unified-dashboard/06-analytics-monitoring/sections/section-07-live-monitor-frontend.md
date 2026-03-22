# Section 07: Live Monitor Frontend

## Overview
Real-time live session monitor card at top of analytics page. 3 Chart.js doughnut gauges (boredom/fatigue/energy), scrolling event feed with smart scroll, phase bar, mood pills. 5s polling with visibilitychange pause.

## Dependencies
- Section 06 (live-state endpoint). No blocks.

## Files
| File | Action |
|------|--------|
| `app/static/js/live-monitor.js` | NEW: JsonPoller + LiveMonitor classes |
| `app/static/css/live-monitor.css` | NEW: monitor card styles |
| `app/templates/analysis.html` | Add monitor container + script/css includes |

## live-monitor.js

### JsonPoller class
- `constructor(url, intervalMs, onData, onError)` — setInterval-based polling
- `start()`, `stop()` — manage interval
- `visibilitychange` listener: stop when hidden, immediate fetch + start when visible
- `AbortController` for in-flight request cleanup

### LiveMonitor class
- `checkForActiveSession()` — fetch /get_user_bots, try /api/bots/{id}/live-state for each, show if 200
- `handleStateUpdate(state)` — update gauges, events, phase bar, mood pills, elapsed
- `handleError(error)` — 404 → hide card, network error → show stale indicator
- `show()` / `hide()` — toggle card display

### Gauges (Chart.js doughnut)
3 canvases (120x120px each):
- Boredom: #F59E0B (orange)
- Fatigue: #EF4444 (red)
- Energy: #22C55E (green)
Config: cutout 78%, rotation -90, circumference 360, no tooltip. Center text plugin shows value + label.
Update: `chart.data.datasets[0].data = [val, 1-val]; chart.update('none');`

### Event Feed (smart scroll)
- `#liveEventFeed` div, max-height 200px, overflow-y auto
- `_renderEvents(events)` — check if `scrollHeight - scrollTop - clientHeight < 20` (isAtBottom). Append line. Only auto-scroll if isAtBottom.
- **Track by last event timestamp** (`_lastEventTs`), NOT by count — backend uses deque(maxlen=20) which evicts old events, so count-based tracking breaks once deque saturates. If last seen timestamp is evicted, full re-render.
- Colors: like=#22C55E, scroll=#6B7280, follow=#3B82F6, comment=#8B5CF6, popup=#F59E0B, search=#EAB308, error=#EF4444

### Phase Bar
Horizontal bar showing current phase name + elapsed time with phase color background. Single segment since backend provides only current phase.

### Mood Pills
Small rounded badges: "Energy x1.2", "Social x0.8". Only show multipliers that differ from 1.0 (±0.05 tolerance).

### Elapsed Timer
`MM:SS` or `HH:MM:SS` computed from `state.started_at` client-side (backend does not update `elapsed_seconds` mid-session). Local setInterval(1000) between polls for smooth ticking.

## live-monitor.css
- `.live-monitor-card` — full-width, #1e1e1e bg, 12px radius, 16px padding
- `.live-monitor-body` — flex row: left (phase+mood, flex:1), center (gauges), right (feed, flex:1)
- `.live-dot` — 8px green circle with pulse animation
- `.live-event-feed` — max-height 200px, custom thin scrollbar
- `.live-gauge-wrapper` — flex column, 120x120 canvas + label

## analysis.html Changes
- Add CSS link for live-monitor.css in head
- Add script for live-monitor.js before analysis.js
- Add `#liveMonitorCard` div at top of `#analyticsContent` (display:none by default)

## Code Review Fixes Applied
- Event tracking changed from count-based to timestamp-based (deque eviction bug)
- Elapsed timer computed from `started_at` instead of `elapsed_seconds` (not updated mid-session)
- Added behavioral phase colors (Arrival/Warmup/Peak/Fatigue/Exit)
- Fixed retry chain duplication (`_scheduleRetry` with tracked timeout ID)
- Added bot account name display in header (`#liveAccountName`)

## Tests (visual)
- 3 gauges render with values
- Event feed scrolls, colors by type, smart scroll works
- Phase bar shows current phase
- Card hidden when no session, appears when session starts
- Polling pauses on tab hidden, resumes on visible
