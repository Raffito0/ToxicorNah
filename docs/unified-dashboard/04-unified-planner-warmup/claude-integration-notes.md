# Integration Notes -- Opus Review Feedback

## Integrating (9 items)

### 1. UniqueConstraint vs archiving -- INTEGRATING
**Issue:** Unique constraint on (proxy_id, week_number, year) prevents inserting new plan while archived one exists.
**Fix:** UPDATE existing row instead of INSERT + archive. Set plan_json and status='active' on the existing row. Keep only 1 row per (proxy_id, week_number, year). For history, add a `previous_plan_json` column or simply overwrite.

### 2. _build_session() returns dict, not Session -- INTEGRATING
**Issue:** Plan shows engagement_caps on Session dataclass but _build_session() returns a dict.
**Fix:** Keep dict pattern (it's already working). Add engagement_caps as a key to the dict. Update Session.to_dict() and Session dataclass for the formatter output path, but the internal planner uses dicts. Document this clearly.

### 3. Enumerate config.ACCOUNTS references -- INTEGRATING
**Issue:** Plan hand-waves "pass accounts through the call chain" without listing all call sites.
**Fix:** Add explicit enumeration in the plan: scheduler.py (generate_weekly_plan, _assign_weekly_special_days, generate_daily_plan), rules_engine.py (validate_cross_phone), personality.py (initialize_all_accounts, load_state, save_state). Each gets an `accounts` parameter.

### 4. Personality state file path -- INTEGRATING
**Issue:** personality.py reads/writes state/account_state.json relative to CWD.
**Fix:** Pass personality state through the service layer too. Service reads personality from BotAccount.personality_json, passes to planner, writes back after. Planner no longer does file I/O for personality.

### 5. Field name mapping -- INTEGRATING
**Issue:** Planner outputs "account"/"type"/"phone" but API expects "account_name"/"session_type"/"phone_id".
**Fix:** Add a translation step in planner_service.py that maps planner output keys to standardized keys. Document the mapping.

### 6. Reconcile warmup systems -- INTEGRATING
**Issue:** Plan's cap table oversimplifies. Existing AccountWarmupState has dead/lazy/normal with non-monotonic engagement and variable schedules.
**Fix:** Keep the existing AccountWarmupState model and warmup plan generation logic. The planner reads warmup_state from DB (BotAccount.warmup_json), uses the warmup_plan dict for that day to determine session type and caps. The simplified cap table in the plan becomes documentation only -- actual caps come from the warmup plan.

### 7. SQLite WAL mode -- INTEGRATING
**Issue:** Plan mentions WAL but never enables it.
**Fix:** Add PRAGMA journal_mode=WAL in app startup (create_app or engine creation).

### 8. Session matching by session_id -- INTEGRATING
**Issue:** Time-window matching is fragile when sessions are close together.
**Fix:** Generate a deterministic session_id when creating the plan (e.g., `{date}_{account}_{session_num}`). Executor writes this session_id to SessionLog. Dashboard matches on session_id.

### 9. Authentication on API routes -- INTEGRATING
**Issue:** No mention of auth on /api/planner/* routes.
**Fix:** Add @login_required decorator to all API routes, consistent with existing app.

## Not Integrating (4 items)

### 7 (review). sys.path fragility
**Why not:** The entire project runs from a single Windows machine (user's desktop). Docker deployment is not planned. The space in directory name works fine on Windows. Adding an env var override adds complexity for no current benefit.

### 10 (review). Warmup skip safety checks
**Why not:** Edge case validation. Will be handled in implementation as standard input validation. Not worth adding to the plan architecture.

### 11 (review). Rollback for mid-week regeneration
**Why not:** Single-user dashboard. If the plan is bad, the user just regenerates again. Keeping old plans archived for rollback adds complexity. The UPDATE approach (item 1) overwrites, which is simpler.

### 14-17 (review). Minor items
- warmup_dead: will be removed from session types list (it's never generated, correct)
- proxy_id join path: cosmetic, the actual query will be correct
- setTimeout vs setInterval: implementation detail, will use setTimeout
- Auth: already integrating (item 9 above)
