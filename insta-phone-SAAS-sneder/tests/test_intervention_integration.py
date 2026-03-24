"""
Integration tests for the full Remote Intervention flow.

Tests cover:
- Full pause-approve flow end-to-end (gate + log)
- Full pause-skip flow end-to-end
- Full pause-timeout flow (short timeout)
- InterventionLog lifecycle across pause and resolve
- Blueprint registration -- all new blueprints register cleanly
- Regression: existing dashboard endpoints still work after blueprint registration
"""
import threading
import time
import pytest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db as _db
from app.models import User, Bot, BotAccount, Phone, InterventionLog
from app.intervention_routes import create_intervention, resolve_intervention


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
    from werkzeug.security import generate_password_hash
    user = User(username='test', email='t@t.com',
                password=generate_password_hash('pw'))
    db.session.add(user)
    db.session.flush()
    phone = Phone(id=1, name='Phone 1', model='SM-G960F')
    db.session.add(phone)
    db.session.flush()
    bot = Bot(user_id=user.id, phone_id='1', name='TKBot', phone_ref_id=1)
    db.session.add(bot)
    db.session.flush()
    account = BotAccount(bot_id=bot.id, clone_id='c1',
                         username='tk_user', password='p')
    db.session.add(account)
    db.session.commit()
    return user, phone, bot, account


def _login(client, user_id=1):
    with client.session_transaction() as sess:
        sess['_user_id'] = str(user_id)


# --- Gate integration tests (gate + DB) ---

def test_full_pause_approve_flow(app):
    """Gate pause -> resolve approve -> check_and_wait returns 'approve'."""
    # Import fresh gate for each test
    from phone_bot.core.intervention import InterventionGate
    gate = InterventionGate()

    with app.app_context():
        user, phone, bot, account = _seed(_db)
        log = create_intervention(bot.id, account.id, 'pre_post', 'sess_1')
        log_id = log.id

        # Worker thread: request_pause + check_and_wait
        gate.request_pause(phone_id=1, reason='pre_post')

        result = [None]

        def worker():
            result[0] = gate.check_and_wait(phone_id=1, timeout_s=5)

        t = threading.Thread(target=worker, daemon=True)
        t.start()

        time.sleep(0.1)  # let worker block

        # Resolver: approve
        gate.resolve(phone_id=1, decision='approve')
        ok, reason = resolve_intervention(log_id, 'approve')

        t.join(timeout=2)
        assert result[0] == 'approve'
        assert ok is True

        # Verify DB
        refreshed = _db.session.get(InterventionLog, log_id)
        assert refreshed.resolved_at is not None
        assert refreshed.resolution == 'approve'


def test_full_pause_skip_flow(app):
    """Gate pause -> resolve skip -> check_and_wait returns 'skip'."""
    from phone_bot.core.intervention import InterventionGate
    gate = InterventionGate()

    with app.app_context():
        user, phone, bot, account = _seed(_db)
        log = create_intervention(bot.id, account.id, 'pre_post', 'sess_2')
        log_id = log.id

        gate.request_pause(phone_id=1, reason='pre_post')

        result = [None]

        def worker():
            result[0] = gate.check_and_wait(phone_id=1, timeout_s=5)

        t = threading.Thread(target=worker, daemon=True)
        t.start()
        time.sleep(0.1)

        gate.resolve(phone_id=1, decision='skip')
        resolve_intervention(log_id, 'skip')

        t.join(timeout=2)
        assert result[0] == 'skip'

        refreshed = _db.session.get(InterventionLog, log_id)
        assert refreshed.resolution == 'skip'


def test_full_pause_timeout_flow(app):
    """Gate pause -> no resolve -> check_and_wait returns 'timeout'."""
    from phone_bot.core.intervention import InterventionGate
    gate = InterventionGate()

    with app.app_context():
        _seed(_db)
        gate.request_pause(phone_id=1, reason='pre_post')
        decision = gate.check_and_wait(phone_id=1, timeout_s=0.1)
        assert decision == 'timeout'


# --- InterventionLog lifecycle ---

def test_create_and_resolve_lifecycle(app):
    """Create -> resolve -> verify timestamps."""
    with app.app_context():
        user, phone, bot, account = _seed(_db)

        log = create_intervention(bot.id, account.id, 'pre_post', 'sess_lc')
        assert log.id is not None
        assert log.resolved_at is None

        ok, reason = resolve_intervention(log.id, 'approve')
        assert ok is True

        refreshed = _db.session.get(InterventionLog, log.id)
        assert refreshed.resolved_at is not None
        assert refreshed.resolution == 'approve'


def test_resolve_already_resolved_fails(app):
    """Resolving same log twice returns error."""
    with app.app_context():
        user, phone, bot, account = _seed(_db)
        log = create_intervention(bot.id, account.id, 'pre_post', 'sess_dup')
        resolve_intervention(log.id, 'approve')

        ok, reason = resolve_intervention(log.id, 'skip')
        assert ok is False
        assert reason == 'already_resolved'


# --- Blueprint registration ---

def test_all_new_blueprints_registered(app):
    """All three new blueprints are registered in the app."""
    assert 'intervention' in app.blueprints
    assert 'scrcpy' in app.blueprints
    assert 'tunnel' in app.blueprints


# --- Regression: existing endpoints still work ---

def test_dashboard_endpoint_still_works(app, client):
    """GET / or /signin should still return 200 after all blueprint registrations."""
    resp = client.get('/signin')
    assert resp.status_code == 200


def test_authenticated_dashboard_accessible(app, client):
    """Authenticated user can access the main dashboard page."""
    with app.app_context():
        _seed(_db)
    _login(client)
    resp = client.get('/')
    # Should be 200 (dashboard) or 302 (redirect to dashboard)
    assert resp.status_code in (200, 302)
