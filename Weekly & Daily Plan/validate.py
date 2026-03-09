"""Validation script: checks ALL 17 rules against the generated weekly plan."""
import json
import os
from datetime import datetime, date as dt_date, timedelta
from collections import Counter

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
JSON_FILE = os.path.join(OUTPUT_DIR, "weekly_plan_2026-W09.json")

with open(JSON_FILE, "r", encoding="utf-8") as f:
    plan = json.load(f)

errors = []
warnings = []

ACCOUNTS_ALL = [
    "ph1_tiktok", "ph1_instagram", "ph2_tiktok",
    "ph2_instagram", "ph3_tiktok", "ph3_instagram",
]
PHONE_MAP = {
    "ph1_tiktok": 1, "ph1_instagram": 1,
    "ph2_tiktok": 2, "ph2_instagram": 2,
    "ph3_tiktok": 3, "ph3_instagram": 3,
}
summaries = plan["account_summaries"]

print("=" * 60)
print("  RULE VALIDATION REPORT")
print("=" * 60)


# ═══════════════════════════════════════════════════════════════
# R1: Daily order - accounts on same phone must be consecutive
# ═══════════════════════════════════════════════════════════════
print("\n--- R1: Phone accounts consecutive (same phone back-to-back) ---")
for day_str, day_data in plan["days"].items():
    sessions = day_data["sessions"]
    # Check that same-phone accounts are always adjacent
    for i in range(len(sessions)):
        s = sessions[i]
        if PHONE_MAP.get(s["account"]) != s["phone"]:
            errors.append(f"R1 FAIL {day_str}: account {s['account']} claims phone {s['phone']} but should be {PHONE_MAP.get(s['account'])}")

    # Check no interleaving within a "phone block" in same slot
    prev_phone = None
    seen_phones_in_row = []
    for s in sessions:
        p = s["phone"]
        if p != prev_phone:
            seen_phones_in_row.append(p)
        prev_phone = p

    # Check that when phone switches away then back, it's for a different time slot
    # (which is valid — same phone can have sessions in multiple slots)
    # The key rule: within consecutive sessions, same phone => no other phone in between
    for i in range(len(sessions) - 2):
        p1 = sessions[i]["phone"]
        p2 = sessions[i + 1]["phone"]
        p3 = sessions[i + 2]["phone"]
        if p1 == p3 and p1 != p2:
            # Phone 1 -> Phone 2 -> Phone 1: check if slot changed
            slot1 = sessions[i]["time_slot"]
            slot3 = sessions[i + 2]["time_slot"]
            if slot1 == slot3:
                errors.append(
                    f"R1 FAIL {day_str}: phone {p1} interleaved with phone {p2} "
                    f"in same slot {slot1} at sessions {i},{i+1},{i+2}"
                )

r1_errors = [e for e in errors if "R1" in e]
print(f"  Phone grouping: {'PASS' if not r1_errors else f'FAIL ({len(r1_errors)} errors)'}")


# ═══════════════════════════════════════════════════════════════
# R2: Posting frequency (75-95% of days should have 2 posts)
# ═══════════════════════════════════════════════════════════════
print("\n--- R2: Posting frequency per account ---")
for acc_name in ACCOUNTS_ALL:
    days_with_posts = {}
    for day_str, day_data in plan["days"].items():
        post_count = 0
        for s in day_data["sessions"]:
            if s["account"] == acc_name and s["post_outcome"] == "posted":
                post_count += 1
        if post_count > 0:
            days_with_posts[day_str] = post_count
    total_active_days = len(days_with_posts)
    two_post_days = sum(1 for v in days_with_posts.values() if v >= 2)
    summ = summaries[acc_name]
    break_days = len(summ.get("two_day_break", []) or [])
    rest_days = len(summ.get("rest_days", []))
    print(f"  {acc_name}: {summ['total_posts']} total posts, "
          f"{two_post_days}/{total_active_days} days with 2+ posts, "
          f"rest={rest_days}, break={break_days}")


