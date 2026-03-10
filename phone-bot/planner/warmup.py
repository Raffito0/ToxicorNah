"""Warmup system -- gradually ramps up activity for new accounts.

Duration is 5-8 days (randomized per account). The warmup plan overrides
the Weekly Plan until complete. After warmup, normal Weekly Plan at full regime.

Key anti-detection features:
- NO likes on days 1-2 (absolute rule)
- 1-2 dead days (don't open app at all)
- 1-2 lazy days (short scroll, zero/minimal engagement)
- Non-monotonic engagement (some days have LESS than previous day)
- Profile pic/bio on random days (different per account)
- Variable session count per day (0, 1, or 2)
- Every account gets a DIFFERENT warmup schedule

TikTok warmup includes the camera overlay trick for the first post.
Instagram just uploads the Reel normally.
"""
import logging
import random
from dataclasses import dataclass, field
from datetime import date

log = logging.getLogger(__name__)


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
    current_day: int = 0   # 0 = not started, 1+ = warmup day
    niche_keywords: list = field(default_factory=list)
    completed: bool = False
    profile_pic_day: int = 0
    bio_day: int = 0
    profile_pic_done: bool = False
    bio_done: bool = False
    total_days: int = 7    # 5-8, randomized at init
    warmup_plan: dict = field(default_factory=dict)

    def advance_day(self):
        if self.current_day <= self.total_days:
            self.current_day += 1
        if self.current_day > self.total_days:
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
            "total_days": self.total_days,
            "warmup_plan": self.warmup_plan,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AccountWarmupState":
        known = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in d.items() if k in known}
        # JSON serializes dict keys as strings -- convert back to int
        if "warmup_plan" in filtered and filtered["warmup_plan"]:
            filtered["warmup_plan"] = {
                int(k): v for k, v in filtered["warmup_plan"].items()
            }
        return cls(**filtered)


# =============================================================================
# Warmup Plan Generator
# =============================================================================

def generate_warmup_plan(state: AccountWarmupState):
    """Generate the full warmup plan for an account (called once at init).

    Creates a unique schedule with dead days, lazy days, non-monotonic
    engagement, and randomized profile setup timing. Stores the plan
    in state.warmup_plan.
    """
    total_days = random.randint(5, 8)
    state.total_days = total_days

    # --- Dead days: 1-2 days with NO sessions ---
    # Never day 1, 2, or the last day
    n_dead = random.randint(1, 2)
    dead_candidates = [d for d in range(3, total_days)]
    n_dead = min(n_dead, len(dead_candidates))
    dead_days = set(random.sample(dead_candidates, n_dead)) if dead_candidates else set()

    # --- Lazy days: 1-2 days with minimal activity ---
    # Not day 1, not last day, not dead days
    n_lazy = random.randint(1, 2)
    lazy_candidates = [d for d in range(2, total_days) if d not in dead_days]
    n_lazy = min(n_lazy, len(lazy_candidates))
    lazy_days = set(random.sample(lazy_candidates, n_lazy)) if lazy_candidates else set()

    # --- Profile setup days ---
    # Not on dead days, pic and bio on different days
    setup_candidates = [d for d in range(1, total_days) if d not in dead_days]
    if len(setup_candidates) >= 2:
        pic_day, bio_day = random.sample(setup_candidates, 2)
    elif setup_candidates:
        pic_day = setup_candidates[0]
        bio_day = setup_candidates[0]
    else:
        pic_day = 1
        bio_day = 2
    state.profile_pic_day = pic_day
    state.bio_day = bio_day

    # --- Generate daily configs ---
    plan = {}

    for day in range(1, total_days + 1):
        # Dead day
        if day in dead_days:
            plan[day] = {"type": "dead"}
            continue

        # Lazy day
        if day in lazy_days:
            plan[day] = {
                "type": "lazy",
                "sessions": 1,
                "duration_range": [3, 6],
                "likes": 0 if day <= 2 else random.randint(0, 2),
                "comments": 0,
                "follows": 0,
                "searches": 0,
                "explore_app": False,
            }
            continue

        # Day 1: Pure exploration, ZERO engagement
        if day == 1:
            plan[day] = {
                "type": "normal",
                "sessions": 1,
                "duration_range": [5, 10],
                "likes": 0,
                "comments": 0,
                "follows": 0,
                "searches": random.randint(2, 4),
                "explore_app": True,
            }
            continue

        # Day 2: Still ZERO likes (absolute rule)
        if day == 2:
            plan[day] = {
                "type": "normal",
                "sessions": 1,
                "duration_range": [5, 12],
                "likes": 0,
                "comments": 0,
                "follows": 0,
                "searches": random.randint(2, 4),
                "explore_app": False,
            }
            continue

        # Last day: First post + full engagement
        if day == total_days:
            plan[day] = {
                "type": "normal",
                "sessions": 2,
                "duration_range": [13, 20],
                "likes": random.randint(12, 25),
                "comments": random.randint(3, 8),
                "follows": random.randint(3, 8),
                "searches": random.randint(0, 1),
                "can_post": True,
                "use_camera_trick": state.platform == "tiktok",
                "explore_app": False,
            }
            continue

        # Middle days: Non-monotonic engagement curve
        progress = (day - 2) / max(1, total_days - 3)  # 0.0 to 1.0
        base_likes = int(3 + progress * 18)
        # Random variance: engagement can DROP from previous day
        variance = random.uniform(-0.4, 0.3)
        likes = max(1, int(base_likes * (1 + variance)))
        comments = max(0, int(likes * random.uniform(0.1, 0.35)))
        follows = max(0, int(likes * random.uniform(0.1, 0.30)))

        # Variable session count (60% one session, 40% two)
        sessions = 1 if random.random() < 0.6 else 2

        # Duration scales with progress
        dur_min = 8 + int(progress * 7)
        dur_max = dur_min + random.randint(3, 7)

        plan[day] = {
            "type": "normal",
            "sessions": sessions,
            "duration_range": [dur_min, dur_max],
            "likes": likes,
            "comments": comments,
            "follows": follows,
            "searches": random.randint(0, 2),
            "explore_app": False,
        }

    state.warmup_plan = plan

    # Log the full plan
    log.info("Warmup plan for %s (%s, %d days):",
             state.account_name, state.platform, total_days)
    for day in range(1, total_days + 1):
        cfg = plan[day]
        if cfg["type"] == "dead":
            log.info("  Day %d: DEAD (no sessions)", day)
        elif cfg["type"] == "lazy":
            log.info("  Day %d: LAZY (%d-%d min, %d likes)",
                     day, cfg["duration_range"][0], cfg["duration_range"][1],
                     cfg.get("likes", 0))
        else:
            extras = []
            if cfg.get("can_post"):
                extras.append("POST")
            if day == state.profile_pic_day:
                extras.append("PIC")
            if day == state.bio_day:
                extras.append("BIO")
            log.info("  Day %d: %d sess, %d-%d min, L=%d C=%d F=%d%s",
                     day, cfg["sessions"],
                     cfg["duration_range"][0], cfg["duration_range"][1],
                     cfg["likes"], cfg["comments"], cfg["follows"],
                     " | " + ", ".join(extras) if extras else "")


