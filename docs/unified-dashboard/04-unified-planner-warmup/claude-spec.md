# Spec — 04 Unified Planner + Warmup

## Goal

Integrate the weekly/daily session planner into the Flask dashboard with warmup sessions interleaved in the same plan. Provide a visual timeline of today's sessions and controls for plan generation, warmup management, and live execution tracking.

## System Context

### Existing Systems Being Integrated

1. **Planner module** (`Weekly & Daily Plan/planner/`) — Python package generating weekly plans with 17 behavioral rules, personality evolution, and validation. Currently outputs JSON files and hardcodes 6 accounts in `config.py`.

2. **Warmup system** (`phone-bot/planner/warmup.py`) — Generates 5-8 day progressive warmup plans per account. Currently persists to `warmup_state.json`. Day types: dead (no app), lazy (short scroll), normal (engagement).

3. **Flask dashboard** (`insta-phone-SAAS-sneder/app/`) — Flask + SQLAlchemy + SQLite. Has Phone, Proxy, Bot, BotAccount, WeeklyPlan, SessionLog tables. Port 1090, Bootstrap dark mode.

4. **Phone-bot executor** (`phone-bot/planner/executor.py`) — Reads plan JSON and executes sessions on physical phones. Integrates with proxy rotation and content delivery.

### Key Constraints
- 1 shared proxy = only 1 phone active at a time
- Same-phone accounts (TikTok + Instagram) always consecutive
- All scheduling in US/Eastern timezone (proxy is Florida-based)
- 3 phones: Motorola E22i (720x1600), Samsung S9 (1080x2220), Samsung S22 (1080x2340)

## Architecture Decisions (from interview)

### D1: Proxy Group Architecture
Build proxy-group support from day 1. Currently 1 proxy = 1 group containing all 3 phones. Architecture supports future addition of multiple proxies with separate parallel plans per group.

### D2: Planner Import
Keep planner in `Weekly & Daily Plan/planner/`. Add that directory to `sys.path` in Flask app. Import directly — no copy/move.

### D3: Timezone Strategy
Planner continues generating Eastern times. `planner_service.py` converts to UTC at DB storage boundary. Display converts UTC → Eastern in templates and API responses.

### D4: Warmup State → DB Migration
Migrate warmup state from `warmup_state.json` into `BotAccount.warmup_json` (already exists as column). Both dashboard and phone-bot executor read from DB. JSON file no longer needed.

### D5: Executor Reads DB
Modify executor to query `WeeklyPlan` table instead of reading JSON files. DB is single source of truth for plans.

### D6: Auto-Regenerate on Phone Add
Adding a phone triggers automatic regeneration of remaining days in the affected proxy group's plan.

### D7: Planner Accepts Accounts as Parameter
Refactor planner to accept account list as input (from DB query) instead of reading hardcoded `config.py`. `planner_service` queries DB for active accounts per proxy group, passes to planner.

### D8: Warmup Panel — Dual Location
Quick warmup status summary on Weekly Plan page. Full warmup controls (reset, skip, mark complete) in Phone Settings per-account.

### D9: Live Status via Polling
Executor writes to `SessionLog` table. Dashboard polls every 30s for status updates on today's sessions.

### D10: Warmup Sessions Random Mix
Warmup sessions get same time slot treatment as regular sessions — no special earlier/quieter slot preference.

### D11: JSON Export = Executor Format
"Download JSON" exports the same format the executor reads — compatible with current `weekly_plan_YYYY-WNN.json` schema.

## Requirements

### R1: Planner Service Layer (`app/planner_service.py`)

Wraps planner module calls with DB integration:

- `generate_weekly_plan(proxy_id, week_date=None)` — queries active accounts for proxy group from DB, calls planner, stores result in WeeklyPlan table, returns plan dict
- `regenerate_remaining_days(proxy_id, from_date)` — regenerates from given date forward for proxy group, preserves completed sessions
- `get_today_sessions(proxy_id=None)` — returns today's sessions from active plan, optionally filtered by proxy group
- `get_current_plan(proxy_id)` — returns active WeeklyPlan record for proxy group
- Timezone conversion: planner outputs Eastern → service converts to UTC for DB storage
- Account source: queries `BotAccount` table joined with `Bot` + `Phone` to get accounts per proxy group

### R2: Unified Plan Generation (planner refactoring)

Modify `scheduler.py` and `rules_engine.py` to:

**Accept accounts as parameter:**
- `generate_weekly_plan(accounts, start_date=None)` — accounts is list of dicts with name, phone_id, platform, warmup_state
- Remove hardcoded `ACCOUNTS` dependency from generation flow
- Keep `config.py` as defaults/fallback only

**Phone Groups (proxy-based):**
- Phones sharing same `proxy_id` form a group
- Each group gets its own weekly plan
- Groups run in parallel (different proxies)
- Phones within group run sequentially (shared proxy)
- `WeeklyPlan.proxy_id` FK tracks group ownership

**Interleave warmup + regular sessions:**
- Input: all accounts in proxy group with their current warmup state
- Warmup accounts get session type: `warmup`, `warmup_lazy`, `warmup_dead`, `rest_only`
- Regular accounts get: `normal`, `aborted`, `extended`, `rest_only`
- ALL sessions in one chronological plan
- Phone order randomized daily, both accounts consecutive
- Warmup sessions treated identically for time slot assignment (random mix)

