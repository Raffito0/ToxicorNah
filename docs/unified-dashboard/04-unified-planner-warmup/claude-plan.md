# Implementation Plan  --  04 Unified Planner + Warmup

## 1. Overview

### What We're Building
A unified session planner integrated into the Flask dashboard that merges warmup sessions and regular sessions into one weekly plan per proxy group. The dashboard provides a visual timeline of today's sessions, live execution status via polling, warmup management controls, and week navigation.

### Why This Approach
Currently the planner is a standalone CLI tool outputting JSON files, warmup state lives in a separate JSON file, and the executor reads from disk. This creates fragmentation: no single source of truth, no live visibility, no way to regenerate on-the-fly. By integrating everything through the DB, the dashboard becomes the control center while the executor reads the same DB.

### System Boundaries
- **Planner module** (`Weekly & Daily Plan/planner/`)  --  stays in place, imported via `sys.path`. Refactored to accept accounts as parameter instead of hardcoding.
- **Flask dashboard** (`insta-phone-SAAS-sneder/app/`)  --  gets new blueprint, service layer, templates, and static assets.
- **Phone-bot executor** (`phone-bot/planner/executor.py`)  --  modified to read plans from DB instead of JSON files.
- **DB**  --  existing SQLite via SQLAlchemy. WeeklyPlan table exists. BotAccount.warmup_json exists.

### Key Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Proxy groups | Build now, 1 group initially | Architecture supports future multi-proxy without refactor |
| Planner import | sys.path addition | Avoids code duplication, planner stays independently testable |
| Timezone | Planner stays Eastern, convert at DB boundary | Minimal planner changes, clean separation |
| Warmup state | Migrate to DB (BotAccount.warmup_json) | Single source of truth, executor + dashboard read same data |
| Executor feed | DB direct | No more JSON file sync, DB is authoritative |
| Auto-regen | On phone add | Immediate plan update when infrastructure changes |
| Session status | Poll SessionLog every 30s | Simple, no WebSocket complexity for a single-user dashboard |

---

## 2. Planner Refactoring

### 2.1 Account Parameterization

The planner currently reads `config.ACCOUNTS` (hardcoded list of 6 account dicts). Refactor `scheduler.py`:

```python
def generate_weekly_plan(accounts: list[dict], start_date: date | None = None) -> WeeklyPlan:
    """Generate weekly plan for a set of accounts.

    accounts: list of dicts with keys: name, phone_id, platform, warmup_state (optional)
    """
```

**All functions that reference `config.ACCOUNTS` or `config.PHONES` must be updated:**

| Module | Function | Change |
|--------|----------|--------|
| `scheduler.py` | `generate_weekly_plan()` | Accept `accounts` param instead of reading `config.ACCOUNTS` |
| `scheduler.py` | `_assign_weekly_special_days()` | Accept `accounts` param, derive phones from it |
| `scheduler.py` | `generate_daily_plan()` | Accept `accounts` param |
| `scheduler.py` | `_build_session()` | Receives individual account dict (already does) |
| `rules_engine.py` | `validate_cross_phone()` | Accept phone list as param |
| `personality.py` | `initialize_all_accounts()` | Accept account name list instead of reading config |
| `personality.py` | `load_state()` / `save_state()` | **Remove file I/O entirely** -- personality state passed in from service layer |

- Extract `PHONES` list from accounts: `phones = sorted(set(a['phone_id'] for a in accounts))`
- Keep `config.py` for rule parameters, time slots, proxy config -- only accounts + personality become dynamic
- Personality state: service layer reads `BotAccount.personality_json` from DB, passes to planner, writes back after generation. Planner no longer does file I/O for personality (`state/account_state.json` no longer needed)

### 2.2 Warmup Session Interleaving

Add warmup awareness to the session generation flow:

**New session types** (added to existing `normal`, `aborted`, `extended`, `rest_only`):
- `warmup` -- active warmup session with engagement caps
- `warmup_lazy` -- minimal activity session

Note: dead days produce NO session (account skipped entirely). There is no `warmup_dead` session type in the output.

**In `_build_session()`** (note: this function returns a plain dict, not a Session dataclass instance):
- Check if account has `warmup_state` and `warmup_state.completed == False`
- If warmup active, read the warmup_plan dict for today's day number and day type
- Dead day -> return `None` (skipped in plan)
- Lazy day -> session_type = `warmup_lazy`, duration 3-5 min, zero engagement caps
- Normal warmup day -> session_type = `warmup`, caps read from warmup_plan for that day
- Warmup accounts: always 1 session/day (never 2), no aborted/extended variants