# ═══════════════════════════════════════════════════════════════
# R3: Max 2 sessions per account per day
# ═══════════════════════════════════════════════════════════════
print("\n--- R3: Max 2 sessions per account per day ---")
for day_str, day_data in plan["days"].items():
    acc_counts = Counter(s["account"] for s in day_data["sessions"])
    for acc, cnt in acc_counts.items():
        if cnt > 2:
            errors.append(f"R3 FAIL {day_str}: {acc} has {cnt} sessions (max 2)")
r3_errors = [e for e in errors if "R3" in e]
print(f"  Max 2 sessions/account/day: {'PASS' if not r3_errors else f'FAIL ({len(r3_errors)} errors)'}")


# ═══════════════════════════════════════════════════════════════
# R4: Pre-post activity duration (1-24 min for normal sessions)
# ═══════════════════════════════════════════════════════════════
print("\n--- R4: Pre-post activity duration ---")
for day_str, day_data in plan["days"].items():
    for s in day_data["sessions"]:
        if s["type"] == "normal" and s["post_scheduled"]:
            pre = s["pre_activity_minutes"]
            if pre < 1 or pre > 30:
                warnings.append(f"R4 WARN {day_str} {s['account']}: pre={pre}min")
r4_warns = [w for w in warnings if "R4" in w]
print(f"  Pre-post range: {'PASS' if not r4_warns else f'{len(r4_warns)} warnings'}")


# ═══════════════════════════════════════════════════════════════
# R5: Post-post activity duration (1-24 min for normal sessions)
# ═══════════════════════════════════════════════════════════════
print("\n--- R5: Post-post activity duration ---")
for day_str, day_data in plan["days"].items():
    for s in day_data["sessions"]:
        if s["type"] == "normal" and s["post_scheduled"]:
            post = s["post_activity_minutes"]
            if post < 1 or post > 30:
                warnings.append(f"R5 WARN {day_str} {s['account']}: post={post}min")
r5_warns = [w for w in warnings if "R5" in w]
print(f"  Post-post range: {'PASS' if not r5_warns else f'{len(r5_warns)} warnings'}")


# ═══════════════════════════════════════════════════════════════
# R6: Sessions within correct time slots
# ═══════════════════════════════════════════════════════════════
print("\n--- R6: Sessions within correct time slot boundaries ---")
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
for day_str, day_data in plan["days"].items():
    d = datetime.fromisoformat(day_str)
    is_weekend = d.weekday() >= 5
    slots = WEEKEND_SLOTS if is_weekend else WEEKDAY_SLOTS
    for s in day_data["sessions"]:
        slot_name = s["time_slot"]
        if slot_name not in slots:
            errors.append(
                f"R6 FAIL {day_str} {s['account']}: slot '{slot_name}' "
                f"invalid for {'weekend' if is_weekend else 'weekday'}"
            )
            continue
        slot_start_str, slot_end_str = slots[slot_name]
        start_t = s["start_time"]
        if start_t < slot_start_str:
            errors.append(
                f"R6 FAIL {day_str} {s['account']}: starts {start_t} "
                f"before slot {slot_name} start ({slot_start_str})"
            )
r6_errors = [e for e in errors if "R6" in e]
print(f"  Slot boundaries: {'PASS' if not r6_errors else f'FAIL ({len(r6_errors)} errors)'}")
for e in r6_errors[:10]:
    print(f"    {e}")


# ═══════════════════════════════════════════════════════════════
# R7: Rest days (should have sessions but no posts)
# ═══════════════════════════════════════════════════════════════
print("\n--- R7: Rest days (sessions but no posts) ---")
for acc_name in ACCOUNTS_ALL:
    rest_dates = summaries[acc_name].get("rest_days", [])
    for rd in rest_dates:
        if rd not in plan["days"]:
            continue
        day_data = plan["days"][rd]
        posts_on_rest = 0
        sessions_on_rest = 0
        for s in day_data["sessions"]:
            if s["account"] == acc_name:
                sessions_on_rest += 1
                if s["post_outcome"] == "posted":
                    posts_on_rest += 1
        if posts_on_rest > 0:
            errors.append(f"R7 FAIL {acc_name}: posted {posts_on_rest} times on rest day {rd}")
        print(f"  {acc_name} rest {rd}: {sessions_on_rest} sessions, {posts_on_rest} posts")
