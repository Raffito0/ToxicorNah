diff --git a/phone-bot/actions/tiktok.py b/phone-bot/actions/tiktok.py
index 85a632d..92a94a9 100644
--- a/phone-bot/actions/tiktok.py
+++ b/phone-bot/actions/tiktok.py
@@ -2717,18 +2717,47 @@ JSON only, no markdown."""
         time.sleep(self.human.timing("t_nav_settle"))
         self._ensure_on_app()
 
+    def _exit_story_safely(self) -> None:
+        """Exit Story view after failed Story header navigation.
+
+        Presses BACK and verifies FYP is restored.
+        Called ONLY from visit_creator_profile() when Story navigation fails.
+        Does NOT replace Story handling in _return_to_fyp() (which uses story_close X tap).
+        INVARIANT: Does not tap any position while in Story view — uses BACK keyevent only.
+        Escalates to _return_to_fyp() if BACK alone does not restore FYP.
+        """
+        log.info("_exit_story_safely: pressing BACK to exit Story")
+        self.adb.press_back()
+        vr = wait_and_verify(
+            adb=self.adb, human=self.human,
+            verify_fn=lambda shot: self._quick_verify_fyp_from_shot(shot),
+            action_name="story_safe_exit",
+            first_wait="t_back_verify",
+            is_slow_verify=False,
+            max_attempts=2,
+        )
+        if vr.success:
+            log.info("_exit_story_safely: FYP restored")
+        else:
+            log.warning("_exit_story_safely: FYP not confirmed after BACK, escalating")
+            self._return_to_fyp()
+
     def visit_creator_profile(self) -> bool:
         """Tap on creator's avatar to visit their profile.
         Uses Gemini bounding box to find the EXACT avatar position first (varies per video).
-        Handles Story circle: if avatar has a blue Story ring, tapping opens the Story
-        instead of the profile. Detects this and taps creator avatar in Story header
-        to enter profile directly from Story.
-        Returns False if navigation failed (caller should abort)."""
+
+        Story handling (3-layer fix):
+        - Layer 1: After profile verify fails, classify screen for Story even if fingerprint unchanged
+        - Layer 2: If Story confirmed, tap story_avatar header once (+-5px jitter, y < 80% guard)
+        - Layer 3: If header tap also fails, call _exit_story_safely(), return False immediately
+
+        INVARIANT: Never tap y > 0.80 * screen_h while in Story view.
+        Returns False if navigation failed (caller should abort).
+        """
         for attempt in range(2):
             log.info("NAV: visit_creator_profile (bbox + tap, attempt %d)", attempt + 1)
 
             # Fingerprint BEFORE tap (to detect if screen changed)
-            from ..core import page_state
             pre_shot = self.adb.screenshot_bytes()
             pre_fp = page_state.screen_fingerprint(pre_shot) if pre_shot else None
 
@@ -2779,29 +2808,33 @@ JSON only, no markdown."""
                 self._log_action("profile_visit")
                 return True
 
-            # Profile verify failed — check what we're on
+            # Profile verify failed — Layer 1: always classify for Story regardless of fingerprint diff.
+            # Stories have similar brightness to FYP videos, so fingerprint comparison is unreliable.
             screenshot = vr.screenshot
             if screenshot:
-                # Step 2: detect if screen changed (fingerprint comparison)
-                # Gemini can't reliably classify Stories — they look like FYP to it.
-                # But fingerprint tells us if SOMETHING opened.
                 post_fp = page_state.screen_fingerprint(screenshot)
-                screen_changed = False
                 if pre_fp and post_fp:
                     diff = sum(abs(a - b) for a, b in zip(pre_fp, post_fp)) / len(pre_fp)
-                    screen_changed = diff > 18
-                    log.debug("visit_creator_profile: fingerprint diff=%.1f, screen_changed=%s", diff, screen_changed)
-
-                # Step 3: screen changed but not profile — classify what opened
-                if screen_changed:
-                    classification = gemini.classify_screen_with_reference(screenshot)
-                    if classification == "story":
-                        # Story confirmed — tap Story header avatar at fixed coords
-                        log.warning("Story confirmed — tapping Story header avatar")
-                        sx, sy = self.adb.get_coord("tiktok", "story_avatar")
+                    log.debug("visit_creator_profile: fingerprint diff=%.1f", diff)
+
+                # Always classify — do not gate on screen_changed
+                classification = gemini.classify_screen_with_reference(screenshot)
+                log.info("visit_creator_profile: screen classified as '%s'", classification)
+
+                if classification == "story":
+                    # Layer 2: Story confirmed — tap Story header avatar once with invariant guard
+                    log.warning("visit_creator_profile: Story detected, attempting header tap")
+                    sx, sy = self.adb.get_coord("tiktok", "story_avatar")
+                    # Invariant guard: story_avatar must be above 80% of screen
+                    if sy >= int(self.adb.screen_h * 0.80):
+                        log.critical(
+                            "visit_creator_profile: story_avatar y=%d exceeds 0.80*screen_h=%d — SKIP TAP",
+                            sy, int(self.adb.screen_h * 0.80))
+                    else:
                         # Minimal jitter — Story avatar is tiny (~30px), standard jitter misses it
                         sx += random.randint(-5, 5)
                         sy += random.randint(-5, 5)
+                        log.info("visit_creator_profile: Story header tap attempt at (%d, %d)", sx, sy)
                         self.adb.tap(sx, sy)
                         vr2 = wait_and_verify(
                             adb=self.adb, human=self.human,
@@ -2817,23 +2850,28 @@ JSON only, no markdown."""
                             self._log_action("profile_visit", metadata={"via": "story_header"})
                             return True
                         log.warning("Story header tap didn't reach profile")
