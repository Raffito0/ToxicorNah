"""Launcher — one command to rule them all.

Run ONCE: python launcher.py --setup
Then it runs every day automatically via Windows Task Scheduler.

What it does:
1. Discovers phones
2. Checks warmup state for each account
3. Stagers new phones (adds 1 every 2-3 days automatically)
4. Runs warmup or weekly plan depending on account state
5. Sends Telegram notifications on status/errors
6. Logs everything

The user only needs to:
1. Create accounts on phones manually
2. Connect phones via USB
3. Run: python launcher.py --setup
4. Never touch it again
"""
import argparse
import asyncio
import json
import logging
import os
import subprocess
import sys
import random
from datetime import datetime, date, timedelta

from config import ADB_PATH, PHONES, ACCOUNTS, DATA_DIR
from core.adb import ADBController
from core.proxy import ProxyQueue
from planner.executor import SessionExecutor
from planner.warmup import generate_warmup_sessions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(
            os.path.join(DATA_DIR, f"bot_{date.today().isoformat()}.log"),
            encoding="utf-8",
        ),
    ],
)
log = logging.getLogger("launcher")

LAUNCH_STATE_FILE = os.path.join(DATA_DIR, "launch_state.json")


# =============================================================================
# Telegram Notifications (optional but recommended)
# =============================================================================