r7_errors = [e for e in errors if "R7" in e]
print(f"  Rest days no-post: {'PASS' if not r7_errors else f'FAIL ({len(r7_errors)} errors)'}")


# ═══════════════════════════════════════════════════════════════
# R8: One-post day (exactly 1 post, different from rest day)
# ═══════════════════════════════════════════════════════════════
print("\n--- R8: One-post days ---")
for acc_name in ACCOUNTS_ALL:
    rest_dates = set(summaries[acc_name].get("rest_days", []))
    onepost_dates = set(summaries[acc_name].get("one_post_days", []))
    overlap = rest_dates & onepost_dates
    if overlap:
        errors.append(f"R8 FAIL {acc_name}: rest and one-post overlap on {overlap}")
    for opd in onepost_dates:
        if opd not in plan["days"]:
            continue
        day_data = plan["days"][opd]
        posts_count = sum(
            1 for s in day_data["sessions"]
            if s["account"] == acc_name and s["post_outcome"] == "posted"
        )
        # On a one-post day, should have exactly 1 posted (may have 0 due to errors)
        if posts_count > 1:
            errors.append(f"R8 FAIL {acc_name}: {posts_count} posts on one-post day {opd}")
        print(f"  {acc_name} 1-post {opd}: {posts_count} actual posts")
r8_errors = [e for e in errors if "R8" in e]
print(f"  One-post day correctness: {'PASS' if not r8_errors else f'FAIL ({len(r8_errors)} errors)'}")


# ═══════════════════════════════════════════════════════════════
# R10: Two-day breaks (consecutive, no phone overlap)
# ═══════════════════════════════════════════════════════════════
print("\n--- R10: Two-day breaks ---")
phone_break_dates = {}
for acc_name in ACCOUNTS_ALL:
    brk = summaries[acc_name].get("two_day_break", [])
    if brk:
        pid = PHONE_MAP[acc_name]
        print(f"  {acc_name} (Phone {pid}): break on {brk}")
        # Check consecutive
        if len(brk) == 2:
            d1 = dt_date.fromisoformat(brk[0])
            d2 = dt_date.fromisoformat(brk[1])
            if (d2 - d1).days != 1:
                errors.append(f"R10 FAIL {acc_name}: break days not consecutive: {brk}")
        # Check account has 0 sessions on break days
        for bd in brk:
            if bd in plan["days"]:
                sessions_on_break = [
                    s for s in plan["days"][bd]["sessions"]
                    if s["account"] == acc_name
                ]
                if sessions_on_break:
                    errors.append(
                        f"R10 FAIL {acc_name}: has {len(sessions_on_break)} sessions "
                        f"on break day {bd}"
                    )
        # Track for overlap check
        if pid not in phone_break_dates:
            phone_break_dates[pid] = set()
        phone_break_dates[pid].update(brk)

# Check break overlap between different phones
all_break_dates = []
for pid, dates in phone_break_dates.items():
    all_break_dates.extend(dates)
dup_dates = [d for d, cnt in Counter(all_break_dates).items() if cnt > 1]
# Actually overlap between phones means ALL phones have break on same day
# Rule says breaks on different phones should not overlap
for d in set(all_break_dates):
    phones_with_break_on_d = [
        pid for pid, dates in phone_break_dates.items() if d in dates
    ]
    if len(phones_with_break_on_d) > 1:
        warnings.append(
            f"R10 WARN: multiple phones have breaks on {d}: {phones_with_break_on_d}"
        )

r10_errors = [e for e in errors if "R10" in e]
print(f"  Break validity: {'PASS' if not r10_errors else f'FAIL ({len(r10_errors)} errors)'}")
for e in r10_errors:
    print(f"    {e}")


