"""Tests for Phone, Bot, BotAccount, Proxy, ProxyRotation models."""
import json
import os
import time
import pytest
from sqlalchemy.exc import IntegrityError
from app.models import (Phone, Bot, BotAccount, User, Proxy, ProxyRotation,
                        TimingPreset, TimingOverride, WeeklyPlan, SessionLog,
                        InterventionLog)
from app import ensure_columns
from app.seed_tiktok import (seed_phones, seed_proxy, seed_presets,
                              migrate_warmup, migrate_personality,
                              migrate_niche, NORMAL_PARAMS)


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


# ─── Section 04: TimingPreset / TimingOverride ─────────────────────

def test_timing_preset_json(app, db):
    """TimingPreset with params_json should round-trip as dict."""
    params = {"t_app_load": [4.0, 0.3, 2.0, 10.0],
              "t_scroll_pause": [1.5, 0.4, 0.5, 5.0]}
    preset = TimingPreset(name='Normal', params_json=params)
    db.session.add(preset)
    db.session.commit()
    result = db.session.get(TimingPreset, preset.id)
    assert result.params_json["t_app_load"] == [4.0, 0.3, 2.0, 10.0]


def test_timing_preset_is_default(app, db):
    """is_default=True should persist and be queryable."""
    preset = TimingPreset(name='Normal', params_json={}, is_default=True)
    db.session.add(preset)
    db.session.commit()
    result = TimingPreset.query.filter_by(is_default=True).first()
    assert result is not None
    assert result.name == 'Normal'


def test_timing_override_unique(app, db):
    """TimingOverride unique constraint on (bot_id, param_name)."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    o1 = TimingOverride(bot_id=bot.id, param_name='t_app_load',
                        median=5.0, sigma=0.4, min_val=2.0, max_val=12.0)
    db.session.add(o1)
    db.session.commit()
    # Same bot_id + param_name should fail
    o2 = TimingOverride(bot_id=bot.id, param_name='t_app_load',
                        median=3.0, sigma=0.2, min_val=1.0, max_val=8.0)
    db.session.add(o2)
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_timing_override_different_params(app, db):
    """Same bot with different param_name should succeed."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    o1 = TimingOverride(bot_id=bot.id, param_name='t_app_load',
                        median=5.0, sigma=0.4, min_val=2.0, max_val=12.0)
    o2 = TimingOverride(bot_id=bot.id, param_name='t_scroll_pause',
                        median=1.5, sigma=0.3, min_val=0.5, max_val=4.0)
    db.session.add_all([o1, o2])
    db.session.commit()
    assert db.session.get(TimingOverride, o1.id).param_name == 't_app_load'
    assert db.session.get(TimingOverride, o2.id).param_name == 't_scroll_pause'


def test_timing_override_fk(app, db):
    """TimingOverride.bot_id should reference an existing Bot record."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    override = TimingOverride(bot_id=bot.id, param_name='t_like_delay',
                              median=0.8, sigma=0.3, min_val=0.3, max_val=3.0)
    db.session.add(override)
    db.session.commit()
    result = db.session.get(TimingOverride, override.id)
    assert result.bot_id == bot.id


def test_timing_preset_updated_at(app, db):
    """After modifying a TimingPreset, updated_at should change."""
    preset = TimingPreset(name='Test', params_json={"a": [1, 2, 3, 4]})
    db.session.add(preset)
    db.session.commit()
    original = preset.updated_at
    time.sleep(0.1)
    preset.name = 'Updated'
    db.session.commit()
    result = db.session.get(TimingPreset, preset.id)
    assert result.updated_at > original


# ─── Section 05: WeeklyPlan / SessionLog / InterventionLog ─────────

def test_weeklyplan_creates(app, db):
    """WeeklyPlan with proxy_id, week_number, year, plan_json should persist."""
    proxy = _make_proxy(db)
    plan = WeeklyPlan(proxy_id=proxy.id, week_number=12, year=2026,
                      plan_json={"monday": [{"account": "ph1_tiktok"}]})
    db.session.add(plan)
    db.session.commit()
    result = db.session.get(WeeklyPlan, plan.id)
    assert result.proxy_id == proxy.id
    assert result.week_number == 12
    assert result.year == 2026
    assert result.status == 'active'


def test_weeklyplan_unique(app, db):
    """Two WeeklyPlan with same (proxy_id, week_number, year) should raise IntegrityError."""
    proxy = _make_proxy(db)
    p1 = WeeklyPlan(proxy_id=proxy.id, week_number=12, year=2026, plan_json={})
    db.session.add(p1)
    db.session.commit()
    p2 = WeeklyPlan(proxy_id=proxy.id, week_number=12, year=2026, plan_json={})
    db.session.add(p2)
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()


def test_weeklyplan_different_week(app, db):
    """Same proxy, different week should succeed."""
    proxy = _make_proxy(db)
    p1 = WeeklyPlan(proxy_id=proxy.id, week_number=12, year=2026, plan_json={})
    p2 = WeeklyPlan(proxy_id=proxy.id, week_number=13, year=2026, plan_json={})
    db.session.add_all([p1, p2])
    db.session.commit()
    assert p1.id != p2.id


def test_weeklyplan_json(app, db):
    """plan_json with nested session objects should round-trip correctly."""
    proxy = _make_proxy(db)
    plan_data = {"monday": [{"account": "ph1_tiktok", "start_time": "09:00",
                             "type": "normal", "post_scheduled": True}]}
    plan = WeeklyPlan(proxy_id=proxy.id, week_number=12, year=2026, plan_json=plan_data)
    db.session.add(plan)
    db.session.commit()
    result = db.session.get(WeeklyPlan, plan.id)
    assert result.plan_json["monday"][0]["account"] == "ph1_tiktok"
    assert result.plan_json["monday"][0]["post_scheduled"] is True


def test_sessionlog_creates(app, db):
    """SessionLog with bot_account_id, session_id, started_at should persist."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    from datetime import datetime as dt, timezone as tz
    log = SessionLog(bot_account_id=acct.id, session_id='uuid-123',
                     started_at=dt.now(tz.utc), session_type='normal',
                     status='running')
    db.session.add(log)
    db.session.commit()
    result = db.session.get(SessionLog, log.id)
    assert result.session_id == 'uuid-123'
    assert result.session_type == 'normal'


