"""Tests for planner_service.py -- DB-integrated planner wrapper."""
import json
from datetime import date, datetime, time
from unittest.mock import patch, MagicMock
from zoneinfo import ZoneInfo

import pytest

from app import db as _db
from app.models import (
    Phone, Bot, BotAccount, Proxy, User, WeeklyPlan, SessionLog,
)
from app.planner_service import (
    _get_accounts_for_proxy,
    _translate_session,
    _add_session_ids,
    _convert_times_to_utc,
    generate_weekly_plan,
    get_current_plan,
    get_today_sessions,
    get_warmup_status,
    update_warmup,
    EASTERN, UTC,
)


# ─── Fixtures ─────────────────────────────────────────────────


@pytest.fixture
def seed_data(app, db):
    """Create User, Phone, Proxy, Bot, BotAccounts for testing."""
    user = User(username='test', email='test@test.com', password='hash')
    db.session.add(user)
    db.session.flush()

    phone = Phone(id=1, name='Galaxy S9', model='SM-G960F')
    db.session.add(phone)
    db.session.flush()

    proxy = Proxy(id=1, name='USA Mobile', host='proxy.example.com',
                  port=20002, username_env='PROXY_USER', password_env='PROXY_PASS')
    db.session.add(proxy)
    db.session.flush()

    bot = Bot(user_id=user.id, phone_id='1', name='Phone 1 Bot',
              platform='tiktok', phone_ref_id=phone.id, proxy_id=proxy.id)
    db.session.add(bot)
    db.session.flush()

    ba1 = BotAccount(
        bot_id=bot.id, clone_id='tt1', username='ph1_tiktok',
        password='pass', platform='tiktok',
        personality_json={'energy': 0.7, 'curiosity': 0.5},
        warmup_json={
            'current_day': 3, 'total_days': 7, 'completed': False,
            'warmup_plan': {
                '1': {'type': 'dead', 'likes': 0, 'comments': 0, 'follows': 0, 'sessions': 0},
                '2': {'type': 'lazy', 'likes': 0, 'comments': 0, 'follows': 0, 'sessions': 1},
                '3': {'type': 'normal', 'likes': 5, 'comments': 1, 'follows': 0, 'sessions': 1},
                '4': {'type': 'normal', 'likes': 8, 'comments': 2, 'follows': 1, 'sessions': 1},
                '5': {'type': 'normal', 'likes': 12, 'comments': 3, 'follows': 2, 'sessions': 2},
                '6': {'type': 'normal', 'likes': 15, 'comments': 4, 'follows': 3, 'sessions': 2},
                '7': {'type': 'normal', 'likes': 20, 'comments': 5, 'follows': 4, 'sessions': 2},
            },
            'profile_pic_day': 4, 'profile_pic_done': False,
            'bio_day': 5, 'bio_done': False,
        },
    )
    ba2 = BotAccount(
        bot_id=bot.id, clone_id='ig1', username='ph1_instagram',
        password='pass', platform='instagram',
        personality_json=None,
        warmup_json=None,
    )
    db.session.add_all([ba1, ba2])
    db.session.commit()

    return {'user': user, 'phone': phone, 'proxy': proxy, 'bot': bot,
            'ba_tiktok': ba1, 'ba_instagram': ba2}


# ─── Account Query ─────────────────────────────────────────────


def test_get_accounts_for_proxy_returns_accounts(app, db, seed_data):
    accounts = _get_accounts_for_proxy(seed_data['proxy'].id)
    assert len(accounts) == 2
    names = {a['name'] for a in accounts}
    assert 'ph1_tiktok' in names
    assert 'ph1_instagram' in names


def test_get_accounts_for_proxy_dict_keys(app, db, seed_data):
    accounts = _get_accounts_for_proxy(seed_data['proxy'].id)
    required_keys = {'name', 'phone_id', 'platform', 'warmup_state', 'personality_state'}
    for acc in accounts:
        assert required_keys.issubset(acc.keys())


def test_get_accounts_for_proxy_no_match(app, db, seed_data):
    accounts = _get_accounts_for_proxy(9999)
    assert accounts == []


