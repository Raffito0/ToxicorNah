"""Data models for the Weekly & Daily Plan Generator."""
from dataclasses import dataclass, field
from datetime import date, time
from typing import Optional


@dataclass
class Session:
    account_name: str
    phone_id: int
    platform: str
    start_time: time
    end_time: time
    time_slot_name: str
    session_number: int  # 1 or 2 (which session of the day for this account)
    session_type: str  # "normal", "aborted", "extended", "rest_only"
    post_scheduled: bool = False
    post_outcome: Optional[str] = None  # "posted", "draft", "skipped", None
    pre_activity_minutes: int = 0
    post_activity_minutes: int = 0
    total_duration_minutes: int = 0
    proxy_rotation_before: bool = False
    engagement_caps: Optional[dict] = None  # None for regular sessions

    def to_dict(self):
        return {
            "account": self.account_name,
            "phone": self.phone_id,
            "platform": self.platform,
            "start_time": self.start_time.strftime("%H:%M"),
            "end_time": self.end_time.strftime("%H:%M"),
            "time_slot": self.time_slot_name,
            "session_number": self.session_number,
            "type": self.session_type,
            "post_scheduled": self.post_scheduled,
            "post_outcome": self.post_outcome,
            "pre_activity_minutes": self.pre_activity_minutes,
            "post_activity_minutes": self.post_activity_minutes,
            "total_duration_minutes": self.total_duration_minutes,
            "proxy_rotation_before": self.proxy_rotation_before,
            "engagement_caps": self.engagement_caps,
        }


@dataclass
class ProxyRotation:
    time_str: str
    from_phone: int
    to_phone: int

    def to_dict(self):
        return {
            "time": self.time_str,
            "reason": "phone_switch",
            "from_phone": self.from_phone,
            "to_phone": self.to_phone,
        }


@dataclass
class DailyPlan:
    date: date
    sessions: list = field(default_factory=list)  # List[Session]
    proxy_rotations: list = field(default_factory=list)  # List[ProxyRotation]

    def to_dict(self):
        return {
            "date": self.date.isoformat(),
            "sessions": [s.to_dict() for s in self.sessions],
            "proxy_rotations": [r.to_dict() for r in self.proxy_rotations],
        }


@dataclass
class AccountWeekSummary:
    account_name: str
    phone_id: int
    platform: str
    total_posts: int = 0
    total_sessions: int = 0
    rest_days: list = field(default_factory=list)
    one_post_days: list = field(default_factory=list)
    two_day_break: list = field(default_factory=list)
    aborted_sessions: int = 0
    extended_sessions: int = 0
    draft_errors: int = 0
    skipped_posts: int = 0

    def to_dict(self):
        return {
            "account": self.account_name,
            "phone": self.phone_id,
            "platform": self.platform,
            "total_posts": self.total_posts,
            "total_sessions": self.total_sessions,
            "rest_days": [d.isoformat() if isinstance(d, date) else d for d in self.rest_days],
            "one_post_days": [d.isoformat() if isinstance(d, date) else d for d in self.one_post_days],
            "two_day_break": [d.isoformat() if isinstance(d, date) else d for d in self.two_day_break],
            "aborted_sessions": self.aborted_sessions,
            "extended_sessions": self.extended_sessions,
            "draft_errors": self.draft_errors,
            "skipped_posts": self.skipped_posts,
        }


@dataclass
class WeeklyPlan:
    week_number: int
    year: int
    start_date: date
    end_date: date
    daily_plans: dict = field(default_factory=dict)  # date -> DailyPlan
    account_summaries: dict = field(default_factory=dict)  # account_name -> AccountWeekSummary

    def to_dict(self):
        return {
            "week": self.week_number,
            "year": self.year,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "days": {d.isoformat(): dp.to_dict() for d, dp in self.daily_plans.items()},
            "account_summaries": {k: v.to_dict() for k, v in self.account_summaries.items()},
        }
