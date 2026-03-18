"""Tests for production hardening: ADB subprocess cleanup (Section 01).

Tests _run() and _run_bytes() Popen rewrite:
- Process kill on timeout
- Return values on timeout
- DeviceLostError on device disconnect
- Consecutive timeout counter
- ADB server restart after 5 consecutive timeouts
"""
import subprocess
from unittest.mock import MagicMock, patch, call

import pytest

# conftest.py registers the module wiring
from core.adb import ADBController, DeviceLostError


def _make_adb(serial="FAKE123"):
    """Create ADBController with mocked __init__ (skip ADB device detection)."""
    with patch.object(ADBController, "__init__", lambda self, *a, **kw: None):
        adb = ADBController.__new__(ADBController)
        adb.serial = serial
        adb.screen_w = 1080
        adb.screen_h = 2400
        adb._device_lost = False
        adb._density = 420
        adb._consecutive_timeouts = 0
        adb.phone = {}
        return adb


# --- 1. _run() timeout kills child process ---

class TestRunTimeoutKillsProcess:
    def test_run_kills_process_on_timeout(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            ("", ""),  # after kill, communicate returns normally
        ]

        with patch("subprocess.Popen", return_value=mock_proc):
            result = adb._run(["shell", "echo", "test"])

        mock_proc.kill.assert_called_once()
        assert result == ""


# --- 2. _run_bytes() timeout kills child process ---

