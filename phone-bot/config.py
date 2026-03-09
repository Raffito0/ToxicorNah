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

# --- Human Behavior Engine ----------------------------------------------------
HUMAN = {
    # Tap jitter (Gaussian noise on every tap)
    "tap_sigma_x": 12,
    "tap_sigma_y": 14,

    # Swipe dynamics
    "swipe_duration_range": (180, 450),     # ms
    "swipe_x_drift_range": (-20, 20),       # px lateral drift
    "swipe_y_jitter": 30,                   # px start/end variance

    # Timing (seconds)
    "between_action_range": (0.4, 3.5),     # pause between taps/swipes
    "reading_pause_range": (1.5, 5.0),      # pause before commenting (reading)
    "typing_speed_range": (0.10, 0.28),     # seconds per character
    "micro_pause_prob": 0.15,               # chance of 50-200ms hesitation mid-action

    # Session fatigue (engagement drops over time)
    "fatigue_start_minute": 10,             # fatigue kicks in after this
    "fatigue_like_drop": 0.4,               # like probability multiplied by this at max fatigue
    "fatigue_scroll_speed_boost": 1.5,      # scroll gets faster when fatigued

    # Interruptions
    "interruption_prob": 0.08,              # per-minute chance of interruption
    "interruption_duration_range": (5, 120),  # seconds (pause or app switch)
    "app_switch_prob": 0.4,                 # of interruptions, how many switch apps

    # Rabbit holes (deep profile visits)
    "rabbit_hole_prob": 0.07,               # per-video chance of visiting creator profile
    "rabbit_hole_videos_range": (2, 5),     # how many videos to watch on their profile

    # Daily mood (multipliers applied at session start)
    "mood_energy_range": (0.7, 1.3),        # overall activity multiplier
    "mood_social_range": (0.5, 1.5),        # comment/follow probability multiplier
}

# --- Engagement Mix (per session, randomized +/-30%) --------------------------
ENGAGEMENT_MIX = {
    "scroll_fyp": 0.60,       # passive watching
    "like": 0.20,             # like videos (30-50% of watched)
    "comment": 0.10,          # contextual comments
    "search_explore": 0.05,   # search hashtags, explore
    "follow": 0.03,           # follow creators
    "profile_visit": 0.02,    # check notifications, own profile
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
