"""Human Behavior Engine -- makes every interaction indistinguishable from a real person.

7 layers of humanization:
1. Log-normal timing    -- heavy-tailed delays (mostly fast, occasional long pauses)
2. Session Flow Phases  -- Arrival -> Warmup -> Peak -> Fatigue -> Exit
3. Fatigue              -- engagement drops over session duration
4. Rabbit holes         -- deep profile visits after interesting videos
5. Interruptions        -- random pauses, app switches, screen locks
6. Memory               -- remembers liked content, stays consistent
7. Mood                 -- daily energy/social multipliers affect everything

Plus 14 human-like micro-behaviors (typing errors, zona morta, like bursts, etc.)
"""
import asyncio
import json
import math
import os
import random
import string
import time
import logging
from dataclasses import dataclass, field
from typing import Optional

from .. import config

log = logging.getLogger(__name__)

H = config.HUMAN


# =============================================================================
# QWERTY adjacency map for typing errors
# =============================================================================

_QWERTY_ADJACENT = {
    'q': 'wa', 'w': 'qeas', 'e': 'wrds', 'r': 'etdf', 't': 'ryfg',
    'y': 'tugh', 'u': 'yijh', 'i': 'uojk', 'o': 'iplk', 'p': 'ol',
    'a': 'qwsz', 's': 'awedxz', 'd': 'serfcx', 'f': 'drtgvc',
    'g': 'ftyhbv', 'h': 'gyujnb', 'j': 'huiknm', 'k': 'jiolm',
    'l': 'kop', 'z': 'asx', 'x': 'zsdc', 'c': 'xdfv', 'v': 'cfgb',
    'b': 'vghn', 'n': 'bhjm', 'm': 'njk',
}


def _nearby_char(c: str) -> str:
    """Return a plausible typo for a character (adjacent key on QWERTY)."""
    adj = _QWERTY_ADJACENT.get(c.lower(), "")
    if adj:
        return random.choice(adj)
    return random.choice(string.ascii_lowercase)


def _lognormal(median: float, sigma: float, minimum: float = 0.0,
               maximum: float = float('inf')) -> float:
    """Sample from a log-normal distribution with given median and sigma.
    Clamped to [minimum, maximum]."""
    mu = math.log(max(median, 0.001))
    val = random.lognormvariate(mu, sigma)
    return max(minimum, min(maximum, val))


def _timing(name: str) -> float:
    """Sample from a log-normal timing param: (median, sigma, min, max).
    All timing parameters in config.HUMAN use this format."""
    p = H[name]
    return _lognormal(p[0], p[1], p[2], p[3])


# =============================================================================
# Layer 7: Daily Mood
# =============================================================================

@dataclass
class DailyMood:
    """Determines how active/social the account is today."""
    energy: float = 1.0
    social: float = 1.0
    patience: float = 1.0
    description: str = "normal"

    @classmethod
    def generate(cls, hour: int = 12, weekday: int = 2) -> "DailyMood":
        energy = random.uniform(*H["mood_energy_range"])
        social = random.uniform(*H["mood_social_range"])
        patience = random.uniform(0.6, 1.4)

        if hour < 9:
            energy *= 0.85
            social *= 0.7
        elif hour >= 20:
            energy *= 1.1
            social *= 1.15

        if weekday in (4, 5) and hour >= 19:
            energy *= 1.2
            social *= 1.3

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
# Layer 6: Content Memory
# =============================================================================

