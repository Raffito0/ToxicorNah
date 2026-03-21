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


def cmd_pixel_check(args) -> int:
    """Compute pixel math for all 3 target phones."""
    cache = load_cache()
    if args.factor is None:
        print("ERROR: --pixel-check requires --factor", file=sys.stderr)
        return 1

    factor = args.factor
    pixel_math = {}
    for name, height in PHONE_SCREENS:
        pixel_math[name] = round(factor * height)

    cache.setdefault("conditional_steps", [])
    if "pixel-check" not in cache["conditional_steps"]:
        cache["conditional_steps"].append("pixel-check")
    cache["pixel_math"] = pixel_math
    save_cache(cache)

    print(f"[forge_analyze --pixel-check] factor={factor}")
    for name, px in pixel_math.items():
        print(f"  {name}: {factor} * screen_h = {px}px")
    return 0


def cmd_regression_check(args) -> int:
    """Find files that call the function for regression testing."""
    cache = load_cache()
    fn = cache.get("function", "")
    if not fn:
        print("ERROR: --regression-check requires --callers to run first (no 'function' in cache)",
              file=sys.stderr)
        return 1

    registry_path = Path(getattr(args, "registry", "forge/forge_registry.json"))
    if not registry_path.exists():
        cache.setdefault("steps_completed", [])
        if "regression-check" not in cache["steps_completed"]:
            cache["steps_completed"].append("regression-check")
        cache["regression_files_to_read"] = []
        save_cache(cache)
        print(f"[forge_analyze --regression-check] registry not found, skipping")
        return 0

    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    entries = registry.get("entries", [])

    # Find entries whose proven functions overlap with fn
    overlapping = [e for e in entries if fn in e.get("functions", [])]

    # For each overlapping entry, find the files that call fn
    search_dir = args.search_dir or "phone-bot"
    caller_lines = _grep_fallback(search_dir, fn)
    files_to_read = []
    for line in caller_lines:
        parts = line.split(":")
        if len(parts) >= 3:
            # Handle Windows drive letter: C:\path\file.py:42:code
            if len(parts[0]) == 1 and parts[0].isalpha():
                file_path = parts[0] + ":" + parts[1]
                rest = parts[2:]
            else:
                file_path = parts[0]
                rest = parts[1:]
            if len(rest) >= 2:
                code = ":".join(rest[1:])
                if f"def {fn}" not in code:
                    if file_path not in files_to_read:
                        files_to_read.append(file_path)

    cache.setdefault("steps_completed", [])
    if "regression-check" not in cache["steps_completed"]:
        cache["steps_completed"].append("regression-check")
    cache["regression_files_to_read"] = files_to_read
    save_cache(cache)

    if overlapping:
        print(f"[forge_analyze --regression-check] {fn} covered by {len(overlapping)} proven section(s)")
        print(f"  Read these files before implementing: {files_to_read}")
    else:
        print(f"[forge_analyze --regression-check] no proven sections overlap with {fn}")
    return 0


def cmd_gemini_check(args) -> int:
    """Detect if Gemini prompts changed in the diff."""
    cache = load_cache()

    diff_text = ""
    diff_file = getattr(args, "diff_file", None)
    if diff_file:
        diff_text = Path(diff_file).read_text(encoding="utf-8")
    else:
        diff_result = subprocess.run(
            ["git", "diff", args.search_dir or "phone-bot", "--", "*.py"],
            capture_output=True, text=True
        )
        diff_text = diff_result.stdout

    # Detect Gemini prompt constant changes or new genai API calls in added lines
    GEMINI_PATTERNS = [r'PROMPT\s*=', r'generate_content', r'genai\.', r'ThinkingConfig']
    prompt_changed = any(
        re.search(rf'^\+.*{pat}', diff_text, re.MULTILINE)
        for pat in GEMINI_PATTERNS
    )

    if prompt_changed:
        # Check that callers have JSON error handling
        caller_files = [c["file"] for c in cache.get("callers", [])]
        missing_fallback = []
        for f in caller_files:
            try:
                content = Path(f).read_text(encoding="utf-8", errors="replace")
                if "json.JSONDecodeError" not in content and "JSONDecodeError" not in content:
                    missing_fallback.append(f)
            except Exception:
                pass
        if missing_fallback:
            print(f"[forge_analyze --gemini-check] WARNING: callers without JSON error fallback: {missing_fallback}")

    cache.setdefault("conditional_steps", [])
    if "gemini-check" not in cache["conditional_steps"]:
        cache["conditional_steps"].append("gemini-check")
    cache["gemini_prompt_changed"] = prompt_changed
    save_cache(cache)

    status = "CHANGED" if prompt_changed else "unchanged"
    print(f"[forge_analyze --gemini-check] Gemini prompt: {status}")
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
    parser.add_argument("--registry", default="forge/forge_registry.json", help="Path to registry file")
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
    elif args.pixel_check:
        return cmd_pixel_check(args)
    elif args.regression_check:
        return cmd_regression_check(args)
    elif args.gemini_check:
        return cmd_gemini_check(args)
    else:
        parser.print_help()
        return 1


if __name__ == "__main__":
    sys.exit(main())
