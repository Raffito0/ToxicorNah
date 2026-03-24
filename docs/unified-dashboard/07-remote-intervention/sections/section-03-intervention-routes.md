# Section 03: InterventionLog Integration

## Overview

This section adds the CRUD service layer and Flask blueprint that expose `InterventionLog` records over HTTP. The API lets the dashboard resolve pending interventions without touching Telegram, and lets the frontend poll for active pauses.

**Depends on**: section-01 (InterventionGate singleton — `gate` is already importable by the time these routes are called)

**Blocks**: section-06 (dashboard UI polls these endpoints), section-07 (integration tests hit these endpoints)

---

## Background

The `InterventionLog` model already exists in `app/models.py` (lines 483-493). Its current columns are:

```
id                  Integer PK
bot_account_id      Integer FK -> bot_account.id   (NOT NULL)
session_id          String(100)                    (NOT NULL)
intervention_type   String(20)                     (NOT NULL)
requested_at        DateTime                       (default: utcnow)
resolved_at         DateTime                       (nullable)
resolution          String(20)                     (nullable)
telegram_message_id Integer                        (nullable)
```

The plan requires a `bot_id` FK linking to the `Bot` table (one level above `BotAccount`). Check whether this column is present before adding it — the migration must be idempotent.

`BotAccount.notify_before_post` (Boolean, default True) is also already in the model at line 274. No schema changes needed for that field.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `app/models.py` | MODIFY -- add `bot_id` FK to `InterventionLog` if absent |
| `app/intervention_routes.py` | NEW -- Flask blueprint |
| `tests/test_intervention_routes.py` | NEW -- pytest tests |

---

## Tests First

**File**: `tests/test_intervention_routes.py`

Use the existing `app`, `db`, and `client` fixtures from `conftest.py`. Use `_make_user()` and `_make_tiktok_bot()` helpers that already exist in other test files. Log in via the test client before each authenticated call.

```python
"""
Tests for intervention_routes.py blueprint.

Fixtures used (from conftest): app, db, client
Helpers used: _make_user(), _make_tiktok_bot()

All routes require @login_required -- unauthenticated requests must return 401.
"""

# Test: GET /api/interventions/active -- unauthenticated returns 401
# Test: GET /api/interventions/active -- empty list when no InterventionLog rows exist

# Test: GET /api/interventions/active -- returns only rows where resolved_at IS NULL
#   Setup: create two InterventionLog rows, resolve one, leave one pending
#   Assert: only the pending one appears in response JSON

# Test: GET /api/interventions/<bot_id>/history -- returns all rows for that bot_id
#   Setup: create rows for bot_id=1 and bot_id=2
#   Assert: querying bot_id=1 returns only its rows, sorted desc by requested_at

# Test: GET /api/interventions/<bot_id>/history -- unknown bot_id returns empty list (not 404)

# Test: POST /api/interventions/<bot_id>/resolve -- resolves first pending intervention
#   Body: {"resolution": "approve"}
#   Assert: resolved_at is set (not null), resolution == "approve", HTTP 200

# Test: POST /api/interventions/<bot_id>/resolve -- also calls gate.resolve(phone_id, decision)
#   Assert: InterventionGate.resolve() is called with the correct phone_id derived from bot_id

# Test: POST /api/interventions/<bot_id>/resolve -- returns 409 when no pending intervention found

# Test: create_intervention() creates an InterventionLog row with correct fields
#   Call the service function directly (not via HTTP)
#   Assert: id is set, requested_at is populated, resolved_at is None

# Test: resolve_intervention() sets resolved_at and resolution on an existing log entry

# Test: resolve_intervention() on already-resolved entry returns an error (does not overwrite)
```

---

## Model Change: Add `bot_id` to `InterventionLog`

Open `app/models.py` and locate the `InterventionLog` class (line 483). Add a `bot_id` column if it is not already present:

```python
bot_id = db.Column(db.Integer, db.ForeignKey('bot.id'), nullable=True)
```

`nullable=True` because existing rows in production do not have this value. The service layer will always populate it for new rows.

After adding the column, generate or write an Alembic migration:

```bash
flask db migrate -m "add bot_id to intervention_log"
flask db upgrade
```

Verify the migration SQL contains only `ADD COLUMN bot_id INTEGER` — no destructive changes.

---

## Service Layer

The service functions live at module level inside `app/intervention_routes.py` (co-located with the blueprint for simplicity — no separate `services/` module needed at this scale).

### `create_intervention(bot_id, account_id, intervention_type, session_id) -> InterventionLog`

Creates and commits a new InterventionLog entry. `intervention_type` is one of `"pre_post"`, `"warmup_first_post"`, `"manual"`. Returns the persisted object so the caller can store its `id` for later resolution.

Stub:

```python
def create_intervention(bot_id: int, account_id: int, intervention_type: str, session_id: str) -> InterventionLog:
    """Create and persist a new InterventionLog row. Returns the new row."""
    ...
```

