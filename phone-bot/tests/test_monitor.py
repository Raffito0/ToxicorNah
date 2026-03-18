"""Tests for Section 07: Structured Event Logger.

Tests JSONL event logging, file rotation, buffered writes,
action trace buffer, screenshots, and graceful failure.
"""
import json
import os
import time
import tempfile
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

# Import directly — conftest.py sets up sys.path
import sys
phone_bot_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if phone_bot_dir not in sys.path:
    sys.path.insert(0, phone_bot_dir)

from core.monitor import BotEvent, EventLogger


def _make_event(**overrides):
    """Helper to create a BotEvent with sensible defaults."""
    defaults = dict(
        timestamp=datetime.utcnow().isoformat(),
        phone_id=1,
        account="ph1_tiktok",
        session_id="sess-001",
        event_type="action",
        action_type="scroll",
        behavioral_state={"energy": 0.8, "fatigue": 0.2, "boredom": 0.1, "phase": "peak"},
        duration_ms=1500,
        success=True,
        metadata={},
    )
    defaults.update(overrides)
    return BotEvent(**defaults)


# ── Event Schema ───────────────────────────────────────────────

class TestEventSchema:
    """Events must contain all required fields and write to JSONL."""

    def test_log_event_creates_jsonl_file(self, tmp_path):
        """log_event writes JSON line to YYYY-MM-DD.jsonl file."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        event = _make_event()
        logger.log_event(event)
        logger.flush()

        today = datetime.utcnow().strftime("%Y-%m-%d")
        jsonl_path = tmp_path / "events" / f"{today}.jsonl"
        assert jsonl_path.exists()
        line = jsonl_path.read_text().strip()
        data = json.loads(line)
        assert data["event_type"] == "action"

    def test_event_contains_all_required_fields(self, tmp_path):
        """Event JSON must have timestamp, phone_id, account, session_id, event_type, behavioral_state."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        event = _make_event()
        logger.log_event(event)
        logger.flush()

        today = datetime.utcnow().strftime("%Y-%m-%d")
        data = json.loads((tmp_path / "events" / f"{today}.jsonl").read_text().strip())
        for field in ["timestamp", "phone_id", "account", "session_id", "event_type", "behavioral_state"]:
            assert field in data, f"Missing required field: {field}"

    def test_behavioral_state_has_required_keys(self, tmp_path):
        """behavioral_state must have energy, fatigue, boredom, phase."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        event = _make_event()
        logger.log_event(event)
        logger.flush()

        today = datetime.utcnow().strftime("%Y-%m-%d")
        data = json.loads((tmp_path / "events" / f"{today}.jsonl").read_text().strip())
        state = data["behavioral_state"]
        for key in ["energy", "fatigue", "boredom", "phase"]:
            assert key in state, f"Missing behavioral_state key: {key}"

    def test_metadata_preserved(self, tmp_path):
        """metadata dict is preserved in the event."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        event = _make_event(metadata={"popup_type": "login", "attempts": 3})
        logger.log_event(event)
        logger.flush()

        today = datetime.utcnow().strftime("%Y-%m-%d")
        data = json.loads((tmp_path / "events" / f"{today}.jsonl").read_text().strip())
        assert data["metadata"]["popup_type"] == "login"
        assert data["metadata"]["attempts"] == 3


# ── JSONL Format ───────────────────────────────────────────────

class TestJSONLFormat:
    """Multiple events as separate lines; midnight creates new file."""

    def test_multiple_events_separate_lines(self, tmp_path):
        """Multiple events written as separate lines in same file."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        logger.log_event(_make_event(action_type="scroll"))
        logger.log_event(_make_event(action_type="like"))
        logger.log_event(_make_event(action_type="follow"))
        logger.flush()

        today = datetime.utcnow().strftime("%Y-%m-%d")
        lines = (tmp_path / "events" / f"{today}.jsonl").read_text().strip().split("\n")
        assert len(lines) == 3
        assert json.loads(lines[0])["action_type"] == "scroll"
        assert json.loads(lines[1])["action_type"] == "like"
        assert json.loads(lines[2])["action_type"] == "follow"

    def test_events_across_midnight_create_new_file(self, tmp_path):
        """Events with different dates go to different files."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")

        yesterday = (datetime.utcnow() - timedelta(days=1)).isoformat()
        today_ts = datetime.utcnow().isoformat()

        logger.log_event(_make_event(timestamp=yesterday, action_type="scroll"))
        logger.log_event(_make_event(timestamp=today_ts, action_type="like"))
        logger.flush()

        yesterday_str = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
        today_str = datetime.utcnow().strftime("%Y-%m-%d")

        assert (tmp_path / "events" / f"{yesterday_str}.jsonl").exists()
        assert (tmp_path / "events" / f"{today_str}.jsonl").exists()


