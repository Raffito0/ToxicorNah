"""Tests for planner_routes.py -- API endpoints for planner + warmup."""
import json
from datetime import date
from unittest.mock import patch

import pytest

from app import db as _db
from app.models import (
    Phone, Bot, BotAccount, Proxy, User, WeeklyPlan,
)


# ─── Fixtures ─────────────────────────────────────────────────


@pytest.fixture
def seed_data(app, db):
    """Create User + minimal data for route tests."""
    user = User(username='test', email='test@test.com', password='hash')
    db.session.add(user)
    db.session.flush()

    phone = Phone(id=1, name='Galaxy S9', model='SM-G960F')
    db.session.add(phone)
    db.session.flush()

    proxy = Proxy(id=1, name='USA Mobile', host='proxy.example.com',
                  port=20002, username_env='PROXY_USER', password_env='PROXY_PASS')
    db.session.add(proxy)
    db.session.flush()

    bot = Bot(user_id=user.id, phone_id='1', name='Phone 1 Bot',
              platform='tiktok', phone_ref_id=phone.id, proxy_id=proxy.id)
    db.session.add(bot)
    db.session.flush()

    ba = BotAccount(
        bot_id=bot.id, clone_id='tt1', username='ph1_tiktok',
        password='pass', platform='tiktok',
        warmup_json={
            'current_day': 3, 'total_days': 7, 'completed': False,
            'warmup_plan': {str(d): {'type': 'normal', 'likes': d*3, 'comments': d, 'follows': 0, 'sessions': 1}
                           for d in range(1, 8)},
        },
    )
    db.session.add(ba)
    db.session.commit()

    return {'user': user, 'proxy': proxy, 'ba': ba}


@pytest.fixture
def auth_client(app, seed_data):
    """Authenticated test client (bypasses login_required)."""
    from flask_login import login_user
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['_user_id'] = str(seed_data['user'].id)
    return client


@pytest.fixture
def unauth_client(app):
    """Unauthenticated test client."""
    return app.test_client()


def _seed_active_plan(db, proxy_id):
    """Insert an active plan for today."""
    today = date.today()
    iso_cal = today.isocalendar()
    plan = WeeklyPlan(
        proxy_id=proxy_id,
        week_number=iso_cal[1], year=iso_cal[0],
        plan_json={
            'week': iso_cal[1], 'year': iso_cal[0],
            'days': {
                today.isoformat(): {
                    'sessions': [
                        {'session_id': f'{today.isoformat()}_ph1_tiktok_1',
                         'account_name': 'ph1_tiktok', 'session_type': 'normal',
                         'start_time_utc': '2026-03-22T23:45:00Z'},
                    ]
                }
            }
        },
        status='active',
    )
    db.session.add(plan)
    db.session.commit()
    return plan


# ─── Auth Required ──────────────────────────────────────────────


def test_weekly_plan_requires_auth(unauth_client):
    resp = unauth_client.get('/api/planner/weekly-plan?proxy_id=1')
    assert resp.status_code in (302, 401)


def test_today_sessions_requires_auth(unauth_client):
    resp = unauth_client.get('/api/planner/today-sessions')
    assert resp.status_code in (302, 401)


def test_generate_requires_auth(unauth_client):
    resp = unauth_client.post('/api/planner/weekly-plan/generate',
                              json={'proxy_id': 1})
    assert resp.status_code in (302, 401)


def test_warmup_requires_auth(unauth_client):
    resp = unauth_client.get('/api/planner/warmup/ph1_tiktok')
    assert resp.status_code in (302, 401)


# ─── GET weekly-plan ────────────────────────────────────────────


def test_get_weekly_plan_returns_plan(auth_client, db, seed_data):
    _seed_active_plan(db, seed_data['proxy'].id)
    resp = auth_client.get('/api/planner/weekly-plan?proxy_id=1')
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'days' in data


def test_get_weekly_plan_404_no_plan(auth_client, seed_data):
    resp = auth_client.get('/api/planner/weekly-plan?proxy_id=1')
    assert resp.status_code == 404


