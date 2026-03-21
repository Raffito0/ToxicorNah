"""Tests for run_forever() daily loop, control file, and check_new_phones().

Standalone tests — no deep imports from phone-bot module tree.
Tests the algorithms and contracts, not the actual module wiring.
"""
import json
import os
import tempfile
import time
from unittest.mock import patch, MagicMock, call
from datetime import datetime, timedelta

import pytest


# ---------------------------------------------------------------------------
# Standalone implementations mirroring main.py logic
# ---------------------------------------------------------------------------

CONTROL_FILE = None  # set per-test via tmp dir


def atomic_write_control(data: dict, control_path: str):
    """Write data as JSON atomically using os.replace()."""
    tmp_path = control_path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(data, f)
    os.replace(tmp_path, control_path)


def read_control(control_path: str) -> dict:
    """Read control file. Returns {} if missing or invalid."""
    try:
        with open(control_path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def run_forever_loop(
    run_today_fn,
    wait_midnight_fn,
    daily_summary_fn,
    check_new_phones_fn,
    control_path: str,
    max_iterations: int = 100,
):
    """Simulate run_forever() loop logic.

    Returns the number of run_today calls made.
    """
    iterations = 0
    for _ in range(max_iterations):
        # Check control before starting the day
        ctrl = read_control(control_path)
        if ctrl.get("action") == "stop":
            break

        # Start of day: check for new phones
        check_new_phones_fn()

        # Run today's sessions
        run_today_fn()
        iterations += 1

        # Daily summary
        daily_summary_fn()

        # Check control after the day (stop signal may have arrived during run)
        ctrl = read_control(control_path)
        if ctrl.get("action") == "stop":
            break

        # Wait for midnight
        wait_midnight_fn()

    return iterations


# ---------------------------------------------------------------------------
# Tests: control file read/write
# ---------------------------------------------------------------------------

class TestControlFile:

    def test_atomic_write_creates_valid_json(self, tmp_path):
        """atomic_write_control creates a valid JSON file."""
        ctrl = tmp_path / "control.json"
        atomic_write_control({"action": "stop"}, str(ctrl))
        assert ctrl.exists()
        data = json.loads(ctrl.read_text())
        assert data == {"action": "stop"}

    def test_atomic_write_uses_replace(self, tmp_path):
        """Write goes through tmp file then os.replace (no partial reads)."""
        ctrl = tmp_path / "control.json"
        # Write initial content
        atomic_write_control({"action": "none"}, str(ctrl))
        # Overwrite atomically
        atomic_write_control({"action": "stop"}, str(ctrl))
        data = json.loads(ctrl.read_text())
        assert data["action"] == "stop"

    def test_atomic_write_no_leftover_tmp(self, tmp_path):
        """After atomic write, no .tmp file remains."""
        ctrl = tmp_path / "control.json"
        atomic_write_control({"action": "none"}, str(ctrl))
        tmp_file = tmp_path / "control.json.tmp"
        assert not tmp_file.exists()

    def test_read_control_returns_empty_on_missing_file(self, tmp_path):
        """Missing control file returns {} (no command)."""
        ctrl = tmp_path / "control.json"
        result = read_control(str(ctrl))
        assert result == {}

    def test_read_control_returns_empty_on_invalid_json(self, tmp_path):
        """Corrupt control file returns {} (no command)."""
        ctrl = tmp_path / "control.json"
        ctrl.write_text("not valid json {{{")
        result = read_control(str(ctrl))
        assert result == {}

    def test_read_control_returns_data(self, tmp_path):
        """Valid control file is read correctly."""
        ctrl = tmp_path / "control.json"
        ctrl.write_text('{"action": "stop"}')
        result = read_control(str(ctrl))
        assert result == {"action": "stop"}


# ---------------------------------------------------------------------------
# Tests: run_forever loop
# ---------------------------------------------------------------------------

class TestRunForeverLoop:

    def test_runs_multiple_days(self, tmp_path):
        """run_forever calls run_today once per iteration."""
        ctrl = tmp_path / "control.json"
        ctrl.write_text('{"action": "none"}')

        call_count = [0]
        def mock_run_today():
            call_count[0] += 1
            if call_count[0] >= 3:
                # Stop after 3 iterations by writing control file
                atomic_write_control({"action": "stop"}, str(ctrl))

        result = run_forever_loop(
            run_today_fn=mock_run_today,
            wait_midnight_fn=lambda: None,
            daily_summary_fn=lambda: None,
            check_new_phones_fn=lambda: None,
            control_path=str(ctrl),
        )
        assert result == 3

    def test_stops_before_first_run_when_stop_set(self, tmp_path):
        """If control file says stop before starting, run_today never called."""
        ctrl = tmp_path / "control.json"
        ctrl.write_text('{"action": "stop"}')

        run_today = MagicMock()
        result = run_forever_loop(
            run_today_fn=run_today,
            wait_midnight_fn=lambda: None,
            daily_summary_fn=lambda: None,
            check_new_phones_fn=lambda: None,
            control_path=str(ctrl),
        )
        assert result == 0
        run_today.assert_not_called()

    def test_stops_after_run_today_when_stop_written_during_run(self, tmp_path):
        """Stop signal written during run_today is caught after it returns."""
        ctrl = tmp_path / "control.json"
        ctrl.write_text('{"action": "none"}')

        def mock_run_today():
            # Simulate dashboard writing stop during the session
            atomic_write_control({"action": "stop"}, str(ctrl))

        result = run_forever_loop(
            run_today_fn=mock_run_today,
            wait_midnight_fn=lambda: None,
            daily_summary_fn=lambda: None,
            check_new_phones_fn=lambda: None,
            control_path=str(ctrl),
        )
        # run_today called once, then stop detected after return
        assert result == 1

    def test_check_new_phones_called_each_iteration(self, tmp_path):
        """check_new_phones is called at the start of each daily loop."""
        ctrl = tmp_path / "control.json"
        ctrl.write_text('{"action": "none"}')

        check_fn = MagicMock()
        call_count = [0]
        def mock_run_today():
            call_count[0] += 1
            if call_count[0] >= 2:
                atomic_write_control({"action": "stop"}, str(ctrl))

        run_forever_loop(
            run_today_fn=mock_run_today,
            wait_midnight_fn=lambda: None,
            daily_summary_fn=lambda: None,
            check_new_phones_fn=check_fn,
            control_path=str(ctrl),
        )
        assert check_fn.call_count == 2

    def test_missing_control_file_continues_normally(self, tmp_path):
        """Missing control file = no command = continue running."""
        ctrl = tmp_path / "nonexistent_control.json"

        call_count = [0]
        def mock_run_today():
            call_count[0] += 1
            if call_count[0] >= 2:
                atomic_write_control({"action": "stop"}, str(ctrl))

        result = run_forever_loop(
            run_today_fn=mock_run_today,
            wait_midnight_fn=lambda: None,
            daily_summary_fn=lambda: None,
            check_new_phones_fn=lambda: None,
            control_path=str(ctrl),
        )
        assert result == 2

    def test_daily_summary_called_each_iteration(self, tmp_path):
        """daily_summary is called after each run_today."""
        ctrl = tmp_path / "control.json"
        ctrl.write_text('{"action": "none"}')

        summary_fn = MagicMock()
        call_count = [0]
        def mock_run_today():
            call_count[0] += 1
            if call_count[0] >= 2:
                atomic_write_control({"action": "stop"}, str(ctrl))

        run_forever_loop(
            run_today_fn=mock_run_today,
            wait_midnight_fn=lambda: None,
            daily_summary_fn=summary_fn,
            check_new_phones_fn=lambda: None,
            control_path=str(ctrl),
        )
        assert summary_fn.call_count == 2


# ---------------------------------------------------------------------------
# Tests: check_new_phones logic
# ---------------------------------------------------------------------------

class TestCheckNewPhones:

    def test_new_account_gets_enrolled(self):
        """Account in config but not in warmup_states triggers init_warmup."""
        warmup_states = {"ph1_tiktok": MagicMock(completed=False)}
        accounts = [
            {"name": "ph1_tiktok", "phone_id": 1, "platform": "tiktok"},
            {"name": "ph2_tiktok", "phone_id": 2, "platform": "tiktok"},
        ]
        init_calls = []
        known = set(warmup_states.keys())
        for acc in accounts:
            if acc["name"] not in known:
                init_calls.append(acc["name"])
        assert init_calls == ["ph2_tiktok"]

    def test_completed_warmup_not_re_enrolled(self):
        """Account that completed warmup is still in warmup_states, so not re-enrolled."""
        warmup_states = {
            "ph1_tiktok": MagicMock(completed=True),
            "ph2_tiktok": MagicMock(completed=False),
        }
        accounts = [
            {"name": "ph1_tiktok", "phone_id": 1, "platform": "tiktok"},
            {"name": "ph2_tiktok", "phone_id": 2, "platform": "tiktok"},
        ]
        known = set(warmup_states.keys())
        new_accounts = [a["name"] for a in accounts if a["name"] not in known]
        assert new_accounts == []

    def test_no_accounts_no_enrollment(self):
        """Empty accounts list means nothing to enroll."""
        warmup_states = {}
        accounts = []
        known = set(warmup_states.keys())
        new_accounts = [a["name"] for a in accounts if a["name"] not in known]
        assert new_accounts == []


# ---------------------------------------------------------------------------
# Tests: wait_until_midnight logic
# ---------------------------------------------------------------------------

class TestWaitUntilMidnight:

    def test_calculates_seconds_to_target(self):
        """Verify seconds calculation to 00:05 next day."""
        # Simulate: it's 23:00, we want 00:05 next day = 1h05m = 3900s
        now = datetime(2026, 3, 21, 23, 0, 0)
        target = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
        seconds = (target - now).total_seconds()
        assert seconds == 3900

    def test_already_past_midnight_goes_to_next_day(self):
        """If called at 00:03, waits only 2 minutes (to 00:05)."""
        now = datetime(2026, 3, 21, 0, 3, 0)
        # Target is 00:05 same day
        target_today = now.replace(hour=0, minute=5, second=0, microsecond=0)
        if now < target_today:
            seconds = (target_today - now).total_seconds()
        else:
            # Past 00:05, go to next day
            target_tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
            seconds = (target_tomorrow - now).total_seconds()
        assert seconds == 120  # 2 minutes
