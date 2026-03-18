# Section 06: Behavior Hardening

## Overview

1. Replace 7 hardcoded probabilities in tiktok.py with state-derived formulas
2. Fatigue persistence across sessions with time-decay (half-life 1hr)
3. Atomic personality file writes
4. Per-device retry_tolerance consumed by wait_and_verify

**Dependencies:** Sections 04 (session lifecycle), 05 (popup handler).
**Files modified:** `actions/tiktok.py`, `core/human.py`
**Files created:** `tests/test_fatigue.py`

---

## Actual Implementation

### 7 Probability Replacements (tiktok.py)

All clamped to [0.0, 1.0] via `max(0.0, min(1.0, ...))`:

1. **Comment screenshot** (line ~1737): `social * 0.7` — social people screenshot more comments
2. **Profile 2nd video** (line ~2073): `curiosity * 0.4 + energy * 0.15` — curious + energetic = explore more
3. **Micro-swipe outlier** (line ~2929): `fatigue * 0.08 + (1-energy) * 0.03` — more fumbles when tired
4. **Inbox scroll count** (line ~3709): fatigue > 0.5 → 1 scroll, else `patience * 0.7` → 1 or 2
5. **Grid scroll before video** (line ~3835): `curiosity * 0.4 + boredom * 0.2`
6. **Interruption type** (line ~4349): `energy * 0.5 + (1-fatigue) * 0.3` — medium vs long exit
7. **Niche pre-check** (line ~4398): `energy * 0.3 + curiosity * 0.2` — Gemini niche check rate

State values accessed via `getattr` chains with safe defaults (0.5) for backward compatibility when mood/fatigue not initialized.

### Fatigue Persistence (human.py)

- `FatigueTracker.start()` accepts `initial_fatigue` parameter (clamped [0.0, 0.8])
- `fatigue_level` blends session fatigue + initial: `session + initial * (1 - session)` (asymptotic blend, clamped to 1.0)
- `start_session()` loads saved fatigue from memory, applies half-life decay: `saved * 0.5^(hours_elapsed)`
- `_save_memory()` persists `fatigue_value` + `fatigue_timestamp` in the JSON
- `_load_memory()` stores raw JSON dict on `memory._raw_data` for fatigue carry-over

### Atomic Writes (human.py)

`_save_memory()` writes to `path.tmp` first, then `os.replace(tmp, path)`. Same pattern as warmup state. If tmp write fails, original file preserved.

### Per-Device retry_tolerance (tiktok.py)

- `TikTokBot.__init__`: reads `adb.phone.get("retry_tolerance", 3)`
- Passed to `wait_and_verify(max_attempts=self._retry_tolerance)` at 3 call sites (return_to_fyp)
- Config already has Motorola=4, Samsung=3 (from Section 03)

### Tests (tests/test_fatigue.py) — 16 tests

- Fatigue persistence: 5 tests (save, load with 30min decay, 2hr decay, clamp, backward compat)
- Atomic writes: 2 tests (create file, crash recovery)
- Probability formulas: 9 tests (each formula, extreme values, formula variation)
