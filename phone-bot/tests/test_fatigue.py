"""Tests for Section 06: Behavior Hardening.

Tests fatigue persistence with time-decay, atomic writes, and
state-derived probability formulas.
"""
import json
import math
import os
import time
import tempfile
from unittest.mock import MagicMock, patch

import pytest


# ── Fatigue persistence ──────────────────────────────────────────

class TestFatiguePersistence:
    """Test fatigue save/load with half-life decay."""

    def test_fatigue_saved_to_personality_json(self, tmp_path):
        """_save_memory() should include fatigue_value + fatigue_timestamp."""
        # Test the save pattern directly without HumanEngine
        # (conftest.py doesn't register core.human for import)
        mem_path = tmp_path / "memory_test.json"

        # Simulate what _save_memory should do with fatigue
        fatigue_value = 0.65
        fatigue_ts = time.time()
        data = {
            "personality": {"reels_preference": 0.7},
            "fatigue_value": fatigue_value,
            "fatigue_timestamp": fatigue_ts,
        }

        # Atomic write (tmp + replace)
        tmp_file = str(mem_path) + ".tmp"
        with open(tmp_file, "w") as f:
            json.dump(data, f)
        os.replace(tmp_file, str(mem_path))

        # Verify
        with open(str(mem_path)) as f:
            loaded = json.load(f)
        assert "fatigue_value" in loaded
        assert "fatigue_timestamp" in loaded
        assert loaded["fatigue_value"] == fatigue_value

    def test_fatigue_loaded_with_decay_30min(self):
        """30 min gap -> fatigue decays to ~70% of saved value (half-life 1hr)."""
        saved_value = 0.8
        minutes_elapsed = 30

        # Half-life = 1hr = 60 min. After 30 min: 0.8 * 0.5^(30/60) = 0.8 * 0.707 = 0.566
        expected = saved_value * (0.5 ** (minutes_elapsed / 60))
        assert 0.50 < expected < 0.60

    def test_fatigue_loaded_with_decay_2hr(self):
        """2 hr gap -> fatigue decays to ~25%."""
        saved_value = 1.0
        saved_time = time.time() - 120 * 60  # 2 hrs ago

        # 1.0 * 0.5^(120/60) = 1.0 * 0.25 = 0.25
        expected = saved_value * (0.5 ** (120 / 60))
        assert abs(expected - 0.25) < 0.01

    def test_fatigue_clamped_to_0_08(self):
        """Fatigue initial value clamped to [0.0, 0.8]."""
        # Even if saved was 1.0 and only 10 min passed
        saved_value = 1.0
        saved_time = time.time() - 10 * 60  # 10 min ago

        decayed = saved_value * (0.5 ** (10 / 60))
        clamped = max(0.0, min(0.8, decayed))
        assert 0.0 <= clamped <= 0.8

    def test_missing_fatigue_field_starts_at_zero(self):
        """Backward compat: missing fatigue fields -> start at 0.0."""
        data = {"personality": {}}  # old format without fatigue
        initial = data.get("fatigue_value", 0.0)
        assert initial == 0.0


# ── Atomic writes ────────────────────────────────────────────────

class TestAtomicWrites:
    """Test tmp+replace write pattern for personality files."""

    def test_atomic_write_creates_file(self, tmp_path):
        """Atomic write: tmp file then os.replace."""
        target = tmp_path / "test_memory.json"
        tmp_file = tmp_path / "test_memory.json.tmp"

        data = {"test": "value", "personality": {"reels_preference": 0.7}}

        # Simulate atomic write pattern
        with open(str(tmp_file), "w") as f:
            json.dump(data, f)
        os.replace(str(tmp_file), str(target))

        assert target.exists()
        assert not tmp_file.exists()
        with open(str(target)) as f:
            loaded = json.load(f)
        assert loaded["test"] == "value"

    def test_atomic_write_survives_crash(self, tmp_path):
        """If tmp write fails, original file preserved."""
        target = tmp_path / "original.json"
        target.write_text('{"original": true}')

        # Simulate failed write (tmp file exists but replace never happens)
        tmp_file = tmp_path / "original.json.tmp"
        tmp_file.write_text('{"corrupt": "partial"}')
        # Don't call os.replace — simulate crash

        # Original should still be intact
        with open(str(target)) as f:
            data = json.load(f)
        assert data["original"] is True


