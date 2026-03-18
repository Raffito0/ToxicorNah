"""Telegram alert bot for phone-bot critical events.

Two modes:
- Fire-and-forget: informational alerts sent in background thread
- Interactive: inline keyboard (SOLVED/SKIP/ABORT) with callback polling for Tier 2

Usage:
    from core.telegram_alerts import init_alerts, send_alert, send_interactive_alert

    init_alerts()  # reads env vars, warns if missing
    send_alert(phone_id=1, account="ph1_tiktok", message="Device lost")
    result = send_interactive_alert(phone_id=1, ..., message="Popup needs help")
"""
import json
import logging
import threading
import time
import urllib.request
import urllib.parse
import urllib.error

log = logging.getLogger(__name__)

_BASE_URL = "https://api.telegram.org/bot{token}/{method}"


class AlertBot:
    """Telegram alert bot with rate limiting and callback polling."""

    def __init__(self, token: str, chat_id: str, rate_limit_seconds: float = 300.0):
        self._token = token
        self._chat_id = chat_id
        self._rate_limit_seconds = rate_limit_seconds
        self._last_alert_time: dict[int, float] = {}  # phone_id -> timestamp
        self._update_offset = 0  # for getUpdates long polling

    def configured(self) -> bool:
        """Return True if token and chat_id are set."""
        return bool(self._token) and bool(self._chat_id)

    # --- HTTP helper -------------------------------------------------------

    def _http_post(self, url: str, payload: dict = None, files: dict = None) -> dict:
        """POST to Telegram API. Returns parsed JSON response."""
        if payload and not files:
            data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(url, data=data, method='POST')
            req.add_header('Content-Type', 'application/json')
        elif files:
            # Multipart form data for photo upload
            boundary = '----FormBoundary' + str(int(time.time() * 1000))
            body = b''
            # Add text fields
            if payload:
                for key, val in payload.items():
                    body += f'--{boundary}\r\n'.encode()
                    body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
                    body += f'{val}\r\n'.encode()
            # Add file
            for field_name, (filename, filedata, content_type) in files.items():
                body += f'--{boundary}\r\n'.encode()
                body += f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode()
                body += f'Content-Type: {content_type}\r\n\r\n'.encode()
                body += filedata
                body += b'\r\n'
            body += f'--{boundary}--\r\n'.encode()
            req = urllib.request.Request(url, data=body, method='POST')
            req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
        else:
            req = urllib.request.Request(url, data=b'', method='POST')

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            log.warning("Telegram API error (check connection)")
            return {"ok": False, "error": str(e)}

    def _api_url(self, method: str) -> str:
        """Build Telegram API URL."""
        return _BASE_URL.format(token=self._token, method=method)

    # --- Message formatting ------------------------------------------------

    def _format_message(self, phone_id: int, account: str, message: str,
                        action_trace: list | None = None) -> str:
        """Format alert message with context."""
        lines = [
            f"Phone {phone_id} | {account}",
            f"\n{message}",
        ]
        if action_trace:
            lines.append("\nLast actions:")
            for entry in action_trace[-5:]:  # last 5
                action = entry.get("action_type", entry.get("event_type", "?"))
                ts = entry.get("timestamp", "")
                ts_short = ts[11:19] if len(ts) > 19 else ts  # HH:MM:SS
                lines.append(f"  {ts_short} {action}")
        return "\n".join(lines)

    # --- Fire-and-forget ---------------------------------------------------

    def send_alert(self, phone_id: int, account: str, message: str,
                   screenshot_bytes: bytes | None = None,
                   action_trace: list | None = None):
        """Send alert in background thread (non-blocking)."""
        if not self.configured():
            return
        t = threading.Thread(
            target=self._send_alert_safe,
            args=(phone_id, account, message, screenshot_bytes, action_trace),
            daemon=True,
        )
        t.start()

    def _send_alert_safe(self, *args, **kwargs):
        """Wrapper that catches all exceptions."""
        try:
            self._send_alert_sync(*args, **kwargs)
        except Exception as e:
            log.warning("Alert send failed: %s", e)

    def _send_alert_sync(self, phone_id: int, account: str, message: str,
                         screenshot_bytes: bytes | None = None,
                         action_trace: list | None = None):
        """Send alert synchronously with rate limiting."""
        if not self.configured():
            return

        # Rate limiting: suppress if same phone within cooldown
        now = time.time()
        last = self._last_alert_time.get(phone_id, 0)
        if now - last < self._rate_limit_seconds:
            log.debug("Alert suppressed for phone %d (rate limited)", phone_id)
            return

        text = self._format_message(phone_id, account, message, action_trace)

        if screenshot_bytes:
            self._http_post(
                self._api_url("sendPhoto"),
                payload={"chat_id": self._chat_id, "caption": text[:1024]},
                files={"photo": ("screenshot.png", screenshot_bytes, "image/png")},
            )
        else:
            self._http_post(
                self._api_url("sendMessage"),
                payload={"chat_id": self._chat_id, "text": text, "parse_mode": "HTML"},
            )

        # Set rate limit AFTER successful send
        self._last_alert_time[phone_id] = time.time()

    # --- Interactive (Tier 2) ----------------------------------------------

    def send_interactive_alert_sync(self, phone_id: int, account: str,
                                    session_id: str, message: str,
                                    screenshot_bytes: bytes | None = None,
                                    action_trace: list | None = None,
                                    timeout_s: float = 300.0) -> str | None:
        """Send interactive alert and poll for callback. Blocks up to timeout_s.
        Returns: 'SOLVED', 'SKIP', 'ABORT', or None on timeout."""
        if not self.configured():
            return None

        text = self._format_message(phone_id, account, message, action_trace)

        # Build inline keyboard
        buttons = []
        for action in ["SOLVED", "SKIP", "ABORT"]:
            buttons.append({
                "text": action,
                "callback_data": f"{action}:{phone_id}:{session_id}",
            })
        reply_markup = json.dumps({"inline_keyboard": [buttons]})

        payload = {
            "chat_id": self._chat_id,
            "text": text,
            "parse_mode": "HTML",
            "reply_markup": reply_markup,
        }

        resp = self._http_post(self._api_url("sendMessage"), payload=payload)
        if not resp.get("ok"):
            log.warning("Failed to send interactive alert: %s", resp)
            return None

        # Poll for callback
        return self._poll_callback(phone_id, session_id, timeout_s)

    def _poll_callback(self, phone_id: int, session_id: str,
                       timeout_s: float = 300.0) -> str | None:
        """Poll getUpdates for matching callback_query. Returns action or None."""
        deadline = time.time() + timeout_s
        poll_interval = min(10, timeout_s)  # 10s long poll, or less for short timeouts

        while time.time() < deadline:
            remaining = deadline - time.time()
            if remaining <= 0:
                break

            params = {
                "offset": self._update_offset,
                "timeout": int(min(poll_interval, remaining)),
                "allowed_updates": json.dumps(["callback_query"]),
            }
            url = self._api_url("getUpdates") + "?" + urllib.parse.urlencode(params)

            try:
                resp = self._http_post(url)
            except Exception as e:
                log.warning("getUpdates failed: %s", e)
                time.sleep(1)
                continue

            if not resp.get("ok"):
                time.sleep(1)
                continue

            for update in resp.get("result", []):
                # Always advance offset
                self._update_offset = update["update_id"] + 1

                cb = update.get("callback_query")
                if not cb:
                    continue

                data = cb.get("data", "")
                parts = data.split(":")
                if len(parts) != 3:
                    continue

                action, cb_phone, cb_session = parts[0], parts[1], parts[2]

                if cb_phone == str(phone_id) and cb_session == session_id:
                    # Answer the callback
                    self._http_post(
                        self._api_url("answerCallbackQuery"),
                        payload={"callback_query_id": cb["id"], "text": f"{action} acknowledged"},
                    )
                    return action

        return None


