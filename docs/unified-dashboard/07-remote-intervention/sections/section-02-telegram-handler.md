# Section 02: Telegram Command Handler

## Overview

This section creates `app/telegram_handler.py`, a polling-based Telegram command handler using `python-telegram-bot` v22+ that runs in a daemon thread. It bridges Telegram user commands with the `InterventionGate` singleton (implemented in section-01) to approve, skip, or take over bot sessions.

**Dependency**: section-01-intervention-gate must be complete before implementing this section. The `InterventionGate` singleton from `phone-bot/core/intervention.py` is imported and used here.

**Blocks**: section-07-integration-wiring.

---

## Background: Telegram Bot Infrastructure

The project already uses @Ueien_bot with per-phone supergroup chats. The bot token is available as the `PHONEBOT_TELEGRAM_TOKEN` environment variable.

Known chat ID to phone ID mappings:
- Phone 1: chat_id `-1003628617587`
- Phone 2: chat_id `-1003822830975`
- Phone 3: chat_id `-1003808705017`

The handler maps incoming messages by `chat_id` to determine which phone the command applies to. Commands from unknown chat IDs are silently ignored.

---

## Tests First

**File**: `tests/test_telegram_handler.py`

Framework: pytest with mocks for the `python-telegram-bot` async API. No real Telegram network calls in tests — use `unittest.mock.AsyncMock` for bot methods and `unittest.mock.MagicMock` for the gate.

```python
"""
Tests for app/telegram_handler.py

Test stubs:
- Test: CHAT_TO_PHONE mapping resolves known chat IDs to phone IDs
- Test: CHAT_TO_PHONE returns None for unknown chat ID
- Test: /done command calls gate.resolve(phone_id, "approve")
- Test: /skip command calls gate.resolve(phone_id, "skip")
- Test: /takeover command sets should_stop and resolves as "skip"
- Test: /status command returns formatted status of all phones
- Test: send_approval_notification() sends message with inline keyboard
- Test: CallbackQueryHandler routes button press to correct resolve action
- Test: Handler ignores commands from non-phone chats
- Test: Telegram handler thread starts and stops cleanly
"""
```

Key testing considerations:

- `python-telegram-bot` v22+ uses `asyncio`; test async handlers with `pytest-asyncio` and `asyncio.get_event_loop().run_until_complete(...)` or `@pytest.mark.asyncio`.
- The `InterventionGate` should be injected via the handler constructor (or patched as a module-level singleton) so tests can use a mock gate rather than the real one.
- For the thread start/stop test, use `threading.Event` to confirm the thread is alive and `handler.stop()` terminates it cleanly within a short timeout (e.g. 2 seconds).
- For `send_approval_notification()`, assert that `bot.send_message()` was called with an `InlineKeyboardMarkup` containing three buttons: Approve, Skip, Take Over.
- For `CallbackQueryHandler`, construct a fake `CallbackQuery` object with `data="approve:2"` (or similar) and verify `gate.resolve(2, "approve")` is called and `query.answer()` + `query.edit_message_text()` are called.

---

## Implementation

### File to Create

**`app/telegram_handler.py`**

### Dependencies to Add

```
python-telegram-bot>=22.0
```

Add to the dashboard `requirements.txt` (or the project-level requirements, depending on project layout). Note: `python-telegram-bot[job-queue]` is NOT needed since this handler does not use the job queue.

### Core Design

The `TelegramCommandHandler` class:

- Holds a reference to the `InterventionGate` singleton.
- Holds a reference to the Flask `app` object (for pushing application context on DB writes).
- Runs `Application.run_polling(stop_signals=None)` inside a dedicated daemon thread. The `stop_signals=None` argument is **required** when `run_polling` is called from a non-main thread — PTB v22+ attempts to register signal handlers on the event loop, which raises `ValueError` when done from a non-main thread.
- The asyncio event loop for the thread is created with `asyncio.new_event_loop()` and set as the thread's event loop before any PTB objects are constructed.

### Class Skeleton

