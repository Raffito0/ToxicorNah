"""Main scheduling engine — orchestrates all rules to generate plans."""
import random
from datetime import date, time, timedelta

from . import config
from .models import Session, ProxyRotation, DailyPlan, WeeklyPlan, AccountWeekSummary
from .personality import load_state, save_state, initialize_all_accounts, get_account_state
from . import rules_engine as rules


def _minutes_to_time(total_minutes):
    """Convert total minutes from midnight to a time object."""
    total_minutes = max(0, min(total_minutes, 23 * 60 + 59))
    h = int(total_minutes) // 60
    m = int(total_minutes) % 60
    return time(h, m)


def _get_week_dates(start_date):
    """Get Mon-Sun dates for the week containing start_date."""
    monday = start_date - timedelta(days=start_date.weekday())
    return [monday + timedelta(days=i) for i in range(7)]


# ─── Weekly Plan: Assign Special Days ────────────────────────────────────────
def _assign_weekly_special_days(state, week_dates):
    """Assign rest days, one-post days, and two-day breaks for the week.
    Returns dict: {account_name: {rest_day: date|None, one_post_day: date|None,
                                   two_day_break: [date, date]|None}}"""
    weekly_assignments = {}
    phone_breaks = {}  # phone_id -> list of (account_name, d1, d2)

    for acc in config.ACCOUNTS:
        acc_state = get_account_state(state, acc["name"])
        personality = acc_state["personality"]
        assignment = {"rest_day": None, "one_post_day": None,
                      "two_day_break": None, "rest_weekday": None, "one_post_weekday": None}

        # R7 + R9: Rest day
        if rules.should_have_rest_day(personality):
            last_rwd = acc_state.get("last_rest_day_weekday")
            rest_date, rest_wd = rules.pick_rest_day(week_dates, last_rwd)
            assignment["rest_day"] = rest_date
            assignment["rest_weekday"] = rest_wd
        else:
            rest_wd = None
            assignment["rest_weekday"] = None

        # R8 + R9: One-post day
        last_opwd = acc_state.get("last_one_post_day_weekday")
        if assignment["rest_weekday"] is not None:
            op_date, op_wd = rules.pick_one_post_day(
                week_dates, assignment["rest_weekday"], last_opwd)
        else:
            op_date, op_wd = rules.pick_one_post_day(week_dates, -1, last_opwd)
        assignment["one_post_day"] = op_date
        assignment["one_post_weekday"] = op_wd

        weekly_assignments[acc["name"]] = assignment

    # R10: Two-day breaks (per phone)
    for phone_id in config.PHONES:
        phone_accs = [a for a in config.ACCOUNTS if a["phone_id"] == phone_id]
        # Check if any account on this phone needs a break
        needs_break = False
        for pa in phone_accs:
            acc_state = get_account_state(state, pa["name"])
            if rules.should_start_two_day_break(acc_state, week_dates[0]):
                needs_break = True
                break

        if needs_break:
            result = rules.assign_two_day_break(phone_id, week_dates, state, phone_breaks)
            if result:
                acc_name, d1, d2 = result
                if phone_id not in phone_breaks:
                    phone_breaks[phone_id] = []
                phone_breaks[phone_id].append(result)
                weekly_assignments[acc_name]["two_day_break"] = [d1, d2]

    # R15: Validate cross-phone — ensure at least 2 phones active each day
    for day_date in week_dates:
        activity = {}
        for acc in config.ACCOUNTS:
            name = acc["name"]
            asgn = weekly_assignments[name]
            is_active = True
            if asgn["rest_day"] == day_date:
                is_active = True  # rest day still has sessions (just no posts)
            if asgn["two_day_break"] and day_date in asgn["two_day_break"]:
                is_active = False
            activity[name] = is_active

        if not rules.validate_cross_phone(day_date, activity):
            # Fix: remove one two-day break that causes the conflict
            for acc_name, asgn in weekly_assignments.items():
                if asgn["two_day_break"] and day_date in asgn["two_day_break"]:
                    asgn["two_day_break"] = None
                    break

    return weekly_assignments, phone_breaks


