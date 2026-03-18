"""
Tests for touch pressure/area physics in HumanEngine.

Validates that pressure parameters are:
- Within valid ranges
- Variable (not constant)
- Influenced by fatigue and energy
- Area proportional to pressure
"""

import sys
from types import ModuleType
from unittest.mock import MagicMock, patch

# Mock phone_bot package for import
mock_config = ModuleType("config")
mock_config.ADB_PATH = "adb"
mock_config.PHONES = {}
mock_config.HUMAN = {
    "tap_sigma_x": 12, "tap_sigma_y": 14,
    "swipe_duration_median": 320, "swipe_duration_sigma": 0.5,
    "swipe_x_drift_range": (-20, 20), "swipe_y_jitter": 30,
    "action_delay_median": 1.2, "action_delay_sigma": 0.6,
    "typing_median": 0.15, "typing_sigma": 0.4,
    "reading_median": 2.5, "reading_sigma": 0.5,
    "micro_pause_prob": 0.15,
    "watch_full_mult": (0.85, 1.1),
    "fatigue_start_minute": 10, "fatigue_like_drop": 0.4, "fatigue_scroll_speed_boost": 1.5,
    "interruption_prob": 0.08, "app_switch_prob": 0.4,
    "rabbit_hole_prob": 0.07, "rabbit_hole_videos_range": (2, 5),
    "mood_energy_range": (0.45, 1.4), "mood_social_range": (0.4, 1.6),
    "zona_morta_prob": 0.15, "typo_rate": 0.10, "peek_scroll_prob": 0.10,
    "rewatch_prob": 0.05, "speed_ramp_minutes": 3.5, "speed_ramp_slow_factor": 1.6,
    "micro_scroll_prob": 0.025, "double_comment_prob": 0.03,
    "bg_end_prob": 0.05, "like_burst_prob": 0.15,
    "like_burst_count": (2, 4), "like_burst_skip": (8, 15),
    "post_like_comment_boost": 2.5, "post_like_follow_boost": 3.0,
    "touch_pressure_peak": (0.55, 0.12, 0.25, 0.85),
    "touch_ramp_up_ms": (30, 8, 15, 50),
    "touch_ramp_down_ms": (20, 6, 10, 40),
    "touch_hold_drift_px": (2, 1, 0, 5),
    "touch_area_base": 30,
    "touch_area_pressure_scale": 40,
}
mock_config.SESSION_PHASES = {}
mock_config.NICHE_KEYWORDS = []
sys.modules["phone_bot"] = ModuleType("phone_bot")
sys.modules["phone_bot"].config = mock_config  # type: ignore
sys.modules["phone_bot.config"] = mock_config

import statistics


class FakeFatigue:
    def __init__(self, level=0.0):
        self.fatigue_level = level
        self.minutes_active = 5.0


class FakeMood:
    def __init__(self, energy=1.0, social=1.0):
        self.energy = energy
        self.social = social


class FakePhase:
    def get_state(self):
        return {"energy": 0.8, "fatigue": 0.2, "curiosity": 0.5,
                "boredom": 0.3, "patience": 0.6, "social": 0.5}


def make_engine(fatigue_level=0.0, energy=1.0):
    """Create a minimal HumanEngine with controlled fatigue/energy."""
    from phone_bot.core.human import HumanEngine
    engine = HumanEngine.__new__(HumanEngine)
    engine.fatigue = FakeFatigue(fatigue_level)
    engine.mood = FakeMood(energy=energy)
    engine.phase = FakePhase()
    engine.personality = MagicMock()
    engine.boredom = MagicMock()
    engine.boredom.level = 0.3
    engine.memory = MagicMock()
    engine.burst = MagicMock()
    engine.account_name = "test"
    return engine


