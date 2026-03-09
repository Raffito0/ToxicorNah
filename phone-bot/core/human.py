"""Human Behavior Engine — makes every interaction indistinguishable from a real person.

5 layers of humanization:
1. Fatigue     — engagement drops over session duration
2. Rabbit holes — deep profile visits after interesting videos
3. Interruptions — random pauses, app switches, screen locks
4. Memory      — remembers liked content, stays consistent
5. Mood        — daily energy/social multipliers affect everything
"""
import math
import random
import time
import logging
from dataclasses import dataclass, field
from typing import Optional

from .. import config

log = logging.getLogger(__name__)

H = config.HUMAN


# =============================================================================
# Layer 5: Daily Mood (set once per session)
# =============================================================================
@dataclass
class DailyMood:
    """Determines how active/social the account is today."""
    energy: float = 1.0       # overall activity multiplier (0.7-1.3)
    social: float = 1.0       # comment/follow probability multiplier (0.5-1.5)
    patience: float = 1.0     # how long before skipping videos (0.6-1.4)
    description: str = "normal"

    @classmethod
    def generate(cls, hour: int = 12, weekday: int = 2) -> "DailyMood":
        """Generate mood based on time of day and day of week."""
        energy = random.uniform(*H["mood_energy_range"])
        social = random.uniform(*H["mood_social_range"])
        patience = random.uniform(0.6, 1.4)

        # Morning = lower energy, evening = higher
        if hour < 9:
            energy *= 0.85
            social *= 0.7
        elif hour >= 20:
            energy *= 1.1
            social *= 1.15

        # Friday/Saturday night = more active
        if weekday in (4, 5) and hour >= 19:
            energy *= 1.2
            social *= 1.3

        # Monday morning = sluggish
        if weekday == 0 and hour < 12:
            energy *= 0.8
            patience *= 0.7

        desc = "energetic" if energy > 1.15 else "tired" if energy < 0.85 else "normal"

        return cls(
            energy=round(max(0.5, min(1.5, energy)), 2),
            social=round(max(0.3, min(2.0, social)), 2),
            patience=round(max(0.4, min(1.8, patience)), 2),
            description=desc,
        )


# =============================================================================
# Layer 4: Content Memory (remembers what you liked)
# =============================================================================
@dataclass
class ContentMemory:
    """Tracks liked content categories to maintain consistency."""
    liked_categories: dict = field(default_factory=dict)   # {"cooking": 5, "dance": 3}
    disliked_categories: dict = field(default_factory=dict)
    recent_creators: list = field(default_factory=list)    # last 20 creators interacted with
    session_likes: int = 0
    session_comments: int = 0

    def record_like(self, category: str, creator: str = ""):
        self.liked_categories[category] = self.liked_categories.get(category, 0) + 1
        self.session_likes += 1
        if creator and creator not in self.recent_creators:
            self.recent_creators.append(creator)
            if len(self.recent_creators) > 20:
                self.recent_creators.pop(0)

    def record_skip(self, category: str):
        self.disliked_categories[category] = self.disliked_categories.get(category, 0) + 1

    def should_like(self, category: str, base_prob: float) -> float:
        """Adjust like probability based on content memory.
        If you liked cooking before, you're more likely to like cooking again."""
        likes = self.liked_categories.get(category, 0)
        dislikes = self.disliked_categories.get(category, 0)

        if likes > 3:
            base_prob *= 1.3  # more likely to engage with familiar content
        elif dislikes > 3:
            base_prob *= 0.6  # less likely with disliked content

        return min(0.95, max(0.05, base_prob))


# =============================================================================
# Layer 1: Session Fatigue
# =============================================================================
@dataclass
class FatigueTracker:
    """Tracks engagement decay over session duration."""
    session_start: float = 0.0
    fatigue_start_min: float = 10.0

    def start(self):
        self.session_start = time.time()

    @property
    def minutes_active(self) -> float:
        if not self.session_start:
            return 0
        return (time.time() - self.session_start) / 60

    @property
    def fatigue_level(self) -> float:
        """0.0 = fresh, 1.0 = very fatigued. Ramps up after fatigue_start_min."""
        mins = self.minutes_active
        if mins < self.fatigue_start_min:
            return 0.0
        # Sigmoid-ish ramp: reaches ~0.8 at 25 min, ~0.95 at 35 min
        x = (mins - self.fatigue_start_min) / 15.0
        return min(1.0, x / (1 + x))

    def adjust_like_prob(self, base_prob: float) -> float:
        """Reduce like probability as fatigue increases."""
        drop = H["fatigue_like_drop"]
        factor = 1.0 - (self.fatigue_level * (1.0 - drop))
        return base_prob * factor

    def adjust_watch_time(self, base_seconds: float) -> float:
        """Reduce watch time when fatigued (skip videos faster)."""
        speed_boost = H["fatigue_scroll_speed_boost"]
        factor = 1.0 + (self.fatigue_level * (speed_boost - 1.0))
        return max(1.0, base_seconds / factor)

    def should_comment(self, base_prob: float) -> float:
        """Comments drop sharply with fatigue."""
        return base_prob * max(0.1, 1.0 - self.fatigue_level * 0.9)


