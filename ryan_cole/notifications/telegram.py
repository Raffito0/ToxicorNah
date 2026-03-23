"""Telegram notifications — daily reports and alerts."""
import json
import logging
import urllib.request

from ..config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

log = logging.getLogger(__name__)


def send_message(text: str):
    """Send a Telegram message."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        log.debug("Telegram not configured, skipping notification")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
    }

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            log.debug("Telegram message sent")
    except Exception as e:
        log.warning("Telegram send failed: %s", e)


def send_daily_report(stats: dict):
    """Send the end-of-day summary report."""
    by_platform = stats.get("by_platform", {})
    lines = [f"<b>Daily Report — {stats['date']}</b>\n"]

    for platform, data in by_platform.items():
        orders = data.get("orders_completed", 0)
        proposals = data.get("proposals_sent", 0)
        replies = data.get("forum_replies", 0)
        revenue = data.get("revenue", 0)
        if orders or proposals or replies:
            lines.append(f"<b>{platform}</b>: {orders} orders, {proposals} proposals, {replies} replies — ${revenue:.0f}")

    lines.append(f"\n<b>Total: ${stats['total_revenue']:.0f}</b>")
    lines.append(f"Orders: {stats['total_orders']} | Proposals: {stats['total_proposals']} | Replies: {stats['total_replies']}")

    send_message("\n".join(lines))


def send_alert(message: str):
    """Send an alert notification (new order, error, etc.)."""
    send_message(f"⚡ {message}")


def send_new_order_alert(platform: str, client: str, title: str, price: float):
    """Alert when a new order comes in."""
    send_message(
        f"<b>New Order!</b>\n"
        f"Platform: {platform}\n"
        f"Client: {client}\n"
        f"Title: {title}\n"
        f"Price: ${price:.2f}"
    )
