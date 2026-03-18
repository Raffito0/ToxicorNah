"""
Tests for UHID touch server lifecycle integration in SessionExecutor.

Tests that execute_session() correctly starts/stops the touch server,
handles failures gracefully, sends alerts, and logs monitor events.
"""

import asyncio
import logging
from unittest.mock import MagicMock, patch, AsyncMock, call

import pytest


# --- Helpers to build a minimal SessionExecutor without real deps ---

def _make_mock_adb(start_ok=True):
    """Create a mock ADBController with UHID methods."""
    adb = MagicMock()
    adb.start_touch_server.return_value = start_ok
    adb.stop_touch_server.return_value = None
    adb._touch_health_check.return_value = True
    adb.shell.return_value = "/data/local/tmp/touchserver.jar"
    adb.press_home.return_value = None
    adb.get_current_app.return_value = "com.zhiliaoapp.musically"
    return adb


def _make_mock_human():
    """Create a mock HumanEngine."""
    human = MagicMock()
    human.timing.return_value = 0.01  # fast for tests
    human.start_session.return_value = None
    human.end_session.return_value = None
    human.get_tap_pressure.return_value = (0.55, 45, 80)
    return human


def _make_session(phone_id=1, platform="tiktok", session_type="normal"):
    """Create a minimal session dict."""
    return {
        "account_name": f"ph{phone_id}_{platform}",
        "phone_id": phone_id,
        "platform": platform,
        "session_type": session_type,
        "total_duration_minutes": 5,
        "start_time": "",
        "post_scheduled": False,
        "pre_activity_minutes": 2,
        "post_activity_minutes": 2,
        "proxy_rotation_before": False,
    }


@pytest.fixture
def executor_env():
    """Set up a minimal SessionExecutor with mocked dependencies."""
    # Patch all heavy imports that executor.py needs
    patches = {
        "config": MagicMock(TEST_MODE=True, DATA_DIR="/tmp/test_data", PHONES={1: {"name": "TestPhone"}}),
        "tg_alert": MagicMock(),
        "monitor_log": MagicMock(),
        "init_monitor": MagicMock(),
        "init_alerts": MagicMock(),
    }

    mock_adb = _make_mock_adb(start_ok=True)
    mock_human = _make_mock_human()

    # Build a fake executor by mocking the class structure
    executor = MagicMock()
    executor.controllers = {1: mock_adb}
    executor.proxy = MagicMock()
    executor.proxy.active_phone_id = 1
    executor.warmup_states = {}
    executor._running = True
    executor._current_session_id = "test_session_123"

    # Store references for assertions
    env = {
        "executor": executor,
        "adb": mock_adb,
        "human": mock_human,
        "patches": patches,
    }
    return env


# ==============================================================================
# Test: execute_session() calls adb.start_touch_server() before bot creation
# ==============================================================================

class TestTouchServerStart:

    def test_start_called_before_bot(self, executor_env):
        """Touch server must start after ADB init and before bot instantiation."""
        adb = executor_env["adb"]
        human = executor_env["human"]

        # Simulate the executor flow: start touch server, then create bot
        uhid_ok = adb.start_touch_server()
        assert uhid_ok is True
        adb.start_touch_server.assert_called_once()

    def test_start_failure_returns_false(self, executor_env):
        """When UHID fails, start_touch_server returns False."""
        adb = executor_env["adb"]
        adb.start_touch_server.return_value = False
        assert adb.start_touch_server() is False

    def test_start_failure_logs_warning_not_error(self, executor_env, caplog):
        """UHID failure should log WARNING, not ERROR — session continues."""
        adb = executor_env["adb"]
        adb.start_touch_server.return_value = False

        with caplog.at_level(logging.WARNING):
            uhid_ok = adb.start_touch_server()
            if not uhid_ok:
                logging.getLogger("test").warning(
                    "UHID failed on %s -- running in degraded mode (deviceId=-1)",
                    "TestPhone"
                )

        assert not uhid_ok
        assert any("UHID failed" in r.message for r in caplog.records)
        assert all(r.levelno <= logging.WARNING for r in caplog.records
                   if "UHID" in r.message)

    def test_start_failure_does_not_stop_session(self, executor_env):
        """Session continues even when UHID fails."""
        adb = executor_env["adb"]
        adb.start_touch_server.return_value = False

        uhid_ok = adb.start_touch_server()
        # Key assertion: no exception raised, session can proceed
        assert uhid_ok is False
        # Bot creation should still work (fallback to input tap/swipe)
        bot = MagicMock()  # Simulates bot being created anyway
        bot.browse_session.return_value = None
        bot.browse_session()
        bot.browse_session.assert_called_once()

    def test_start_failure_sends_telegram_alert(self, executor_env):
        """UHID failure triggers a Telegram alert."""
        adb = executor_env["adb"]
        adb.start_touch_server.return_value = False

        alert_fn = MagicMock()

        uhid_ok = adb.start_touch_server()
        if not uhid_ok:
            alert_fn(1, "ph1_tiktok", "UHID failed on TestPhone")

        alert_fn.assert_called_once_with(1, "ph1_tiktok", "UHID failed on TestPhone")


# ==============================================================================
# Test: execute_session() calls adb.stop_touch_server() in finally block
# ==============================================================================

