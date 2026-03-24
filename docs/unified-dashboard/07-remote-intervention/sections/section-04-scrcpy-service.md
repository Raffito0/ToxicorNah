# Section 04: ws-scrcpy Server Management

## Overview

This section implements `ScrcpyManager` — a singleton class that manages the ws-scrcpy Node.js server process — and its companion API blueprint. It has no dependencies on other sections and can be implemented in parallel with section-01-intervention-gate.

**Depends on**: nothing
**Blocks**: section-05-tunnel-service, section-06-dashboard-ui

---

## Background

ws-scrcpy (github.com/NetrisTV/ws-scrcpy) is the real tool for browser-based phone screen viewing, not "scrcpy-web" (which does not exist). It is a Node.js server that bridges ADB-connected Android phones to a browser WebSocket client. One server instance serves ALL connected phones simultaneously — the user picks the target phone inside the ws-scrcpy web UI.

**Key characteristics:**
- Default port: 8000
- No built-in authentication — must never be exposed directly to the internet
- All ADB-connected phones appear automatically; no per-phone filtering needed in this code
- Prerequisites on the PC: Node.js installed, ws-scrcpy cloned and `npm install` done

**Security constraint**: ws-scrcpy has zero auth. Access must be restricted to:
1. **Local**: `http://localhost:8000` (only when sitting at the PC)
2. **Remote**: Only through the Flask dashboard (which has `@login_required`), via a "Live View" link/proxy, NOT by tunneling ws-scrcpy directly

The Cloudflare tunnel (section-05) points to Flask on port 1090, not to ws-scrcpy on 8000, precisely because of this constraint.

---

## Files to Create

| File | Action |
|------|--------|
| `app/scrcpy_service.py` | NEW -- ScrcpyManager singleton |
| `app/scrcpy_routes.py` | NEW -- Blueprint with 3 API endpoints |

---

## Tests First

**File**: `tests/test_scrcpy_service.py`

All tests mock `subprocess.Popen` so no actual Node.js process is launched. Use `unittest.mock.patch` and `MagicMock`.

```python
# Test: ScrcpyManager.start() launches subprocess with correct command (node, not npm)
#   Assert: Popen called with ['node', 'index.js'], cwd=ws_scrcpy_dir
#   Rationale: npm start on Windows creates cmd->npm->node tree; killing parent orphans node.exe

# Test: ScrcpyManager.stop() kills process tree on Windows (taskkill /F /T /PID)
#   Patch platform.system() to return 'Windows'
#   Assert: subprocess.run called with ['taskkill', '/F', '/T', '/PID', str(pid)]
#   Assert: manager.is_running() returns False after stop()

# Test: ScrcpyManager.is_running() returns True when process alive
#   Mock process.poll() to return None (still running)

# Test: ScrcpyManager.is_running() returns False when process dead
#   Mock process.poll() to return 0 (exited)

# Test: ScrcpyManager.get_url() returns localhost URL with configured port
#   Assert: returns 'http://localhost:8000' when port is default

# Test: ScrcpyManager.start() when already running is a no-op
#   Call start() twice; assert Popen called exactly once

# Test: GET /api/scrcpy/status returns correct running/stopped state
#   When stopped: {'running': False, 'port': 8000, 'url': None}
#   When running: {'running': True, 'port': 8000, 'url': 'http://localhost:8000'}

# Test: POST /api/scrcpy/start starts server, returns 200 with URL
#   Mock ScrcpyManager.start(); assert response contains 'url'

# Test: POST /api/scrcpy/stop stops server, returns 200
#   Mock ScrcpyManager.stop(); assert 200
```

Stub for test file:

```python
# tests/test_scrcpy_service.py
import pytest
from unittest.mock import patch, MagicMock
from app import create_app


@pytest.fixture
def client(app):
    """Use existing app fixture from conftest.py."""
    return app.test_client()


def test_start_uses_node_not_npm():
    """ScrcpyManager.start() must call 'node index.js', not 'npm start'."""
    ...


def test_stop_kills_process_tree_windows():
    """On Windows, stop() uses taskkill /F /T /PID to kill entire tree."""
    ...


def test_is_running_true_when_process_alive():
    ...


def test_is_running_false_when_process_dead():
    ...


def test_get_url_returns_localhost_url():
    ...


def test_start_noop_when_already_running():
    ...


def test_status_endpoint_stopped(client):
    ...


def test_status_endpoint_running(client):
    ...


def test_start_endpoint(client):
    ...


def test_stop_endpoint(client):
    ...
```

---

## Implementation: `app/scrcpy_service.py`

### ScrcpyManager class

Singleton — import `scrcpy_manager` (the global instance) wherever needed.

**Attributes:**
- `_process`: `subprocess.Popen | None` — handle to the running ws-scrcpy Node process
- `_port`: `int` — default 8000, configurable via constructor or env var `WS_SCRCPY_PORT`
- `_ws_scrcpy_dir`: `str` — path to the cloned ws-scrcpy directory. Read from env var `WS_SCRCPY_DIR`, default `C:\ws-scrcpy`
- `_watchdog_thread`: `threading.Thread | None` — daemon thread for crash recovery
- `_lock`: `threading.Lock` — protects `_process` access

**Method stubs:**

