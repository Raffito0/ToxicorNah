"""Tests for device auto-detect: config normalization, ADB detection, serial discovery."""
import copy
from unittest.mock import patch, MagicMock
import pytest


# ---------------------------------------------------------------------------
# Section 01 — normalize_phone_config
# ---------------------------------------------------------------------------

class TestNormalizePhoneConfig:
    """Tests for the normalize_phone_config function in config.py."""

    @pytest.fixture(autouse=True)
    def _import_normalize(self):
        from config import normalize_phone_config
        self.normalize = normalize_phone_config

    def test_minimal_config_gets_defaults(self):
        """Minimal config (id + adb_serial only) gets all defaults filled."""
        result = self.normalize({"id": 99, "adb_serial": "TEST123"})
        assert result["id"] == 99
        assert result["adb_serial"] == "TEST123"
        assert result["name"] == "Phone 99"
        assert result["model"] == "unknown"
        assert result["screen_w"] is None
        assert result["screen_h"] is None
        assert result["density"] is None

    def test_full_config_preserved(self):
        """Full config with all fields preserves every value unchanged."""
        full = {
            "id": 1,
            "name": "Galaxy S9+",
            "model": "SM-G965F",
            "adb_serial": "R58M1234",
            "screen_w": 1080,
            "screen_h": 2220,
            "density": 420,
        }
        result = self.normalize(copy.deepcopy(full))
        for key in full:
            assert result[key] == full[key], f"Key {key} changed"

    def test_name_defaults_to_phone_id(self):
        """Missing name defaults to 'Phone {id}'."""
        result = self.normalize({"id": 7, "adb_serial": "S"})
        assert result["name"] == "Phone 7"

    def test_model_defaults_to_unknown(self):
        """Missing model defaults to 'unknown'."""
        result = self.normalize({"id": 1, "adb_serial": "S"})
        assert result["model"] == "unknown"

    def test_screen_params_default_to_none(self):
        """Missing screen_w/screen_h/density default to None."""
        result = self.normalize({"id": 1, "adb_serial": "S"})
        assert result["screen_w"] is None
        assert result["screen_h"] is None
        assert result["density"] is None

    def test_missing_id_raises_key_error(self):
        """Missing 'id' raises KeyError."""
        with pytest.raises(KeyError):
            self.normalize({"adb_serial": "S"})

    def test_missing_adb_serial_raises_key_error(self):
        """Missing 'adb_serial' raises KeyError."""
        with pytest.raises(KeyError):
            self.normalize({"id": 1})

    def test_returns_new_dict(self):
        """normalize_phone_config returns a new dict, not a mutation of input."""
        original = {"id": 5, "adb_serial": "X"}
        result = self.normalize(original)
        assert result is not original


# ---------------------------------------------------------------------------
# Section 02 — ADB screen auto-detect helpers
# ---------------------------------------------------------------------------

class TestParseWmSize:
    """Tests for _parse_wm_size helper."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from core.adb import _parse_wm_size
        self.parse = _parse_wm_size

    def test_physical_and_override_returns_override(self):
        output = "Physical size: 1080x2220\nOverride size: 1080x2340"
        assert self.parse(output) == (1080, 2340)

    def test_physical_only(self):
        output = "Physical size: 1080x2220"
        assert self.parse(output) == (1080, 2220)

    def test_override_only(self):
        output = "Override size: 720x1600"
        assert self.parse(output) == (720, 1600)

    def test_override_before_physical(self):
        output = "Override size: 1080x2340\nPhysical size: 1080x2220"
        assert self.parse(output) == (1080, 2340)

    def test_garbage_returns_none(self):
        assert self.parse("some random text") is None

    def test_empty_returns_none(self):
        assert self.parse("") is None


class TestParseWmDensity:
    """Tests for _parse_wm_density helper."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from core.adb import _parse_wm_density
        self.parse = _parse_wm_density

    def test_physical_and_override_returns_override(self):
        output = "Physical density: 420\nOverride density: 280"
        assert self.parse(output) == 280

    def test_physical_only(self):
        output = "Physical density: 420"
        assert self.parse(output) == 420

    def test_garbage_returns_none(self):
        assert self.parse("no density here") is None


# ---------------------------------------------------------------------------
# Section 02 — ADB sanity checks + fallback chain
# ---------------------------------------------------------------------------

def _make_mock_run(size_output="Physical size: 1080x2340",
                   density_output="Physical density: 420"):
    """Returns a function that mimics ADBController._run() for wm commands."""
    def mock_run(self_or_args, args=None, timeout=15):
        # Handle both bound method (self, args) and direct call patterns
        if args is None:
            actual_args = self_or_args
        else:
            actual_args = args
        cmd = " ".join(actual_args)
        if "wm size" in cmd:
            return size_output
        if "wm density" in cmd:
            return density_output
        return ""
    return mock_run


def _full_phone_config(**overrides):
    base = {
        "id": 1, "name": "Test", "model": "test", "adb_serial": "TEST123",
        "screen_w": 1080, "screen_h": 2220, "density": 420,
    }
    base.update(overrides)
    return base


def _minimal_phone_config(**overrides):
    base = {
        "id": 1, "name": "Phone 1", "model": "unknown", "adb_serial": "TEST123",
        "screen_w": None, "screen_h": None, "density": None,
    }
    base.update(overrides)
    return base


