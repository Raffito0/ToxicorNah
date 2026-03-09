"""Instagram actions — all interactions with Instagram via raw ADB.

Same pattern as TikTok: ADB for input, UI tree for elements, Gemini for decisions.
"""
import asyncio
import logging
import os
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
        time.sleep(random.uniform(3, 5))

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
        el = self.adb.find_element(content_desc="Home") or \
             self.adb.find_element(content_desc="home")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            x, y = self.human.jitter_tap(50, self.adb.screen_h - 60)
            self.adb.tap(x, y)
        time.sleep(1.5)

    def go_to_reels(self):
        """Navigate to the Reels tab."""
        el = self.adb.find_element(content_desc="Reels")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Reels icon is in the middle of bottom nav
            x, y = self.human.jitter_tap(self.adb.screen_w // 2, self.adb.screen_h - 60)
            self.adb.tap(x, y)
        time.sleep(2)

    def go_to_explore(self):
        """Navigate to Explore/Search."""
        el = self.adb.find_element(content_desc="Search and explore") or \
             self.adb.find_element(content_desc="Search")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            x, y = self.human.jitter_tap(self.adb.screen_w // 4, self.adb.screen_h - 60)
            self.adb.tap(x, y)
        time.sleep(2)

    def go_to_profile(self):
        el = self.adb.find_element(content_desc="Profile")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            x, y = self.human.jitter_tap(self.adb.screen_w - 50, self.adb.screen_h - 60)
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
            # Double-tap
            cx, cy = self.adb.screen_w // 2, self.adb.screen_h // 2
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
            time.sleep(random.uniform(0.1, 0.25))
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
        else:
            el = self.adb.find_element(content_desc="Like") or \
                 self.adb.find_element(content_desc="like")
            if el:
                x, y = self.human.jitter_tap(*el.center)
                self.adb.tap(x, y)

        time.sleep(self.human.action_delay())
        log.debug("Liked post on Instagram")

    def open_comments(self):
        el = self.adb.find_element(content_desc="Comment") or \
             self.adb.find_element(content_desc="comment")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        time.sleep(2)

    def write_comment(self, text: str):
        # Tap comment input
        el = self.adb.find_element(text="Add a comment") or \
             self.adb.find_element(resource_id="com.instagram.android:id/layout_comment_thread_edittext")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)

        time.sleep(self.human.reading_delay())

        for char in text:
            self.adb.type_text(char)
            time.sleep(self.human.typing_delay())

        time.sleep(random.uniform(0.5, 1.0))

        # Post button
        el = self.adb.find_element(text="Post") or \
             self.adb.find_element(content_desc="Post")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)

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
        el = self.adb.find_element(text="Follow")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(self.human.action_delay())
            log.debug("Followed user on IG")

    def visit_profile(self):
        """Tap on the username of the current post to visit their profile."""
        # Username is usually near the top of the post
        el = self.adb.find_element(resource_id="com.instagram.android:id/row_feed_photo_profile_name")
        if el:
            x, y = self.human.jitter_tap(*el.center)
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

    # --- Profile Setup -----------------------------------------------------

    def set_profile_pic(self, image_path: str):
        """Set profile picture during warmup."""
        log.info("Setting Instagram profile picture")

        device_path = f"/sdcard/DCIM/profile_{random.randint(1000,9999)}.jpg"
        self.adb.push_file(image_path, device_path)
        time.sleep(2)
        self.adb.shell(f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://{device_path}"')
        time.sleep(2)

        # Navigate: Profile → Edit profile
        self.go_to_profile()
        time.sleep(random.uniform(1.5, 3))

        el = self.adb.find_element(text="Edit profile") or \
             self.adb.find_element(content_desc="Edit profile")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Tap avatar / "Change profile photo"
        el = self.adb.find_element(text="Change profile photo") or \
             self.adb.find_element(text="Edit picture or avatar") or \
             self.adb.find_element(content_desc="Change profile photo")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Fallback: tap avatar area
            x, y = self.human.jitter_tap(self.adb.screen_w // 2, 250)
            self.adb.tap(x, y)
        time.sleep(2)

        # "New profile photo" / "Choose from library"
        el = self.adb.find_element(text="New profile photo") or \
             self.adb.find_element(text="Choose from library") or \
             self.adb.find_element(text="Import from gallery")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Select most recent photo
        x, y = self.human.jitter_tap(self.adb.screen_w // 4, self.adb.screen_h // 3)
        self.adb.tap(x, y)
        time.sleep(2)

        # Confirm
        el = self.adb.wait_for_element(text="Done", timeout=5) or \
             self.adb.find_element(text="Next") or \
             self.adb.find_element(content_desc="Done")
        if el:
            x, y = self.human.jitter_tap(*el.center)
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
        time.sleep(random.uniform(1.5, 3))

        el = self.adb.find_element(text="Edit profile") or \
             self.adb.find_element(content_desc="Edit profile")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Tap Bio field
        el = self.adb.find_element(text="Bio") or \
             self.adb.find_element(resource_id="com.instagram.android:id/bio")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(1)

        self.adb.shell("input keyevent --longpress KEYCODE_DEL")
        time.sleep(0.3)

        for char in bio_text:
            self.adb.type_text(char)
            time.sleep(self.human.typing_delay())
        time.sleep(random.uniform(0.5, 1.5))

        # Save / checkmark
        el = self.adb.find_element(content_desc="Done") or \
             self.adb.find_element(text="Done") or \
             self.adb.find_element(content_desc="Save")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)
        else:
            self.adb.press_back()
            time.sleep(1)

        self.adb.press_back()
        time.sleep(1)
        log.info("Instagram bio set: %s", bio_text[:40])

    # --- Video Posting (Reels) ---------------------------------------------

    def post_reel(self, video_path: str, caption: str = "") -> bool:
        """Upload and post a Reel to Instagram."""
        # Push video to phone with Android camera naming
        now = datetime.now()
        cam_name = f"VID_{now.strftime('%Y%m%d_%H%M%S')}_{random.randint(100,999)}.mp4"
        device_path = f"/sdcard/DCIM/Camera/{cam_name}"
        log.info("Pushing reel to device: %s", device_path)
        self.adb.push_file(video_path, device_path)
        time.sleep(2)

        self.adb.shell(f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://{device_path}"')
        time.sleep(2)

        # Tap + (create) button
        el = self.adb.find_element(content_desc="New post") or \
             self.adb.find_element(content_desc="Create")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Center bottom nav
            x, y = self.human.jitter_tap(self.adb.screen_w // 2, self.adb.screen_h - 60)
            self.adb.tap(x, y)
        time.sleep(3)

        # Switch to REEL tab
        el = self.adb.wait_for_element(text="REEL", timeout=5) or \
             self.adb.find_element(text="Reel")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Select video from gallery (tap most recent)
        x, y = self.human.jitter_tap(self.adb.screen_w // 4, self.adb.screen_h // 3)
        self.adb.tap(x, y)
        time.sleep(2)

        # Tap Next/Add
        el = self.adb.wait_for_element(text="Next", timeout=5) or \
             self.adb.find_element(text="Add")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Skip editing, tap Next again
        el = self.adb.find_element(text="Next", force_dump=True)
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Add caption
        if caption:
            el = self.adb.find_element(text="Write a caption") or \
                 self.adb.find_element(resource_id="com.instagram.android:id/caption_text_view")
            if el:
                x, y = self.human.jitter_tap(*el.center)
                self.adb.tap(x, y)
                time.sleep(0.5)

                for char in caption:
                    self.adb.type_text(char)
                    time.sleep(self.human.typing_delay())

                time.sleep(1)

        # Share
        el = self.adb.wait_for_element(text="Share", timeout=5)
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            log.info("Reel posted on Instagram!")
            time.sleep(5)

            self.adb.shell(f'rm "{device_path}"')
            return True

        log.warning("Could not find Share button")
        return False

    # --- High-Level Session ------------------------------------------------

    async def browse_session(self, duration_minutes: float, should_post: bool = False,
                             video_path: str = "", caption: str = "",
                             pre_scroll_minutes: float = 0, post_scroll_minutes: float = 0):
        """Execute a full Instagram browsing session."""
        if not self.open_app():
            return

        # 50/50 start on Feed vs Reels
        if random.random() < 0.5:
            self.go_to_reels()
        else:
            self.go_to_feed()
        time.sleep(2)

        engagement_mix = self.human.session_engagement_mix()
        start = time.time()
        total_seconds = duration_minutes * 60
        post_done = False
        post_after = pre_scroll_minutes * 60 if should_post else float('inf')

        while (time.time() - start) < total_seconds:
            elapsed = time.time() - start

            # Post at the right time
            if should_post and not post_done and elapsed >= post_after:
                if video_path:
                    success = self.post_reel(video_path, caption)
                    post_done = True
                    if success:
                        self.go_to_reels()
                        time.sleep(2)
                    continue

            # Interruption check
            if self.human.should_interrupt():
                await self.human.do_interruption(self.adb)
                continue

            action = self.human.pick_action(engagement_mix)

            if action == "scroll_fyp":
                watch_time = self.human.watch_duration()
                await asyncio.sleep(watch_time)
                self.scroll_reels()
                await asyncio.sleep(self.human.action_delay())

            elif action == "like":
                if self.human.should_like():
                    self.like_post()
                    self.human.memory.record_like("unknown")

            elif action == "comment":
                if self.human.should_comment():
                    await self.comment_with_ai()

            elif action == "follow":
                if self.human.should_follow():
                    self.follow_user()

            elif action == "search_explore":
                self.go_to_explore()
                await asyncio.sleep(random.uniform(5, 15))
                self.go_to_reels()

            elif action == "profile_visit":
                if self.human.should_rabbit_hole():
                    await self.rabbit_hole()

            await asyncio.sleep(self.human.action_delay())

        self.close_app()
        log.info("Instagram session complete (%.1f min)", duration_minutes)
