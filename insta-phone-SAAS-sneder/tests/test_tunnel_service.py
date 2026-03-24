"""Tests for tunnel_service.py and tunnel_routes.py."""
import pytest
import os
import sys
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.tunnel_service import TunnelManager


# --- TunnelManager unit tests ---

def test_start_launches_cloudflared_with_correct_args():
    mgr = TunnelManager(local_port=1090)
    with patch('app.tunnel_service.subprocess.Popen') as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_proc.pid = 1234
        mock_proc.stderr = MagicMock()
        mock_proc.stderr.readline.return_value = ''
        mock_popen.return_value = mock_proc
        result = mgr.start()
    assert result is True
    args = mock_popen.call_args[0][0]
    assert 'cloudflared' in args[0]
    assert 'tunnel' in args
    assert '--url' in args
    assert 'http://localhost:1090' in args
    mgr.stop()


def test_start_points_to_flask_not_scrcpy():
    mgr = TunnelManager(local_port=1090)
    with patch('app.tunnel_service.subprocess.Popen') as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_proc.pid = 1234
        mock_proc.stderr = MagicMock()
        mock_proc.stderr.readline.return_value = ''
        mock_popen.return_value = mock_proc
        mgr.start()
    cmd = ' '.join(mock_popen.call_args[0][0])
    assert '1090' in cmd
    assert '8000' not in cmd
    mgr.stop()


def test_parse_url_extracts_trycloudflare():
    url = TunnelManager._parse_url(
        '2024-01-01T00:00:00Z INF  | https://abc-def-ghi.trycloudflare.com |'
    )
    assert url == 'https://abc-def-ghi.trycloudflare.com'


def test_parse_url_returns_none_for_no_match():
    assert TunnelManager._parse_url('some random log line') is None


def test_parse_url_handles_noise():
    url = TunnelManager._parse_url(
        'blah blah https://my-tunnel-123.trycloudflare.com more stuff'
    )
    assert url == 'https://my-tunnel-123.trycloudflare.com'


def test_stop_terminates_process():
    mgr = TunnelManager(local_port=1090)
    mock_proc = MagicMock()
    mock_proc.poll.return_value = None
    mock_proc.pid = 5678
    mgr._process = mock_proc

    with patch('app.tunnel_service.sys') as mock_sys, \
         patch('app.tunnel_service.subprocess.run') as mock_run:
        mock_sys.platform = 'win32'
        mgr.stop()

    mock_run.assert_called_once()
    assert mgr._process is None
    assert mgr._url is None


def test_get_url_none_when_not_running():
    mgr = TunnelManager(local_port=1090)
    assert mgr.get_url() is None


def test_get_url_returns_parsed_url():
    mgr = TunnelManager(local_port=1090)
    mgr._url = 'https://test-tunnel.trycloudflare.com'
    assert mgr.get_url() == 'https://test-tunnel.trycloudflare.com'


def test_is_running_false_when_no_process():
    mgr = TunnelManager(local_port=1090)
    assert mgr.is_running() is False


def test_is_running_true_when_alive():
    mgr = TunnelManager(local_port=1090)
    mock_proc = MagicMock()
    mock_proc.poll.return_value = None
    mgr._process = mock_proc
    assert mgr.is_running() is True


# --- Route tests ---

@pytest.fixture
def app(tmp_path):
    os.environ['TESTING'] = '1'
    db_file = str(tmp_path / 'test.db')
    from app import create_app, db as _db
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


def _login(client):
    from app.models import User
    from werkzeug.security import generate_password_hash
    from app import db as _db
    user = User(username='test', email='t@t.com',
                password=generate_password_hash('pw'))
    _db.session.add(user)
    _db.session.commit()
    with client.session_transaction() as sess:
        sess['_user_id'] = str(user.id)


def test_status_endpoint(app, client):
    with app.app_context():
        _login(client)
    with patch('app.tunnel_routes.get_manager') as mock_get:
        mock_mgr = MagicMock()
        mock_mgr.is_running.return_value = False
        mock_mgr.get_url.return_value = None
        mock_mgr._port = 1090
        mock_get.return_value = mock_mgr
        resp = client.get('/api/tunnel/status')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['running'] is False
    assert data['url'] is None
    assert data['local_port'] == 1090


def test_start_endpoint(app, client):
    with app.app_context():
        _login(client)
    with patch('app.tunnel_routes.get_manager') as mock_get:
        mock_mgr = MagicMock()
        mock_mgr.start.return_value = True
        mock_get.return_value = mock_mgr
        resp = client.post('/api/tunnel/start')
    assert resp.status_code == 200
    assert resp.get_json()['started'] is True


def test_stop_endpoint(app, client):
    with app.app_context():
        _login(client)
    with patch('app.tunnel_routes.get_manager') as mock_get:
        mock_mgr = MagicMock()
        mock_mgr.is_running.return_value = True
        mock_get.return_value = mock_mgr
        resp = client.post('/api/tunnel/stop')
    assert resp.status_code == 200
    assert resp.get_json()['stopped'] is True
