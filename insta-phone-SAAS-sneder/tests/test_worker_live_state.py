"""Tests for worker live state extension (section-06)."""

import threading
import time
from collections import deque

import pytest

from app.tiktok_worker import (
    _clear_status,
    _event_queues,
    _status_lock,
    _update_status,
    _worker_status,
    get_worker_status,
    push_event,
)


@pytest.fixture(autouse=True)
def clean_worker_state():
    """Reset global worker state between tests."""
    with _status_lock:
        _worker_status.clear()
        _event_queues.clear()
    yield
    with _status_lock:
        _worker_status.clear()
        _event_queues.clear()


def test_worker_status_includes_new_fields():
    """Live state fields are present after update."""
    _update_status(
        1,
        account="test",
        phase="Running",
        boredom=0.3,
        fatigue=0.5,
        energy=0.8,
        mood={"energy_mult": 1.0, "social_mult": 0.9, "patience_mult": 1.1},
        recent_events=list(deque(maxlen=20)),
        phase_elapsed=42,
    )
    status = get_worker_status(1)
    assert status is not None
    assert status["boredom"] == 0.3
    assert status["fatigue"] == 0.5
    assert status["energy"] == 0.8
    assert status["mood"]["social_mult"] == 0.9
    assert isinstance(status["recent_events"], list)
    assert status["phase_elapsed"] == 42


def test_gauge_values_clamped_0_1():
    """Gauge values are clamped to [0.0, 1.0]."""
    from app.tiktok_worker import _clamp

    assert _clamp(-0.5, 0.0, 1.0) == 0.0
    assert _clamp(1.5, 0.0, 1.0) == 1.0
    assert _clamp(0.5, 0.0, 1.0) == 0.5


def test_event_queue_maxlen_20():
    """Events deque respects maxlen=20."""
    _update_status(1, account="test", recent_events=[])
    for i in range(30):
        push_event(1, "action", f"event_{i}")

    status = get_worker_status(1)
    events = status["recent_events"]
    # After draining, deque maxlen=20 keeps last 20
    assert len(events) <= 20


def test_thread_safe_status_update():
    """Concurrent read/write does not crash."""
    _update_status(1, account="test", boredom=0.0)
    errors = []

    def writer():
        try:
            for i in range(100):
                _update_status(1, boredom=i / 100.0)
        except Exception as e:
            errors.append(e)

    def reader():
        try:
            for _ in range(100):
                s = get_worker_status(1)
                if s:
                    _ = s.get("boredom", 0)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=writer), threading.Thread(target=reader)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert len(errors) == 0


def test_live_state_endpoint_active_session(app, db):
    """GET /api/bots/<id>/live-state returns status when worker is active."""
    from app.models import User, Bot

    with app.app_context():
        user = User(username="test", email="t@t.com", password="test123")
        db.session.add(user)
        db.session.commit()

        bot = Bot(user_id=user.id, phone_id="p1", name="TestBot")
        db.session.add(bot)
        db.session.commit()

        _update_status(bot.id, account="test_account", phase="Running",
                       boredom=0.4, fatigue=0.2, energy=0.9,
                       mood={"energy_mult": 1.0}, recent_events=[],
                       phase_elapsed=10)

        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess['_user_id'] = str(user.id)

            resp = client.get(f'/api/bots/{bot.id}/live-state')
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["boredom"] == 0.4
            assert data["phase"] == "Running"


def test_live_state_endpoint_404_no_session(app, db):
    """GET /api/bots/<id>/live-state returns 404 when no worker is active."""
    from app.models import User, Bot

    with app.app_context():
        user = User(username="test2", email="t2@t.com", password="test123")
        db.session.add(user)
        db.session.commit()

        bot = Bot(user_id=user.id, phone_id="p2", name="TestBot2")
        db.session.add(bot)
        db.session.commit()

        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess['_user_id'] = str(user.id)

            resp = client.get(f'/api/bots/{bot.id}/live-state')
            assert resp.status_code == 404
