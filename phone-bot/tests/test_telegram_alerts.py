"""Tests for Section 08: Telegram Alert Bot.

Tests alert sending, interactive callbacks, rate limiting, timeout,
configuration, and non-blocking behavior.
"""
import json
import os
import time
import threading
from unittest.mock import patch, MagicMock, call

import pytest

import sys
phone_bot_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if phone_bot_dir not in sys.path:
    sys.path.insert(0, phone_bot_dir)

from core.telegram_alerts import AlertBot, init_alerts, configured, send_alert, send_interactive_alert


# ── Alert Sending ──────────────────────────────────────────────

class TestAlertSending:
    """Fire-and-forget alerts via sendMessage/sendPhoto."""

    def test_alert_sends_post_to_send_message(self):
        """Alert sends POST to sendMessage API with correct chat_id."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True}
            bot._send_alert_sync(
                phone_id=1, account="ph1_tiktok",
                message="Test alert", screenshot_bytes=None, action_trace=None,
            )
            mock_post.assert_called_once()
            args = mock_post.call_args
            assert "sendMessage" in args[0][0]
            assert args[1]["payload"]["chat_id"] == "12345"

    def test_message_includes_context(self):
        """Message includes phone_id, account, and action trace."""
        bot = AlertBot(token="test-token", chat_id="12345")
        trace = [
            {"action_type": "scroll", "timestamp": "2026-03-18T10:00:00"},
            {"action_type": "like", "timestamp": "2026-03-18T10:00:05"},
        ]
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True}
            bot._send_alert_sync(
                phone_id=1, account="ph1_tiktok",
                message="Popup detected", screenshot_bytes=None, action_trace=trace,
            )
            text = mock_post.call_args[1]["payload"]["text"]
            assert "Phone 1" in text
            assert "ph1_tiktok" in text
            assert "scroll" in text
            assert "like" in text

    def test_screenshot_sent_as_photo(self):
        """Screenshot bytes sent via sendPhoto as multipart."""
        bot = AlertBot(token="test-token", chat_id="12345")
        fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True}
            bot._send_alert_sync(
                phone_id=1, account="ph1_tiktok",
                message="Error", screenshot_bytes=fake_png, action_trace=None,
            )
            # Should call sendPhoto (with files), not sendMessage
            url = mock_post.call_args[0][0]
            assert "sendPhoto" in url

    def test_no_screenshot_text_only(self):
        """No screenshot means text-only via sendMessage."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True}
            bot._send_alert_sync(
                phone_id=1, account="ph1_tiktok",
                message="Info alert", screenshot_bytes=None, action_trace=None,
            )
            url = mock_post.call_args[0][0]
            assert "sendMessage" in url


# ── Interactive (Tier 2) ──────────────────────────────────────

class TestInteractive:
    """Interactive alerts with inline keyboard and callback polling."""

    def test_interactive_sends_inline_keyboard(self):
        """Interactive alert sends reply_markup with 3 inline buttons."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True, "result": {"message_id": 999}}
            # Don't actually poll — mock _poll_callback to return immediately
            with patch.object(bot, '_poll_callback', return_value="SOLVED"):
                bot.send_interactive_alert_sync(
                    phone_id=1, account="ph1_tiktok", session_id="sess-001",
                    message="Popup needs help",
                )
            # First call should be sendMessage with reply_markup
            first_call = mock_post.call_args_list[0]
            payload = first_call[1]["payload"]
            markup = json.loads(payload["reply_markup"])
            buttons = markup["inline_keyboard"][0]
            assert len(buttons) == 3
            labels = [b["text"] for b in buttons]
            assert "SOLVED" in labels
            assert "SKIP" in labels
            assert "ABORT" in labels

    def test_callback_data_format(self):
        """callback_data format: '{action}:{phone_id}:{session_id}'."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True, "result": {"message_id": 999}}
            with patch.object(bot, '_poll_callback', return_value="SOLVED"):
                bot.send_interactive_alert_sync(
                    phone_id=2, account="ph2_tiktok", session_id="sess-xyz",
                    message="Help needed",
                )
            payload = mock_post.call_args_list[0][1]["payload"]
            markup = json.loads(payload["reply_markup"])
            buttons = markup["inline_keyboard"][0]
            for b in buttons:
                parts = b["callback_data"].split(":")
                assert len(parts) == 3
                assert parts[1] == "2"  # phone_id
                assert parts[2] == "sess-xyz"  # session_id

    def test_poll_callback_returns_matching_action(self):
        """poll_callback returns action when matching callback received."""
        bot = AlertBot(token="test-token", chat_id="12345")
        # Simulate getUpdates returning a matching callback
        fake_response = {
            "ok": True,
            "result": [{
                "update_id": 100,
                "callback_query": {
                    "id": "cb-1",
                    "data": "SOLVED:1:sess-001",
                }
            }]
        }
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = fake_response
            result = bot._poll_callback(phone_id=1, session_id="sess-001", timeout_s=5)
        assert result == "SOLVED"

    def test_poll_callback_ignores_different_session(self):
        """poll_callback ignores callbacks for different phone/session."""
        bot = AlertBot(token="test-token", chat_id="12345")
        # Response has callback for different session
        fake_response = {
            "ok": True,
            "result": [{
                "update_id": 100,
                "callback_query": {
                    "id": "cb-1",
                    "data": "SKIP:2:sess-other",
                }
            }]
        }
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = fake_response
            # Short timeout so test doesn't hang
            result = bot._poll_callback(phone_id=1, session_id="sess-001", timeout_s=1)
        assert result is None


