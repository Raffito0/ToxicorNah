#!/usr/bin/env python3
"""
FORGE v2 — Phase 3 verification CLI.
Run after test completes (after ffmpeg frame extraction).

Usage:
  python forge/forge_verify.py --filter-logs --log tmp_forge_section-07_log.txt
  python forge/forge_verify.py --gemini-analysis --video tmp_forge_section-07.mkv --log forge/.filtered_log.txt
  python forge/forge_verify.py --gemini-analysis --mock
  python forge/forge_verify.py --compare-predictions
  python forge/forge_verify.py --interference-check
  python forge/forge_verify.py --write-emerging [--emerging-file path]
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

_FORGE_DIR = Path(os.environ.get("FORGE_CACHE_DIR", Path(__file__).parent))
VERIFY_CACHE = _FORGE_DIR / ".verify_result.json"
PREDICT_CACHE = _FORGE_DIR / ".predict_cache.json"
FILTERED_LOG = _FORGE_DIR / ".filtered_log.txt"

DEFAULT_EMERGING = Path("phone-bot/planning/06-navigation-completeness/07-bugfix-round/emerging-problems.md")


def load_verify() -> dict:
    if VERIFY_CACHE.exists():
        return json.loads(VERIFY_CACHE.read_text(encoding="utf-8"))
    return {"steps_completed": [], "gemini": {}}


def save_verify(data: dict) -> None:
    VERIFY_CACHE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def cmd_filter_logs(args) -> int:
    log_path = Path(args.log)
    if not log_path.exists():
        print(f"ERROR: log file not found: {log_path}", file=sys.stderr)
        return 1

    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    filtered = [
        l for l in lines
        if ("[INFO]" in l or "[WARNING]" in l) and "PIL." not in l
    ]
    FILTERED_LOG.write_text("\n".join(filtered), encoding="utf-8")

    verify = load_verify()
    verify.setdefault("steps_completed", [])
    if "filter-logs" not in verify["steps_completed"]:
        verify["steps_completed"].append("filter-logs")
    save_verify(verify)

    print(f"[forge_verify --filter-logs] {len(filtered)} lines kept from {len(lines)} total")
    return 0


def cmd_compare_predictions(args) -> int:  # noqa: ARG001
    verify = load_verify()
    predict = {}
    if PREDICT_CACHE.exists():
        predict = json.loads(PREDICT_CACHE.read_text(encoding="utf-8"))

    log_text = FILTERED_LOG.read_text(encoding="utf-8") if FILTERED_LOG.exists() else ""
    gemini = verify.get("gemini", {})

    pass_sig = predict.get("expect_pass_signature", "")
    fail_sig = predict.get("expect_fail_signature", "")

    pass_found = bool(pass_sig) and pass_sig in log_text
    fail_found = bool(fail_sig) and fail_sig in log_text

    # Check recoveries
    predicted_recoveries = set(predict.get("recovery_at_risk", []))
    actual_recoveries = set()
    for ra in gemini.get("recovery_analysis", []):
        for fn in ["_return_to_fyp", "press_back", "nuclear_escape", "tap_nav_home"]:
            if fn in ra.get("reason_in_logs", ""):
                actual_recoveries.add(fn)

    unexpected = actual_recoveries - predicted_recoveries

    verify["pass_signature_found"] = pass_found
    verify["fail_signature_found"] = fail_found
    verify["unexpected_recoveries"] = list(unexpected)
    verify.setdefault("steps_completed", [])
    if "compare-predictions" not in verify["steps_completed"]:
        verify["steps_completed"].append("compare-predictions")
    save_verify(verify)

    print(f"[forge_verify --compare-predictions]")
    print(f"  Pass signature found: {pass_found}")
    print(f"  Fail signature found: {fail_found}")
    if unexpected:
        print(f"  UNEXPECTED recoveries fired: {unexpected} -- diagnosis may be wrong")
    return 0


def cmd_interference_check(args) -> int:  # noqa: ARG001
    verify = load_verify()
    gemini = verify.get("gemini", {})

    anomalies = gemini.get("anomalies_detected", [])
    events = gemini.get("events_analyzed", [])

    # Find the earliest failure event timestamp
    failure_ts = None
    for ev in events:
        if ev.get("correlation") == "mismatch":
            failure_ts = ev.get("timestamp", "99:99:99")
            break

    interference = False
    for anomaly in anomalies:
        severity = anomaly.get("severity", "low")
        category = anomaly.get("category", "")
        a_ts = anomaly.get("video_timestamp", "00:00:00")

        if severity in ("high", "critical") and category in ("popup", "unexpected_screen"):
            # Check if anomaly happened before failure (normalize HH:MM:SS for safe comparison)
            def _ts_seconds(ts: str) -> int:
                parts = ts.split(":")
                try:
                    return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                except (IndexError, ValueError):
                    return 0
            if failure_ts is None or _ts_seconds(a_ts) <= _ts_seconds(failure_ts):
                interference = True
                break

    verify["interference_detected"] = interference
    verify["attempt_should_be_counted"] = not interference
    verify.setdefault("steps_completed", [])
    if "interference-check" not in verify["steps_completed"]:
        verify["steps_completed"].append("interference-check")
    save_verify(verify)

    if interference:
        print("[forge_verify --interference-check] INTERFERENCE DETECTED -- attempt will NOT be counted")
    else:
        print("[forge_verify --interference-check] no interference -- attempt counted normally")
    return 0


def cmd_write_emerging(args) -> int:
    verify = load_verify()
    gemini = verify.get("gemini", {})
    anomalies = gemini.get("anomalies_detected", [])

    ep_path = Path(args.emerging_file) if args.emerging_file else DEFAULT_EMERGING
    new_eps = []

    for anomaly in anomalies:
        if anomaly.get("severity") in ("high", "critical"):
            new_eps.append(anomaly)

    if new_eps and not ep_path.exists():
        print(f"[forge_verify --write-emerging] WARNING: emerging-problems file not found: {ep_path} -- skipping write")
    if new_eps and ep_path.exists():
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with open(ep_path, "a", encoding="utf-8") as f:
            for ep in new_eps:
                f.write(f"\n## EP-AUTO {today}: {ep['description']}\n")
                f.write(f"- **Video timestamp**: {ep['video_timestamp']}\n")
                f.write(f"- **Category**: {ep['category']}\n")
                f.write(f"- **Severity**: {ep['severity']}\n")
                f.write(f"- **Status**: open\n")

    verify["new_emerging_problems"] = [ep["description"] for ep in new_eps]
    verify.setdefault("steps_completed", [])
    if "write-emerging" not in verify["steps_completed"]:
        verify["steps_completed"].append("write-emerging")
    save_verify(verify)

    print(f"[forge_verify --write-emerging] {len(new_eps)} new EP(s) written")
    return 0


def cmd_gemini_analysis(args) -> int:
    """Upload video + logs to Gemini 2.5 Flash + thinking. Requires GEMINI_API_KEY.
    Use --mock to skip Gemini (offline/unit test environments)."""

    if getattr(args, 'mock', False):
        # Write a stub result so the hook can proceed without real video/API
        verify = load_verify()
        verify["gemini"] = {
            "preliminary_verdict": "UNVERIFIED",
            "confidence": 0,
            "flow_summary": "Mock mode -- no video analyzed",
            "anomalies_detected": [],
            "recovery_analysis": [],
            "events_analyzed": [],
            "suspicious_moments": [],
        }
        verify.setdefault("steps_completed", [])
        if "gemini-analysis" not in verify["steps_completed"]:
            verify["steps_completed"].append("gemini-analysis")
        verify["verdict"] = "UNVERIFIED"
        verify["confidence"] = 0
        save_verify(verify)
        print("[forge_verify --gemini-analysis] MOCK MODE -- stub result written. Real verdict required before production PASS.")
        return 0

    try:
        from google import genai  # type: ignore[import-untyped]
        from google.genai import types  # type: ignore[import-untyped]
    except ImportError:
        print("ERROR: google-genai not installed. Run: pip install google-genai", file=sys.stderr)
        return 1

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY not set", file=sys.stderr)
        return 1

    video_path = args.video
    if not video_path:
        print("ERROR: --gemini-analysis requires --video PATH", file=sys.stderr)
        return 1
    log_path = args.log or str(FILTERED_LOG)

    if not Path(video_path).exists():
        print(f"ERROR: video not found: {video_path}", file=sys.stderr)
        return 1

    log_text = Path(log_path).read_text(encoding="utf-8") if Path(log_path).exists() else ""

    client = genai.Client(api_key=api_key)

    print(f"[forge_verify --gemini-analysis] uploading {video_path}...")
    video_file = client.files.upload(file=video_path)
    while video_file.state.name == "PROCESSING":
        print("  processing...")
        time.sleep(3)
        video_file = client.files.get(name=video_file.name)

    if video_file.state.name != "ACTIVE":
        print(f"ERROR: video processing failed: {video_file.state.name}", file=sys.stderr)
        return 1

    prompt = _build_analysis_prompt()

    print(f"[forge_verify --gemini-analysis] calling Gemini 2.5 Flash + thinking...")
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[types.Content(role="user", parts=[
            types.Part.from_uri(file_uri=video_file.uri, mime_type="video/mp4"),
            types.Part.from_text(text=f"## BOT LOGS\n\n```\n{log_text}\n```"),
            types.Part.from_text(text=prompt),
        ])],
        config=types.GenerateContentConfig(
            temperature=0.2,
            max_output_tokens=8000,
            thinking_config=types.ThinkingConfig(thinking_budget=5000),
        ),
    )

    response_text = ""
    for part in response.candidates[0].content.parts:
        if not part.thought:
            response_text += part.text

    # Parse JSON
    clean = response_text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1]
    if clean.endswith("```"):
        clean = clean.rsplit("```", 1)[0]

    try:
        gemini_result = json.loads(clean.strip())
    except json.JSONDecodeError:
        gemini_result = {"preliminary_verdict": "FAIL", "confidence": 0,
                         "parse_error": response_text[:500]}

    verify = load_verify()
    verify["gemini"] = gemini_result
    verify.setdefault("steps_completed", [])
    if "gemini-analysis" not in verify["steps_completed"]:
        verify["steps_completed"].append("gemini-analysis")
    verify["verdict"] = gemini_result.get("preliminary_verdict", "FAIL")
    verify["confidence"] = gemini_result.get("confidence", 0)
    save_verify(verify)

    print(f"[forge_verify --gemini-analysis] verdict={verify['verdict']} confidence={verify['confidence']}")
    return 0


def _build_analysis_prompt() -> str:
    return """You are analyzing a phone automation bot test run on TikTok (Android).

