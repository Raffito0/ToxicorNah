# 05 — Video Posting End-to-End Flow

## Priority: HIGH (depends on 02-dynamic-nav-detection)

## Problem

The existing `post_video()` method (lines 3588-3673 in tiktok.py) handles the basic upload flow but is incomplete: no caption from Content Library, no hashtag entry, no draft save flow, no skip flow, and post-verification only checks that TikTok is still open (not that the video actually posted). The weekly plan supports 3 post outcomes (`posted`, `draft`, `skipped`) but only `posted` has any implementation.

## Scope

4 gaps to close:

### Gap 1: Full Upload Flow Audit & Fix (CRITICAL)

**Current flow** (post_video, line 3588):
1. Push video to `/sdcard/Download/` via ADB
2. Media scan via broadcast
3. Tap + (Create button)
4. Tap "Upload" tab
5. Tap first gallery item (`gallery_first` coord)
6. Tap "Next" (2x, through edit screens)
7. Type caption via `type_text()`
8. Tap post button
9. Verify TikTok still running
10. Delete temp file on device

**Issues found**:
- **Step 7**: Caption is hardcoded as parameter. Content Library has `social_caption` field with caption + hashtags. Executor must pass this.
- **Step 7**: No hashtag handling. TikTok has a separate hashtag entry flow (type # → suggestions appear → tap suggestion). But Content Library captions may already include hashtags inline.
- **Step 6**: "Next" button position found via Gemini `find_on_screen()`. Works but slow — 2 Gemini calls for 2 Next taps.
- **Step 9**: Only checks `get_current_app()` shows TikTok. Doesn't verify the video actually posted (could be stuck on error screen).
- **No handling** of TikTok's "Are you sure you want to post?" confirmation if it appears.
- **No handling** of upload progress screen (video may take 10-30s to upload).

**Fix**:

#### Step 7 Enhancement — Caption + Hashtags from Content Library:
```python
def post_video(self, video_path: str, caption: str = "", hashtags: list = None):
    """Post video with caption and optional hashtags."""
    # ... existing push + gallery flow ...

    # Caption entry
    if caption:
        # Find caption input field via Gemini
        shot = self.adb.screenshot_bytes()
        caption_field = gemini.find_element_by_vision(shot, "caption input field or 'Describe your video'")
        if caption_field:
            self.adb.tap(int(caption_field["x"] * w / 1000), int(caption_field["y"] * h / 1000))
            time.sleep(self.human.timing("t_field_focus"))
        # Type caption (may include #hashtags inline)
        self.human.type_with_errors(self.adb, caption)
        time.sleep(self.human.timing("t_post_typing"))
```

#### Step 9 Enhancement — Post Verification:
```python
    # After tapping post button, wait for upload
    for attempt in range(6):  # max 30s wait
        time.sleep(5)
        shot = self.adb.screenshot_bytes()
        page = page_state.detect_page(shot)
        if page.get("page") == "fyp" or page.get("page") == "profile":
            return True  # Successfully posted, returned to main screen
        # Check if still on posting screen (uploading)
        result = gemini.classify_screen_with_reference(shot, "Is this: uploading, error, fyp, profile, other?")
        if result == "error":
            logger.error("Post failed — error screen detected")
            return False
    return False  # Timeout
```

#### Executor Integration:
```python
# executor.py — pass caption from Content Library
video_info = get_next_video(phone_id, platform)
caption = video_info.get("caption", "")
post_success = bot.post_video(local_path, caption=caption)
```

### Gap 2: Draft Save Flow (HIGH)

**Current**: Weekly plan supports `post_outcome: "draft"` but no implementation exists.
**Flow**: Navigate to post screen → go through upload → on final screen, tap "Drafts" or navigate back to trigger "Save as draft?" dialog → confirm save.

```python
def save_as_draft(self, video_path: str, caption: str = ""):
    """Navigate through upload flow, save as draft instead of posting."""
    # Same flow as post_video up to caption entry
    success = self._navigate_to_post_screen(video_path, caption)
    if not success:
        return False

    # Press BACK to trigger "Save as draft?" dialog
    self.adb.press_back()
    time.sleep(self.human.timing("t_popup_appear"))

    # Find and tap "Save as draft" button
    shot = self.adb.screenshot_bytes()
    save_btn = gemini.find_element_by_vision(shot, "Save as draft button or Save draft")
    if save_btn:
        self.adb.tap(int(save_btn["x"] * self.adb.screen_w / 1000),
                     int(save_btn["y"] * self.adb.screen_h / 1000))
        time.sleep(self.human.timing("t_draft_save"))
        self._log_action("draft_saved")
        return True

    # Fallback: if no dialog, try pressing back again
    self.adb.press_back()
    return False
```

### Gap 3: Skip Post Flow (HIGH)

**Current**: Weekly plan supports `post_outcome: "skipped"` (user changed their mind) but no implementation.
**Flow**: Open upload screen → browse gallery briefly → go back without selecting anything. Simulates "thought about posting, decided not to."

```python
def skip_post(self):
    """Open upload screen, browse briefly, leave without posting."""
    # Tap + (Create)
    cx, cy = self.adb.get_coord("tiktok", "nav_create")
    self.adb.tap(cx, cy)
    time.sleep(self.human.timing("t_app_load"))

    # Brief glance at gallery (2-5s)
    time.sleep(self.human.timing("t_skip_post_glance"))

    # Maybe scroll gallery once
    if random.random() < 0.3:
        self.adb.swipe(*self.human.humanize_swipe(...))
        time.sleep(self.human.timing("t_video_glance"))

    # Go back (changed mind)
    self.adb.press_back()
    time.sleep(self.human.timing("t_back_verify"))

    # Handle "Discard?" dialog if it appears
    shot = self.adb.screenshot_bytes()
    discard = gemini.find_element_by_vision(shot, "Discard button")
    if discard:
        self.adb.tap(int(discard["x"] * self.adb.screen_w / 1000),
                     int(discard["y"] * self.adb.screen_h / 1000))

    self._log_action("post_skipped")
```

### Gap 4: Camera Trick Post (Warmup) Verification

**Current**: `_tiktok_camera_trick_post()` exists in executor.py (lines 887-989) for the first TikTok post. Uses camera → record → overlay real video.
**Issue**: Uses `adb.wait_for_screen()` and `adb.find_on_screen()` which call Gemini Vision. Flow is complex (record → effects → overlay → gallery → next → caption → post). Multiple points of failure.
**Fix**: Audit and add verification at each step:
1. After "Record" → verify recording started (timer visible)
2. After "Effects" → verify effects panel opened
3. After overlay selection → verify video imported
4. After "Next" → verify edit screen
5. After "Post" → verify posted (same as Gap 1 verification)

Add `try/except` around each step with graceful fallback (abort camera trick, fall back to normal `post_video()` if any step fails).

## Shared Helper: Navigate to Post Screen

Extract common flow into shared method:

```python
def _navigate_to_post_screen(self, video_path: str, caption: str = "") -> bool:
    """Navigate from FYP to the post screen with video loaded and caption entered.
    Used by post_video(), save_as_draft().
    Returns True if successfully reached post screen."""

    # Push video
    device_path = f"/sdcard/Download/video_{int(time.time())}.mp4"
    self.adb.push_file(video_path, device_path)
    self.adb.shell(f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://{device_path}"')
    time.sleep(self.human.timing("t_media_scan"))

    # Tap + (Create)
    cx, cy = self.adb.get_coord("tiktok", "nav_create")
    self.adb.tap(cx, cy)
    time.sleep(self.human.timing("t_app_load"))

    # Tap Upload tab
    shot = self.adb.screenshot_bytes()
    upload_btn = gemini.find_element_by_vision(shot, "Upload tab or button")
    if not upload_btn:
        return False
    self.adb.tap(...)
    time.sleep(self.human.timing("t_tab_switch"))

    # Tap first gallery item
    gx, gy = self.adb.get_coord("tiktok", "gallery_first")
    self.adb.tap(gx, gy)
    time.sleep(self.human.timing("t_video_load"))

    # Tap Next (through edit screens)
    for i in range(2):
        shot = self.adb.screenshot_bytes()
        next_btn = gemini.find_element_by_vision(shot, "Next button")
        if next_btn:
            self.adb.tap(...)
            time.sleep(self.human.timing("t_tab_switch"))

    # Enter caption
    if caption:
        self.human.type_with_errors(self.adb, caption)
        time.sleep(self.human.timing("t_post_typing"))

    self._temp_device_path = device_path  # for cleanup
    return True
```

## Config Additions

```python
# config.py — new timing params
"t_field_focus": (0.5, 0.2, 0.2, 1.0),      # after tapping caption field
"t_post_typing": (1.0, 0.3, 0.5, 2.5),      # after finishing typing caption
"t_media_scan": (2.0, 0.3, 1.0, 4.0),       # after media scan broadcast
"t_video_load": (2.0, 0.4, 1.0, 5.0),       # after selecting video in gallery
"t_upload_wait": (5.0, 0.5, 3.0, 15.0),     # waiting for upload to complete
"t_draft_save": (1.5, 0.3, 0.5, 3.0),       # after saving draft
"t_skip_post_glance": (3.0, 0.5, 1.5, 6.0), # browsing gallery before skipping
"t_popup_appear": (1.0, 0.3, 0.5, 2.0),     # waiting for dialog to appear
```

## Executor Integration

```python
# executor.py — enhanced post handling
if session.get("post_scheduled"):
    outcome = session.get("post_outcome", "posted")

    if outcome == "posted":
        video_info = get_next_video(phone_id, platform)
        if video_info:
            local_path = download_video(video_info["video_url"])
            caption = video_info.get("caption", "")
            success = bot.post_video(local_path, caption=caption)
            if success:
                mark_posted(video_info["record_id"], platform)
                bot.visit_own_profile()  # post-posting check (Split 04)

    elif outcome == "draft":
        video_info = get_next_video(phone_id, platform)
        if video_info:
            local_path = download_video(video_info["video_url"])
            caption = video_info.get("caption", "")
            bot.save_as_draft(local_path, caption=caption)
            mark_draft(video_info["record_id"], platform)

    elif outcome == "skipped":
        bot.skip_post()
        if video_info:
            mark_skipped(video_info["record_id"], platform)
```

## Testing

1. **Full post**: Upload video with caption containing hashtags → verify posted on Profile
2. **Post verification**: Upload video → verify bot detects successful post vs error
3. **Draft save**: Go through upload → save as draft → verify draft exists in Drafts section
4. **Skip post**: Open upload → browse → leave → verify no video posted
5. **Caption with hashtags**: Post with "Check this out! #fyp #viral" → verify caption visible
6. **Upload timeout**: Slow upload (large file) → verify bot waits patiently
7. **Camera trick**: Warmup first post → verify camera overlay flow works end-to-end

## Acceptance Criteria

- [ ] Videos posted with caption from Content Library
- [ ] Hashtags in caption rendered correctly
- [ ] Post verification detects success vs error (not just "app is open")
- [ ] Draft save flow works: navigate → save as draft → verify
- [ ] Skip flow works: open upload → browse → leave → no post
- [ ] Upload wait handles slow uploads (up to 30s)
- [ ] Camera trick post has step-by-step verification with fallback
- [ ] Executor passes caption/hashtags from Content Library to bot
- [ ] Temp video files cleaned up from device after post/draft/skip
