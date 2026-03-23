"""Ryan Cole — AI Content Strategist agent configuration."""
import os
from zoneinfo import ZoneInfo

# --- Identity ---
AGENT_NAME = "Ryan Cole"
AGENT_BIO = (
    "Content strategist helping brands tell better stories. "
    "I write threads, blogs, emails, and ad copy that convert. "
    "Fast delivery, clear communication, no fluff."
)
AGENT_TIMEZONE = ZoneInfo("US/Eastern")

# --- AI Model ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyDvwh4rbEQu4TnsqmPukaC6wAqXiyINuv8")
GEMINI_MODEL = "gemini-2.0-flash"
# Premium model for high-value orders ($50+)
GEMINI_MODEL_PREMIUM = "gemini-2.0-flash"  # upgrade to Claude Sonnet when needed

# --- Telegram notifications ---
TELEGRAM_BOT_TOKEN = os.getenv("RYANCOLE_TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("RYANCOLE_TELEGRAM_CHAT", "")

# --- Platforms (enable/disable) ---
PLATFORMS = {
    "fiverr": True,
    "freelancer": True,
    "peopleperhour": True,
    "textbroker": True,
    "scripted": True,
    "contra": True,
}

# --- Cookies directory ---
COOKIES_DIR = os.path.join(os.path.dirname(__file__), "state", "cookies")
DB_PATH = os.path.join(os.path.dirname(__file__), "state", "ryan_cole.db")

# --- Schedule (ET times) ---
SCHEDULE = {
    "morning_start": "06:00",
    "morning_end": "09:00",
    "day_start": "09:00",
    "day_end": "17:00",
    "evening_start": "17:00",
    "evening_end": "22:00",
    # Night: inbox monitoring only
}

# --- Rate limits (per platform per day) ---
RATE_LIMITS = {
    "fiverr_max_deliveries": 20,
    "freelancer_proposals": 20,
    "peopleperhour_proposals": 15,
    "textbroker_articles": 10,
    "scripted_articles": 10,
    "contra_applications": 10,
}

# --- Writing personality ---
WRITING_STYLE = {
    "tone": "direct, confident, casual but professional",
    "avoid": [
        "I'd be happy to help",
        "In today's fast-paced world",
        "Look no further",
        "game-changer",
        "leverage",
        "synergy",
        "deep dive",
    ],
    "rules": [
        "Never mention AI, ChatGPT, Claude, or any AI tool",
        "Write like a human who has opinions and experience",
        "Use contractions (I'm, don't, can't)",
        "Occasional typo in casual messages (not in deliverables)",
        "Short paragraphs, punchy sentences",
        "Start with the point, not with filler",
    ],
}
