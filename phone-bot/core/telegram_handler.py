"""
Telegram command handler for remote intervention.

Runs python-telegram-bot v22+ polling in a daemon thread with its own asyncio loop.
Bridges Telegram commands with InterventionGate to approve/skip/takeover bot sessions.
"""

import asyncio
import logging
import os
import threading
from typing import Optional

log = logging.getLogger(__name__)

# Maps Telegram supergroup chat_id -> phone_id
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
    """

    def __init__(self, token: str, gate):
        """
        Args:
            token: Telegram bot token (PHONEBOT_TELEGRAM_TOKEN)
            gate: InterventionGate instance
        """
        self._token = token
        self._gate = gate
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._application = None
        self._thread: Optional[threading.Thread] = None
        self._started = threading.Event()
        # Takeover flags per phone
        self._takeover: dict[int, bool] = {}

    def start(self) -> None:
        """Start polling in a daemon thread. Returns immediately."""
        if self._thread and self._thread.is_alive():
            log.warning("Telegram handler already running")
            return
        self._thread = threading.Thread(target=self._run_thread, daemon=True, name="telegram-handler")
        self._thread.start()
        self._started.wait(timeout=10)
        log.info("Telegram command handler started")

    def stop(self) -> None:
        """Signal the handler to stop polling."""
        if self._application and self._loop and self._loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                self._application.stop(), self._loop
            )
            try:
                future.result(timeout=5)
            except Exception as e:
                log.warning("Error stopping Telegram handler: %s", e)
        if self._thread:
            self._thread.join(timeout=5)
        log.info("Telegram command handler stopped")

    def is_takeover(self, phone_id: int) -> bool:
        """Check if a phone is in takeover mode."""
        return self._takeover.get(phone_id, False)

    def send_approval_notification(
        self,
        phone_id: int,
        account_name: str,
        reason: str,
        tunnel_url: Optional[str] = None,
    ) -> Optional[int]:
        """
        Send Telegram notification with Approve/Skip/Take Over buttons.
        Called from worker thread (sync). Returns message_id or None.
        """
        if self._loop is None or self._application is None:
            log.warning("Telegram handler not running, cannot send notification")
            return None
        future = asyncio.run_coroutine_threadsafe(
            self._send_notification_async(phone_id, account_name, reason, tunnel_url),
            self._loop,
        )
        try:
            return future.result(timeout=10)
        except Exception as e:
            log.error("Failed to send Telegram notification: %s", e)
            return None

    # --- Internal: thread entry ---

    def _run_thread(self) -> None:
        """Thread entry point. Creates event loop and runs PTB polling."""
        from telegram.ext import Application, CommandHandler, CallbackQueryHandler

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop

        self._application = (
            Application.builder()
            .token(self._token)
            .build()
        )
        self._application.add_handler(CommandHandler("done", self._done_command))
        self._application.add_handler(CommandHandler("skip", self._skip_command))
        self._application.add_handler(CommandHandler("takeover", self._takeover_command))
        self._application.add_handler(CommandHandler("resume", self._resume_command))
        self._application.add_handler(CommandHandler("status", self._status_command))
        self._application.add_handler(CallbackQueryHandler(self._callback_query))
        self._started.set()
        self._application.run_polling(stop_signals=None)

    # --- Internal: async handlers ---

    async def _done_command(self, update, context) -> None:
        """Handle /done -- approve the pending post."""
        phone_id = self._get_phone_id(update)
        if phone_id is None:
            return
        self._gate.resolve(phone_id, "approve")
        await update.message.reply_text("Approved -- posting now.")

    async def _skip_command(self, update, context) -> None:
        """Handle /skip -- skip the pending post."""
        phone_id = self._get_phone_id(update)
        if phone_id is None:
            return
        self._gate.resolve(phone_id, "skip")
        await update.message.reply_text("Skipped -- post will not be published.")

    async def _takeover_command(self, update, context) -> None:
        """Handle /takeover -- abort session, resolve as skip."""
        phone_id = self._get_phone_id(update)
        if phone_id is None:
            return
        self._takeover[phone_id] = True
        self._gate.resolve(phone_id, "skip")
        await update.message.reply_text(
            "Manual control active. Send /resume when done.\n"
            "Start a new session from the dashboard."
        )

    async def _resume_command(self, update, context) -> None:
        """Handle /resume -- clear takeover flag."""
        phone_id = self._get_phone_id(update)
        if phone_id is None:
            return
        self._takeover[phone_id] = False
        await update.message.reply_text(
            "Takeover ended. Start a new session from the dashboard when ready."
        )

    async def _status_command(self, update, context) -> None:
        """Handle /status -- show all phones status."""
        lines = []
        all_pending = self._gate.get_all_pending()
        for pid in sorted(_PHONE_TO_CHAT.keys()):
            if self._takeover.get(pid, False):
                lines.append(f"Phone {pid}: TAKEOVER (manual control)")
            elif pid in all_pending:
                entry = all_pending[pid]
                lines.append(f"Phone {pid}: PAUSED -- {entry.get('reason', 'awaiting approval')}")
            else:
                lines.append(f"Phone {pid}: running")
        text = "\n".join(lines) if lines else "No phones configured."
        await update.message.reply_text(text)

    async def _callback_query(self, update, context) -> None:
        """Handle inline keyboard button presses. Data format: '<action>:<phone_id>'"""
        query = update.callback_query
        if not query or not query.data:
            return
        parts = query.data.split(":", 1)
        if len(parts) != 2:
            return
        action, phone_id_str = parts
        try:
            phone_id = int(phone_id_str)
        except ValueError:
            return

        if action == "approve":
            self._gate.resolve(phone_id, "approve")
            await query.answer("Approved")
            await query.edit_message_text(f"Phone {phone_id}: APPROVED -- posting now.")
        elif action == "skip":
            self._gate.resolve(phone_id, "skip")
            await query.answer("Skipped")
            await query.edit_message_text(f"Phone {phone_id}: SKIPPED.")
        elif action == "takeover":
            self._takeover[phone_id] = True
            self._gate.resolve(phone_id, "skip")
            await query.answer("Takeover active")
            await query.edit_message_text(
                f"Phone {phone_id}: TAKEOVER active. Send /resume when done."
            )
        else:
            await query.answer("Unknown action")

    async def _send_notification_async(self, phone_id, account_name, reason, tunnel_url):
        """Build and send approval notification message."""
        from telegram import InlineKeyboardMarkup, InlineKeyboardButton

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

    def _get_phone_id(self, update) -> Optional[int]:
        """Resolve chat_id to phone_id. Returns None for unknown chats."""
        if not update.effective_chat:
            return None
        chat_id = str(update.effective_chat.id)
        return CHAT_TO_PHONE.get(chat_id)


# --- Module-level singleton ---
_handler: Optional[TelegramCommandHandler] = None


def get_telegram_handler() -> Optional[TelegramCommandHandler]:
    """Return the module-level handler instance (may be None if not started)."""
    return _handler


def start_telegram_handler(gate) -> Optional[TelegramCommandHandler]:
    """Create and start the Telegram handler if token is available."""
    global _handler
    token = os.environ.get("PHONEBOT_TELEGRAM_TOKEN")
    if not token:
        log.warning("PHONEBOT_TELEGRAM_TOKEN not set -- Telegram handler disabled")
        return None
    _handler = TelegramCommandHandler(token=token, gate=gate)
    _handler.start()
    return _handler
