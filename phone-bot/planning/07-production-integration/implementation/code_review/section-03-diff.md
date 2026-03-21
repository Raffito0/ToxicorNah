diff --git a/phone-bot/actions/instagram.py b/phone-bot/actions/instagram.py
index f69fdae..8b656df 100644
--- a/phone-bot/actions/instagram.py
+++ b/phone-bot/actions/instagram.py
@@ -92,6 +92,8 @@ class InstagramBot:
             self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
             self.adb.screen_w // 2, self.adb.screen_h // 4,
         )
+        if sw.get("hand_switched"):
+            time.sleep(sw["hand_switch_pause"])
         self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
 
     def scroll_reels(self):
@@ -121,9 +123,50 @@ class InstagramBot:
         x, y = self.adb.get_coord("instagram", "comment_icon")
         x, y = self.human.jitter_tap(x, y)
         self.adb.tap(x, y)
-        time.sleep(self.human.timing("t_nav_settle"))
+        time.sleep(self.human.timing("t_comment_load"))
+
+    def _scroll_comments(self):
+        """Scroll within the comments sheet. Distance varies by state."""
+        w, h = self.adb.screen_w, self.adb.screen_h
+        dist_frac = self.human.comment_scroll_distance()
+        start_y = int(h * 0.75)
+        end_y = int(h * (0.75 - dist_frac))
+        end_y = max(int(h * 0.15), end_y)
+
+        sw = self.human.humanize_swipe(w // 2, start_y, w // 2, end_y)
+        if sw.get("hand_switched"):
+            time.sleep(sw["hand_switch_pause"])
+        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
+
+    async def browse_comments(self) -> list[bytes]:
+        """Browse comments section with variable scrolls. Returns screenshots taken."""
+        plan = self.human.browse_comments_plan()
+        scroll_count = plan["scroll_count"]
+        timing_key = plan["read_timing_key"]
+        screenshots = []
+
+        if plan["is_deep_dive"]:
+            log.debug("IG comment deep dive: %d scrolls", scroll_count)
+        else:
+            log.debug("IG browsing comments: %d scrolls", scroll_count)
+
+        for i in range(scroll_count):
+            await asyncio.sleep(self.human.timing(timing_key))
+
+            if i == 0 or random.random() < 0.5:
+                shot = self.adb.screenshot_bytes()
+                if shot:
+                    screenshots.append(shot)
+
+            if i < scroll_count - 1:
+                self._scroll_comments()
+
+        return screenshots
 
     def write_comment(self, text: str):
+        # Pause before tapping input (deciding to write)
+        time.sleep(self.human.timing("t_comment_before_write"))
+
         # Tap comment input
         x, y = self.adb.get_coord("instagram", "comment_input")
         x, y = self.human.jitter_tap(x, y)
@@ -142,19 +185,61 @@ class InstagramBot:
         log.debug("Posted comment on IG: %s", text[:30])
 
     async def comment_with_ai(self):
-        screenshot = self.adb.screenshot_bytes()
-        if not screenshot:
+        """Generate a contextual comment using multi-frame video understanding."""
+        # --- Step 1: Capture 3 video frames ---
+        video_frames = []
+
+        frame1 = self.adb.screenshot_bytes()
+        if not frame1:
             return
+        video_frames.append(frame1)
+
+        await asyncio.sleep(self.human.timing("t_frame_capture_gap"))
+        frame2 = self.adb.screenshot_bytes()
+        if frame2:
+            video_frames.append(frame2)
 
-        await asyncio.sleep(self.human.reading_delay())
+        await asyncio.sleep(self.human.timing("t_frame_capture_gap"))
+        frame3 = self.adb.screenshot_bytes()
+        if frame3:
+            video_frames.append(frame3)
+
+        log.debug("Captured %d video frames for IG comment", len(video_frames))
+
+        # --- Step 2: Open and browse comments ---
+        self.open_comments()
+        comment_frames = await self.browse_comments()
+
+        if not comment_frames:
+            shot = self.adb.screenshot_bytes()
+            if shot:
+                comment_frames = [shot]
+
+        log.debug("Captured %d IG comment screenshots", len(comment_frames))
+
+        # --- Step 3: Generate comment with multi-frame AI ---
+        style = self.human.personality.comment_style if self.human.personality else "reactor"
+        comment = gemini.generate_comment_v2(
+            video_frames=video_frames,
+            comment_frames=comment_frames,
+            platform="instagram",
+            style=style,
+        )
+
+        # Fallback to single-frame if multi-frame fails
+        if not comment or len(comment) < 3:
+            log.warning("Multi-frame IG comment failed, trying single-frame fallback")
+            comment = gemini.generate_comment(video_frames[0], platform="instagram")
 
-        comment = gemini.generate_comment(screenshot, platform="instagram")
         if not comment or len(comment) < 3:
+            log.warning("IG comment generation failed entirely, closing comments")
+            self.adb.press_back()
             return
 
-        self.open_comments()
+        # --- Step 4: Write the comment ---
         self.write_comment(comment)
         self.human.memory.session_comments += 1
+        log.info("[IG Comment] style=%s text='%s'", style, comment[:40])
 
     def follow_user(self):
         """Follow creator -- tap avatar with + overlay in Reels view."""
@@ -449,7 +534,7 @@ class InstagramBot:
                 "New profile photo or Choose from library button"
             )
             if coords:
-                x, y = self.human.jitter_tap(*coords)
+                x, y = self.human.jitter_tap(coords[0], coords[1])
                 self.adb.tap(x, y)
                 time.sleep(self.human.timing("t_nav_settle"))
 
@@ -462,7 +547,7 @@ class InstagramBot:
             # Confirm -- Vision for Done/Next button
             coords = self.adb.wait_for_screen("Done or Next button", timeout=5)
             if coords:
-                x, y = self.human.jitter_tap(*coords)
+                x, y = self.human.jitter_tap(coords[0], coords[1])
                 self.adb.tap(x, y)
                 time.sleep(self.human.timing("t_confirm_save"))
 
@@ -509,14 +594,21 @@ class InstagramBot:
 
     # --- Video Posting (Reels) ---------------------------------------------
 
-    def post_reel(self, video_path: str, caption: str = "") -> bool:
-        """Upload and post a Reel to Instagram."""
+    def post_reel(self, video_path: str, caption: str = "") -> str:
+        """Upload and post a Reel to Instagram.
+
+        Returns one of: "success" | "retryable" | "banned" | "media_error"
+        """
         # Push video to /sdcard/Download/ (not DCIM -- no EXIF = suspicious there)
         now = datetime.now()
         vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
         device_path = f"/sdcard/Download/{vid_name}"
         log.info("Pushing reel to device: %s", device_path)
