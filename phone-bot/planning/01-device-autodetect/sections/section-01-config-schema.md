# Section 01: Config Schema Changes (config.py)

## Background

The phone-bot currently requires every phone entry in `config.py` to have all fields specified: `id`, `name`, `model`, `adb_serial`, `screen_w`, `screen_h`, and `density`. This section makes only `id` and `adb_serial` required. All other fields become optional with sensible defaults or `None` (which signals "auto-detect from ADB" in later sections).

A normalization function fills in defaults at module load time so that every downstream consumer still sees a complete dict with all keys present. This avoids scattering `.get()` calls throughout the codebase.

## File to Modify

`phone-bot/config.py`

## File to Create

`phone-bot/tests/test_autodetect.py` (also ensure `phone-bot/tests/__init__.py` exists as an empty file)

## Dependencies

None. This is the first section and has no dependencies on other sections.

## Tests (Write First)

All tests for this section go in `phone-bot/tests/test_autodetect.py`:

```python
# Test: minimal config with only id + adb_serial gets all defaults filled
# {"id": 99, "adb_serial": "TEST"} -> name="Phone 99", model="unknown", screen params=None

# Test: full config preserves all existing values unchanged

# Test: name defaults to "Phone {id}" when missing

# Test: model defaults to "unknown" when missing

# Test: screen_w/screen_h/density default to None when missing

# Test: missing "id" raises KeyError

# Test: missing "adb_serial" raises KeyError

# Test: PHONES list is normalized at module level (all entries have all 7 keys)
```

### How to Run

```bash
cd phone-bot && python -m pytest tests/test_autodetect.py -v
```

## Implementation Details

### 1. Create the `normalize_phone_config` function

Add this function in `config.py`, after the `TEST_MODE` definition but before the `PHONES` list:

```python
def normalize_phone_config(phone: dict) -> dict:
    """Fill defaults for optional phone config fields.

    Required fields: "id", "adb_serial" (KeyError if missing).
    Optional fields with defaults:
      - name: "Phone {id}"
      - model: "unknown"
      - screen_w: None  (triggers ADB auto-detect)
      - screen_h: None  (triggers ADB auto-detect)
      - density: None   (triggers ADB auto-detect)

    Returns a new dict with all 7 keys guaranteed present.
    """
```

The function must:

1. Access `phone["id"]` and `phone["adb_serial"]` — these raise `KeyError` naturally if missing, which is the desired behavior (both are required).
2. Use `phone.get("name", f"Phone {phone['id']}")` for the name default.
3. Use `phone.get("model", "unknown")` for the model default.
4. Use `phone.get("screen_w", None)`, `phone.get("screen_h", None)`, `phone.get("density", None)` for screen params.
5. Return a new dict containing all 7 keys.

### 2. Normalize PHONES in place at module level

Immediately after the `PHONES` list definition (after the closing `]`), add:

```python
for i, p in enumerate(PHONES):
    PHONES[i] = normalize_phone_config(p)
```

This mutates the list in place so that any module importing `PHONES` directly sees normalized entries. This is important because multiple modules (`main.py`, `executor.py`, etc.) import `PHONES` from `config`.

### 3. Existing phone entries remain unchanged

The four existing phone entries already have all fields, so normalization is a no-op for them. No changes to the existing phone definitions are needed.

### 4. What this enables

After this section, a new phone can be added to `PHONES` with just:

```python
{"id": 5, "adb_serial": "R5CR1234567"},
```

The normalization fills in `name="Phone 5"`, `model="unknown"`, and `screen_w/screen_h/density=None`. The `None` screen params will trigger ADB auto-detection in Section 02.

## Implementation Notes (Post-Review)

### Deviation from plan: `{**defaults, **phone}` pattern
The plan specified building a new dict with exactly 7 hardcoded keys. Code review identified that this silently drops unknown keys — a real bug when phones gain fields like `telegram_chat_id`. Changed to `{**defaults, **phone}` which preserves all input keys while filling defaults.

### Files created
- `phone-bot/tests/__init__.py` (empty)
- `phone-bot/tests/test_autodetect.py` (9 tests: 8 for normalize + 1 for PHONES normalization)

### Files modified
- `phone-bot/config.py` — added `normalize_phone_config()` function + normalization loop after PHONES list

### Test count: 9 (all passing)

## Blocked By

Nothing.

## Blocks

- **Section 02 (ADB auto-detect)**: Uses `None` screen params as the trigger for auto-detection.
- **Section 03 (serial discovery)**: Relies on normalized phone configs having all keys present.
