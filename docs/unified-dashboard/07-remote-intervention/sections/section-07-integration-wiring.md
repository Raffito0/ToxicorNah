# Section 07: Integration Testing & Wiring

## Overview

This is the final section of the Remote Intervention feature. All five previous sections must be complete before starting this one:

- **Section 01** (`intervention-gate`): `phone-bot/core/intervention.py` -- `InterventionGate` singleton with `request_pause`, `check_and_wait`, `resolve`, `get_pending`
- **Section 02** (`telegram-handler`): `app/telegram_handler.py` -- PTB v22+ polling handler with `/done`, `/skip`, `/takeover`, `/resume`, `/status` and inline keyboard callbacks
- **Section 03** (`intervention-routes`): `app/intervention_routes.py` -- `InterventionLog` CRUD, active/history/resolve routes
- **Section 04** (`scrcpy-service`): `app/scrcpy_service.py` + `app/scrcpy_routes.py` -- ws-scrcpy subprocess management
- **Section 05** (`tunnel-service`): `app/tunnel_service.py` + `app/tunnel_routes.py` -- cloudflared Quick Tunnel management
- **Section 06** (`dashboard-ui`): `app/templates/after-login.html` + `app/static/js/intervention.js` -- Live View button, Take Over/Release, intervention status bar, tunnel indicator

This section wires everything together in `app/__init__.py` and proves the full system works via integration tests.

---

## Tests First

**File**: `tests/test_intervention_integration.py`

Framework: pytest with in-memory SQLite (existing `conftest.py` fixtures: `app`, `db`, `client`, `_make_user`, `_make_tiktok_bot`).

```python
"""
Integration tests for the full Remote Intervention flow.

Tests cover:
- Full pause-approve flow end-to-end (gate + Telegram + log)
- Full pause-skip flow end-to-end
- Full pause-timeout flow (short timeout)
- InterventionLog lifecycle across pause and resolve
- Blueprint registration -- all new blueprints register cleanly
- Regression: existing dashboard endpoints still work after blueprint registration
"""
import threading
import time
import pytest
from app import create_app
from app.models import db, InterventionLog
from phone_bot.core.intervention import intervention_gate  # singleton

# Test: Full pause-approve flow
# - Simulate a worker thread calling gate.check_and_wait()
# - From another thread, call gate.resolve(phone_id, "approve")
# - Assert check_and_wait() returns "approve"
# - Assert InterventionLog created on pause, resolved_at set on resolve

# Test: Full pause-skip flow
# - Same pattern, resolve with "skip"
# - Assert check_and_wait() returns "skip"

# Test: Full pause-timeout flow
# - Call check_and_wait() with timeout_s=0.1
# - Do NOT call resolve() from any thread
# - Assert check_and_wait() returns "timeout" within ~0.5s

# Test: InterventionLog is created on pause and updated on resolve
# - call create_intervention() -> assert record in DB, resolved_at IS NULL
# - call resolve_intervention() -> assert resolved_at IS NOT NULL, resolution set

# Test: Blueprints register without errors in create_app()
# - Inspect app.blueprints dict for presence of:
#   'intervention', 'scrcpy', 'tunnel'
# - No assertion errors, no import errors

# Test: Dashboard endpoint still works after blueprint registration (no regression)
# - GET /dashboard or / with authenticated client
# - Assert 200 response
```

Each test is independent. Use `threading.Thread(target=..., daemon=True)` for concurrent resolution tests. Keep timeout values at 0.1-0.5 seconds in tests -- never use the production 1800-second default.

---

## Implementation: `app/__init__.py` Changes

**File to modify**: `app/__init__.py`

The `create_app()` factory must register all four new blueprints and optionally start the Telegram handler daemon thread.

### Blueprint Registration

Inside `create_app()`, after existing blueprint registrations, add:

```python
from app.intervention_routes import intervention_bp
from app.scrcpy_routes import scrcpy_bp
from app.tunnel_routes import tunnel_bp

app.register_blueprint(intervention_bp)
app.register_blueprint(scrcpy_bp)
app.register_blueprint(tunnel_bp)
```

The `telegram_handler.py` does NOT use a Flask blueprint -- it is a daemon thread, not a route handler. It is started separately (see below).

### Telegram Handler Startup

The Telegram handler can be started in two ways. Choose one based on deployment preference:

**Option A -- Auto-start on app creation (recommended for production):**
```python
from app.telegram_handler import TelegramCommandHandler

if not app.config.get('TESTING'):
    tg_handler = TelegramCommandHandler(app)
    tg_handler.start()  # starts daemon thread
```

The `TESTING` guard is critical -- PTB polling must not start during pytest runs (it would block test teardown and make spurious network calls).

**Option B -- Manual start via dashboard button:**
Do not auto-start. Expose a `POST /api/telegram/start` route that starts the handler on demand. Simpler for development but less suitable for unattended operation.

The plan recommends Option A with the `TESTING` guard.

### `TelegramCommandHandler` Constructor Signature

The handler needs a reference to the Flask app to push `app.app_context()` before DB writes:

```python
class TelegramCommandHandler:
    def __init__(self, flask_app):
        """
        Args:
            flask_app: The Flask application instance. Used to push an
                       app context when performing DB writes (InterventionLog).
        """
```

### Shutdown Hook

Register a teardown so the Telegram handler stops cleanly when Flask shuts down:

```python
import atexit

@atexit.register
def _shutdown_telegram():
    if tg_handler:
        tg_handler.stop()
```

---

## Full Flow Walkthrough

This is the canonical end-to-end sequence. Use it to manually verify the integrated system before running automated tests.

### Prerequisites

