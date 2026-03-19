"""Gemini Vision integration -- the bot's brain for intelligent decisions.

Used for:
- Contextual comments (reads video caption/content, writes natural comment)
- Error handling (detects popups, captchas, unexpected screens)
- Content categorization (what type of video is this?)
- Finding dynamic UI elements in upload flows (via find_element_by_vision)
Routine navigation uses coordinate maps (core/coords.py) -- free and instant.
"""
import base64
import collections
import json
import logging
import math
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Optional

import google.generativeai as genai

from .. import config

log = logging.getLogger(__name__)

# --- Shared executor for hard timeouts on generate_content() calls ---
_executor = ThreadPoolExecutor(max_workers=3)

# --- Circuit breaker state ---
_timeout_timestamps: collections.deque = collections.deque(maxlen=10)
_circuit_open_until: float = 0.0
_cb_lock = threading.Lock()
_CB_THRESHOLD = 3       # timeouts within window to trip
_CB_WINDOW = 300         # 5 minutes
_CB_COOLDOWN = 120       # 2 minutes


def _check_circuit() -> bool:
    """Return True if circuit is open (calls should be skipped)."""
    with _cb_lock:
        if _circuit_open_until > 0 and time.monotonic() < _circuit_open_until:
            return True
        return False


def _record_timeout():
    """Record a timeout event. Opens circuit if threshold reached."""
    with _cb_lock:
        now = time.monotonic()
        _timeout_timestamps.append(now)
        # Count recent timeouts within window
        cutoff = now - _CB_WINDOW
        recent = sum(1 for t in _timeout_timestamps if t > cutoff)
        if recent >= _CB_THRESHOLD:
            global _circuit_open_until
            _circuit_open_until = now + _CB_COOLDOWN
            log.warning("Gemini circuit breaker OPEN: %d timeouts in %ds, cooldown %ds",
                        recent, _CB_WINDOW, _CB_COOLDOWN)


def _record_success():
    """Record a successful call. Clears timeout history."""
    with _cb_lock:
        _timeout_timestamps.clear()
        global _circuit_open_until
        if _circuit_open_until > 0:
            log.info("Gemini circuit breaker CLOSED (success)")
            _circuit_open_until = 0.0


def _hw_delay(median: float, sigma: float = 0.3, lo: float = 0.1, hi: float = 5.0) -> float:
    """Log-normal delay for natural timing variation."""
    val = random.lognormvariate(math.log(max(median, 0.01)), sigma)
    return max(lo, min(hi, val))


# Rate limiting: paid tier allows 2000 RPM, but we still add a small
# interval to avoid hammering the API and to look natural (bot shouldn't
# make instant back-to-back AI calls)
_last_call_time = 0
_MIN_INTERVAL = 0.5  # seconds between API calls (paid tier, minimal delay)
_rate_lock = threading.Lock()  # thread-safe rate limiting for prefetch threads
_initialized = False


def _init():
    global _initialized
    if _initialized:
        return
    if config.GEMINI["api_key"]:
        genai.configure(api_key=config.GEMINI["api_key"])
        _initialized = True


def _rate_limit():
    global _last_call_time
    with _rate_lock:
        now = time.time()
        elapsed = now - _last_call_time
        if elapsed < _MIN_INTERVAL:
            time.sleep(_MIN_INTERVAL - elapsed)
        _last_call_time = time.time()


def _compress_image(image_bytes: bytes) -> tuple:
    """Compress screenshot for faster API calls. Returns (bytes, mime_type).
    Resizes to 75% and converts to JPEG quality 85 (preserves thin UI elements
    like tab underlines, story progress bars, small text).
    Handles RGBA screenshots (Android screencap) by converting to RGB first."""
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(image_bytes))
        # Android screencap produces RGBA, JPEG requires RGB
        if img.mode == "RGBA":
            img = img.convert("RGB")
        w, h = img.size
        new_w, new_h = int(w * 0.75), int(h * 0.75)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), "image/jpeg"
    except Exception:
        return image_bytes, "image/png"


def _call_vision(image_bytes: bytes, prompt: str, max_tokens: int = 256,
                  urgent: bool = False, temperature: float = 0.7,
                  response_mime_type: str = None,
                  timeout: float = 10.0,
                  retry_backoff: float = 1.0,
                  compress: bool = True) -> str:
    """Send a screenshot + prompt to Gemini Vision and return the response.
    Uses ThreadPoolExecutor for hard timeout on generate_content().
    Circuit breaker skips call if API is repeatedly timing out.
    Retries once on failure with configurable backoff."""
    _init()
    if _check_circuit():
        log.warning("Gemini circuit breaker open -- skipping vision call")
        return ""
    if not urgent:
        _rate_limit()

    compressed, mime = image_bytes, "image/png"
    model = genai.GenerativeModel(config.GEMINI["model"])
    image_part = {
        "mime_type": mime,
        "data": compressed,
    }

    gen_config = {"max_output_tokens": max_tokens, "temperature": temperature}
    if response_mime_type:
        gen_config["response_mime_type"] = response_mime_type

    for attempt in range(2):
        try:
            future = _executor.submit(
                model.generate_content,
                [prompt, image_part],
                generation_config=gen_config,
                request_options={"timeout": timeout},
            )
            response = future.result(timeout=timeout)
            _record_success()
            return response.text.strip()
        except FuturesTimeoutError:
            future.cancel()
            _record_timeout()
            backoff = _hw_delay(1.0, 0.4, 0.5, 3.0)
            if attempt == 0:
                log.warning("Gemini vision hard timeout (%.1fs), retrying in %.1fs", timeout, backoff)
                time.sleep(backoff)
            else:
                log.error("Gemini vision hard timeout after retry")
        except Exception as e:
            backoff = _hw_delay(1.0, 0.4, 0.5, 3.0)
            if attempt == 0:
                log.warning("Gemini vision call failed (retrying in %.1fs): %s", backoff, e)
                time.sleep(backoff)
            else:
                log.error("Gemini vision call failed after retry: %s", e)
    return ""