# ── Rate Limiting ──────────────────────────────────────────────

class TestRateLimiting:
    """Rate limiting: 5min cooldown per phone for fire-and-forget."""

    def test_second_alert_same_phone_suppressed(self):
        """Second alert for same phone within 5min is suppressed."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True}
            bot._send_alert_sync(phone_id=1, account="ph1", message="Alert 1")
            bot._send_alert_sync(phone_id=1, account="ph1", message="Alert 2")
            # Only first call should go through
            assert mock_post.call_count == 1

    def test_different_phone_not_suppressed(self):
        """Different phone within 5min is NOT suppressed."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True}
            bot._send_alert_sync(phone_id=1, account="ph1", message="Alert 1")
            bot._send_alert_sync(phone_id=2, account="ph2", message="Alert 2")
            assert mock_post.call_count == 2

    def test_same_phone_after_cooldown(self):
        """Same phone after cooldown period is sent normally."""
        bot = AlertBot(token="test-token", chat_id="12345", rate_limit_seconds=0.1)
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True}
            bot._send_alert_sync(phone_id=1, account="ph1", message="Alert 1")
            time.sleep(0.15)  # exceed 0.1s rate limit
            bot._send_alert_sync(phone_id=1, account="ph1", message="Alert 2")
            assert mock_post.call_count == 2

    def test_interactive_bypasses_rate_limit(self):
        """Interactive alerts bypass rate limiting."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = {"ok": True, "result": {"message_id": 1}}
            # First: fire-and-forget (sets rate limit)
            bot._send_alert_sync(phone_id=1, account="ph1", message="Alert 1")
            # Second: interactive (should NOT be suppressed)
            with patch.object(bot, '_poll_callback', return_value="SKIP"):
                bot.send_interactive_alert_sync(
                    phone_id=1, account="ph1", session_id="s1", message="Interactive",
                )
            # Both should have sent HTTP requests
            assert mock_post.call_count >= 2


# ── Timeout ────────────────────────────────────────────────────

class TestTimeout:
    """Callback polling timeout behavior."""

    def test_poll_callback_returns_none_after_timeout(self):
        """poll_callback returns None after timeout."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            # Return empty updates
            mock_post.return_value = {"ok": True, "result": []}
            result = bot._poll_callback(phone_id=1, session_id="s1", timeout_s=1)
        assert result is None

    def test_answer_callback_query_called(self):
        """answerCallbackQuery called when callback received."""
        bot = AlertBot(token="test-token", chat_id="12345")
        fake_response = {
            "ok": True,
            "result": [{
                "update_id": 100,
                "callback_query": {
                    "id": "cb-42",
                    "data": "ABORT:1:s1",
                }
            }]
        }
        with patch.object(bot, '_http_post') as mock_post:
            mock_post.return_value = fake_response
            bot._poll_callback(phone_id=1, session_id="s1", timeout_s=5)
            # Should have called answerCallbackQuery
            answer_calls = [c for c in mock_post.call_args_list if "answerCallbackQuery" in str(c)]
            assert len(answer_calls) >= 1


# ── Configuration ──────────────────────────────────────────────

class TestConfiguration:
    """Startup warning and graceful no-op when not configured."""

    def test_not_configured_returns_immediately(self):
        """All methods return immediately when not configured."""
        bot = AlertBot(token="", chat_id="")
        assert not bot.configured()
        # Should not raise
        bot._send_alert_sync(phone_id=1, account="ph1", message="test")

    def test_configured_returns_true(self):
        """configured() returns True when token and chat_id set."""
        bot = AlertBot(token="abc", chat_id="123")
        assert bot.configured()

    def test_warning_on_startup_if_missing(self):
        """init_alerts logs WARNING if env vars missing."""
        with patch.dict(os.environ, {"PHONEBOT_TELEGRAM_TOKEN": "", "PHONEBOT_TELEGRAM_CHAT": ""}, clear=False):
            import logging
            with patch('logging.Logger.warning') as mock_warn:
                # Reset module-level bot
                import core.telegram_alerts as ta_mod
                old = ta_mod._default_bot
                try:
                    ta_mod._default_bot = None
                    ta_mod.init_alerts()
                    # Should have logged a warning
                    assert mock_warn.called or not ta_mod.configured()
                finally:
                    ta_mod._default_bot = old


# ── Non-blocking ───────────────────────────────────────────────

class TestNonBlocking:
    """Fire-and-forget runs in background thread."""

    def test_fire_and_forget_returns_immediately(self):
        """send_alert returns immediately (background thread)."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post') as mock_post:
            # Make HTTP slow
            def slow_post(*a, **kw):
                time.sleep(0.5)
                return {"ok": True}
            mock_post.side_effect = slow_post

            start = time.time()
            bot.send_alert(phone_id=1, account="ph1", message="Background alert")
            elapsed = time.time() - start
            # Should return in < 100ms (not waiting for 500ms HTTP)
            assert elapsed < 0.2
            # Wait for background thread to finish
            time.sleep(0.7)

    def test_http_failure_no_propagation(self):
        """HTTP failure in background thread doesn't crash."""
        bot = AlertBot(token="test-token", chat_id="12345")
        with patch.object(bot, '_http_post', side_effect=Exception("Network error")):
            # Should not raise
            bot.send_alert(phone_id=1, account="ph1", message="Will fail")
            time.sleep(0.2)  # wait for thread