def test_get_weekly_plan_400_no_proxy(auth_client, seed_data):
    resp = auth_client.get('/api/planner/weekly-plan')
    assert resp.status_code == 400


# ─── POST generate ──────────────────────────────────────────────


@patch('app.planner_routes.planner_service.generate_weekly_plan')
def test_generate_returns_201(mock_gen, auth_client, seed_data):
    mock_gen.return_value = {'days': {}}
    resp = auth_client.post('/api/planner/weekly-plan/generate',
                            json={'proxy_id': 1})
    assert resp.status_code == 201
    assert 'days' in resp.get_json()


@patch('app.planner_routes.planner_service.generate_weekly_plan')
def test_generate_400_on_error(mock_gen, auth_client, seed_data):
    mock_gen.side_effect = ValueError("No accounts found")
    resp = auth_client.post('/api/planner/weekly-plan/generate',
                            json={'proxy_id': 999})
    assert resp.status_code == 400
    assert 'error' in resp.get_json()


def test_generate_400_no_proxy(auth_client, seed_data):
    resp = auth_client.post('/api/planner/weekly-plan/generate', json={})
    assert resp.status_code == 400


# ─── POST regenerate ────────────────────────────────────────────


@patch('app.planner_routes.planner_service.regenerate_remaining_days')
def test_regenerate_returns_plan(mock_regen, auth_client, seed_data):
    mock_regen.return_value = {'days': {}}
    resp = auth_client.post('/api/planner/weekly-plan/regenerate',
                            json={'proxy_id': 1})
    assert resp.status_code == 200


# ─── GET today-sessions ─────────────────────────────────────────


def test_today_sessions_returns_list(auth_client, db, seed_data):
    _seed_active_plan(db, seed_data['proxy'].id)
    resp = auth_client.get('/api/planner/today-sessions?proxy_id=1')
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'sessions' in data
    assert 'current_time_et' in data
    assert 'timezone' in data


def test_today_sessions_empty(auth_client, seed_data):
    resp = auth_client.get('/api/planner/today-sessions?proxy_id=1')
    assert resp.status_code == 200
    assert resp.get_json()['sessions'] == []


# ─── GET warmup ──────────────────────────────────────────────────


def test_warmup_status(auth_client, seed_data):
    resp = auth_client.get('/api/planner/warmup/ph1_tiktok')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['current_day'] == 3
    assert data['completed'] is False


def test_warmup_404_unknown(auth_client, seed_data):
    resp = auth_client.get('/api/planner/warmup/nonexistent')
    assert resp.status_code == 404


# ─── POST warmup actions ────────────────────────────────────────


def test_warmup_reset(auth_client, seed_data):
    resp = auth_client.post('/api/planner/warmup/ph1_tiktok/reset')
    assert resp.status_code == 200
    assert resp.get_json()['current_day'] == 0


def test_warmup_skip(auth_client, seed_data):
    resp = auth_client.post('/api/planner/warmup/ph1_tiktok/skip',
                            json={'target_day': 5})
    assert resp.status_code == 200
    assert resp.get_json()['current_day'] == 5


def test_warmup_skip_400_no_target(auth_client, seed_data):
    resp = auth_client.post('/api/planner/warmup/ph1_tiktok/skip', json={})
    assert resp.status_code == 400


def test_warmup_complete(auth_client, seed_data):
    resp = auth_client.post('/api/planner/warmup/ph1_tiktok/complete')
    assert resp.status_code == 200
    assert resp.get_json()['completed'] is True


# ─── GET export ──────────────────────────────────────────────────


def test_export_plan(auth_client, db, seed_data):
    _seed_active_plan(db, seed_data['proxy'].id)
    resp = auth_client.get('/api/planner/weekly-plan/export?proxy_id=1')
    assert resp.status_code == 200
    assert 'Content-Disposition' in resp.headers
    assert 'attachment' in resp.headers['Content-Disposition']


def test_export_404_no_plan(auth_client, seed_data):
    resp = auth_client.get('/api/planner/weekly-plan/export?proxy_id=1')
    assert resp.status_code == 404
