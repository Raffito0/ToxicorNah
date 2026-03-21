# forge/tests/test_forge_analyze.py
import json
import subprocess
import sys
import os
from pathlib import Path


def run_analyze(tmp_path, *args):
    """Run forge_analyze.py with given args, with FORGE_DIR pointing to tmp_path."""
    result = subprocess.run(
        [sys.executable, "forge/forge_analyze.py", *args],
        capture_output=True, text=True,
        env={"FORGE_CACHE_DIR": str(tmp_path), **os.environ},
        cwd="c:/Users/rafca/OneDrive/Desktop/Toxic or Nah",
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


def test_callers_no_results(tmp_path):
    """--callers with no matches still marks step complete, callers=[]."""
    run_analyze(tmp_path, "--init", "--section", "section-07")
    result = run_analyze(tmp_path, "--callers", "_nonexistent_fn_xyz",
                         "--search-dir", str(tmp_path))
    assert result.returncode == 0
    cache = json.loads((tmp_path / ".analyze_cache.json").read_text())
    assert "callers" in cache["steps_completed"]
    assert cache["callers"] == []
