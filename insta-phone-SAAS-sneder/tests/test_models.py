"""Tests for Phone, Bot, BotAccount, Proxy, ProxyRotation models."""
import os
import time
import pytest
from sqlalchemy.exc import IntegrityError
from app.models import Phone, Bot, BotAccount, User, Proxy, ProxyRotation


def test_phone_table_created(app, db):
    """After db.create_all(), the phone table should exist with all columns."""
    inspector = db.inspect(db.engine)
    tables = inspector.get_table_names()
    assert 'phone' in tables

    columns = {col['name'] for col in inspector.get_columns('phone')}
    expected = {'id', 'name', 'model', 'adb_serial', 'screen_w', 'screen_h',
                'density', 'retry_tolerance', 'created_at', 'updated_at'}
    assert expected.issubset(columns)


def test_phone_explicit_id(app, db):
    """Phone(id=1, name='Galaxy S9+', model='SM-G965F') should persist with id=1."""
    phone = Phone(id=1, name='Galaxy S9+', model='SM-G965F')
    db.session.add(phone)
    db.session.commit()

    result = db.session.get(Phone, 1)
    assert result is not None
    assert result.id == 1
    assert result.name == 'Galaxy S9+'
    assert result.model == 'SM-G965F'


def test_phone_duplicate_id(app, db):
    """Inserting two Phone records with the same id should raise IntegrityError."""
    phone1 = Phone(id=1, name='Phone A', model='Model A')
    db.session.add(phone1)
    db.session.commit()

    phone2 = Phone(id=1, name='Phone B', model='Model B')
    db.session.add(phone2)
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_phone_defaults(app, db):
    """Phone created with only id/name/model should have correct defaults."""
    phone = Phone(id=1, name='Test Phone', model='TEST-001')
    db.session.add(phone)
    db.session.commit()

    result = db.session.get(Phone, 1)
    assert result.screen_w == 1080
    assert result.screen_h == 2220
    assert result.density == 420
    assert result.retry_tolerance == 3


def test_phone_adb_serial_nullable(app, db):
    """Phone can be created without adb_serial (it's auto-detected at runtime)."""
    phone = Phone(id=1, name='Test Phone', model='TEST-001')
    db.session.add(phone)
    db.session.commit()

    result = db.session.get(Phone, 1)
    assert result.adb_serial is None


def test_phone_updated_at(app, db):
    """After modifying a Phone and committing, updated_at should change."""
    phone = Phone(id=1, name='Test Phone', model='TEST-001')
    db.session.add(phone)
    db.session.commit()

    original_updated = phone.updated_at
    time.sleep(0.1)

    phone.name = 'Updated Phone'
    db.session.commit()

    result = db.session.get(Phone, 1)
    assert result.updated_at > original_updated


# ─── Section 02: Bot extensions ────────────────────────────────────

def _make_user(db):
    """Helper to create a User for Bot FK."""
    u = User(username='testuser', email='test@test.com', password='hash')
    db.session.add(u)
    db.session.commit()
    return u


def _make_bot(db, user, **kwargs):
    """Helper to create a Bot with required fields."""
    defaults = dict(user_id=user.id, phone_id='phone1', name='TestBot')
    defaults.update(kwargs)
    bot = Bot(**defaults)
    db.session.add(bot)
    db.session.commit()
    return bot


def test_bot_new_fields(app, db):
    """Bot with platform='tiktok', control_status='running' should persist."""
    u = _make_user(db)
    bot = _make_bot(db, u, platform='tiktok', control_status='running',
                    always_on=True, dry_run=True)
    result = db.session.get(Bot, bot.id)
    assert result.platform == 'tiktok'
    assert result.control_status == 'running'
    assert result.always_on is True
    assert result.dry_run is True


def test_bot_platform_default(app, db):
    """Bot created without platform should default to 'instagram'."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    assert bot.platform == 'instagram'


def test_bot_control_status_default(app, db):
    """Bot created without control_status should default to 'stopped'."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    assert bot.control_status == 'stopped'