class TestADBSanityChecks:
    """Sanity check validation for detected screen params."""

    @pytest.fixture(autouse=True)
    def _import(self):
        from core.adb import _parse_wm_size
        self.parse = _parse_wm_size

    def test_width_zero_fails_sanity(self):
        result = self.parse("Physical size: 0x2340")
        # Parser returns the values; sanity check is in __init__
        assert result == (0, 2340)

    def test_normal_values_pass(self):
        result = self.parse("Physical size: 1080x2340")
        assert result == (1080, 2340)


class TestADBFallbackChain:
    """Test ADB detection -> config fallback -> DeviceConfigError chain."""

    @patch("core.adb.subprocess")
    def test_adb_success_overrides_config(self, mock_subprocess):
        """ADB succeeds -> uses detected values, ignores config."""
        from core.adb import ADBController
        mock_run = _make_mock_run(
            size_output="Physical size: 720x1600",
            density_output="Physical density: 280"
        )
        with patch.object(ADBController, '_run', mock_run):
            ctrl = ADBController("TEST", _full_phone_config())
        assert ctrl.screen_w == 720
        assert ctrl.screen_h == 1600
        assert ctrl._density == 280

    @patch("core.adb.subprocess")
    def test_adb_fails_uses_config(self, mock_subprocess):
        """ADB fails -> uses config values."""
        from core.adb import ADBController
        mock_run = _make_mock_run(size_output="", density_output="")
        with patch.object(ADBController, '_run', mock_run):
            ctrl = ADBController("TEST", _full_phone_config())
        assert ctrl.screen_w == 1080
        assert ctrl.screen_h == 2220

    @patch("core.adb.subprocess")
    def test_adb_fails_config_none_raises(self, mock_subprocess):
        """ADB fails + config is None -> raises DeviceConfigError."""
        from core.adb import ADBController, DeviceConfigError
        mock_run = _make_mock_run(size_output="", density_output="")
        with patch.object(ADBController, '_run', mock_run):
            with pytest.raises(DeviceConfigError):
                ADBController("TEST", _minimal_phone_config())

    @patch("core.adb.subprocess")
    def test_adb_detects_different_than_config(self, mock_subprocess):
        """ADB detects different values than config -> ADB wins."""
        from core.adb import ADBController
        mock_run = _make_mock_run(
            size_output="Physical size: 720x1600",
            density_output="Physical density: 280"
        )
        with patch.object(ADBController, '_run', mock_run):
            ctrl = ADBController("TEST", _full_phone_config(screen_w=1080, screen_h=2340, density=420))
        assert ctrl.screen_w == 720  # ADB wins
        assert ctrl.screen_h == 1600
        assert ctrl._density == 280

    @patch("core.adb.subprocess")
    def test_minimal_config_working_adb(self, mock_subprocess):
        """Minimal config (None screen params) + working ADB -> auto-detected."""
        from core.adb import ADBController
        mock_run = _make_mock_run(
            size_output="Physical size: 1080x2340",
            density_output="Physical density: 420"
        )
        with patch.object(ADBController, '_run', mock_run):
            ctrl = ADBController("TEST", _minimal_phone_config())
        assert ctrl.screen_w == 1080
        assert ctrl.screen_h == 2340
        assert ctrl._density == 420

    @patch("core.adb.subprocess")
    def test_sanity_fail_falls_to_config(self, mock_subprocess):
        """ADB returns insane values -> falls back to config."""
        from core.adb import ADBController
        mock_run = _make_mock_run(
            size_output="Physical size: 0x99999",
            density_output="Physical density: 420"
        )
        with patch.object(ADBController, '_run', mock_run):
            ctrl = ADBController("TEST", _full_phone_config())
        assert ctrl.screen_w == 1080  # config fallback
        assert ctrl.screen_h == 2220

    @patch("core.adb.subprocess")
    def test_density_default_280_when_all_fail(self, mock_subprocess):
        """Density defaults to 280 when ADB and config both fail."""
        from core.adb import ADBController
        mock_run = _make_mock_run(
            size_output="Physical size: 1080x2340",
            density_output=""
        )
        with patch.object(ADBController, '_run', mock_run):
            ctrl = ADBController("TEST", _minimal_phone_config())
        assert ctrl._density == 280

    @patch("core.adb.subprocess")
    def test_run_exception_falls_to_config(self, mock_subprocess):
        """_run raising exception falls back to config values."""
        from core.adb import ADBController
        def mock_run_raise(self_unused, args=None, timeout=15):
            raise subprocess.TimeoutExpired(cmd="adb", timeout=5)
        import subprocess
        with patch.object(ADBController, '_run', mock_run_raise):
            ctrl = ADBController("TEST", _full_phone_config())
        assert ctrl.screen_w == 1080
        assert ctrl.screen_h == 2220

    @patch("core.adb.subprocess")
    def test_run_exception_config_none_raises(self, mock_subprocess):
        """_run raising exception + config None -> DeviceConfigError."""
        from core.adb import ADBController, DeviceConfigError
        import subprocess
        def mock_run_raise(self_unused, args=None, timeout=15):
            raise subprocess.TimeoutExpired(cmd="adb", timeout=5)
        with patch.object(ADBController, '_run', mock_run_raise):
            with pytest.raises(DeviceConfigError):
                ADBController("TEST", _minimal_phone_config())


class TestPhonesNormalized:
    """Verify that the PHONES list is normalized at module level."""

    def test_all_phones_have_all_keys(self):
        """Every entry in PHONES has all 7 required keys after normalization."""
        from config import PHONES
        required_keys = {"id", "name", "model", "adb_serial", "screen_w", "screen_h", "density"}
        for phone in PHONES:
            missing = required_keys - set(phone.keys())
            assert not missing, f"Phone {phone.get('id', '?')} missing keys: {missing}"