```python
# app/telegram_handler.py

import asyncio
import logging
import threading
from telegram import Bot, Update, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler, ContextTypes
)

logger = logging.getLogger(__name__)

# Maps Telegram supergroup chat_id (as string) -> phone_id (int)
CHAT_TO_PHONE: dict[str, int] = {
    "-1003628617587": 1,
    "-1003822830975": 2,
    "-1003808705017": 3,
}

# Reverse map: phone_id -> chat_id
_PHONE_TO_CHAT: dict[int, str] = {v: k for k, v in CHAT_TO_PHONE.items()}


class TelegramCommandHandler:
    """
    Polling-based Telegram handler for remote intervention commands.

    Runs in a daemon thread with its own asyncio event loop.
    Must be constructed after the Flask app is created.
    """

    def __init__(self, token: str, gate, flask_app=None):
        """
        Args:
            token: Telegram bot token (PHONEBOT_TELEGRAM_TOKEN)
            gate: InterventionGate singleton instance
            flask_app: Flask app instance for app context on DB writes
        """
        ...

    def start(self) -> None:
        """Start polling in a daemon thread. Returns immediately."""
        ...

    def stop(self) -> None:
        """Signal the handler to stop polling. Blocks briefly for clean shutdown."""
        ...

    def send_approval_notification(
        self,
        phone_id: int,
        account_name: str,
        reason: str,
        tunnel_url: str | None = None,
    ) -> int | None:
        """
        Send a Telegram notification with Approve/Skip/Take Over inline buttons
        to the supergroup for the given phone_id.

        Returns the sent message_id, or None on failure.
        This is called from the worker thread (not from async context),
        so it must use asyncio.run_coroutine_threadsafe() to submit to the loop.
        """
        ...

    # --- Internal async handlers ---

    async def _done_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle /done -- approve the pending post for this phone."""
        ...

    async def _skip_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle /skip -- skip the pending post for this phone."""
        ...

    async def _takeover_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """
        Handle /takeover -- abort current session, resolve gate as 'skip',
        set should_stop on the worker, and notify user that manual control is active.
        The aborted session is logged. User must start a new session from the dashboard.
        """
        ...

    async def _resume_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle /resume -- clear takeover flag. User starts new session from dashboard."""
        ...

    async def _status_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """
        Handle /status -- reply with a formatted summary of all phones.
        Format example:
            Phone 1: running (ph1_tiktok)
            Phone 2: paused -- awaiting approval
            Phone 3: stopped
        """
        ...

    async def _callback_query(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """
        Handle inline keyboard button presses.
        Callback data format: "<action>:<phone_id>"
        where action is one of: approve, skip, takeover
        """
        ...

    def _get_phone_id(self, update: Update) -> int | None:
        """
        Resolve chat_id from an Update to a phone_id.
        Returns None if chat_id is not in CHAT_TO_PHONE (commands silently ignored).
        """
        ...
```

### Thread Loop Setup

The thread entry function must:

1. Create a new event loop: `loop = asyncio.new_event_loop()`
2. Set it on the thread: `asyncio.set_event_loop(loop)`
3. Build the PTB `Application` object inside the loop (so all internal coroutines bind to the correct loop).
4. Register handlers before calling `run_polling`.
5. Call `application.run_polling(stop_signals=None)` — this blocks until `application.stop()` is called.

```python
def _run_thread(self) -> None:
    """Thread entry point. Creates event loop and runs PTB polling."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    self._loop = loop
    self._application = (
        Application.builder()
        .token(self._token)
        .build()
    )
    # Register handlers here
    self._application.add_handler(CommandHandler("done", self._done_command))
    self._application.add_handler(CommandHandler("skip", self._skip_command))
    self._application.add_handler(CommandHandler("takeover", self._takeover_command))
    self._application.add_handler(CommandHandler("resume", self._resume_command))
    self._application.add_handler(CommandHandler("status", self._status_command))
    self._application.add_handler(CallbackQueryHandler(self._callback_query))
    self._application.run_polling(stop_signals=None)
```

Store the event loop reference on `self` (`self._loop = loop`) so `send_approval_notification()` can submit coroutines from other threads using `asyncio.run_coroutine_threadsafe(coro, self._loop)`.

### Sending Notifications from Worker Thread

`send_approval_notification()` is called from the phone-bot worker thread (which is synchronous). It must bridge into the handler's asyncio loop:

```python
def send_approval_notification(self, phone_id, account_name, reason, tunnel_url=None):
    """Submit async notification to the handler's event loop from a sync thread."""
    if self._loop is None or self._application is None:
        logger.warning("Telegram handler not running, cannot send notification")
        return None
    future = asyncio.run_coroutine_threadsafe(
        self._send_notification_async(phone_id, account_name, reason, tunnel_url),
        self._loop
    )
    try:
        return future.result(timeout=10)
    except Exception as e:
        logger.error(f"Failed to send Telegram notification: {e}")
        return None
```

The `_send_notification_async` coroutine constructs the message text and the `InlineKeyboardMarkup`:

