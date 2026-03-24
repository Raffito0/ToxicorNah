"""Tests for intervention_routes.py blueprint.

Fixtures: app, client (from conftest pattern)
All routes require @login_required -- unauthenticated requests must return 302 (redirect).
"""
import pytest
import os
import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db as _db
from app.models import User, Bot, BotAccount, Phone, InterventionLog


@pytest.fixture
def app(tmp_path):
    os.environ['TESTING'] = '1'
    db_file = str(tmp_path / 'test.db')
    application = create_app()
    application.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_file}'
    application.config['TESTING'] = True
    application.config['SECRET_KEY'] = 'test-secret'
    with application.app_context():
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


def _seed(db):
    """Create user, phone, bot, account for testing."""
    from werkzeug.security import generate_password_hash
    user = User(username='test', email='t@t.com',
                password=generate_password_hash('pw'))
    db.session.add(user)
    db.session.flush()

    phone = Phone(id=1, name='Phone 1', model='SM-G960F')
    db.session.add(phone)
    db.session.flush()

    bot = Bot(user_id=user.id, phone_id='1', name='TKBot',
              phone_ref_id=1)
    db.session.add(bot)
    db.session.flush()

    account = BotAccount(bot_id=bot.id, clone_id='c1',
                         username='tk_user', password='p')
    db.session.add(account)
    db.session.commit()
    return user, phone, bot, account


def _login(client, user_id=1):
    """Set session user_id to simulate login."""
    with client.session_transaction() as sess:
        sess['_user_id'] = str(user_id)


# --- Auth tests ---

def test_active_unauthenticated_returns_redirect(client):
    resp = client.get('/api/interventions/active')
    assert resp.status_code in (302, 401)


def test_history_unauthenticated_returns_redirect(client):
    resp = client.get('/api/interventions/1/history')
    assert resp.status_code in (302, 401)


# --- GET /api/interventions/active ---

def test_active_empty(app, client):
    with app.app_context():
        _seed(_db)
    _login(client)
    resp = client.get('/api/interventions/active')
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_active_returns_only_unresolved(app, client):
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        # Pending intervention
        pending = InterventionLog(
            bot_account_id=account.id,
            session_id='sess_1',
            intervention_type='pre_post',
            bot_id=bot.id,
        )
        # Resolved intervention
        resolved = InterventionLog(
            bot_account_id=account.id,
            session_id='sess_2',
            intervention_type='pre_post',
            bot_id=bot.id,
            resolved_at=datetime.now(timezone.utc),
            resolution='approve',
        )
        _db.session.add_all([pending, resolved])
        _db.session.commit()

    _login(client)
    resp = client.get('/api/interventions/active')
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data) == 1
    assert data[0]['session_id'] == 'sess_1'
    assert data[0]['resolved_at'] is None


# --- GET /api/interventions/<bot_id>/history ---

def test_history_returns_bot_rows(app, client):
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        # Create second bot
        bot2 = Bot(user_id=user.id, phone_id='2', name='TKBot2',
                   phone_ref_id=1)
        _db.session.add(bot2)
        _db.session.flush()
        account2 = BotAccount(bot_id=bot2.id, clone_id='c2',
                              username='tk_user2', password='p')
        _db.session.add(account2)
        _db.session.flush()

        log1 = InterventionLog(bot_account_id=account.id,
                               session_id='s1', intervention_type='pre_post',
                               bot_id=bot.id)
        log2 = InterventionLog(bot_account_id=account2.id,
                               session_id='s2', intervention_type='pre_post',
                               bot_id=bot2.id)
        _db.session.add_all([log1, log2])
        _db.session.commit()
        bot1_id = bot.id
        bot2_id = bot2.id

    _login(client)
    resp = client.get(f'/api/interventions/{bot1_id}/history')
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data) == 1
    assert data[0]['bot_id'] == bot1_id


def test_history_unknown_bot_returns_empty(app, client):
    with app.app_context():
        _seed(_db)
    _login(client)
    resp = client.get('/api/interventions/999/history')
    assert resp.status_code == 200
    assert resp.get_json() == []


# --- POST /api/interventions/<bot_id>/resolve ---

def test_resolve_success(app, client):
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        log = InterventionLog(bot_account_id=account.id,
                              session_id='s1', intervention_type='pre_post',
                              bot_id=bot.id)
        _db.session.add(log)
        _db.session.commit()
        bot_id = bot.id

    _login(client)
    with patch('app.intervention_routes._resolve_gate') as mock_gate:
        resp = client.post(f'/api/interventions/{bot_id}/resolve',
                           json={'resolution': 'approve'})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['status'] == 'ok'
    assert 'intervention_id' in data
    # Verify gate was called with correct phone_ref_id and resolution
    mock_gate.assert_called_once_with(1, 'approve')

    # Verify DB was updated
    with app.app_context():
        log = InterventionLog.query.get(data['intervention_id'])
        assert log.resolved_at is not None
        assert log.resolution == 'approve'


def test_resolve_no_pending_returns_409(app, client):
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        bot_id = bot.id

    _login(client)
    resp = client.post(f'/api/interventions/{bot_id}/resolve',
                       json={'resolution': 'approve'})
    assert resp.status_code == 409
    assert resp.get_json()['error'] == 'no_pending'


def test_resolve_already_resolved_returns_409(app, client):
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        log = InterventionLog(bot_account_id=account.id,
                              session_id='s1', intervention_type='pre_post',
                              bot_id=bot.id,
                              resolved_at=datetime.now(timezone.utc),
                              resolution='skip')
        _db.session.add(log)
        _db.session.commit()
        bot_id = bot.id

    _login(client)
    resp = client.post(f'/api/interventions/{bot_id}/resolve',
                       json={'resolution': 'approve'})
    assert resp.status_code == 409


# --- Service function tests ---

def test_create_intervention(app):
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        from app.intervention_routes import create_intervention
        log = create_intervention(
            bot_id=bot.id,
            account_id=account.id,
            intervention_type='pre_post',
            session_id='sess_test'
        )
        assert log.id is not None
        assert log.requested_at is not None
        assert log.resolved_at is None
        assert log.intervention_type == 'pre_post'


def test_resolve_intervention_success(app):
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        from app.intervention_routes import create_intervention, resolve_intervention
        log = create_intervention(bot.id, account.id, 'pre_post', 'sess_test')
        ok, reason = resolve_intervention(log.id, 'approve')
        assert ok is True
        assert reason == 'ok'

        refreshed = InterventionLog.query.get(log.id)
        assert refreshed.resolved_at is not None
        assert refreshed.resolution == 'approve'


def test_resolve_intervention_already_resolved(app):
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        from app.intervention_routes import create_intervention, resolve_intervention
        log = create_intervention(bot.id, account.id, 'pre_post', 'sess_test')
        resolve_intervention(log.id, 'approve')
        ok, reason = resolve_intervention(log.id, 'skip')
        assert ok is False
        assert reason == 'already_resolved'
