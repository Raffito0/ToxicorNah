# Section 04: Integration Tests

## Goal

End-to-end tests verifying the full auto-detection chain: config normalization (Section 01) -> ADB init (Section 02) -> page_state/coords propagation. Also backward compatibility with existing full configs and mixed minimal/full config scenarios.

## Dependencies

All three prior sections must be implemented:
- Section 01 (config.py): `normalize_phone_config()`
- Section 02 (adb.py): `wm size` parsing, `DeviceConfigError`, fallback chain
- Section 03 (main.py): serial-based discovery

## File

`phone-bot/tests/test_autodetect.py` (extend the existing file from Sections 01-03)

## How to Run

```bash
cd phone-bot && python -m pytest tests/test_autodetect.py -v
```

## Mocking Strategy

- `ADBController._run()` — mock to simulate `wm size` and `wm density` output
- `subprocess.run` — mock for `discover_devices()` tests
- No physical phone needed

## Tests

### TestPropagationChain

```python
# Test: after ADBController init with auto-detected 1080x2340,
#   adb.screen_w == 1080 and adb.screen_h == 2340

# Test: page_state.set_screen_params() called with auto-detected screen_h and density
#   -> _NAV_Y is recomputed (not the default 0.943)

# Test: after set_screen_params(2340, 420), coords._nav_y updated
#   -> get_coord("tiktok", "nav_home", 1080, 2340) returns correct Y

# Test: full chain minimal config
#   {"id": 99, "adb_serial": "TEST"} -> normalize -> ADB init (mocked 1080x2340, 420)
#   -> page_state -> coords -> correct pixel positions

# Test: backward compat full config
#   existing phone entry (all fields) -> ADB confirms same values
#   -> behavior identical to before, screen_w/screen_h/density unchanged
```

### TestMixedConfigs

```python
# Test: 3 phones — one minimal, one full, one partial
#   all discovered correctly via mocked ADB

# Test: minimal config phone gets same coords as full config phone
#   when ADB returns the same values for both
```

## Implementation Notes

1. **Import paths**: Tests use `from config import normalize_phone_config`, `from core.adb import ADBController, DeviceConfigError`
2. **Isolating config state**: Tests call `normalize_phone_config()` on fresh dicts, don't modify global PHONES
3. **Propagation tests**: After constructing mocked ADBController, call `page_state.set_screen_params(adb.screen_h, adb._density)` then verify `coords._nav_y` and `coords.get_coord()` output
4. **Sanity check values**: Width 200-4000, height 200-8000
5. **Expected total test count across all sections**: ~31 tests

## Implementation Notes (Post-Review)

### Module identity issue
Tests import `core.coords` and `core.page_state` which are different Python module objects from `phone_bot.core.coords` / `phone_bot.core.page_state`. The `set_screen_params()` call updates the `phone_bot.core.coords` module. Fixed by resolving the correct module via `sys.modules`.

### Files modified
- `phone-bot/tests/test_autodetect.py` — 7 new integration tests (42 total)

### Test count: 42 (all passing)
- Section 01: 9 tests (normalize)
- Section 02: 20 tests (ADB parsing, sanity, fallback)
- Section 03: 6 tests (discovery paths A/B/C + error handling)
- Section 04: 7 tests (propagation chain, mixed configs, backward compat)

## Blocked By

Sections 01, 02, 03

## Blocks

Nothing — this is the final section.
