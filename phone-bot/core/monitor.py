"""Structured event logger for phone-bot.

Captures every significant bot event as structured JSON in JSONL files.
One file per day, 30-day rotation, buffered writes, rolling action trace
buffer for alert context.

Usage:
    from core.monitor import init_monitor, log_event, get_action_trace

    init_monitor(events_dir="data/events", screenshots_dir="data/screenshots")
    log_event(BotEvent(timestamp=..., phone_id=1, ...))
    trace = get_action_trace("session-id")
"""
import collections
import json
import logging
import os
import threading
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

# Event types that warrant a screenshot
_ALERT_EVENT_TYPES = {"captcha", "error", "device_lost", "popup"}


@dataclass
class BotEvent:
    """A single structured bot event."""
    timestamp: str          # ISO 8601
    phone_id: int
    account: str
    session_id: str
    event_type: str         # session_start, action, popup, captcha, error, device_lost
    action_type: str | None  # like, follow, scroll, comment, profile_visit, search
    behavioral_state: dict  # {energy, fatigue, boredom, phase}
    duration_ms: int | None
    success: bool
    metadata: dict


class EventLogger:
    """Thread-safe JSONL event logger with buffering and trace tracking."""

    def __init__(self, events_dir, screenshots_dir, retention_days=30, flush_every=10):
        self._events_dir = str(events_dir)
        self._screenshots_dir = str(screenshots_dir)
        self._retention_days = retention_days
        self._flush_every = flush_every

        # Buffered writes: list of (date_str, json_line) tuples
        self._buffer: list[tuple[str, str]] = []
        self._lock = threading.Lock()

        # Action trace: session_id -> deque(maxlen=10)
        self._traces: dict[str, collections.deque] = {}

        # Ensure directories exist
        os.makedirs(self._events_dir, exist_ok=True)
        os.makedirs(self._screenshots_dir, exist_ok=True)

    def log_event(self, event: BotEvent, screenshot_bytes: bytes | None = None):
        """Log a bot event. Optionally save a screenshot for alert events."""
        # Convert to dict, handling non-serializable metadata gracefully
        try:
            event_dict = asdict(event)
            # Test serialization early
            json_line = json.dumps(event_dict, default=str)
        except (TypeError, ValueError) as e:
            log.warning("Failed to serialize event: %s", e)
            # Fallback: replace metadata with error note
            event_dict = asdict(event)
            event_dict["metadata"] = {"_serialization_error": str(e)}
            json_line = json.dumps(event_dict, default=str)

        # Save screenshot for alert events
        if screenshot_bytes and event.event_type in _ALERT_EVENT_TYPES:
            screenshot_path = self._save_screenshot(event, screenshot_bytes)
            if screenshot_path:
                # Re-serialize with screenshot path
                event_dict["metadata"]["screenshot_path"] = screenshot_path
                json_line = json.dumps(event_dict, default=str)

        # Extract date from timestamp for file routing
        date_str = event.timestamp[:10]  # YYYY-MM-DD

        with self._lock:
            self._buffer.append((date_str, json_line))

            # Update action trace
            trace_entry = {
                "event_type": event.event_type,
                "action_type": event.action_type,
                "timestamp": event.timestamp,
                "success": event.success,
            }
            if event.session_id not in self._traces:
                self._traces[event.session_id] = collections.deque(maxlen=10)
            self._traces[event.session_id].append(trace_entry)

            # Auto-flush if buffer is full
            if len(self._buffer) >= self._flush_every:
                self._flush_unlocked()

    def get_action_trace(self, session_id: str) -> list[dict]:
        """Return copy of last N events for a session."""
        with self._lock:
            if session_id in self._traces:
                return list(self._traces[session_id])
            return []

    def clear_session_trace(self, session_id: str):
        """Remove trace buffer for a session."""
        with self._lock:
            self._traces.pop(session_id, None)

    def flush(self):
        """Flush buffered events to disk."""
        with self._lock:
            self._flush_unlocked()

    def _flush_unlocked(self):
        """Flush without acquiring lock (caller must hold lock)."""
        if not self._buffer:
            return

        # Group by date
        by_date: dict[str, list[str]] = {}
        for date_str, line in self._buffer:
            by_date.setdefault(date_str, []).append(line)
        self._buffer.clear()

        for date_str, lines in by_date.items():
            path = os.path.join(self._events_dir, f"{date_str}.jsonl")
            try:
                with open(path, "a", encoding="utf-8") as f:
                    for line in lines:
                        f.write(line + "\n")
            except (PermissionError, OSError) as e:
                log.warning("Failed to write events to %s: %s", path, e)

    def close(self):
        """Flush remaining events and clean up."""
        self.flush()

    def rotate_old_files(self):
        """Delete .jsonl files and screenshots older than retention_days."""
        cutoff = datetime.utcnow() - timedelta(days=self._retention_days)
        cutoff_str = cutoff.strftime("%Y-%m-%d")

        # Rotate JSONL event files
        try:
            for filename in os.listdir(self._events_dir):
                if not filename.endswith(".jsonl"):
                    continue
                # Extract date from filename (YYYY-MM-DD.jsonl)
                file_date = filename.replace(".jsonl", "")
                if file_date < cutoff_str:
                    filepath = os.path.join(self._events_dir, filename)
                    try:
                        os.remove(filepath)
                        log.info("Rotated old event log: %s", filename)
                    except OSError as e:
                        log.warning("Failed to rotate %s: %s", filename, e)
        except OSError as e:
            log.warning("Failed to list events dir for rotation: %s", e)

        # Rotate old screenshots (by file modification time)
        cutoff_ts = cutoff.timestamp()
        try:
            for filename in os.listdir(self._screenshots_dir):
                if not filename.endswith(".png"):
                    continue
                filepath = os.path.join(self._screenshots_dir, filename)
                try:
                    if os.path.getmtime(filepath) < cutoff_ts:
                        os.remove(filepath)
                        log.info("Rotated old screenshot: %s", filename)
                except OSError as e:
                    log.warning("Failed to rotate screenshot %s: %s", filename, e)
        except OSError as e:
            log.warning("Failed to list screenshots dir for rotation: %s", e)

    def _save_screenshot(self, event: BotEvent, screenshot_bytes: bytes) -> str | None:
        """Save screenshot PNG and return the file path."""
        try:
            ts_safe = event.timestamp.replace(":", "-").replace(".", "-")
            filename = f"{event.session_id}_{ts_safe}.png"
            filepath = os.path.join(self._screenshots_dir, filename)
            with open(filepath, "wb") as f:
                f.write(screenshot_bytes)
            return filepath
        except (OSError, PermissionError) as e:
            log.warning("Failed to save screenshot: %s", e)
            return None


# ── Module-level convenience API ──────────────────────────────

_default_logger: EventLogger | None = None


def init_monitor(events_dir, screenshots_dir, **kwargs):
    """Initialize the global event logger."""
    global _default_logger
    if _default_logger is not None:
        _default_logger.close()
    _default_logger = EventLogger(events_dir, screenshots_dir, **kwargs)
    return _default_logger


def log_event(event: BotEvent, screenshot_bytes: bytes | None = None):
    """Log an event via the global logger."""
    if _default_logger is None:
        log.warning("Monitor not initialized, event dropped: %s", event.event_type)
        return
    _default_logger.log_event(event, screenshot_bytes)


def get_action_trace(session_id: str) -> list[dict]:
    """Get action trace via the global logger."""
    if _default_logger is None:
        return []
    return _default_logger.get_action_trace(session_id)


def clear_session_trace(session_id: str):
    """Clear session trace via the global logger."""
    if _default_logger is not None:
        _default_logger.clear_session_trace(session_id)


def get_logger() -> EventLogger | None:
    """Return the global logger instance (for flush/close)."""
    return _default_logger
