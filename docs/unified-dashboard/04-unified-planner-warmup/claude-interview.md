# Interview Transcript — 04 Unified Planner + Warmup

## Q1: Proxy Group Architecture
**Q:** The planner currently generates plans for ALL 6 accounts together. The spec says to split by proxy_id (one plan per proxy group). Currently all 3 phones share 1 proxy. Do you plan to add more proxies soon, or should we build group-by-proxy now but expect most users to have 1 group initially?

**A:** Build it now, expect 1 group initially. Full proxy-group architecture from day 1, but practically 1 group for now.

## Q2: Planner Import Path
**Q:** Where should the planner service run? The planner is in a separate directory (`Weekly & Daily Plan/planner/`). Should we copy it into the Flask app, or add the planner directory to Python path and import from there?

**A:** Add to sys.path and import directly. Keep planner where it is, add `Weekly & Daily Plan/` to Flask's Python path.

## Q3: Timezone Strategy
**Q:** The planner generates Session objects with start_time as Python `time` objects (e.g., 19:45). These are timezone-naive. Should we add timezone awareness to the planner itself, or keep the planner generating Eastern times and convert to UTC only when storing in DB?

**A:** Planner stays Eastern, convert at DB boundary. Planner logic unchanged, planner_service converts to UTC before DB save.

## Q4: Warmup State Storage
**Q:** The warmup system currently uses `warmup_state.json` (file) while the Flask app uses SQLite. Should warmup state be migrated fully into the DB, or keep the JSON file?

**A:** Migrate to DB (BotAccount.warmup_json). Dashboard reads/writes DB. Phone-bot executor reads from DB too (no more JSON file).

## Q5: Executor Plan Feed
**Q:** How should the executor know about plan changes? When a new plan is generated via dashboard, the phone-bot executor currently reads from a JSON file.

**A:** Executor reads from DB directly. Modify executor to query WeeklyPlan table instead of reading JSON file.

## Q6: Mid-Week Phone Addition
**Q:** When a phone is added mid-week, should the dashboard automatically regenerate remaining days, or show a warning and let the user click 'Regenerate'?

**A:** Auto-regenerate on phone add. Adding a phone immediately triggers regeneration of remaining days.

## Q7: Account Source
**Q:** The existing planner hardcodes 6 accounts in config.py. The dashboard has Phones and BotAccounts in DB. Should the planner be refactored to accept accounts as input?

**A:** Yes, planner accepts accounts as parameter. planner_service queries DB for active accounts, passes them to planner. Config.py becomes defaults only.

## Q8: Warmup Panel Location
**Q:** The warmup panel — where should it live?

**A:** Both — summary on Weekly Plan, details in Phone Settings. Quick status on Weekly Plan page, full controls in Phone Settings.

## Q9: Live Session Status
**Q:** Session execution status — how will the timeline know if a session completed, failed, or is running?

**A:** SessionLog in DB, poll every 30s. Executor writes to SessionLog table, dashboard polls for updates.

## Q10: Warmup Session Timing
**Q:** When warmup accounts and regular accounts are interleaved, should warmup accounts get earlier time slots or be randomly mixed?

**A:** Random mix — treat warmup sessions like any other. Warmup sessions get whatever slot the randomizer picks.

## Q11: JSON Export Format
**Q:** The 'Download JSON' button — same format as current planner output, or dashboard-friendly?

**A:** Same format as current planner output. Executor-compatible JSON, useful for debugging or manual execution.
