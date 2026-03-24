"""
Tests for InterventionGate: thread-safe pre-post pause mechanism.

Each test creates a fresh gate instance (not the singleton) to avoid state leakage.
"""

import threading
import time
import pytest

from phone_bot.core.intervention import InterventionGate


def test_request_pause_stores_pending_state():
    """request_pause() must store state='pending', reason, and a since timestamp."""
    gate = InterventionGate()
    gate.request_pause(phone_id=1, reason="warmup first post")
    pending = gate.get_pending(1)
    assert pending is not None
    assert pending["state"] == "pending"
    assert pending["reason"] == "warmup first post"
    assert "since" in pending
    assert isinstance(pending["since"], float)


def test_check_and_wait_unblocked_by_approve():
    """
    check_and_wait() must block until resolve() is called from another thread.
    When resolved with 'approve', returns 'approve'.
    """
    gate = InterventionGate()
    gate.request_pause(phone_id=2, reason="test")
    result = [None]

    def resolver():
        time.sleep(0.2)
        gate.resolve(phone_id=2, decision="approve")

    t = threading.Thread(target=resolver)
    t.start()
    result[0] = gate.check_and_wait(phone_id=2, timeout_s=5)
    t.join()
    assert result[0] == "approve"


def test_check_and_wait_unblocked_by_skip():
    """Same as above, but resolve() called with 'skip' — returns 'skip'."""
    gate = InterventionGate()
    gate.request_pause(phone_id=3, reason="test")

    def resolver():
        time.sleep(0.2)
        gate.resolve(phone_id=3, decision="skip")

    t = threading.Thread(target=resolver)
    t.start()
    result = gate.check_and_wait(phone_id=3, timeout_s=5)
    t.join()
    assert result == "skip"


def test_check_and_wait_returns_timeout():
    """
    check_and_wait(timeout_s=0.1) returns 'timeout' when no resolve() is called.
    Verify the return value and that it does NOT block longer than ~0.5s.
    """
    gate = InterventionGate()
    gate.request_pause(phone_id=4, reason="test")
    start = time.monotonic()
    result = gate.check_and_wait(phone_id=4, timeout_s=0.1)
    elapsed = time.monotonic() - start
    assert result == "timeout"
    assert elapsed < 0.5


def test_resolve_unknown_phone_id_is_noop():
    """resolve() on a phone_id with no pending state must not raise."""
    gate = InterventionGate()
    gate.resolve(phone_id=99, decision="approve")  # should not raise


def test_get_pending_returns_none_when_absent():
    """get_pending(phone_id) returns None when no pause requested."""
    gate = InterventionGate()
    assert gate.get_pending(1) is None


def test_get_pending_returns_dict_when_pending():
    """get_pending(phone_id) returns the pending dict after request_pause()."""
    gate = InterventionGate()
    gate.request_pause(phone_id=5, reason="check")
    pending = gate.get_pending(5)
    assert pending is not None
    assert pending["state"] == "pending"
    assert pending["reason"] == "check"
    # _event must NOT be exposed
    assert "_event" not in pending


def test_thread_safe_resolve_unblocks_waiting_thread():
    """
    Concurrent scenario: main thread calls check_and_wait() while a second thread
    calls resolve() after 0.2s. Main thread must unblock with the correct resolution.
    """
    gate = InterventionGate()
    gate.request_pause(phone_id=6, reason="concurrent test")
    result = [None]
    unblocked = threading.Event()

    def waiter():
        result[0] = gate.check_and_wait(phone_id=6, timeout_s=5)
        unblocked.set()

    def resolver():
        time.sleep(0.2)
        gate.resolve(phone_id=6, decision="approve")

    t_wait = threading.Thread(target=waiter)
    t_resolve = threading.Thread(target=resolver)
    t_wait.start()
    t_resolve.start()
    assert unblocked.wait(timeout=2), "Waiter thread was not unblocked in time"
    t_wait.join()
    t_resolve.join()
    assert result[0] == "approve"


def test_second_request_pause_replaces_first():
    """
    Calling request_pause() twice for the same phone_id replaces the first pending
    state. Only one pending entry per phone at a time.
    """
    gate = InterventionGate()
    gate.request_pause(phone_id=7, reason="first")
    gate.request_pause(phone_id=7, reason="second")
    pending = gate.get_pending(7)
    assert pending["reason"] == "second"


def test_short_timeout_does_not_block():
    """
    Integration: request_pause() then check_and_wait(timeout_s=0.05).
    Must return 'timeout' within 0.5s wall time.
    """
    gate = InterventionGate()
    gate.request_pause(phone_id=8, reason="quick")
    start = time.monotonic()
    result = gate.check_and_wait(phone_id=8, timeout_s=0.05)
    elapsed = time.monotonic() - start
    assert result == "timeout"
    assert elapsed < 0.5


def test_get_all_pending():
    """get_all_pending() returns all pending entries without _event keys."""
    gate = InterventionGate()
    gate.request_pause(phone_id=1, reason="one")
    gate.request_pause(phone_id=2, reason="two")
    all_pending = gate.get_all_pending()
    assert len(all_pending) == 2
    assert 1 in all_pending
    assert 2 in all_pending
    for entry in all_pending.values():
        assert "_event" not in entry


def test_pending_cleaned_up_after_wait():
    """After check_and_wait() returns, get_pending() returns None (cleanup)."""
    gate = InterventionGate()
    gate.request_pause(phone_id=9, reason="cleanup test")

    def resolver():
        time.sleep(0.1)
        gate.resolve(phone_id=9, decision="approve")

    t = threading.Thread(target=resolver)
    t.start()
    gate.check_and_wait(phone_id=9, timeout_s=5)
    t.join()
    assert gate.get_pending(9) is None
