"""Tests for Personality API (section-01)."""
import pytest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db as _db
from app.models import User, Bot, BotAccount
from app.personality_routes import PERSONALITY_RANGES


@pytest.fixture
def app(tmp_path):
    """Create a Flask app with a temp SQLite DB."""
    os.environ['TESTING'] = '1'
    db_file = str(tmp_path / 'test.db')
    application = create_app()
    application.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_file}'
    application.config['TESTING'] = True
    application.config['WTF_CSRF_ENABLED'] = False
    application.config['SECRET_KEY'] = 'test-secret'

    with application.app_context():
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


def _create_test_data():
    """Create user + bot + account for testing."""
    from werkzeug.security import generate_password_hash
    user = User(username='testuser', email='test@test.com',
                password=generate_password_hash('password'))
    _db.session.add(user)
    _db.session.flush()

    bot = Bot(user_id=user.id, phone_id='1', name='TestBot', platform='tiktok')
    _db.session.add(bot)
    _db.session.flush()

    account = BotAccount(bot_id=bot.id, clone_id='clone1',
                         username='tiktok_user', password='pass',
                         platform='tiktok')
    _db.session.add(account)
    _db.session.commit()
    return user, bot, account


@pytest.fixture
def auth_client(app, client):
    """Create user, bot, account and log in."""
    with app.app_context():
        user, bot, account = _create_test_data()
        # Log in via session
        with client.session_transaction() as sess:
            sess['_user_id'] = str(user.id)
        return client, account.id, bot.id


class TestGetPersonality:
    def test_get_returns_traits_and_metadata(self, auth_client):
        client, account_id, _ = auth_client
        resp = client.get(f'/api/accounts/{account_id}/personality')
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'traits' in data
        assert 'locked_traits' in data
        assert 'history' in data
        assert 'sessions_count' in data

    def test_get_null_personality_returns_defaults(self, auth_client):
        client, account_id, _ = auth_client
        resp = client.get(f'/api/accounts/{account_id}/personality')
        data = resp.get_json()
        traits = data['traits']
        for key, (lo, hi) in PERSONALITY_RANGES.items():
            assert key in traits
            expected_mid = round((lo + hi) / 2, 3)
            assert abs(traits[key] - expected_mid) < 0.01

    def test_get_requires_login(self, client):
        resp = client.get('/api/accounts/1/personality')
        assert resp.status_code in (302, 401)


class TestPutPersonality:
    def test_put_updates_specific_traits(self, auth_client):
        client, account_id, _ = auth_client
        resp = client.put(f'/api/accounts/{account_id}/personality',
                          json={'traits': {'reels_preference': 0.70}})
        assert resp.status_code == 200
        resp = client.get(f'/api/accounts/{account_id}/personality')
        assert resp.get_json()['traits']['reels_preference'] == 0.70

    def test_put_rejects_unknown_traits(self, auth_client):
        client, account_id, _ = auth_client
        resp = client.put(f'/api/accounts/{account_id}/personality',
                          json={'traits': {'fake_trait': 0.5}})
        assert resp.status_code == 400
        assert 'Unknown traits' in resp.get_json()['error']

    def test_put_clamps_to_range(self, auth_client):
        client, account_id, _ = auth_client
        resp = client.put(f'/api/accounts/{account_id}/personality',
                          json={'traits': {'reels_preference': 99.0}})
        assert resp.status_code == 200
        resp = client.get(f'/api/accounts/{account_id}/personality')
        assert resp.get_json()['traits']['reels_preference'] == 0.80


class TestRandomize:
    def test_randomize_within_bounds(self, auth_client):
        client, account_id, _ = auth_client
        resp = client.post(f'/api/accounts/{account_id}/personality/randomize')
        assert resp.status_code == 200
        data = resp.get_json()
        for key, (lo, hi) in PERSONALITY_RANGES.items():
            assert lo <= data['traits'][key] <= hi

    def test_randomize_skips_locked(self, auth_client):
        client, account_id, _ = auth_client
        client.put(f'/api/accounts/{account_id}/personality',
                   json={'traits': {'reels_preference': 0.50}})
        client.put(f'/api/accounts/{account_id}/personality/lock',
                   json={'trait': 'reels_preference', 'locked': True})
        resp = client.post(f'/api/accounts/{account_id}/personality/randomize')
        data = resp.get_json()
        assert data['traits']['reels_preference'] == 0.50


class TestReset:
    def test_reset_restores_midpoints(self, auth_client):
        client, account_id, _ = auth_client
        client.put(f'/api/accounts/{account_id}/personality',
                   json={'traits': {'reels_preference': 0.75}})
        resp = client.post(f'/api/accounts/{account_id}/personality/reset')
        assert resp.status_code == 200
        data = resp.get_json()
        for key, (lo, hi) in PERSONALITY_RANGES.items():
            expected_mid = round((lo + hi) / 2, 3)
            assert abs(data['traits'][key] - expected_mid) < 0.01

    def test_reset_clears_locks(self, auth_client):
        client, account_id, _ = auth_client
        client.put(f'/api/accounts/{account_id}/personality/lock',
                   json={'trait': 'reels_preference', 'locked': True})
        client.post(f'/api/accounts/{account_id}/personality/reset')
        resp = client.get(f'/api/accounts/{account_id}/personality')
        assert resp.get_json()['locked_traits'] == []


class TestLock:
    def test_lock_toggles_trait(self, auth_client):
        client, account_id, _ = auth_client
        resp = client.put(f'/api/accounts/{account_id}/personality/lock',
                          json={'trait': 'reels_preference', 'locked': True})
        assert resp.status_code == 200
        resp = client.get(f'/api/accounts/{account_id}/personality')
        assert 'reels_preference' in resp.get_json()['locked_traits']

        resp = client.put(f'/api/accounts/{account_id}/personality/lock',
                          json={'trait': 'reels_preference', 'locked': False})
        resp = client.get(f'/api/accounts/{account_id}/personality')
        assert 'reels_preference' not in resp.get_json()['locked_traits']


class TestHistory:
    def test_history_limited_to_30(self, auth_client):
        client, account_id, _ = auth_client
        for i in range(35):
            client.put(f'/api/accounts/{account_id}/personality',
                       json={'traits': {'reels_preference': 0.20 + i * 0.01},
                             'record_history': True})
        resp = client.get(f'/api/accounts/{account_id}/personality')
        history = resp.get_json()['history']
        assert len(history) <= 30
