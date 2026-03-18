# Section 07: Structured Event Logger

## Overview

New module `core/monitor.py` captures every significant bot event as structured JSON. JSONL files per day, 30-day rotation, buffered writes, rolling action trace buffer for alert messages.

**Dependencies:** Section 06 (behavioral state fields must exist).
**Blocks:** Section 08 (Telegram alerts read from monitor).
**Files:** `core/monitor.py` (NEW), `config.py`, `actions/tiktok.py`, `planner/executor.py`, `tests/test_monitor.py` (NEW)

---

## Tests First (tests/test_monitor.py)

```python
# --- Event Schema ---
# Test: log_event writes JSON line to YYYY-MM-DD.jsonl file
# Test: event contains all required fields (timestamp, phone_id, account, session_id, event_type, behavioral_state)
# Test: behavioral_state has energy, fatigue, boredom, phase
# Test: metadata dict preserved in event

# --- JSONL Format ---
# Test: multiple events as separate lines in same file
# Test: events across midnight create new file

# --- File Rotation ---
# Test: rotation deletes files older than 30 days
# Test: rotation only deletes .jsonl files

# --- Screenshots ---
# Test: screenshot saved for alert events with path in metadata
# Test: no screenshot for non-alert events

# --- Buffered Write ---
# Test: buffered (flush every 10 events)
# Test: flush on explicit call
# Test: flush on close/shutdown

# --- Graceful Failure ---
# Test: disk full / permission denied -> warning, no crash
# Test: non-serializable metadata -> no crash

# --- Action Trace Buffer ---
# Test: rolling buffer keeps last 10 events per session
# Test: separate sessions have separate traces
# Test: trace cleared on session end
```

---

## Implementation Details

### BotEvent Dataclass

```python
@dataclass
class BotEvent:
    timestamp: str          # ISO 8601
    phone_id: int
    account: str
    session_id: str
    event_type: str         # session_start, action, popup, captcha, error, device_lost
    action_type: str | None # like, follow, scroll, comment, profile_visit, search
    behavioral_state: dict  # {energy, fatigue, boredom, phase}
    duration_ms: int | None
    success: bool
    metadata: dict
```

### EventLogger Class

```python
class EventLogger:
    def __init__(self, events_dir, screenshots_dir, retention_days=30, flush_every=10): ...
    def log_event(self, event, screenshot_bytes=None): ...
    def get_action_trace(self, session_id) -> list[dict]: ...
    def clear_session_trace(self, session_id): ...
    def flush(self): ...
    def close(self): ...
    def rotate_old_files(self): ...
```

### Storage

- Events: `data/events/YYYY-MM-DD.jsonl` (append-only, one JSON per line)
- Screenshots: `data/screenshots/{session_id}_{timestamp}.png`

### Buffered Writing

Buffer in list, flush when length >= flush_every or explicit flush(). Open file in append mode, write all buffered lines, close. No persistent file handle.

### Action Trace Buffer

`_traces: dict[str, collections.deque(maxlen=10)]`. Every log_event appends summary to session's deque. `get_action_trace()` returns list copy. `clear_session_trace()` removes key.

### Module-Level Convenience

```python
_default_logger = None
def init_monitor(events_dir, screenshots_dir, **kwargs): ...
def log_event(event, screenshot_bytes=None): ...
def get_action_trace(session_id): ...
```

### Thread Safety

Buffer and traces protected by `threading.Lock`.

### Integration

- executor.py: `init_monitor()` at startup, `log_event()` for session_start/end, device_lost, error, timeout
- tiktok.py: `_log_action()` helper after like, comment, follow, profile_visit actions
- tiktok.py: CAPTCHA detection logs event with screenshot via PopupGuardian
- Session ID: generated in executor.py (`{account}_{uuid8}`), propagated to bot via `bot._session_id`
- Behavioral state: extracted via `_get_behavioral_state()` / `_extract_behavioral_state()` helpers

### Actual Implementation

**Files created:** `core/monitor.py`, `tests/test_monitor.py`
**Files modified:** `planner/executor.py`, `actions/tiktok.py`, `tests/conftest.py`

**Deviations from plan:**
- config.py NOT modified (no new config needed — dirs derived from DATA_DIR)
- Scroll actions NOT logged (too noisy at 84-90% frequency — would dominate event files)
- instagram.py NOT integrated yet (same pattern as tiktok.py, deferred)
- Screenshot rotation added to `rotate_old_files()` (reviews caught missing cleanup)
- `_extract_behavioral_state()` static method on SessionExecutor deduplicates nested getattr chains

**Tests:** 19 tests covering event schema, JSONL format, file rotation, screenshots, buffered writes, graceful failure, action trace buffer, module-level API. All pass (146/146 full suite).