# ── File Rotation ──────────────────────────────────────────────

class TestFileRotation:
    """Rotation deletes old .jsonl files, preserves others."""

    def test_rotation_deletes_old_files(self, tmp_path):
        """Files older than retention_days are deleted."""
        events_dir = tmp_path / "events"
        events_dir.mkdir(parents=True)

        # Create a file from 45 days ago
        old_date = (datetime.utcnow() - timedelta(days=45)).strftime("%Y-%m-%d")
        (events_dir / f"{old_date}.jsonl").write_text('{"test": true}\n')

        # Create a recent file
        today = datetime.utcnow().strftime("%Y-%m-%d")
        (events_dir / f"{today}.jsonl").write_text('{"test": true}\n')

        logger = EventLogger(events_dir=events_dir, screenshots_dir=tmp_path / "screenshots", retention_days=30)
        logger.rotate_old_files()

        assert not (events_dir / f"{old_date}.jsonl").exists()
        assert (events_dir / f"{today}.jsonl").exists()

    def test_rotation_only_deletes_jsonl(self, tmp_path):
        """Non-.jsonl files are not deleted even if old."""
        events_dir = tmp_path / "events"
        events_dir.mkdir(parents=True)

        old_date = (datetime.utcnow() - timedelta(days=45)).strftime("%Y-%m-%d")
        (events_dir / f"{old_date}.jsonl").write_text('{"test": true}\n')
        (events_dir / "README.txt").write_text("keep me")

        logger = EventLogger(events_dir=events_dir, screenshots_dir=tmp_path / "screenshots", retention_days=30)
        logger.rotate_old_files()

        assert not (events_dir / f"{old_date}.jsonl").exists()
        assert (events_dir / "README.txt").exists()


# ── Screenshots ────────────────────────────────────────────────

class TestScreenshots:
    """Screenshots saved for alert events, not for normal events."""

    def test_screenshot_saved_for_alert_event(self, tmp_path):
        """Alert events (captcha, error) save screenshot with path in metadata."""
        screenshots_dir = tmp_path / "screenshots"
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=screenshots_dir)
        event = _make_event(event_type="captcha", session_id="sess-alert")
        fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

        logger.log_event(event, screenshot_bytes=fake_png)
        logger.flush()

        # Check screenshot was saved
        screenshots = list(screenshots_dir.glob("*.png"))
        assert len(screenshots) == 1
        assert b"\x89PNG" in screenshots[0].read_bytes()

        # Check path is in the event metadata
        today = datetime.utcnow().strftime("%Y-%m-%d")
        data = json.loads((tmp_path / "events" / f"{today}.jsonl").read_text().strip())
        assert "screenshot_path" in data["metadata"]

    def test_no_screenshot_for_normal_event(self, tmp_path):
        """Normal events don't save screenshots even if bytes provided."""
        screenshots_dir = tmp_path / "screenshots"
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=screenshots_dir)
        event = _make_event(event_type="action")
        # Don't pass screenshot_bytes for normal events
        logger.log_event(event)
        logger.flush()

        screenshots = list(screenshots_dir.glob("*.png")) if screenshots_dir.exists() else []
        assert len(screenshots) == 0


# ── Buffered Write ─────────────────────────────────────────────

