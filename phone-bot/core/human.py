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
    comment_sociality: float = 0.40   # how much this account browses comments
    dominant_hand: int = 1  # +1 = right-handed, -1 = left-handed (persistent)
    comment_style: str = "reactor"    # categorical: reactor/questioner/quoter/hype (persistent)
    sessions_count: int = 0

    @classmethod
    def generate(cls) -> "Personality":
        """Create a new personality with random traits within configured ranges."""
        ranges = config.PERSONALITY_RANGES
        p = cls(**{
            trait: random.uniform(*bounds)
            for trait, bounds in ranges.items()
        })
        # Dominant hand: 75% right-handed, 25% left-handed. Set once, never changes.
        p.dominant_hand = random.choice([1, 1, 1, -1])
        # Comment style: assigned once, never changes (like handedness)
        p.comment_style = random.choice(config.COMMENT_STYLES)
        return p

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
            "comment_sociality": self.comment_sociality,
            "dominant_hand": self.dominant_hand,
            "comment_style": self.comment_style,
            "sessions_count": self.sessions_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Personality":
        p = cls()
        for trait in config.PERSONALITY_RANGES:
            if trait in d:
                setattr(p, trait, d[trait])
        p.dominant_hand = d.get("dominant_hand", random.choice([1, 1, 1, -1]))
        p.comment_style = d.get("comment_style", random.choice(config.COMMENT_STYLES))
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
    _initial_fatigue: float = 0.0  # carried over from previous session

    def start(self, initial_fatigue: float = 0.0):
        self.session_start = time.time()
        self._initial_fatigue = max(0.0, min(0.8, initial_fatigue))

    @property
    def minutes_active(self) -> float:
        if not self.session_start:
            return 0
        return (time.time() - self.session_start) / 60

    @property
    def fatigue_level(self) -> float:
        """0.0 = fresh, 1.0 = very fatigued.

        Combines session-accumulated fatigue with initial fatigue
        carried from previous session (decayed by half-life 1hr).
        """
        mins = self.minutes_active
        if mins < self.fatigue_start_min:
            return min(1.0, self._initial_fatigue)
        x = (mins - self.fatigue_start_min) / 15.0
        session_fatigue = x / (1 + x)
        return min(1.0, session_fatigue + self._initial_fatigue * (1 - session_fatigue))

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
        """Get engagement mix for current phase with per-action jitter.
        No normalization — weights are used as-is by random.choices().
        Scroll dominates naturally because it has the highest base weight.
        """
        phase = self.current_phase
        base = config.SESSION_PHASES[phase]["engagement"]
        mix = {}
        for action, weight in base.items():
            mix[action] = weight * random.uniform(0.7, 1.3)
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
        # Load initial fatigue from previous session (decayed by half-life 1hr)
        initial_fatigue = 0.0
        if hasattr(self, 'memory') and self.memory:
            saved_fat = getattr(self.memory, '_raw_data', {}).get("fatigue_value", 0.0)
            saved_ts = getattr(self.memory, '_raw_data', {}).get("fatigue_timestamp", 0)
            if saved_fat > 0 and saved_ts > 0:
                hours_elapsed = (time.time() - saved_ts) / 3600
                initial_fatigue = saved_fat * (0.5 ** hours_elapsed)
                log.info("Fatigue carry-over: saved=%.2f, elapsed=%.1fh, initial=%.2f",
                         saved_fat, hours_elapsed, initial_fatigue)
        self.fatigue = FatigueTracker()
        self.fatigue.start(initial_fatigue=initial_fatigue)
        self.phase = SessionPhaseTracker(duration_minutes)
        self.burst = LikeBurstTracker()
        self.boredom = BoredomTracker(self.personality)
        self._session_active = True
        self._video_count = 0
        self._zona_morta_next = time.time() + _timing("zona_morta_interval")
        self._scrolls_since_like = 999  # no cooldown at session start
        self._like_cooldown = 0         # scrolls needed before next like
        self._follow_timestamps = []    # rolling window for follow cap
        self._inbox_badge_detected = False
        self._explore_done_this_session = False
        self._shop_done_this_session = False
        # Session engagement multiplier: some sessions you're in the mood
        # to interact (1.3-1.8x), others you just scroll (0.3-0.7x).
        # Driven by energy + patience + random factor.
        _eng_base = 0.6 + self.mood.energy * 0.4 + self.mood.patience * 0.2
        self._engagement_mult = max(0.6, min(2.0,
            _eng_base * random.uniform(0.6, 1.4)))
        self._session_stats = {
            "reels_likes": 0, "feed_likes": 0,
            "stories_watched": 0, "searches_done": 0,
        }
        hand_name = "RIGHT" if self.personality.dominant_hand == 1 else "LEFT"
        log.info("Session started | mood=%s energy=%.2f social=%.2f | %.0f min | "
                 "personality: reels=%.0f%% stories=%.0f%% dbl_tap=%.0f%% hand=%s | phases=%s",
                 self.mood.description, self.mood.energy, self.mood.social,
                 duration_minutes,
                 self.personality.reels_preference * 100,
                 self.personality.story_affinity * 100,
                 self.personality.double_tap_habit * 100,
                 hand_name,
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
                # Store raw data for fatigue carry-over in start_session
                self.memory._raw_data = data
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
        """Save memory + personality + fatigue state atomically (tmp+replace)."""
        path = self._memory_path()
        try:
            data = self.memory.to_dict()
            data["personality"] = self.personality.to_dict()
            # Persist fatigue for cross-session carry-over
            if hasattr(self, 'fatigue') and self.fatigue:
                data["fatigue_value"] = self.fatigue.fatigue_level
                data["fatigue_timestamp"] = time.time()
            # Atomic write: tmp file then os.replace
            tmp_path = path + ".tmp"
            with open(tmp_path, "w") as f:
                json.dump(data, f)
            os.replace(tmp_path, path)
        except OSError as e:
            log.warning("Failed to save memory for %s: %s", self.account_name, e)

    # --- Layer 1: Tap Jitter -----------------------------------------------

    def jitter_tap(self, x: int, y: int, target_size: str = "small") -> tuple[int, int]:
        """Add human-like noise to tap coordinates.

        Never taps at exact center. Bias from handedness/grip:
        - Right-handed: taps shifted slightly LEFT of center (thumb approaches from right)
        - Left-handed: opposite
        - Bottom of screen: more Y variance (thumb reach is less precise)

        target_size: "small" (buttons/icons), "medium" (avatars), "large" (thumbnails)
        Larger targets = more offset from center (humans are lazier with big targets).
        """
        sigma_x = H["tap_sigma_x"]
        sigma_y = H["tap_sigma_y"]

        # Scale jitter by target size (larger target = more offset)
        size_mult = {"small": 1.0, "medium": 1.4, "large": 2.0}.get(target_size, 1.0)
        sigma_x *= size_mult
        sigma_y *= size_mult

        # Bottom of screen = more Y variance (thumb reach)
        if y > 1500:
            sigma_y *= 1.3

        # Handedness bias: thumb approaches from dominant side,
        # so taps land slightly OPPOSITE of dominant hand
        hand = getattr(self.personality, 'dominant_hand', 1)
        grip_bias_x = -hand * random.uniform(2, 6) * size_mult  # opposite of hand
        # Taps tend to land slightly BELOW center (thumb covers bottom of target)
        grip_bias_y = random.uniform(1, 4) * size_mult

        jx = int(random.gauss(x + grip_bias_x, sigma_x))
        jy = int(random.gauss(y + grip_bias_y, sigma_y))
        return jx, jy

    # --- Layer 1: Swipe Humanization ---------------------------------------

    def _init_swipe_habit(self):
        """Generate per-session swipe identity for BOTH hands.

        Thumb physics: you hold the phone in one hand. The thumb pivots from
        the base of your palm (bottom-right for right-handed). This means:
        - The thumb rests on the RIGHT side of the screen, not the center
        - When swiping UP, the thumb curves INWARD (right -> center)
        - The grip offset is significant: 30-50px from center on a 720px screen

        Each hand has its own characteristics (different grip, arc, speed).
        The dominant hand comes from personality (persistent per-account).
        Hand switches happen during session driven by fatigue/state.
        """
        # Use personality's persistent dominant hand
        self._handedness = self.personality.dominant_hand

        # Generate characteristics for BOTH hands
        self._hand_profiles = {}
        for hand_sign in [1, -1]:
            self._hand_profiles[hand_sign] = {
                "start_y_bias": random.gauss(0, 0.04),
                "speed_mult": random.uniform(0.85, 1.20),
                "grip_offset": hand_sign * random.uniform(25, 50),
                "arc_inward": random.uniform(12, 28),
                "noise_level": random.uniform(0.7, 1.3),
            }

        # Non-dominant hand is slightly slower and sloppier
        non_dom = -self._handedness
        self._hand_profiles[non_dom]["speed_mult"] *= random.uniform(1.05, 1.15)
        self._hand_profiles[non_dom]["noise_level"] *= random.uniform(1.1, 1.3)

        # Start with dominant hand
        self._current_hand = self._handedness
        self._swipe_habit = self._hand_profiles[self._current_hand]

        # Grip X: where the thumb sits right now (varies slowly with grip shifts)
        self._grip_x_offset = int(
            self._swipe_habit["grip_offset"] + random.gauss(0, 5)
        )
        self._swipes_until_grip_shift = random.randint(12, 30)
        self._swipe_count = 0
        # Previous swipe duration and position for smooth transitions
        self._prev_duration = None
        self._prev_start_y_offset = None

        # Hand fatigue: accumulates while using current hand, drives switches
        self._hand_fatigue = 0.0      # 0.0 = fresh, builds toward switch
        self._swipes_this_hand = 0    # counter since last switch
        self._hand_switches = 0       # total switches this session
        self._hand_just_switched = False  # flag for caller to detect switch
        self._last_switch_time = time.time()
        # Event switch: random life event (drink, scratch, message) — max 1 per session
        # Decided at session start: WHICH swipe triggers it (or never)
        self._event_switch_done = False
        self._event_trigger_swipe = self._pick_event_trigger_swipe()

    def _pick_event_trigger_swipe(self) -> int:
        """Decide at session start IF and WHEN a life event hand switch happens.

        Uses state-driven probability: bored/tired/low-energy sessions are more
        likely to have an event. Returns the swipe number that triggers it,
        or -1 if no event this session.

        Target: ~20-30% of 10-min sessions (50 swipes) depending on state.
        """
        # State influences whether an event happens at all
        session_fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0
        boredom = self.boredom.level if self.boredom else 0.0
        energy = self.mood.energy if self.mood else 1.0

        # Base: ~25% chance. State shifts it 10-40%
        event_drive = (
            0.25
            * (1 + boredom * 0.5)              # bored = restless, more events
            * (1 + session_fatigue * 0.3)       # tired = shift position
            * (1.3 - min(energy, 1.2) * 0.3)   # low energy = uncomfortable
        )
        # Add noise so it is not the same every session
        event_drive += random.gauss(0, 0.06)

        if random.random() > event_drive:
            return -1  # no event this session

        # WHEN: exponential distribution — can be early or late, unpredictable
        # Median around swipe 30, but can be 12 or 48
        trigger = 10 + int(random.expovariate(1.0 / 20))
        return trigger

    def _check_hand_switch(self):
        """Decide whether to switch hands based on two independent mechanisms:

        1. LIFE EVENT (any session): random imprevisto — drink, scratch, message,
           cigarette, shift position. Decided at session start. Max 1 per session.

        2. HAND FATIGUE (long sessions): accumulates over many swipes, triggers
           in sessions 80+ swipes. Driven by session fatigue, boredom, energy.
        """
        if self._swipes_this_hand < 8:
            return  # minimum swipes before considering a switch

        # =================================================================
        # Mechanism 1: LIFE EVENT
        # Pre-decided at session start. Triggers at specific swipe count.
        # =================================================================
        if (not self._event_switch_done
                and self._event_trigger_swipe > 0
                and self._swipe_count >= self._event_trigger_swipe):
            self._event_switch_done = True
            log.info("[Hand switch] life event at swipe %d (drink, scratch, repositioned)",
                     self._swipe_count)
            self._do_hand_switch()
            return

        # =================================================================
        # Mechanism 2: HAND FATIGUE (long sessions only)
        # Slow accumulation, triggers around 80-100 swipes.
        # =================================================================
        session_fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0
        boredom = self.boredom.level if self.boredom else 0.0
        energy = self.mood.energy if self.mood else 1.0

        fatigue_rate = (
            0.008                              # base accumulation per swipe
            * (1 + session_fatigue * 1.2)      # tired = hand tires faster
            * (1 + boredom * 0.6)              # bored = fidgety
            * (1.5 - min(energy, 1.4) * 0.5)   # low energy = grip weakens
        )
        self._hand_fatigue += fatigue_rate

        # Dominant hand = higher threshold (more natural to hold longer)
        is_dominant = (self._current_hand == self._handedness)
        base_threshold = 0.7 if is_dominant else 0.5

        # Each previous switch raises threshold (no ping-pong)
        switch_penalty = self._hand_switches * 0.15
        threshold = base_threshold + switch_penalty

        # Noise so it is not deterministic
        threshold += random.gauss(0, 0.08)

        if self._hand_fatigue > threshold:
            self._do_hand_switch()

    def _do_hand_switch(self):
        """Switch to the other hand. Resets hand fatigue, updates swipe profile."""
        old_hand = self._current_hand
        self._current_hand = -self._current_hand
        self._hand_just_switched = True
        self._swipe_habit = self._hand_profiles[self._current_hand]
        self._grip_x_offset = int(
            self._swipe_habit["grip_offset"] + random.gauss(0, 5)
        )
        self._hand_fatigue = 0.0
        self._swipes_this_hand = 0
        self._hand_switches += 1
        self._prev_duration = None  # reset smooth transition (new hand = new baseline)
        self._last_switch_time = time.time()

        hand_name = "RIGHT" if self._current_hand == 1 else "LEFT"
        old_name = "RIGHT" if old_hand == 1 else "LEFT"
        log.info("[Hand switch] %s -> %s (switch #%d)",
                 old_name, hand_name, self._hand_switches)

    def get_hand_switch_pause(self) -> float:
        """Return pause duration for physically moving phone to other hand.

        Three tiers driven by state:
        - Quick (0.8-3s): just shift grip — most common
        - Medium (5-15s): drink, scratch, look around — more when bored/tired
        - Long (15-40s): reply to message, bathroom — rare, more when fatigued
        """
        session_fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0
        boredom = self.boredom.level if self.boredom else 0.0
        energy = self.mood.energy if self.mood else 1.0

        # Weights: state shifts the distribution toward longer pauses
        w_quick = 1.0 + energy * 0.5 - boredom * 0.3 - session_fatigue * 0.2
        w_medium = 0.15 + boredom * 0.3 + session_fatigue * 0.2
        w_long = 0.03 + session_fatigue * 0.08 + boredom * 0.04 - energy * 0.02

        w_quick = max(w_quick, 0.1)
        w_medium = max(w_medium, 0.01)
        w_long = max(w_long, 0.005)

        total = w_quick + w_medium + w_long
        roll = random.random() * total

        if roll < w_quick:
            return random.uniform(0.8, 3.0)
        elif roll < w_quick + w_medium:
            return random.uniform(5.0, 15.0)
        else:
            return random.uniform(15.0, 40.0)

    def _update_grip(self):
        """Shift grip position every N swipes (adjusting hand on phone).
        Also checks if it is time to switch hands based on accumulated state."""
        self._swipe_count += 1
        self._swipes_this_hand += 1
        self._swipes_until_grip_shift -= 1
        if self._swipes_until_grip_shift <= 0:
            old = self._grip_x_offset
            # Small shift: stays near the natural grip offset
            self._grip_x_offset = int(
                old * 0.5 + self._swipe_habit["grip_offset"] * 0.5
                + random.gauss(0, 6)
            )
            self._swipes_until_grip_shift = random.randint(12, 30)

        # Check if hand fatigue accumulated enough to trigger a switch
        self._check_hand_switch()

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
        # Capture grip and hand BEFORE _update_grip (which may trigger a switch).
        # This swipe belongs to the current hand; the switch takes effect next swipe.
        grip_x_now = self._grip_x_offset
        hand_now = self._current_hand
        self._update_grip()
        thumb_contact = int(random.gauss(0, 11 * noise))
        start_x = grip_x_now + thumb_contact

        # Arc: thumb curves INWARD during upswipe (toward center),
        # but the AMOUNT varies a lot — sometimes almost straight,
        # sometimes a noticeable curve. Gaussian around the baseline
        # with wide sigma so some swipes are nearly straight (3px)
        # and some curve a lot (25px+)
        swiping_up = dy < 0
        arc_amount = max(0, random.gauss(habit["arc_inward"], habit["arc_inward"] * 0.4))
        if swiping_up:
            arc_direction = -hand_now  # toward center (depends on which hand holds phone)
        else:
            arc_direction = hand_now   # back toward hand
        end_x = grip_x_now + int(arc_direction * arc_amount)

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

        # Check if a hand switch happened during this swipe's _update_grip
        switched = getattr(self, '_hand_just_switched', False)
        switch_pause = 0.0
        if switched:
            self._hand_just_switched = False
            switch_pause = self.get_hand_switch_pause()

        swipe_pressure = self.get_swipe_pressure()
        return {
            "x1": x1 + start_x,
            "y1": y1 + start_y_offset,
            "x2": x2 + end_x,
            "y2": y2 + end_y_offset,
            "duration": duration,
            "hand_switched": switched,
            "hand_switch_pause": switch_pause,
            "pressure_peak": swipe_pressure["peak"],
            "area": swipe_pressure["area"],
        }

    # --- Touch Pressure Physics (UHID) ------------------------------------

    def get_tap_pressure(self) -> dict:
        """Generate pressure/area parameters for a single tap.

        Returns dict with:
            peak: float 0.0-1.0 -- peak pressure during tap
            ramp_up_ms: int -- time to reach peak pressure
            ramp_down_ms: int -- time to release
            hold_drift_px: int -- micro-drift during hold (pixels)
            area: int -- touch contact area (0-255 scale)
            hold_ms: int -- hold duration
        """
        cfg = H.get("touch_pressure_peak", (0.55, 0.12, 0.25, 0.85))
        peak = random.gauss(cfg[0], cfg[1])

        # Fatigue: slightly heavier taps (less motor control)
        peak *= (1 + self.fatigue.fatigue_level * 0.15)
        # Energy: low energy = lighter taps
        peak *= max(0.5, self.mood.energy)
        peak = max(cfg[2], min(cfg[3], peak))

        ramp_cfg = H.get("touch_ramp_up_ms", (30, 8, 15, 50))
        ramp_up = random.gauss(ramp_cfg[0], ramp_cfg[1])
        ramp_up *= (1 + self.fatigue.fatigue_level * 0.2)
        ramp_up_ms = int(max(ramp_cfg[2], min(ramp_cfg[3], ramp_up)))

        down_cfg = H.get("touch_ramp_down_ms", (20, 6, 10, 40))
        ramp_down_ms = int(max(down_cfg[2], min(down_cfg[3], random.gauss(down_cfg[0], down_cfg[1]))))

        drift_cfg = H.get("touch_hold_drift_px", (2, 1, 0, 5))
        hold_drift = random.gauss(drift_cfg[0], drift_cfg[1])
        hold_drift *= (1 + self.fatigue.fatigue_level * 0.3)
        hold_drift_px = int(max(drift_cfg[2], min(drift_cfg[3], hold_drift)))

        area_base = H.get("touch_area_base", 30)
        area_scale = H.get("touch_area_pressure_scale", 40)
        area = int(area_base + peak * area_scale)

        hold_ms = ramp_up_ms + ramp_down_ms + random.randint(30, 60)

        return {
            "peak": peak,
            "ramp_up_ms": ramp_up_ms,
            "ramp_down_ms": ramp_down_ms,
            "hold_drift_px": hold_drift_px,
            "area": area,
            "hold_ms": hold_ms,
        }

    def get_swipe_pressure(self) -> dict:
        """Generate pressure parameters for a swipe.

        Returns dict with:
            peak: float 0.0-1.0 -- peak pressure during middle of swipe
            area: int -- touch contact area at peak pressure
        """
        cfg = H.get("touch_pressure_peak", (0.55, 0.12, 0.25, 0.85))
        peak = random.gauss(cfg[0], cfg[1])
        peak *= (1 + self.fatigue.fatigue_level * 0.15)
        peak *= max(0.5, self.mood.energy)
        peak = max(cfg[2], min(cfg[3], peak))

        area_base = H.get("touch_area_base", 30)
        area_scale = H.get("touch_area_pressure_scale", 40)
        area = int(area_base + peak * area_scale)

        return {"peak": peak, "area": area}

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

        log.debug("WATCH: %.1fs (video #%d, fatigue=%.2f)", watch, self._video_count,
                  self.fatigue.fatigue_level if self.fatigue else 0)
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
        roll = random.random()
        raw_decision = roll < base_prob
        result = self.burst.process(raw_decision)
        log.debug("DECIDE like: roll=%.2f prob=%.2f raw=%s burst=%s", roll, base_prob, raw_decision, result)
        return result

    def should_comment(self) -> bool:
        """Decide whether to comment. Boosted after liking (Behavior #13)."""
        base_prob = 0.08 * self.mood.social
        # Correlated post-like engagement
        if self.burst.just_liked:
            base_prob *= H["post_like_comment_boost"]
        base_prob *= max(0.1, 1.0 - self.fatigue.fatigue_level * 0.9)
        roll = random.random()
        result = roll < base_prob
        log.debug("DECIDE comment: roll=%.2f prob=%.2f post_like=%s -> %s", roll, base_prob, self.burst.just_liked, result)
        return result

    def should_follow(self, creator: str = "") -> bool:
        """Decide whether to follow. Boosted after liking (Behavior #13)."""
        if creator in self.memory.recent_creators:
            log.debug("DECIDE follow: SKIP (recent creator)")
            return False
        base_prob = 0.04 * self.mood.social
        if self.burst.just_liked:
            base_prob *= H["post_like_follow_boost"]
        base_prob *= max(0.2, 1.0 - self.fatigue.fatigue_level * 0.7)
        roll = random.random()
        result = roll < base_prob
        log.debug("DECIDE follow: roll=%.2f prob=%.2f post_like=%s -> %s", roll, base_prob, self.burst.just_liked, result)
        return result

    def post_like_pause(self) -> float:
        """Behavior #3: Pause on same video after liking before scrolling."""
        return _timing("post_like_pause")

    # --- Comment Browsing --------------------------------------------------

    def browse_comments_plan(self) -> dict:
        """Decide how to browse comments: number of scrolls, whether deep dive.

        Returns dict with:
            scroll_count: int (1-12)
            is_deep_dive: bool
            read_timing_key: str (which timing param for read pauses)
        """
        fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0
        boredom = self.boredom.level if self.boredom else 0.0
        curiosity = self.personality.explore_curiosity if self.personality else 0.1
        social = self.mood.social if self.mood else 1.0
        sociality = self.personality.comment_sociality if self.personality else 0.4

        # Deep dive probability: high curiosity + high social + low boredom = drama reader
        deep_drive = (
            0.02
            * (1 + curiosity * 3)
            * (1 + social * 0.5)
            * (1 + sociality * 1.5)
            * (1.2 - boredom * 0.6)
            * (1.1 - fatigue * 0.4)
        )
        deep_drive = max(0.01, min(0.12, deep_drive))
        is_deep = random.random() < deep_drive

        if is_deep:
            # Deep dive: 6-12 scrolls, reading everything
            scroll_count = random.randint(6, 12)
            return {
                "scroll_count": scroll_count,
                "is_deep_dive": True,
                "read_timing_key": "t_comment_read_deep",
            }

        # Normal browse: 1-5 scrolls, weighted by state
        # More sociality/curiosity = more scrolls, more fatigue/boredom = fewer
        avg_scrolls = (
            1.8
            + sociality * 2.0
            + curiosity * 3.0
            - fatigue * 1.0
            - boredom * 0.8
        )
        avg_scrolls = max(1.0, min(4.5, avg_scrolls))

        # Use a simple weighted random around the average
        scroll_count = max(1, min(5, int(random.gauss(avg_scrolls, 0.8))))

        return {
            "scroll_count": scroll_count,
            "is_deep_dive": False,
            "read_timing_key": "t_comment_read",
        }

    def comment_scroll_distance(self) -> float:
        """How far to scroll in comments section (fraction of screen height).

        Returns a value 0.20-0.65. State-driven: curious = scrolls more,
        fatigued = lazy short scrolls.
        """
        fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0
        curiosity = self.personality.explore_curiosity if self.personality else 0.1
        boredom = self.boredom.level if self.boredom else 0.0

        # Base weights for short/medium/long scroll
        w_short = 1.0 + fatigue * 1.5 + boredom * 0.5     # tired/bored = short lazy scrolls
        w_medium = 1.0                                      # baseline
        w_long = 0.15 + curiosity * 2.0 - fatigue * 0.3    # curious = longer scrolls

        w_short = max(w_short, 0.1)
        w_medium = max(w_medium, 0.1)
        w_long = max(w_long, 0.02)

        total = w_short + w_medium + w_long
        roll = random.random() * total

        if roll < w_short:
            return random.uniform(0.20, 0.35)
        elif roll < w_short + w_medium:
            return random.uniform(0.35, 0.50)
        else:
            return random.uniform(0.50, 0.65)

    def should_browse_comments(self) -> bool:
        """Decide whether to open and browse comments WITHOUT writing one.
        Separate from should_comment() -- this is just reading comments.
        Driven by comment_sociality personality trait + state.
        """
        sociality = self.personality.comment_sociality if self.personality else 0.4
        social = self.mood.social if self.mood else 1.0
        fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0
        boredom = self.boredom.level if self.boredom else 0.0

        prob = (
            sociality * 0.3
            * (0.5 + social * 0.5)
            * (1.1 - fatigue * 0.5)
            * (1.0 + boredom * 0.2)  # slightly bored = might check comments for entertainment
        )
        prob = max(0.02, min(0.35, prob))
        roll = random.random()
        result = roll < prob
        log.debug("DECIDE browse_comments: roll=%.2f prob=%.2f -> %s", roll, prob, result)
        return result

    # --- Layer 4: Rabbit Holes ---------------------------------------------

    def should_rabbit_hole(self) -> bool:
        prob = H["rabbit_hole_prob"] * self.mood.patience
        prob *= max(0.2, 1.0 - self.fatigue.fatigue_level * 0.6)
        roll = random.random()
        result = roll < prob
        log.debug("DECIDE rabbit_hole: roll=%.2f prob=%.2f -> %s", roll, prob, result)
        return result

    def rabbit_hole_depth(self) -> int:
        return random.randint(*H["rabbit_hole_videos_range"])

    # --- Layer 5: Interruptions --------------------------------------------

    def should_interrupt(self) -> bool:
        roll = random.random()
        result = roll < H["interruption_prob"]
        if result:
            log.debug("DECIDE interrupt: roll=%.2f prob=%.2f -> YES", roll, H["interruption_prob"])
        return result

    def interruption_type(self) -> str:
        """Pick interruption type and duration based on state.

        Three tiers:
        - short (3-8s): glance at notification, check time. Most common.
        - medium (15-45s): reply to message, open another app briefly.
        - long (60-180s): genuinely distracted, conversation, etc. Rare.

        Tired/bored = more medium/long. Energetic/focused = mostly short.
        """
        fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0
        boredom = self.boredom.level if self.boredom else 0.0
        energy = self.mood.energy if self.mood else 1.0

        # Probability of each tier (state-driven + per-session jitter)
        # Per-session jitter: each session has a slightly different "distractibility"
        jitter = random.gauss(0, 0.12)

        long_chance = 0.25 + fatigue * 0.15 + boredom * 0.10 - energy * 0.05 + jitter * 0.3
        long_chance = max(0.10, min(0.45, long_chance))

        medium_chance = 0.33 + fatigue * 0.10 + boredom * 0.08 - energy * 0.04 + jitter * 0.5
        medium_chance = max(0.20, min(0.50, medium_chance))

        short_chance = 1.0 - medium_chance - long_chance

        roll = random.random()
        if roll < short_chance:
            itype = "short"
        elif roll < short_chance + medium_chance:
            itype = "medium"
        else:
            itype = "long"

        log.info("INTERRUPTION: %s (short=%.0f%% medium=%.0f%% long=%.0f%%)",
                 itype, short_chance * 100, medium_chance * 100, long_chance * 100)
        return itype

    def interruption_duration(self, itype: str = "short") -> float:
        """Duration based on interruption type."""
        if itype == "short":
            return random.uniform(3, 8)
        elif itype == "medium":
            # Real exit: check WhatsApp, reply to message, scroll IG for a sec
            return random.uniform(50, 150)
        else:  # long
            # Genuinely distracted: conversation, phone call, has to do something
            return random.uniform(150, 300)

    async def do_interruption(self, adb, current_app: str = "", itype: str = None):
        """Execute an interruption on the device.
        current_app: package name to reopen after app_switch (e.g. TIKTOK_PKG).
        itype: if provided, use this type instead of picking one.
        """
        if itype is None:
            itype = self.interruption_type()
        duration = self.interruption_duration(itype)
        log.info("Interruption: %s for %.0fs", itype, duration)

        if itype == "short":
            # Short = always stay in app (pause, thinking, rereading)
            await asyncio.sleep(duration)
        elif itype == "medium":
            # App switch — go home, check something, come back
            adb.press_home()
            await asyncio.sleep(duration)
            if current_app:
                adb.open_app(current_app)
                await asyncio.sleep(_timing("t_app_load"))
                adb.save_screenshot_if_recording("after_interruption_return")
            else:
                adb.press_back()
        else:
            # Long — genuinely distracted
            adb.press_home()
            await asyncio.sleep(duration)
            if current_app:
                adb.open_app(current_app)
                await asyncio.sleep(_timing("t_app_load"))
                adb.save_screenshot_if_recording("after_interruption_return")
            else:
                adb.press_back()

    # --- Layer 2: Phase-Aware Action Selection -----------------------------

    def _generate_like_cooldown(self) -> int:
        """Generate scrolls-before-next-like cooldown (state-driven, not fixed).
        More energy = shorter cooldown (active user). More fatigue = longer.
        ~10% chance of very short cooldown (found 2 great videos in a row).
        """
        fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0
        energy = self.mood.energy

        # Rare short cooldown: "found 2 bangers in a row" (~8-12%)
        short_chance = 0.04 + energy * 0.05 - fatigue * 0.03
        short_chance = max(0.04, min(0.12, short_chance))
        if random.random() < short_chance:
            return random.randint(2, 3)

        # Normal cooldown: median ~6, adjusted by state
        median = 6.0 - energy * 1.5 + fatigue * 2.0
        median = max(4.0, min(9.0, median))
        cd = _lognormal(median, 0.3, 3, 12)
        return int(cd)

    def on_like(self):
        """Record a like action — sets cooldown before next like is allowed."""
        self._scrolls_since_like = 0
        self._like_cooldown = self._generate_like_cooldown()

    def on_scroll_for_like(self):
        """Record a scroll — counts toward like cooldown."""
        self._scrolls_since_like += 1

    # --- Follow Cap + Follow Path -----------------------------------------

    def _follow_allowed(self) -> bool:
        """Check rolling 30-min window: max FOLLOW_CAP_PER_30MIN follows."""
        now = time.time()
        window_start = now - 30 * 60
        recent = [t for t in self._follow_timestamps if t > window_start]
        self._follow_timestamps = recent  # prune old entries
        return len(recent) < config.FOLLOW_CAP_PER_30MIN

    def on_follow(self):
        """Record a follow action with timestamp for cap tracking."""
        self._follow_timestamps.append(time.time())

    def should_follow_from_profile(self) -> bool:
        """State-driven: enter profile first (higher niche certainty) vs follow from video.
        More curious/patient = more likely to enter profile first.
        Returns True = enter profile, False = follow from video directly.
        """
        curiosity = self.personality.explore_curiosity
        patience = self.mood.patience
        fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0

        profile_drive = 0.60 + curiosity * 0.15 + patience * 0.10 - fatigue * 0.08
        profile_drive = max(0.55, min(0.90, profile_drive))
        roll = random.random()
        result = roll < profile_drive
        log.debug("DECIDE follow_from_profile: roll=%.2f drive=%.2f -> %s", roll, profile_drive, result)
        return result

    def should_visit_commenter_profile(self) -> bool:
        """State-driven: while reading comments, chance to tap on a commenter's avatar.
        More social + curious + bored = more likely. More fatigued = less likely.
        """
        social = self.mood.social
        curiosity = self.personality.explore_curiosity
        boredom = self.boredom.level
        fatigue = self.fatigue.fatigue_level if self.fatigue else 0.0

        drive = social * 0.04 + curiosity * 0.03 + boredom * 0.02 - fatigue * 0.02
        drive = max(0.02, min(0.12, drive))
        return random.random() < drive

    def pick_action(self) -> str:
        """Pick next action based on session flow phase + boredom level.
        When bored, exploration and profile visits get boosted naturally.
        Like cooldown prevents liking too many videos in quick succession.
        """
        if self.phase:
            mix = self.phase.get_mix()
        else:
            mix = {
                "scroll_fyp": 0.60, "like": 0.20, "comment": 0.10,
                "search_explore": 0.05, "follow": 0.03, "profile_visit": 0.02,
            }

        # Apply session engagement multiplier (scales all non-scroll actions)
        for act in ("like", "comment", "follow", "search_explore", "profile_visit",
                     "check_inbox", "browse_following", "browse_explore", "browse_shop"):
            mix[act] = mix.get(act, 0) * self._engagement_mult

        # Apply mood modifiers on top
        mix["comment"] = mix.get("comment", 0) * self.mood.social
        mix["follow"] = mix.get("follow", 0) * self.mood.social
        mix["like"] = mix.get("like", 0) * self.mood.energy

        # Like cooldown: suppress like weight if not enough scrolls since last like
        # Redistribute suppressed weight to non-scroll actions (not just scroll)
        if self._scrolls_since_like < self._like_cooldown:
            suppressed = mix["like"]
            mix["like"] = 0.0
            # Spread to comment, search, follow, profile (proportionally)
            non_scroll = ["comment", "search_explore", "follow", "profile_visit"]
            non_scroll_total = sum(mix.get(a, 0) for a in non_scroll)
            if non_scroll_total > 0:
                for a in non_scroll:
                    mix[a] = mix.get(a, 0) + suppressed * (mix.get(a, 0) / non_scroll_total)
            else:
                mix["scroll_fyp"] = mix.get("scroll_fyp", 0) + suppressed

        # Follow cap: suppress follow if at max for rolling 30min window
        if not self._follow_allowed():
            mix["follow"] = 0.0

        # Apply boredom: high boredom boosts exploration, reduces passive scrolling
        if self.boredom.level > 0.4:
            boredom_boost = 1 + (self.boredom.level - 0.4) * 3
            mix["search_explore"] = mix.get("search_explore", 0) * min(boredom_boost, 1.5)
            mix["profile_visit"] = mix.get("profile_visit", 0) * min(boredom_boost, 1.5)
            mix["scroll_fyp"] = mix.get("scroll_fyp", 0) / boredom_boost

        # --- New section modifiers ---

        # check_inbox: strong boost when badge visible
        if mix.get("check_inbox", 0) > 0:
            if hasattr(self, '_inbox_badge_detected') and self._inbox_badge_detected:
                mix["check_inbox"] *= 4.0

        # browse_following: boost from boredom + story_affinity
        if mix.get("browse_following", 0) > 0:
            boredom_level = self.boredom.level if self.boredom else 0
            story_aff = self.personality.story_affinity if self.personality else 0.5
            mix["browse_following"] *= (1.0 + boredom_level * 1.5 + story_aff * 0.5)

        # browse_explore: suppress if search_explore was done recently
        if mix.get("browse_explore", 0) > 0:
            if hasattr(self, '_explore_done_this_session') and self._explore_done_this_session:
                mix["browse_explore"] = 0.0
        if mix.get("search_explore", 0) > 0:
            if hasattr(self, '_explore_done_this_session') and self._explore_done_this_session:
                mix["search_explore"] *= 0.1  # heavily suppress after explore

        # browse_shop: max once per session, slight curiosity boost
        if mix.get("browse_shop", 0) > 0:
            if hasattr(self, '_shop_done_this_session') and self._shop_done_this_session:
                mix["browse_shop"] = 0.0
            else:
                energy = self.mood.energy if self.mood else 1.0
                mix["browse_shop"] *= (0.5 + energy * 0.5)

        # --- New engagement actions (Split 04) ---
        # State variables for action weight calculations
        explore_cur = self.personality.explore_curiosity if self.personality else 0.1
        fatigue_lvl = self.fatigue.fatigue_level if self.fatigue else 0.0
        energy = self.mood.energy if self.mood else 1.0
        boredom_lvl = self.boredom.level if self.boredom else 0.0

        # Bookmark: curiosity + energy driven. Curious, energetic users save more.
        # Fatigued users don't bother saving anything.
        mix["bookmark"] = (
            0.005                                   # tiny base
            + explore_cur * 0.08                    # curious = saves more (up to +1.6%)
            + energy * 0.01                         # energetic = more engaged
            - fatigue_lvl * 0.015                   # fatigued = stops saving
        ) * self._engagement_mult
        mix["bookmark"] = max(0.0, mix["bookmark"])

        # Not interested: driven by boredom + impatience. Bored/impatient users
        # mark more videos. Patient/curious users almost never do it.
        patience = self.mood.patience if self.mood else 0.5
        mix["not_interested"] = (
            0.01                                    # tiny base (almost never when happy)
            + boredom_lvl * 0.04                    # bored = more likely (up to +4%)
            + (1 - patience) * 0.015                # impatient = more likely
            - explore_cur * 0.03                    # curious people tolerate diverse content
        ) * self._engagement_mult
        mix["not_interested"] = max(0.0, min(0.06, mix["not_interested"]))  # hard cap 6%

        # Own profile visit: ~1% during peak/fatigue only
        phase_name = self.phase.current_phase if self.phase else "warmup"
        if phase_name in ("peak", "fatigue"):
            mix["own_profile"] = 0.01 * self._engagement_mult
        else:
            mix["own_profile"] = 0.0

        actions = list(mix.keys())
        weights = list(mix.values())
        chosen = random.choices(actions, weights=weights, k=1)[0]
        # Log the decision with weights so we can trace every action choice
        weight_str = " ".join(f"{a}={w:.2f}" for a, w in zip(actions, weights))
        log.info("ACTION: %s [weights: %s] phase=%s boredom=%.2f",
                 chosen, weight_str,
                 self.phase.current_phase if self.phase else "?",
                 self.boredom.level if self.boredom else 0)
        return chosen

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
        roll = random.random()
        result = roll < H["zona_morta_prob"]
        if result:
            log.info("ZONA_MORTA: triggered (roll=%.2f prob=%.2f)", roll, H["zona_morta_prob"])
        return result

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
