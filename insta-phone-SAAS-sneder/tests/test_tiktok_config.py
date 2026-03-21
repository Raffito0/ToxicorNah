"""Tests for tiktok_config.py — DB to phone-bot config translation."""
import os
import pytest
from app.models import Phone, Bot, BotAccount, User, Proxy, TimingPreset, TimingOverride
from app.tiktok_config import (build_phone_config, build_proxy_config,
                                build_timing_config, build_account_config,
                                apply_config_to_module)


def _make_user(db):
    u = User(username='testuser', email='test@test.com', password='hash')
    db.session.add(u)
    db.session.commit()
    return u


def _make_bot(db, user, **kwargs):
    defaults = dict(user_id=user.id, phone_id='phone1', name='TestBot')
    defaults.update(kwargs)
    bot = Bot(**defaults)
    db.session.add(bot)
    db.session.commit()
    return bot


def test_build_phone_config(app, db):
    """Phone model -> config dict."""
    phone = Phone(id=1, name='Galaxy S9+', model='SM-G965F',
                  screen_w=1080, screen_h=2220, density=420, retry_tolerance=3)
    db.session.add(phone)
    db.session.commit()

    cfg = build_phone_config(phone)
    assert cfg['id'] == 1
    assert cfg['name'] == 'Galaxy S9+'
    assert cfg['screen_w'] == 1080
    assert cfg['screen_h'] == 2220
    assert cfg['density'] == 420
    assert cfg['retry_tolerance'] == 3
    assert cfg['adb_serial'] is None


def test_build_proxy_config(app, db, monkeypatch):
    """Proxy model -> config dict with env vars resolved."""
    monkeypatch.setenv('PROXY_1_USERNAME', 'testuser')
    monkeypatch.setenv('PROXY_1_PASSWORD', 'testpass')
    monkeypatch.setenv('PROXY_1_ROTATION_URL', 'https://rotate.example.com')

    proxy = Proxy(name='Test', host='proxy.example.com', port=20002,
                  username_env='PROXY_1_USERNAME', password_env='PROXY_1_PASSWORD',
                  rotation_url_env='PROXY_1_ROTATION_URL')
    db.session.add(proxy)
    db.session.commit()

    cfg = build_proxy_config(proxy)
    assert cfg['host'] == 'proxy.example.com'
    assert cfg['port'] == 20002
    assert cfg['username'] == 'testuser'
    assert cfg['password'] == 'testpass'
    assert cfg['socks5_url'] == 'socks5://testuser:testpass@proxy.example.com:20002'
    assert cfg['rotation_url'] == 'https://rotate.example.com'


def test_build_proxy_config_missing_env(app, db):
    """Proxy config raises KeyError when env vars not set."""
    os.environ.pop('PROXY_MISSING_USER', None)
    proxy = Proxy(name='Bad', host='x', port=1,
                  username_env='PROXY_MISSING_USER', password_env='PROXY_MISSING_PASS')
    db.session.add(proxy)
    db.session.commit()

    with pytest.raises(KeyError):
        build_proxy_config(proxy)


def test_build_timing_config_preset_only(app, db):
    """TimingPreset params_json used when no overrides."""
    params = {'t_app_load': [4.0, 0.3, 2.0, 10.0], 't_nav_settle': [1.8, 0.3, 0.5, 5.0]}
    preset = TimingPreset(name='Normal', params_json=params)
    db.session.add(preset)
    db.session.commit()

    cfg = build_timing_config(preset)
    assert cfg['t_app_load'] == [4.0, 0.3, 2.0, 10.0]
    assert cfg['t_nav_settle'] == [1.8, 0.3, 0.5, 5.0]


def test_build_timing_config_with_overrides(app, db):
    """TimingOverride replaces specific params in preset."""
    params = {'t_app_load': [4.0, 0.3, 2.0, 10.0], 't_nav_settle': [1.8, 0.3, 0.5, 5.0]}
    preset = TimingPreset(name='Normal', params_json=params)
    db.session.add(preset)
    db.session.commit()

    u = _make_user(db)
    bot = _make_bot(db, u)
    override = TimingOverride(bot_id=bot.id, param_name='t_app_load',
                              median=6.0, sigma=0.5, min_val=3.0, max_val=15.0)
    db.session.add(override)
    db.session.commit()

    cfg = build_timing_config(preset, overrides=[override])
    assert cfg['t_app_load'] == [6.0, 0.5, 3.0, 15.0]  # overridden
    assert cfg['t_nav_settle'] == [1.8, 0.3, 0.5, 5.0]  # unchanged


def test_build_account_config(app, db):
    """BotAccount -> account config dict."""
    u = _make_user(db)
    bot = _make_bot(db, u, phone_ref_id=1, proxy_id=1, platform='tiktok')
    acct = BotAccount(bot_id=bot.id, clone_id='c1', username='ph1_tiktok',
                      password='pass', platform='tiktok')
    db.session.add(acct)
    db.session.commit()

    cfg = build_account_config(acct, bot)
    assert cfg['name'] == 'ph1_tiktok'
    assert cfg['phone_id'] == 1
    assert cfg['platform'] == 'tiktok'
    assert cfg['proxy_id'] == 'proxy-1'


def test_apply_config_patches_module(app, db, monkeypatch):
    """After apply_config_to_module(), phone_bot.config has DB values."""
    phone_cfg = {'id': 1, 'name': 'Test', 'screen_w': 720, 'screen_h': 1600,
                 'density': 280, 'model': 'TEST', 'adb_serial': None, 'retry_tolerance': 4}
    timing_cfg = {'t_app_load': [5.0, 0.4, 2.5, 12.0]}
    niche_cfg = {'description': 'Test niche', 'follow_threshold': 60,
                 'keywords': ['test1', 'test2']}

    apply_config_to_module(phone_cfg, timing_config=timing_cfg, niche_config=niche_cfg)

    from phone_bot import config
    assert config.PHONES == [phone_cfg]
    assert config.HUMAN['t_app_load'] == [5.0, 0.4, 2.5, 12.0]
    assert config.NICHE_DESCRIPTION == 'Test niche'
    assert config.NICHE_FOLLOW_THRESHOLD == 60
