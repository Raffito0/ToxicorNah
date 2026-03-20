#!/usr/bin/env python3
"""
FORGE regression registry.

Tracks functions/features that are proven to work (3x PASS).
Detects stale entries (not verified within stale_after_hours).
Marks entries broken when a section causes a regression.

Usage:
    from forge.forge_registry import ForgeRegistry
    reg = ForgeRegistry("forge/forge_registry.json")
    reg.add_entry("browse-smoke", "section-06", ["_return_to_fyp"], "python ...", 24)
    stale = reg.get_stale_entries()
"""
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path


class ForgeRegistry:
    def __init__(self, registry_path: str):
        self.path = Path(registry_path)

    def _load(self) -> dict:
        if not self.path.exists():
            return {"entries": []}
        with open(self.path) as f:
            return json.load(f)

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w") as f:
            json.dump(data, f, indent=2)

    def add_entry(
        self,
        entry_id: str,
        section: str,
        functions: list,
        test_command: str,
        stale_after_hours: int = 24,
    ) -> None:
        """Add or update a registry entry. Idempotent by entry_id."""
        data = self._load()
        now = datetime.now(timezone.utc).isoformat()

        # Update if exists
        for entry in data["entries"]:
            if entry["id"] == entry_id:
                entry["section"] = section
                entry["functions"] = functions
                entry["test_command"] = test_command
                entry["stale_after_hours"] = stale_after_hours
                entry["last_verified"] = now
                entry["broken_by"] = None
                if "proven_at" not in entry:
                    entry["proven_at"] = now
                self._save(data)
                return

        # New entry
        data["entries"].append({
            "id": entry_id,
            "section": section,
            "functions": functions,
            "test_command": test_command,
            "stale_after_hours": stale_after_hours,
            "last_verified": now,
            "proven_at": now,
            "broken_by": None,
        })
        self._save(data)

    def get_all(self) -> list:
        """Return all registry entries."""
        return self._load()["entries"]

    def get_stale_entries(self) -> list:
        """Return entries not verified within their stale_after_hours window."""
        data = self._load()
        now = datetime.now(timezone.utc)
        stale = []
        for entry in data["entries"]:
            last = datetime.fromisoformat(entry["last_verified"])
            threshold = timedelta(hours=entry.get("stale_after_hours", 24))
            if now - last > threshold:
                stale.append(entry)
        return stale

    def get_entries_for_functions(self, functions: list) -> list:
        """Return entries that cover any of the given function names."""
        data = self._load()
        result = []
        for entry in data["entries"]:
            if any(fn in entry.get("functions", []) for fn in functions):
                result.append(entry)
        return result

    def mark_broken(self, entry_id: str, broken_by: str) -> None:
        """Mark an entry as broken by a section that caused a regression."""
        data = self._load()
        for entry in data["entries"]:
            if entry["id"] == entry_id:
                entry["broken_by"] = broken_by
                self._save(data)
                return

    def update_verified(self, entry_id: str) -> None:
        """Reset last_verified timestamp to now for an entry."""
        data = self._load()
        now = datetime.now(timezone.utc).isoformat()
        for entry in data["entries"]:
            if entry["id"] == entry_id:
                entry["last_verified"] = now
                entry["broken_by"] = None
                self._save(data)
                return
