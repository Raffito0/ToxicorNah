# Section 07: Testing

## Overview

Comprehensive test suite for the UHID touch engine. Unit tests (pytest, mock-based) for the Python side, plus hardware integration tests for real-phone validation.

## Background

The phone-bot uses pytest with a custom `conftest.py` that registers modules for import. Tests live in `phone-bot/tests/`. Real-phone tests are separate scripts in `phone-bot/tools/` (not pytest).

**Existing test patterns:**
- `conftest.py` registers `core.adb`, `core.human`, etc. in `sys.modules`
- ADB commands mocked via `@patch("core.adb.subprocess")`
- Log-normal timing tested with statistical sampling (100+ samples)

## What to Build

### 1. Protocol Tests (`tests/test_touch_protocol.py`)

Tests the command format and mapping math that both Python client and Java server must agree on:

```python
# --- Coordinate Mapping ---
# Test: pixel (0, 0) maps to HID (0, 0)
# Test: pixel (screenW, screenH) maps to HID (4095, 4095)
# Test: pixel (screenW/2, screenH/2) maps to HID (2047 or 2048, 2047 or 2048)
# Test: negative pixel coordinates clamped to 0
# Test: pixel > screen clamped to screen dimensions

# --- Pressure Mapping ---
# Test: float 0.0 → int 0
# Test: float 1.0 → int 255
# Test: float 0.5 → int 127 or 128
# Test: float > 1.0 clamped to 255
# Test: float < 0.0 clamped to 0

# --- Command Format ---
# Test: TAP command string is "TAP {x} {y} {pressure:.2f} {area} {hold_ms}\n"
# Test: SWIPE command string is "SWIPE {x1} {y1} {x2} {y2} {dur} {pressure:.2f}\n"
# Test: PING command is "PING\n"
# Test: DESTROY command is "DESTROY\n"

# --- Response Parsing ---
# Test: "PONG\n" is valid PING response
# Test: "OK 85\n" parsed as success with duration 85
# Test: "ERR bad command\n" parsed as error
```

### 2. Client Tests (`tests/test_touch_client.py`)

Tests the Python socket client in `adb.py` with mocked socket:

```python
# --- Lifecycle ---
# Test: start_touch_server() runs adb shell with correct CLASSPATH command
# Test: start_touch_server() calls adb forward with tcp:0
# Test: start_touch_server() parses port number from forward output
# Test: start_touch_server() connects socket to localhost:port
# Test: start_touch_server() sends PING and expects PONG
# Test: start_touch_server() returns True on success
# Test: start_touch_server() returns False when JAR not found on phone
# Test: start_touch_server() returns False when adb forward fails
# Test: start_touch_server() returns False when socket connect times out
# Test: stop_touch_server() sends DESTROY before closing socket
# Test: stop_touch_server() calls adb forward --remove
# Test: stop_touch_server() kills server process

# --- Touch Commands ---
# Test: tap() with UHID sends TAP command with correct params
# Test: tap() without UHID calls shell("input tap x y")
# Test: swipe() with UHID sends SWIPE command with correct params
# Test: swipe() with UHID does NOT add random drift
# Test: swipe() without UHID calls shell("input swipe ...") WITH legacy drift
# Test: press_back() with UHID sends SWIPE for edge gesture coordinates
# Test: press_home() with UHID sends SWIPE for bottom gesture coordinates
# Test: long_press() sends TAP with longer hold_ms
# Test: set_touch_params() stores values used by next tap()

# --- Socket Timeout ---
# Test: TAP with hold_ms=100 sets timeout to 2.1s
# Test: SWIPE with dur=500 sets timeout to 2.5s
# Test: PING sets timeout to 1.0s
# Test: socket timeout raises ConnectionError

# --- Fallback ---
# Test: ConnectionError sets _touch_connected = False
# Test: after ConnectionError, tap() uses input tap
# Test: _handle_touch_failure() attempts reconnect once
# Test: successful reconnect sets _touch_connected = True
# Test: failed reconnect keeps _touch_connected = False
# Test: second failure does NOT attempt reconnect again
# Test: Telegram alert sent on first failure
```

### 3. Pressure Tests (`tests/test_touch_pressure.py`)

Tests HumanEngine pressure/area generation:

```python
# --- get_tap_pressure() ---
# Test: returns dict with keys: peak, ramp_up_ms, ramp_down_ms, hold_drift_px, area
# Test: peak in range [0.25, 0.85] (sample 100)
# Test: peak varies (std > 0.01 over 100 samples)
# Test: ramp_up_ms in range [15, 50]
# Test: ramp_down_ms in range [10, 40]
# Test: hold_drift_px in range [0, 5]
# Test: area in range [30, 70]
# Test: area positively correlated with peak (r > 0.3 over 200 samples)

# --- Fatigue/Energy Effects ---
# Test: high fatigue (0.8) increases mean peak vs low fatigue (0.1)
# Test: low energy (0.3) decreases mean peak vs high energy (0.9)
# Test: high fatigue increases mean ramp_up_ms (slower)

# --- get_swipe_pressure() ---
# Test: returns dict with peak and area
# Test: peak in valid range
# Test: area proportional to peak

# --- humanize_swipe() Integration ---
# Test: return dict includes pressure_peak field
# Test: return dict includes area field
# Test: pressure_peak is float in [0.25, 0.85]

# --- Config ---
# Test: HUMAN dict has touch_pressure_peak as (center, sigma, min, max) tuple
# Test: HUMAN dict has touch_ramp_up_ms tuple
# Test: HUMAN dict has touch_area_base (int)
# Test: HUMAN dict has touch_area_pressure_scale (int or float)
```

