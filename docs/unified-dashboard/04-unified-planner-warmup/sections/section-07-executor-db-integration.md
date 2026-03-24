# Section 07: Executor DB Integration

## Overview

Modify the phone-bot executor to read plans from the `WeeklyPlan` DB table instead of JSON files, read/write warmup state from `BotAccount.warmup_json` instead of `warmup_state.json`, and write execution records to `SessionLog` using deterministic session IDs.

**Depends on:** Section 03 (planner service stores plans in DB with UTC times and session_ids)

## Files Modified

| File | Change |
|------|--------|
| `phone-bot/planner/executor.py` | DB-first warmup state load/save, plan loading, SessionLog writing (most DB infra pre-existed) |
| `phone-bot/tests/test_executor_db.py` | **NEW** — 16 tests covering all DB integration |

## DB Models Used (from `insta-phone-SAAS-sneder/app/models.py`)

- **WeeklyPlan**: `plan_json`, `proxy_id`, `week_number`, `year`, `status`
- **SessionLog**: `session_id`, `started_at`, `ended_at`, `status`, `error_message`
- **BotAccount**: `warmup_json`, `personality_json`

## Tests

File: `phone-bot/tests/test_executor_db.py` — **16 tests, all passing**

### TestUtcToEastern (3 tests)
- EDT conversion (March, UTC-4)
- EST conversion (January, UTC-5)
- Summer EDT conversion (July)

### TestLoadPlanFromDB (4 tests)
- Loads active plan from DB with UTC->Eastern conversion
- Returns None when no active plan exists
- Returns None when DB file doesn't exist
- Verifies UTC times are converted to Eastern in plan sessions

### TestWarmupStateDB (4 tests)
- load_warmup_state reads from BotAccount.warmup_json
- save_warmup_state writes to BotAccount.warmup_json
- DB data preferred over JSON file when both available
- Falls back to JSON file when DB unavailable

### TestSessionLogDB (5 tests)
- Writes session start with 'running' status
- Updates session end with success status and post_outcome
- Records error_message on failure
- Deterministic session_id format matches plan
- No crash when DB file is missing

## Implementation Details

### Pre-existing (from prior work)
Most DB infrastructure was already in executor.py before this section:
- `_DB_PATH` pointing to `insta-phone-SAAS-sneder/app/user_data/app.db` (note: plan spec said `instance/app.db` which was stale)
- `_get_db()`, `_db_available()` helpers
- `_load_plan_from_db()` with UTC->Eastern conversion
- `_log_session_start_db()`, `_log_session_end_db()`
- `_load_account_db_ids()` and `self._account_db_ids`
- `load_weekly_plan()` with DB-first, JSON fallback, auto-generate

### New in this section
- `_load_warmup_state()` — rewritten to DB-first (query `bot_account.warmup_json`), JSON file fallback
- `_save_warmup_state()` — rewritten to DB-first (update `bot_account.warmup_json`), JSON file fallback
- Only returns early (skipping JSON) if ALL accounts were saved to DB
- All DB call sites now use try/finally for connection cleanup (review fix)

### Code Review Fixes Applied
1. **Connection leaks (HIGH)** — All 6 DB functions now use try/finally for conn.close()
2. **Early return with empty states (MEDIUM)** — `_load_warmup_state` only skips JSON fallback if `self.warmup_states` is non-empty
3. **Account drop on save (MEDIUM)** — `_save_warmup_state` tracks saved count, only skips JSON if all accounts persisted
4. **Log format strings (MINOR)** — Normalized to %-formatting for lazy evaluation

### Backward Compatibility
All DB ops wrapped in try/except with JSON file fallback. Bot runs identically when dashboard DB doesn't exist.
