# 04 — Engagement Completeness & Natural Behavior

## Priority: HIGH (depends on 02-dynamic-nav-detection)

## Problem

The bot's behavioral repertoire is limited: scroll, like, comment, follow, search, profile visit. A real TikTok user does 10+ additional actions that the bot doesn't: long-pressing "Not interested", bookmarking videos, browsing comments without writing, opening DMs, checking notification badges, and handling photo carousels. These missing actions create a detectable behavioral fingerprint — an account that NEVER bookmarks, NEVER long-presses, and NEVER checks DMs is suspicious.

## Scope

12 gaps to close, grouped by implementation complexity:

### SIDEBAR ACTIONS (use existing sidebar scan infrastructure)

#### Gap 1: Bookmark/Save Videos (HIGH)
**Current**: Bot never bookmarks. Real users save 1-3% of videos.
**Fix**: New method `bookmark_video()` — tap bookmark icon in sidebar. Sidebar scan already detects bookmark position.
```python
def bookmark_video(self):
    """Save current video to bookmarks."""
    positions = self._get_sidebar_positions()
    if not positions or "bookmark" not in positions:
        return
    bx, by = positions["bookmark"]
    self.adb.tap(bx, by)
    time.sleep(self.human.timing("t_bookmark_tap"))
    self._log_action("bookmark")
```
**Integration**: Add to `browse_session()` pick_action. Weight: ~1.5% base, modified by explore_curiosity trait. Only on niche content (niche gate).
**HumanEngine**: New method `should_bookmark()` — 1-3% base, +curiosity, -fatigue.

