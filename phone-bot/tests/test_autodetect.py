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


# ---------------------------------------------------------------------------
# Section 03 — Serial-based device discovery
# ---------------------------------------------------------------------------

def _fake_adb_devices_output(*serials):
    """Build fake `adb devices -l` stdout with given serials."""
    lines = ["List of devices attached"]
    for s in serials:
        lines.append(f"{s}             device usb:1-1 product:model transport_id:1")
    return "\n".join(lines) + "\n"


def _fake_getprop(model="SM-G965F"):
    """Build fake `adb shell getprop ro.product.model` stdout."""
    return model + "\n"


class TestDiscoverDevicesPathA:
    """Path A: phone with pre-set adb_serial."""

    @patch("core.adb.subprocess")
    def test_preset_serial_connected(self, mock_adb_subprocess):
        """Phone with adb_serial set + serial connected -> ADBController created."""
        from main_discovery import discover_devices
        from core.adb import ADBController

        phones = [_full_phone_config(id=1, adb_serial="ABC123", model="SM-G965F")]
        mock_run = _make_mock_run()

        with patch("main_discovery.subprocess") as mock_sp, \
             patch("main_discovery.PHONES", phones), \
             patch.object(ADBController, '_run', mock_run):
            # adb devices returns ABC123
            mock_sp.run.return_value = MagicMock(
                stdout=_fake_adb_devices_output("ABC123"),
                returncode=0
            )
            result = discover_devices()

        assert 1 in result
        assert result[1].serial == "ABC123"

    @patch("core.adb.subprocess")
    def test_preset_serial_not_connected(self, mock_adb_subprocess):
        """Phone with adb_serial set + serial NOT connected -> skipped."""
        from main_discovery import discover_devices

        phones = [_full_phone_config(id=1, adb_serial="ABC123")]

        with patch("main_discovery.subprocess") as mock_sp, \
             patch("main_discovery.PHONES", phones):
            mock_sp.run.return_value = MagicMock(
                stdout=_fake_adb_devices_output("OTHER999"),
                returncode=0
            )
            result = discover_devices()

        assert 1 not in result


class TestDiscoverDevicesPathB:
    """Path B: phone with adb_serial=None, model matching."""

    @patch("core.adb.subprocess")
    def test_model_matching(self, mock_adb_subprocess):
        """Phone with adb_serial=None + model set -> matched via getprop."""
        from main_discovery import discover_devices
        from core.adb import ADBController

        phones = [_full_phone_config(id=1, adb_serial=None, model="SM-G965F")]
        mock_run = _make_mock_run()

        with patch("main_discovery.subprocess") as mock_sp, \
             patch("main_discovery.PHONES", phones), \
             patch.object(ADBController, '_run', mock_run):
            def fake_subprocess_run(cmd, **kwargs):
                cmd_str = " ".join(cmd)
                if "devices" in cmd_str:
                    return MagicMock(stdout=_fake_adb_devices_output("SER001"), returncode=0)
                if "getprop" in cmd_str:
                    return MagicMock(stdout=_fake_getprop("SM-G965F"), returncode=0)
                return MagicMock(stdout="", returncode=0)
            mock_sp.run.side_effect = fake_subprocess_run
            result = discover_devices()

        assert 1 in result


class TestDiscoverDevicesPathC:
    """Path C: phone with adb_serial=None + model unknown."""

    @patch("core.adb.subprocess")
    def test_no_serial_no_model_skipped(self, mock_adb_subprocess):
        """Phone with no serial and unknown model -> skipped."""
        from main_discovery import discover_devices

        phones = [_minimal_phone_config(id=5, adb_serial=None, model="unknown")]

        with patch("main_discovery.subprocess") as mock_sp, \
             patch("main_discovery.PHONES", phones):
            mock_sp.run.return_value = MagicMock(
                stdout=_fake_adb_devices_output("SER001"),
                returncode=0
            )
            result = discover_devices()

        assert 5 not in result