def test_bot_always_on_default(app, db):
    """Bot.always_on should default to False."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    assert bot.always_on is False


def test_bot_dry_run_default(app, db):
    """Bot.dry_run should default to False."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    assert bot.dry_run is False


def test_bot_phone_ref_fk(app, db):
    """Bot.phone_ref_id should reference an existing Phone record."""
    u = _make_user(db)
    phone = Phone(id=1, name='Galaxy S9+', model='SM-G965F')
    db.session.add(phone)
    db.session.commit()
    bot = _make_bot(db, u, phone_ref_id=1)
    result = db.session.get(Bot, bot.id)
    assert result.phone_ref_id == 1


def test_bot_backward_compat(app, db):
    """Bot created with only original fields should work."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    assert bot.proxy_id is None
    assert bot.timing_preset_id is None
    assert bot.phone_ref_id is None
    assert bot.scrcpy_port is None


def test_bot_dual_status(app, db):
    """Bot.status and Bot.control_status are independent."""
    u = _make_user(db)
    bot = _make_bot(db, u, status='active', control_status='running')
    result = db.session.get(Bot, bot.id)
    assert result.status == 'active'
    assert result.control_status == 'running'


# ─── Section 02: BotAccount extensions ─────────────────────────────

def _make_account(db, bot, **kwargs):
    """Helper to create a BotAccount with required fields."""
    defaults = dict(bot_id=bot.id, clone_id='clone1',
                    username='testaccount', password='pass')
    defaults.update(kwargs)
    acct = BotAccount(**defaults)
    db.session.add(acct)
    db.session.commit()
    return acct


def test_botaccount_personality_json(app, db):
    """personality_json with traits should round-trip as dict."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    traits = {"reels_preference": 0.5, "story_affinity": 0.2, "boredom_rate": 0.12}
    acct = _make_account(db, bot, personality_json=traits)
    result = db.session.get(BotAccount, acct.id)
    assert result.personality_json == traits


def test_botaccount_json_type(app, db):
    """After read from DB, personality_json should be a Python dict."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot, personality_json={"key": "value"})
    result = db.session.get(BotAccount, acct.id)
    assert isinstance(result.personality_json, dict)


def test_botaccount_warmup_json(app, db):
    """warmup_json with nested structure should round-trip correctly."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    warmup = {"current_day": 3, "completed": False,
              "warmup_plan": {"1": {"type": "normal", "likes": 0}}}
    acct = _make_account(db, bot, warmup_json=warmup)
    result = db.session.get(BotAccount, acct.id)
    assert result.warmup_json["warmup_plan"]["1"]["type"] == "normal"


def test_botaccount_niche_json(app, db):
    """niche_json with keywords list should round-trip correctly."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    niche = {"keywords": ["toxic", "red flags"], "follow_threshold": 55}
    acct = _make_account(db, bot, niche_json=niche)
    result = db.session.get(BotAccount, acct.id)
    assert result.niche_json["keywords"] == ["toxic", "red flags"]


def test_botaccount_notify_default(app, db):
    """notify_before_post should default to True."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    assert acct.notify_before_post is True


def test_botaccount_warmup_completed_true(app, db):
    """When warmup_json has completed=true, warmup_completed returns True."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot, warmup_json={"completed": True})
    assert acct.warmup_completed is True


def test_botaccount_warmup_completed_none(app, db):
    """When warmup_json is None, warmup_completed returns False."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    assert acct.warmup_completed is False


def test_botaccount_platform_default(app, db):
    """BotAccount without platform should default to 'instagram'."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    assert acct.platform == 'instagram'


def test_botaccount_backward_compat(app, db):
    """BotAccount with only original fields should work."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    assert acct.personality_json is None
    assert acct.warmup_json is None
    assert acct.niche_json is None


