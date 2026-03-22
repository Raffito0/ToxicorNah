"""Tests for Niche Config API (section-05)."""
import pytest
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db as _db
from app.models import User, Bot, BotAccount


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


@pytest.fixture
def auth_client(app, client):
    with app.app_context():
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
        _db.session.commit()
        with client.session_transaction() as sess:
            sess['_user_id'] = str(user.id)
        return client, account.id


class TestGetNiche:
    def test_get_returns_niche_config(self, auth_client):
        client, account_id = auth_client
        resp = client.get(f'/api/accounts/{account_id}/niche')
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'description' in data
        assert 'keywords' in data

    def test_get_null_returns_defaults(self, auth_client):
        client, account_id = auth_client
        resp = client.get(f'/api/accounts/{account_id}/niche')
        data = resp.get_json()
        assert data['follow_threshold'] == 55
        assert data['session_keywords_count'] == 8

    def test_requires_login(self, client):
        resp = client.get('/api/accounts/1/niche')
        assert resp.status_code in (302, 401)


class TestPutNiche:
    def test_put_updates_fields(self, auth_client):
        client, account_id = auth_client
        resp = client.put(f'/api/accounts/{account_id}/niche',
                          json={'description': 'fitness niche',
                                'keywords': ['gym', 'workout']})
        assert resp.status_code == 200
        resp = client.get(f'/api/accounts/{account_id}/niche')
        data = resp.get_json()
        assert data['description'] == 'fitness niche'
        assert data['keywords'] == ['gym', 'workout']

    def test_threshold_clamped(self, auth_client):
        client, account_id = auth_client
        client.put(f'/api/accounts/{account_id}/niche',
                   json={'follow_threshold': 100})
        resp = client.get(f'/api/accounts/{account_id}/niche')
        assert resp.get_json()['follow_threshold'] == 70

    def test_session_keywords_clamped(self, auth_client):
        client, account_id = auth_client
        client.put(f'/api/accounts/{account_id}/niche',
                   json={'session_keywords_count': 1})
        resp = client.get(f'/api/accounts/{account_id}/niche')
        assert resp.get_json()['session_keywords_count'] == 4

    def test_keywords_must_be_array(self, auth_client):
        client, account_id = auth_client
        resp = client.put(f'/api/accounts/{account_id}/niche',
                          json={'keywords': 'not-an-array'})
        assert resp.status_code == 400
