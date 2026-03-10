"""Session Executor — reads the Weekly Plan JSON and executes it on real phones.

The Weekly Plan is the "script". This module is the "actor" that performs it.
Reads each session from the plan and translates it into real ADB actions.

Also handles warmup sessions for new accounts (days 1-7).
"""
import asyncio
import json
import logging
import os
import random
import time
from datetime import datetime, date, timedelta

from .. import config  # NOTE: config.py adds delivery module to sys.path
from ..core.adb import ADBController
from ..core.human import HumanEngine
from ..core.proxy import ProxyQueue
from ..actions.tiktok import TikTokBot
from ..actions.instagram import InstagramBot
from .warmup import AccountWarmupState, generate_warmup_sessions, generate_warmup_plan
from delivery import get_next_video, download_video, push_to_phone, mark_posted, mark_draft, mark_skipped

log = logging.getLogger(__name__)

WARMUP_STATE_FILE = os.path.join(config.DATA_DIR, "warmup_state.json")


class SessionExecutor:
    """Reads the weekly/daily plan and executes sessions on physical phones."""

    def __init__(self, controllers: dict[int, ADBController], proxy_queue: ProxyQueue):
        self.controllers = controllers  # {phone_id: ADBController}
        self.proxy = proxy_queue
        self.human_engines: dict[str, HumanEngine] = {}  # per account
        self.warmup_states: dict[str, AccountWarmupState] = {}
        self._running = False
        self._pending_record = None
        self._load_warmup_state()

    # --- Warmup State Persistence ------------------------------------------

    def _load_warmup_state(self):
        """Load warmup state from disk."""
        if os.path.exists(WARMUP_STATE_FILE):
            with open(WARMUP_STATE_FILE, "r") as f:
                data = json.load(f)
            for name, state_dict in data.items():
                self.warmup_states[name] = AccountWarmupState.from_dict(state_dict)
            log.info("Loaded warmup state for %d accounts", len(self.warmup_states))

    def _save_warmup_state(self):
        """Save warmup state to disk."""
        data = {name: state.to_dict() for name, state in self.warmup_states.items()}
        with open(WARMUP_STATE_FILE, "w") as f:
            json.dump(data, f, indent=2)

    def init_warmup(self, account_name: str, platform: str, phone_id: int,
                    niche_keywords: list[str] = None):
        """Initialize warmup for a new account.
        Generates a unique 5-8 day plan with dead days, lazy days,
        non-monotonic engagement, and randomized profile setup.
        """
        state = AccountWarmupState(
            account_name=account_name,
            platform=platform,
            phone_id=phone_id,
            start_date=date.today().isoformat(),
            current_day=1,
            niche_keywords=niche_keywords or [
                "toxic relationship", "red flags", "situationship",
                "dating advice", "couples", "relationship tips",
            ],
        )
        generate_warmup_plan(state)
        self.warmup_states[account_name] = state
        self._save_warmup_state()
        log.info("Warmup initialized for %s (%d days, pic=day %d, bio=day %d)",
                 account_name, state.total_days, state.profile_pic_day, state.bio_day)

    def is_in_warmup(self, account_name: str) -> bool:
        """Check if an account is still in warmup phase."""
        state = self.warmup_states.get(account_name)
        return state is not None and not state.completed

    def _get_human(self, account_name: str) -> HumanEngine:
        """Get or create a HumanEngine for an account."""
        if account_name not in self.human_engines:
            self.human_engines[account_name] = HumanEngine(account_name=account_name)
        return self.human_engines[account_name]

    # --- Profile Content Lookup --------------------------------------------

    def _get_profile_pic(self, phone_id: int, platform: str) -> str | None:
        """Get the profile picture path for a phone+platform combo.
        Looks in data/profiles/phone{id}_{platform}_pic.jpg
        """
        candidates = [
            os.path.join(config.DATA_DIR, "profiles", f"phone{phone_id}_{platform}_pic.jpg"),
            os.path.join(config.DATA_DIR, "profiles", f"phone{phone_id}_pic.jpg"),
        ]
        for path in candidates:
            if os.path.exists(path):
                return path
        log.warning("No profile pic found for phone %d %s", phone_id, platform)
        return None

    def _get_bio(self, phone_id: int, platform: str) -> str | None:
        """Get the bio text for a phone+platform combo.
        Reads from data/profiles/phone{id}_{platform}_bio.txt
        """
        candidates = [
            os.path.join(config.DATA_DIR, "profiles", f"phone{phone_id}_{platform}_bio.txt"),
            os.path.join(config.DATA_DIR, "profiles", f"phone{phone_id}_bio.txt"),
        ]
        for path in candidates:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return f.read().strip()
        log.warning("No bio found for phone %d %s", phone_id, platform)
        return None

    # --- Plan Loading ------------------------------------------------------

    def load_weekly_plan(self, week_iso: str = None) -> dict | None:
        """Load the weekly plan JSON for the given week.
        week_iso: e.g. '2026-W09'. If None, uses current week.
        """
        if not week_iso:
            today = date.today()
            week_iso = f"{today.year}-W{today.isocalendar()[1]:02d}"

        filename = f"weekly_plan_{week_iso}.json"

        # Check multiple locations
        search_paths = [
            os.path.join(config.PLANS_DIR, filename),
            os.path.join(config.BASE_DIR, "plans", filename),
            # Also check the original Weekly Plan output dir
            os.path.join(os.path.expanduser("~"), "Downloads", "Weekly & Daily Plan", "output", filename),
        ]

        for path in search_paths:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    plan = json.load(f)
                log.info("Loaded plan: %s", path)
                return plan

        log.error("No plan found for %s", week_iso)
        return None

    def get_today_sessions(self, plan: dict) -> list[dict]:
        """Extract today's sessions from the weekly plan."""
        today = date.today().isoformat()
        daily = plan.get("daily_plans", {})

        if today in daily:
            return daily[today].get("sessions", [])

        # Try date format variations
        for key, day_plan in daily.items():
            if today in key:
                return day_plan.get("sessions", [])

        log.warning("No sessions found for today (%s)", today)
        return []

    # --- Session Execution -------------------------------------------------

    async def execute_session(self, session: dict):
        """Execute a single session from the plan.

        Session dict example:
        {
            "account_name": "ph1_tiktok",
            "phone_id": 1,
            "platform": "tiktok",
            "start_time": "19:30",
            "end_time": "19:48",
            "session_type": "normal",  # normal, aborted, extended, rest_only
            "post_scheduled": true,
            "post_outcome": "posted",  # posted, draft, skipped
            "pre_activity_minutes": 8,
            "post_activity_minutes": 9,
            "proxy_rotation_before": false,
            "total_duration_minutes": 18
        }
        """
        account = session["account_name"]
        phone_id = session["phone_id"]
        platform = session["platform"]
        session_type = session.get("session_type", "normal")
        total_duration = session.get("total_duration_minutes", 15)

        log.info("=== Session: %s | Phone %d | %s | %s | %d min ===",
                 account, phone_id, platform, session_type, total_duration)

        # Connect phone to proxy
        if session.get("proxy_rotation_before", False) or self.proxy.active_phone_id != phone_id:
            if not self.proxy.switch_to_phone(phone_id):
                log.error("Failed to connect Phone %d to proxy, skipping session", phone_id)
                return

        adb = self.controllers[phone_id]
        human = self._get_human(account)

        # Start the human engine for this session (with duration for phase tracking)
        now = datetime.now()
        human.start_session(hour=now.hour, weekday=now.weekday(),
                            duration_minutes=total_duration)

        # --- Handle session types ---

        if session_type == "aborted":
            await self._execute_aborted(adb, human, platform, total_duration)

        elif session_type == "rest_only":
            await self._execute_rest_only(adb, human, platform, total_duration)

        elif session_type == "extended":
            should_post = session.get("post_scheduled", False)
            await self._execute_normal(
                adb, human, platform, total_duration,
                should_post=should_post,
                post_outcome=session.get("post_outcome", "posted"),
                pre_minutes=session.get("pre_activity_minutes", 8),
                post_minutes=session.get("post_activity_minutes", 9),
                phone_id=phone_id,
            )

        else:  # normal
            should_post = session.get("post_scheduled", False)
            await self._execute_normal(
                adb, human, platform, total_duration,
                should_post=should_post,
                post_outcome=session.get("post_outcome", "posted"),
                pre_minutes=session.get("pre_activity_minutes", 8),
                post_minutes=session.get("post_activity_minutes", 9),
                phone_id=phone_id,
            )

        human.end_session()
        log.info("=== Session complete: %s ===", account)

    async def _execute_aborted(self, adb: ADBController, human: HumanEngine,
                                platform: str, duration_min: float):
        """Aborted session: open app, look around <2 min, close."""
        log.info("Aborted session — opening and closing quickly")

        if platform == "tiktok":
            bot = TikTokBot(adb, human)
            bot.open_app()
            await asyncio.sleep(duration_min * 60)
            bot.close_app()
        else:
            bot = InstagramBot(adb, human)
            bot.open_app()
            await asyncio.sleep(duration_min * 60)
            bot.close_app()

    async def _execute_rest_only(self, adb: ADBController, human: HumanEngine,
                                  platform: str, duration_min: float):
        """Rest-only session: just scroll, no posting."""
        log.info("Rest-only session — scrolling for %.1f min", duration_min)

        if platform == "tiktok":
            bot = TikTokBot(adb, human)
            await bot.browse_session(duration_minutes=duration_min, should_post=False)
        else:
            bot = InstagramBot(adb, human)
            await bot.browse_session(duration_minutes=duration_min, should_post=False)

    async def _execute_normal(self, adb: ADBController, human: HumanEngine,
                               platform: str, duration_min: float,
                               should_post: bool, post_outcome: str,
                               pre_minutes: float, post_minutes: float,
                               phone_id: int):
        """Normal/extended session: scroll → post → scroll."""
        video_path = ""
        caption = ""
        self._pending_record = None  # reset per session

        if should_post and post_outcome == "posted":
            # Fetch video from Content Library via delivery module
            video_info = get_next_video(phone_id, platform)
            if video_info:
                local_path = download_video(video_info["video_url"])
                if local_path:
                    video_path = local_path
                    caption = video_info.get("caption", "")
                    self._pending_record = video_info["record_id"]
                else:
                    log.warning("Failed to download video, will skip post")
                    should_post = False
            else:
                log.info("No pending video, will just scroll")
                should_post = False

        elif should_post and post_outcome == "draft":
            video_info = get_next_video(phone_id, platform)
            if video_info:
                self._pending_record = video_info["record_id"]
                mark_draft(video_info["record_id"], platform)
            should_post = False

        elif should_post and post_outcome == "skipped":
            video_info = get_next_video(phone_id, platform)
            if video_info:
                self._pending_record = video_info["record_id"]
                mark_skipped(video_info["record_id"], platform)
            should_post = False

        if platform == "tiktok":
            bot = TikTokBot(adb, human)
            await bot.browse_session(
                duration_minutes=duration_min,
                should_post=should_post,
                video_path=video_path,
                caption=caption,
                pre_scroll_minutes=pre_minutes,
                post_scroll_minutes=post_minutes,
            )
        else:
            bot = InstagramBot(adb, human)
            await bot.browse_session(
                duration_minutes=duration_min,
                should_post=should_post,
                video_path=video_path,
                caption=caption,
                pre_scroll_minutes=pre_minutes,
                post_scroll_minutes=post_minutes,
            )

        # Mark video as posted in Airtable
        if should_post and video_path and self._pending_record:
            mark_posted(self._pending_record, platform)

    # --- Warmup Session Execution ------------------------------------------

    async def execute_warmup_session(self, session: dict):
        """Execute a warmup session with limited actions based on warmup day."""
        account = session["account_name"]
        phone_id = session["phone_id"]
        platform = session["platform"]
        day = session["warmup_day"]
        duration = session["duration_minutes"]
        actions = session["actions"]

        log.info("=== WARMUP Day %d: %s | Phone %d | %s | %d min ===",
                 day, account, phone_id, platform, duration)

        # Connect proxy
        if self.proxy.active_phone_id != phone_id:
            if not self.proxy.switch_to_phone(phone_id):
                log.error("Failed to connect Phone %d, skipping warmup session", phone_id)
                return

        adb = self.controllers[phone_id]
        human = self._get_human(account)
        now = datetime.now()
        human.start_session(hour=now.hour, weekday=now.weekday(),
                            duration_minutes=duration)

        if platform == "tiktok":
            await self._warmup_tiktok(adb, human, session)
        else:
            await self._warmup_instagram(adb, human, session)

        human.end_session()
        log.info("=== Warmup session complete: %s day %d ===", account, day)

    async def _warmup_tiktok(self, adb: ADBController, human: HumanEngine, session: dict):
        """Execute a TikTok warmup session.
        Pre-loop tasks are shuffled per session. Scroll loop has full
        micro-behaviors (zona morta, peek scroll, post-like pause, etc.)."""
        bot = TikTokBot(adb, human)
        actions = session["actions"]
        duration = session["duration_minutes"]
        niche_keywords = session.get("niche_keywords", [])
        account_name = session["account_name"]
        warmup_state = self.warmup_states.get(account_name)
        n_searches = actions.get("search_niche", 0)

        if not bot.open_app():
            return

        # Behavior #10: Variable load reaction time
        await asyncio.sleep(human.load_reaction_time())

        # --- Pre-loop tasks (SHUFFLED order per session) ---
        pre_tasks = []
        if actions.get("explore_app"):
            pre_tasks.append("explore_app")
        if n_searches and niche_keywords:
            pre_tasks.append("search_niche")
        if session.get("set_profile_pic") and warmup_state:
            pre_tasks.append("set_profile_pic")
        if session.get("set_bio") and warmup_state:
            pre_tasks.append("set_bio")

        random.shuffle(pre_tasks)

        for task in pre_tasks:
            if task == "explore_app":
                log.info("Warmup: exploring app features")
                bot.go_to_fyp()
                await asyncio.sleep(human.timing("t_explore_browse"))
                bot.go_to_search()
                await asyncio.sleep(human.timing("t_explore_browse"))
                bot.go_to_fyp()
                await asyncio.sleep(human.timing("t_nav_settle"))

            elif task == "search_niche":
                keywords_to_search = random.sample(
                    niche_keywords, min(n_searches, len(niche_keywords))
                )
                for kw in keywords_to_search:
                    log.info("Warmup: searching '%s'", kw)
                    bot.search_hashtag(kw)
                    await asyncio.sleep(human.timing("t_browse_results"))
                    bot.go_to_fyp()
                    await asyncio.sleep(human.timing("t_explore_browse"))

            elif task == "set_profile_pic":
                profile_pic = self._get_profile_pic(session["phone_id"], "tiktok")
                if profile_pic:
                    bot.set_profile_pic(profile_pic)
                    warmup_state.profile_pic_done = True
                    self._save_warmup_state()
                    await asyncio.sleep(human.timing("t_profile_settle"))

            elif task == "set_bio":
                bio = self._get_bio(session["phone_id"], "tiktok")
                if bio:
                    bot.set_bio(bio)
                    warmup_state.bio_done = True
                    self._save_warmup_state()
                    await asyncio.sleep(human.timing("t_profile_settle"))

        # --- Main scroll + engagement loop (with micro-behaviors) ---
        bot.go_to_fyp()
        await asyncio.sleep(human.timing("t_nav_settle"))

        likes_left = actions.get("like", 0)
        comments_left = actions.get("comment", 0)
        follows_left = actions.get("follow", 0)

        start = time.time()
        total_seconds = duration * 60

        while (time.time() - start) < total_seconds:
            # Behavior #1: Zona morta
            if human.should_zona_morta():
                zm_dur = human.zona_morta_duration()
                log.debug("Warmup zona morta: %.0fs", zm_dur)
                await asyncio.sleep(zm_dur)
                continue

            # Interruption
            if human.should_interrupt():
                await human.do_interruption(adb, "com.zhiliaoapp.musically")
                continue

            # Watch current video
            watch_time = human.watch_duration()
            await asyncio.sleep(watch_time)

            # Pick ONE engagement action (jittered weights, respecting limits)
            _j = lambda base: base * random.uniform(0.75, 1.25)
            options = ["scroll"]
            weights = [_j(0.40)]
            if likes_left > 0:
                options.append("like")
                weights.append(_j(0.35))
            if comments_left > 0:
                options.append("comment")
                weights.append(_j(0.15))
            if follows_left > 0:
                options.append("follow")
                weights.append(_j(0.10))

            action = random.choices(options, weights=weights, k=1)[0]

            if action == "like":
                bot.like_video()
                likes_left -= 1
                await asyncio.sleep(human.post_like_pause())

            elif action == "comment":
                if human.should_double_open_comments():
                    bot.open_comments()
                    await asyncio.sleep(human.timing("t_double_open_1"))
                    adb.press_back()
                    await asyncio.sleep(human.timing("t_double_open_2"))
                await bot.comment_with_ai()
                comments_left -= 1

            elif action == "follow":
                bot.follow_creator()
                follows_left -= 1

            # Scroll to next (with micro-behaviors)
            if human.should_micro_scroll():
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                    adb.screen_w // 2, adb.screen_h // 2,
                )
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.timing("t_micro_scroll"))
            elif human.should_peek_scroll():
                bot.peek_scroll()
            elif human.should_rewatch():
                bot.scroll_fyp()
                await asyncio.sleep(human.timing("t_rewatch"))
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h // 4,
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                )
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.watch_duration())
            else:
                bot.scroll_fyp()

            await asyncio.sleep(human.action_delay())

        # Post on last day
        if session.get("can_post"):
            try:
                if session.get("use_camera_trick"):
                    await self._tiktok_camera_trick_post(adb, human, bot, session)
                else:
                    video_info = get_next_video(session["phone_id"], "tiktok")
                    if video_info:
                        local_path = download_video(video_info["video_url"])
                        if local_path:
                            bot.post_video(local_path, video_info.get("caption", ""))
                            mark_posted(video_info["record_id"], "tiktok")
            except Exception as e:
                log.error("Warmup TikTok post failed: %s", e, exc_info=True)

        # Behavior #11: Background at end
        if human.should_end_in_background():
            bg_time = human.bg_end_duration()
            log.debug("Warmup background end: %.0fs", bg_time)
            adb.press_home()
            await asyncio.sleep(bg_time)

        bot.close_app()

    async def _warmup_instagram(self, adb: ADBController, human: HumanEngine, session: dict):
        """Execute an Instagram warmup session.
        Pre-loop tasks are shuffled per session. Scroll loop has full
        micro-behaviors (zona morta, peek scroll, post-like pause, etc.)."""
        bot = InstagramBot(adb, human)
        actions = session["actions"]
        duration = session["duration_minutes"]
        niche_keywords = session.get("niche_keywords", [])
        account_name = session["account_name"]
        warmup_state = self.warmup_states.get(account_name)
        n_searches = actions.get("search_niche", 0)

        if not bot.open_app():
            return

        # Behavior #10: Variable load reaction time
        await asyncio.sleep(human.load_reaction_time())

        # --- Pre-loop tasks (SHUFFLED order per session) ---
        pre_tasks = []
        if actions.get("explore_tab"):
            pre_tasks.append("explore_tab")
        if n_searches and niche_keywords:
            pre_tasks.append("search_niche")
        if session.get("set_profile_pic") and warmup_state:
            pre_tasks.append("set_profile_pic")
        if session.get("set_bio") and warmup_state:
            pre_tasks.append("set_bio")

        random.shuffle(pre_tasks)

        for task in pre_tasks:
            if task == "explore_tab":
                log.info("Warmup: exploring Explore tab")
                bot.go_to_explore()
                await asyncio.sleep(human.timing("t_browse_results"))

            elif task == "search_niche":
                keywords_to_search = random.sample(
                    niche_keywords, min(n_searches, len(niche_keywords))
                )
                for kw in keywords_to_search:
                    log.info("Warmup: searching '%s' on IG", kw)
                    bot.search_keyword(kw)
                    bot.go_to_reels()
                    await asyncio.sleep(human.timing("t_explore_browse"))

            elif task == "set_profile_pic":
                profile_pic = self._get_profile_pic(session["phone_id"], "instagram")
                if profile_pic:
                    bot.set_profile_pic(profile_pic)
                    warmup_state.profile_pic_done = True
                    self._save_warmup_state()
                    await asyncio.sleep(human.timing("t_profile_settle"))

            elif task == "set_bio":
                bio = self._get_bio(session["phone_id"], "instagram")
                if bio:
                    bot.set_bio(bio)
                    warmup_state.bio_done = True
                    self._save_warmup_state()
                    await asyncio.sleep(human.timing("t_profile_settle"))

        # --- Start on Reels or Feed (random) ---
        if random.random() < 0.6:
            bot.go_to_reels()
        else:
            bot.go_to_feed()
            # Watch stories sometimes during warmup (20% — real users do this)
            if random.random() < 0.20:
                bot.watch_stories(count=random.randint(1, 3))
        await asyncio.sleep(human.timing("t_nav_settle"))

        # --- Main scroll + engagement loop (with micro-behaviors) ---
        likes_left = actions.get("like", 0)
        comments_left = actions.get("comment", 0)
        follows_left = actions.get("follow", 0)

        start = time.time()
        total_seconds = duration * 60

        while (time.time() - start) < total_seconds:
            # Behavior #1: Zona morta
            if human.should_zona_morta():
                zm_dur = human.zona_morta_duration()
                log.debug("Warmup zona morta: %.0fs", zm_dur)
                await asyncio.sleep(zm_dur)
                continue

            # Interruption
            if human.should_interrupt():
                await human.do_interruption(adb, "com.instagram.android")
                continue

            # Watch current video
            watch_time = human.watch_duration()
            await asyncio.sleep(watch_time)

            # Pick ONE engagement action (jittered weights, respecting limits)
            _j = lambda base: base * random.uniform(0.75, 1.25)
            options = ["scroll"]
            weights = [_j(0.40)]
            if likes_left > 0:
                options.append("like")
                weights.append(_j(0.35))
            if comments_left > 0:
                options.append("comment")
                weights.append(_j(0.15))
            if follows_left > 0:
                options.append("follow")
                weights.append(_j(0.10))

            action = random.choices(options, weights=weights, k=1)[0]

            if action == "like":
                bot.like_post()
                likes_left -= 1
                await asyncio.sleep(human.post_like_pause())

            elif action == "comment":
                if human.should_double_open_comments():
                    bot.open_comments()
                    await asyncio.sleep(human.timing("t_double_open_1"))
                    adb.press_back()
                    await asyncio.sleep(human.timing("t_double_open_2"))
                await bot.comment_with_ai()
                comments_left -= 1

            elif action == "follow":
                bot.follow_user()
                follows_left -= 1

            # Scroll to next (with micro-behaviors)
            if human.should_micro_scroll():
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                    adb.screen_w // 2, adb.screen_h // 2,
                )
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.timing("t_micro_scroll"))
            elif human.should_peek_scroll():
                # Inline peek scroll for IG
                mid_y = adb.screen_h // 2
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                    adb.screen_w // 2, mid_y,
                )
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.timing("t_micro_scroll"))
                adb.swipe(sw["x2"], sw["y2"], sw["x1"], sw["y1"], sw["duration"])
            elif human.should_rewatch():
                bot.scroll_reels()
                await asyncio.sleep(human.timing("t_rewatch"))
                sw = human.humanize_swipe(
                    adb.screen_w // 2, adb.screen_h // 4,
                    adb.screen_w // 2, adb.screen_h * 3 // 4,
                )
                adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                await asyncio.sleep(human.watch_duration())
            else:
                bot.scroll_reels()

            await asyncio.sleep(human.action_delay())

        # Post on last day
        if session.get("can_post"):
            try:
                video_info = get_next_video(session["phone_id"], "instagram")
                if video_info:
                    local_path = download_video(video_info["video_url"])
                    if local_path:
                        bot.post_reel(local_path, video_info.get("caption", ""))
                        mark_posted(video_info["record_id"], "instagram")
            except Exception as e:
                log.error("Warmup Instagram post failed: %s", e, exc_info=True)

        # Behavior #11: Background at end
        if human.should_end_in_background():
            bg_time = human.bg_end_duration()
            log.debug("Warmup background end: %.0fs", bg_time)
            adb.press_home()
            await asyncio.sleep(bg_time)

        bot.close_app()

    async def _tiktok_camera_trick_post(self, adb: ADBController, human: HumanEngine,
                                         bot: TikTokBot, session: dict):
        """TikTok camera overlay trick: record with native camera, then overlay real video.
        This makes TikTok think the content was created natively, boosting reach."""
        log.info("Warmup: posting with camera overlay trick")

        # First, push the real video to the phone
        video_info = get_next_video(session["phone_id"], "tiktok")
        if not video_info:
            log.warning("No video to post, skipping camera trick")
            return

        local_path = download_video(video_info["video_url"])
        if not local_path:
            return

        now = datetime.now()
        vid_name = f"video_{now.strftime('%Y%m%d%H%M%S')}_{random.randint(100, 999)}.mp4"
        device_video_path = f"/sdcard/Download/{vid_name}"
        adb.push_file(local_path, device_video_path)
        await asyncio.sleep(human.timing("t_file_push"))
        adb.shell(
            f'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE '
            f'-d "file://{device_video_path}"'
        )
        await asyncio.sleep(human.timing("t_file_push"))

        # Step 1: Open TikTok camera (Create button)
        x, y = adb.get_coord("tiktok", "nav_create")
        x, y = human.jitter_tap(x, y)
        adb.tap(x, y)
        await asyncio.sleep(human.timing("t_upload_load"))

        # Step 2: Make sure we're on Camera mode (not Upload)
        x, y = adb.get_coord("tiktok", "camera_tab")
        x, y = human.jitter_tap(x, y)
        adb.tap(x, y)
        await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 3: Record for a few seconds (filming desk/whatever)
        x, y = adb.get_coord("tiktok", "record_btn")
        x, y = human.jitter_tap(x, y)
        adb.tap(x, y)
        await asyncio.sleep(human.timing("t_camera_record"))
        # Stop recording
        adb.tap(x, y)
        await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 4: Go to edit (Next/Done button -- use Vision for this dynamic element)
        coords = adb.wait_for_screen("Next or Done button", timeout=5)
        if coords:
            x, y = human.jitter_tap(*coords)
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 5: Find and tap Overlay/Effects (use Vision -- position varies)
        coords = adb.find_on_screen("Overlay or Effects button")
        if coords:
            x, y = human.jitter_tap(*coords)
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_nav_settle"))

            # "Add overlay" button (use Vision)
            coords = adb.find_on_screen("Add overlay or Add button")
            if coords:
                x, y = human.jitter_tap(*coords)
                adb.tap(x, y)
                await asyncio.sleep(human.timing("t_nav_settle"))

            # Select the video from gallery (most recent = top-left)
            x, y = adb.get_coord("tiktok", "gallery_first")
            x, y = human.jitter_tap(x, y)
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 6: Tap Next to go to caption screen
        coords = adb.wait_for_screen("Next button", timeout=5)
        if coords:
            x, y = human.jitter_tap(*coords)
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_nav_settle"))

        # Step 7: Add caption
        caption = video_info.get("caption", "")
        if caption:
            x, y = adb.get_coord("tiktok", "upload_caption")
            x, y = human.jitter_tap(x, y)
            adb.tap(x, y)
            await asyncio.sleep(human.timing("t_caption_input"))
            human.type_with_errors(adb, caption)
            await asyncio.sleep(human.timing("t_post_typing"))

        # Step 8: Post (use Vision for Post button)
        coords = adb.wait_for_screen("Post button", timeout=5)
        if coords:
            x, y = human.jitter_tap(*coords)
            adb.tap(x, y)
            log.info("Warmup: video posted with camera trick!")
            await asyncio.sleep(human.timing("t_post_upload"))
            mark_posted(video_info["record_id"], "tiktok")

        # Clean up
        adb.shell(f'rm "{device_video_path}"')

    # --- Day Runner --------------------------------------------------------

    async def run_today(self):
        """Load today's plan and execute all sessions.
        If accounts are in warmup, runs warmup sessions instead of the weekly plan.
        """
        self._running = True

        # --- Phase 1: Run warmup sessions for accounts still in warmup ---
        warmup_accounts = {name: state for name, state in self.warmup_states.items()
                          if not state.completed}

        if warmup_accounts:
            log.info("Running warmup for %d accounts", len(warmup_accounts))

            # Group by phone for proxy efficiency
            phones_done = set()
            for name, state in warmup_accounts.items():
                if not self._running:
                    break

                sessions = generate_warmup_sessions(state)
                for session in sessions:
                    if not self._running:
                        break
                    try:
                        await self.execute_warmup_session(session)
                    except Exception as e:
                        log.error("Warmup session %s crashed: %s",
                                  session.get("account_name", "?"), e, exc_info=True)
                    # Gap between warmup sessions on same phone
                    await asyncio.sleep(self._get_human(name).timing("t_session_gap"))

                # Advance warmup day
                state.advance_day()
                self._save_warmup_state()
                log.info("Warmup day %d complete for %s", state.current_day - 1, name)

        # --- Phase 2: Run weekly plan for accounts done with warmup ---
        plan = self.load_weekly_plan()
        if not plan:
            if not warmup_accounts:
                log.error("No weekly plan found and no warmup to run")
            self.proxy.disconnect_all()
            return

        sessions = self.get_today_sessions(plan)

        # Filter out sessions for accounts still in warmup
        if warmup_accounts:
            sessions = [s for s in sessions
                       if s.get("account_name") not in warmup_accounts]

        if not sessions:
            log.info("No regular sessions for today (all in warmup or no plan)")
        else:
            log.info("Found %d regular sessions for today", len(sessions))

            for session in sessions:
                if not self._running:
                    log.info("Execution stopped by user")
                    break

                start_time_str = session.get("start_time", "")
                if start_time_str:
                    await self._wait_until(start_time_str)

                try:
                    await self.execute_session(session)
                except Exception as e:
                    log.error("Session %s crashed: %s",
                              session.get("account_name", "?"), e, exc_info=True)

                gap = session.get("gap_after_minutes", 0)
                if gap > 0:
                    log.info("Waiting %.1f min gap before next session", gap)
                    await asyncio.sleep(gap * 60)

        self.proxy.disconnect_all()
        log.info("All sessions for today completed!")

    async def _wait_until(self, time_str: str):
        """Wait until a specific time (HH:MM format)."""
        target_h, target_m = map(int, time_str.split(":"))
        while True:
            now = datetime.now()
            if now.hour > target_h or (now.hour == target_h and now.minute >= target_m):
                return
            remaining = (target_h * 60 + target_m) - (now.hour * 60 + now.minute)
            if remaining < 0:
                # Past target time (day-wrap or already passed) -- don't wait
                return
            log.info("Waiting %d min until %s...", remaining, time_str)
            await asyncio.sleep(min(remaining * 60, 60))  # check every minute

    def stop(self):
        """Stop execution after current session completes."""
        self._running = False