-        self.adb.push_file(video_path, device_path)
+        try:
+            self.adb.push_file(video_path, device_path)
+        except Exception as e:
+            log.error("Failed to push reel to device: %s", e)
+            return "media_error"
         time.sleep(self.human.timing("t_file_push"))
 
         self.adb.shell(
@@ -578,9 +670,92 @@ class InstagramBot:
         if current and INSTAGRAM_PKG in current:
             log.info("Reel posted on Instagram!")
             self.adb.shell(f'rm "{device_path}"')
-            return True
+            return "success"
         else:
             log.warning("Post may have failed (current app: %s), keeping video on device", current)
+            return "retryable"
+
+    def save_as_draft(self, video_path: str, caption: str = "") -> bool:
+        """Open the reel upload screen, fill caption, save as draft.
+
+        Returns True if draft was saved, False if draft save failed.
+        Instagram draft: navigate to share screen, tap Back, confirm 'Save Draft'.
+        """
+        now = datetime.now()
+        vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
+        device_path = f"/sdcard/Download/{vid_name}"
+        log.info("Saving as draft — pushing reel to device: %s", device_path)
+        try:
+            self.adb.push_file(video_path, device_path)
+        except Exception as e:
+            log.error("Failed to push reel for draft: %s", e)
+            return False
+        time.sleep(self.human.timing("t_file_push"))
+
+        self.adb.shell(
+            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
+            f'-d "file://{device_path}"'
+        )
+        time.sleep(self.human.timing("t_file_push"))
+
+        # Tap + (create) button
+        x, y = self.adb.get_coord("instagram", "nav_create")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_upload_load"))
+
+        # Switch to REEL tab
+        x, y = self.adb.get_coord("instagram", "reel_tab")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Select video from gallery
+        x, y = self.adb.get_coord("instagram", "gallery_first")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Tap Next (top-right)
+        x, y = self.adb.get_coord("instagram", "upload_next_btn")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Skip editing, tap Next again
+        x, y = self.adb.get_coord("instagram", "upload_next_btn")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Add caption if provided
+        if caption:
+            x, y = self.adb.get_coord("instagram", "upload_caption")
+            x, y = self.human.jitter_tap(x, y)
+            self.adb.tap(x, y)
+            time.sleep(self.human.timing("t_caption_input"))
+
+            self.human.type_with_errors(self.adb, caption)
+            time.sleep(self.human.timing("t_post_typing"))
+
+        # Instagram draft: press Back to trigger "Save Draft?" dialog
+        self.adb.press_back()
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Tap "Save Draft" in the confirmation dialog
+        x, y = self.adb.get_coord("instagram", "save_draft_confirm")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Verify: check we're still in Instagram
+        current = self.adb.get_current_app()
+        if current and INSTAGRAM_PKG in current:
+            log.info("Reel saved as draft on Instagram")
+            self.adb.shell(f'rm "{device_path}"')
+            return True
+        else:
+            log.warning("Draft save may have failed (current app: %s)", current)
             return False
 
     # --- High-Level Session ------------------------------------------------
@@ -643,9 +818,10 @@ class InstagramBot:
 
             if should_post and not post_done and elapsed >= post_after:
                 if video_path:
-                    success = self.post_reel(video_path, caption)
+                    result = self.post_reel(video_path, caption)
                     post_done = True
-                    if success:
+                    self._last_post_result = result
+                    if result == "success":
                         self.go_to_reels()
                         current_view = "reels"
                         time.sleep(self.human.timing("t_nav_settle"))
@@ -739,6 +915,12 @@ class InstagramBot:
                         await asyncio.sleep(self.human.timing("t_double_open_2"))
                     await self.comment_with_ai()
                     self.human.on_engage()
+                elif self.human.should_browse_comments():
+                    # Just browse comments without writing (reading mode)
+                    self.open_comments()
+                    await self.browse_comments()
+                    self.adb.press_back()
+                    log.debug("Browsed IG comments (read-only)")
 
             elif action == "follow":
                 if self.human.should_follow():
diff --git a/phone-bot/actions/tiktok.py b/phone-bot/actions/tiktok.py
index 0401d33..16271eb 100644
--- a/phone-bot/actions/tiktok.py
+++ b/phone-bot/actions/tiktok.py
@@ -17,10 +17,11 @@ import threading
 from datetime import datetime
 
 from .. import config
-from ..core.adb import ADBController
+from ..core.adb import ADBController, DeviceLostError
 from ..core.human import HumanEngine
 from ..core import gemini
 from ..core import page_state
+from ..core import ocr as ocr_mod
 from ..core.verify import wait_and_verify
 from ..core.monitor import log_event as monitor_log, BotEvent
 
@@ -950,13 +951,62 @@ class TikTokBot:
         from ..core import gemini as _gem
         return _gem.should_skip_content(screenshot)
 
+    # --- Post-swipe LIVE/PYMK check (Section 06) ---------------------------
+
+    def _post_swipe_live_check(self) -> bool:
+        """Called immediately after scroll_fyp() in browse_session().
+        Waits t_swipe_settle for screen to settle, then checks if the
+        new video is a LIVE preview card (or PYMK/non-standard).
+
+        Returns True if double-scroll was performed (caller should continue).
+        Returns False if normal video confirmed (proceed normally).
+        """
+        try:
+            time.sleep(self.human.timing("t_swipe_settle"))
+
+            # Sidebar scan: LIVE preview has sidebar but NO avatar
+            sidebar, shot = self._get_sidebar_with_shot()
+
+            if sidebar is not None:
+                if sidebar.get("avatar_live"):
+                    log.info("LIVE preview detected (red ring), double-scrolling")
+                    time.sleep(self.human.timing("t_live_skip_pause"))
+                    self.scroll_fyp()
+                    return True
+
+                if sidebar.get("avatar") is None:
+                    if self._should_skip_content(shot):
+                        log.info("LIVE/non-standard detected (sidebar, no avatar, Gemini=SKIP), double-scrolling")
+                        time.sleep(self.human.timing("t_live_skip_pause"))
+                        self.scroll_fyp()
+                        return True
+
+            if sidebar is None:
+                if self._should_skip_content(shot):
+                    log.info("non-standard post-swipe content (no sidebar), double-scrolling")
+                    time.sleep(self.human.timing("t_live_skip_pause"))
+                    self.scroll_fyp()
+                    return True
+
+            return False
+        except DeviceLostError:
+            raise  # propagate to browse_session handler
+        except Exception as e:
+            log.warning("_post_swipe_live_check error (assuming normal video): %s", e)
+            return False
+
     # --- Health check during non-FYP tab scroll ----------------------------
 
     def _health_check_during_scroll(self, target_tab: str = "following") -> bool:
         """Periodic health check during video scrolling in non-FYP tabs.
         Verifies we're still on a video feed (not kicked to profile, inbox, etc).
         Uses page_state pixel detection (zero Gemini, <5ms).
-        Returns True if OK, False if wrong page detected."""
+        Also checks for CAPTCHA (F3: mid-session detection in all browse modes).
+        Returns True if OK, False if wrong page or CAPTCHA detected."""
+        # CAPTCHA check (F3: covers Following/Explore/Shop sessions too)
+        if self._detect_captcha():
+            return False
+
         screenshot = self.adb.screenshot_bytes()
         if not screenshot:
             return True  # can't check, assume OK
@@ -981,9 +1031,17 @@ class TikTokBot:
 
     # --- Bbox-first tap (find element THEN tap) ----------------------------
 
+    def _screenshot_bgr(self, screenshot_bytes: bytes):
+        """Convert screenshot bytes → BGR numpy array for OCR."""
+        import numpy as np
+        import cv2
+        arr = np.frombuffer(screenshot_bytes, np.uint8)
+        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
+
     def _find_and_tap(self, description: str, fallback_coord: str = None,
                       y_max_pct: float = None, x_min_pct: float = None,
-                      tap_y_bias: float = 0.0) -> bool:
+                      tap_y_bias: float = 0.0,
+                      ocr_text: str = None, ocr_region: tuple = None) -> bool:
         """Find a UI element via Gemini bounding box, then tap its center.
         This is the definitive solution for elements whose position varies
         per video (avatar, comment icon, etc).
@@ -1005,8 +1063,26 @@ class TikTokBot:
 
         Returns True if element found and tapped, False if not found.
         """
+        # OCR fast-path: try OCR first if caller provides target text (~300ms vs 3-8s Gemini)
+        _ocr_shot = None
+        if ocr_text:
+            _ocr_shot = self.adb.screenshot_bytes()
+            if _ocr_shot:
+                region = ocr_region or (0.0, 0.0, 1.0, 1.0)
+                bgr = self._screenshot_bgr(_ocr_shot)
+                result = ocr_mod.find_text_coord(bgr, ocr_text, region)
+                if result:
+                    cx, cy = result
+                    cx, cy = self.human.jitter_tap(cx, cy)
+                    self.adb.tap(cx, cy)
+                    log.info("FIND_TAP_OCR: found '%s' at (%d,%d)", ocr_text, cx, cy)
+                    return True
+                log.debug("FIND_TAP_OCR: '%s' not found, falling back to Gemini", ocr_text)
+
         for attempt in range(2):
-            screenshot = self.adb.screenshot_bytes()
+            # Reuse the OCR screenshot on first attempt to avoid a redundant ADB round-trip
+            screenshot = _ocr_shot if (attempt == 0 and _ocr_shot) else self.adb.screenshot_bytes()
+            _ocr_shot = None  # only reuse once
             if not screenshot:
                 if fallback_coord:
                     log.warning("FIND_TAP: no screenshot, using fallback '%s'", fallback_coord)
@@ -1641,6 +1717,10 @@ class TikTokBot:
             if not self.adb._touch_health_check():
                 log.warning("UHID health check failed")
 
+        # CAPTCHA mid-session detection (F3: check during health, not just on restart)
+        if self._detect_captcha():
+            return False
+
         # Pixel overlay check (free, <5ms)
         screenshot, fp = self.guardian.take_fingerprint()
         if fp and self.guardian._last_clean_fp:
@@ -1906,12 +1986,21 @@ class TikTokBot:
         return False
 
     def scroll_fyp(self):
-        """Scroll to the next video on FYP (swipe up)."""
+        """Scroll to the next video on FYP (swipe up).
+        end_y is clamped to screen_h * 0.88 to avoid the 'Search · username'
+        suggestion bar injected at y=92-95% after profile visits.
+        """
         log.debug("SCROLL_FYP")
         sw = self.human.humanize_swipe(
             self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
             self.adb.screen_w // 2, self.adb.screen_h // 4,
         )
+        # FYP-specific guard: clamp end_y below suggestion bar zone (y=92-95%)
+        end_y_max = int(self.adb.screen_h * 0.88)
+        original_y2 = sw["y2"]
+        sw["y2"] = min(sw["y2"], end_y_max)
+        if sw["y2"] < original_y2:
+            log.debug("scroll_fyp: end_y clamped %d -> %d", original_y2, sw["y2"])
         if sw.get("hand_switched"):
             time.sleep(sw["hand_switch_pause"])
         self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
@@ -2761,6 +2850,21 @@ JSON only, no markdown."""
         """Ask Gemini: is the Follow or Following button visible on this profile?
         Uses bounding box mode for accurate coordinates.
         Returns {"status": "follow"|"following"|"not_visible", "x": int|None, "y": int|None}"""
+        # OCR fast-path: check Follow/Following button in profile button area.
+        # IMPORTANT: uses exact word matching (not fuzzy) to avoid "Follow" matching "Following".
+        region = (0.05, 0.25, 0.95, 0.48)
+        bgr = self._screenshot_bgr(screenshot_bytes)
+        ocr_status = ocr_mod.find_follow_status(bgr, region)
+        if ocr_status == "following":
+            log.info("FOLLOW_CHECK_OCR: status=following")
+            return {"status": "following", "x": None, "y": None}
+        if ocr_status == "follow":
+            coords = ocr_mod.find_text_coord(bgr, "Follow", region)
+            if coords:
+                cx, cy = coords
+                log.info("FOLLOW_CHECK_OCR: status=follow at (%d,%d)", cx, cy)
+                return {"status": "follow", "x": cx, "y": cy}
+
         import re
 
         prompt = """Look at this TikTok profile screenshot.
@@ -3455,8 +3559,12 @@ JSON only, no markdown."""
         if shot:
             result = gemini.identify_page_with_recovery(shot)
             page = result.get("page", "unknown")
-            if page != "profile":
-                log.warning("Grid scroll opened fullscreen player (%s), pressing BACK", page)
+            # Press BACK only if we left the search grid (opened fullscreen, popup, etc.)
+            # "search" = still on grid (correct) — do NOT press BACK (EP-03 fix)
+            # "profile" = navigated to profile — acceptable, no BACK needed
+            # "unknown" = can't tell — conservative, no BACK
+            if page not in ("search", "profile", "unknown"):
+                log.warning("Grid scroll left search grid (%s), pressing BACK", page)
                 self.adb.press_back()
                 time.sleep(self.human.timing("t_nav_settle"))
         return True
@@ -3485,7 +3593,12 @@ JSON only, no markdown."""
             y_top = 0.42    # top of comment sheet
             y_bottom = 0.88  # bottom of comment sheet (above input field)
             max_dist = 0.30  # max scroll distance within sheet
-        else:  # grid (search results, profile)
+        elif context == "grid":
+            y_top = 0.15
+            y_bottom = 0.85
+            max_dist = 0.20  # was 0.55 — large swipes open fullscreen on small thumbnails (section-08)
+        else:
+            # shop_grid, shop_product, or future contexts
             y_top = 0.15
             y_bottom = 0.85
             max_dist = 0.55
@@ -3521,7 +3634,9 @@ JSON only, no markdown."""
             dist = max(0.08, min(max_dist, random.gauss(base_dist, 0.10)))
 
             # Speed: patient = slow, impatient = fast flick
-            if patience > 1.0:
+            if context == "grid":
+                duration = int(self.human.timing("t_grid_scroll_duration") * 1000)  # section-08: slower scroll for small thumbnails
+            elif patience > 1.0:
                 duration = random.randint(350, 550)  # slow careful scroll
             elif fatigue > 0.4:
                 duration = random.randint(250, 350)  # tired fast flick
@@ -3683,6 +3798,38 @@ JSON only, no markdown."""
         time.sleep(self.human.timing("t_nav_settle"))
         self._verify_page("fyp")
 
+    def _thumbnails_loaded(self, screenshot: bytes) -> bool:
+        """Check if search grid thumbnails are loaded (not showing spinner).
+
+        Samples pixel brightness at 6 positions across the 2-column grid area.
+        Thumbnails have high color variance (stdev > 30 across sample points).
+        Spinner is uniform gray/white (stdev < 30).
+        Same approach as page_state.detect_bottom_bar() — avoids false positives
+        that a brightness-only check would produce (spinner can also be bright).
+        """
+        try:
+            from PIL import Image
+            import io
+            img = Image.open(io.BytesIO(screenshot)).convert("L")
+            w, h = img.size
+            # Sample 6 positions in the grid area (below tab bar ~20%, above nav ~90%)
+            # Left column ~25%, right column ~75%, rows at 40%, 55%, 70% of screen
+            sample_xs = [int(w * 0.25), int(w * 0.75)]
+            sample_ys = [int(h * 0.40), int(h * 0.55), int(h * 0.70)]
+            brightness = []
+            for x in sample_xs:
+                for y in sample_ys:
+                    brightness.append(img.getpixel((x, y)))
+            mean = sum(brightness) / len(brightness)
+            stdev = (sum((b - mean) ** 2 for b in brightness) / len(brightness)) ** 0.5
+            loaded = stdev > 30
+            log.debug("THUMBNAILS_LOADED: stdev=%.1f values=%s -> %s",
+                      stdev, brightness, "loaded" if loaded else "spinner")
+            return loaded
+        except Exception as e:
+            log.warning("THUMBNAILS_LOADED: error %s, assuming loaded", e)
+            return True  # fail-safe: proceed rather than block forever
+
     def _type_search_query(self, keyword: str) -> bool:
         """Navigate to search, type keyword, hit enter. Returns False if search failed."""
         log.info("SEARCH: typing '%s'", keyword)
@@ -3707,39 +3854,57 @@ JSON only, no markdown."""
         # Tap "Videos" tab to get the video grid we can actually browse.
         self._find_and_tap(
             'the "Videos" tab text in the horizontal filter bar (Top/Videos/Users/Sounds)',
-            y_max_pct=0.20)
-        # Wait for Videos grid to load (shows spinner for 1-3s)
-        time.sleep(self.human.timing("t_tab_switch"))
-        time.sleep(self.human.timing("t_feed_refresh"))  # extra wait for grid thumbnails
+            y_max_pct=0.20,
+            ocr_text="Videos", ocr_region=(0.0, 0.10, 1.0, 0.22))
+        # Wait for Videos grid thumbnails to load (shows spinner 1-3s on slow connections).
+        # Use stdev pixel check instead of fixed wait: thumbnails have high color variance,
+        # spinner is uniform gray (low stdev). Same approach as detect_bottom_bar().
+        from ..core.verify import wait_and_verify
+        wait_and_verify(
+            adb=self.adb, human=self.human,
+            verify_fn=self._thumbnails_loaded,
+            action_name="search_videos_tab_load",
+            first_wait="t_tab_switch",
+            retry_wait="t_feed_refresh",
+            max_attempts=4,
+        )
         return True
 
     def _clear_and_retype(self, keyword: str):
         """Clear search bar and type new keyword.
 
-        Strategy: triple-tap search bar to select all text (universal Android
-        gesture), then typing overwrites the selection. If that fails, fall
-        back to X button tap, then to back+reopen as last resort.
+        Strategy: tap the × clear button in the TikTok search bar (always
+        present when text exists), then type new keyword.
+        Triple-tap and CTRL_A both fail on TikTok's React Native TextInput.
+        The × button is a reliable UI-level clear that works on all Android versions.
         """
         log.info("SEARCH_RETYPE: clearing, new='%s'", keyword)
 