## YOUR TASK
Analyze the video AND logs together. Correlate what you see in the video with the logs.

## REQUIRED OUTPUT FORMAT
Return ONLY valid JSON:
{
  "preliminary_verdict": "PASS" or "FAIL",
  "confidence": 0-100,
  "flow_summary": "2-3 sentences",
  "log_video_correlation": {"quality": "excellent/good/partial/poor", "explanation": "string"},
  "events_analyzed": [{"timestamp": "HH:MM:SS", "video_moment": "string", "log_entry": "string",
                        "video_observation": "string", "correlation": "match/mismatch/unclear", "notes": "string"}],
  "recovery_analysis": [{"timestamp": "string", "reason_in_logs": "string",
                          "video_confirms": true, "assessment": "justified/false_positive/unclear"}],
  "anomalies_detected": [{"video_timestamp": "string", "description": "string",
                           "severity": "critical/high/medium/low", "category": "popup/navigation/ui_glitch/stuck/unexpected_screen/other"}],
  "suspicious_moments": [{"video_timestamp": "string", "reason": "string"}],
  "human_likeness": {"score": 0-100, "robotic_patterns": [], "human_patterns": []},
  "recommendations": []
}"""


def main():
    parser = argparse.ArgumentParser(description="FORGE v2 Phase 3 -- post-test verification")
    parser.add_argument("--filter-logs", action="store_true")
    parser.add_argument("--log", help="Path to raw log file")
    parser.add_argument("--gemini-analysis", action="store_true")
    parser.add_argument("--mock", action="store_true", help="Skip Gemini API (offline/test environments)")
    parser.add_argument("--video", help="Path to .mkv recording")
    parser.add_argument("--compare-predictions", action="store_true")
    parser.add_argument("--interference-check", action="store_true")
    parser.add_argument("--write-emerging", action="store_true")
    parser.add_argument("--emerging-file", help="Path to emerging-problems.md")

    args = parser.parse_args()

    if args.filter_logs:
        return cmd_filter_logs(args)
    if args.gemini_analysis:
        return cmd_gemini_analysis(args)
    if args.compare_predictions:
        return cmd_compare_predictions(args)
    if args.interference_check:
        return cmd_interference_check(args)
    if args.write_emerging:
        return cmd_write_emerging(args)

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
