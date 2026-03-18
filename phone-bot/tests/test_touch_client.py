"""
Tests for UHID touch client integration in ADBController.

Tests the socket-based touch routing, fallback logic, pressure parameter passing,
and connection lifecycle. Uses mocking since we can't connect to a real phone.
"""

import socket
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

# We need to mock config and coords imports before importing adb
import sys
from types import ModuleType

# Create mock modules for phone-bot package structure
mock_config = ModuleType("config")
mock_config.ADB_PATH = "adb"
mock_config.PHONES = {}
mock_config.HUMAN = {}

mock_phonebot = ModuleType("phone_bot")
mock_phonebot.config = mock_config

mock_coords = ModuleType("coords")
mock_coords.get_coords = MagicMock(return_value=(0, 0))

# Patch the imports
sys.modules.setdefault("phone_bot", mock_phonebot)
sys.modules.setdefault("phone_bot.config", mock_config)


@pytest.fixture
def mock_adb():
    """Create an ADBController with mocked ADB commands."""
    with patch("phone_bot.core.adb.ADBController.__init__", lambda self, *a, **k: None):
        from phone_bot.core.adb import ADBController
        adb = ADBController.__new__(ADBController)
        # Set required attributes manually
        adb.serial = "test_serial"
        adb.phone = {}
        adb.screen_w = 1080
        adb.screen_h = 2220
        adb._density = 420
        adb._consecutive_timeouts = 0
        adb._device_lost = False
        # UHID state
        adb._touch_socket = None
        adb._touch_connected = False
        adb._touch_port = None
        adb._touch_server_pid = None
        adb._touch_reconnect_attempted = False
        adb._last_pressure = 0.55
        adb._last_area = 45
        adb._last_hold_ms = 80
        return adb


class TestSetTouchParams:

    def test_set_touch_params_stores_values(self, mock_adb):
        mock_adb.set_touch_params(pressure=0.75, area=60, hold_ms=120)
        assert mock_adb._last_pressure == 0.75
        assert mock_adb._last_area == 60
        assert mock_adb._last_hold_ms == 120

    def test_set_touch_params_defaults(self, mock_adb):
        mock_adb.set_touch_params()
        assert mock_adb._last_pressure == 0.55
        assert mock_adb._last_area == 45
        assert mock_adb._last_hold_ms == 80


