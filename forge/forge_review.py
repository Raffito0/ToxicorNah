#!/usr/bin/env python3
"""
FORGE code review gate.

Manages forge/.code_review_cache.json — the mechanical enforcement
that blocks progression until code review is completed.

Usage:
    # After editing code, before requesting code review:
    python forge/forge_review.py --record-diff

    # After code-reviewer agent returns approval:
    python forge/forge_review.py --record-complete

    # Check status:
    python forge/forge_review.py --check

    # Clear (after section complete or moving to next item):
    python forge/forge_review.py --clear
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def find_forge_dir() -> Path:
    cwd = Path(os.getcwd())
    for parent in [cwd] + list(cwd.parents):
        candidate = parent / "forge"
        if candidate.is_dir():
            return candidate
    # Fallback: create in cwd
    forge = cwd / "forge"
    forge.mkdir(exist_ok=True)
    return forge


def get_cache_path() -> Path:
    return find_forge_dir() / ".code_review_cache.json"


def load_cache() -> dict:
    path = get_cache_path()
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(data: dict) -> None:
    path = get_cache_path()
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_git_diff() -> str:
    """Get the current phone-bot diff."""
    try:
        result = subprocess.run(
            ["git", "diff", "phone-bot/"],
            capture_output=True, timeout=10,
            cwd=str(find_forge_dir().parent)
        )
        return result.stdout.decode("utf-8", errors="replace").strip()
    except Exception:
        return ""


def record_diff():
    """Record that code has been edited and needs review."""
    diff = get_git_diff()

    if not diff:
        # Also check staged changes
        try:
            result = subprocess.run(
                ["git", "diff", "--cached", "phone-bot/"],
                capture_output=True, timeout=10,
                cwd=str(find_forge_dir().parent)
            )
            diff = result.stdout.decode("utf-8", errors="replace").strip()
        except Exception:
            pass

    cache = {
        "status": "pending_review",
        "diff_recorded_at": datetime.now(timezone.utc).isoformat(),
        "diff_lines": len(diff.splitlines()) if diff else 0,
        "has_diff": bool(diff),
    }
    save_cache(cache)

    if diff:
        print(f"CODE REVIEW GATE: diff recorded ({cache['diff_lines']} lines)")
        print("Next step: spawn superpowers:code-reviewer with the diff")
        print("Then run: python forge/forge_review.py --record-complete")
    else:
        print("CODE REVIEW GATE: no diff found (code already present?)")
        print("Still need code review on existing code.")
        print("Spawn superpowers:code-reviewer on the relevant function")
        print("Then run: python forge/forge_review.py --record-complete")


def record_complete():
    """Record that code review has been completed."""
    cache = load_cache()

    if not cache:
        print("WARNING: no review was pending, but recording completion anyway")

    cache["status"] = "review_complete"
    cache["completed_at"] = datetime.now(timezone.utc).isoformat()
    save_cache(cache)

    print("CODE REVIEW GATE: review completed")
    print("You may now proceed to forge_predict (CATEGORIA A) or import-check (CATEGORIA B)")


def check():
    """Check current code review status."""
    cache = load_cache()

    if not cache:
        print("CODE REVIEW STATUS: no review in progress")
        print("Run: python forge/forge_review.py --record-diff")
        return

    status = cache.get("status", "unknown")
    if status == "pending_review":
        age = ""
        if "diff_recorded_at" in cache:
            try:
                recorded = datetime.fromisoformat(cache["diff_recorded_at"])
                elapsed = (datetime.now(timezone.utc) - recorded).total_seconds()
                age = f" ({int(elapsed)}s ago)"
            except Exception:
                pass
        print(f"CODE REVIEW STATUS: PENDING{age}")
        print(f"  Diff: {cache.get('diff_lines', '?')} lines")
        print("  Action: spawn superpowers:code-reviewer, then --record-complete")
        sys.exit(1)

    elif status == "review_complete":
        print("CODE REVIEW STATUS: COMPLETE")
        print("  You may proceed to next step")
        sys.exit(0)

    else:
        print(f"CODE REVIEW STATUS: {status}")
        sys.exit(1)


def clear():
    """Clear the review cache (after section done or moving to next item)."""
    path = get_cache_path()
    if path.exists():
        path.unlink()
        print("CODE REVIEW GATE: cleared")
    else:
        print("CODE REVIEW GATE: nothing to clear")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="FORGE code review gate")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record-diff", action="store_true",
                       help="Record that code was edited, review needed")
    group.add_argument("--record-complete", action="store_true",
                       help="Record that code review passed")
    group.add_argument("--check", action="store_true",
                       help="Check current review status")
    group.add_argument("--clear", action="store_true",
                       help="Clear review cache (section done)")

    args = parser.parse_args()

    if args.record_diff:
        record_diff()
    elif args.record_complete:
        record_complete()
    elif args.check:
        check()
    elif args.clear:
        clear()


if __name__ == "__main__":
    main()
