# forge/tests/test_forge_analyze.py
import json
import subprocess
import sys
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).parent.parent.parent


def run_analyze(tmp_path, *args):
    """Run forge_analyze.py with given args, with FORGE_DIR pointing to tmp_path."""
    result = subprocess.run(
        [sys.executable, "forge/forge_analyze.py", *args],
        capture_output=True, text=True,
        env={"FORGE_CACHE_DIR": str(tmp_path), **os.environ},
        cwd=str(PROJECT_ROOT),
    )
    return result


def test_init_creates_empty_cache(tmp_path):
    """--init creates a fresh .analyze_cache.json with empty steps_completed."""
    result = run_analyze(tmp_path, "--init", "--section", "section-07")
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert cache["section"] == "section-07"
    assert cache["steps_completed"] == []
    assert "session_id" in cache


def test_callers_finds_function(tmp_path):
    """--callers finds grep results and appends to cache."""
    # Pre-init
    run_analyze(tmp_path, "--init", "--section", "section-07")

    # Create a fake python file with a caller
    fake_file = tmp_path / "tiktok.py"
    fake_file.write_text("def browse_session():\n    result = _return_to_fyp()\n    return result\n")

    result = run_analyze(tmp_path, "--callers", "_return_to_fyp",
                         "--search-dir", str(tmp_path))
    assert result.returncode == 0

    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert "callers" in cache["steps_completed"]
    assert len(cache["callers"]) >= 1
    assert cache["callers"][0]["file"].endswith("tiktok.py")
    assert cache["callers"][0]["line"] == 2
    assert cache["function"] == "_return_to_fyp"


def test_callers_no_results(tmp_path):
    """--callers with no matches still marks step complete, callers=[]."""
    run_analyze(tmp_path, "--init", "--section", "section-07")
    result = run_analyze(tmp_path, "--callers", "_nonexistent_fn_xyz",
                         "--search-dir", str(tmp_path))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert "callers" in cache["steps_completed"]
    assert cache["callers"] == []


def test_call_chain_finds_app_states(tmp_path):
    """--call-chain traces up 3 levels and identifies app states."""
    run_analyze(tmp_path, "--init", "--section", "section-07")

    # Create fake call hierarchy: browse_session -> _return_to_fyp
    (tmp_path / "tiktok.py").write_text(
        "def browse_session():\n    _return_to_fyp()\n\n"
        "def _return_to_fyp():\n    pass\n"
    )
    # browse_session is called from main.py
    (tmp_path / "main.py").write_text("browse_session()\n")

    result = run_analyze(tmp_path, "--call-chain", "_return_to_fyp",
                         "--search-dir", str(tmp_path))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert "call-chain" in cache["steps_completed"]
    assert isinstance(cache["app_states"], list)


def test_protected_core_detects_in_list(tmp_path):
    """--protected-core returns True for functions in PROTECTED_CORE."""
    run_analyze(tmp_path, "--init", "--section", "section-07")
    result = run_analyze(tmp_path, "--protected-core", "_return_to_fyp")
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert cache["protected_core"] is True
    assert "protected-core" in cache["steps_completed"]


def test_protected_core_not_in_list(tmp_path):
    """--protected-core returns False for functions NOT in PROTECTED_CORE."""
    run_analyze(tmp_path, "--init", "--section", "section-07")
    result = run_analyze(tmp_path, "--protected-core", "browse_session")
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert cache["protected_core"] is False


def test_config_check_finds_missing(tmp_path):
    """--config-check flags params not in config.py."""
    run_analyze(tmp_path, "--init", "--section", "section-07")
    # Create a config.py without the param
    (tmp_path / "config.py").write_text('HUMAN = {"t_existing": (1.0, 0.1, 0.5, 3.0)}\n')

    result = run_analyze(tmp_path, "--config-check", "--params", "t_missing_param",
                         "--config-file", str(tmp_path / "config.py"))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert "t_missing_param" in cache["config_missing"]
    assert "config-check" in cache["steps_completed"]


def test_config_check_all_present(tmp_path):
    """--config-check passes when all params exist in config.py."""
    run_analyze(tmp_path, "--init", "--section", "section-07")
    (tmp_path / "config.py").write_text('HUMAN = {"t_existing": (1.0, 0.1, 0.5, 3.0)}\n')

    result = run_analyze(tmp_path, "--config-check", "--params", "t_existing",
                         "--config-file", str(tmp_path / "config.py"))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert cache["config_missing"] == []


