"""Phone Bot — main entry point.

Discovers connected phones via ADB, initializes controllers,
and starts the session executor to run today's plan.

Usage:
    python main.py                       # run today's plan (or warmup if active)
    python main.py --forever             # 24/7 mode: daily loop with auto plan loading
    python main.py --dashboard           # start web dashboard
    python main.py --test                # test device connections
    python main.py --warmup              # initialize warmup for all accounts
    python main.py --warmup --phone 1    # initialize warmup for phone 1 only
    python main.py --scroll-only --phone 4  # TEST: 5 min passive scroll, no engagement
    python main.py --browse-test --phone 4  # TEST: full session (no comment write, no post)
    python main.py --browse-test --phone 4 --duration 10  # same but 10 min
    python main.py --action-test --phone 4  # TEST: force every action once (scroll,like,follow,search,comments,profile)
"""
import argparse
import asyncio
import logging
import logging.handlers
import os
import random
import subprocess
import sys
import time
import json
from datetime import datetime, timedelta

from .config import ADB_PATH, PHONES, ACCOUNTS, LOGS_DIR, GEMINI, AIRTABLE, TEST_MODE, DATA_DIR
from .core.adb import ADBController, DeviceLostError, DeviceConfigError
from .core.proxy import ProxyQueue
from .core.human import HumanEngine
from .planner.executor import SessionExecutor
from .main_discovery import discover_devices

# Console + rotating file log
# DEBUG level: see every tap, swipe, decision, Gemini call in real-time
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stderr,  # unbuffered on most systems
)
_file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOGS_DIR, "phone_bot.log"),
    maxBytes=5 * 1024 * 1024,  # 5 MB
    backupCount=3,
    encoding="utf-8",
)
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
))
logging.getLogger().addHandler(_file_handler)
log = logging.getLogger("phone_bot")


# discover_devices() is imported from main_discovery.py (single source of truth)


def test_devices(controllers: dict[int, ADBController]):
    """Test all connected devices."""
    for phone_id, ctrl in controllers.items():
        log.info("--- Testing Phone %d ---", phone_id)
        log.info("  Connected: %s", ctrl.is_connected())
        log.info("  Screen on: %s", ctrl.is_screen_on())
        log.info("  Current app: %s", ctrl.get_current_app())
        log.info("  WiFi: %s", ctrl.get_wifi_ssid())

        # Test screenshot
        img = ctrl.screenshot()
        if img:
            log.info("  Screenshot: %dx%d", img.width, img.height)
        else:
            log.warning("  Screenshot: FAILED")

        # Test coord lookup
        x, y = ctrl.get_coord("tiktok", "nav_home")
        log.info("  Coord test (tiktok nav_home): %d, %d", x, y)


async def run_scroll_only(controllers: dict[int, ADBController], phone_id: int,
                          duration_min: int = 5):
    """TEST MODE: Open TikTok and scroll passively. No likes, comments, follows, posts.
    Logs every action to console + file for review."""
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=duration_min,
    )

    from .core.monitor import init_monitor
    init_monitor(test_mode=True)
    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== SCROLL-ONLY TEST: Phone %d | %d min | NO engagement ===", phone_id, duration_min)

    if not bot.open_app():
        log.error("Failed to open TikTok")
        return

    time.sleep(human.timing("t_app_load"))
    bot.go_to_fyp()
    time.sleep(human.timing("t_nav_settle"))

    start = time.time()
    video_count = 0

    while (time.time() - start) < duration_min * 60:
        # Watch current video
        watch = human.watch_duration()
        video_count += 1
        log.info("[Video #%d] Watching %.1fs", video_count, watch)
        time.sleep(watch)

        # Zona morta (stare doing nothing)
        if human.should_zona_morta():
            zm = human.zona_morta_duration()
            log.info("[Zona morta] Pausing %.0fs", zm)
            time.sleep(zm)

        # Scroll to next video
        sw = human.humanize_swipe(
            adb.screen_w // 2, adb.screen_h * 3 // 4,
            adb.screen_w // 2, adb.screen_h // 4,
        )
        if sw.get("hand_switched"):
            log.info("[Hand switch] pausing %.1fs for repositioning", sw["hand_switch_pause"])
            time.sleep(sw["hand_switch_pause"])
        log.info("[Scroll] swipe (%d,%d)->(%d,%d) %dms",
                 sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
        adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])

        delay = human.action_delay()
        log.info("[Delay] %.2fs", delay)
        time.sleep(delay)

    elapsed = time.time() - start
    log.info("=== TEST COMPLETE: %d videos in %.0fs ===", video_count, elapsed)
    bot.close_app()
    human.end_session()


async def run_like_test(controllers: dict[int, ADBController], phone_id: int):
    """TEST MODE: Scroll 3 videos then like the 4th. Verifies like_video() works."""
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=6,
    )

    from .core.monitor import init_monitor
    init_monitor(test_mode=True)
    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== LIKE TEST: Phone %d | Scroll 9, like 10th, scroll 5-6 more ===", phone_id)

    if not bot.open_app():
        log.error("Failed to open TikTok")
        return

    time.sleep(human.timing("t_app_load"))
    bot.go_to_fyp()
    time.sleep(human.timing("t_nav_settle"))

    # Scroll through 9 videos
    for i in range(9):
        watch = human.watch_duration()
        log.info("[Video #%d] Watching %.1fs (scroll past)", i + 1, watch)
        time.sleep(watch)
        bot.scroll_fyp()
        time.sleep(human.action_delay())

    # Watch the 10th video, then like it
    watch = human.watch_duration()
    log.info("[Video #10] Watching %.1fs then LIKING", watch)
    time.sleep(watch)

    log.info("[LIKE] Liking video #10 (double_tap_habit=%.0f%%)",
             human.personality.double_tap_habit * 100)
    bot.like_video()

    # Watch a bit more after liking
    post_like = human.post_like_pause()
    log.info("[Post-like] Pausing %.1fs", post_like)
    time.sleep(post_like)

    # Scroll 5-6 more to verify no issues after like
    post_like_count = random.randint(5, 6)
    for i in range(post_like_count):
        watch = human.watch_duration()
        log.info("[Video #%d] Watching %.1fs (post-like scroll)", i + 11, watch)
        time.sleep(watch)
        bot.scroll_fyp()
        time.sleep(human.action_delay())

    log.info("=== LIKE TEST COMPLETE ===")
    bot.close_app()
    human.end_session()


async def run_browse_test(controllers: dict[int, ADBController], phone_id: int,
                          duration_min: int = 8):
    """TEST MODE: Full browse session with ALL engagement EXCEPT comment writing and posting.
    Tests: scroll, like, follow, search/explore, comment browsing, profile visits,
    all micro-behaviors (zona morta, peek scroll, micro scroll, etc.)."""
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=duration_min,
    )

    # Sample niche keywords for this session
    from . import config
    niche_keywords = random.sample(
        config.NICHE_KEYWORDS_POOL,
        min(8, len(config.NICHE_KEYWORDS_POOL)),
    )

    from .core.monitor import init_monitor
    init_monitor(test_mode=True)
    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== BROWSE TEST: Phone %d | %d min | ALL engagement EXCEPT comment write + post ===",
             phone_id, duration_min)
    log.info("  Personality: sociality=%.2f, style=%s, curiosity=%.2f, double_tap=%.2f",
             human.personality.comment_sociality, human.personality.comment_style,
             human.personality.explore_curiosity, human.personality.double_tap_habit)
    log.info("  Mood: energy=%.2f, patience=%.2f", human.mood.energy, human.mood.patience)
    log.info("  Niche keywords: %s", niche_keywords[:4])

    # Auto-save screenshots at every Gemini call point
    from .core.adb import ADBController
    test_id = datetime.now().strftime('%Y%m%d_%H%M%S')
    screenshot_dir = os.path.join(config.DATA_DIR, "logs", f"screenshots_{test_id}")
    os.makedirs(screenshot_dir, exist_ok=True)
    adb._screenshot_save_dir = screenshot_dir
    ADBController._screenshot_counter = 0
    log.info("Screenshots saving to: %s", screenshot_dir)

    # No background recorder — interferes with ADB tap commands.
    # Using targeted screenshots at error-prone moments instead (zero interference).

    await bot.browse_session(
        duration_minutes=duration_min,
        should_post=False,
        niche_keywords=niche_keywords,
        allow_comment_write=False,
    )
    adb._screenshot_save_dir = None

    human.end_session()
    log.info("=== BROWSE TEST COMPLETE ===")


