# Opus Review

**Model:** claude-opus-4
**Generated:** 2026-03-22

---

## Critical Issues

**1. config.ACCOUNTS is deeply embedded -- refactoring is harder than described**

Section 2.1 says "Remove direct dependency on config.ACCOUNTS" but config.ACCOUNTS is referenced in at least _assign_weekly_special_days (line 33), generate_daily_plan (line 204), the R15 cross-phone validation (line 84), and likely more places downstream. config.PHONES is also derived from config.ACCOUNTS and used independently. The personality.py module (load_state, save_state, get_account_state) almost certainly reads account names from config too. The plan should explicitly list every function that touches config.ACCOUNTS or config.PHONES.

**2. WeeklyPlan UniqueConstraint conflicts with plan archiving**

There is a unique constraint on (proxy_id, week_number, year). The plan says generate_weekly_plan() archives the existing active plan before creating a new one. But if the old plan stays in the table with the same values, inserting a new row will violate the unique constraint. Options: drop the unique constraint, make status part of the constraint, or delete/update the old row instead of inserting a new one.

**3. _build_session() returns a dict, not a Session dataclass**

The plan shows engagement_caps being added to the Session dataclass, but _build_session() returns a plain dict, not a Session instance. The to_dict() method on Session also does not include engagement_caps. Either acknowledge sessions are dicts throughout and add engagement_caps to the dict pattern, or include migrating _build_session() to return Session instances.

**4. Personality state file conflict**

The planner's personality.py uses load_state/save_state which reads/writes state/account_state.json on disk. The plan says warmup state moves to DB, but personality state is a separate system. When the service layer calls generate_weekly_plan(), the planner will still try to read/write account_state.json. If Flask runs from a different working directory, the relative path will resolve incorrectly.

## Significant Gaps

**5. Session dict field name mismatches**

The planner's Session.to_dict() outputs "account" but the plan's API response shows "account_name". The planner uses "type" but the plan references "session_type". Similarly "time_slot" vs "time_slot_name", "phone" vs "phone_id". Need an explicit mapping/translation step.

**6. Two different warmup systems need reconciling**

The phone-bot has AccountWarmupState (dataclass with current_day, total_days, warmup_plan, profile_pic_day, bio_day, niche_keywords). The plan's warmup cap table (days 1-2, 3-4, 5-7) does not match the existing system which has dead days, lazy days, non-monotonic engagement, and variable day types per account.

**7. sys.path hack is fragile**

Relative path '..', '..', 'Weekly & Daily Plan' has a space and assumes fixed directory structure. Should add startup check or environment variable override.

**8. SessionLog matching by time window is fragile**

If two sessions for same account are within 10 minutes (R17 allows 1-5 min gap), matching produces false positives. Should use session_id as deterministic key.

## Moderate Concerns

**9. SQLite WAL mode not enabled**

Plan mentions "SQLite WAL mode handles concurrent reads" but never enables it. SQLite defaults to journal mode delete, not WAL. Need PRAGMA journal_mode=WAL at startup.

**10. Warmup "Skip to Day" has no safety checks**

No handling for target_day > total_days, negative, or < current_day. No specification of whether skipping recalculates day type assignments.

**11. No rollback for mid-week regeneration**

If regenerated plan is worse (e.g., violates R15), no way to undo. Should keep previous plan as archived for restoration.

**12. Timezone handling under-specified for executor**

Plan does not specify exact datetime string format or parsing code for UTC storage. The executor currently works entirely in Eastern time.

**13. Two config.py files may collide**

Weekly & Daily Plan/planner/config.py (planner rules) and phone-bot/config.py (timing params). Plan references "config.py" generically. Name collision risk when service layer imports planner.

## Minor Issues

**14.** warmup_dead session type is listed but never generated (dead day returns None).

**15.** proxy_id is on Bot model, not Phone. Join path description is misleading.

**16.** 30-second setInterval will accumulate if requests slow. Use setTimeout with recursive calls.

**17.** No authentication on /api/planner/* routes. Existing app uses flask_login.

## Actionable Items (Priority Order)

1. Fix UniqueConstraint vs archiving conflict (will crash at runtime)
2. Account for _build_session() returning dicts, not dataclass instances
3. Enumerate all config.ACCOUNTS/config.PHONES references for refactoring
4. Address personality state file path resolution
5. Define field name mapping between planner output and plan target schema
6. Reconcile the two warmup systems
7. Enable SQLite WAL mode explicitly
8. Use session_id for session matching instead of time windows
9. Add authentication to API routes
10. Specify datetime string format for UTC storage and parsing
