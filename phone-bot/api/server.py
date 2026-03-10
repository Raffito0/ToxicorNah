"""FastAPI web dashboard — monitor and control the bot from a browser."""
import asyncio
import logging
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from ..core.adb import ADBController
from ..core.proxy import ProxyQueue
from ..planner.executor import SessionExecutor

log = logging.getLogger(__name__)

app = FastAPI(title="Phone Bot Dashboard")

# Global state (set on startup)
_controllers: dict[int, ADBController] = {}
_proxy: ProxyQueue | None = None
_executor: SessionExecutor | None = None
_ws_clients: list[WebSocket] = []


# --- REST Endpoints --------------------------------------------------------

@app.get("/")
async def dashboard():
    return HTMLResponse(DASHBOARD_HTML)


@app.get("/api/devices")
async def get_devices():
    """List all connected devices and their status."""
    devices = []
    for phone_id, ctrl in _controllers.items():
        devices.append({
            "phone_id": phone_id,
            "name": ctrl.phone["name"],
            "serial": ctrl.serial,
            "connected": ctrl.is_connected(),
            "screen_on": ctrl.is_screen_on(),
            "current_app": ctrl.get_current_app(),
            "wifi": ctrl.get_wifi_ssid(),
            "is_proxy_active": _proxy and _proxy.active_phone_id == phone_id,
        })
    return {"devices": devices}


