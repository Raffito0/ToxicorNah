"""Global configuration for the Phone Bot automation system."""
import os

# --- Test Mode ----------------------------------------------------------------
# When True: skip proxy, use local WiFi, verbose logging, Europe/Rome timezone
TEST_MODE = os.getenv("PHONEBOT_TEST", "1") == "1"

# --- Phone Config Normalization -----------------------------------------------
def normalize_phone_config(phone: dict) -> dict:
    """Fill defaults for optional phone config fields.

    Required fields: "id", "adb_serial" (KeyError if missing).
    Optional fields with defaults:
      - name: "Phone {id}"
      - model: "unknown"
      - screen_w: None  (triggers ADB auto-detect)
      - screen_h: None  (triggers ADB auto-detect)
      - density: None   (triggers ADB auto-detect)
      - retry_tolerance: 3  (max verify retries, Motorola=4)

    Returns a new dict with all 8 keys guaranteed present.
    Extra keys in the input dict are preserved.
    """
    pid = phone["id"]
    _ = phone["adb_serial"]  # validate required
    defaults = {
        "name": f"Phone {pid}",
        "model": "unknown",
        "screen_w": None,
        "screen_h": None,
        "density": None,
        "retry_tolerance": 3,
    }
    return {**defaults, **phone}


# --- Phones -------------------------------------------------------------------
PHONES = [
    {
        "id": 1,
        "name": "Galaxy S9+",
        "model": "SM-G965F",
        "adb_serial": None,  # auto-detected on startup
        "screen_w": 1080,
        "screen_h": 2220,
        "density": 420,
    },
    {
        "id": 2,
        "name": "Samsung S22",
        "model": "SM-S901B",
        "adb_serial": None,
        "screen_w": 1080,
        "screen_h": 2340,
        "density": 420,
    },
    {
        "id": 3,
        "name": "Galaxy S9",
        "model": "SM-G960F",
        "adb_serial": None,
        "screen_w": 1080,
        "screen_h": 2220,
        "density": 420,
    },
    {
        "id": 4,
        "name": "Motorola E22i",
        "model": "moto e22i",
        "adb_serial": None,
        "screen_w": 720,
        "screen_h": 1600,
        "density": 280,
        "retry_tolerance": 4,
    },
]

# Normalize all phone entries (fill defaults for optional fields)
for i, p in enumerate(PHONES):
    PHONES[i] = normalize_phone_config(p)

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
_proxy_user = os.getenv("PROXY_USERNAME", "")
_proxy_pass = os.getenv("PROXY_PASSWORD", "")
_proxy_token = os.getenv("PROXY_ROTATION_TOKEN", "")
PROXY = {
    "host": "sinister.services",
    "port": 20002,
    "username": _proxy_user,
    "password": _proxy_pass,
    "rotation_url": f"https://sinister.services/selling/rotate?token={_proxy_token}",
    "socks5_url": f"socks5://{_proxy_user}:{_proxy_pass}@sinister.services:20002",
    "hotspot_ssid": os.getenv("HOTSPOT_SSID", "PhoneBot_Proxy"),
    "hotspot_password": os.getenv("HOTSPOT_PASSWORD", ""),
}

# --- Airtable (Content Library) -----------------------------------------------
AIRTABLE = {
    "api_key": os.getenv("AIRTABLE_API_KEY", ""),
    "base_id": "appsgjIdkpak2kaXq",
    "content_library_table": "tblx1KX7mlTX5QyGb",
}

