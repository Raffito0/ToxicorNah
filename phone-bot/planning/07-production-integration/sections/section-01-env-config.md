# Section 01 — Environment Configuration & Delivery Path Reconciliation

## Overview

This is the **first section** and a prerequisite for all others. It fixes a dead import in `executor.py`, creates a `.env.template` documenting every required variable, and adds a `setup_env.py` validation script that must pass before the first production run.

**No other section may be implemented until this one is complete.**

---

## Background

The phone-bot has two video delivery paths:

1. **Delivery module** (`Weekly & Daily Plan/delivery/`): `push_to_phone()` pushes a video to `/sdcard/DCIM/Camera/` using `ADB_SERIAL_PHONE{N}` env vars.
2. **Executor / `post_video()`**: `adb.push_file()` pushes to `/sdcard/Download/video_{timestamp}.mp4` using the already-connected ADB controller instance.

Path 2 is what actually runs. Path 1 (`push_to_phone()`) is imported in executor but **never called**. It is dead weight that creates a confusing mental model.

The delivery module's real job is three functions only: `get_next_video()` (Airtable query), `download_video()` (R2 download), and `mark_posted/draft/skipped()` (status updates). ADB push is the posting function's concern.

---

## Tests — Write BEFORE Implementing

**File to create**: `phone-bot/tests/test_setup_env.py`

```python
# test_setup_env.py
#
# Tests for setup_env.py and executor import cleanup.
# Run with: pytest phone-bot/tests/test_setup_env.py -v

# Test: setup_env validates all required env vars are present
#   → call validate_env() with all vars set, expect no exception

# Test: setup_env raises clear error with variable name when a required var is missing
#   → monkeypatch to delete one required var, call validate_env(), expect ValueError
#   → error message must contain the missing variable name

# Test: setup_env succeeds when all required vars are set (mocked ADB/Airtable/proxy checks)
#   → mock check_adb_connections(), check_airtable(), check_proxy()
#   → call run_setup_checks(), expect True

# Test: setup_env reports which optional vars are missing (ADB_SERIAL_PHONE*) without failing
#   → delete ADB_SERIAL_PHONE1, ADB_SERIAL_PHONE2, ADB_SERIAL_PHONE3
#   → call validate_env(), expect no exception but warning in output

# Test: .env.template contains all variables listed in the plan
#   → parse phone-bot/.env.template line by line
#   → assert each of the 15 required var names is present as a KEY= line
```

**File to create**: `phone-bot/tests/test_executor_imports.py`

```python
# test_executor_imports.py
#
# Tests that executor.py no longer imports push_to_phone.

# Test: executor imports do NOT include push_to_phone
#   → import phone-bot.planner.executor module (or parse its source with importlib)
#   → assert "push_to_phone" NOT in dir(executor) or executor's globals

# Test: executor still has access to the 3 valid delivery functions
#   → assert get_next_video is importable via executor (or directly from delivery)
#   → assert download_video is importable
#   → assert mark_posted is importable
```

**Test infrastructure**: Create `phone-bot/tests/conftest.py` with shared fixtures (mock Airtable client, mock ADB, mock env vars). This conftest will be reused by all sections.

---

## Implementation

### 1. Fix `executor.py` — Remove `push_to_phone`

**File**: `phone-bot/planner/executor.py`

Find the delivery import line (search for `push_to_phone` in the import block):

```python
# Current — CHANGE THIS:
from delivery import get_next_video, download_video, push_to_phone, mark_posted, mark_draft, mark_skipped

# New:
from delivery import get_next_video, download_video, mark_posted, mark_draft, mark_skipped
```

Also update the fallback `except ImportError` stub below it — remove `push_to_phone` from any `None` assignments in the stub chain.

Verify no other call site in `executor.py` references `push_to_phone` (current research shows none).

### 2. Create `.env.template`

**File to create**: `phone-bot/.env.template`

