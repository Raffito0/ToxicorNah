"""Tests for planner parameterization -- accounts as parameter."""
import pytest
from datetime import date

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from planner.scheduler import generate_weekly_plan
from planner.models import Session
from planner.personality import initialize_all_accounts, get_account_state


@pytest.fixture
def two_accounts():
    return [
        {"name": "ph1_tiktok", "phone_id": 1, "platform": "tiktok"},
        {"name": "ph1_instagram", "phone_id": 1, "platform": "instagram"},
    ]


@pytest.fixture
def six_accounts():
    accounts = []
    for phone_id in range(1, 4):
        accounts.append({"name": f"ph{phone_id}_tiktok", "phone_id": phone_id, "platform": "tiktok"})
        accounts.append({"name": f"ph{phone_id}_instagram", "phone_id": phone_id, "platform": "instagram"})
    return accounts


@pytest.fixture
def eight_accounts():
    accounts = []
    for phone_id in range(1, 5):
        accounts.append({"name": f"ph{phone_id}_tiktok", "phone_id": phone_id, "platform": "tiktok"})
        accounts.append({"name": f"ph{phone_id}_instagram", "phone_id": phone_id, "platform": "instagram"})
    return accounts


class TestAccountParameterization:
    def test_accepts_accounts_list(self, six_accounts):
        plan = generate_weekly_plan(accounts=six_accounts, start_date=date(2026, 3, 22))
        assert plan.week_number > 0
        assert len(plan.daily_plans) == 7

    def test_two_accounts_one_phone(self, two_accounts):
        plan = generate_weekly_plan(accounts=two_accounts, start_date=date(2026, 3, 22))
        assert len(plan.account_summaries) == 2
        for name in plan.account_summaries:
            assert name in ["ph1_tiktok", "ph1_instagram"]

    def test_eight_accounts_four_phones(self, eight_accounts):
        plan = generate_weekly_plan(accounts=eight_accounts, start_date=date(2026, 3, 22))
        assert len(plan.account_summaries) == 8

    def test_phones_derived_from_accounts(self, eight_accounts):
        plan = generate_weekly_plan(accounts=eight_accounts, start_date=date(2026, 3, 22))
        phone_ids = set()
        for dp in plan.daily_plans.values():
            for s in dp.sessions:
                phone_ids.add(s.phone_id)
        assert phone_ids == {1, 2, 3, 4}

    def test_no_file_io_for_personality(self, two_accounts):
        state = {}
        plan = generate_weekly_plan(accounts=two_accounts, start_date=date(2026, 3, 22), state=state)
        # State should be populated by the planner
        assert "ph1_tiktok" in state
        assert "personality" in state["ph1_tiktok"]

    def test_config_accounts_not_needed(self, two_accounts):
        """Monkeypatch config.ACCOUNTS to verify planner doesn't read it."""
        import planner.config as cfg
        original = cfg.ACCOUNTS
        cfg.ACCOUNTS = []
        try:
            plan = generate_weekly_plan(accounts=two_accounts, start_date=date(2026, 3, 22))
            assert len(plan.daily_plans) == 7
        finally:
            cfg.ACCOUNTS = original

    def test_no_config_accounts_references_in_source(self):
        """Verify scheduler, rules_engine, personality don't reference config.ACCOUNTS/PHONES."""
        import inspect
        from planner import scheduler, rules_engine, personality
        for mod in [scheduler, rules_engine, personality]:
            source = inspect.getsource(mod)
            assert "config.ACCOUNTS" not in source, f"{mod.__name__} still references config.ACCOUNTS"
            assert "config.PHONES" not in source, f"{mod.__name__} still references config.PHONES"

    def test_randomize_phone_order_requires_params(self, six_accounts):
        """randomize_phone_order must require accounts and phones params."""
        from planner.rules_engine import randomize_phone_order
        phones = [1, 2, 3]
        result = randomize_phone_order(accounts=six_accounts, phones=phones)
        assert len(result) == 3
        all_names = set()
        for pid, names in result:
            all_names.update(names)
        assert len(all_names) == 6

    def test_validate_cross_phone_requires_accounts(self, six_accounts):
        """validate_cross_phone must require accounts param."""
        from planner.rules_engine import validate_cross_phone
        activity = {a["name"]: True for a in six_accounts}
        assert validate_cross_phone(date(2026, 3, 22), activity, accounts=six_accounts)

    def test_generate_daily_plan_uses_params(self, six_accounts):
        """generate_daily_plan accepts accounts and phones params."""
        from planner.scheduler import generate_daily_plan
        state = {}
        initialize_all_accounts(state, date(2026, 3, 22), [a["name"] for a in six_accounts])
        phones = sorted(set(a["phone_id"] for a in six_accounts))
        # Build minimal weekly_assignments
        weekly_assignments = {}
        for acc in six_accounts:
            weekly_assignments[acc["name"]] = {
                "rest_day": None, "one_post_day": None,
                "two_day_break": None, "rest_weekday": None, "one_post_weekday": None,
            }
        daily = generate_daily_plan(date(2026, 3, 22), state, weekly_assignments, six_accounts, phones)
        assert daily.date == date(2026, 3, 22)
        assert len(daily.sessions) > 0

    def test_initialize_all_accounts_accepts_names(self):
        state = {}
        names = ["test_acc_1", "test_acc_2"]
        result = initialize_all_accounts(state, date(2026, 3, 22), names)
        assert "test_acc_1" in result
        assert "test_acc_2" in result


    def test_accounts_required_positional(self):
        """generate_weekly_plan requires accounts as first arg."""
        with pytest.raises(TypeError):
            generate_weekly_plan()

    def test_assign_two_day_break_with_dynamic_accounts(self):
        """assign_two_day_break works with arbitrary account lists."""
        from planner.rules_engine import assign_two_day_break
        from datetime import timedelta
        accounts = [
            {"name": "test_tiktok", "phone_id": 99, "platform": "tiktok"},
            {"name": "test_instagram", "phone_id": 99, "platform": "instagram"},
        ]
        week_dates = [date(2026, 3, 23) + timedelta(days=i) for i in range(7)]
        state = {}
        result = assign_two_day_break(99, week_dates, state, {}, accounts=accounts)
        if result:
            acc_name, d1, d2 = result
            assert acc_name in ["test_tiktok", "test_instagram"]
            assert d2 - d1 == timedelta(days=1)

    def test_single_phone_plan_works(self, two_accounts):
        """Single-phone plans work (R15 may deactivate breaks)."""
        plan = generate_weekly_plan(accounts=two_accounts, start_date=date(2026, 3, 22))
        assert len(plan.daily_plans) == 7
        # All sessions belong to phone 1
        for dp in plan.daily_plans.values():
            for s in dp.sessions:
                assert s.phone_id == 1


class TestEngagementCaps:
    def test_session_has_engagement_caps_field(self):
        s = Session(
            account_name="test", phone_id=1, platform="tiktok",
            start_time=__import__('datetime').time(19, 0),
            end_time=__import__('datetime').time(19, 30),
            time_slot_name="Evening", session_number=1, session_type="normal",
        )
        assert s.engagement_caps is None

    def test_session_to_dict_includes_caps(self):
        s = Session(
            account_name="test", phone_id=1, platform="tiktok",
            start_time=__import__('datetime').time(19, 0),
            end_time=__import__('datetime').time(19, 30),
            time_slot_name="Evening", session_number=1, session_type="normal",
            engagement_caps={"likes": 10, "scroll_only": False},
        )
        d = s.to_dict()
        assert "engagement_caps" in d
        assert d["engagement_caps"]["likes"] == 10