def _call_multi_vision(images: list[bytes], prompt: str, max_tokens: int = 256,
                       temperature: float = 0.8,
                       retry_backoff: float = 1.0,
                       timeout: float = 15.0) -> str:
    """Send multiple screenshots + prompt to Gemini Vision.
    Uses ThreadPoolExecutor for hard timeout. Circuit breaker aware."""
    _init()
    if _check_circuit():
        log.warning("Gemini circuit breaker open -- skipping multi-vision call")
        return ""
    _rate_limit()

    model = genai.GenerativeModel(config.GEMINI["model"])
    parts = [prompt]
    for img_bytes in images:
        compressed, mime = _compress_image(img_bytes)
        parts.append({"mime_type": mime, "data": compressed})

    for attempt in range(2):
        try:
            future = _executor.submit(
                model.generate_content,
                parts,
                generation_config={"max_output_tokens": max_tokens, "temperature": temperature},
                request_options={"timeout": timeout},
            )
            response = future.result(timeout=timeout)
            _record_success()
            return response.text.strip()
        except FuturesTimeoutError:
            future.cancel()
            _record_timeout()
            backoff = _hw_delay(1.0, 0.4, 0.5, 3.0)
            if attempt == 0:
                log.warning("Gemini multi-vision hard timeout (%.1fs), retrying", timeout)
                time.sleep(backoff)
            else:
                log.error("Gemini multi-vision hard timeout after retry")
        except Exception as e:
            backoff = _hw_delay(1.0, 0.4, 0.5, 3.0)
            if attempt == 0:
                log.warning("Gemini multi-vision call failed (retrying in %.1fs): %s", backoff, e)
                time.sleep(backoff)
            else:
                log.error("Gemini multi-vision call failed after retry: %s", e)
    return ""


def _call_text(prompt: str, max_tokens: int = 256, timeout: float = 10.0) -> str:
    """Text-only Gemini call (no screenshot needed).
    Uses ThreadPoolExecutor for hard timeout. Circuit breaker aware."""
    _init()
    if _check_circuit():
        log.warning("Gemini circuit breaker open -- skipping text call")
        return ""
    _rate_limit()

    model = genai.GenerativeModel(config.GEMINI["model"])
    for attempt in range(2):
        try:
            future = _executor.submit(
                model.generate_content,
                prompt,
                generation_config={"max_output_tokens": max_tokens, "temperature": 0.8},
                request_options={"timeout": timeout},
            )
            response = future.result(timeout=timeout)
            _record_success()
            return response.text.strip()
        except FuturesTimeoutError:
            future.cancel()
            _record_timeout()
            backoff = _hw_delay(2.0, 0.4, 1.0, 5.0)
            if attempt == 0:
                log.warning("Gemini text hard timeout (%.1fs), retrying in %.1fs", timeout, backoff)
                time.sleep(backoff)
            else:
                log.error("Gemini text hard timeout after retry")
        except Exception as e:
            backoff = _hw_delay(2.0, 0.4, 1.0, 5.0)
            if attempt == 0:
                log.warning("Gemini text call failed (retrying in %.1fs): %s", backoff, e)
                time.sleep(backoff)
            else:
                log.error("Gemini text call failed after retry: %s", e)
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
        data = json.loads(result)
        log.info("CATEGORIZE_VIDEO: %s - %s (engage=%s mood=%s)",
                 data.get("category"), data.get("description", "")[:30],
                 data.get("engagement_worthy"), data.get("mood"))
        return data
    except (json.JSONDecodeError, ValueError):
        log.warning("CATEGORIZE_VIDEO: parse failed")
        return {"category": "unknown", "description": "", "engagement_worthy": False, "mood": "unknown"}


def generate_comment(screenshot_bytes: bytes, platform: str = "tiktok") -> str:
    """Legacy single-frame comment. Kept as fallback if multi-frame fails."""
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

    comment = _call_vision(screenshot_bytes, prompt, max_tokens=60)
    log.info("COMMENT_SINGLE: '%s'", (comment or "")[:40])
    return comment


def generate_comment_v2(video_frames: list[bytes], comment_frames: list[bytes],
                        platform: str = "tiktok", style: str = "reactor") -> str:
    """Generate a contextual comment using multi-frame video understanding + visible comments.

    Args:
        video_frames: 3 screenshots of the video at ~0s, ~2s, ~4s (first one has caption visible)
        comment_frames: 1-3 screenshots of the comments section (scrolled at different depths)
        platform: "tiktok" or "instagram"
        style: personality comment style ("reactor", "questioner", "quoter", "hype")

    Returns:
        A natural, human-sounding comment string, or "" on failure.
    """
    style_guide = {
        "reactor": (
            "You are an EMOTIONAL REACTOR. You react viscerally to what you see.\n"
            "Examples: 'the way she did that im DEAD', 'NOT THE AUDACITY', "
            "'i cant with this omg', 'this just ruined my whole day', "
            "'the scream i just let out', 'NO BECAUSE WHY IS THIS SO REAL'"
        ),
        "questioner": (
            "You are a CURIOUS QUESTIONER. You ask genuine questions about what you see.\n"
            "Examples: 'wait how did you do that', 'whats the song called??', "
            "'where is this i need to go', 'does this actually work tho', "
            "'how long did this take you', 'can someone explain the ending'"
        ),
        "quoter": (
            "You are a QUOTER. You reference or quote specific moments from the video.\n"
            "Examples: 'he really said that with a straight face', "
            "'\"im fine\" GIRL NO YOURE NOT', 'the part where she looked back tho', "
            "'that transition at 0:03 was insane', 'the face he made when she said it'"
        ),
        "hype": (
            "You are a HYPE PERSON. You support and gas up the creator.\n"
            "Examples: 'this goes so hard', 'underrated fr', 'more of this pls', "
            "'you never miss', 'this deserves way more views', "
            "'the talent is actually insane', 'why is nobody talking about this'"
        ),
    }

    style_instruction = style_guide.get(style, style_guide["reactor"])

    # Count total images for the prompt
    n_video = len(video_frames)
    n_comments = len(comment_frames)

    prompt = f"""You are a real person scrolling {platform}. You just watched a video and browsed the comments.

I'm sending you {n_video + n_comments} screenshots in this order:
- Frames 1-{n_video}: The VIDEO at different moments (~2 seconds apart). Frame 1 has the caption/description visible at the bottom.
- Frames {n_video + 1}-{n_video + n_comments}: The COMMENTS section at different scroll depths. Comments with more likes = what resonated with people.

YOUR STYLE:
{style_instruction}

RULES:
- Write ONE comment, max 60 characters
- Sound like a real young person on {platform} — casual, genuine, unpolished
- Your comment must be SPECIFIC to THIS video's content. Reference what you actually saw happening across the frames
- Read the caption text visible in Frame 1 — it gives you context about what the video is about
- Look at what other commenters are saying for TONE (not to copy them). Match the vibe of the comments section
- If comments are funny, be funny. If emotional, be supportive. If chaotic, be chaotic
- Do NOT repeat or paraphrase existing comments you see
- Use slang naturally (not forced). Abbreviations ok (fr, ngl, istg, imo, tbh, rn)
- Emoji usage: 60% no emoji, 30% one emoji, 10% two emoji max
- NEVER write generic comments (nice, cool, wow, love this, so good, amazing)
- NEVER start with "I" — vary your sentence structure
- Capitalization: mostly lowercase. ALL CAPS only for emphasis on 1-2 words max
- No periods at the end. Questions can have ? but not always

Return ONLY the comment text. Nothing else. No quotes around it."""

    all_frames = video_frames + comment_frames
    result = _call_multi_vision(all_frames, prompt, max_tokens=80, temperature=0.85)

    if not result:
        return ""

    # Clean up: remove quotes, markdown, extra whitespace
    result = result.strip().strip('"').strip("'").strip("`")
    # Remove any "Comment:" or similar prefix Gemini might add
    for prefix in ["Comment:", "comment:", "Reply:", "reply:"]:
        if result.startswith(prefix):
            result = result[len(prefix):].strip()

    # Enforce max length
    if len(result) > 80:
        result = result[:77].rsplit(" ", 1)[0]

    log.info("COMMENT_V2: style=%s text='%s'", style, (result or "")[:40])
    return result


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
        data = json.loads(result)
        log.info("SCREEN_STATE: screen=%s app=%s issue=%s",
                 data.get("screen"), data.get("app"), data.get("issue"))
        return data
    except (json.JSONDecodeError, ValueError):
        log.warning("SCREEN_STATE: parse failed")
        return {"screen": "unknown", "app": "unknown", "issue": None}