@app.get("/api/status")
async def get_status():
    return {
        "running": _executor._running if _executor else False,
        "active_phone": _proxy.active_phone_id if _proxy else None,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/start")
async def start_execution():
    """Start today's plan execution."""
    if _executor and not _executor._running:
        asyncio.create_task(_executor.run_today())
        return {"status": "started"}
    return {"status": "already_running"}


@app.post("/api/stop")
async def stop_execution():
    """Stop execution after current session."""
    if _executor:
        _executor.stop()
        return {"status": "stopping"}
    return {"status": "not_running"}


@app.post("/api/test/{phone_id}")
async def test_phone(phone_id: int):
    """Test a specific phone connection."""
    ctrl = _controllers.get(phone_id)
    if not ctrl:
        return {"error": "Phone not found"}

    return {
        "phone_id": phone_id,
        "connected": ctrl.is_connected(),
        "screen_on": ctrl.is_screen_on(),
        "current_app": ctrl.get_current_app(),
        "screenshot_ok": ctrl.screenshot_bytes() != b"",
    }


@app.post("/api/screenshot/{phone_id}")
async def take_screenshot(phone_id: int):
    """Take a screenshot of a phone (returns base64)."""
    import base64
    ctrl = _controllers.get(phone_id)
    if not ctrl:
        return {"error": "Phone not found"}

    raw = ctrl.screenshot_bytes()
    if raw:
        return {"image": base64.b64encode(raw).decode()}
    return {"error": "Screenshot failed"}


# --- WebSocket for live updates -------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.append(ws)
    try:
        while True:
            # Send status every 3 seconds
            status = {
                "running": _executor._running if _executor else False,
                "active_phone": _proxy.active_phone_id if _proxy else None,
                "devices": [],
            }
            for phone_id, ctrl in _controllers.items():
                status["devices"].append({
                    "phone_id": phone_id,
                    "current_app": ctrl.get_current_app(),
                    "is_proxy_active": _proxy and _proxy.active_phone_id == phone_id,
                })
            await ws.send_json(status)
            await asyncio.sleep(3)
    except WebSocketDisconnect:
        _ws_clients.remove(ws)


# --- Dashboard HTML -------------------------------------------------------

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Phone Bot Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
               background: #0a0a0a; color: #e0e0e0; padding: 24px; }
        h1 { font-size: 24px; margin-bottom: 24px; color: #fff; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
        .card { background: #1a1a1a; border-radius: 12px; padding: 20px; border: 1px solid #2a2a2a; }
        .card h3 { font-size: 16px; color: #fff; margin-bottom: 12px; }
        .status { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 14px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; }
        .dot.on { background: #4ade80; }
        .dot.off { background: #666; }
        .dot.active { background: #60a5fa; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .controls { margin: 24px 0; display: flex; gap: 12px; }
        button { padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;
                 font-size: 14px; font-weight: 600; }
        .btn-start { background: #22c55e; color: #000; }
        .btn-stop { background: #ef4444; color: #fff; }
        .btn-test { background: #3b82f6; color: #fff; }
        .log { background: #111; border-radius: 8px; padding: 16px; margin-top: 24px;
               font-family: 'Consolas', monospace; font-size: 13px; max-height: 400px;
               overflow-y: auto; border: 1px solid #2a2a2a; }
        .log-line { margin: 2px 0; color: #9ca3af; }
    </style>
</head>
<body>
    <h1>Phone Bot Dashboard</h1>

    <div class="controls">
        <button class="btn-start" onclick="startBot()">Start Today's Plan</button>
        <button class="btn-stop" onclick="stopBot()">Stop</button>
        <button class="btn-test" onclick="refreshDevices()">Refresh Devices</button>
    </div>

    <div class="grid" id="devices"></div>

    <div class="log" id="log">
        <div class="log-line">Dashboard ready. Connect devices and press Start.</div>
    </div>

    <script>
        async function refreshDevices() {
            const res = await fetch('/api/devices');
            const data = await res.json();
            const grid = document.getElementById('devices');
            grid.innerHTML = data.devices.map(d => `
                <div class="card">
                    <h3>Phone ${d.phone_id} — ${d.name}</h3>
                    <div class="status">
                        <span class="dot ${d.connected ? 'on' : 'off'}"></span>
                        ${d.connected ? 'Connected' : 'Disconnected'}
                    </div>
                    <div class="status">
                        <span class="dot ${d.is_proxy_active ? 'active' : 'off'}"></span>
                        Proxy: ${d.is_proxy_active ? 'ACTIVE' : 'Idle'}
                    </div>
                    <div class="status">App: ${d.current_app || 'None'}</div>
                    <div class="status">WiFi: ${d.wifi || 'Disconnected'}</div>
                    <button class="btn-test" style="margin-top:8px;font-size:12px;padding:6px 12px"
                            onclick="testPhone(${d.phone_id})">Test</button>
                </div>
            `).join('');
        }

        async function startBot() {
            await fetch('/api/start', {method: 'POST'});
            addLog('Started today\\'s plan execution');
        }

        async function stopBot() {
            await fetch('/api/stop', {method: 'POST'});
            addLog('Stop requested — will finish current session');
        }

        async function testPhone(id) {
            const res = await fetch(`/api/test/${id}`, {method: 'POST'});
            const data = await res.json();
            addLog(`Phone ${id}: connected=${data.connected}, screen=${data.screen_on}, elements=${data.ui_elements}`);
        }

        function addLog(msg) {
            const log = document.getElementById('log');
            const time = new Date().toLocaleTimeString();
            log.innerHTML += `<div class="log-line">[${time}] ${msg}</div>`;
            log.scrollTop = log.scrollHeight;
        }

        // WebSocket for live updates
        const ws = new WebSocket(`ws://${location.host}/ws`);
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            // Update device cards if data changed
        };

        // Initial load
        refreshDevices();
        setInterval(refreshDevices, 10000);
    </script>
</body>
</html>"""


def start_dashboard(controllers: dict[int, ADBController], port: int = 8080):
    """Start the web dashboard server."""
    global _controllers, _proxy, _executor
    _controllers = controllers
    _proxy = ProxyQueue(controllers)
    _executor = SessionExecutor(controllers, _proxy)

    log.info("Starting dashboard at http://localhost:%d", port)
    uvicorn.run(app, host="0.0.0.0", port=port)
