import pytest
import json
from unittest.mock import patch, MagicMock
from pathlib import Path


def make_state(section="section-01", pass_count=0, attempt_count=0):
    return {
        "project": "test",
        "autonomy_mode": "full",
        "current_section": section,
        "pass_count": pass_count,
        "attempt_count": attempt_count,
        "analysis_written": False,
        "work_queue": [],
        "deferred_groups": [],
        "last_action": "idle",
        "last_updated": "2026-01-01T00:00:00+00:00",
    }


def test_pass_increments_pass_count(tmp_path):
    """PASS increments pass_count."""
    from forge.forge_controller import ForgeController

    state_file = tmp_path / "forge_state.json"
    state_file.write_text(json.dumps(make_state(pass_count=0)))

    ctrl = ForgeController(str(state_file))
    ctrl.record_pass()

    state = json.loads(state_file.read_text())
    assert state["pass_count"] == 1
    assert state["attempt_count"] == 0


def test_fail_resets_pass_count_and_increments_attempt(tmp_path):
    """FAIL resets pass_count to 0, increments attempt_count."""
    from forge.forge_controller import ForgeController

    state_file = tmp_path / "forge_state.json"
    state_file.write_text(json.dumps(make_state(pass_count=2, attempt_count=0)))

    ctrl = ForgeController(str(state_file))
    ctrl.record_fail()

    state = json.loads(state_file.read_text())
    assert state["pass_count"] == 0
    assert state["attempt_count"] == 1


def test_three_passes_completes_section(tmp_path):
    """3 consecutive PASS marks section complete, resets counters."""
    from forge.forge_controller import ForgeController

    state_file = tmp_path / "forge_state.json"
    state_file.write_text(json.dumps(make_state(pass_count=2)))

    ctrl = ForgeController(str(state_file))
    result = ctrl.record_pass()

    assert result["section_complete"] is True
    state = json.loads(state_file.read_text())
    assert state["pass_count"] == 0
    assert state["attempt_count"] == 0


def test_attempt_count_2_triggers_external_intelligence(tmp_path):
    """attempt_count reaching 2 signals that external intelligence should be called."""
    from forge.forge_controller import ForgeController

    state_file = tmp_path / "forge_state.json"
    state_file.write_text(json.dumps(make_state(attempt_count=1)))

    ctrl = ForgeController(str(state_file))
    result = ctrl.record_fail()

    assert result["needs_external_intelligence"] is True


def test_external_intelligence_formats_prompt():
    """External intelligence prompt includes problem, attempts, and failure evidence."""
    from forge.forge_controller import ForgeController, build_external_intelligence_prompt

    prompt = build_external_intelligence_prompt(
        section="section-06",
        objective="Fix _return_to_fyp to handle Story state",
        attempt1_diff="+ if story_detected: press_back()",
        attempt1_failure="f_031: bot stuck on Story, press_back had no effect",
        attempt2_diff="+ detect_story_via_pixel(); if True: press_back()",
        attempt2_failure="f_028: pixel detector false positive on video with progress bar",
    )

    assert "section-06" in prompt
    assert "_return_to_fyp" in prompt
    assert "f_031" in prompt
    assert "f_028" in prompt
    assert "root cause" in prompt.lower()


def test_state_persists_across_instances(tmp_path):
    """State written by one controller instance is readable by another."""
    from forge.forge_controller import ForgeController

    state_file = tmp_path / "forge_state.json"
    state_file.write_text(json.dumps(make_state()))

    ctrl1 = ForgeController(str(state_file))
    ctrl1.record_pass()

    ctrl2 = ForgeController(str(state_file))
    state = ctrl2.load_state()
    assert state["pass_count"] == 1


def test_attempt_count_3_signals_needs_human_input(tmp_path):
    """attempt_count reaching 3 signals needs_human_input -- loop must stop."""
    from forge.forge_controller import ForgeController

    state_file = tmp_path / "forge_state.json"
    state_file.write_text(json.dumps(make_state(attempt_count=2)))

    ctrl = ForgeController(str(state_file))
    result = ctrl.record_fail()

    assert result["needs_human_input"] is True
    assert result["attempt_count"] == 3
