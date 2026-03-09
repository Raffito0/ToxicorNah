"""Implementation of all 17 rules for human-like behavior simulation."""
import random
from datetime import date, timedelta

from . import config


# ─── R1: Daily Order of Accounts ─────────────────────────────────────────────
def randomize_phone_order():
    """Randomize the order of phones for the day.
    Within each phone, TikTok and Instagram order is also randomized.
    Returns list of (phone_id, [account_name_1, account_name_2])."""
    phones = list(config.PHONES)
    random.shuffle(phones)

    result = []
    for phone_id in phones:
        phone_accounts = [a for a in config.ACCOUNTS if a["phone_id"] == phone_id]
        random.shuffle(phone_accounts)
        result.append((phone_id, [a["name"] for a in phone_accounts]))
    return result


# ─── R2: Posting Frequency ───────────────────────────────────────────────────
def determine_post_count(personality, is_one_post_day, is_rest_day):
    """Determine how many posts an account should make today.
    Returns 0 (rest day), 1, or 2."""
    if is_rest_day:
        return 0
    if is_one_post_day:
        return 1
    # Use personality's two_post_target to decide 1 or 2
    if random.random() < personality["two_post_target"]:
        return 2
    return 1


# ─── R3: Number of Sessions ──────────────────────────────────────────────────
def determine_session_count():
    """Normally 2 sessions, ~8% chance of only 1. Max 2."""
    if random.random() < config.RULES["single_session_prob"]:
        return 1
    return 2


# ─── R4: Pre-Post Activity Duration ──────────────────────────────────────────
def generate_pre_post_duration(personality):
    """Generate duration (minutes) of activity BEFORE posting."""
    r = config.RULES
    roll = random.random()
    short_prob = personality.get("pre_post_short_prob", 0.10)
    long_prob = personality.get("pre_post_long_prob", 0.10)

    if roll < short_prob:
        duration = random.randint(*r["pre_post_short_range"])
    elif roll < short_prob + long_prob:
        duration = random.randint(*r["pre_post_long_range"])
    else:
        duration = random.randint(*r["pre_post_normal_range"])

    bias = personality.get("session_length_bias", 1.0)
    return max(1, round(duration * bias))


# ─── R5: Post-Post Activity Duration ─────────────────────────────────────────
def generate_post_post_duration(personality):
    """Generate duration (minutes) of activity AFTER posting."""
    r = config.RULES
    roll = random.random()
    short_prob = personality.get("post_post_short_prob", 0.10)
    long_prob = personality.get("post_post_long_prob", 0.05)

    if roll < short_prob:
        duration = random.randint(*r["post_post_short_range"])
    elif roll < short_prob + long_prob:
        duration = random.randint(*r["post_post_long_range"])
    else:
        duration = random.randint(*r["post_post_normal_range"])

    bias = personality.get("session_length_bias", 1.0)
    return max(1, round(duration * bias))


# ─── R6: Time Slot Selection ─────────────────────────────────────────────────
def get_slots_for_date(d):
    """Return the appropriate time slots (weekday or weekend)."""
    if d.weekday() >= 5:  # Saturday=5, Sunday=6
        return config.WEEKEND_SLOTS
    return config.WEEKDAY_SLOTS


def pick_session_slot(slots, has_post=False, exclude_slots=None, is_weekend=False):
    """Smart distribution: pick a time slot weighted by engagement.
    R11: On weekends, 60-75% of sessions should be after 4 PM.
    Posting sessions get heavier weight toward high-engagement slots.
    exclude_slots: list of slot names to avoid (for second sessions)."""
    available = [s for s in slots if not exclude_slots or s["name"] not in exclude_slots]
    if not available:
        available = slots  # fallback if all excluded

    if is_weekend:
        # R11: 60-75% of weekend sessions should be after 4 PM
        # Slots after 4 PM: Afternoon (15-18, partially), Night Peak (19-23:30)
        # Heavily favor late slots
        weights = []
        for s in available:
            if s["start_h"] >= 19:
                # Night Peak: highest weight
                weights.append(6 if has_post else 4)
            elif s["start_h"] >= 15:
                # Afternoon (3-6 PM): medium-high weight
                weights.append(4 if has_post else 3)
            else:
                # Morning/Early Afternoon: low weight
                weights.append(1)
    elif has_post:
        # Weekday posting: heavily favor high-engagement slots
        weights = [s["weight"] ** 2 for s in available]
    else:
        # Weekday non-posting: more even distribution
        weights = [s["weight"] for s in available]

    return random.choices(available, weights=weights, k=1)[0]


def random_time_in_slot(slot):
    """Pick a random minute within the slot's time range."""
    start_mins = slot["start_h"] * 60 + slot["start_m"]
    end_mins = slot["end_h"] * 60 + slot["end_m"]
    chosen = random.randint(start_mins, max(start_mins, end_mins - 1))
    return chosen  # total minutes from midnight


# ─── R7: Weekly Rest Day ─────────────────────────────────────────────────────
def should_have_rest_day(personality):
    """84-95% probability of having a rest day this week."""
    return random.random() < personality["rest_day_prob"]


