"""Coordinate maps for TikTok and Instagram UI elements.

Replaces uiautomator dump -- zero detectable process on the device.
All coordinates are proportional: (screen_w, screen_h) -> (x, y).
Resolution-independent across phone models (720p, 1080p, etc.).

For complex/dynamic flows (upload posting, camera trick), use Gemini Vision.
"""

# =============================================================================
# Dynamic nav bar Y — set by page_state.set_screen_params() at init time
# =============================================================================
_nav_y = 0.943  # default, overridden by set_nav_y() for each phone's density

def set_nav_y(y: float):
    """Override nav bar Y ratio. Called from page_state.set_screen_params()."""
    global _nav_y
    _nav_y = y


# =============================================================================
# TikTok Coordinate Map
# =============================================================================

TIKTOK = {
    # --- Bottom Navigation Bar (5 tabs, evenly spaced) ---
    # Y position is computed per-phone from density via set_nav_y()
    # IMPORTANT: All phones MUST have gesture navigation (not 3-button) in Settings
    "nav_home":         lambda w, h: (int(w * 0.10), int(h * _nav_y)),
    "nav_friends":      lambda w, h: (int(w * 0.30), int(h * _nav_y)),
    "nav_create":       lambda w, h: (int(w * 0.50), int(h * _nav_y)),
    "nav_inbox":        lambda w, h: (int(w * 0.70), int(h * _nav_y)),
    "nav_profile":      lambda w, h: (int(w * 0.90), int(h * _nav_y)),

    # --- Right-Side Engagement Panel (FYP/video view) ---
    # Calibrated 2026-03-16 for GESTURE navigation (Motorola 720x1600)
    # Icons are dp-anchored from bottom, NOT proportional to screen height
    # These values vary per phone aspect ratio — fallback only, Gemini bbox is primary
    # NOTE: position varies ~90px per video depending on caption/music/playlist bar
    "avatar":           lambda w, h: (int(w * 0.92), int(h * 0.507)),
    "like_icon":        lambda w, h: (int(w * 0.92), int(h * 0.583)),
    "comment_icon":     lambda w, h: (int(w * 0.92), int(h * 0.647)),
    "bookmark_icon":    lambda w, h: (int(w * 0.92), int(h * 0.714)),
    "share_icon":       lambda w, h: (int(w * 0.92), int(h * 0.777)),

    # --- Story Header (top-left, avatar/username to enter profile from Story) ---
    "story_avatar":     lambda w, h: (int(w * 0.065), int(h * 0.08)),

    # --- Content Area ---
    "video_center":     lambda w, h: (int(w * 0.45), int(h * 0.45)),
    # Username: bold white text at bottom-left. Verified 2026-03-14 on 2 real screenshots:
    # MC DIY at y=1328 (0.830), Innovation Marble at y=1344 (0.840). Using 0.833 center.
    "username":         lambda w, h: (int(w * 0.139), int(h * 0.833)),
    "caption_area":     lambda w, h: (int(w * 0.35), int(h * 0.870)),

    # --- Top Tab Bar (horizontal tabs, calibrated 2026-03-16 from 720x1600) ---
    # Order: LIVE / Explore / Bari / Following / Shop / For You / Search icon
    # All tabs at y=0.059h. Gemini bbox is primary detection, these are fallback
    "top_tab_explore":   lambda w, h: (int(w * 0.222), int(h * 0.059)),
    "top_tab_following": lambda w, h: (int(w * 0.479), int(h * 0.059)),
    "top_tab_shop":      lambda w, h: (int(w * 0.625), int(h * 0.059)),
    "top_tab_foryou":    lambda w, h: (int(w * 0.764), int(h * 0.059)),

    # --- Story Navigation (inside a Story, calibrated 2026-03-16) ---
    "story_tap_next":    lambda w, h: (int(w * 0.833), int(h * 0.50)),   # tap right = next Story
    "story_tap_prev":    lambda w, h: (int(w * 0.167), int(h * 0.50)),   # tap left = previous Story
    "story_close":       lambda w, h: (int(w * 0.917), int(h * 0.081)),  # X button top-right
    "live_x_close":      lambda w, h: (int(w * 0.93), int(h * 0.032)),   # X button top-right in LIVE streams (y=71px S9, y=51px Motorola)

    # --- Stories Carousel (Following tab / Inbox, calibrated 2026-03-16) ---
    # Circle centers at y=0.131h, spaced evenly. First is "Create" (skip), rest are Stories
    "stories_carousel_1": lambda w, h: (int(w * 0.364), int(h * 0.131)),  # first Story (after Create)
    "stories_carousel_2": lambda w, h: (int(w * 0.601), int(h * 0.131)),  # second Story
    "stories_carousel_3": lambda w, h: (int(w * 0.833), int(h * 0.131)),  # third Story

    # --- Inbox Sub-sections (calibrated 2026-03-16) ---
    "inbox_new_followers": lambda w, h: (int(w * 0.319), int(h * 0.306)),
    "inbox_activity":      lambda w, h: (int(w * 0.271), int(h * 0.394)),

    # --- Top Bar (on FYP) ---
    "search_icon":      lambda w, h: (int(w * 0.96), int(h * 0.036)),

    # --- Search Page ---
    # Verified from Motorola 720x1600 screenshot (2026-03-13)
    "search_bar":       lambda w, h: (int(w * 0.47), int(h * 0.056)),
    "search_clear":     lambda w, h: (int(w * 0.826), int(h * 0.056)),  # X button inside search field

    # --- Search Results Grid (2 columns) ---
    # Verified from Motorola 720x1600 screenshot (2026-03-13)
    # Tab row (Top/Videos/Photos/Users/Sounds/Shop) at ~y=0.105
    # Row 1 thumbnails: y=0.125 to y=0.475, Row 2: y=0.575 to y=0.925
    "search_grid_1":    lambda w, h: (int(w * 0.243), int(h * 0.30)),   # row 1 left
    "search_grid_2":    lambda w, h: (int(w * 0.729), int(h * 0.30)),   # row 1 right
    "search_grid_3":    lambda w, h: (int(w * 0.243), int(h * 0.75)),   # row 2 left
    "search_grid_4":    lambda w, h: (int(w * 0.729), int(h * 0.75)),   # row 2 right
    "search_creator":   lambda w, h: (int(w * 0.25), int(h * 0.85)),    # bottom area (creator/profile)

    # --- Creator Profile Actions ---
    # Follow button: LEFT of 3-button row [Follow | Message | v], ABOVE bio
    # Pixel scan of 3 real profiles (2026-03-14): red center at (0.292w, 0.300h), y range 0.277-0.324
    "profile_follow_btn": lambda w, h: (int(w * 0.292), int(h * 0.300)),

    # --- Creator Profile Video Grid (3 columns) ---
    # Verified from Motorola 720x1600 screenshots (2026-03-13)
    # Y varies by bio length: no bio ~0.41, short ~0.44, long ~0.46
    # Using average 0.44 for row 1; row spacing ~0.19h
    "profile_grid_1":   lambda w, h: (int(w * 0.16), int(h * 0.44)),   # row 1 left
    "profile_grid_2":   lambda w, h: (int(w * 0.49), int(h * 0.44)),   # row 1 center
    "profile_grid_3":   lambda w, h: (int(w * 0.81), int(h * 0.44)),   # row 1 right
    "profile_grid_4":   lambda w, h: (int(w * 0.16), int(h * 0.63)),   # row 2 left
    "profile_grid_5":   lambda w, h: (int(w * 0.49), int(h * 0.63)),   # row 2 center
    "profile_grid_6":   lambda w, h: (int(w * 0.81), int(h * 0.63)),   # row 2 right

    # --- Comments Sheet ---
    # Verified from Motorola 720x1600 screenshot (2026-03-14): "Add comment..." at y=0.913
    "comment_input":    lambda w, h: (int(w * 0.50), int(h * 0.913)),

    # --- Create / Upload Flow ---
    "upload_tab":       lambda w, h: (int(w * 0.926), int(h * 0.973)),
    "camera_tab":       lambda w, h: (int(w * 0.35), int(h * 0.973)),
    "gallery_first":    lambda w, h: (int(w * 0.25), int(h * 0.33)),
    "record_btn":       lambda w, h: (int(w * 0.50), int(h * 0.946)),
    "upload_next_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
    "upload_post_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
    "upload_save_draft_btn": lambda w, h: (int(w * 0.20), int(h * 0.97)),
    "upload_caption":   lambda w, h: (int(w * 0.50), int(h * 0.15)),

    # --- Edit Screen (after recording/selecting) ---
    "edit_overlay_btn": lambda w, h: (int(w * 0.50), int(h * 0.964)),
    "edit_next_btn":    lambda w, h: (int(w * 0.944), int(h * 0.023)),

    # --- Profile / Edit Profile ---
    "edit_profile_btn": lambda w, h: (int(w * 0.50), int(h * 0.22)),
    "settings_icon":    lambda w, h: (int(w * 0.954), int(h * 0.023)),
    "avatar_edit":      lambda w, h: (int(w * 0.50), int(h * 0.113)),
    "bio_field":        lambda w, h: (int(w * 0.50), int(h * 0.45)),
    "save_btn":         lambda w, h: (int(w * 0.944), int(h * 0.023)),
}


