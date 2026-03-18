"""Page state detection for TikTok via pixel analysis.

Takes a screenshot (bytes) and determines which TikTok page is displayed
by sampling pixel brightness at key UI landmarks. Zero API calls, ~5ms.

Detection strategy:
1. Bottom nav bar: 5 icons, active one is WHITE/bright, others gray
   -> Tells us: FYP, Search/Friends, Create, Inbox, Profile
2. Popup/dialog: center of screen brighter than edges (overlay dimming)
3. Comments overlay: nav bar hidden, bottom half darker with text variation
"""
import io
import logging

from PIL import Image

log = logging.getLogger(__name__)


# Nav bar icon X positions (normalized 0-1) for TikTok bottom tabs
# Home | Friends | Create(+) | Inbox | Profile
_NAV_ICON_X = {
    "fyp":     0.10,
    "friends": 0.30,
    "create":  0.50,
    "inbox":   0.70,
    "profile": 0.90,
}
_NAV_Y = 0.947   # default, overridden by set_screen_params()
_SAMPLE_R = 6    # sample a 12x12 box around each icon


def set_screen_params(screen_h: int, density: int):
    """Set screen-specific parameters based on device density.

    TikTok's bottom tab bar center sits ~50dp from the bottom edge.
    This converts dp to pixels using the device density and computes
    the correct _NAV_Y ratio. Call once during bot init.

    Also syncs the computed _NAV_Y to coords.py so that get_coord()
    returns density-correct nav bar positions.

    Args:
        screen_h: screen height in pixels
        density: screen DPI (e.g. 280 for Motorola, 420 for Samsung)
    """
    global _NAV_Y, _cached_nav_y
    _cached_nav_y = None  # force re-scan for new device
    nav_dp = 50  # TikTok tab bar center ~50dp from bottom
    nav_px = nav_dp * density / 160
    _NAV_Y = (screen_h - nav_px) / screen_h
    log.info("PAGE_STATE: _NAV_Y set to %.4f (screen_h=%d, density=%d, nav_px=%.1f)",
             _NAV_Y, screen_h, density, nav_px)
    # Sync to coords.py so get_coord("tiktok", "nav_*") uses the same Y
    from . import coords
    coords.set_nav_y(_NAV_Y)
    log.info("PAGE_STATE: synced _NAV_Y=%.4f to coords.py", _NAV_Y)


def _avg_brightness(img, cx, cy, r=_SAMPLE_R):
    """Average brightness (0-255) in a small box around (cx, cy)."""
    x1 = max(0, cx - r)
    y1 = max(0, cy - r)
    x2 = min(img.width, cx + r)
    y2 = min(img.height, cy + r)
    region = img.crop((x1, y1, x2, y2))
    pixels = list(region.getdata())
    if not pixels:
        return 0
    return sum(sum(p[:3]) / 3 for p in pixels) / len(pixels)


def _region_brightness(img, x1_pct, y1_pct, x2_pct, y2_pct):
    """Average brightness of a rectangular region (percentages)."""
    x1 = int(img.width * x1_pct)
    y1 = int(img.height * y1_pct)
    x2 = int(img.width * x2_pct)
    y2 = int(img.height * y2_pct)
    region = img.crop((x1, y1, x2, y2))
    pixels = list(region.getdata())
    if not pixels:
        return 0
    return sum(sum(p[:3]) / 3 for p in pixels) / len(pixels)


