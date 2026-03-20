import sys
import json
import pytest
from pathlib import Path


def make_payload(response_text: str, command: str = "echo verdict") -> dict:
    return {
        "tool_input": {"command": command},
        "messages": [{"role": "assistant", "content": response_text}],
    }


def run_hook(payload: dict) -> tuple:
    """Run require-block-b.py with given payload. Returns (exit_code, output)."""
    import subprocess
    result = subprocess.run(
        ["python", "C:/Users/rafca/.claude/hooks/require-block-b.py"],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout + result.stderr


def test_passes_when_no_block_b_keyword(tmp_path):
    """Hook only fires when Block B marker is present."""
    payload = make_payload("Just some regular text, no verdict here.")
    code, _ = run_hook(payload)
    assert code == 0


VALID_BLOCK_B = """
\u2500\u2500 TEST RESULT (run 1/3) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
scrcpy:   tmp_test_browse.mkv recording started \u2713
test:     python phone-bot/main.py --test browse --phone 3 \u2192 exit 0
stopped:  taskkill /IM scrcpy.exe \u2713
ffmpeg:   fps=0.5,scale=720:-2 \u2192 5 frames extracted \u2713
Frames:   5 frames total
  f_001 \u2192 FYP visible, bot scrolling
  f_002 \u2192 FYP still, like action
  f_003 \u2192 FYP after like
  f_004 \u2192 FYP continuing scroll
  f_005 \u2192 FYP final state
Recovery: none
Logs:     navigation returned \u2713
Verdict:  PASS \u2014 all scenarios passed
SOLUTIONS.md: not yet
Integration: N/A
Emerging: new: none \u2014 existing: none
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
"""


def test_passes_with_valid_complete_block_b(tmp_path, monkeypatch):
    """Valid Block B with correct frame count passes."""
    # Hook derives frames dir from scrcpy line: tmp_test_browse.mkv -> tmp_test_browse_frames
    frames_dir = tmp_path / "tmp_test_browse_frames"
    frames_dir.mkdir()
    for i in range(1, 6):
        (frames_dir / f"f_{i:03d}.jpg").write_bytes(b"x")

    # Run hook from tmp_path so it finds the frames dir by convention
    import subprocess
    result = subprocess.run(
        ["python", "C:/Users/rafca/.claude/hooks/require-block-b.py"],
        input=json.dumps(make_payload(VALID_BLOCK_B)),
        capture_output=True, text=True, cwd=str(tmp_path),
    )
    assert result.returncode == 0, f"Should pass: {result.stdout}{result.stderr}"


def test_blocks_when_frame_count_mismatch(tmp_path):
    """Block B lists 5 frames but directory has 8 -> BLOCKED."""
    frames_dir = tmp_path / "tmp_test_browse_frames"
    frames_dir.mkdir()
    for i in range(1, 9):  # 8 frames on disk
        (frames_dir / f"f_{i:03d}.jpg").write_bytes(b"x")

    import subprocess
    result = subprocess.run(
        ["python", "C:/Users/rafca/.claude/hooks/require-block-b.py"],
        input=json.dumps(make_payload(VALID_BLOCK_B)),  # block B says 5 frames
        capture_output=True, text=True, cwd=str(tmp_path),
    )
    assert result.returncode != 0
    assert "frame" in (result.stdout + result.stderr).lower() or "BLOCKED" in (result.stdout + result.stderr)


def test_blocks_when_sampling_detected():
    """Block B with '...' shorthand between frames -> BLOCKED."""
    block_b_sampled = VALID_BLOCK_B.replace(
        "  f_003 \u2192 FYP after like\n  f_004 \u2192 FYP continuing scroll\n",
        "  ...\n"
    )
    payload = make_payload(block_b_sampled)
    code, output = run_hook(payload)
    assert code != 0
    assert "sampling" in output.lower() or "BLOCKED" in output


def test_blocks_when_recovery_fires_more_than_twice():
    """Recovery firing > 2 times must force FAIL."""
    block_b_recovery = VALID_BLOCK_B.replace(
        "Recovery: none",
        "Recovery: _return_to_fyp \u00d7 3"
    )
    payload = make_payload(block_b_recovery)
    code, output = run_hook(payload)
    assert code != 0
    assert "recovery" in output.lower() or "BLOCKED" in output


def test_blocks_missing_solutions_on_third_pass():
    """On PASS 3/3, SOLUTIONS.md must be written."""
    block_b_3rd = VALID_BLOCK_B.replace(
        "\u2500\u2500 TEST RESULT (run 1/3)",
        "\u2500\u2500 TEST RESULT (run 3/3)"
    ).replace(
        "SOLUTIONS.md: not yet",
        "SOLUTIONS.md: not yet"
    )
    payload = make_payload(block_b_3rd)
    code, output = run_hook(payload)
    assert code != 0
    assert "solutions" in output.lower() or "BLOCKED" in output
