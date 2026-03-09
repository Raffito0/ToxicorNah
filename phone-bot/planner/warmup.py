"""Warmup system — gradually ramps up activity for new accounts over 7 days.

Each account tracks its warmup day. The warmup plan overrides the Weekly Plan
until day 7 is complete. Day 8+ uses the normal Weekly Plan at full regime.

TikTok warmup includes the camera overlay trick for the first post (day 7).
Instagram just uploads the Reel normally.
"""
import logging
import random
from dataclasses import dataclass, field
from datetime import date

log = logging.getLogger(__name__)


# =============================================================================
# Warmup Configuration — Day-by-day rules
# =============================================================================

TIKTOK_WARMUP = {
    1: {
        "sessions": 1,
        "duration_range": (5, 10),       # minutes per session
        "actions": {
            "scroll_fyp": True,
            "explore_app": True,          # click Live, Discover, back to profile
            "search_niche": 3,            # number of niche keyword searches
            "verify_email": True,
            "like": 0,
            "comment": 0,
            "share": 0,
            "follow": 0,
        },
        "can_post": False,
    },
    2: {
        "sessions": 1,
        "duration_range": (10, 15),
        "actions": {
            "scroll_fyp": True,
            "explore_app": False,
            "search_niche": 4,
            "verify_email": False,
            "like": (5, 8),
            "comment": (2, 3),
            "share": (1, 2),
            "follow": 0,
        },
        "can_post": False,
    },
    3: {
        "sessions": 1,
        "duration_range": (12, 18),
        "actions": {
            "scroll_fyp": True,
            "explore_app": False,
            "search_niche": 2,
            "verify_email": False,
            "like": (8, 12),
            "comment": (3, 4),
            "share": (1, 2),
            "follow": (2, 3),
        },
        "can_post": False,
    },
    4: {
        "sessions": 2,
        "duration_range": (8, 13),
        "actions": {
            "scroll_fyp": True,
            "explore_app": False,
            "search_niche": 1,
            "verify_email": False,
            "like": (10, 15),
            "comment": (3, 5),
            "share": (1, 3),
            "follow": (3, 5),
        },
        "can_post": False,
    },
    5: {
        "sessions": 2,
        "duration_range": (10, 15),
        "actions": {
            "scroll_fyp": True,
            "explore_app": False,
            "search_niche": 1,
            "verify_email": False,
            "like": (12, 20),
            "comment": (4, 6),
            "share": (1, 2),
            "follow": (4, 6),
        },
        "can_post": False,
    },
    6: {
        "sessions": 2,
        "duration_range": (12, 17),
        "actions": {
            "scroll_fyp": True,
            "explore_app": False,
            "search_niche": 1,
            "verify_email": False,
            "like": (15, 22),
            "comment": (4, 7),
            "share": (1, 3),
            "follow": (4, 7),
        },
        "can_post": False,
    },
    7: {
        "sessions": 2,
        "duration_range": (13, 18),
        "actions": {
            "scroll_fyp": True,
            "explore_app": False,
            "search_niche": 0,
            "verify_email": False,
            "like": (15, 25),
            "comment": (5, 8),
            "share": (1, 3),
            "follow": (5, 8),
        },
        "can_post": True,
        "use_camera_trick": True,  # record with camera → overlay real video
    },
}

INSTAGRAM_WARMUP = {
    1: {
        "sessions": 1,
        "duration_range": (8, 12),
        "actions": {
            "scroll_feed": True,
            "scroll_reels": True,
            "explore_tab": True,
            "search_niche": 2,
            "like": 0,
            "comment": 0,
            "follow": 0,
        },
        "can_post": False,
    },
    2: {
        "sessions": 1,
        "duration_range": (10, 15),
        "actions": {
            "scroll_feed": True,
            "scroll_reels": True,
            "explore_tab": False,
            "search_niche": 2,
            "like": (5, 8),
            "comment": 0,
            "follow": 0,
        },
        "can_post": False,
    },
    3: {
        "sessions": 1,
        "duration_range": (12, 18),
        "actions": {
            "scroll_feed": True,
            "scroll_reels": True,
            "explore_tab": False,
            "search_niche": 2,
            "like": (8, 12),
            "comment": (2, 3),
            "follow": (2, 3),
        },
        "can_post": False,
    },
    4: {
        "sessions": 2,
        "duration_range": (8, 13),
        "actions": {
            "scroll_feed": True,
            "scroll_reels": True,
            "explore_tab": False,
            "search_niche": 1,
            "like": (10, 15),
            "comment": (3, 5),
            "follow": (3, 5),
        },
        "can_post": False,
    },
    5: {
        "sessions": 2,
        "duration_range": (10, 15),
        "actions": {
            "scroll_feed": True,
            "scroll_reels": True,
            "explore_tab": False,
            "search_niche": 1,
            "like": (12, 20),
            "comment": (4, 6),
            "follow": (4, 6),
        },
        "can_post": False,
    },
    6: {
        "sessions": 2,
        "duration_range": (12, 17),
        "actions": {
            "scroll_feed": True,
            "scroll_reels": True,
            "explore_tab": False,
            "search_niche": 0,
            "like": (15, 22),
            "comment": (4, 7),
            "follow": (4, 7),
        },
        "can_post": False,
    },
    7: {
        "sessions": 2,
        "duration_range": (13, 18),
        "actions": {
            "scroll_feed": True,
            "scroll_reels": True,
            "explore_tab": False,
            "search_niche": 0,
            "like": (15, 25),
            "comment": (5, 8),
            "follow": (5, 8),
        },
        "can_post": True,
        "use_camera_trick": False,  # Instagram: normal upload
    },
}


