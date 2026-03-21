"""Production monitoring via Telegram — session lifecycle, post outcomes, stock alerts, daily summary.

Distinct from telegram_alerts.py (FORGE dev alerts) — this module handles structured
production events between sessions. Sends are synchronous and blocking (0.5-2s) since
they only happen between sessions, never during UI interaction.

Usage:
    from core.telegram_monitor import init_monitor, get_monitor

    init_monitor()  # call once at process start, reads env vars

    monitor = get_monitor()
    monitor.session_start(phone_id=2, account="ph2_tiktok", ...)
    monitor.session_result(phone_id=2, account="ph2_tiktok", success=True, ...)
"""
import json
import logging
import os
import time
import urllib.request
import urllib.error
from dataclasses import dataclass

log = logging.getLogger(__name__)

_TELEGRAM_API = "https://api.telegram.org/bot{token}/{method}"
_LOW_STOCK_THRESHOLD = 14


@dataclass
class DailySummary:
    """Aggregated stats for the daily summary message."""
    sessions_completed: int
    sessions_total: int
    posts_tiktok: int
    posts_instagram: int
    drafts: int
    skipped: int
    errors: int
    stock_by_phone: dict  # {phone_id: pending_count}


def _html_escape(text: str) -> str:
    """Escape < > & for Telegram HTML parse mode. Apostrophes and quotes are left as-is."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class TelegramMonitor:
    """Structured production event monitor. Sends HTML messages to a Telegram chat."""

    def __init__(self, token: str, chat_id: str):
        self._token = token
        self._chat_id = chat_id

    def configured(self) -> bool:
        """Return True only when both token and chat_id are non-empty."""
        return bool(self._token) and bool(self._chat_id)

    def send(self, text: str) -> bool:
        """Send an HTML message. Handles 429 (retry_after) once. Returns True on success."""
        if not self.configured():
            return False

        url = _TELEGRAM_API.format(token=self._token, method="sendMessage")
        payload = json.dumps({
            "chat_id": self._chat_id,
            "text": text,
            "parse_mode": "HTML",
        }).encode("utf-8")
        headers = {"Content-Type": "application/json"}

        for attempt in range(2):
            try:
                req = urllib.request.Request(url, data=payload, headers=headers)
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return True
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt == 0:
                    # Rate limited — parse retry_after
                    retry_after = 5  # default
                    try:
                        body = json.loads(e.read().decode("utf-8"))
                        retry_after = min(body.get("parameters", {}).get("retry_after", 5), 30)
                    except Exception:
                        pass
                    log.warning("Telegram 429 rate limit — sleeping %ds", retry_after)
                    time.sleep(retry_after)
                    continue
                log.warning("Telegram send failed (HTTP %d): %s", e.code, e.reason)
                return False
            except Exception as e:
                log.warning("Telegram send failed: %s", e)
                return False

        return False

    def session_start(self, phone_id: int, account: str, session_type: str,
                      post_scheduled: bool, platform: str = "") -> None:
        """Send session start notification."""
        if not self.configured():
            return
        plat = platform.upper() if platform else account.split("_")[-1].upper()
        post_status = "scheduled" if post_scheduled else "none"
        msg = (
            f"\U0001f4f1 <b>Phone {phone_id}</b> {plat}\n"
            f"Session started | Type: {_html_escape(session_type)} | Post: {post_status}"
        )
        self.send(msg)

    def session_result(self, phone_id: int, account: str, success: bool,
                       post_outcome: str = None, video_name: str = None,
                       duration_minutes: float = 0, error_reason: str = None) -> None:
        """Send session completion notification."""
        if not self.configured():
            return
        plat = account.split("_")[-1].upper() if account else ""
        dur = f"{duration_minutes:.0f}m"

        if success:
            parts = [f"\u2705 <b>Phone {phone_id}</b> {plat} | DONE"]
            if post_outcome and post_outcome != "none":
                parts.append(f"Post: {_html_escape(post_outcome)}")
            if video_name:
                parts.append(f"Video: {_html_escape(video_name)}")
            parts.append(f"Duration: {dur}")
            msg = " | ".join(parts)
        else:
            reason = _html_escape(error_reason) if error_reason else "unknown"
            msg = f"\u274c <b>Phone {phone_id}</b> {plat} | ERROR | Reason: {reason} | Duration: {dur}"

        self.send(msg)

    def post_failure(self, phone_id: int, account: str, retries: int,
                     outcome: str, video_name: str) -> None:
        """Send critical post failure notification."""
        if not self.configured():
            return
        plat = account.split("_")[-1].upper() if account else ""
        outcome_text = "Saved as draft" if outcome == "draft" else "FAILED completely"
        msg = (
            f"\U0001f6a8 <b>POST FAILED</b> | Phone {phone_id} {plat}\n"
            f"After {retries} retries | {outcome_text}\n"
            f"Video: {_html_escape(video_name)}"
        )
        self.send(msg)

    def stock_alert(self, phone_id: int, count: int, critical: bool = False) -> None:
        """Send stock warning for a phone below threshold."""
        if not self.configured():
            return
        if critical:
            msg = (
                f"\U0001f6a8 <b>STOCK EMPTY</b> | Phone {phone_id}: 0 videos remaining\n"
                f"Sessions running in scroll-only mode today"
            )
        else:
            msg = (
                f"\u26a0\ufe0f <b>LOW STOCK</b> | Phone {phone_id}: {count} videos remaining "
                f"(need {_LOW_STOCK_THRESHOLD})\n"
                f"Posting will skip if 0"
            )
        self.send(msg)

    def daily_summary(self, summary: DailySummary) -> None:
        """Send end-of-day summary message."""
        if not self.configured():
            return

        stock_parts = []
        for pid, cnt in sorted(summary.stock_by_phone.items()):
            warn = " \u26a0\ufe0f" if cnt < _LOW_STOCK_THRESHOLD else ""
            stock_parts.append(f"Ph{pid}={cnt}{warn}")
        stock_line = ", ".join(stock_parts) if stock_parts else "N/A"

        extras = []
        if summary.drafts:
            extras.append(f"{summary.drafts} draft")
        if summary.skipped:
            extras.append(f"{summary.skipped} skipped")
        extras_text = f" ({', '.join(extras)})" if extras else ""

        msg = (
            f"\U0001f4ca <b>Daily Summary</b>\n"
            f"Sessions: {summary.sessions_completed}/{summary.sessions_total} completed\n"
            f"Posts: {summary.posts_tiktok} TikTok + {summary.posts_instagram} IG{extras_text}\n"
            f"Errors: {summary.errors}\n"
            f"Stock: {stock_line}"
        )
        self.send(msg)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_monitor: TelegramMonitor = None


def init_monitor() -> TelegramMonitor:
    """Initialise global monitor from env vars. Warns if unconfigured. Returns instance."""
    global _monitor
    token = os.getenv("PHONEBOT_TELEGRAM_TOKEN", "")
    chat_id = os.getenv("PHONEBOT_TELEGRAM_CHAT", "")
    _monitor = TelegramMonitor(token, chat_id)
    if not _monitor.configured():
        log.info("Telegram production monitor not configured (missing PHONEBOT_TELEGRAM_TOKEN or PHONEBOT_TELEGRAM_CHAT)")
    return _monitor


def get_monitor() -> TelegramMonitor:
    """Return global monitor instance. Auto-initializes if needed."""
    global _monitor
    if _monitor is None:
        _monitor = init_monitor()
    return _monitor
