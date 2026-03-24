# Section 01: Pre-Post Pause Shared State (InterventionGate)

## Background

The phone-bot runs in worker threads managed by the Flask dashboard. When `browse_session()` reaches the moment of posting, it calls `post_video()` directly — there is no natural hook where the Flask app or a Telegram handler can interpose. To support remote approval before posting, a shared-state mechanism is needed that:

1. Can be written by the worker thread ("I need approval before posting")
2. Blocks the worker thread with zero CPU spin while waiting
3. Can be resolved from any other thread (Telegram handler, dashboard HTTP handler, timeout)

This section implements the `InterventionGate` class and the two integration points inside phone-bot.

## Dependencies

None. This section has no upstream dependencies and can be implemented immediately.

## Files to Create / Modify

| File | Action |
|---|---|
| `phone-bot/core/intervention.py` | NEW — InterventionGate class and singleton |
| `phone-bot/actions/tiktok.py` | MODIFY — add `_check_pre_post_pause()` and call it at line ~5370 |
| `phone-bot/planner/executor.py` | MODIFY — add pre-post pause check before `post_fn()` at line ~815 |

## Tests First

**File**: `tests/test_intervention_gate.py`

Testing framework: pytest. No database or Flask context required — the gate is pure Python threading.

```python
"""
Tests for InterventionGate: thread-safe pre-post pause mechanism.

Setup: import InterventionGate from phone_bot.core.intervention
       (adjust import path to match project layout).
       Each test creates a fresh gate instance (not the singleton) to avoid state leakage.
"""

import threading
import time
import pytest
# from phone_bot.core.intervention import InterventionGate  # adjust path as needed


def test_request_pause_stores_pending_state():
    """request_pause() must store state='pending', reason, and a since timestamp."""
    ...


def test_check_and_wait_unblocked_by_approve():
    """
    check_and_wait() must block until resolve() is called from another thread.
    When resolved with 'approve', returns 'approve'.
    Uses a short timeout (5s) so the test doesn't hang on failure.
    """
    ...


def test_check_and_wait_unblocked_by_skip():
    """Same as above, but resolve() called with 'skip' — returns 'skip'."""
    ...


def test_check_and_wait_returns_timeout():
    """
    check_and_wait(timeout_s=0.1) returns 'timeout' when no resolve() is called.
    Verify the return value and that it does NOT block longer than ~0.5s.
    """
    ...


def test_resolve_unknown_phone_id_is_noop():
    """resolve() on a phone_id with no pending state must not raise."""
    ...


def test_get_pending_returns_none_when_absent():
    """get_pending(phone_id) returns None when no pause requested."""
    ...


def test_get_pending_returns_dict_when_pending():
    """get_pending(phone_id) returns the pending dict after request_pause()."""
    ...


def test_thread_safe_resolve_unblocks_waiting_thread():
    """
    Concurrent scenario: main thread calls check_and_wait() while a second thread
    calls resolve() after 0.2s. Main thread must unblock with the correct resolution.
    No race condition or deadlock.
    """
    ...


def test_second_request_pause_replaces_first():
    """
    Calling request_pause() twice for the same phone_id replaces the first pending
    state. Only one pending entry per phone at a time.
    """
    ...


def test_short_timeout_does_not_block():
    """
    Integration: request_pause() then check_and_wait(timeout_s=0.05).
    Must return 'timeout' within 0.5s wall time.
    """
    ...
```

## Implementation: `phone-bot/core/intervention.py`

### Design

`InterventionGate` uses `threading.Event` — one per pending pause — to block the worker thread with zero CPU spin. `resolve()` calls `event.set()` which wakes the waiter immediately. There is no polling loop.

Key fields in each pending entry:

```python
{
    "state": "pending",        # always "pending" while waiting
    "reason": str,             # human-readable reason for the pause
    "since": float,            # time.time() when pause was requested
    "resolution": str | None,  # set by resolve(): "approve" | "skip" | "timeout"
    "timeout_at": float,       # time.time() + timeout_s
    "_event": threading.Event, # NOT serialized — internal only
}
```

