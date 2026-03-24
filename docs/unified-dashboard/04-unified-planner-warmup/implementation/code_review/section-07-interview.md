# Section 07 Code Review Interview

## Auto-fixed (no user input needed)

### 1. Connection leaks (HIGH) — FIXED
All 6 DB call sites now use try/finally to ensure conn.close() runs even on exceptions.

### 2. _load_warmup_state early return (MEDIUM) — FIXED
Changed `if rows:` guard to `if self.warmup_states:` — only returns (skipping JSON fallback) if we actually loaded accounts from DB.

### 3. _save_warmup_state account drop (MEDIUM) — FIXED
Now counts saved accounts. Only skips JSON fallback if `saved_count == len(data)` (all accounts persisted to DB).

### 4. Log format strings (MINOR) — FIXED
Changed f-strings in logging calls to %-formatting for lazy evaluation.

## Let go (not in scope)

- **session_id UNIQUE constraint**: Schema change belongs in models.py, out of section-07 scope
- **advance_warmup_day test**: Tests warmup logic, not DB integration. Covered in warmup.py tests
- **execute_warmup_session integration**: Session logging already calls _save_warmup_state at lines 1066+
- **_load_account_db_ids test**: Covered indirectly by save_warmup_to_db test
- **JSON-not-written test**: Save logic is straightforward, not worth testing the negative
