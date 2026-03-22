# Section 03: Planner Service

## Overview

This section creates `insta-phone-SAAS-sneder/app/planner_service.py`, the service layer that wraps the standalone planner module with DB integration. It handles account querying from SQLAlchemy models, timezone conversion (Eastern to UTC at DB boundary), UPSERT for plan storage, field name mapping, deterministic session ID generation, personality state round-trips via DB, warmup service functions, and SQLite WAL mode.

**Depends on:** section-01 (planner accepts `accounts` param), section-02 (warmup interleaving)

**Blocks:** section-04 (API routes), section-05 (timeline), section-06 (warmup panel), section-07 (executor DB), section-08 (polling)

## Files to Create/Modify

| File | Action |
|------|--------|
| `insta-phone-SAAS-sneder/app/planner_service.py` | **CREATE** -- entire service layer |
| `insta-phone-SAAS-sneder/app/__init__.py` | **MODIFY** -- add sys.path for planner, enable WAL mode |

## Tests

File: `insta-phone-SAAS-sneder/tests/test_planner_service.py`

```python
# ---- Account Query ----
# Test: _get_accounts_for_proxy returns accounts joined through BotAccount -> Bot -> proxy_id
# Test: _get_accounts_for_proxy returns dicts with keys: name, phone_id, platform, warmup_state, personality_state
# Test: _get_accounts_for_proxy with no matching proxy_id returns empty list

# ---- Plan Generation ----
# Test: generate_weekly_plan queries accounts by proxy_id from DB
# Test: generate_weekly_plan stores plan in WeeklyPlan table
# Test: generate_weekly_plan UPSERTS (updates existing row, no constraint violation)
# Test: generate_weekly_plan converts Eastern times to UTC in plan_json
# Test: generate_weekly_plan returns dict with week_number, year, days, account_summaries

# ---- Field Name Mapping ----
# Test: planner "account" -> API "account_name"
# Test: planner "type" -> API "session_type"
# Test: planner "phone" -> API "phone_id"
# Test: planner "time_slot" -> API "time_slot_name"

# ---- Session ID ----
# Test: session_id format is "{date}_{account}_{session_num}"
# Test: each session in stored plan_json has a unique session_id

# ---- Timezone ----
# Test: Eastern "19:45" on 2026-03-22 converts to UTC "2026-03-22T23:45:00Z" (EDT)
# Test: timezone round-trip Eastern -> UTC -> Eastern produces same time

# ---- Today Sessions ----
# Test: get_today_sessions returns sessions with execution_status
# Test: get_today_sessions returns empty list when no plan exists
# Test: session with matching SessionLog gets status='completed'
# Test: session with started_at but no ended_at gets status='running'
# Test: session with no SessionLog entry gets status='planned'

# ---- Personality Round-Trip ----
# Test: personality state read from BotAccount.personality_json
# Test: personality state written back after generation
# Test: BotAccount with personality_json=None gets fresh personality

# ---- Warmup Service ----
# Test: get_warmup_status reads from BotAccount.warmup_json
# Test: update_warmup reset sets current_day=0
# Test: update_warmup skip advances to target_day
# Test: update_warmup complete sets completed=True

# ---- WAL Mode ----
# Test: SQLite WAL mode is enabled at startup
```

## Implementation Details

### 1. sys.path Setup (`__init__.py`)

In `create_app()`, add planner path:

```python
planner_parent = os.path.normpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', 'Weekly & Daily Plan'))
if os.path.isdir(planner_parent) and planner_parent not in sys.path:
    sys.path.insert(0, planner_parent)
```

### 2. SQLite WAL Mode (`__init__.py`)

After `db.create_all()`:
```python
from sqlalchemy import text
db.session.execute(text("PRAGMA journal_mode=WAL"))
db.session.commit()
```

### 3. Account Query

```python
def _get_accounts_for_proxy(proxy_id: int) -> list[dict]:
    """Join BotAccount -> Bot (has proxy_id) -> Phone, filter by Bot.proxy_id."""
```

Returns dicts with: `name` (constructed as `ph{phone_id}_{platform}`), `phone_id`, `platform`, `warmup_state`, `personality_state`.

Note: `proxy_id` is on `Bot` model, not `Phone`. Join: `BotAccount.bot_id -> Bot.id` where `Bot.proxy_id == proxy_id`.

### 4. Plan Generation

```python
def generate_weekly_plan(proxy_id: int, week_date: date | None = None) -> dict:
```

Steps:
1. Query accounts via `_get_accounts_for_proxy(proxy_id)`
2. Build personality state dict from `BotAccount.personality_json`
3. Call planner's `generate_weekly_plan(accounts, start_date, state)`
4. Translate field names
5. Generate deterministic session_ids
6. Convert Eastern times to UTC
7. UPSERT into WeeklyPlan table
8. Write updated personality back to `BotAccount.personality_json`

### 5. Field Name Mapping

Helper `_translate_session_keys(session_dict) -> dict`:

| Planner key | API key |
|-------------|---------|
| `account` | `account_name` |
| `type` | `session_type` |
| `phone` | `phone_id` |
| `time_slot` | `time_slot_name` |

### 6. Deterministic Session ID

Format: `{date}_{account_name}_{session_number}` (e.g., `2026-03-22_ph2_tiktok_1`).

### 7. Timezone Conversion

```python
from zoneinfo import ZoneInfo
eastern = ZoneInfo("US/Eastern")
dt_eastern = datetime.combine(day_date, session_time, tzinfo=eastern)
dt_utc = dt_eastern.astimezone(ZoneInfo("UTC"))
# Store: "start_time_utc": dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
# Also: "start_time_et": session_time.strftime("%H:%M")
```

### 8. UPSERT Pattern

Query for existing row with `(proxy_id, week_number, year)`. If found: update `plan_json`, `generated_at`, `status='active'`. If not found: insert new row.

### 9. Session Status Enrichment

```python
def get_today_sessions(proxy_id: int | None = None) -> list[dict]:
```

Match on `session_id` (deterministic). Add `execution_status`: planned, running, completed, failed, skipped.

### 10. Warmup Service

```python
def get_warmup_status(account_name: str) -> dict:
    """Read BotAccount.warmup_json, return structured status."""

def update_warmup(account_name: str, action: str, **kwargs) -> dict:
    """Reset, skip, or complete warmup."""
```

### 11. Planner Import Aliases

```python
from planner.scheduler import generate_weekly_plan as planner_generate
from planner.models import WeeklyPlan as PlannerWeeklyPlan
```

Note: Planner's `WeeklyPlan` dataclass is distinct from DB model `WeeklyPlan`.

## Key Gotchas

1. Service must always pass accounts explicitly -- never let planner fall back to `config.ACCOUNTS`
2. `Bot.phone_ref_id` (FK int) vs `Bot.phone_id` (legacy string) -- use `phone_ref_id`
3. Account naming: construct as `f"ph{bot.phone_ref_id}_{account.platform}"`
4. Include `warmup_state` in account dict only if `completed == False`
5. WeeklyPlan unique constraint -- always UPSERT, never blind INSERT