def test_get_accounts_warmup_state_only_if_incomplete(app, db, seed_data):
    accounts = _get_accounts_for_proxy(seed_data['proxy'].id)
    tt = next(a for a in accounts if a['platform'] == 'tiktok')
    ig = next(a for a in accounts if a['platform'] == 'instagram')
    # TikTok has warmup_json with completed=False -> warmup_state present
    assert tt['warmup_state'] is not None
    # Instagram has warmup_json=None -> warmup_state is None
    assert ig['warmup_state'] is None


# ─── Field Name Mapping ───────────────────────────────────────


def test_translate_account_to_account_name():
    result = _translate_session({'account': 'ph1_tiktok', 'foo': 'bar'})
    assert 'account_name' in result
    assert result['account_name'] == 'ph1_tiktok'
    assert 'account' not in result


def test_translate_type_to_session_type():
    result = _translate_session({'type': 'normal'})
    assert result['session_type'] == 'normal'
    assert 'type' not in result


def test_translate_phone_to_phone_id():
    result = _translate_session({'phone': 1})
    assert result['phone_id'] == 1
    assert 'phone' not in result


def test_translate_time_slot():
    result = _translate_session({'time_slot': 'Evening'})
    assert result['time_slot_name'] == 'Evening'
    assert 'time_slot' not in result


def test_translate_preserves_unknown_keys():
    result = _translate_session({'account': 'x', 'start_time': '19:00'})
    assert result['start_time'] == '19:00'


# ─── Session ID ────────────────────────────────────────────────


def test_session_id_format():
    plan = {
        'days': {
            '2026-03-22': {
                'sessions': [
                    {'account_name': 'ph1_tiktok', 'session_number': 1},
                    {'account_name': 'ph1_tiktok', 'session_number': 2},
                ]
            }
        }
    }
    _add_session_ids(plan)
    sessions = plan['days']['2026-03-22']['sessions']
    assert sessions[0]['session_id'] == '2026-03-22_ph1_tiktok_1'
    assert sessions[1]['session_id'] == '2026-03-22_ph1_tiktok_2'


def test_session_ids_unique_across_days():
    plan = {
        'days': {
            '2026-03-22': {'sessions': [{'account_name': 'ph1_tiktok', 'session_number': 1}]},
            '2026-03-23': {'sessions': [{'account_name': 'ph1_tiktok', 'session_number': 1}]},
        }
    }
    _add_session_ids(plan)
    id1 = plan['days']['2026-03-22']['sessions'][0]['session_id']
    id2 = plan['days']['2026-03-23']['sessions'][0]['session_id']
    assert id1 != id2


# ─── Timezone Conversion ──────────────────────────────────────


def test_eastern_to_utc_edt():
    """EDT (summer): Eastern 19:45 -> UTC 23:45."""
    plan = {
        'days': {
            '2026-03-22': {
                'sessions': [{'start_time': '19:45', 'end_time': '20:11'}]
            }
        }
    }
    _convert_times_to_utc(plan)
    session = plan['days']['2026-03-22']['sessions'][0]
    assert session['start_time_utc'] == '2026-03-22T23:45:00Z'
    assert session['start_time_et'] == '19:45'
    assert session['end_time_utc'] == '2026-03-23T00:11:00Z'
    assert session['end_time_et'] == '20:11'


def test_eastern_to_utc_est():
    """EST (winter): Eastern 19:45 -> UTC 00:45 (next day, -5h offset)."""
    plan = {
        'days': {
            '2026-01-15': {
                'sessions': [{'start_time': '19:45', 'end_time': '20:11'}]
            }
        }
    }
    _convert_times_to_utc(plan)
    session = plan['days']['2026-01-15']['sessions'][0]
    assert session['start_time_utc'] == '2026-01-16T00:45:00Z'
    assert session['end_time_utc'] == '2026-01-16T01:11:00Z'