**Engagement caps stored in session dict:**

Since `_build_session()` returns a dict (not a Session dataclass), add `engagement_caps` as a key in the returned dict. Also add the field to the `Session` dataclass and its `to_dict()` method for the formatter output path:

```python
@dataclass
class Session:
    # ... existing fields ...
    engagement_caps: dict | None  # None for regular sessions
```

**Cap values come from the existing warmup plan** (generated by `warmup.py`'s `generate_warmup_plan()`). The plan contains per-day type/caps that include dead days, lazy days, and non-monotonic engagement progression. The table below is documentation of the general pattern, not a replacement for the warmup plan logic:

| Days | scroll_only | likes | comments | follows | search | post |
|------|-------------|-------|----------|---------|--------|------|
| 1-2  | True        | 0     | 0        | 0       | 0      | No   |
| 3-4  | False       | 0-10  | 0        | 0       | 0      | No   |
| 5-7  | False       | 5-20  | 0-3      | 0-5     | 0-2    | Maybe|

**Warmup sessions get same time slot treatment as regular**  --  random mix, no preference for earlier/quieter slots.

### 2.3 Proxy Group Support

Modify `generate_weekly_plan()` to work per-group:
- Caller (planner_service) filters accounts by proxy_id before calling
- Plan generation treats the filtered list as "all accounts"
- WeeklyPlan record gets `proxy_id` FK
- Multiple plans can coexist for different proxy groups (generated independently)

No changes needed inside the planner for parallel group support  --  the parallelism is at the service layer (one call per group).

### 2.4 Mid-Week Regeneration

New function in `scheduler.py`:

```python
def regenerate_from_date(accounts: list[dict], from_date: date, existing_plan: WeeklyPlan) -> WeeklyPlan:
    """Regenerate days from from_date forward, preserving earlier days."""
```

- Keeps `daily_plans` for dates before `from_date` unchanged
- Regenerates dates from `from_date` through Sunday
- Re-applies personality refresh, special day assignments for remaining days only
- Returns new WeeklyPlan with mixed old + new days
- Account summaries recalculated from all days

---

## 3. Service Layer

### 3.1 Planner Service (`app/planner_service.py`)

Wraps planner module with DB integration. All timezone conversion happens here.

**Key functions:**

```python
def generate_weekly_plan(proxy_id: int, week_date: date | None = None) -> dict:
    """Query accounts for proxy group, generate plan, store in DB, return plan dict."""

def regenerate_remaining_days(proxy_id: int, from_date: date) -> dict:
    """Load current plan, regenerate from_date forward, update DB."""

def get_today_sessions(proxy_id: int | None = None) -> list[dict]:
    """Return today's sessions with execution status from SessionLog."""

def get_current_plan(proxy_id: int) -> WeeklyPlan | None:
    """Return active WeeklyPlan record for proxy group."""

def get_warmup_status(account_name: str) -> dict:
    """Read BotAccount.warmup_json, return structured warmup status."""

def update_warmup(account_name: str, action: str, **kwargs) -> dict:
    """Reset, skip, or complete warmup for account."""
```

**Account query:**
```python
def _get_accounts_for_proxy(proxy_id: int) -> list[dict]:
    """Join BotAccount -> Bot (has proxy_id) -> Phone, filter by Bot.proxy_id, return account dicts with warmup_state and personality_state."""
```

Note: `proxy_id` is on the `Bot` model, not `Phone`. The join path is `BotAccount -> Bot.proxy_id`.

**Personality state round-trip:**
1. Service reads `BotAccount.personality_json` for each account
2. Passes personality dict into planner via account dict
3. Planner uses personality for scheduling (refresh if due, apply traits)
4. Service writes updated personality back to `BotAccount.personality_json`
5. `state/account_state.json` is no longer used

**Timezone conversion pattern:**
- Planner outputs `Session.start_time` as `time` object (Eastern)
- Service combines with plan date to create `datetime` in Eastern
- Converts to UTC via `zoneinfo.ZoneInfo("US/Eastern")` -> `.astimezone(ZoneInfo("UTC"))`
- Stores UTC datetime strings in `plan_json`
- When reading back: converts UTC -> Eastern for display

**Plan storage:**
- Serialize WeeklyPlan to JSON
- UPSERT pattern: UPDATE existing row for (proxy_id, week_number, year) with new plan_json and status='active'. If no row exists, INSERT. This avoids unique constraint violations when regenerating plans.
- Only one row per (proxy_id, week_number, year) -- no archiving needed for single-user dashboard

**Field name mapping** (planner output -> API/DB format):

| Planner key | API key | Notes |
|-------------|---------|-------|
| `account` | `account_name` | Standardize to full name |
| `type` | `session_type` | Avoid generic "type" |
| `phone` | `phone_id` | Explicit int |
| `time_slot` | `time_slot_name` | Descriptive |

Translation happens in `planner_service.py` after receiving planner output, before storing in DB.

### 3.2 Session Status Enrichment

**Deterministic session_id:** Each session in the plan gets a unique ID: `{date}_{account_name}_{session_number}` (e.g., `2026-03-22_ph2_tiktok_1`). Generated during plan creation, stored in plan_json. Executor writes this same session_id to SessionLog when starting execution.

`get_today_sessions()` joins planned sessions with `SessionLog`:
- Match on `session_id` (deterministic, no time-window ambiguity)
- Add `execution_status` field: `planned` (no log), `running` (started_at set, ended_at null), `completed` (ended_at set, status=success), `failed` (ended_at set, status=error), `skipped`

---

## 4. API Routes

### 4.1 Blueprint (`app/planner_routes.py`)

Blueprint `planner_bp` with prefix `/api/planner`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/weekly-plan` | Get plan for proxy group + week (`?proxy_id=&week_number=&year=`) |
| POST | `/weekly-plan/generate` | Generate new plan (`{proxy_id, week_date?}`) |
| POST | `/weekly-plan/regenerate` | Regenerate remaining days (`{proxy_id, from_date}`) |
| GET | `/today-sessions` | Today's sessions with status (`?proxy_id=`) |
| GET | `/warmup/<account_name>` | Warmup status for account |
| POST | `/warmup/<account_name>/reset` | Reset warmup to day 1 |
| POST | `/warmup/<account_name>/skip` | Skip to day N (`{target_day}`) |
| POST | `/warmup/<account_name>/complete` | Mark warmup complete |
| GET | `/weekly-plan/export` | Download executor-compatible JSON (`?proxy_id=&week_number=&year=`) |

**Template routes** (separate from API):
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/weekly-plan` | Render weekly plan page (Jinja2 template) |

### 4.2 Response Formats

**Today's sessions response:**
```json
{
  "sessions": [
    {
      "account_name": "ph2_tiktok",
      "phone_id": 2,
      "platform": "tiktok",
      "start_time_utc": "2026-03-22T00:45:00Z",
      "start_time_et": "19:45",
      "end_time_et": "20:11",
      "duration_minutes": 26,
      "session_type": "normal",
      "post_scheduled": true,
      "engagement_caps": null,
      "execution_status": "completed"
    }
  ],
  "current_time_et": "21:30",
  "timezone": "US/Eastern"
}
```

**Warmup status response:**
```json
{
  "account_name": "ph1_tiktok",
  "current_day": 3,
  "total_days": 7,
  "day_type": "normal",
  "completed": false,
  "caps": {"likes": [0, 10], "comments": 0, "follows": 0},
  "profile_pic": {"day": 2, "done": true},
  "bio": {"day": 4, "done": false},
  "plan_summary": [
    {"day": 1, "type": "dead", "sessions": 0},
    {"day": 2, "type": "normal", "sessions": 1, "caps": {"scroll_only": true}}
  ]
}
```

---

## 5. Frontend

### 5.1 Weekly Plan Page (`app/templates/weekly-plan.html`)

Jinja2 template with Bootstrap dark mode (consistent with existing dashboard).

**Layout:**
- Sidebar: existing nav + new "Weekly Plan" item
- Main content: tab switcher (Today / Week Overview)
- Top bar: proxy group selector (dropdown), week navigator (<- Week 12 ->), action buttons

**Today's Timeline tab:**
- Left column: hour labels (00:00 through 23:00, Eastern Time)
- Main area: session blocks positioned proportionally
- Each block: colored by platform (TikTok #25F4EE, Instagram #E1306C), warmup = dashed border
- Block content: account name (e.g., "P2 TikTok"), time range, duration
- Status overlay: green check (completed), pulsing blue (running), red X (failed)
- Current time: red horizontal line spanning full width
- Right panel: warmup status summary cards (one per warmup-active account)

**Week Overview tab:**
- 7-column grid
- Each cell: phone name, session count, color dot per platform
- Rest days: orange highlight
- One-post days: badge
- Generate/Regenerate buttons at top

### 5.2 Timeline JavaScript (`app/static/js/weekly-plan.js`)

**Core functions:**
- `renderTimeline(sessions)`  --  positions session blocks based on start/end time
- `renderWeekOverview(plan)`  --  builds week grid
- `pollSessionStatus()`  --  fetches `/api/planner/today-sessions` every 30s, updates status indicators
- `updateTimeMarker()`  --  moves current-time line every 60s
- `showSessionDetail(session)`  --  populates and shows detail modal
- `generatePlan()`  --  POST to generate endpoint, reload on success
- `regeneratePlan()`  --  POST to regenerate endpoint
- `downloadJSON()`  --  fetch export endpoint, trigger download
- `navigateWeek(direction)`  --  change week, reload plan

**Block positioning algorithm:**
```
top = (startMinutes / 1440) * timelineHeight
height = (durationMinutes / 1440) * timelineHeight
// Minimum height: 20px for very short sessions
```

**Polling loop** (use setTimeout to avoid request accumulation):
```javascript
async function pollLoop() {
    const data = await fetch('/api/planner/today-sessions?proxy_id=' + proxyId);
    updateSessionStatuses(data.sessions);
    setTimeout(pollLoop, 30000);
}
```

### 5.3 Timeline Styles (`app/static/css/weekly-plan.css`)

- Dark theme consistent with existing dashboard (#1a1a2e background)
- Session block colors: TikTok blue, Instagram pink, warmup dashed border
- Status colors: completed green (#43A047), running blue pulse, failed red (#E53935)
- Current time marker: 2px solid red line, z-index above blocks
- Responsive: at < 768px, timeline becomes full-width, detail modal becomes full-screen
- Modal: glassmorphism backdrop, dark card

### 5.4 Warmup Controls in Phone Settings

Extend existing `phone-settings.html` template:
- New section per BotAccount: "Warmup Status"
- Progress bar with day count
- Day type badge
- Caps display table
- Action buttons: Reset, Skip to Day, Mark Complete
- Each button POSTs to `/api/planner/warmup/<account_name>/<action>`

---

## 6. Executor Modifications

### 6.1 DB Plan Reading

Modify `SessionExecutor` to read from DB instead of JSON files:

- Import SQLAlchemy models or use raw SQLite queries
- Query `WeeklyPlan` table: `WHERE proxy_id = ? AND status = 'active' AND week_number = ? AND year = ?`
- Parse `plan_json` to get today's sessions
- Convert UTC times back to Eastern for execution scheduling
- **Datetime format:** UTC times stored as ISO 8601 strings: `"2026-03-22T00:45:00Z"`. Parse with `datetime.fromisoformat()`, convert to Eastern with `.astimezone(ZoneInfo("US/Eastern"))`
- **Write session_id to SessionLog:** use the deterministic session_id from the plan (e.g., `2026-03-22_ph2_tiktok_1`)

### 6.2 Warmup State from DB

Replace `warmup_state.json` reads with `BotAccount.warmup_json` queries:
- `load_warmup_state(account_name)` -> query `BotAccount WHERE name = ?`, parse `warmup_json`
- `save_warmup_state(account_name, state)` -> update `BotAccount.warmup_json`
- `advance_warmup_day(account_name)` -> increment day, recalculate caps, save

### 6.3 SessionLog Writing

Executor writes execution records to `SessionLog` table:
- On session start: INSERT with `started_at`, `session_type`, `account_name`
- On session end: UPDATE with `ended_at`, `status` (success/error), `error_message`, `actions_json`
- Dashboard polls this table for live status

---

## 7. Database Changes

### 7.1 WeeklyPlan Table (already exists)

Verify existing schema has these columns:
- `id` (PK)
- `proxy_id` (FK to Proxy)
- `week_number` (int)
- `year` (int)
- `plan_json` (TEXT/JSON)
- `status` (VARCHAR: active, archived)
- `created_at` (DATETIME)
- Unique constraint: `(proxy_id, week_number, year)` -- plan storage uses UPSERT (UPDATE existing row), so this constraint is never violated

### 7.2 Session Model Extension

Add `engagement_caps` field to Session dataclass (planner side):
- Dictionary with cap values per engagement type
- None for regular sessions
- Serialized as part of `plan_json`

### 7.3 BotAccount.warmup_json (already exists)

Verify column exists. Migrate warmup state from JSON file:
- One-time migration script reads `warmup_state.json`
- For each account, updates `BotAccount.warmup_json` with warmup state
- After migration, `warmup_state.json` is no longer read

---

## 8. sys.path Integration

In Flask app's `__init__.py` or startup:

```python
import sys
import os
planner_path = os.path.join(os.path.dirname(__file__), '..', '..', 'Weekly & Daily Plan')
sys.path.insert(0, os.path.abspath(planner_path))
```

This allows:
```python
from planner.scheduler import generate_weekly_plan
from planner.models import WeeklyPlan, Session
from planner.rules_engine import validate_cross_phone
```

---

## 9. File Structure

```
insta-phone-SAAS-sneder/
  app/
    __init__.py              # MODIFY: register planner_bp, add sys.path for planner
    planner_service.py       # NEW: planner wrapper with DB integration
    planner_routes.py        # NEW: API + template routes blueprint
    templates/
      weekly-plan.html       # NEW: timeline page
      phone-settings.html    # MODIFY: add warmup panel section
    static/
      js/
        weekly-plan.js       # NEW: timeline rendering + polling
      css/
        weekly-plan.css      # NEW: timeline styles

Weekly & Daily Plan/
  planner/
    scheduler.py             # MODIFY: accept accounts param, warmup interleaving
    rules_engine.py          # MODIFY: warmup rules, engagement cap generation
    models.py                # MODIFY: add engagement_caps to Session
    config.py                # MODIFY: keep as defaults, remove hardcoded ACCOUNTS dependency

phone-bot/
  planner/
    executor.py              # MODIFY: read from DB, write SessionLog
    warmup.py                # MODIFY: read/write BotAccount.warmup_json instead of JSON file
```

---

## 10. Implementation Order

1. **Planner refactoring**  --  accounts as parameter, warmup interleaving, engagement caps, regeneration
2. **Service layer**  --  planner_service.py with DB integration, timezone conversion
3. **API routes**  --  planner_routes.py blueprint
4. **Frontend  --  timeline**  --  weekly-plan.html + weekly-plan.js + weekly-plan.css
5. **Frontend  --  warmup panel**  --  warmup summary on plan page, full controls in phone settings
6. **Executor modifications**  --  DB plan reading, warmup from DB, SessionLog writing
7. **Status polling**  --  live session status with 30s polling
8. **Auto-regeneration**  --  phone add triggers regenerate_remaining_days

---

## 11. Edge Cases & Error Handling

### Plan Generation Failures
- If planner raises an exception (e.g., no valid time slots), `planner_service` catches and returns error dict with message
- API route returns 400 with error description
- UI shows error toast

### No Active Plan
- If no plan exists for current week, timeline shows empty state with "Generate This Week" button
- `get_today_sessions()` returns empty list

### Warmup + Regular Mix Edge Cases
- All accounts in warmup (no regular sessions)  --  valid plan with only warmup sessions
- Account finishes warmup mid-week  --  day it completes, treated as regular from next plan
- Dead day for ALL accounts in a group  --  day has zero sessions (valid, no proxy needed)

### DST Transitions
- Planner generates Eastern times, which are timezone-aware
- Spring forward (March): 2:00 AM doesn't exist -> sessions scheduled in that window shift to 3:00 AM
- Fall back (November): 1:00 AM happens twice -> use `fold` parameter
- Service layer handles this during UTC conversion

### Concurrent Access
- Enable SQLite WAL mode at app startup: `PRAGMA journal_mode=WAL` (prevents SQLITE_BUSY errors when executor writes while dashboard reads)
- Only one row per (proxy_id, week_number, year) -- UPSERT pattern prevents constraint violations

### Authentication
- All `/api/planner/*` routes require `@login_required` (consistent with existing Flask-Login setup)
- Template route `/weekly-plan` also requires login
