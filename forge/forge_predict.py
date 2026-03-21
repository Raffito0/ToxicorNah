#!/usr/bin/env python3
"""
FORGE v2 — Phase 2 prediction CLI.
Run after implementation, before launching scrcpy test.

Usage:
  python forge/forge_predict.py --import-check --module phone_bot.actions.tiktok
  python forge/forge_predict.py --log-signatures [--diff-file path]
  python forge/forge_predict.py --recovery-predict [--diff-file path]
  python forge/forge_predict.py --precondition-verify --section-file path/to/section.md
  python forge/forge_predict.py --test-command --section-file path/to/section.md
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

_FORGE_DIR = Path(os.environ.get("FORGE_CACHE_DIR", Path(__file__).parent))
PREDICT_CACHE = _FORGE_DIR / ".predict_cache.json"

RECOVERY_FNS = ["_return_to_fyp", "press_back", "nuclear_escape", "tap_nav_home"]


def load_cache() -> dict:
    if PREDICT_CACHE.exists():
        return json.loads(PREDICT_CACHE.read_text(encoding="utf-8"))
    return {
        "steps_completed": [],
        "import_check_passed": False,
        "expect_pass_signature": "",
        "expect_fail_signature": "",
        "recovery_at_risk": [],
        "precondition_met": False,
        "precondition_description": "",
        "test_command": "",
    }


def save_cache(data: dict) -> None:
    PREDICT_CACHE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def cmd_import_check(args) -> int:
    cache = load_cache()
    module = args.module or "phone_bot.actions.tiktok"

    result = subprocess.run(
        [sys.executable, "-c", f"import {module}"],
        capture_output=True, text=True
    )
    passed = result.returncode == 0

    cache.setdefault("steps_completed", [])
    if "import-check" not in cache["steps_completed"]:
        cache["steps_completed"].append("import-check")
    cache["import_check_passed"] = passed
    save_cache(cache)

    if passed:
        print(f"[forge_predict --import-check] OK — {module} imports successfully")
    else:
        print(f"[forge_predict --import-check] FAIL — {module}: {result.stderr.strip()}")
        print("Fix the import error before running the test.")
    return 0


def _get_diff_text(args) -> str:
    diff_file = getattr(args, "diff_file", None)
    if diff_file:
        return Path(diff_file).read_text(encoding="utf-8")
    result = subprocess.run(
        ["git", "diff", "phone-bot/"],
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return result.stdout or ""


def cmd_log_signatures(args) -> int:
    cache = load_cache()
    diff_text = _get_diff_text(args)

    # Find added log lines (start with +)
    info_lines = re.findall(r'^\+.*log\.info\(["\'](.+?)["\']\)', diff_text, re.MULTILINE)
    warn_lines = re.findall(r'^\+.*log\.warning\(["\'](.+?)["\']\)', diff_text, re.MULTILINE)

    expect_pass = info_lines[0] if info_lines else "(no log.info found in diff)"
    expect_fail = warn_lines[0] if warn_lines else "(no log.warning found in diff)"

    cache.setdefault("steps_completed", [])
    if "log-signatures" not in cache["steps_completed"]:
        cache["steps_completed"].append("log-signatures")
    cache["expect_pass_signature"] = expect_pass
    cache["expect_fail_signature"] = expect_fail
    save_cache(cache)

    print(f"[forge_predict --log-signatures]")
    print(f"  Expect pass: {expect_pass}")
    print(f"  Expect fail: {expect_fail}")
    return 0


def cmd_recovery_predict(args) -> int:
    cache = load_cache()
    diff_text = _get_diff_text(args)

    at_risk = []
    for fn in RECOVERY_FNS:
        if re.search(rf"\+.*\b{re.escape(fn)}\b", diff_text, re.MULTILINE):
            at_risk.append(fn)

    cache.setdefault("steps_completed", [])
    if "recovery-predict" not in cache["steps_completed"]:
        cache["steps_completed"].append("recovery-predict")
    cache["recovery_at_risk"] = at_risk
    save_cache(cache)

    if at_risk:
        print(f"[forge_predict --recovery-predict] recovery functions at risk: {at_risk}")
    else:
        print(f"[forge_predict --recovery-predict] no recovery calls added in diff")
    return 0


def cmd_precondition_verify(args) -> int:
    cache = load_cache()
    section_file = Path(args.section_file) if args.section_file else None

    precondition_text = ""
    if section_file and section_file.exists():
        content = section_file.read_text(encoding="utf-8")
        match = re.search(r'\*?\*?pre_condition\*?\*?\s*:\s*(.+)', content, re.IGNORECASE)
        if match:
            precondition_text = match.group(1).strip()

    if not precondition_text:
        cache.setdefault("steps_completed", [])
        if "precondition-verify" not in cache["steps_completed"]:
            cache["steps_completed"].append("precondition-verify")
        cache["precondition_met"] = True
        cache["precondition_description"] = "no precondition required"
        save_cache(cache)
        print("[forge_predict --precondition-verify] no precondition defined — OK")
        return 0

    if getattr(args, "skip_adb", False):
        cache.setdefault("steps_completed", [])
        if "precondition-verify" not in cache["steps_completed"]:
            cache["steps_completed"].append("precondition-verify")
        cache["precondition_met"] = True
        cache["precondition_description"] = precondition_text
        save_cache(cache)
        print(f"[forge_predict --precondition-verify] ADB skipped (--skip-adb). Precondition: {precondition_text}")
        return 0

    # Take ADB screenshot
    phone = getattr(args, "phone", "3")
    result = subprocess.run(
        ["adb", "-s", f"phone{phone}", "exec-out", "screencap", "-p"],
        capture_output=True
    )
    if result.returncode != 0:
        print(f"[forge_predict --precondition-verify] WARNING: ADB screenshot failed. "
              f"Assuming precondition met. Manually verify: {precondition_text}")
        cache.setdefault("steps_completed", [])
        if "precondition-verify" not in cache["steps_completed"]:
            cache["steps_completed"].append("precondition-verify")
        cache["precondition_met"] = True
        cache["precondition_description"] = precondition_text + " [NOT VERIFIED — ADB failed]"
        save_cache(cache)
        return 0

    # Save screenshot to temp dir (cross-platform)
    tmp_dir = Path(tempfile.gettempdir())
    tmp_ss = tmp_dir / "forge_precondition.png"
    tmp_ss.write_bytes(result.stdout)

    # Use Gemini Vision to verify
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print(f"[forge_predict --precondition-verify] GEMINI_API_KEY not set. "
              f"Cannot verify. Manually ensure: {precondition_text}")
        cache.setdefault("steps_completed", [])
        if "precondition-verify" not in cache["steps_completed"]:
            cache["steps_completed"].append("precondition-verify")
        cache["precondition_met"] = False
        cache["precondition_description"] = precondition_text + " [NOT VERIFIED — no API key]"
        save_cache(cache)
        return 0

    try:
        from google import genai  # type: ignore[import-untyped]
        from google.genai import types  # type: ignore[import-untyped]
        client = genai.Client(api_key=api_key)
        img_bytes = tmp_ss.read_bytes()
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[types.Content(role="user", parts=[
                types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
                types.Part.from_text(
                    text=f'Is this precondition met? Answer YES or NO and one sentence why.\n'
                         f'Precondition: "{precondition_text}"'
                ),
            ])],
            config=types.GenerateContentConfig(temperature=0.1, max_output_tokens=100),
        )
        answer = (response.text or "").strip().upper()
        met = answer.startswith("YES")
    except Exception as e:
        print(f"[forge_predict --precondition-verify] Gemini error: {e}")
        met = False
        answer = str(e)

    cache.setdefault("steps_completed", [])
    if "precondition-verify" not in cache["steps_completed"]:
        cache["steps_completed"].append("precondition-verify")
    cache["precondition_met"] = met
    cache["precondition_description"] = precondition_text

    if not met:
        print(f"[forge_predict --precondition-verify] PRECONDITION NOT MET")
        print(f"  Required: {precondition_text}")
        print(f"  Navigate to the required state and reply 'ready', then re-run.")
    else:
        print(f"[forge_predict --precondition-verify] OK — {precondition_text}")

    save_cache(cache)
    return 0


def cmd_test_command(args) -> int:
    cache = load_cache()
    section_file = Path(args.section_file) if args.section_file else None
    main_py = Path(args.main_py) if args.main_py else Path("phone-bot/main.py")

    if not section_file or not section_file.exists():
        print(f"ERROR: section file not found: {section_file}", file=sys.stderr)
        return 1

    section_text = section_file.read_text(encoding="utf-8")

    match = re.search(r'--test\s+(\S+)', section_text)
    if not match:
        print("[forge_predict --test-command] no --test mode found in section file")
        test_command = "python phone-bot/main.py --phone 3"
    else:
        mode = match.group(1).rstrip('"')
        if main_py.exists():
            main_text = main_py.read_text(encoding="utf-8")
            if f'"{mode}"' not in main_text and f"'{mode}'" not in main_text:
                print(f"[forge_predict --test-command] WARNING: mode '{mode}' not found in main.py")
        test_command = f"python phone-bot/main.py --test {mode} --phone 3"

    cache.setdefault("steps_completed", [])
    if "test-command" not in cache["steps_completed"]:
        cache["steps_completed"].append("test-command")
    cache["test_command"] = test_command
    save_cache(cache)

    print(f"[forge_predict --test-command] {test_command}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="FORGE v2 Phase 2 — pre-test predictions")
    parser.add_argument("--import-check", action="store_true")
    parser.add_argument("--module", default="phone_bot.actions.tiktok")
    parser.add_argument("--log-signatures", action="store_true")
    parser.add_argument("--diff-file", help="Path to diff file (default: git diff phone-bot/)")
    parser.add_argument("--recovery-predict", action="store_true")
    parser.add_argument("--precondition-verify", action="store_true")
    parser.add_argument("--skip-adb", action="store_true", help="Skip ADB screenshot in unit tests")
    parser.add_argument("--phone", default="3", help="Phone number for ADB (default: 3)")
    parser.add_argument("--test-command", action="store_true")
    parser.add_argument("--section-file", help="Path to section .md file")
    parser.add_argument("--main-py", help="Path to main.py (default: phone-bot/main.py)")

    args = parser.parse_args()

    if args.import_check:
        return cmd_import_check(args)
    if args.log_signatures:
        return cmd_log_signatures(args)
    if args.recovery_predict:
        return cmd_recovery_predict(args)
    if args.precondition_verify:
        return cmd_precondition_verify(args)
    if args.test_command:
        return cmd_test_command(args)

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
