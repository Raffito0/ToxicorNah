# Section 05: Executor Integration

## Overview

Wire the UHID touch server lifecycle into `executor.py` so it starts/stops with each bot session. Handle failures gracefully with fallback mode and Telegram alerts.

## Background

`executor.py` orchestrates bot sessions: it creates `ADBController` and `TikTokBot`/`InstagramBot` instances, runs the action loop, and handles errors. The touch server must be started after ADB init and stopped at session end.

The existing session flow:
1. `run_today()` → iterates daily sessions
2. `execute_session(session)` → handles one session
3. Creates `ADBController`, creates bot, runs `bot.browse_session()` or `bot.warmup_session()`
4. On `DeviceLostError`: marks phone as dead, continues to next

## What to Build

### 1. Touch Server Start (in `execute_session()`)

After `ADBController` is created and before the bot is instantiated:

```python
# After: adb = ADBController(serial, phone_config)
# Before: bot = TikTokBot(adb, human, ...)

uhid_ok = adb.start_touch_server()
if not uhid_ok:
    log.warning("UHID failed on %s — running in degraded mode (deviceId=-1)", phone_name)
    send_alert(f"UHID failed on {phone_name}", "uhid_start_failure", phone_id)
    # Session continues — fallback to input tap/swipe
else:
    log.info("UHID touch server started on %s", phone_name)

# Log monitor event
log_event(BotEvent(
    type="uhid_start",
    session_id=session_id,
    phone_id=phone_id,
    details={"success": uhid_ok}
))
```

### 2. Touch Server Stop (session end)

In the `finally` block of `execute_session()`:

```python
finally:
    try:
        adb.stop_touch_server()
        log_event(BotEvent(type="uhid_stop", session_id=session_id, phone_id=phone_id))
    except Exception as e:
        log.debug("Touch server stop failed (expected if device lost): %s", e)
```

### 3. DeviceLostError Handling

In the existing `DeviceLostError` handler, `stop_touch_server()` is called as part of cleanup. It may fail silently if the device is disconnected — this is expected and should not propagate.

### 4. Health Check Integration

The existing `_check_health()` in `tiktok.py` runs every 3-5 videos. Add UHID health check:

```python
# In TikTokBot._check_health() or browse_session() health check point:
if hasattr(self.adb, '_touch_health_check'):
    if not self.adb._touch_health_check():
        log.warning("UHID health check failed")
        # Reconnection is handled internally by _handle_touch_failure()
```

### 5. Pressure Params Flow

The executor doesn't directly handle pressure params — that's between `tiktok.py` and `human.py`. But the executor needs to ensure `HumanEngine` is available to the bot, which it already is.

**In `_dispatch_session()`**: The `TikTokBot` constructor already receives `human` (HumanEngine instance). The bot calls `self.human.get_tap_pressure()` before each tap. No executor changes needed for this flow.

### 6. JAR Deployment Check

At the start of `run_today()` (once per day, before any sessions):

```python
# Check if touchserver.jar exists on each phone
for phone in active_phones:
    jar_exists = adb.shell_check(f"ls /data/local/tmp/touchserver.jar")
    if not jar_exists:
        log.warning("touchserver.jar missing on %s — push it first", phone["name"])
        # Could auto-push: adb.push("touchserver/touchserver.jar", "/data/local/tmp/")
```

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `phone-bot/planner/executor.py` | MODIFY | Add start/stop touch server, health check, JAR check |

## Tests

### Unit tests (`tests/test_executor_uhid.py`)

```python
# Test: execute_session() calls adb.start_touch_server() before bot creation
# Test: execute_session() calls adb.stop_touch_server() in finally block
# Test: start_touch_server() failure logs WARNING (not ERROR)
# Test: start_touch_server() failure sends Telegram alert
# Test: start_touch_server() failure does NOT stop session
# Test: DeviceLostError handler calls stop_touch_server()
# Test: stop_touch_server() failure in finally block is silently caught
# Test: uhid_start event logged to monitor with success=True/False
# Test: uhid_stop event logged to monitor
# Test: health check calls _touch_health_check() when available
```

## Acceptance Criteria

- [ ] Touch server starts before first action in session
- [ ] Touch server stops in finally block (always runs)
- [ ] UHID failure = WARNING + Telegram alert, session continues
- [ ] DeviceLostError cleanup includes touch server stop
- [ ] Health check includes UHID ping
- [ ] Monitor events logged for UHID start/stop
- [ ] All unit tests pass