@dataclass
class ContentMemory:
    """Tracks liked content categories to maintain consistency.
    Persists across sessions via save/load JSON."""
    liked_categories: dict = field(default_factory=dict)
    disliked_categories: dict = field(default_factory=dict)
    recent_creators: list = field(default_factory=list)
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

    def like_affinity(self, category: str, base_prob: float) -> float:
        """Adjust like probability based on content memory."""
        likes = self.liked_categories.get(category, 0)
        dislikes = self.disliked_categories.get(category, 0)
        if likes > 3:
            base_prob *= 1.3
        elif dislikes > 3:
            base_prob *= 0.6
        return min(0.95, max(0.05, base_prob))

    def to_dict(self) -> dict:
        return {
            "liked_categories": self.liked_categories,
            "disliked_categories": self.disliked_categories,
            "recent_creators": self.recent_creators,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ContentMemory":
        return cls(
            liked_categories=d.get("liked_categories", {}),
            disliked_categories=d.get("disliked_categories", {}),
            recent_creators=d.get("recent_creators", []),
        )


# =============================================================================
# Layer 8: Personality (per-account, persistent, drifts over time)
# =============================================================================

@dataclass
class Personality:
    """Per-account behavioral identity. Generated once, drifts slowly over sessions.

    Each account develops its own habits: some prefer Reels, some double-tap,
    some watch stories often. These traits evolve based on actual behavior --
    like a real person whose habits shift over weeks and months.
    """
    reels_preference: float = 0.50
    story_affinity: float = 0.25
    double_tap_habit: float = 0.60
    explore_curiosity: float = 0.10
    boredom_rate: float = 0.12
    boredom_relief: float = 0.40
    switch_threshold: float = 0.70
    sessions_count: int = 0

    @classmethod
    def generate(cls) -> "Personality":
        """Create a new personality with random traits within configured ranges."""
        ranges = config.PERSONALITY_RANGES
        return cls(**{
            trait: random.uniform(*bounds)
            for trait, bounds in ranges.items()
        })

    def drift(self, session_stats: dict):
        """Evolve traits slightly based on what happened this session.
        Called at end of every session. Small shifts compound over weeks."""
        rate = config.PERSONALITY_DRIFT
        ranges = config.PERSONALITY_RANGES
        self.sessions_count += 1

        # Reels preference: drift toward where more likes happened
        reels_likes = session_stats.get("reels_likes", 0)
        feed_likes = session_stats.get("feed_likes", 0)
        total_likes = reels_likes + feed_likes
        if total_likes > 0:
            reels_ratio = reels_likes / total_likes
            if reels_ratio > 0.6:
                self.reels_preference += random.uniform(0, rate)
            elif reels_ratio < 0.4:
                self.reels_preference -= random.uniform(0, rate)

        # Story affinity: drift based on whether stories were watched
        if session_stats.get("stories_watched", 0) > 0:
            self.story_affinity += random.uniform(0, rate * 0.5)
        else:
            self.story_affinity -= random.uniform(0, rate * 0.3)

        # Explore curiosity: drift based on search usage
        if session_stats.get("searches_done", 0) > 0:
            self.explore_curiosity += random.uniform(0, rate * 0.5)
        else:
            self.explore_curiosity -= random.uniform(0, rate * 0.2)

        # Clamp all traits to valid ranges
        for trait, (lo, hi) in ranges.items():
            val = getattr(self, trait)
            setattr(self, trait, round(max(lo, min(hi, val)), 4))

    def to_dict(self) -> dict:
        return {
            "reels_preference": self.reels_preference,
            "story_affinity": self.story_affinity,
            "double_tap_habit": self.double_tap_habit,
            "explore_curiosity": self.explore_curiosity,
            "boredom_rate": self.boredom_rate,
            "boredom_relief": self.boredom_relief,
            "switch_threshold": self.switch_threshold,
            "sessions_count": self.sessions_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Personality":
        p = cls()
        for trait in config.PERSONALITY_RANGES:
            if trait in d:
                setattr(p, trait, d[trait])
        p.sessions_count = d.get("sessions_count", 0)
        return p


# =============================================================================
# Layer 9: Boredom Tracker (drives view switches and exploration)
# =============================================================================

class BoredomTracker:
    """Tracks boredom during a session. Replaces fixed timers for view switches.

    Boredom rises with passive scrolling, drops with engagement (like/comment/follow).
    Interesting content (niche match) slows boredom buildup.
    When boredom exceeds the personality's switch_threshold, triggers a view change.
    """

    def __init__(self, personality: Personality):
        self.personality = personality
        self.level = 0.0  # 0.0 = engaged, 1.0 = very bored

    def on_scroll(self, niche_match: bool = None):
        """Boredom increases with each passive scroll.
        niche_match: True = interesting content, False = boring, None = unknown.
        """
        rate = self.personality.boredom_rate
        if niche_match is True:
            rate *= 0.4   # interesting content = much slower boredom
        elif niche_match is False:
            rate *= 1.3   # boring content = faster boredom
        # Add noise so boredom growth is never linear
        self.level += rate * random.uniform(0.6, 1.4)
        self.level = min(1.0, self.level)

    def on_engage(self):
        """Engagement (like, comment, follow) relieves boredom."""
        relief = self.personality.boredom_relief * random.uniform(0.7, 1.3)
        self.level = max(0.0, self.level - relief)

    def wants_switch(self) -> bool:
        """Should we switch views (Feed<->Reels)?
        Probability rises steeply once boredom passes the personality threshold.
        """
        threshold = self.personality.switch_threshold
        if self.level >= threshold:
            excess = self.level - threshold
            prob = min(0.8, excess * 3)  # steep rise past threshold
            if random.random() < prob:
                self.level *= 0.4  # partial reset after switching
                return True
        return False

    def reset(self):
        """Full reset (e.g. after posting a video)."""
        self.level = random.uniform(0.0, 0.15)


# =============================================================================
# Layer 3: Session Fatigue
# =============================================================================

@dataclass
class FatigueTracker:
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
        """0.0 = fresh, 1.0 = very fatigued."""
        mins = self.minutes_active
        if mins < self.fatigue_start_min:
            return 0.0
        x = (mins - self.fatigue_start_min) / 15.0
        return min(1.0, x / (1 + x))

    def adjust_like_prob(self, base_prob: float) -> float:
        drop = H["fatigue_like_drop"]
        factor = 1.0 - (self.fatigue_level * (1.0 - drop))
        return base_prob * factor

    def adjust_watch_time(self, base_seconds: float) -> float:
        speed_boost = H["fatigue_scroll_speed_boost"]
        factor = 1.0 + (self.fatigue_level * (speed_boost - 1.0))
        return max(1.0, base_seconds / factor)


# =============================================================================
# Layer 2: Session Flow Phases
# =============================================================================

class SessionPhaseTracker:
    """Tracks which phase of the session we're in.
    Phases: arrival -> warmup -> peak -> fatigue -> exit
    Durations are randomized and scaled to fit the total session length.
    """
    PHASES = ["arrival", "warmup", "peak", "fatigue", "exit"]

    def __init__(self, total_duration_minutes: float):
        self.start_time = time.time()
        self.total_duration = total_duration_minutes
        self.boundaries = {}
        self._build_phases()

    def _build_phases(self):
        raw_durations = {}
        for phase in self.PHASES:
            cfg = config.SESSION_PHASES[phase]
            raw_durations[phase] = random.uniform(*cfg["duration_range"])

        # Scale to fit total session duration
        total_raw = sum(raw_durations.values())
        scale = self.total_duration / total_raw

        cumulative = 0.0
        for phase in self.PHASES:
            start = cumulative
            cumulative += raw_durations[phase] * scale
            self.boundaries[phase] = (start, cumulative)

    @property
    def elapsed_minutes(self) -> float:
        return (time.time() - self.start_time) / 60

    @property
    def current_phase(self) -> str:
        elapsed = self.elapsed_minutes
        for phase in self.PHASES:
            start, end = self.boundaries[phase]
            if start <= elapsed < end:
                return phase
        return "exit"

    def get_mix(self) -> dict:
        """Get engagement mix for current phase with slight randomization."""
        phase = self.current_phase
        base = config.SESSION_PHASES[phase]["engagement"]
        mix = {}
        for action, weight in base.items():
            mix[action] = weight * random.uniform(0.8, 1.2)
        # Normalize
        total = sum(mix.values())
        if total > 0:
            mix = {k: v / total for k, v in mix.items()}
        return mix


# =============================================================================
# Like Burst Tracker (Behavior #12)
# =============================================================================

class LikeBurstTracker:
    """Tracks like burst state -- clustered likes with gaps between them."""

    def __init__(self):
        self.in_burst = False
        self.burst_remaining = 0
        self.skip_remaining = 0
        self.just_liked = False

    def process(self, base_should_like: bool) -> bool:
        """Decide whether to like, applying burst logic."""
        # In skip mode: don't like
        if self.skip_remaining > 0:
            self.skip_remaining -= 1
            self.just_liked = False
            return False

        # In burst mode: always like
        if self.in_burst and self.burst_remaining > 0:
            self.burst_remaining -= 1
            if self.burst_remaining == 0:
                self.in_burst = False
                self.skip_remaining = random.randint(*H["like_burst_skip"])
            self.just_liked = True
            return True

        # Normal mode: maybe start a burst
        if base_should_like:
            if random.random() < H["like_burst_prob"]:
                self.in_burst = True
                self.burst_remaining = random.randint(*H["like_burst_count"]) - 1
            self.just_liked = True
            return True

        self.just_liked = False
        return False


# =============================================================================
# Main Human Engine
# =============================================================================

class HumanEngine:
    """Wraps all 7 human behavior layers + 14 micro-behaviors into a unified interface.

    Usage:
        engine = HumanEngine()
        engine.start_session(hour=20, weekday=4, duration_minutes=18)

        # Before every tap:
        x, y = engine.jitter_tap(540, 1200)

        # Between actions:
        delay = engine.action_delay()

        # Pick next action (phase-aware):
        action = engine.pick_action()

        # Check for behaviors:
        if engine.should_zona_morta():
            await asyncio.sleep(engine.zona_morta_duration())
    """

    def __init__(self, account_name: str = ""):
        self.account_name = account_name
        self.mood = DailyMood()
        self.memory = ContentMemory()
        self.personality = Personality.generate()
        self.boredom = BoredomTracker(self.personality)
        self.fatigue = FatigueTracker()
        self.phase: Optional[SessionPhaseTracker] = None
        self.burst = LikeBurstTracker()
        self._session_active = False
        self._video_count = 0
        self._zona_morta_next = 0.0
        self._session_stats = {}
        # Load persisted memory + personality for this account
        if account_name:
            self._load_memory()
            self.boredom = BoredomTracker(self.personality)

    def start_session(self, hour: int = 12, weekday: int = 2,
                      duration_minutes: float = 15.0):
        """Initialize all layers for a new session."""
        self.mood = DailyMood.generate(hour=hour, weekday=weekday)
        self.fatigue = FatigueTracker()
        self.fatigue.start()
        self.phase = SessionPhaseTracker(duration_minutes)
        self.burst = LikeBurstTracker()
        self.boredom = BoredomTracker(self.personality)
        self._session_active = True
        self._video_count = 0
        self._zona_morta_next = time.time() + _timing("zona_morta_interval")
        self._session_stats = {
            "reels_likes": 0, "feed_likes": 0,
            "stories_watched": 0, "searches_done": 0,
        }
        log.info("Session started | mood=%s energy=%.2f social=%.2f | %.0f min | "
                 "personality: reels=%.0f%% stories=%.0f%% dbl_tap=%.0f%% | phases=%s",
                 self.mood.description, self.mood.energy, self.mood.social,
                 duration_minutes,
                 self.personality.reels_preference * 100,
                 self.personality.story_affinity * 100,
                 self.personality.double_tap_habit * 100,
                 {p: f"{s:.1f}-{e:.1f}" for p, (s, e) in self.phase.boundaries.items()})

    def end_session(self):
        self._session_active = False
        # Evolve personality based on session behavior
        self.personality.drift(self._session_stats)
        if self.account_name:
            self._save_memory()

    def _memory_path(self) -> str:
        return os.path.join(config.DATA_DIR, f"memory_{self.account_name}.json")

    def _load_memory(self):
        path = self._memory_path()
        if os.path.exists(path):
            try:
                with open(path, "r") as f:
                    data = json.load(f)
                self.memory = ContentMemory.from_dict(data)
                if "personality" in data:
                    self.personality = Personality.from_dict(data["personality"])
                    log.debug("Loaded personality for %s (sessions=%d)",
                              self.account_name, self.personality.sessions_count)
                else:
                    log.debug("No personality found for %s, using generated",
                              self.account_name)
            except (json.JSONDecodeError, OSError) as e:
                log.warning("Failed to load memory for %s: %s", self.account_name, e)

    def _save_memory(self):
        path = self._memory_path()
        try:
            data = self.memory.to_dict()
            data["personality"] = self.personality.to_dict()
            with open(path, "w") as f:
                json.dump(data, f)
        except OSError as e:
            log.warning("Failed to save memory for %s: %s", self.account_name, e)

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

    def _init_swipe_habit(self):
        """Generate per-session swipe identity (muscle memory baseline).

        Thumb physics: you hold the phone in one hand. The thumb pivots from
        the base of your palm (bottom-right for right-handed). This means:
        - The thumb rests on the RIGHT side of the screen, not the center
        - When swiping UP, the thumb curves INWARD (right → center)
        - The grip offset is significant: 30-50px from center on a 720px screen
        - All of this is consistent for the entire session
        """
        # Handedness: +1 = right-handed (75%), -1 = left-handed (25%)
        self._handedness = random.choice([1, 1, 1, -1])

        self._swipe_habit = {
            # Where thumb naturally starts Y (% offset from caller base)
            "start_y_bias": random.gauss(0, 0.04),
            # Personal speed: 0.85 = slightly fast, 1.15 = slightly slow
            "speed_mult": random.uniform(0.85, 1.20),
            # How far from center the thumb rests (px). Right-handed = positive.
            # On a 720px screen, 30-50px offset = thumb at ~55-57% of screen width
            "grip_offset": self._handedness * random.uniform(25, 50),
            # How much the thumb curves inward during upswipe (px)
            # Bigger = more arc. Real thumbs curve 15-30px inward over a full swipe
            "arc_inward": random.uniform(12, 28),
            # Precision: tight=0.7, sloppy=1.3
            "noise_level": random.uniform(0.7, 1.3),
        }
        # Grip X: where the thumb sits right now (varies slowly with grip shifts)
        self._grip_x_offset = int(
            self._swipe_habit["grip_offset"] + random.gauss(0, 5)
        )
        self._swipes_until_grip_shift = random.randint(12, 30)
        self._swipe_count = 0
        # Previous swipe duration for smooth transitions
        self._prev_duration = None
        # Previous start Y for position continuity
        self._prev_start_y_offset = None

    def _update_grip(self):
        """Shift grip position every N swipes (adjusting hand on phone).
        Shift is small and stays on the same side — you don't switch hands."""
        self._swipe_count += 1
        self._swipes_until_grip_shift -= 1
        if self._swipes_until_grip_shift <= 0:
            old = self._grip_x_offset
            # Small shift: stays near the natural grip offset
            self._grip_x_offset = int(
                old * 0.5 + self._swipe_habit["grip_offset"] * 0.5
                + random.gauss(0, 6)
            )
            self._swipes_until_grip_shift = random.randint(12, 30)

    def humanize_swipe(self, x1: int, y1: int, x2: int, y2: int) -> dict:
        """Generate a swipe indistinguishable from a real TikTok/IG user.

        How a real person scrolls TikTok:
        - You hold the phone the same way for dozens of swipes
        - Your thumb does the same gesture from muscle memory, over and over
        - Each swipe is ALMOST the same as the last one (±10-15% variation)
        - Speed changes happen GRADUALLY over several swipes, not suddenly
        - Position varies subtly (±25-35px) — your thumb doesn't land on exact pixels
        - Your hand arc always curves the same direction (your hand shape)
        - Over time you get slightly slower/lazier (fatigue)
        - Once in a while (~3%) a swipe is a bit off — NOT wildly different,
          just slightly faster or slower than your usual range

        The BIG human variation in TikTok comes from WATCH DURATION and
        engagement timing — NOT from wildly different swipe gestures.
        """
        if not hasattr(self, '_swipe_habit'):
            self._init_swipe_habit()

        habit = self._swipe_habit
        dy = y2 - y1
        distance = max(abs(dy), 50)
        noise = habit["noise_level"]

        # --- Start Y: muscle memory + subtle noise + position continuity ---
        fatigue_drop = self.fatigue.fatigue_level * distance * 0.05
        raw_start_y = (
            distance * habit["start_y_bias"]
            + fatigue_drop
            + random.gauss(0, distance * 0.025 * noise)
        )
        # Smooth position continuity: blend with previous position
        if self._prev_start_y_offset is not None:
            raw_start_y = self._prev_start_y_offset * 0.3 + raw_start_y * 0.7
        start_y_offset = int(raw_start_y)
        self._prev_start_y_offset = raw_start_y

        # --- End Y: subtle noise, adjusted after duration ---
        end_y_base_noise = random.gauss(0, distance * 0.02 * noise)

        # --- X position: thumb surface area + inward arc ---
        # The thumb is NOT a point — it's a pad. Where it touches the screen
        # varies: sometimes more with the tip (closer to center), sometimes
        # more with the side (closer to edge). ±10-15px variation per swipe.
        self._update_grip()
        thumb_contact = int(random.gauss(0, 11 * noise))
        start_x = self._grip_x_offset + thumb_contact

        # Arc: thumb curves INWARD during upswipe (toward center),
        # but the AMOUNT varies a lot — sometimes almost straight,
        # sometimes a noticeable curve. Gaussian around the baseline
        # with wide sigma so some swipes are nearly straight (3px)
        # and some curve a lot (25px+)
        swiping_up = dy < 0
        arc_amount = max(0, random.gauss(habit["arc_inward"], habit["arc_inward"] * 0.4))
        if swiping_up:
            arc_direction = -self._handedness  # toward center
        else:
            arc_direction = self._handedness   # back toward hand
        end_x = self._grip_x_offset + int(arc_direction * arc_amount)

        # --- Duration: personal baseline + subtle gaussian variation ---
        baseline = H["swipe_duration_median"] * habit["speed_mult"]
        baseline /= max(self.mood.energy, 0.6)
        baseline *= (1 + self.fatigue.fatigue_level * 0.15)
        if self.fatigue.minutes_active < H["speed_ramp_minutes"]:
            baseline *= 1.10

        # Per-swipe noise: gaussian ±12% around baseline
        raw_duration = baseline * random.gauss(1.0, 0.12)

        # Rare slightly-off swipe (3%): ±30-40% from baseline (NOT from prev)
        # This is like a slightly lazy swipe or a slightly quick one — subtle
        if random.random() < 0.03:
            if random.random() < 0.5:
                raw_duration = baseline * random.uniform(0.65, 0.75)
            else:
                raw_duration = baseline * random.uniform(1.30, 1.40)

        # --- Smooth transition: limit change vs previous to ±25% ---
        # A real thumb can't go from 400ms to 150ms in one gesture.
        # Changes are GRADUAL — you speed up or slow down over several swipes.
        if self._prev_duration is not None:
            ratio = raw_duration / self._prev_duration
            if ratio > 1.25:
                raw_duration = self._prev_duration * (1 + 0.25 * random.uniform(0.5, 1.0))
            elif ratio < 0.75:
                raw_duration = self._prev_duration * (1 - 0.25 * random.uniform(0.5, 1.0))

        duration = int(max(180, min(600, raw_duration)))
        self._prev_duration = duration

        # --- Speed-distance correlation (subtle) ---
        speed_ratio = baseline / max(duration, 150)
        distance_adjust = int((speed_ratio - 1.0) * distance * 0.08)
        end_y_offset = int(end_y_base_noise) + distance_adjust
        end_y_offset += int(self.fatigue.fatigue_level * distance * 0.03)

        return {
            "x1": x1 + start_x,
            "y1": y1 + start_y_offset,
            "x2": x2 + end_x,
            "y2": y2 + end_y_offset,
            "duration": duration,
        }

    # --- Layer 1: Timing (all log-normal) ----------------------------------

    def action_delay(self) -> float:
        """Random delay between actions (log-normal, heavy tail)."""
        base = _lognormal(
            H["action_delay_median"], H["action_delay_sigma"],
            minimum=0.2, maximum=20.0
        )
        # Apply mood energy (tired = slower)
        delay = base / self.mood.energy

        # Micro-pause (random hesitation)
        if random.random() < H["micro_pause_prob"]:
            delay += _timing("micro_pause")

        # Fatigue makes you slightly slower
        delay *= (1 + self.fatigue.fatigue_level * 0.3)

        # Speed ramp: slower at session start (Behavior #7)
        if self.fatigue.minutes_active < H["speed_ramp_minutes"]:
            delay *= H["speed_ramp_slow_factor"]

        return max(0.2, delay)

    def typing_delay(self, rhythm: str = "confident",
                     pos_ratio: float = 0.5,
                     after_space: bool = False,
                     is_corner_key: bool = False) -> float:
        """Delay between keystrokes -- varies by rhythm, position, and state.

        Rhythm profiles (chosen per-text, not per-char):
          confident -- knows what to say, fast and steady
          composing -- thinking while typing, irregular pauses
          rush      -- wants to send fast, accelerates
          careful   -- important text, slow and deliberate
        """
        base_median = H["typing_median"]  # 0.15s reference
        sigma = H["typing_sigma"]  # 0.4

        # --- Rhythm modifies the base speed ---
        if rhythm == "confident":
            speed = 0.85  # slightly faster than default
            sigma *= 0.8  # more consistent
        elif rhythm == "composing":
            speed = 1.1   # slightly slower
            sigma *= 1.3  # more irregular
        elif rhythm == "rush":
            # Accelerates toward end
            speed = 1.0 - pos_ratio * 0.35  # 1.0 at start -> 0.65 at end
            sigma *= 0.7  # tight timing when rushing
        elif rhythm == "careful":
            speed = 1.3   # noticeably slower
            sigma *= 0.6  # very consistent
        else:
            speed = 1.0

        # --- State modifiers ---
        # Fatigue: tired = slower + more variable
        speed *= (1 + self.fatigue.fatigue_level * 0.4)
        sigma *= (1 + self.fatigue.fatigue_level * 0.3)
        # Energy: high energy = faster
        speed *= max(0.7, 1.3 - self.mood.energy * 0.4)

        # --- Positional modifiers (NOT always applied) ---
        # Corner keys (q, z, p, x, etc.) = slightly slower ~60% of the time
        if is_corner_key and random.random() < 0.6:
            speed *= random.uniform(1.08, 1.25)

        # After space = sometimes a word-gap pause
        if after_space:
            # In composing mode, longer pauses between words
            if rhythm == "composing" and random.random() < 0.55:
                speed *= random.uniform(1.4, 2.5)
            elif rhythm == "rush" and random.random() < 0.15:
                speed *= random.uniform(1.1, 1.3)
            elif random.random() < 0.35:
                speed *= random.uniform(1.15, 1.6)

        base = _lognormal(base_median * speed, sigma, minimum=0.04, maximum=3.0)
        return base

    def reading_delay(self) -> float:
        """Pause before commenting (log-normal)."""
        return _lognormal(
            H["reading_median"], H["reading_sigma"],
            minimum=0.5, maximum=15.0
        ) * self.mood.patience

    def watch_duration(self, video_length: float = 15.0) -> float:
        """How long to watch a video before scrolling.
        Heavy-tailed: most quick, some half, some full, rare 30-60s."""
        self._video_count += 1

        # Behavior #6: First video always longer
        if self._video_count == 1:
            return _timing("first_video_watch")

        # Single roll determines watch type (not multiple random() calls)
        roll = random.random()
        full_threshold = 0.30 * self.mood.patience
        if roll < full_threshold:
            watch = video_length * random.uniform(*H["watch_full_mult"])
        elif roll < full_threshold + 0.40:
            watch = _timing("watch_medium")
        else:
            watch = _timing("watch_short")

        watch = self.fatigue.adjust_watch_time(watch)

        # Behavior #7: Speed ramp (slow start)
        if self.fatigue.minutes_active < H["speed_ramp_minutes"]:
            watch *= H["speed_ramp_slow_factor"]

        return watch

    def load_reaction_time(self) -> float:
        """Behavior #10: Variable delay after app/page loads."""
        return _timing("load_reaction")

    # --- Layer 2: Engagement Decisions -------------------------------------

    def should_like(self, category: str = "unknown", creator: str = "") -> bool:
        """Decide whether to like. Uses burst tracker (Behavior #12)."""
        base_prob = 0.35 * self.mood.energy
        base_prob = self.fatigue.adjust_like_prob(base_prob)
        base_prob = self.memory.like_affinity(category, base_prob)
        raw_decision = random.random() < base_prob
        return self.burst.process(raw_decision)

    def should_comment(self) -> bool:
        """Decide whether to comment. Boosted after liking (Behavior #13)."""
        base_prob = 0.08 * self.mood.social
        # Correlated post-like engagement
        if self.burst.just_liked:
            base_prob *= H["post_like_comment_boost"]
        base_prob *= max(0.1, 1.0 - self.fatigue.fatigue_level * 0.9)
        return random.random() < base_prob

    def should_follow(self, creator: str = "") -> bool:
        """Decide whether to follow. Boosted after liking (Behavior #13)."""
        if creator in self.memory.recent_creators:
            return False
        base_prob = 0.04 * self.mood.social
        if self.burst.just_liked:
            base_prob *= H["post_like_follow_boost"]
        base_prob *= max(0.2, 1.0 - self.fatigue.fatigue_level * 0.7)
        return random.random() < base_prob

    def post_like_pause(self) -> float:
        """Behavior #3: Pause on same video after liking before scrolling."""
        return _timing("post_like_pause")

    # --- Layer 4: Rabbit Holes ---------------------------------------------

    def should_rabbit_hole(self) -> bool:
        prob = H["rabbit_hole_prob"] * self.mood.patience
        prob *= max(0.2, 1.0 - self.fatigue.fatigue_level * 0.6)
        return random.random() < prob

    def rabbit_hole_depth(self) -> int:
        return random.randint(*H["rabbit_hole_videos_range"])

    # --- Layer 5: Interruptions --------------------------------------------

    def should_interrupt(self) -> bool:
        return random.random() < H["interruption_prob"]

    def interruption_type(self) -> str:
        roll = random.random()
        if roll < H["app_switch_prob"]:
            return "app_switch"
        elif roll < H["app_switch_prob"] + 0.15:
            return "lock_screen"
        else:
            return "pause"

    def interruption_duration(self) -> float:
        return _timing("interruption_duration")

    async def do_interruption(self, adb, current_app: str = ""):
        """Execute an interruption on the device.
        current_app: package name to reopen after app_switch (e.g. TIKTOK_PKG).
        """
        itype = self.interruption_type()
        duration = self.interruption_duration()
        log.info("Interruption: %s for %.0fs", itype, duration)

        if itype == "app_switch":
            adb.press_home()
            await asyncio.sleep(duration)
            # Re-open the app (press_back from home screen does nothing)
            if current_app:
                adb.open_app(current_app)
                await asyncio.sleep(_timing("t_app_load"))
            else:
                adb.press_back()
        elif itype == "lock_screen":
            adb.shell("input keyevent KEYCODE_POWER")
            await asyncio.sleep(duration)
            adb.unlock_screen()
            # After unlock, last app returns to foreground automatically
        else:
            await asyncio.sleep(duration)

    # --- Layer 2: Phase-Aware Action Selection -----------------------------

    def pick_action(self) -> str:
        """Pick next action based on session flow phase + boredom level.
        When bored, exploration and profile visits get boosted naturally.
        """
        if self.phase:
            mix = self.phase.get_mix()
        else:
            mix = {
                "scroll_fyp": 0.60, "like": 0.20, "comment": 0.10,
                "search_explore": 0.05, "follow": 0.03, "profile_visit": 0.02,
            }

        # Apply mood modifiers
        mix["comment"] = mix.get("comment", 0) * self.mood.social
        mix["follow"] = mix.get("follow", 0) * self.mood.social
        mix["like"] = mix.get("like", 0) * self.mood.energy

        # Apply boredom: high boredom boosts exploration, reduces passive scrolling
        if self.boredom.level > 0.4:
            boredom_boost = 1 + (self.boredom.level - 0.4) * 3
            mix["search_explore"] = mix.get("search_explore", 0) * boredom_boost
            mix["profile_visit"] = mix.get("profile_visit", 0) * boredom_boost
            mix["scroll_fyp"] = mix.get("scroll_fyp", 0) / boredom_boost

        actions = list(mix.keys())
        weights = list(mix.values())
        return random.choices(actions, weights=weights, k=1)[0]

    # --- Boredom-Driven Decisions ------------------------------------------

    def on_scroll(self, niche_match: bool = None):
        """Record a passive scroll (increases boredom)."""
        self.boredom.on_scroll(niche_match)

    def on_engage(self):
        """Record an engagement action like/comment/follow (decreases boredom)."""
        self.boredom.on_engage()

    def wants_view_switch(self) -> bool:
        """Should we switch views? Boredom-driven (Instagram Feed<->Reels)."""
        return self.boredom.wants_switch()

    # --- 14 Human-Like Behaviors -------------------------------------------

    def should_zona_morta(self) -> bool:
        """Behavior #1: Dead zone -- stare at screen, no touch.
        Checked periodically (every 5-10 min)."""
        now = time.time()
        if now < self._zona_morta_next:
            return False
        # Schedule next check
        self._zona_morta_next = now + _timing("zona_morta_interval")
        return random.random() < H["zona_morta_prob"]

    def zona_morta_duration(self) -> float:
        """How long the zona morta lasts."""
        return _timing("zona_morta_duration")

    def _pick_typing_rhythm(self) -> str:
        """Choose a typing rhythm for this text based on current state.
        NOT fixed -- different texts get different rhythms."""
        energy = self.mood.energy
        fatigue = self.fatigue.fatigue_level
        patience = self.mood.patience
        boredom = self.boredom.level

        # Weighted probabilities based on state
        w_confident = 1.0 + energy * 1.5 - fatigue * 0.5
        w_composing = 1.0 - energy * 0.4 + fatigue * 0.8 + patience * 0.3
        w_rush = 0.5 + boredom * 2.0 + (1 - patience) * 1.0 - fatigue * 0.3
        w_careful = 0.3 + patience * 1.2 - boredom * 0.8 - fatigue * 0.4

        # Clamp to positive
        weights = [max(0.05, w) for w in [w_confident, w_composing, w_rush, w_careful]]
        return random.choices(
            ["confident", "composing", "rush", "careful"],
            weights=weights, k=1
        )[0]

    def type_with_errors(self, adb, text: str):
        """Behavior #2: Type with occasional errors (backspace + retype).

        Each text gets a random typing RHYTHM (confident/composing/rush/careful)
        chosen based on energy, fatigue, boredom, patience.

        Typo rate depends on fatigue, energy, text length, and position --
        but position effects are NOT a fixed curve (rhythm changes where
        slowdowns/speedups happen).

        Thinking pauses: in composing mode, 2-3 random positions get a long
        pause. In confident mode, almost never. In careful mode, at regular
        intervals.
        """
        rhythm = self._pick_typing_rhythm()
        corner_keys = set("qzpxmkw")  # phone keyboard corners/edges

        base_rate = H["typo_rate"]  # 0.10 reference
        # Fatigue: tired fingers make more mistakes
        rate = base_rate * (1 + self.fatigue.fatigue_level * 0.8)
        # Energy: high energy = typing faster = more slips
        rate *= (0.7 + self.mood.energy * 0.3)
        # Longer text = slightly more careless overall
        if len(text) > 15:
            rate *= 1.15
        elif len(text) < 6:
            rate *= 0.75  # short words = more careful

        # Rhythm affects typo rate too
        if rhythm == "rush":
            rate *= 1.25   # rushing = more mistakes
        elif rhythm == "careful":
            rate *= 0.6    # being careful = fewer mistakes
        elif rhythm == "composing":
            rate *= 1.05   # distracted thinking = slightly more

        text_len = max(len(text), 1)

        # Pre-generate thinking pause positions for composing rhythm
        # (random positions, not evenly spaced)
        thinking_positions = set()
        if rhythm == "composing":
            n_pauses = random.randint(1, max(1, text_len // 8))
            thinking_positions = set(random.sample(
                range(2, max(3, text_len - 1)), min(n_pauses, max(1, text_len - 3))
            ))
        elif rhythm == "careful" and text_len > 10:
            # Regular-ish intervals but with jitter
            interval = random.randint(5, 9)
            pos = interval
            while pos < text_len - 2:
                thinking_positions.add(pos + random.randint(-1, 1))
                pos += interval

        prev_was_space = False
        for i, char in enumerate(text):
            pos_ratio = i / text_len

            # Position-based typo modifier -- varies by rhythm
            if rhythm == "confident":
                # Confident: steady rate, slight warmup in first 2 chars
                char_rate = rate * (0.6 if i < 2 else 1.0)
            elif rhythm == "rush":
                # Rush: more typos toward end (going faster)
                char_rate = rate * (0.9 + pos_ratio * 0.4)
            elif rhythm == "composing":
                # Composing: irregular -- random bursts of fast/slow
                char_rate = rate * random.uniform(0.7, 1.4)
            elif rhythm == "careful":
                # Careful: low and steady throughout
                char_rate = rate
            else:
                char_rate = rate

            # Make the typo (if applicable)
            if char.isalpha() and random.random() < char_rate:
                adb.type_text(_nearby_char(char))
                time.sleep(self.typing_delay(rhythm, pos_ratio))
                time.sleep(_timing("t_typo_notice"))
                adb.shell("input keyevent KEYCODE_DEL")
                time.sleep(_timing("t_typo_backspace"))

            adb.type_text(char)

            # Thinking pause at pre-generated positions
            if i in thinking_positions:
                time.sleep(_timing("t_thinking"))

            # Keystroke delay with full context
            time.sleep(self.typing_delay(
                rhythm=rhythm,
                pos_ratio=pos_ratio,
                after_space=prev_was_space,
                is_corner_key=char.lower() in corner_keys,
            ))
            prev_was_space = (char == " ")

    def should_peek_scroll(self) -> bool:
        """Behavior #4: Scroll halfway and come back.
        Patient users peek more. Fatigue reduces it (too tired to bother)."""
        prob = H["peek_scroll_prob"] * self.mood.patience
        prob *= max(0.3, 1.0 - self.fatigue.fatigue_level * 0.5)
        return random.random() < prob

    def should_rewatch(self) -> bool:
        """Behavior #5: Scroll forward then back to re-watch previous video.
        Patient + not tired = more likely to go back. Bored = less likely."""
        prob = H["rewatch_prob"] * self.mood.patience
        prob *= max(0.2, 1.0 - self.fatigue.fatigue_level * 0.6)
        prob *= max(0.3, 1.0 - self.boredom.level * 0.5)
        return random.random() < prob

    def should_micro_scroll(self) -> bool:
        """Behavior #8: Incomplete swipe that doesn't change video.
        Tired = clumsier swipes. Also more likely when distracted (bored)."""
        prob = H["micro_scroll_prob"]
        prob *= (1 + self.fatigue.fatigue_level * 0.6)
        prob *= (1 + self.boredom.level * 0.3)
        return random.random() < prob

    def should_double_open_comments(self) -> bool:
        """Behavior #9: Open comments, close, re-open.
        Social mood = more curious about comments. Fatigue = fumble more."""
        prob = H["double_comment_prob"] * self.mood.social
        prob *= (1 + self.fatigue.fatigue_level * 0.4)
        return random.random() < prob

    def should_end_in_background(self) -> bool:
        """Behavior #11: End session by going to background (fell asleep).
        Much more likely when very tired. Low energy = doze off."""
        prob = H["bg_end_prob"]
        prob *= (1 + self.fatigue.fatigue_level * 2.5)
        prob *= max(0.3, 1.5 - self.mood.energy)
        return random.random() < prob

    def bg_end_duration(self) -> float:
        """How long to stay in background before closing."""
        return _timing("bg_end_duration")

    def timing(self, name: str) -> float:
        """Sample from a log-normal timing config parameter.
        Use this for inline delays instead of random.uniform()."""
        return _timing(name)