class TestDiscoverDevicesErrorHandling:
    """DeviceConfigError handling in discover_devices."""

    @patch("core.adb.subprocess")
    def test_device_config_error_skips_phone(self, mock_adb_subprocess):
        """ADBController raises DeviceConfigError -> phone skipped, others succeed."""
        from main_discovery import discover_devices
        from core.adb import ADBController, DeviceConfigError

        phones = [
            _full_phone_config(id=1, adb_serial="SER1"),
            _full_phone_config(id=2, adb_serial="SER2"),
        ]
        call_count = [0]
        def mock_init(self, serial, phone_config):
            call_count[0] += 1
            self.serial = serial
            self.phone = phone_config
            if serial == "SER1":
                raise DeviceConfigError("Cannot determine screen size")
            # Normal init for SER2
            self.screen_w = phone_config["screen_w"]
            self.screen_h = phone_config["screen_h"]
            self._density = phone_config.get("density", 280)

        with patch("main_discovery.subprocess") as mock_sp, \
             patch("main_discovery.PHONES", phones), \
             patch.object(ADBController, '__init__', mock_init):
            mock_sp.run.return_value = MagicMock(
                stdout=_fake_adb_devices_output("SER1", "SER2"),
                returncode=0
            )
            result = discover_devices()

        assert 1 not in result  # failed
        assert 2 in result      # succeeded

    @patch("core.adb.subprocess")
    def test_empty_adb_devices(self, mock_adb_subprocess):
        """No devices connected -> empty result."""
        from main_discovery import discover_devices

        with patch("main_discovery.subprocess") as mock_sp, \
             patch("main_discovery.PHONES", [_full_phone_config(id=1, adb_serial="SER1")]):
            mock_sp.run.return_value = MagicMock(
                stdout="List of devices attached\n\n",
                returncode=0
            )
            result = discover_devices()

        assert len(result) == 0


# ---------------------------------------------------------------------------
# Section 04 — Integration tests (full chain)
# ---------------------------------------------------------------------------

class TestPropagationChain:
    """End-to-end: normalize -> ADB init -> page_state -> coords."""

    @patch("core.adb.subprocess")
    def test_adb_init_sets_screen_params(self, mock_subprocess):
        """ADB auto-detects 1080x2340 -> adb.screen_w/h set correctly."""
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

    def test_set_screen_params_updates_nav_y(self):
        """page_state.set_screen_params() recomputes _NAV_Y and syncs to coords."""
        from core import page_state, coords

        # Save original values
        orig_nav_y = coords._nav_y

        try:
            page_state.set_screen_params(2340, 420)
            # _NAV_Y should NOT be the default 0.943
            assert coords._nav_y != 0.943
            # Should be approximately (2340 - 50*420/160) / 2340
            nav_px = 50 * 420 / 160
            expected = (2340 - nav_px) / 2340
            assert abs(coords._nav_y - expected) < 0.001
        finally:
            # Restore
            coords.set_nav_y(orig_nav_y)

    def test_coords_use_computed_nav_y(self):
        """After set_screen_params, get_coords returns correct pixel Y for nav."""
        import sys
        # Use the same module objects that page_state uses internally
        coords_mod = sys.modules.get("phone_bot.core.coords") or sys.modules.get("core.coords")
        page_state_mod = sys.modules.get("phone_bot.core.page_state") or sys.modules.get("core.page_state")

        if not coords_mod or not page_state_mod:
            from core import page_state as page_state_mod, coords as coords_mod

        orig_nav_y = coords_mod._nav_y

        try:
            page_state_mod.set_screen_params(2340, 420)
            # Compute expected nav_y
            nav_px = 50 * 420 / 160
            expected_nav_y = (2340 - nav_px) / 2340
            # Verify coords was updated
            assert abs(coords_mod._nav_y - expected_nav_y) < 0.001
            # Verify get_coords uses the updated value
            x, y = coords_mod.get_coords("tiktok", "nav_home", 1080, 2340)
            assert x == int(1080 * 0.10)
            assert y == int(2340 * expected_nav_y)
        finally:
            coords_mod.set_nav_y(orig_nav_y)

    @patch("core.adb.subprocess")
    def test_full_chain_minimal_config(self, mock_subprocess):
        """Minimal config -> normalize -> ADB init -> correct screen params."""
        from config import normalize_phone_config
        from core.adb import ADBController

        raw = {"id": 99, "adb_serial": "TEST99"}
        normalized = normalize_phone_config(raw)
        assert normalized["screen_w"] is None
        assert normalized["screen_h"] is None

        mock_run = _make_mock_run(
            size_output="Physical size: 720x1600",
            density_output="Physical density: 280"
        )
        with patch.object(ADBController, '_run', mock_run):
            ctrl = ADBController("TEST99", normalized)

        assert ctrl.screen_w == 720
        assert ctrl.screen_h == 1600
        assert ctrl._density == 280

    @patch("core.adb.subprocess")
    def test_backward_compat_full_config(self, mock_subprocess):
        """Existing full config + ADB confirms same values -> no change."""
        from core.adb import ADBController

        config = _full_phone_config(screen_w=1080, screen_h=2220, density=420)
        mock_run = _make_mock_run(
            size_output="Physical size: 1080x2220",
            density_output="Physical density: 420"
        )
        with patch.object(ADBController, '_run', mock_run):
            ctrl = ADBController("TEST", config)

        assert ctrl.screen_w == 1080
        assert ctrl.screen_h == 2220
        assert ctrl._density == 420


