"""TunnelManager: singleton for cloudflared Quick Tunnel lifecycle."""
import logging
import os
import re
import subprocess
import sys
import threading
from typing import Optional

logger = logging.getLogger(__name__)

FLASK_PORT = 1090  # NEVER change to 8000 -- ws-scrcpy has no auth


class TunnelManager:
    """Manages a cloudflared Quick Tunnel subprocess."""

    def __init__(self, local_port: int = FLASK_PORT):
        self._port = local_port
        self._process: Optional[subprocess.Popen] = None
        self._url: Optional[str] = None
        self._lock = threading.Lock()
        self._stderr_thread: Optional[threading.Thread] = None

    def start(self) -> bool:
        """Launch cloudflared tunnel pointing at Flask. Returns True if started."""
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                return False

            cloudflared = os.environ.get('CLOUDFLARED_PATH', 'cloudflared')
            self._url = None
            self._process = subprocess.Popen(
                [cloudflared, 'tunnel', '--url', f'http://localhost:{self._port}'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            logger.info("cloudflared started (PID %d), tunneling port %d",
                        self._process.pid, self._port)

            self._stderr_thread = threading.Thread(
                target=self._read_stderr, daemon=True)
            self._stderr_thread.start()
            return True

    def stop(self) -> None:
        """Terminate the cloudflared process."""
        with self._lock:
            if self._process is None:
                return
            if sys.platform == 'win32':
                subprocess.run(
                    ['taskkill', '/F', '/PID', str(self._process.pid)],
                    capture_output=True,
                )
            else:
                self._process.terminate()
            self._process = None
            self._url = None
            logger.info("cloudflared stopped")

    def is_running(self) -> bool:
        """Return True if cloudflared subprocess is alive."""
        with self._lock:
            return self._process is not None and self._process.poll() is None

    def get_url(self) -> Optional[str]:
        """Return the current tunnel URL, or None."""
        with self._lock:
            return self._url

    def _read_stderr(self) -> None:
        """Background thread: read cloudflared stderr and parse URL."""
        proc = self._process
        if proc is None or proc.stderr is None:
            return
        for line in iter(proc.stderr.readline, ''):
            if not line:
                break
            url = self._parse_url(line)
            if url:
                with self._lock:
                    self._url = url
                logger.info("Tunnel URL: %s", url)
                self._notify_telegram(url)

    @staticmethod
    def _parse_url(line: str) -> Optional[str]:
        """Extract trycloudflare.com URL from a cloudflared stderr line."""
        match = re.search(r'https://[a-z0-9\-]+\.trycloudflare\.com', line)
        return match.group(0) if match else None

    def _notify_telegram(self, url: str) -> None:
        """Best-effort Telegram notification of new tunnel URL."""
        token = os.environ.get('PHONEBOT_TELEGRAM_TOKEN')
        chat_id = os.environ.get('PHONEBOT_TELEGRAM_CHAT_ID', '-1003628617587')
        if not token:
            logger.warning("No PHONEBOT_TELEGRAM_TOKEN — skipping tunnel notification")
            return
        try:
            import urllib.request
            import json
            data = json.dumps({
                'chat_id': chat_id,
                'text': f'Tunnel active: {url}',
                'parse_mode': 'HTML',
            }).encode()
            req = urllib.request.Request(
                f'https://api.telegram.org/bot{token}/sendMessage',
                data=data,
                headers={'Content-Type': 'application/json'},
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            logger.warning("Telegram notification failed: %s", e)


# Module-level singleton
_manager: Optional[TunnelManager] = None


def get_manager() -> TunnelManager:
    """Return the shared TunnelManager singleton."""
    global _manager
    if _manager is None:
        _manager = TunnelManager(local_port=FLASK_PORT)
    return _manager