# --- Gemini AI ----------------------------------------------------------------
GEMINI = {
    "api_key": os.getenv("GEMINI_API_KEY", "AIzaSyDvwh4rbEQu4TnsqmPukaC6wAqXiyINuv8"),
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
    "swipe_duration_median": 320,           # ms
    "swipe_duration_sigma": 0.5,            # wider spread: fast flicks (150ms) + slow drags (600ms+)
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
    "mood_energy_range": (0.45, 1.4),
    "mood_social_range": (0.4, 1.6),

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
    "interruption_duration": (12.0, 0.6, 3, 30),
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
    "t_file_push": (2.0, 0.3, 1.0, 5),            # after adb push + media scan
    "t_upload_load": (3.0, 0.3, 1.5, 7),           # after tapping create/upload button
    "t_post_upload": (5.0, 0.3, 3, 12),            # after tapping Post/Share (upload processing)
    "t_key_settle": (0.3, 0.3, 0.1, 0.8),          # after longpress DEL or single key
    "t_proxy_settle": (2.5, 0.3, 1, 6),            # after proxy IP rotation
    "t_wifi_connect": (3.5, 0.3, 2, 8),            # after wifi connect command
    "t_confirm_save": (3.0, 0.3, 1.5, 7),          # after confirm/save button (profile, upload)
    "t_poll_check": (1.0, 0.3, 0.5, 3),            # polling loop check interval
    "t_caption_input": (0.5, 0.3, 0.2, 1.5),       # after tapping caption field
    "t_story_watch": (3.0, 0.5, 1.0, 12),          # watching each story slide
    "t_search_scroll_pause": (1.5, 0.4, 0.5, 5),    # pause between videos in search results
    "t_search_clear": (0.8, 0.3, 0.3, 2),            # time to clear search bar before new keyword
    "t_tab_load_settle": (1.5, 0.3, 0.8, 3.0),        # settle time after switching to a new top tab

    # --- Comment browsing timing ---
    "t_comment_load": (1.5, 0.3, 0.8, 4),              # wait for comments sheet to load
    "t_comment_read": (2.0, 0.5, 0.8, 8),              # reading pause between comment scrolls
    "t_comment_read_deep": (3.5, 0.5, 1.5, 12),        # longer reading during deep dive (drama/beef)
    "t_comment_before_write": (1.2, 0.4, 0.4, 4),      # pause before tapping input to write
    "t_frame_capture_gap": (2.2, 0.4, 1.2, 5),         # gap between multi-frame captures for AI comment

    # --- Page state verification ---
    "t_popup_dismiss": (0.8, 0.3, 0.3, 2.0),              # pause after dismissing a popup
    "t_popup_read": (1.5, 0.4, 0.5, 4.0),                 # "reading" the popup before dismissing
    "t_recovery_settle": (1.2, 0.3, 0.5, 3.0),            # settling after page recovery
    "t_captcha_drag": (1.2, 0.3, 0.6, 2.5),              # drag duration for slider CAPTCHAs

    # --- New Section Timings (2026-03-16) ---
    "t_tab_switch":        (1.0, 0.3, 0.5, 2.5),
    "t_inbox_glance":      (2.0, 0.4, 1.0, 5.0),
    "t_shop_popup_read":   (1.5, 0.3, 0.8, 3.0),
    "t_product_browse":    (4.0, 0.5, 2.0, 10.0),
    "t_carousel_scroll":   (0.8, 0.2, 0.3, 1.5),
    "t_follower_read":     (1.5, 0.4, 0.5, 4.0),       # reading one follower row
    "t_niche_profile_glance": (2.5, 0.4, 1.0, 7.0),  # reading profile before niche eval screenshot
    "t_niche_video_watch": (4.0, 0.5, 2.0, 12.0),    # watching a video during niche eval
    "t_notification_read": (1.2, 0.4, 0.4, 3.5),       # reading one notification
    "t_profile_views_browse": (4.0, 0.5, 2.0, 10.0),   # browsing profile viewers list

    # --- Post-action verification waits (Category A -- CRITICAL) ---
    "t_back_verify":        (1.2, 0.3, 0.6, 3.0),     # after press_back, before verify screenshot
    "t_tab_content_load":   (2.5, 0.3, 1.5, 5.0),     # after tab tap, before verify content loaded
    "t_comment_anim":       (1.8, 0.3, 1.0, 4.0),     # comment sheet open animation
    "t_profile_load":       (3.0, 0.3, 1.5, 6.0),     # after avatar tap, before profile verify
    "t_profile_from_story": (3.5, 0.3, 2.0, 7.0),     # profile via Story header (slower)
    "t_video_open":         (2.0, 0.3, 1.0, 4.0),     # after grid tap, before video page verify

    # --- Anti-detection cosmetic waits (Category B) ---
    "t_tap_gap":            (0.5, 0.3, 0.2, 1.5),     # brief natural pause between sequential taps
    "t_anim_complete":      (1.5, 0.4, 0.8, 4.0),     # wait for animation/refresh to complete
    "t_brief_watch":        (5.0, 0.5, 2.0, 15.0),    # accidentally entered LIVE/video, brief watch
    "t_product_detail":     (2.0, 0.4, 1.0, 5.0),     # browsing product in Shop

    # --- System recovery waits (Category C) ---
    "t_home_settle":        (2.0, 0.3, 1.0, 4.0),     # after HOME gesture
    "t_reopen_app":         (3.5, 0.3, 2.0, 6.0),     # after reopening app from launcher
    "t_frozen_retry":       (4.0, 0.4, 2.0, 8.0),     # FYP frozen, wait before retry
    "t_close_before_open":  (3.0, 0.3, 1.5, 6.0),     # after closing app, before reopening
    "t_proxy_retry":        (5.0, 0.3, 3.0, 10.0),    # delay before proxy retry on first failure

    # --- Touch Pressure Physics (UHID) ---
    "touch_pressure_peak":  (0.55, 0.12, 0.25, 0.85),  # (center, sigma, min, max)
    "touch_ramp_up_ms":     (30, 8, 15, 50),
    "touch_ramp_down_ms":   (20, 6, 10, 40),
    "touch_hold_drift_px":  (2, 1, 0, 5),
    "touch_area_base":      30,
    "touch_area_pressure_scale": 40,

    # --- Session Environment ---
    "t_feed_refresh":       (3.0, 0.4, 1.5, 8.0),     # wait for feed to load after refresh
    "t_screen_setup":       (0.5, 0.2, 0.2, 1.5),     # wait after screen settings change
    "t_wifi_reconnect":     (3.0, 0.4, 1.5, 8.0),     # wait for WiFi to reconnect

    # --- Dynamic Nav + Engagement (Splits 02-04) ---
    "t_profile_glance":     (4.0, 0.5, 2.0, 10.0),    # brief own-profile check
    "t_video_glance":       (2.0, 0.3, 1.0, 5.0),     # glancing at video in profile grid
    "t_following_empty":    (1.5, 0.3, 0.5, 3.0),     # verify following has content
    "t_bookmark_tap":       (0.3, 0.2, 0.1, 0.8),     # after bookmark tap
    "t_context_menu":       (0.8, 0.3, 0.4, 2.0),     # after long-press (context menu appear)
    "t_carousel_photo":     (2.5, 0.4, 1.0, 6.0),     # per photo in carousel browse
    "t_message_glance":     (3.0, 0.5, 1.5, 7.0),     # DM list glance
    "t_post_celebration":   (5.0, 0.5, 2.0, 12.0),    # pause after posting video

    # --- Non-standard FYP posts (LIVE, PYMK, ads) ---
    "t_live_skip_pause":    (0.4, 0.2, 0.2, 0.8),     # brief pause before single scroll past PYMK (section-06 reuses for LIVE)
}

