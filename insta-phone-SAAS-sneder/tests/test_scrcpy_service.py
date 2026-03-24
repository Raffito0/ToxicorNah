"""Tests for scrcpy_service.py and scrcpy_routes.py."""
import pytest
import os
import sys
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.scrcpy_service import ScrcpyManager


# --- ScrcpyManager unit tests ---

def test_start_uses_node_not_npm():
    mgr = ScrcpyManager(port=8000)
    mgr._ws_scrcpy_dir = '/fake/dir'
    with patch('app.scrcpy_service.subprocess.Popen') as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_proc.pid = 1234
        mock_popen.return_value = mock_proc
        result = mgr.start()
    assert result is True
    mock_popen.assert_called_once()
    args = mock_popen.call_args
    assert args[0][0] == ['node', 'index.js']
    assert args[1]['cwd'] == '/fake/dir'
    mgr.stop()


def test_stop_kills_process_tree_windows():
    mgr = ScrcpyManager(port=8000)
    mock_proc = MagicMock()
    mock_proc.poll.return_value = None
    mock_proc.pid = 5678
    mgr._process = mock_proc

    with patch('app.scrcpy_service.platform.system', return_value='Windows'), \
         patch('app.scrcpy_service.subprocess.run') as mock_run:
        mgr.stop()

    mock_run.assert_called_once()
    call_args = mock_run.call_args[0][0]
    assert call_args == ['taskkill', '/F', '/T', '/PID', '5678']
    assert mgr._process is None


def test_is_running_true_when_process_alive():
    mgr = ScrcpyManager(port=8000)
    mock_proc = MagicMock()
    mock_proc.poll.return_value = None
    mgr._process = mock_proc
    assert mgr.is_running() is True


def test_is_running_false_when_process_dead():
    mgr = ScrcpyManager(port=8000)
    mock_proc = MagicMock()
    mock_proc.poll.return_value = 0
    mgr._process = mock_proc
    assert mgr.is_running() is False


def test_is_running_false_when_no_process():
    mgr = ScrcpyManager(port=8000)
    assert mgr.is_running() is False


def test_get_url_returns_localhost_url():
    mgr = ScrcpyManager(port=8000)
    mock_proc = MagicMock()
    mock_proc.poll.return_value = None
    mgr._process = mock_proc
    assert mgr.get_url() == 'http://localhost:8000'


def test_get_url_returns_none_when_stopped():
    mgr = ScrcpyManager(port=8000)
    assert mgr.get_url() is None


def test_start_noop_when_already_running():
    mgr = ScrcpyManager(port=8000)
    mgr._ws_scrcpy_dir = '/fake/dir'
    with patch('app.scrcpy_service.subprocess.Popen') as mock_popen:
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_proc.pid = 1234
        mock_popen.return_value = mock_proc
        mgr.start()
        result = mgr.start()
    assert result is False
    assert mock_popen.call_count == 1
    mgr.stop()


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


def test_status_endpoint_stopped(app, client):
    with app.app_context():
        _login(client)
    with patch('app.scrcpy_routes.scrcpy_manager') as mock_mgr:
        mock_mgr.is_running.return_value = False
        mock_mgr._port = 8000
        mock_mgr.get_url.return_value = None
        resp = client.get('/api/scrcpy/status')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['running'] is False
    assert data['url'] is None


def test_status_endpoint_running(app, client):
    with app.app_context():
        _login(client)
    with patch('app.scrcpy_routes.scrcpy_manager') as mock_mgr:
        mock_mgr.is_running.return_value = True
        mock_mgr._port = 8000
        mock_mgr.get_url.return_value = 'http://localhost:8000'
        resp = client.get('/api/scrcpy/status')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['running'] is True
    assert data['url'] == 'http://localhost:8000'


def test_start_endpoint(app, client):
    with app.app_context():
        _login(client)
    with patch('app.scrcpy_routes.scrcpy_manager') as mock_mgr, \
         patch('app.scrcpy_routes.os.path.isdir', return_value=True):
        mock_mgr._ws_scrcpy_dir = '/fake'
        mock_mgr.start.return_value = True
        mock_mgr.get_url.return_value = 'http://localhost:8000'
        resp = client.post('/api/scrcpy/start')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['started'] is True
    assert data['url'] == 'http://localhost:8000'


def test_stop_endpoint(app, client):
    with app.app_context():
        _login(client)
    with patch('app.scrcpy_routes.scrcpy_manager') as mock_mgr:
        resp = client.post('/api/scrcpy/stop')
    assert resp.status_code == 200
    assert resp.get_json()['stopped'] is True