def identify_page_with_recovery(screenshot_bytes: bytes) -> dict:
    """Identify current TikTok page AND how to recover if wrong.

    Used as fallback when pixel detection is uncertain.
    Returns: {"page": "fyp/profile/search/comments/popup/other",
              "dismiss_action": "back" | "tap_x" | "tap_ok" | "none",
              "dismiss_target": null or "description of button to tap"}
    """
    prompt = """Look at this Android TikTok screenshot. Return ONLY a JSON object:
{
  "page": "fyp" or "profile" or "search" or "comments" or "popup" or "other",
  "has_popup": true or false,
  "popup_text": null or "what the popup says",
  "dismiss_action": "back" or "tap_x" or "tap_ok" or "tap_outside" or "none",
  "dismiss_target": null or "brief description of the close/dismiss button"
}
Rules:
- "fyp" = For You feed with full-screen video playing
- "profile" = someone's profile page with avatar, follower count, Follow/Message buttons, and video grid. This is a NORMAL page, NOT a popup. has_popup must be false for profile pages.
- "search" = search/discover page with results
- "comments" = comment overlay on a video (sheet covering bottom half with text comments)
- "popup" = ONLY unexpected modal overlays that block the screen with a dark backdrop: permission requests, promo modals covering the page, login prompts, age verification, cookie banners. NOT normal app pages.
- A profile page with Follow and Message buttons is NOT a popup.
- The TikTok Shop page (product grid, search bar, coupon banners, "Orders"/"Messages"/"Favorites") is NOT a popup — it is a normal page. has_popup must be false for shop pages.
- If popup: describe the dismiss button (X, OK, Close, Not Now, etc.)
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=120)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(result)
        # Normalize page name
        page = parsed.get("page", "unknown").lower().strip()
        if page not in ("fyp", "profile", "search", "comments", "popup", "other"):
            page = "unknown"
        # Hard-code: profile/search/comments/fyp pages are NEVER popups.
        # Gemini sometimes says has_popup=True on profiles (sees Follow/Message as popup buttons).
        has_popup = parsed.get("has_popup", False)
        if page in ("profile", "search", "comments", "fyp"):
            has_popup = False
        result = {
            "page": page,
            "has_popup": has_popup,
            "popup_text": parsed.get("popup_text") if has_popup else None,
            "dismiss_action": parsed.get("dismiss_action", "none") if has_popup else "none",
            "dismiss_target": parsed.get("dismiss_target") if has_popup else None,
        }
        log.info("PAGE_ID: page=%s popup=%s dismiss=%s target=%s",
                 page, result["has_popup"], result["dismiss_action"], result["dismiss_target"])
        return result
    except (json.JSONDecodeError, ValueError):
        log.warning("PAGE_ID: parse failed")
        return {"page": "unknown", "has_popup": False, "popup_text": None,
                "dismiss_action": "none", "dismiss_target": None}


def classify_screen_with_reference(screenshot_bytes: bytes) -> str:
    """Classify the current screen as story, sound, or other.

    Two-tier detection:
    1. Pixel check: detect Story progress bar at top of screen (instant, free).
       If high confidence -> return 'story' immediately without any Gemini call.
    2. Gemini fallback: single-image prompt classifying Story vs Sound vs Other.
       Only called when pixel check says no progress bar (covers Sound pages
       and edge cases where progress bar is not detected).

    Returns: 'story', 'sound', or 'other'.
    """
    from . import page_state

    # --- Tier 1: pixel-based Story progress bar detection (free, <5ms) ---
    bar_result = page_state.detect_story_progress_bar(screenshot_bytes)
    if bar_result["detected"] and bar_result["confidence"] >= 0.60:
        log.info("CLASSIFY_SCREEN: story (pixel progress bar, conf=%.2f, segments=%d)",
                 bar_result["confidence"], bar_result["segment_count"])
        return "story"

    # --- Tier 2: single-image Gemini classification ---
    prompt = """Look at this TikTok screenshot. What type of page is this?

STORY: Fullscreen photo/video content. Key indicators:
- Thin progress bar segments at the VERY TOP of the screen
- Small circular avatar + username at top-left
- "Message..." input bar or emoji reactions at the bottom
- X (close) button at top-right
- NO sidebar icons (heart, comment, bookmark, share) on the right side
- May have text overlays, stickers, emoji on the content

SOUND: A sound/music page with:
- "Find related content" search bar at top
- "Original Sound" text + "Add to Favorites" button
- Video grid thumbnails below
- "Add to Story" or "Use sound" buttons at bottom

OTHER: Any other page, including:
- FYP video (has sidebar icons: heart, comment, bookmark, share)
- LIVE stream (has floating hearts, viewer count, sidebar icons — NOT a Story)
- Profile, search, comments, inbox, shop, etc.

Answer ONLY one word: "story", "sound", or "other"."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=10, temperature=0.1, timeout=6.0)
    answer = result.strip().lower().replace('"', '').replace("'", "")
    # Normalize
    if answer.startswith("stor"):
        classification = "story"
    elif answer.startswith("sound"):
        classification = "sound"
    else:
        classification = "other"
    log.info("CLASSIFY_SCREEN: %s (gemini fallback, raw: %s)", classification, answer)
    return classification


