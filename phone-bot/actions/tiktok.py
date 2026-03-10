"""TikTok actions -- all interactions with TikTok via raw ADB.

Every action uses:
- adb.get_coord() for known UI element positions (zero detection footprint)
- adb.tap() / adb.swipe() for input (with HumanEngine jitter)
- adb.find_on_screen() for dynamic elements in upload flows (Gemini Vision)
- gemini.py for intelligent decisions (comments, categorization)

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

TIKTOK_PKG = "com.zhiliaoapp.musically"


class TikTokBot:
    """All TikTok interactions for a single device."""

    def __init__(self, adb: ADBController, human: HumanEngine):
        self.adb = adb
        self.human = human

    # --- Navigation --------------------------------------------------------

    def open_app(self):
        """Open TikTok and wait for it to load."""
        log.info("Opening TikTok...")
        self.adb.open_tiktok()
        time.sleep(self.human.timing("t_app_load"))

        for _ in range(10):
            if TIKTOK_PKG in self.adb.get_current_app():
                log.info("TikTok is open")
                return True
            time.sleep(self.human.timing("t_poll_check"))

        log.warning("TikTok didn't open in time")
        return False

    def close_app(self):
        """Close TikTok naturally."""
        self.adb.close_tiktok()
        time.sleep(self.human.timing("t_nav_settle"))

    def go_to_fyp(self):
        """Navigate to the For You Page (home tab)."""
        x, y = self.adb.get_coord("tiktok", "nav_home")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def go_to_profile(self):
        """Navigate to own profile tab."""
        x, y = self.adb.get_coord("tiktok", "nav_profile")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def go_to_search(self):
        """Open the Discover/Search page."""
        x, y = self.adb.get_coord("tiktok", "nav_friends")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def _check_health(self) -> bool:
        """Verify TikTok is still in foreground. Recovers if lost."""
        current = self.adb.get_current_app()
        if current and TIKTOK_PKG not in current:
            log.warning("TikTok lost focus (current: %s), recovering", current)
            self.open_app()
            self.go_to_fyp()
            return False
        return True

    # --- Core Actions ------------------------------------------------------

    def scroll_fyp(self):
        """Scroll to the next video on FYP (swipe up)."""
        sw = self.human.humanize_swipe(
            self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
            self.adb.screen_w // 2, self.adb.screen_h // 4,
        )
        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])

    def peek_scroll(self):
        """Scroll halfway then go back -- like peeking at next video."""
        mid_y = self.adb.screen_h // 2
        sw = self.human.humanize_swipe(
            self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
            self.adb.screen_w // 2, mid_y,
        )
        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
        time.sleep(self.human.timing("t_micro_scroll"))
        # Scroll back
        self.adb.swipe(sw["x2"], sw["y2"], sw["x1"], sw["y1"], sw["duration"])

    def like_video(self):
        """Like the current video. Randomly uses double-tap or heart icon."""
        if random.random() < 0.6:
            # Double-tap center (more human)
            cx, cy = self.adb.get_coord("tiktok", "video_center")
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_double_tap"))
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
        else:
            # Tap heart icon
            x, y = self.adb.get_coord("tiktok", "like_icon")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)

        time.sleep(self.human.action_delay())
        log.debug("Liked video")

    def open_comments(self):
        """Open the comments section."""
        x, y = self.adb.get_coord("tiktok", "comment_icon")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def write_comment(self, text: str):
        """Type and post a comment."""
        # Tap the comment input field
        x, y = self.adb.get_coord("tiktok", "comment_input")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.reading_delay())

        # Type with human-like errors (Behavior #2)
        self.human.type_with_errors(self.adb, text)

        time.sleep(self.human.timing("t_post_typing"))

        # Post comment (Enter key is most reliable)
        self.adb.press_enter()
        time.sleep(self.human.timing("t_post_typing"))

        # Close comments
        self.adb.press_back()
        log.debug("Posted comment: %s", text[:30])

    async def comment_with_ai(self):
        """Generate a contextual comment using Gemini and post it."""
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return

        await asyncio.sleep(self.human.reading_delay())

        comment = gemini.generate_comment(screenshot, platform="tiktok")
        if not comment or len(comment) < 3:
            log.warning("Gemini generated empty/short comment, skipping")
            return

        self.open_comments()
        self.write_comment(comment)
        self.human.memory.session_comments += 1

    def follow_creator(self):
        """Follow the creator of the current video (tap avatar with + overlay)."""
        x, y = self.adb.get_coord("tiktok", "avatar")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.action_delay())
        log.debug("Followed creator")

    def visit_creator_profile(self):
        """Tap on creator's username to visit their profile."""
        x, y = self.adb.get_coord("tiktok", "username")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_profile_settle"))

    async def rabbit_hole(self):
        """Visit creator profile and watch several of their videos."""
        self.visit_creator_profile()
        time.sleep(self.human.timing("t_nav_settle"))

        n_videos = self.human.rabbit_hole_depth()
        log.info("Rabbit hole: watching %d videos on profile", n_videos)

        for i in range(n_videos):
            if i == 0:
                # Tap first video on their grid
                grid_y = self.adb.screen_h // 2
                x, y = self.human.jitter_tap(self.adb.screen_w // 4, grid_y)
                self.adb.tap(x, y)
                time.sleep(self.human.timing("t_nav_settle"))
            else:
                self.scroll_fyp()

            watch = self.human.watch_duration(15)
            await asyncio.sleep(watch)

            if self.human.should_like():
                self.like_video()

        # Go back to FYP
        self.adb.press_back()
        time.sleep(self.human.timing("micro_pause"))
        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))

    def search_hashtag(self, hashtag: str):
        """Search for a hashtag and browse results."""
        self.go_to_search()
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap search bar
        x, y = self.adb.get_coord("tiktok", "search_bar")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Type hashtag with human-like errors
        self.human.type_with_errors(self.adb, hashtag)

        time.sleep(self.human.timing("micro_pause"))
        self.adb.press_enter()
        time.sleep(self.human.timing("t_browse_results"))

    # --- Profile Setup -----------------------------------------------------

    def set_profile_pic(self, image_path: str):
        """Set profile picture during warmup."""
        log.info("Setting TikTok profile picture")

        # Push image to phone
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

            # Tap Edit profile button
            x, y = self.adb.get_coord("tiktok", "edit_profile_btn")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_nav_settle"))

            # Tap avatar area to change photo
            x, y = self.adb.get_coord("tiktok", "avatar_edit")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_nav_settle"))

            # "Select from gallery" -- use Vision (text varies per version)
            coords = self.adb.find_on_screen("Select from gallery or Choose from library button")
            if coords:
                x, y = self.human.jitter_tap(*coords)
                self.adb.tap(x, y)
                time.sleep(self.human.timing("t_nav_settle"))

            # Select most recent photo (top-left of gallery grid)
            x, y = self.adb.get_coord("tiktok", "gallery_first")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_nav_settle"))

            # Confirm/Save -- use Vision (text varies: Save, Confirm, Done)
            coords = self.adb.wait_for_screen("Save or Confirm or Done button", timeout=5)
            if coords:
                x, y = self.human.jitter_tap(*coords)
                self.adb.tap(x, y)
                time.sleep(self.human.timing("t_confirm_save"))

            # Go back
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            log.info("TikTok profile pic set")
        finally:
            self.adb.shell(f'rm "{device_path}"')

    def set_bio(self, bio_text: str):
        """Set bio/description during warmup."""
        log.info("Setting TikTok bio")

        self.go_to_profile()
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap Edit profile
        x, y = self.adb.get_coord("tiktok", "edit_profile_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap Bio field
        x, y = self.adb.get_coord("tiktok", "bio_field")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Clear existing text
        self.adb.shell("input keyevent --longpress KEYCODE_DEL")
        time.sleep(self.human.timing("t_key_settle"))

        # Type bio with human-like errors
        self.human.type_with_errors(self.adb, bio_text)
        time.sleep(self.human.timing("t_post_typing"))

        # Save (top-right button)
        x, y = self.adb.get_coord("tiktok", "save_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_confirm_save"))

        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))
        log.info("TikTok bio set: %s", bio_text[:40])

    # --- Video Posting -----------------------------------------------------

    def post_video(self, video_path: str, caption: str = "") -> bool:
        """Upload and post a video to TikTok.
        Returns True if successful.
        """
        # Step 1: Push video to /sdcard/Download/ (not DCIM -- no EXIF = suspicious there)
        now = datetime.now()
        vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
        device_path = f"/sdcard/Download/{vid_name}"
        log.info("Pushing video to device: %s", device_path)
        self.adb.push_file(video_path, device_path)
        time.sleep(self.human.timing("t_file_push"))

        # Trigger media scan
        self.adb.shell(
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
            f'-d "file://{device_path}"'
        )
        time.sleep(self.human.timing("t_file_push"))

        # Step 2: Tap + (create) button
        x, y = self.adb.get_coord("tiktok", "nav_create")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_upload_load"))

        # Step 3: Tap "Upload" tab
        x, y = self.adb.get_coord("tiktok", "upload_tab")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Step 4: Select most recent video (top-left of gallery)
        x, y = self.adb.get_coord("tiktok", "gallery_first")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Step 5: Tap Next (top-right)
        x, y = self.adb.get_coord("tiktok", "upload_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Step 6: May need to tap Next again (editing screen)
        x, y = self.adb.get_coord("tiktok", "edit_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Step 7: Add caption
        if caption:
            x, y = self.adb.get_coord("tiktok", "upload_caption")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_caption_input"))

            self.adb.shell("input keyevent --longpress KEYCODE_DEL")
            time.sleep(self.human.timing("t_key_settle"))

            self.human.type_with_errors(self.adb, caption)
            time.sleep(self.human.timing("t_post_typing"))

        # Step 8: Tap Post (top-right or bottom)
        x, y = self.adb.get_coord("tiktok", "upload_post_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_post_upload"))

        # Verify post: check we're back on TikTok (not stuck in error dialog)
        # Wait briefly and re-check to catch delayed error popups
        time.sleep(self.human.timing("t_nav_settle"))
        current = self.adb.get_current_app()
        if current and TIKTOK_PKG in current:
            log.info("Video posted on TikTok!")
            self.adb.shell(f'rm "{device_path}"')
            return True
        else:
            log.warning("Post may have failed (current app: %s), keeping video on device", current)
            return False

    # --- High-Level Session Actions ----------------------------------------

    async def browse_session(self, duration_minutes: float, should_post: bool = False,
                             video_path: str = "", caption: str = "",
                             pre_scroll_minutes: float = 0, post_scroll_minutes: float = 0,
                             niche_keywords: list = None):
        """Execute a full browsing session.

        This is the main entry point called by the session executor.
        Handles the full cycle: scroll -> engage -> optionally post -> scroll more.
        """
        if not self.open_app():
            return

        # Behavior #10: Variable load reaction time
        time.sleep(self.human.load_reaction_time())

        self.go_to_fyp()
        time.sleep(self.human.timing("t_nav_settle"))

        start = time.time()
        total_seconds = duration_minutes * 60
        post_done = False
        post_after = pre_scroll_minutes * 60 if should_post else float('inf')
        category = "unknown"
        action_count = 0

        while (time.time() - start) < total_seconds:
            elapsed = time.time() - start

            # Periodic health check (every ~15 actions)
            action_count += 1
            if action_count % 15 == 0:
                self._check_health()

            # --- Post video at the right time ---
            if should_post and not post_done and elapsed >= post_after:
                if video_path:
                    success = self.post_video(video_path, caption)
                    post_done = True
                    if success:
                        self.go_to_fyp()
                        time.sleep(self.human.timing("t_nav_settle"))
                    continue

            # Behavior #1: Zona morta (dead stare, no touch)
            if self.human.should_zona_morta():
                duration = self.human.zona_morta_duration()
                log.debug("Zona morta: %.0fs", duration)
                await asyncio.sleep(duration)
                continue

            # --- Check for interruption (Layer 5) ---
            if self.human.should_interrupt():
                await self.human.do_interruption(self.adb, TIKTOK_PKG)
                continue

            # --- Pick next action based on session flow phase ---
            action = self.human.pick_action()

            if action == "scroll_fyp":
                watch_time = self.human.watch_duration()
                await asyncio.sleep(watch_time)

                # Categorize with Gemini (25% of videos for better memory)
                if random.random() < 0.25:
                    screenshot = self.adb.screenshot_bytes()
                    if screenshot:
                        info = gemini.categorize_video(screenshot)
                        category = info.get("category", "unknown")
                else:
                    category = "unknown"  # reset stale category each scroll

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
                    self.peek_scroll()
                # Behavior #5: Re-watch previous video
                elif self.human.should_rewatch():
                    self.scroll_fyp()
                    await asyncio.sleep(self.human.timing("t_rewatch"))
                    # Scroll back up
                    sw = self.human.humanize_swipe(
                        self.adb.screen_w // 2, self.adb.screen_h // 4,
                        self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
                    )
                    self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                    await asyncio.sleep(self.human.watch_duration())
                else:
                    self.scroll_fyp()
                await asyncio.sleep(self.human.action_delay())

            elif action == "like":
                if self.human.should_like(category):
                    self.like_video()
                    self.human.memory.record_like(category)
                    # Behavior #3: Post-like pause
                    await asyncio.sleep(self.human.post_like_pause())

            elif action == "comment":
                if self.human.should_comment():
                    # Behavior #9: Double-open comments (open, close, reopen)
                    if self.human.should_double_open_comments():
                        self.open_comments()
                        await asyncio.sleep(self.human.timing("t_double_open_1"))
                        self.adb.press_back()
                        await asyncio.sleep(self.human.timing("t_double_open_2"))
                    await self.comment_with_ai()

            elif action == "follow":
                if self.human.should_follow():
                    self.follow_creator()

            elif action == "search_explore":
                pool = niche_keywords or config.NICHE_KEYWORDS_POOL
                keywords = random.sample(pool, min(6, len(pool)))
                self.search_hashtag(random.choice(keywords))
                await asyncio.sleep(self.human.timing("t_search_browse"))
                self.go_to_fyp()

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
        log.info("TikTok session complete (%.1f min)", duration_minutes)