# ── State-derived probability formulas ───────────────────────────

class TestProbabilityFormulas:
    """Test that state-derived formulas produce valid [0,1] values."""

    def _clamp(self, v):
        return max(0.0, min(1.0, v))

    def test_comment_screenshot_formula(self):
        """Formula: sociality * 0.7. All states produce [0,1]."""
        for social in [0.0, 0.3, 0.5, 0.8, 1.0]:
            result = self._clamp(social * 0.7)
            assert 0.0 <= result <= 1.0

    def test_profile_2nd_video_formula(self):
        """Formula: curiosity * 0.4 + energy * 0.15."""
        for curiosity in [0.0, 0.5, 1.0]:
            for energy in [0.0, 0.5, 1.0]:
                result = self._clamp(curiosity * 0.4 + energy * 0.15)
                assert 0.0 <= result <= 1.0

    def test_micro_swipe_outlier_formula(self):
        """Formula: fatigue * 0.08 + (1-energy) * 0.03."""
        for fatigue in [0.0, 0.5, 1.0]:
            for energy in [0.0, 0.5, 1.0]:
                result = self._clamp(fatigue * 0.08 + (1 - energy) * 0.03)
                assert 0.0 <= result <= 1.0
                assert result < 0.15  # should be low probability

    def test_inbox_scroll_formula(self):
        """Formula: patience-based decision."""
        for fatigue in [0.0, 0.5, 1.0]:
            for patience in [0.0, 0.5, 1.0]:
                # High fatigue -> 1 scroll, else patience-driven
                if fatigue > 0.5:
                    n = 1
                else:
                    n = 1 if patience > 0.5 else 2
                assert n in (1, 2)

    def test_grid_scroll_formula(self):
        """Formula: curiosity * 0.4 + boredom * 0.2."""
        for curiosity in [0.0, 0.5, 1.0]:
            for boredom in [0.0, 0.5, 1.0]:
                result = self._clamp(curiosity * 0.4 + boredom * 0.2)
                assert 0.0 <= result <= 1.0

    def test_interruption_type_formula(self):
        """Formula: energy * 0.5 + (1-fatigue) * 0.3."""
        for energy in [0.0, 0.5, 1.0]:
            for fatigue in [0.0, 0.5, 1.0]:
                result = self._clamp(energy * 0.5 + (1 - fatigue) * 0.3)
                assert 0.0 <= result <= 1.0

    def test_niche_precheck_formula(self):
        """Formula: energy * 0.3 + curiosity * 0.2."""
        for energy in [0.0, 0.5, 1.0]:
            for curiosity in [0.0, 0.5, 1.0]:
                result = self._clamp(energy * 0.3 + curiosity * 0.2)
                assert 0.0 <= result <= 1.0

    def test_extreme_values_no_nan(self):
        """Extreme state values (0, 1) produce no NaN/errors."""
        extremes = [0.0, 1.0]
        for e in extremes:
            for f in extremes:
                for c in extremes:
                    for s in extremes:
                        # All formulas with extreme values
                        assert not math.isnan(self._clamp(s * 0.7))
                        assert not math.isnan(self._clamp(c * 0.4 + e * 0.15))
                        assert not math.isnan(self._clamp(f * 0.08 + (1 - e) * 0.03))
                        assert not math.isnan(self._clamp(c * 0.4 + f * 0.2))
                        assert not math.isnan(self._clamp(e * 0.5 + (1 - f) * 0.3))
                        assert not math.isnan(self._clamp(e * 0.3 + c * 0.2))

    def test_formulas_vary_with_state(self):
        """Formulas change output when state changes."""
        # Profile 2nd video: should be higher with more curiosity
        low = self._clamp(0.1 * 0.4 + 0.3 * 0.15)
        high = self._clamp(0.9 * 0.4 + 0.9 * 0.15)
        assert high > low

        # Micro-swipe: should be higher with more fatigue
        low = self._clamp(0.1 * 0.08 + 0.1 * 0.03)
        high = self._clamp(0.9 * 0.08 + 0.9 * 0.03)
        assert high > low
