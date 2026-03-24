"""
InterventionGate: thread-safe pre-post pause mechanism.

Blocks a phone-bot worker thread before posting, waiting for an external
resolve() signal (Telegram handler, dashboard HTTP, or timeout).
"""

import threading
import time
import logging
from typing import Optional, Dict, Any

log = logging.getLogger(__name__)


class InterventionGate:
    """
    Thread-safe gate that blocks a phone-bot worker thread before posting,
    waiting for an external resolve() signal (Telegram, dashboard, or timeout).

    Usage (worker thread):
        gate.request_pause(phone_id=2, reason="Warmup day 7 first post")
        decision = gate.check_and_wait(phone_id=2, timeout_s=1800)
        if decision == "approve":
            bot.post_video(...)

    Usage (Telegram handler or dashboard):
        gate.resolve(phone_id=2, decision="approve")
    """

    def __init__(self):
        self._pending: Dict[int, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def request_pause(self, phone_id: int, reason: str = "") -> None:
        """
        Register a pause request for phone_id.
        Replaces any existing pending entry for this phone.
        """
        with self._lock:
            self._pending[phone_id] = {
                "state": "pending",
                "reason": reason,
                "since": time.time(),
                "resolution": None,
                "_event": threading.Event(),
            }
        log.info("InterventionGate: pause requested for phone %d — %s", phone_id, reason)

    def check_and_wait(self, phone_id: int, timeout_s: float = 1800) -> str:
        """
        Block until resolve() is called or timeout_s elapses.
        Returns 'approve' | 'skip' | 'timeout'.
        """
        with self._lock:
            entry = self._pending.get(phone_id)
            if entry is None:
                return "timeout"
            event = entry["_event"]

        # Wait WITHOUT holding the lock
        event.wait(timeout=timeout_s)

        with self._lock:
            entry = self._pending.pop(phone_id, None)
            if entry is None:
                return "timeout"
            resolution = entry.get("resolution")
            if resolution is None:
                # Event timed out
                return "timeout"
            return resolution

    def resolve(self, phone_id: int, decision: str) -> None:
        """
        Resolve a pending pause with 'approve' or 'skip'.
        No-op if no pending state exists.
        """
        with self._lock:
            entry = self._pending.get(phone_id)
            if entry is None:
                return
            entry["resolution"] = decision
            entry["_event"].set()
        log.info("InterventionGate: phone %d resolved — %s", phone_id, decision)

    def get_pending(self, phone_id: int) -> Optional[Dict[str, Any]]:
        """Return a copy of the pending dict (without _event), or None."""
        with self._lock:
            entry = self._pending.get(phone_id)
            if entry is None:
                return None
            return {k: v for k, v in entry.items() if k != "_event"}

    def get_all_pending(self) -> Dict[int, Dict[str, Any]]:
        """Return a copy of all pending entries (without _event keys)."""
        with self._lock:
            return {
                pid: {k: v for k, v in entry.items() if k != "_event"}
                for pid, entry in self._pending.items()
            }


# --- Module-level singleton ---
_gate: Optional[InterventionGate] = None
_gate_lock = threading.Lock()


def get_gate() -> InterventionGate:
    """Return the module-level singleton InterventionGate (thread-safe)."""
    global _gate
    if _gate is None:
        with _gate_lock:
            if _gate is None:
                _gate = InterventionGate()
    return _gate