def test_sessionlog_ended_at_nullable(app, db):
    """A running session has ended_at=None."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    from datetime import datetime as dt, timezone as tz
    log = SessionLog(bot_account_id=acct.id, session_id='uuid-456',
                     started_at=dt.now(tz.utc), session_type='normal',
                     status='running')
    db.session.add(log)
    db.session.commit()
    assert db.session.get(SessionLog, log.id).ended_at is None


def test_sessionlog_phase_log(app, db):
    """phase_log_json should round-trip correctly."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    from datetime import datetime as dt, timezone as tz
    phases = [{"phase": "warmup", "actions_count": 5},
              {"phase": "peak", "actions_count": 12}]
    log = SessionLog(bot_account_id=acct.id, session_id='uuid-789',
                     started_at=dt.now(tz.utc), session_type='normal',
                     status='completed', phase_log_json=phases)
    db.session.add(log)
    db.session.commit()
    result = db.session.get(SessionLog, log.id)
    assert result.phase_log_json[0]["phase"] == "warmup"
    assert result.phase_log_json[1]["actions_count"] == 12


def test_sessionlog_dry_run_default(app, db):
    """SessionLog.dry_run should default to False."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    from datetime import datetime as dt, timezone as tz
    log = SessionLog(bot_account_id=acct.id, session_id='uuid-dry',
                     started_at=dt.now(tz.utc), session_type='normal',
                     status='running')
    db.session.add(log)
    db.session.commit()
    assert db.session.get(SessionLog, log.id).dry_run is False


def test_sessionlog_index(app, db):
    """The composite index on (bot_account_id, started_at) should exist."""
    inspector = db.inspect(db.engine)
    indexes = inspector.get_indexes('session_log')
    index_names = [idx['name'] for idx in indexes]
    assert 'ix_session_log_account_date' in index_names


def test_interventionlog_creates(app, db):
    """InterventionLog with required fields should persist."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    log = InterventionLog(bot_account_id=acct.id, session_id='uuid-int',
                          intervention_type='post_approval')
    db.session.add(log)
    db.session.commit()
    result = db.session.get(InterventionLog, log.id)
    assert result.intervention_type == 'post_approval'


def test_interventionlog_resolved_at_nullable(app, db):
    """A pending intervention has resolved_at=None."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    log = InterventionLog(bot_account_id=acct.id, session_id='uuid-pend',
                          intervention_type='takeover')
    db.session.add(log)
    db.session.commit()
    assert db.session.get(InterventionLog, log.id).resolved_at is None


def test_interventionlog_resolution_nullable(app, db):
    """A pending intervention has resolution=None."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    log = InterventionLog(bot_account_id=acct.id, session_id='uuid-res',
                          intervention_type='skip')
    db.session.add(log)
    db.session.commit()
    assert db.session.get(InterventionLog, log.id).resolution is None


