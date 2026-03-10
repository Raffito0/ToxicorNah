"""Instagram actions -- all interactions with Instagram via raw ADB.

Same pattern as TikTok: coords for navigation, Gemini Vision for complex flows.

NO uiautomator, NO find_element, NO UI tree parsing.
"""
import asyncio
import logging
import random
import time
from datetime import datetime

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
            time.sleep(1)

        log.warning("Instagram didn't open in time")
        return False

    def close_app(self):
        self.adb.close_instagram()
        time.sleep(1)

    def go_to_feed(self):
        """Navigate to the home feed."""
        x, y = self.adb.get_coord("instagram", "nav_home")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(1.5)

    def go_to_reels(self):
        """Navigate to the Reels tab."""
        x, y = self.adb.get_coord("instagram", "nav_reels")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

    def go_to_explore(self):
        """Navigate to Explore/Search."""
        x, y = self.adb.get_coord("instagram", "nav_search")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

    def go_to_profile(self):
        x, y = self.adb.get_coord("instagram", "nav_profile")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

    # --- Core Actions ------------------------------------------------------

    def scroll_feed(self):
        """Scroll to next post/reel in the feed."""
        sw = self.human.humanize_swipe(
            self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
            self.adb.screen_w // 2, self.adb.screen_h // 4,
        )
        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])

    def scroll_reels(self):
        """Scroll to next Reel (same as TikTok swipe-up)."""
        self.scroll_feed()

    def like_post(self):
        """Like the current post/reel. Uses double-tap or heart icon."""
        if random.random() < 0.5:
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
        time.sleep(2)

    def write_comment(self, text: str):
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
        time.sleep(1.5)
        self.adb.press_back()
        log.debug("Posted comment on IG: %s", text[:30])

    async def comment_with_ai(self):
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return

        await asyncio.sleep(self.human.reading_delay())

        comment = gemini.generate_comment(screenshot, platform="instagram")
        if not comment or len(comment) < 3:
            return

        self.open_comments()
        self.write_comment(comment)
        self.human.memory.session_comments += 1

    def follow_user(self):
        """Follow creator -- tap avatar area (same as TikTok in Reels view)."""
        # In Reels view, avatar with + is on the right side
        x, y = self.adb.get_coord("instagram", "like_icon")
        # Avatar is above like icon
        avatar_y = y - int(self.adb.screen_h * 0.09)
        x, y = self.human.jitter_tap(x, avatar_y)
        self.adb.tap(x, y)
        time.sleep(self.human.action_delay())
        log.debug("Followed user on IG")

    def visit_profile(self):
        """Tap on the username of the current reel to visit their profile."""
        x, y = self.adb.get_coord("instagram", "username_reel")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2.5)

    async def rabbit_hole(self):
        """Visit a profile and browse their content."""
        self.visit_profile()
        time.sleep(2)

        n = self.human.rabbit_hole_depth()
        log.info("IG rabbit hole: browsing %d posts", n)

        # Tap first post in grid
        x, y = self.human.jitter_tap(self.adb.screen_w // 4, self.adb.screen_h // 2)
        self.adb.tap(x, y)
        time.sleep(2)

        for _ in range(n):
            watch = self.human.watch_duration(10)
            await asyncio.sleep(watch)
            if self.human.should_like():
                self.like_post()
            self.scroll_feed()
            await asyncio.sleep(self.human.action_delay())

        self.adb.press_back()
        time.sleep(0.5)
        self.adb.press_back()
        time.sleep(1)

    def search_keyword(self, keyword: str):
        """Search for a keyword on Instagram Explore."""
        self.go_to_explore()
        time.sleep(1)

        # Tap search bar
        x, y = self.adb.get_coord("instagram", "search_bar")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(1)

        self.human.type_with_errors(self.adb, keyword)

        self.adb.press_enter()
        time.sleep(self.human.timing("t_browse_results"))

    # --- Profile Setup -----------------------------------------------------

    def set_profile_pic(self, image_path: str):
        """Set profile picture during warmup."""
        log.info("Setting Instagram profile picture")

        device_path = f"/sdcard/DCIM/profile_{random.randint(1000, 9999)}.jpg"
        self.adb.push_file(image_path, device_path)
        time.sleep(2)
        self.adb.shell(
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
            f'-d "file://{device_path}"'
        )
        time.sleep(2)

        # Navigate: Profile -> Edit profile
        self.go_to_profile()
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap Edit profile
        x, y = self.adb.get_coord("instagram", "edit_profile_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        # Tap avatar area
        x, y = self.adb.get_coord("instagram", "avatar_edit")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        # "New profile photo" / "Choose from library" -- use Vision
        coords = self.adb.find_on_screen(
            "New profile photo or Choose from library button"
        )
        if coords:
            x, y = self.human.jitter_tap(*coords)
            self.adb.tap(x, y)
            time.sleep(2)

        # Select most recent photo
        x, y = self.adb.get_coord("instagram", "gallery_first")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        # Confirm -- Vision for Done/Next button
        coords = self.adb.wait_for_screen("Done or Next button", timeout=5)
        if coords:
            x, y = self.human.jitter_tap(*coords)
            self.adb.tap(x, y)
            time.sleep(3)

        self.adb.press_back()
        time.sleep(1)
        self.adb.shell(f'rm "{device_path}"')
        log.info("Instagram profile pic set")

    def set_bio(self, bio_text: str):
        """Set bio during warmup."""
        log.info("Setting Instagram bio")

        self.go_to_profile()
        time.sleep(self.human.timing("t_nav_settle"))

        # Tap Edit profile
        x, y = self.adb.get_coord("instagram", "edit_profile_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        # Tap Bio field
        x, y = self.adb.get_coord("instagram", "bio_field")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(1)

        self.adb.shell("input keyevent --longpress KEYCODE_DEL")
        time.sleep(0.3)

        self.human.type_with_errors(self.adb, bio_text)
        time.sleep(self.human.timing("t_post_typing"))

        # Save (top-right)
        x, y = self.adb.get_coord("instagram", "save_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        self.adb.press_back()
        time.sleep(1)
        log.info("Instagram bio set: %s", bio_text[:40])

    # --- Video Posting (Reels) ---------------------------------------------

    def post_reel(self, video_path: str, caption: str = "") -> bool:
        """Upload and post a Reel to Instagram."""
        # Push video to /sdcard/Download/ (not DCIM -- no EXIF = suspicious there)
        now = datetime.now()
        vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
        device_path = f"/sdcard/Download/{vid_name}"
        log.info("Pushing reel to device: %s", device_path)
        self.adb.push_file(video_path, device_path)
        time.sleep(2)

        self.adb.shell(
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
            f'-d "file://{device_path}"'
        )
        time.sleep(2)

        # Tap + (create) button
        x, y = self.adb.get_coord("instagram", "nav_create")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(3)

        # Switch to REEL tab
        x, y = self.adb.get_coord("instagram", "reel_tab")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        # Select video from gallery
        x, y = self.adb.get_coord("instagram", "gallery_first")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        # Tap Next (top-right)
        x, y = self.adb.get_coord("instagram", "upload_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        # Skip editing, tap Next again
        x, y = self.adb.get_coord("instagram", "upload_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(2)

        # Add caption
        if caption:
            x, y = self.adb.get_coord("instagram", "upload_caption")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(0.5)

            self.human.type_with_errors(self.adb, caption)
            time.sleep(1)

        # Share (top-right)
        x, y = self.adb.get_coord("instagram", "upload_share_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        log.info("Reel posted on Instagram!")
        time.sleep(5)

        self.adb.shell(f'rm "{device_path}"')
        return True

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

        # 50/50 start on Feed vs Reels
        if random.random() < 0.5:
            self.go_to_reels()
        else:
            self.go_to_feed()
        time.sleep(2)

        start = time.time()
        total_seconds = duration_minutes * 60
        post_done = False
        post_after = pre_scroll_minutes * 60 if should_post else float('inf')

        while (time.time() - start) < total_seconds:
            elapsed = time.time() - start

            if should_post and not post_done and elapsed >= post_after:
                if video_path:
                    success = self.post_reel(video_path, caption)
                    post_done = True
                    if success:
                        self.go_to_reels()
                        time.sleep(2)
                    continue

            # Behavior #1: Zona morta (dead stare, no touch)
            if self.human.should_zona_morta():
                duration = self.human.zona_morta_duration()
                log.debug("Zona morta: %.0fs", duration)
                await asyncio.sleep(duration)
                continue

            if self.human.should_interrupt():
                await self.human.do_interruption(self.adb)
                continue

            # --- Pick next action based on session flow phase ---
            action = self.human.pick_action()

            if action == "scroll_fyp":
                watch_time = self.human.watch_duration()
                await asyncio.sleep(watch_time)

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
                    # Scroll back up
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
                if self.human.should_like():
                    self.like_post()
                    self.human.memory.record_like("unknown")
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
                    self.follow_user()

            elif action == "search_explore":
                keywords = niche_keywords or [
                    "toxic relationship", "red flags", "situationship",
                    "dating advice", "couples", "relationship tips",
                ]
                self.search_keyword(random.choice(keywords))
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
