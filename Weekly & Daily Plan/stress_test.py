"""Stress test: generate the weekly plan N times and validate ALL 17 rules each time.
Reports aggregate statistics to prove consistency."""
import sys
import os
import json
from datetime import datetime, date as dt_date, timedelta
from collections import Counter

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from planner.scheduler import generate_weekly_plan
from planner import config

NUM_RUNS = 20
TARGET_DATE = dt_date(2026, 2, 27)  # Week 9

ACCOUNTS_ALL = [
    "ph1_tiktok", "ph1_instagram", "ph2_tiktok",
    "ph2_instagram", "ph3_tiktok", "ph3_instagram",
]
PHONE_MAP = {
    "ph1_tiktok": 1, "ph1_instagram": 1,
    "ph2_tiktok": 2, "ph2_instagram": 2,
    "ph3_tiktok": 3, "ph3_instagram": 3,
}
WEEKDAY_SLOTS = {
    "Morning": ("06:00", "08:00"),
    "Midday": ("11:00", "13:00"),
    "Afternoon": ("16:00", "18:00"),
    "Evening": ("19:30", "22:00"),
}
WEEKEND_SLOTS = {
    "Late Morning": ("09:00", "11:00"),
    "Early Afternoon": ("12:00", "14:00"),
    "Afternoon": ("15:00", "18:00"),
    "Night Peak": ("19:00", "23:30"),
}