def test_pixel_check_computes_all_phones(tmp_path):
    """--pixel-check computes correct px values for all 3 target phones."""
    run_analyze(tmp_path, "--init", "--section", "section-07")
    result = run_analyze(tmp_path, "--pixel-check", "--factor", "0.20")
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert cache["pixel_math"]["motorola_1600"] == 320    # 0.20 * 1600
    assert cache["pixel_math"]["samsung_s9_2220"] == 444  # 0.20 * 2220
    assert cache["pixel_math"]["samsung_s22_2340"] == 468 # 0.20 * 2340
    assert "pixel-check" in cache["conditional_steps"]


def test_regression_check_reads_function_from_cache(tmp_path):
    """--regression-check uses function name stored by --callers step and finds caller files."""
    run_analyze(tmp_path, "--init", "--section", "section-07")

    # Create a fake caller file that CALLS _return_to_fyp (not just defines it)
    (tmp_path / "tiktok.py").write_text(
        "def browse_session():\n    result = _return_to_fyp()\n    return result\n"
    )

    # Use --callers to set cache["function"] (real workflow, not manual injection)
    run_analyze(tmp_path, "--callers", "_return_to_fyp", "--search-dir", str(tmp_path))

    # Verify --callers stored the function name
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert cache["function"] == "_return_to_fyp"

    # Create a fake registry with a completed section covering _return_to_fyp
    registry = {
        "entries": [{
            "id": "browse-smoke",
            "section": "section-06",
            "functions": ["_return_to_fyp", "_tap_top_tab"],
            "test_command": "pytest",
            "proven_at": "2026-01-01T00:00:00+00:00",
            "last_verified": "2026-01-01T00:00:00+00:00",
        }]
    }
    (tmp_path / "forge_registry.json").write_text(json.dumps(registry))

    result = run_analyze(tmp_path, "--regression-check",
                         "--registry", str(tmp_path / "forge_registry.json"),
                         "--search-dir", str(tmp_path))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert "regression-check" in cache["steps_completed"]
    # Must find tiktok.py as a file to read (it calls _return_to_fyp)
    assert len(cache["regression_files_to_read"]) >= 1
    assert any("tiktok.py" in f for f in cache["regression_files_to_read"])


def test_gemini_check_detects_prompt_change(tmp_path):
    """--gemini-check sets gemini_prompt_changed=True when diff contains Gemini prompt changes."""
    run_analyze(tmp_path, "--init", "--section", "section-07")

    diff_file = tmp_path / "fake.diff"
    diff_file.write_text('+ANALYSIS_PROMPT = """You are analyzing..."""\n')

    result = run_analyze(tmp_path, "--gemini-check",
                         "--diff-file", str(diff_file),
                         "--search-dir", str(tmp_path))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert "gemini-check" in cache["conditional_steps"]
    assert cache["gemini_prompt_changed"] is True


def test_gemini_check_no_change(tmp_path):
    """--gemini-check sets gemini_prompt_changed=False when diff has no Gemini changes."""
    run_analyze(tmp_path, "--init", "--section", "section-07")

    diff_file = tmp_path / "fake.diff"
    diff_file.write_text('+    result = some_other_function()\n')

    result = run_analyze(tmp_path, "--gemini-check",
                         "--diff-file", str(diff_file),
                         "--search-dir", str(tmp_path))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert cache["gemini_prompt_changed"] is False


def test_regression_check_no_overlap(tmp_path):
    """--regression-check with no overlap produces empty regression_files_to_read."""
    run_analyze(tmp_path, "--init", "--section", "section-07")
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    cache["function"] = "_unrelated_fn"
    (tmp_path / ".analyze_cache.json").write_text(json.dumps(cache))

    registry = {"entries": [{"id": "x", "section": "s1", "functions": ["_other_fn"],
                              "test_command": "pytest", "proven_at": "", "last_verified": ""}]}
    (tmp_path / "forge_registry.json").write_text(json.dumps(registry))

    result = run_analyze(tmp_path, "--regression-check",
                         "--registry", str(tmp_path / "forge_registry.json"),
                         "--search-dir", str(tmp_path))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert cache["regression_files_to_read"] == []
