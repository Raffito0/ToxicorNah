"""Rule 16: Dynamic Account Personalities.

Each account has a 'personality' that changes slowly over time (every 1-2 weeks).
This makes behavior realistic — no account has a perfectly stable average.
"""
import json
import os
import random
from datetime import date, timedelta

from . import config


def _default_personality():
    """Generate a fresh random personality."""
    r = config.RULES
    return {
        "two_post_target": random.uniform(*r["two_post_target_range"]),
        "weekend_more_active": random.random() < random.uniform(*r["weekend_personality_prob_range"]),
        "session_length_bias": random.uniform(*r["session_length_bias_range"]),
        "pre_post_short_prob": random.uniform(*r["pre_post_short_prob_range"]),
        "pre_post_long_prob": random.uniform(*r["pre_post_long_prob_range"]),
        "post_post_short_prob": random.uniform(*r["post_post_short_prob_range"]),
        "post_post_long_prob": random.uniform(*r["post_post_long_prob_range"]),
        "rest_day_prob": random.uniform(*r["rest_day_prob_range"]),
        "abort_prob": random.uniform(*r["abort_prob_range"]),
        "draft_error_prob": random.uniform(*r["draft_error_prob_range"]),
        "skip_post_prob": random.uniform(*r["skip_post_prob_range"]),
    }


def _default_account_state(account_name):
    """Default state for a new account."""
    return {
        "account_name": account_name,
        "personality": _default_personality(),
        "personality_last_changed": None,
        "last_rest_day_weekday": None,  # 0=Mon, 6=Sun
        "last_one_post_day_weekday": None,
        "last_two_day_break_date": None,
        "days_since_break": 0,
        "two_day_break_interval": random.randint(*config.RULES["two_day_break_interval_range"]),
        "extended_session_used_this_week": False,
        "extended_session_week": None,
    }


def load_state():
    """Load persisted account state from disk."""
    if os.path.exists(config.STATE_FILE):
        with open(config.STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(state):
    """Save account state to disk."""
    os.makedirs(config.STATE_DIR, exist_ok=True)
    with open(config.STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def get_account_state(state, account_name):
    """Get or create state for a specific account."""
    if account_name not in state:
        state[account_name] = _default_account_state(account_name)
    return state[account_name]


def maybe_refresh_personality(account_state, current_date):
    """Rule 16: Refresh personality if enough time has passed."""
    r = config.RULES
    last_changed = account_state.get("personality_last_changed")

    if last_changed is None:
        account_state["personality"] = _default_personality()
        account_state["personality_last_changed"] = current_date.isoformat()
        return

    last_date = date.fromisoformat(last_changed)
    days_since = (current_date - last_date).days
    interval = random.randint(*r["personality_change_interval_range"])

    if days_since >= interval:
        old_p = account_state["personality"]
        new_p = _default_personality()
        # Blend old and new for gradual transition (70% new, 30% old)
        for key in new_p:
            if isinstance(new_p[key], (int, float)):
                new_p[key] = new_p[key] * 0.7 + old_p.get(key, new_p[key]) * 0.3
            # booleans stay as the new value
        account_state["personality"] = new_p
        account_state["personality_last_changed"] = current_date.isoformat()


def initialize_all_accounts(state, current_date):
    """Ensure all accounts have state and refresh personalities if needed."""
    for acc in config.ACCOUNTS:
        acc_state = get_account_state(state, acc["name"])
        maybe_refresh_personality(acc_state, current_date)
    return state