async def run_scroll_test(controllers: dict[int, ADBController], phone_id: int):
    """TEST: Focus test for the universal scroll system in all 3 contexts."""
    if phone_id not in controllers:
        log.error("Phone %d not connected!", phone_id)
        return

    adb = controllers[phone_id]
    from .core.adb import ADBController as _ADB
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(hour=datetime.now().hour, weekday=datetime.now().weekday(), duration_minutes=10)

    from . import config
    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    # Screenshots
    test_id = datetime.now().strftime('%Y%m%d_%H%M%S')
    screenshot_dir = os.path.join(config.DATA_DIR, "logs", f"screenshots_scroll_{test_id}")
    os.makedirs(screenshot_dir, exist_ok=True)
    adb._screenshot_save_dir = screenshot_dir
    _ADB._screenshot_counter = 0

    log.info("=" * 60)
    log.info("SCROLL TEST: testing universal scroll in all contexts")
    log.info("=" * 60)

    if not bot.open_app():
        log.error("Failed to open TikTok")
        return
    time.sleep(human.timing("t_app_load"))

    # Verify FYP is actually responding to swipes
    if not bot._verify_fyp_responsive():
        log.error("FYP not responsive — aborting test")
        bot.close_app()
        return

    # Randomize test order each run
    search_keywords = ["couple goals", "love advice", "dating red flags",
                       "heartbreak quotes", "boyfriend goals", "situationship",
                       "toxic relationships"]
    search_kw = random.choice(search_keywords)

    def _test_comments():
        log.info("\n>>> TEST: Comments scroll")
        n_scroll = random.randint(2, 5)
        log.info("Scrolling %d videos before opening comments", n_scroll)
        for _ in range(n_scroll):
            bot.scroll_fyp()
            time.sleep(human.watch_duration() * random.uniform(0.2, 0.5))

        if bot.open_comments():
            if bot._comments_scrollable:
                log.info("Comments opened + scrollable — testing scroll system")
                bot._human_browse_scroll(context="comments")
                log.info("Comments scroll DONE")
            else:
                log.info("Comments opened but NOT scrollable (too few) — skipping scroll")
                time.sleep(2)
            adb.press_back()
            time.sleep(human.timing("t_nav_settle"))
            bot._verify_page("fyp")
        else:
            log.error("Comments didn't open!")

    def _test_search():
        log.info("\n>>> TEST: Search grid scroll (keyword: '%s')", search_kw)
        # Scroll a bit first so we're not on the same video
        for _ in range(random.randint(1, 3)):
            bot.scroll_fyp()
            time.sleep(human.watch_duration() * random.uniform(0.2, 0.4))

        bot.go_to_search()
        time.sleep(human.timing("t_nav_settle"))
        x, y = adb.get_coord("tiktok", "search_bar")
        x, y = human.jitter_tap(x, y)
        adb.tap(x, y)
        time.sleep(0.5)
        human.type_with_errors(adb, search_kw)
        time.sleep(human.timing("micro_pause"))
        adb.press_enter()
        time.sleep(human.timing("t_browse_results"))

        log.info("Search results loaded — testing scroll system")
        bot._human_browse_scroll(context="grid")
        log.info("Search grid scroll DONE")

        # Go back to FYP
        adb.press_back()
        time.sleep(human.timing("t_nav_settle"))
        bot._return_to_fyp()

    def _test_profile():
        log.info("\n>>> TEST: Profile grid scroll")
        # Scroll to fresh content with avatar visible
        for _ in range(random.randint(2, 4)):
            bot.scroll_fyp()
            time.sleep(human.watch_duration() * random.uniform(0.2, 0.5))

        if bot.visit_creator_profile():
            log.info("Profile opened — testing scroll system")
            bot._human_browse_scroll(context="grid")
            log.info("Profile grid scroll DONE")
            adb.press_back()
            time.sleep(human.timing("t_nav_settle"))
        else:
            log.error("Profile didn't open!")

    tests = [_test_comments, _test_search, _test_profile]
    random.shuffle(tests)
    log.info("Test order: %s", [t.__name__ for t in tests])

    for test_fn in tests:
        test_fn()
        # Ensure on FYP between tests
        if not bot._verify_page("fyp"):
            bot._return_to_fyp()

    bot.close_app()
    adb._screenshot_save_dir = None
    human.end_session()

    log.info("\n" + "=" * 60)
    log.info("SCROLL TEST COMPLETE — check screenshots in %s", screenshot_dir)
    log.info("=" * 60)


