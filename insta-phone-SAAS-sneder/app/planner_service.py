"""Planner service layer -- wraps planner module with DB integration.

Handles: account querying, timezone conversion, UPSERT plan storage,
field name mapping, deterministic session IDs, personality round-trips,
and warmup service functions.
"""
import json
import logging
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from . import db
from .models import WeeklyPlan, SessionLog, BotAccount, Bot, Phone

logger = logging.getLogger(__name__)

# Planner imports are lazy -- sys.path is set during create_app()
_planner_generate = None
_planner_get_account_state = None


def _ensure_planner_imports():
    """Lazy import of planner module (sys.path set during create_app)."""
    global _planner_generate, _planner_get_account_state
    if _planner_generate is not None:
        return True
    try:
        from planner.scheduler import generate_weekly_plan as pg
        from planner.personality import get_account_state as gas
        _planner_generate = pg
        _planner_get_account_state = gas
        return True
    except ImportError:
        logger.warning("Planner module not available -- check sys.path setup")
        return False

EASTERN = ZoneInfo("US/Eastern")
UTC = ZoneInfo("UTC")

# Field name mapping: planner output -> API format
_FIELD_MAP = {
    "account": "account_name",
    "type": "session_type",
    "phone": "phone_id",
    "time_slot": "time_slot_name",
}


def _get_accounts_for_proxy(proxy_id):
    """Query accounts for a proxy group from DB.

    Join path: BotAccount -> Bot (has proxy_id) -> Phone
    Returns list of account dicts compatible with planner's accounts parameter.
    """
    results = (
        db.session.query(BotAccount, Bot, Phone)
        .join(Bot, BotAccount.bot_id == Bot.id)
        .join(Phone, Bot.phone_ref_id == Phone.id)
        .filter(Bot.proxy_id == proxy_id)
        .all()
    )

    accounts = []
    for ba, bot, phone in results:
        name = f"ph{phone.id}_{ba.platform or bot.platform or 'tiktok'}"

        # Parse warmup state
        warmup_state = None
        if ba.warmup_json:
            ws = ba.warmup_json if isinstance(ba.warmup_json, dict) else json.loads(ba.warmup_json)
            if not ws.get("completed", True):
                warmup_state = ws

        # Parse personality state
        personality_state = None
        if ba.personality_json:
            personality_state = (ba.personality_json if isinstance(ba.personality_json, dict)
                                 else json.loads(ba.personality_json))

        accounts.append({
            "name": name,
            "phone_id": phone.id,
            "platform": ba.platform or bot.platform or "tiktok",
            "warmup_state": warmup_state,
            "personality_state": personality_state,
            "_bot_account_id": ba.id,
        })

    return accounts


def _translate_session(session_dict):
    """Translate planner field names to API format."""
    translated = {}
    for k, v in session_dict.items():
        new_key = _FIELD_MAP.get(k, k)
        translated[new_key] = v
    return translated


def _add_session_ids(plan_dict):
    """Add deterministic session_id to each session in the plan."""
    for day_str, day_data in plan_dict.get("days", {}).items():
        for session in day_data.get("sessions", []):
            account = session.get("account_name", session.get("account", "unknown"))
            session_num = session.get("session_number", 1)
            session["session_id"] = f"{day_str}_{account}_{session_num}"


def _convert_times_to_utc(plan_dict):
    """Convert Eastern time strings to UTC ISO 8601 in the plan."""
    for day_str, day_data in plan_dict.get("days", {}).items():
        day_date = date.fromisoformat(day_str)
        for session in day_data.get("sessions", []):
            start_et = session.get("start_time")
            end_et = session.get("end_time")
            if start_et:
                session["start_time_et"] = start_et
                h, m = map(int, start_et.split(":"))
                dt = datetime(day_date.year, day_date.month, day_date.day, h, m, tzinfo=EASTERN)
                session["start_time_utc"] = dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            if end_et:
                session["end_time_et"] = end_et
                h, m = map(int, end_et.split(":"))
                dt = datetime(day_date.year, day_date.month, day_date.day, h, m, tzinfo=EASTERN)
                session["end_time_utc"] = dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def generate_weekly_plan(proxy_id, week_date=None):
    """Generate a weekly plan for a proxy group, store in DB, return dict.

    Args:
        proxy_id: Proxy group ID
        week_date: Any date in the target week (defaults to today)
    """
    if not _ensure_planner_imports():
        raise ValueError("Planner module not available")

    accounts = _get_accounts_for_proxy(proxy_id)
    if not accounts:
        raise ValueError(f"No accounts found for proxy group {proxy_id}")

    # Build personality state from DB
    state = {}
    for acc in accounts:
        if acc.get("personality_state"):
            state[acc["name"]] = acc["personality_state"]

    # Generate plan
    plan = _planner_generate(accounts=accounts, start_date=week_date, state=state)
    plan_dict = plan.to_dict()

    # Translate field names in all sessions
    for day_str, day_data in plan_dict.get("days", {}).items():
        day_data["sessions"] = [_translate_session(s) for s in day_data["sessions"]]

    # Add session IDs and convert times
    _add_session_ids(plan_dict)
    _convert_times_to_utc(plan_dict)

    # UPSERT into DB
    iso_cal = (week_date or date.today()).isocalendar()
    week_number = iso_cal[1]
    year = iso_cal[0]

    existing = WeeklyPlan.query.filter_by(
        proxy_id=proxy_id, week_number=week_number, year=year
    ).first()

    if existing:
        existing.plan_json = plan_dict
        existing.generated_at = datetime.now(UTC)
        existing.status = 'active'
    else:
        new_plan = WeeklyPlan(
            proxy_id=proxy_id,
            week_number=week_number,
            year=year,
            plan_json=plan_dict,
            status='active',
        )
        db.session.add(new_plan)

    # Write personality state back to DB
    for acc in accounts:
        acc_state = state.get(acc["name"])
        if acc_state and acc.get("_bot_account_id"):
            ba = db.session.get(BotAccount, acc["_bot_account_id"])
            if ba:
                ba.personality_json = acc_state

    db.session.commit()
    return plan_dict


