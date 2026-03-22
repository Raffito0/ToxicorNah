"""Tests for warmup session interleaving in the planner."""
import pytest
from datetime import date

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from planner.scheduler import generate_weekly_plan


def _warmup_account(day, day_type="normal", likes=0, comments=0, follows=0, searches=0,
                    can_post=False, duration_range=None):
    """Helper to create an account with warmup state."""
    if duration_range is None:
        duration_range = [5, 12]
    return {
        "name": "ph1_tiktok", "phone_id": 1, "platform": "tiktok",
        "warmup_state": {
            "completed": False, "current_day": day, "total_days": 7,
            "warmup_plan": {
                str(day): {
                    "type": day_type,
                    "duration_range": duration_range,
                    "likes": likes, "comments": comments,
                    "follows": follows, "searches": searches,
                    "can_post": can_post,
                }
            }
        }
    }


REGULAR_ACCOUNTS = [
    {"name": "ph1_instagram", "phone_id": 1, "platform": "instagram"},
    {"name": "ph2_tiktok", "phone_id": 2, "platform": "tiktok"},
    {"name": "ph2_instagram", "phone_id": 2, "platform": "instagram"},
]


class TestWarmupDeadDay:
    def test_dead_day_no_sessions(self):
        accounts = [_warmup_account(1, "dead")] + REGULAR_ACCOUNTS
        plan = generate_weekly_plan(accounts=accounts, start_date=date(2026, 3, 22))
        warmup_sessions = [
            s for dp in plan.daily_plans.values() for s in dp.sessions
            if s.account_name == "ph1_tiktok"
        ]
        assert len(warmup_sessions) == 0


class TestWarmupLazyDay:
    def test_lazy_day_type(self):
        accounts = [_warmup_account(2, "lazy", duration_range=[3, 6])] + REGULAR_ACCOUNTS
        plan = generate_weekly_plan(accounts=accounts, start_date=date(2026, 3, 22))
        for dp in plan.daily_plans.values():
            for s in dp.sessions:
                if s.account_name == "ph1_tiktok":
                    assert s.session_type == "warmup_lazy"
                    assert 3 <= s.total_duration_minutes <= 6
                    assert s.engagement_caps is not None
                    assert s.engagement_caps["scroll_only"] is True


class TestWarmupNormalDay:
    def test_warmup_with_likes(self):
        accounts = [_warmup_account(3, "normal", likes=10)] + REGULAR_ACCOUNTS
        plan = generate_weekly_plan(accounts=accounts, start_date=date(2026, 3, 22))
        for dp in plan.daily_plans.values():
            for s in dp.sessions:
                if s.account_name == "ph1_tiktok":
                    assert s.session_type == "warmup"
                    assert s.engagement_caps["likes"] == 10
                    assert s.engagement_caps["scroll_only"] is False


class TestWarmupSessionLimits:
    def test_max_one_session_per_day(self):
        accounts = [_warmup_account(3, "normal", likes=10)] + REGULAR_ACCOUNTS
        plan = generate_weekly_plan(accounts=accounts, start_date=date(2026, 3, 22))
        for dp in plan.daily_plans.values():
            count = sum(1 for s in dp.sessions if s.account_name == "ph1_tiktok")
            assert count <= 1, f"Warmup got {count} sessions on {dp.date}"


class TestMixedPlan:
    def test_mixed_session_types(self):
        accounts = [_warmup_account(3, "normal", likes=10)] + REGULAR_ACCOUNTS
        plan = generate_weekly_plan(accounts=accounts, start_date=date(2026, 3, 22))
        warmup_types = set()
        regular_types = set()
        for dp in plan.daily_plans.values():
            for s in dp.sessions:
                if s.account_name == "ph1_tiktok":
                    warmup_types.add(s.session_type)
                else:
                    regular_types.add(s.session_type)
        assert warmup_types <= {"warmup", "warmup_lazy"}
        assert regular_types <= {"normal", "aborted", "extended", "rest_only"}


class TestRegularSessionsCaps:
    def test_regular_sessions_no_caps(self):
        accounts = [_warmup_account(3, "normal", likes=10)] + REGULAR_ACCOUNTS
        plan = generate_weekly_plan(accounts=accounts, start_date=date(2026, 3, 22))
        for dp in plan.daily_plans.values():
            for s in dp.sessions:
                if s.account_name != "ph1_tiktok":
                    assert s.engagement_caps is None