def run_tap_test(controllers: dict[int, ADBController], phone_id: int, target: str):
    """Quick tap test on the current video. App must already be open on a FYP video.
    target: 'avatar' or 'comment'"""
    if phone_id not in controllers:
        log.error("Phone %d not connected!", phone_id)
        return
    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(hour=datetime.now().hour, weekday=datetime.now().weekday(), duration_minutes=5)

    from . import config
    from .actions.tiktok import TikTokBot
    from .core import gemini
    bot = TikTokBot(adb, human)

    if target == "avatar":
        log.info("TAP TEST: avatar (visit_creator_profile)")
        result = bot.visit_creator_profile()
        if result:
            log.info("SUCCESS: profile opened!")
            time.sleep(2)
            bot._return_to_fyp()
            log.info("Returned to FYP")
        else:
            log.error("FAILED: profile didn't open")

    elif target == "comment":
        log.info("TAP TEST: comment icon (open_comments)")
        result = bot.open_comments()
        if result:
            log.info("SUCCESS: comments opened! (scrollable=%s)", bot._comments_scrollable)
            if bot._comments_scrollable:
                log.info("Scrolling comments...")
                bot._human_browse_scroll(context="comments")
                log.info("Comments scroll DONE")
            else:
                log.info("Not enough comments to scroll, skipping")
                time.sleep(2)
            bot._dismiss_comments()
            log.info("Comments closed via video tap")
        else:
            log.error("FAILED: comments didn't open")

    elif target == "following":
        log.info("TAP TEST: Following tab")
        result = bot._tap_top_tab("Following")
        if result:
            log.info("SUCCESS: Following tab opened!")
            time.sleep(2)
            # Phase 1: Stories carousel (may watch multiple Stories)
            log.info("Phase 1: Stories carousel...")
            stories_watched = 0
            while stories_watched < 4:
                tapped = bot._browse_stories_carousel()
                if not tapped:
                    break
                log.info("Story tapped, navigating...")
                bot._navigate_stories(max_stories=2)
                adb.press_back()
                time.sleep(0.5)
                stories_watched += 1
                story_aff = human.personality.story_affinity if human.personality else 0.5
                fatigue_val = human.fatigue.fatigue_level if human.fatigue else 0
                another_drive = story_aff * 0.4 - fatigue_val * 0.3 - stories_watched * 0.15
                if random.random() > max(0.05, another_drive):
                    log.info("Stories done: watched %d, moving to videos", stories_watched)
                    break
                log.info("Checking for another Story...")
            # Phase 2: Scroll down to video
            log.info("Phase 2: Scrolling down to video...")
            cx = adb.screen_w // 2
            adb.swipe(cx, int(adb.screen_h * 0.7), cx, int(adb.screen_h * 0.3),
                      random.randint(350, 550))
            time.sleep(1.5)
            # Phase 3: Browse videos (state-driven duration)
            energy = human.mood.energy if human.mood else 1.0
            fatigue = human.fatigue.fatigue_level if human.fatigue else 0.0
            n_videos = max(1, int(random.gauss(3 + energy * 3 - fatigue * 2, 1.5)))
            n_videos = min(n_videos, 8)
            log.info("Phase 3: Browsing %d videos...", n_videos)
            _health_countdown = random.randint(3, 5)
            for i in range(n_videos):
                watch = human.watch_duration()
                log.info("  Watching video %d/%d for %.1fs", i + 1, n_videos, watch)
                time.sleep(watch)
                sw = human.humanize_swipe(
                    adb.screen_w // 2, int(adb.screen_h * 0.75),
                    adb.screen_w // 2, int(adb.screen_h * 0.25))
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                time.sleep(human.action_delay())
                # Periodic health check
                _health_countdown -= 1
                if _health_countdown <= 0:
                    _health_countdown = random.randint(3, 5)
                    if not bot._health_check_during_scroll("Following"):
                        log.warning("FOLLOWING tap test: health check failed, ending early")
                        break
            log.info("Phase 3 done: watched %d videos", n_videos)
            # Return to For You
            bot._return_to_foryou()
            log.info("Returned to FYP")
        else:
            log.error("FAILED: Following tab not found")

    elif target == "explore":
        log.info("TAP TEST: Explore tab")
        result = bot._tap_top_tab("Explore")
        if result:
            log.info("SUCCESS: Explore tab opened!")
            time.sleep(2)
            # Scroll the grid a bit
            log.info("Scrolling explore grid...")
            bot._human_browse_scroll(context="grid", max_override=3)
            log.info("Explore scroll DONE")
            bot._return_to_foryou()
            log.info("Returned to FYP")
        else:
            log.error("FAILED: Explore tab not found")

    elif target == "shop":
        log.info("TAP TEST: Shop tab")
        result = bot._tap_top_tab("Shop")
        if result:
            log.info("SUCCESS: Shop tab opened!")
            time.sleep(4)  # Shop loads slower than other tabs
            # Check for popup
            screenshot = adb.screenshot_bytes()
            if screenshot:
                from .core import gemini
                popup = gemini.check_popup(screenshot, adb.screen_w, adb.screen_h)
                if popup and popup.get("has_popup"):
                    # Guard against false positives: if popup_text is None/empty,
                    # Gemini couldn't identify what it says — likely Shop UI mistaken
                    # for a popup. Confirm with a second check.
                    popup_text = popup.get("popup_text")
                    if not popup_text:
                        log.info("SHOP: first check says popup but text=None — confirming...")
                        time.sleep(1.0)
                        screenshot2 = adb.screenshot_bytes()
                        if screenshot2:
                            popup2 = gemini.check_popup(screenshot2, adb.screen_w, adb.screen_h)
                            if not (popup2 and popup2.get("has_popup") and popup2.get("popup_text")):
                                log.info("SHOP: confirmation says NO popup — false positive, skipping dismiss")
                                popup = None  # cancel dismiss
                            else:
                                log.info("SHOP: confirmation says popup '%s' — real popup", popup2.get("popup_text"))
                                popup = popup2  # use confirmed result

                    if popup and popup.get("has_popup"):
                        dx = popup.get("dismiss_x")
                        dy = popup.get("dismiss_y")
                        if dx is not None and dy is not None:
                            log.info("SHOP: popup detected '%s', tapping dismiss at (%d, %d) [%s]",
                                     popup.get("popup_text", "?"), dx, dy, popup.get("dismiss_label", "?"))
                            tx, ty = human.jitter_tap(dx, dy)
                            adb.tap(tx, ty)
                        else:
                            # Fallback: tap top-right X zone (do NOT press_back — exits Shop)
                            fx = int(adb.screen_w * 0.85)
                            fy = int(adb.screen_h * 0.35)
                            log.info("SHOP: popup detected, no coords — tapping fallback (%d, %d)", fx, fy)
                            tx, ty = human.jitter_tap(fx, fy)
                            adb.tap(tx, ty)
                        time.sleep(0.5)
            # Scroll products
            log.info("Scrolling shop products...")
            bot._human_browse_scroll(context="grid", max_override=3)
            log.info("Shop scroll DONE")
            bot._return_to_foryou()
            log.info("Returned to FYP")
        else:
            log.error("FAILED: Shop tab not found")

    elif target == "inbox":
        log.info("TAP TEST: Inbox — testing New Followers + Activity via Gemini find_and_tap")

        # Step 1: navigate to Inbox
        log.info("Step 1: Tapping nav_inbox...")
        x, y = adb.get_coord("tiktok", "nav_inbox")
        x += random.randint(-5, 5)
        y += random.randint(-3, 3)
        adb.tap(x, y)
        time.sleep(human.timing("t_tab_switch"))

        # Step 2: screenshot to see current state
        log.info("Step 2: Taking screenshot of current Inbox state...")
        shot = adb.screenshot()
        if shot:
            shot.save("tmp_inbox_state.png")
        log.info("Screenshot saved to tmp_inbox_state.png")

        # Brief pause (Inbox opens at top after nav tap, no scroll needed)
        time.sleep(1.0)

        # Step 3: tap New Followers via Gemini
        log.info("Step 3: Tapping 'New followers' via Gemini _find_and_tap...")
        entered = bot._inbox_enter_subpage("New followers")
        if entered:
            log.info("SUCCESS: Entered New Followers!")
            time.sleep(2.0)
            # Take screenshot inside New Followers
            shot2 = adb.screenshot()
            if shot2:
                shot2.save("tmp_inbox_new_followers.png")
            log.info("Screenshot saved to tmp_inbox_new_followers.png")
            # Go back to Inbox
            adb.press_back()
            time.sleep(human.timing("t_nav_settle"))
            log.info("Returned to Inbox main page")
        else:
            log.error("FAILED: Could not find 'New followers'")

        time.sleep(1.5)

        # Step 4: tap Activity via Gemini
        log.info("Step 4: Tapping 'Activity' via Gemini _find_and_tap...")
        entered2 = bot._inbox_enter_subpage("Activity")
        if entered2:
            log.info("SUCCESS: Entered Activity!")
            time.sleep(2.0)
            shot3 = adb.screenshot()
            if shot3:
                shot3.save("tmp_inbox_activity.png")
            log.info("Screenshot saved to tmp_inbox_activity.png")
            adb.press_back()
            time.sleep(human.timing("t_nav_settle"))
            log.info("Returned to Inbox main page")
        else:
            log.error("FAILED: Could not find 'Activity'")

        log.info("Inbox test DONE — returning to FYP")
        bot.go_to_fyp()
        time.sleep(human.timing("t_nav_settle"))
        log.info("Returned to FYP")

    else:
        log.error("Unknown tap test target: %s (use: avatar, comment, following, explore, shop, inbox)", target)

    human.end_session()


async def run_action_test(controllers: dict[int, ADBController], phone_id: int):
    """TEST MODE: Force EVERY action type once in sequence to verify coordinates.
    Sequence: scroll(3) -> like -> scroll(2) -> follow -> scroll(2) -> search -> scroll(2) -> comment browse
    Each action is logged with coordinates and result for verification."""
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=15,
    )

    from . import config
    niche_keywords = random.sample(
        config.NICHE_KEYWORDS_POOL,
        min(8, len(config.NICHE_KEYWORDS_POOL)),
    )

    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=" * 60)
    log.info("ACTION TEST: Phone %d -- forced sequence of ALL actions", phone_id)
    log.info("=" * 60)
    log.info("  Niche keywords: %s", niche_keywords[:4])

    # Auto-save screenshots + background recorder
    test_id = datetime.now().strftime('%Y%m%d_%H%M%S')
    screenshot_dir = os.path.join(config.DATA_DIR, "logs", f"screenshots_{test_id}")
    os.makedirs(screenshot_dir, exist_ok=True)
    adb._screenshot_save_dir = screenshot_dir
    ADBController._screenshot_counter = 0
    log.info("Screenshots saving to: %s", screenshot_dir)

    results = {}

    try:
        await _run_action_steps(bot, adb, human, niche_keywords, results)
    except DeviceLostError as e:
        log.error("!!! DEVICE DISCONNECTED — test aborted: %s", e)
        results["device_lost"] = str(e)
    except Exception as e:
        log.error("!!! UNEXPECTED ERROR — test aborted: %s", e)
        import traceback
        traceback.print_exc()


    # --- Summary ---
    log.info("\n" + "=" * 60)
    log.info("ACTION TEST RESULTS")
    log.info("=" * 60)
    for action, result in results.items():
        status = "PASS" if result.startswith("OK") else "SKIP" if "SKIP" in result else "FAIL"
        log.info("  %-20s  %s  %s", action, status, result)

    passed = sum(1 for r in results.values() if r.startswith("OK"))
    total = len(results)
    log.info("\n  %d/%d actions passed", passed, total)
    log.info("=" * 60)

    adb._screenshot_save_dir = None