def detect_fyp_layout(screenshot_bytes: bytes) -> dict:
    """Detect FYP layout features: bottom bar (search/playlist) and LIVE avatar.
    Uses a wireframe reference showing both indicators.
    Returns dict with:
      - has_bar: True if search/playlist/music bar above nav bar (shifts icons up ~60px)
      - is_live: True if avatar has red/pink LIVE circle (must NOT tap — opens live stream)
    """
    import os
    ref_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "public", "fyp_searchbar_ref.jpg")
    try:
        with open(ref_path, "rb") as f:
            ref_bytes = f.read()
    except FileNotFoundError:
        log.warning("FYP layout wireframe not found at %s", ref_path)
        return {"has_bar": False, "is_live": False}

    prompt = """I'm showing you TWO images.

IMAGE 1: A reference wireframe showing TWO TikTok FYP features to look for:
- LEFT layout: a BAR at the bottom of the screen, just ABOVE the navigation bar (search bar, playlist bar, music bar, or any banner)
- RIGHT layout: a RED/PINK CIRCLE around the creator's avatar on the right side with a "LIVE" badge, indicating the creator is currently live streaming

IMAGE 2: An actual TikTok screenshot from a phone.

Answer TWO questions about IMAGE 2:
1. Is there ANY bar or banner between the video content and the bottom navigation bar?
2. Does the creator's avatar have a RED or PINK glowing circle/ring around it with a "LIVE" badge? IMPORTANT: a BLUE or CYAN circle around the avatar means the creator has unwatched Stories — that is NOT live. Only a RED/PINK circle with "LIVE" text counts as live.

Answer ONLY in this exact format:
bar:yes/no
live:yes/no"""

    result = _call_multi_vision([ref_bytes, screenshot_bytes], prompt, max_tokens=15, temperature=0.2)
    lines = result.strip().lower().replace('"', '').replace("'", "")
    has_bar = False
    is_live = False
    for line in lines.split("\n"):
        line = line.strip()
        if line.startswith("bar:"):
            has_bar = "yes" in line
        elif line.startswith("live:"):
            is_live = "yes" in line
    log.info("FYP_LAYOUT: has_bar=%s, is_live=%s (raw: %s)", has_bar, is_live, lines.replace("\n", " | "))
    return {"has_bar": has_bar, "is_live": is_live}


def is_story_page(screenshot_bytes: bytes) -> bool:
    """Check if the current screen is a TikTok Story."""
    prompt = """Look at this Android TikTok screenshot. Is this a TikTok STORY?

A TikTok Story has these elements:
- Fullscreen photo or video content
- A small circular avatar and username at the TOP LEFT
- A thin progress bar at the very top of the screen
- A "Reply" or text input field at the bottom
- NO sidebar icons (heart, comment, bookmark) like on the FYP

Answer ONLY "yes" or "no". Nothing else."""
    result = _call_vision(screenshot_bytes, prompt, max_tokens=10, timeout=6.0)
    answer = result.strip().lower().replace('"', '').replace("'", "")
    is_st = answer.startswith("yes")
    log.info("IS_STORY: %s (raw: %s)", is_st, answer)
    return is_st


def is_profile_page(screenshot_bytes: bytes) -> bool:
    """Dedicated profile page check with specific prompt.
    More reliable than generic identify_page_with_recovery() which can confuse
    profile with FYP, especially after Story-to-profile transitions."""
    prompt = """Look at this Android TikTok screenshot. Is this a USER PROFILE page?

A profile page has MOST of these elements:
- Username and avatar at the top
- Follower/Following/Likes counts
- A bio section
- Follow and/or Message buttons
- A grid of video thumbnails below

Answer ONLY "yes" or "no". Nothing else."""
    result = _call_vision(screenshot_bytes, prompt, max_tokens=10, timeout=6.0)
    answer = result.strip().lower().replace('"', '').replace("'", "")
    is_prof = answer.startswith("yes")
    log.info("IS_PROFILE: %s (raw: %s)", is_prof, answer)
    return is_prof


def is_pymk_post(screenshot_bytes: bytes) -> bool:
    """Check if the current FYP item is a 'People You May Know' suggestion carousel.

    Called when find_sidebar_icons() returns None and the LIVE ring pixel check
    is also negative. Uses a single yes/no Gemini call (temp=0.1, max_tokens=5).

    Conservative default: ambiguous or empty responses return True (scroll past).
    Never returns True for LIVE streams, ads, or regular videos.
    """
    prompt = (
        "Is this a 'People you may know' post -- a photo carousel showing multiple "
        "profile cards with a Follow button for each person? "
        "Answer ONLY 'yes' or 'no'. "
        "Do NOT answer yes for: TikTok LIVE streams, video ads, regular videos, "
        "or any other content type."
    )
    result = _call_vision(
        screenshot_bytes, prompt,
        max_tokens=5, temperature=0.1, timeout=6.0,
    )
    answer = (result or "").strip().lower().replace('"', '').replace("'", "")
    if answer.startswith("n"):
        log.info("IS_PYMK: False (raw: %s)", answer)
        return False
    # "yes", ambiguous, empty, or parse failure -> scroll past (conservative)
    log.info("IS_PYMK: True (raw: %s)", answer)
    return True


def count_story_segments(screenshot_bytes: bytes) -> int:
    """Count the number of Story progress bar segments at the top of screen.

    Each segment = one Story from the creator. The progress bar is a thin
    horizontal bar at the very top of the Story screen, divided into segments.
    Calibrated position: y ~4.6% of screen height, spanning x 2.5%-93.3%.

    Returns segment count (0 if not in a Story or can't determine).
    """
    prompt = """Look at this TikTok Story screenshot. At the very top of the screen
(just below the status bar), there is a thin progress bar divided into segments.
Each segment represents one Story from this creator.

Count the number of distinct segments (separated by small gaps) in the progress bar.
If there is no progress bar visible, answer 0.

Answer ONLY a single number. Nothing else."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=5)
    try:
        count = int(result.strip())
        log.info("STORY_SEGMENTS: %d", count)
        return count
    except (ValueError, AttributeError):
        log.warning("STORY_SEGMENTS: could not parse '%s', defaulting to 1", result)
        return 1


def check_popup(screenshot_bytes: bytes, screen_w: int, screen_h: int,
                urgent: bool = False) -> dict:
    """Fast popup check: is there a popup? If yes, where to tap to dismiss?

    Single Gemini call optimized for speed (~80 tokens output).
    Used by PopupGuardian for continuous monitoring.

    Args:
        urgent: If True, skip rate limiting (for stall-triggered checks
                where the bot is blocked and needs an immediate answer).

    Returns:
        {"has_popup": bool,
         "popup_text": str or None,
         "dismiss_x": int or None,  # pixel x coordinate of dismiss button
         "dismiss_y": int or None,  # pixel y coordinate of dismiss button
         "dismiss_label": str or None}  # what the button says (OK, Accept, X, etc.)
    """
    prompt = f"""Screenshot is {screen_w}x{screen_h}. Is there a popup, dialog, or modal overlay BLOCKING the main content?

