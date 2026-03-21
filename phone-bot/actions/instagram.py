"""Instagram actions -- all interactions with Instagram via raw ADB.

Same pattern as TikTok: coords for navigation, Gemini Vision for complex flows.

NO uiautomator, NO find_element, NO UI tree parsing.
"""
import asyncio
import logging
import random
import time
from datetime import datetime

from .. import config
from ..core.adb import ADBController
from ..core.human import HumanEngine
from ..core import gemini

log = logging.getLogger(__name__)

INSTAGRAM_PKG = "com.instagram.android"


class InstagramBot:
    """All Instagram interactions for a single device."""

    def __init__(self, adb: ADBController, human: HumanEngine):
        self.adb = adb
        self.human = human

    # --- Navigation --------------------------------------------------------

    def open_app(self):
        log.info("Opening Instagram...")
        self.adb.open_instagram()
        time.sleep(self.human.timing("t_app_load"))

        for _ in range(10):
            if INSTAGRAM_PKG in self.adb.get_current_app():
                log.info("Instagram is open")
                return True
            time.sleep(self.human.timing("t_poll_check"))

        log.warning("Instagram didn't open in time")
        return False

    def close_app(self):
        self.adb.close_instagram()
        time.sleep(self.human.timing("t_nav_settle"))

    def go_to_feed(self):
        """Navigate to the home feed."""
        x, y = self.adb.get_coord("instagram", "nav_home")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def go_to_reels(self):
        """Navigate to the Reels tab."""
        x, y = self.adb.get_coord("instagram", "nav_reels")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def go_to_explore(self):
        """Navigate to Explore/Search."""
        x, y = self.adb.get_coord("instagram", "nav_search")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def go_to_profile(self):
        x, y = self.adb.get_coord("instagram", "nav_profile")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def _check_health(self) -> bool:
        """Verify Instagram is still in foreground. Recovers if lost."""
        current = self.adb.get_current_app()
        if current and INSTAGRAM_PKG not in current:
            log.warning("Instagram lost focus (current: %s), recovering", current)
            self.open_app()
            self.go_to_reels()
            return False
        return True

    # --- Core Actions ------------------------------------------------------

    def scroll_feed(self):
        """Scroll to next post/reel in the feed."""
        sw = self.human.humanize_swipe(
            self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
            self.adb.screen_w // 2, self.adb.screen_h // 4,
        )
        if sw.get("hand_switched"):
            time.sleep(sw["hand_switch_pause"])
        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])

    def scroll_reels(self):
        """Scroll to next Reel (same as TikTok swipe-up)."""
        self.scroll_feed()

    def like_post(self):
        """Like the current post/reel. Uses double-tap or heart icon based on personality."""
        if random.random() < self.human.personality.double_tap_habit:
            # Double-tap center
            cx, cy = self.adb.get_coord("instagram", "video_center")
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_double_tap"))
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
        else:
            # Tap heart icon
            x, y = self.adb.get_coord("instagram", "like_icon")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)

        time.sleep(self.human.action_delay())
        log.debug("Liked post on Instagram")

    def open_comments(self):
        x, y = self.adb.get_coord("instagram", "comment_icon")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_comment_load"))

    def _scroll_comments(self):
        """Scroll within the comments sheet. Distance varies by state."""
        w, h = self.adb.screen_w, self.adb.screen_h
        dist_frac = self.human.comment_scroll_distance()
        start_y = int(h * 0.75)
        end_y = int(h * (0.75 - dist_frac))
        end_y = max(int(h * 0.15), end_y)

        sw = self.human.humanize_swipe(w // 2, start_y, w // 2, end_y)
        if sw.get("hand_switched"):
            time.sleep(sw["hand_switch_pause"])
        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])

    async def browse_comments(self) -> list[bytes]:
        """Browse comments section with variable scrolls. Returns screenshots taken."""
        plan = self.human.browse_comments_plan()
        scroll_count = plan["scroll_count"]
        timing_key = plan["read_timing_key"]
        screenshots = []

        if plan["is_deep_dive"]:
            log.debug("IG comment deep dive: %d scrolls", scroll_count)
        else:
            log.debug("IG browsing comments: %d scrolls", scroll_count)

        for i in range(scroll_count):
            await asyncio.sleep(self.human.timing(timing_key))

            if i == 0 or random.random() < 0.5:
                shot = self.adb.screenshot_bytes()
                if shot:
                    screenshots.append(shot)

            if i < scroll_count - 1:
                self._scroll_comments()

        return screenshots

    def write_comment(self, text: str):
        # Pause before tapping input (deciding to write)
        time.sleep(self.human.timing("t_comment_before_write"))

        # Tap comment input
        x, y = self.adb.get_coord("instagram", "comment_input")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.reading_delay())

        # Type with human-like errors (Behavior #2)
        self.human.type_with_errors(self.adb, text)

        time.sleep(self.human.timing("t_post_typing"))

        # Post (Enter key is most reliable)
        self.adb.press_enter()
        time.sleep(self.human.timing("t_post_typing"))
        self.adb.press_back()
        log.debug("Posted comment on IG: %s", text[:30])

    async def comment_with_ai(self):
        """Generate a contextual comment using multi-frame video understanding."""
        # --- Step 1: Capture 3 video frames ---
        video_frames = []

        frame1 = self.adb.screenshot_bytes()
        if not frame1:
            return
        video_frames.append(frame1)

        await asyncio.sleep(self.human.timing("t_frame_capture_gap"))
        frame2 = self.adb.screenshot_bytes()
        if frame2:
            video_frames.append(frame2)

        await asyncio.sleep(self.human.timing("t_frame_capture_gap"))
        frame3 = self.adb.screenshot_bytes()
        if frame3:
            video_frames.append(frame3)

        log.debug("Captured %d video frames for IG comment", len(video_frames))

        # --- Step 2: Open and browse comments ---
        self.open_comments()
        comment_frames = await self.browse_comments()

        if not comment_frames:
            shot = self.adb.screenshot_bytes()
            if shot:
                comment_frames = [shot]

        log.debug("Captured %d IG comment screenshots", len(comment_frames))

        # --- Step 3: Generate comment with multi-frame AI ---
        style = self.human.personality.comment_style if self.human.personality else "reactor"
        comment = gemini.generate_comment_v2(
            video_frames=video_frames,
            comment_frames=comment_frames,
            platform="instagram",
            style=style,
        )

        # Fallback to single-frame if multi-frame fails
        if not comment or len(comment) < 3:
            log.warning("Multi-frame IG comment failed, trying single-frame fallback")
            comment = gemini.generate_comment(video_frames[0], platform="instagram")

        if not comment or len(comment) < 3:
            log.warning("IG comment generation failed entirely, closing comments")
            self.adb.press_back()
            return

        # --- Step 4: Write the comment ---
        self.write_comment(comment)
        self.human.memory.session_comments += 1
        log.info("[IG Comment] style=%s text='%s'", style, comment[:40])

    def follow_user(self):
        """Follow creator -- tap avatar with + overlay in Reels view."""
        x, y = self.adb.get_coord("instagram", "avatar_reel")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.action_delay())
        log.debug("Followed user on IG")

    def visit_profile(self):
        """Tap on the username of the current reel to visit their profile."""
        x, y = self.adb.get_coord("instagram", "username_reel")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_profile_settle"))

    async def rabbit_hole(self):
        """Visit a profile and browse their content."""
        self.visit_profile()
        time.sleep(self.human.timing("t_nav_settle"))

        n = self.human.rabbit_hole_depth()
        log.info("IG rabbit hole: browsing %d posts", n)

        # Tap first post in grid
        x, y = self.human.jitter_tap(self.adb.screen_w // 4, self.adb.screen_h // 2)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        for _ in range(n):
            watch = self.human.watch_duration(10)
            await asyncio.sleep(watch)
            if self.human.should_like():
                self.like_post()
            self.scroll_feed()
            await asyncio.sleep(self.human.action_delay())

        self.adb.press_back()
        time.sleep(self.human.timing("micro_pause"))
        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))

    def _type_search_query(self, keyword: str):
        """Navigate to Explore, type keyword, hit enter."""
        self.go_to_explore()
        time.sleep(self.human.timing("t_nav_settle"))

        x, y = self.adb.get_coord("instagram", "search_bar")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        self.human.type_with_errors(self.adb, keyword)
        self.adb.press_enter()
        time.sleep(self.human.timing("t_browse_results"))

    def _clear_and_retype(self, keyword: str):
        """Clear search bar and type a new keyword (staying in Explore)."""
        x, y = self.adb.get_coord("instagram", "search_bar")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_search_clear"))

        cx, cy = self.adb.get_coord("instagram", "search_clear")
        cx, cy = self.human.jitter_tap(cx, cy)
        self.adb.tap(cx, cy)
        time.sleep(self.human.timing("t_search_clear"))

        time.sleep(self.human.timing("t_thinking"))

        self.human.type_with_errors(self.adb, keyword)
        self.adb.press_enter()
        time.sleep(self.human.timing("t_browse_results"))

    async def search_explore_session(self, niche_keywords: list = None):
        """Human-like search mini-session on Instagram Explore.
        Every decision driven by personality + boredom + mood.

        IG Explore has a 3-column grid. Tapping opens a reel/post fullscreen,
        back returns to grid. Same logic as TikTok but with 6 grid slots.
        """
        pool = niche_keywords or config.NICHE_KEYWORDS_POOL
        session_keywords = random.sample(pool, min(6, len(pool)))
        keyword = session_keywords.pop(0)

        log.info("IG Search explore: '%s'", keyword)
        self._type_search_query(keyword)

        curiosity = self.human.personality.explore_curiosity
        boredom = self.human.boredom.level
        energy = self.human.mood.energy
        patience = self.human.mood.patience
        videos_watched = 0
        found_interesting = False

        # How many results to browse (IG grid = 3 cols, more visible at once)
        browse_drive = curiosity * 5 + boredom * 3 + energy * 0.5
        n_results = max(2, int(random.gauss(browse_drive, browse_drive * 0.3)))
        n_results = min(n_results, 9)  # IG shows more per scroll

        grid_keys = [f"search_grid_{i}" for i in range(1, 7)]  # 6 visible

        for i in range(n_results):
            if i < len(grid_keys):
                gx, gy = self.adb.get_coord("instagram", grid_keys[i])
            else:
                sw = self.human.humanize_swipe(
                    self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
                    self.adb.screen_w // 2, self.adb.screen_h // 3,
                )
                self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"],
                               sw["duration"])
                await asyncio.sleep(self.human.timing("t_search_scroll_pause"))
                gx, gy = self.adb.get_coord("instagram",
                                             grid_keys[i % len(grid_keys)])

            gx, gy = self.human.jitter_tap(gx, gy)
            self.adb.tap(gx, gy)

            watch = self.human.watch_duration()
            await asyncio.sleep(watch)
            videos_watched += 1

            # Like -- same formula as TikTok, energy + exposure + boredom
            like_drive = (energy * 0.15
                          + videos_watched * 0.04
                          + boredom * 0.06)
            if random.random() < like_drive:
                self.like_post()
                self.human.on_engage()
                found_interesting = True
                await asyncio.sleep(self.human.post_like_pause())

            # Visit profile -- curiosity + exposure + boredom
            profile_drive = (curiosity * 1.5
                             + videos_watched * 0.03
                             + boredom * 0.08
                             - (0.12 if found_interesting else 0))
            if random.random() < max(0, profile_drive):
                log.debug("IG Search: visiting creator profile")
                self.visit_profile()

                depth = max(1, int(random.gauss(2 + curiosity * 8, 1)))
                depth = min(depth, 5)

                # Tap first post in their grid
                px, py = self.human.jitter_tap(
                    self.adb.screen_w // 4, self.adb.screen_h // 2)
                self.adb.tap(px, py)
                time.sleep(self.human.timing("t_nav_settle"))

                for v in range(depth):
                    await asyncio.sleep(self.human.watch_duration(10))
                    if self.human.should_like():
                        self.like_post()
                        self.human.on_engage()
                        found_interesting = True
                    if v < depth - 1:
                        self.scroll_feed()
                        await asyncio.sleep(self.human.action_delay())

                # Back to search results (post -> profile -> results)
                self.adb.press_back()
                time.sleep(self.human.timing("micro_pause"))
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))
            else:
                self.adb.press_back()
                await asyncio.sleep(self.human.timing("t_search_scroll_pause"))

            self.human.boredom.on_scroll(True if found_interesting else None)

        # --- Second keyword? ---
        if session_keywords:
            second_drive = (curiosity * 2.5
                            + self.human.boredom.level * 0.4
                            + patience * 0.05
                            - (0.25 if found_interesting else 0))
            if random.random() < max(0.05, min(0.6, second_drive)):
                keyword2 = session_keywords.pop(0)
                log.info("IG Search explore: second keyword '%s'", keyword2)
                self._clear_and_retype(keyword2)

                n2 = max(1, int(n_results * random.uniform(0.3, 0.7)))
                for j in range(n2):
                    if j < len(grid_keys):
                        gx, gy = self.adb.get_coord("instagram",
                                                     grid_keys[j])
                    else:
                        sw = self.human.humanize_swipe(
                            self.adb.screen_w // 2,
                            self.adb.screen_h * 3 // 4,
                            self.adb.screen_w // 2,
                            self.adb.screen_h // 3,
                        )
                        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"],
                                       sw["y2"], sw["duration"])
                        await asyncio.sleep(
                            self.human.timing("t_search_scroll_pause"))
                        gx, gy = self.adb.get_coord(
                            "instagram", grid_keys[j % len(grid_keys)])

                    gx, gy = self.human.jitter_tap(gx, gy)
                    self.adb.tap(gx, gy)
                    await asyncio.sleep(self.human.watch_duration())

                    like2 = energy * 0.12 + videos_watched * 0.02
                    if random.random() < like2:
                        self.like_post()
                        self.human.on_engage()

                    self.adb.press_back()
                    await asyncio.sleep(
                        self.human.timing("t_search_scroll_pause"))
                    videos_watched += 1

        self.human._session_stats["searches_done"] = \
            self.human._session_stats.get("searches_done", 0) + 1
        log.info("IG Search explore done: watched %d videos", videos_watched)

    def search_keyword(self, keyword: str):
        """Legacy wrapper -- simple search without full explore session."""
        self._type_search_query(keyword)

    # --- Stories -----------------------------------------------------------

    def watch_stories(self, count: int = 0):
        """Watch a few stories from the Feed's story bar at the top.
        Real users do this -- not watching stories at all is suspicious."""
        if count <= 0:
            hi = max(3, int(3 + self.human.personality.story_affinity * 6))
            count = random.randint(2, hi)

        log.info("Watching %d stories", count)

        # Tap 2nd or 3rd story circle (skip "Your Story" at position 1)
        circle = random.choice(["story_row_second", "story_row_third"])
        x, y = self.adb.get_coord("instagram", circle)
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        for i in range(count):
            # Watch the story slide
            time.sleep(self.human.timing("t_story_watch"))

            # Tap right side to advance to next story
            x, y = self.adb.get_coord("instagram", "story_tap_next")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("micro_pause"))

        # Exit stories
        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))
        log.debug("Watched %d stories", count)

    # --- Profile Setup -----------------------------------------------------

    def set_profile_pic(self, image_path: str):
        """Set profile picture during warmup."""
        log.info("Setting Instagram profile picture")

        device_path = f"/sdcard/DCIM/profile_{random.randint(1000, 9999)}.jpg"
        self.adb.push_file(image_path, device_path)
        time.sleep(self.human.timing("t_file_push"))
        self.adb.shell(
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
            f'-d "file://{device_path}"'
        )
        time.sleep(self.human.timing("t_file_push"))

        try:
            # Navigate: Profile -> Edit profile
            self.go_to_profile()
            time.sleep(self.human.timing("t_nav_settle"))

            # Tap Edit profile
            x, y = self.adb.get_coord("instagram", "edit_profile_btn")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_nav_settle"))

            # Tap avatar area
            x, y = self.adb.get_coord("instagram", "avatar_edit")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_nav_settle"))

            # "New profile photo" / "Choose from library" -- use Vision
            coords = self.adb.find_on_screen(
                "New profile photo or Choose from library button"
            )
            if coords:
                x, y = self.human.jitter_tap(coords[0], coords[1])
                self.adb.tap(x, y)
                time.sleep(self.human.timing("t_nav_settle"))

            # Select most recent photo
            x, y = self.adb.get_coord("instagram", "gallery_first")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_nav_settle"))

            # Confirm -- Vision for Done/Next button
            coords = self.adb.wait_for_screen("Done or Next button", timeout=5)
            if coords:
                x, y = self.human.jitter_tap(coords[0], coords[1])
                self.adb.tap(x, y)
                time.sleep(self.human.timing("t_confirm_save"))

            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            log.info("Instagram profile pic set")
        finally:
            self.adb.shell(f'rm "{device_path}"')

    def set_bio(self, bio_text: str):
        """Set bio during warmup."""
        log.info("Setting Instagram bio")

        self.go_to_profile()
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap Edit profile
        x, y = self.adb.get_coord("instagram", "edit_profile_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap Bio field
        x, y = self.adb.get_coord("instagram", "bio_field")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        self.adb.shell("input keyevent --longpress KEYCODE_DEL")
        time.sleep(self.human.timing("t_key_settle"))

        self.human.type_with_errors(self.adb, bio_text)
        time.sleep(self.human.timing("t_post_typing"))

        # Save (top-right)
        x, y = self.adb.get_coord("instagram", "save_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_confirm_save"))

        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))
        log.info("Instagram bio set: %s", bio_text[:40])

    # --- Video Posting (Reels) ---------------------------------------------

    def post_reel(self, video_path: str, caption: str = "") -> str:
        """Upload and post a Reel to Instagram.

        Returns one of: "success" | "retryable" | "banned" | "media_error"
        """
        # Push video to /sdcard/Download/ (not DCIM -- no EXIF = suspicious there)
        now = datetime.now()
        vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
        device_path = f"/sdcard/Download/{vid_name}"
        log.info("Pushing reel to device: %s", device_path)
        try:
            self.adb.push_file(video_path, device_path)
        except Exception as e:
            log.error("Failed to push reel to device: %s", e)
            return "media_error"
        time.sleep(self.human.timing("t_file_push"))

        self.adb.shell(
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
            f'-d "file://{device_path}"'
        )
        time.sleep(self.human.timing("t_file_push"))

        # Tap + (create) button
        x, y = self.adb.get_coord("instagram", "nav_create")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_upload_load"))

        # Switch to REEL tab
        x, y = self.adb.get_coord("instagram", "reel_tab")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Select video from gallery
        x, y = self.adb.get_coord("instagram", "gallery_first")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap Next (top-right)
        x, y = self.adb.get_coord("instagram", "upload_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Skip editing, tap Next again
        x, y = self.adb.get_coord("instagram", "upload_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Add caption
        if caption:
            x, y = self.adb.get_coord("instagram", "upload_caption")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_caption_input"))

            self.human.type_with_errors(self.adb, caption)
            time.sleep(self.human.timing("t_post_typing"))

        # Share (top-right)
        x, y = self.adb.get_coord("instagram", "upload_share_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_post_upload"))

        # Verify post: check we're back on Instagram (not stuck in error dialog)
        # Wait briefly and re-check to catch delayed error popups
        time.sleep(self.human.timing("t_nav_settle"))
        current = self.adb.get_current_app()
        if current and INSTAGRAM_PKG in current:
            log.info("Reel posted on Instagram!")
            self.adb.shell(f'rm "{device_path}"')
            return "success"
        else:
            log.warning("Post may have failed (current app: %s), keeping video on device", current)
            return "retryable"

    def save_as_draft(self, video_path: str, caption: str = "") -> bool:
        """Open the reel upload screen, fill caption, save as draft.

        Returns True if draft was saved, False if draft save failed.
        Instagram draft: navigate to share screen, tap Back, confirm 'Save Draft'.
        """
        now = datetime.now()
        vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
        device_path = f"/sdcard/Download/{vid_name}"
        log.info("Saving as draft — pushing reel to device: %s", device_path)
        try:
            self.adb.push_file(video_path, device_path)
        except Exception as e:
            log.error("Failed to push reel for draft: %s", e)
            return False
        time.sleep(self.human.timing("t_file_push"))

        self.adb.shell(
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
            f'-d "file://{device_path}"'
        )
        time.sleep(self.human.timing("t_file_push"))

        # Tap + (create) button
        x, y = self.adb.get_coord("instagram", "nav_create")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_upload_load"))

        # Switch to REEL tab
        x, y = self.adb.get_coord("instagram", "reel_tab")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Select video from gallery
        x, y = self.adb.get_coord("instagram", "gallery_first")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap Next (top-right)
        x, y = self.adb.get_coord("instagram", "upload_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Skip editing, tap Next again
        x, y = self.adb.get_coord("instagram", "upload_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Add caption if provided
        if caption:
            x, y = self.adb.get_coord("instagram", "upload_caption")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_caption_input"))

            self.human.type_with_errors(self.adb, caption)
            time.sleep(self.human.timing("t_post_typing"))

        # Instagram draft: press Back to trigger "Save Draft?" dialog
        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap "Save Draft" in the confirmation dialog
        x, y = self.adb.get_coord("instagram", "save_draft_confirm")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Verify: check we're still in Instagram
        current = self.adb.get_current_app()
        if current and INSTAGRAM_PKG in current:
            log.info("Reel saved as draft on Instagram")
            self.adb.shell(f'rm "{device_path}"')
            return True
        else:
            log.warning("Draft save may have failed (current app: %s)", current)
            return False

    # --- High-Level Session ------------------------------------------------

    async def browse_session(self, duration_minutes: float, should_post: bool = False,
                             video_path: str = "", caption: str = "",
                             pre_scroll_minutes: float = 0, post_scroll_minutes: float = 0,
                             niche_keywords: list = None):
        """Execute a full Instagram browsing session."""
        if not self.open_app():
            return

        # Behavior #10: Variable load reaction time
        time.sleep(self.human.load_reaction_time())

        # Start on Feed or Reels based on personality preference
        if random.random() < self.human.personality.reels_preference:
            self.go_to_reels()
            current_view = "reels"
        else:
            self.go_to_feed()
            current_view = "feed"
            # Maybe watch stories at session start (personality-driven)
            if random.random() < self.human.personality.story_affinity:
                self.watch_stories()
                self.human._session_stats["stories_watched"] = \
                    self.human._session_stats.get("stories_watched", 0) + 1
        time.sleep(self.human.timing("t_nav_settle"))

        start = time.time()
        total_seconds = duration_minutes * 60
        post_done = False
        post_after = pre_scroll_minutes * 60 if should_post else float('inf')
        action_count = 0
        health_interval = random.randint(12, 20)
        category = "unknown"

        while (time.time() - start) < total_seconds:
            elapsed = time.time() - start

            # Periodic health check (randomized interval)
            action_count += 1
            if action_count % health_interval == 0:
                self._check_health()

            # Feed <-> Reels switch (boredom-driven, not fixed timer)
            if self.human.wants_view_switch():
                if current_view == "feed":
                    self.go_to_reels()
                    current_view = "reels"
                else:
                    self.go_to_feed()
                    current_view = "feed"
                    # Switched to Feed — maybe watch stories (personality-driven)
                    if random.random() < self.human.personality.story_affinity:
                        self.watch_stories()
                        self.human._session_stats["stories_watched"] = \
                            self.human._session_stats.get("stories_watched", 0) + 1
                time.sleep(self.human.timing("t_nav_settle"))

            if should_post and not post_done and elapsed >= post_after:
                if video_path:
                    result = self.post_reel(video_path, caption)
                    post_done = True
                    self._last_post_result = result
                    if result == "success":
                        self.go_to_reels()
                        current_view = "reels"
                        time.sleep(self.human.timing("t_nav_settle"))
                    continue

            # Behavior #1: Zona morta (dead stare, no touch)
            if self.human.should_zona_morta():
                duration = self.human.zona_morta_duration()
                log.debug("Zona morta: %.0fs", duration)
                await asyncio.sleep(duration)
                continue

            if self.human.should_interrupt():
                await self.human.do_interruption(self.adb, INSTAGRAM_PKG)
                continue

            # --- Pick next action based on session flow phase ---
            action = self.human.pick_action()

            if action == "scroll_fyp":
                watch_time = self.human.watch_duration()
                await asyncio.sleep(watch_time)

                # Categorize with Gemini (15% for IG memory)
                if random.random() < 0.15:
                    screenshot = self.adb.screenshot_bytes()
                    if screenshot:
                        info = gemini.categorize_video(screenshot)
                        category = info.get("category", "unknown")
                else:
                    category = "unknown"

                # Update boredom based on content relevance
                niche_match = None
                if category != "unknown":
                    pool = niche_keywords or config.NICHE_KEYWORDS_POOL
                    cat_lower = category.lower()
                    niche_match = any(kw.lower() in cat_lower or cat_lower in kw.lower()
                                      for kw in pool)
                self.human.on_scroll(niche_match)

                # Behavior #8: Micro-scroll (incomplete swipe)
                if self.human.should_micro_scroll():
                    sw = self.human.humanize_swipe(
                        self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
                        self.adb.screen_w // 2, self.adb.screen_h // 2,
                    )
                    self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                    await asyncio.sleep(self.human.timing("t_micro_scroll"))
                # Behavior #4: Peek scroll (scroll halfway and back)
                elif self.human.should_peek_scroll():
                    mid_y = self.adb.screen_h // 2
                    sw = self.human.humanize_swipe(
                        self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
                        self.adb.screen_w // 2, mid_y,
                    )
                    self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                    await asyncio.sleep(self.human.timing("t_micro_scroll"))
                    self.adb.swipe(sw["x2"], sw["y2"], sw["x1"], sw["y1"], sw["duration"])
                # Behavior #5: Re-watch previous video
                elif self.human.should_rewatch():
                    self.scroll_reels()
                    await asyncio.sleep(self.human.timing("t_rewatch"))
                    sw = self.human.humanize_swipe(
                        self.adb.screen_w // 2, self.adb.screen_h // 4,
                        self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
                    )
                    self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                    await asyncio.sleep(self.human.watch_duration())
                else:
                    self.scroll_reels()
                await asyncio.sleep(self.human.action_delay())

            elif action == "like":
                if self.human.should_like(category):
                    self.like_post()
                    self.human.memory.record_like(category)
                    self.human.on_engage()
                    # Track which view got the like (for personality drift)
                    stat_key = "reels_likes" if current_view == "reels" else "feed_likes"
                    self.human._session_stats[stat_key] = \
                        self.human._session_stats.get(stat_key, 0) + 1
                    await asyncio.sleep(self.human.post_like_pause())

            elif action == "comment":
                if self.human.should_comment():
                    if self.human.should_double_open_comments():
                        self.open_comments()
                        await asyncio.sleep(self.human.timing("t_double_open_1"))
                        self.adb.press_back()
                        await asyncio.sleep(self.human.timing("t_double_open_2"))
                    await self.comment_with_ai()
                    self.human.on_engage()
                elif self.human.should_browse_comments():
                    # Just browse comments without writing (reading mode)
                    self.open_comments()
                    await self.browse_comments()
                    self.adb.press_back()
                    log.debug("Browsed IG comments (read-only)")

            elif action == "follow":
                if self.human.should_follow():
                    self.follow_user()
                    self.human.on_engage()

            elif action == "search_explore":
                await self.search_explore_session(niche_keywords)
                # Return to whatever view we were in
                if current_view == "feed":
                    self.go_to_feed()
                else:
                    self.go_to_reels()

            elif action == "profile_visit":
                if self.human.should_rabbit_hole():
                    await self.rabbit_hole()

            await asyncio.sleep(self.human.action_delay())

        # Behavior #11: Background at end (fell asleep)
        if self.human.should_end_in_background():
            bg_time = self.human.bg_end_duration()
            log.debug("Background end: %.0fs", bg_time)
            self.adb.press_home()
            await asyncio.sleep(bg_time)

        self.close_app()
        log.info("Instagram session complete (%.1f min)", duration_minutes)