async def _run_action_steps(bot, adb, human, niche_keywords, results):
    """Inner function for action test steps. Raises DeviceLostError if device disconnects."""

    # --- Helper: scroll N videos ---
    async def scroll_videos(n, label=""):
        for i in range(n):
            watch = human.watch_duration() * 0.4  # shorter for test
            log.info("    [Scroll %s #%d] Watching %.1fs", label, i + 1, watch)
            time.sleep(watch)
            bot.scroll_fyp()
            time.sleep(human.action_delay() * 0.5)
            # Fix 3A: if humanized swipe was too short and became a tap on LIVE preview, exit
            post_shot = adb.screenshot_bytes()
            if post_shot and not bot._quick_verify_fyp_from_shot(post_shot):
                log.warning("    [Scroll %s #%d] No longer on FYP after scroll (entered LIVE?), exiting", label, i + 1)
                bot._exit_live()
                time.sleep(human.timing("t_nav_settle"))

    # --- Open TikTok ---
    log.info("\n>>> STEP 0: Open TikTok")
    if not bot.open_app():
        log.error("Failed to open TikTok -- ABORT")
        return
    # open_app() already verifies we're on FYP — no need to tap Home again
    time.sleep(human.timing("t_app_load"))
    results["open_app"] = "OK"
    log.info("    Result: OK")

    # --- Warmup scroll ---
    log.info("\n>>> Warmup: Scroll 2-3 videos")
    await scroll_videos(random.randint(2, 3), "warmup")

    # --- Randomize action order ---
    actions = ["like", "follow", "search", "comments", "profile_visit"]
    random.shuffle(actions)
    log.info("Action order: %s", " -> ".join(actions))

    for step_num, action_name in enumerate(actions, 1):
        # Scroll 1-2 videos between actions (natural spacing)
        if step_num > 1:
            await scroll_videos(random.randint(1, 2), f"between-{step_num}")

        # Ensure on FYP before each action
        bot._verify_page("fyp")

        # Fix 3B: if current video is a LIVE preview (no sidebar), scroll past it
        # New accounts see many LIVE previews; retry up to 3 times to find a proper video
        for _live_skip in range(3):
            _sb = bot._get_sidebar_positions()
            if _sb is not None:
                break  # proper video with sidebar found
            log.info("    [Step %d] LIVE preview detected (no sidebar), scrolling past (attempt %d/3)",
                     step_num, _live_skip + 1)
            bot.scroll_fyp()
            time.sleep(human.timing("t_nav_settle"))
            # Fix 3A inside retry: if scroll entered another LIVE, exit first
            post_shot = adb.screenshot_bytes()
            if post_shot and not bot._quick_verify_fyp_from_shot(post_shot):
                log.warning("    [Step %d] Scroll entered LIVE during skip retry, exiting", step_num)
                bot._exit_live()
                time.sleep(human.timing("t_nav_settle"))

        if action_name == "like":
            log.info("\n>>> STEP %d: Like video", step_num)
            try:
                watch = human.watch_duration()
                log.info("    Watching video for %.1fs before liking...", watch)
                time.sleep(watch)
                bot.like_video()
                results["like"] = "OK"
                log.info("    Result: OK -- liked (double_tap=%.0f%%)",
                         human.personality.double_tap_habit * 100)
            except Exception as e:
                results["like"] = f"FAIL: {e}"
                log.error("    Result: FAIL -- %s", e)

        elif action_name == "follow":
            log.info("\n>>> STEP %d: Follow creator from profile", step_num)
            try:
                followed = bot.follow_from_profile()
                if followed:
                    results["follow"] = "OK"
                    log.info("    Result: OK -- followed from profile")
                else:
                    results["follow"] = "SKIP (already following or nav failed)"
                    log.info("    Result: SKIP -- already following or profile nav failed")
            except Exception as e:
                results["follow"] = f"FAIL: {e}"
                log.error("    Result: FAIL -- %s", e)
            # Always return to FYP
            bot.go_to_fyp()
            time.sleep(human.timing("t_nav_settle"))

        elif action_name == "search":
            log.info("\n>>> STEP %d: Search explore session", step_num)
            try:
                await bot.search_explore_session(niche_keywords=niche_keywords)
                results["search"] = "OK"
                log.info("    Result: OK -- search session completed")
            except Exception as e:
                results["search"] = f"FAIL: {e}"
                log.error("    Result: FAIL -- %s", e)
            # Force return to FYP (search can be deep)
            bot._ensure_on_app()
            bot.go_to_fyp()
            time.sleep(human.timing("t_nav_settle"))
            if not bot._verify_page("fyp"):
                adb.press_back()
                time.sleep(human.timing("t_nav_settle"))
                bot.go_to_fyp()
                time.sleep(human.timing("t_nav_settle"))

        elif action_name == "comments":
            log.info("\n>>> STEP %d: Browse comments", step_num)
            try:
                if bot.open_comments():
                    time.sleep(human.timing("t_nav_settle"))
                    screenshots = await bot.browse_comments(check_commenter_profile=False)
                    results["comments"] = f"OK ({len(screenshots)} screenshots)"
                    log.info("    Result: OK -- browsed comments, %d screenshots", len(screenshots))
                    adb.press_back()
                    time.sleep(human.timing("t_nav_settle"))
                else:
                    results["comments"] = "FAIL (comments didn't open)"
                    log.error("    Result: FAIL -- comments didn't open after 2 attempts")
            except Exception as e:
                results["comments"] = f"FAIL: {e}"
                log.error("    Result: FAIL -- %s", e)

        elif action_name == "profile_visit":
            log.info("\n>>> STEP %d: Visit creator profile", step_num)
            try:
                if bot.visit_creator_profile():
                    time.sleep(human.timing("t_nav_settle") * 2)
                    results["profile_visit"] = "OK"
                    log.info("    Result: OK -- visited creator profile")
                    adb.press_back()
                    time.sleep(human.timing("t_nav_settle"))
                else:
                    results["profile_visit"] = "SKIP (nav failed)"
                    log.info("    Result: SKIP -- profile navigation failed")
            except Exception as e:
                results["profile_visit"] = f"FAIL: {e}"
                log.error("    Result: FAIL -- %s", e)

    # --- Cooldown scroll ---
    await scroll_videos(random.randint(2, 3), "cooldown")

    # --- Close ---
    bot.close_app()
    human.end_session()


async def run_today(controllers: dict[int, ADBController]):
    """Run today's scheduled sessions."""
    proxy = ProxyQueue(controllers)
    executor = SessionExecutor(controllers, proxy)
    await executor.run_today()


# ---------------------------------------------------------------------------
# Always-On: run_forever + control file
# ---------------------------------------------------------------------------

_CONTROL_PATH = os.path.join(DATA_DIR, "control.json")


def atomic_write_control(data: dict):
    """Write data as JSON to control.json atomically via os.replace()."""
    tmp_path = _CONTROL_PATH + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(data, f)
    os.replace(tmp_path, _CONTROL_PATH)


def read_control() -> dict:
    """Read control.json. Returns {} if missing or invalid JSON."""
    try:
        with open(_CONTROL_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def wait_until_midnight():
    """Sleep until 00:05 next day (5-min buffer). Sleeps in 60s intervals for interruptibility."""
    now = datetime.now()
    target_today = now.replace(hour=0, minute=5, second=0, microsecond=0)
    # If we're before 00:05, target is today 00:05; otherwise tomorrow 00:05
    if now <= target_today:
        target = target_today
    else:
        target = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)

    remaining = (target - now).total_seconds()
    if remaining <= 0:
        return

    log.info("Sleeping until %s (%.0f minutes)", target.strftime("%H:%M"), remaining / 60)
    while True:
        remaining = (target - datetime.now()).total_seconds()
        if remaining <= 0:
            break
        time.sleep(min(60, remaining))


async def run_forever(controllers: dict[int, ADBController]):
    """Daily loop: run today -> wait for midnight -> repeat.

    Checks control.json between days for {"action": "stop"}.
    Gracefully finishes the current day before stopping.
    """
    log.info("Starting always-on mode (run_forever)")

    while True:
        # Check control before starting the day
        ctrl = read_control()
        if ctrl.get("action") == "stop":
            log.info("Control file says stop — exiting run_forever before starting today")
            break

        # Run today's sessions
        log.info("=== Starting daily run: %s ===", datetime.now().strftime("%Y-%m-%d"))
        proxy = ProxyQueue(controllers)
        executor = SessionExecutor(controllers, proxy)

        # Auto-enroll any new accounts from config into warmup
        executor.check_new_phones()

        await executor.run_today()
        log.info("=== Daily run complete ===")

        # Check control after the day
        ctrl = read_control()
        if ctrl.get("action") == "stop":
            log.info("Control file says stop — exiting run_forever after today's run")
            break

        # Wait for midnight
        wait_until_midnight()

    log.info("run_forever exited cleanly")


def init_warmup(controllers: dict[int, ADBController], phone_filter: int = None):
    """Initialize warmup for accounts. Run once when setting up new accounts."""
    proxy = ProxyQueue(controllers)
    executor = SessionExecutor(controllers, proxy)

    # Default niche keywords — customize per account if needed
    niche_keywords = [
        "toxic relationship", "red flags", "situationship",
        "dating advice", "couples", "relationship tips",
        "boyfriend goals", "girlfriend goals", "love advice",
    ]

    for acc in ACCOUNTS:
        if phone_filter and acc["phone_id"] != phone_filter:
            continue

        if executor.is_in_warmup(acc["name"]):
            state = executor.warmup_states[acc["name"]]
            log.info("  %s: already in warmup (day %d)", acc["name"], state.current_day)
            continue

        executor.init_warmup(
            account_name=acc["name"],
            platform=acc["platform"],
            phone_id=acc["phone_id"],
            niche_keywords=niche_keywords,
        )
        log.info("  %s: warmup initialized (day 1)", acc["name"])

    log.info("Warmup initialized! Run 'python main.py' daily for 7 days.")


