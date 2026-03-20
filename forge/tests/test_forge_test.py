import pytest
import json
from unittest.mock import patch, MagicMock
from pathlib import Path


# --- Hardware failure detection ---

def test_hardware_failure_when_scrcpy_not_found(tmp_path):
    """forge_test returns hardware_error when scrcpy exits non-zero."""
    from forge.forge_test import run_test_protocol

    protocol = {
        "type": "physical_device",
        "commands": ["scrcpy --record test.mkv", "python main.py --test x --phone 3"],
        "frame_extraction": "ffmpeg -y -i test.mkv -vf fps=0.5,scale=720:-2 frames/f_%03d.jpg",
        "pass_threshold": 3,
        "gemini_analysis": False,
    }

    with patch("forge.forge_test.subprocess.Popen") as mock_popen:
        proc = MagicMock()
        proc.returncode = 1
        proc.stderr = MagicMock()
        proc.stderr.__iter__ = MagicMock(return_value=iter([b"error: could not connect\n"]))
        proc.poll.return_value = 1
        mock_popen.return_value = proc

        result = run_test_protocol("section-01", protocol, str(tmp_path))

    assert result["hardware_error"] is True
    assert "phone" in result["message"].lower() or "scrcpy" in result["message"].lower()


def test_returns_frame_count_on_success(tmp_path):
    """forge_test returns correct frame count when test succeeds."""
    from forge.forge_test import run_test_protocol

    # Create fake extracted frames
    frames_dir = tmp_path / "tmp_forge_section-01_frames"
    frames_dir.mkdir()
    for i in range(1, 8):
        (frames_dir / f"f_{i:03d}.jpg").write_bytes(b"fake")

    protocol = {
        "type": "physical_device",
        "commands": ["scrcpy --record test.mkv", "python main.py --test x --phone 3"],
        "frame_extraction": f"ffmpeg -y -i test.mkv -vf fps=0.5,scale=720:-2 {frames_dir}/f_%03d.jpg",
        "pass_threshold": 3,
        "gemini_analysis": False,
    }

    with patch("forge.forge_test.subprocess.Popen") as mock_scrcpy, \
         patch("forge.forge_test.subprocess.run") as mock_run:

        scrcpy_proc = MagicMock()
        scrcpy_proc.returncode = None
        scrcpy_proc.poll.return_value = None
        # Simulate stderr yielding "Recording started" line
        scrcpy_proc.stderr = MagicMock()
        scrcpy_proc.stderr.__iter__ = MagicMock(return_value=iter([b"Recording started\n"]))
        mock_scrcpy.return_value = scrcpy_proc
        mock_run.return_value = MagicMock(returncode=0)

        result = run_test_protocol("section-01", protocol, str(tmp_path))

    assert result.get("hardware_error") is not True
    assert result["frames_extracted"] == 7
    assert result["exit_code"] == 0


def test_ffmpeg_always_uses_scale_720(tmp_path):
    """frame extraction command MUST include scale=720:-2."""
    from forge.forge_test import build_ffmpeg_command

    mkv = str(tmp_path / "test.mkv")
    frames = str(tmp_path / "frames")
    cmd = build_ffmpeg_command(mkv, frames)

    assert "scale=720:-2" in cmd, "scale=720:-2 is mandatory — Samsung screens crash Claude API otherwise"


def test_unit_test_protocol_skips_scrcpy(tmp_path):
    """For unit_test type, scrcpy is not launched."""
    from forge.forge_test import run_test_protocol

    protocol = {
        "type": "unit_test",
        "commands": ["npm test"],
        "pass_threshold": 1,
        "gemini_analysis": False,
    }

    with patch("forge.forge_test.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="Tests passed")
        result = run_test_protocol("section-01", protocol, str(tmp_path))

    assert result.get("hardware_error") is not True
    assert result["exit_code"] == 0


def test_result_json_schema(tmp_path):
    """Result JSON always contains required fields."""
    from forge.forge_test import run_test_protocol

    protocol = {
        "type": "unit_test",
        "commands": ["echo ok"],
        "pass_threshold": 1,
        "gemini_analysis": False,
    }

    with patch("forge.forge_test.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="ok")
        result = run_test_protocol("section-01", protocol, str(tmp_path))

    required_fields = {"exit_code", "frames_extracted", "analysis_path", "hardware_error"}
    for field in required_fields:
        assert field in result, f"Missing required field: {field}"