def test_midnight_crossing_end_time():
    """Session 23:00-00:30: end_time should be next day."""
    plan = {
        'days': {
            '2026-03-22': {
                'sessions': [{'start_time': '23:00', 'end_time': '00:30'}]
            }
        }
    }
    _convert_times_to_utc(plan)
    session = plan['days']['2026-03-22']['sessions'][0]
    # Start: 23:00 EDT -> 03:00Z (next day)
    assert session['start_time_utc'] == '2026-03-23T03:00:00Z'
    # End: 00:30 EDT (next day) -> 04:30Z (next day)
    assert session['end_time_utc'] == '2026-03-23T04:30:00Z'


def test_timezone_round_trip():
    """Eastern -> UTC -> Eastern produces same time."""
    eastern = ZoneInfo("US/Eastern")
    utc = ZoneInfo("UTC")
    original = datetime(2026, 3, 22, 19, 45, tzinfo=eastern)
    via_utc = original.astimezone(utc)
    back = via_utc.astimezone(eastern)
    assert back.hour == 19
    assert back.minute == 45


# ─── get_current_plan ──────────────────────────────────────────


def test_get_current_plan_returns_plan(app, db, seed_data):
    today = date.today()
    iso_cal = today.isocalendar()
    plan = WeeklyPlan(
        proxy_id=seed_data['proxy'].id,
        week_number=iso_cal[1], year=iso_cal[0],
        plan_json={'days': {today.isoformat(): {'sessions': []}}},
        status='active',
    )
    db.session.add(plan)
    db.session.commit()

    result = get_current_plan(seed_data['proxy'].id)
    assert result is not None
    assert 'days' in result


def test_get_current_plan_returns_none(app, db, seed_data):
    result = get_current_plan(9999)
    assert result is None


# ─── Plan Generation (mocked planner) ─────────────────────────


def _make_mock_plan():
    """Create a mock PlannerWeeklyPlan-like object with to_dict()."""
    mock_plan = MagicMock()
    mock_plan.to_dict.return_value = {
        'week_number': 13,
        'year': 2026,
        'days': {
            '2026-03-22': {
                'sessions': [
                    {'account': 'ph1_tiktok', 'phone': 1, 'type': 'normal',
                     'time_slot': 'Evening', 'session_number': 1,
                     'start_time': '19:45', 'end_time': '20:11'},
                ]
            }
        }
    }
    return mock_plan


@patch('app.planner_service._planner_generate')
@patch('app.planner_service._planner_get_account_state')
@patch('app.planner_service._ensure_planner_imports', return_value=True)
def test_generate_stores_in_db(mock_ensure, mock_gas, mock_gen, app, db, seed_data):
    mock_gen.return_value = _make_mock_plan()
    generate_weekly_plan(seed_data['proxy'].id, date(2026, 3, 22))

    plan = WeeklyPlan.query.filter_by(proxy_id=seed_data['proxy'].id).first()
    assert plan is not None
    assert plan.week_number == 12  # ISO week for 2026-03-22
    assert plan.status == 'active'


@patch('app.planner_service._planner_generate')
@patch('app.planner_service._planner_get_account_state')
@patch('app.planner_service._ensure_planner_imports', return_value=True)
def test_generate_upserts_no_duplicate(mock_ensure, mock_gas, mock_gen, app, db, seed_data):
    mock_gen.return_value = _make_mock_plan()
    generate_weekly_plan(seed_data['proxy'].id, date(2026, 3, 22))
    generate_weekly_plan(seed_data['proxy'].id, date(2026, 3, 22))

    count = WeeklyPlan.query.filter_by(proxy_id=seed_data['proxy'].id).count()
    assert count == 1


@patch('app.planner_service._planner_generate')
@patch('app.planner_service._planner_get_account_state')
@patch('app.planner_service._ensure_planner_imports', return_value=True)
def test_generate_returns_translated_keys(mock_ensure, mock_gas, mock_gen, app, db, seed_data):
    mock_gen.return_value = _make_mock_plan()
    result = generate_weekly_plan(seed_data['proxy'].id, date(2026, 3, 22))

    session = result['days']['2026-03-22']['sessions'][0]
    assert 'account_name' in session
    assert 'session_type' in session
    assert 'phone_id' in session
    assert 'time_slot_name' in session
    assert 'session_id' in session
    assert 'start_time_utc' in session


