"""Coordinate maps for TikTok and Instagram UI elements.

Replaces uiautomator dump -- zero detectable process on the device.
All coordinates are lambda functions: (screen_w, screen_h) -> (x, y).
Resolution-independent across phone models (720p, 1080p, etc.).

For complex/dynamic flows (upload posting, camera trick), use Gemini Vision.
"""

# =============================================================================
# TikTok Coordinate Map
# =============================================================================

TIKTOK = {
    # --- Bottom Navigation Bar (5 tabs, evenly spaced) ---
    "nav_home":         lambda w, h: (int(w * 0.10), h - 60),
    "nav_friends":      lambda w, h: (int(w * 0.30), h - 60),
    "nav_create":       lambda w, h: (int(w * 0.50), h - 60),
    "nav_inbox":        lambda w, h: (int(w * 0.70), h - 60),
    "nav_profile":      lambda w, h: (int(w * 0.90), h - 60),

    # --- Right-Side Engagement Panel (FYP/video view) ---
    "avatar":           lambda w, h: (w - 50, int(h * 0.35)),
    "like_icon":        lambda w, h: (w - 50, int(h * 0.44)),
    "comment_icon":     lambda w, h: (w - 50, int(h * 0.53)),
    "share_icon":       lambda w, h: (w - 50, int(h * 0.62)),
    "bookmark_icon":    lambda w, h: (w - 50, int(h * 0.70)),

    # --- Content Area ---
    "video_center":     lambda w, h: (int(w * 0.45), int(h * 0.45)),
    "username":         lambda w, h: (150, h - 200),
    "caption_area":     lambda w, h: (int(w * 0.35), h - 150),

    # --- Top Bar (on FYP) ---
    "search_icon":      lambda w, h: (w - 60, 80),

    # --- Search Page ---
    "search_bar":       lambda w, h: (int(w * 0.50), 100),

    # --- Comments Sheet ---
    "comment_input":    lambda w, h: (int(w * 0.50), h - 80),

    # --- Create / Upload Flow ---
    "upload_tab":       lambda w, h: (w - 80, h - 60),
    "camera_tab":       lambda w, h: (int(w * 0.35), h - 60),
    "gallery_first":    lambda w, h: (int(w * 0.25), int(h * 0.33)),
    "record_btn":       lambda w, h: (int(w * 0.50), h - 120),
    "upload_next_btn":  lambda w, h: (w - 60, 50),
    "upload_post_btn":  lambda w, h: (w - 60, 50),
    "upload_caption":   lambda w, h: (int(w * 0.50), int(h * 0.15)),

    # --- Edit Screen (after recording/selecting) ---
    "edit_overlay_btn": lambda w, h: (int(w * 0.50), h - 80),
    "edit_next_btn":    lambda w, h: (w - 60, 50),

    # --- Profile / Edit Profile ---
    "edit_profile_btn": lambda w, h: (int(w * 0.50), int(h * 0.22)),
    "settings_icon":    lambda w, h: (w - 50, 50),
    "avatar_edit":      lambda w, h: (int(w * 0.50), 250),
    "bio_field":        lambda w, h: (int(w * 0.50), int(h * 0.45)),
    "save_btn":         lambda w, h: (w - 60, 50),
}


# =============================================================================
# Instagram Coordinate Map
# =============================================================================

INSTAGRAM = {
    # --- Bottom Navigation Bar (5 tabs) ---
    "nav_home":         lambda w, h: (int(w * 0.10), h - 60),
    "nav_search":       lambda w, h: (int(w * 0.30), h - 60),
    "nav_reels":        lambda w, h: (int(w * 0.50), h - 60),
    "nav_create":       lambda w, h: (int(w * 0.70), h - 60),
    "nav_profile":      lambda w, h: (int(w * 0.90), h - 60),

    # --- Right-Side Panel (Reels view, similar to TikTok) ---
    "like_icon":        lambda w, h: (w - 50, int(h * 0.44)),
    "comment_icon":     lambda w, h: (w - 50, int(h * 0.54)),
    "share_icon":       lambda w, h: (w - 50, int(h * 0.62)),

    # --- Content Area ---
    "video_center":     lambda w, h: (int(w * 0.45), int(h * 0.45)),
    "username_reel":    lambda w, h: (150, h - 180),

    # --- Search / Explore ---
    "search_bar":       lambda w, h: (int(w * 0.50), 130),

    # --- Comments ---
    "comment_input":    lambda w, h: (int(w * 0.50), h - 80),

    # --- Create / Reel Upload Flow ---
    "gallery_first":    lambda w, h: (int(w * 0.25), int(h * 0.33)),
    "reel_tab":         lambda w, h: (int(w * 0.50), h - 60),
    "upload_next_btn":  lambda w, h: (w - 60, 50),
    "upload_share_btn": lambda w, h: (w - 60, 50),
    "upload_caption":   lambda w, h: (int(w * 0.50), int(h * 0.15)),

    # --- Profile / Edit Profile ---
    "edit_profile_btn": lambda w, h: (int(w * 0.50), int(h * 0.22)),
    "avatar_edit":      lambda w, h: (int(w * 0.50), 250),
    "bio_field":        lambda w, h: (int(w * 0.50), int(h * 0.40)),
    "save_btn":         lambda w, h: (w - 60, 50),
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
