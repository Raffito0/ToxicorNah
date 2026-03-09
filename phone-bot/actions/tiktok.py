"""TikTok actions — all interactions with TikTok via raw ADB.

Every action uses:
- adb.tap() / adb.swipe() for input (with HumanEngine jitter)
- adb.dump_ui() / adb.find_element() for finding UI elements
- gemini.py for intelligent decisions (comments, categorization)
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
        time.sleep(random.uniform(3, 5))

        # Wait for TikTok to be in foreground
        for _ in range(10):
            if TIKTOK_PKG in self.adb.get_current_app():
                log.info("TikTok is open")
                return True
            time.sleep(1)

        log.warning("TikTok didn't open in time")
        return False

    def close_app(self):
        """Close TikTok."""
        self.adb.close_tiktok()
        time.sleep(1)

    def go_to_fyp(self):
        """Navigate to the For You Page (home tab)."""
        # Tap the Home icon (bottom left)
        el = self.adb.find_element(content_desc="Home")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Fallback: tap bottom-left area
            x, y = self.human.jitter_tap(self.adb.screen_w // 10, self.adb.screen_h - 60)
            self.adb.tap(x, y)
        time.sleep(1.5)

    def go_to_profile(self):
        """Navigate to own profile tab."""
        el = self.adb.find_element(content_desc="Profile")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Fallback: bottom-right
            x, y = self.human.jitter_tap(self.adb.screen_w - 50, self.adb.screen_h - 60)
            self.adb.tap(x, y)
        time.sleep(2)

    def go_to_search(self):
        """Open the Discover/Search page."""
        el = self.adb.find_element(content_desc="Discover") or \
             self.adb.find_element(content_desc="Search")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Fallback: tap search icon area (top right of FYP)
            x, y = self.human.jitter_tap(self.adb.screen_w - 60, 80)
            self.adb.tap(x, y)
        time.sleep(2)

    # --- Core Actions ------------------------------------------------------

    def scroll_fyp(self):
        """Scroll to the next video on FYP (swipe up)."""
        sw = self.human.humanize_swipe(
            self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
            self.adb.screen_w // 2, self.adb.screen_h // 4,
        )
        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])

    def peek_scroll(self):
        """Scroll halfway then go back — like peeking at next video."""
        mid_y = self.adb.screen_h // 2
        sw = self.human.humanize_swipe(
            self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
            self.adb.screen_w // 2, mid_y,
        )
        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
        time.sleep(random.uniform(0.5, 1.5))
        # Scroll back
        self.adb.swipe(sw["x2"], sw["y2"], sw["x1"], sw["y1"], sw["duration"])

    def like_video(self):
        """Like the current video. Randomly uses double-tap or heart icon."""
        if random.random() < 0.6:
            # Double-tap (more human)
            cx, cy = self.adb.screen_w // 2, self.adb.screen_h // 2
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
            time.sleep(random.uniform(0.1, 0.25))
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
        else:
            # Tap heart icon (right side)
            el = self.adb.find_element(content_desc="Like")
            if el:
                x, y = self.human.jitter_tap(*el.center)
                self.adb.tap(x, y)
            else:
                # Fallback: right side roughly where heart is
                x, y = self.human.jitter_tap(
                    self.adb.screen_w - 50,
                    self.adb.screen_h // 2 - 100,
                )
                self.adb.tap(x, y)

        time.sleep(self.human.action_delay())
        log.debug("Liked video")

    def open_comments(self):
        """Open the comments section."""
        el = self.adb.find_element(content_desc="Comment") or \
             self.adb.find_element(content_desc="comment")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Fallback: comment icon is below heart
            x, y = self.human.jitter_tap(
                self.adb.screen_w - 50,
                self.adb.screen_h // 2,
            )
            self.adb.tap(x, y)
        time.sleep(2)

    def write_comment(self, text: str):
        """Type and post a comment."""
        # Tap the comment input field
        el = self.adb.find_element(text="Add comment") or \
             self.adb.find_element(resource_id="comment_text")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Fallback: bottom of comments sheet
            x, y = self.human.jitter_tap(self.adb.screen_w // 2, self.adb.screen_h - 80)
            self.adb.tap(x, y)

        time.sleep(self.human.reading_delay())

        # Type character by character with human speed
        for char in text:
            self.adb.type_text(char)
            time.sleep(self.human.typing_delay())

        time.sleep(random.uniform(0.5, 1.5))

        # Tap Post/Send button
        el = self.adb.find_element(text="Post") or \
             self.adb.find_element(content_desc="Post")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            self.adb.press_enter()

        time.sleep(1.5)
        # Close comments
        self.adb.press_back()
        log.debug("Posted comment: %s", text[:30])

    async def comment_with_ai(self):
        """Generate a contextual comment using Gemini and post it."""
        # Take screenshot for Gemini to analyze
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return

        # Reading pause (pretend to read the video)
        await asyncio.sleep(self.human.reading_delay())

        comment = gemini.generate_comment(screenshot, platform="tiktok")
        if not comment or len(comment) < 3:
            log.warning("Gemini generated empty/short comment, skipping")
            return

        self.open_comments()
        self.write_comment(comment)
        self.human.memory.session_comments += 1

    def follow_creator(self):
        """Follow the creator of the current video."""
        # Tap the profile picture (has + icon) or Follow button
        el = self.adb.find_element(content_desc="Follow") or \
             self.adb.find_element(text="Follow")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(self.human.action_delay())
            log.debug("Followed creator")
        else:
            # Tap the avatar icon on the right side (usually has + overlay)
            x, y = self.human.jitter_tap(
                self.adb.screen_w - 50,
                self.adb.screen_h // 2 - 200,
            )
            self.adb.tap(x, y)

    def visit_creator_profile(self):
        """Tap on creator's username to visit their profile."""
        # Username is usually at the bottom-left of the video
        el = self.adb.find_element(resource_id="com.zhiliaoapp.musically:id/title")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Fallback: tap username area (bottom-left)
            x, y = self.human.jitter_tap(150, self.adb.screen_h - 200)
            self.adb.tap(x, y)
        time.sleep(2.5)

    async def rabbit_hole(self):
        """Visit creator profile and watch several of their videos."""
        self.visit_creator_profile()
        time.sleep(2)

        n_videos = self.human.rabbit_hole_depth()
        log.info("Rabbit hole: watching %d videos on profile", n_videos)

        for i in range(n_videos):
            if i == 0:
                # Tap first video on their grid
                grid_y = self.adb.screen_h // 2
                x, y = self.human.jitter_tap(self.adb.screen_w // 4, grid_y)
                self.adb.tap(x, y)
                time.sleep(2)
            else:
                # Swipe to next video
                self.scroll_fyp()

            # Watch for a bit
            watch = self.human.watch_duration(15)
            await asyncio.sleep(watch)

            # Maybe like
            if self.human.should_like():
                self.like_video()

        # Go back to FYP
        self.adb.press_back()
        time.sleep(0.5)
        self.adb.press_back()
        time.sleep(1)

    def search_hashtag(self, hashtag: str):
        """Search for a hashtag and browse results."""
        self.go_to_search()
        time.sleep(1.5)

        # Tap search bar
        el = self.adb.find_element(resource_id="com.zhiliaoapp.musically:id/search_bar") or \
             self.adb.find_element(text="Search")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        time.sleep(1)

        # Type hashtag
        for char in hashtag:
            self.adb.type_text(char)
            time.sleep(self.human.typing_delay())

        time.sleep(0.5)
        self.adb.press_enter()
        time.sleep(2.5)

    # --- Profile Setup -----------------------------------------------------

    def set_profile_pic(self, image_path: str):
        """Set profile picture during warmup. Pushes image to phone, navigates to settings."""
        log.info("Setting TikTok profile picture")

        # Push image to phone
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

        # Tap profile photo area (usually top center of edit screen)
        el = self.adb.find_element(text="Change photo") or \
             self.adb.find_element(content_desc="Change photo") or \
             self.adb.find_element(text="Change picture")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Fallback: tap avatar area at top
            x, y = self.human.jitter_tap(self.adb.screen_w // 2, 250)
            self.adb.tap(x, y)
        time.sleep(2)

        # Select "Choose from library" / "Select from gallery"
        el = self.adb.find_element(text="Select from gallery") or \
             self.adb.find_element(text="Choose from library") or \
             self.adb.find_element(text="Upload photo")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Select most recent photo (top-left of gallery)
        x, y = self.human.jitter_tap(self.adb.screen_w // 4, self.adb.screen_h // 3)
        self.adb.tap(x, y)
        time.sleep(2)

        # Confirm/crop
        el = self.adb.wait_for_element(text="Save", timeout=5) or \
             self.adb.find_element(text="Confirm") or \
             self.adb.find_element(text="Done")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(3)

        # Go back to profile
        self.adb.press_back()
        time.sleep(1)
        self.adb.shell(f'rm "{device_path}"')
        log.info("TikTok profile pic set")

    def set_bio(self, bio_text: str):
        """Set bio/description during warmup."""
        log.info("Setting TikTok bio")

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
             self.adb.find_element(text="Add a bio") or \
             self.adb.find_element(resource_id="com.zhiliaoapp.musically:id/bio")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(1)

        # Clear existing text
        self.adb.shell("input keyevent --longpress KEYCODE_DEL")
        time.sleep(0.3)

        # Type bio with human speed
        for char in bio_text:
            self.adb.type_text(char)
            time.sleep(self.human.typing_delay())
        time.sleep(random.uniform(0.5, 1.5))

        # Save
        el = self.adb.find_element(text="Save") or \
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
        log.info("TikTok bio set: %s", bio_text[:40])

    # --- Video Posting -----------------------------------------------------

    def post_video(self, video_path: str, caption: str = "") -> bool:
        """Upload and post a video to TikTok.
        1. Push video to phone storage
        2. Open TikTok upload flow
        3. Select the video
        4. Add caption
        5. Post
        Returns True if successful.
        """
        # Step 1: Push video to phone with Android camera naming
        now = datetime.now()
        cam_name = f"VID_{now.strftime('%Y%m%d_%H%M%S')}_{random.randint(100,999)}.mp4"
        device_path = f"/sdcard/DCIM/Camera/{cam_name}"
        log.info("Pushing video to device: %s", device_path)
        self.adb.push_file(video_path, device_path)
        time.sleep(2)

        # Trigger media scan so the video appears in gallery
        self.adb.shell(f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://{device_path}"')
        time.sleep(2)

        # Step 2: Tap the + (create) button
        el = self.adb.find_element(content_desc="Create") or \
             self.adb.find_element(resource_id="com.zhiliaoapp.musically:id/bottom_tab_icon_big")
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
        else:
            # Center bottom
            x, y = self.human.jitter_tap(self.adb.screen_w // 2, self.adb.screen_h - 60)
            self.adb.tap(x, y)

        time.sleep(3)

        # Step 3: Tap "Upload" to go to gallery
        el = self.adb.wait_for_element(text="Upload", timeout=5)
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Step 4: Select the most recent video (top-left of gallery grid)
        time.sleep(2)
        x, y = self.human.jitter_tap(self.adb.screen_w // 4, self.adb.screen_h // 3)
        self.adb.tap(x, y)
        time.sleep(1.5)

        # Tap "Next"
        el = self.adb.wait_for_element(text="Next", timeout=5)
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # May need to tap Next again (editing screen)
        el = self.adb.find_element(text="Next", force_dump=True)
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            time.sleep(2)

        # Step 5: Add caption
        if caption:
            el = self.adb.find_element(text="Describe your video") or \
                 self.adb.find_element(resource_id="com.zhiliaoapp.musically:id/description")
            if el:
                x, y = self.human.jitter_tap(*el.center)
                self.adb.tap(x, y)
                time.sleep(0.5)

                # Clear any existing text
                self.adb.shell("input keyevent --longpress KEYCODE_DEL")
                time.sleep(0.3)

                # Type caption with human speed
                for char in caption:
                    self.adb.type_text(char)
                    time.sleep(self.human.typing_delay())

                time.sleep(1)

        # Step 6: Tap "Post"
        el = self.adb.wait_for_element(text="Post", timeout=5)
        if el:
            x, y = self.human.jitter_tap(*el.center)
            self.adb.tap(x, y)
            log.info("Video posted on TikTok!")
            time.sleep(5)

            # Clean up: delete video from phone
            self.adb.shell(f'rm "{device_path}"')
            return True

        log.warning("Could not find Post button")
        return False

    # --- High-Level Session Actions ----------------------------------------

    async def browse_session(self, duration_minutes: float, should_post: bool = False,
                             video_path: str = "", caption: str = "",
                             pre_scroll_minutes: float = 0, post_scroll_minutes: float = 0):
        """Execute a full browsing session.

        This is the main entry point called by the session executor.
        Handles the full cycle: scroll → engage → optionally post → scroll more.
        """
        if not self.open_app():
            return

        self.go_to_fyp()
        time.sleep(2)

        engagement_mix = self.human.session_engagement_mix()
        start = time.time()
        total_seconds = duration_minutes * 60
        post_done = False

        # If posting: scroll pre_scroll_minutes first, then post, then post_scroll
        post_after = pre_scroll_minutes * 60 if should_post else float('inf')

        while (time.time() - start) < total_seconds:
            elapsed = time.time() - start

            # --- Post video at the right time ---
            if should_post and not post_done and elapsed >= post_after:
                if video_path:
                    success = self.post_video(video_path, caption)
                    post_done = True
                    if success:
                        self.go_to_fyp()
                        time.sleep(2)
                    continue

            # --- Check for interruption (Layer 3) ---
            if self.human.should_interrupt():
                await self.human.do_interruption(self.adb)
                continue

            # --- Pick next action based on engagement mix ---
            action = self.human.pick_action(engagement_mix)

            if action == "scroll_fyp":
                # Watch current video
                watch_time = self.human.watch_duration()
                await asyncio.sleep(watch_time)

                # Maybe categorize with Gemini (10% of videos, saves API calls)
                category = "unknown"
                if random.random() < 0.10:
                    screenshot = self.adb.screenshot_bytes()
                    if screenshot:
                        info = gemini.categorize_video(screenshot)
                        category = info.get("category", "unknown")

                # Scroll to next video
                if random.random() < 0.05:
                    self.peek_scroll()  # 5% peek scrolls
                else:
                    self.scroll_fyp()
                await asyncio.sleep(self.human.action_delay())

            elif action == "like":
                if self.human.should_like(category):
                    self.like_video()
                    self.human.memory.record_like(category)

            elif action == "comment":
                if self.human.should_comment():
                    await self.comment_with_ai()

            elif action == "follow":
                if self.human.should_follow():
                    self.follow_creator()

            elif action == "search_explore":
                hashtags = ["fyp", "viral", "trending", "funny", "relatable"]
                self.search_hashtag(random.choice(hashtags))
                await asyncio.sleep(random.uniform(5, 15))
                self.go_to_fyp()

            elif action == "profile_visit":
                if self.human.should_rabbit_hole():
                    await self.rabbit_hole()

            await asyncio.sleep(self.human.action_delay())

        self.close_app()
        log.info("TikTok session complete (%.1f min)", duration_minutes)