### `resolve_intervention(intervention_id, resolution) -> tuple[bool, str]`

Sets `resolved_at` to now and `resolution` to the given string on the matching log entry. Returns `(True, "ok")` on success, `(False, "not_found")` or `(False, "already_resolved")` on error. Does NOT call `InterventionGate.resolve()` — the caller is responsible for that.

Stub:

```python
def resolve_intervention(intervention_id: int, resolution: str) -> tuple[bool, str]:
    """Set resolved_at + resolution on an InterventionLog row. Returns (success, reason)."""
    ...
```

### `get_active_interventions() -> list[InterventionLog]`

Returns all rows where `resolved_at IS NULL`, ordered by `requested_at` ascending.

### `get_bot_history(bot_id, limit=50) -> list[InterventionLog]`

Returns up to `limit` rows for the given `bot_id`, ordered by `requested_at` descending.

---

## Blueprint: `app/intervention_routes.py`

Register as a Flask blueprint with the prefix `/api/interventions`.

```python
from flask import Blueprint, jsonify, request
from flask_login import login_required
# Import InterventionGate singleton from phone-bot
# from phone_bot.core.intervention import gate   <- adjust import path as needed
# Import service functions defined in this file

intervention_bp = Blueprint('intervention', __name__, url_prefix='/api/interventions')
```

### `GET /api/interventions/active`

- Requires `@login_required`
- Calls `get_active_interventions()`
- Returns JSON array of intervention objects:
  ```json
  [
    {
      "id": 12,
      "bot_id": 3,
      "bot_account_id": 7,
      "session_id": "sess_abc123",
      "intervention_type": "pre_post",
      "requested_at": "2026-03-23T14:05:00Z",
      "resolved_at": null,
      "resolution": null,
      "telegram_message_id": 99
    }
  ]
  ```

### `GET /api/interventions/<int:bot_id>/history`

- Requires `@login_required`
- Calls `get_bot_history(bot_id)`
- Returns JSON array (same schema as above), empty array if no rows
- Does NOT return 404 for unknown bot — returns `[]`

### `POST /api/interventions/<int:bot_id>/resolve`

- Requires `@login_required`
- Body JSON: `{"resolution": "approve" | "skip"}`
- Finds the first active (unresolved) intervention for `bot_id`
- Calls `resolve_intervention(intervention_id, resolution)`
- Also calls `gate.resolve(phone_id, resolution)` to unblock any waiting worker thread. The `phone_id` for a given `bot_id` can be found by querying `Bot.query.get(bot_id).phone` (or equivalent model attribute)
- Returns `{"status": "ok", "intervention_id": 12}` on success
- Returns HTTP 409 with `{"error": "no_pending"}` if no pending intervention for this bot

---

## InterventionGate Import Path

The `InterventionGate` singleton lives in `phone-bot/core/intervention.py` (created in section-01). From `app/intervention_routes.py`, the import looks like:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'phone-bot'))
from core.intervention import gate
```

Alternatively, if the dashboard app and phone-bot are run from the same Python environment and `phone-bot/` is on `sys.path`, just use:

```python
from core.intervention import gate
```

The exact import path depends on how `create_app()` configures `sys.path`. Check `app/__init__.py` for any existing `sys.path` manipulation before deciding. The important thing is that both the phone-bot worker threads and Flask routes share the **same `gate` instance** — this only works if they run in the same process and import the same module object.

---

## Blueprint Registration

In `app/__init__.py`, inside `create_app()`, add after the existing blueprint registrations:

```python
from app.intervention_routes import intervention_bp
app.register_blueprint(intervention_bp)
```

---

## Serialization Helper

Add a private `_serialize(log: InterventionLog) -> dict` helper inside `intervention_routes.py` to convert model rows to JSON-safe dicts. Use `isoformat()` for datetime fields, return `None` for null datetimes. This helper is used by all three GET/list responses so they return consistent schemas.

---

## Edge Cases

1. **Race between Telegram resolve and dashboard resolve**: If the Telegram handler calls `gate.resolve()` first and the dashboard POST arrives a second later, `resolve_intervention()` will see `already_resolved` and return 409. This is correct — the resolution is already recorded. The dashboard should show a message like "Already resolved via Telegram."

2. **bot_id vs phone_id mapping**: The `Bot` model has a `phone` integer field (phone number 1/2/3). This is the `phone_id` that `InterventionGate` uses as its key. When routing `/resolve`, look up `bot.phone` from the `Bot` row to get the correct gate key.

3. **Flask app context in tests**: When calling service functions that touch the DB in tests, ensure you are inside an `app.app_context()`. The `app` and `db` fixtures from `conftest.py` handle this automatically.

4. **`session_id` field**: The `session_id` passed to `create_intervention()` should be the session identifier from the worker thread (from `_worker_status[phone_id]['session_id']` or equivalent). It is a string, not a FK — used for cross-referencing logs only.
