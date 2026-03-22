# Section 07: Executor DB Integration

## Overview

Modify the phone-bot executor to read plans from the `WeeklyPlan` DB table instead of JSON files, read/write warmup state from `BotAccount.warmup_json` instead of `warmup_state.json`, and write execution records to `SessionLog` using deterministic session IDs.

**Depends on:** Section 03 (planner service stores plans in DB with UTC times and session_ids)

## Files to Modify

| File | Change |
|------|--------|
| `phone-bot/planner/executor.py` | DB plan loading, warmup from DB, SessionLog writing |

## DB Models Used (from `insta-phone-SAAS-sneder/app/models.py`)

- **WeeklyPlan**: `plan_json`, `proxy_id`, `week_number`, `year`, `status`
- **SessionLog**: `session_id`, `started_at`, `ended_at`, `status`, `error_message`
- **BotAccount**: `warmup_json`, `personality_json`

## Tests

File: `phone-bot/tests/test_executor_db.py`

```python
# --- DB Plan Reading ---
# Test: executor loads plan from WeeklyPlan table (not JSON file)
# Test: executor converts UTC times to Eastern for scheduling
# Test: executor parses ISO 8601 datetime strings correctly
# Test: executor handles missing plan gracefully (no crash)

# --- Warmup State from DB ---
# Test: load_warmup_state reads from BotAccount.warmup_json
# Test: save_warmup_state writes to BotAccount.warmup_json
# Test: advance_warmup_day increments current_day and updates caps
# Test: warmup_state.json is not read or written

# --- SessionLog Writing ---
# Test: executor writes session_id to SessionLog on start
# Test: executor updates SessionLog with ended_at and status on completion
# Test: executor writes error_message on failure
# Test: SessionLog.session_id matches plan's deterministic ID
```

## Implementation Details

### 7.1 DB Connection

Use raw `sqlite3` (executor runs outside Flask, no SQLAlchemy). DB path:

```python
_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "insta-phone-SAAS-sneder", "instance", "app.db"
)

def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn
```

### 7.2 Plan Loading (DB-first with JSON fallback)

Replace `load_weekly_plan()` internals:
1. Query `SELECT plan_json FROM weekly_plan WHERE proxy_id=? AND week_number=? AND year=? AND status='active'`
2. Parse plan_json, convert UTC times to Eastern
3. If no DB result, fall back to existing JSON file search

**UTC to Eastern conversion:**
```python
def _utc_to_eastern(utc_str: str) -> str:
    dt = datetime.fromisoformat(utc_str.replace('Z', '+00:00'))
    et = dt.astimezone(ZoneInfo("US/Eastern"))
    return et.strftime("%H:%M")
```

### 7.3 Warmup State (DB-first with JSON fallback)

Replace `_load_warmup_state()`:
- Query `SELECT id, warmup_json FROM bot_account WHERE warmup_json IS NOT NULL`
- Parse into `AccountWarmupState.from_dict()`
- Maintain `self._account_db_ids` mapping (account_name -> bot_account.id)

Replace `_save_warmup_state()`:
- `UPDATE bot_account SET warmup_json=? WHERE id=?`
- Use `self._account_db_ids` for row lookup

Fallback: if DB unavailable (`_db_available()` returns False), use JSON file.

### 7.4 SessionLog Writing

Use deterministic session_id from plan (e.g., `2026-03-22_ph2_tiktok_1`):

```python
def _log_session_start(self, session_id, bot_account_id, session_type, dry_run=False):
    """INSERT INTO session_log (bot_account_id, session_id, started_at, session_type, status, dry_run)"""

def _log_session_end(self, session_id, success, error_message=None, post_outcome=None, actions_json=None):
    """UPDATE session_log SET ended_at=datetime('now'), status=?, error_message=?, ... WHERE session_id=?"""
```

Integration in `execute_session()`:
- After session_id assignment: `_log_session_start()`
- Success path: `_log_session_end(success=True)`
- Exception handlers: `_log_session_end(success=False, error_message=str(e))`

Same pattern for `execute_warmup_session()`.

### 7.5 Backward Compatibility

All DB ops wrapped in try/except. If DB file missing or queries fail, fall back to JSON-based behavior. `_db_available()` checks `os.path.exists(_DB_PATH)`.

### 7.6 Summary of Changes

1. Add `sqlite3` import and `_DB_PATH` constant
2. Add `_get_db()`, `_db_available()` helpers
3. Modify `_load_warmup_state()` -- DB first, JSON fallback
4. Modify `_save_warmup_state()` -- DB first, JSON fallback
5. Modify `load_weekly_plan()` -- DB first, JSON fallback
6. Add `_utc_to_eastern()` utility
7. Add `_log_session_start()`, `_log_session_end()` methods
8. Modify `execute_session()` -- deterministic session_id, SessionLog writes
9. Add `self._account_db_ids` mapping
