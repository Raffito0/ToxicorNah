# Section 06: Worker Live State Extension

## Overview
Extend `_worker_status` in tiktok_worker.py with boredom/fatigue/energy/mood/recent_events. Hybrid approach: Timer polling for gauges, queue.Queue for events. Thread-safe with Lock. New endpoint GET /api/bots/<id>/live-state.

## Dependencies
- None (parallel). Blocks: section-07.

## _worker_status New Fields
```python
{
    # existing: account, phase, elapsed_seconds, actions, started_at, error
    "boredom": 0.0,        # float 0-1, clamped
    "fatigue": 0.0,        # float 0-1, clamped
    "energy": 1.0,         # float 0-1, clamped
    "mood": {"energy_mult": 1.0, "social_mult": 1.0, "patience_mult": 1.0},
    "recent_events": [],   # deque(maxlen=20) converted to list
    "phase_elapsed": 0     # seconds in current phase
}
```

## Gauge Polling (tiktok_worker.py)
Background Timer reads HumanEngine state every 5s:
- `human.boredom.level` → boredom
- `human.fatigue.fatigue_level` → fatigue
- Energy = `clamp(0.6 + mood.energy * 0.4 + mood.patience * 0.2)`
- Mood dict from `human.mood`
- Uses `threading.Event` stop signal, cancelled in finally block.

## Event Queue
- `_event_queues = {}` — bot_id → queue.Queue(maxsize=50)
- `push_event(bot_id, event_type, detail)` — non-blocking put
- `_drain_events(bot_id)` — move queue items into deque(maxlen=20) in _worker_status
- Drain called by gauge poller and by API endpoint

## Thread Safety
- All _worker_status access via `_status_lock` (existing Lock)
- `get_worker_status()` returns `copy.deepcopy()`, converts deque to list
- `_clamp(value, 0.0, 1.0)` helper for gauge values

## API Endpoint (analysis_routes.py)
```python
GET /api/bots/<int:bot_id>/live-state
@login_required
# Verify bot.user_id == current_user.id
# _drain_events(bot_id) for freshest events
# get_worker_status(bot_id) → 200 or 404
```

## Tests (`tests/test_worker_live_state.py`)
```python
# test_worker_status_includes_new_fields
# test_gauge_values_clamped_0_1
# test_event_queue_maxlen_20
# test_thread_safe_status_update (concurrent read/write)
# test_live_state_endpoint_active_session
# test_live_state_endpoint_404_no_session
```

## New imports in tiktok_worker.py
```python
import copy, queue
from collections import deque
```

## Implementation Notes
- Gauge poller: `_start_gauge_poller(bot_id, human)` reads HumanEngine attrs every 5s via `threading.Event.wait(5.0)`. Stopped in finally block via `_stop_gauge_poller(bot_id)`.
- `push_event()` uses `setdefault()` for thread-safe queue creation (no race condition)
- `_drain_events()` drains queue into local list OUTSIDE the lock, then appends under lock (minimal lock hold time)
- `get_worker_status()` returns `copy.deepcopy()` and strips internal `_events_deque`
- `_clear_status()` cleans both status dict and event queue under the same lock
- Energy formula: `clamp(0.6 + mood.energy*0.4 + mood.patience*0.2, 0, 1)`
- All gauge values clamped via `_clamp(value, 0.0, 1.0)`

## File Summary
| File | Action |
|------|--------|
| `app/tiktok_worker.py` | Extend status, add poller, add event queue |
| `app/analysis_routes.py` | Add live-state endpoint |
| `tests/test_worker_live_state.py` | NEW: 6 tests |