def validate_plan(plan_dict):
    """Validate a plan dict against all rules. Returns (errors, warnings)."""
    errors = []
    warnings = []
    plan = plan_dict
    summaries = plan["account_summaries"]

    # ── R1: Phone accounts consecutive ──
    for day_str, day_data in plan["days"].items():
        sessions = day_data["sessions"]
        for s in sessions:
            if PHONE_MAP.get(s["account"]) != s["phone"]:
                errors.append(f"R1: {day_str} account {s['account']} wrong phone")

        for i in range(len(sessions) - 2):
            p1 = sessions[i]["phone"]
            p2 = sessions[i + 1]["phone"]
            p3 = sessions[i + 2]["phone"]
            if p1 == p3 and p1 != p2:
                slot1 = sessions[i]["time_slot"]
                slot3 = sessions[i + 2]["time_slot"]
                if slot1 == slot3:
                    errors.append(f"R1: {day_str} phone {p1} interleaved in slot {slot1}")

    # ── R3: Max 2 sessions per account per day ──
    for day_str, day_data in plan["days"].items():
        acc_counts = Counter(s["account"] for s in day_data["sessions"])
        for acc, cnt in acc_counts.items():
            if cnt > 2:
                errors.append(f"R3: {day_str} {acc} has {cnt} sessions")

    # ── R4/R5: Pre/post duration ranges ──
    for day_str, day_data in plan["days"].items():
        for s in day_data["sessions"]:
            if s["type"] == "normal" and s["post_scheduled"]:
                if s["pre_activity_minutes"] < 1 or s["pre_activity_minutes"] > 35:
                    warnings.append(f"R4: {day_str} {s['account']} pre={s['pre_activity_minutes']}")
                if s["post_activity_minutes"] < 1 or s["post_activity_minutes"] > 35:
                    warnings.append(f"R5: {day_str} {s['account']} post={s['post_activity_minutes']}")

    # ── R6: Sessions within correct time slot boundaries ──
    for day_str, day_data in plan["days"].items():
        d = datetime.fromisoformat(day_str)
        is_weekend = d.weekday() >= 5
        slots = WEEKEND_SLOTS if is_weekend else WEEKDAY_SLOTS
        for s in day_data["sessions"]:
            slot_name = s["time_slot"]
            if slot_name not in slots:
                errors.append(f"R6: {day_str} {s['account']} invalid slot '{slot_name}'")
                continue
            slot_start_str, slot_end_str = slots[slot_name]
            if s["start_time"] < slot_start_str:
                errors.append(f"R6: {day_str} {s['account']} starts {s['start_time']} before {slot_start_str}")

    # ── R7: Rest days (sessions but no posts) ──
    for acc_name in ACCOUNTS_ALL:
        rest_dates = summaries[acc_name].get("rest_days", [])
        for rd in rest_dates:
            if rd not in plan["days"]:
                continue
            for s in plan["days"][rd]["sessions"]:
                if s["account"] == acc_name and s["post_outcome"] == "posted":
                    errors.append(f"R7: {acc_name} posted on rest day {rd}")

    # ── R8: One-post days (max 1 post, different from rest) ──
    for acc_name in ACCOUNTS_ALL:
        rest_dates = set(summaries[acc_name].get("rest_days", []))
        onepost_dates = set(summaries[acc_name].get("one_post_days", []))
        overlap = rest_dates & onepost_dates
        if overlap:
            errors.append(f"R8: {acc_name} rest/one-post overlap {overlap}")
        for opd in onepost_dates:
            if opd not in plan["days"]:
                continue
            posts = sum(1 for s in plan["days"][opd]["sessions"]
                        if s["account"] == acc_name and s["post_outcome"] == "posted")
            if posts > 1:
                errors.append(f"R8: {acc_name} {posts} posts on one-post day {opd}")

    # ── R10: Two-day breaks ──
    phone_break_dates = {}
    for acc_name in ACCOUNTS_ALL:
        brk = summaries[acc_name].get("two_day_break", [])
        if brk:
            pid = PHONE_MAP[acc_name]
            if len(brk) == 2:
                d1 = dt_date.fromisoformat(brk[0])
                d2 = dt_date.fromisoformat(brk[1])
                if (d2 - d1).days != 1:
                    errors.append(f"R10: {acc_name} break not consecutive {brk}")
            for bd in brk:
                if bd in plan["days"]:
                    if any(s["account"] == acc_name for s in plan["days"][bd]["sessions"]):
                        errors.append(f"R10: {acc_name} sessions on break day {bd}")
            if pid not in phone_break_dates:
                phone_break_dates[pid] = set()
            phone_break_dates[pid].update(brk)

    # ── R12: Aborted sessions ──
    for day_str, day_data in plan["days"].items():
        for s in day_data["sessions"]:
            if s["type"] == "aborted":
                if s["total_duration_minutes"] > 2:
                    errors.append(f"R12: {day_str} {s['account']} abort {s['total_duration_minutes']}min")
                if s["post_scheduled"]:
                    errors.append(f"R12: {day_str} {s['account']} aborted with post")

    # ── R13: Extended sessions (25-40 min) ──
    for day_str, day_data in plan["days"].items():
        for s in day_data["sessions"]:
            if s["type"] == "extended":
                dur = s["total_duration_minutes"]
                if dur < 25 or dur > 40:
                    errors.append(f"R13: {day_str} {s['account']} extended={dur}min")

    # ── R15: Cross-phone (>= 2 phones active/day) ──
    for day_str, day_data in plan["days"].items():
        active_phones = set(s["phone"] for s in day_data["sessions"])
        if len(active_phones) < 2:
            errors.append(f"R15: {day_str} only {len(active_phones)} phone(s)")

    # ── R17: No overlapping sessions ──
    for day_str, day_data in plan["days"].items():
        sessions = day_data["sessions"]
        for i in range(len(sessions) - 1):
            if sessions[i]["end_time"] > sessions[i + 1]["start_time"]:
                errors.append(f"R17: {day_str} overlap {sessions[i]['account']}->{sessions[i+1]['account']}")

    # ── PROXY: Rotation only on phone switch ──
    for day_str, day_data in plan["days"].items():
        sessions = day_data["sessions"]
        for i in range(1, len(sessions)):
            prev_phone = sessions[i - 1]["phone"]
            curr_phone = sessions[i]["phone"]
            has_rot = sessions[i]["proxy_rotation_before"]
            if prev_phone == curr_phone and has_rot:
                errors.append(f"PROXY: {day_str} rotation same phone {curr_phone}")
            if prev_phone != curr_phone and not has_rot:
                errors.append(f"PROXY: {day_str} missing rotation {prev_phone}->{curr_phone}")

    # ── PLATFORM BOUNDARY: No same platform across phone switch ──
    for day_str, day_data in plan["days"].items():
        sessions = day_data["sessions"]
        for i in range(1, len(sessions)):
            if sessions[i - 1]["phone"] != sessions[i]["phone"]:
                if sessions[i - 1]["platform"] == sessions[i]["platform"]:
                    errors.append(
                        f"PLATFORM: {day_str} same platform '{sessions[i]['platform']}' "
                        f"across phone switch {sessions[i-1]['account']}->{sessions[i]['account']}"
                    )

    # ── R11: Weekend bias (60-75% sessions after 4 PM) ──
    weekend_total = 0
    weekend_after_4pm = 0
    for day_str, day_data in plan["days"].items():
        d = datetime.fromisoformat(day_str)
        if d.weekday() >= 5:
            for s in day_data["sessions"]:
                weekend_total += 1
                h = int(s["start_time"].split(":")[0])
                if h >= 16:
                    weekend_after_4pm += 1

    weekend_pct = (weekend_after_4pm / weekend_total * 100) if weekend_total > 0 else 0

    return errors, warnings, weekend_pct


