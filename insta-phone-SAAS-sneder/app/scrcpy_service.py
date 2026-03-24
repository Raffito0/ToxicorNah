"""ScrcpyManager: singleton for ws-scrcpy Node.js subprocess lifecycle."""
import logging
import os
import platform
import subprocess
import threading

logger = logging.getLogger(__name__)


class ScrcpyManager:
    """Manages the ws-scrcpy Node.js subprocess lifecycle."""

    def __init__(self, port: int = None):
        self._port = port or int(os.environ.get('WS_SCRCPY_PORT', '8000'))
        self._ws_scrcpy_dir = os.environ.get('WS_SCRCPY_DIR', r'C:\ws-scrcpy')
        self._process = None
        self._lock = threading.Lock()
        self._should_watch = False
        self._stop_event = threading.Event()
        self._watchdog_thread = None

    def start(self) -> bool:
        """Launch 'node index.js'. No-op if already running. Returns True if started."""
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                return False  # already running

            self._process = subprocess.Popen(
                ['node', 'index.js'],
                cwd=self._ws_scrcpy_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            logger.info("ws-scrcpy started on port %d (PID %d)", self._port, self._process.pid)

            # Start watchdog
            self._should_watch = True
            self._stop_event.clear()
            self._watchdog_thread = threading.Thread(target=self._watchdog, daemon=True)
            self._watchdog_thread.start()

            return True

    def stop(self) -> None:
        """Terminate the ws-scrcpy process. Uses taskkill on Windows."""
        with self._lock:
            self._should_watch = False
            self._stop_event.set()

            if self._process is None:
                return

            if platform.system() == 'Windows':
                subprocess.run(
                    ['taskkill', '/F', '/T', '/PID', str(self._process.pid)],
                    capture_output=True,
                )
            else:
                self._process.terminate()

            self._process = None
            logger.info("ws-scrcpy stopped")

    def is_running(self) -> bool:
        """Return True if process exists and is alive."""
        with self._lock:
            return self._process is not None and self._process.poll() is None

    def get_url(self):
        """Return localhost URL if running, else None."""
        if self.is_running():
            return f'http://localhost:{self._port}'
        return None

    def _watchdog(self) -> None:
        """Daemon thread: restart ws-scrcpy if it crashes."""
        while not self._stop_event.wait(timeout=30):
            if not self.is_running() and self._should_watch:
                logger.warning("ws-scrcpy crashed, restarting...")
                self.start()


# Module-level singleton
scrcpy_manager = ScrcpyManager()
