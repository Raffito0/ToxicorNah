# Section 04: Telegram Production Monitor

**Depends on**: section-03-post-retry (executor.py must have `_post_with_retry()` in place so session outcomes include post result codes)

**Blocks**: section-05-stock-monitor (stock alert method must exist in `telegram_monitor.py` before wiring stock check)

---

## Background

The existing `phone-bot/core/telegram_alerts.py` handles FORGE development-time critical alerts (device lost, UHID failure, session timeout). It uses rate-limiting per phone (5-minute cooldown) and fire-and-forget background threads — intentionally designed so individual alerts don't block UI automation.

Production monitoring has different requirements: structured session lifecycle events, post outcome reports, daily summaries, and stock warnings. These messages go **between sessions** (never during UI interaction), so blocking HTTP calls are acceptable. A separate module keeps production monitoring semantically distinct from the FORGE-era alert bot.

**Parse mode decision**: HTML, not MarkdownV2. HTML only requires escaping `<`, `>`, and `&`. MarkdownV2 requires escaping 18+ characters — any special character in a video name or caption causes a silent 400 error that drops critical alerts without any log entry.

---

## Tests First

File: `phone-bot/tests/test_telegram_monitor.py`

Write these tests before implementing `telegram_monitor.py`.

```python
# test_telegram_monitor.py

# Test: monitor.send() constructs correct Telegram API POST request (HTML parse mode)
#   → mock urllib.request.urlopen, verify payload has parse_mode="HTML"

# Test: monitor.session_start() sends message containing phone name, platform, session type, post_scheduled
#   → verify message text includes "Phone 2", "tiktok", "normal", "scheduled"

# Test: monitor.session_result() sends success message with duration and post outcome
#   → mock successful session, verify ✅ prefix and "Posted" in message

# Test: monitor.session_result() sends error message with reason when session fails
#   → mock failed session, verify ❌ prefix and reason in message

# Test: monitor.post_failure() sends 🚨 message with retry count and draft/failed status
#   → verify message contains "POST FAILED", retry count, and outcome

# Test: monitor.stock_alert() sends ⚠️ message listing phones with stock < 14
#   → pass stock={1: 3, 2: 15, 3: 0}, verify only Phone 1 and Phone 3 appear

# Test: monitor.daily_summary() sends summary with session count, post counts, error count, stock levels
#   → construct DailySummary dataclass, verify all fields present in output

# Test: monitor handles 429 rate limit by sleeping retry_after seconds and retrying once
#   → mock first call returns 429 with retry_after=2, second call returns 200
#   → verify total calls == 2 and sleep was called with value >= 2

# Test: _html_escape() escapes < > & characters correctly
#   → assert _html_escape("<b>&foo</b>") == "&lt;b&gt;&amp;foo&lt;/b&gt;"

# Test: _html_escape() does NOT escape apostrophes or quotes (HTML mode is lenient)
#   → assert _html_escape("it's fine") == "it's fine"

# Test: monitor does nothing when PHONEBOT_TELEGRAM_TOKEN is not set (graceful no-op)
#   → construct TelegramMonitor with token="" and verify send() returns without error
```

---

## Implementation

### New file: `phone-bot/core/telegram_monitor.py`

Create a singleton production monitor class. The module exports a single global instance and convenience functions matching the existing `telegram_alerts.py` pattern.

```python
# phone-bot/core/telegram_monitor.py
"""Production monitoring via Telegram — session lifecycle, post outcomes, stock alerts, daily summary.

Distinct from telegram_alerts.py (FORGE dev alerts) — this module handles structured
production events between sessions. Sends are synchronous and blocking (0.5-2s) since
they only happen between sessions, never during UI interaction.

Usage:
    from core.telegram_monitor import init_monitor, get_monitor

    init_monitor()  # call once at process start, reads env vars

    monitor = get_monitor()
    monitor.session_start(phone_id=2, account="ph2_tiktok", session_type="normal", post_scheduled=True)
    monitor.session_result(phone_id=2, account="ph2_tiktok", success=True,
                           post_outcome="posted", video_name="...", duration_minutes=18)
    monitor.post_failure(phone_id=2, account="ph2_tiktok", retries=2,
                         outcome="draft", video_name="scenario_name")
    monitor.stock_alert(phone_id=2, count=3, critical=False)
    monitor.daily_summary(summary)
"""
import logging
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


class TelegramMonitor:
    """Structured production event monitor. Sends HTML messages to a Telegram chat."""

    def __init__(self, token: str, chat_id: str):
        """Initialise with bot token and chat id. Empty strings = no-op mode."""
        ...

    def configured(self) -> bool:
        """Return True only when both token and chat_id are non-empty."""
        ...

    def send(self, text: str) -> bool:
        """Send an HTML message. Handles 429 (retry_after) once. Returns True on success."""
        ...

    def session_start(self, phone_id: int, account: str, session_type: str,
                      post_scheduled: bool, platform: str = "") -> None:
        """Send session start notification.

        Message format: "📱 Phone {N} {PLATFORM} | Session started | Type: {type} | Post: scheduled/none"
        """
        ...

    def session_result(self, phone_id: int, account: str, success: bool,
                       post_outcome: str | None, video_name: str | None,
                       duration_minutes: float, error_reason: str | None = None) -> None:
        """Send session completion notification.

        Success format: "✅ Phone {N} {PLATFORM} | DONE | Posted: {video_name} | Duration: {N}m"
        Failure format: "❌ Phone {N} {PLATFORM} | ERROR | Reason: {reason} | Duration: {N}m"
        """
        ...

    def post_failure(self, phone_id: int, account: str, retries: int,
                     outcome: str, video_name: str) -> None:
        """Send critical post failure notification.

        Format: "🚨 POST FAILED | Phone {N} {PLATFORM} | After {N} retries | Saved as draft | Video: {name}"
        outcome: "draft" | "failed" (determines last phrase)
        """
        ...

    def stock_alert(self, phone_id: int, count: int, critical: bool = False) -> None:
        """Send stock warning for a phone below threshold.

        Non-critical (stock 1-13):
          "⚠️ LOW STOCK | Phone {N}: {count} videos remaining (need 14) | Posting will skip if 0"

        Critical (stock=0):
          "🚨 STOCK EMPTY | Phone {N}: 0 videos remaining | Sessions running in scroll-only mode today"
        """
        ...

    def daily_summary(self, summary: DailySummary) -> None:
        """Send end-of-day summary message.

        Format:
            📊 Daily Summary
            Sessions: 12/12 completed
            Posts: 5 TikTok + 5 IG (1 draft, 1 skipped)
            Errors: 0
            Stock: Ph1=12, Ph2=8 ⚠️, Ph3=14
        """
        ...


def _html_escape(text: str) -> str:
    """Escape < > & for Telegram HTML parse mode. Apostrophes and quotes are left as-is."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


_monitor: TelegramMonitor | None = None


def init_monitor() -> TelegramMonitor:
    """Initialise global monitor from env vars. Warns if unconfigured. Returns instance."""
    ...


def get_monitor() -> TelegramMonitor:
    """Return global monitor instance. Raises RuntimeError if init_monitor() not called."""
    ...
```