#### Gap 2: "Not Interested" Long-Press (HIGH)
**Current**: Bot never long-presses. Real users do this to train algorithm and express dislike.
**Fix**: New method `mark_not_interested()` — long-press on video → tap "Not interested" from context menu.
```python
def mark_not_interested(self):
    """Long-press video → tap 'Not interested'."""
    cx = self.adb.screen_w // 2
    cy = int(self.adb.screen_h * 0.5)
    self.adb.long_press(cx, cy, duration_ms=random.randint(800, 1500))
    time.sleep(self.human.timing("t_context_menu_appear"))
    # Find "Not interested" via Gemini bbox
    shot = self.adb.screenshot_bytes()
    result = gemini.find_element_by_vision(shot, "Not interested")
    if result and result.get("x"):
        self.adb.tap(int(result["x"] * self.adb.screen_w / 1000),
                     int(result["y"] * self.adb.screen_h / 1000))
        time.sleep(self.human.timing("t_tap_gap"))
    self._log_action("not_interested")
```
**Integration**: 2-5% of NON-niche videos (opposite of bookmark — used on content bot doesn't like). Helps train TikTok algorithm toward niche content.
**HumanEngine**: New method `should_mark_not_interested(category, is_niche)` — 3% base for non-niche, 0% for niche content.

### COMMENT ENHANCEMENTS

#### Gap 3: Read-Only Comment Browsing (HIGH)
**Current**: Bot only opens comments to WRITE. Real users open comments to READ far more often (10:1 ratio).
**Fix**: In `browse_session()`, when `should_browse_comments()` triggers, 70% of the time browse-only (open → scroll → close), 30% write.
```python
# In browse_session() comment section:
if self.human.should_browse_comments():
    if self.open_comments():
        if random.random() < 0.7:  # 70% read-only
            self.browse_comments()  # already exists — scroll + pause
            self._dismiss_comments()
        else:  # 30% write
            self.comment_with_ai()
```
**Already implemented**: `browse_comments()` exists (lines 1772-1822) and handles scrolling + pausing. Just need to call it without writing.

#### Gap 4: Comments with 0 Comments (MEDIUM)
**Current**: Bot opens comments, finds 0, current dismiss via 2 video taps needs verification.
**Fix**: In `open_comments()`, after detecting 0 comments, dismiss immediately. The existing `_dismiss_comments()` (2 video taps) should work — verify via test. Add specific 0-comment handling:
```python
# In open_comments(), after count detection:
if total_comments == 0:
    time.sleep(self.human.timing("t_comment_glance"))  # brief pause (real user looks)
    self._dismiss_comments()
    return False  # signal: don't try to write
```

### CONTENT TYPE HANDLING

#### Gap 5: Photo Carousel Detection (HIGH)
**Current**: Bot doesn't distinguish photo carousels from videos. Swiping UP on a carousel moves to next video (correct). But UI differences (dot indicator, no play controls, different sidebar) could confuse sidebar scan + engagement logic.
**Detection strategy** (multi-signal, zero false positives):
1. **Sidebar scan**: May return slightly different positions (no progress bar at bottom)
2. **Gemini check**: During niche pre-cache, add "is_carousel: true/false" to response
3. **Dot indicator**: Pixel check for small dots at bottom-center of screen
**Behavior on carousel**:
- Normal engagement (like, bookmark, comment) still works
- Do NOT try to open sidebar-based actions if sidebar scan fails
- Occasionally swipe LEFT to view next photo (10-30% chance, 1-3 photos max) — mimics real user browsing
```python
def _handle_carousel(self):
    """Browse a photo carousel post."""
    num_photos = random.randint(1, 3)
    for i in range(num_photos):
        time.sleep(self.human.timing("t_carousel_photo_view"))  # 2-4s per photo
        # Swipe left for next photo
        sx = int(self.adb.screen_w * 0.75)
        ex = int(self.adb.screen_w * 0.25)
        sy = ey = int(self.adb.screen_h * 0.5)
        self.adb.swipe(sx, sy, ex, ey, duration=random.randint(250, 450))
```

### INBOX & NOTIFICATION ACTIONS

#### Gap 6: Notification Badge Response (MEDIUM)
**Current**: `page_state.detect_inbox_badge()` exists but is never used in browse_session().
**Fix**: Check for inbox badge periodically (every 8-15 actions). If badge present, increase probability of `check_inbox` action.
```python
# In browse_session(), every 8-15 actions:
if self._actions_since_badge_check >= random.randint(8, 15):
    shot = self.adb.screenshot_bytes()
    if page_state.detect_inbox_badge(shot):
        # Boost inbox probability for next action pick
        self._inbox_badge_boost = True
    self._actions_since_badge_check = 0
```
**Integration**: When `_inbox_badge_boost` is True, `pick_action()` increases inbox weight 3x.

#### Gap 7: DM/Messages Brief Glance (MEDIUM)
**Current**: Bot never opens Messages tab in Inbox. Real users check DMs sometimes.
**Fix**: New method `_browse_messages()` in check_inbox_session():
```python
def _browse_messages(self):
    """Brief DM glance — open messages, scroll once, close."""
    # Tap "Messages" tab/icon in Inbox (use Gemini to find it)
    if self._inbox_enter_subpage("Messages", "Messages"):
        time.sleep(self.human.timing("t_message_glance"))  # 2-5s
        # Maybe scroll once (40% chance)
        if random.random() < 0.4:
            self.adb.swipe(*self.human.humanize_swipe(...))
            time.sleep(self.human.timing("t_message_scroll_pause"))
        self.adb.press_back()  # return to Inbox
```
**Safety**: NEVER tap on conversations, NEVER type, NEVER read content. Just open + glance + close.
**Integration**: Add as 4th action in `check_inbox_session()` with ~15% probability (personality.social drives it).

### SEARCH & SHOP POLISH

#### Gap 8: Search Second Keyword (MEDIUM)
**Current**: `_clear_and_retype()` exists but search bar clear/retype flow needs verification.
**Fix**: Verify `_clear_and_retype()` works:
1. Find X button to clear search bar → tap
2. Tap search bar → type new keyword → enter
3. Verify results changed (fingerprint comparison)
If X button not found, use select-all + delete approach.

#### Gap 9: Shop Tab Brief Visit (MEDIUM)
**Current**: `browse_shop_session()` exists (lines 4240-4320) but minimal.
**Fix**: Verify and enhance:
- Detect Shop tab exists (from dynamic nav scan, Split 02)
- Navigate to Shop
- Handle "Shop is not available" or popup (common on new accounts)
- Scroll 2-4 products (existing code does max 6)
- Maybe tap 1 product for detail view (existing code does this)
- NEVER tap purchase/cart buttons
- Return to FYP
**No major code changes needed** — just verify the existing flow works and integrate with dynamic tab detection.

### STORIES & POST-POSTING

#### Gap 10: Story Edge Cases (MEDIUM)
**Current**: Stories carousel works (pixel progress bar + Gemini fallback). Story-to-LIVE transition in carousel partially tested.
**Fix**: Verify edge cases:
- Story from someone doing LIVE: carousel shows red ring → bot taps → enters LIVE instead of Story → must detect and exit
- Empty stories row: no colored circles detected → skip gracefully
- Subscribers-only stories: may show lock icon → skip
**Enhancement**: In `_browse_stories_carousel()`, after tapping a story, verify we're on Story (not LIVE) using progress bar detector. If LIVE detected, `_exit_live()` and continue carousel.

#### Gap 11: Post-Posting Profile Check (MEDIUM)
**Current**: After posting, bot returns to FYP immediately. Real users check their Profile to see if the video is there and getting views.
**Fix**: After successful `post_video()`:
```python
# In executor.py, after successful post:
if post_success:
    time.sleep(human.timing("t_post_celebration"))  # 3-8s pause
    bot.visit_own_profile()  # from Split 02
    # Scroll to see the new video at top of grid
    time.sleep(human.timing("t_profile_glance"))
    bot._return_to_foryou()
```

#### Gap 12: Search Explore Session Polish (MEDIUM)
**Current**: `search_explore_session()` works but entry from Explore tab needs verification.
**Fix**: When entering from Explore tab (vs search icon), the UI is a grid already (no search bar first). Handle both entry paths:
```python
def search_explore_session(self, entry="search_icon"):
    if entry == "explore_tab":
        # Already on Explore grid — scroll and tap directly
        ...
    else:
        # Open search → type keyword → browse results
        ...
```

## HumanEngine Additions

```python
# New methods in human.py:
def should_bookmark(self) -> bool:
    """1-3% base, +curiosity, -fatigue."""
    base = 0.015 + self._personality.explore_curiosity * 0.01
    return random.random() < base * (1 - self._fatigue * 0.3)

def should_mark_not_interested(self, is_niche: bool) -> bool:
    """3% for non-niche, 0% for niche."""
    if is_niche:
        return False
    return random.random() < 0.03 * (1 + self._boredom * 0.5)

def should_check_inbox_badge(self) -> bool:
    """Periodic badge check."""
    return random.random() < 0.08  # ~8% per action cycle
```

## Config Additions

```python
# config.py — new timing params
"t_bookmark_tap": (0.3, 0.2, 0.1, 0.8),           # after bookmark tap
"t_context_menu_appear": (0.8, 0.3, 0.4, 2.0),     # after long-press
"t_not_interested_tap": (0.5, 0.2, 0.2, 1.2),      # after tapping Not Interested
"t_carousel_photo_view": (2.5, 0.4, 1.0, 6.0),     # per photo in carousel
"t_message_glance": (3.0, 0.5, 1.5, 7.0),           # DM list glance
"t_message_scroll_pause": (2.0, 0.4, 1.0, 5.0),     # after scrolling DMs
"t_comment_glance": (1.5, 0.3, 0.5, 3.0),           # looking at 0 comments
"t_post_celebration": (5.0, 0.5, 2.0, 12.0),        # pause after posting
```

## Testing

1. **Bookmark**: Scroll to niche video → bookmark → verify icon state changed
2. **Not interested**: Scroll to non-niche video → long-press → tap "Not interested" → verify context menu dismissed
3. **Read-only comments**: Open comments → scroll → close WITHOUT writing → verify smooth close
4. **0 comments**: Find video with 0 comments → open → verify smooth dismiss
5. **Photo carousel**: Encounter carousel post → verify sidebar behavior, swipe left works
6. **Notification badge**: Trigger badge → verify bot checks Inbox
7. **DM glance**: Open Inbox → Messages → glance → back → verify no conversation opened
8. **Post-posting check**: Post video → verify Profile visit happens

## Acceptance Criteria

- [ ] Bookmark action fires at ~1-3% rate on niche content
- [ ] "Not interested" fires at ~2-5% rate on non-niche content
- [ ] Comment browsing is 70% read-only, 30% write
- [ ] 0-comment sheets dismissed cleanly
- [ ] Photo carousels detected and handled (left-swipe for photos)
- [ ] Notification badge drives Inbox visits
- [ ] DM list opened and closed without interaction
- [ ] Post-posting Profile check happens after every post
- [ ] All new actions integrated into pick_action weights
- [ ] All timings use log-normal from config