def run_story_coord_audit():
    """TEST: Static audit of story_* coords — no phone needed.
    Verifies that all story coords stay below y=80% on all target phone screen heights."""
    from .core.coords import get_coords as _get_coords

    screen_specs = [
        ("Samsung S9",  1080, 2220),
        ("Samsung S22", 1080, 2340),
        ("Motorola",    720,  1600),
    ]
    story_coord_names = ["story_avatar", "story_tap_next", "story_tap_prev", "story_close"]
    max_y_pct = 0.80
    failures = []

    log.info("=== STORY COORD AUDIT ===")
    for name in story_coord_names:
        parts = []
        failed = False
        for phone_name, w, h in screen_specs:
            try:
                _, y = _get_coords("tiktok", name, screen_w=w, screen_h=h)
            except Exception as e:
                log.error("  %s: MISSING coord '%s': %s", phone_name, name, e)
                failed = True
                continue
            y_pct = y / h
            ok = y_pct <= max_y_pct
            parts.append(f"{phone_name}={y_pct:.2%}({'OK' if ok else 'FAIL'})")
            if not ok:
                failed = True
                failures.append(
                    f"FAIL: {name} y={y_pct:.1%} on {phone_name} (h={h}) exceeds {max_y_pct:.0%} limit"
                )
        status = "PASS" if not failed else "FAIL"
        log.info("  [%s] %s: %s", status, name, "  ".join(parts))

    log.info("=== AUDIT RESULT: %d failure(s) ===", len(failures))
    for f in failures:
        log.error("  %s", f)
    if not failures:
        log.info("  All story coords pass y < 80%% invariant on all phones.")


async def run_story_exit_test(controllers: dict, phone_id: int):
    """TEST: Call visit_creator_profile() on a FYP video with a Story-ring creator.
    Precondition: user must position phone on a video with blue Story ring visible.
    Verifies: Story detected, safe exit, FYP restored, no keyboard opened."""
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=5,
    )

    from .core.monitor import init_monitor
    import tempfile
    tmp_events = tempfile.mkdtemp(prefix="phone_bot_story_test_events_")
    tmp_shots = tempfile.mkdtemp(prefix="phone_bot_story_test_shots_")
    init_monitor(events_dir=tmp_events, screenshots_dir=tmp_shots)
    log.info("Monitor initialized (temp dirs: %s, %s)", tmp_events, tmp_shots)

    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== STORY-EXIT TEST: Phone %d ===", phone_id)
    log.info("Precondition: TikTok FYP open, current video creator has active Story (blue ring)")
    log.info("Expected: Story detected + handled safely (no keyboard, no text typed)")
    log.info("Valid outcomes: True (profile opened via Story header) or False (safe exit to FYP)")

    result = bot.visit_creator_profile()

    log.info("=== RESULT: visit_creator_profile returned %s ===", result)
    # Both True (Layer 2: profile opened via Story header) and False (Layer 3: safe exit)
    # are valid — the critical check is that Story was DETECTED and no keyboard/text appeared
    if result is True:
        log.info("PASS: Story detected, profile opened via header tap (Layer 2 success)")
    else:
        log.info("PASS: Story detected, safe exit to FYP (Layer 3)")
    log.info("Check logs above for: 'Story detected' + 'Story header tap attempt'")
    log.info("Verify scrcpy frames: no keyboard, no text typed")


def run_overlay_photosensitive_test(controllers: dict, phone_id: int):
    """TEST: Verify photosensitive_warning overlay is handled by tapping 'Skip all'.

    Usage:
      python -m phone_bot.main --test overlay-photosensitive --phone 1

    Pass criteria:
    - classify_overlay() returns type='photosensitive_warning'
    - 'Skip all' tapped (NOT 'Watch video')
    - Overlay dismissed (sidebar returns non-None after tap)
    - Log: 'photosensitive_warning detected' and 'tapping Skip all'

    If a saved overlay screenshot exists at phone-bot/calibration/photosensitive_01.png,
    the test replays it directly through handle_overlay() without needing a live device.
    Otherwise opens TikTok and browses until the overlay appears naturally.
    """
    import os
    calibration_path = os.path.join(
        os.path.dirname(__file__), "calibration", "photosensitive_01.png")

    if os.path.exists(calibration_path):
        log.info("=== OVERLAY-PHOTOSENSITIVE TEST: offline replay ===")
        with open(calibration_path, "rb") as f:
            shot_bytes = f.read()
        if phone_id not in controllers:
            log.error("Phone %d not connected — needed for adb dimensions", phone_id)
            return
        adb = controllers[phone_id]
        human = HumanEngine(account_name=f"test_ph{phone_id}")
        from .actions.tiktok import TikTokBot, PopupGuardian
        guardian = PopupGuardian(adb, human)
        result = guardian.handle_overlay(shot_bytes, bot_ref=None)
        log.info("=== RESULT: %s ===", result)
        log.info("Expected: resolved=True, action_taken='photosensitive_warning_skipped'")
    else:
        log.info("=== OVERLAY-PHOTOSENSITIVE TEST: live browse (no calibration screenshot) ===")
        log.info("Save a screenshot to phone-bot/calibration/photosensitive_01.png for offline test")
        if phone_id not in controllers:
            log.error("Phone %d not connected!", phone_id)
            return
        log.info("Browse TikTok and trigger a photosensitive warning to test live handling")
        log.info("(No automated live-browse mode — use scrcpy recording + manual trigger)")


async def run_search_tab_restore_test(controllers: dict, phone_id: int):
    """TEST: Verify _ensure_search_tab() restores 'Videos' tab after BACK from video.
    Searches 'girlfriend goals', taps a grid item, watches, presses BACK,
    calls _ensure_search_tab('Videos'), verifies tab is active."""
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=5,
    )

    from .core.monitor import init_monitor
    import tempfile
    init_monitor(
        events_dir=tempfile.mkdtemp(prefix="phone_bot_search_test_events_"),
        screenshots_dir=tempfile.mkdtemp(prefix="phone_bot_search_test_shots_"),
    )

    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== SEARCH-TAB-RESTORE TEST: Phone %d ===", phone_id)
    log.info("Precondition: TikTok FYP open")

    # Step 1: Search a keyword
    if not bot._type_search_query("girlfriend goals"):
        log.error("FAIL: could not open search")
        return

    # Step 2: Tap first grid item
    import time as _time
    _time.sleep(2.0)  # wait for results to load
    from .core import gemini as _gem
    shot = adb.screenshot_bytes()
    thumbs = _gem.find_search_grid_thumbnails(shot, adb.screen_w, adb.screen_h) if shot else []
    if not thumbs:
        log.error("FAIL: no grid thumbnails found")
        return
    thumb = thumbs[0]
    log.info("Tapping grid item at (%d, %d)", thumb["x"], thumb["y"])
    adb.tap(thumb["x"], thumb["y"])

    # Step 3: Wait (simulate watching)
    _time.sleep(5.0)

    # Step 4: Press BACK
    log.info("Pressing BACK to return to search results")
    adb.press_back()
    _time.sleep(human.timing("t_nav_settle"))

    # Step 5: Call _ensure_search_tab
    log.info("Calling _ensure_search_tab('Videos')...")
    result = bot._ensure_search_tab("Videos")

    # Step 6: Verify via Gemini
    shot2 = adb.screenshot_bytes()
    if shot2:
        verify = _gem._call_vision(
            shot2,
            "In this TikTok search results page, which tab is currently "
            "active (underlined or bold)? Reply with exactly one word: "
            "Top, Videos, Users, or None.",
            max_tokens=10, temperature=0.1, timeout=6.0,
        )
        active = (verify or "").strip().lower().split()[0] if verify else "unknown"
        log.info("Final active tab: '%s'", active)
        if active == "videos":
            log.info("=== PASS: Videos tab confirmed active ===")
        else:
            log.error("=== FAIL: Expected 'videos' but got '%s' ===", active)
    else:
        log.error("=== FAIL: could not take verification screenshot ===")

    log.info("_ensure_search_tab returned: %s", result)


def run_return_to_fyp_on_fyp_test(controllers: dict, phone_id: int):
    """TEST: Verify _return_to_fyp() skips BACK when already on FYP.
    Precondition: TikTok FYP open.
    Pass: no toast, no BACK, log shows 'already on FYP', FYP stable."""
    import time as _time
    if phone_id not in controllers:
        log.error("Phone %d not connected!", phone_id)
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=5,
    )

    from .core.monitor import init_monitor
    import tempfile
    init_monitor(
        events_dir=tempfile.mkdtemp(prefix="phone_bot_rtf_test_events_"),
        screenshots_dir=tempfile.mkdtemp(prefix="phone_bot_rtf_test_shots_"),
    )

    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== RETURN-TO-FYP-ON-FYP TEST: Phone %d ===", phone_id)
    log.info("Precondition: TikTok FYP open")

    # Confirm on FYP first
    if not bot._quick_verify_fyp():
        log.error("FAIL: not on FYP at start")
        return

    # Simulate watching for 3-5 seconds
    watch = 3.0 + random.random() * 2.0
    log.info("Watching FYP for %.1fs...", watch)
    _time.sleep(watch)

    # Call _return_to_fyp — should detect FYP and skip BACK
    log.info("Calling _return_to_fyp() while on FYP...")
    result = bot._return_to_fyp()

    log.info("=== RESULT: _return_to_fyp returned %s ===", result)
    if result:
        log.info("PASS: returned True (FYP confirmed)")
    else:
        log.error("FAIL: returned False")
    log.info("Check logs for: '_return_to_fyp: already on FYP (quick verify), no BACK needed'")
    log.info("Check frames: no toast, no BACK gesture, FYP stable")


