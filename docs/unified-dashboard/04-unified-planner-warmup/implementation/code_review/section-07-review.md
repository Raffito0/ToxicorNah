# Section 07 Code Review

## HIGH: Connection leaks on exception paths
All DB functions use `conn = _get_db()` then `conn.close()` inside try, but if exception occurs between, connection leaks. Fix: use try/finally or context manager.

## MEDIUM: _load_warmup_state returns early with empty states
If DB rows exist but all have empty warmup_json, `rows` is truthy so `return` fires, skipping JSON fallback with empty warmup_states.

## MEDIUM: _save_warmup_state drops accounts not in _account_db_ids
New accounts from init_warmup() not in _account_db_ids are silently skipped, then `return` prevents JSON fallback.

## MEDIUM: _log_session_end_db updates all matching rows
No UNIQUE constraint on session_id. Retried sessions could update multiple rows.

## LOW: _DB_PATH differs from plan spec
Plan says `instance/app.db`, implementation uses `app/user_data/app.db`. Implementation is correct for actual file location.

## MISSING: test for advance_warmup_day
Plan requires it but no test exists.

## MISSING: test that JSON file not written when DB succeeds
Plan requires verifying save doesn't touch JSON when DB works.

## MISSING: execute_warmup_session integration
Plan says session logging should be in warmup sessions too.

## MINOR: Inconsistent log format strings
Mix of f-strings and %-formatting in logging calls.

## MINOR: No test for _load_account_db_ids
Critical for save path but untested.
