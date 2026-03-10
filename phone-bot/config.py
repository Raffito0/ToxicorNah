"""Global configuration for the Phone Bot automation system."""
import os

# --- Phones -------------------------------------------------------------------
PHONES = [
    {
        "id": 1,
        "name": "Samsung S22",
        "model": "SM-S901B",
        "adb_serial": None,  # auto-detected on startup
        "screen_w": 1080,
        "screen_h": 2340,
    },
    {
        "id": 2,
        "name": "Galaxy S9",
        "model": "SM-G960F",
        "adb_serial": None,
        "screen_w": 1080,
        "screen_h": 2220,
    },
    {
        "id": 3,
        "name": "Galaxy S9+",
        "model": "SM-G965F",
        "adb_serial": None,
        "screen_w": 1080,
        "screen_h": 2220,
    },
    {
        "id": 4,
        "name": "Motorola E22i",
        "model": "XT2239-15",
        "adb_serial": None,
        "screen_w": 720,
        "screen_h": 1600,
    },
]

# --- Accounts -----------------------------------------------------------------
ACCOUNTS = [
    {"name": "ph1_tiktok",    "phone_id": 1, "platform": "tiktok"},
    {"name": "ph1_instagram", "phone_id": 1, "platform": "instagram"},
    {"name": "ph2_tiktok",    "phone_id": 2, "platform": "tiktok"},
    {"name": "ph2_instagram", "phone_id": 2, "platform": "instagram"},
    {"name": "ph3_tiktok",    "phone_id": 3, "platform": "tiktok"},
    {"name": "ph3_instagram", "phone_id": 3, "platform": "instagram"},
    {"name": "ph4_tiktok",    "phone_id": 4, "platform": "tiktok"},
    {"name": "ph4_instagram", "phone_id": 4, "platform": "instagram"},
]

# --- Proxy (SOCKS5 via SSTap + MyPublicWiFi) ----------------------------------
PROXY = {
    "host": "sinister.services",
    "port": 20002,
    "username": "CY9NRSRY",
    "password": "CY9NRSRY",
    "rotation_url": "http://sinister.services/selling/rotate?token=a4803a26a87c41699f3c5d10e7bdc292",
    "socks5_url": "socks5://CY9NRSRY:CY9NRSRY@sinister.services:20002",
    "hotspot_ssid": "PhoneBot_Proxy",
    "hotspot_password": "",  # set your MyPublicWiFi password
}

# --- Airtable (Content Library) -----------------------------------------------
AIRTABLE = {
    "api_key": os.getenv("AIRTABLE_API_KEY", ""),
    "base_id": "appsgjIdkpak2kaXq",
    "content_library_table": "tblx1KX7mlTX5QyGb",
}

# --- Gemini AI ----------------------------------------------------------------
GEMINI = {
    "api_key": os.getenv("GEMINI_API_KEY", ""),
    "model": "gemini-2.0-flash",
    "max_tokens": 256,
}

# --- ADB ----------------------------------------------------------------------
ADB_PATH = os.getenv("ADB_PATH", "adb")

# --- App Activities (for am start, replaces detectable monkey command) --------
APP_ACTIVITIES = {
    "com.zhiliaoapp.musically": "com.ss.android.ugc.aweme.splash.SplashActivity",
    "com.instagram.android": "com.instagram.mainactivity.LauncherActivity",
}

