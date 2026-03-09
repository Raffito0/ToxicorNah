"""Configuration for the Weekly & Daily Plan Generator."""
import os

# ─── Account Definitions ───────────────────────────────────────────────────────
ACCOUNTS = [
    {"name": "ph1_tiktok",    "phone_id": 1, "platform": "tiktok"},
    {"name": "ph1_instagram", "phone_id": 1, "platform": "instagram"},
    {"name": "ph2_tiktok",    "phone_id": 2, "platform": "tiktok"},
    {"name": "ph2_instagram", "phone_id": 2, "platform": "instagram"},
    {"name": "ph3_tiktok",    "phone_id": 3, "platform": "tiktok"},
    {"name": "ph3_instagram", "phone_id": 3, "platform": "instagram"},
]

PHONES = [1, 2, 3]

# ─── Proxy Configuration ──────────────────────────────────────────────────────
PROXY = {
    "host": "sinister.services",
    "port": 20002,
    "username": "CY9NRSRY",
    "password": "CY9NRSRY",
    "rotation_url": "http://sinister.services/selling/rotate?token=a4803a26a87c41699f3c5d10e7bdc292",
    "socks5_url": "socks5://CY9NRSRY:CY9NRSRY@sinister.services:20002",
}

# ─── Time Slots (Eastern Time) ────────────────────────────────────────────────
# Each slot: name, start (hour, minute), end (hour, minute), engagement_weight
# Higher weight = better for posting (more engagement)

WEEKDAY_SLOTS = [
    {"name": "Morning",   "start_h": 6,  "start_m": 0,  "end_h": 8,  "end_m": 0,  "weight": 1},
    {"name": "Midday",    "start_h": 11, "start_m": 0,  "end_h": 13, "end_m": 0,  "weight": 2},
    {"name": "Afternoon", "start_h": 16, "start_m": 0,  "end_h": 18, "end_m": 0,  "weight": 2},
    {"name": "Evening",   "start_h": 19, "start_m": 30, "end_h": 22, "end_m": 0,  "weight": 3},
]

WEEKEND_SLOTS = [
    {"name": "Late Morning",    "start_h": 9,  "start_m": 0,  "end_h": 11, "end_m": 0,  "weight": 1},
    {"name": "Early Afternoon", "start_h": 12, "start_m": 0,  "end_h": 14, "end_m": 0,  "weight": 2},
    {"name": "Afternoon",       "start_h": 15, "start_m": 0,  "end_h": 18, "end_m": 0,  "weight": 2},
    {"name": "Night Peak",      "start_h": 19, "start_m": 0,  "end_h": 23, "end_m": 30, "weight": 3},
]

TIMEZONE = "US/Eastern"

# ─── Rule Parameters ──────────────────────────────────────────────────────────
RULES = {
    # R2: Posting frequency
    "two_post_target_range": (0.75, 0.95),

    # R3: Session count
    "single_session_prob": 0.08,

    # R4: Pre-post activity duration (minutes)
    "pre_post_normal_range": (6, 19),
    "pre_post_short_range": (1, 5),
    "pre_post_short_prob_range": (0.08, 0.15),
    "pre_post_long_range": (19, 24),
    "pre_post_long_prob_range": (0.06, 0.13),

    # R5: Post-post activity duration (minutes)
    "post_post_normal_range": (6, 14),
    "post_post_short_range": (1, 5),
    "post_post_short_prob_range": (0.08, 0.15),
    "post_post_long_range": (15, 24),
    "post_post_long_prob_range": (0.03, 0.08),

    # R7: Rest day
    "rest_day_prob_range": (0.84, 0.95),

    # R10: Two-day break interval (days)
    "two_day_break_interval_range": (7, 15),

    # R11: Weekend variation
    "weekend_late_session_prob_range": (0.60, 0.75),
    "weekend_personality_prob_range": (0.15, 0.25),
    "weekend_session_length_range": (10, 25),

    # R12: Aborted sessions
    "abort_prob_range": (0.05, 0.10),
    "abort_max_duration": 2,

    # R13: Extended sessions
    "extended_weekly_prob_range": (0.03, 0.07),
    "extended_duration_range": (25, 40),

    # R14: Post errors
    "draft_error_prob_range": (0.02, 0.05),
    "skip_post_prob_range": (0.01, 0.03),

    # R16: Personality change interval (days)
    "personality_change_interval_range": (7, 14),
    "session_length_bias_range": (0.85, 1.15),

    # Session gaps between consecutive sessions (minutes)
    "inter_session_gap_range": (0, 30),

    # Rest-only session duration (minutes)
    "rest_session_duration_range": (5, 25),
}

# ─── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_DIR = os.path.join(BASE_DIR, "state")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
STATE_FILE = os.path.join(STATE_DIR, "account_state.json")
