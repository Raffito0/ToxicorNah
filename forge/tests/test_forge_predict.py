# forge/tests/test_forge_predict.py
import json
import subprocess
import sys
from pathlib import Path
import os

PROJECT_ROOT = Path(__file__).parent.parent.parent


def run_predict(tmp_path, *args):
    return subprocess.run(
        [sys.executable, "forge/forge_predict.py", *args],
        capture_output=True, text=True,
        env={"FORGE_CACHE_DIR": str(tmp_path), **os.environ},
        cwd=str(PROJECT_ROOT),
    )


def test_import_check_pass(tmp_path):
    """--import-check passes for a valid module."""
    result = run_predict(tmp_path, "--import-check", "--module", "json")
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".predict_cache.json").read_text())
    assert cache["import_check_passed"] is True
    assert "import-check" in cache["steps_completed"]


def test_import_check_fail(tmp_path):
    """--import-check fails for a non-existent module."""
    result = run_predict(tmp_path, "--import-check", "--module", "nonexistent_module_xyz_abc")
    assert result.returncode == 0  # tool exits 0, but marks failed
    cache = json.loads((tmp_path / ".predict_cache.json").read_text())
    assert cache["import_check_passed"] is False


def test_log_signatures_extracts_from_diff(tmp_path):
    """--log-signatures extracts log.info/warning strings from a diff."""
    diff = (
        '+    log.info("[INFO] _return_to_fyp: FYP confirmed")\n'
        '+    log.warning("[WARNING] _return_to_fyp: still on Story")\n'
    )
    diff_file = tmp_path / "fake.diff"
    diff_file.write_text(diff)

    result = run_predict(tmp_path, "--log-signatures", "--diff-file", str(diff_file))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".predict_cache.json").read_text())
    assert "FYP confirmed" in cache["expect_pass_signature"]
    assert "still on Story" in cache["expect_fail_signature"]
    assert "log-signatures" in cache["steps_completed"]


def test_recovery_predict_finds_calls(tmp_path):
    """--recovery-predict finds recovery function calls in diff."""
    diff = (
        '+    if stuck:\n'
        '+        _return_to_fyp()\n'
        '+        press_back()\n'
    )
    diff_file = tmp_path / "fake.diff"
    diff_file.write_text(diff)

    result = run_predict(tmp_path, "--recovery-predict", "--diff-file", str(diff_file))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".predict_cache.json").read_text())
    assert "_return_to_fyp" in cache["recovery_at_risk"]
    assert "press_back" in cache["recovery_at_risk"]


def test_precondition_verify_no_precondition(tmp_path):
    """--precondition-verify passes immediately when section has no pre_condition."""
    section = tmp_path / "section-07.md"
    section.write_text("# Section 07\n\nNo precondition defined here.\n")

    result = run_predict(tmp_path, "--precondition-verify",
                         "--section-file", str(section))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".predict_cache.json").read_text())
    assert cache["precondition_met"] is True
    assert cache["precondition_description"] == "no precondition required"
    assert "precondition-verify" in cache["steps_completed"]


def test_precondition_verify_with_precondition_text(tmp_path):
    """--precondition-verify records description when precondition text is found."""
    section = tmp_path / "section-07.md"
    section.write_text(
        "# Section 07\n\n"
        "**pre_condition**: FYP must be visible with at least one video loaded\n\n"
    )

    result = run_predict(tmp_path, "--precondition-verify",
                         "--section-file", str(section),
                         "--skip-adb")  # skip ADB in unit tests
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".predict_cache.json").read_text())
    assert "FYP" in cache["precondition_description"]
    assert "precondition-verify" in cache["steps_completed"]


def test_test_command_validates_mode(tmp_path):
    """--test-command extracts mode from section file and verifies it exists in main.py."""
    # Create fake section file with forge header
    section = tmp_path / "section-07.md"
    section.write_text('<!--forge\nforge:\n  test_protocol:\n    commands:\n      - "python phone-bot/main.py --test browse-smoke --phone 3"\nforge-->\n')

    # Create fake main.py with the mode
    main_py = tmp_path / "main.py"
    main_py.write_text('if args.test == "browse-smoke":\n    pass\n')

    result = run_predict(tmp_path, "--test-command",
                         "--section-file", str(section),
                         "--main-py", str(main_py))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".predict_cache.json").read_text())
    assert "browse-smoke" in cache["test_command"]
    assert "test-command" in cache["steps_completed"]