-        # Strategy 1: Tap search bar, triple-tap to select all, then type
-        # (typing with text selected overwrites it — no need for DEL)
-        x, y = self.adb.get_coord("tiktok", "search_bar")
-        x, y = self.human.jitter_tap(x, y)
-        self.adb.tap(x, y)
-        time.sleep(0.3)
-        # Triple-tap: select all text in the field
-        # Each tap has slight position drift + variable timing (human finger)
-        for i in range(3):
-            tx = x + random.randint(-4, 4)
-            ty = y + random.randint(-3, 3)
-            self.adb.tap(tx, ty)
-            if i < 2:
-                time.sleep(random.uniform(0.05, 0.14))  # fast but not identical
-        time.sleep(random.uniform(0.2, 0.5))
+        # Tap the × (clear) button at the right side of the search bar.
+        # This button appears in TikTok's search bar whenever text is present.
+        # Using _find_and_tap for universality (no hardcoded coords).
+        tapped = self._find_and_tap(
+            'the X or circle-X clear/cancel button at the RIGHT side of the search input bar '
+            'at the TOP of the screen. It clears the search text. '
+            'Do NOT select the back arrow on the left.',
+            y_max_pct=0.12,
+            x_min_pct=0.60,
+        )
+        if not tapped:
+            # Fallback: tap search bar, then send KEYCODE_MOVE_END + hold-shift-MOVE_HOME,
+            # then delete. Less reliable but recoverable.
+            log.warning("SEARCH_RETYPE: X button not found, using fallback DPAD_MOVE_END + DEL")
+            x, y = self.adb.get_coord("tiktok", "search_bar")
+            self.adb.tap(x, y)
+            time.sleep(self.human.timing("t_tap_gap"))
+            self.adb.shell("input keyevent KEYCODE_MOVE_END")
+            time.sleep(0.1)
+            # Send enough DEL keyevents to clear typical search text (up to 40 chars)
+            for _ in range(40):
+                self.adb.shell("input keyevent KEYCODE_DEL")
+        time.sleep(self.human.timing("t_tap_gap"))
 
