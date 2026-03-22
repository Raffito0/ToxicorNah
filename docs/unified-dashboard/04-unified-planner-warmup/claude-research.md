# Research — 04 Unified Planner + Warmup

## Part 1: Codebase Research

### 1. Planner Module (`Weekly & Daily Plan/planner/`)

**Core Files:**
- `models.py` (122 lines) — `Session`, `DailyPlan`, `WeeklyPlan`, `AccountWeekSummary`, `ProxyRotation` dataclasses
- `config.py` (107 lines) — 6 accounts (`ph{1-3}_{tiktok,instagram}`), 3 phones, proxy config, time slots (weekday/weekend with engagement weights), 17 rule params
- `scheduler.py` (526 lines) — `generate_weekly_plan(start_date)` → `_assign_weekly_special_days()` → `generate_daily_plan()` per day
- `rules_engine.py` (350+ lines) — 17 rule functions (R1-R17)
- `personality.py` (102 lines) — personality refresh every 7-14 days, 70% new + 30% old blend
- `formatter.py` (120+ lines) — JSON + TXT output to `output/`
- `main.py` (76 lines) — CLI: `python -m planner.main --weekly [--date YYYY-MM-DD]`

**Session Model Fields:**
- `account_name`, `phone_id`, `platform`, `start_time`, `end_time`, `time_slot_name`
- `session_number` (1 or 2), `session_type` (normal/aborted/extended/rest_only)
- `post_scheduled`, `post_outcome` (posted/draft/skipped/null)
- `pre_activity_minutes`, `post_activity_minutes`, `total_duration_minutes`
- `proxy_rotation_before` (bool)

**Account naming**: `ph{phone}_{platform}` (e.g., `ph1_tiktok`, `ph2_instagram`)

**Key algorithms:**
- Phone blocks: same phone always has both accounts consecutive
- Round-based scheduling: round 1 sessions first, round 2 later
- Session gaps: same phone 1-5 min, different phone 0-30 min
- All times in US/Eastern

**State persistence:**
- `state/account_state.json` — personality + special day history per account
- `output/weekly_plan_{year}-W{week}.json` — generated plans

### 2. Warmup System (`phone-bot/planner/warmup.py`)

**AccountWarmupState dataclass:**
- `account_name`, `platform`, `phone_id`, `start_date`, `current_day`
- `niche_keywords`, `completed`, `profile_pic_day`, `bio_day`
- `total_days` (5-8 randomized), `warmup_plan` (dict per day)

**Day types:** dead (no app), lazy (short scroll, zero engagement), normal (regular engagement)

**Key rules:**
- Days 1-2: ONLY FYP scroll, zero likes/comments/follows/searches
- Non-monotonic engagement (some days less than previous)
- Profile pic/bio on random different days per account
- Every account gets unique schedule

**Persistence:** `warmup_state.json` (atomic writes)

### 3. Flask App (`insta-phone-SAAS-sneder/app/`)

**Stack:** Flask + SQLAlchemy + SQLite, Flask-Login, Bootstrap dark mode, port 1090

**Database models (14 tables):**
- `Phone` — device specs (adb_serial, screen_w/h, density)
- `Proxy` — proxy config (host, port, credentials as env var names)
- `Bot` — bot instances (user_id, phone_id, platform, status, always_on, dry_run)
- `BotAccount` — account per bot (username, password, warmup_json, personality_json)
- `WeeklyPlan` — cached plans (proxy_id, week_number, year, plan_json, status)
- `SessionLog` — execution history (session_id, times, type, phase_log_json, actions_json, status)
- `ScheduledAction` — scheduled actions (date, type, min/max, status, error)
- Various social tracking tables (follows, messages, followers)

**WeeklyPlan table already exists** with: `proxy_id`, `week_number`, `year`, `plan_json` (JSONB), `status` (active/archived), unique constraint on (proxy_id, week_number, year).

**BotAccount already has:** `warmup_json`, `personality_json` fields.

### 4. Phone-Bot Executor (`phone-bot/planner/executor.py`)

**SessionExecutor class** reads plan JSON and executes sessions on physical phones. Integrates with:
- Warmup state loading/initialization
- Proxy management
- Content stock checking (Airtable queries)
- Delivery bridge (`from delivery import get_next_video, download_video, mark_posted`)

### 5. Testing

- **Validation script** (`validate.py`): 21 checks across all 17 rules
- **Stress test** (`stress_test.py`): 20 iterations, 100% pass rate
- No pytest config found — manual validation scripts
- Phone-bot has some test files (`test_*.py`) but no formal test framework

---

## Part 2: Web Research

### Flask Blueprint Patterns (2025)

**Service layer pattern (Cosmic Python):**
- Routes handle HTTP only, service functions handle business logic
- Routes catch domain exceptions → HTTP status codes
- Blueprint with `url_prefix='/api/planner'`

**Long-running task pattern (for plan generation):**
- `threading.Thread` + `queue.Queue` for async generation
- Status polling endpoint (`GET /api/planner/status/<task_id>`)
- Acceptable for dashboard (generation takes <5s)

**Blueprint registration:**
```python
def create_app():
    app = Flask(__name__)
    from .planner.routes import planner_bp
    app.register_blueprint(planner_bp)
    return app
```

### Timeline UI (Vanilla JS)

**Architecture (CodyHouse Schedule Template):**
1. Container with hourly slot markers
2. Session blocks positioned absolutely via `data-start`/`data-end` attributes
3. Click-to-detail modal

**Positioning formula:**
```javascript
const top = (startMinutes / totalMinutes) * totalHeight;
const height = (durationMinutes / totalMinutes) * totalHeight;
```

**Status indicators via CSS:**
- Completed: green (#43A047)
- Running: blue (#1E88E5) with pulse animation
- Upcoming: gray (#546E7A)
- Failed: red (#E53935)
- Rest: orange (#FFA726)

**Current time marker:** `setInterval(updateTimeMarker, 60000)` — recalculates position every minute

**Responsive:** At mobile widths, convert horizontal to vertical stacked layout

### Timezone Handling

**Python: Use `zoneinfo` (stdlib 3.9+), NOT `pytz` (deprecated)**

Key rules:
- Store UTC always in database
- Convert with `.astimezone(ZoneInfo("US/Eastern"))`, never `.replace()`
- DST pitfalls: ambiguous times (fall-back), non-existent times (spring-forward)
- Always convert FROM UTC to avoid gap/overlap issues

**JavaScript: `Intl.DateTimeFormat`**
```javascript
const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/New_York"
});
```

### Warmup Scheduling

**Progressive ramp-up (TokPortal 7-day plan):**
- Day 1: 15 min browse, 0 likes/comments/follows, 0 posts
- Day 2: 25+ min, 15 likes, 5 comments, 0 posts
- Day 3-4: 30 min, 15 likes, 10+ comments, 0-10 followbacks, 1 post
- Day 5-7: 30-45 min, 15-20 likes, 10+ comments, 1-2 posts

**Anti-detection limits:** Max 50 likes/hour, 30 follows/day, 30+ sec between likes

**Interleaving algorithm:**
1. For each account, determine warmup day → generate appropriate session type
2. Group by phone (consecutive), randomize within phone
3. Assign time slots with jitter
4. Regular accounts get normal sessions, warmup accounts get capped sessions
5. Dead day accounts: 0 sessions (skipped entirely)

**Randomization strategies:**
- Time slot jitter: ±15-30 min (log-normal)
- Session duration variance: target × random(0.85, 1.15)
- Rest/abort/extended probabilities per personality