1. Dashboard running on `http://localhost:1090`
2. ws-scrcpy installed at configured path, `npm install` done
3. cloudflared binary available on PATH
4. All three Samsung phones connected via USB (`adb devices` shows all three)
5. `PHONEBOT_TELEGRAM_TOKEN` env var set
6. Per-phone Telegram chat IDs mapped in `app/telegram_handler.py`:
   - Phone 1 -> `-1003628617587`
   - Phone 2 -> `-1003822830975`
   - Phone 3 -> `-1003808705017`

### Step-by-Step Manual Test

1. **Start dashboard** -- `create_app()` runs -- `TelegramCommandHandler` daemon thread starts -- begins polling @Ueien_bot
2. **Start bot session** on Phone 2 from the dashboard
3. **Bot runs** `browse_session()` in worker thread -- eventually reaches `post_video()` call site
4. **Pre-post check fires** -- `_check_pre_post_pause()` in `tiktok.py`:
   - Calls `intervention_gate.request_pause(phone_id=2, reason="pre_post")`
   - The registered Telegram callback sends notification to `-1003822830975`:
     ```
     Phone 2 -- ph2_tiktok
     Ready to post video (Warmup Day 7/7)

     Watch live: https://<tunnel>.trycloudflare.com

     [Approve] [Skip] [Take Over]
     ```
   - Creates `InterventionLog` record in DB (`resolved_at=NULL`)
   - Worker thread blocks on `intervention_gate.check_and_wait(phone_id=2, timeout_s=1800)`
5. **User taps "Approve"** -- `CallbackQueryHandler` fires in the Telegram daemon thread
   - `intervention_gate.resolve(phone_id=2, "approve")` -- `event.set()` unblocks worker thread immediately
   - Original Telegram message edited to "Approved, posting..."
   - `InterventionLog.resolved_at` and `resolution="approve"` updated in DB
6. **Worker thread resumes** -- `check_and_wait()` returned `"approve"` -- `post_video()` is called -- video posts
7. **Verify** in the dashboard intervention history for Phone 2 -- one log entry, approved, timestamps correct

### Alternative: Timeout Path

If the user does not respond within 30 minutes:
- `check_and_wait()` returns `"timeout"`
- `_check_pre_post_pause()` treats timeout as skip (does NOT call `post_video()`)
- `InterventionLog.resolution` = `"timeout"` is written
- Telegram message is edited to "Timed out -- post skipped"

---

## File Checklist

All files that must exist before this section's tests can pass:

| File | Provided By | Required For |
|------|-------------|-------------|
| `phone-bot/core/intervention.py` | Section 01 | Integration tests, gate singleton |
| `phone-bot/actions/tiktok.py` | Section 01 (modified) | End-to-end flow |
| `phone-bot/planner/executor.py` | Section 01 (modified) | End-to-end flow |
| `app/telegram_handler.py` | Section 02 | Blueprint startup, flow test |
| `app/intervention_routes.py` | Section 03 | `intervention_bp` registration |
| `app/models.py` | Section 03 (verified) | `InterventionLog` DB writes |
| `app/scrcpy_service.py` | Section 04 | `ScrcpyManager` singleton |
| `app/scrcpy_routes.py` | Section 04 | `scrcpy_bp` registration |
| `app/tunnel_service.py` | Section 05 | `TunnelManager` singleton |
| `app/tunnel_routes.py` | Section 05 | `tunnel_bp` registration |
| `app/templates/after-login.html` | Section 06 (modified) | Dashboard regression test |
| `app/static/js/intervention.js` | Section 06 | Dashboard regression test |
| `app/__init__.py` | This section (modified) | Blueprint wiring |
| `tests/test_intervention_integration.py` | This section | Integration test suite |

---

## Key Pitfalls to Avoid

**PTB polling in test mode.** `Application.run_polling()` with `stop_signals=None` is required when running in a thread (PTB v22+ uses `asyncio.run()` internally which registers signal handlers -- only valid on the main thread). The `TESTING` guard in `create_app()` prevents the polling thread from starting during pytest. Forgetting this causes test hangs or `RuntimeError: This event loop is already running`.

**Thread-safety of the gate singleton.** The `InterventionGate` singleton in `phone-bot/core/intervention.py` is shared across the Flask process and phone-bot worker threads. All access must go through the `threading.Lock`. Never access `_pending` directly from outside the class.

**Blueprint name collisions.** Each blueprint must have a unique `name` argument. Use `intervention_bp`, `scrcpy_bp`, `tunnel_bp` consistently as the variable names and `url_prefix` values (e.g. `/api/interventions`, `/api/scrcpy`, `/api/tunnel`).

**Windows process tree for ws-scrcpy.** `ScrcpyManager.stop()` must use `taskkill /F /T /PID {pid}` -- not `process.terminate()` -- to kill the full Node.js process tree on Windows. `process.terminate()` only kills the parent, leaving orphaned `node.exe` processes holding the port.

**cloudflared URL is on stderr.** `TunnelManager` must read cloudflared's **stderr** stream in a background thread. Reading from stdout will block forever (cloudflared writes nothing to stdout). The URL pattern to match: `https://[a-z0-9-]+\.trycloudflare\.com`.

**Tunnel points to Flask, not ws-scrcpy.** The Quick Tunnel must point to `http://localhost:1090` (the Flask dashboard with `@login_required`). Tunneling directly to ws-scrcpy port 8000 would expose unauthenticated ADB control to anyone who discovers the URL.

**InterventionLog DB writes from the Telegram daemon thread.** The PTB callback handlers run in the daemon thread's asyncio event loop, outside Flask's request context. Before any `db.session` operation in a callback, push the Flask app context: `with flask_app.app_context(): ...`.

**Regression guard.** After registering all new blueprints, run the existing dashboard integration tests (not just the new ones) to confirm no route conflicts or import errors were introduced.