### Class Stub

```python
import threading
import time
from typing import Optional, Dict, Any


class InterventionGate:
    """
    Thread-safe gate that blocks a phone-bot worker thread before posting,
    waiting for an external resolve() signal (Telegram, dashboard, or timeout).

    Usage (worker thread):
        gate.request_pause(phone_id=2, reason="Warmup day 7 first post")
        decision = gate.check_and_wait(phone_id=2, timeout_s=1800)
        if decision == "approve":
            bot.post_video(...)
        # "skip" and "timeout" both mean: do not post

    Usage (Telegram handler or dashboard):
        gate.resolve(phone_id=2, decision="approve")
    """

    def __init__(self):
        """Initialize with empty pending dict and a lock."""
        ...

    def request_pause(self, phone_id: int, reason: str = "") -> None:
        """
        Register a pause request for phone_id.
        If a pending entry already exists for this phone, it is replaced
        (only one pending per phone at a time).
        Creates a new threading.Event for this request.
        """
        ...

    def check_and_wait(self, phone_id: int, timeout_s: float = 1800) -> str:
        """
        Block until resolve() is called for phone_id or timeout_s elapses.
        Returns 'approve' | 'skip' | 'timeout'.
        Must be called AFTER request_pause() for the same phone_id.
        If no pending entry exists, returns 'timeout' immediately (safe default).
        """
        ...

    def resolve(self, phone_id: int, decision: str) -> None:
        """
        Resolve a pending pause for phone_id with decision ('approve' or 'skip').
        Sets _event so check_and_wait() unblocks immediately.
        No-op if no pending state exists for phone_id.
        """
        ...

    def get_pending(self, phone_id: int) -> Optional[Dict[str, Any]]:
        """
        Return a copy of the pending dict for phone_id, or None if not pending.
        The returned dict does NOT include the internal _event key.
        """
        ...

    def get_all_pending(self) -> Dict[int, Dict[str, Any]]:
        """
        Return a copy of all pending entries (for /status and dashboard).
        No _event keys in returned dicts.
        """
        ...


# --- Module-level singleton ---
_gate: Optional[InterventionGate] = None
_gate_lock = threading.Lock()


def get_gate() -> InterventionGate:
    """
    Return the module-level singleton InterventionGate.
    Creates it on first call (thread-safe).
    Import this function from both phone-bot and Flask to share the same instance.
    """
    ...
```

### Implementation Notes

- The `_pending` dict maps `phone_id (int)` to pending entry dict.
- All access to `_pending` must hold `self._lock`.
- `check_and_wait()` must retrieve the `_event` while holding the lock, then release the lock before calling `event.wait(timeout=timeout_s)`. Never hold the lock while waiting — that would deadlock `resolve()`.
- After `event.wait()` returns, re-acquire the lock to read `resolution`. If `resolution` is still `None`, the wait timed out — return `"timeout"`.
- Clean up the `_pending` entry after returning from `check_and_wait()` to avoid stale state.
- `get_pending()` must strip the `_event` key from the returned copy so callers never hold a reference to the internal event.

## Integration Point 1: `phone-bot/actions/tiktok.py`

### Where

Around line 5368 in `browse_session()`, immediately before `result = self.post_video(video_path, caption)`.

### Current Code (around line 5368)

```python
# --- Post video at the right time ---
if should_post and not post_done and elapsed >= post_after:
    if video_path:
        result = self.post_video(video_path, caption)
        post_done = True
```

### Change

Add a `_check_pre_post_pause()` call between the condition check and `post_video()`. If the decision is `"skip"` or `"timeout"`, skip the post and mark `post_done = True` so the session continues normally (no retry).

```python
def _check_pre_post_pause(self, reason: str = "") -> str:
    """
    If an intervention gate callback is registered, signal it and block until
    resolved. Returns 'approve' | 'skip' | 'timeout'.

    If no callback is registered (gate not available), returns 'approve'
    immediately so normal operation is unaffected.
    """
    ...
```