def test_interventionlog_fk(app, db):
    """InterventionLog.bot_account_id should reference an existing BotAccount."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    log = InterventionLog(bot_account_id=acct.id, session_id='uuid-fk',
                          intervention_type='post_approval',
                          resolution='done')
    db.session.add(log)
    db.session.commit()
    result = db.session.get(InterventionLog, log.id)
    assert result.bot_account_id == acct.id
    assert result.resolution == 'done'


# ─── Section 06: ensure_columns ────────────────────────────────────

def test_ensure_columns_fresh_db(app, db):
    """On a fresh DB, ensure_columns should not raise."""
    ensure_columns(db)


def test_ensure_columns_idempotent(app, db):
    """Calling ensure_columns twice in a row should not raise any errors."""
    ensure_columns(db)
    ensure_columns(db)


def test_ensure_columns_bot_platform(app, db):
    """After ensure_columns, Bot.platform column exists and is queryable."""
    ensure_columns(db)
    u = _make_user(db)
    bot = _make_bot(db, u, platform='tiktok')
    result = db.session.get(Bot, bot.id)
    assert result.platform == 'tiktok'


def test_ensure_columns_botaccount_json(app, db):
    """After ensure_columns, personality_json column should be usable."""
    ensure_columns(db)
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot, personality_json={"reels_preference": 0.5})
    result = db.session.get(BotAccount, acct.id)
    assert result.personality_json["reels_preference"] == 0.5


def test_full_schema_creation(app, db):
    """db.create_all() + ensure_columns() should result in full schema."""
    ensure_columns(db)
    # Test all new models are usable
    phone = Phone(id=1, name='Test', model='TEST')
    proxy = Proxy(name='P1', host='h', port=1, username_env='U', password_env='P')
    preset = TimingPreset(name='Normal', params_json={"a": [1, 2, 3, 4]})
    db.session.add_all([phone, proxy, preset])
    db.session.commit()
    assert db.session.get(Phone, 1) is not None
    assert db.session.get(Proxy, proxy.id) is not None
    assert db.session.get(TimingPreset, preset.id) is not None


# ─── Section 07: Seed script ──────────────────────────────────────

def test_seed_phones(app, db):
    """After seed_phones(), Phone.query.count() == 4."""
    count = seed_phones(db)
    assert count == 4
    assert Phone.query.count() == 4
    p1 = db.session.get(Phone, 1)
    assert p1.name == 'Galaxy S9+'
    assert p1.screen_w == 1080
    p4 = db.session.get(Phone, 4)
    assert p4.name == 'Motorola E22i'
    assert p4.density == 280
    assert p4.retry_tolerance == 4


def test_seed_phones_idempotent(app, db):
    """Calling seed_phones() twice should still result in 4."""
    seed_phones(db)
    seed_phones(db)
    assert Phone.query.count() == 4


def test_seed_proxy(app, db):
    """After seed_proxy(), Proxy with sinister.services exists."""
    count = seed_proxy(db)
    assert count == 1
    proxy = Proxy.query.filter_by(host='sinister.services').first()
    assert proxy is not None
    assert proxy.username_env == 'PROXY_1_USERNAME'
    assert proxy.password_env == 'PROXY_1_PASSWORD'


def test_seed_proxy_idempotent(app, db):
    """Calling seed_proxy() twice should still result in 1."""
    seed_proxy(db)
    seed_proxy(db)
    assert Proxy.query.count() == 1


def test_seed_presets_count(app, db):
    """After seed_presets(), TimingPreset.query.count() == 4."""
    count = seed_presets(db)
    assert count == 4
    assert TimingPreset.query.count() == 4


def test_seed_presets_normal(app, db):
    """Normal preset should contain key timing params."""
    seed_presets(db)
    normal = TimingPreset.query.filter_by(name='Normal').first()
    assert 't_app_load' in normal.params_json
    assert 't_scroll_pause' in normal.params_json or 't_nav_settle' in normal.params_json
    assert normal.is_default is True


def test_seed_presets_cautious(app, db):
    """Cautious median should be Normal * 1.3."""
    seed_presets(db)
    normal = TimingPreset.query.filter_by(name='Normal').first()
    cautious = TimingPreset.query.filter_by(name='Cautious').first()
    for param in ['t_app_load', 't_nav_settle']:
        n_median = normal.params_json[param][0]
        c_median = cautious.params_json[param][0]
        assert abs(c_median - n_median * 1.3) < 0.01


def test_seed_presets_aggressive(app, db):
    """Aggressive median should be Normal * 0.7."""
    seed_presets(db)
    normal = TimingPreset.query.filter_by(name='Normal').first()
    aggressive = TimingPreset.query.filter_by(name='Aggressive').first()
    for param in ['t_app_load', 't_nav_settle']:
        n_median = normal.params_json[param][0]
        a_median = aggressive.params_json[param][0]
        assert abs(a_median - n_median * 0.7) < 0.01


def test_seed_presets_stealth(app, db):
    """Stealth: action params * 1.5, verification params * 1.0."""
    seed_presets(db)
    normal = TimingPreset.query.filter_by(name='Normal').first()
    stealth = TimingPreset.query.filter_by(name='Stealth').first()
    # Action param should be 1.5x
    n_action = normal.params_json['t_app_load'][0]
    s_action = stealth.params_json['t_app_load'][0]
    assert abs(s_action - n_action * 1.5) < 0.01
    # Verify param should be 1.0x
    n_verify = normal.params_json['t_recovery_settle'][0]
    s_verify = stealth.params_json['t_recovery_settle'][0]
    assert abs(s_verify - n_verify * 1.0) < 0.01


def test_seed_presets_clamps(app, db):
    """Derived preset min >= Normal_min * 0.5, max <= Normal_max * 2.0."""
    seed_presets(db)
    normal = TimingPreset.query.filter_by(name='Normal').first()
    for preset_name in ['Cautious', 'Aggressive', 'Stealth']:
        preset = TimingPreset.query.filter_by(name=preset_name).first()
        for param in preset.params_json:
            n_min = normal.params_json[param][2]
            n_max = normal.params_json[param][3]
            p_min = preset.params_json[param][2]
            p_max = preset.params_json[param][3]
            assert p_min >= n_min * 0.5 - 0.01, f"{preset_name}.{param} min too low"
            assert p_max <= n_max * 2.0 + 0.01, f"{preset_name}.{param} max too high"


def test_seed_presets_idempotent(app, db):
    """Calling seed_presets() twice should still result in 4."""
    seed_presets(db)
    seed_presets(db)
    assert TimingPreset.query.count() == 4


def test_migrate_warmup(app, db, tmp_path):
    """Create a fake warmup JSON, run migrate_warmup(), verify."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot, username='test_warmup_acct')
    warmup_file = tmp_path / 'warmup_state.json'
    warmup_file.write_text(json.dumps({
        'test_warmup_acct': {'current_day': 3, 'completed': False}
    }))
    count = migrate_warmup(db, warmup_path=str(warmup_file))
    assert count == 1
    result = db.session.get(BotAccount, acct.id)
    assert result.warmup_json['current_day'] == 3


