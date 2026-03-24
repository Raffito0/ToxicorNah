"""Session Executor — reads the Weekly Plan JSON and executes it on real phones.

The Weekly Plan is the "script". This module is the "actor" that performs it.
Reads each session from the plan and translates it into real ADB actions.

Also handles warmup sessions for new accounts (days 1-7).
"""
import asyncio
import json
import logging
import os
import random
import time
import urllib.request
import urllib.error
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

# All scheduling uses Eastern Time (proxy is in Florida, phones simulate US users)
_ET = ZoneInfo("US/Eastern")


def _now_et() -> datetime:
    """Current time in US/Eastern (timezone-aware)."""
    return datetime.now(_ET)


def _today_et() -> date:
    """Today's date in US/Eastern."""
    return _now_et().date()

from .. import config  # NOTE: config.py adds delivery module to sys.path
from ..core.adb import ADBController, DeviceLostError, DeviceConfigError
from ..core.human import HumanEngine
from ..core.proxy import ProxyQueue
from ..core.rate_limiter import SessionRateLimiter
from ..core.monitor import init_monitor, log_event as monitor_log, BotEvent, get_logger as get_monitor, get_action_trace
from ..core.telegram_alerts import init_alerts, send_alert as tg_alert
from ..core.telegram_monitor import init_monitor as init_prod_monitor, get_monitor as get_prod_monitor
from ..actions.tiktok import TikTokBot
from ..actions.instagram import InstagramBot
from .warmup import AccountWarmupState, generate_warmup_sessions, generate_warmup_plan
try:
    from delivery import get_next_video, download_video, mark_posted, mark_draft, mark_skipped
except ImportError:
    get_next_video = download_video = mark_posted = mark_draft = mark_skipped = None

import sqlite3

log = logging.getLogger(__name__)

WARMUP_STATE_FILE = os.path.join(config.DATA_DIR, "warmup_state.json")
VIDEO_DOWNLOAD_TIMEOUT = 30  # seconds
_download_pool = ThreadPoolExecutor(max_workers=1)

_AIRTABLE_BASE_ID = "appsgjIdkpak2kaXq"
_CONTENT_LIBRARY_TABLE = "tblx1KX7mlTX5QyGb"
_LOW_STOCK_THRESHOLD = 14

# Dashboard DB path for plan/warmup/session-log integration
_DB_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "insta-phone-SAAS-sneder", "app", "user_data", "app.db"
))