-                    else:
-                        log.warning("Screen changed to %s (not Story) — pressing BACK", classification)
-                    # Recovery — BACK to FYP
-                    self.adb.press_back()
-                    time.sleep(self.human.timing("t_nav_settle"))
-                    if not self._verify_page("fyp"):
-                        self._return_to_fyp()
-                    if attempt == 0:
-                        time.sleep(self.human.timing("t_tap_gap"))
-                        continue
-                    break
 
-                # Step 4: screen didn't change — tap didn't work, retry
-                log.warning("Avatar tap did nothing (screen unchanged), retrying")
+                    # Layer 3: Story confirmed but couldn't reach profile — safe exit, no outer retry
+                    log.info("visit_creator_profile: Story exit, skip profile")
+                    self._exit_story_safely()
+                    return False
+
+                # Non-story classification — press BACK and optionally retry
+                log.warning("visit_creator_profile: screen changed to '%s' — pressing BACK", classification)
+                self.adb.press_back()
+                time.sleep(self.human.timing("t_nav_settle"))
+                if not self._verify_page("fyp"):
+                    self._return_to_fyp()
                 if attempt == 0:
                     time.sleep(self.human.timing("t_tap_gap"))
                     continue
+                break
+
+            # No screenshot from verify — tap probably did nothing, retry once
+            log.warning("Avatar tap produced no screenshot (screen unchanged?), retrying")
+            if attempt == 0:
+                time.sleep(self.human.timing("t_tap_gap"))
+                continue
 
         log.warning("visit_creator_profile: failed after 2 attempts")
         return False
diff --git a/phone-bot/main.py b/phone-bot/main.py
index 17b7421..c6d225e 100644
--- a/phone-bot/main.py
+++ b/phone-bot/main.py
@@ -893,6 +893,87 @@ def init_warmup(controllers: dict[int, ADBController], phone_filter: int = None)
     log.info("Warmup initialized! Run 'python main.py' daily for 7 days.")
 
 
