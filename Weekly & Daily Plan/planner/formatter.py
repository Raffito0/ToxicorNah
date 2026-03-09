"""Output formatter — generates JSON and human-readable text files."""
import json
import os
from datetime import date, datetime

from . import config
from .models import WeeklyPlan, DailyPlan

WEEKDAY_NAMES_IT = {
    0: "LUNEDI'", 1: "MARTEDI'", 2: "MERCOLEDI'",
    3: "GIOVEDI'", 4: "VENERDI'", 5: "SABATO", 6: "DOMENICA",
}

PLATFORM_ICONS = {"tiktok": "TikTok", "instagram": "Instagram"}


def _ensure_output_dir():
    os.makedirs(config.OUTPUT_DIR, exist_ok=True)


# ─── JSON Output ──────────────────────────────────────────────────────────────
def save_weekly_json(plan):
    _ensure_output_dir()
    data = plan.to_dict()
    data["generated_at"] = datetime.now().isoformat()
    filename = f"weekly_plan_{plan.year}-W{plan.week_number:02d}.json"
    filepath = os.path.join(config.OUTPUT_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return filepath


def save_daily_json(plan):
    _ensure_output_dir()
    data = plan.to_dict()
    data["generated_at"] = datetime.now().isoformat()
    filename = f"daily_plan_{plan.date.isoformat()}.json"
    filepath = os.path.join(config.OUTPUT_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return filepath


# ─── Text Output ──────────────────────────────────────────────────────────────
def _format_session_line(session):
    """Format a single session as a readable text line."""
    time_range = f"{session.start_time.strftime('%H:%M')}-{session.end_time.strftime('%H:%M')}"
    phone_label = f"Phone {session.phone_id}"
    platform = PLATFORM_ICONS.get(session.platform, session.platform)

    # Session type indicator
    if session.session_type == "aborted":
        action = f"ABORTED ({session.total_duration_minutes}min) - opened and closed"
        return f"  {time_range}  {phone_label} | {platform}\n             {action}"

    if session.session_type == "extended":
        action = f"EXTENDED session ({session.total_duration_minutes}min) - long scroll"
        if session.post_scheduled:
            outcome_str = _outcome_str(session.post_outcome)
            action += f" + {outcome_str}"
        return f"  {time_range}  {phone_label} | {platform}\n             {action}"

    if session.session_type == "rest_only":
        action = f"Scroll {session.pre_activity_minutes}min (no post - rest/browse)"
        return f"  {time_range}  {phone_label} | {platform}\n             {action}"

    # Normal session with post
    outcome_str = _outcome_str(session.post_outcome)
    action = (f"Scroll {session.pre_activity_minutes}min -> "
              f"{outcome_str} -> "
              f"Scroll {session.post_activity_minutes}min")

    return f"  {time_range}  {phone_label} | {platform}\n             {action}"


def _outcome_str(outcome):
    if outcome == "posted":
        return "POST video"
    if outcome == "draft":
        return "SAVED AS DRAFT (error)"
    if outcome == "skipped":
        return "SKIPPED POST (changed mind)"
    return "no post"


def _format_daily_text(day_date, daily_plan):
    """Format a single day as readable text."""
    weekday = WEEKDAY_NAMES_IT.get(day_date.weekday(), "")
    lines = [
        f"\n{weekday} {day_date.strftime('%d/%m/%Y')}",
        "-" * 50,
    ]

    if not daily_plan.sessions:
        lines.append("  (no sessions scheduled)")
        return "\n".join(lines)

    last_phone = None
    for session in daily_plan.sessions:
        if session.proxy_rotation_before:
            lines.append(f"             [ROTATE PROXY: Phone {last_phone} -> Phone {session.phone_id}]")
        lines.append(_format_session_line(session))
        last_phone = session.phone_id

    return "\n".join(lines)


def save_weekly_text(plan):
    _ensure_output_dir()
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")

    lines = [
        "=" * 60,
        f"  WEEKLY PLAN - Week {plan.week_number}, {plan.year}",
        f"  {plan.start_date.strftime('%d/%m/%Y')} - {plan.end_date.strftime('%d/%m/%Y')}",
        f"  Generated: {now_str} | Timezone: ET (Eastern Time)",
        "=" * 60,
    ]

    # Daily details
    for day_date in sorted(plan.daily_plans.keys()):
        dp = plan.daily_plans[day_date]
        lines.append(_format_daily_text(day_date, dp))

    # Weekly summary
    lines.append("\n" + "=" * 60)
    lines.append("  WEEKLY SUMMARY")
    lines.append("=" * 60)

    for acc_name, summary in sorted(plan.account_summaries.items()):
        rest_str = ", ".join(
            d.strftime("%a %d/%m") if isinstance(d, date) else d
            for d in summary.rest_days
        ) or "none"
        one_post_str = ", ".join(
            d.strftime("%a %d/%m") if isinstance(d, date) else d
            for d in summary.one_post_days
        ) or "none"
        break_str = ""
        if summary.two_day_break:
            break_str = " | 2-day break: " + ", ".join(
                d.strftime("%a %d/%m") if isinstance(d, date) else d
                for d in summary.two_day_break
            )

        errors_str = ""
        if summary.draft_errors or summary.skipped_posts or summary.aborted_sessions:
            parts = []
            if summary.draft_errors:
                parts.append(f"{summary.draft_errors} drafts")
            if summary.skipped_posts:
                parts.append(f"{summary.skipped_posts} skipped")
            if summary.aborted_sessions:
                parts.append(f"{summary.aborted_sessions} aborted")
            errors_str = f" | Events: {', '.join(parts)}"

        platform = PLATFORM_ICONS.get(summary.platform, summary.platform)
        lines.append(
            f"  Phone {summary.phone_id} {platform:>10}: "
            f"{summary.total_posts:2d} posts, {summary.total_sessions:2d} sessions | "
            f"Rest: {rest_str} | 1-post: {one_post_str}"
            f"{break_str}{errors_str}"
        )

    filename = f"weekly_plan_{plan.year}-W{plan.week_number:02d}.txt"
    filepath = os.path.join(config.OUTPUT_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return filepath


def save_daily_text(daily_plan):
    _ensure_output_dir()
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")

    lines = [
        "=" * 60,
        f"  DAILY PLAN - {daily_plan.date.strftime('%d/%m/%Y')}",
        f"  Generated: {now_str} | Timezone: ET (Eastern Time)",
        "=" * 60,
        _format_daily_text(daily_plan.date, daily_plan),
    ]

    filename = f"daily_plan_{daily_plan.date.isoformat()}.txt"
    filepath = os.path.join(config.OUTPUT_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return filepath
