# Section 02: ADB Screen Size Auto-Detection (adb.py)

## Goal

Add `wm size` parsing to `ADBController.__init__()` so that screen dimensions are auto-detected from the connected device. Upgrade the existing density detection to handle Override/Physical pairs. Add `DeviceConfigError` for unresolvable screen parameters.

## Dependencies

- **Section 01 (config-schema)** must be completed first. It makes `screen_w`, `screen_h`, and `density` optional (possibly `None`) in phone config dicts via `normalize_phone_config()`.

## File to Modify

`phone-bot/core/adb.py`

## Background

The current `ADBController.__init__()` (lines 45-62) does:
1. Sets `self.screen_w` and `self.screen_h` directly from `phone_config["screen_w"]` and `phone_config["screen_h"]`
2. Sets `self._density` from config with default 280
3. Runs `adb shell wm density`, parses with `re.search(r'(\d+)')` (grabs first number), overrides density if passes sanity check

After Section 01, config values can be `None`. This section adds ADB auto-detection for screen size AND upgrades density detection.

### Key Principle: ADB Always Wins

ADB-detected values always override config values. Config values serve only as fallback when ADB fails.

## Tests (Write First)

Add to `phone-bot/tests/test_autodetect.py`. All tests mock `ADBController._run()`:

```python
# --- wm size parsing ---
# Test: Physical+Override output -> returns Override values (1080, 2340)
# Test: Physical-only output -> returns Physical values (1080, 2220)
# Test: garbage/empty output -> returns None, triggers config fallback
# Test: Override-only (no Physical line) -> returns Override values
# Test: order independence -- Override before Physical still works

# --- wm density parsing (upgraded) ---
# Test: "Physical density: 420\nOverride density: 280" -> returns 280
# Test: "Physical density: 420" -> returns 420
# Test: garbage -> returns config value or default 280

# --- sanity checks ---
# Test: width=0 fails (200 <= w <= 4000) -> falls back to config
# Test: height=99999 fails (200 <= h <= 8000) -> falls back to config
# Test: width=1080, height=2340 passes

# --- fallback chain ---
# Test: ADB succeeds -> screen_w/screen_h set to detected (config ignored)
# Test: ADB fails + config has values -> uses config values
# Test: ADB fails + config is None -> raises DeviceConfigError
# Test: ADB detects different values than config -> ADB wins, logged

# --- __init__ integration ---
# Test: full config + working ADB -> all three params auto-detected
# Test: minimal config (None screen params) + working ADB -> auto-detected
# Test: minimal config + broken ADB -> DeviceConfigError raised
```

### Mocking Strategy

All ADB interactions go through `ADBController._run()`. Patch this single method:

```python
def make_mock_run(size_output, density_output):
    """Returns a mock _run that returns appropriate output per command."""
    # Check if args contain "wm size" or "wm density" and return accordingly
```

## Implementation Details

### 1. Add DeviceConfigError Exception

Define alongside the existing `DeviceLostError` at the top of `adb.py`:

```python
class DeviceConfigError(Exception):
    """Raised when device screen parameters cannot be determined."""
```

### 2. Add Parsing Helpers

Two module-level or static method helpers:

**`_parse_wm_size(output: str) -> tuple[int, int] | None`**
- Regex: `r'(\w+)\s+size:\s*(\d+)x(\d+)'`
- Collect all matches into dict keyed by label (Physical, Override)
- Return `(width, height)` tuple preferring Override, or `None` if no matches

**`_parse_wm_density(output: str) -> int | None`**
- Regex: `r'(\w+)\s+density:\s*(\d+)'`
- Collect matches, prefer Override over Physical
- Return int or None

### 3. Rewrite __init__ Detection Block

Replace current lines 48-62. The new logic (pseudocode):

```
# Screen size detection
config_w = phone_config.get("screen_w")  # may be None
config_h = phone_config.get("screen_h")  # may be None

detected_size = None
try:
    size_output = self._run(["shell", "wm", "size"], timeout=5)
    parsed = _parse_wm_size(size_output)
    if parsed:
        w, h = parsed
        if 200 <= w <= 4000 and 200 <= h <= 8000:
            detected_size = (w, h)
except Exception:
    pass

if detected_size:
    self.screen_w, self.screen_h = detected_size
    # Log comparison with config
elif config_w is not None and config_h is not None:
    self.screen_w, self.screen_h = config_w, config_h
    log.info("ADB: wm size failed, using config values %dx%d", config_w, config_h)
else:
    raise DeviceConfigError(f"Cannot determine screen size for {serial}")

# Density detection (upgraded to Override-preferred)
config_density = phone_config.get("density")
detected_density = None
try:
    density_output = self._run(["shell", "wm", "density"], timeout=5)
    parsed = _parse_wm_density(density_output)
    if parsed and 100 < parsed < 800:
        detected_density = parsed
except Exception:
    pass

if detected_density:
    self._density = detected_density
elif config_density is not None:
    self._density = config_density
else:
    self._density = 280  # safe default
```

### 4. Logging Format

```
ADB: screen 1080x2340 (auto-detected, config had 1080x2340 -- match)
ADB: screen 720x1600 (auto-detected, config had None -- new detection)
ADB: using Override size 1080x2340 (Physical was 1080x2220)
ADB: density 420 (auto-detected, config had 420 -- match)
ADB: density 280 (auto-detected via Override, Physical was 420)
```

### 5. ADB Detection Returns Pairs

`wm size` always returns width AND height together. No individual field detection. Both set or neither set. If ADB fails and either config value is None, abort.

## Edge Cases

- **Emulator with Override size**: Override preferred, correct
- **Samsung Screen zoom**: Changes density via Override. Upgraded parser handles this
- **USB disconnect during init**: `wm size` times out, falls to config. If None, DeviceConfigError
- **Partial config** (screen_w set, screen_h None): ADB replaces both if successful. If fails, having one is useless -> abort (both config_w and config_h must be non-None)

## Implementation Notes (Post-Review)

### Deviations from plan
- Density sanity check uses `<=` instead of `<` (plan had `100 < parsed < 800`, changed to `100 <= parsed <= 800` to support low-DPI emulators)
- Added `{**defaults, **phone}` approach inherited from section-01 review

### conftest.py
- Created `phone-bot/tests/conftest.py` to handle relative imports (`from .. import config` in core/adb.py). Registers a fake parent package so that `core.adb` can be imported with working relative imports.

### Files modified
- `phone-bot/core/adb.py` — added `DeviceConfigError`, `_parse_wm_size()`, `_parse_wm_density()`, rewrote `__init__` detection block
- `phone-bot/tests/test_autodetect.py` — 20 new tests (29 total)
- `phone-bot/tests/conftest.py` — new file for import resolution

### Test count: 29 (all passing)

## Blocked By

Section 01 (config-schema)

## Blocks

- Section 03 (serial discovery) — uses DeviceConfigError
- Section 04 (integration tests) — tests the full chain