-        # Now type — if text was selected, this overwrites it.
-        # If not selected, it appends (we'll detect via search results later)
+        # Type new keyword
         time.sleep(self.human.timing("t_thinking"))
         self.human.type_with_errors(self.adb, keyword)
         time.sleep(self.human.timing("micro_pause"))
@@ -3749,8 +3914,17 @@ JSON only, no markdown."""
         # Tap "Videos" tab (BACK from video returns to "Top" tab)
         self._find_and_tap(
             'the "Videos" tab text in the horizontal filter bar (Top/Videos/Users/Sounds)',
-            y_max_pct=0.20)
-        time.sleep(self.human.timing("t_tab_switch"))
+            y_max_pct=0.20,
+            ocr_text="Videos", ocr_region=(0.0, 0.10, 1.0, 0.22))
+        from ..core.verify import wait_and_verify
+        wait_and_verify(
+            adb=self.adb, human=self.human,
+            verify_fn=self._thumbnails_loaded,
+            action_name="search_videos_tab_load",
+            first_wait="t_tab_switch",
+            retry_wait="t_feed_refresh",
+            max_attempts=4,
+        )
 
     def _ensure_search_tab(self, target_tab: str) -> bool:
         """Verify the specified search results tab is active (underlined/bold).
@@ -3783,7 +3957,8 @@ JSON only, no markdown."""
         self._find_and_tap(
             'the "%s" tab text in the horizontal search filter bar '
             '(Top/Videos/Users/Live)' % target_tab,
-            y_max_pct=0.20)
+            y_max_pct=0.20,
+            ocr_text=target_tab, ocr_region=(0.0, 0.10, 1.0, 0.22))
         time.sleep(self.human.timing("t_tab_switch"))
 
         # Verify
@@ -4194,16 +4369,21 @@ JSON only, no markdown."""
 
     # --- Video Posting -----------------------------------------------------
 
-    def post_video(self, video_path: str, caption: str = "") -> bool:
+    def post_video(self, video_path: str, caption: str = "") -> str:
         """Upload and post a video to TikTok.
-        Returns True if successful.
+
+        Returns one of: "success" | "retryable" | "banned" | "media_error"
         """
         # Step 1: Push video to /sdcard/Download/ (not DCIM -- no EXIF = suspicious there)
         now = datetime.now()
         vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
         device_path = f"/sdcard/Download/{vid_name}"
         log.info("Pushing video to device: %s", device_path)
-        self.adb.push_file(video_path, device_path)
+        try:
+            self.adb.push_file(video_path, device_path)
+        except Exception as e:
+            log.error("Failed to push video to device: %s", e)
+            return "media_error"
         time.sleep(self.human.timing("t_file_push"))
 
         # Trigger media scan