class TestTapWithUHID:

    def test_tap_sends_uhid_command_when_connected(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.return_value = b"OK 85\n"
        mock_adb.set_touch_params(0.60, 50, 90)

        mock_adb.tap(540, 1110)

        sent_data = mock_adb._touch_socket.sendall.call_args[0][0]
        assert b"TAP 540 1110 0.60 50 90\n" == sent_data

    def test_tap_falls_back_when_disconnected(self, mock_adb):
        mock_adb._touch_connected = False
        mock_adb.shell = MagicMock()

        mock_adb.tap(540, 1110)

        mock_adb.shell.assert_called_once()
        assert "input tap 540 1110" in mock_adb.shell.call_args[0][0]

    def test_tap_falls_back_on_connection_error(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.sendall.side_effect = OSError("broken pipe")
        mock_adb.shell = MagicMock()
        mock_adb._touch_reconnect_attempted = True  # skip reconnect

        mock_adb.tap(540, 1110)

        mock_adb.shell.assert_called_once()
        assert "input tap" in mock_adb.shell.call_args[0][0]


class TestSwipeWithUHID:

    def test_swipe_sends_uhid_command_when_connected(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.return_value = b"OK 300\n"
        mock_adb.set_touch_params(0.65, 50, 80)

        mock_adb.swipe(540, 2000, 540, 500, 300)

        sent_data = mock_adb._touch_socket.sendall.call_args[0][0]
        assert b"SWIPE 540 2000 540 500 300 0.65\n" == sent_data

    def test_swipe_no_legacy_drift_with_uhid(self, mock_adb):
        """UHID swipe should NOT add legacy drift — humanize_swipe handles it."""
        mock_adb._touch_connected = True
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.return_value = b"OK 300\n"

        mock_adb.swipe(540, 2000, 540, 500, 300)

        sent_data = mock_adb._touch_socket.sendall.call_args[0][0].decode()
        # x2 should be exactly 540, no drift
        parts = sent_data.strip().split()
        assert parts[3] == "540"  # x2 unchanged

    def test_swipe_falls_back_without_uhid(self, mock_adb):
        mock_adb._touch_connected = False
        mock_adb.shell = MagicMock()

        mock_adb.swipe(540, 2000, 540, 500, 300)

        mock_adb.shell.assert_called_once()
        assert "input swipe" in mock_adb.shell.call_args[0][0]


class TestLongPressWithUHID:

    def test_long_press_sends_tap_with_long_hold(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.return_value = b"OK 800\n"

        mock_adb.long_press(540, 1110, 800)

        sent_data = mock_adb._touch_socket.sendall.call_args[0][0].decode()
        assert "TAP 540 1110" in sent_data
        assert "800" in sent_data  # hold_ms


class TestPressBackWithUHID:

    def test_press_back_sends_swipe_when_connected(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.return_value = b"OK 200\n"

        mock_adb.press_back()

        sent_data = mock_adb._touch_socket.sendall.call_args[0][0].decode()
        assert sent_data.startswith("SWIPE ")


class TestPressHomeWithUHID:

    def test_press_home_sends_swipe_when_connected(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.return_value = b"OK 300\n"

        mock_adb.press_home()

        sent_data = mock_adb._touch_socket.sendall.call_args[0][0].decode()
        assert sent_data.startswith("SWIPE ")


class TestTouchSend:

    def test_touch_send_raises_when_no_socket(self, mock_adb):
        mock_adb._touch_socket = None
        with pytest.raises(ConnectionError):
            mock_adb._touch_send("PING")

    def test_touch_send_sets_timeout(self, mock_adb):
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.return_value = b"PONG\n"

        mock_adb._touch_send("PING", timeout_s=5.0)

        mock_adb._touch_socket.settimeout.assert_called_with(5.0)

    def test_touch_send_raises_on_timeout(self, mock_adb):
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.side_effect = socket.timeout("timed out")

        with pytest.raises(ConnectionError, match="timeout"):
            mock_adb._touch_send("TAP 100 200 0.5 30 80", timeout_s=1.0)


class TestHealthCheck:

    def test_health_check_returns_true_on_pong(self, mock_adb):
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.return_value = b"PONG\n"
        assert mock_adb._touch_health_check() is True

    def test_health_check_returns_false_on_timeout(self, mock_adb):
        mock_adb._touch_socket = MagicMock()
        mock_adb._touch_socket.recv.side_effect = socket.timeout()
        assert mock_adb._touch_health_check() is False


class TestHandleTouchFailure:

    def test_sets_connected_false(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_reconnect_attempted = True  # skip reconnect
        mock_adb._handle_touch_failure()
        assert mock_adb._touch_connected is False

    def test_attempts_reconnect_once(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_reconnect_attempted = False
        # Mock reconnect to fail
        mock_adb._touch_reconnect = MagicMock(return_value=False)
        mock_adb._handle_touch_failure()
        mock_adb._touch_reconnect.assert_called_once()
        assert mock_adb._touch_reconnect_attempted is True

    def test_does_not_reconnect_twice(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_reconnect_attempted = True
        mock_adb._touch_reconnect = MagicMock()
        mock_adb._handle_touch_failure()
        mock_adb._touch_reconnect.assert_not_called()

    def test_successful_reconnect_resumes_uhid(self, mock_adb):
        mock_adb._touch_connected = True
        mock_adb._touch_reconnect_attempted = False
        mock_adb._touch_reconnect = MagicMock(return_value=True)
        mock_adb._handle_touch_failure()
        # _handle_touch_failure returns early on reconnect success
        # _touch_connected was set to False first, then reconnect restores it
        mock_adb._touch_reconnect.assert_called_once()


class TestStopTouchServer:

    def test_stop_sends_destroy_and_cleans_up(self, mock_adb):
        sock_mock = MagicMock()
        sock_mock.recv.return_value = b"OK\n"
        mock_adb._touch_socket = sock_mock
        mock_adb._touch_port = 7100
        mock_adb._touch_connected = True
        mock_adb.shell = MagicMock()
        mock_adb._run = MagicMock(return_value="")

        mock_adb.stop_touch_server()

        # DESTROY sent (capture from original mock ref)
        sent = sock_mock.sendall.call_args[0][0]
        assert b"DESTROY\n" in sent
        # Socket closed
        sock_mock.close.assert_called_once()
        # Port forward removed
        mock_adb._run.assert_called()
        assert mock_adb._touch_connected is False
        assert mock_adb._touch_port is None