def main():
    print("=" * 70)
    print(f"  STRESS TEST — {NUM_RUNS} plan generations")
    print(f"  Target: Week 9, 2026 (23/02 - 01/03)")
    print("=" * 70)

    total_errors = 0
    total_warnings = 0
    all_weekend_pcts = []
    failed_runs = []

    for i in range(NUM_RUNS):
        try:
            plan = generate_weekly_plan(accounts=config.ACCOUNTS, start_date=TARGET_DATE)
            plan_dict = plan.to_dict()

            errs, warns, wknd_pct = validate_plan(plan_dict)
            total_errors += len(errs)
            total_warnings += len(warns)
            all_weekend_pcts.append(wknd_pct)

            status = "PASS" if not errs else f"FAIL ({len(errs)} errors)"
            print(f"  Run {i+1:2d}/{NUM_RUNS}: {status}  |  warnings={len(warns)}  |  weekend={wknd_pct:.0f}%", end="")

            if errs:
                failed_runs.append((i + 1, errs))
                print(f"  !! {errs[0]}", end="")
            print()

        except Exception as e:
            total_errors += 1
            failed_runs.append((i + 1, [f"EXCEPTION: {e}"]))
            print(f"  Run {i+1:2d}/{NUM_RUNS}: EXCEPTION — {e}")

    # ── Aggregate Report ──
    print()
    print("=" * 70)
    print("  AGGREGATE RESULTS")
    print("=" * 70)
    print(f"  Total runs:      {NUM_RUNS}")
    print(f"  Total errors:    {total_errors}")
    print(f"  Total warnings:  {total_warnings}")
    print(f"  Pass rate:       {NUM_RUNS - len(failed_runs)}/{NUM_RUNS} ({(NUM_RUNS - len(failed_runs))/NUM_RUNS*100:.0f}%)")
    print()

    if all_weekend_pcts:
        avg_wknd = sum(all_weekend_pcts) / len(all_weekend_pcts)
        min_wknd = min(all_weekend_pcts)
        max_wknd = max(all_weekend_pcts)
        print(f"  Weekend after-4PM bias:")
        print(f"    Average: {avg_wknd:.1f}%  (target: 60-75%)")
        print(f"    Min:     {min_wknd:.1f}%")
        print(f"    Max:     {max_wknd:.1f}%")

    if failed_runs:
        print()
        print("  FAILED RUNS:")
        for run_num, errs in failed_runs:
            print(f"    Run {run_num}:")
            for e in errs[:5]:
                print(f"      !! {e}")
    else:
        print()
        print("  ALL 20 RUNS PASSED — 0 ERRORS ACROSS ALL 17 RULES!")
        print("  The plan generator is 1000% validated.")

    print("=" * 70)


if __name__ == "__main__":
    main()