def _get_db():
    """Get SQLite connection to the dashboard DB with WAL mode."""
    conn = sqlite3.connect(_DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn


def _db_available():
    """Check if dashboard DB exists and is accessible."""
    return os.path.exists(_DB_PATH)


def _utc_to_eastern(utc_str):
    """Convert UTC ISO string to Eastern time string (HH:MM).

    Input: '2026-03-22T00:45:00Z'
    Output: '19:45'
    """
    dt = datetime.fromisoformat(utc_str.replace('Z', '+00:00'))
    et = dt.astimezone(_ET)
    return et.strftime("%H:%M")


def _load_plan_from_db(proxy_id=1):
    """Load active weekly plan from dashboard DB.

    Returns plan dict or None if not found.
    """
    if not _db_available():
        return None

    today = _today_et()
    iso_cal = today.isocalendar()

    try:
        conn = _get_db()
        try:
            row = conn.execute(
                "SELECT plan_json FROM weekly_plan "
                "WHERE proxy_id = ? AND week_number = ? AND year = ? AND status = 'active'",
                (proxy_id, iso_cal[1], iso_cal[0])
            ).fetchone()

            if not row:
                return None

            plan_data = json.loads(row[0]) if isinstance(row[0], str) else row[0]

            # Convert UTC times to Eastern for execution
            for day_str, day_data in plan_data.get("days", {}).items():
                for session in day_data.get("sessions", []):
                    if "start_time_utc" in session:
                        session["start_time"] = _utc_to_eastern(session["start_time_utc"])
                    if "end_time_utc" in session:
                        session["end_time"] = _utc_to_eastern(session["end_time_utc"])

            return plan_data
        finally:
            conn.close()
    except Exception as e:
        log.warning("Failed to load plan from DB: %s", e)
        return None


def _log_session_start_db(session_id, bot_account_id, session_type, dry_run=False):
    """Write session start to SessionLog in dashboard DB."""
    if not _db_available():
        return

    try:
        conn = _get_db()
        try:
            conn.execute(
                "INSERT INTO session_log (bot_account_id, session_id, started_at, session_type, status, dry_run) "
                "VALUES (?, ?, datetime('now'), ?, 'running', ?)",
                (bot_account_id, session_id, session_type, dry_run)
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        log.warning("Failed to log session start to DB: %s", e)


def _log_session_end_db(session_id, success, error_message=None, post_outcome=None):
    """Update SessionLog with completion status in dashboard DB."""
    if not _db_available():
        return

    status = "success" if success else "error"
    try:
        conn = _get_db()
        try:
            conn.execute(
                "UPDATE session_log SET ended_at = datetime('now'), status = ?, "
                "error_message = ?, post_outcome = ? WHERE session_id = ?",
                (status, error_message, post_outcome, session_id)
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        log.warning("Failed to log session end to DB: %s", e)


def check_content_stock(phones: list[int]) -> dict[int, int]:
    """Query Airtable for pending video count per phone.

    Uses the Content Library table with filter:
    AND(FIND('Phone N', {content_label}), {platform_status_tiktok}='pending')

    Returns {phone_id: count}. On any error, logs warning and returns {}.
    """
    api_key = os.environ.get("AIRTABLE_API_KEY", "")
    if not api_key:
        log.warning("AIRTABLE_API_KEY not set — skipping stock check")
        return {}

    result = {}
    for phone_id in phones:
        try:
            formula = f"AND(FIND('Phone {phone_id}', {{content_label}}), {{platform_status_tiktok}}='pending')"
            encoded_formula = urllib.parse.quote(formula, safe="")
            base_url = (
                f"https://api.airtable.com/v0/{_AIRTABLE_BASE_ID}/{_CONTENT_LIBRARY_TABLE}"
                f"?filterByFormula={encoded_formula}"
            )
            # Paginate through all results (Airtable returns max 100 per page)
            count = 0
            offset = None
            while True:
                url = base_url
                if offset:
                    url += f"&offset={urllib.parse.quote(offset, safe='')}"
                req = urllib.request.Request(url, headers={
                    "Authorization": f"Bearer {api_key}",
                })
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                count += len(data.get("records", []))
                offset = data.get("offset")
                if not offset:
                    break
            result[phone_id] = count
        except Exception as e:
            log.warning("Stock check failed for Phone %d: %s", phone_id, e)
            # Continue checking other phones — partial results are better than none
    return result


class SessionExecutor:
    """Reads the weekly/daily plan and executes sessions on physical phones."""

    def __init__(self, controllers: dict[int, ADBController], proxy_queue: ProxyQueue):
        self.controllers = controllers  # {phone_id: ADBController}
        self.proxy = proxy_queue
        self.human_engines: dict[str, HumanEngine] = {}  # per account
        self.warmup_states: dict[str, AccountWarmupState] = {}
        self._running = False
        self._pending_record = None
        self._dry_run = False
        self._account_db_ids = {}  # account_name -> bot_account.id (loaded from DB)
        self._load_warmup_state()
        self._load_account_db_ids()

    # --- Warmup State Persistence ------------------------------------------

    def _load_warmup_state(self):
        """Load warmup state — DB first (BotAccount.warmup_json), JSON file fallback."""
        # Try DB first
        if _db_available():
            try:
                conn = _get_db()
                try:
                    rows = conn.execute(
                        "SELECT username, warmup_json FROM bot_account WHERE warmup_json IS NOT NULL"
                    ).fetchall()
                finally:
                    conn.close()
                for row in rows:
                    username, wj = row[0], row[1]
                    if not wj:
                        continue
                    state_dict = json.loads(wj) if isinstance(wj, str) else wj
                    self.warmup_states[username] = AccountWarmupState.from_dict(state_dict)
                if self.warmup_states:
                    log.info("Loaded warmup state for %d accounts from DB", len(self.warmup_states))
                    return
            except Exception as e:
                log.warning("Failed to load warmup state from DB: %s", e)

        # Fallback to JSON file
        if os.path.exists(WARMUP_STATE_FILE):
            with open(WARMUP_STATE_FILE, "r") as f:
                data = json.load(f)
            for name, state_dict in data.items():
                self.warmup_states[name] = AccountWarmupState.from_dict(state_dict)
            log.info("Loaded warmup state for %d accounts from file", len(self.warmup_states))

    def _save_warmup_state(self):
        """Save warmup state — DB first (BotAccount.warmup_json), JSON file fallback."""
        data = {name: state.to_dict() for name, state in self.warmup_states.items()}

        # Try DB first — only skip JSON fallback if ALL accounts were saved
        if _db_available() and self._account_db_ids:
            try:
                conn = _get_db()
                saved_count = 0
                try:
                    for name, state_dict in data.items():
                        db_id = self._account_db_ids.get(name)
                        if db_id:
                            conn.execute(
                                "UPDATE bot_account SET warmup_json = ? WHERE id = ?",
                                (json.dumps(state_dict), db_id)
                            )
                            saved_count += 1
                    conn.commit()
                finally:
                    conn.close()
                if saved_count == len(data):
                    return  # All accounts saved to DB, skip JSON fallback
            except Exception as e:
                log.warning("Failed to save warmup state to DB: %s", e)

        # Fallback to JSON file
        tmp_path = WARMUP_STATE_FILE + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, WARMUP_STATE_FILE)

    def _load_account_db_ids(self):
        """Load account_name -> bot_account.id mapping from dashboard DB."""
        if not _db_available():
            return
        try:
            conn = _get_db()
            try:
                rows = conn.execute("SELECT id, username FROM bot_account").fetchall()
            finally:
                conn.close()
            for row in rows:
                self._account_db_ids[row[1]] = row[0]
            if self._account_db_ids:
                log.info("Loaded %d account DB IDs for session logging", len(self._account_db_ids))
        except Exception as e:
            log.debug("Could not load account DB IDs: %s", e)

    def init_warmup(self, account_name: str, platform: str, phone_id: int,
                    niche_keywords: list[str] = None):
        """Initialize warmup for a new account.
        Generates a unique 5-8 day plan with dead days, lazy days,
        non-monotonic engagement, and randomized profile setup.
        """
        state = AccountWarmupState(
            account_name=account_name,
            platform=platform,
            phone_id=phone_id,
            start_date=_today_et().isoformat(),
            current_day=1,
            niche_keywords=niche_keywords or [
                "toxic relationship", "red flags", "situationship",
                "dating advice", "couples", "relationship tips",
            ],
        )
        generate_warmup_plan(state)
        self.warmup_states[account_name] = state
        self._save_warmup_state()
        log.info("Warmup initialized for %s (%d days, pic=day %d, bio=day %d)",
                 account_name, state.total_days, state.profile_pic_day, state.bio_day)

    def check_new_phones(self):
        """Auto-enroll new accounts found in config.ACCOUNTS into warmup.

        Compares config.ACCOUNTS against warmup_state.json. Any account
        not in warmup (and not already completed) gets enrolled.
        """
        known_accounts = set(self.warmup_states.keys())
        for acc in config.ACCOUNTS:
            name = acc["name"]
            if name not in known_accounts:
                log.info("New account discovered: %s — enrolling in warmup", name)
                self.init_warmup(
                    account_name=name,
                    platform=acc["platform"],
                    phone_id=acc["phone_id"],
                )

    def is_in_warmup(self, account_name: str) -> bool:
        """Check if an account is still in warmup phase."""
        state = self.warmup_states.get(account_name)
        return state is not None and not state.completed

    def _get_human(self, account_name: str) -> HumanEngine:
        """Get or create a HumanEngine for an account."""
        if account_name not in self.human_engines:
            self.human_engines[account_name] = HumanEngine(account_name=account_name)
        return self.human_engines[account_name]

    def _create_bot(self, platform: str, adb: ADBController, human: HumanEngine,
                    account_name: str = "") -> "TikTokBot | InstagramBot":
        """Create bot instance with rate limiter and session_id wired."""
        if platform == "tiktok":
            bot = TikTokBot(adb, human)
        else:
            bot = InstagramBot(adb, human)
        bot._session_id = getattr(self, '_current_session_id', 'unknown')
        if account_name:
            bot.rate_limiter = SessionRateLimiter(account_name)
        return bot

    # --- Profile Content Lookup --------------------------------------------

    def _get_profile_pic(self, phone_id: int, platform: str) -> str | None:
        """Get the profile picture path for a phone+platform combo.
        Looks in data/profiles/phone{id}_{platform}_pic.jpg
        """
        candidates = [
            os.path.join(config.DATA_DIR, "profiles", f"phone{phone_id}_{platform}_pic.jpg"),
            os.path.join(config.DATA_DIR, "profiles", f"phone{phone_id}_pic.jpg"),
        ]
        for path in candidates:
            if os.path.exists(path):
                return path
        log.warning("No profile pic found for phone %d %s", phone_id, platform)
        return None

    def _get_bio(self, phone_id: int, platform: str) -> str | None:
        """Get the bio text for a phone+platform combo.
        Reads from data/profiles/phone{id}_{platform}_bio.txt
        """
        candidates = [
            os.path.join(config.DATA_DIR, "profiles", f"phone{phone_id}_{platform}_bio.txt"),
            os.path.join(config.DATA_DIR, "profiles", f"phone{phone_id}_bio.txt"),
        ]
        for path in candidates:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return f.read().strip()
        log.warning("No bio found for phone %d %s", phone_id, platform)
        return None

    # --- Plan Loading ------------------------------------------------------

    def load_weekly_plan(self, week_iso: str = None) -> dict | None:
        """Load the weekly plan JSON for the given week.
        week_iso: e.g. '2026-W09'. If None, uses current week.

        Tries dashboard DB first, then JSON files, then auto-generate.
        """
        # Try dashboard DB first
        db_plan = _load_plan_from_db()
        if db_plan:
            log.info("Loaded plan from dashboard DB")
            return db_plan

        if not week_iso:
            today = _today_et()
            week_iso = f"{today.year}-W{today.isocalendar()[1]:02d}"

        filename = f"weekly_plan_{week_iso}.json"

        # Check multiple locations (JSON file fallback)
        search_paths = [
            os.path.join(config.PLANS_DIR, filename),
            os.path.join(config.BASE_DIR, "plans", filename),
            os.path.join(os.path.expanduser("~"), "Downloads", "Weekly & Daily Plan", "output", filename),
        ]

        for path in search_paths:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    plan = json.load(f)
                log.info("Loaded plan from file: %s", path)
                return plan

        # No plan found -- auto-generate it
        log.info("No plan found for %s -- generating automatically...", week_iso)
        plan = self._auto_generate_plan()
        if plan:
            return plan

        log.error("Failed to generate plan for %s", week_iso)
        return None

    def _auto_generate_plan(self) -> dict | None:
        """Auto-generate the weekly plan using the planner module."""
        try:
            import sys
            # Add Weekly & Daily Plan to sys.path so planner can be imported
            planner_parent = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                "Weekly & Daily Plan",
            )
            if planner_parent not in sys.path:
                sys.path.insert(0, planner_parent)

            import importlib
            scheduler_mod = importlib.import_module("planner.scheduler")
            formatter_mod = importlib.import_module("planner.formatter")
            generate_weekly_plan = scheduler_mod.generate_weekly_plan
            save_weekly_json = formatter_mod.save_weekly_json

            today = _today_et()
            plan = generate_weekly_plan(today)
            json_path = save_weekly_json(plan)
            log.info("Auto-generated weekly plan: %s", json_path)

            # Read back the written file (includes generated_at metadata)
            with open(json_path, "r", encoding="utf-8") as f:
                plan_data = json.load(f)

            # Copy to PLANS_DIR so executor finds it next time
            filename = os.path.basename(json_path)
            local_path = os.path.join(config.PLANS_DIR, filename)
            os.makedirs(config.PLANS_DIR, exist_ok=True)
            import shutil
            shutil.copy2(json_path, local_path)
            log.info("Plan copied to: %s", local_path)

            return plan_data
        except Exception as e:
            log.error("Auto-generate plan failed: %s", e, exc_info=True)
            return None

    def get_today_sessions(self, plan: dict) -> list[dict]:
        """Extract today's sessions from the weekly plan."""
        today = _today_et().isoformat()
        daily = plan.get("daily_plans", {})

        if today in daily:
            return daily[today].get("sessions", [])

        # Try date format variations
        for key, day_plan in daily.items():
            if today in key:
                return day_plan.get("sessions", [])

        log.warning("No sessions found for today (%s)", today)
        return []

    # --- Monitor Helpers ---------------------------------------------------

    @staticmethod
    def _extract_behavioral_state(human) -> dict:
        """Extract behavioral state dict from HumanEngine for monitor events."""
        if not human:
            return {}
        return {
            "energy": getattr(human, '_energy', 0.5),
            "fatigue": getattr(getattr(human, 'fatigue', None), 'fatigue_level', 0.0) if hasattr(human, 'fatigue') else 0.0,
            "boredom": getattr(getattr(human, 'boredom', None), 'level', 0.0) if hasattr(human, 'boredom') else 0.0,
            "phase": getattr(getattr(human, 'phase_tracker', None), 'current_phase', 'unknown') if hasattr(human, 'phase_tracker') else 'unknown',
        }

    def _monitor_event(self, phone_id, account, session_id, event_type,
                       action_type=None, human=None, success=True, metadata=None,
                       duration_ms=None, screenshot_bytes=None):
        """Build and log a BotEvent to the structured monitor."""
        state = self._extract_behavioral_state(human)
        event = BotEvent(
            timestamp=datetime.utcnow().isoformat(),
            phone_id=phone_id,
            account=account,
            session_id=session_id or "unknown",
            event_type=event_type,
            action_type=action_type,
            behavioral_state=state,
            duration_ms=duration_ms,
            success=success,
            metadata=metadata or {},
        )
        monitor_log(event, screenshot_bytes=screenshot_bytes)

    # --- Session Execution -------------------------------------------------

    async def execute_session(self, session: dict):
        """Execute a single session from the plan.

        Session dict example:
        {
            "account_name": "ph1_tiktok",
            "phone_id": 1,
            "platform": "tiktok",
            "start_time": "19:30",
            "end_time": "19:48",
            "session_type": "normal",  # normal, aborted, extended, rest_only
            "post_scheduled": true,
            "post_outcome": "posted",  # posted, draft, skipped
            "pre_activity_minutes": 8,
            "post_activity_minutes": 9,
            "proxy_rotation_before": false,
            "total_duration_minutes": 18
        }
        """
        account = session["account_name"]
        self._current_account = account  # for _create_bot() rate limiter
        phone_id = session["phone_id"]
        platform = session["platform"]
        session_type = session.get("session_type", "normal")
        total_duration = session.get("total_duration_minutes", 15)

        # Use deterministic session_id from plan if available, else generate
        session_id = session.get("session_id", f"{account}_{uuid.uuid4().hex[:8]}")

        post_scheduled = session.get("post_scheduled", False)

        log.info("=== Session: %s | Phone %d | %s | %s | %d min ===",
                 account, phone_id, platform, session_type, total_duration)

        # Log session start to dashboard DB
        _log_session_start_db(session_id, self._account_db_ids.get(account, 0),
                              session_type, dry_run=self._dry_run)

        # Log session start
        self._monitor_event(phone_id, account, session_id, "session_start",
                            metadata={"platform": platform, "session_type": session_type,
                                      "total_duration_minutes": total_duration})

        # Production monitor: session start
        try:
            get_prod_monitor().session_start(
                phone_id=phone_id, account=account,
                session_type=session_type, post_scheduled=post_scheduled,
                platform=platform,
            )
        except Exception:
            pass  # never let monitoring crash the session

        # Connect phone to proxy (skip in TEST_MODE and DRY_RUN — use local WiFi)
        dry_run = self._dry_run
        if not config.TEST_MODE and not dry_run:
            if session.get("proxy_rotation_before", False) or self.proxy.active_phone_id != phone_id:
                if not self.proxy.switch_to_phone(phone_id):
                    # Retry once after delay
                    human = self._get_human(account)
                    log.warning("Proxy switch failed, retrying in ~5s...")
                    await asyncio.sleep(human.timing("t_proxy_retry"))
                    if not self.proxy.switch_to_phone(phone_id):
                        log.error("Proxy switch failed twice for Phone %d, skipping session", phone_id)
                        return "proxy_failed"
        elif dry_run and not config.TEST_MODE:
            log.info("DRY RUN: skipping proxy rotation for Phone %d", phone_id)

        adb = self.controllers[phone_id]
        human = self._get_human(account)

        # Start the human engine for this session (with duration for phase tracking)
        now = _now_et()
        human.start_session(hour=now.hour, weekday=now.weekday(),
                            duration_minutes=total_duration)

        # --- UHID Touch Server Start ---
        phone_name = next((p.get("name", f"Phone {phone_id}") for p in config.PHONES if p["id"] == phone_id), f"Phone {phone_id}")
        uhid_started = False
        try:
            uhid_ok = adb.start_touch_server()
        except Exception as e:
            log.warning("UHID start crashed on %s: %s -- running in degraded mode", phone_name, e)
            uhid_ok = False
        if not uhid_ok:
            log.warning("UHID failed on %s -- running in degraded mode (deviceId=-1)", phone_name)
            tg_alert(phone_id, account, f"UHID failed on {phone_name}")
        else:
            uhid_started = True
            log.info("UHID touch server started on %s", phone_name)
        self._monitor_event(phone_id, account, session_id, "uhid_start",
                            metadata={"success": uhid_ok})

        # --- Session Environment Setup ---
        original_screen_timeout = None
        try:
            # Ensure WiFi is on and connected (SIM disabled, WiFi = only network)
            if not config.TEST_MODE:
                if not adb.get_wifi_state():
                    adb.wifi_on()
                    await asyncio.sleep(human.timing("t_wifi_reconnect"))
                if not adb.check_wifi():
                    log.warning("No internet after WiFi enable — waiting 5s and retrying")
                    await asyncio.sleep(5)
                    if not adb.check_wifi():
                        log.error("No internet on Phone %d — skipping session", phone_id)
                        return "no_wifi"

            # Keep screen on during session (restore in finally)
            original_screen_timeout = adb.get_screen_timeout()
            adb.set_screen_timeout(1800000)  # 30 min

            # Set volume to random realistic level (40-70% of max)
            _, max_vol = adb.get_media_volume()
            target_vol = random.randint(int(max_vol * 0.4), int(max_vol * 0.7))
            adb.set_media_volume(target_vol)
        except Exception as e:
            log.debug("Session env setup partial failure (non-critical): %s", e)

        # Hard session timeout: duration * 1.5 + 5 min grace
        timeout_seconds = total_duration * 60 * 1.5 + 300
        self._session_start_time = time.time()

        try:
            await asyncio.wait_for(
                self._dispatch_session(adb, human, platform, session_type, session, total_duration, phone_id, session_id),
                timeout=timeout_seconds,
            )

        except asyncio.TimeoutError:
            log.critical("SESSION TIMEOUT: %s exceeded %.0fs limit -- forcing cleanup",
                         account, timeout_seconds)
            self._monitor_event(phone_id, account, session_id, "error",
                                human=human, success=False,
                                metadata={"error": "session_timeout", "limit_seconds": timeout_seconds})
            tg_alert(phone_id, account, f"SESSION TIMEOUT after {timeout_seconds:.0f}s",
                     action_trace=get_action_trace(session_id))
            try:
                adb.press_home()
            except Exception:
                pass
            try:
                get_prod_monitor().session_result(
                    phone_id=phone_id, account=account, success=False,
                    duration_minutes=timeout_seconds / 60,
                    error_reason="session timeout",
                )
            except Exception:
                pass
            _log_session_end_db(session_id, success=False, error_message="session timeout")
            human.end_session()
            return "timeout"

        except DeviceLostError as e:
            log.error("DEVICE LOST during session %s (Phone %d): %s -- skipping remaining sessions for this phone",
                      account, phone_id, e)
            self._monitor_event(phone_id, account, session_id, "device_lost",
                                human=human, success=False,
                                metadata={"error": str(e)})
            tg_alert(phone_id, account, f"DEVICE LOST: {e}",
                     action_trace=get_action_trace(session_id))
            try:
                get_prod_monitor().session_result(
                    phone_id=phone_id, account=account, success=False,
                    error_reason=f"device lost: {e}",
                )
            except Exception:
                pass
            _log_session_end_db(session_id, success=False, error_message=f"device lost: {e}")
            human.end_session()
            return "device_lost"

        finally:
            # --- Restore screen timeout ---
            if original_screen_timeout is not None:
                try:
                    adb.set_screen_timeout(original_screen_timeout)
                except Exception:
                    pass

            # --- UHID Touch Server Stop (always runs if started) ---
            if uhid_started:
                try:
                    adb.stop_touch_server()
                    self._monitor_event(phone_id, account, session_id, "uhid_stop")
                except Exception as e:
                    log.debug("Touch server stop failed (expected if device lost): %s", e)

            # --- WiFi off between sessions (prevents background IP leakage) ---
            if not config.TEST_MODE:
                try:
                    adb.wifi_off()
                except Exception:
                    pass

        self._monitor_event(phone_id, account, session_id, "session_end",
                            human=human, metadata={"result": "ok"})

        # Production monitor: session completed
        elapsed_min = (time.time() - self._session_start_time) / 60 if hasattr(self, '_session_start_time') else total_duration
        try:
            get_prod_monitor().session_result(
                phone_id=phone_id, account=account, success=True,
                post_outcome=session.get("post_outcome"),
                duration_minutes=elapsed_min,
            )
        except Exception:
            pass

        # Log success to dashboard DB
        _log_session_end_db(session_id, success=True,
                            post_outcome=session.get("post_outcome"))

        human.end_session()
        log.info("=== Session complete: %s ===", account)
        return "ok"

    async def _dispatch_session(self, adb, human, platform, session_type, session, total_duration, phone_id, session_id="unknown"):
        """Dispatch to the correct session handler (wrapped by timeout in execute_session)."""
        # Store session_id so bots can access it for monitor events
        self._current_session_id = session_id
        if session_type == "aborted":
            await self._execute_aborted(adb, human, platform, total_duration)

        elif session_type == "rest_only":
            await self._execute_rest_only(adb, human, platform, total_duration)

        else:  # normal or extended
            if session_type not in ("normal", "extended"):
                log.warning("Unknown session_type '%s', treating as normal", session_type)
            should_post = session.get("post_scheduled", False)
            await self._execute_normal(
                adb, human, platform, total_duration,
                should_post=should_post,
                post_outcome=session.get("post_outcome", "posted"),
                pre_minutes=session.get("pre_activity_minutes", 8),
                post_minutes=session.get("post_activity_minutes", 9),
                phone_id=phone_id,
            )

    async def _execute_aborted(self, adb: ADBController, human: HumanEngine,
                                platform: str, duration_min: float):
        """Aborted session: open app, scroll 3-6 times passively, close (30-90s)."""
        log.info("Aborted session — opening, scrolling briefly, closing")

        bot = self._create_bot(platform, adb, human)

        bot.open_app()
        await asyncio.sleep(human.timing("t_app_load"))

        # Scroll 3-6 times with no engagement, capped at 90s total
        n_scrolls = random.randint(3, 6)
        start = time.time()
        for _ in range(n_scrolls):
            if time.time() - start > 90:
                break
            watch_time = human.watch_duration()
            await asyncio.sleep(watch_time)
            if platform == "tiktok":
                bot.scroll_fyp()
            else:
                bot.scroll_reels()

        bot.close_app()

    async def _execute_rest_only(self, adb: ADBController, human: HumanEngine,
                                  platform: str, duration_min: float):
        """Rest-only session: just scroll, no posting."""
        log.info("Rest-only session — scrolling for %.1f min", duration_min)

        session_keywords = random.sample(
            config.NICHE_KEYWORDS_POOL,
            k=random.randint(6, min(10, len(config.NICHE_KEYWORDS_POOL))),
        )

        bot = self._create_bot(platform, adb, human)
        await bot.browse_session(duration_minutes=duration_min, should_post=False,
                                 niche_keywords=session_keywords)

    async def _post_with_retry(
        self,
        bot,
        adb: ADBController,
        platform: str,
        video_path: str,
        caption: str,
        phone_id: int,
        record_id: str,
        dry_run: bool = False,
    ) -> str:
        """Try to post, reset app and retry once on retryable failure, fall back to draft.

        Returns one of: "posted" | "draft" | "failed" | "failed_permanent" | "dry_run_skipped"

        In dry_run mode: logs the skip and returns "dry_run_skipped" without calling post.

        Retry flow:
            Attempt 1: post_video/post_reel
              -> "success":     mark_posted, return "posted"
              -> "retryable":   force-stop app, wait 3s, reopen app, wait for load
              -> "banned":      return "failed_permanent" (no retry, no draft)
              -> "media_error": return "failed_permanent" (no retry, no draft)
            Attempt 2: post_video/post_reel
              -> "success":     mark_posted, return "posted"
              -> any failure:   fall through to draft save
            Draft save: bot.save_as_draft
              -> True:   mark_draft in Airtable, return "draft"
              -> False:  send critical Telegram alert, return "failed"

        DeviceLostError propagates up (not caught here).
        """
        if dry_run:
            log.info("DRY RUN: skipping post (would post %s on %s, phone %d)",
                     video_path, platform, phone_id)
            return "dry_run_skipped"

        from ..actions.tiktok import TIKTOK_PKG
        from ..actions.instagram import INSTAGRAM_PKG

        pkg = TIKTOK_PKG if platform == "tiktok" else INSTAGRAM_PKG
        post_fn = bot.post_video if platform == "tiktok" else bot.post_reel

        # Pre-post intervention gate check (delegates to bot method)
        if hasattr(bot, '_check_pre_post_pause'):
            decision = bot._check_pre_post_pause(reason="executor post")
            if decision != "approve":
                log.info("Pre-post pause: decision=%s — skipping post for phone %d", decision, phone_id)
                return "skipped"

        for attempt in range(2):
            result = post_fn(video_path, caption)
            log.info("Post attempt %d/%d: %s (platform=%s, phone=%d)",
                     attempt + 1, 2, result, platform, phone_id)

            if result == "success":
                if not dry_run and mark_posted:
                    mark_posted(record_id, platform)
                return "posted"

            if result in ("banned", "media_error"):
                log.error("Permanent post failure: %s — no retry", result)
                return "failed_permanent"

            # "retryable" — app-reset before next attempt
            if attempt == 0:
                log.warning("Post retryable — resetting app before retry")
                adb.shell(f"am force-stop {pkg}")
                await asyncio.sleep(3.0)
                bot.open_app()
                await asyncio.sleep(bot.human.timing("t_app_load"))

        # Both attempts failed — try saving as draft
        log.warning("Post failed after 2 attempts — trying save_as_draft")
        draft_ok = bot.save_as_draft(video_path, caption)
        account = getattr(self, '_current_account', '')
        if draft_ok:
            if not dry_run and mark_draft:
                mark_draft(record_id, platform)
            try:
                get_prod_monitor().post_failure(
                    phone_id=phone_id, account=account, retries=2,
                    outcome="draft", video_name=caption or "unknown",
                )
            except Exception:
                pass
            return "draft"

        # Draft also failed — critical alert
        log.critical("BOTH post AND draft failed (phone=%d, platform=%s)", phone_id, platform)
        tg_alert(phone_id, account,
                 f"CRITICAL: Post AND draft both failed for {platform}")
        try:
            get_prod_monitor().post_failure(
                phone_id=phone_id, account=account, retries=2,
                outcome="failed", video_name=caption or "unknown",
            )
        except Exception:
            pass
        return "failed"

    async def _execute_normal(self, adb: ADBController, human: HumanEngine,
                               platform: str, duration_min: float,
                               should_post: bool, post_outcome: str,
                               pre_minutes: float, post_minutes: float,
                               phone_id: int):
        """Normal/extended session: scroll -> post -> scroll."""
        dry_run = self._dry_run

        # In dry-run mode, cap scroll to 30s (0.5 min)
        if dry_run:
            pre_minutes = min(pre_minutes, 0.5)
            post_minutes = min(post_minutes, 0.5)
            duration_min = min(duration_min, 1.5)
            log.info("DRY RUN: scroll capped to %.1f/%.1f min", pre_minutes, post_minutes)

        video_path = ""
        caption = ""
        record_id = None
        self._pending_record = None  # reset per session

        if should_post and post_outcome == "posted":
            # Fetch video from Content Library via delivery module
            video_info = get_next_video(phone_id, platform) if get_next_video else None
            if video_info:
                # Download with timeout to prevent session stall
                try:
                    future = _download_pool.submit(download_video, video_info["video_url"])
                    local_path = future.result(timeout=VIDEO_DOWNLOAD_TIMEOUT)
                except Exception as e:
                    log.warning("Video download failed/timed out: %s — will skip post", e)
                    local_path = None
                if local_path:
                    video_path = local_path
                    caption = video_info.get("caption", "")
                    record_id = video_info["record_id"]
                    self._pending_record = record_id
                else:
                    log.warning("Failed to download video, will skip post")
                    should_post = False
            else:
                log.info("No pending video, will just scroll")
                should_post = False

        elif should_post and post_outcome == "draft":
            video_info = get_next_video(phone_id, platform) if get_next_video else None
            if video_info:
                self._pending_record = video_info["record_id"]
                if not dry_run and mark_draft:
                    mark_draft(video_info["record_id"], platform)
                elif dry_run:
                    log.info("DRY RUN: would mark_draft %s [%s]", video_info["record_id"], platform)
            should_post = False

        elif should_post and post_outcome == "skipped":
            video_info = get_next_video(phone_id, platform) if get_next_video else None
            if video_info:
                self._pending_record = video_info["record_id"]
                if not dry_run and mark_skipped:
                    mark_skipped(video_info["record_id"], platform)
                elif dry_run:
                    log.info("DRY RUN: would mark_skipped %s [%s]", video_info["record_id"], platform)
            should_post = False

        session_keywords = random.sample(
            config.NICHE_KEYWORDS_POOL,
            k=random.randint(6, min(10, len(config.NICHE_KEYWORDS_POOL))),
        )

        account = getattr(self, '_current_account', '')
        bot = self._create_bot(platform, adb, human, account_name=account)

        # Pre-scroll phase (or full session if no post)
        # When posting: session splits into pre_minutes + post + post_minutes
        # When not posting: single browse for total duration_min
        await bot.browse_session(
            duration_minutes=pre_minutes if should_post else duration_min,
            should_post=False,
            niche_keywords=session_keywords,
        )

        # Post phase with retry (if applicable)
        if should_post and video_path and record_id:
            post_result = await self._post_with_retry(
                bot, adb, platform, video_path, caption,
                phone_id, record_id, dry_run=dry_run,
            )
            log.info("Post result: %s (phone=%d, platform=%s)", post_result, phone_id, platform)

            # Return to main feed after posting
            if platform == "tiktok":
                bot.go_to_fyp()
            else:
                bot.go_to_reels()

            # Post-scroll phase
            if post_minutes > 0:
                await bot.browse_session(
                    duration_minutes=post_minutes,
                    should_post=False,
                    niche_keywords=session_keywords,
                )

    # --- Warmup Session Execution ------------------------------------------

    async def execute_warmup_session(self, session: dict):
        """Execute a warmup session with limited actions based on warmup day."""
        account = session["account_name"]
        phone_id = session["phone_id"]
        platform = session["platform"]
        day = session["warmup_day"]
        duration = session["duration_minutes"]
        actions = session["actions"]

        log.info("=== WARMUP Day %d: %s | Phone %d | %s | %d min ===",
                 day, account, phone_id, platform, duration)

        # Connect proxy (skip in TEST_MODE)
        if not config.TEST_MODE:
            if self.proxy.active_phone_id != phone_id:
                if not self.proxy.switch_to_phone(phone_id):
                    log.error("Failed to connect Phone %d, skipping warmup session", phone_id)
                    return

        adb = self.controllers[phone_id]
        human = self._get_human(account)
        now = _now_et()
        human.start_session(hour=now.hour, weekday=now.weekday(),
                            duration_minutes=duration)

        if platform == "tiktok":
            await self._warmup_tiktok(adb, human, session)
        else:
            await self._warmup_instagram(adb, human, session)

        human.end_session()
        log.info("=== Warmup session complete: %s day %d ===", account, day)

    async def _warmup_tiktok(self, adb: ADBController, human: HumanEngine, session: dict):
        """Execute a TikTok warmup session.
        Pre-loop tasks are shuffled per session. Scroll loop has full
        micro-behaviors (zona morta, peek scroll, post-like pause, etc.)."""
        account_name = session["account_name"]
        bot = self._create_bot("tiktok", adb, human, account_name=account_name)
        actions = session["actions"]
        duration = session["duration_minutes"]
        niche_keywords = session.get("niche_keywords", [])
        warmup_state = self.warmup_states.get(account_name)
        n_searches = actions.get("search_niche", 0)

        if not bot.open_app():
            return

        # Behavior #10: Variable load reaction time
        await asyncio.sleep(human.load_reaction_time())

        # --- Pre-loop tasks (SHUFFLED order per session) ---
        pre_tasks = []
        if actions.get("explore_app"):
            pre_tasks.append("explore_app")
        if n_searches and niche_keywords:
            pre_tasks.append("search_niche")
        if session.get("set_profile_pic") and warmup_state:
            pre_tasks.append("set_profile_pic")
        if session.get("set_bio") and warmup_state:
            pre_tasks.append("set_bio")

        random.shuffle(pre_tasks)

        for task in pre_tasks:
            if task == "explore_app":
                log.info("Warmup: exploring app features")
                bot.go_to_fyp()
                await asyncio.sleep(human.timing("t_explore_browse"))
                bot.go_to_search()
                await asyncio.sleep(human.timing("t_explore_browse"))
                bot.go_to_fyp()
                await asyncio.sleep(human.timing("t_nav_settle"))

            elif task == "search_niche":
                keywords_to_search = random.sample(
                    niche_keywords, min(n_searches, len(niche_keywords))
                )
                for kw in keywords_to_search:
                    log.info("Warmup: searching '%s'", kw)
                    bot.search_hashtag(kw)
                    await asyncio.sleep(human.timing("t_browse_results"))
                    bot.go_to_fyp()
                    await asyncio.sleep(human.timing("t_explore_browse"))

            elif task == "set_profile_pic":
                profile_pic = self._get_profile_pic(session["phone_id"], "tiktok")
                if profile_pic:
                    bot.set_profile_pic(profile_pic)
                    warmup_state.profile_pic_done = True
                    self._save_warmup_state()
                    await asyncio.sleep(human.timing("t_profile_settle"))

            elif task == "set_bio":
                bio = self._get_bio(session["phone_id"], "tiktok")
                if bio:
                    bot.set_bio(bio)
                    warmup_state.bio_done = True
                    self._save_warmup_state()
                    await asyncio.sleep(human.timing("t_profile_settle"))

        # --- Main scroll + engagement loop (with micro-behaviors) ---
        bot.go_to_fyp()
        await asyncio.sleep(human.timing("t_nav_settle"))

        likes_left = actions.get("like", 0)
        comments_left = actions.get("comment", 0)
        follows_left = actions.get("follow", 0)

        start = time.time()
        total_seconds = duration * 60

        while (time.time() - start) < total_seconds:
            # Behavior #1: Zona morta
            if human.should_zona_morta():
                zm_dur = human.zona_morta_duration()
                log.debug("Warmup zona morta: %.0fs", zm_dur)
                await asyncio.sleep(zm_dur)
                continue

            # Interruption
            if human.should_interrupt():
                await human.do_interruption(adb, "com.zhiliaoapp.musically")
                continue

            # Watch current video
            watch_time = human.watch_duration()
            await asyncio.sleep(watch_time)

            # Pick ONE engagement action (jittered weights, respecting limits)
            _j = lambda base: base * random.uniform(0.75, 1.25)
            options = ["scroll"]
            weights = [_j(0.40)]
            if likes_left > 0:
                options.append("like")
                weights.append(_j(0.35))
            if comments_left > 0:
                options.append("comment")
                weights.append(_j(0.15))
            if follows_left > 0:
                options.append("follow")
                weights.append(_j(0.10))

            action = random.choices(options, weights=weights, k=1)[0]

            if action == "like":
                bot.like_video()
                likes_left -= 1
                await asyncio.sleep(human.post_like_pause())

            elif action == "comment":
                if human.should_double_open_comments():
                    bot.open_comments()
                    await asyncio.sleep(human.timing("t_double_open_1"))
                    adb.press_back()
                    await asyncio.sleep(human.timing("t_double_open_2"))
                await bot.comment_with_ai()
                comments_left -= 1

            elif action == "follow":
                bot.follow_creator()
                follows_left -= 1

            # Scroll to next (with micro-behaviors)
            if human.should_micro_scroll():
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                    adb.screen_w // 2, adb.screen_h // 2,
                )
                if sw.get("hand_switched"):
                    await asyncio.sleep(sw["hand_switch_pause"])
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.timing("t_micro_scroll"))
            elif human.should_peek_scroll():
                bot.peek_scroll()
            elif human.should_rewatch():
                bot.scroll_fyp()
                await asyncio.sleep(human.timing("t_rewatch"))
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h // 4,
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                )
                if sw.get("hand_switched"):
                    await asyncio.sleep(sw["hand_switch_pause"])
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.watch_duration())
            else:
                bot.scroll_fyp()

            await asyncio.sleep(human.action_delay())

        # Post on last day
        if session.get("can_post"):
            try:
                if session.get("use_camera_trick"):
                    await self._tiktok_camera_trick_post(adb, human, bot, session)
                else:
                    video_info = get_next_video(session["phone_id"], "tiktok") if get_next_video else None
                    if video_info:
                        local_path = download_video(video_info["video_url"]) if download_video else None
                        if local_path:
                            if not self._dry_run:
                                result = bot.post_video(local_path, video_info.get("caption", ""))
                                if result == "success" and mark_posted:
                                    mark_posted(video_info["record_id"], "tiktok")
                            else:
                                log.info("DRY RUN: would post TikTok video %s", local_path)
            except Exception as e:
                log.error("Warmup TikTok post failed: %s", e, exc_info=True)

        # Behavior #11: Background at end
        if human.should_end_in_background():
            bg_time = human.bg_end_duration()
            log.debug("Warmup background end: %.0fs", bg_time)
            adb.press_home()
            await asyncio.sleep(bg_time)

        bot.close_app()

    async def _warmup_instagram(self, adb: ADBController, human: HumanEngine, session: dict):
        """Execute an Instagram warmup session.
        Pre-loop tasks are shuffled per session. Scroll loop has full
        micro-behaviors (zona morta, peek scroll, post-like pause, etc.)."""
        bot = InstagramBot(adb, human)
        actions = session["actions"]
        duration = session["duration_minutes"]
        niche_keywords = session.get("niche_keywords", [])
        account_name = session["account_name"]
        warmup_state = self.warmup_states.get(account_name)
        n_searches = actions.get("search_niche", 0)

        if not bot.open_app():
            return

        # Behavior #10: Variable load reaction time
        await asyncio.sleep(human.load_reaction_time())

        # --- Pre-loop tasks (SHUFFLED order per session) ---
        pre_tasks = []
        if actions.get("explore_tab"):
            pre_tasks.append("explore_tab")
        if n_searches and niche_keywords:
            pre_tasks.append("search_niche")
        if session.get("set_profile_pic") and warmup_state:
            pre_tasks.append("set_profile_pic")
        if session.get("set_bio") and warmup_state:
            pre_tasks.append("set_bio")

        random.shuffle(pre_tasks)

        for task in pre_tasks:
            if task == "explore_tab":
                log.info("Warmup: exploring Explore tab")
                bot.go_to_explore()
                await asyncio.sleep(human.timing("t_browse_results"))

            elif task == "search_niche":
                keywords_to_search = random.sample(
                    niche_keywords, min(n_searches, len(niche_keywords))
                )
                for kw in keywords_to_search:
                    log.info("Warmup: searching '%s' on IG", kw)
                    bot.search_keyword(kw)
                    bot.go_to_reels()
                    await asyncio.sleep(human.timing("t_explore_browse"))

            elif task == "set_profile_pic":
                profile_pic = self._get_profile_pic(session["phone_id"], "instagram")
                if profile_pic:
                    bot.set_profile_pic(profile_pic)
                    warmup_state.profile_pic_done = True
                    self._save_warmup_state()
                    await asyncio.sleep(human.timing("t_profile_settle"))

            elif task == "set_bio":
                bio = self._get_bio(session["phone_id"], "instagram")
                if bio:
                    bot.set_bio(bio)
                    warmup_state.bio_done = True
                    self._save_warmup_state()
                    await asyncio.sleep(human.timing("t_profile_settle"))

        # --- Start on Reels or Feed (random) ---
        if random.random() < 0.6:
            bot.go_to_reels()
        else:
            bot.go_to_feed()
            # Watch stories sometimes during warmup (20% — real users do this)
            if random.random() < 0.20:
                bot.watch_stories(count=random.randint(1, 3))
        await asyncio.sleep(human.timing("t_nav_settle"))

        # --- Main scroll + engagement loop (with micro-behaviors) ---
        likes_left = actions.get("like", 0)
        comments_left = actions.get("comment", 0)
        follows_left = actions.get("follow", 0)

        start = time.time()
        total_seconds = duration * 60

        while (time.time() - start) < total_seconds:
            # Behavior #1: Zona morta
            if human.should_zona_morta():
                zm_dur = human.zona_morta_duration()
                log.debug("Warmup zona morta: %.0fs", zm_dur)
                await asyncio.sleep(zm_dur)
                continue

            # Interruption
            if human.should_interrupt():
                await human.do_interruption(adb, "com.instagram.android")
                continue

            # Watch current video
            watch_time = human.watch_duration()
            await asyncio.sleep(watch_time)

            # Pick ONE engagement action (jittered weights, respecting limits)
            _j = lambda base: base * random.uniform(0.75, 1.25)
            options = ["scroll"]
            weights = [_j(0.40)]
            if likes_left > 0:
                options.append("like")
                weights.append(_j(0.35))
            if comments_left > 0:
                options.append("comment")
                weights.append(_j(0.15))
            if follows_left > 0:
                options.append("follow")
                weights.append(_j(0.10))

            action = random.choices(options, weights=weights, k=1)[0]

            if action == "like":
                bot.like_post()
                likes_left -= 1
                await asyncio.sleep(human.post_like_pause())

            elif action == "comment":
                if human.should_double_open_comments():
                    bot.open_comments()
                    await asyncio.sleep(human.timing("t_double_open_1"))
                    adb.press_back()
                    await asyncio.sleep(human.timing("t_double_open_2"))
                await bot.comment_with_ai()
                comments_left -= 1

            elif action == "follow":
                bot.follow_user()
                follows_left -= 1

            # Scroll to next (with micro-behaviors)
            if human.should_micro_scroll():
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                    adb.screen_w // 2, adb.screen_h // 2,
                )
                if sw.get("hand_switched"):
                    await asyncio.sleep(sw["hand_switch_pause"])
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.timing("t_micro_scroll"))
            elif human.should_peek_scroll():
                # Inline peek scroll for IG
                mid_y = adb.screen_h // 2
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                    adb.screen_w // 2, mid_y,
                )
                if sw.get("hand_switched"):
                    await asyncio.sleep(sw["hand_switch_pause"])
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.timing("t_micro_scroll"))
                adb.swipe(sw["x2"], sw["y2"], sw["x1"], sw["y1"], sw["duration"])
            elif human.should_rewatch():
                bot.scroll_reels()
                await asyncio.sleep(human.timing("t_rewatch"))
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h // 4,
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                )
                if sw.get("hand_switched"):
                    await asyncio.sleep(sw["hand_switch_pause"])
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.watch_duration())
            else:
                bot.scroll_reels()

            await asyncio.sleep(human.action_delay())

        # Post on last day
        if session.get("can_post"):
            try:
                video_info = get_next_video(session["phone_id"], "instagram") if get_next_video else None
                if video_info:
                    local_path = download_video(video_info["video_url"]) if download_video else None
                    if local_path:
                        if not self._dry_run:
                            result = bot.post_reel(local_path, video_info.get("caption", ""))
                            if result == "success" and mark_posted:
                                mark_posted(video_info["record_id"], "instagram")
                        else:
                            log.info("DRY RUN: would post Instagram reel %s", local_path)
            except Exception as e:
                log.error("Warmup Instagram post failed: %s", e, exc_info=True)

        # Behavior #11: Background at end
        if human.should_end_in_background():
            bg_time = human.bg_end_duration()
            log.debug("Warmup background end: %.0fs", bg_time)
            adb.press_home()
            await asyncio.sleep(bg_time)

        bot.close_app()

    async def _tiktok_camera_trick_post(self, adb: ADBController, human: HumanEngine,
                                         bot: TikTokBot, session: dict):
        """TikTok camera overlay trick: record with native camera, then overlay real video.
        This makes TikTok think the content was created natively, boosting reach."""
        log.info("Warmup: posting with camera overlay trick")

        # First, push the real video to the phone
        video_info = get_next_video(session["phone_id"], "tiktok")
        if not video_info:
            log.warning("No video to post, skipping camera trick")
            return

        local_path = download_video(video_info["video_url"])
        if not local_path:
            return

        now = _now_et()
        vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
        device_video_path = f"/sdcard/Download/{vid_name}"
        adb.push_file(local_path, device_video_path)
        await asyncio.sleep(human.timing("t_file_push"))
        adb.shell(
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
            f'-d "file://{device_video_path}"'
        )
        await asyncio.sleep(human.timing("t_file_push"))

        # Step 1: Open TikTok camera (Create button)
        x, y = adb.get_coord("tiktok", "nav_create")
        x, y = human.jitter_tap(x, y)
        adb.tap(x, y)
        await asyncio.sleep(human.timing("t_upload_load"))

        # Step 2: Make sure we're on Camera mode (not Upload)
        x, y = adb.get_coord("tiktok", "camera_tab")
        x, y = human.jitter_tap(x, y)
        adb.tap(x, y)
        await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 3: Record for a few seconds (filming desk/whatever)
        x, y = adb.get_coord("tiktok", "record_btn")
        x, y = human.jitter_tap(x, y)
        adb.tap(x, y)
        await asyncio.sleep(human.timing("t_camera_record"))
        # Stop recording
        adb.tap(x, y)
        await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 4: Go to edit (Next/Done button -- use Vision for this dynamic element)
        coords = adb.wait_for_screen("Next or Done button", timeout=5)
        if coords:
            x, y = human.jitter_tap(coords[0], coords[1])
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 5: Find and tap Overlay/Effects (use Vision -- position varies)
        coords = adb.find_on_screen("Overlay or Effects button")
        if coords:
            x, y = human.jitter_tap(coords[0], coords[1])
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_nav_settle"))

            # "Add overlay" button (use Vision)
            coords = adb.find_on_screen("Add overlay or Add button")
            if coords:
                x, y = human.jitter_tap(coords[0], coords[1])
                adb.tap(x, y)
                await asyncio.sleep(human.timing("t_nav_settle"))

            # Select the video from gallery (most recent = top-left)
            x, y = adb.get_coord("tiktok", "gallery_first")
            x, y = human.jitter_tap(x, y)
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 6: Tap Next to go to caption screen
        coords = adb.wait_for_screen("Next button", timeout=5)
        if coords:
            x, y = human.jitter_tap(coords[0], coords[1])
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 7: Add caption
        caption = video_info.get("caption", "")
        if caption:
            x, y = adb.get_coord("tiktok", "upload_caption")
            x, y = human.jitter_tap(x, y)
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_caption_input"))
            human.type_with_errors(adb, caption)
            await asyncio.sleep(human.timing("t_post_typing"))

        # Step 8: Post (use Vision for Post button)
        coords = adb.wait_for_screen("Post button", timeout=5)
        if coords:
            x, y = human.jitter_tap(coords[0], coords[1])
            adb.tap(x, y)
            if not self._dry_run:
                log.info("Warmup: video posted with camera trick!")
                await asyncio.sleep(human.timing("t_post_upload"))
                mark_posted(video_info["record_id"], "tiktok")
            else:
                log.info("DRY RUN: would post TikTok camera trick video")

        # Clean up
        adb.shell(f'rm "{device_video_path}"')

    # --- Day Runner --------------------------------------------------------

    async def run_today(self, dry_run: bool = False):
        """Load today's plan and execute all sessions.
        If accounts are in warmup, runs warmup sessions instead of the weekly plan.
        """
        self._dry_run = dry_run
        if dry_run:
            log.info("DRY RUN mode — Airtable writes suppressed, proxy rotation skipped, scroll capped at 30s")
        self._running = True

        # Initialize structured event logger
        events_dir = os.path.join(config.DATA_DIR, "events")
        screenshots_dir = os.path.join(config.DATA_DIR, "screenshots")
        init_monitor(events_dir=events_dir, screenshots_dir=screenshots_dir)

        # Initialize Telegram alerts (warns if env vars missing)
        init_alerts()
        init_prod_monitor()

        # --- UHID JAR deployment check (once per day, before any sessions) ---
        for pid, adb in self.controllers.items():
            phone_name = next((p.get("name", f"Phone {pid}") for p in config.PHONES if p["id"] == pid), f"Phone {pid}")
            try:
                jar_check = adb.shell("ls /data/local/tmp/touchserver.jar").strip()
                if "/data/local/tmp/touchserver.jar" not in jar_check:
                    log.warning("touchserver.jar missing on %s -- push it first", phone_name)
                    tg_alert(pid, phone_name, f"touchserver.jar missing on {phone_name}")
            except Exception as e:
                log.debug("JAR check failed for %s: %s", phone_name, e)

        # Track phones that lost USB connection (shared across phases)
        dead_phones = set()

        # --- Check for new phones and auto-enroll in warmup ---
        self.check_new_phones()

        # --- Phase 1: Run warmup sessions for accounts still in warmup ---
        warmup_accounts = {name: state for name, state in self.warmup_states.items()
                          if not state.completed}

        if warmup_accounts:
            log.info("Running warmup for %d accounts", len(warmup_accounts))

            # Group by phone for proxy efficiency
            phones_done = set()
            for name, state in warmup_accounts.items():
                if not self._running:
                    break

                phone_id = state.phone_id
                if phone_id not in self.controllers:
                    log.debug("Skipping warmup for %s — Phone %d not connected", name, phone_id)
                    continue
                if phone_id in dead_phones:
                    log.warning("Skipping warmup for %s — Phone %d lost connection", name, phone_id)
                    continue

                sessions = generate_warmup_sessions(state)
                for session in sessions:
                    if not self._running:
                        break
                    try:
                        await self.execute_warmup_session(session)
                    except DeviceLostError as e:
                        log.error("DEVICE LOST during warmup %s (Phone %d): %s", name, phone_id, e)
                        dead_phones.add(phone_id)
                        break
                    except DeviceConfigError as e:
                        log.critical("DEVICE CONFIG FAILED phone %d: %s", phone_id, e)
                        dead_phones.add(phone_id)
                        break
                    except Exception as e:
                        log.error("Warmup session %s crashed: %s",
                                  session.get("account_name", "?"), e, exc_info=True)
                    # Gap between warmup sessions on same phone
                    await asyncio.sleep(self._get_human(name).timing("t_session_gap"))

                # Advance warmup day
                state.advance_day()
                self._save_warmup_state()
                log.info("Warmup day %d complete for %s", state.current_day - 1, name)

        # --- Phase 2: Run weekly plan for accounts done with warmup ---
        plan = self.load_weekly_plan()
        if not plan:
            if not warmup_accounts:
                log.error("No weekly plan found and no warmup to run")
            self.proxy.disconnect_all()
            return

        sessions = self.get_today_sessions(plan)

        # Filter out sessions for accounts still in warmup
        if warmup_accounts:
            sessions = [s for s in sessions
                       if s.get("account_name") not in warmup_accounts]

        if not sessions:
            log.info("No regular sessions for today (all in warmup or no plan)")
        else:
            log.info("Found %d regular sessions for today", len(sessions))

            # --- Content stock check (once per day, before session loop) ---
            phone_ids = list({s.get("phone_id") for s in sessions if s.get("phone_id")})
            stock = check_content_stock(phone_ids)

            if stock:
                for pid, count in stock.items():
                    if count == 0:
                        get_prod_monitor().stock_alert(phone_id=pid, count=0, critical=True)
                        log.warning("Phone %d: ZERO stock — sessions will run scroll-only", pid)
                    elif count < _LOW_STOCK_THRESHOLD:
                        get_prod_monitor().stock_alert(phone_id=pid, count=count, critical=False)
                        log.info("Phone %d: low stock (%d videos)", pid, count)
            else:
                log.info("Stock check returned empty — proceeding with normal posting for all")

            # dead_phones set is shared from Phase 1 (top of run_today)

            for session in sessions:
                if not self._running:
                    log.info("Execution stopped by user")
                    break

                phone_id = session.get("phone_id")
                if phone_id in dead_phones:
                    log.warning("Skipping session %s — Phone %d lost connection",
                                session.get("account_name", "?"), phone_id)
                    continue

                # Warmup-only override: if stock=0, disable posting for this phone
                phone_stock = stock.get(phone_id, None)
                warmup_only = (phone_stock is not None and phone_stock == 0)
                if warmup_only and session.get("post_scheduled", False):
                    log.info("Phone %d: stock=0, overriding to scroll-only (no post)", phone_id)
                    session = dict(session)  # shallow copy to avoid mutating plan
                    session["post_scheduled"] = False

                start_time_str = session.get("start_time", "")
                if start_time_str:
                    await self._wait_until(start_time_str)

                try:
                    result = await self.execute_session(session)
                    if result == "device_lost":
                        dead_phones.add(phone_id)
                        log.warning("Phone %d marked as dead for this run", phone_id)
                except DeviceLostError as e:
                    log.error("DEVICE LOST (uncaught): Phone %d — %s", phone_id, e)
                    dead_phones.add(phone_id)
                except DeviceConfigError as e:
                    log.critical("DEVICE CONFIG FAILED phone %d: %s", phone_id, e)
                    dead_phones.add(phone_id)
                except Exception as e:
                    log.error("Session %s crashed: %s",
                              session.get("account_name", "?"), e, exc_info=True)

                gap = session.get("gap_after_minutes", 0)
                if gap > 0:
                    log.info("Waiting %.1f min gap before next session", gap)
                    await asyncio.sleep(gap * 60)

        if not config.TEST_MODE:
            self.proxy.disconnect_all()

        # Flush and close the event logger
        monitor = get_monitor()
        if monitor:
            monitor.rotate_old_files()
            monitor.close()

        log.info("All sessions for today completed!")

    async def _wait_until(self, time_str: str):
        """Wait until a specific time (HH:MM format)."""
        target_h, target_m = map(int, time_str.split(":"))
        while True:
            now = _now_et()
            if now.hour > target_h or (now.hour == target_h and now.minute >= target_m):
                return
            remaining = (target_h * 60 + target_m) - (now.hour * 60 + now.minute)
            if remaining < 0:
                # Past target time (day-wrap or already passed) -- don't wait
                return
            log.info("Waiting %d min until %s...", remaining, time_str)
            await asyncio.sleep(min(remaining * 60, 60))  # check every minute

    def stop(self):
        """Stop execution after current session completes."""
        self._running = False