# Legacy alias (backwards compat with executor.py)
def assign_profile_setup_days(state: AccountWarmupState):
    """Generate the full warmup plan (profile days are assigned inside)."""
    generate_warmup_plan(state)


# =============================================================================
# Session Generator (called daily by executor)
# =============================================================================

def generate_warmup_sessions(state: AccountWarmupState) -> list[dict]:
    """Generate sessions for the current warmup day from the stored plan.

    Returns a list of session dicts compatible with the executor format.
    Dead days return an empty list (no sessions).
    """
    day = state.current_day
    if day < 1 or day > state.total_days:
        return []

    # Backwards compat: if no plan stored, generate one now
    if not state.warmup_plan:
        log.warning("No warmup plan found for %s, generating now", state.account_name)
        generate_warmup_plan(state)

    day_config = state.warmup_plan.get(day)
    if not day_config:
        log.warning("No config for day %d in warmup plan for %s", day, state.account_name)
        return []

    # Dead day = no sessions at all
    if day_config["type"] == "dead":
        log.info("Warmup day %d for %s: DEAD DAY (no sessions)", day, state.account_name)
        return []

    n_sessions = day_config.get("sessions", 1)
    sessions = []

    total_likes = day_config.get("likes", 0)
    total_comments = day_config.get("comments", 0)
    total_follows = day_config.get("follows", 0)
    total_searches = day_config.get("searches", 0)

    for i in range(n_sessions):
        duration = random.randint(*day_config["duration_range"])

        # Split engagement counts across sessions (roughly 60/40)
        if n_sessions > 1:
            if i == 0:
                likes = int(total_likes * 0.6)
                comments = int(total_comments * 0.6)
                follows = int(total_follows * 0.6)
                searches = max(1, int(total_searches * 0.6)) if total_searches else 0
            else:
                likes = total_likes - int(total_likes * 0.6)
                comments = total_comments - int(total_comments * 0.6)
                follows = total_follows - int(total_follows * 0.6)
                searches = total_searches - max(1, int(total_searches * 0.6)) if total_searches else 0
        else:
            likes = total_likes
            comments = total_comments
            follows = total_follows
            searches = total_searches

        # Build actions dict (compatible with executor._warmup_tiktok/_warmup_instagram)
        actions = {
            "scroll_fyp": True,
            "scroll_feed": True,
            "scroll_reels": True,
            "explore_app": day_config.get("explore_app", False) and i == 0,
            "explore_tab": day_config.get("explore_app", False) and i == 0,
            "search_niche": searches,
            "like": likes,
            "comment": comments,
            "share": 0,
            "follow": follows,
        }

        # Profile setup flags (only in first session of the day)
        set_pic = (i == 0 and day == state.profile_pic_day and not state.profile_pic_done)
        set_bio = (i == 0 and day == state.bio_day and not state.bio_done)

        # Can post only on last session of last day
        can_post = day_config.get("can_post", False) and i == n_sessions - 1

        sessions.append({
            "account_name": state.account_name,
            "phone_id": state.phone_id,
            "platform": state.platform,
            "session_type": "warmup",
            "warmup_day": day,
            "duration_minutes": duration,
            "actions": actions,
            "can_post": can_post,
            "use_camera_trick": day_config.get("use_camera_trick", False),
            "niche_keywords": state.niche_keywords,
            "set_profile_pic": set_pic,
            "set_bio": set_bio,
        })

    day_type = day_config["type"].upper()
    log.info("Warmup day %d (%s) for %s: %d sessions, %d min total",
             day, day_type, state.account_name, n_sessions,
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