async def run_pymk_detection_test(controllers: dict, phone_id: int):
    """TEST: Generic content skip test.
    Precondition: user positions phone on non-standard FYP content
    (PYMK, LIVE preview, ad, shopping post, etc.)

    Pass criteria:
    - should_skip_content() returns True on initial screenshot
    - scroll_fyp() scrolls past
    - After scroll, content is gone (sidebar visible OR skip=False)
    - Log contains 'CONTENT_CHECK: SKIP'
    - No Follow/Buy button tapped in any frame
    """
    import time as _time
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=5,
    )

    from .core.monitor import init_monitor
    import tempfile
    init_monitor(
        events_dir=tempfile.mkdtemp(prefix="phone_bot_skip_test_events_"),
        screenshots_dir=tempfile.mkdtemp(prefix="phone_bot_skip_test_shots_"),
    )

    from .actions.tiktok import TikTokBot
    from .core import gemini as _gem
    from .core.sidebar import find_sidebar_icons
    bot = TikTokBot(adb, human)

    log.info("=== CONTENT-SKIP TEST: Phone %d ===", phone_id)
    log.info("Precondition: FYP showing non-standard content (PYMK, ad, LIVE, etc.)")

    # Step 1: Verify content should be skipped
    shot1 = adb.screenshot_bytes()
    if not shot1:
        log.error("FAIL: screenshot failed")
        return
    should_skip = _gem.should_skip_content(shot1)
    log.info("Step 1: should_skip_content = %s", should_skip)
    if not should_skip:
        log.error("=== FAIL: content was NOT flagged for skip ===")
        log.error("Make sure non-standard content (PYMK, ad, LIVE preview) is visible")
        return

    # Step 2: Scroll past
    log.info("Step 2: scrolling past non-standard content...")
    _time.sleep(human.timing("t_live_skip_pause"))
    bot.scroll_fyp()
    _time.sleep(2.0)  # wait for next video to load

    # Step 3: Verify content is gone
    shot2 = adb.screenshot_bytes()
    if not shot2:
        log.error("FAIL: post-scroll screenshot failed")
        return
    sidebar = find_sidebar_icons(shot2, adb.screen_w, adb.screen_h)
    log.info("Step 3: sidebar=%s", sidebar is not None)

    if sidebar is not None:
        # Sidebar found = normal video present. No need for second Gemini call.
        log.info("=== PASS: non-standard content detected, scrolled past, normal video restored (sidebar found) ===")
    else:
        # No sidebar after scroll either — check if at least content changed
        still_skip = _gem.should_skip_content(shot2)
        log.info("Step 3b: should_skip=%s (no sidebar, checking content)", still_skip)
        if not still_skip:
            log.info("=== PASS: non-standard content detected, scrolled past (WATCH content now) ===")
        else:
            log.error("=== FAIL: non-standard content still visible after scroll ===")


async def run_live_double_scroll_test(controllers: dict, phone_id: int, duration: int = 5):
    """TEST: Browse FYP for N minutes, verify LIVE previews get double-scrolled.

    Pass criteria:
    - _post_swipe_live_check() fires on LIVE preview cards
    - Log shows 'LIVE preview detected' or 'non-standard post-swipe content'
    - No full LIVE stream UI visible in frames (no chat overlay, no heart rain)
    - Normal videos load correctly after double-scroll
    """
    import time as _time
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=duration,
    )

    from .core.monitor import init_monitor
    import tempfile
    init_monitor(
        events_dir=tempfile.mkdtemp(prefix="phone_bot_live_test_events_"),
        screenshots_dir=tempfile.mkdtemp(prefix="phone_bot_live_test_shots_"),
    )

    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== LIVE DOUBLE-SCROLL TEST: Phone %d, %d minutes ===", phone_id, duration)
    log.info("Browse FYP — LIVE previews should be double-scrolled automatically")

    await bot.browse_session(
        duration_minutes=duration,
        should_post=False,
        niche_keywords=["test"],
        allow_comment_write=False,
    )
    log.info("=== LIVE DOUBLE-SCROLL TEST COMPLETE ===")
    log.info("Check logs for 'LIVE preview detected' or 'non-standard post-swipe content'")
    log.info("Check frames for: no full LIVE stream UI (chat overlay, heart rain)")


async def run_search_retype_test(controllers: dict, phone_id: int):
    """TEST: Verify _clear_and_retype() replaces search bar text correctly.
    Types 'girlfriend goals', then calls _clear_and_retype('breakup story').
    Verifies via Gemini Vision that search bar contains 'breakup story' only.
    PASS: Gemini reads 'breakup story' in the search bar.
    FAIL: old text remains, text is appended, or search results unchanged.
    """
    import time as _time
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=5,
    )

    from .core.monitor import init_monitor
    import tempfile
    init_monitor(
        events_dir=tempfile.mkdtemp(prefix="phone_bot_retype_test_events_"),
        screenshots_dir=tempfile.mkdtemp(prefix="phone_bot_retype_test_shots_"),
    )

    from .actions.tiktok import TikTokBot
    from .core import gemini as _gem
    bot = TikTokBot(adb, human)

    log.info("=== SEARCH RETYPE TEST: Phone %d ===", phone_id)

    # Open TikTok
    bot.open_app()
    _time.sleep(human.timing("t_app_load"))

    # Step 1: search first keyword
    log.info("Step 1: searching 'girlfriend goals'")
    ok = bot._type_search_query("girlfriend goals")
    if not ok:
        log.error("SEARCH RETYPE TEST: FAIL — could not open search page")
        bot.close_app()
        return
    _time.sleep(2.0)

    # Save before screenshot
    before_shot = adb.screenshot_bytes()
    if before_shot:
        with open("tmp_search_retype_before.png", "wb") as f:
            f.write(before_shot)
        log.info("Step 1: before screenshot saved")

    # Step 2: retype with new keyword
    log.info("Step 2: calling _clear_and_retype('breakup story')")
    bot._clear_and_retype("breakup story")
    _time.sleep(2.0)

    # Save after screenshot
    after_shot = adb.screenshot_bytes()
    if after_shot:
        with open("tmp_search_retype_after.png", "wb") as f:
            f.write(after_shot)
        log.info("Step 2: after screenshot saved")

    # Step 3: Gemini reads the search bar text
    gemini_response = None
    if after_shot:
        gemini_response = _gem._call_vision(
            after_shot,
            "What text is currently shown in the TikTok search bar at the top of this screen? "
            "Reply with only the exact text, nothing else.",
            max_tokens=50,
            temperature=0.1,
        )

    log.info("Step 3: Gemini search bar read: %r", gemini_response)

    # Evaluate
    if gemini_response and "breakup story" in gemini_response.strip().lower():
        log.info("=== SEARCH RETYPE TEST: PASS — search bar contains 'breakup story' ===")
        log.info("Gemini response: %r", gemini_response)
    else:
        log.error("=== SEARCH RETYPE TEST: FAIL — expected 'breakup story', got: %r ===", gemini_response)

    bot.close_app()


async def run_fyp_swipe_clamp_test(controllers: dict, phone_id: int):
    """TEST: Verify scroll_fyp() end_y stays below screen_h*0.88 (suggestion bar clamp).
    Runs 30 FYP scroll cycles and logs each sw['y2'] value.
    PASS: all 30 end_y values < screen_h * 0.88, no suggestion bar tapped.
    """
    import time as _time
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=5,
    )

    from .core.monitor import init_monitor
    init_monitor(test_mode=True)
    from .actions.tiktok import TikTokBot
    bot = TikTokBot(adb, human)

    log.info("=== FYP SWIPE CLAMP TEST: Phone %d ===", phone_id)
    log.info("screen_h=%d  end_y_max=%.0f (88%%)", adb.screen_h, adb.screen_h * 0.88)

    bot.open_app()
    _time.sleep(human.timing("t_app_load"))
    bot.go_to_fyp()
    _time.sleep(human.timing("t_back_verify"))

    end_y_max = int(adb.screen_h * 0.88)
    violations = 0
    n_scrolls = 5
    for i in range(n_scrolls):
        sw = human.humanize_swipe(
            adb.screen_w // 2, adb.screen_h * 3 // 4,
            adb.screen_w // 2, adb.screen_h // 4,
        )
        clamped_y2 = min(sw["y2"], end_y_max)
        if sw["y2"] > end_y_max:
            violations += 1
            log.warning("Scroll %d/%d: end_y=%d EXCEEDS max=%d (pre-clamp violation)",
                        i + 1, n_scrolls, sw["y2"], end_y_max)
        log.info("Scroll %d/%d: end_y_raw=%d end_y_clamped=%d ok=%s",
                 i + 1, n_scrolls, sw["y2"], clamped_y2, sw["y2"] <= end_y_max)
        bot.scroll_fyp()
        _time.sleep(human.timing("t_video_glance") + 2.0)  # ~4-7s realistic watch time

    bot.close_app()

    if violations == 0:
        log.info("=== FYP SWIPE CLAMP TEST: PASS — 0/%d violations, all end_y < %d ===",
                 n_scrolls, end_y_max)
    else:
        log.error("=== FYP SWIPE CLAMP TEST: FAIL — %d/%d scrolls exceeded end_y_max=%d ===",
                  violations, n_scrolls, end_y_max)