def pick_rest_day(week_dates, last_rest_weekday=None):
    """Pick a rest day that's different from last week's.
    week_dates: list of date objects for the week (Mon-Sun)."""
    available_weekdays = list(range(7))
    if last_rest_weekday is not None:
        available_weekdays = [d for d in available_weekdays if d != last_rest_weekday]
    if not available_weekdays:
        available_weekdays = list(range(7))

    chosen_weekday = random.choice(available_weekdays)
    return week_dates[chosen_weekday], chosen_weekday


# ─── R8: One-Post Day ────────────────────────────────────────────────────────
def pick_one_post_day(week_dates, rest_day_weekday, last_one_post_weekday=None):
    """Pick a day with only 1 post, different from rest day and last week's."""
    available = [d for d in range(7) if d != rest_day_weekday]
    if last_one_post_weekday is not None:
        available = [d for d in available if d != last_one_post_weekday]
    if not available:
        available = [d for d in range(7) if d != rest_day_weekday]

    chosen_weekday = random.choice(available)
    return week_dates[chosen_weekday], chosen_weekday


# ─── R10: Two-Day Break ──────────────────────────────────────────────────────
def should_start_two_day_break(account_state, current_date):
    """Check if it's time for a two-day break on this phone."""
    last_break = account_state.get("last_two_day_break_date")
    interval = account_state.get("two_day_break_interval",
                                  random.randint(*config.RULES["two_day_break_interval_range"]))

    if last_break is None:
        days_since = interval  # trigger on first check
    else:
        last_date = date.fromisoformat(last_break) if isinstance(last_break, str) else last_break
        days_since = (current_date - last_date).days

    return days_since >= interval


def assign_two_day_break(phone_id, week_dates, state, other_phone_breaks):
    """Assign a 2-day break to one random account on this phone.
    Ensures no overlap with breaks on other phones.
    Returns (account_name, break_day1, break_day2) or None."""
    phone_accounts = [a for a in config.ACCOUNTS if a["phone_id"] == phone_id]

    # Find which dates are already taken by other phone breaks
    blocked_dates = set()
    for breaks in other_phone_breaks.values():
        for _, d1, d2 in breaks:
            blocked_dates.add(d1)
            blocked_dates.add(d2)

    # Try to find 2 consecutive dates not blocked
    possible_starts = []
    for i in range(len(week_dates) - 1):
        d1, d2 = week_dates[i], week_dates[i + 1]
        if d1 not in blocked_dates and d2 not in blocked_dates:
            possible_starts.append(i)

    if not possible_starts:
        return None

    start_idx = random.choice(possible_starts)
    break_d1 = week_dates[start_idx]
    break_d2 = week_dates[start_idx + 1]

    # Pick one random account on this phone for the break
    chosen_account = random.choice(phone_accounts)
    return (chosen_account["name"], break_d1, break_d2)


# ─── R11: Weekend Variation ──────────────────────────────────────────────────
def apply_weekend_session_bias(personality, is_weekend):
    """Returns a duration multiplier for weekend sessions."""
    if not is_weekend:
        return 1.0
    if personality.get("weekend_more_active", False):
        return random.uniform(1.1, 1.3)
    return random.uniform(1.0, 1.15)


# ─── R12: Aborted Sessions ───────────────────────────────────────────────────
def maybe_abort_session(personality):
    """5-10% chance of an aborted session (<2 min, no post)."""
    return random.random() < personality.get("abort_prob", 0.07)


def aborted_session_duration():
    """Duration of an aborted session: <2 minutes."""
    return random.uniform(0.5, config.RULES["abort_max_duration"])


# ─── R13: Extended Sessions ──────────────────────────────────────────────────
def maybe_extend_session(account_state):
    """3-7% weekly chance of an extra long session (25-40 min).
    Only triggers once per week per account."""
    week_iso = account_state.get("extended_session_week")
    if week_iso and week_iso == date.today().isocalendar()[1]:
        if account_state.get("extended_session_used_this_week", False):
            return False

    prob = random.uniform(*config.RULES["extended_weekly_prob_range"])
    return random.random() < prob


def extended_session_duration():
    """Duration of an extended session."""
    return random.randint(*config.RULES["extended_duration_range"])


# ─── R14: Post Errors ────────────────────────────────────────────────────────
def apply_post_error(personality):
    """Returns the post outcome: 'posted', 'draft', or 'skipped'."""
    roll = random.random()
    draft_prob = personality.get("draft_error_prob", 0.03)
    skip_prob = personality.get("skip_post_prob", 0.02)

    if roll < draft_prob:
        return "draft"
    if roll < draft_prob + skip_prob:
        return "skipped"
    return "posted"


# ─── R15: Cross-Phone Coordination ───────────────────────────────────────────
def validate_cross_phone(day_date, account_activity):
    """Ensure at least 1 account on at least 2 phones is active.
    account_activity: dict {account_name: bool (active or not)}
    Returns True if valid, False if violated."""
    active_phones = set()
    for acc in config.ACCOUNTS:
        if account_activity.get(acc["name"], True):
            active_phones.add(acc["phone_id"])
    return len(active_phones) >= 2


# ─── R17: Session Gap ────────────────────────────────────────────────────────
def random_inter_session_gap():
    """Random gap (minutes) between consecutive sessions: 0-30 min."""
    return random.randint(*config.RULES["inter_session_gap_range"])


def rest_only_session_duration():
    """Duration for a session on a rest day (just scrolling, no post)."""
    return random.randint(*config.RULES["rest_session_duration_range"])