def test_botaccount_json_replace(app, db):
    """Read personality_json, modify a trait, write entire dict back."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot, personality_json={"reels_preference": 0.5})
    # Read, modify, write
    data = dict(acct.personality_json)
    data["reels_preference"] = 0.9
    acct.personality_json = data
    db.session.commit()
    result = db.session.get(BotAccount, acct.id)
    assert result.personality_json["reels_preference"] == 0.9


# ─── Section 03: Proxy / ProxyRotation ─────────────────────────────

def _make_proxy(db, **kwargs):
    """Helper to create a Proxy with required fields."""
    defaults = dict(name='Florida Mobile', host='sinister.services', port=20002,
                    username_env='PROXY_1_USERNAME', password_env='PROXY_1_PASSWORD')
    defaults.update(kwargs)
    proxy = Proxy(**defaults)
    db.session.add(proxy)
    db.session.commit()
    return proxy


def test_proxy_creates(app, db):
    """Proxy with host, port, env var names should persist."""
    proxy = _make_proxy(db)
    result = db.session.get(Proxy, proxy.id)
    assert result.name == 'Florida Mobile'
    assert result.host == 'sinister.services'
    assert result.port == 20002
    assert result.username_env == 'PROXY_1_USERNAME'
    assert result.password_env == 'PROXY_1_PASSWORD'


def test_proxy_status_default(app, db):
    """Proxy created without status should default to 'active'."""
    proxy = _make_proxy(db)
    assert proxy.status == 'active'


def test_proxy_socks5_url(app, db, monkeypatch):
    """socks5_url should compute URL from env vars."""
    monkeypatch.setenv('PROXY_1_USERNAME', 'testuser')
    monkeypatch.setenv('PROXY_1_PASSWORD', 'testpass')
    proxy = _make_proxy(db)
    assert proxy.socks5_url == 'socks5://testuser:testpass@sinister.services:20002'


def test_proxy_socks5_url_missing_env(app, db):
    """socks5_url should raise KeyError when env var is not set."""
    proxy = _make_proxy(db)
    # Ensure env vars are NOT set
    os.environ.pop('PROXY_1_USERNAME', None)
    os.environ.pop('PROXY_1_PASSWORD', None)
    with pytest.raises(KeyError):
        _ = proxy.socks5_url


def test_proxy_rotation_fk(app, db):
    """ProxyRotation with proxy_id referencing Proxy should persist."""
    proxy = _make_proxy(db)
    rotation = ProxyRotation(proxy_id=proxy.id, old_ip='1.2.3.4',
                             new_ip='5.6.7.8', triggered_by='manual',
                             status='success')
    db.session.add(rotation)
    db.session.commit()
    result = db.session.get(ProxyRotation, rotation.id)
    assert result.proxy_id == proxy.id
    assert result.old_ip == '1.2.3.4'
    assert result.new_ip == '5.6.7.8'


def test_proxy_rotation_status(app, db):
    """ProxyRotation status should accept both 'success' and 'failed'."""
    proxy = _make_proxy(db)
    r1 = ProxyRotation(proxy_id=proxy.id, old_ip='1.1.1.1', new_ip='2.2.2.2',
                       triggered_by='session_switch', status='success')
    r2 = ProxyRotation(proxy_id=proxy.id, old_ip='2.2.2.2',
                       triggered_by='health_check', status='failed',
                       error_message='Timeout')
    db.session.add_all([r1, r2])
    db.session.commit()
    assert db.session.get(ProxyRotation, r1.id).status == 'success'
    assert db.session.get(ProxyRotation, r2.id).status == 'failed'


def test_proxy_rotation_error_nullable(app, db):
    """ProxyRotation can be created without error_message."""
    proxy = _make_proxy(db)
    rotation = ProxyRotation(proxy_id=proxy.id, old_ip='1.2.3.4',
                             new_ip='5.6.7.8', triggered_by='manual',
                             status='success')
    db.session.add(rotation)
    db.session.commit()
    assert db.session.get(ProxyRotation, rotation.id).error_message is None


def test_proxy_rotation_index(app, db):
    """The composite index on (proxy_id, rotated_at) should exist."""
    inspector = db.inspect(db.engine)
    indexes = inspector.get_indexes('proxy_rotation')
    index_names = [idx['name'] for idx in indexes]
    assert 'ix_proxy_rotation_history' in index_names