# --- Human Behavior Engine (log-normal timing, phase-based engagement) --------
HUMAN = {
    # Tap jitter (Gaussian noise on every tap)
    "tap_sigma_x": 12,
    "tap_sigma_y": 14,

    # Swipe dynamics (log-normal duration)
    "swipe_duration_median": 300,           # ms
    "swipe_duration_sigma": 0.3,
    "swipe_x_drift_range": (-20, 20),       # px lateral drift
    "swipe_y_jitter": 30,                   # px start/end variance

    # Core action timing (log-normal: median + sigma)
    "action_delay_median": 1.2,             # seconds between actions
    "action_delay_sigma": 0.6,              # heavy tail: mostly 0.5-2s, rare up to 15s
    "typing_median": 0.15,                  # seconds per character
    "typing_sigma": 0.4,
    "reading_median": 2.5,                  # seconds before commenting
    "reading_sigma": 0.5,
    "micro_pause_prob": 0.15,               # chance of hesitation mid-action

    # Watch duration
    "watch_full_mult": (0.85, 1.1),         # full video multiplier (30%) -- uniform

    # Session fatigue
    "fatigue_start_minute": 10,
    "fatigue_like_drop": 0.4,
    "fatigue_scroll_speed_boost": 1.5,

    # Interruptions
    "interruption_prob": 0.08,
    "app_switch_prob": 0.4,

    # Rabbit holes
    "rabbit_hole_prob": 0.07,
    "rabbit_hole_videos_range": (2, 5),

    # Daily mood (multipliers)
    "mood_energy_range": (0.7, 1.3),
    "mood_social_range": (0.5, 1.5),

    # === 14 Human-Like Behaviors (probabilities + counts) ===
    "zona_morta_prob": 0.15,
    "typo_rate": 0.10,
    "peek_scroll_prob": 0.10,
    "rewatch_prob": 0.05,
    "speed_ramp_minutes": 3.5,
    "speed_ramp_slow_factor": 1.6,
    "micro_scroll_prob": 0.025,
    "double_comment_prob": 0.03,
    "bg_end_prob": 0.05,
    "like_burst_prob": 0.15,
    "like_burst_count": (2, 4),
    "like_burst_skip": (8, 15),
    "post_like_comment_boost": 2.5,
    "post_like_follow_boost": 3.0,

    # === ALL Timing Parameters -- Log-Normal ===
    # Format: (median_seconds, sigma, min_clamp, max_clamp)
    # sigma: 0.2=tight, 0.3=moderate, 0.5=wide, 0.8=very heavy tail
    # These produce heavy-tailed distributions: most values near the median,
    # with occasional long pauses -- like a real human.

    # Behavior durations (converted from old uniform ranges)
    "zona_morta_duration": (18.0, 0.4, 5, 60),
    "zona_morta_interval": (420.0, 0.3, 180, 900),
    "post_like_pause": (1.8, 0.4, 0.5, 6),
    "first_video_watch": (8.0, 0.5, 3, 25),
    "watch_short": (2.5, 0.4, 0.8, 8),
    "watch_medium": (6.0, 0.4, 2, 18),
    "load_reaction": (3.5, 0.4, 1.0, 12),
    "interruption_duration": (30.0, 0.8, 3, 300),
    "bg_end_duration": (42.0, 0.3, 15, 120),
    "micro_pause": (0.1, 0.4, 0.02, 0.5),

    # Inline timing (replaces hardcoded random.uniform calls)
    "t_app_load": (4.0, 0.3, 2, 10),              # after opening app
    "t_nav_settle": (1.8, 0.3, 0.5, 5),           # after navigating to a tab
    "t_browse_results": (7.0, 0.5, 3, 25),        # browsing search results
    "t_profile_settle": (4.5, 0.4, 1.5, 15),      # after profile pic/bio setup
    "t_double_tap": (0.15, 0.3, 0.05, 0.5),       # gap between double-tap for like
    "t_post_typing": (0.8, 0.4, 0.2, 3),          # settle after typing
    "t_micro_scroll": (0.8, 0.4, 0.2, 3),         # settle after micro-scroll
    "t_rewatch": (1.5, 0.5, 0.5, 6),              # pause before re-watching
    "t_double_open_1": (0.8, 0.4, 0.2, 3),        # first close in double-open comments
    "t_double_open_2": (1.2, 0.4, 0.3, 4),        # wait before reopening comments
    "t_search_browse": (8.0, 0.5, 3, 30),         # explore browsing after search
    "t_camera_record": (14.0, 0.2, 8, 25),        # camera trick recording duration
    "t_session_gap": (100.0, 0.4, 30, 360),       # gap between warmup sessions
    "t_explore_browse": (3.5, 0.4, 1, 12),        # browse during explore feature
    "t_typo_notice": (0.5, 0.3, 0.15, 1.5),       # noticing a typo
    "t_typo_backspace": (0.18, 0.3, 0.05, 0.6),   # backspace before retype
    "t_thinking": (0.5, 0.4, 0.15, 2.0),          # thinking pause while typing
}

# --- Session Flow Phases (replaces flat ENGAGEMENT_MIX) -----------------------
# Each phase has a duration range (minutes) and engagement weights.
# Phases are scaled to fit the actual session duration.
SESSION_PHASES = {
    "arrival": {
        "duration_range": (2, 3),
        "engagement": {
            "scroll_fyp": 0.95, "like": 0.02, "comment": 0.00,
            "search_explore": 0.02, "follow": 0.00, "profile_visit": 0.01,
        },
    },
    "warmup": {
        "duration_range": (3, 5),
        "engagement": {
            "scroll_fyp": 0.70, "like": 0.18, "comment": 0.03,
            "search_explore": 0.04, "follow": 0.02, "profile_visit": 0.03,
        },
    },
    "peak": {
        "duration_range": (7, 12),
        "engagement": {
            "scroll_fyp": 0.45, "like": 0.25, "comment": 0.12,
            "search_explore": 0.05, "follow": 0.05, "profile_visit": 0.08,
        },
    },
    "fatigue": {
        "duration_range": (5, 10),
        "engagement": {
            "scroll_fyp": 0.78, "like": 0.12, "comment": 0.03,
            "search_explore": 0.02, "follow": 0.01, "profile_visit": 0.04,
        },
    },
    "exit": {
        "duration_range": (2, 3),
        "engagement": {
            "scroll_fyp": 0.92, "like": 0.05, "comment": 0.01,
            "search_explore": 0.01, "follow": 0.00, "profile_visit": 0.01,
        },
    },
}

# --- Paths --------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "bot.db")
PLANS_DIR = os.path.join(DATA_DIR, "plans")
VIDEOS_DIR = os.path.join(DATA_DIR, "videos")
LOGS_DIR = os.path.join(DATA_DIR, "logs")

# Delivery module (existing, in Weekly & Daily Plan)
DELIVERY_MODULE_DIR = os.path.join(
    os.path.expanduser("~"), "OneDrive", "Desktop", "Toxic or Nah", "Weekly & Daily Plan"
)
import sys
if DELIVERY_MODULE_DIR not in sys.path:
    sys.path.insert(0, DELIVERY_MODULE_DIR)

# Ensure dirs exist
for d in [DATA_DIR, PLANS_DIR, VIDEOS_DIR, LOGS_DIR]:
    os.makedirs(d, exist_ok=True)

# --- Timezone -----------------------------------------------------------------
TIMEZONE = "US/Eastern"
