"""Gemini Vision integration — the bot's brain for intelligent decisions.

Used for:
- Contextual comments (reads video caption/content, writes natural comment)
- Error handling (detects popups, captchas, unexpected screens)
- Content categorization (what type of video is this?)
NOT used for finding buttons (that's done by UI tree parsing — free and fast).
"""
import base64
import json
import logging
import time
from typing import Optional

import google.generativeai as genai

from .. import config

log = logging.getLogger(__name__)

# Rate limiting: max ~10 calls/minute for free tier
_last_call_time = 0
_MIN_INTERVAL = 6.0  # seconds between API calls


def _init():
    if config.GEMINI["api_key"]:
        genai.configure(api_key=config.GEMINI["api_key"])


def _rate_limit():
    global _last_call_time
    now = time.time()
    elapsed = now - _last_call_time
    if elapsed < _MIN_INTERVAL:
        time.sleep(_MIN_INTERVAL - elapsed)
    _last_call_time = time.time()


def _call_vision(image_bytes: bytes, prompt: str, max_tokens: int = 256) -> str:
    """Send a screenshot + prompt to Gemini Vision and return the response."""
    _init()
    _rate_limit()

    model = genai.GenerativeModel(config.GEMINI["model"])
    image_part = {
        "mime_type": "image/png",
        "data": image_bytes,
    }

    try:
        response = model.generate_content(
            [prompt, image_part],
            generation_config={"max_output_tokens": max_tokens, "temperature": 0.7},
        )
        return response.text.strip()
    except Exception as e:
        log.error("Gemini API error: %s", e)
        return ""


def _call_text(prompt: str, max_tokens: int = 256) -> str:
    """Text-only Gemini call (no screenshot needed)."""
    _init()
    _rate_limit()

    model = genai.GenerativeModel(config.GEMINI["model"])
    try:
        response = model.generate_content(
            prompt,
            generation_config={"max_output_tokens": max_tokens, "temperature": 0.8},
        )
        return response.text.strip()
    except Exception as e:
        log.error("Gemini API error: %s", e)
        return ""


# =============================================================================
# Public API
# =============================================================================

def categorize_video(screenshot_bytes: bytes) -> dict:
    """Look at current TikTok/IG video and categorize it.
    Returns: {"category": "cooking", "description": "pasta recipe tutorial",
              "engagement_worthy": true, "mood": "upbeat"}
    """
    prompt = """Look at this TikTok/Instagram video screenshot. Return ONLY a JSON object:
{
  "category": "one word category (cooking, dance, comedy, fashion, sports, music, pets, travel, fitness, education, other)",
  "description": "brief 5-word description of the content",
  "engagement_worthy": true/false (would a real person find this interesting enough to like?),
  "mood": "upbeat/chill/emotional/funny/boring"
}
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt)
    try:
        # Clean markdown fences if present
        result = result.replace("```json", "").replace("```", "").strip()
        return json.loads(result)
    except (json.JSONDecodeError, ValueError):
        return {"category": "unknown", "description": "", "engagement_worthy": False, "mood": "unknown"}


def generate_comment(screenshot_bytes: bytes, platform: str = "tiktok") -> str:
    """Generate a contextual comment for the current video.
    Reads the video content and writes a natural, human-sounding comment."""
    prompt = f"""Look at this {platform} video screenshot. Write ONE short comment (max 50 chars)
that a real person would write. Rules:
- Sound casual and genuine, like a real young person
- Match the video's mood (funny video = funny comment, emotional = supportive)
- Use slang naturally (not forced)
- 70% chance of NO emojis, 30% one emoji max
- NEVER be generic ("nice", "cool", "wow"). Be SPECIFIC to what you see
- Examples of good comments: "the way she flipped that omg", "this recipe goes crazy",
  "bro really said that with a straight face"
Return ONLY the comment text, nothing else."""

    return _call_vision(screenshot_bytes, prompt, max_tokens=60)


def detect_screen_state(screenshot_bytes: bytes) -> dict:
    """Analyze screenshot to detect current app state and any issues.
    Returns: {"screen": "fyp/profile/search/upload/popup/captcha/error/unknown",
              "app": "tiktok/instagram/home/other",
              "issue": null or "description of problem"}
    """
    prompt = """Look at this Android screenshot. Return ONLY a JSON object:
{
  "screen": "fyp" or "profile" or "search" or "upload" or "comments" or "popup" or "captcha" or "login" or "error" or "home_screen" or "other",
  "app": "tiktok" or "instagram" or "home" or "other",
  "issue": null or "brief description of any problem/popup/error visible"
}
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=100)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        return json.loads(result)
    except (json.JSONDecodeError, ValueError):
        return {"screen": "unknown", "app": "unknown", "issue": None}


def generate_caption(platform: str = "tiktok", niche: str = "general") -> str:
    """Generate a post caption with hashtags.
    Used as fallback if no caption comes from Content Library."""
    prompt = f"""Write a {platform} video caption for a {niche} account. Rules:
- 1-2 short sentences, casual tone
- 3-5 relevant hashtags
- Sound authentic, not salesy
- Max 150 characters total including hashtags
Return ONLY the caption text."""

    return _call_text(prompt, max_tokens=80)


def find_element_by_vision(screenshot_bytes: bytes, description: str,
                           screen_w: int, screen_h: int) -> Optional[tuple[int, int]]:
    """Vision fallback: find a UI element by visual description.
    Returns (x, y) center coordinates or None if not found.
    Used when UI tree can't find the element (e.g. after app update)."""
    prompt = f"""Look at this Android screenshot ({screen_w}x{screen_h} resolution).
Find the UI element: "{description}"
Return ONLY a JSON object with the pixel coordinates of its CENTER:
{{"x": 540, "y": 1200, "found": true}}
If you cannot find it:
{{"x": 0, "y": 0, "found": false}}
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=60)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        data = json.loads(result)
        if data.get("found"):
            x, y = int(data["x"]), int(data["y"])
            # Sanity check: coordinates must be within screen bounds
            if 0 < x < screen_w and 0 < y < screen_h:
                log.info("Vision found '%s' at (%d, %d)", description, x, y)
                return (x, y)
            log.warning("Vision returned out-of-bounds coords: (%d, %d)", x, y)
        else:
            log.info("Vision could not find '%s'", description)
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        log.warning("Vision parse error for '%s': %s", description, e)
    return None


def should_engage(screenshot_bytes: bytes, fatigue_level: float = 0.0) -> dict:
    """Quick decision: should the bot engage with this video?
    Used sparingly (only when categorize_video isn't enough).
    Returns: {"like": bool, "comment": bool, "follow": bool, "reason": str}
    """
    prompt = f"""Look at this video. You're a casual {'' if fatigue_level < 0.3 else 'tired '}user scrolling.
Would you like it, comment, or follow? Return JSON:
{{"like": true/false, "comment": true/false, "follow": true/false, "reason": "brief why"}}
JSON only."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=80)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        return json.loads(result)
    except (json.JSONDecodeError, ValueError):
        return {"like": False, "comment": False, "follow": False, "reason": "parse error"}