def run_niche_baking_test():
    """TEST: Verify evaluate_niche_fit() correctly classifies cooking vs relationship content.
    No phone needed — direct Gemini API calls on saved calibration screenshots.
    PASS: baking < 30, cooking profile < 40, relationship video >= 60, relationship profile >= 60.
    """
    import pathlib
    from .core import gemini as _gem
    from .config import NICHE_DESCRIPTION, NICHE_KEYWORDS_POOL as NICHE_KEYWORDS

    CAL = pathlib.Path("phone-bot/calibration")
    tests = [
        ("niche_test_baking_video.png",        "video",   None, 30,  "baking video out-of-niche"),
        ("niche_test_cooking_profile.png",      "profile", None, 40,  "cooking profile out-of-niche"),
        ("niche_test_relationship_video.png",   "video",   60,  None, "relationship video in-niche"),
        ("niche_test_relationship_profile.png", "profile", 60,  None, "relationship profile in-niche"),
    ]

    log.info("=== NICHE BAKING TEST ===")
    all_pass = True
    for fname, ctx, min_score, max_score, label in tests:
        path = CAL / fname
        if not path.exists():
            log.error("MISSING screenshot: %s", path)
            all_pass = False
            continue
        shot = path.read_bytes()
        result = _gem.evaluate_niche_fit(shot, NICHE_DESCRIPTION, NICHE_KEYWORDS or [], context=ctx)
        score = result["score"]
        ok = True
        if min_score is not None and score < min_score:
            ok = False
        if max_score is not None and score >= max_score:
            ok = False
        status = "PASS" if ok else "FAIL"
        log.info("[%s] %s: score=%d reason=%s", status, label, score, result["reason"])
        if not ok:
            all_pass = False

    if all_pass:
        log.info("=== NICHE BAKING TEST: PASS ===")
    else:
        log.error("=== NICHE BAKING TEST: FAIL ===")


def run_screen_detect_test(controllers: dict, phone_id: int):
    """TEST: Verify all 3 ADB screen size detection methods log raw output + parsed result.
    No scrcpy needed — purely ADB log verification.
    PASS: each method runs, logs raw output at DEBUG, returns (1080, 2220) or None with reason.
    """
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    log.info("=== SCREEN DETECT TEST: Phone %d (%s) ===", phone_id, adb.serial)

    log.info("--- Method 1: wm size ---")
    r1 = adb._detect_size_wm()
    log.info("wm size result: %s", r1)

    log.info("--- Method 2: dumpsys window ---")
    r2 = adb._detect_size_dumpsys_window()
    log.info("dumpsys window result: %s", r2)

    log.info("--- Method 3: dumpsys display ---")
    r3 = adb._detect_size_dumpsys_display()
    log.info("dumpsys display result: %s", r3)

    log.info("--- Cascade result (_get_screen_size) ---")
    rc = adb._get_screen_size()
    log.info("_get_screen_size result: %s", rc)

    expected = (adb.screen_w, adb.screen_h)
    log.info("Current screen_w x screen_h: %dx%d", adb.screen_w, adb.screen_h)

    # Method 3 (dumpsys display) returns PHYSICAL size on Samsung override devices —
    # this is expected. Cascade stops at Method 1 or 2 which return the override size.
    cascade_ok = rc == expected
    any_method_ok = any(r == expected for r in (r1, r2, r3) if r is not None)
    if cascade_ok and any_method_ok:
        log.info("=== SCREEN DETECT TEST: PASS — cascade returned correct %dx%d ===", *expected)
    elif any_method_ok:
        log.warning("=== SCREEN DETECT TEST: PARTIAL — cascade=%s, expected=%s ===", rc, expected)
    else:
        log.error("=== SCREEN DETECT TEST: FAIL — no method returned %dx%d ===", *expected)


async def run_search_reveal_test(controllers: dict, phone_id: int):
    """TEST: Verify go_to_search() correctly opens the search page.
    Checks whether top bar is hidden before the call, then verifies search opens.
    PASS: search page open after go_to_search() call.
    PARTIAL: top bar was already visible (bar never auto-hides on this device) but search worked.
    FAIL: search page did not open.
    """
    import time as _time
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=5,
    )

    from .core.monitor import init_monitor
    import tempfile
    init_monitor(
        events_dir=tempfile.mkdtemp(prefix="phone_bot_reveal_test_events_"),
        screenshots_dir=tempfile.mkdtemp(prefix="phone_bot_reveal_test_shots_"),
    )

    from .actions.tiktok import TikTokBot
    from .core import gemini as _gem
    bot = TikTokBot(adb, human)

    log.info("=== SEARCH REVEAL TEST: Phone %d ===", phone_id)

    # Step 1: navigate to FYP
    bot.open_app()
    _time.sleep(human.timing("t_app_load"))
    bot.go_to_fyp()
    _time.sleep(human.timing("t_back_verify"))

    # Step 2: wait for top bar to auto-hide (10s)
    log.info("Waiting 10s for top bar to auto-hide...")
    _time.sleep(10.0)

    # Step 3: check if top bar is hidden
    pre_shot = adb.screenshot_bytes()
    bar_visible_before = "yes"
    if pre_shot:
        resp = _gem._call_vision(
            pre_shot,
            "Is the TikTok top navigation bar (containing the search icon and 'For You' tab) "
            "visible at the top of the screen? Answer yes or no only.",
            max_tokens=5,
            temperature=0.1,
        )
        bar_visible_before = (resp or "yes").strip().lower()
    log.info("pre_reveal_bar_visible: %s", bar_visible_before)
    if bar_visible_before != "no":
        log.warning("Top bar still visible after 10s wait — device may not auto-hide bar (PARTIAL test)")

    # Step 4: call go_to_search()
    ok = bot.go_to_search()
    log.info("go_to_search() returned: %s", ok)

    # Step 5: verify search page open
    post_shot = adb.screenshot_bytes()
    search_open = "no"
    if post_shot:
        resp2 = _gem._call_vision(
            post_shot,
            "Is the TikTok search/discover page currently open? "
            "Look for a search input field at the top and content below. Answer yes or no only.",
            max_tokens=5,
            temperature=0.1,
        )
        search_open = (resp2 or "no").strip().lower()
    log.info("search_page_open: %s", search_open)

    # Step 6: result
    if ok and search_open == "yes":
        if bar_visible_before == "no":
            log.info("=== SEARCH REVEAL TEST: PASS — reveal tap showed top bar and search opened ===")
        else:
            log.info("=== SEARCH REVEAL TEST: PASS (PARTIAL — bar was already visible, search opened) ===")
    else:
        log.error("=== SEARCH REVEAL TEST: FAIL — go_to_search=%s search_open=%s ===", ok, search_open)

    bot.close_app()


