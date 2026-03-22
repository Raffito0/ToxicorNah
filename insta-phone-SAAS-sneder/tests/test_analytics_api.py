"""Tests for TikTok + Gemini analytics API (section-02 of 06-analytics)."""
import pytest
import os
import sys
import json
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db as _db
from app.models import User, Bot, BotAccount, SessionLog, GeminiUsage, Phone


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

    bot = Bot(user_id=user.id, phone_id='1', name='TKBot', platform='tiktok',
              phone_ref_id=1)
    db.session.add(bot)
    db.session.flush()

    account = BotAccount(bot_id=bot.id, clone_id='c1', username='tk_user', password='p')
    db.session.add(account)
    db.session.commit()
    return user, bot, account


@pytest.fixture
def auth_client(app, client):
    with app.app_context():
        user, bot, account = _seed(_db)
        account_id = account.id
        bot_id = bot.id
        with client.session_transaction() as sess:
            sess['_user_id'] = str(user.id)
        return client, bot_id, account_id


class TestTikTokEndpoint:
    def test_empty_db_returns_structure(self, auth_client):
        client, bot_id, account_id = auth_client
        resp = client.get('/api/analysis/tiktok')
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'daily_engagement' in data
        assert 'videos_posted' in data
        assert 'phase_distribution' in data
        assert 'follow_back_stats' in data

    def test_daily_engagement_aggregates(self, auth_client, app):
        client, bot_id, account_id = auth_client
        with app.app_context():
            now = datetime.now(timezone.utc)
            _db.session.add(SessionLog(
                bot_account_id=account_id, session_id='s1',
                started_at=now, session_type='normal', status='completed',
                actions_json={'likes': 5, 'comments': 2, 'follows': 1}
            ))
            _db.session.add(SessionLog(
                bot_account_id=account_id, session_id='s2',
                started_at=now, session_type='normal', status='completed',
                actions_json={'likes': 3, 'comments': 1, 'follows': 0}
            ))
            _db.session.commit()

        resp = client.get('/api/analysis/tiktok')
        data = resp.get_json()
        today = data['daily_engagement']
        assert len(today) >= 1
        # Should aggregate: likes=8, comments=3, follows=1
        day_data = today[-1]  # most recent
        assert day_data['likes'] == 8
        assert day_data['comments'] == 3

    def test_videos_posted_groups(self, auth_client, app):
        client, bot_id, account_id = auth_client
        with app.app_context():
            now = datetime.now(timezone.utc)
            _db.session.add(SessionLog(
                bot_account_id=account_id, session_id='s1',
                started_at=now, session_type='normal', status='completed',
                post_outcome='posted', actions_json={}
            ))
            _db.session.add(SessionLog(
                bot_account_id=account_id, session_id='s2',
                started_at=now, session_type='normal', status='completed',
                post_outcome='draft', actions_json={}
            ))
            _db.session.commit()

        resp = client.get('/api/analysis/tiktok')
        data = resp.get_json()
        vp = data['videos_posted']
        assert len(vp) >= 1
        assert vp[0]['posted'] >= 1

    def test_date_range_filtering(self, auth_client, app):
        client, bot_id, account_id = auth_client
        with app.app_context():
            now = datetime.now(timezone.utc)
            _db.session.add(SessionLog(
                bot_account_id=account_id, session_id='s1',
                started_at=now - timedelta(days=3), session_type='normal',
                status='completed', actions_json={'likes': 5}
            ))
            _db.session.add(SessionLog(
                bot_account_id=account_id, session_id='s2',
                started_at=now - timedelta(days=10), session_type='normal',
                status='completed', actions_json={'likes': 99}
            ))
            _db.session.commit()

        resp = client.get('/api/analysis/tiktok?days=7')
        data = resp.get_json()
        total_likes = sum(d.get('likes', 0) for d in data['daily_engagement'])
        assert total_likes == 5  # only the 3-day-old one

    def test_requires_login(self, client):
        resp = client.get('/api/analysis/tiktok')
        assert resp.status_code in (302, 401)


class TestGeminiEndpoint:
    def test_aggregates_by_day(self, auth_client, app):
        client, bot_id, account_id = auth_client
        with app.app_context():
            now = datetime.now(timezone.utc)
            _db.session.add(GeminiUsage(call_type='bbox', latency_ms=400,
                                         success=True, created_at=now))
            _db.session.add(GeminiUsage(call_type='popup', latency_ms=300,
                                         success=False, created_at=now))
            _db.session.commit()

        resp = client.get('/api/analysis/gemini')
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['daily_calls']) >= 1
        assert data['daily_calls'][-1]['calls'] == 2
        assert data['daily_calls'][-1]['errors'] == 1

    def test_by_type_breakdown(self, auth_client, app):
        client, bot_id, account_id = auth_client
        with app.app_context():
            for _ in range(3):
                _db.session.add(GeminiUsage(call_type='bbox', latency_ms=400, success=True))
            _db.session.add(GeminiUsage(call_type='popup', latency_ms=300, success=True))
            _db.session.commit()

        resp = client.get('/api/analysis/gemini')
        data = resp.get_json()
        bbox_entry = next(t for t in data['by_type'] if t['type'] == 'bbox')
        assert bbox_entry['count'] == 3

    def test_requires_login(self, client):
        resp = client.get('/api/analysis/gemini')
        assert resp.status_code in (302, 401)