+def run_story_coord_audit():
+    """TEST: Static audit of story_* coords — no phone needed.
+    Verifies that all story coords stay below y=80% on all target phone screen heights."""
+    from .core.coords import get_coords as _get_coords
+
+    screen_specs = [
+        ("Samsung S9",  1080, 2220),
+        ("Samsung S22", 1080, 2340),
+        ("Motorola",    720,  1600),
+    ]
+    story_coord_names = ["story_avatar", "story_tap_next", "story_tap_prev", "story_close"]
+    max_y_pct = 0.80
+    failures = []
+
+    log.info("=== STORY COORD AUDIT ===")
+    for name in story_coord_names:
+        parts = []
+        failed = False
+        for phone_name, w, h in screen_specs:
+            try:
+                _, y = _get_coords("tiktok", name, screen_w=w, screen_h=h)
+            except Exception as e:
+                log.error("  %s: MISSING coord '%s': %s", phone_name, name, e)
+                failed = True
+                continue
+            y_pct = y / h
+            ok = y_pct <= max_y_pct
+            parts.append(f"{phone_name}={y_pct:.2%}({'OK' if ok else 'FAIL'})")
+            if not ok:
+                failed = True
+                failures.append(
+                    f"FAIL: {name} y={y_pct:.1%} on {phone_name} (h={h}) exceeds {max_y_pct:.0%} limit"
+                )
+        status = "PASS" if not failed else "FAIL"
+        log.info("  [%s] %s: %s", status, name, "  ".join(parts))
+
+    log.info("=== AUDIT RESULT: %d failure(s) ===", len(failures))
+    for f in failures:
+        log.error("  %s", f)
+    if not failures:
+        log.info("  All story coords pass y < 80%% invariant on all phones.")
+
+
+async def run_story_exit_test(controllers: dict, phone_id: int):
+    """TEST: Call visit_creator_profile() once on a phone where the current FYP
+    contains a creator with an active Story (blue ring on avatar).
+    Verifies: Story detected, safe exit, FYP restored, no keyboard opened."""
+    if phone_id not in controllers:
+        log.error("Phone %d not connected! Available: %s", phone_id, list(controllers.keys()))
+        return
+
+    adb = controllers[phone_id]
+    human = HumanEngine(account_name=f"test_ph{phone_id}")
+    human.start_session(
+        hour=datetime.now().hour,
+        weekday=datetime.now().weekday(),
+        duration_minutes=5,
+    )
+
+    from .core.monitor import init_monitor
+    import tempfile
+    tmp_events = tempfile.mkdtemp(prefix="phone_bot_story_test_events_")
+    tmp_shots = tempfile.mkdtemp(prefix="phone_bot_story_test_shots_")
+    init_monitor(events_dir=tmp_events, screenshots_dir=tmp_shots)
+    log.info("Monitor initialized (temp dirs: %s, %s)", tmp_events, tmp_shots)
+
+    from .actions.tiktok import TikTokBot
+    bot = TikTokBot(adb, human)
+
+    log.info("=== STORY-EXIT TEST: Phone %d ===", phone_id)
+    log.info("Precondition: TikTok FYP must be open, current video creator must have active Story (blue ring)")
+    log.info("Expected: Story detected + safely exited, FYP restored, visit_creator_profile returns False")
+
+    result = bot.visit_creator_profile()
+
+    log.info("=== RESULT: visit_creator_profile returned %s ===", result)
+    log.info("Expected: False (Story handled, profile not opened)")
+    log.info("Check logs above for: 'Story detected' + 'Story header tap attempt' or 'Story exit, skip profile'")
+    log.info("Verify scrcpy frames: no keyboard, no text typed, FYP restored in later frame")
+
+
 def _check_api_keys():
     """Warn at startup if critical API keys are missing."""
     if not GEMINI.get("api_key"):
@@ -903,7 +984,8 @@ def _check_api_keys():
 
 def main():
     parser = argparse.ArgumentParser(description="Phone Bot — TikTok & Instagram Automation")
-    parser.add_argument("--test", action="store_true", help="Test device connections")
+    parser.add_argument("--test", nargs="?", const="devices", metavar="MODE",
+                        help="Test mode: 'devices' (default), 'story-coord-audit', 'story-exit'")
     parser.add_argument("--dashboard", action="store_true", help="Start web dashboard")
     parser.add_argument("--warmup", action="store_true", help="Initialize warmup for new accounts")
     parser.add_argument("--scroll-only", action="store_true",
@@ -924,10 +1006,15 @@ def main():
     args = parser.parse_args()
 
     # Verbose logging in TEST_MODE
-    if TEST_MODE or args.scroll_only or args.browse_test or args.action_test:
+    if TEST_MODE or args.scroll_only or args.browse_test or args.action_test or args.test:
         logging.getLogger().setLevel(logging.DEBUG)
         log.info("TEST MODE active — proxy disabled, verbose logging, timezone Europe/Rome")
 
+    # story-coord-audit is static — runs BEFORE device discovery (no phone needed)
+    if args.test == "story-coord-audit":
+        run_story_coord_audit()
+        return
+
     _check_api_keys()
     log.info("Discovering connected devices...")
     controllers = discover_devices()
@@ -941,7 +1028,14 @@ def main():
     # WiFi off on inactive phones is the primary defense against background IP leakage.
     # No background restriction needed — WiFi off = zero network = zero risk.
 
-    if args.test:
+    if args.test == "story-exit":
+        if not args.phone:
+            log.error("--test story-exit requires --phone (e.g. --phone 1)")
+            sys.exit(1)
+        asyncio.run(run_story_exit_test(controllers, args.phone))
+        return
+
+    if args.test:  # default: 'devices'
         test_devices(controllers)
         return
 
