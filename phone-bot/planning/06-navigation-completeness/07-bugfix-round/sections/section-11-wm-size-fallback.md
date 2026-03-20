<!--forge
forge:
  risk_level: medium
  autonomy_gate: continue
  solutions_md_checked: []
  solutions_md_match: []
  solution_selected:
    approach: "TBD -- filled by forge_planner analysis"
    score: 0
  test_protocol:
    type: "physical_device"
    pre_condition: "FYP must be visible on phone"
    commands:
      - "scrcpy --record tmp_forge_{section}.mkv"
      - "python phone-bot/main.py --test {mode} --phone 3"
    frame_extraction: "ffmpeg -y -i {mkv} -vf fps=0.5,scale=720:-2 {frames}/f_%03d.jpg"
    pass_threshold: "3"
    scenarios:
      - "FYP"
      - "Following"
      - "Explore"
      - "Shop"
    gemini_analysis: true
  regression_scope: []
  cross_section_deps: []
  attempt_count: 0
forge-->

# Section 11 — `wm size` Fallback Chain

## Problem Summary

`adb shell wm size` silently fails on Samsung Galaxy S9 (Android 10). The current code in `core/adb.py` logs "ADB: wm size failed, using config values 1080x2220" on every session for this phone. The fallback works today because the config has hardcoded values, but for any new phone without config values the failure becomes fatal with no recovery.

Two gaps to fix:
1. Only one ADB method tried before falling back to config — two more reliable methods exist
2. No DEBUG-level logging of raw output — parse failures are undiagnosable

**Priority**: MEDIUM (originally listed as MEDIUM in the plan; CRITICAL label in some context refers to the failure severity if all fallbacks fail)

---

## Files to Modify

- **`phone-bot/core/adb.py`** — primary: refactor screen size detection in `__init__`
- **`phone-bot/planner/executor.py`** — secondary: handle `DeviceConfigError` at initialization

---

## Tests First

**Test mode to add: `--test screen-detect`** in `main.py`.

The test runs each detection method explicitly and logs raw output + parsed result for each.

### What to verify

1. Each method (wm size, dumpsys window, dumpsys display) runs independently with its output logged at DEBUG level
2. Verify all three methods return correct `(1080, 2220)` for Samsung S9
3. Simulate timeout: inject a slow shell command, confirm the timeout triggers and execution falls through to the next method within the configured limit
4. Verify CRITICAL path: if all methods return None with no config → logs show CRITICAL + phone skipped

No scrcpy recording or frame analysis needed — purely ADB command test with log-level verification.

```
PASS conditions:
  - wm size: raw output logged at DEBUG, parsed (1080, 2220) or None logged
  - dumpsys window: raw output logged, DisplayFrames parsed or None
  - dumpsys display: raw output logged, mBaseDisplayInfo parsed or None
  - Timeout inject: method 1 aborts within 5s, method 2 tried
  - Config fallback: reached only when all 3 ADB methods fail
  - CRITICAL path: DeviceConfigError logged as CRITICAL, phone skipped in executor
```

---

## Implementation

### Overview of the Cascading Chain

Replace the single-method screen size block in `ADBController.__init__` with a four-method cascading chain:

```
Method 1: wm size           (timeout=5s)   → Physical size: WxH
Method 2: dumpsys window    (timeout=8s)   → DisplayFrames w=W h=H
Method 3: dumpsys display   (timeout=5s)   → real W x H
Method 4: config values                    → phone_config["screen_w/h"]
```

If all four fail: log CRITICAL and raise `DeviceConfigError`.

### Method 1 — `wm size` (already exists, needs diagnostic logging)

The existing call already uses `timeout=5`. Add **DEBUG-level logging of the raw output** when parsing fails:

```python
log.debug("wm size raw output: %r", size_output)
```

This lets future debugging distinguish "empty output" from "wrong format" from "permission error text".

### Method 2 — `dumpsys window` (NEW)