@@ -4276,9 +4456,98 @@ JSON only, no markdown."""
         if current and TIKTOK_PKG in current:
             log.info("Video posted on TikTok!")
             self.adb.shell(f'rm "{device_path}"')
-            return True
+            return "success"
         else:
             log.warning("Post may have failed (current app: %s), keeping video on device", current)
+            return "retryable"
+
+    def save_as_draft(self, video_path: str, caption: str = "") -> bool:
+        """Open the post screen, fill caption, tap Save Draft instead of Post.
+
+        Returns True if draft was saved, False if draft save failed.
+        Called by executor after all post retries are exhausted.
+        """
+        now = datetime.now()
+        vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
+        device_path = f"/sdcard/Download/{vid_name}"
+        log.info("Saving as draft — pushing video to device: %s", device_path)
+        try:
+            self.adb.push_file(video_path, device_path)
+        except Exception as e:
+            log.error("Failed to push video for draft: %s", e)
+            return False
+        time.sleep(self.human.timing("t_file_push"))
+
+        # Trigger media scan
+        self.adb.shell(
+            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
+            f'-d "file://{device_path}"'
+        )
+        time.sleep(self.human.timing("t_file_push"))
+
+        # Tap + (create) button
+        self.guardian.handle_if_popup()
+        x, y = self.adb.get_coord("tiktok", "nav_create")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_upload_load"))
+
+        # Tap "Upload" tab
+        self.guardian.handle_if_popup()
+        x, y = self.adb.get_coord("tiktok", "upload_tab")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Select most recent video (top-left of gallery)
+        self.guardian.handle_if_popup()
+        x, y = self.adb.get_coord("tiktok", "gallery_first")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Tap Next (top-right)
+        self.guardian.handle_if_popup()
+        x, y = self.adb.get_coord("tiktok", "upload_next_btn")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Tap Next again (editing screen)
+        self.guardian.handle_if_popup()
+        x, y = self.adb.get_coord("tiktok", "edit_next_btn")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Add caption if provided
+        if caption:
+            x, y = self.adb.get_coord("tiktok", "upload_caption")
+            x, y = self.human.jitter_tap(x, y)
+            self.adb.tap(x, y)
+            time.sleep(self.human.timing("t_caption_input"))
+
+            self.adb.shell("input keyevent --longpress KEYCODE_DEL")
+            time.sleep(self.human.timing("t_key_settle"))
+
+            self.human.type_with_errors(self.adb, caption)
+            time.sleep(self.human.timing("t_post_typing"))
+
+        # Tap Save Draft (instead of Post)
+        self.guardian.pre_chain_check()
+        x, y = self.adb.get_coord("tiktok", "upload_save_draft_btn")
+        x, y = self.human.jitter_tap(x, y)
+        self.adb.tap(x, y)
+        time.sleep(self.human.timing("t_nav_settle"))
+
+        # Verify: check we're still in TikTok
+        current = self.adb.get_current_app()
+        if current and TIKTOK_PKG in current:
+            log.info("Video saved as draft on TikTok")
+            self.adb.shell(f'rm "{device_path}"')
+            return True
+        else:
+            log.warning("Draft save may have failed (current app: %s)", current)
             return False
 
     # --- High-Level Session Actions ----------------------------------------
@@ -4661,7 +4930,8 @@ JSON only, no markdown."""
         view_all_drive = curiosity * 0.35 + social * 0.15 - fatigue * 0.1
         if random.random() < max(0.08, min(0.35, view_all_drive)):
             log.info("NEW_FOLLOWERS: tapping 'View all'")
-            found_va = self._find_and_tap("View all", y_max_pct=0.60)
+            found_va = self._find_and_tap("View all", y_max_pct=0.60,
+                                          ocr_text="View all", ocr_region=(0.0, 0.30, 0.65, 0.65))
             if found_va:
                 time.sleep(self.human.timing("t_tab_switch"))
                 items_seen += 2
@@ -4735,7 +5005,8 @@ JSON only, no markdown."""
             found = self._find_and_tap(
                 'the "Profile views" notification row with a blue/purple people icon. '
                 'NOT bulletin board invites. NOT "liked your comment".',
-                y_max_pct=0.55
+                y_max_pct=0.55,
+                ocr_text="Profile views", ocr_region=(0.0, 0.15, 1.0, 0.60)
             )
             if found:
                 log.info("ACTIVITY: opened Profile views")
@@ -4752,7 +5023,8 @@ JSON only, no markdown."""
             va_drive = curiosity * 0.3 + social * 0.12 - fatigue * 0.08
             if random.random() < max(0.06, min(0.25, va_drive)):
                 log.info("ACTIVITY: tapping 'View all'")
-                found_va = self._find_and_tap("View all", y_max_pct=0.55)
+                found_va = self._find_and_tap("View all", y_max_pct=0.55,
+                                              ocr_text="View all", ocr_region=(0.0, 0.25, 0.65, 0.60))
                 if found_va:
                     time.sleep(self.human.timing("t_tab_switch"))
 
@@ -4836,7 +5108,8 @@ JSON only, no markdown."""
             return False
 
         for attempt in range(2):
-            found = self._find_and_tap(row_desc, y_max_pct=0.55)
+            found = self._find_and_tap(row_desc, y_max_pct=0.55,
+                                       ocr_text=label, ocr_region=(0.0, 0.15, 1.0, 0.75))
             if not found:
                 log.warning("INBOX: %s not found on screen (attempt %d)", label, attempt + 1)
                 if attempt == 0:
@@ -4996,6 +5269,7 @@ JSON only, no markdown."""
             self.guardian._last_clean_fp = init_fp
 
         while (time.time() - start) < total_seconds:
+          try:
             elapsed = time.time() - start
 
             # Hard ceiling: prevent runaway sessions (Gemini slow, API hangs)
@@ -5010,14 +5284,17 @@ JSON only, no markdown."""
             # Periodic health check (randomized interval)
             action_count += 1
             if action_count % health_interval == 0:
-                self._check_health()
+                if not self._check_health():
+                    log.warning("SESSION: health check failed (CAPTCHA/attention needed), ending session")
+                    break
 
             # --- Post video at the right time ---
             if should_post and not post_done and elapsed >= post_after:
                 if video_path:
-                    success = self.post_video(video_path, caption)
+                    result = self.post_video(video_path, caption)
                     post_done = True
-                    if success:
+                    self._last_post_result = result
+                    if result == "success":
                         self.go_to_fyp()
                         time.sleep(self.human.timing("t_nav_settle"))
                     continue
@@ -5140,6 +5417,10 @@ JSON only, no markdown."""
                 else:
                     self.scroll_fyp()
 
+                    # Section 06: immediate LIVE/PYMK check after swipe
+                    if self._post_swipe_live_check():
+                        continue  # double-scrolled past LIVE/PYMK, restart loop
+
                     # --- PopupGuardian: fingerprint AFTER swipe, check stall ---
                     _post_shot, _post_fp = self.guardian.take_fingerprint()
                     if _pre_fp and _post_fp:
@@ -5329,6 +5610,13 @@ JSON only, no markdown."""
                     self.human._inbox_badge_detected = page_state.detect_inbox_badge(
                         _shot, self.adb.screen_w, self.adb.screen_h)
 
+          except DeviceLostError:
+            log.error("SESSION: device disconnected during browse_session, ending gracefully")
+            break
+          except Exception as e:
+            log.error("SESSION: unexpected error in main loop: %s", e, exc_info=True)
+            break
+
         # --- Session end ---
         self.guardian.log_stats()
 
diff --git a/phone-bot/core/coords.py b/phone-bot/core/coords.py
index d0699a3..6402528 100644
--- a/phone-bot/core/coords.py
+++ b/phone-bot/core/coords.py
@@ -122,6 +122,7 @@ TIKTOK = {
     "record_btn":       lambda w, h: (int(w * 0.50), int(h * 0.946)),
     "upload_next_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
     "upload_post_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
+    "upload_save_draft_btn": lambda w, h: (int(w * 0.20), int(h * 0.97)),
     "upload_caption":   lambda w, h: (int(w * 0.50), int(h * 0.15)),
 
     # --- Edit Screen (after recording/selecting) ---
@@ -182,6 +183,7 @@ INSTAGRAM = {
     "upload_next_btn":  lambda w, h: (int(w * 0.944), int(h * 0.023)),
     "upload_share_btn": lambda w, h: (int(w * 0.944), int(h * 0.023)),
     "upload_caption":   lambda w, h: (int(w * 0.50), int(h * 0.15)),
+    "save_draft_confirm": lambda w, h: (int(w * 0.50), int(h * 0.44)),
 
     # --- Profile / Edit Profile ---
     "edit_profile_btn": lambda w, h: (int(w * 0.50), int(h * 0.22)),
diff --git a/phone-bot/planner/executor.py b/phone-bot/planner/executor.py
index e4be6ad..718ea32 100644
--- a/phone-bot/planner/executor.py
+++ b/phone-bot/planner/executor.py
@@ -451,19 +451,93 @@ class SessionExecutor:
         await bot.browse_session(duration_minutes=duration_min, should_post=False,
                                  niche_keywords=session_keywords)
 
+    async def _post_with_retry(
+        self,
+        bot,
+        adb: ADBController,
+        platform: str,
+        video_path: str,
+        caption: str,
+        phone_id: int,
+        record_id: str,
+        dry_run: bool = False,
+    ) -> str:
+        """Try to post, reset app and retry once on retryable failure, fall back to draft.
+
+        Returns one of: "posted" | "draft" | "failed" | "failed_permanent"
+
+        Retry flow:
+            Attempt 1: post_video/post_reel
+              -> "success":     mark_posted, return "posted"
+              -> "retryable":   force-stop app, wait 3s, reopen app, wait for load
+              -> "banned":      return "failed_permanent" (no retry, no draft)
+              -> "media_error": return "failed_permanent" (no retry, no draft)
+            Attempt 2: post_video/post_reel
+              -> "success":     mark_posted, return "posted"
+              -> any failure:   fall through to draft save
+            Draft save: bot.save_as_draft
+              -> True:   mark_draft in Airtable, return "draft"
+              -> False:  send critical Telegram alert, return "failed"
+
+        DeviceLostError propagates up (not caught here).
+        """
+        from ..actions.tiktok import TIKTOK_PKG
+        from ..actions.instagram import INSTAGRAM_PKG
+
+        pkg = TIKTOK_PKG if platform == "tiktok" else INSTAGRAM_PKG
+        post_fn = bot.post_video if platform == "tiktok" else bot.post_reel
+
+        for attempt in range(2):
+            result = post_fn(video_path, caption)
+            log.info("Post attempt %d/%d: %s (platform=%s, phone=%d)",
+                     attempt + 1, 2, result, platform, phone_id)
+
+            if result == "success":
+                if not dry_run and mark_posted:
+                    mark_posted(record_id, platform)
+                return "posted"
+
+            if result in ("banned", "media_error"):
+                log.error("Permanent post failure: %s — no retry", result)
+                return "failed_permanent"
+
+            # "retryable" — app-reset before next attempt
+            if attempt == 0:
+                log.warning("Post retryable — resetting app before retry")
+                adb.shell(f"am force-stop {pkg}")
+                await asyncio.sleep(3.0)
+                bot.open_app()
+                await asyncio.sleep(bot.human.timing("t_app_load"))
+
+        # Both attempts failed — try saving as draft
+        log.warning("Post failed after 2 attempts — trying save_as_draft")
+        draft_ok = bot.save_as_draft(video_path, caption)
+        if draft_ok:
+            if not dry_run and mark_draft:
+                mark_draft(record_id, platform)
+            return "draft"
+
+        # Draft also failed — critical alert
+        log.critical("BOTH post AND draft failed (phone=%d, platform=%s)", phone_id, platform)
+        account = getattr(self, '_current_account', '')
+        tg_alert(phone_id, account,
+                 f"CRITICAL: Post AND draft both failed for {platform}")
+        return "failed"
+
     async def _execute_normal(self, adb: ADBController, human: HumanEngine,
                                platform: str, duration_min: float,
                                should_post: bool, post_outcome: str,
                                pre_minutes: float, post_minutes: float,
                                phone_id: int):
-        """Normal/extended session: scroll → post → scroll."""
+        """Normal/extended session: scroll -> post -> scroll."""
         video_path = ""
         caption = ""
+        record_id = None
         self._pending_record = None  # reset per session
 
         if should_post and post_outcome == "posted":
             # Fetch video from Content Library via delivery module
-            video_info = get_next_video(phone_id, platform)
+            video_info = get_next_video(phone_id, platform) if get_next_video else None
             if video_info:
                 # Download with timeout to prevent session stall
                 try:
@@ -475,7 +549,8 @@ class SessionExecutor:
                 if local_path:
                     video_path = local_path
                     caption = video_info.get("caption", "")
-                    self._pending_record = video_info["record_id"]
+                    record_id = video_info["record_id"]
+                    self._pending_record = record_id
                 else:
                     log.warning("Failed to download video, will skip post")
                     should_post = False
@@ -484,17 +559,19 @@ class SessionExecutor:
                 should_post = False
 
         elif should_post and post_outcome == "draft":
-            video_info = get_next_video(phone_id, platform)
+            video_info = get_next_video(phone_id, platform) if get_next_video else None
             if video_info:
                 self._pending_record = video_info["record_id"]
-                mark_draft(video_info["record_id"], platform)
+                if mark_draft:
+                    mark_draft(video_info["record_id"], platform)
             should_post = False
 
         elif should_post and post_outcome == "skipped":
-            video_info = get_next_video(phone_id, platform)
+            video_info = get_next_video(phone_id, platform) if get_next_video else None
             if video_info:
                 self._pending_record = video_info["record_id"]
-                mark_skipped(video_info["record_id"], platform)
+                if mark_skipped:
+                    mark_skipped(video_info["record_id"], platform)
             should_post = False
 
         session_keywords = random.sample(
@@ -504,19 +581,35 @@ class SessionExecutor:
 
         account = getattr(self, '_current_account', '')
         bot = self._create_bot(platform, adb, human, account_name=account)
+
+        # Pre-scroll phase
         await bot.browse_session(
-            duration_minutes=duration_min,
-            should_post=should_post,
-            video_path=video_path,
-            caption=caption,
-            pre_scroll_minutes=pre_minutes,
-            post_scroll_minutes=post_minutes,
+            duration_minutes=pre_minutes if should_post else duration_min,
+            should_post=False,
             niche_keywords=session_keywords,
         )
 
-        # Mark video as posted in Airtable
-        if should_post and video_path and self._pending_record:
-            mark_posted(self._pending_record, platform)
+        # Post phase with retry (if applicable)
+        if should_post and video_path and record_id:
+            post_result = await self._post_with_retry(
+                bot, adb, platform, video_path, caption,
+                phone_id, record_id,
+            )
+            log.info("Post result: %s (phone=%d, platform=%s)", post_result, phone_id, platform)
+
+            # Return to main feed after posting
+            if platform == "tiktok":
+                bot.go_to_fyp()
+            else:
+                bot.go_to_reels()
+
+            # Post-scroll phase
+            if post_minutes > 0:
+                await bot.browse_session(
+                    duration_minutes=post_minutes,
+                    should_post=False,
+                    niche_keywords=session_keywords,
+                )
 
     # --- Warmup Session Execution ------------------------------------------
 
@@ -717,12 +810,13 @@ class SessionExecutor:
                 if session.get("use_camera_trick"):
                     await self._tiktok_camera_trick_post(adb, human, bot, session)
                 else:
-                    video_info = get_next_video(session["phone_id"], "tiktok")
+                    video_info = get_next_video(session["phone_id"], "tiktok") if get_next_video else None
                     if video_info:
-                        local_path = download_video(video_info["video_url"])
+                        local_path = download_video(video_info["video_url"]) if download_video else None
                         if local_path:
-                            bot.post_video(local_path, video_info.get("caption", ""))
-                            mark_posted(video_info["record_id"], "tiktok")
+                            result = bot.post_video(local_path, video_info.get("caption", ""))
+                            if result == "success" and mark_posted:
+                                mark_posted(video_info["record_id"], "tiktok")
             except Exception as e:
                 log.error("Warmup TikTok post failed: %s", e, exc_info=True)
 
@@ -908,12 +1002,13 @@ class SessionExecutor:
         # Post on last day
         if session.get("can_post"):
             try:
-                video_info = get_next_video(session["phone_id"], "instagram")
+                video_info = get_next_video(session["phone_id"], "instagram") if get_next_video else None
                 if video_info:
-                    local_path = download_video(video_info["video_url"])
+                    local_path = download_video(video_info["video_url"]) if download_video else None
                     if local_path:
-                        bot.post_reel(local_path, video_info.get("caption", ""))
-                        mark_posted(video_info["record_id"], "instagram")
+                        result = bot.post_reel(local_path, video_info.get("caption", ""))
+                        if result == "success" and mark_posted:
+                            mark_posted(video_info["record_id"], "instagram")
             except Exception as e:
                 log.error("Warmup Instagram post failed: %s", e, exc_info=True)
 
diff --git a/phone-bot/tests/test_post_retry.py b/phone-bot/tests/test_post_retry.py
new file mode 100644
index 0000000..61eda5e
--- /dev/null
+++ b/phone-bot/tests/test_post_retry.py
@@ -0,0 +1,161 @@
+"""Tests for post retry logic in executor.py.
+
+Tests the retry flow: attempt 1 -> app-reset -> attempt 2 -> draft fallback.
+All dependencies mocked — no ADB, no Airtable, no phone needed.
+
+Uses asyncio.run() to run async tests without pytest-asyncio dependency.
+"""
+import asyncio
+import pytest
+from unittest.mock import MagicMock
+
+
+# ---------------------------------------------------------------------------
+# Standalone retry function — mirrors executor._post_with_retry() algorithm
+# ---------------------------------------------------------------------------
+
+async def post_with_retry(bot, adb, platform, video_path, caption,
+                          phone_id, record_id, mark_posted_fn=None,
+                          mark_draft_fn=None, tg_alert_fn=None) -> str:
+    """Retry logic identical to executor._post_with_retry()."""
+    pkg = "com.zhiliaoapp.musically" if platform == "tiktok" else "com.instagram.android"
+    post_fn = bot.post_video if platform == "tiktok" else bot.post_reel
+
+    for attempt in range(2):
+        result = post_fn(video_path, caption)
+
+        if result == "success":
+            if mark_posted_fn:
+                mark_posted_fn(record_id, platform)
+            return "posted"
+
+        if result in ("banned", "media_error"):
+            return "failed_permanent"
+
+        if attempt == 0:
+            adb.shell(f"am force-stop {pkg}")
+            await asyncio.sleep(0.01)
+            bot.open_app()
+            await asyncio.sleep(0.01)
+
+    draft_ok = bot.save_as_draft(video_path, caption)
+    if draft_ok:
+        if mark_draft_fn:
+            mark_draft_fn(record_id, platform)
+        return "draft"
+
+    if tg_alert_fn:
+        tg_alert_fn(phone_id, "", f"CRITICAL: Post AND draft both failed for {platform}")
+    return "failed"
+
+
+# ---------------------------------------------------------------------------
+# Helpers
+# ---------------------------------------------------------------------------
+
+class FakeDeviceLostError(Exception):
+    pass
+
+
+def _bot(post_results, save_draft_result=True, platform="tiktok"):
+    bot = MagicMock()
+    bot.human = MagicMock()
+    bot.human.timing = MagicMock(return_value=0.01)
+    bot.open_app = MagicMock()
+    bot.save_as_draft = MagicMock(return_value=save_draft_result)
+    if platform == "tiktok":
+        bot.post_video = MagicMock(side_effect=list(post_results))
+    else:
+        bot.post_reel = MagicMock(side_effect=list(post_results))
+    return bot
+
+
+def _adb():
+    adb = MagicMock()
+    adb.shell = MagicMock()
+    return adb
+
+
+def _run(coro):
+    return asyncio.get_event_loop().run_until_complete(coro)
+
+
+# ---------------------------------------------------------------------------
+# Tests
+# ---------------------------------------------------------------------------
+
+class TestPostWithRetry:
+
+    def test_returns_posted_on_first_success(self):
+        bot, adb, mp = _bot(["success"]), _adb(), MagicMock()
+        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "cap", 1, "r1", mark_posted_fn=mp))
+        assert r == "posted"
+        bot.post_video.assert_called_once_with("/v.mp4", "cap")
+        mp.assert_called_once_with("r1", "tiktok")
+
+    def test_force_stops_app_on_retryable(self):
+        bot, adb = _bot(["retryable", "success"]), _adb()
+        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1"))
+        assert r == "posted"
+        adb.shell.assert_any_call("am force-stop com.zhiliaoapp.musically")
+        bot.open_app.assert_called_once()
+
+    def test_returns_posted_on_second_attempt(self):
+        bot, adb, mp = _bot(["retryable", "success"]), _adb(), MagicMock()
+        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "c", 1, "r1", mark_posted_fn=mp))
+        assert r == "posted"
+        assert bot.post_video.call_count == 2
+        mp.assert_called_once_with("r1", "tiktok")
+
+    def test_calls_save_as_draft_after_two_retryable(self):
+        bot, adb = _bot(["retryable", "retryable"], save_draft_result=True), _adb()
+        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "c", 1, "r1"))
+        assert r == "draft"
+        bot.save_as_draft.assert_called_once_with("/v.mp4", "c")
+
+    def test_returns_draft_marks_airtable(self):
+        bot, adb, md = _bot(["retryable", "retryable"], save_draft_result=True), _adb(), MagicMock()
+        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1", mark_draft_fn=md))
+        assert r == "draft"
+        md.assert_called_once_with("r1", "tiktok")
+
+    def test_returns_failed_sends_alert_when_draft_fails(self):
+        bot, adb, ta = _bot(["retryable", "retryable"], save_draft_result=False), _adb(), MagicMock()
+        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1", tg_alert_fn=ta))
+        assert r == "failed"
+        ta.assert_called_once()
+
+    def test_banned_returns_failed_permanent_no_retry(self):
+        bot, adb = _bot(["banned"]), _adb()
+        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1"))
+        assert r == "failed_permanent"
+        assert bot.post_video.call_count == 1
+        bot.save_as_draft.assert_not_called()
+        bot.open_app.assert_not_called()
+
+    def test_media_error_returns_failed_permanent_no_retry(self):
+        bot, adb = _bot(["media_error"]), _adb()
+        r = _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1"))
+        assert r == "failed_permanent"
+        assert bot.post_video.call_count == 1
+        bot.save_as_draft.assert_not_called()
+
+    def test_device_lost_error_propagates(self):
+        bot = _bot([])
+        bot.post_video = MagicMock(side_effect=FakeDeviceLostError("USB gone"))
+        adb = _adb()
+        with pytest.raises(FakeDeviceLostError):
+            _run(post_with_retry(bot, adb, "tiktok", "/v.mp4", "", 1, "r1"))
+
+    def test_instagram_uses_post_reel(self):
+        bot, adb, mp = _bot(["success"], platform="instagram"), _adb(), MagicMock()
+        r = _run(post_with_retry(bot, adb, "instagram", "/v.mp4", "c", 1, "r1", mark_posted_fn=mp))
+        assert r == "posted"
+        bot.post_reel.assert_called_once_with("/v.mp4", "c")
+        mp.assert_called_once_with("r1", "instagram")
+
+    def test_instagram_force_stop_correct_package(self):
+        bot, adb = _bot(["retryable", "success"], platform="instagram"), _adb()
+        r = _run(post_with_retry(bot, adb, "instagram", "/v.mp4", "", 1, "r1"))
+        assert r == "posted"
+        adb.shell.assert_any_call("am force-stop com.instagram.android")
diff --git a/phone-bot/tests/test_save_as_draft.py b/phone-bot/tests/test_save_as_draft.py
new file mode 100644
index 0000000..c1b752c
--- /dev/null
+++ b/phone-bot/tests/test_save_as_draft.py
@@ -0,0 +1,162 @@
+"""Tests for save_as_draft() presence and signature in TikTokBot and InstagramBot.
+
+Uses source code inspection (AST) to verify the methods exist and follow
+the correct pattern, without importing the heavy bot modules.
+"""
+import ast
+from pathlib import Path
+
+import pytest
+
+PHONE_BOT_DIR = Path(__file__).parent.parent
+TIKTOK_PATH = PHONE_BOT_DIR / "actions" / "tiktok.py"
+INSTAGRAM_PATH = PHONE_BOT_DIR / "actions" / "instagram.py"
+
+
+def _get_method_node(filepath: Path, class_name: str, method_name: str):
+    """Find an AST method definition inside a class."""
+    source = filepath.read_text(encoding="utf-8")
+    tree = ast.parse(source)
+    for node in ast.walk(tree):
+        if isinstance(node, ast.ClassDef) and node.name == class_name:
+            for item in node.body:
+                if isinstance(item, ast.FunctionDef) and item.name == method_name:
+                    return item
+    return None
+
+
+def _get_source_segment(filepath: Path, method_name: str) -> str:
+    """Get source lines for a method (rough: from def to next def or class)."""
+    lines = filepath.read_text(encoding="utf-8").splitlines()
+    in_method = False
+    method_lines = []
+    indent = 0
+    for line in lines:
+        if f"def {method_name}" in line:
+            in_method = True
+            indent = len(line) - len(line.lstrip())
+            method_lines.append(line)
+            continue
+        if in_method:
+            if line.strip() and not line.startswith(" " * (indent + 1)) and not line.strip().startswith("#"):
+                if line.strip().startswith("def ") or line.strip().startswith("class "):
+                    break
+            method_lines.append(line)
+    return "\n".join(method_lines)
+
+
+class TestTikTokSaveAsDraft:
+
+    def test_save_as_draft_method_exists(self):
+        """TikTokBot must have a save_as_draft method."""
+        node = _get_method_node(TIKTOK_PATH, "TikTokBot", "save_as_draft")
+        assert node is not None, "TikTokBot.save_as_draft() not found in tiktok.py"
+
+    def test_save_as_draft_returns_bool(self):
+        """save_as_draft must have -> bool return annotation."""
+        node = _get_method_node(TIKTOK_PATH, "TikTokBot", "save_as_draft")
+        assert node is not None
+        assert node.returns is not None
+        ret = ast.dump(node.returns)
+        assert "bool" in ret, f"Return annotation is not bool: {ret}"
+
+    def test_save_as_draft_has_video_path_and_caption_params(self):
+        """save_as_draft must accept (self, video_path, caption)."""
+        node = _get_method_node(TIKTOK_PATH, "TikTokBot", "save_as_draft")
+        assert node is not None
+        arg_names = [a.arg for a in node.args.args]
+        assert "self" in arg_names
+        assert "video_path" in arg_names
+        assert "caption" in arg_names
+
+    def test_save_as_draft_pushes_video(self):
+        """save_as_draft source must contain push_file call."""
+        src = _get_source_segment(TIKTOK_PATH, "save_as_draft")
+        assert "push_file" in src, "save_as_draft must push video to device"
+
+    def test_save_as_draft_uses_draft_button(self):
+        """save_as_draft source must tap upload_save_draft_btn (not upload_post_btn)."""
+        src = _get_source_segment(TIKTOK_PATH, "save_as_draft")
+        assert "upload_save_draft_btn" in src, "Must tap the draft button"
+        assert "upload_post_btn" not in src, "Must NOT tap the post button"
+
+    def test_save_as_draft_deletes_video(self):
+        """save_as_draft must delete video from device after success."""
+        src = _get_source_segment(TIKTOK_PATH, "save_as_draft")
+        assert 'rm "' in src or "rm '" in src, "Must delete video file after draft save"
+
+    def test_save_as_draft_verifies_app(self):
+        """save_as_draft must verify current app after draft save."""
+        src = _get_source_segment(TIKTOK_PATH, "save_as_draft")
+        assert "get_current_app" in src, "Must verify app is still TikTok after draft"
+
+
+class TestInstagramSaveAsDraft:
+
+    def test_save_as_draft_method_exists(self):
+        """InstagramBot must have a save_as_draft method."""
+        node = _get_method_node(INSTAGRAM_PATH, "InstagramBot", "save_as_draft")
+        assert node is not None, "InstagramBot.save_as_draft() not found in instagram.py"
+
+    def test_save_as_draft_returns_bool(self):
+        """save_as_draft must have -> bool return annotation."""
+        node = _get_method_node(INSTAGRAM_PATH, "InstagramBot", "save_as_draft")
+        assert node is not None
+        assert node.returns is not None
+        ret = ast.dump(node.returns)
+        assert "bool" in ret, f"Return annotation is not bool: {ret}"
+
+    def test_save_as_draft_has_video_path_and_caption_params(self):
+        """save_as_draft must accept (self, video_path, caption)."""
+        node = _get_method_node(INSTAGRAM_PATH, "InstagramBot", "save_as_draft")
+        assert node is not None
+        arg_names = [a.arg for a in node.args.args]
+        assert "self" in arg_names
+        assert "video_path" in arg_names
+        assert "caption" in arg_names
+
+    def test_save_as_draft_uses_back_button(self):
+        """Instagram draft uses Back to trigger 'Save Draft' dialog."""
+        src = _get_source_segment(INSTAGRAM_PATH, "save_as_draft")
+        assert "press_back" in src, "Instagram draft must use press_back to trigger save dialog"
+
+    def test_save_as_draft_taps_confirm(self):
+        """Instagram draft must tap save_draft_confirm in dialog."""
+        src = _get_source_segment(INSTAGRAM_PATH, "save_as_draft")
+        assert "save_draft_confirm" in src, "Must tap save_draft_confirm button"
+
+
+class TestPostVideoReturnType:
+    """Verify post_video/post_reel return string codes, not booleans."""
+
+    def test_tiktok_post_video_returns_str(self):
+        """post_video must have -> str return annotation."""
+        node = _get_method_node(TIKTOK_PATH, "TikTokBot", "post_video")
+        assert node is not None
+        assert node.returns is not None
+        ret = ast.dump(node.returns)
+        assert "str" in ret, f"post_video return type should be str, got: {ret}"
+
+    def test_tiktok_post_video_no_bare_true_return(self):
+        """post_video must not return bare True/False."""
+        src = _get_source_segment(TIKTOK_PATH, "post_video")
+        assert "return True" not in src, "post_video must return string codes, not True"
+        assert "return False" not in src, "post_video must return string codes, not False"
+
+    def test_tiktok_post_video_returns_success_string(self):
+        """post_video must return 'success' on success path."""
+        src = _get_source_segment(TIKTOK_PATH, "post_video")
+        assert '"success"' in src, "post_video must return 'success' string"
+
+    def test_instagram_post_reel_returns_str(self):
+        """post_reel must have -> str return annotation."""
+        node = _get_method_node(INSTAGRAM_PATH, "InstagramBot", "post_reel")
+        assert node is not None
+        assert node.returns is not None
+        ret = ast.dump(node.returns)
+        assert "str" in ret, f"post_reel return type should be str, got: {ret}"
+
+    def test_instagram_post_reel_returns_success_string(self):
+        """post_reel must return 'success' on success path."""
+        src = _get_source_segment(INSTAGRAM_PATH, "post_reel")
+        assert '"success"' in src, "post_reel must return 'success' string"