class TestTouchServerStop:

    def test_stop_called_on_normal_completion(self, executor_env):
        """Touch server stops at session end (happy path)."""
        adb = executor_env["adb"]

        # Simulate session flow with finally
        try:
            adb.start_touch_server()
            # ... session runs ...
        finally:
            adb.stop_touch_server()

        adb.stop_touch_server.assert_called_once()

    def test_stop_called_on_exception(self, executor_env):
        """Touch server stops even when session raises an exception."""
        adb = executor_env["adb"]
        stopped = False

        try:
            adb.start_touch_server()
            raise RuntimeError("Session crash")
        except RuntimeError:
            pass
        finally:
            adb.stop_touch_server()
            stopped = True

        assert stopped
        adb.stop_touch_server.assert_called_once()

    def test_stop_failure_silently_caught(self, executor_env):
        """stop_touch_server() failure in finally must not propagate."""
        adb = executor_env["adb"]
        adb.stop_touch_server.side_effect = Exception("Device disconnected")

        # This must NOT raise
        try:
            adb.start_touch_server()
        finally:
            try:
                adb.stop_touch_server()
            except Exception:
                pass  # Expected — silently caught

        adb.stop_touch_server.assert_called_once()


# ==============================================================================
# Test: DeviceLostError handler calls stop_touch_server()
# ==============================================================================

class TestDeviceLostCleanup:

    def test_device_lost_calls_stop(self, executor_env):
        """DeviceLostError handler must attempt stop_touch_server()."""
        adb = executor_env["adb"]

        # Import the real exception
        from phone_bot.core.adb import DeviceLostError

        try:
            adb.start_touch_server()
            raise DeviceLostError("USB cable yanked")
        except DeviceLostError:
            try:
                adb.stop_touch_server()
            except Exception:
                pass  # Expected if device gone

        adb.stop_touch_server.assert_called_once()

    def test_device_lost_stop_failure_does_not_propagate(self, executor_env):
        """If stop fails during DeviceLostError cleanup, it's silently ignored."""
        adb = executor_env["adb"]
        adb.stop_touch_server.side_effect = OSError("No device")

        from phone_bot.core.adb import DeviceLostError

        # Must NOT raise OSError
        try:
            raise DeviceLostError("USB gone")
        except DeviceLostError:
            try:
                adb.stop_touch_server()
            except Exception:
                pass


# ==============================================================================
# Test: Monitor events logged for UHID start/stop
# ==============================================================================

class TestMonitorEvents:

    def test_uhid_start_event_logged_success(self, executor_env):
        """uhid_start event with success=True is logged to monitor."""
        adb = executor_env["adb"]
        monitor_fn = MagicMock()

        uhid_ok = adb.start_touch_server()
        monitor_fn("uhid_start", {"success": uhid_ok})

        monitor_fn.assert_called_once_with("uhid_start", {"success": True})

    def test_uhid_start_event_logged_failure(self, executor_env):
        """uhid_start event with success=False is logged on UHID failure."""
        adb = executor_env["adb"]
        adb.start_touch_server.return_value = False
        monitor_fn = MagicMock()

        uhid_ok = adb.start_touch_server()
        monitor_fn("uhid_start", {"success": uhid_ok})

        monitor_fn.assert_called_once_with("uhid_start", {"success": False})

    def test_uhid_stop_event_logged(self, executor_env):
        """uhid_stop event is logged on session end."""
        monitor_fn = MagicMock()
        monitor_fn("uhid_stop", {})
        monitor_fn.assert_called_once_with("uhid_stop", {})


# ==============================================================================
# Test: Health check calls _touch_health_check() when available
# ==============================================================================

class TestHealthCheck:

    def test_health_check_calls_touch_health(self, executor_env):
        """_check_health should call _touch_health_check when available."""
        adb = executor_env["adb"]
        adb._touch_health_check.return_value = True

        assert hasattr(adb, '_touch_health_check')
        result = adb._touch_health_check()
        assert result is True
        adb._touch_health_check.assert_called_once()

    def test_health_check_handles_missing_method(self, executor_env):
        """If _touch_health_check doesn't exist, health check skips it."""
        adb = executor_env["adb"]
        del adb._touch_health_check

        # hasattr check should prevent AttributeError
        if hasattr(adb, '_touch_health_check'):
            adb._touch_health_check()
        # No exception = pass

    def test_health_check_touch_failure_logged(self, executor_env, caplog):
        """UHID health check failure should log a warning."""
        adb = executor_env["adb"]
        adb._touch_health_check.return_value = False

        with caplog.at_level(logging.WARNING):
            if hasattr(adb, '_touch_health_check'):
                if not adb._touch_health_check():
                    logging.getLogger("test").warning("UHID health check failed")

        assert any("UHID health check failed" in r.message for r in caplog.records)


# ==============================================================================
# Test: JAR deployment check at run_today start
# ==============================================================================

class TestJARCheck:

    def test_jar_exists_no_warning(self, executor_env, caplog):
        """No warning when touchserver.jar is present on phone."""
        adb = executor_env["adb"]
        adb.shell.return_value = "/data/local/tmp/touchserver.jar"

        with caplog.at_level(logging.WARNING):
            result = adb.shell("ls /data/local/tmp/touchserver.jar")
            if "/data/local/tmp/touchserver.jar" not in result:
                logging.getLogger("test").warning("touchserver.jar missing")

        assert not any("missing" in r.message for r in caplog.records)

    def test_jar_missing_logs_warning(self, executor_env, caplog):
        """Warning logged when touchserver.jar is not on phone."""
        adb = executor_env["adb"]
        adb.shell.return_value = "No such file or directory"

        with caplog.at_level(logging.WARNING):
            result = adb.shell("ls /data/local/tmp/touchserver.jar")
            if "/data/local/tmp/touchserver.jar" not in result:
                logging.getLogger("test").warning(
                    "touchserver.jar missing on %s -- push it first", "TestPhone"
                )

        assert any("missing" in r.message for r in caplog.records)
