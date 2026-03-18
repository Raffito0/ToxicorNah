# 02 — Dynamic UI Detection & Adaptive Navigation

## Priority: CRITICAL (depends on 01-session-infrastructure)

## Problem

The bot assumes a fixed TikTok UI layout, but TikTok shows different tabs and UI elements depending on account age, region, and A/B testing. New accounts see only "For You" + "Following" at top; mature accounts may also see "Explore", "Shop", "LIVE", "Nearby". The bottom nav's second slot varies between Friends, Shop, and Discover. The bot must detect what's available and adapt — not crash or navigate to nonexistent tabs.

Additionally, several navigation paths are broken or missing: LIVE exit never tested, Following tab empty state not detected, own profile never visited, and tab switching verification fails on similar-looking pages.

## Scope

10 gaps to close:

### Gap 1: Dynamic Bottom Nav Detection (CRITICAL)
**Current**: Bot assumes fixed 5-tab bottom nav: Home (10%), Friends (30%), Create (50%), Inbox (70%), Profile (90%). But the 30% slot varies: Friends, Shop, or Discover depending on account.
**Fix**: On first FYP load each session, scan bottom nav bar with Gemini Vision to identify which tabs are present. Cache the result for the session.
**Design**:
```python
def _scan_bottom_nav(self) -> dict:
    """Scan bottom nav once per session, cache result."""
    if self._cached_bottom_nav:
        return self._cached_bottom_nav
    shot = self.adb.screenshot_bytes()
    result = gemini.identify_bottom_nav(shot)
    # result: {"tabs": ["home", "friends", "create", "inbox", "profile"], "positions": {...}}
    # or: {"tabs": ["home", "shop", "create", "inbox", "profile"], "positions": {...}}
    self._cached_bottom_nav = result
    return result
```
**New Gemini prompt** (gemini.py):
```
Look at the bottom navigation bar. List ALL tab icons from left to right.
Reply as JSON: {"tabs": ["home", "friends|shop|discover", "create", "inbox", "profile"]}
The second tab from left may be: friends (people icon), shop (bag icon), or discover (compass icon).
```
**Integration**: All `go_to_*()` methods check cached nav before navigating. If target tab doesn't exist (e.g., Shop on new account), skip gracefully.

### Gap 2: Dynamic Top Tab Detection (CRITICAL)
**Current**: `_tap_top_tab()` has fixed coord positions for Explore, Following, etc. But new accounts only have "For You" + "Following". Tapping where Explore should be hits nothing or wrong element.
**Fix**: Scan top tabs once per session with Gemini, cache available tabs + positions.
**Design**:
```python
def _scan_top_tabs(self) -> dict:
    """Detect which top tabs are visible on FYP."""
    if self._cached_top_tabs:
        return self._cached_top_tabs
    shot = self.adb.screenshot_bytes()
    result = gemini.identify_top_tabs(shot)
    # result: {"tabs": ["for_you", "following"], "active": "for_you"}  # new account
    # or: {"tabs": ["live", "following", "for_you", "explore"], "active": "for_you"}  # mature
    self._cached_top_tabs = result
    return result
```
**Warmup integration**: During warmup days 1-2, even if tabs are detected, only allow FYP scrolling. Warmup executor already blocks engagement — extend to block tab navigation.

### Gap 3: Tab Switching Verification (CRITICAL)
**Current**: After tapping a bottom tab, verification uses fingerprint comparison. But Inbox (white) and New Followers (white) look the same → diff < 25 → "didn't switch" false negative.
**Fix**: After tab tap, use Gemini `identify_active_top_tab()` for top tabs, and `classify_screen_with_reference()` for bottom tab pages. Cache expected page appearance.
**Enhancement to `_tap_top_tab()`**: Already has 2-tier (fixed coords → Gemini bbox). Add tier 3: post-tap Gemini verification that we actually landed on the right page.

### Gap 4: LIVE Exit Testing & Fix (CRITICAL)
**Current**: `_exit_live()` exists (line 936-996) with 3-tier approach: fixed X coord → Gemini bbox → nuclear escape. But NEVER tested on real phone. During Samsung S9 test, bot entered LIVE accidentally (confirmed in frame analysis).
**Fix**: Verify `_exit_live()` works. Known issues to check:
- "Leave" confirmation dialog after tapping X (need to detect and tap "Leave")
- Swiping down in LIVE moves to next LIVE (not exit)
- `press_back()` gesture may not work inside LIVE
- Detection: sidebar scan returns None inside LIVE (no engagement panel)
**Test protocol**: Force-enter a LIVE stream, verify each exit tier works.

### Gap 5: Following Tab Empty State (HIGH)
**Current**: No detection for "Follow accounts to see videos here" screen. Bot would scroll an empty page endlessly.
**Fix**: After navigating to Following tab, check for empty state:
```python
def _check_following_empty(self, shot) -> bool:
    """Detect Following tab empty state via Gemini."""
    result = gemini.classify_screen_with_reference(
        shot, "Is this an empty Following page saying 'Follow accounts to see videos'? Reply: empty or has_content"
    )
    return result == "empty"
```
**Recovery**: If empty, log it, return to FYP. Don't waste session time scrolling nothing.