def _brightness_variance(img, x1_pct, y1_pct, x2_pct, y2_pct):
    """Brightness variance in a region (high = text/UI elements, low = solid)."""
    x1 = int(img.width * x1_pct)
    y1 = int(img.height * y1_pct)
    x2 = int(img.width * x2_pct)
    y2 = int(img.height * y2_pct)
    # Subsample for speed (every 4th pixel)
    region = img.crop((x1, y1, x2, y2)).resize(
        (max(1, (x2 - x1) // 4), max(1, (y2 - y1) // 4)), Image.NEAREST
    )
    pixels = list(region.getdata())
    if len(pixels) < 2:
        return 0
    vals = [sum(p[:3]) / 3 for p in pixels]
    mean = sum(vals) / len(vals)
    return sum((v - mean) ** 2 for v in vals) / len(vals)


def detect_page(screenshot_bytes, screen_w, screen_h):
    """Detect current TikTok page from screenshot pixels.

    Returns:
        dict with keys:
            page: "fyp" | "profile" | "search" | "comments" | "popup" | "unknown"
            confidence: float 0.0 - 1.0
            has_popup: bool
            nav_visible: bool
            details: str (human-readable reason)
    """
    try:
        img = Image.open(io.BytesIO(screenshot_bytes)).convert("RGB")
    except Exception as e:
        log.warning("page_state: failed to open screenshot: %s", e)
        return {"page": "unknown", "confidence": 0, "has_popup": False,
                "nav_visible": False, "details": "image open failed"}

    # ---- 1. Popup check DISABLED ----
    # Pixel-based popup detection caused too many false positives on normal TikTok
    # videos (text overlays, expanded bios detected as "popup" → unwanted press_back).
    # Popups are now handled by:
    #   - Gemini Vision fallback in _verify_page (when page is unknown/low confidence)
    #   - PopupGuardian in browse_session (stall detection + background Gemini checks)
    # Both are more accurate than pixel heuristics.

    # ---- 2. Bottom nav bar check ----
    nav = _check_nav_bar(img)

    if nav["visible"] and nav["confidence"] >= 0.5:
        r = {"page": nav["active_tab"], "confidence": nav["confidence"],
             "has_popup": False, "nav_visible": True,
             "details": nav["reason"]}
        log.debug("PAGE_DETECT: %s conf=%.2f | %s", r["page"], r["confidence"], r["details"])
        return r

    # ---- 3. No nav bar -> overlay check (comments) ----
    comments = _check_comments(img)
    if comments["detected"]:
        r = {"page": "comments", "confidence": comments["confidence"],
             "has_popup": False, "nav_visible": False,
             "details": comments["reason"]}
        log.debug("PAGE_DETECT: comments conf=%.2f | %s", r["confidence"], r["details"])
        return r

    # ---- 4. Nav visible but low confidence ----
    if nav["visible"]:
        r = {"page": nav["active_tab"], "confidence": nav["confidence"],
             "has_popup": False, "nav_visible": True,
             "details": nav["reason"] + " (low confidence)"}
        log.info("PAGE_DETECT: %s LOW_CONF=%.2f | %s", r["page"], r["confidence"], r["details"])
        return r

    result = {"page": "unknown", "confidence": 0, "has_popup": False,
              "nav_visible": False, "details": "no nav bar, no overlay detected"}
    log.debug("PAGE_DETECT: %s conf=%.2f nav=%s | %s",
              result["page"], result["confidence"], result["nav_visible"], result["details"])
    return result


_cached_nav_y = None


def _find_nav_bar_y(img):
    """Scan bottom of screen to find TikTok's nav bar Y position.

    Looks for the characteristic pattern: 5 evenly-spaced icons where the
    center "create" button is bright AND exactly 1 of the 4 real tabs is
    bright (active) while the rest are dim. Scans y from 88% to 98%.

    Returns Y as fraction (0-1). Caches result for the session.
    Fast: ~55 pixel samples total, < 20ms.
    """
    global _cached_nav_y
    if _cached_nav_y is not None:
        return _cached_nav_y

    best_y = _NAV_Y  # fallback to computed default
    best_score = 0

    for y_pct_int in range(88, 99):  # 88% to 98%
        y_pct = y_pct_int / 100.0
        cy = int(img.height * y_pct)

        brightnesses = {}
        for name, x_pct in _NAV_ICON_X.items():
            cx = int(img.width * x_pct)
            brightnesses[name] = _avg_brightness(img, cx, cy)

        # Score this Y: good nav bar has create bright + contrast between tabs
        create_b = brightnesses.get("create", 0)
        others = {k: v for k, v in brightnesses.items() if k != "create"}

        if create_b < 60:  # create button not visible at all = not nav bar
            continue

        other_vals = sorted(others.values())
        max_b = other_vals[-1] if other_vals else 0
        min_b = other_vals[0] if other_vals else 0
        contrast = max_b - min_b

        # Strategy 1 (strict): absolute thresholds (works on high-contrast phones)
        bright_count = sum(1 for v in others.values() if v > 130)
        dim_count = sum(1 for v in others.values() if v < 80)
        if bright_count == 1 and dim_count >= 2:
            score = contrast + create_b * 0.1
            if score > best_score:
                best_score = score
                best_y = y_pct

        # Strategy 2 (relative): contrast-based (works on Samsung where inactive=90-130)
        # Active tab is significantly brighter than the dimmest inactive tab
        elif contrast >= 40 and max_b >= 120 and create_b >= 60:
            # At least one tab must stand out from the rest
            second_brightest = other_vals[-2] if len(other_vals) >= 2 else 0
            gap_to_brightest = max_b - second_brightest
            if gap_to_brightest >= 30:  # clear winner (active tab)
                score = contrast * 0.8 + gap_to_brightest * 0.5 + create_b * 0.05
                if score > best_score:
                    best_score = score
                    best_y = y_pct

    if best_score > 50:
        _cached_nav_y = best_y
        log.info("NAV_BAR_SCAN: found at y=%.4f (score=%.1f)", best_y, best_score)
        return _cached_nav_y
    else:
        # Low score = weak/ambiguous match, don't cache (re-scan next call)
        log.info("NAV_BAR_SCAN: low score %.1f, using default y=%.4f (not caching)",
                 best_score, _NAV_Y)
        return _NAV_Y


def reset_nav_cache():
    """Reset cached nav bar Y. Call when switching phones or on new session."""
    global _cached_nav_y
    _cached_nav_y = None


def _check_nav_bar(img):
    """Check bottom nav bar: which icon is brightest = active tab."""
    nav_y = _find_nav_bar_y(img)
    brightnesses = {}
    for name, x_pct in _NAV_ICON_X.items():
        cx = int(img.width * x_pct)
        cy = int(img.height * nav_y)
        brightnesses[name] = _avg_brightness(img, cx, cy)

    max_b = max(brightnesses.values())

    # Nav bar not visible (all dark = overlay covering it)
    if max_b < 40:
        return {"visible": False, "active_tab": "unknown", "confidence": 0,
                "reason": "nav bar too dark (max_b=%.0f)" % max_b}

    # Exclude "create" from active tab detection: TikTok's center + button
    # is always colorful/bright regardless of which page is active.
    # It's never a real "active tab" (tapping it opens a modal, not a page).
    tabs = {k: v for k, v in brightnesses.items() if k != "create"}

    tab_max = max(tabs.values())
    tab_min = min(tabs.values())

    # No clear winner among the 4 real tabs
    contrast = tab_max - tab_min
    if contrast < 25:
        return {"visible": True, "active_tab": "unknown", "confidence": 0.25,
                "reason": "nav bar visible but low contrast (%.0f)" % contrast}

    # Find the brightest icon among the 4 real tabs
    active = max(tabs, key=tabs.get)

    # Confidence based on how much brighter the active icon is vs others
    others = {k: v for k, v in tabs.items() if k != active}
    others_avg = sum(others.values()) / max(len(others), 1)
    ratio = (tab_max - others_avg) / max(tab_max, 1)
    confidence = min(0.95, 0.45 + ratio * 1.5)

    log.debug("nav brightness: %s | active=%s (%.0f vs avg %.0f)",
              {k: "%.0f" % v for k, v in brightnesses.items()},
              active, tab_max, others_avg)

    return {"visible": True, "active_tab": active, "confidence": confidence,
            "reason": "nav: %s brightest (%.0f vs avg %.0f, create=%.0f excluded)" % (
                active, tab_max, others_avg, brightnesses.get("create", 0))}


def _check_popup(img):
    """Detect popup/dialog: lighter rectangle in center, dimmed edges.

    IMPORTANT: TikTok videos often have bright text overlays in the center
    (e.g. "BOSCH 9 KG LARJE") which are NOT popups. Threshold must be high
    enough to avoid false positives on text-heavy videos.
    Real popups (permission dialogs, TikTok Shop) have center_b > 200
    and diff > 100 (very distinct bright rectangle on dimmed background).
    """
    # Center region (middle 30% x 15% of screen)
    center_b = _region_brightness(img, 0.35, 0.42, 0.65, 0.58)

    # Edge regions (left and right strips at same height)
    left_b = _region_brightness(img, 0.02, 0.42, 0.12, 0.58)
    right_b = _region_brightness(img, 0.88, 0.42, 0.98, 0.58)
    edge_avg = (left_b + right_b) / 2

    # Popup = center VERY bright (>200) AND much brighter than edges (diff > 100)
    # Old thresholds (35, 90) caused false positives on videos with text overlays
    diff = center_b - edge_avg
    if diff > 100 and center_b > 200:
        confidence = min(0.90, 0.5 + diff / 200)
        return {"detected": True, "confidence": confidence,
                "reason": "center brighter than edges (%.0f vs %.0f)" % (
                    center_b, edge_avg)}

    # Also check for bottom popup (cookie consent, TikTok Shop, etc.)
    bottom_b = _region_brightness(img, 0.15, 0.70, 0.85, 0.85)
    bottom_edge = _region_brightness(img, 0.02, 0.70, 0.12, 0.85)
    bottom_diff = bottom_b - bottom_edge
    if bottom_diff > 100 and bottom_b > 200:
        confidence = min(0.85, 0.45 + bottom_diff / 200)
        return {"detected": True, "confidence": confidence,
                "reason": "bottom popup (%.0f vs %.0f)" % (
                    bottom_b, bottom_edge)}

    return {"detected": False, "confidence": 0, "reason": "no popup"}


def _check_comments(img):
    """Comments overlay detection — DISABLED (pixel-based).

    Pixel heuristics cannot reliably distinguish comments from other bright screens
    (search results, profiles, expanded bios). All have panel_b > 190.
    Comments are now detected by Gemini Vision via identify_page_with_recovery()
    when _verify_page encounters an unknown/low-confidence page.
    """
    return {"detected": False, "confidence": 0, "reason": "pixel check disabled"}


# =============================================================================
# Screen Fingerprint -- stall detection for popup guardian
# =============================================================================

# Crop percentages: skip status bar (top 4%) and nav bar (bottom 8%)
_FP_TOP = 0.04
_FP_BOTTOM = 0.92
_FP_COLS = 10
_FP_ROWS = 18


def screen_fingerprint(screenshot_bytes):
    """Downscale screenshot to a 10x18 grayscale grid (180 values).

    Used to detect if a swipe changed the screen content.
    Skips status bar and nav bar (always static).

    Returns:
        list of 180 ints (0-255) or None if screenshot invalid.
    """
    try:
        img = Image.open(io.BytesIO(screenshot_bytes)).convert("L")
    except Exception:
        return None

    # Crop to video area only (skip status bar + nav bar)
    top = int(img.height * _FP_TOP)
    bottom = int(img.height * _FP_BOTTOM)
    crop = img.crop((0, top, img.width, bottom))

    # Downscale to grid
    thumb = crop.resize((_FP_COLS, _FP_ROWS), Image.BILINEAR)
    return list(thumb.getdata())


def is_stalled(fp_before, fp_after, threshold=18):
    """Compare two fingerprints. Returns True if screen barely changed.

    When swipe works (new video): avg diff typically 40-80+.
    When popup blocks swipe (same video): avg diff typically 3-12.
    Playing video without swipe: avg diff typically 5-20 (motion).

    Args:
        fp_before: fingerprint from before the swipe
        fp_after: fingerprint from after the swipe
        threshold: max avg diff to consider "stalled" (default 18)

    Returns:
        True if screen is stalled (swipe had no effect).
    """
    if not fp_before or not fp_after:
        return False
    if len(fp_before) != len(fp_after):
        return False

    total_diff = sum(abs(a - b) for a, b in zip(fp_before, fp_after))
    avg_diff = total_diff / len(fp_before)

    log.debug("fingerprint avg_diff=%.1f (threshold=%d) -> %s",
              avg_diff, threshold, "STALLED" if avg_diff < threshold else "ok")

    return avg_diff < threshold


def detect_bottom_bar(screenshot_bytes):
    """Detect if TikTok FYP has a search/playlist/music bar above the nav bar.

    Uses pixel uniformity at y=86% of screen height. The bar is a semi-transparent
    horizontal strip that makes all pixels at that Y nearly identical (stdev ~0).
    Video content without a bar has high pixel variance (stdev 20+).

    Calibrated from 11 real screenshots (5 bar, 6 no-bar): 100% accuracy.

    Returns True if a bottom bar is present (sidebar icons shifted up ~60px).
    """
    try:
        img = Image.open(io.BytesIO(screenshot_bytes)).convert("L")
    except Exception:
        return False

    w, h = img.size

    # Sample 30 points at y=86% across the width (5% to 95%)
    bar_y = int(h * 0.86)
    x_points = [int(w * (0.05 + 0.9 * i / 29)) for i in range(30)]
    vals = [img.getpixel((x, bar_y)) for x in x_points]

    avg = sum(vals) / len(vals)
    mean = avg
    variance = sum((v - mean) ** 2 for v in vals) / len(vals)
    stdev = variance ** 0.5

    has_bar = stdev < 15 and 20 < avg < 65

    if has_bar:
        log.info("BOTTOM_BAR: detected (avg=%.1f, stdev=%.1f)", avg, stdev)
    else:
        log.debug("BOTTOM_BAR: none (avg=%.1f, stdev=%.1f)", avg, stdev)

    return has_bar


def detect_inbox_subpage(screenshot_bytes):
    """Detect if we're on an Inbox sub-page (New Followers, Activity) vs main Inbox/FYP.

    Sub-pages have:
    - White/light background (avg brightness > 180 in content area)
    - Back arrow at top-left (dark element on light bg)
    - No bottom nav bar visible OR nav bar present but page is white

    Main Inbox has:
    - Stories carousel (darker, colorful circles at top)
    - Mixed brightness (dark + light sections)

    FYP has:
    - Dark/video background (avg brightness < 80)

    Returns:
        {"is_subpage": bool, "has_back_arrow": bool, "bg_brightness": float, "confidence": float}
    """
    try:
        img = Image.open(io.BytesIO(screenshot_bytes)).convert("RGB")
    except Exception:
        return {"is_subpage": False, "has_back_arrow": False, "bg_brightness": 0, "confidence": 0}

    w, h = img.size

    # Check 1: Back arrow at top-left
    # Sub-pages have a dark arrow icon at ~(3-8% x, 3-6% y) on white bg
    arrow_region_bright = _region_brightness(img, 0.01, 0.025, 0.12, 0.065)
    arrow_bg_bright = _region_brightness(img, 0.15, 0.025, 0.40, 0.065)
    has_back_arrow = arrow_region_bright < 120 and arrow_bg_bright > 160

    # Check 2: Content area brightness (skip header + nav)
    # Sample mid-page brightness at multiple points
    content_bright = _region_brightness(img, 0.05, 0.15, 0.95, 0.75)

    # Check 3: Header brightness (sub-pages have white header)
    header_bright = _region_brightness(img, 0.10, 0.03, 0.90, 0.08)

    # Decision logic
    is_subpage = False
    confidence = 0.0

    if has_back_arrow and header_bright > 160:
        # Back arrow + white header = very likely a sub-page
        is_subpage = True
        confidence = 0.9
    elif has_back_arrow and content_bright > 150:
        # Back arrow + light content = probably a sub-page
        is_subpage = True
        confidence = 0.75
    elif content_bright > 190 and header_bright > 190:
        # Very bright everywhere = might be a sub-page (no back arrow detected but white page)
        is_subpage = True
        confidence = 0.5

    result = {
        "is_subpage": is_subpage,
        "has_back_arrow": has_back_arrow,
        "bg_brightness": content_bright,
        "confidence": confidence,
    }

    log.info("INBOX_SUBPAGE: subpage=%s arrow=%s bg=%.0f header=%.0f conf=%.2f",
             is_subpage, has_back_arrow, content_bright, header_bright, confidence)
    return result


def detect_story_progress_bar(screenshot_bytes):
    """Detect TikTok Story progress bar at top of screen.

    Story progress bars are thin segments at y~5.5% of screen (just below
    status bar area). Segments have brightness ~80-95 on a dark background
    (~20), with gaps between segments at brightness ~20-55.

    Calibrated from REAL screenshots (2026-03-17):
    - Progress bar at y=5.5% (88px on 720x1600)
    - Segments: brightness 83-93
    - Gaps between segments: brightness 21-54
    - Above/below bar: uniform dark 19-21

    Detection: scan y=5.0%, 5.5%, 6.0% (3 rows for reliability).
    A row matches if: many medium-bright points (>60) AND dark gaps (<35)
    AND the row above (y-1%) is uniformly dark (all <35) — this last check
    distinguishes the progress bar from other content.

    Universal: percentages only, works on any resolution.

    Returns:
        {"detected": bool, "confidence": float, "segment_count": int}
    """
    try:
        img = Image.open(io.BytesIO(screenshot_bytes)).convert("L")
    except Exception:
        return {"detected": False, "confidence": 0.0, "segment_count": 0}

    w, h = img.size

    rows_matched = 0
    total_segments = 0

    for y_pct in (0.050, 0.055, 0.060):
        y = int(h * y_pct)
        y_above = int(h * (y_pct - 0.015))  # 1.5% above — should be dark

        # Sample 40 points across x=3% to 93%
        x_points = [int(w * (0.03 + 0.90 * i / 39)) for i in range(40)]
        vals = [img.getpixel((x, y)) for x in x_points]
        vals_above = [img.getpixel((x, y_above)) for x in x_points]

        # Check 1: Brightness cap — story segments never exceed ~220.
        # LIVE text/buttons hit 240-255.
        if max(vals) > 230:
            continue  # skip this row — too bright for a progress bar

        # Check 2: Dead zone — story gaps are 21-54 (never near 0).
        # LIVE has true-black zones (8+ consecutive points at 0-9).
        consecutive_dark = 0
        max_dark_run = 0
        for v in vals:
            if v < 10:
                consecutive_dark += 1
                max_dark_run = max(max_dark_run, consecutive_dark)
            else:
                consecutive_dark = 0
        if max_dark_run > 3:
            continue  # skip this row — has dead zones (LIVE, not story)

        # Progress bar segments: brightness 60-120 (NOT white 200+, NOT dark <30)
        segment_count = sum(1 for v in vals if v > 60)
        gap_count = sum(1 for v in vals if v < 35)

        # Row above must be uniformly dark (no bright content)
        above_bright = sum(1 for v in vals_above if v > 50)
        above_is_dark = above_bright <= 5  # allow a few status bar icon pixels

        # Count distinct segments (transitions from bright to dark)
        segments = 0
        in_segment = False
        for v in vals:
            if v > 60:
                if not in_segment:
                    segments += 1
                    in_segment = True
            elif v < 35:
                in_segment = False

        # Match: many segment points + at least 1 gap + row above is dark
        if segment_count >= 15 and gap_count >= 1 and above_is_dark:
            rows_matched += 1
            total_segments = max(total_segments, segments)

    if rows_matched >= 2:
        confidence = 0.95
    elif rows_matched == 1:
        confidence = 0.70
    else:
        confidence = 0.0

    detected = rows_matched >= 1

    if detected:
        log.info("STORY_BAR: detected (rows=%d, confidence=%.2f, segments=%d)",
                 rows_matched, confidence, total_segments)
    else:
        log.debug("STORY_BAR: none (rows=%d)", rows_matched)

    return {"detected": detected, "confidence": confidence, "segment_count": total_segments}


def detect_inbox_badge(screenshot_bytes, screen_w, screen_h):
    """Detect red notification badge on Inbox nav bar icon.

    The badge is a small red circle with a number, positioned at
    top-right of the Inbox icon (nav_inbox at 70% x, 97.3% y).
    Calibrated from 720x1600 Motorola screenshot (2026-03-16).

    Returns True if red badge detected.
    """
    try:
        img = Image.open(io.BytesIO(screenshot_bytes)).convert("RGB")
    except Exception:
        return False

    # Badge position: top-right of Inbox icon, slightly above _NAV_Y
    badge_cx = int(screen_w * 0.718)
    badge_cy = int(screen_h * (_NAV_Y - 0.012))

    # Sample pixels in a small grid around expected badge center
    red_count = 0
    total = 0
    for dx in range(-4, 5, 2):
        for dy in range(-4, 5, 2):
            px, py = badge_cx + dx, badge_cy + dy
            if 0 <= px < screen_w and 0 <= py < screen_h:
                r, g, b = img.getpixel((px, py))[:3]
                total += 1
                if r > 200 and g < 80:
                    red_count += 1

    has_badge = red_count >= 4  # at least 4 of ~25 samples are red
    if has_badge:
        log.info("INBOX_BADGE: detected (%d/%d red pixels)", red_count, total)
    else:
        log.debug("INBOX_BADGE: none (%d/%d red pixels)", red_count, total)
    return has_badge
