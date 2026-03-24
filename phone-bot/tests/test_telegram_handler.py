"""
Tests for core/telegram_handler.py

Uses mocks for python-telegram-bot — no real Telegram network calls.
All async handler tests use asyncio.run() for compatibility.
"""

import asyncio
import pytest
from unittest.mock import MagicMock, AsyncMock

from phone_bot.core.telegram_handler import (
    CHAT_TO_PHONE,
    _PHONE_TO_CHAT,
    TelegramCommandHandler,
)
from phone_bot.core.intervention import InterventionGate


def _make_handler() -> TelegramCommandHandler:
    """Create a handler with a fresh gate (no real token, no thread start)."""
    gate = InterventionGate()
    return TelegramCommandHandler(token="fake-token", gate=gate)


def _make_update(chat_id: str):
    """Create a mock Update with effective_chat.id set."""
    update = MagicMock()
    update.effective_chat.id = int(chat_id)
    update.message.reply_text = AsyncMock()
    update.callback_query = None
    return update


def _make_callback_update(data: str):
    """Create a mock Update with callback_query."""
    update = MagicMock()
    update.effective_chat.id = -1003628617587
    update.callback_query.data = data
    update.callback_query.answer = AsyncMock()
    update.callback_query.edit_message_text = AsyncMock()
    return update


# --- Mapping tests ---

def test_chat_to_phone_known():
    assert CHAT_TO_PHONE["-1003628617587"] == 1
    assert CHAT_TO_PHONE["-1003822830975"] == 2
    assert CHAT_TO_PHONE["-1003808705017"] == 3


def test_chat_to_phone_unknown():
    assert CHAT_TO_PHONE.get("-999") is None


def test_phone_to_chat_reverse():
    assert _PHONE_TO_CHAT[1] == "-1003628617587"
    assert _PHONE_TO_CHAT[2] == "-1003822830975"
    assert _PHONE_TO_CHAT[3] == "-1003808705017"


# --- Command handler tests (sync wrappers) ---

def test_done_resolves_approve():
    handler = _make_handler()
    handler._gate.request_pause(phone_id=1, reason="test")
    update = _make_update("-1003628617587")
    asyncio.run(handler._done_command(update, None))
    pending = handler._gate.get_pending(1)
    assert pending is not None
    assert pending["resolution"] == "approve"
    update.message.reply_text.assert_called_once()


def test_skip_resolves_skip():
    handler = _make_handler()
    handler._gate.request_pause(phone_id=2, reason="test")
    update = _make_update("-1003822830975")
    asyncio.run(handler._skip_command(update, None))
    pending = handler._gate.get_pending(2)
    assert pending["resolution"] == "skip"


def test_takeover_sets_flag_and_resolves():
    handler = _make_handler()
    handler._gate.request_pause(phone_id=3, reason="test")
    update = _make_update("-1003808705017")
    asyncio.run(handler._takeover_command(update, None))
    assert handler.is_takeover(3) is True
    pending = handler._gate.get_pending(3)
    assert pending["resolution"] == "skip"


def test_resume_clears_takeover():
    handler = _make_handler()
    handler._takeover[1] = True
    update = _make_update("-1003628617587")
    asyncio.run(handler._resume_command(update, None))
    assert handler.is_takeover(1) is False


def test_status_shows_all_phones():
    handler = _make_handler()
    handler._gate.request_pause(phone_id=2, reason="warmup post")
    update = _make_update("-1003628617587")
    asyncio.run(handler._status_command(update, None))
    call_args = update.message.reply_text.call_args[0][0]
    assert "Phone 1: running" in call_args
    assert "Phone 2: PAUSED" in call_args
    assert "Phone 3: running" in call_args


def test_callback_approve():
    handler = _make_handler()
    handler._gate.request_pause(phone_id=1, reason="test")
    update = _make_callback_update("approve:1")
    asyncio.run(handler._callback_query(update, None))
    update.callback_query.answer.assert_called_once_with("Approved")
    update.callback_query.edit_message_text.assert_called_once()
    pending = handler._gate.get_pending(1)
    assert pending["resolution"] == "approve"


def test_callback_skip():
    handler = _make_handler()
    handler._gate.request_pause(phone_id=2, reason="test")
    update = _make_callback_update("skip:2")
    asyncio.run(handler._callback_query(update, None))
    update.callback_query.answer.assert_called_once_with("Skipped")


def test_callback_takeover():
    handler = _make_handler()
    handler._gate.request_pause(phone_id=3, reason="test")
    update = _make_callback_update("takeover:3")
    asyncio.run(handler._callback_query(update, None))
    assert handler.is_takeover(3) is True


def test_ignores_unknown_chat():
    handler = _make_handler()
    update = _make_update("-999999")
    asyncio.run(handler._done_command(update, None))
    update.message.reply_text.assert_not_called()


def test_get_phone_id_known():
    handler = _make_handler()
    update = _make_update("-1003628617587")
    assert handler._get_phone_id(update) == 1


def test_get_phone_id_unknown():
    handler = _make_handler()
    update = _make_update("-999")
    assert handler._get_phone_id(update) is None