Command: `adb shell dumpsys window | grep -E "DisplayFrames"`

Parse pattern: `DisplayFrames\s+w=(\d+)\s+h=(\d+)`

Timeout: 8 seconds (dumpsys is slower than wm commands). Works on Android 6+, all manufacturers.

```python
def _detect_size_dumpsys_window(self) -> tuple[int, int] | None:
    """
    Parse screen dimensions from 'dumpsys window'.
    Looks for line: DisplayFrames w=1080 h=2220 r=...
    Returns (width, height) or None.
    Timeout: 8s.
    """
```

Use `re.search()`, not `re.match()` — Samsung output may have additional fields or different field order.

### Method 3 — `dumpsys display` (NEW)

Command: `adb shell dumpsys display | grep mBaseDisplayInfo`

Parse pattern: `real\s+(\d+)\s+x\s+(\d+)`

Timeout: 5 seconds. Works on Android 9+.

```python
def _detect_size_dumpsys_display(self) -> tuple[int, int] | None:
    """
    Parse screen dimensions from 'dumpsys display'.
    Looks for line containing 'mBaseDisplayInfo' and 'real WxH'.
    Returns (width, height) or None.
    Timeout: 5s.
    """
```

Note: `real W x H` has width first — consistent with `wm size` (also width-first).

### Dimension Validity Guard

All three ADB methods must validate with the existing guard:
```python
if 200 <= w <= 4000 and 200 <= h <= 8000:
    # valid
```

Do not skip this check on fallback methods — garbage values from a malformed `dumpsys` output could produce out-of-range integers.

### Refactored `_get_screen_size()` helper

Consolidate into a single helper:

```python
def _get_screen_size(self) -> tuple[int, int] | None:
    """
    Cascading ADB fallback for screen dimensions.
    Tries: wm size → dumpsys window → dumpsys display.
    Returns (width, height) or None if all fail.
    Logs raw output at DEBUG level on each failure for diagnostics.
    """
```

Then in `__init__`:

```python
detected_size = self._get_screen_size()
if detected_size:
    self.screen_w, self.screen_h = detected_size
elif config_w is not None and config_h is not None:
    self.screen_w, self.screen_h = config_w, config_h
    log.info("ADB: all wm/dumpsys methods failed, using config %dx%d", config_w, config_h)
else:
    raise DeviceConfigError(
        f"Cannot determine screen size for {serial}: "
        f"all ADB methods failed and config has no screen dimensions"
    )
```

### `DeviceConfigError` handling in `executor.py`

The existing pattern catches `DeviceLostError` at two locations in `executor.py`. Add a parallel `except DeviceConfigError` block at the same locations:

```python
except DeviceConfigError as e:
    log.critical("DEVICE CONFIG FAILED phone %d (%s): %s", phone_id, serial, e)
    dead_phones.add(phone_id)
    continue
```

Same `dead_phones.add` + `continue` pattern as `DeviceLostError`. No new infrastructure needed.

**No `adb reboot`**: rebooting mid-session is highly suspicious for detection and is never automated. Recovery is manual — operator checks USB and restarts session.

---

## Config Changes

No new timing parameters needed. The timeouts (5s, 8s, 5s) are hardcoded constants in the detection functions — they are technical ADB timeouts, not behavioral human timing params.

---

## Verification

After implementing:

1. Run `--test screen-detect` on Samsung S9 (the device that fails `wm size`)
2. Confirm which method first succeeds and returns `(1080, 2220)`
3. If `wm size` still fails, confirm method 2 or 3 succeeds and session proceeds without the "using config values" warning
4. Verify no session startup time regression — cascading chain only tries further methods when earlier ones fail
5. Simulate `DeviceConfigError` by temporarily removing screen dimensions from config while mocking all ADB methods to fail — confirm log shows CRITICAL and `dead_phones` contains that phone_id

`DeviceConfigError` is already defined in `core/adb.py` and imported in `main.py`. Verify it is also imported in `planner/executor.py` (add import if missing).