class TestRunBytesTimeoutKillsProcess:
    def test_run_bytes_kills_process_on_timeout(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 8888
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            (b"", b""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc):
            result = adb._run_bytes(["exec-out", "screencap", "-p"])

        mock_proc.kill.assert_called_once()
        assert result == b""


# --- 3. _run() normal operation unchanged ---

class TestRunNormalOperation:
    def test_run_returns_stdout_on_success(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 7777
        mock_proc.communicate.return_value = ("hello world\n", "")
        mock_proc.returncode = 0

        with patch("subprocess.Popen", return_value=mock_proc):
            result = adb._run(["shell", "echo", "hello"])

        mock_proc.kill.assert_not_called()
        assert result == "hello world\n"


# --- 4. Return value on timeout ---

class TestReturnValueOnTimeout:
    def test_run_returns_empty_string_on_timeout(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 6666
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            ("", ""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc):
            result = adb._run(["shell", "ls"])

        assert result == ""
        assert not isinstance(result, type(None))

    def test_run_bytes_returns_empty_bytes_on_timeout(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 5555
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            (b"", b""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc):
            result = adb._run_bytes(["exec-out", "screencap", "-p"])

        assert result == b""
        assert not isinstance(result, type(None))


# --- 5. DeviceLostError still raised on device disconnect ---

class TestDeviceLostError:
    def test_run_raises_on_not_found(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 4444
        mock_proc.communicate.return_value = ("", "error: device 'FAKE123' not found")
        mock_proc.returncode = 1

        with patch("subprocess.Popen", return_value=mock_proc):
            with pytest.raises(DeviceLostError):
                adb._run(["shell", "ls"])

    def test_run_raises_on_offline(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 3333
        mock_proc.communicate.return_value = ("", "error: device offline")
        mock_proc.returncode = 1

        with patch("subprocess.Popen", return_value=mock_proc):
            with pytest.raises(DeviceLostError):
                adb._run(["shell", "ls"])

    def test_run_bytes_raises_on_not_found(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 2222
        mock_proc.communicate.return_value = (b"", b"error: device 'FAKE123' not found")
        mock_proc.returncode = 1

        with patch("subprocess.Popen", return_value=mock_proc):
            with pytest.raises(DeviceLostError):
                adb._run_bytes(["exec-out", "screencap", "-p"])


# --- 6. Consecutive timeout counter ---

class TestConsecutiveTimeoutCounter:
    def test_timeout_increments_counter(self):
        adb = _make_adb()
        assert adb._consecutive_timeouts == 0

        mock_proc = MagicMock()
        mock_proc.pid = 1111
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            ("", ""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc):
            adb._run(["shell", "ls"])

        assert adb._consecutive_timeouts == 1

    def test_success_resets_counter(self):
        adb = _make_adb()
        adb._consecutive_timeouts = 3

        mock_proc = MagicMock()
        mock_proc.pid = 1010
        mock_proc.communicate.return_value = ("ok", "")
        mock_proc.returncode = 0

        with patch("subprocess.Popen", return_value=mock_proc):
            adb._run(["shell", "echo"])

        assert adb._consecutive_timeouts == 0


# --- 7. ADB server restart after 5 consecutive timeouts ---

class TestADBServerRestart:
    def test_restart_after_5_consecutive_timeouts(self):
        adb = _make_adb()
        adb._consecutive_timeouts = 4  # next timeout = 5th

        mock_proc = MagicMock()
        mock_proc.pid = 999
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            ("", ""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc), \
             patch.object(adb, "_restart_adb_server") as mock_restart:
            adb._run(["shell", "ls"])

        mock_restart.assert_called_once()

    def test_no_restart_before_5_timeouts(self):
        adb = _make_adb()
        adb._consecutive_timeouts = 3  # next timeout = 4th

        mock_proc = MagicMock()
        mock_proc.pid = 888
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            ("", ""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc), \
             patch.object(adb, "_restart_adb_server") as mock_restart:
            adb._run(["shell", "ls"])

        mock_restart.assert_not_called()


# --- 8. Server restart fires only once per recovery cycle ---

class TestServerRestartCycle:
    def test_restart_resets_counter(self):
        adb = _make_adb()
        adb._consecutive_timeouts = 4  # next timeout triggers restart

        mock_proc = MagicMock()
        mock_proc.pid = 777
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            ("", ""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc), \
             patch.object(adb, "_restart_adb_server"):
            adb._run(["shell", "ls"])

        # Counter should be reset to 0 after restart
        assert adb._consecutive_timeouts == 0

    def test_4_timeouts_after_restart_no_second_restart(self):
        """After restart resets counter, 4 more timeouts should NOT trigger another restart."""
        adb = _make_adb()
        adb._consecutive_timeouts = 0  # fresh after restart

        with patch.object(adb, "_restart_adb_server") as mock_restart:
            for i in range(4):
                mock_proc = MagicMock()
                mock_proc.pid = 600 + i
                mock_proc.communicate.side_effect = [
                    subprocess.TimeoutExpired(cmd="adb", timeout=15),
                    ("", ""),
                ]
                with patch("subprocess.Popen", return_value=mock_proc):
                    adb._run(["shell", "ls"])

        mock_restart.assert_not_called()
        assert adb._consecutive_timeouts == 4


# --- 9. _run_bytes counter and restart (mirror of _run tests) ---

class TestRunBytesCounterAndRestart:
    def test_run_bytes_timeout_increments_counter(self):
        adb = _make_adb()
        mock_proc = MagicMock()
        mock_proc.pid = 500
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            (b"", b""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc):
            adb._run_bytes(["exec-out", "screencap", "-p"])

        assert adb._consecutive_timeouts == 1

    def test_run_bytes_success_resets_counter(self):
        adb = _make_adb()
        adb._consecutive_timeouts = 3

        mock_proc = MagicMock()
        mock_proc.pid = 501
        mock_proc.communicate.return_value = (b"image_data", b"")
        mock_proc.returncode = 0

        with patch("subprocess.Popen", return_value=mock_proc):
            adb._run_bytes(["exec-out", "screencap", "-p"])

        assert adb._consecutive_timeouts == 0

    def test_run_bytes_restart_after_5_timeouts(self):
        adb = _make_adb()
        adb._consecutive_timeouts = 4

        mock_proc = MagicMock()
        mock_proc.pid = 502
        mock_proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="adb", timeout=15),
            (b"", b""),
        ]

        with patch("subprocess.Popen", return_value=mock_proc), \
             patch.object(adb, "_restart_adb_server") as mock_restart:
            adb._run_bytes(["exec-out", "screencap", "-p"])

        mock_restart.assert_called_once()
        assert adb._consecutive_timeouts == 0