TELEGRAM_BOT_TOKEN = os.getenv("PHONEBOT_TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("PHONEBOT_TELEGRAM_CHAT", "")


def notify(message: str):
    """Send a Telegram notification. Silent fail if not configured."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        import httpx
        httpx.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "HTML"},
            timeout=10,
        )
    except Exception:
        pass


# =============================================================================
# Launch State — tracks which phones are activated and when
# =============================================================================

def load_launch_state() -> dict:
    if os.path.exists(LAUNCH_STATE_FILE):
        with open(LAUNCH_STATE_FILE, "r") as f:
            return json.load(f)
    return {
        "setup_date": None,
        "phones_activated": {},  # {phone_id: activation_date}
        "stagger_days": 2,      # add new phone every N days
        "niche_keywords": [],
        "last_run_date": None,
    }


def save_launch_state(state: dict):
    with open(LAUNCH_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# =============================================================================
# Device Discovery
# =============================================================================

def discover_devices() -> dict[int, ADBController]:
    result = subprocess.run(
        [ADB_PATH, "devices", "-l"], capture_output=True, text=True
    )
    lines = result.stdout.strip().split("\n")[1:]

    connected = {}
    for line in lines:
        if "device" not in line or "offline" in line:
            continue
        serial = line.split()[0]

        model_output = subprocess.run(
            [ADB_PATH, "-s", serial, "shell", "getprop", "ro.product.model"],
            capture_output=True, text=True,
        )
        model = model_output.stdout.strip()

        for phone in PHONES:
            if phone["model"] and phone["model"].lower() in model.lower():
                phone["adb_serial"] = serial
                ctrl = ADBController(serial, phone)
                connected[phone["id"]] = ctrl
                log.info("Phone %d: %s (%s) [%s]", phone["id"], phone["name"], model, serial)
                break

    return connected


# =============================================================================
# Auto-Stagger: activate phones gradually
# =============================================================================

def get_phones_to_run_today(state: dict, connected_phones: list[int]) -> list[int]:
    """Determine which phones should run today based on stagger schedule.

    Phone 1 starts on setup day.
    Phone 2 starts 2-3 days later.
    Phone 3 starts 2-3 days after Phone 2.
    Phone 4 starts 2-3 days after Phone 3.
    """
    today = date.today().isoformat()
    activated = state["phones_activated"]
    stagger = state["stagger_days"]

    # Find the most recently activated phone
    if not activated:
        # First run: activate Phone 1 (or the first connected phone)
        first_phone = min(connected_phones)
        activated[str(first_phone)] = today
        save_launch_state(state)
        log.info("Activated Phone %d (first phone)", first_phone)
        return [first_phone]

    # Check if it's time to activate the next phone
    last_activation = max(activated.values())
    last_date = date.fromisoformat(last_activation)
    days_since = (date.today() - last_date).days

    if days_since >= stagger:
        # Find the next unactivated phone
        for pid in sorted(connected_phones):
            if str(pid) not in activated:
                activated[str(pid)] = today
                save_launch_state(state)
                log.info("Activated Phone %d (stagger: %d days since last)", pid, days_since)
                break

    # Return all activated phones that are currently connected
    active_ids = [int(pid) for pid in activated.keys()]
    return [pid for pid in active_ids if pid in connected_phones]


# =============================================================================
# Windows Task Scheduler Setup
# =============================================================================

def setup_task_scheduler():
    """Create a Windows Task Scheduler task to run daily."""
    python_path = sys.executable
    script_path = os.path.abspath(__file__)
    task_name = "PhoneBot_Daily"

    # Random start time between 8:00-10:00 (looks more natural than exact times)
    start_hour = random.randint(8, 9)
    start_min = random.randint(0, 59)
    start_time = f"{start_hour:02d}:{start_min:02d}"

    cmd = (
        f'schtasks /create /tn "{task_name}" /tr '
        f'"\"{python_path}\" \"{script_path}\" --run" '
        f'/sc daily /st {start_time} /f'
    )

    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if result.returncode == 0:
            log.info("Task Scheduler: daily task created at %s", start_time)
            return True, start_time
        else:
            log.warning("Task Scheduler failed: %s", result.stderr)
            return False, ""
    except Exception as e:
        log.warning("Task Scheduler error: %s", e)
        return False, ""


# =============================================================================
# Health Check
# =============================================================================

def health_check(controllers: dict[int, ADBController]) -> list[str]:
    """Quick health check on all devices. Returns list of issues."""
    issues = []
    for phone_id, ctrl in controllers.items():
        if not ctrl.is_connected():
            issues.append(f"Phone {phone_id}: disconnected")
        elif not ctrl.is_screen_on():
            # Try to wake it
            ctrl.wake_screen()
    return issues


# =============================================================================
# Main Flow
# =============================================================================

async def daily_run():
    """The main daily execution flow. Called automatically by Task Scheduler."""
    log.info("=" * 60)
    log.info("Phone Bot — Daily Run — %s", date.today().isoformat())
    log.info("=" * 60)

    state = load_launch_state()
    state["last_run_date"] = date.today().isoformat()
    save_launch_state(state)

    # Discover devices
    controllers = discover_devices()
    if not controllers:
        msg = "No phones connected! Check USB cables."
        log.error(msg)
        notify(f"Phone Bot ERROR: {msg}")
        return

    # Health check
    issues = health_check(controllers)
    if issues:
        for issue in issues:
            log.warning(issue)
        notify("Phone Bot WARNINGS:\n" + "\n".join(issues))

    # Determine which phones run today (stagger logic)
    phones_today = get_phones_to_run_today(state, list(controllers.keys()))
    log.info("Phones active today: %s", phones_today)

    # Filter controllers to only active phones
    active_controllers = {pid: ctrl for pid, ctrl in controllers.items() if pid in phones_today}

    # Create executor
    proxy = ProxyQueue(active_controllers)
    executor = SessionExecutor(active_controllers, proxy)

    # Initialize warmup for newly activated phones
    niche_keywords = state.get("niche_keywords", ["fyp", "viral", "trending"])
    for pid in phones_today:
        phone_accounts = [a for a in ACCOUNTS if a["phone_id"] == pid]
        for acc in phone_accounts:
            if not executor.is_in_warmup(acc["name"]) and \
               acc["name"] not in executor.warmup_states:
                executor.init_warmup(
                    account_name=acc["name"],
                    platform=acc["platform"],
                    phone_id=acc["phone_id"],
                    niche_keywords=niche_keywords,
                )

    # Count warmup vs regular accounts
    warmup_count = sum(1 for name in executor.warmup_states
                       if not executor.warmup_states[name].completed
                       and executor.warmup_states[name].phone_id in phones_today)
    regular_count = len([a for a in ACCOUNTS if a["phone_id"] in phones_today]) - warmup_count

    status_msg = (
        f"Phone Bot started\n"
        f"Phones: {phones_today}\n"
        f"Warmup: {warmup_count} accounts\n"
        f"Regular: {regular_count} accounts"
    )
    log.info(status_msg)
    notify(status_msg)

    # Run
    try:
        await executor.run_today()
        notify("Phone Bot: daily run completed successfully")
    except Exception as e:
        log.exception("Fatal error during execution")
        notify(f"Phone Bot CRASH: {e}")
    finally:
        proxy.disconnect_all()

    log.info("Daily run finished")


def setup(niche_keywords: list[str] = None):
    """Initial setup — run once.

    1. Discovers phones
    2. Sets niche keywords
    3. Creates Windows Task Scheduler job
    4. Saves state
    5. Runs first day immediately
    """
    log.info("=" * 60)
    log.info("Phone Bot — SETUP")
    log.info("=" * 60)

    # Discover devices
    controllers = discover_devices()
    if not controllers:
        log.error("No phones found! Connect phones via USB and enable ADB debugging.")
        sys.exit(1)

    log.info("Found %d phone(s): %s", len(controllers),
             [f"Phone {pid}" for pid in sorted(controllers.keys())])

    # Default niche keywords
    if not niche_keywords:
        niche_keywords = [
            "toxic relationship", "red flags", "situationship",
            "dating advice", "couples", "relationship tips",
            "boyfriend goals", "girlfriend goals", "love advice",
        ]

    # Save state
    state = load_launch_state()
    state["setup_date"] = date.today().isoformat()
    state["niche_keywords"] = niche_keywords
    state["stagger_days"] = 2  # new phone every 2 days
    save_launch_state(state)

    # Setup Windows Task Scheduler
    success, start_time = setup_task_scheduler()
    if success:
        log.info("Auto-start configured: every day at %s", start_time)
    else:
        log.info("Auto-start not configured. Run manually: python launcher.py --run")

    log.info("")
    log.info("Setup complete! Here's what happens next:")
    log.info("  Today:        Phone %d starts warmup (day 1)", min(controllers.keys()))
    log.info("  Day 3:        Phone 2 joins warmup")
    log.info("  Day 5:        Phone 3 joins warmup")
    log.info("  Day 7:        Phone 4 joins warmup")
    log.info("  Day 8:        Phone 1 starts posting (weekly plan)")
    log.info("  Day 14:       All phones at full regime")
    log.info("")
    log.info("You don't need to do anything else. The bot runs daily automatically.")
    log.info("")

    notify(
        f"Phone Bot SETUP complete!\n"
        f"Phones: {len(controllers)}\n"
        f"Stagger: 1 new phone every 2 days\n"
        f"Auto-start: {'yes at ' + start_time if success else 'manual'}"
    )

    # Run first day immediately
    log.info("Running first day now...")
    asyncio.run(daily_run())


def main():
    parser = argparse.ArgumentParser(description="Phone Bot Launcher")
    parser.add_argument("--setup", action="store_true",
                        help="Initial setup (run once, configures everything)")
    parser.add_argument("--run", action="store_true",
                        help="Run today's sessions (called by Task Scheduler)")
    parser.add_argument("--status", action="store_true",
                        help="Show current status of all accounts")
    parser.add_argument("--dashboard", action="store_true",
                        help="Start web dashboard")
    parser.add_argument("--test", action="store_true",
                        help="Test device connections")
    parser.add_argument("--niche", nargs="+",
                        help="Custom niche keywords (for --setup)")
    args = parser.parse_args()

    if args.setup:
        setup(niche_keywords=args.niche)
        return

    if args.status:
        show_status()
        return

    if args.test:
        controllers = discover_devices()
        if not controllers:
            log.error("No phones found!")
            return
        for pid, ctrl in controllers.items():
            log.info("Phone %d: connected=%s screen=%s app=%s",
                     pid, ctrl.is_connected(), ctrl.is_screen_on(), ctrl.get_current_app())
        return

    if args.dashboard:
        controllers = discover_devices()
        if not controllers:
            log.error("No phones found!")
            return
        from api.server import start_dashboard
        start_dashboard(controllers)
        return

    # Default: --run (daily execution)
    asyncio.run(daily_run())


def show_status():
    """Show current status of the bot and all accounts."""
    state = load_launch_state()
    controllers = discover_devices()

    log.info("=" * 50)
    log.info("PHONE BOT STATUS")
    log.info("=" * 50)
    log.info("Setup date: %s", state.get("setup_date", "not set up"))
    log.info("Last run:   %s", state.get("last_run_date", "never"))
    log.info("Stagger:    every %d days", state.get("stagger_days", 2))
    log.info("")

    # Phone activation status
    activated = state.get("phones_activated", {})
    for phone in PHONES:
        pid = str(phone["id"])
        connected = phone["id"] in controllers
        act_date = activated.get(pid, "not activated")
        status = "CONNECTED" if connected else "DISCONNECTED"
        log.info("Phone %s (%s): %s | Activated: %s",
                 phone["id"], phone["name"], status, act_date)

    # Warmup status
    log.info("")
    proxy = ProxyQueue(controllers) if controllers else None
    if controllers:
        executor = SessionExecutor(controllers, proxy)
        for acc in ACCOUNTS:
            name = acc["name"]
            if name in executor.warmup_states:
                ws = executor.warmup_states[name]
                if ws.completed:
                    log.info("  %s: WARMUP COMPLETE (full regime)", name)
                else:
                    log.info("  %s: warmup day %d/7", name, ws.current_day)
            else:
                pid_activated = str(acc["phone_id"]) in activated
                if pid_activated:
                    log.info("  %s: active (no warmup data)", name)
                else:
                    log.info("  %s: waiting (phone not activated yet)", name)


if __name__ == "__main__":
    main()