# ── Module-level convenience API ──────────────────────────────

_default_bot: AlertBot | None = None


def init_alerts():
    """Initialize the global alert bot from config (env vars)."""
    global _default_bot
    try:
        from .. import config as _cfg
        token = _cfg.TELEGRAM_ALERT_BOT_TOKEN
        chat_id = _cfg.TELEGRAM_ALERT_CHAT_ID
    except (ImportError, AttributeError):
        import os
        token = os.getenv("PHONEBOT_TELEGRAM_TOKEN", "")
        chat_id = os.getenv("PHONEBOT_TELEGRAM_CHAT", "")
    _default_bot = AlertBot(token=token, chat_id=chat_id)
    if not _default_bot.configured():
        log.warning("Telegram alerts NOT configured (missing PHONEBOT_TELEGRAM_TOKEN or PHONEBOT_TELEGRAM_CHAT)")
    return _default_bot


def configured() -> bool:
    """Check if alerts are configured."""
    return _default_bot is not None and _default_bot.configured()


def send_alert(phone_id: int, account: str, message: str,
               screenshot_bytes: bytes | None = None,
               action_trace: list | None = None):
    """Send fire-and-forget alert via global bot."""
    if _default_bot is None:
        return
    _default_bot.send_alert(phone_id, account, message, screenshot_bytes, action_trace)


def send_interactive_alert(phone_id: int, account: str, session_id: str,
                           message: str, screenshot_bytes: bytes | None = None,
                           action_trace: list | None = None,
                           timeout_s: float = 300.0) -> str | None:
    """Send interactive alert via global bot. Blocks up to timeout_s."""
    if _default_bot is None:
        return None
    return _default_bot.send_interactive_alert_sync(
        phone_id, account, session_id, message, screenshot_bytes, action_trace, timeout_s,
    )
