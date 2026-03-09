"""Phone Bot — main entry point.

Discovers connected phones via ADB, initializes controllers,
and starts the session executor to run today's plan.

Usage:
    python main.py                   # run today's plan (or warmup if active)
    python main.py --dashboard       # start web dashboard
    python main.py --test            # test device connections
    python main.py --warmup          # initialize warmup for all accounts
    python main.py --warmup --phone 1  # initialize warmup for phone 1 only
"""
import argparse
import asyncio
import logging
import subprocess
import sys

from config import ADB_PATH, PHONES, ACCOUNTS
from core.adb import ADBController
from core.proxy import ProxyQueue
from planner.executor import SessionExecutor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("phone_bot")


def discover_devices() -> dict[int, ADBController]:
    """Detect connected ADB devices and match them to phone configs."""
    result = subprocess.run(
        [ADB_PATH, "devices", "-l"], capture_output=True, text=True
    )
    lines = result.stdout.strip().split("\n")[1:]  # skip header

    connected = {}
    for line in lines:
        if "device" not in line or "offline" in line:
            continue
        serial = line.split()[0]

        # Get device model
        model_output = subprocess.run(
            [ADB_PATH, "-s", serial, "shell", "getprop", "ro.product.model"],
            capture_output=True, text=True,
        )
        model = model_output.stdout.strip()

        # Match to phone config
        for phone in PHONES:
            if phone["model"] and phone["model"].lower() in model.lower():
                phone["adb_serial"] = serial
                ctrl = ADBController(serial, phone)
                connected[phone["id"]] = ctrl
                log.info("Found Phone %d: %s (%s) [%s]",
                         phone["id"], phone["name"], model, serial)
                break
        else:
            log.warning("Unknown device: %s (%s)", serial, model)

    return connected


def test_devices(controllers: dict[int, ADBController]):
    """Test all connected devices."""
    for phone_id, ctrl in controllers.items():
        log.info("--- Testing Phone %d ---", phone_id)
        log.info("  Connected: %s", ctrl.is_connected())
        log.info("  Screen on: %s", ctrl.is_screen_on())
        log.info("  Current app: %s", ctrl.get_current_app())
        log.info("  WiFi: %s", ctrl.get_wifi_ssid())

        # Test screenshot
        img = ctrl.screenshot()
        if img:
            log.info("  Screenshot: %dx%d", img.width, img.height)
        else:
            log.warning("  Screenshot: FAILED")

        # Test UI dump
        elements = ctrl.dump_ui(force=True)
        log.info("  UI elements: %d", len(elements))


async def run_today(controllers: dict[int, ADBController]):
    """Run today's scheduled sessions."""
    proxy = ProxyQueue(controllers)
    executor = SessionExecutor(controllers, proxy)
    await executor.run_today()


def init_warmup(controllers: dict[int, ADBController], phone_filter: int = None):
    """Initialize warmup for accounts. Run once when setting up new accounts."""
    proxy = ProxyQueue(controllers)
    executor = SessionExecutor(controllers, proxy)

    # Default niche keywords — customize per account if needed
    niche_keywords = [
        "toxic relationship", "red flags", "situationship",
        "dating advice", "couples", "relationship tips",
        "boyfriend goals", "girlfriend goals", "love advice",
    ]

    for acc in ACCOUNTS:
        if phone_filter and acc["phone_id"] != phone_filter:
            continue

        if executor.is_in_warmup(acc["name"]):
            state = executor.warmup_states[acc["name"]]
            log.info("  %s: already in warmup (day %d)", acc["name"], state.current_day)
            continue

        executor.init_warmup(
            account_name=acc["name"],
            platform=acc["platform"],
            phone_id=acc["phone_id"],
            niche_keywords=niche_keywords,
        )
        log.info("  %s: warmup initialized (day 1)", acc["name"])

    log.info("Warmup initialized! Run 'python main.py' daily for 7 days.")


def main():
    parser = argparse.ArgumentParser(description="Phone Bot — TikTok & Instagram Automation")
    parser.add_argument("--test", action="store_true", help="Test device connections")
    parser.add_argument("--dashboard", action="store_true", help="Start web dashboard")
    parser.add_argument("--warmup", action="store_true", help="Initialize warmup for new accounts")
    parser.add_argument("--phone", type=int, help="Filter to specific phone ID (1-4)")
    args = parser.parse_args()

    log.info("Discovering connected devices...")
    controllers = discover_devices()

    if not controllers:
        log.error("No devices found! Make sure phones are connected via USB with ADB debugging enabled.")
        sys.exit(1)

    log.info("Found %d device(s)", len(controllers))

    if args.test:
        test_devices(controllers)
        return

    if args.dashboard:
        from api.server import start_dashboard
        start_dashboard(controllers)
        return

    if args.warmup:
        init_warmup(controllers, phone_filter=args.phone)
        return

    # Default: run today's plan (warmup sessions run automatically if active)
    asyncio.run(run_today(controllers))


if __name__ == "__main__":
    main()