**Key implementation notes**:

- `send()` calls `urllib.request.urlopen` synchronously. Blocks 0.5-2s but only happens between sessions.
- **429 handling**: parse the response body for `{"parameters": {"retry_after": N}}`. Sleep `N` seconds (capped at 30). Retry once. If retry also fails, log warning and return `False`. Do not raise.
- If `not self.configured()`, all methods return immediately without logging (silent no-op).
- `_html_escape` must run on any user-supplied string before embedding in a message: `video_name`, `error_reason`, caption text.

---

### Modify: `phone-bot/config.py`

Add a `TELEGRAM_MONITOR` config dict after the existing Telegram config block. The existing `TELEGRAM_ALERT_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID` remain for backward compatibility with `telegram_alerts.py`.

```python
# --- Telegram Production Monitor ----------------------------------------------
TELEGRAM_MONITOR = {
    "token": TELEGRAM_ALERT_BOT_TOKEN,  # reuses PHONEBOT_TELEGRAM_TOKEN env var
    "chat_id": TELEGRAM_ALERT_CHAT_ID,  # reuses PHONEBOT_TELEGRAM_CHAT env var
}
```

---

### Modify: `phone-bot/planner/executor.py`

Wire the monitor into the session lifecycle.

**Import** (add alongside existing telegram_alerts import):
```python
from ..core.telegram_monitor import init_monitor as init_prod_monitor, get_monitor as prod_monitor
```

**In `SessionExecutor.__init__`** (or wherever `init_alerts()` is called at startup):
```python
init_prod_monitor()  # reads same env vars, no-op if unconfigured
```

**4 integration points**:

1. **Session start** — at top of `_execute_session()` after account/session_id established:
   ```python
   prod_monitor().session_start(
       phone_id=phone_id, account=account,
       session_type=session_type, post_scheduled=post_scheduled, platform=platform,
   )
   ```

2. **Session result** — in the `finally`/completion block of `_execute_session()`:
   ```python
   prod_monitor().session_result(
       phone_id=phone_id, account=account,
       success=result not in ("error", "device_lost", "timeout"),
       post_outcome=post_outcome, video_name=video_name,
       duration_minutes=elapsed / 60, error_reason=error_reason,
   )
   ```

3. **Post failure** — inside `_post_with_retry()` when both retries fail:
   ```python
   prod_monitor().post_failure(
       phone_id=phone_id, account=account, retries=2,
       outcome=draft_result, video_name=video_name,
   )
   ```

4. **Daily summary** — at end of `run_today()` after last session completes:
   ```python
   prod_monitor().daily_summary(DailySummary(
       sessions_completed=completed_count,
       sessions_total=total_sessions,
       posts_tiktok=tiktok_post_count,
       posts_instagram=ig_post_count,
       drafts=draft_count,
       skipped=skipped_count,
       errors=error_count,
       stock_by_phone=stock_snapshot,  # {} until section-05 adds check_content_stock()
   ))
   ```
   Add local accumulators (`completed_count`, `tiktok_post_count`, etc.) to `run_today()`'s local scope, incremented as sessions complete.

---

## File Summary

| Action | File |
|--------|------|
| Create | `phone-bot/core/telegram_monitor.py` |
| Create | `phone-bot/tests/test_telegram_monitor.py` |
| Modify | `phone-bot/config.py` — add `TELEGRAM_MONITOR` dict |
| Modify | `phone-bot/planner/executor.py` — import + wire 4 monitor call sites |

---

## Acceptance Criteria

- [ ] `pytest phone-bot/tests/test_telegram_monitor.py -v` — all 11 tests pass
- [ ] When `PHONEBOT_TELEGRAM_TOKEN` is unset, all monitor methods return silently without error
- [ ] When token is set, a real Telegram message is received for each of the 5 message types (manual verification)
- [ ] 429 responses handled: bot sleeps `retry_after` seconds and retries once before giving up
- [ ] HTML special characters in video names do not cause 400 errors
- [ ] `telegram_alerts.py` (FORGE dev alerts) is unchanged — no regressions to existing alert behavior