A popup is an UNEXPECTED MODAL OVERLAY that covers/blocks the page underneath. Examples:
- Permission dialogs (notifications, location, camera)
- Full-screen or half-screen promo modals (e.g. "Unwrap your deal" covering the whole page)
- Login/signup prompts blocking the screen
- Age verification dialogs
- Cookie consent banners
- System alerts
- "Accept Terms" or policy update dialogs

These are NOT popups — they are NORMAL pages/elements. NEVER report these as popups:
- A user's profile page with Follow/Message buttons
- The comments section open on a video
- The search/explore page
- The TikTok SHOP PAGE itself: product grid, search bar, "Orders"/"Messages"/"Favorites" icons, coupon banners ("30% off", "Claim" buttons), flash sale banners, category tabs — these are all NORMAL Shop page UI, NOT popups
- Any banner or button that is PART OF the page layout (not floating over it)
- Navigation bars (top tabs, bottom nav)
- Any standard TikTok or Instagram screen the user navigated to intentionally

KEY RULE: A popup MUST be a FLOATING LAYER that COVERS the page behind it with a semi-transparent dark backdrop or clearly overlays on top of the normal content. If the content fills the page normally without any overlay, there is NO popup.

If YES (a real modal overlay blocking content), find the DISMISS button (X, Close, Not now, Don't allow, Cancel, Skip, No thanks, Later, etc.).
Return the PIXEL coordinates of the CENTER of that dismiss button.
IMPORTANT: Point to a VISIBLE BUTTON on the popup itself, NOT empty space outside the popup.
If there is both a dismiss and accept button, prefer the DISMISS/CANCEL one.
If NO popup, return has_popup: false.

Return ONLY JSON:
{{"has_popup": true/false, "popup_text": "what it says" or null, "dismiss_x": 540 or null, "dismiss_y": 1200 or null, "dismiss_label": "OK" or null}}
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=80, urgent=urgent,
                          timeout=6.0, retry_backoff=0.5, compress=False)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        data = json.loads(result)
        has_popup = bool(data.get("has_popup", False))
        if has_popup:
            dx = data.get("dismiss_x")
            dy = data.get("dismiss_y")
            # Validate coordinates are within screen bounds
            if dx is not None and dy is not None:
                dx, dy = int(dx), int(dy)
                if not (0 < dx < screen_w and 0 < dy < screen_h):
                    dx, dy = None, None
            log.info("POPUP_CHECK: FOUND '%s' dismiss=(%s,%s) label=%s",
                     data.get("popup_text", "?"), dx, dy, data.get("dismiss_label"))
            return {
                "has_popup": True,
                "popup_text": data.get("popup_text"),
                "dismiss_x": dx,
                "dismiss_y": dy,
                "dismiss_label": data.get("dismiss_label"),
            }
        log.debug("POPUP_CHECK: CLEAR (no popup)")
        return {"has_popup": False, "popup_text": None,
                "dismiss_x": None, "dismiss_y": None, "dismiss_label": None}
    except (json.JSONDecodeError, ValueError, KeyError):
        log.warning("POPUP_CHECK: parse failed")
        return {"has_popup": False, "popup_text": None,
                "dismiss_x": None, "dismiss_y": None, "dismiss_label": None}