```dotenv
# =============================================================================
# Phone-Bot Production Environment Variables
# Copy to .env and fill in all values before running setup_env.py
# =============================================================================

# --- Core mode ---------------------------------------------------------------
# Set to 0 for production. 1 = test mode (skip proxy, local WiFi, verbose logs)
PHONEBOT_TEST=0

# --- Airtable ----------------------------------------------------------------
# Personal Access Token from airtable.com/create/tokens
AIRTABLE_API_KEY=pat...

# --- Proxy (SOCKS5 via sinister.services) ------------------------------------
PROXY_USERNAME=...
PROXY_PASSWORD=...
# Token for calling the rotation API endpoint
PROXY_ROTATION_TOKEN=...
# Windows hotspot name and password that phones connect to for proxy traffic
HOTSPOT_SSID=PhoneBot_Proxy
HOTSPOT_PASSWORD=...

# --- Gemini Vision -----------------------------------------------------------
GEMINI_API_KEY=AIza...

# --- Telegram Monitoring (production alerts and daily summaries) -------------
PHONEBOT_TELEGRAM_TOKEN=123:ABC...
PHONEBOT_TELEGRAM_CHAT=123456789

# --- Cloudflare R2 (Content Library video storage) ---------------------------
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_URL=https://pub-...r2.dev

# --- ADB Serial Numbers (optional, for direct delivery module calls) ---------
# Find with: adb devices (when phones are connected via USB)
# The executor manages ADB internally; these are only needed if calling
# the delivery module's push_to_phone() directly (currently not used).
ADB_SERIAL_PHONE1=
ADB_SERIAL_PHONE2=
ADB_SERIAL_PHONE3=
```

### 3. Create `setup_env.py`

**File to create**: `phone-bot/setup_env.py`

This script is run once before the first production deployment. It validates configuration end-to-end and exits with a clear error if anything is wrong.

```python
#!/usr/bin/env python3
"""
setup_env.py — Pre-production environment validator.

Usage:
    python phone-bot/setup_env.py

Checks:
  1. All required env vars are set (non-empty)
  2. ADB devices are reachable (lists connected phones)
  3. Airtable API key is valid (simple GET request)
  4. Proxy host is reachable (TCP connect, not proxy auth)
  5. Gemini API key is valid (simple models list call)

Exit codes:
  0 = all checks passed
  1 = one or more checks failed
"""

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


def validate_env() -> list[str]:
    """Check all required env vars. Raises ValueError with missing var name if any absent."""
    ...


def check_adb_connections() -> bool:
    """Run `adb devices` and report found phones. Non-fatal if none."""
    ...


def check_airtable(api_key: str) -> bool:
    """GET /v0/meta/bases — validates API key. Returns True on 200."""
    ...


def check_proxy(host: str, port: int) -> bool:
    """TCP connect to proxy host:port. Returns True if reachable."""
    ...


def check_gemini(api_key: str) -> bool:
    """List Gemini models — validates API key. Returns True on 200."""
    ...


def run_setup_checks() -> bool:
    """
    Run all checks in order. Print pass/fail for each.
    Returns True only if all required checks pass.
    """
    ...


if __name__ == "__main__":
    import sys
    success = run_setup_checks()
    sys.exit(0 if success else 1)
```

**Key design decisions**:
- `validate_env()` raises `ValueError` with the missing variable name when a required var is absent.
- ADB serial vars (`ADB_SERIAL_PHONE*`) are optional — missing them prints a warning but does not fail.
- Connectivity checks (`check_airtable`, `check_proxy`, `check_gemini`) are isolated functions so they can be mocked in tests.
- Run from project root: `python phone-bot/setup_env.py`.

### 4. Create `phone-bot/tests/` directory

**File to create**: `phone-bot/tests/__init__.py` (empty)

**File to create**: `phone-bot/tests/conftest.py`

The conftest should provide:
- `mock_env` fixture: patches `os.environ` with all required vars set to test values
- `mock_airtable` fixture: mock responses for Airtable API calls
- `mock_adb` fixture: mock subprocess for `adb devices` and `adb shell` calls

---

## Acceptance Criteria

- [ ] `pytest phone-bot/tests/test_setup_env.py -v` — all tests pass
- [ ] `pytest phone-bot/tests/test_executor_imports.py -v` — all tests pass
- [ ] `grep push_to_phone phone-bot/planner/executor.py` returns no results
- [ ] `phone-bot/.env.template` exists and contains all 15 variable names
- [ ] `python phone-bot/setup_env.py` (with valid `.env`) exits with code 0
- [ ] `python phone-bot/setup_env.py` (with a missing required var) exits with code 1 and prints the variable name

---

## Dependencies

None — this section has no prerequisites.

## Blocks

All other sections depend on this one.
