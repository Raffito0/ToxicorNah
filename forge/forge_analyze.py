#!/usr/bin/env python3
"""
FORGE v2 — Phase 1 analysis CLI.
Run before writing any code for a section.
Each subcommand appends results to forge/.analyze_cache.json.

Usage:
  python forge/forge_analyze.py --init --section section-07
  python forge/forge_analyze.py --callers _return_to_fyp [--search-dir phone-bot]
  python forge/forge_analyze.py --call-chain _return_to_fyp [--search-dir phone-bot]
  python forge/forge_analyze.py --regression-check
  python forge/forge_analyze.py --protected-core _return_to_fyp
  python forge/forge_analyze.py --config-check [--params t_new_param,OTHER]
  python forge/forge_analyze.py --pixel-check --factor 0.20
  python forge/forge_analyze.py --gemini-check [--search-dir phone-bot]
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow tests to override cache dir via env var
_FORGE_DIR = Path(os.environ.get("FORGE_CACHE_DIR", Path(__file__).parent))
ANALYZE_CACHE = _FORGE_DIR / ".analyze_cache.json"

PROTECTED_CORE = [
    "_return_to_fyp", "_tap_top_tab", "get_bounding_box",
    "scan_sidebar", "humanize_swipe", "tap_nav_home", "_inbox_enter_subpage",
]

PHONE_SCREENS = [
    ("motorola_1600", 1600),
    ("samsung_s9_2220", 2220),
    ("samsung_s22_2340", 2340),
]


def load_cache() -> dict:
    if ANALYZE_CACHE.exists():
        return json.loads(ANALYZE_CACHE.read_text(encoding="utf-8"))
    return {}


def save_cache(data: dict) -> None:
    ANALYZE_CACHE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def cmd_init(args) -> int:
    data = {
        "session_id": datetime.now(timezone.utc).isoformat(),
        "section": args.section,
        "steps_completed": [],
        "conditional_steps": [],
        "callers": [],
        "app_states": [],
        "regression_files_to_read": [],
        "protected_core": False,
        "config_missing": [],
        "pixel_math": {},
        "gemini_prompt_changed": False,
    }
    save_cache(data)
    print(f"[forge_analyze] initialized cache for {args.section}")
    return 0


def _grep_fallback(search_dir: str, fn: str) -> list:
    """Windows fallback: walk files and grep manually."""
    results = []
    for path in Path(search_dir).rglob("*.py"):
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            for i, line in enumerate(lines, start=1):
                if re.search(rf"\b{re.escape(fn)}\b", line):
                    results.append(f"{path}:{i}:{line}")
        except Exception:
            pass
    return results


def cmd_callers(args) -> int:
    cache = load_cache()
    search_dir = args.search_dir or "phone-bot"
    fn = args.callers

    try:
        result = subprocess.run(
            ["grep", "-rn", rf"\b{fn}\b", search_dir, "--include=*.py"],
            capture_output=True, text=True
        )
        if result.returncode not in (0, 1):
            raise FileNotFoundError
        lines = [l for l in result.stdout.splitlines() if l.strip()]
    except FileNotFoundError:
        # Windows: use python glob fallback
        lines = _grep_fallback(search_dir, fn)

    callers = []
    for line in lines:
        # Format: path/to/file.py:42:    result = fn()
        # On Windows: C:\path\to\file.py:42:    result = fn()
        # Split handling: check if line starts with drive letter
        parts = line.split(":")
        if len(parts) >= 4 and len(parts[0]) == 1 and parts[0].isalpha():
            # Windows path: join first 3 parts back, then split properly
            file_path = parts[0] + ":" + parts[1]
            lineno = parts[2]
            code = ":".join(parts[3:])
        elif len(parts) >= 3:
            # Unix path or already split
            file_path, lineno, code = parts[0], parts[1], ":".join(parts[2:])
        else:
            continue

        # Skip the definition itself
        if f"def {fn}" in code:
            continue
        try:
            callers.append({
                "file": str(file_path),
                "line": int(lineno),
                "code": code.strip(),
            })
        except ValueError:
            pass

    cache["callers"] = callers
    if "callers" not in cache.get("steps_completed", []):
        cache.setdefault("steps_completed", []).append("callers")
    save_cache(cache)
    print(f"[forge_analyze --callers] found {len(callers)} caller(s) of {fn}")
    return 0


def cmd_call_chain(args) -> int:
    """Trace call chain for FUNCTION and identify app states."""
    cache = load_cache()
    search_dir = args.search_dir or "phone-bot"
    fn: str = args.call_chain

    # Level 1: direct callers of fn
    direct = _grep_fallback(search_dir, fn)

    # Cross-reference with known app state entry points
    entry_points = {
        "browse_session": "FYP",
        "browse_following_session": "Following",
        "browse_explore_session": "Explore",
        "browse_shop_session": "Shop",
        "browse_inbox_session": "Inbox",
    }
    app_states = []

    for ep, state in entry_points.items():
        # Check if ep is in direct callers of fn
        if any(ep in line for line in direct):
            app_states.append(state)
        else:
            # Level 2 check: does ep call fn indirectly?
            ep_calls = _grep_fallback(search_dir, ep)
            if any(fn in line for line in ep_calls):
                app_states.append(state)

    if not app_states:
        app_states = ["unknown — trace manually"]

    cache.setdefault("steps_completed", [])
    if "call-chain" not in cache["steps_completed"]:
        cache["steps_completed"].append("call-chain")
    cache["app_states"] = app_states
    save_cache(cache)

    print(f"[forge_analyze --call-chain] {fn} reachable from: {', '.join(app_states)}")
    return 0


def cmd_protected_core(args) -> int:
    """Check if FUNCTION is in PROTECTED_CORE."""
    cache = load_cache()
    fn = getattr(args, "protected_core", None)
    is_protected = fn in PROTECTED_CORE

    cache.setdefault("steps_completed", [])
    if "protected-core" not in cache["steps_completed"]:
        cache["steps_completed"].append("protected-core")
    cache["protected_core"] = is_protected
    save_cache(cache)

    status = "YES — browse-smoke required after fix" if is_protected else "no"
    print(f"[forge_analyze --protected-core] {fn}: {status}")
    return 0


def cmd_config_check(args) -> int:
    """Check if config params exist in config.py."""
    cache = load_cache()
    params = [p.strip() for p in (args.params or "").split(",") if p.strip()]
    config_file = Path(args.config_file or "phone-bot/config.py")

    missing = []
    if config_file.exists():
        config_text = config_file.read_text(encoding="utf-8", errors="replace")
        for param in params:
            if f'"{param}"' not in config_text and f"'{param}'" not in config_text:
                missing.append(param)
    else:
        print(f"[forge_analyze --config-check] WARNING: config file not found: {config_file}")

    cache.setdefault("steps_completed", [])
    if "config-check" not in cache["steps_completed"]:
        cache["steps_completed"].append("config-check")
    cache["config_missing"] = missing
    save_cache(cache)

    if missing:
        print(f"[forge_analyze --config-check] MISSING in config.py: {', '.join(missing)}")
    else:
        print(f"[forge_analyze --config-check] all params present")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="FORGE v2 Phase 1 — Analysis CLI")
    parser.add_argument("--init", action="store_true", help="Initialize fresh cache")
    parser.add_argument("--section", default="", help="Section name (required with --init)")
    parser.add_argument("--callers", metavar="FUNCTION", help="Find all callers of FUNCTION")
    parser.add_argument("--call-chain", metavar="FUNCTION", help="Trace full call chain of FUNCTION")
    parser.add_argument("--regression-check", action="store_true", help="List files to read for regression")
    parser.add_argument("--protected-core", metavar="FUNCTION", help="Check if FUNCTION is PROTECTED_CORE")
    parser.add_argument("--config-check", action="store_true", help="Check config params exist")
    parser.add_argument("--params", default="", help="Comma-separated param names to check")
    parser.add_argument("--config-file", default="phone-bot/config.py", help="Path to config.py")
    parser.add_argument("--pixel-check", action="store_true", help="Compute pixel math for all phones")
    parser.add_argument("--factor", type=float, help="Proportional factor for pixel math (e.g. 0.20)")
    parser.add_argument("--gemini-check", action="store_true", help="Check if Gemini prompts changed")
    parser.add_argument("--search-dir", default=None, help="Directory to search (default: phone-bot)")
    parser.add_argument("--diff-file", default=None, help="Path to diff file for --gemini-check")

    args = parser.parse_args()

    if args.init:
        return cmd_init(args)
    elif args.callers:
        return cmd_callers(args)
    elif getattr(args, "call_chain", None):
        return cmd_call_chain(args)
    elif getattr(args, "protected_core", None):
        return cmd_protected_core(args)
    elif args.config_check:
        return cmd_config_check(args)
    else:
        parser.print_help()
        return 1


if __name__ == "__main__":
    sys.exit(main())