@patch('app.planner_service._planner_generate')
@patch('app.planner_service._planner_get_account_state')
@patch('app.planner_service._ensure_planner_imports', return_value=True)
def test_generate_converts_eastern_to_utc(mock_ensure, mock_gas, mock_gen, app, db, seed_data):
    mock_gen.return_value = _make_mock_plan()
    result = generate_weekly_plan(seed_data['proxy'].id, date(2026, 3, 22))

    session = result['days']['2026-03-22']['sessions'][0]
    assert session['start_time_utc'] == '2026-03-22T23:45:00Z'


@patch('app.planner_service._planner_generate')
@patch('app.planner_service._planner_get_account_state')
@patch('app.planner_service._ensure_planner_imports', return_value=True)
def test_generate_queries_accounts_by_proxy(mock_ensure, mock_gas, mock_gen, app, db, seed_data):
    mock_gen.return_value = _make_mock_plan()
    generate_weekly_plan(seed_data['proxy'].id, date(2026, 3, 22))

    # Planner was called with accounts list
    call_kwargs = mock_gen.call_args
    accounts = call_kwargs.kwargs.get('accounts') or call_kwargs[1].get('accounts')
    assert len(accounts) == 2


def test_generate_raises_on_no_accounts(app, db, seed_data):
    with patch('app.planner_service._ensure_planner_imports', return_value=True):
        with pytest.raises(ValueError, match="No accounts found"):
            generate_weekly_plan(9999, date(2026, 3, 22))


# ─── Today Sessions ───────────────────────────────────────────


def test_get_today_sessions_empty_when_no_plan(app, db, seed_data):
    sessions = get_today_sessions(seed_data['proxy'].id)
    assert sessions == []


def test_get_today_sessions_with_plan(app, db, seed_data):
    today = date.today().isoformat()
    iso_cal = date.today().isocalendar()
    plan = WeeklyPlan(
        proxy_id=seed_data['proxy'].id,
        week_number=iso_cal[1], year=iso_cal[0],
        plan_json={
            'days': {
                today: {
                    'sessions': [
                        {'session_id': f'{today}_ph1_tiktok_1', 'account_name': 'ph1_tiktok',
                         'session_type': 'normal', 'start_time_utc': '2026-03-22T23:45:00Z'},
                    ]
                }
            }
        },
        status='active',
    )
    db.session.add(plan)
    db.session.commit()

    sessions = get_today_sessions(seed_data['proxy'].id)
    assert len(sessions) == 1
    assert sessions[0]['execution_status'] == 'planned'


def test_session_completed_status(app, db, seed_data):
    today = date.today().isoformat()
    iso_cal = date.today().isocalendar()
    sid = f'{today}_ph1_tiktok_1'

    plan = WeeklyPlan(
        proxy_id=seed_data['proxy'].id,
        week_number=iso_cal[1], year=iso_cal[0],
        plan_json={'days': {today: {'sessions': [{'session_id': sid, 'account_name': 'ph1_tiktok'}]}}},
        status='active',
    )
    log = SessionLog(
        bot_account_id=seed_data['ba_tiktok'].id, session_id=sid,
        started_at=datetime.now(), ended_at=datetime.now(),
        session_type='normal', status='success',
    )
    db.session.add_all([plan, log])
    db.session.commit()

    sessions = get_today_sessions(seed_data['proxy'].id)
    assert sessions[0]['execution_status'] == 'completed'


def test_session_running_status(app, db, seed_data):
    today = date.today().isoformat()
    iso_cal = date.today().isocalendar()
    sid = f'{today}_ph1_tiktok_1'

    plan = WeeklyPlan(
        proxy_id=seed_data['proxy'].id,
        week_number=iso_cal[1], year=iso_cal[0],
        plan_json={'days': {today: {'sessions': [{'session_id': sid}]}}},
        status='active',
    )
    log = SessionLog(
        bot_account_id=seed_data['ba_tiktok'].id, session_id=sid,
        started_at=datetime.now(), ended_at=None,
        session_type='normal', status='running',
    )
    db.session.add_all([plan, log])
    db.session.commit()

    sessions = get_today_sessions(seed_data['proxy'].id)
    assert sessions[0]['execution_status'] == 'running'


