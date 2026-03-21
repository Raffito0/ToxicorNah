"""Tests for telegram_monitor.py — production monitoring via Telegram.

All network calls mocked — no real Telegram API calls needed.
"""
import json
import sys
import os
import types
from unittest.mock import patch, MagicMock

import pytest

# Ensure phone-bot modules are importable
phone_bot_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if phone_bot_dir not in sys.path:
    sys.path.insert(0, phone_bot_dir)

# Import the module under test
from core.telegram_monitor import (
    TelegramMonitor, DailySummary, _html_escape, init_monitor, get_monitor,
)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestHtmlEscape:

    def test_escapes_angle_brackets_and_ampersand(self):
        assert _html_escape("<b>&foo</b>") == "&lt;b&gt;&amp;foo&lt;/b&gt;"

    def test_does_not_escape_apostrophes_or_quotes(self):
        assert _html_escape("it's \"fine\"") == "it's \"fine\""

    def test_empty_string(self):
        assert _html_escape("") == ""


class TestTelegramMonitorSend:

    def test_send_constructs_correct_payload(self):
        monitor = TelegramMonitor("test-token", "12345")
        with patch("core.telegram_monitor.urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__ = MagicMock(return_value=MagicMock())
            mock_open.return_value.__exit__ = MagicMock(return_value=False)
            monitor.send("Hello <b>world</b>")

            call_args = mock_open.call_args
            req = call_args[0][0]
            payload = json.loads(req.data.decode("utf-8"))
            assert payload["parse_mode"] == "HTML"
            assert payload["chat_id"] == "12345"
            assert payload["text"] == "Hello <b>world</b>"

    def test_send_returns_false_when_unconfigured(self):
        monitor = TelegramMonitor("", "")
        result = monitor.send("test")
        assert result is False

    def test_noop_when_token_missing(self):
        monitor = TelegramMonitor("", "12345")
        assert monitor.configured() is False
        # All methods should return without error
        monitor.session_start(1, "ph1_tiktok", "normal", True, "tiktok")
        monitor.session_result(1, "ph1_tiktok", True)
        monitor.post_failure(1, "ph1_tiktok", 2, "draft", "video.mp4")
        monitor.stock_alert(1, 5)
        monitor.daily_summary(DailySummary(0, 0, 0, 0, 0, 0, 0, {}))


class TestTelegramMonitor429:

    def test_handles_429_rate_limit_with_retry(self):
        monitor = TelegramMonitor("test-token", "12345")

        # First call: 429, second call: success
        import urllib.error
        error_body = json.dumps({"parameters": {"retry_after": 1}}).encode("utf-8")
        mock_429 = urllib.error.HTTPError(
            "url", 429, "Too Many Requests", {}, None
        )
        mock_429.read = MagicMock(return_value=error_body)

        call_count = {"n": 0}
        def side_effect(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise mock_429
            # Success context manager
            cm = MagicMock()
            cm.__enter__ = MagicMock(return_value=MagicMock())
            cm.__exit__ = MagicMock(return_value=False)
            return cm

        with patch("core.telegram_monitor.urllib.request.urlopen", side_effect=side_effect):
            with patch("core.telegram_monitor.time.sleep") as mock_sleep:
                result = monitor.send("test")

        assert result is True
        assert call_count["n"] == 2
        mock_sleep.assert_called_once()
        sleep_val = mock_sleep.call_args[0][0]
        assert sleep_val >= 1


class TestSessionMessages:

    def test_session_start_contains_required_fields(self):
        monitor = TelegramMonitor("t", "c")
        with patch.object(monitor, "send") as mock_send:
            monitor.session_start(2, "ph2_tiktok", "normal", True, "tiktok")
            msg = mock_send.call_args[0][0]
            assert "Phone 2" in msg
            assert "TIKTOK" in msg
            assert "normal" in msg
            assert "scheduled" in msg

    def test_session_result_success(self):
        monitor = TelegramMonitor("t", "c")
        with patch.object(monitor, "send") as mock_send:
            monitor.session_result(2, "ph2_tiktok", True,
                                   post_outcome="posted", video_name="test.mp4",
                                   duration_minutes=18)
            msg = mock_send.call_args[0][0]
            assert "\u2705" in msg  # checkmark
            assert "Phone 2" in msg
            assert "DONE" in msg
            assert "posted" in msg
            assert "18m" in msg

    def test_session_result_error(self):
        monitor = TelegramMonitor("t", "c")
        with patch.object(monitor, "send") as mock_send:
            monitor.session_result(2, "ph2_tiktok", False,
                                   error_reason="timeout", duration_minutes=25)
            msg = mock_send.call_args[0][0]
            assert "\u274c" in msg  # X mark
            assert "ERROR" in msg
            assert "timeout" in msg

    def test_post_failure_message(self):
        monitor = TelegramMonitor("t", "c")
        with patch.object(monitor, "send") as mock_send:
            monitor.post_failure(2, "ph2_tiktok", 2, "draft", "scenario_name")
            msg = mock_send.call_args[0][0]
            assert "POST FAILED" in msg
            assert "Phone 2" in msg
            assert "2 retries" in msg
            assert "draft" in msg.lower()
            assert "scenario_name" in msg

    def test_stock_alert_low(self):
        monitor = TelegramMonitor("t", "c")
        with patch.object(monitor, "send") as mock_send:
            monitor.stock_alert(1, 3)
            msg = mock_send.call_args[0][0]
            assert "LOW STOCK" in msg
            assert "Phone 1" in msg
            assert "3 videos" in msg

    def test_stock_alert_critical(self):
        monitor = TelegramMonitor("t", "c")
        with patch.object(monitor, "send") as mock_send:
            monitor.stock_alert(3, 0, critical=True)
            msg = mock_send.call_args[0][0]
            assert "STOCK EMPTY" in msg
            assert "Phone 3" in msg
            assert "scroll-only" in msg

    def test_daily_summary_all_fields(self):
        monitor = TelegramMonitor("t", "c")
        summary = DailySummary(
            sessions_completed=10, sessions_total=12,
            posts_tiktok=5, posts_instagram=4,
            drafts=1, skipped=1, errors=2,
            stock_by_phone={1: 12, 2: 3, 3: 14},
        )
        with patch.object(monitor, "send") as mock_send:
            monitor.daily_summary(summary)
            msg = mock_send.call_args[0][0]
            assert "Daily Summary" in msg
            assert "10/12" in msg
            assert "5 TikTok" in msg
            assert "4 IG" in msg
            assert "1 draft" in msg
            assert "Errors: 2" in msg
            assert "Ph1=12" in msg
            assert "Ph2=3" in msg
            assert "\u26a0\ufe0f" in msg  # warning emoji for Ph2
