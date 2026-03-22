# Section 04: API Routes (`planner_routes.py`)

## Overview

This section creates the Flask blueprint `planner_bp` that exposes all planner and warmup endpoints under the `/api/planner` prefix, plus one template route for the weekly plan page. All routes require `@login_required`. The blueprint delegates all business logic to `planner_service.py` (built in section-03).

## Dependencies

- **section-03-planner-service** must be complete.

## Files to Create/Modify

| File | Action |
|------|--------|
| `insta-phone-SAAS-sneder/app/planner_routes.py` | **CREATE** -- blueprint with 9 API + 1 template route |
| `insta-phone-SAAS-sneder/app/__init__.py` | **MODIFY** -- register `planner_bp` |

## Tests

File: `insta-phone-SAAS-sneder/tests/test_planner_routes.py`

```python
# Test: all routes require @login_required (401/302 without auth)
# Test: GET /api/planner/weekly-plan returns plan JSON (200)
# Test: GET /api/planner/weekly-plan returns 404 when no plan exists
# Test: POST /api/planner/weekly-plan/generate returns 201 with plan
# Test: POST /api/planner/weekly-plan/generate returns 400 on planner error
# Test: POST /api/planner/weekly-plan/regenerate returns updated plan
# Test: GET /api/planner/today-sessions returns sessions list
# Test: GET /api/planner/warmup/<account> returns warmup status
# Test: POST /api/planner/warmup/<account>/reset returns updated status
# Test: POST /api/planner/warmup/<account>/skip with target_day returns 200
# Test: POST /api/planner/warmup/<account>/complete returns 200
# Test: GET /api/planner/weekly-plan/export returns downloadable JSON
```

## Endpoint Specification

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/weekly-plan` | Render weekly-plan.html template |
| GET | `/api/planner/weekly-plan` | Get plan for proxy group + week |
| POST | `/api/planner/weekly-plan/generate` | Generate new plan |
| POST | `/api/planner/weekly-plan/regenerate` | Regenerate remaining days |
| GET | `/api/planner/today-sessions` | Today's sessions with status |
| GET | `/api/planner/warmup/<account_name>` | Warmup status |
| POST | `/api/planner/warmup/<account_name>/reset` | Reset warmup |
| POST | `/api/planner/warmup/<account_name>/skip` | Skip to day N |
| POST | `/api/planner/warmup/<account_name>/complete` | Mark complete |
| GET | `/api/planner/weekly-plan/export` | Download executor-compatible JSON |

## Implementation Details

### Error Handling Pattern

All routes wrap service calls in try/except, return 400 with `{"error": str(e)}` on failure. Required params validated at top of handler, return 400 if missing.

### Authentication

`@login_required` on every route (consistent with existing Flask-Login setup).

### Blueprint Registration

In `__init__.py` `create_app()`:
```python
from .planner_routes import planner_bp
app.register_blueprint(planner_bp)
```

### Response Formats

**Today's sessions:**
```json
{
  "sessions": [...],
  "current_time_et": "21:30",
  "timezone": "US/Eastern"
}
```

**Export:** `Content-Disposition: attachment; filename="weekly_plan_W{week}_{year}.json"`

### Date Parsing Helper

```python
def _parse_date(date_str: str) -> date:
    return date.fromisoformat(date_str)
```

### Current Time in Eastern

```python
from zoneinfo import ZoneInfo
current_time_et = datetime.now(ZoneInfo("US/Eastern")).strftime("%H:%M")
```
