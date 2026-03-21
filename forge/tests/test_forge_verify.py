# forge/tests/test_forge_verify.py
import json
import subprocess
import sys
from pathlib import Path
import os


PROJECT_ROOT = Path(__file__).parent.parent.parent


def run_verify(tmp_path, *args):
    return subprocess.run(
        [sys.executable, "forge/forge_verify.py", *args],
        capture_output=True, text=True,
        env={"FORGE_CACHE_DIR": str(tmp_path), **os.environ},
        cwd=str(PROJECT_ROOT),
    )


def test_filter_logs_removes_debug_and_pil(tmp_path):
    """--filter-logs keeps INFO/WARNING, removes DEBUG and PIL lines."""
    log = tmp_path / "test.log"
    log.write_text(
        "[DEBUG] some debug line\n"
        "[INFO] bot scrolled FYP\n"
        "[WARNING] recovery fired\n"
        "[INFO] PIL.Image loaded\n"
    )
    result = run_verify(tmp_path, "--filter-logs", "--log", str(log))
    assert result.returncode == 0
    filtered = (tmp_path / ".filtered_log.txt").read_text()
    assert "[INFO] bot scrolled FYP" in filtered
    assert "[WARNING] recovery fired" in filtered
    assert "[DEBUG]" not in filtered
    assert "PIL." not in filtered


def test_compare_predictions_detects_pass_signature(tmp_path):
    """--compare-predictions marks signature_found=True when pass sig in log."""
    predict = {
        "expect_pass_signature": "FYP confirmed",
        "expect_fail_signature": "still on Story",
        "recovery_at_risk": ["_return_to_fyp"],
    }
    (tmp_path / ".predict_cache.json").write_text(json.dumps(predict))
    (tmp_path / ".filtered_log.txt").write_text("[INFO] _return_to_fyp: FYP confirmed\n")

    gemini_result = {"recovery_analysis": [], "events_analyzed": []}
    (tmp_path / ".verify_result.json").write_text(json.dumps({"gemini": gemini_result}))

    result = run_verify(tmp_path, "--compare-predictions")
    assert result.returncode == 0
    verify = json.loads((tmp_path / ".verify_result.json").read_text())
    assert verify["pass_signature_found"] is True
    assert verify["fail_signature_found"] is False


def test_interference_check_marks_attempt_not_counted(tmp_path):
    """--interference-check sets attempt_should_be_counted=False when popup caused failure."""
    gemini_output = {
        "preliminary_verdict": "FAIL",
        "anomalies_detected": [{
            "video_timestamp": "00:00:30",
            "description": "Unexpected popup appeared",
            "severity": "high",
            "category": "popup",
        }],
        "events_analyzed": [
            {"timestamp": "00:00:45", "correlation": "mismatch", "notes": "bot got stuck"},
        ],
    }
    (tmp_path / ".verify_result.json").write_text(json.dumps({"gemini": gemini_output}))

    result = run_verify(tmp_path, "--interference-check")
    assert result.returncode == 0
    verify = json.loads((tmp_path / ".verify_result.json").read_text())
    assert verify["interference_detected"] is True
    assert verify["attempt_should_be_counted"] is False


def test_interference_check_counts_attempt_on_clean_fail(tmp_path):
    """--interference-check sets attempt_should_be_counted=True when no interference."""
    gemini_output = {
        "preliminary_verdict": "FAIL",
        "anomalies_detected": [],
        "events_analyzed": [],
    }
    (tmp_path / ".verify_result.json").write_text(json.dumps({"gemini": gemini_output}))

    result = run_verify(tmp_path, "--interference-check")
    assert result.returncode == 0
    verify = json.loads((tmp_path / ".verify_result.json").read_text())
    assert verify["interference_detected"] is False
    assert verify["attempt_should_be_counted"] is True


def test_write_emerging_appends_high_severity(tmp_path):
    """--write-emerging appends high-severity anomalies to emerging-problems.md."""
    ep_file = tmp_path / "emerging-problems.md"
    ep_file.write_text("# Emerging Problems\n\n")

    gemini_output = {
        "anomalies_detected": [
            {"video_timestamp": "00:01:00", "description": "LIVE badge detection fails",
             "severity": "high", "category": "navigation"},
            {"video_timestamp": "00:00:05", "description": "minor ui flicker",
             "severity": "low", "category": "ui_glitch"},
        ]
    }
    (tmp_path / ".verify_result.json").write_text(json.dumps({"gemini": gemini_output}))

    result = run_verify(tmp_path, "--write-emerging",
                        "--emerging-file", str(ep_file))
    assert result.returncode == 0
    content = ep_file.read_text()
    assert "LIVE badge detection fails" in content
    assert "minor ui flicker" not in content  # low severity not written

    verify = json.loads((tmp_path / ".verify_result.json").read_text())
    assert len(verify["new_emerging_problems"]) == 1