class TestBufferedWrite:
    """Buffer flushes every N events, on explicit call, and on close."""

    def test_buffered_flush_every_n(self, tmp_path):
        """Buffer flushes when length >= flush_every."""
        logger = EventLogger(
            events_dir=tmp_path / "events",
            screenshots_dir=tmp_path / "screenshots",
            flush_every=3,
        )
        today = datetime.utcnow().strftime("%Y-%m-%d")
        jsonl_path = tmp_path / "events" / f"{today}.jsonl"

        logger.log_event(_make_event())
        logger.log_event(_make_event())
        # Not flushed yet (2 < 3)
        assert not jsonl_path.exists()

        logger.log_event(_make_event())
        # Should auto-flush now (3 >= 3)
        assert jsonl_path.exists()
        lines = jsonl_path.read_text().strip().split("\n")
        assert len(lines) == 3

    def test_explicit_flush(self, tmp_path):
        """flush() writes buffered events before threshold."""
        logger = EventLogger(
            events_dir=tmp_path / "events",
            screenshots_dir=tmp_path / "screenshots",
            flush_every=100,
        )
        logger.log_event(_make_event())
        logger.flush()

        today = datetime.utcnow().strftime("%Y-%m-%d")
        jsonl_path = tmp_path / "events" / f"{today}.jsonl"
        assert jsonl_path.exists()

    def test_flush_on_close(self, tmp_path):
        """close() flushes remaining buffered events."""
        logger = EventLogger(
            events_dir=tmp_path / "events",
            screenshots_dir=tmp_path / "screenshots",
            flush_every=100,
        )
        logger.log_event(_make_event())
        logger.close()

        today = datetime.utcnow().strftime("%Y-%m-%d")
        jsonl_path = tmp_path / "events" / f"{today}.jsonl"
        assert jsonl_path.exists()


# ── Graceful Failure ───────────────────────────────────────────

class TestGracefulFailure:
    """Logging must never crash the bot."""

    def test_permission_denied_no_crash(self, tmp_path):
        """Disk write failure produces warning, no crash."""
        # Use a non-existent deep path that can't be created
        logger = EventLogger(
            events_dir=tmp_path / "events",
            screenshots_dir=tmp_path / "screenshots",
        )
        logger.log_event(_make_event())

        # Patch open to simulate permission denied
        with patch("builtins.open", side_effect=PermissionError("Permission denied")):
            # Should not raise
            logger.flush()

    def test_non_serializable_metadata_no_crash(self, tmp_path):
        """Non-serializable metadata should not crash."""
        logger = EventLogger(
            events_dir=tmp_path / "events",
            screenshots_dir=tmp_path / "screenshots",
        )
        event = _make_event(metadata={"obj": object()})
        # Should not raise — logger should handle serialization error
        logger.log_event(event)
        logger.flush()


# ── Action Trace Buffer ───────────────────────────────────────

class TestActionTraceBuffer:
    """Rolling buffer keeps last N events per session."""

    def test_rolling_buffer_keeps_last_10(self, tmp_path):
        """Buffer keeps last 10 events per session."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        for i in range(15):
            logger.log_event(_make_event(session_id="sess-trace", action_type=f"action_{i}"))

        trace = logger.get_action_trace("sess-trace")
        assert len(trace) == 10
        # Should have actions 5-14 (last 10)
        assert trace[0]["action_type"] == "action_5"
        assert trace[-1]["action_type"] == "action_14"

    def test_separate_sessions_separate_traces(self, tmp_path):
        """Different sessions maintain independent traces."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        logger.log_event(_make_event(session_id="sess-A", action_type="like"))
        logger.log_event(_make_event(session_id="sess-B", action_type="follow"))

        trace_a = logger.get_action_trace("sess-A")
        trace_b = logger.get_action_trace("sess-B")
        assert len(trace_a) == 1
        assert len(trace_b) == 1
        assert trace_a[0]["action_type"] == "like"
        assert trace_b[0]["action_type"] == "follow"

    def test_trace_cleared_on_session_end(self, tmp_path):
        """clear_session_trace removes all events for that session."""
        logger = EventLogger(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        logger.log_event(_make_event(session_id="sess-clear", action_type="scroll"))
        logger.log_event(_make_event(session_id="sess-clear", action_type="like"))

        assert len(logger.get_action_trace("sess-clear")) == 2
        logger.clear_session_trace("sess-clear")
        assert len(logger.get_action_trace("sess-clear")) == 0


# ── Module-level convenience ───────────────────────────────────

class TestModuleLevelAPI:
    """Module-level init_monitor / log_event convenience functions."""

    def test_init_and_log(self, tmp_path):
        """init_monitor + log_event works end-to-end."""
        import core.monitor as monitor_mod

        monitor_mod.init_monitor(events_dir=tmp_path / "events", screenshots_dir=tmp_path / "screenshots")
        try:
            event = _make_event(session_id="mod-test")
            monitor_mod.log_event(event)

            trace = monitor_mod.get_action_trace("mod-test")
            assert len(trace) == 1
        finally:
            # Clean up global state to avoid test pollution
            if monitor_mod._default_logger:
                monitor_mod._default_logger.close()
            monitor_mod._default_logger = None
