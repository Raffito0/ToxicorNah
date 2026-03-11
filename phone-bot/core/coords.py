"""Coordinate maps for TikTok and Instagram UI elements.

Replaces uiautomator dump -- zero detectable process on the device.
All coordinates are proportional: (screen_w, screen_h) -> (x, y).
Resolution-independent across phone models (720p, 1080p, etc.).

For complex/dynamic flows (upload posting, camera trick), use Gemini Vision.
"""

# =============================================================================
# TikTok Coordinate Map
# =============================================================================

TIKTOK = {
    # --- Bottom Navigation Bar (5 tabs, evenly spaced) ---
    "nav_home":         lambda w, h: (int(w * 0.10), int(h * 0.973)),
    "nav_friends":      lambda w, h: (int(w * 0.30), int(h * 0.973)),
    "nav_create":       lambda w, h: (int(w * 0.50), int(h * 0.973)),
    "nav_inbox":        lambda w, h: (int(w * 0.70), int(h * 0.973)),
    "nav_profile":      lambda w, h: (int(w * 0.90), int(h * 0.973)),

    # --- Right-Side Engagement Panel (FYP/video view) ---
    "avatar":           lambda w, h: (int(w * 0.954), int(h * 0.35)),
    "like_icon":        lambda w, h: (int(w * 0.954), int(h * 0.44)),
    "comment_icon":     lambda w, h: (int(w * 0.954), int(h * 0.53)),
    "share_icon":       lambda w, h: (int(w * 0.954), int(h * 0.62)),
    "bookmark_icon":    lambda w, h: (int(w * 0.954), int(h * 0.70)),

    # --- Content Area ---
    "video_center":     lambda w, h: (int(w * 0.45), int(h * 0.45)),
    "username":         lambda w, h: (int(w * 0.139), int(h * 0.910)),
    "caption_area":     lambda w, h: (int(w * 0.35), int(h * 0.932)),

    # --- Top Bar (on FYP) ---
    "search_icon":      lambda w, h: (int(w * 0.944), int(h * 0.036)),

    # --- Search Page ---
    "search_bar":       lambda w, h: (int(w * 0.50), int(h * 0.045)),
    "search_clear":     lambda w, h: (int(w * 0.90), int(h * 0.045)),   # X button to clear search

    # --- Search Results Grid (2 columns) ---
    "search_grid_1":    lambda w, h: (int(w * 0.25), int(h * 0.25)),    # top-left video
    "search_grid_2":    lambda w, h: (int(w * 0.75), int(h * 0.25)),    # top-right video
    "search_grid_3":    lambda w, h: (int(w * 0.25), int(h * 0.55)),    # mid-left video
    "search_grid_4":    lambda w, h: (int(w * 0.75), int(h * 0.55)),    # mid-right video
    "search_creator":   lambda w, h: (int(w * 0.25), int(h * 0.85)),    # bottom area (creator/profile)

    # --- Comments Sheet ---
    "comment_input":    lambda w, h: (int(w * 0.50), int(h * 0.964)),

    # --- Create / Upload Flow ---
    "upload_tab":       lambda w, h: (int(w * 0.926), int(h * 0.973)),
    "camera_tab":       lambda w, h: (int(w * 0.35), int(h * 0.973)),
    "gallery_first":    lambda w, h: (int(w * 0.25), int(h * 0.33)),
    "record_btn":       lambda w, h: (int(w * 0.50), int(h * 0.946)),
    "upload_next_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
    "upload_post_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
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
    "like_icon":        lambda w, h: (int(w * 0.954), int(h * 0.44)),
    "comment_icon":     lambda w, h: (int(w * 0.954), int(h * 0.54)),
    "share_icon":       lambda w, h: (int(w * 0.954), int(h * 0.62)),
    "avatar_reel":      lambda w, h: (int(w * 0.954), int(h * 0.35)),

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
    "comment_input":    lambda w, h: (int(w * 0.50), int(h * 0.964)),

    # --- Create / Reel Upload Flow ---
    "gallery_first":    lambda w, h: (int(w * 0.25), int(h * 0.33)),
    "reel_tab":         lambda w, h: (int(w * 0.50), int(h * 0.973)),
    "upload_next_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
    "upload_share_btn": lambda w, h: (int(w * 0.944), int(h * 0.023)),
    "upload_caption":   lambda w, h: (int(w * 0.50), int(h * 0.15)),

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
