# Section 08: Telegram Alert Bot

## Overview

New module `core/telegram_alerts.py` for push notifications on critical events. Two modes: fire-and-forget (informational) and interactive (inline keyboard SOLVED/SKIP/ABORT with polling for Tier 2 human intervention).

**Dependencies:** Section 07 (monitor provides action trace), Section 05 (popup handler triggers Tier 2).
**Files:** `core/telegram_alerts.py` (NEW), `config.py`, `tests/test_monitor.py` (extend)

---

## Tests First (extend tests/test_monitor.py)

```python
# --- Alert Sending ---
# Test: alert sends POST to sendMessage + sendPhoto APIs with correct chat_id
# Test: message includes phone_id, account, classification, last 5 actions from trace
# Test: screenshot sent as multipart photo
# Test: no screenshot -> text only

# --- Interactive (Tier 2) ---
# Test: interactive alert sends reply_markup with 3 inline buttons
# Test: callback_data format: "{action}:{phone_id}:{session_id}"
# Test: poll_callback returns SOLVED/SKIP/ABORT on matching callback
# Test: poll_callback ignores callbacks for different phone/session

# --- Rate Limiting ---
# Test: second alert for same phone within 5min suppressed
# Test: different phone within 5min NOT suppressed
# Test: same phone after 5min sent normally
# Test: interactive alerts bypass rate limiting

# --- Timeout ---
# Test: poll_callback returns None after 5 minutes
# Test: each poll waits ~10s
# Test: answerCallbackQuery called on callback

# --- Configuration ---
# Test: WARNING log on startup if env vars missing
# Test: all methods return immediately when not configured
# Test: configured() returns False/True correctly

# --- Non-blocking ---
# Test: fire-and-forget returns immediately (background thread)
# Test: HTTP failure in background thread doesn't propagate
```

---

## Implementation Details

### Config (config.py)

```python
TELEGRAM_ALERT_BOT_TOKEN = os.getenv("PHONEBOT_TELEGRAM_TOKEN", "")
TELEGRAM_ALERT_CHAT_ID = os.getenv("PHONEBOT_TELEGRAM_CHAT", "")
```

### Public API

```python
def init_alerts(): ...  # Call once at startup, WARNING if not configured
def configured() -> bool: ...
def send_alert(phone_id, account, message, screenshot_bytes=None, action_trace=None): ...  # Fire-and-forget
def send_interactive_alert(phone_id, account, session_id, message, ...) -> str | None: ...  # Blocks up to 5min
```

### AlertBot Class (internal)

- Rate limiting: `_last_alert_time` dict, 300s per phone. Interactive alerts bypass.
- Message format: phone label + context + last 5 actions + bot decision + result
- Inline keyboard: `[[SOLVED, SKIP, ABORT]]` with callback_data `"{action}:{phone_id}:{session_id}"`
- Callback polling: `getUpdates(offset, timeout=10)` every 10s for 5 minutes total. Match on phone_id + session_id.
- Fire-and-forget: daemon thread, catches all exceptions internally
- HTTP: `httpx` with 10s timeout. Base URL: `https://api.telegram.org/bot{token}/`

### Integration

- `executor.py`: `init_alerts()` at startup. `send_alert()` on DeviceLostError, timeout.
- Popup handler (section 05): `send_interactive_alert()` available for Tier 2 intervention.
- Monitor (section 07): `get_action_trace(session_id)` provides last events for message context.

### Actual Implementation

**Files created:** `core/telegram_alerts.py`, `tests/test_telegram_alerts.py`
**Files modified:** `config.py`, `planner/executor.py`, `tests/conftest.py`

**Deviations from plan:**
- Uses `urllib.request` instead of `httpx` (no external dependency needed)
- `_http_post` param renamed from `json` to `payload` (avoids shadowing `json` module)
- Rate limit timestamp set AFTER successful send (review fix — prevents suppression on HTTP failure)
- `init_alerts()` reads from config.py constants with env var fallback
- Message shows last 5 actions (not 10) for readability
- Token masked in error logs (review fix)

**Tests:** 19 tests covering alert sending, interactive keyboard, rate limiting, timeout, configuration, non-blocking. All pass (165/165 full suite).
