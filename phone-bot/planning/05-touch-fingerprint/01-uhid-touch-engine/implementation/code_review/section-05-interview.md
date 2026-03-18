# Section 05 Code Review Interview

## Applied Fixes

### Fix 1: UHID start wrapped in try/except (was outside try block)
- **Issue**: If `start_touch_server()` raises an exception, the finally block wouldn't catch it
- **Fix**: Wrapped in try/except, sets `uhid_ok = False` on crash
- **Status**: APPLIED

### Fix 2: Added `uhid_started` flag to guard stop in finally
- **Issue**: uhid_stop monitor event would fire even when start failed
- **Fix**: Only call `stop_touch_server()` and log uhid_stop when `uhid_started = True`
- **Status**: APPLIED

### Fix 3: JAR check sends Telegram alert
- **Issue**: Missing JAR only logged to console, operator might not see
- **Fix**: Added `tg_alert()` call when JAR is missing
- **Status**: APPLIED

## Let Go (not fixing)

- end_session() scattered across 3 locations — correct but fragile. Not a bug, would be a larger refactor.
- Tests test flow patterns not actual executor — integration tests come in section-07.
- Private method name `_touch_health_check` — pre-existing API from section-03.
- Auto-push JAR — nice-to-have, not critical for initial integration.
- Health check recovery — `_touch_health_check()` internally calls `_handle_touch_failure()` which does reconnection. The warning in tiktok.py is informational only.