def classify_overlay(screenshot_bytes: bytes, screen_w: int, screen_h: int) -> dict:
    """Classify an overlay/popup into actionable types for the 3-tier handler.

    More detailed than check_popup(): identifies overlay TYPE and recommended ACTION
    so the handler knows whether to auto-dismiss, escalate to human, or degrade.

    Returns:
        {"type": str, "subtype": str, "dismiss_coords": [x,y] or None,
         "action": str, "description": str}

    Types: dismissible_safe, captcha_simple, captcha_complex, permission,
           account_warning, login_expired, unknown
    Actions: tap_dismiss, tap_to_verify, drag_slider, escalate
    """
    prompt = f"""Screenshot is {screen_w}x{screen_h}. There is an overlay/popup blocking the screen.
Classify it into EXACTLY ONE of these types:

- "dismissible_safe": promo popup, cookie banner, GDPR consent, notification permission,
  age verification, "Unwrap deal", "What's New" update popup, wind-down/break reminder,
  "Choose your interests" category selection, any popup with a clear X/Close/Not now/Skip/
  Cancel/Got it/Accept/OK button
- "captcha_simple": tap-to-verify ("I am not a robot"), drag slider to verify
- "captcha_puzzle": puzzle piece to slide into correct position (jigsaw-like)
- "captcha_rotate": image to rotate to correct orientation
- "captcha_complex": select matching images from grid, 3D shape matching
- "permission": system permission dialog (camera, microphone, location, contacts)
- "anr": Android system "App not responding" dialog with Wait/Close buttons
- "content_warning": "This post is age protected" or content warning overlay on a video
- "photosensitive_warning": full-screen overlay with a lightning bolt icon and warning
  text about seizures, flashing lights, or photosensitive epilepsy. Has exactly two
  buttons: one red/prominent labeled "Watch video" and one gray/secondary labeled
  "Skip all" or "Skip". This is NOT "content_warning" (different button labels, no
  lightning bolt).
- "account_warning": community guidelines warning, account restriction, phone/email verify
- "login_expired": login/signup screen, session expired, re-authentication needed
- "unknown": cannot classify

For each type, determine the ACTION:
- dismissible_safe/permission -> "tap_dismiss" (find the dismiss/cancel/OK button coords)
- captcha_simple with tap -> "tap_to_verify"
- captcha_simple with slider -> "drag_slider"
- captcha_puzzle -> "slide_puzzle" (find target position)
- captcha_rotate -> "rotate_image"
- anr -> "tap_wait" (find the Wait button coords)
- content_warning -> "swipe_skip" (swipe up to skip the video)
- photosensitive_warning -> "tap_skip_all" (find the gray "Skip all" button coords)
- captcha_complex/account_warning/login_expired/unknown -> "escalate"

Find the PIXEL coordinates of the dismiss/verify/wait button center if applicable.

Return ONLY JSON:
{{"type": "dismissible_safe", "subtype": "cookie_consent", "dismiss_coords": [540, 1200], "action": "tap_dismiss", "description": "what the overlay shows"}}
JSON only, no markdown."""

    try:
        result = _call_vision(screenshot_bytes, prompt, max_tokens=120,
                              temperature=0.1, timeout=6.0, retry_backoff=0.5,
                              compress=False)
        result = result.replace("```json", "").replace("```", "").strip()
        data = json.loads(result)

        overlay_type = data.get("type", "unknown")
        valid_types = {"dismissible_safe", "captcha_simple", "captcha_puzzle",
                       "captcha_rotate", "captcha_complex", "permission", "anr",
                       "content_warning", "photosensitive_warning",
                       "account_warning", "login_expired", "unknown"}
        if overlay_type not in valid_types:
            overlay_type = "unknown"

        coords = data.get("dismiss_coords")
        if coords and isinstance(coords, list) and len(coords) == 2:
            cx, cy = int(coords[0]), int(coords[1])
            if not (0 < cx < screen_w and 0 < cy < screen_h):
                coords = None
            else:
                coords = [cx, cy]
        else:
            coords = None

        log.info("CLASSIFY_OVERLAY: type=%s subtype=%s action=%s",
                 overlay_type, data.get("subtype"), data.get("action"))

        return {
            "type": overlay_type,
            "subtype": data.get("subtype", ""),
            "dismiss_coords": coords,
            "action": data.get("action", "escalate"),
            "description": data.get("description", ""),
        }
    except Exception as e:
        log.warning("CLASSIFY_OVERLAY: failed (%s), returning unknown", e)
        return {
            "type": "unknown",
            "subtype": "",
            "dismiss_coords": None,
            "action": "escalate",
            "description": str(e),
        }


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
                           screen_w: int, screen_h: int) -> Optional[tuple]:
    """Find a UI element using bounding box detection.

    Uses Gemini's official box_2d format with JSON response mode for maximum
    reliability. Temperature 0.1 for deterministic coordinate output.

    Returns (x, y, bbox_h) tuple — center coordinates + bbox height in pixels.
    Returns None if not found.
    """
    prompt = (
        f'Detect this UI element on the screenshot: "{description}"\n'
        'Return the bounding box as box_2d: [ymin, xmin, ymax, xmax] '
        'where each value is 0-1000 (normalized to image dimensions).\n'
        'Return JSON: {"box_2d": [ymin, xmin, ymax, xmax]}'
    )

    result = _call_vision(
        screenshot_bytes, prompt, max_tokens=150,
        temperature=0.1, timeout=8.0, retry_backoff=0.5,
    )

    try:
        result = result.replace("```json", "").replace("```", "").strip()
        # Gemini sometimes adds extra fields beyond box_2d, causing truncation.
        # Extract box_2d array even from partial/truncated JSON.
        import re
        box_match = re.search(r'"box_2d"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]', result)
        if box_match:
            box = [int(box_match.group(i)) for i in range(1, 5)]
        else:
            try:
                data = json.loads(result)
                box = data.get("box_2d")
            except json.JSONDecodeError:
                box = None
        if not box or len(box) != 4:
            log.info("Vision could not find '%s' (no box_2d)", description[:50])
            return None

        ymin, xmin, ymax, xmax = int(box[0]), int(box[1]), int(box[2]), int(box[3])

        # Filter out degenerate boxes (all zeros or near-zero area)
        if (ymax - ymin) < 3 and (xmax - xmin) < 3:
            log.info("Vision could not find '%s' (degenerate box)", description[:50])
            return None

        # Convert from 0-1000 normalized to pixel coordinates
        x = int((xmin + xmax) / 2 * screen_w / 1000)
        y = int((ymin + ymax) / 2 * screen_h / 1000)
        bbox_h = int((ymax - ymin) * screen_h / 1000)

        if 0 < x < screen_w and 0 < y < screen_h:
            log.info("Vision found '%s' at (%d, %d) [box_2d %d,%d,%d,%d] h=%dpx",
                     description[:50], x, y, ymin, xmin, ymax, xmax, bbox_h)
            return (x, y, bbox_h)

        log.warning("Vision bbox out of bounds: [%d,%d,%d,%d]", ymin, xmin, ymax, xmax)
    except (json.JSONDecodeError, ValueError, TypeError, KeyError) as e:
        log.warning("Vision parse error for '%s': %s (raw: %s)",
                    description[:40], e, (result or "")[:60])
    return None