```python
async def _send_notification_async(self, phone_id, account_name, reason, tunnel_url):
    """Build and send the approval notification message."""
    chat_id = _PHONE_TO_CHAT.get(phone_id)
    if chat_id is None:
        return None

    text = f"Phone {phone_id} -- {account_name}\nReady to post ({reason})"
    if tunnel_url:
        text += f"\n\nWatch live: {tunnel_url}"

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("Approve", callback_data=f"approve:{phone_id}"),
            InlineKeyboardButton("Skip", callback_data=f"skip:{phone_id}"),
            InlineKeyboardButton("Take Over", callback_data=f"takeover:{phone_id}"),
        ]
    ])
    msg = await self._application.bot.send_message(
        chat_id=chat_id, text=text, reply_markup=keyboard
    )
    return msg.message_id
```

### /takeover Command Detail

The takeover flow must do all of:
1. Set a `should_stop` signal on the worker for this phone so the current session terminates after the current action completes. Access this via `_worker_status` from `tiktok_worker.py` (the existing thread-safe status dict).
2. Call `gate.resolve(phone_id, "skip")` to unblock any pending `check_and_wait()` call.
3. Reply: "Manual control active. Send /resume when done. Start a new session from the dashboard."

The aborted session is NOT resumed — phone-bot desynchronises internal state after a human takes over the phone, so the only safe option is to start fresh.

### /resume Command Detail

`/resume` clears the takeover flag on the worker. It does NOT restart the bot session. Reply: "Takeover ended. Start a new session from the dashboard when ready."

### Flask App Context for DB Writes

When a command handler needs to write to `InterventionLog` (e.g. recording a resolution), it must push the Flask app context:

```python
async def _done_command(self, update, context):
    phone_id = self._get_phone_id(update)
    if phone_id is None:
        return  # ignore unknown chats
    self._gate.resolve(phone_id, "approve")
    if self._flask_app:
        with self._flask_app.app_context():
            # resolve_intervention(intervention_id, "approve") call here
            pass
    await update.message.reply_text("Approved -- posting now.")
```

The DB write is optional at this stage (section-03 handles the full InterventionLog service). The `app_context()` push pattern is the load-bearing piece to implement correctly here.

### Startup

In `create_app()` (or via an explicit call after `create_app()` returns), construct and start the handler:

```python
# In app/__init__.py or app/extensions.py
import os
from app.telegram_handler import TelegramCommandHandler

_telegram_handler: TelegramCommandHandler | None = None

def get_telegram_handler() -> TelegramCommandHandler | None:
    return _telegram_handler

def start_telegram_handler(app) -> None:
    global _telegram_handler
    token = os.environ.get("PHONEBOT_TELEGRAM_TOKEN")
    if not token:
        app.logger.warning("PHONEBOT_TELEGRAM_TOKEN not set -- Telegram handler disabled")
        return
    from phone_bot.core.intervention import gate  # InterventionGate singleton
    _telegram_handler = TelegramCommandHandler(token=token, gate=gate, flask_app=app)
    _telegram_handler.start()
```

The `start_telegram_handler()` call belongs in `create_app()`, after all extensions are initialized.

### Graceful Shutdown

On Flask shutdown (process exit), call `handler.stop()`:

```python
def stop(self) -> None:
    if self._application:
        # run_polling blocks the thread -- schedule stop on the loop
        asyncio.run_coroutine_threadsafe(
            self._application.stop(), self._loop
        ).result(timeout=5)
    self._thread.join(timeout=5)
```

Register this with `atexit` or Flask's `teardown_appcontext` as appropriate.

---

## Integration with InterventionGate (Section 01)

The gate's `request_pause()` method must trigger the Telegram notification. The cleanest design is a registered callback:

```python
# In intervention.py (section 01 defines this interface)
gate.set_notification_callback(callback_fn)
# callback_fn(phone_id, account_name, reason) -> message_id
```

When `request_pause()` is called (from the worker thread), it invokes this callback synchronously. The callback is `handler.send_approval_notification()`, which bridges into the asyncio loop via `run_coroutine_threadsafe`. The returned `message_id` is stored in the pending state so the handler can edit the message later (e.g. to show "Approved" after resolution).

If section-01 does not implement the callback pattern, wire the notification call directly into the phone-bot pre-post check (`_check_pre_post_pause()` in `tiktok.py`) instead.

---

## File Summary

| File | Action |
|------|--------|
| `app/telegram_handler.py` | NEW -- full implementation |
| `tests/test_telegram_handler.py` | NEW -- unit tests |
| `app/__init__.py` | MODIFY -- call `start_telegram_handler(app)` in `create_app()` |
| `requirements.txt` (dashboard) | MODIFY -- add `python-telegram-bot>=22.0` |