```python
class ScrcpyManager:
    """Manages the ws-scrcpy Node.js subprocess lifecycle."""

    def __init__(self, port: int = 8000):
        """Initialize with port and read WS_SCRCPY_DIR from env."""
        ...

    def start(self) -> bool:
        """
        Launch 'node index.js' in ws_scrcpy_dir.
        No-op if already running.
        Starts the watchdog thread after launching.
        Returns True if started, False if was already running.
        """
        ...

    def stop(self) -> None:
        """
        Terminate the ws-scrcpy process.
        On Windows: subprocess.run(['taskkill', '/F', '/T', '/PID', str(self._process.pid)])
        On Linux/Mac: self._process.terminate()
        Stops the watchdog thread.
        Sets _process to None.
        """
        ...

    def is_running(self) -> bool:
        """Return True if process exists and process.poll() is None."""
        ...

    def get_url(self) -> str | None:
        """Return 'http://localhost:{port}' if running, else None."""
        ...

    def _watchdog(self) -> None:
        """
        Daemon thread: check every 30s if process is alive.
        If dead and _should_watch is True, call start() to restart.
        Log restart events.
        Exits cleanly when _should_watch is set to False.
        """
        ...


# Singleton -- import this from routes and other modules
scrcpy_manager = ScrcpyManager()
```

**Important implementation detail -- Windows process killing:**

On Windows, `npm start` spawns: `cmd.exe` -> `npm.cmd` -> `node.exe`. If you kill only the top process, `node.exe` becomes an orphan and keeps holding the port. This is why the command must be `node index.js` directly (not `npm start`), so `_process.pid` IS the node process. But even so, use `taskkill /F /T /PID` for the stop to kill the whole tree robustly:

```python
import platform
import subprocess

def stop(self):
    with self._lock:
        if self._process is None:
            return
        if platform.system() == 'Windows':
            subprocess.run(
                ['taskkill', '/F', '/T', '/PID', str(self._process.pid)],
                capture_output=True
            )
        else:
            self._process.terminate()
        self._process = None
```

**Watchdog internals:**

The watchdog checks every 30 seconds whether the process is still alive. If not, it calls `start()`. Use a `threading.Event` (not `time.sleep`) for the 30-second wait so the watchdog can be interrupted cleanly on `stop()`:

```python
def _watchdog(self):
    while not self._stop_event.wait(timeout=30):
        if not self.is_running() and self._should_watch:
            logging.warning("ws-scrcpy crashed, restarting...")
            self.start()
```

Add `_stop_event = threading.Event()` and `_should_watch = False` as instance attributes. Set `_should_watch = True` on `start()`, clear it on `stop()`, and call `_stop_event.set()` to wake the watchdog thread immediately on stop.

---

## Implementation: `app/scrcpy_routes.py`

Blueprint with 3 endpoints. All endpoints use the `scrcpy_manager` singleton.

```python
# app/scrcpy_routes.py
from flask import Blueprint, jsonify
from flask_login import login_required
from app.scrcpy_service import scrcpy_manager

scrcpy_bp = Blueprint('scrcpy', __name__)


@scrcpy_bp.route('/api/scrcpy/status', methods=['GET'])
@login_required
def scrcpy_status():
    """
    Returns: {'running': bool, 'port': int, 'url': str|None}
    """
    ...


@scrcpy_bp.route('/api/scrcpy/start', methods=['POST'])
@login_required
def scrcpy_start():
    """
    Starts the ws-scrcpy server.
    Returns: {'started': bool, 'url': str, 'message': str}
    400 if WS_SCRCPY_DIR does not exist.
    """
    ...


@scrcpy_bp.route('/api/scrcpy/stop', methods=['POST'])
@login_required
def scrcpy_stop():
    """
    Stops the ws-scrcpy server.
    Returns: {'stopped': bool}
    """
    ...
```

**`start` endpoint behavior:**
- Before calling `scrcpy_manager.start()`, verify that `WS_SCRCPY_DIR` exists on disk. If not, return HTTP 400 with `{'error': 'ws-scrcpy directory not found: {path}. Clone ws-scrcpy and run npm install first.'}`.
- Return 200 with `url` if started or was already running.

**`status` endpoint response shape:**
```json
{
  "running": true,
  "port": 8000,
  "url": "http://localhost:8000"
}
```

When stopped, `url` is `null`.

---

## Registration in `app/__init__.py`

This is done in section-07, but note the import pattern:

```python
from app.scrcpy_routes import scrcpy_bp
app.register_blueprint(scrcpy_bp)
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_SCRCPY_DIR` | `C:\ws-scrcpy` | Path to cloned ws-scrcpy repo |
| `WS_SCRCPY_PORT` | `8000` | Port ws-scrcpy listens on |

These should be added to the `.env` file and loaded via `os.environ.get()` in `ScrcpyManager.__init__()`.

---

## Prerequisites (User Setup)

Before this code can run, the user must:

1. Clone ws-scrcpy: `git clone https://github.com/NetrisTV/ws-scrcpy.git C:\ws-scrcpy`
2. Install deps: `cd C:\ws-scrcpy && npm install`
3. Confirm phones are connected and visible to `adb devices`
4. Set `WS_SCRCPY_DIR=C:\ws-scrcpy` in `.env`

The `start` endpoint validates step 1/2 exist (directory check). Steps 3/4 are runtime failures that will be visible in process stdout/stderr (not caught here).

---

## What This Section Does NOT Do

- Does not manage per-phone scrcpy instances (one instance serves all)
- Does not proxy the ws-scrcpy WebSocket through Flask (the "Live View" button in section-06 opens ws-scrcpy directly in a new browser tab at `http://localhost:8000`)
- Does not expose ws-scrcpy through the Cloudflare tunnel (that is section-05's responsibility, and it tunnels Flask, not ws-scrcpy)
- Does not read or parse ws-scrcpy stdout/stderr for device list (not needed — user selects phone in ws-scrcpy UI)
