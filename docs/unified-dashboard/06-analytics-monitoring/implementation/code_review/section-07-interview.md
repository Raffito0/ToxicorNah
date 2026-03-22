# Section 07 Code Review Interview

## Auto-fixes (applied without user input)

### Fix 1: Event feed desync — track by last timestamp, not count
**Issue**: Backend uses deque(maxlen=20), evicts old events. Frontend's `_lastEventCount` breaks once deque saturates.
**Fix**: Track `_lastEventTs` (last seen timestamp). On each poll, find new events by comparing timestamps. Full re-render when events array shrinks (deque eviction).

### Fix 2: Elapsed timer — compute from `started_at` client-side
**Issue**: Backend only sets `elapsed_seconds` at start (0) and completion. The gauge poller does NOT update it mid-session, causing the local ticker to reset to 0 every 5s.
**Fix**: Compute elapsed from `state.started_at` on each poll update. The local 1s ticker increments between polls for smooth display.

### Fix 3: Phase colors — add behavioral phase colors
**Issue**: Only worker lifecycle phases (Starting/Running/Completed/Error) had colors. Session behavioral phases (Arrival/Warmup/Peak/Fatigue/Exit) had no mapping.
**Fix**: Add colors for all behavioral phases.

### Fix 4: Retry chain duplication
**Issue**: `_hide()` and `_checkForActiveSession()` both spawn setTimeout retries without tracking IDs. Multiple calls = multiple overlapping chains.
**Fix**: Track `_retryTimeout` and clear before spawning new one.

### Fix 5: Add bot name to header
**Issue**: Multi-bot users see "Live Session" without knowing which bot.
**Fix**: Show account name from state in the header.

## Let go (not fixing)
- Sequential bot check: acceptable for 1-3 bots
- Chart.js `_liveGaugeMeta` on chart instance: works fine, low risk
- `_escapeHtml` DOM creation: negligible at 20 events scale