**Warmup rules (from existing warmup.py):**
- Day 1-2: ONLY FYP scroll. Zero engagement of any kind
- Day 3-4: Few likes (0-10), some scroll (8-12 min)
- Day 5-7: Moderate engagement, first post possible
- Dead days: 0 sessions (account skipped in plan)
- Lazy days: 1 short session (3-5 min, 0 engagement)
- Warmup accounts: max 1 session/day

**Engagement caps per session type:**
```
warmup (day 1-2): scroll_only=True, likes=0, comments=0, follows=0, search=0
warmup (day 3-4): scroll_only=False, likes=(0,10), comments=0, follows=0, search=0
warmup (day 5-7): scroll_only=False, likes=(5,20), comments=(0,3), follows=(0,5), search=(0,2)
warmup_lazy:      scroll_only=True, duration=(3,5), likes=0, comments=0, follows=0
warmup_dead:      no session generated
rest_only:        scroll_only=True, likes=0, comments=0, follows=0 (same as regular rest)
```

### R3: Weekly Plan Page

New sidebar item "Weekly Plan" with two views:

**Today's Timeline (main view):**
- Vertical timeline showing 24h in Eastern Time
- Session blocks positioned proportionally by start/end time
- Color by platform: TikTok (#25F4EE blue), Instagram (#E1306C pink)
- Warmup sessions: dashed border
- Block content: account name, time slot, duration
- Click block → detail modal with: account, phone, platform, session type, time slot, pre/post activity minutes, post scheduled?, outcome, engagement caps (if warmup)
- Current time indicator (red horizontal line, updates every minute)
- Status indicators: completed (green checkmark), running (pulse animation), upcoming (normal), failed/skipped (red X)
- Polling: fetch session status every 30s from SessionLog

**Week Overview (secondary tab):**
- 7-column grid (Mon-Sun)
- Each column: session count per phone, color-coded
- Rest days highlighted (orange)
- One-post days marked
- "Generate New Week" button

**Controls:**
- "Generate This Week" → calls `planner_service.generate_weekly_plan()`
- "Regenerate From Today" → calls `planner_service.regenerate_remaining_days()`
- Week selector: previous/next week navigation
- "Download JSON" → export current plan in executor-compatible format

### R4: Warmup Panel (dual location)

**On Weekly Plan page (summary):**
- Per-account warmup progress bar: "Day 3 of 7"
- Current day type badge: Normal / Lazy / Dead
- "Warmup Complete" badge when done

**In Phone Settings (full controls):**
- Progress bar: "Day 3 of 7"
- Current day type
- Daily caps display: Likes 0-10, Comments 0, Follows 0, Posts 0
- Profile pic status: "Set on Day 2" / "Pending (Day 4)"
- Bio status: "Set on Day 1" / "Pending (Day 3)"
- Controls: Reset Warmup, Skip to Day N, Mark Completed
- "View Full Plan" expandable table

### R5: Timezone Handling

- Planner generates Eastern times (unchanged)
- `planner_service.py` converts to UTC before DB storage
- DB stores all datetimes as UTC
- API responses include both UTC and Eastern display strings
- Jinja2 templates: custom filter `|eastern` for display
- JavaScript: `Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York'})` for client-side
- Format: "19:45 ET" in UI

### R6: API Routes (`app/planner_routes.py`)

Blueprint `planner_bp` with prefix `/api/planner`:
- `GET /weekly-plan?proxy_id=&week=` — get plan for proxy group and week
- `POST /weekly-plan/generate` — generate new weekly plan
- `POST /weekly-plan/regenerate` — regenerate remaining days
- `GET /today-sessions?proxy_id=` — today's sessions with live status
- `GET /warmup/<account_name>` — warmup status for account
- `POST /warmup/<account_name>/reset` — reset warmup to day 1
- `POST /warmup/<account_name>/skip` — skip to day N
- `POST /warmup/<account_name>/complete` — mark warmup complete
- `GET /weekly-plan/export?proxy_id=&week=` — download JSON

### R7: SessionLog Integration

- Executor writes to `SessionLog` table: session_id, started_at, ended_at, status, error_message
- Dashboard polls `GET /today-sessions` every 30s
- Response includes `execution_status`: planned, running, completed, failed, skipped
- Match planned sessions to SessionLog entries by account + time window

## Dependencies
- 01-db-schema-migration (WeeklyPlan table, warmup fields in BotAccount)
- 02-tiktok-engine-integration (executor reads plan from DB)

## Non-goals
- No drag-and-drop session reordering
- No manual session creation
- No Instagram planner integration yet
- No WebSocket real-time updates (polling is sufficient)

## Acceptance Criteria
1. "Generate This Week" creates a unified plan with warmup + regular sessions
2. Today's timeline shows sessions in Eastern Time with correct platform colors
3. Warmup accounts have appropriate engagement caps in the plan
4. Phone order varies daily (not deterministic)
5. Adding a phone mid-week auto-regenerates remaining days
6. Warmup summary visible on Weekly Plan page
7. Full warmup controls work in Phone Settings
8. All times display in Eastern Time
9. Download JSON exports executor-compatible format
10. Session status updates every 30s from SessionLog
11. Planner accepts accounts from DB (not hardcoded config)
