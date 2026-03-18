# Section 03: Serial-Based Device Discovery (main.py)

## Overview

Rewrite `discover_devices()` in `phone-bot/main.py` to support three device-discovery paths, checked in priority order:

- **Path A (pre-set serial)**: If `phone["adb_serial"]` is set, check if that serial is connected. If yes, create `ADBController`. If not, log WARNING and skip.
- **Path B (model matching)**: If `adb_serial` is `None` but `model` is set (not `"unknown"`), run existing model-matching logic.
- **Path C (no serial, no model)**: If both missing/unknown, log WARNING and skip.

Additionally, `ADBController` creation is wrapped in try/except for `DeviceConfigError` so one bad phone doesn't crash everything.

## Dependencies

- **Section 01 (config-schema)**: `normalize_phone_config()` exists, PHONES normalized at import time
- **Section 02 (adb-autodetect)**: `DeviceConfigError` defined in `core/adb.py`

## File to Modify

`phone-bot/main.py` — rewrite `discover_devices()`, update import line

## Import Changes

Current import:
```python
from .core.adb import ADBController, DeviceLostError
```

Add `DeviceConfigError`:
```python
from .core.adb import ADBController, DeviceLostError, DeviceConfigError
```

## Tests (Write First)

Add to `phone-bot/tests/test_autodetect.py`:

```python
# --- Path A: pre-set serial ---
# Test: phone with adb_serial="ABC123" + "ABC123" connected -> ADBController created
# Test: phone with adb_serial="ABC123" + "ABC123" NOT connected -> warning, skipped
# Test: phone with pre-set serial skips model query entirely

# --- Path B: model matching ---
# Test: phone with adb_serial=None + model="SM-S901B" -> model matched, serial assigned
# Test: existing behavior preserved for phones with model

# --- Path C: no serial, no model ---
# Test: phone with adb_serial=None + model="unknown" -> warning, skipped

# --- DeviceConfigError handling ---
# Test: ADBController raises DeviceConfigError -> phone skipped, CRITICAL logged
# Test: one phone fails, two others succeed -> result has 2 phones

# --- Edge cases ---
# Test: empty adb devices -> returns empty dict
```

### Mocking Strategy

Mock `subprocess.run` for `adb devices` and `adb shell getprop` output. Mock `ADBController.__init__` to avoid actual ADB calls.

## Implementation Details

### Two-Pass Discovery

**First pass (Path A)**: Iterate PHONES, handle all phones with pre-set `adb_serial`. Track claimed serials in `matched_serials` set.

**Second pass (Path B + C)**: Iterate PHONES again for phones without `adb_serial`. For Path B, only query model on serials NOT in `matched_serials`.

The two-pass approach ensures Path A phones claim their serials before Path B tries model matching on those same serials.

### DeviceConfigError Handling

Wrap every `ADBController()` call:
```python
try:
    ctrl = ADBController(serial, phone)
except DeviceConfigError as e:
    log.critical("Phone %s: %s -- skipping", phone["name"], e)
    continue
```

### Logging Examples

```
INFO  Phone 2: serial ABC123 connected (pre-configured)
WARNING  Phone 2: expected serial ABC123 not connected, skipping
INFO  Found Phone 1: Phone 1 (SM-G965F) [DEF456]
WARNING  Phone 5: no serial and no model configured, cannot discover
CRITICAL  Phone 3: Device screen parameters cannot be determined -- skipping
WARNING  Unknown device: XYZ789 (Pixel 6)
```

### Key Behavioral Changes

- Path A phones skip model query entirely (faster, avoids model-matching ambiguity)
- `DeviceConfigError` caught per-phone (no global crash)
- Unknown connected devices still logged

## Implementation Notes (Post-Review)

### Deviation from plan: separate module
Plan said modify main.py only. Implementation created `main_discovery.py` as a separate module with the discovery logic, imported by main.py. This avoids heavy import-time side effects in main.py making testing impossible.

### Deviation from plan: try/except imports
main_discovery.py uses try/except for both relative (when imported from main.py) and absolute (when imported from tests) imports.

### Files created
- `phone-bot/main_discovery.py` — discover_devices() implementation

### Files modified
- `phone-bot/main.py` — imports discover_devices from main_discovery, removed inline copy
- `phone-bot/tests/test_autodetect.py` — 6 new discovery tests (35 total)
- `phone-bot/tests/conftest.py` — registers main_discovery module

### Test count: 35 (all passing)

## Blocked By

Section 01, Section 02

## Blocks

Section 04 (integration tests)