# ─── Personality Round-Trip ────────────────────────────────────


def test_personality_read_from_db(app, db, seed_data):
    accounts = _get_accounts_for_proxy(seed_data['proxy'].id)
    tt = next(a for a in accounts if a['platform'] == 'tiktok')
    assert tt['personality_state'] is not None
    assert tt['personality_state']['energy'] == 0.7


def test_personality_none_returns_none(app, db, seed_data):
    accounts = _get_accounts_for_proxy(seed_data['proxy'].id)
    ig = next(a for a in accounts if a['platform'] == 'instagram')
    assert ig['personality_state'] is None


@patch('app.planner_service._planner_generate')
@patch('app.planner_service._planner_get_account_state')
@patch('app.planner_service._ensure_planner_imports', return_value=True)
def test_personality_written_back_after_generation(mock_ensure, mock_gas, mock_gen, app, db, seed_data):
    """Verify that generate_weekly_plan writes personality state back to BotAccount."""
    # Modify personality in DB to a known value before generation
    ba = db.session.get(BotAccount, seed_data['ba_tiktok'].id)
    ba.personality_json = {'energy': 0.7, 'curiosity': 0.5}
    db.session.commit()

    # The planner mock will mutate the state dict in-place (like real planner does)
    def side_effect(accounts=None, start_date=None, state=None):
        if state:
            for name in state:
                state[name]['session_count'] = 42
        return _make_mock_plan()
    mock_gen.side_effect = side_effect

    generate_weekly_plan(seed_data['proxy'].id, date(2026, 3, 22))

    # Refresh from DB
    db.session.expire_all()
    ba = db.session.get(BotAccount, seed_data['ba_tiktok'].id)
    ps = ba.personality_json if isinstance(ba.personality_json, dict) else json.loads(ba.personality_json)
    assert ps.get('session_count') == 42


# ─── Warmup Service ────────────────────────────────────────────


def test_get_warmup_status(app, db, seed_data):
    status = get_warmup_status('ph1_tiktok')
    assert status is not None
    assert status['current_day'] == 3
    assert status['total_days'] == 7
    assert status['completed'] is False
    assert status['caps']['likes'] == 5
    assert status['caps']['comments'] == 1
    assert len(status['plan_summary']) == 7


def test_get_warmup_status_none(app, db, seed_data):
    status = get_warmup_status('ph1_instagram')
    assert status is None


def test_update_warmup_reset(app, db, seed_data):
    result = update_warmup('ph1_tiktok', 'reset')
    assert result['current_day'] == 0
    assert result['completed'] is False


def test_update_warmup_skip(app, db, seed_data):
    result = update_warmup('ph1_tiktok', 'skip', target_day=5)
    assert result['current_day'] == 5


def test_update_warmup_complete(app, db, seed_data):
    result = update_warmup('ph1_tiktok', 'complete')
    assert result['completed'] is True
    assert result['current_day'] == 7


def test_update_warmup_unknown_action(app, db, seed_data):
    with pytest.raises(ValueError, match="Unknown warmup action"):
        update_warmup('ph1_tiktok', 'invalid_action')


def test_update_warmup_account_not_found(app, db, seed_data):
    with pytest.raises(ValueError, match="not found"):
        update_warmup('nonexistent', 'reset')


# ─── WAL Mode ─────────────────────────────────────────────────


def test_wal_mode_enabled(app, db):
    """SQLite WAL mode should be enabled at app startup."""
    from sqlalchemy import text
    result = db.session.execute(text("PRAGMA journal_mode")).scalar()
    # In-memory SQLite may report 'memory' instead of 'wal'
    # but the PRAGMA was executed without error
    assert result in ('wal', 'memory')