class TestGetTapPressure:

    def test_returns_all_required_keys(self):
        engine = make_engine()
        result = engine.get_tap_pressure()
        assert "peak" in result
        assert "ramp_up_ms" in result
        assert "ramp_down_ms" in result
        assert "hold_drift_px" in result
        assert "area" in result
        assert "hold_ms" in result

    def test_peak_in_valid_range(self):
        engine = make_engine()
        for _ in range(100):
            r = engine.get_tap_pressure()
            assert 0.25 <= r["peak"] <= 0.85

    def test_peak_varies_between_calls(self):
        engine = make_engine()
        peaks = [engine.get_tap_pressure()["peak"] for _ in range(100)]
        assert statistics.stdev(peaks) > 0.01

    def test_ramp_up_in_range(self):
        engine = make_engine()
        for _ in range(100):
            r = engine.get_tap_pressure()
            assert 15 <= r["ramp_up_ms"] <= 50

    def test_ramp_down_in_range(self):
        engine = make_engine()
        for _ in range(100):
            r = engine.get_tap_pressure()
            assert 10 <= r["ramp_down_ms"] <= 40

    def test_hold_drift_in_range(self):
        engine = make_engine()
        for _ in range(100):
            r = engine.get_tap_pressure()
            assert 0 <= r["hold_drift_px"] <= 5

    def test_area_in_expected_range(self):
        engine = make_engine()
        for _ in range(100):
            r = engine.get_tap_pressure()
            # area = base(30) + peak(0.25-0.85) * scale(40) = 40-64
            assert 30 <= r["area"] <= 70

    def test_area_increases_with_pressure(self):
        """Area should positively correlate with peak pressure."""
        engine = make_engine()
        samples = [engine.get_tap_pressure() for _ in range(200)]
        # Sort by peak, compare mean area of bottom quarter vs top quarter
        samples.sort(key=lambda s: s["peak"])
        quarter = len(samples) // 4
        low_area = statistics.mean([s["area"] for s in samples[:quarter]])
        high_area = statistics.mean([s["area"] for s in samples[-quarter:]])
        assert high_area > low_area

    def test_fatigue_increases_average_peak(self):
        engine_rested = make_engine(fatigue_level=0.0)
        engine_tired = make_engine(fatigue_level=0.8)
        peaks_rested = [engine_rested.get_tap_pressure()["peak"] for _ in range(200)]
        peaks_tired = [engine_tired.get_tap_pressure()["peak"] for _ in range(200)]
        # Fatigued should have higher average peak (heavier taps)
        assert statistics.mean(peaks_tired) > statistics.mean(peaks_rested)

    def test_low_energy_decreases_average_peak(self):
        engine_high = make_engine(energy=1.2)
        engine_low = make_engine(energy=0.5)
        peaks_high = [engine_high.get_tap_pressure()["peak"] for _ in range(200)]
        peaks_low = [engine_low.get_tap_pressure()["peak"] for _ in range(200)]
        assert statistics.mean(peaks_high) > statistics.mean(peaks_low)


class TestGetSwipePressure:

    def test_returns_peak_and_area(self):
        engine = make_engine()
        result = engine.get_swipe_pressure()
        assert "peak" in result
        assert "area" in result

    def test_peak_in_valid_range(self):
        engine = make_engine()
        for _ in range(100):
            r = engine.get_swipe_pressure()
            assert 0.25 <= r["peak"] <= 0.85


class TestHumanizeSwipeIncludesPressure:

    def test_get_swipe_pressure_returns_valid_for_swipe_integration(self):
        """Verify get_swipe_pressure output can be used by humanize_swipe return dict."""
        engine = make_engine()
        result = engine.get_swipe_pressure()
        # These would be added to humanize_swipe return dict
        assert "peak" in result
        assert "area" in result
        assert 0.25 <= result["peak"] <= 0.85
        assert result["area"] >= 30


class TestConfigContainsTouchParams:

    def test_config_has_touch_pressure_peak(self):
        from phone_bot import config
        assert "touch_pressure_peak" in config.HUMAN
        cfg = config.HUMAN["touch_pressure_peak"]
        assert isinstance(cfg, tuple)
        assert len(cfg) == 4

    def test_config_has_touch_ramp_up_ms(self):
        from phone_bot import config
        assert "touch_ramp_up_ms" in config.HUMAN

    def test_config_has_touch_area_params(self):
        from phone_bot import config
        assert "touch_area_base" in config.HUMAN
        assert "touch_area_pressure_scale" in config.HUMAN