### 4. Executor Tests (`tests/test_executor_uhid.py`)

Tests touch server lifecycle in executor:

```python
# Test: execute_session() calls adb.start_touch_server()
# Test: execute_session() calls adb.stop_touch_server() in finally
# Test: start failure logs WARNING (check log capture)
# Test: start failure sends Telegram alert
# Test: start failure does NOT raise — session continues
# Test: stop failure in finally is silently caught
# Test: DeviceLostError handler calls stop_touch_server()
# Test: BotEvent("uhid_start") logged with success field
# Test: BotEvent("uhid_stop") logged
```

### 5. conftest.py Update

Register new modules for pytest import:

```python
# In phone-bot/tests/conftest.py, add:
# Register touchserver modules (if testing Java build outputs / protocol shared code)
# Register tools modules (verify_uhid)
```

### 6. Hardware Integration Tests (NOT pytest — manual scripts)

These require a real phone connected via ADB. Run via:
```
python tools/test_uhid_integration.py --serial 2aa12f822d027ece
```

**Test matrix:**

| Test | What | How to Verify |
|------|------|---------------|
| Device creation | UHID device appears | `getevent -p` shows "sec_touchscreen" |
| INPUT_PROP_DIRECT | Touchscreen classification | `getevent -p` shows `INPUT_PROP_DIRECT` |
| TAP pressure ramp | Variable pressure | MotionLogger shows increasing then decreasing pressure |
| TAP micro-drift | Position variation during hold | MotionLogger shows x/y changing ±1-3px |
| SWIPE interpolation | Smooth motion | MotionLogger shows 15+ MOVE events for 300ms swipe |
| SWIPE pressure curve | Pressure variation | Pressure low at start, peak in middle, low at end |
| Navigation back | Edge swipe works | Screen navigates back |
| Navigation home | Bottom swipe works | Returns to home screen |
| Fallback | Kill server mid-session | Next tap uses `input tap`, Telegram alert sent |
| Reconnect | Server restarted after kill | After health check, UHID resumes |
| Device cleanup | DESTROY removes device | `InputDevice.getDeviceIds()` no longer includes UHID |

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `phone-bot/tests/test_touch_protocol.py` | CREATE | Protocol format + mapping tests |
| `phone-bot/tests/test_touch_client.py` | CREATE | ADB client socket tests |
| `phone-bot/tests/test_touch_pressure.py` | CREATE | HumanEngine pressure tests |
| `phone-bot/tests/test_executor_uhid.py` | CREATE | Executor lifecycle tests |
| `phone-bot/tests/conftest.py` | MODIFY | Register new modules |

## Acceptance Criteria

- [x] All unit tests pass: `pytest tests/test_touch_*.py tests/test_executor_uhid.py -v`
- [x] Test coverage: every public method in the UHID system has at least one test
- [x] Fallback paths tested (UHID connected AND disconnected)
- [x] Statistical tests confirm pressure variability (not constant)
- [x] Hardware integration test script exists and documents full test matrix
- [x] conftest.py updated with new module registrations

## Implementation Notes (Actual)

### TDD pattern across sections

The test files for section-07 were written incrementally during prior sections (TDD-first):
- `test_touch_protocol.py` — 26 tests, written during section-02 (protocol design)
- `test_touch_client.py` — 21 tests, written during section-03 (Python client)
- `test_touch_pressure.py` — 17 tests, written during section-04 (pressure physics)
- `test_executor_uhid.py` — 17 tests, written during section-05 (executor integration)
- `test_verify_uhid.py` — 34 tests, written during section-06 (verification tools)

Section-07 is the consolidation pass: confirm all 115 tests pass together and document coverage.

### Test results
```
pytest phone-bot/tests/test_touch_protocol.py \
       phone-bot/tests/test_touch_client.py \
       phone-bot/tests/test_touch_pressure.py \
       phone-bot/tests/test_executor_uhid.py \
       phone-bot/tests/test_verify_uhid.py
=> 115 passed, 0 failed
```

### conftest.py — no changes needed for section-07

`test_verify_uhid.py` uses direct `sys.path` injection to reach `phone-bot/tools/`.
All other test files import via `conftest.py`'s existing `phone_bot` package registration.

### Statistical test approach

`test_touch_pressure.py` uses 100-200 sample loops to verify:
- Pressure varies (std > threshold across samples)
- Fatigue increases mean pressure (comparing two population means)
- Low energy decreases mean pressure
- Area is correlated with peak pressure

No fixed random seed — tests check distributional properties, not exact values.

### Hardware integration

`phone-bot/tools/test_uhid_integration.py` documents the full hardware test matrix and
requires a real Samsung S9 with touchserver.jar deployed. Run:
```
python tools/test_uhid_integration.py --serial 2aa12f822d027ece
```
