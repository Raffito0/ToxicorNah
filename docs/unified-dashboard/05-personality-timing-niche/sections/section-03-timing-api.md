# Section 03 -- Timing API

## Overview
Flask blueprint `timing_bp` with CRUD for timing presets, bot preset assignment, per-bot parameter overrides, and custom preset creation.

## Dependencies
- None (parallel). Blocks: section-04 (timing frontend).
- DB models already exist: TimingPreset, TimingOverride, Bot.timing_preset_id.

## API Routes (`timing_routes.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/timing/presets` | List presets (id, name, desc, param_count) |
| GET | `/api/timing/presets/<id>` | Get preset with full params_json |
| GET | `/api/bots/<id>/timing` | Bot's preset params merged with overrides |
| PUT | `/api/bots/<id>/timing/preset` | Change bot's preset_id |
| POST | `/api/bots/<id>/timing/override` | Upsert single param override |
| DELETE | `/api/bots/<id>/timing/override/<param>` | Remove one override |
| DELETE | `/api/bots/<id>/timing/overrides` | Clear all overrides |
| POST | `/api/timing/presets` | Create custom preset |
| GET | `/timing-editor` | Render timing-editor.html |

### Merge Logic (GET bot timing)
1. Load preset's params_json
2. Load all TimingOverride rows for bot_id
3. Override matching params
4. Return merged params + list of overridden param names

### Validation
- median/sigma/min/max: non-negative floats
- min <= median <= max
- sigma: clamp to [0, 2.0]

All bot routes: ownership check (bot.user_id == current_user.id).

## Tests (`tests/test_timing_api.py`)
```python
# Test: GET presets returns 4 defaults
# Test: GET bot timing returns merged preset + overrides
# Test: PUT preset changes bot.timing_preset_id
# Test: POST override creates/updates entry (upsert)
# Test: DELETE single override removes it
# Test: DELETE all overrides clears them
# Test: POST custom preset creates with is_default=False
# Test: override values merge correctly with preset
# Test: all routes require login
```