# =============================================================================
# Warmup State Tracker
# =============================================================================

@dataclass
class AccountWarmupState:
    """Tracks warmup progress for a single account."""
    account_name: str
    platform: str          # "tiktok" or "instagram"
    phone_id: int
    start_date: str = ""   # ISO date string
    current_day: int = 0   # 0 = not started, 1-7 = warmup, 8+ = done
    niche_keywords: list = field(default_factory=list)
    completed: bool = False
    profile_pic_day: int = 0   # which day to set profile pic (0 = not assigned)
    bio_day: int = 0           # which day to set bio (0 = not assigned)
    profile_pic_done: bool = False
    bio_done: bool = False

    def advance_day(self):
        if self.current_day < 8:
            self.current_day += 1
        if self.current_day > 7:
            self.completed = True

    def to_dict(self) -> dict:
        return {
            "account_name": self.account_name,
            "platform": self.platform,
            "phone_id": self.phone_id,
            "start_date": self.start_date,
            "current_day": self.current_day,
            "niche_keywords": self.niche_keywords,
            "completed": self.completed,
            "profile_pic_day": self.profile_pic_day,
            "bio_day": self.bio_day,
            "profile_pic_done": self.profile_pic_done,
            "bio_done": self.bio_done,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AccountWarmupState":
        # Handle legacy state files that don't have profile fields
        known = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in d.items() if k in known}
        return cls(**filtered)


# =============================================================================
# Warmup Plan Generator
# =============================================================================

def assign_profile_setup_days(state: AccountWarmupState):
    """Assign random days (5-7) for profile pic and bio setup.

    Rules:
    - Not in first 3-4 days (earliest = day 5)
    - Profile pic and bio NEVER on the same day
    - Randomized per account (so different phones get different schedules)
    """
    if state.profile_pic_day and state.bio_day:
        return  # already assigned

    eligible_days = [5, 6, 7]
    pic_day, bio_day = random.sample(eligible_days, 2)
    state.profile_pic_day = pic_day
    state.bio_day = bio_day
    log.info("%s: profile pic on day %d, bio on day %d", state.account_name, pic_day, bio_day)


def _resolve_action_count(value) -> int:
    """Resolve an action count: 0, int, or (min, max) tuple."""
    if isinstance(value, (list, tuple)):
        return random.randint(value[0], value[1])
    return int(value)


def generate_warmup_sessions(state: AccountWarmupState) -> list[dict]:
    """Generate sessions for the current warmup day.

    Returns a list of session dicts compatible with the executor format:
    [
        {
            "account_name": "ph1_tiktok",
            "phone_id": 1,
            "platform": "tiktok",
            "session_type": "warmup",
            "warmup_day": 3,
            "duration_minutes": 15,
            "actions": {
                "like": 10,
                "comment": 3,
                "share": 1,
                "follow": 2,
                "search_niche": 2,
                "explore_app": False,
                "verify_email": False,
            },
            "can_post": False,
            "use_camera_trick": False,
        }
    ]
    """
    day = state.current_day
    if day < 1 or day > 7:
        return []

    if state.platform == "tiktok":
        day_config = TIKTOK_WARMUP[day]
    else:
        day_config = INSTAGRAM_WARMUP[day]

    n_sessions = day_config["sessions"]
    sessions = []

    for i in range(n_sessions):
        duration = random.randint(*day_config["duration_range"])

        # Resolve action counts
        actions = {}
        for key, value in day_config["actions"].items():
            if isinstance(value, bool):
                actions[key] = value
            else:
                count = _resolve_action_count(value)
                # Split counts across sessions
                if n_sessions > 1 and isinstance(value, (list, tuple)):
                    # Roughly split: first session gets a bit more
                    if i == 0:
                        count = int(count * 0.6)
                    else:
                        count = int(count * 0.4) + 1
                actions[key] = count

        # Profile setup flags (only in first session of the day)
        set_profile_pic = (i == 0 and day == state.profile_pic_day and not state.profile_pic_done)
        set_bio = (i == 0 and day == state.bio_day and not state.bio_done)

        sessions.append({
            "account_name": state.account_name,
            "phone_id": state.phone_id,
            "platform": state.platform,
            "session_type": "warmup",
            "warmup_day": day,
            "duration_minutes": duration,
            "actions": actions,
            "can_post": day_config["can_post"] and i == n_sessions - 1,  # post in last session
            "use_camera_trick": day_config.get("use_camera_trick", False),
            "niche_keywords": state.niche_keywords,
            "set_profile_pic": set_profile_pic,
            "set_bio": set_bio,
        })

    log.info("Warmup day %d for %s: %d sessions, %d min total",
             day, state.account_name, n_sessions,
             sum(s["duration_minutes"] for s in sessions))

    return sessions


# =============================================================================
# Default Niche Keywords
# =============================================================================

DEFAULT_NICHE_KEYWORDS = {
    "relationship": [
        "toxic relationship", "red flags", "situationship",
        "dating advice", "couples", "relationship tips",
        "boyfriend", "girlfriend goals", "love advice",
    ],
    "general": [
        "fyp", "viral", "trending", "funny", "relatable",
        "storytime", "lifestyle", "motivation",
    ],
}