def regenerate_remaining_days(proxy_id, from_date):
    """Regenerate days from from_date forward, update existing plan."""
    current = get_current_plan(proxy_id)
    if not current:
        return generate_weekly_plan(proxy_id, from_date)

    # For simplicity, regenerate the entire week
    # (preserving old days would require deserializing back to planner dataclasses)
    return generate_weekly_plan(proxy_id, from_date)


def get_current_plan(proxy_id):
    """Return active plan dict for proxy group, or None."""
    today = date.today()
    iso_cal = today.isocalendar()

    plan = WeeklyPlan.query.filter_by(
        proxy_id=proxy_id, week_number=iso_cal[1], year=iso_cal[0], status='active'
    ).first()

    if plan:
        return plan.plan_json
    return None


def get_today_sessions(proxy_id=None):
    """Return today's sessions with execution status from SessionLog."""
    today = date.today()
    today_str = today.isoformat()

    # Get plan
    if proxy_id:
        plan_dict = get_current_plan(proxy_id)
    else:
        # Get all active plans
        plans = WeeklyPlan.query.filter_by(status='active').all()
        plan_dict = None
        for p in plans:
            if today_str in (p.plan_json or {}).get("days", {}):
                plan_dict = p.plan_json
                break

    if not plan_dict:
        return []

    day_data = plan_dict.get("days", {}).get(today_str, {})
    sessions = day_data.get("sessions", [])

    # Enrich with execution status
    for session in sessions:
        sid = session.get("session_id")
        if sid:
            log = SessionLog.query.filter_by(session_id=sid).first()
            if log:
                if log.ended_at:
                    session["execution_status"] = "completed" if log.status == "success" else "failed"
                else:
                    session["execution_status"] = "running"
            else:
                session["execution_status"] = "planned"
        else:
            session["execution_status"] = "planned"

    return sessions


def get_warmup_status(account_name):
    """Read warmup status from BotAccount.warmup_json."""
    ba = BotAccount.query.filter_by(username=account_name).first()
    if not ba or not ba.warmup_json:
        return None

    ws = ba.warmup_json if isinstance(ba.warmup_json, dict) else json.loads(ba.warmup_json)

    current_day = ws.get("current_day", 0)
    total_days = ws.get("total_days", 7)
    warmup_plan = ws.get("warmup_plan", {})

    day_plan = warmup_plan.get(str(current_day), {})
    day_type = day_plan.get("type", "normal")

    caps = {}
    if not ws.get("completed", False):
        caps = {
            "likes": day_plan.get("likes", 0),
            "comments": day_plan.get("comments", 0),
            "follows": day_plan.get("follows", 0),
            "scroll_only": (day_plan.get("likes", 0) == 0
                            and day_plan.get("comments", 0) == 0
                            and day_plan.get("follows", 0) == 0),
        }

    plan_summary = []
    for d in range(1, total_days + 1):
        dp = warmup_plan.get(str(d), {})
        plan_summary.append({
            "day": d,
            "type": dp.get("type", "normal"),
            "sessions": dp.get("sessions", 1) if dp.get("type") != "dead" else 0,
            "caps": {k: dp.get(k, 0) for k in ["likes", "comments", "follows"]},
        })

    return {
        "account_name": account_name,
        "current_day": current_day,
        "total_days": total_days,
        "day_type": day_type,
        "completed": ws.get("completed", False),
        "caps": caps,
        "profile_pic": {"day": ws.get("profile_pic_day", 0), "done": ws.get("profile_pic_done", False)},
        "bio": {"day": ws.get("bio_day", 0), "done": ws.get("bio_done", False)},
        "plan_summary": plan_summary,
    }


def update_warmup(account_name, action, **kwargs):
    """Reset, skip, or complete warmup for an account."""
    ba = BotAccount.query.filter_by(username=account_name).first()
    if not ba:
        raise ValueError(f"Account {account_name} not found")

    ws = (ba.warmup_json if isinstance(ba.warmup_json, dict)
          else json.loads(ba.warmup_json or "{}"))

    if action == "reset":
        ws["current_day"] = 0
        ws["completed"] = False
        ws["profile_pic_done"] = False
        ws["bio_done"] = False
    elif action == "skip":
        target = kwargs.get("target_day", ws.get("current_day", 0) + 1)
        ws["current_day"] = min(target, ws.get("total_days", 7))
    elif action == "complete":
        ws["completed"] = True
        ws["current_day"] = ws.get("total_days", 7)
    else:
        raise ValueError(f"Unknown warmup action: {action}")

    # Force SQLAlchemy to detect the change (JSON column mutation)
    import copy
    ba.warmup_json = copy.deepcopy(ws)
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(ba, "warmup_json")
    db.session.commit()

    return get_warmup_status(account_name)