def categorize_and_check_niche(screenshot_bytes: bytes,
                                niche_keywords: list[str] = None) -> dict:
    """Single Gemini call that does BOTH categorization AND niche check.
    Eliminates the need for separate categorize_video() + check_niche_content() calls.

    Returns: {"category": str, "description": str, "in_niche": bool, "confidence": float,
              "engagement_worthy": bool, "mood": str, "reason": str}
    """
    kw_hint = ""
    if niche_keywords:
        kw_hint = f"\nTarget niche keywords for reference: {', '.join(niche_keywords[:10])}"

    prompt = f"""Look at this TikTok/Instagram video screenshot. Do TWO things:

1. CATEGORIZE the video content (one word: cooking, dance, comedy, fashion, relationships, dating, drama, sports, music, pets, travel, fitness, education, other)
2. Determine if this content is about RELATIONSHIPS, DATING, LOVE, BREAKUPS, TOXIC BEHAVIOR, or COUPLE DYNAMICS

The target niche includes: toxic relationships, red flags, situationships, dating advice,
couples content, heartbreak, love advice, relationship drama, boyfriend/girlfriend content.{kw_hint}

Content NOT in niche: cooking, fitness, sports, gaming, pets, travel, random comedy
(unless comedy is specifically about relationships/dating).

IMPORTANT: Look at the FULL picture — not just the text/caption, but also:
- The creator's username and hashtags (visible at bottom)
- The visual content of the video itself
- If the video has relationship TEXT but the creator/hashtags suggest a different niche
  (e.g. dance, lifestyle, beauty), mark in_niche as FALSE.
A generic lifestyle creator posting a love quote is NOT in niche.

Return ONLY a JSON object:
{{"category": "one word", "description": "brief 5-word description", "in_niche": true/false, "confidence": 0.0-1.0, "engagement_worthy": true/false, "mood": "upbeat/chill/emotional/funny/boring", "reason": "brief 5-word reason for niche decision"}}
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=120)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        data = json.loads(result)
        data["in_niche"] = bool(data.get("in_niche", False))
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.0))))
        data["engagement_worthy"] = bool(data.get("engagement_worthy", False))
        data.setdefault("category", "unknown")
        data.setdefault("description", "")
        data.setdefault("mood", "unknown")
        data.setdefault("reason", "")
        log.info("NICHE_CHECK: %s in_niche=%s conf=%.2f reason=%s",
                 data["category"], data["in_niche"], data["confidence"], data.get("reason", ""))
        return data
    except (json.JSONDecodeError, ValueError, KeyError):
        log.warning("NICHE_CHECK: parse failed")
        return {"category": "unknown", "description": "", "in_niche": False,
                "confidence": 0.0, "engagement_worthy": False, "mood": "unknown",
                "reason": "parse error"}


def evaluate_niche_fit(screenshot_bytes: bytes,
                       niche_description: str,
                       niche_keywords: list[str],
                       context: str = "profile") -> dict:
    """Score how well a profile or video fits the target niche (0-100).

    For context="profile": COMBINED call that also verifies it's a profile page
    and checks which content tab is active. Returns 3 things in 1 Gemini call.

    For context="video": just scores the video content.

    Args:
        screenshot_bytes: screenshot of profile page or video
        niche_description: human description of the niche
        niche_keywords: list of niche keywords for reference
        context: "profile" or "video"

    Returns for "profile":
        {"score": 0-100, "reason": str, "is_profile": bool, "active_tab": "videos"|"reposts"|"likes"|"unknown"}

    Returns for "video":
        {"score": 0-100, "reason": str, "is_profile": False, "active_tab": "n/a"}
    """
    if context == "profile":
        prompt = (
            "You are looking at an Android screenshot. Do THREE things:\n\n"
            "1. IS THIS A PROFILE PAGE? A profile page has: username, avatar, "
            "follower/following counts, Follow/Message buttons, and a content grid below. "
            "Answer true or false.\n\n"
            "2. WHICH CONTENT TAB IS ACTIVE? Below the Follow/Message buttons there is a "
            "row of tab icons (grid/bars = videos, arrows = reposts, heart = likes). "
            "The active tab has a bold underline or darker icon. "
            'Answer "videos", "reposts", "likes", or "unknown".\n\n'
            "3. NICHE SCORE. Evaluate whether this profile fits the target niche.\n\n"
            f"TARGET NICHE: {niche_description}\n"
            f"Reference keywords: {', '.join(niche_keywords[:12])}\n\n"
            "SCORING RULES:\n"
            "- 80-100: Clearly in-niche. Bio mentions relationships/dating/love, OR video "
            "thumbnails show couple content, text about red flags, breakups, toxic behavior\n"
            "- 60-79: Probably in-niche. Relationship-adjacent, drama/storytime\n"
            "- 40-59: Ambiguous. Mixed or generic lifestyle content\n"
            "- 20-39: Probably NOT in niche. Mostly other topics\n"
            "- 0-19: Clearly NOT in niche. Pure cooking, sports, gaming, pets, tech\n\n"
            "IMPORTANT:\n"
            "- Bio text is the STRONGEST signal. Relationship keywords in bio = high score\n"
            "- Video thumbnail grid is secondary (text overlays, couple images)\n"
            "- Empty/new profiles with few videos: score 40-50\n"
            "- General drama/tea/gossip accounts: score 55-65\n\n"
            'Return ONLY JSON:\n'
            '{"is_profile": true/false, "active_tab": "videos"/"reposts"/"likes"/"unknown", '
            '"score": 0-100, "reason": "brief 8-word reason"}\n'
            "JSON only, no markdown."
        )
        result = _call_vision(screenshot_bytes, prompt, max_tokens=100, temperature=0.3, timeout=8.0)
        try:
            result = result.replace("```json", "").replace("```", "").strip()
            data = json.loads(result)
            score = max(0, min(100, int(data.get("score", 0))))
            reason = str(data.get("reason", ""))[:80]
            is_profile = bool(data.get("is_profile", False))
            active_tab = str(data.get("active_tab", "unknown")).lower().strip()
            if active_tab not in ("videos", "reposts", "likes"):
                active_tab = "unknown"
            log.info("NICHE_FIT: profile=%s tab=%s score=%d reason=%s",
                     is_profile, active_tab, score, reason)
            return {"score": score, "reason": reason,
                    "is_profile": is_profile, "active_tab": active_tab}
        except (json.JSONDecodeError, ValueError, KeyError):
            log.warning("NICHE_FIT: parse failed (raw: %s)", (result or "")[:60])
            return {"score": 0, "reason": "parse error",
                    "is_profile": False, "active_tab": "unknown"}
    else:
        # Video context — simple score only
        prompt = (
            "You are looking at a TikTok/Instagram VIDEO screenshot. "
            "Evaluate whether this video content fits the target niche.\n\n"
            f"TARGET NICHE: {niche_description}\n"
            f"Reference keywords: {', '.join(niche_keywords[:12])}\n\n"
            "SCORING RULES:\n"
            "- 80-100: Clearly in-niche (relationship/dating content)\n"
            "- 60-79: Probably in-niche (adjacent content)\n"
            "- 40-59: Ambiguous\n"
            "- 20-39: Probably NOT in niche\n"
            "- 0-19: Clearly NOT in niche\n\n"
            "Look at: video content, text overlays, caption, visual context.\n\n"
            'Return ONLY JSON:\n'
            '{"score": 0-100, "reason": "brief 8-word reason"}\n'
            "JSON only, no markdown."
        )
        result = _call_vision(screenshot_bytes, prompt, max_tokens=80, temperature=0.3, timeout=8.0)
        try:
            result = result.replace("```json", "").replace("```", "").strip()
            data = json.loads(result)
            score = max(0, min(100, int(data.get("score", 0))))
            reason = str(data.get("reason", ""))[:80]
            log.info("NICHE_FIT: video score=%d reason=%s", score, reason)
            return {"score": score, "reason": reason,
                    "is_profile": False, "active_tab": "n/a"}
        except (json.JSONDecodeError, ValueError, KeyError):
            log.warning("NICHE_FIT: parse failed (raw: %s)", (result or "")[:60])
            return {"score": 0, "reason": "parse error",
                    "is_profile": False, "active_tab": "n/a"}


def check_niche_content(screenshot_bytes: bytes, niche_keywords: list[str] = None) -> dict:
    """Check if the current video/profile is in the target niche (toxic relationships/dating).
    Used as a gate before liking or following -- only engage with in-niche content.

    Args:
        screenshot_bytes: screenshot of the current video or profile
        niche_keywords: optional list of niche keywords for context

    Returns:
        {"in_niche": bool, "confidence": float 0-1, "reason": str}
    """
    kw_hint = ""
    if niche_keywords:
        kw_hint = f"\nTarget niche keywords for reference: {', '.join(niche_keywords[:10])}"

    prompt = f"""Look at this TikTok/Instagram screenshot. Determine if this content is about
RELATIONSHIPS, DATING, LOVE, BREAKUPS, TOXIC BEHAVIOR, or COUPLE DYNAMICS.

