import pytest
import json
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta


def test_add_entry(tmp_path):
    """Registry saves a new entry correctly."""
    from forge.forge_registry import ForgeRegistry

    reg = ForgeRegistry(str(tmp_path / "registry.json"))
    reg.add_entry(
        entry_id="browse-smoke",
        section="section-06",
        functions=["_return_to_fyp", "_tap_top_tab"],
        test_command="python phone-bot/main.py --test browse-smoke --phone 3",
        stale_after_hours=24,
    )

    entries = reg.get_all()
    assert len(entries) == 1
    assert entries[0]["id"] == "browse-smoke"
    assert "_return_to_fyp" in entries[0]["functions"]


def test_staleness_check(tmp_path):
    """Entry is stale if not verified within stale_after_hours."""
    from forge.forge_registry import ForgeRegistry

    reg = ForgeRegistry(str(tmp_path / "registry.json"))
    old_time = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()

    reg.add_entry("nav", "section-01", ["fn_a"], "pytest", stale_after_hours=24)
    # Manually backdate last_verified
    data = reg._load()
    data["entries"][0]["last_verified"] = old_time
    reg._save(data)

    stale = reg.get_stale_entries()
    assert len(stale) == 1
    assert stale[0]["id"] == "nav"


def test_fresh_entry_not_stale(tmp_path):
    """Entry verified recently is not stale."""
    from forge.forge_registry import ForgeRegistry

    reg = ForgeRegistry(str(tmp_path / "registry.json"))
    reg.add_entry("nav", "section-01", ["fn_a"], "pytest", stale_after_hours=24)

    stale = reg.get_stale_entries()
    assert len(stale) == 0


def test_mark_broken(tmp_path):
    """Mark entry as broken by a section."""
    from forge.forge_registry import ForgeRegistry

    reg = ForgeRegistry(str(tmp_path / "registry.json"))
    reg.add_entry("nav", "section-01", ["fn_a"], "pytest", stale_after_hours=24)
    reg.mark_broken("nav", broken_by="section-07")

    data = reg._load()
    assert data["entries"][0]["broken_by"] == "section-07"


def test_get_entries_for_functions(tmp_path):
    """Query entries that cover specific functions."""
    from forge.forge_registry import ForgeRegistry

    reg = ForgeRegistry(str(tmp_path / "registry.json"))
    reg.add_entry("nav", "section-01", ["_return_to_fyp", "_tap_top_tab"], "pytest", stale_after_hours=24)
    reg.add_entry("search", "section-03", ["search_explore_session"], "pytest", stale_after_hours=24)

    matches = reg.get_entries_for_functions(["_return_to_fyp"])
    assert len(matches) == 1
    assert matches[0]["id"] == "nav"


def test_update_verified_timestamp(tmp_path):
    """Calling update_verified resets last_verified to now."""
    from forge.forge_registry import ForgeRegistry

    reg = ForgeRegistry(str(tmp_path / "registry.json"))
    reg.add_entry("nav", "section-01", ["fn_a"], "pytest", stale_after_hours=24)

    # Backdate
    data = reg._load()
    data["entries"][0]["last_verified"] = "2020-01-01T00:00:00+00:00"
    reg._save(data)

    reg.update_verified("nav")
    stale = reg.get_stale_entries()
    assert len(stale) == 0