# Max recovery attempts before forcing go_to_fyp()
PAGE_VERIFY_MAX_RETRIES = 3

# --- PopupGuardian (continuous popup detection) ---
# Stall threshold: max avg brightness diff to consider screen "unchanged" after swipe.
# New video: avg_diff typically 40-80+. Same video with popup: typically 3-12.
# Set conservatively to avoid false positives from static video backgrounds.
POPUP_STALL_THRESHOLD = 18

# --- Popup Handler (3-tier overlay system) ---
POPUP_DARK_OVERLAY_BRIGHTNESS_DROP = 0.40   # min brightness drop to flag dark overlay
POPUP_DARK_OVERLAY_MAX_STDEV = 25           # max stdev for uniform overlay (not dark video)
POPUP_BOTTOM_BUTTON_BRIGHTNESS = 180        # min avg brightness for bottom button band
POPUP_HANDLER_RATE_LIMIT = 3                # max overlay handler invocations per 60s
POPUP_TIER2_TIMEOUT_SEC = 300               # 5 min timeout for human intervention
POPUP_COORD_MARGIN_PCT = 0.05              # safety margin for tap coord clamping

# --- Niche Gate (like/follow only in-niche content) ---
# Follow cap: max follows per rolling 30-minute window
FOLLOW_CAP_PER_30MIN = 2

# --- Niche Keywords Pool (per-session random sampling, avoids all accounts = same queries) ---
NICHE_KEYWORDS_POOL = [
    "toxic relationship", "red flags", "situationship",
    "dating advice", "couples", "relationship tips",
    "boyfriend check", "girlfriend goals", "love advice",
    "talking stage", "toxic ex", "heartbreak",
    "relationship goals", "couple goals", "breakup",
    "dating red flags", "toxic traits", "relationship drama",
    "single life", "dating fails", "love language",
]

# --- Niche Description (for Gemini niche-fit evaluation prompts) ---
NICHE_DESCRIPTION = (
    "Relationship and dating content: toxic relationships, red flags, situationships, "
    "dating advice, couples content, heartbreak, love advice, breakups, boyfriend/girlfriend "
    "dynamics, relationship drama, talking stage."
)

# --- Niche Follow Threshold (base score 0-100, modified by personality) ---
NICHE_FOLLOW_THRESHOLD = 55

# --- Rate Limits (conservative, below TikTok's actual thresholds) ----------
RATE_LIMITS = {
    "max_follows_day": 150,     # TikTok limit ~200
    "max_follows_hour": 25,     # TikTok safe range ~15-30
    "max_likes_day": 400,       # TikTok limit ~500
    "max_comments_day": 50,     # conservative
}