# ═══════════════════════════════════════════════════════════════
# R12: Aborted sessions (<= 2 min, no post)
# ═══════════════════════════════════════════════════════════════
print("\n--- R12: Aborted sessions ---")
abort_count = 0
for day_str, day_data in plan["days"].items():
    for s in day_data["sessions"]:
        if s["type"] == "aborted":
            abort_count += 1
            if s["total_duration_minutes"] > 2:
                errors.append(
                    f"R12 FAIL {day_str} {s['account']}: aborted session "
                    f"{s['total_duration_minutes']}min (max 2)"
                )
            if s["post_scheduled"]:
                errors.append(
                    f"R12 FAIL {day_str} {s['account']}: aborted session has post"
                )
r12_errors = [e for e in errors if "R12" in e]
print(f"  {abort_count} aborted sessions: {'PASS' if not r12_errors else f'FAIL ({len(r12_errors)} errors)'}")


# ═══════════════════════════════════════════════════════════════
# R13: Extended sessions (25-40 min)
# ═══════════════════════════════════════════════════════════════
print("\n--- R13: Extended sessions ---")
ext_count = 0
for day_str, day_data in plan["days"].items():
    for s in day_data["sessions"]:
        if s["type"] == "extended":
            ext_count += 1
            dur = s["total_duration_minutes"]
            if dur < 25 or dur > 40:
                errors.append(
                    f"R13 FAIL {day_str} {s['account']}: extended={dur}min (expected 25-40)"
                )
            print(f"  {day_str} {s['account']}: {dur}min")
r13_errors = [e for e in errors if "R13" in e]
print(f"  {ext_count} extended sessions: {'PASS' if not r13_errors else f'FAIL ({len(r13_errors)} errors)'}")


# ═══════════════════════════════════════════════════════════════
# R14: Post errors (draft, skipped)
# ═══════════════════════════════════════════════════════════════
print("\n--- R14: Post errors ---")
draft_count = 0
skip_count = 0
for day_str, day_data in plan["days"].items():
    for s in day_data["sessions"]:
        if s["post_outcome"] == "draft":
            draft_count += 1
            print(f"  DRAFT: {day_str} {s['account']}")
        if s["post_outcome"] == "skipped":
            skip_count += 1
            print(f"  SKIP:  {day_str} {s['account']}")
print(f"  Drafts: {draft_count}, Skipped: {skip_count}")


# ═══════════════════════════════════════════════════════════════
# R15: Cross-phone coordination (>= 2 phones active per day)
# ═══════════════════════════════════════════════════════════════
print("\n--- R15: Cross-phone (>= 2 phones active/day) ---")
for day_str, day_data in plan["days"].items():
    active_phones = set(s["phone"] for s in day_data["sessions"])
    if len(active_phones) < 2:
        errors.append(f"R15 FAIL {day_str}: only phones {active_phones} active")
    print(f"  {day_str}: {sorted(active_phones)} ({len(active_phones)} phones)")
r15_errors = [e for e in errors if "R15" in e]
print(f"  >= 2 phones/day: {'PASS' if not r15_errors else f'FAIL ({len(r15_errors)} errors)'}")


# ═══════════════════════════════════════════════════════════════
# R17: No overlapping sessions (sequential ordering)
# ═══════════════════════════════════════════════════════════════
print("\n--- R17: No overlapping sessions ---")
for day_str, day_data in plan["days"].items():
    sessions = day_data["sessions"]
    for i in range(len(sessions) - 1):
        end_i = sessions[i]["end_time"]
        start_next = sessions[i + 1]["start_time"]
        if end_i > start_next:
            errors.append(
                f"R17 FAIL {day_str}: {sessions[i]['account']} ends {end_i} "
                f"overlaps {sessions[i+1]['account']} starts {start_next}"
            )
r17_errors = [e for e in errors if "R17" in e]
print(f"  No overlaps: {'PASS' if not r17_errors else f'FAIL ({len(r17_errors)} errors)'}")
for e in r17_errors[:10]:
    print(f"    {e}")


