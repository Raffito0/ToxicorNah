"""Tests for Timing API (section-03)."""
import pytest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db as _db
from app.models import User, Bot, BotAccount, TimingPreset, TimingOverride


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


def _seed_data():
    """Create user + bot + account + default presets."""
    from werkzeug.security import generate_password_hash
    user = User(username='testuser', email='test@test.com',
                password=generate_password_hash('password'))
    _db.session.add(user)
    _db.session.flush()

    bot = Bot(user_id=user.id, phone_id='1', name='TestBot', platform='tiktok')
    _db.session.add(bot)
    _db.session.flush()

    account = BotAccount(bot_id=bot.id, clone_id='clone1',
                         username='tiktok_user', password='pass')
    _db.session.add(account)

    # Create default presets
    presets = [
        TimingPreset(name='Human Default', description='Standard human-like timing',
                     params_json={'t_app_load': [1.5, 0.3, 0.5, 4.0]}, is_default=True),
        TimingPreset(name='Fast', description='Faster timing',
                     params_json={'t_app_load': [0.8, 0.2, 0.3, 2.0]}, is_default=True),
        TimingPreset(name='Slow', description='Slower timing',
                     params_json={'t_app_load': [3.0, 0.5, 1.0, 8.0]}, is_default=True),
        TimingPreset(name='Stealth', description='Extra cautious timing',
                     params_json={'t_app_load': [2.0, 0.4, 0.8, 5.0]}, is_default=True),
    ]
    for p in presets:
        _db.session.add(p)
    _db.session.commit()

    preset_ids = [p.id for p in presets]

    # Assign first preset to bot
    bot.timing_preset_id = preset_ids[0]
    _db.session.commit()
    return user, bot, account, preset_ids


@pytest.fixture
def auth_client(app, client):
    with app.app_context():
        user, bot, account, preset_ids = _seed_data()
        with client.session_transaction() as sess:
            sess['_user_id'] = str(user.id)
        return client, bot.id, preset_ids


class TestListPresets:
    def test_get_presets_returns_defaults(self, auth_client):
        client, bot_id, preset_ids = auth_client
        resp = client.get('/api/timing/presets')
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['presets']) == 4

    def test_get_presets_requires_login(self, client):
        resp = client.get('/api/timing/presets')
        assert resp.status_code in (302, 401)


class TestGetPreset:
    def test_get_preset_with_params(self, auth_client):
        client, bot_id, preset_ids = auth_client
        resp = client.get(f'/api/timing/presets/{preset_ids[0]}')
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'params_json' in data
        assert 't_app_load' in data['params_json']


class TestBotTiming:
    def test_get_bot_timing_merged(self, auth_client):
        client, bot_id, preset_ids = auth_client
        resp = client.get(f'/api/bots/{bot_id}/timing')
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'params' in data
        assert 'overrides' in data

    def test_put_preset_changes_bot(self, auth_client):
        client, bot_id, preset_ids = auth_client
        resp = client.put(f'/api/bots/{bot_id}/timing/preset',
                          json={'preset_id': preset_ids[1]})
        assert resp.status_code == 200

    def test_post_override_upserts(self, auth_client):
        client, bot_id, preset_ids = auth_client
        resp = client.post(f'/api/bots/{bot_id}/timing/override',
                           json={'param_name': 't_app_load',
                                 'median': 2.0, 'sigma': 0.3,
                                 'min_val': 0.5, 'max_val': 5.0})
        assert resp.status_code == 200
        # Verify via GET
        resp = client.get(f'/api/bots/{bot_id}/timing')
        data = resp.get_json()
        assert 't_app_load' in data['overrides']

    def test_delete_single_override(self, auth_client):
        client, bot_id, preset_ids = auth_client
        # Create override first
        client.post(f'/api/bots/{bot_id}/timing/override',
                    json={'param_name': 't_app_load',
                          'median': 2.0, 'sigma': 0.3,
                          'min_val': 0.5, 'max_val': 5.0})
        # Delete it
        resp = client.delete(f'/api/bots/{bot_id}/timing/override/t_app_load')
        assert resp.status_code == 200
        # Verify removed
        resp = client.get(f'/api/bots/{bot_id}/timing')
        assert 't_app_load' not in resp.get_json()['overrides']

    def test_delete_all_overrides(self, auth_client):
        client, bot_id, preset_ids = auth_client
        client.post(f'/api/bots/{bot_id}/timing/override',
                    json={'param_name': 't_app_load',
                          'median': 2.0, 'sigma': 0.3,
                          'min_val': 0.5, 'max_val': 5.0})
        resp = client.delete(f'/api/bots/{bot_id}/timing/overrides')
        assert resp.status_code == 200
        resp = client.get(f'/api/bots/{bot_id}/timing')
        assert resp.get_json()['overrides'] == []

    def test_override_merges_with_preset(self, auth_client):
        client, bot_id, preset_ids = auth_client
        # Add override
        client.post(f'/api/bots/{bot_id}/timing/override',
                    json={'param_name': 't_app_load',
                          'median': 9.0, 'sigma': 0.1,
                          'min_val': 8.0, 'max_val': 10.0})
        resp = client.get(f'/api/bots/{bot_id}/timing')
        data = resp.get_json()
        # Override should replace preset value
        assert data['params']['t_app_load'][0] == 9.0


class TestCreateCustomPreset:
    def test_create_custom_preset(self, auth_client):
        client, bot_id, preset_ids = auth_client
        resp = client.post('/api/timing/presets',
                           json={'name': 'My Custom',
                                 'description': 'Custom preset',
                                 'params_json': {'t_app_load': [2.0, 0.3, 0.5, 5.0]}})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['preset']['is_default'] is False