class TestMixedConfigs:
    """Mixed minimal/full configs in same PHONES list."""

    @patch("core.adb.subprocess")
    def test_mixed_phones_all_discovered(self, mock_subprocess):
        """3 phones: minimal + full + partial (screen_w only) all resolve."""
        from core.adb import ADBController

        phones = [
            {"id": 1, "adb_serial": "S1", "screen_w": None, "screen_h": None, "density": None,
             "name": "Phone 1", "model": "unknown"},
            {"id": 2, "adb_serial": "S2", "screen_w": 1080, "screen_h": 2220, "density": 420,
             "name": "Galaxy S9", "model": "SM-G965F"},
            {"id": 3, "adb_serial": "S3", "screen_w": 1080, "screen_h": None, "density": None,
             "name": "Partial", "model": "unknown"},
        ]
        mock_run = _make_mock_run(
            size_output="Physical size: 720x1600",
            density_output="Physical density: 280"
        )

        results = []
        with patch.object(ADBController, '_run', mock_run):
            for phone in phones:
                ctrl = ADBController(phone["adb_serial"], phone)
                results.append(ctrl)

        # All 3 should get ADB-detected values (ADB always wins)
        for ctrl in results:
            assert ctrl.screen_w == 720
            assert ctrl.screen_h == 1600

    @patch("core.adb.subprocess")
    def test_minimal_same_coords_as_full(self, mock_subprocess):
        """Minimal and full configs with same ADB values produce same coords."""
        from core.adb import ADBController
        from core import coords, page_state
        from core.coords import get_coords

        mock_run = _make_mock_run(
            size_output="Physical size: 1080x2340",
            density_output="Physical density: 420"
        )

        orig_nav_y = coords._nav_y

        try:
            with patch.object(ADBController, '_run', mock_run):
                ctrl_minimal = ADBController("S1", _minimal_phone_config())
                ctrl_full = ADBController("S2", _full_phone_config(screen_w=1080, screen_h=2340, density=420))

            # Both should have same screen params
            assert ctrl_minimal.screen_w == ctrl_full.screen_w
            assert ctrl_minimal.screen_h == ctrl_full.screen_h
            assert ctrl_minimal._density == ctrl_full._density

            # After set_screen_params, coords should be identical
            page_state.set_screen_params(ctrl_minimal.screen_h, ctrl_minimal._density)
            x1, y1 = get_coords("tiktok", "nav_home", ctrl_minimal.screen_w, ctrl_minimal.screen_h)
            x2, y2 = get_coords("tiktok", "nav_home", ctrl_full.screen_w, ctrl_full.screen_h)
            assert (x1, y1) == (x2, y2)
        finally:
            coords.set_nav_y(orig_nav_y)


class TestPhonesNormalized:
    """Verify that the PHONES list is normalized at module level."""

    def test_all_phones_have_all_keys(self):
        """Every entry in PHONES has all 7 required keys after normalization."""
        from config import PHONES
        required_keys = {"id", "name", "model", "adb_serial", "screen_w", "screen_h", "density"}
        for phone in PHONES:
            missing = required_keys - set(phone.keys())
            assert not missing, f"Phone {phone.get('id', '?')} missing keys: {missing}"