def test_migrate_warmup_no_file(app, db):
    """migrate_warmup() with nonexistent path should not raise."""
    count = migrate_warmup(db, warmup_path='/nonexistent/path.json')
    assert count == 0


def test_migrate_warmup_no_overwrite(app, db, tmp_path):
    """If BotAccount already has warmup_json, don't overwrite."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot, username='warmup_existing',
                         warmup_json={'current_day': 5, 'completed': True})
    warmup_file = tmp_path / 'warmup_state.json'
    warmup_file.write_text(json.dumps({
        'warmup_existing': {'current_day': 1, 'completed': False}
    }))
    migrate_warmup(db, warmup_path=str(warmup_file))
    result = db.session.get(BotAccount, acct.id)
    assert result.warmup_json['current_day'] == 5  # unchanged


def test_migrate_personality_defaults(app, db):
    """Without memory files, personality_json should use midpoint defaults."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot)
    migrate_personality(db, data_dir='/nonexistent/dir')
    result = db.session.get(BotAccount, acct.id)
    assert result.personality_json['reels_preference'] == 0.5
    assert result.personality_json['switch_threshold'] == 0.7


def test_migrate_personality_from_file(app, db, tmp_path):
    """When memory file exists, evolved personality values should be used."""
    u = _make_user(db)
    bot = _make_bot(db, u)
    acct = _make_account(db, bot, username='evolved_acct')
    memory = {'evolved_acct': {'reels_preference': 0.9, 'story_affinity': 0.8}}
    (tmp_path / 'memory_test_ph1.json').write_text(json.dumps(memory))
    migrate_personality(db, data_dir=str(tmp_path))
    result = db.session.get(BotAccount, acct.id)
    assert result.personality_json['reels_preference'] == 0.9


def test_migrate_niche(app, db):
    """After migrate_niche(), TikTok BotAccounts should have niche_json."""
    u = _make_user(db)
    bot = _make_bot(db, u, platform='tiktok')
    acct = _make_account(db, bot, platform='tiktok')
    migrate_niche(db)
    result = db.session.get(BotAccount, acct.id)
    assert result.niche_json is not None
    assert 'toxic relationship' in result.niche_json['keywords']


def test_seed_full_run(app, db, capsys):
    """Running the full seed should print a summary."""
    seed_phones(db)
    seed_proxy(db)
    seed_presets(db)
    # Verify all data exists
    assert Phone.query.count() == 4
    assert Proxy.query.count() == 1
    assert TimingPreset.query.count() == 4
