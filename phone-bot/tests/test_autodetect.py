"""Tests for device auto-detect: config normalization, ADB detection, serial discovery."""
import copy
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


class TestPhonesNormalized:
    """Verify that the PHONES list is normalized at module level."""

    def test_all_phones_have_all_keys(self):
        """Every entry in PHONES has all 7 required keys after normalization."""
        from config import PHONES
        required_keys = {"id", "name", "model", "adb_serial", "screen_w", "screen_h", "density"}
        for phone in PHONES:
            missing = required_keys - set(phone.keys())
            assert not missing, f"Phone {phone.get('id', '?')} missing keys: {missing}"
