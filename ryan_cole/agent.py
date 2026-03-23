"""Ryan Cole — Main agent orchestrator.

Runs 24/7 on a schedule, executing tasks across 6 freelance platforms.
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import AGENT_TIMEZONE, PLATFORMS
from .state.database import init_db, get_today_summary
from .notifications.telegram import send_daily_report, send_alert
from .platforms.fiverr import check_and_deliver as fiverr_check
from .platforms.freelancer import scrape_and_propose as freelancer_propose
from .platforms.peopleperhour import scrape_and_propose as pph_propose
from .platforms.textbroker import check_and_write as textbroker_check
from .platforms.scripted import check_and_write as scripted_check
from .platforms.contra import scrape_and_apply as contra_apply

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ryan-cole")

_ET = AGENT_TIMEZONE


def _now() -> datetime:
    return datetime.now(_ET)


# ---------------------------------------------------------------------------
# Task wrappers (check platform enabled + catch errors)
# ---------------------------------------------------------------------------

def _safe(name: str, fn):
    """Run a platform task safely — log errors, never crash the scheduler."""
    def wrapper():
        if not PLATFORMS.get(name):
            return
        try:
            log.info("[%s] Starting task...", name)
            fn()
            log.info("[%s] Task complete", name)
        except Exception as e:
            log.error("[%s] Task failed: %s", name, e, exc_info=True)
            send_alert(f"{name} task failed: {e}")
    wrapper.__name__ = f"task_{name}"
    return wrapper


def task_inbox_monitor():
    """Check all platform inboxes for new messages."""
    log.info("[Monitor] Checking all inboxes...")
    if PLATFORMS.get("fiverr"):
        try:
            fiverr_check()
        except Exception as e:
            log.error("[Monitor] Fiverr inbox check failed: %s", e)


def task_daily_report():
    """Send end-of-day summary via Telegram."""
    stats = get_today_summary()
    log.info("[Report] Sending daily summary: $%.0f revenue, %d orders",
             stats["total_revenue"], stats["total_orders"])
    send_daily_report(stats)


# ---------------------------------------------------------------------------
# Scheduler setup
# ---------------------------------------------------------------------------

def create_scheduler() -> BlockingScheduler:
    """Create the APScheduler with all Ryan Cole tasks."""
    scheduler = BlockingScheduler(timezone=_ET)

    # --- Morning (6:00-9:00 ET) ---
    scheduler.add_job(_safe("fiverr", fiverr_check),
                      CronTrigger(hour=6, minute=0, timezone=_ET),
                      id="fiverr_morning", name="Fiverr morning check")
    scheduler.add_job(_safe("freelancer", freelancer_propose),
                      CronTrigger(hour=6, minute=30, timezone=_ET),
                      id="freelancer_morning", name="Freelancer morning proposals")
    scheduler.add_job(_safe("peopleperhour", pph_propose),
                      CronTrigger(hour=7, minute=0, timezone=_ET),
                      id="pph_morning", name="PeoplePerHour morning proposals")
    scheduler.add_job(_safe("textbroker", textbroker_check),
                      CronTrigger(hour=8, minute=0, timezone=_ET),
                      id="textbroker_morning", name="Textbroker morning check")

    # --- Day (9:00-17:00 ET) ---
    scheduler.add_job(_safe("scripted", scripted_check),
                      CronTrigger(hour=9, minute=0, timezone=_ET),
                      id="scripted", name="Scripted articles")
    scheduler.add_job(_safe("contra", contra_apply),
                      CronTrigger(hour=10, minute=0, timezone=_ET),
                      id="contra", name="Contra applications")
    # Second round - Fiverr check
    scheduler.add_job(_safe("fiverr", fiverr_check),
                      CronTrigger(hour=11, minute=0, timezone=_ET),
                      id="fiverr_midday", name="Fiverr midday check")
    # Second round - proposals
    scheduler.add_job(_safe("freelancer", freelancer_propose),
                      CronTrigger(hour=13, minute=0, timezone=_ET),
                      id="freelancer_afternoon", name="Freelancer afternoon proposals")
    scheduler.add_job(_safe("peopleperhour", pph_propose),
                      CronTrigger(hour=14, minute=0, timezone=_ET),
                      id="pph_afternoon", name="PeoplePerHour afternoon proposals")

    # --- Evening (17:00-22:00 ET) ---
    scheduler.add_job(_safe("fiverr", fiverr_check),
                      CronTrigger(hour=17, minute=0, timezone=_ET),
                      id="fiverr_evening", name="Fiverr evening check")
    scheduler.add_job(_safe("textbroker", textbroker_check),
                      CronTrigger(hour=18, minute=0, timezone=_ET),
                      id="textbroker_evening", name="Textbroker evening check")
    scheduler.add_job(_safe("freelancer", freelancer_propose),
                      CronTrigger(hour=19, minute=0, timezone=_ET),
                      id="freelancer_evening", name="Freelancer evening proposals")

    # --- Daily report ---
    scheduler.add_job(task_daily_report,
                      CronTrigger(hour=21, minute=30, timezone=_ET),
                      id="daily_report", name="Daily report to Telegram")

    # --- 24/7 Inbox monitoring (every 30 minutes) ---
    scheduler.add_job(task_inbox_monitor, "interval", minutes=30,
                      id="inbox_monitor", name="Inbox monitor")

    return scheduler


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """Start Ryan Cole agent."""
    log.info("=" * 60)
    log.info("Ryan Cole — AI Content Strategist")
    log.info("Starting agent at %s ET", _now().strftime("%Y-%m-%d %H:%M"))
    log.info("Active platforms: %s", ", ".join(k for k, v in PLATFORMS.items() if v))
    log.info("=" * 60)

    init_db()
    send_alert("Ryan Cole agent started")

    scheduler = create_scheduler()
    log.info("Scheduled %d tasks:", len(scheduler.get_jobs()))
    for job in scheduler.get_jobs():
        log.info("  %s — %s", job.id, job.trigger)

    try:
        scheduler.start()
    except KeyboardInterrupt:
        log.info("Agent stopped by user")
        send_alert("Ryan Cole agent stopped")


if __name__ == "__main__":
    main()