# ─── Daily Plan: Generate Sessions ───────────────────────────────────────────
def _build_session(account, personality, session_num, has_post, is_rest_day,
                   slot, is_weekend, account_state, force_abort=False):
    """Build a single Session object with all rule-based randomness."""
    # R12: Aborted session?
    if force_abort:
        duration = rules.aborted_session_duration()
        return {
            "account_name": account["name"],
            "phone_id": account["phone_id"],
            "platform": account["platform"],
            "session_number": session_num,
            "session_type": "aborted",
            "post_scheduled": False,
            "post_outcome": None,
            "pre_activity_minutes": round(duration),
            "post_activity_minutes": 0,
            "total_duration_minutes": max(1, round(duration)),
            "slot": slot,
        }

    # R13: Extended session?
    if rules.maybe_extend_session(account_state):
        duration = rules.extended_session_duration()
        account_state["extended_session_used_this_week"] = True
        return {
            "account_name": account["name"],
            "phone_id": account["phone_id"],
            "platform": account["platform"],
            "session_number": session_num,
            "session_type": "extended",
            "post_scheduled": has_post,
            "post_outcome": rules.apply_post_error(personality) if has_post else None,
            "pre_activity_minutes": duration,
            "post_activity_minutes": 0,
            "total_duration_minutes": duration,
            "slot": slot,
        }

    # Normal or rest-only session
    weekend_bias = rules.apply_weekend_session_bias(personality, is_weekend)

    if is_rest_day or not has_post:
        # Rest or no-post session: just scrolling
        duration = rules.rest_only_session_duration()
        duration = max(1, round(duration * weekend_bias))
        return {
            "account_name": account["name"],
            "phone_id": account["phone_id"],
            "platform": account["platform"],
            "session_number": session_num,
            "session_type": "rest_only",
            "post_scheduled": False,
            "post_outcome": None,
            "pre_activity_minutes": duration,
            "post_activity_minutes": 0,
            "total_duration_minutes": duration,
            "slot": slot,
        }

    # Normal session with post
    pre_mins = rules.generate_pre_post_duration(personality)
    post_mins = rules.generate_post_post_duration(personality)
    pre_mins = max(1, round(pre_mins * weekend_bias))
    post_mins = max(1, round(post_mins * weekend_bias))
    post_outcome = rules.apply_post_error(personality)

    return {
        "account_name": account["name"],
        "phone_id": account["phone_id"],
        "platform": account["platform"],
        "session_number": session_num,
        "session_type": "normal",
        "post_scheduled": True,
        "post_outcome": post_outcome,
        "pre_activity_minutes": pre_mins,
        "post_activity_minutes": post_mins,
        "total_duration_minutes": pre_mins + post_mins + 1,  # +1 for post action
        "slot": slot,
    }