The method should:
1. Try to import `get_gate` from `phone_bot.core.intervention` (guarded with try/except ImportError so phone-bot works standalone without the gate installed)
2. Call `gate.request_pause(self.phone_id, reason)`
3. Also invoke `self._pre_post_callback` if one has been registered (the Flask worker sets this callback to trigger the Telegram notification — see Section 2)
4. Call `gate.check_and_wait(self.phone_id, timeout_s=1800)`
5. Return the decision

The modified block in `browse_session()` becomes:

```python
if should_post and not post_done and elapsed >= post_after:
    if video_path:
        decision = self._check_pre_post_pause(reason="browse_session post")
        if decision == "approve":
            result = self.post_video(video_path, caption)
            post_done = True
            self._last_post_result = result
            if result == "success":
                self.go_to_fyp()
                time.sleep(self.human.timing("t_nav_settle"))
        else:
            log.info("Pre-post pause: decision=%s — skipping post", decision)
            post_done = True  # mark done to avoid repeated checks
        continue
```

### Callback Registration

Add `_pre_post_callback` attribute to `TikTokBot.__init__`:

```python
self._pre_post_callback: Optional[callable] = None
```

The Flask worker thread sets this after creating the bot:

```python
bot._pre_post_callback = lambda reason: telegram_handler.send_approval_notification(phone_id, account_name, reason)
```

## Integration Point 2: `phone-bot/planner/executor.py`

### Where

Around line 814 in `_do_post()`, before `result = post_fn(video_path, caption)`.

### Current Code (around line 814)

```python
for attempt in range(2):
    result = post_fn(video_path, caption)
```

### Change

Before the `for attempt` loop, add a pre-post pause check:

```python
# Pre-post pause check (intervention gate)
decision = self._check_pre_post_pause(bot, phone_id, account, reason="executor post")
if decision != "approve":
    log.info("Pre-post pause: decision=%s — skipping post for %s", decision, account)
    return "skipped"

for attempt in range(2):
    result = post_fn(video_path, caption)
    ...
```

The helper `_check_pre_post_pause` in `executor.py` follows the same pattern as in `tiktok.py` (import gate, request_pause, invoke callback, check_and_wait, return decision).

## Pause Logic (Two Layers)

The caller decides whether to trigger a pause before calling `_check_pre_post_pause`. The decision tree is:

1. **Warmup last-day first post (FORCED)**: Always pause regardless of any toggle. The worker must detect this condition (`is_last_warmup_day AND first_post_of_day`) and call `_check_pre_post_pause()` unconditionally.
2. **Normal posts**: Check `account.notify_before_post` (a boolean flag on `BotAccount` model, already defined). Only call `_check_pre_post_pause()` if `True`.
3. **Timeout = skip**: If the 30-minute timeout expires, the gate returns `"timeout"`. Treat the same as `"skip"` — never post blindly. Log as `resolution="timeout"` in `InterventionLog` (see Section 3 for logging).

Neither `tiktok.py` nor `executor.py` have access to the `BotAccount` model directly — the flag must be passed in as a parameter by the Flask worker when it launches the session. The worker should read `account.notify_before_post` from DB and pass it to the bot or executor as a session config value.

## Import Path Note

The `phone-bot/core/intervention.py` module must be importable from both:
- Inside phone-bot: `from .intervention import get_gate` (relative) or `from phone_bot.core.intervention import get_gate` (absolute, if phone-bot is installed as a package)
- From the Flask app: same absolute path

If phone-bot is not a proper package (no `setup.py`), the Flask app can add the phone-bot directory to `sys.path` before importing. The gate is a pure Python module with no dependencies beyond stdlib `threading` and `time` — safe to import from either context.

## What This Section Does NOT Cover

- Sending the Telegram notification (Section 2 — `telegram_handler.py`)
- Writing to `InterventionLog` in the database (Section 3 — `intervention_routes.py`)
- Dashboard UI for approving/skipping (Section 6)
- Any integration testing (Section 7)

Section 2 (Telegram handler) depends on this section being complete. Once `InterventionGate` exists and the `_pre_post_callback` slot is available on `TikTokBot`, Section 2 can wire the notification sending.
