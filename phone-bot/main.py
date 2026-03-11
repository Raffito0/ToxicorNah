"""Phone Bot — main entry point.

Discovers connected phones via ADB, initializes controllers,
and starts the session executor to run today's plan.

Usage:
    python main.py                       # run today's plan (or warmup if active)
    python main.py --dashboard           # start web dashboard
    python main.py --test                # test device connections
    python main.py --warmup              # initialize warmup for all accounts
    python main.py --warmup --phone 1    # initialize warmup for phone 1 only
    python main.py --scroll-only --phone 4  # TEST: 5 min passive scroll, no engagement
"""
import argparse
import asyncio
import logging
import logging.handlers
import os
import subprocess
import sys
import time
from datetime import datetime

from .config import ADB_PATH, PHONES, ACCOUNTS, LOGS_DIR, GEMINI, AIRTABLE, TEST_MODE
from .core.adb import ADBController
from .core.proxy import ProxyQueue
from .core.human import HumanEngine
from .planner.executor import SessionExecutor

# Console + rotating file log
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
_file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOGS_DIR, "phone_bot.log"),
    maxBytes=5 * 1024 * 1024,  # 5 MB
    backupCount=3,
    encoding="utf-8",
)
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
))
logging.getLogger().addHandler(_file_handler)
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

        # Test coord lookup
        x, y = ctrl.get_coord("tiktok", "nav_home")
        log.info("  Coord test (tiktok nav_home): %d, %d", x, y)


async def run_scroll_only(controllers: dict[int, ADBController], phone_id: int,
                          duration_min: int = 5):
    """TEST MODE: Open TikTok and scroll passively. No likes, comments, follows, posts.
    Logs every action to console + file for review."""
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=duration_min,
    )

    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== SCROLL-ONLY TEST: Phone %d | %d min | NO engagement ===", phone_id, duration_min)

    if not bot.open_app():
        log.error("Failed to open TikTok")
        return

    time.sleep(human.timing("t_app_load"))
    bot.go_to_fyp()
    time.sleep(human.timing("t_nav_settle"))

    start = time.time()
    video_count = 0

    while (time.time() - start) < duration_min * 60:
        # Watch current video
        watch = human.watch_duration()
        video_count += 1
        log.info("[Video #%d] Watching %.1fs", video_count, watch)
        time.sleep(watch)

        # Zona morta (stare doing nothing)
        if human.should_zona_morta():
            zm = human.zona_morta_duration()
            log.info("[Zona morta] Pausing %.0fs", zm)
            time.sleep(zm)

        # Scroll to next video
        sw = human.humanize_swipe(
            adb.screen_w // 2, adb.screen_h * 3 // 4,
            adb.screen_w // 2, adb.screen_h // 4,
        )
        log.info("[Scroll] swipe (%d,%d)->(%d,%d) %dms",
                 sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
        adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])

        delay = human.action_delay()
        log.info("[Delay] %.2fs", delay)
        time.sleep(delay)

    elapsed = time.time() - start
    log.info("=== TEST COMPLETE: %d videos in %.0fs ===", video_count, elapsed)
    bot.close_app()
    human.end_session()


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


def _check_api_keys():
    """Warn at startup if critical API keys are missing."""
    if not GEMINI.get("api_key"):
        log.warning("GEMINI_API_KEY not set -- AI comments and categorization will fail")
    if not AIRTABLE.get("api_key"):
        log.warning("AIRTABLE_API_KEY not set -- Content Library delivery will fail")


def main():
    parser = argparse.ArgumentParser(description="Phone Bot — TikTok & Instagram Automation")
    parser.add_argument("--test", action="store_true", help="Test device connections")
    parser.add_argument("--dashboard", action="store_true", help="Start web dashboard")
    parser.add_argument("--warmup", action="store_true", help="Initialize warmup for new accounts")
    parser.add_argument("--scroll-only", action="store_true",
                        help="TEST: passive scroll only, no engagement (requires --phone)")
    parser.add_argument("--duration", type=int, default=5,
                        help="Duration in minutes for --scroll-only (default: 5)")
    parser.add_argument("--phone", type=int, help="Filter to specific phone ID (1-4)")
    args = parser.parse_args()

    # Verbose logging in TEST_MODE
    if TEST_MODE or args.scroll_only:
        logging.getLogger().setLevel(logging.DEBUG)
        log.info("TEST MODE active — proxy disabled, verbose logging, timezone Europe/Rome")

    _check_api_keys()
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
        from .api.server import start_dashboard
        start_dashboard(controllers)
        return

    if args.scroll_only:
        if not args.phone:
            log.error("--scroll-only requires --phone (e.g. --phone 4)")
            sys.exit(1)
        asyncio.run(run_scroll_only(controllers, args.phone, args.duration))
        return

    if args.warmup:
        init_warmup(controllers, phone_filter=args.phone)
        return

    # Default: run today's plan (warmup sessions run automatically if active)
    asyncio.run(run_today(controllers))


if __name__ == "__main__":
    main()