# --- Session Flow Phases (replaces flat ENGAGEMENT_MIX) -----------------------
# Each phase has a duration range (minutes) and engagement weights.
# Phases are scaled to fit the actual session duration.
SESSION_PHASES = {
    "arrival": {
        "duration_range": (2, 3),
        "engagement": {
            "scroll_fyp": 0.93, "like": 0.03, "comment": 0.00,
            "search_explore": 0.00, "follow": 0.00, "profile_visit": 0.00,
            "check_inbox": 0.03, "browse_following": 0.00,
            "browse_explore": 0.00, "browse_shop": 0.00,
        },
    },
    "warmup": {
        "duration_range": (3, 5),
        "engagement": {
            "scroll_fyp": 0.77, "like": 0.06, "comment": 0.01,
            "search_explore": 0.01, "follow": 0.01, "profile_visit": 0.01,
            "check_inbox": 0.05, "browse_following": 0.04,
            "browse_explore": 0.03, "browse_shop": 0.01,
        },
    },
    "peak": {
        "duration_range": (7, 12),
        "engagement": {
            "scroll_fyp": 0.69, "like": 0.06, "comment": 0.04,
            "search_explore": 0.02, "follow": 0.01, "profile_visit": 0.03,
            "check_inbox": 0.04, "browse_following": 0.05,
            "browse_explore": 0.04, "browse_shop": 0.02,
        },
    },
    "fatigue": {
        "duration_range": (5, 10),
        "engagement": {
            "scroll_fyp": 0.85, "like": 0.05, "comment": 0.01,
            "search_explore": 0.01, "follow": 0.00, "profile_visit": 0.01,
            "check_inbox": 0.02, "browse_following": 0.03,
            "browse_explore": 0.02, "browse_shop": 0.00,
        },
    },
    "exit": {
        "duration_range": (2, 3),
        "engagement": {
            "scroll_fyp": 0.94, "like": 0.04, "comment": 0.01,
            "search_explore": 0.00, "follow": 0.00, "profile_visit": 0.00,
            "check_inbox": 0.01, "browse_following": 0.00,
            "browse_explore": 0.00, "browse_shop": 0.00,
        },
    },
}

# --- Personality System (per-account, persistent, evolves over time) -----------
# Each trait has a (min, max) range. Initial value sampled randomly, then drifts
# slowly based on actual behavior (max PERSONALITY_DRIFT per session).
PERSONALITY_RANGES = {
    "reels_preference": (0.20, 0.80),     # IG: probability of choosing Reels over Feed
    "story_affinity": (0.05, 0.50),       # IG: probability of watching stories
    "double_tap_habit": (0.25, 0.90),     # TT+IG: probability of double-tap vs heart icon
    "explore_curiosity": (0.03, 0.20),    # TT+IG: base tendency to search/explore
    "boredom_rate": (0.06, 0.18),         # how fast boredom accumulates per passive scroll
    "boredom_relief": (0.25, 0.55),       # how much engagement (like/comment) reduces boredom
    "switch_threshold": (0.55, 0.85),     # boredom level that triggers IG view switch
    "comment_sociality": (0.15, 0.75),    # how much this account browses/reads comments (independent of commenting)
}

# Comment style per account (persistent, assigned on first load, not in PERSONALITY_RANGES because it's categorical)
# Styles: "reactor" = emotional reactions, "questioner" = asks questions,
#          "quoter" = quotes/references video, "hype" = hype/support
COMMENT_STYLES = ["reactor", "questioner", "quoter", "hype"]

PERSONALITY_DRIFT = 0.015  # max trait shift per session (~1.5%)

# --- Paths --------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "bot.db")
PLANS_DIR = os.path.join(DATA_DIR, "plans")
VIDEOS_DIR = os.path.join(DATA_DIR, "videos")
LOGS_DIR = os.path.join(DATA_DIR, "logs")

# Delivery module (existing, in Weekly & Daily Plan)
DELIVERY_MODULE_DIR = os.path.join(
    os.path.expanduser("~"), "Desktop", "Weekly & Daily Plan"
)
import sys
if DELIVERY_MODULE_DIR not in sys.path:
    sys.path.insert(0, DELIVERY_MODULE_DIR)

# Ensure dirs exist
for d in [DATA_DIR, PLANS_DIR, VIDEOS_DIR, LOGS_DIR]:
    os.makedirs(d, exist_ok=True)

# --- Telegram Alerts ----------------------------------------------------------
TELEGRAM_ALERT_BOT_TOKEN = os.getenv("PHONEBOT_TELEGRAM_TOKEN", "")
TELEGRAM_ALERT_CHAT_ID = os.getenv("PHONEBOT_TELEGRAM_CHAT", "")

# --- Timezone -----------------------------------------------------------------
TIMEZONE = "Europe/Rome" if TEST_MODE else "US/Eastern"