# =============================================================================
# Main Human Engine
# =============================================================================
class HumanEngine:
    """Wraps all 5 human behavior layers into a unified interface.

    Usage:
        engine = HumanEngine()
        engine.start_session(hour=20, weekday=4)

        # Before every tap:
        x, y = engine.jitter_tap(540, 1200)

        # Before every swipe:
        params = engine.humanize_swipe(540, 1800, 540, 600)

        # Decide whether to like:
        if engine.should_like("dance", creator="@username"):
            ...

        # Wait between actions:
        await engine.wait_between_actions()

        # Check for interruption:
        if engine.should_interrupt():
            await engine.do_interruption(adb)
    """

    def __init__(self):
        self.mood = DailyMood()
        self.memory = ContentMemory()
        self.fatigue = FatigueTracker()
        self._session_active = False

    def start_session(self, hour: int = 12, weekday: int = 2):
        """Initialize all layers for a new session."""
        self.mood = DailyMood.generate(hour=hour, weekday=weekday)
        self.fatigue = FatigueTracker()
        self.fatigue.start()
        self._session_active = True
        log.info("Session started | mood=%s energy=%.2f social=%.2f",
                 self.mood.description, self.mood.energy, self.mood.social)

    def end_session(self):
        self._session_active = False

    # --- Layer 1: Tap Jitter -----------------------------------------------

    def jitter_tap(self, x: int, y: int) -> tuple[int, int]:
        """Add Gaussian noise to tap coordinates like a real thumb."""
        sigma_x = H["tap_sigma_x"]
        sigma_y = H["tap_sigma_y"]

        # Bottom of screen = more Y variance (thumb reach)
        if y > 1500:
            sigma_y *= 1.3

        jx = int(random.gauss(x, sigma_x))
        jy = int(random.gauss(y, sigma_y))
        return jx, jy

    # --- Layer 1: Swipe Humanization ---------------------------------------

    def humanize_swipe(self, x1: int, y1: int, x2: int, y2: int) -> dict:
        """Add human-like variance to a swipe gesture."""
        duration = random.randint(*H["swipe_duration_range"])
        jitter = H["swipe_y_jitter"]
        drift = random.randint(*H["swipe_x_drift_range"])

        return {
            "x1": x1 + random.randint(-jitter // 2, jitter // 2),
            "y1": y1 + random.randint(-jitter, jitter),
            "x2": x2 + drift,
            "y2": y2 + random.randint(-jitter, jitter),
            "duration": duration,
        }

    # --- Layer 1: Timing ---------------------------------------------------

    def action_delay(self) -> float:
        """Random delay between actions (log-normal distribution)."""
        base = random.uniform(*H["between_action_range"])
        # Apply mood energy (tired = slower)
        delay = base / self.mood.energy

        # Micro-pause (random hesitation)
        if random.random() < H["micro_pause_prob"]:
            delay += random.uniform(0.05, 0.2)

        # Fatigue makes you slightly slower (zoning out)
        delay *= (1 + self.fatigue.fatigue_level * 0.3)

        return max(0.2, delay)

    def typing_delay(self) -> float:
        """Delay between keystrokes when typing."""
        base = random.uniform(*H["typing_speed_range"])
        # Occasional longer pause (thinking what to type)
        if random.random() < 0.08:
            base += random.uniform(0.3, 1.0)
        return base

    def reading_delay(self) -> float:
        """Pause before commenting (reading the content first)."""
        return random.uniform(*H["reading_pause_range"]) * self.mood.patience

    def watch_duration(self, video_length: float = 15.0) -> float:
        """How long to watch a video before scrolling.
        Some videos: watch fully. Some: skip after 2-3s."""
        # 30% chance of watching full video
        if random.random() < 0.30 * self.mood.patience:
            watch = video_length * random.uniform(0.85, 1.1)
        # 40% watch half
        elif random.random() < 0.60:
            watch = video_length * random.uniform(0.3, 0.6)
        # 30% skip quickly
        else:
            watch = random.uniform(1.5, 4.0)

        return self.fatigue.adjust_watch_time(watch)

    # --- Layer 2: Engagement Decisions -------------------------------------

    def should_like(self, category: str = "unknown", creator: str = "") -> bool:
        """Decide whether to like the current video."""
        base_prob = 0.35  # 30-50% base like rate
        base_prob *= self.mood.energy
        base_prob = self.fatigue.adjust_like_prob(base_prob)
        base_prob = self.memory.should_like(category, base_prob)
        return random.random() < base_prob

    def should_comment(self) -> bool:
        """Decide whether to comment on the current video."""
        base_prob = 0.08 * self.mood.social
        base_prob = self.fatigue.should_comment(base_prob)
        return random.random() < base_prob

    def should_follow(self, creator: str = "") -> bool:
        """Decide whether to follow the current creator."""
        if creator in self.memory.recent_creators:
            return False  # don't follow someone you already interacted with
        base_prob = 0.04 * self.mood.social
        base_prob *= max(0.2, 1.0 - self.fatigue.fatigue_level * 0.7)
        return random.random() < base_prob

    # --- Layer 2: Rabbit Holes ---------------------------------------------

    def should_rabbit_hole(self) -> bool:
        """Decide whether to visit a creator's profile (deep dive)."""
        prob = H["rabbit_hole_prob"] * self.mood.patience
        # Less likely when fatigued
        prob *= max(0.2, 1.0 - self.fatigue.fatigue_level * 0.6)
        return random.random() < prob

    def rabbit_hole_depth(self) -> int:
        """How many videos to watch on a creator's profile."""
        return random.randint(*H["rabbit_hole_videos_range"])

    # --- Layer 3: Interruptions --------------------------------------------

    def should_interrupt(self) -> bool:
        """Per-minute chance of a random interruption."""
        return random.random() < H["interruption_prob"]

    def interruption_type(self) -> str:
        """What kind of interruption: 'pause', 'app_switch', or 'lock_screen'."""
        roll = random.random()
        if roll < H["app_switch_prob"]:
            return "app_switch"
        elif roll < H["app_switch_prob"] + 0.15:
            return "lock_screen"
        else:
            return "pause"

    def interruption_duration(self) -> float:
        """How long the interruption lasts (seconds)."""
        return random.uniform(*H["interruption_duration_range"])

    async def do_interruption(self, adb):
        """Execute an interruption on the device."""
        itype = self.interruption_type()
        duration = self.interruption_duration()

        log.info("Interruption: %s for %.0fs", itype, duration)

        if itype == "app_switch":
            # Go home, wait, come back
            adb.press_home()
            await asyncio.sleep(duration)
            adb.press_back()  # return to previous app via recents

        elif itype == "lock_screen":
            # Lock screen, wait, unlock
            adb.shell("input keyevent KEYCODE_POWER")
            await asyncio.sleep(duration)
            adb.unlock_screen()

        else:
            # Just pause (stare at screen)
            await asyncio.sleep(duration)

    # --- Layer 5: Engagement Mix -------------------------------------------

    def session_engagement_mix(self) -> dict:
        """Generate randomized engagement mix for this session.
        Each value is the proportion of time spent on that activity."""
        mix = {}
        for action, base_pct in config.ENGAGEMENT_MIX.items():
            # +/-30% randomization
            variation = random.uniform(0.7, 1.3)
            mix[action] = base_pct * variation

        # Apply mood: social mood = more comments/follows
        mix["comment"] *= self.mood.social
        mix["follow"] *= self.mood.social
        mix["like"] *= self.mood.energy

        # Normalize to 1.0
        total = sum(mix.values())
        return {k: v / total for k, v in mix.items()}

    def pick_action(self, mix: dict) -> str:
        """Pick next action based on engagement mix weights."""
        actions = list(mix.keys())
        weights = list(mix.values())
        return random.choices(actions, weights=weights, k=1)[0]


# Need asyncio import for do_interruption
import asyncio