# =============================================================================
# Instagram Coordinate Map
# =============================================================================

INSTAGRAM = {
    # --- Bottom Navigation Bar (5 tabs) ---
    "nav_home":         lambda w, h: (int(w * 0.10), int(h * 0.973)),
    "nav_search":       lambda w, h: (int(w * 0.30), int(h * 0.973)),
    "nav_reels":        lambda w, h: (int(w * 0.50), int(h * 0.973)),
    "nav_create":       lambda w, h: (int(w * 0.70), int(h * 0.973)),
    "nav_profile":      lambda w, h: (int(w * 0.90), int(h * 0.973)),

    # --- Right-Side Panel (Reels view, similar to TikTok) ---
    # NOTE: Instagram Reels layout may differ slightly — verify with IG screenshot
    "avatar_reel":      lambda w, h: (int(w * 0.92), int(h * 0.46)),
    "like_icon":        lambda w, h: (int(w * 0.92), int(h * 0.52)),
    "comment_icon":     lambda w, h: (int(w * 0.92), int(h * 0.59)),
    "share_icon":       lambda w, h: (int(w * 0.92), int(h * 0.66)),

    # --- Content Area ---
    "video_center":     lambda w, h: (int(w * 0.45), int(h * 0.45)),
    "username_reel":    lambda w, h: (int(w * 0.139), int(h * 0.919)),

    # --- Search / Explore ---
    "search_bar":       lambda w, h: (int(w * 0.50), int(h * 0.056)),
    "search_clear":     lambda w, h: (int(w * 0.90), int(h * 0.056)),   # X button to clear search

    # --- Search/Explore Results Grid (3 columns) ---
    "search_grid_1":    lambda w, h: (int(w * 0.167), int(h * 0.25)),   # top-left
    "search_grid_2":    lambda w, h: (int(w * 0.50), int(h * 0.25)),    # top-center
    "search_grid_3":    lambda w, h: (int(w * 0.833), int(h * 0.25)),   # top-right
    "search_grid_4":    lambda w, h: (int(w * 0.167), int(h * 0.50)),   # mid-left
    "search_grid_5":    lambda w, h: (int(w * 0.50), int(h * 0.50)),    # mid-center
    "search_grid_6":    lambda w, h: (int(w * 0.833), int(h * 0.50)),   # mid-right

    # --- Comments ---
    # Same position as TikTok comments sheet
    "comment_input":    lambda w, h: (int(w * 0.50), int(h * 0.913)),

    # --- Create / Reel Upload Flow ---
    "gallery_first":    lambda w, h: (int(w * 0.25), int(h * 0.33)),
    "reel_tab":         lambda w, h: (int(w * 0.50), int(h * 0.973)),
    "upload_next_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
    "upload_share_btn": lambda w, h: (int(w * 0.944), int(h * 0.023)),
    "upload_caption":   lambda w, h: (int(w * 0.50), int(h * 0.15)),
    "save_draft_confirm": lambda w, h: (int(w * 0.50), int(h * 0.44)),

    # --- Profile / Edit Profile ---
    "edit_profile_btn": lambda w, h: (int(w * 0.50), int(h * 0.22)),
    "avatar_edit":      lambda w, h: (int(w * 0.50), int(h * 0.113)),
    "bio_field":        lambda w, h: (int(w * 0.50), int(h * 0.40)),
    "save_btn":         lambda w, h: (int(w * 0.944), int(h * 0.023)),

    # --- Stories (visible at top of Feed view) ---
    "story_row_second": lambda w, h: (int(w * 0.30), int(h * 0.075)),
    "story_row_third":  lambda w, h: (int(w * 0.43), int(h * 0.075)),
    "story_tap_next":   lambda w, h: (int(w * 0.80), int(h * 0.50)),
}


# =============================================================================
# Lookup
# =============================================================================

COORD_MAPS = {
    "tiktok": TIKTOK,
    "instagram": INSTAGRAM,
}


def get_coords(app: str, element: str, screen_w: int, screen_h: int) -> tuple[int, int]:
    """Get pixel coordinates for a UI element.

    Args:
        app: "tiktok" or "instagram"
        element: element key from the coordinate map
        screen_w: device screen width in pixels
        screen_h: device screen height in pixels

    Returns:
        (x, y) tuple scaled to actual screen dimensions.

    Raises:
        KeyError if app or element not found.
    """
    return COORD_MAPS[app][element](screen_w, screen_h)
