# Section 01 -- Personality API

## Overview
Backend API routes and DB columns for managing per-account personality traits. CRUD for 7+1 behavioral traits, lock toggles, randomize, reset, and 30-session history for evolution charts.

## Dependencies
- None (first section). Blocks: section-02 (personality frontend).

## DB Changes
Add to `ensure_columns()` in `__init__.py`:
```sql
ALTER TABLE bot_account ADD COLUMN personality_history_json JSON
ALTER TABLE bot_account ADD COLUMN personality_locked_traits JSON
```
Add corresponding fields to `BotAccount` model in `models.py`.

## API Routes (`personality_routes.py`)
Blueprint `personality_bp`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/accounts/<id>/personality` | Get traits + history + locked |
| PUT | `/api/accounts/<id>/personality` | Update specific traits (partial, clamped) |
| POST | `/api/accounts/<id>/personality/randomize` | Random within bounds (skip locked) |
| POST | `/api/accounts/<id>/personality/reset` | Reset to range midpoints |
| PUT | `/api/accounts/<id>/personality/lock` | Toggle trait lock |

Constants (mirror phone-bot ranges):
```python
PERSONALITY_RANGES = {
    "reels_preference": (0.20, 0.80),
    "story_affinity": (0.05, 0.50),
    "double_tap_habit": (0.25, 0.90),
    "explore_curiosity": (0.03, 0.20),
    "boredom_rate": (0.06, 0.18),
    "boredom_relief": (0.25, 0.55),
    "switch_threshold": (0.55, 0.85),
    "comment_sociality": (0.15, 0.75),
}
MAX_HISTORY = 30
```

All routes require `@login_required` + ownership check (BotAccount -> Bot -> user_id).
Use `flag_modified(account, 'personality_json')` for JSON mutation detection.

## Tests (`tests/test_personality_api.py`)
```python
# Test: GET returns traits, locked_traits, categorical, sessions_count, history
# Test: GET with NULL personality_json returns defaults (range midpoints)
# Test: PUT updates specific traits, clamps to range
# Test: POST randomize generates within bounds, skips locked
# Test: POST reset restores midpoints, clears locks
# Test: PUT lock toggles trait in locked_traits list
# Test: history limited to 30 entries
# Test: all routes require login
```