The target niche includes: toxic relationships, red flags, situationships, dating advice,
couples content, heartbreak, love advice, relationship drama, boyfriend/girlfriend content.{kw_hint}

Content that is NOT in niche: cooking, fitness, sports, gaming, pets, travel, random comedy
(unless the comedy is specifically about relationships/dating).

Return ONLY a JSON object:
{{"in_niche": true/false, "confidence": 0.0-1.0, "reason": "brief 5-word reason"}}
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=80)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        data = json.loads(result)
        data["in_niche"] = bool(data.get("in_niche", False))
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.0))))
        return data
    except (json.JSONDecodeError, ValueError, KeyError):
        # On parse failure, default to NOT in niche (conservative -- don't engage)
        return {"in_niche": False, "confidence": 0.0, "reason": "parse error"}


def find_search_grid_thumbnails(screenshot_bytes: bytes,
                                screen_w: int, screen_h: int) -> list[dict]:
    """Find clickable video thumbnail positions in the search results grid.
    Called ONLY when the screen is stopped (never while scrolling).

    Returns list of dicts: [{"x": int, "y": int, "index": int}, ...]
    Each entry is the CENTER of a visible video thumbnail. Sorted top-to-bottom,
    left-to-right. Returns empty list if no thumbnails found.
    """
    prompt = f"""Look at this TikTok/Instagram search results screenshot ({screen_w}x{screen_h}).
The screen shows a GRID of video thumbnails (small rectangular preview images).

Find ALL visible video thumbnail tiles in the grid. For each one, return the CENTER
pixel coordinates. Ignore any thumbnails that are partially cut off at the edges.

Return ONLY a JSON array of objects, sorted top-to-bottom then left-to-right:
[{{"x": 180, "y": 400, "index": 0}}, {{"x": 540, "y": 400, "index": 1}}, ...]

If no thumbnails are visible, return: []
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=400, compress=False)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        data = json.loads(result)
        if not isinstance(data, list):
            return []
        valid = []
        for i, item in enumerate(data):
            x, y = int(item.get("x", 0)), int(item.get("y", 0))
            if 0 < x < screen_w and 0 < y < screen_h:
                valid.append({"x": x, "y": y, "index": i})
        log.info("Vision found %d search grid thumbnails", len(valid))
        return valid
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        log.warning("Vision search grid parse error: %s", e)
        return []


def find_comment_avatars(screenshot_bytes: bytes,
                         screen_w: int, screen_h: int) -> list[dict]:
    """Find commenter profile picture (avatar) positions in the comments section.
    Called ONLY when the screen is stopped on the comments sheet.

    Returns list of dicts: [{"x": int, "y": int, "index": int}, ...]
    Each entry is the CENTER of a commenter's circular avatar icon.
    Sorted top-to-bottom. Returns empty list if none found.
    """
    prompt = f"""Look at this TikTok/Instagram comments section screenshot ({screen_w}x{screen_h}).
The screen shows user comments with small circular PROFILE PICTURES (avatars) on the left
side of each comment.

Find the CENTER coordinates of each visible commenter's avatar (the small circular
profile picture). Do NOT include the main video creator's avatar or any reply avatars
that are indented/nested -- only top-level comment avatars.

Return ONLY a JSON array sorted top-to-bottom:
[{{"x": 50, "y": 300, "index": 0}}, {{"x": 50, "y": 480, "index": 1}}, ...]

If no avatars visible, return: []
JSON only, no markdown."""

    result = _call_vision(screenshot_bytes, prompt, max_tokens=300, compress=False)
    try:
        result = result.replace("```json", "").replace("```", "").strip()
        data = json.loads(result)
        if not isinstance(data, list):
            return []
        valid = []
        for i, item in enumerate(data):
            x, y = int(item.get("x", 0)), int(item.get("y", 0))
            if 0 < x < screen_w and 0 < y < screen_h:
                valid.append({"x": x, "y": y, "index": i})
        log.info("Vision found %d comment avatars", len(valid))
        return valid
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        log.warning("Vision comment avatars parse error: %s", e)
        return []


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


def identify_active_top_tab(screenshot_bytes: bytes) -> str:
    """Identify which TikTok top tab is currently active/selected.

    Sends TWO images to Gemini:
    1. Reference wireframe (all tabs inactive/equal)
    2. Cropped screenshot (top 8% = tab bar with one tab bold/underlined)
    Gemini compares and identifies the different/active tab.

    Returns one of: "foryou", "following", "explore", "shop", "unknown".
    """
    import os
    from PIL import Image
    import io as _io

    # Load reference wireframe (all tabs inactive)
    ref_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                            "public", "WhatsApp Image 2026-03-16 at 11.18.28 PM (1)(1).jpg")
    try:
        with open(ref_path, "rb") as f:
            ref_bytes = f.read()
    except FileNotFoundError:
        log.warning("Tab bar reference not found at %s", ref_path)
        ref_bytes = None

    # Crop screenshot to top tab bar only (~8%)
    try:
        img = Image.open(_io.BytesIO(screenshot_bytes))
        w, h = img.size
        cropped = img.crop((0, 0, w, int(h * 0.08)))
        buf = _io.BytesIO()
        cropped.save(buf, format="PNG")
        tab_bar_bytes = buf.getvalue()
    except Exception:
        tab_bar_bytes = screenshot_bytes

    if ref_bytes:
        # Multi-image comparison (more reliable)
        prompt = """I'm showing you TWO images.

IMAGE 1: A reference showing the TikTok top tab bar with ALL tabs inactive (same style).
IMAGE 2: The actual tab bar from a phone. ONE tab is ACTIVE — it looks different (bolder, underlined, or highlighted).

Which tab in IMAGE 2 is the active/different one compared to IMAGE 1?
Answer ONLY one word: foryou, following, explore, shop, or unknown."""

        result = _call_multi_vision([ref_bytes, tab_bar_bytes], prompt, max_tokens=10, temperature=0.2)
    else:
        # Fallback: single image
        prompt = """This image shows the TikTok top tab bar.
One tab is ACTIVE (bolder, underlined). Which one?
Answer ONLY one word: foryou, following, explore, shop, or unknown."""
        result = _call_vision(tab_bar_bytes, prompt, max_tokens=10)
    answer = result.strip().lower().replace('"', '').replace("'", "").replace(".", "")

    # Normalize common variations
    if "foryou" in answer or "for you" in answer or "for_you" in answer or answer == "fyp":
        return "foryou"
    elif "following" in answer or "follow" in answer:
        return "following"
    elif "explore" in answer:
        return "explore"
    elif "shop" in answer:
        return "shop"
    else:
        log.info("ACTIVE_TAB: unknown response: '%s'", answer)
        return "unknown"
