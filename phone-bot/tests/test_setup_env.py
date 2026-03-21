"""Tests for setup_env.py and executor import cleanup.

Run with: pytest phone-bot/tests/test_setup_env.py -v
"""
import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest

# ── helpers ──────────────────────────────────────────────────────────────────

PHONE_BOT_DIR = Path(__file__).parent.parent
ENV_TEMPLATE = PHONE_BOT_DIR / ".env.template"
SETUP_ENV_PATH = PHONE_BOT_DIR / "setup_env.py"

REQUIRED_VARS = [
    "AIRTABLE_API_KEY",
    "PROXY_USERNAME",
    "PROXY_PASSWORD",
    "PROXY_ROTATION_TOKEN",
    "HOTSPOT_SSID",
    "HOTSPOT_PASSWORD",
    "GEMINI_API_KEY",
    "PHONEBOT_TELEGRAM_TOKEN",
    "PHONEBOT_TELEGRAM_CHAT",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_URL",
]

OPTIONAL_VARS = [
    "ADB_SERIAL_PHONE1",
    "ADB_SERIAL_PHONE2",
    "ADB_SERIAL_PHONE3",
]


def _load_setup_env():
    """Import setup_env.py as a module (it lives in phone-bot/, not tests/)."""
    spec = importlib.util.spec_from_file_location("setup_env", SETUP_ENV_PATH)
    assert spec is not None and spec.loader is not None, "Could not load setup_env.py"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


@pytest.fixture()
def full_env(monkeypatch):
    """Patch os.environ with all required + optional vars set to dummy values."""
    for var in REQUIRED_VARS:
        monkeypatch.setenv(var, f"test_value_{var}")
    for var in OPTIONAL_VARS:
        monkeypatch.setenv(var, f"test_serial_{var}")
    yield


@pytest.fixture()
def env_without_optional(monkeypatch):
    """Required vars present, optional (ADB serials) absent."""
    for var in REQUIRED_VARS:
        monkeypatch.setenv(var, f"test_value_{var}")
    for var in OPTIONAL_VARS:
        monkeypatch.delenv(var, raising=False)
    yield


# ── tests ────────────────────────────────────────────────────────────────────


def test_validate_env_passes_when_all_required_set(full_env):
    """validate_env() should not raise when all required vars are present."""
    mod = _load_setup_env()
    # Should not raise
    mod.validate_env()


def test_validate_env_raises_with_var_name_when_missing(monkeypatch):
    """validate_env() must raise ValueError containing the missing var name."""
    # Set all required vars first
    for var in REQUIRED_VARS:
        monkeypatch.setenv(var, "dummy")
    # Then remove one
    missing = "AIRTABLE_API_KEY"
    monkeypatch.delenv(missing, raising=False)

    mod = _load_setup_env()
    with pytest.raises(ValueError) as exc_info:
        mod.validate_env()

    assert missing in str(exc_info.value), (
        f"ValueError message should mention '{missing}', got: {exc_info.value}"
    )


def test_run_setup_checks_passes_when_all_mocked(full_env):
    """run_setup_checks() should return True when all connectivity checks pass."""
    mod = _load_setup_env()
    with (
        patch.object(mod, "check_adb_connections", return_value=True),
        patch.object(mod, "check_airtable", return_value=True),
        patch.object(mod, "check_proxy", return_value=True),
        patch.object(mod, "check_gemini", return_value=True),
    ):
        result = mod.run_setup_checks()
    assert result is True


def test_validate_env_does_not_fail_when_optional_vars_missing(env_without_optional, capsys):
    """validate_env() must not raise when ADB_SERIAL_PHONE* are absent."""
    mod = _load_setup_env()
    # Must not raise
    mod.validate_env()
    # Should print a warning mentioning optional vars
    captured = capsys.readouterr()
    # Accept: warning in stdout OR silence (both are valid, key thing is no exception)
    # If there's output, it should mention serial or optional
    if captured.out or captured.err:
        combined = (captured.out + captured.err).lower()
        assert any(kw in combined for kw in ["adb", "serial", "optional", "missing"]), (
            f"Unexpected output when optional vars missing: {captured.out}{captured.err}"
        )


def test_env_template_contains_all_required_vars():
    """.env.template must contain a KEY= line for each of the 15 required vars."""
    assert ENV_TEMPLATE.exists(), f".env.template not found at {ENV_TEMPLATE}"

    content = ENV_TEMPLATE.read_text(encoding="utf-8")
    lines = content.splitlines()

    # Extract var names from KEY=... lines (skip comments)
    defined_keys = set()
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key = line.split("=")[0].strip()
            defined_keys.add(key)

    for var in REQUIRED_VARS:
        assert var in defined_keys, (
            f"Required variable '{var}' not found in .env.template.\n"
            f"Defined keys: {sorted(defined_keys)}"
        )
