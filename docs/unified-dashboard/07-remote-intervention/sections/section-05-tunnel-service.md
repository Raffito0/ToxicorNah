# Section 05: Tunnel Service

## Overview

This section implements `app/tunnel_service.py` and `app/tunnel_routes.py`. The `TunnelManager` singleton launches a Cloudflare Quick Tunnel subprocess that exposes the Flask dashboard (port 1090) to the internet, parses the generated URL from cloudflared's stderr output, and notifies the user via Telegram when a new tunnel URL is ready.

**Dependencies:** section-04-scrcpy-service must be complete before this section. The tunnel routes blueprint is registered in section-07-integration-wiring.

**Blocks:** section-06-dashboard-ui (needs tunnel URL endpoint) and section-07-integration-wiring.

---

## Background and Security Model

Cloudflare Quick Tunnels (`cloudflared tunnel --url`) create a temporary `*.trycloudflare.com` HTTPS URL that proxies to a local port. The URL changes on every restart.

**Critical security constraint:** The tunnel MUST point to the Flask app on port 1090, NOT to ws-scrcpy on port 8000. The ws-scrcpy server has zero authentication — anyone who discovers its URL has unauthenticated ADB control over all connected phones. The Flask dashboard has `@login_required` on all routes, so tunneling through it provides authentication for free.

Telegram notifications are sent on each tunnel start because the URL changes every time.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `app/tunnel_service.py` | NEW -- TunnelManager singleton |
| `app/tunnel_routes.py` | NEW -- Flask blueprint with 3 API endpoints |

The blueprint is registered in `app/__init__.py` in section-07.

---

## Tests First

**File:** `tests/test_tunnel_service.py`

```python
# Test: TunnelManager.start() launches cloudflared with correct args
#   - Command must include: cloudflared tunnel --url http://localhost:1090
#   - Port must be 1090 (Flask), never 8000 (ws-scrcpy)

# Test: TunnelManager.start() points to Flask port (1090), not ws-scrcpy (security)
#   - Assert "1090" in the command args
#   - Assert "8000" NOT in the command args

# Test: TunnelManager._parse_url() extracts .trycloudflare.com URL from stderr output
#   - Input: typical cloudflared stderr line containing https://abc-def.trycloudflare.com
#   - Output: "https://abc-def.trycloudflare.com"
#   - Edge case: line with noise before the URL still extracts correctly

# Test: TunnelManager.stop() terminates cloudflared process
#   - Mock subprocess; assert process.terminate() called (or taskkill on Windows)

# Test: TunnelManager.get_url() returns None when not running
#   - Fresh instance, never started -> get_url() returns None

# Test: TunnelManager.get_url() returns parsed URL when running
#   - After start() and URL parsed from stderr -> get_url() returns that URL

# Test: GET /api/tunnel/status returns running state and URL
#   - When stopped: {"running": false, "url": null}
#   - When running: {"running": true, "url": "https://...trycloudflare.com"}

# Test: POST /api/tunnel/start starts tunnel
#   - Mock TunnelManager.start(); assert 200 response

# Test: POST /api/tunnel/stop stops tunnel
#   - Mock TunnelManager.stop(); assert 200 response
```

Run with: `pytest tests/test_tunnel_service.py -v`

---

## Implementation: `app/tunnel_service.py`

### TunnelManager Class

Singleton. All state is instance-level; expose one global `_manager` and a module-level `get_manager()` function.

```python
# app/tunnel_service.py

import subprocess
import threading
import re
import logging
import sys
from typing import Optional

logger = logging.getLogger(__name__)

FLASK_PORT = 1090  # NEVER change to 8000 -- ws-scrcpy has no auth


class TunnelManager:
    """
    Manages a cloudflared Quick Tunnel subprocess that tunnels the Flask
    dashboard (port 1090) to a public trycloudflare.com URL.

    URL is parsed from cloudflared's stderr (cloudflared writes all output,
    including the tunnel URL, to stderr -- not stdout).

    Singleton: use get_manager() to get the shared instance.
    """

    def __init__(self, local_port: int = FLASK_PORT):
        self._port = local_port
        self._process: Optional[subprocess.Popen] = None
        self._url: Optional[str] = None
        self._lock = threading.Lock()
        self._stderr_thread: Optional[threading.Thread] = None

    def start(self) -> bool:
        """
        Launch cloudflared tunnel pointing at Flask (self._port).
        Spawns a background thread to read stderr and parse the URL.
        Returns True if started, False if already running.
        """
        ...

    def stop(self) -> None:
        """
        Terminate the cloudflared process.
        On Windows uses taskkill /F /PID to ensure process exits.
        Clears _url on stop.
        """
        ...

    def is_running(self) -> bool:
        """Return True if cloudflared subprocess is alive."""
        ...

    def get_url(self) -> Optional[str]:
        """Return the current tunnel URL, or None if not running/not yet parsed."""
        with self._lock:
            return self._url

    def _read_stderr(self) -> None:
        """
        Background thread: reads cloudflared stderr line-by-line.
        Calls _parse_url() on each line. Stops when process exits.
        """
        ...

    @staticmethod
    def _parse_url(line: str) -> Optional[str]:
        """
        Extract trycloudflare.com URL from a cloudflared stderr line.
        Returns the URL string or None if not found in this line.

        Typical cloudflared output line:
          2024-01-01T00:00:00Z INF  | https://abc-def-ghi.trycloudflare.com |
        """
        match = re.search(r'https://[a-z0-9\-]+\.trycloudflare\.com', line)
        return match.group(0) if match else None

    def _notify_telegram(self, url: str) -> None:
        """
        Send tunnel URL to user via Telegram.
        Called once per start() after URL is parsed from stderr.
        Uses PHONEBOT_TELEGRAM_TOKEN env var and PHONEBOT_TELEGRAM_CHAT_ID
        (or the Phone 1 supergroup as default notification target).
        Best-effort: log and swallow any Telegram API errors.
        """
        ...
```