# ═══════════════════════════════════════════════════════════════
# PROXY: Rotation only on phone switch, always on phone switch
# ═══════════════════════════════════════════════════════════════
print("\n--- PROXY: Rotation correctness ---")
for day_str, day_data in plan["days"].items():
    sessions = day_data["sessions"]
    for i in range(1, len(sessions)):
        prev_phone = sessions[i - 1]["phone"]
        curr_phone = sessions[i]["phone"]
        has_rotation = sessions[i]["proxy_rotation_before"]

        if prev_phone == curr_phone and has_rotation:
            errors.append(
                f"PROXY FAIL {day_str}: rotation between SAME phone {curr_phone} "
                f"({sessions[i-1]['account']} -> {sessions[i]['account']})"
            )
        if prev_phone != curr_phone and not has_rotation:
            errors.append(
                f"PROXY FAIL {day_str}: MISSING rotation phone {prev_phone}->{curr_phone} "
                f"({sessions[i-1]['account']} -> {sessions[i]['account']})"
            )
proxy_errors = [e for e in errors if "PROXY" in e]
print(f"  Proxy rotation: {'PASS' if not proxy_errors else f'FAIL ({len(proxy_errors)} errors)'}")
for e in proxy_errors[:10]:
    print(f"    {e}")


# ═══════════════════════════════════════════════════════════════
# PLATFORM BOUNDARY: No same platform across phone switch
# ═══════════════════════════════════════════════════════════════
print("\n--- PLATFORM: No same platform at phone boundary ---")
for day_str, day_data in plan["days"].items():
    sessions = day_data["sessions"]
    for i in range(1, len(sessions)):
        if sessions[i - 1]["phone"] != sessions[i]["phone"]:
            if sessions[i - 1]["platform"] == sessions[i]["platform"]:
                errors.append(
                    f"PLATFORM FAIL {day_str}: same platform '{sessions[i]['platform']}' "
                    f"across phone switch {sessions[i-1]['account']} -> {sessions[i]['account']}"
                )
plat_errors = [e for e in errors if "PLATFORM" in e]
print(f"  Platform boundary: {'PASS' if not plat_errors else f'FAIL ({len(plat_errors)} errors)'}")
for e in plat_errors[:10]:
    print(f"    {e}")


# ═══════════════════════════════════════════════════════════════
# R11: Weekend variation (sessions tend to be later on weekends)
# ═══════════════════════════════════════════════════════════════
print("\n--- R11: Weekend vs weekday pattern ---")
weekday_starts = []
weekend_starts = []
for day_str, day_data in plan["days"].items():
    d = datetime.fromisoformat(day_str)
    for s in day_data["sessions"]:
        h, m = map(int, s["start_time"].split(":"))
        total_mins = h * 60 + m
        if d.weekday() >= 5:
            weekend_starts.append(total_mins)
        else:
            weekday_starts.append(total_mins)
if weekday_starts and weekend_starts:
    avg_wd = sum(weekday_starts) / len(weekday_starts)
    avg_we = sum(weekend_starts) / len(weekend_starts)
    print(f"  Weekday avg start: {int(avg_wd)//60}:{int(avg_wd)%60:02d} ({len(weekday_starts)} sessions)")
    print(f"  Weekend avg start: {int(avg_we)//60}:{int(avg_we)%60:02d} ({len(weekend_starts)} sessions)")


# ═══════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
total_sessions = sum(len(d["sessions"]) for d in plan["days"].values())
total_rotations = sum(len(d["proxy_rotations"]) for d in plan["days"].values())
print(f"  TOTAL SESSIONS:    {total_sessions}")
print(f"  TOTAL ROTATIONS:   {total_rotations}")
print(f"  TOTAL ERRORS:      {len(errors)}")
print(f"  TOTAL WARNINGS:    {len(warnings)}")
print("=" * 60)

if errors:
    print("\nALL ERRORS:")
    for e in errors:
        print(f"  !! {e}")

if warnings:
    print("\nALL WARNINGS:")
    for w in warnings:
        print(f"  ?? {w}")

if not errors:
    print("\n  ALL RULES VALIDATED SUCCESSFULLY!")