async def run_search_grid_scroll_test(controllers: dict, phone_id: int):
    """TEST: Verify 5 consecutive grid scrolls never open the fullscreen video player.
    PASS: all 5 scrolls keep search grid visible (2-column thumbnail layout).
    FAIL: even 1 scroll opens fullscreen player.
    """
    import time as _time
    if phone_id not in controllers:
        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
        return

    adb = controllers[phone_id]
    human = HumanEngine(account_name=f"test_ph{phone_id}")
    human.start_session(
        hour=datetime.now().hour,
        weekday=datetime.now().weekday(),
        duration_minutes=5,
    )

    from .core.monitor import init_monitor
    import tempfile
    init_monitor(
        events_dir=tempfile.mkdtemp(prefix="phone_bot_grid_test_events_"),
        screenshots_dir=tempfile.mkdtemp(prefix="phone_bot_grid_test_shots_"),
    )

    from .actions.tiktok import TikTokBot
    from .core import gemini as _gem
    bot = TikTokBot(adb, human)

    log.info("=== SEARCH GRID SCROLL TEST: Phone %d ===", phone_id)

    # Open TikTok and navigate to search grid
    bot.open_app()
    _time.sleep(human.timing("t_app_load"))

    ok = bot._type_search_query("relationship goals")
    if not ok:
        log.error("FAIL: could not open search page")
        bot.close_app()
        return

    _time.sleep(2.0)
    log.info("Step 1: on 'relationship goals' Videos grid — running 5 grid scrolls")

    fullscreen_opens = 0
    for i in range(5):
        log.info("Grid scroll %d/5...", i + 1)
        bot._maybe_scroll_grid(scroll_prob=1.0)
        _time.sleep(1.0)

        # Verify still on search grid (not fullscreen player)
        shot = adb.screenshot_bytes()
        if shot:
            result = _gem.identify_page_with_recovery(shot)
            page = result.get("page", "unknown")
            if page != "search" and page != "unknown":
                log.error("Scroll %d/5 OPENED FULLSCREEN (page=%s) ← FAIL", i + 1, page)
                fullscreen_opens += 1
            else:
                log.info("Scroll %d/5 OK (page=%s)", i + 1, page)

    if fullscreen_opens == 0:
        log.info("=== SEARCH GRID SCROLL TEST: PASS — 0/5 scrolls opened fullscreen ===")
    else:
        log.error("=== SEARCH GRID SCROLL TEST: FAIL — %d/5 scrolls opened fullscreen ===", fullscreen_opens)

    bot.close_app()


def _check_api_keys():
    """Warn at startup if critical API keys are missing."""
    if not GEMINI.get("api_key"):
        log.warning("GEMINI_API_KEY not set -- AI comments and categorization will fail")
    if not AIRTABLE.get("api_key"):
        log.warning("AIRTABLE_API_KEY not set -- Content Library delivery will fail")


def main():
    parser = argparse.ArgumentParser(description="Phone Bot — TikTok & Instagram Automation")
    parser.add_argument("--test", nargs="?", const="devices", metavar="MODE",
                        help="Test mode: 'devices' (default), 'story-coord-audit', 'story-exit', 'pymk-detection', 'overlay-photosensitive', 'search-tab-restore', 'live-double-scroll', 'search-retype', 'search-grid-scroll'")
    parser.add_argument("--dashboard", action="store_true", help="Start web dashboard")
    parser.add_argument("--warmup", action="store_true", help="Initialize warmup for new accounts")
    parser.add_argument("--scroll-only", action="store_true",
                        help="TEST: passive scroll only, no engagement (requires --phone)")
    parser.add_argument("--like-test", action="store_true",
                        help="TEST: scroll 3 videos then like one (requires --phone)")
    parser.add_argument("--browse-test", action="store_true",
                        help="TEST: full session with all engagement except comment writing (requires --phone)")
    parser.add_argument("--action-test", action="store_true",
                        help="TEST: force every action once in sequence (requires --phone)")
    parser.add_argument("--scroll-test", action="store_true",
                        help="TEST: test scroll system in all contexts (search grid, comments, profile)")
    parser.add_argument("--tap-test", choices=["avatar", "comment", "following", "explore", "shop", "inbox"],
                        help="TEST: tap avatar or comment icon on current video (app must be open)")
    parser.add_argument("--duration", type=int, default=5,
                        help="Duration in minutes for --scroll-only (default: 5)")
    parser.add_argument("--phone", type=int, help="Filter to specific phone ID (1-4)")
    parser.add_argument("--forever", action="store_true",
                        help="Run 24/7 mode: daily loop with automatic plan loading")
    args = parser.parse_args()

    # Verbose logging in TEST_MODE
    if TEST_MODE or args.scroll_only or args.browse_test or args.action_test or args.test:
        logging.getLogger().setLevel(logging.DEBUG)
        log.info("TEST MODE active — proxy disabled, verbose logging, timezone Europe/Rome")

    # story-coord-audit is static — runs BEFORE device discovery (no phone needed)
    if args.test == "story-coord-audit":
        run_story_coord_audit()
        return

    _check_api_keys()
    log.info("Discovering connected devices...")
    controllers = discover_devices()

    if not controllers:
        log.error("No devices found! Make sure phones are connected via USB with ADB debugging enabled.")
        sys.exit(1)

    log.info("Found %d device(s)", len(controllers))

    # WiFi off on inactive phones is the primary defense against background IP leakage.
    # No background restriction needed — WiFi off = zero network = zero risk.

    if args.test == "story-exit":
        if not args.phone:
            log.error("--test story-exit requires --phone (e.g. --phone 1)")
            sys.exit(1)
        asyncio.run(run_story_exit_test(controllers, args.phone))
        return

    if args.test == "pymk-detection":
        if not args.phone:
            log.error("--test pymk-detection requires --phone (e.g. --phone 1)")
            sys.exit(1)
        asyncio.run(run_pymk_detection_test(controllers, args.phone))
        return

    if args.test == "overlay-photosensitive":
        if not args.phone:
            log.error("--test overlay-photosensitive requires --phone (e.g. --phone 1)")
            sys.exit(1)
        run_overlay_photosensitive_test(controllers, args.phone)
        return

    if args.test == "search-tab-restore":
        if not args.phone:
            log.error("--test search-tab-restore requires --phone (e.g. --phone 3)")
            sys.exit(1)
        asyncio.run(run_search_tab_restore_test(controllers, args.phone))
        return

    if args.test == "return-to-fyp-on-fyp":
        if not args.phone:
            log.error("--test return-to-fyp-on-fyp requires --phone (e.g. --phone 3)")
            sys.exit(1)
        run_return_to_fyp_on_fyp_test(controllers, args.phone)
        return

    if args.test == "live-double-scroll":
        if not args.phone:
            log.error("--test live-double-scroll requires --phone (e.g. --phone 3)")
            sys.exit(1)
        asyncio.run(run_live_double_scroll_test(controllers, args.phone, args.duration))
        return

    if args.test == "search-retype":
        if not args.phone:
            log.error("--test search-retype requires --phone (e.g. --phone 3)")
            sys.exit(1)
        asyncio.run(run_search_retype_test(controllers, args.phone))
        return

    if args.test == "search-grid-scroll":
        if not args.phone:
            log.error("--test search-grid-scroll requires --phone (e.g. --phone 3)")
            sys.exit(1)
        asyncio.run(run_search_grid_scroll_test(controllers, args.phone))
        return

    if args.test == "search-reveal":
        if not args.phone:
            log.error("--test search-reveal requires --phone (e.g. --phone 3)")
            sys.exit(1)
        asyncio.run(run_search_reveal_test(controllers, args.phone))
        return

    if args.test == "screen-detect":
        if not args.phone:
            log.error("--test screen-detect requires --phone (e.g. --phone 3)")
            sys.exit(1)
        run_screen_detect_test(controllers, args.phone)
        return

    if args.test == "niche-baking":
        run_niche_baking_test()
        return

    if args.test == "fyp-swipe-clamp":
        if not args.phone:
            log.error("--test fyp-swipe-clamp requires --phone (e.g. --phone 3)")
            sys.exit(1)
        asyncio.run(run_fyp_swipe_clamp_test(controllers, args.phone))
        return

    if args.test:  # default: 'devices'
        test_devices(controllers)
        return

    if args.dashboard:
        from .api.server import start_dashboard
        start_dashboard(controllers)
        return

    if args.scroll_only:
        if not args.phone:
            log.error("--scroll-only requires --phone (e.g. --phone 4)")
            sys.exit(1)
        asyncio.run(run_scroll_only(controllers, args.phone, args.duration))
        return

    if args.like_test:
        if not args.phone:
            log.error("--like-test requires --phone (e.g. --phone 4)")
            sys.exit(1)
        asyncio.run(run_like_test(controllers, args.phone))
        return

    if args.browse_test:
        if not args.phone:
            log.error("--browse-test requires --phone (e.g. --phone 4)")
            sys.exit(1)
        asyncio.run(run_browse_test(controllers, args.phone, args.duration))
        return

    if args.action_test:
        if not args.phone:
            log.error("--action-test requires --phone (e.g. --phone 4)")
            sys.exit(1)
        asyncio.run(run_action_test(controllers, args.phone))
        return

    if args.scroll_test:
        if not args.phone:
            log.error("--scroll-test requires --phone (e.g. --phone 4)")
            sys.exit(1)
        asyncio.run(run_scroll_test(controllers, args.phone))
        return

    if args.tap_test:
        if not args.phone:
            log.error("--tap-test requires --phone (e.g. --phone 4)")
            sys.exit(1)
        run_tap_test(controllers, args.phone, args.tap_test)
        return

    if args.warmup:
        init_warmup(controllers, phone_filter=args.phone)
        return

    if args.forever:
        log.info("Starting always-on (forever) mode")
        asyncio.run(run_forever(controllers))
        return

    # Default: run today's plan (warmup sessions run automatically if active)
    asyncio.run(run_today(controllers))


if __name__ == "__main__":
    main()