### Gap 6: Following Tab Profile Visit Recovery (HIGH)
**Current**: After rabbit_hole from Following tab, pressing BACK may not return to Following feed (may land on FYP or get lost).
**Fix**: After rabbit_hole returns, verify we're still on Following tab:
```python
# In browse_following_session(), after rabbit_hole():
shot = self.adb.screenshot_bytes()
active_tab = gemini.identify_active_top_tab(shot)
if active_tab != "following":
    self._tap_top_tab("following")  # re-navigate
```

### Gap 7: Own Profile Visit (HIGH)
**Current**: Bot NEVER visits its own profile. Real users check stats (follower count, video views) periodically.
**Fix**: New method `visit_own_profile()`:
```python
def visit_own_profile(self):
    """Brief profile visit like a real user checking stats."""
    self.go_to_profile()
    time.sleep(self.human.timing("t_profile_glance"))  # 3-8s
    # Maybe scroll down once to see recent videos
    if random.random() < 0.4:
        self.adb.swipe(*self.human.humanize_swipe(...))  # scroll once
        time.sleep(self.human.timing("t_video_glance"))
    self._return_to_foryou()
```
**Integration**: Add to `browse_session()` pick_action with ~1-2% weight, only during Peak/Fatigue phases.

### Gap 8: State Detection Gaps (HIGH)
**Current**: `page_state.detect_page()` works for FYP (nav bar detection) but popup and comments detection are DISABLED (too many false positives).
**Fix**: Don't re-enable broken pixel detection. Instead, add fast pixel pre-filters for high-confidence cases:
- **LIVE stream**: sidebar scan returns None + bright top area (streamer UI) → LIVE
- **Profile page**: avatar circle at top + grid thumbnails → profile
- **Search results**: grid layout + search bar at top → search
These are informational signals (low cost, zero Gemini), not replacements for Gemini verification.

### Gap 9: Navigation Recovery Enhancement (HIGH)
**Current**: `_return_to_fyp()` has 3 tiers (back → nav_home → nuclear_escape). Works from most screens.
**Fix**: Audit edge cases:
- **From Shop product detail**: BACK should work, but Shop has nested navigation. May need multiple BACKs.
- **From Search results with keyboard open**: BACK closes keyboard first, second BACK goes to search, third BACK to FYP. Add keyboard detection.
- **From DM conversation**: BACK → Inbox → BACK → Home.
Add `_return_to_fyp_deep()` variant that retries BACK up to 5x (checking after each) before escalating to nuclear.

### Gap 10: Nearby/Local Tab (LOW)
**Current**: Not handled. New tab appearing in EU/US (2025-2026).
**Fix**: Dynamic tab detection (Gap 1 & 2) already handles this — if Nearby appears, it's just another detected tab. Bot can skip it or briefly glance. No specific implementation needed beyond detection.

## Key Design Decisions

1. **Tab scan frequency**: Once per session (first FYP load). TikTok doesn't change tabs mid-session.
2. **Cache invalidation**: Clear cached tabs on nuclear_escape (app restarted).
3. **Warmup nav restriction**: Even with all tabs detected, warmup days 1-2 stay FYP-only. Days 3+ can explore detected tabs gradually.
4. **Gemini call budget**: Tab scan = 2 Gemini calls per session (bottom + top). Acceptable overhead.

## Config Additions

```python
# config.py
"t_profile_glance": (4.0, 0.5, 2.0, 10.0),    # brief own-profile check
"t_video_glance": (2.0, 0.3, 1.0, 5.0),         # glancing at video in profile grid
"t_following_empty_check": (1.5, 0.3, 0.5, 3.0), # verify following has content
```

## Testing

1. **Bottom nav scan**: Screenshot Samsung S9 (new account) → verify detection handles Friends/Shop/Discover/missing
2. **Top tab scan**: Screenshot new account (2 tabs) vs mature account (4+ tabs) → verify correct detection
3. **Tab switch verify**: Navigate to each detected tab → verify arrival via Gemini
4. **LIVE exit**: Enter LIVE stream → verify each exit tier works
5. **Following empty**: Navigate to Following on new account (0 following) → verify empty state detected
6. **Own profile**: Verify `visit_own_profile()` navigates and returns cleanly
7. **Deep navigation recovery**: Navigate 3 levels deep (Search → video → profile) → verify _return_to_fyp works

## Acceptance Criteria

- [ ] Bot detects available bottom nav tabs per session (handles Friends/Shop/Discover/absent)
- [ ] Bot detects available top tabs per session (handles new account: 2 tabs, mature: 4+)
- [ ] Tab navigation only attempts to visit detected tabs
- [ ] Warmup days 1-2: only FYP scroll regardless of detected tabs
- [ ] LIVE exit works reliably (tested on real phone)
- [ ] Following empty state detected and handled gracefully
- [ ] Own profile visited ~1-2% of sessions
- [ ] Navigation recovery works from 3+ levels deep
