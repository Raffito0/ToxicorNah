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

    def test_initialize_all_accounts_accepts_names(self):
        state = {}
        names = ["test_acc_1", "test_acc_2"]
        result = initialize_all_accounts(state, date(2026, 3, 22), names)
        assert "test_acc_1" in result
        assert "test_acc_2" in result


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