def generate_daily_plan(day_date, state, weekly_assignments):
    """Generate a complete daily plan for the given date.

    Key design: sessions are organized in PHONE BLOCKS. Both accounts of the
    same phone always run consecutively. Each phone block is assigned to a
    single time slot. If a phone has a second round of sessions, that round
    goes to a different slot.
    """
    is_weekend = day_date.weekday() >= 5
    slots = rules.get_slots_for_date(day_date)

    # R1: Randomize phone order (and order of TT/IG within each phone)
    phone_order = rules.randomize_phone_order()

    # ── Step 1: Determine session/post counts per account ──────────────
    account_plans = {}  # acc_name -> {session_count, post_count, ...}
    for phone_id, acc_names in phone_order:
        for acc_name in acc_names:
            account = next(a for a in config.ACCOUNTS if a["name"] == acc_name)
            acc_state = get_account_state(state, acc_name)
            personality = acc_state["personality"]
            asgn = weekly_assignments[acc_name]

            # Two-day break: completely inactive
            if asgn["two_day_break"] and day_date in asgn["two_day_break"]:
                account_plans[acc_name] = {"active": False}
                continue

            is_rest_day = (asgn["rest_day"] == day_date)
            is_one_post_day = (asgn["one_post_day"] == day_date)

            post_count = rules.determine_post_count(personality, is_one_post_day, is_rest_day)
            session_count = rules.determine_session_count()

            account_plans[acc_name] = {
                "active": True,
                "account": account,
                "personality": personality,
                "acc_state": acc_state,
                "is_rest_day": is_rest_day,
                "session_count": session_count,
                "post_count": post_count,
            }

    # ── Step 1b: Synchronize session counts per phone ─────────────────
    # Both accounts on the same phone MUST have the same session_count
    # so they always appear together in every round.
    for phone_id, acc_names in phone_order:
        active_accs = [n for n in acc_names if account_plans[n].get("active")]
        if len(active_accs) == 2:
            sc1 = account_plans[active_accs[0]]["session_count"]
            sc2 = account_plans[active_accs[1]]["session_count"]
            if sc1 != sc2:
                max_sc = max(sc1, sc2)
                for n in active_accs:
                    account_plans[n]["session_count"] = max_sc

    # ── Step 2: Build phone blocks per round ───────────────────────────
    # round 1 = first session of each account; round 2 = second session
    # Both accounts of a phone share the SAME slot within a round
    phone_blocks = []  # list of {phone_id, round, slot, sessions}

    max_rounds = max(
        (account_plans[an].get("session_count", 0)
         for _, ans in phone_order for an in ans
         if account_plans[an].get("active")),
        default=0,
    )

    for round_num in range(1, max_rounds + 1):
        for phone_id, acc_names in phone_order:
            block_sessions = []
            any_post_in_block = False

            for acc_name in acc_names:
                ap = account_plans[acc_name]
                if not ap.get("active"):
                    continue
                if ap["session_count"] < round_num:
                    continue

                # Distribute posts: round 1 gets first post, round 2 gets second
                has_post = False
                if ap["post_count"] >= round_num:
                    has_post = True
                any_post_in_block = any_post_in_block or has_post

                # Check abort BEFORE building session.
                # If aborted AND posting AND there is a next round, reschedule post.
                personality = ap["personality"]
                will_abort = rules.maybe_abort_session(personality)

                if will_abort and has_post and ap["session_count"] > round_num:
                    ap["post_count"] = max(ap["post_count"], round_num + 1)

                session_desc = _build_session(
                    ap["account"], personality, round_num, has_post,
                    ap["is_rest_day"], None,  # slot assigned below
                    is_weekend, ap["acc_state"],
                    force_abort=will_abort,
                )
                block_sessions.append(session_desc)

            if block_sessions:
                slot = rules.pick_session_slot(
                    slots, has_post=any_post_in_block,
                    exclude_slots=None,
                    is_weekend=is_weekend,
                )
                for sd in block_sessions:
                    sd["slot"] = slot
                phone_blocks.append({
                    "phone_id": phone_id,
                    "round": round_num,
                    "slot": slot,
                    "sessions": block_sessions,
                })

    # ── Step 3: Ensure round 2 slots are AFTER round 1 slots ──────────
    # This guarantees the complete phone block (round 1) always appears
    # before any partial round 2 blocks in the final schedule.
    phone_round1_slots = {}
    for pb in phone_blocks:
        if pb["round"] == 1:
            phone_round1_slots[pb["phone_id"]] = pb["slot"]

    def _slot_start_mins(slot):
        return slot["start_h"] * 60 + slot["start_m"]

    for pb in phone_blocks:
        if pb["round"] <= 1:
            continue
        r1_slot = phone_round1_slots.get(pb["phone_id"])
        if r1_slot is None:
            continue
        r1_end = r1_slot["end_h"] * 60 + r1_slot["end_m"]
        cur_start = _slot_start_mins(pb["slot"])

        if cur_start <= _slot_start_mins(r1_slot):
            # Round 2 is in an earlier or same slot — pick a later one
            later_slots = [s for s in slots if _slot_start_mins(s) > _slot_start_mins(r1_slot)]
            if later_slots:
                new_slot = rules.pick_session_slot(
                    later_slots,
                    has_post=any(sd.get("post_scheduled") for sd in pb["sessions"]),
                    exclude_slots=None,
                    is_weekend=is_weekend,
                )
            else:
                # No later slot available — use the last slot
                new_slot = slots[-1]
            pb["slot"] = new_slot
            for sd in pb["sessions"]:
                sd["slot"] = new_slot

    # ── Step 4: Sort blocks by slot time, then phone order ─────────────
    phone_order_map = {pid: idx for idx, (pid, _) in enumerate(phone_order)}

    def slot_start_minutes(slot):
        return slot["start_h"] * 60 + slot["start_m"]

    phone_blocks.sort(key=lambda pb: (
        slot_start_minutes(pb["slot"]),
        phone_order_map.get(pb["phone_id"], 0),
    ))

    # ── Step 4b: Avoid same platform at phone boundaries ─────────────
    # When switching phones, the first account of the new phone must be
    # a different platform from the last account of the previous phone.
    # If they match, reverse the session order within the new block.
    for i in range(1, len(phone_blocks)):
        prev_block = phone_blocks[i - 1]
        curr_block = phone_blocks[i]
        if prev_block["phone_id"] == curr_block["phone_id"]:
            continue  # same phone, no boundary issue
        if len(prev_block["sessions"]) == 0 or len(curr_block["sessions"]) == 0:
            continue
        if len(curr_block["sessions"]) < 2:
            continue  # only 1 account active, can't swap
        last_platform = prev_block["sessions"][-1]["platform"]
        first_platform = curr_block["sessions"][0]["platform"]
        if last_platform == first_platform:
            curr_block["sessions"].reverse()

    # ── Step 5: Place sessions sequentially (R17) ──────────────────────
    sessions = []
    proxy_rotations = []
    current_time_mins = None
    last_phone_id = None

    for pb in phone_blocks:
        phone_id = pb["phone_id"]
        slot = pb["slot"]
        slot_start = slot["start_h"] * 60 + slot["start_m"]
        slot_end = slot["end_h"] * 60 + slot["end_m"]

        for sd in pb["sessions"]:
            # Determine start time
            if current_time_mins is None:
                start_mins = rules.random_time_in_slot(slot)
            else:
                gap = rules.random_inter_session_gap()
                # Within same phone block, use smaller gap (1-5 min)
                if phone_id == last_phone_id:
                    gap = random.randint(1, 5)
                earliest = current_time_mins + gap
                start_mins = max(earliest, slot_start)
                if start_mins > slot_end:
                    start_mins = current_time_mins + max(1, gap // 3)

            # Proxy rotation if switching phones
            needs_rotation = (last_phone_id is not None and phone_id != last_phone_id)
            if needs_rotation:
                rotation_time = _minutes_to_time(max(0, start_mins - 1))
                proxy_rotations.append(ProxyRotation(
                    time_str=rotation_time.strftime("%H:%M"),
                    from_phone=last_phone_id,
                    to_phone=phone_id,
                ))

            duration = sd["total_duration_minutes"]
            end_mins = start_mins + duration

            session = Session(
                account_name=sd["account_name"],
                phone_id=sd["phone_id"],
                platform=sd["platform"],
                start_time=_minutes_to_time(start_mins),
                end_time=_minutes_to_time(end_mins),
                time_slot_name=slot["name"],
                session_number=sd["session_number"],
                session_type=sd["session_type"],
                post_scheduled=sd["post_scheduled"],
                post_outcome=sd["post_outcome"],
                pre_activity_minutes=sd["pre_activity_minutes"],
                post_activity_minutes=sd["post_activity_minutes"],
                total_duration_minutes=duration,
                proxy_rotation_before=needs_rotation,
            )
            sessions.append(session)

            current_time_mins = end_mins
            last_phone_id = phone_id

    return DailyPlan(date=day_date, sessions=sessions, proxy_rotations=proxy_rotations)


# ─── Weekly Plan ──────────────────────────────────────────────────────────────
def generate_weekly_plan(start_date=None):
    """Generate a complete weekly plan (Mon-Sun).

    Args:
        start_date: Any date within the desired week. Defaults to today.

    Returns:
        WeeklyPlan object with all daily plans and summaries.
    """
    if start_date is None:
        start_date = date.today()

    week_dates = _get_week_dates(start_date)
    iso_cal = start_date.isocalendar()

    # Load and initialize state
    state = load_state()
    state = initialize_all_accounts(state, start_date)

    # Reset weekly extended session flags
    for acc in config.ACCOUNTS:
        acc_state = get_account_state(state, acc["name"])
        acc_state["extended_session_used_this_week"] = False
        acc_state["extended_session_week"] = iso_cal[1]

    # Assign special days for the week
    weekly_assignments, phone_breaks = _assign_weekly_special_days(state, week_dates)

    # Generate daily plans
    daily_plans = {}
    for day_date in week_dates:
        daily_plans[day_date] = generate_daily_plan(day_date, state, weekly_assignments)

    # Build summaries
    account_summaries = {}
    for acc in config.ACCOUNTS:
        name = acc["name"]
        asgn = weekly_assignments[name]
        summary = AccountWeekSummary(
            account_name=name,
            phone_id=acc["phone_id"],
            platform=acc["platform"],
        )
        if asgn["rest_day"]:
            summary.rest_days.append(asgn["rest_day"])
        if asgn["one_post_day"]:
            summary.one_post_days.append(asgn["one_post_day"])
        if asgn["two_day_break"]:
            summary.two_day_break = asgn["two_day_break"]

        # Count from daily plans
        for day_date, dp in daily_plans.items():
            for session in dp.sessions:
                if session.account_name == name:
                    summary.total_sessions += 1
                    if session.post_outcome == "posted":
                        summary.total_posts += 1
                    if session.post_outcome == "draft":
                        summary.draft_errors += 1
                    if session.post_outcome == "skipped":
                        summary.skipped_posts += 1
                    if session.session_type == "aborted":
                        summary.aborted_sessions += 1
                    if session.session_type == "extended":
                        summary.extended_sessions += 1

        account_summaries[name] = summary

    # Update persisted state
    for acc in config.ACCOUNTS:
        name = acc["name"]
        acc_state = get_account_state(state, name)
        asgn = weekly_assignments[name]
        if asgn["rest_weekday"] is not None:
            acc_state["last_rest_day_weekday"] = asgn["rest_weekday"]
        if asgn["one_post_weekday"] is not None:
            acc_state["last_one_post_day_weekday"] = asgn["one_post_weekday"]
        if asgn["two_day_break"]:
            acc_state["last_two_day_break_date"] = asgn["two_day_break"][1].isoformat()
            acc_state["two_day_break_interval"] = random.randint(
                *config.RULES["two_day_break_interval_range"])

    save_state(state)

    return WeeklyPlan(
        week_number=iso_cal[1],
        year=iso_cal[0],
        start_date=week_dates[0],
        end_date=week_dates[6],
        daily_plans=daily_plans,
        account_summaries=account_summaries,
    )