### Key Implementation Notes

**cloudflared command:**
```
cloudflared tunnel --url http://localhost:1090
```
No `--no-autoupdate` needed for Quick Tunnels. On Windows, `cloudflared` must be on PATH or provide an absolute path (e.g. `C:\cloudflared\cloudflared.exe`). Store the path in a config constant or env var `CLOUDFLARED_PATH`.

**stderr reading is non-blocking by design.** cloudflared continues running after printing the URL. The background thread keeps reading so the process does not deadlock on a full stderr buffer. Use `iter(process.stderr.readline, b'')` with `text=True` encoding.

**URL parsing timing:** cloudflared typically prints the URL within 3-8 seconds of starting. `get_url()` may return `None` briefly after `start()` until the stderr thread parses it. Routes should handle this gracefully (return `{"url": null, "running": true}` while still starting up).

**Stop on Windows:** `process.terminate()` sends SIGTERM which cloudflared may ignore on Windows. Use:
```python
if sys.platform == 'win32':
    subprocess.run(['taskkill', '/F', '/PID', str(self._process.pid)], capture_output=True)
else:
    self._process.terminate()
```

**Thread safety:** `_url` is set in the stderr reader thread and read in the main/request threads. All reads and writes to `_url` must go through `self._lock`.

---

## Implementation: `app/tunnel_routes.py`

```python
# app/tunnel_routes.py

from flask import Blueprint, jsonify
from flask_login import login_required
from app.tunnel_service import get_manager

tunnel_bp = Blueprint('tunnel', __name__)


@tunnel_bp.route('/api/tunnel/status', methods=['GET'])
@login_required
def tunnel_status():
    """
    Returns:
      {"running": bool, "url": str | null, "local_port": 1090}
    """
    ...


@tunnel_bp.route('/api/tunnel/start', methods=['POST'])
@login_required
def tunnel_start():
    """
    Start cloudflared if not already running.
    Returns 200 with {"started": true} or {"already_running": true}.
    """
    ...


@tunnel_bp.route('/api/tunnel/stop', methods=['POST'])
@login_required
def tunnel_stop():
    """
    Stop cloudflared if running.
    Returns 200 with {"stopped": true} or {"not_running": true}.
    """
    ...
```

All routes require `@login_required` (Flask-Login). This is what provides authentication when the tunnel exposes the dashboard to the internet.

---

## Module-Level Singleton

At the bottom of `app/tunnel_service.py`:

```python
_manager: Optional[TunnelManager] = None

def get_manager() -> TunnelManager:
    """Return the shared TunnelManager singleton, creating it on first call."""
    global _manager
    if _manager is None:
        _manager = TunnelManager(local_port=FLASK_PORT)
    return _manager
```

`tunnel_routes.py` imports `get_manager` and calls it per-request. This avoids circular imports and is safe for testing (can reset `_manager = None` between tests).

---

## Environment Variables

| Var | Purpose | Required |
|-----|---------|----------|
| `CLOUDFLARED_PATH` | Full path to cloudflared binary (e.g. `C:\cloudflared\cloudflared.exe`). Falls back to `cloudflared` on PATH | No |
| `PHONEBOT_TELEGRAM_TOKEN` | Telegram bot token for URL notifications (already used elsewhere in the project) | Yes (for notifications) |
| `PHONEBOT_TELEGRAM_CHAT_ID` | Chat ID to send tunnel URL notifications. Defaults to Phone 1 supergroup `-1003628617587` | No |

---

## Cloudflared Installation

cloudflared is a single binary download from `https://github.com/cloudflare/cloudflared/releases`. No account or Cloudflare login needed for Quick Tunnels. Place it in the project or add to PATH. Document the path in `.env` or `config.py`.

No Cloudflare account, named tunnel, or cert.pem needed. Quick Tunnel works anonymously.

---

## What This Section Does NOT Cover

- Dashboard UI for tunnel status indicator -- that is section-06-dashboard-ui
- Blueprint registration in `create_app()` -- that is section-07-integration-wiring
- The Telegram notification implementation detail (format, which chat) is intentionally left to the implementer since the Telegram handler is set up in section-02; `_notify_telegram()` can either call the section-02 handler directly or use `requests` to call the Telegram Bot API directly
