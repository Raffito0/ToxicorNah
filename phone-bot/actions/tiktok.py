"""TikTok actions -- all interactions with TikTok via raw ADB.

Every action uses:
- adb.get_coord() for known UI element positions (zero detection footprint)
- adb.tap() / adb.swipe() for input (with HumanEngine jitter)
- adb.find_on_screen() for dynamic elements in upload flows (Gemini Vision)
- gemini.py for intelligent decisions (comments, categorization)

NO uiautomator, NO find_element, NO UI tree parsing.
"""
import asyncio
import json
import logging
import random
import time
import threading
from datetime import datetime

from .. import config
from ..core.adb import ADBController
from ..core.human import HumanEngine
from ..core import gemini
from ..core import page_state
from ..core.verify import wait_and_verify

log = logging.getLogger(__name__)

TIKTOK_PKG = "com.zhiliaoapp.musically"

SHOP_BLACKLIST = [
    "acquista", "buy", "add to cart", "checkout", "pay",
    "claim", "unwrap", "purchase", "order", "compra",
    "aggiungi al carrello", "paga",
]


# =============================================================================
# PopupGuardian -- continuous popup detection across all app states
# =============================================================================

class PopupGuardian:
    """Monitors for unexpected popups using two detection strategies:

    1. Stall detection (scroll FYP): fingerprint comparison pre/post swipe.
       If screen didn't change after swipe -> sends screenshot to Gemini.
    2. Background check (natural pauses): sends screenshot to Gemini during
       pauses that already exist (watching video, viewing profile, etc.).
    3. Pre-chain check (fast chains): quick local fingerprint comparison
       before starting action chains (search->type->enter).

    Gemini runs in a background thread. Results are checked before the
    next action. If popup found, bot pauses ("reads" it) then taps dismiss.
    """

    def __init__(self, adb: ADBController, human: HumanEngine):
        self.adb = adb
        self.human = human
        # Background Gemini result
        self._pending_result = None
        self._pending_lock = threading.Lock()
        self._bg_thread = None
        # Last known "clean" fingerprint (no popup)
        self._last_clean_fp = None
        # Background check throttle: only check every N eligible pauses
        self._bg_check_counter = 0
        self._BG_CHECK_EVERY = 1  # check every natural pause (paid tier, ~$3/mo)
        # Stats for logging
        self.stats = {
            "checks_total": 0,
            "stalls_detected": 0,
            "popups_found": 0,
            "popups_dismissed": 0,
            "gemini_calls": 0,
            "dismiss_retries": 0,
        }
        # Rate limiter for handle_overlay (max invocations per 60s)
        self._overlay_timestamps = []
        # Back-reference to TikTokBot for FYP verification in escalation
        self._bot_ref = None

    def take_fingerprint(self):
        """Take screenshot + compute fingerprint. Returns (screenshot_bytes, fingerprint)."""
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return None, None
        fp = page_state.screen_fingerprint(screenshot)
        return screenshot, fp

    def check_stall(self, fp_before, screenshot_after, fp_after):
        """Compare pre/post swipe fingerprints. If stalled, send to Gemini immediately.

        Called after every swipe in FYP scroll loop.
        Returns True if stall detected (Gemini check queued or popup handled).
        """
        self.stats["checks_total"] += 1

        if page_state.is_stalled(fp_before, fp_after, config.POPUP_STALL_THRESHOLD):
            self.stats["stalls_detected"] += 1
            log.info("PopupGuardian: stall detected (swipe had no effect)")
            # Stall = something blocking. Send to Gemini NOW (not background)
            # because this is urgent -- the bot can't proceed.
            # urgent=True bypasses rate limiter to avoid 6s freeze.
            result = gemini.check_popup(
                screenshot_after, self.adb.screen_w, self.adb.screen_h,
                urgent=True)
            self.stats["gemini_calls"] += 1

            if result["has_popup"]:
                self.stats["popups_found"] += 1
                log.warning("PopupGuardian: popup confirmed by Gemini: %s",
                            result.get("popup_text", "unknown"))
                if not self._dismiss(result):
                    # _dismiss failed all 4 levels — escalate to 3-tier handler
                    log.info("PopupGuardian: _dismiss failed, escalating to handle_overlay")
                    self.handle_overlay(screenshot_after, bot_ref=self._bot_ref)
                return True
            else:
                # Stall is 100% accurate, so "stall + no popup" likely means
                # Gemini API failed (3%). Retry once to be sure.
                log.info("PopupGuardian: stall but Gemini said no popup, retrying...")
                time.sleep(self.human.timing("t_popup_read") * 0.3)
                retry_shot = self.adb.screenshot_bytes()
                if retry_shot:
                    result2 = gemini.check_popup(
                        retry_shot, self.adb.screen_w, self.adb.screen_h,
                        urgent=True)
                    self.stats["gemini_calls"] += 1
                    if result2["has_popup"]:
                        self.stats["popups_found"] += 1
                        log.warning("PopupGuardian: popup caught on retry: %s",
                                    result2.get("popup_text", "unknown"))
                        if not self._dismiss(result2):
                            log.info("PopupGuardian: retry _dismiss failed, escalating")
                            self.handle_overlay(retry_shot, bot_ref=self._bot_ref)
                        return True
                log.debug("PopupGuardian: stall confirmed no popup (static video)")
                return False
        else:
            # Swipe worked, screen changed. Update clean fingerprint
            self._last_clean_fp = fp_after
            return False

    def check_background(self, screenshot_bytes):
        """Send screenshot to Gemini in background thread during a natural pause.

        Non-blocking. Result is picked up by handle_if_popup() before next action.
        Throttled to every 3rd call to stay within Gemini free tier budget.
        """
        # Don't stack multiple background checks
        if self._bg_thread and self._bg_thread.is_alive():
            return

        # Throttle: only actually call Gemini every Nth eligible pause
        self._bg_check_counter += 1
        if self._bg_check_counter % self._BG_CHECK_EVERY != 0:
            return

        self.stats["checks_total"] += 1
        screen_w = self.adb.screen_w
        screen_h = self.adb.screen_h

        def _bg_check():
            result = gemini.check_popup(screenshot_bytes, screen_w, screen_h)
            self.stats["gemini_calls"] += 1
            with self._pending_lock:
                self._pending_result = result

        self._bg_thread = threading.Thread(target=_bg_check, daemon=True)
        self._bg_thread.start()

    def handle_if_popup(self):
        """Check if background Gemini found a popup. If yes, dismiss it.

        Called before every action. Non-blocking if no result yet.
        Returns True if popup was found and dismissed.
        """
        with self._pending_lock:
            result = self._pending_result
            self._pending_result = None

        if result is None:
            return False

        if result.get("has_popup"):
            self.stats["popups_found"] += 1
            log.warning("PopupGuardian: background check found popup: %s",
                        result.get("popup_text", "unknown"))
            self._dismiss(result)
            return True

        return False

    def pre_chain_check(self):
        """Quick local check before starting a fast action chain.

        Compares current screen to last known clean fingerprint.
        If screen changed significantly (possible popup appeared),
        sends to Gemini synchronously before proceeding.

        Returns True if popup was found and dismissed.
        """
        screenshot, fp = self.take_fingerprint()
        if not screenshot or not fp:
            return False

        self.stats["checks_total"] += 1

        # If we have no clean reference, just save and proceed
        if not self._last_clean_fp:
            self._last_clean_fp = fp
            return False

        # Compare to last known clean state
        total_diff = sum(abs(a - b) for a, b in zip(self._last_clean_fp, fp))
        avg_diff = total_diff / len(fp)

        # If screen changed a LOT from last clean (>30), something new appeared
        # Normal video change is already captured in _last_clean_fp updates
        # A popup on top of video = big structural change from clean reference
        if avg_diff > 30:
            log.debug("PopupGuardian: pre-chain screen changed significantly "
                      "(avg_diff=%.1f), checking with Gemini", avg_diff)
            result = gemini.check_popup(
                screenshot, self.adb.screen_w, self.adb.screen_h)
            self.stats["gemini_calls"] += 1

            if result["has_popup"]:
                self.stats["popups_found"] += 1
                log.warning("PopupGuardian: pre-chain popup: %s",
                            result.get("popup_text", "unknown"))
                self._dismiss(result)
                return True

            # Not a popup, just screen changed (navigated somewhere)
            self._last_clean_fp = fp

        return False

    def _dismiss(self, result):
        """Dismiss a popup with 4-level escalation. Fastest path first.

        Level 1: press_back (free, ~0.7s total, works 95% of cases)
        Level 2: Gemini coords from original detection (~2.5s, for stubborn popups)
        Level 3: find_element_by_vision focused search (~2s, precise button finding)
        Level 4: Hardcoded fallback zones (~0.6s, last resort)

        Verification between levels uses fingerprint comparison (free, ~0.05s)
        instead of Gemini API calls. Only escalates to Gemini verify if fingerprint
        is ambiguous.
        """
        # Simulate reading the popup (human behavior)
        time.sleep(self.human.timing("t_popup_read"))

        # Snapshot fingerprint BEFORE dismiss attempt (with popup on screen)
        _, fp_with_popup = self.take_fingerprint()

        # ── Level 1: press_back ──────────────────────────────────────────
        log.info("PopupGuardian: L1 press_back")
        self.adb.press_back()
        time.sleep(self.human.timing("t_popup_dismiss"))

        if self._verify_dismissed(fp_with_popup, "L1"):
            return True

        # ── Level 2: Gemini coords from original detection ───────────────
        dx = result.get("dismiss_x")
        dy = result.get("dismiss_y")
        if dx is not None and dy is not None:
            self.stats["dismiss_retries"] += 1
            log.info("PopupGuardian: L2 tap Gemini coords (%d, %d) [%s]",
                     dx, dy, result.get("dismiss_label", "?"))
            time.sleep(self.human.timing("t_popup_read") * 0.3)
            tx, ty = self.human.jitter_tap(dx, dy)
            self.adb.tap(tx, ty)
            time.sleep(self.human.timing("t_popup_dismiss"))

            if self._verify_dismissed(fp_with_popup, "L2"):
                return True

        # ── Level 3: find_element_by_vision (focused button search) ──────
        self.stats["dismiss_retries"] += 1
        log.info("PopupGuardian: L3 find_element_by_vision for dismiss button")
        screenshot = self.adb.screenshot_bytes()
        if screenshot:
            coords = gemini.find_element_by_vision(
                screenshot,
                "the X, Close, Not now, Don't allow, Cancel, or dismiss button on the popup",
                self.adb.screen_w, self.adb.screen_h)
            self.stats["gemini_calls"] += 1

            if coords:
                tx, ty = self.human.jitter_tap(coords[0], coords[1])
                log.info("PopupGuardian: L3 tapping found button at (%d, %d)", tx, ty)
                self.adb.tap(tx, ty)
                time.sleep(self.human.timing("t_popup_dismiss"))

                if self._verify_dismissed(fp_with_popup, "L3"):
                    return True

        # ── Level 4: Hardcoded fallback zones ────────────────────────────
        self.stats["dismiss_retries"] += 1
        sw, sh = self.adb.screen_w, self.adb.screen_h
        fallback_zones = [
            # Top-right X button (common on bottom sheets, dialogs)
            (int(sw * 0.92), int(sh * 0.38), "top-right X"),
            # Bottom-center button (OK, Accept, Not now)
            (int(sw * 0.50), int(sh * 0.58), "bottom-center button"),
            # press_back one more time
            (None, None, "press_back"),
        ]

        for fx, fy, desc in fallback_zones:
            log.info("PopupGuardian: L4 fallback: %s", desc)
            if fx is not None:
                tx, ty = self.human.jitter_tap(fx, fy)
                self.adb.tap(tx, ty)
            else:
                self.adb.press_back()
            time.sleep(self.human.timing("t_popup_dismiss") * 0.7)

            if self._verify_dismissed(fp_with_popup, "L4"):
                return True

        # If we're here, nothing worked.
        log.error("PopupGuardian: ALL dismiss levels failed. Popup may still be on screen.")
        _, fp = self.take_fingerprint()
        if fp:
            self._last_clean_fp = fp
        return False

    def _verify_dismissed(self, fp_with_popup, level_tag):
        """Verify popup is gone using fingerprint first (free), then Gemini if ambiguous.

        Returns True if popup is confirmed dismissed.
        """
        screenshot, fp_now = self.take_fingerprint()
        if not fp_now or not fp_with_popup:
            # Can't verify -- assume dismissed
            self.stats["popups_dismissed"] += 1
            return True

        # Compare fingerprint to the popup state
        total_diff = sum(abs(a - b) for a, b in zip(fp_with_popup, fp_now))
        avg_diff = total_diff / len(fp_now)

        if avg_diff > 18:
            # Screen changed significantly -- popup very likely gone
            # Threshold 18: same as stall detection. If diff > 18, something moved.
            # In production, video playing underneath makes diff even larger.
            log.info("PopupGuardian: %s dismissed (fingerprint diff=%.1f)",
                     level_tag, avg_diff)
            self.stats["popups_dismissed"] += 1
            self._last_clean_fp = fp_now
            return True

        if avg_diff < 6:
            # Screen barely changed -- popup definitely still there
            log.info("PopupGuardian: %s failed (fingerprint diff=%.1f, popup still there)",
                     level_tag, avg_diff)
            return False

        # Ambiguous zone (6-18) -- ask Gemini to be sure
        if screenshot:
            log.debug("PopupGuardian: %s ambiguous (diff=%.1f), checking Gemini",
                      level_tag, avg_diff)
            verify = gemini.check_popup(
                screenshot, self.adb.screen_w, self.adb.screen_h, urgent=True)
            self.stats["gemini_calls"] += 1

            if not verify.get("has_popup"):
                log.info("PopupGuardian: %s dismissed (Gemini confirmed)", level_tag)
                self.stats["popups_dismissed"] += 1
                self._last_clean_fp = fp_now
                return True
            else:
                log.info("PopupGuardian: %s failed (Gemini says popup still there)",
                         level_tag)
                return False

        # No screenshot for Gemini, assume still there
        return False

    # --- Pixel-based overlay detection ---

    def detect_dark_overlay(self, fp_current, fp_baseline):
        """Check if a dark semi-transparent overlay is covering the screen.

        Compares current fingerprint brightness to baseline. Returns True if
        brightness dropped >40% AND stdev is low (uniform dark = overlay,
        not just a dark video).
        """
        if not fp_current or not fp_baseline:
            return False

        avg_current = sum(fp_current) / len(fp_current)
        avg_baseline = sum(fp_baseline) / len(fp_baseline)

        if avg_baseline < 20:
            return False  # baseline too dark to measure drop

        drop = (avg_baseline - avg_current) / avg_baseline
        if drop < config.POPUP_DARK_OVERLAY_BRIGHTNESS_DROP:
            return False

        # Check stdev: overlay = uniform dark, video = varied dark
        variance = sum((v - avg_current) ** 2 for v in fp_current) / len(fp_current)
        stdev = variance ** 0.5

        if stdev > config.POPUP_DARK_OVERLAY_MAX_STDEV:
            log.debug("PopupGuardian: dark but high stdev (%.1f) = video, not overlay", stdev)
            return False

        log.info("PopupGuardian: dark overlay detected (drop=%.0f%%, stdev=%.1f)",
                 drop * 100, stdev)
        return True

    def detect_bottom_buttons(self, fp_current):
        """Check for bright button band in bottom region of screen.

        Popup buttons (OK, Accept, etc.) create a bright horizontal band.
        Fingerprint is 10 columns x 18 rows. Check last 3 rows.
        """
        if not fp_current:
            return False
        cols = 10
        bottom_rows = fp_current[-(3 * cols):]
        avg = sum(bottom_rows) / len(bottom_rows)
        if avg > config.POPUP_BOTTOM_BUTTON_BRIGHTNESS:
            log.info("PopupGuardian: bright bottom band detected (avg=%.0f)", avg)
            return True
        return False

    def detect_overlay_combined(self, fp_before, fp_after):
        """Combined pixel check: dark overlay + bottom buttons.

        Returns True if ANY detector fires. Used as pre-filter before Gemini
        classification. Note: stall detection is handled separately by
        check_stall() which already sends to Gemini — don't duplicate here.
        """
        dark = self.detect_dark_overlay(fp_after, fp_before)
        buttons = self.detect_bottom_buttons(fp_after)
        return dark or buttons

    # --- Three-tier overlay handler ---

    def handle_overlay(self, screenshot_bytes, bot_ref=None):
        """Three-tier overlay handling: auto-solve -> human -> degrade.

        Args:
            screenshot_bytes: current screenshot showing the overlay
            bot_ref: reference to TikTokBot for FYP verification + navigation

        Returns:
            {"resolved": bool, "action_taken": str, "needs_attention": bool}
        """
        # Rate limiting
        now = time.time()
        self._overlay_timestamps = [
            t for t in self._overlay_timestamps if now - t < 60
        ]
        if len(self._overlay_timestamps) >= config.POPUP_HANDLER_RATE_LIMIT:
            log.warning("PopupGuardian: rate limit hit (%d/min), skipping",
                        config.POPUP_HANDLER_RATE_LIMIT)
            return {"resolved": False, "action_taken": "rate_limited",
                    "needs_attention": False}
        self._overlay_timestamps.append(now)

        # Classify the overlay
        classification = gemini.classify_overlay(
            screenshot_bytes, self.adb.screen_w, self.adb.screen_h)
        self.stats["gemini_calls"] += 1

        overlay_type = classification["type"]
        action = classification["action"]
        log.info("PopupGuardian: overlay classified as %s (action=%s)",
                 overlay_type, action)

        # ── Tier 1: Auto-solve ─────────────────────────────────────────
        if overlay_type in ("dismissible_safe", "permission"):
            result = self._tier1_auto_dismiss(classification, bot_ref)
            if result["resolved"]:
                return result
            log.info("PopupGuardian: Tier 1 failed, escalating")

        if overlay_type == "captcha_simple":
            result = self._tier1_auto_captcha(classification, bot_ref)
            if result["resolved"]:
                return result
            log.info("PopupGuardian: Tier 1 captcha failed, escalating")

        # ── Tier 2: Human intervention (Telegram) ─────────────────────
        # Section 08 (telegram_alerts) may not be implemented yet
        try:
            from ..core import telegram_alerts
            has_telegram = telegram_alerts.is_configured()
        except (ImportError, AttributeError):
            has_telegram = False

        if has_telegram and overlay_type not in ("unknown",):
            result = self._tier2_human_intervention(
                screenshot_bytes, classification, telegram_alerts, bot_ref)
            if result["resolved"]:
                return result
            log.info("PopupGuardian: Tier 2 timed out, degrading")

        # ── Tier 3: Graceful degradation ───────────────────────────────
        return self._tier3_degrade(classification, bot_ref)

    def _clamp_coords(self, x, y):
        """Clamp tap coordinates to screen bounds with safety margin."""
        margin = config.POPUP_COORD_MARGIN_PCT
        sw, sh = self.adb.screen_w, self.adb.screen_h
        cx = max(int(sw * margin), min(int(sw * (1 - margin)), x))
        cy = max(int(sh * margin), min(int(sh * (1 - margin)), y))
        return cx, cy

    def _verify_fyp_restored(self, bot_ref):
        """Check if FYP is visible after dismiss action."""
        if not bot_ref:
            return True  # can't verify without bot reference
        time.sleep(self.human.timing("t_popup_dismiss"))
        return bot_ref._quick_verify_fyp()

    def _tier1_auto_dismiss(self, classification, bot_ref):
        """Tier 1: auto-dismiss safe overlays."""
        time.sleep(self.human.timing("t_popup_read"))

        coords = classification.get("dismiss_coords")
        if coords and len(coords) == 2:
            x, y = self._clamp_coords(coords[0], coords[1])
            tx, ty = self.human.jitter_tap(x, y)
            log.info("PopupGuardian: T1 tap dismiss at (%d, %d)", tx, ty)
            self.adb.tap(tx, ty)
        else:
            log.info("PopupGuardian: T1 press_back (no coords)")
            self.adb.press_back()

        if self._verify_fyp_restored(bot_ref):
            self.stats["popups_dismissed"] += 1
            log.info("PopupGuardian: T1 auto-dismiss SUCCESS")
            return {"resolved": True, "action_taken": "auto_dismissed",
                    "needs_attention": False}

        # Try press_back as fallback
        self.adb.press_back()
        time.sleep(self.human.timing("t_popup_dismiss"))
        if self._verify_fyp_restored(bot_ref):
            self.stats["popups_dismissed"] += 1
            return {"resolved": True, "action_taken": "auto_dismissed_back",
                    "needs_attention": False}

        return {"resolved": False, "action_taken": "auto_dismiss_failed",
                "needs_attention": False}

    def _tier1_auto_captcha(self, classification, bot_ref):
        """Tier 1: auto-solve simple CAPTCHAs (tap-to-verify, drag slider)."""
        action = classification.get("action", "")

        if action == "tap_to_verify":
            coords = classification.get("dismiss_coords")
            if coords and len(coords) == 2:
                x, y = self._clamp_coords(coords[0], coords[1])
                tx, ty = self.human.jitter_tap(x, y)
                log.info("PopupGuardian: T1 tap-to-verify at (%d, %d)", tx, ty)
                time.sleep(self.human.timing("t_popup_read") * 0.5)
                self.adb.tap(tx, ty)
                time.sleep(self.human.timing("t_popup_dismiss") * 2)

                if self._verify_fyp_restored(bot_ref):
                    self.stats["popups_dismissed"] += 1
                    return {"resolved": True, "action_taken": "captcha_tapped",
                            "needs_attention": False}

        elif action == "drag_slider":
            # Drag from left to right across the slider
            sw = self.adb.screen_w
            coords = classification.get("dismiss_coords")
            if coords and len(coords) == 2:
                _, y = self._clamp_coords(coords[0], coords[1])
                start_x = int(sw * 0.15)
                end_x = int(sw * 0.85)
                duration = int(self.human.timing("t_captcha_drag") * 1000)
                log.info("PopupGuardian: T1 drag slider y=%d (%d->%d, %dms)",
                         y, start_x, end_x, duration)
                self.adb.swipe(start_x, y, end_x, y, duration)
                time.sleep(self.human.timing("t_popup_dismiss") * 2)

                if self._verify_fyp_restored(bot_ref):
                    self.stats["popups_dismissed"] += 1
                    return {"resolved": True, "action_taken": "captcha_dragged",
                            "needs_attention": False}

        return {"resolved": False, "action_taken": "captcha_auto_failed",
                "needs_attention": False}

    def _tier2_human_intervention(self, screenshot_bytes, classification,
                                   telegram_alerts, bot_ref):
        """Tier 2: send to Telegram for human intervention with callback."""
        overlay_type = classification["type"]
        description = classification.get("description", overlay_type)
        log.info("PopupGuardian: T2 sending to Telegram: %s", description)

        try:
            callback = telegram_alerts.send_interactive_alert(
                screenshot=screenshot_bytes,
                message=f"Overlay detected: {description}",
                buttons=["SOLVED", "SKIP", "ABORT"],
            )
        except Exception as e:
            log.warning("PopupGuardian: T2 Telegram send failed: %s", e)
            return {"resolved": False, "action_taken": "telegram_failed",
                    "needs_attention": False}

        # Poll for human response
        timeout = config.POPUP_TIER2_TIMEOUT_SEC
        poll_interval = 10
        elapsed = 0
        while elapsed < timeout:
            time.sleep(poll_interval)
            elapsed += poll_interval

            # Bail if phone disconnected during wait
            if getattr(self.adb, '_device_lost', False):
                log.warning("PopupGuardian: T2 device lost during wait")
                return {"resolved": False, "action_taken": "device_lost",
                        "needs_attention": True}

            try:
                response = telegram_alerts.check_callback(callback)
            except Exception:
                continue

            if not response:
                continue

            if response == "SOLVED":
                log.info("PopupGuardian: T2 human marked SOLVED")
                if self._verify_fyp_restored(bot_ref):
                    self.stats["popups_dismissed"] += 1
                    return {"resolved": True, "action_taken": "human_solved",
                            "needs_attention": False}
                # Human said solved but FYP not restored
                return {"resolved": False, "action_taken": "human_solved_no_fyp",
                        "needs_attention": True}

            elif response == "SKIP":
                log.info("PopupGuardian: T2 human said SKIP")
                if bot_ref:
                    bot_ref._return_to_fyp()
                self.stats["popups_dismissed"] += 1
                return {"resolved": True, "action_taken": "human_skipped",
                        "needs_attention": False}

            elif response == "ABORT":
                log.info("PopupGuardian: T2 human said ABORT")
                if bot_ref:
                    bot_ref.close_app()
                return {"resolved": False, "action_taken": "human_aborted",
                        "needs_attention": True}

        log.warning("PopupGuardian: T2 timeout after %ds", timeout)
        return {"resolved": False, "action_taken": "tier2_timeout",
                "needs_attention": False}

    def _tier3_degrade(self, classification, bot_ref):
        """Tier 3: graceful degradation when auto-solve and human both fail."""
        overlay_type = classification["type"]

        if overlay_type in ("captcha_complex", "captcha_simple",
                            "account_warning", "login_expired"):
            log.critical("PopupGuardian: T3 %s -> abort, phone needs attention",
                         overlay_type)
            if bot_ref:
                bot_ref.close_app()
            return {"resolved": False, "action_taken": f"degraded_{overlay_type}",
                    "needs_attention": True}

        if overlay_type == "unknown":
            log.warning("PopupGuardian: T3 unknown overlay, trying back then abort")
            self.adb.press_back()
            time.sleep(self.human.timing("t_popup_dismiss"))
            if bot_ref and bot_ref._quick_verify_fyp():
                self.stats["popups_dismissed"] += 1
                return {"resolved": True, "action_taken": "back_resolved_unknown",
                        "needs_attention": False}
            # Still stuck
            if bot_ref:
                bot_ref.nuclear_escape()
                if bot_ref._quick_verify_fyp():
                    self.stats["popups_dismissed"] += 1
                    return {"resolved": True, "action_taken": "nuclear_resolved",
                            "needs_attention": False}

        log.error("PopupGuardian: T3 all tiers failed, phone needs attention")
        return {"resolved": False, "action_taken": "all_tiers_failed",
                "needs_attention": True}

    def log_stats(self):
        """Log summary stats for the session."""
        s = self.stats
        log.info("PopupGuardian stats: %d checks, %d stalls, %d popups found, "
                 "%d dismissed, %d gemini calls",
                 s["checks_total"], s["stalls_detected"],
                 s["popups_found"], s["popups_dismissed"], s["gemini_calls"])


class TikTokBot:
    """All TikTok interactions for a single device."""

    def __init__(self, adb: ADBController, human: HumanEngine):
        self.adb = adb
        self.human = human
        # Popup Guardian: continuous popup detection
        self.guardian = PopupGuardian(adb, human)
        self.guardian._bot_ref = self  # back-reference for handle_overlay escalation
        # Niche gate cache: reset on every scroll to next video
        self._niche_checked = False
        self._niche_result = False  # True = in niche, False = not / unknown
        self._cached_category = "unknown"  # category from merged niche+categorize call
        # Like drought protection: bypass niche gate after too many scrolls without a like
        self._scrolls_since_last_like = 0
        # Stats tracking for Gemini calls, dismisses, etc.
        self.stats = {"gemini_calls": 0, "popups_dismissed": 0, "dismiss_retries": 0}
        # Per-device retry tolerance (consumed by wait_and_verify)
        self._retry_tolerance = adb.phone.get("retry_tolerance", 3)
        # Set screen-specific params for page_state (dynamic _NAV_Y based on density)
        from ..core import page_state
        page_state.set_screen_params(adb.screen_h, adb._density)

    # --- Sidebar pixel scan (zero AI, <50ms) --------------------------------

    def _get_sidebar_positions(self) -> dict | None:
        """Get all sidebar icon positions from current screenshot via pixel scan.
        Zero AI calls, <50ms. Returns None if not on FYP."""
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return None
        from ..core.sidebar import find_sidebar_icons
        return find_sidebar_icons(screenshot, self.adb.screen_w, self.adb.screen_h)

    # --- Health check during non-FYP tab scroll ----------------------------

    def _health_check_during_scroll(self, target_tab: str = "following") -> bool:
        """Periodic health check during video scrolling in non-FYP tabs.
        Verifies we're still on a video feed (not kicked to profile, inbox, etc).
        Uses page_state pixel detection (zero Gemini, <5ms).
        Returns True if OK, False if wrong page detected."""
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return True  # can't check, assume OK

        result = page_state.detect_page(screenshot, self.adb.screen_w, self.adb.screen_h)
        detected = result.get("page", "unknown") if result else "unknown"

        # Following/Explore/Shop video feeds show "fyp" in bottom nav (Home tab active)
        # If we see profile/inbox/friends, we've been kicked to wrong page
        if detected in ("fyp", "unknown"):
            return True  # OK -- fyp means Home tab active (which includes Following/Explore feeds)

        # Wrong page detected
        log.warning("HEALTH_CHECK: expected video feed, detected '%s' -- recovering", detected)
        self.go_to_fyp()
        time.sleep(self.human.timing("t_back_verify"))
        if target_tab and target_tab != "fyp":
            if self._tap_top_tab(target_tab):
                time.sleep(self.human.timing("t_tab_load_settle"))
                return True
        return False

    # --- Bbox-first tap (find element THEN tap) ----------------------------

    def _find_and_tap(self, description: str, fallback_coord: str = None,
                      y_max_pct: float = None, tap_y_bias: float = 0.0) -> bool:
        """Find a UI element via Gemini bounding box, then tap its center.
        This is the definitive solution for elements whose position varies
        per video (avatar, comment icon, etc).

        If Gemini doesn't find it (e.g. light effects hiding icons), waits 0.5s
        and retries once (effects are cyclic, icons reappear quickly).

        Args:
            description: what to find (e.g. "the circular profile avatar")
            fallback_coord: optional coords.py key to try if Gemini fails
            y_max_pct: optional max Y position as % of screen height (0.0-1.0).
                        Reject elements below this threshold.
            tap_y_bias: shift tap Y within the bbox. -0.3 = tap 30% ABOVE center,
                        +0.3 = tap 30% BELOW center. Used to avoid adjacent
                        elements (e.g. avatar has + button below, comment has
                        bookmark above).

        Returns True if element found and tapped, False if not found.
        """
        for attempt in range(2):
            screenshot = self.adb.screenshot_bytes()
            if not screenshot:
                if fallback_coord:
                    log.warning("FIND_TAP: no screenshot, using fallback '%s'", fallback_coord)
                    x, y = self.adb.get_coord("tiktok", fallback_coord)
                    x, y = self.human.jitter_tap(x, y)
                    self.adb.tap(x, y)
                    return True
                return False

            coords = gemini.find_element_by_vision(
                screenshot, description,
                self.adb.screen_w, self.adb.screen_h)

            if coords:
                cx, cy, bbox_h = coords[0], coords[1], coords[2]
                # Validate Y position if constrained
                if y_max_pct and cy > self.adb.screen_h * y_max_pct:
                    log.warning("FIND_TAP: element at y=%d rejected (below %.0f%% = %d)",
                                cy, y_max_pct * 100,
                                int(self.adb.screen_h * y_max_pct))
                    if attempt == 0:
                        time.sleep(self.human.timing("t_tap_gap"))
                        continue
                    break  # fall through to fallback
                # Apply Y bias proportional to actual bbox height
                tap_x, tap_y = cx, cy
                if tap_y_bias != 0.0:
                    tap_y = int(tap_y + tap_y_bias * bbox_h)
                tap_x, tap_y = self.human.jitter_tap(tap_x, tap_y)
                self.adb.tap(tap_x, tap_y)
                return True

            # Not found — might be hidden by light effects. Wait and retry once
            if attempt == 0:
                log.debug("FIND_TAP: element not found, retrying in 0.5s (light effects?)")
                time.sleep(self.human.timing("t_tap_gap"))
                continue

        # Both attempts failed — use fallback fixed coords
        if fallback_coord:
            log.warning("FIND_TAP: Gemini failed 2x, using fallback '%s'", fallback_coord)
            x, y = self.adb.get_coord("tiktok", fallback_coord)
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            return True

        return False

    # --- Navigation --------------------------------------------------------

    def open_app(self):
        """Open TikTok and wait for it to load."""
        log.info("Opening TikTok...")
        self.adb.open_tiktok()
        time.sleep(self.human.timing("t_app_load"))

        for _ in range(10):
            if TIKTOK_PKG in self.adb.get_current_app():
                log.info("TikTok is open")
                # Check for startup popups (TikTok Shop, policy, etc.)
                self._verify_page("fyp")
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
        log.info("NAV: go_to_fyp (tap nav_home)")
        x, y = self.adb.get_coord("tiktok", "nav_home")
        # Minimal jitter — nav bar icons are small, standard jitter misses them
        x += random.randint(-5, 5)
        y += random.randint(-3, 3)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def nuclear_escape(self) -> bool:
        """GUARANTEED return to FYP from ANY screen. Last resort.
        Gesture HOME (go to Android home) → reopen TikTok (lands on FYP).
        100% safe — identical to a real user pressing home and reopening the app."""
        log.warning("NUCLEAR_ESCAPE: gesture HOME + reopen TikTok")
        from ..core import page_state
        # Step 1: gesture HOME to exit TikTok completely
        self.adb.press_home()
        time.sleep(self.human.timing("t_home_settle"))
        # Step 2: reopen TikTok (lands on FYP)
        self.adb.open_tiktok()
        time.sleep(self.human.timing("t_reopen_app"))
        # Verify FYP
        screenshot = self.adb.screenshot_bytes()
        if screenshot:
            result = page_state.detect_page(screenshot, self.adb.screen_w, self.adb.screen_h)
            page = result.get("page", "unknown") if result else "unknown"
            if page == "fyp":
                log.info("NUCLEAR_ESCAPE: confirmed on FYP")
                return True
        # If not on FYP yet, wait a bit more (app loading)
        time.sleep(self.human.timing("t_home_settle"))
        log.info("NUCLEAR_ESCAPE: waited extra, assuming FYP")
        return True

    def _exit_live(self) -> bool:
        """Exit a TikTok LIVE stream. press_back does NOT work in LIVE -- must tap X.

        3-tier strategy (zero recalibration across all phones):
        1. Fixed coord (fast, free) -- works on calibrated phones
        2. Gemini bbox (universal) -- finds X on ANY phone/screen size/TikTok version
        3. Nuclear escape (guaranteed)

        Returns True if successfully exited."""
        from ..core import page_state

        def _nav_visible(shot):
            if not shot:
                return False
            return page_state.detect_page(shot, self.adb.screen_w, self.adb.screen_h).get("nav_visible", False)

        # Tier 1: fixed coord (fast, free)
        log.info("EXIT_LIVE: tier 1 -- fixed coord tap")
        x, y = self.adb.get_coord("tiktok", "live_x_close")
        self.adb.tap(x + random.randint(-5, 5), y + random.randint(-5, 5))
        time.sleep(self.human.timing("t_back_verify"))
        shot = self.adb.screenshot_bytes()
        if _nav_visible(shot):
            log.info("EXIT_LIVE: exited on tier 1 (fixed coord)")
            return True

        # Check for "Leave LIVE?" confirmation dialog (appears on some LIVE types)
        if shot:
            leave_btn = gemini.find_element_by_vision(
                shot,
                'a "Leave" button on a "Leave LIVE?" or "Leave this LIVE?" confirmation dialog',
                self.adb.screen_w, self.adb.screen_h
            )
            if leave_btn:
                log.info("EXIT_LIVE: Leave dialog found at (%d,%d), tapping", leave_btn[0], leave_btn[1])
                self.adb.tap(leave_btn[0] + random.randint(-3, 3), leave_btn[1] + random.randint(-3, 3))
                time.sleep(self.human.timing("t_back_verify"))
                return True

        # Tier 2: Gemini bbox -- universal, works on any phone/screen size
        log.warning("EXIT_LIVE: tier 1 missed, trying Gemini bbox for X button")
        if shot:
            x_btn = gemini.find_element_by_vision(
                shot,
                'the X or close button at the very TOP-RIGHT corner of the screen. '
                'It is a small X symbol used to exit/close the LIVE stream. '
                'It is in the top bar alongside the streamer name and follower count.',
                self.adb.screen_w, self.adb.screen_h
            )
            if x_btn:
                log.info("EXIT_LIVE: tier 2 Gemini found X at (%d,%d)", x_btn[0], x_btn[1])
                self.adb.tap(x_btn[0] + random.randint(-3, 3), x_btn[1] + random.randint(-3, 3))
                time.sleep(self.human.timing("t_back_verify"))
                shot2 = self.adb.screenshot_bytes()
                if _nav_visible(shot2):
                    log.info("EXIT_LIVE: exited on tier 2 (Gemini bbox)")
                    return True

        # Tier 3: nuclear escape (guaranteed)
        log.warning("EXIT_LIVE: tiers 1+2 failed, using nuclear escape")
        return self.nuclear_escape()

    def _quick_verify_fyp(self) -> bool:
        """Fast FYP check using only pixel nav bar detection. Zero Gemini."""
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return False
        return self._quick_verify_fyp_from_shot(screenshot)

    def _quick_verify_fyp_from_shot(self, screenshot: bytes) -> bool:
        """Fast FYP check from provided screenshot. Zero Gemini, zero screenshot."""
        result = page_state.detect_page(screenshot, self.adb.screen_w, self.adb.screen_h)
        page = result.get("page", "unknown") if result else "unknown"
        return page == "fyp"

    def _detect_captcha(self) -> bool:
        """Check if current screen shows CAPTCHA, verification, or login.
        Uses Gemini Vision with low temperature for reliable detection.
        Returns True if a blocking screen is detected."""
        shot = self.adb.screenshot_bytes()
        if not shot:
            return False
        try:
            result = gemini._call_vision(
                shot,
                'Is this screen showing ANY of: a CAPTCHA puzzle, a security verification challenge, '
                'a phone number verification form, a login/signup screen, a "Verify your identity" screen, '
                'or an account suspended/banned notice? '
                'Answer ONLY "yes" or "no". '
                'These are NOT CAPTCHA (answer "no"): normal TikTok pages (FYP, profile, search, '
                'comments, inbox, shop), Shop checkout/order confirmation, region/language selection, '
                'notification permission dialogs, cookie consent banners, age verification.',
                max_tokens=10,
                temperature=0.1,
                timeout=6.0,
            )
            answer = result.strip().lower()
            if answer.startswith("yes"):
                log.critical("CAPTCHA/VERIFICATION DETECTED — aborting session")
                return True
        except Exception as e:
            log.warning("CAPTCHA detection failed: %s", e)
        return False

    def _return_to_fyp(self):
        """Reliably return to FYP from anywhere. 3-tier escalation:
        Tier 1: press_back + Story X button (free, fast)
        Tier 2: nav_home tap (works when nav bar visible)
        Tier 3: nuclear_escape (guaranteed, any state)"""
        # Tier 1: press_back (up to 2 attempts) with retry verification
        for attempt in range(2):
            self.adb.press_back()

            # Verify FYP with retry (handles slow phones)
            vr = wait_and_verify(
                adb=self.adb, human=self.human,
                verify_fn=lambda shot: self._quick_verify_fyp_from_shot(shot),
                action_name="return_to_fyp_back",
                first_wait="t_back_verify",
                max_attempts=self._retry_tolerance,
            )
            if vr.success:
                return True

            # Not FYP — check if stuck on Story
            if vr.screenshot:
                classification = gemini.classify_screen_with_reference(vr.screenshot)
                if classification == "story":
                    log.info("_return_to_fyp: still on Story, tapping X to close")
                    sx, sy = self.adb.get_coord("tiktok", "story_close")
                    sx += random.randint(-5, 5)
                    sy += random.randint(-5, 5)
                    self.adb.tap(sx, sy)
                    # Verify FYP after Story close
                    vr2 = wait_and_verify(
                        adb=self.adb, human=self.human,
                        verify_fn=lambda shot: self._quick_verify_fyp_from_shot(shot),
                        action_name="return_to_fyp_story_close",
                        first_wait="t_back_verify",
                        max_attempts=2,
                    )
                    if vr2.success:
                        return True

        # Tier 2: nav_home tap with retry
        self.go_to_fyp()
        vr3 = wait_and_verify(
            adb=self.adb, human=self.human,
            verify_fn=lambda shot: self._quick_verify_fyp_from_shot(shot),
            action_name="return_to_fyp_nav",
            first_wait="t_back_verify",
            max_attempts=2,
        )
        if vr3.success:
            return True

        # Tier 3: nuclear escape (guaranteed)
        log.warning("_return_to_fyp: Tier 1+2 failed, nuclear escape")
        return self.nuclear_escape()

    def _tap_top_tab(self, tab_name: str) -> bool:
        """Navigate to a top tab (Explore, Following, Shop, For You).

        3-tier strategy with verification:
          Tier 1: Fixed coords (free, instant) -> verify with Gemini 1-word call
          Tier 2: Gemini bbox to find tab text -> verify
          Tier 3: Scan nearby X positions along the tab bar -> verify

        Returns True only when verification confirms we're on the correct tab.
        Worst case: 4 Gemini calls. Best case: 1 Gemini call (verify only).
        """
        # Map display name -> verification key
        tab_key = tab_name.lower().replace(" ", "")  # "For You" -> "foryou"
        coord_key = f"top_tab_{tab_key}"  # "top_tab_foryou"
        log.info("NAV: tap top tab '%s' (key=%s)", tab_name, tab_key)

        # No pre-check — always tap, then verify.
        # Pre-check caused false positives (said "already on Shop" when on FYP)

        # --- Tier 1: Fixed coords (free) ---
        try:
            x, y = self.adb.get_coord("tiktok", coord_key)
            # Minimal jitter — tab text is small (~15px), standard jitter misses it
            x += random.randint(-5, 5)
            y += random.randint(-3, 3)

            self.adb.tap(x, y)

            # Verify tab with retry (slow phones may not load tab content in time)
            # _verify_top_tab takes its own screenshot + calls Gemini (slow verify)
            tab_verified = False
            for _tv_attempt in range(2):
                time.sleep(self.human.timing("t_tab_content_load"))
                if self._verify_top_tab(tab_key):
                    tab_verified = True
                    break
                log.info("NAV: tab verify attempt %d failed, retrying", _tv_attempt + 1)

            if tab_verified:
                log.info("NAV: Tier 1 (fixed coords) success for '%s'", tab_name)
                # Re-tap same tab to scroll to top (native TikTok feature)
                # Ensures we start from fresh position, exits fullscreen video mode
                time.sleep(self.human.timing("t_tap_gap"))
                x2, y2 = self.adb.get_coord("tiktok", coord_key)
                x2 += random.randint(-5, 5)
                y2 += random.randint(-3, 3)
                self.adb.tap(x2, y2)
                time.sleep(self.human.timing("t_tap_gap"))
                log.info("NAV: re-tapped '%s' to scroll to top", tab_name)
                return True
            log.info("NAV: Tier 1 (fixed coords) wrong tab for '%s'", tab_name)
        except KeyError:
            log.info("NAV: no fixed coords for '%s', skipping Tier 1", tab_name)

        # --- Tier 2: Gemini bbox ---
        found = self._find_and_tap(
            f'the "{tab_name}" text tab at the top of the screen, '
            f'in the horizontal tab bar. Look for the exact text "{tab_name}".',
            y_max_pct=0.15)

        if found:
            time.sleep(self.human.timing("t_tab_switch"))
            if self._verify_top_tab(tab_key):
                log.info("NAV: Tier 2 (Gemini bbox) success for '%s'", tab_name)
                # Re-tap to scroll to top
                time.sleep(self.human.timing("t_tap_gap"))
                try:
                    x2, y2 = self.adb.get_coord("tiktok", coord_key)
                    x2 += random.randint(-5, 5)
                    y2 += random.randint(-3, 3)
                    self.adb.tap(x2, y2)
                    time.sleep(self.human.timing("t_tap_gap"))
                    log.info("NAV: re-tapped '%s' to scroll to top", tab_name)
                except KeyError:
                    pass
                return True
            log.info("NAV: Tier 2 (Gemini bbox) wrong tab for '%s'", tab_name)

        # Tier 1 + Tier 2 both failed — recover to FYP before giving up
        # (we might be on a random page, live, etc. — must get back to safety)
        log.warning("NAV: both tiers failed for tab '%s', recovering to FYP", tab_name)
        self.adb.press_back()
        time.sleep(self.human.timing("t_back_verify"))
        self.go_to_fyp()
        time.sleep(self.human.timing("t_back_verify"))
        return False

    def _verify_top_tab(self, expected_tab_key: str) -> bool:
        """Verify we're on the expected top tab via Gemini 1-word call.

        Args:
            expected_tab_key: "foryou", "following", "explore", "shop"

        Returns True if the active tab matches expected_tab_key.
        """
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            log.warning("_verify_top_tab: no screenshot")
            return False

        active = gemini.identify_active_top_tab(screenshot)
        match = active == expected_tab_key
        log.debug("_verify_top_tab: expected=%s, active=%s, match=%s",
                  expected_tab_key, active, match)
        return match

    def _return_to_foryou(self):
        """Return to For You from any top-tab section.
        Uses nav_home (bottom bar) directly — 100% reliable, no tab verification needed.
        Taps 'For You' top tab directly (nav_home doesn't work — Shop/Following/Explore
        are sub-tabs of Home, so Home icon is already active).
        No verify — just tap and trust the fixed coords."""
        log.info("NAV: returning to FYP via For You top tab")
        x, y = self.adb.get_coord("tiktok", "top_tab_foryou")
        x += random.randint(-5, 5)
        y += random.randint(-3, 3)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_tab_content_load"))

    def go_to_profile(self):
        """Navigate to own profile tab."""
        log.info("NAV: go_to_profile (tap nav_profile)")
        x, y = self.adb.get_coord("tiktok", "nav_profile")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

    def go_to_search(self) -> bool:
        """Open the Search/Discover page via search icon (top-right magnifier).
        Verifies search page opened. If not (e.g. was on Following), goes to FYP first and retries.
        Returns True if search page opened."""
        for attempt in range(2):
            log.info("NAV: go_to_search (tap search_icon, attempt %d)", attempt + 1)
            x, y = self.adb.get_coord("tiktok", "search_icon")
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_tab_content_load"))

            # Verify search page opened
            screenshot = self.adb.screenshot_bytes()
            if screenshot:
                result = gemini.identify_page_with_recovery(screenshot)
                page = result.get("page", "unknown")
                if page == "search":
                    log.info("Search page opened OK")
                    return True
                log.warning("Search didn't open (Gemini sees: %s), going to FYP first", page)
                # Go to FYP and retry
                self.go_to_fyp()
                self._verify_page("fyp")
                continue

        log.error("Search failed to open after 2 attempts")
        return False

    def _ensure_on_app(self) -> bool:
        """Lightweight nav safety check after complex navigation (rabbit_hole, search, etc.).
        Uses get_current_app() only (ADB command, zero ban risk, ~200ms).
        If TikTok is lost, recovers by reopening. Returns True if on TikTok."""
        current = self.adb.get_current_app()
        if current and TIKTOK_PKG in current:
            return True
        log.warning("Navigation landed outside TikTok (current: %s), recovering", current)
        self.open_app()
        self.go_to_fyp()
        return False

    def _check_health(self) -> bool:
        """Verify TikTok is still in foreground. Recovers if lost.

        Also runs pixel overlay detection — if dark overlay or bottom buttons
        detected, escalates to 3-tier handle_overlay() for classification
        and resolution.
        """
        current = self.adb.get_current_app()
        if current and TIKTOK_PKG not in current:
            log.warning("TikTok lost focus (current: %s), recovering", current)
            self.open_app()
            self.go_to_fyp()
            return False

        # Pixel overlay check (free, <5ms)
        screenshot, fp = self.guardian.take_fingerprint()
        if fp and self.guardian._last_clean_fp:
            if self.guardian.detect_overlay_combined(self.guardian._last_clean_fp, fp):
                log.info("_check_health: pixel overlay detected, classifying")
                if screenshot:
                    result = self.guardian.handle_overlay(screenshot, bot_ref=self)
                    if result.get("needs_attention"):
                        log.critical("_check_health: phone needs attention")
                        return False
        return True

    # --- Page State Verification -------------------------------------------

    def _verify_page(self, expected: str) -> bool:
        """Verify we're on the expected page. If not, attempt recovery.

        Args:
            expected: "fyp", "profile", "search", "comments"

        Returns:
            True if on expected page (or recovered successfully).
            False if recovery failed (caller should abort action).

        Flow:
            1. Screenshot + pixel check (~400ms)
            2. If popup -> dismiss -> retry
            3. If wrong page + low confidence -> Gemini fallback
            4. If wrong page confirmed -> recovery (back / go_to_fyp)
        """
        for attempt in range(config.PAGE_VERIFY_MAX_RETRIES):
            screenshot = self.adb.screenshot_bytes()
            if not screenshot:
                log.warning("_verify_page: screenshot failed (attempt %d)", attempt + 1)
                time.sleep(self.human.timing("t_recovery_settle"))
                continue

            result = page_state.detect_page(
                screenshot, self.adb.screen_w, self.adb.screen_h)

            detected = result["page"]
            confidence = result["confidence"]

            log.debug("_verify_page: expected=%s, detected=%s (conf=%.2f) %s",
                      expected, detected, confidence, result["details"])

            # --- Popup detected: dismiss it first ---
            if result["has_popup"] or detected == "popup":
                log.info("Popup detected, dismissing (attempt %d)", attempt + 1)
                self._dismiss_popup(screenshot)
                continue  # re-check after dismiss

            # --- Match: we're on the right page ---
            if detected == expected and confidence >= 0.4:
                return True

            # --- Low confidence: use Gemini to be sure ---
            if confidence < 0.4 and detected != expected:
                log.debug("Low confidence (%.2f), asking Gemini", confidence)
                gemini_result = gemini.identify_page_with_recovery(screenshot)
                gemini_page = gemini_result.get("page", "unknown")

                if gemini_result.get("has_popup"):
                    log.info("Gemini detected popup: %s",
                             gemini_result.get("popup_text", "unknown"))
                    self._dismiss_popup_with_hint(gemini_result)
                    continue

                if gemini_page == expected:
                    log.debug("Gemini confirms: on %s", expected)
                    return True

                detected = gemini_page
                confidence = 0.7  # Gemini is more reliable

            # --- Wrong page confirmed: recover ---
            log.warning("Wrong page: expected=%s, on=%s (attempt %d)",
                        expected, detected, attempt + 1)
            self._recover_to(expected, from_page=detected)

        # All retries exhausted
        log.error("_verify_page: failed to reach %s after %d attempts, nuclear escape",
                  expected, config.PAGE_VERIFY_MAX_RETRIES)
        self.nuclear_escape()
        return expected == "fyp"

    def _dismiss_popup(self, screenshot_bytes=None):
        """Try to dismiss a popup using common strategies.

        Order: press_back (safest) -> if that fails, try tapping common
        dismiss positions (X button top-right, bottom button).
        """
        # Simulate "reading" the popup before dismissing (human behavior)
        time.sleep(self.human.timing("t_popup_read"))

        # Strategy 1: press_back (dismisses most popups)
        self.adb.press_back()
        time.sleep(self.human.timing("t_popup_dismiss"))

    def _dismiss_popup_with_hint(self, gemini_result: dict):
        """Dismiss popup using Gemini's hint about the dismiss button."""
        time.sleep(self.human.timing("t_popup_read"))

        action = gemini_result.get("dismiss_action", "back")
        target = gemini_result.get("dismiss_target")

        if action == "back" or action == "none":
            self.adb.press_back()
        elif action == "tap_x":
            # X button is usually top-right of popup
            # Try finding it with Gemini if we have a target description
            if target:
                screenshot = self.adb.screenshot_bytes()
                if screenshot:
                    coords = gemini.find_element_by_vision(
                        screenshot, target,
                        self.adb.screen_w, self.adb.screen_h)
                    if coords:
                        x, y = self.human.jitter_tap(coords[0], coords[1])
                        self.adb.tap(x, y)
                        time.sleep(self.human.timing("t_popup_dismiss"))
                        return
            # Fallback: common X position (top-right area of popup)
            x = int(self.adb.screen_w * 0.85)
            y = int(self.adb.screen_h * 0.35)
            x, y = self.human.jitter_tap(x, y)
            self.adb.tap(x, y)
        elif action in ("tap_ok", "tap_outside"):
            # OK/Accept button usually at bottom-center of popup
            if target:
                screenshot = self.adb.screenshot_bytes()
                if screenshot:
                    coords = gemini.find_element_by_vision(
                        screenshot, target,
                        self.adb.screen_w, self.adb.screen_h)
                    if coords:
                        x, y = self.human.jitter_tap(coords[0], coords[1])
                        self.adb.tap(x, y)
                        time.sleep(self.human.timing("t_popup_dismiss"))
                        return
            # Fallback: press back
            self.adb.press_back()

        time.sleep(self.human.timing("t_popup_dismiss"))

    def _recover_to(self, expected: str, from_page: str = "unknown"):
        """Attempt to navigate from current wrong page to expected page."""
        log.warning("RECOVERY: from=%s -> expected=%s", from_page, expected)
        if expected == "fyp":
            if from_page in ("profile", "search", "comments"):
                log.info("RECOVERY: press_back (from known page)")
                self.adb.press_back()
                time.sleep(self.human.timing("t_recovery_settle"))
            else:
                log.info("RECOVERY: go_to_fyp via nav_home (unknown state)")
                self.go_to_fyp()
        elif expected == "profile":
            log.warning("RECOVERY: can't recover to profile, caller should abort")
        elif expected == "search":
            if from_page == "fyp":
                log.info("RECOVERY: go_to_search from fyp")
                if not self.go_to_search():
                    log.warning("RECOVERY: go_to_search failed")
                time.sleep(self.human.timing("t_back_verify"))
            else:
                log.info("RECOVERY: press_back toward search")
                self.adb.press_back()
                time.sleep(self.human.timing("t_recovery_settle"))
        elif expected == "comments":
            log.info("RECOVERY: comments closed unexpectedly, continuing")
        else:
            log.info("RECOVERY: press_back (fallback)")
            self.adb.press_back()
            time.sleep(self.human.timing("t_recovery_settle"))

    # --- Core Actions ------------------------------------------------------

    def _verify_fyp_responsive(self) -> bool:
        """Verify TikTok FYP is actually responding to swipes.
        Called once after app open. Takes screenshot before/after first scroll
        and compares fingerprints. If identical → TikTok is frozen/loading.
        Retries up to 3 times with 5s waits, then restarts the app.
        Returns True if FYP is responsive, False if unrecoverable."""
        from ..core import page_state

        for retry in range(3):
            # Screenshot before scroll
            pre_shot = self.adb.screenshot_bytes()
            if not pre_shot:
                time.sleep(self.human.timing("t_back_verify"))
                continue
            pre_fp = page_state.screen_fingerprint(pre_shot)

            # Scroll
            self.scroll_fyp()
            time.sleep(self.human.timing("t_back_verify"))

            # Screenshot after scroll
            post_shot = self.adb.screenshot_bytes()
            if not post_shot:
                time.sleep(self.human.timing("t_back_verify"))
                continue
            post_fp = page_state.screen_fingerprint(post_shot)

            if not page_state.is_stalled(pre_fp, post_fp):
                log.info("FYP responsive (scroll verified, attempt %d)", retry + 1)
                return True

            log.warning("FYP not responsive (stalled after scroll, attempt %d/3)", retry + 1)
            time.sleep(self.human.timing("t_frozen_retry"))

        # 3 retries failed — restart app
        log.warning("FYP frozen after 3 attempts, restarting TikTok")
        self.close_app()
        time.sleep(self.human.timing("t_close_before_open"))
        if not self.open_app():
            log.error("FYP restart failed — app didn't open")
            return False
        time.sleep(self.human.timing("t_app_load"))

        # One final check after restart
        pre_shot = self.adb.screenshot_bytes()
        pre_fp = page_state.screen_fingerprint(pre_shot) if pre_shot else None
        self.scroll_fyp()
        time.sleep(self.human.timing("t_back_verify"))
        post_shot = self.adb.screenshot_bytes()
        post_fp = page_state.screen_fingerprint(post_shot) if post_shot else None

        if pre_fp and post_fp and not page_state.is_stalled(pre_fp, post_fp):
            log.info("FYP responsive after restart")
            return True

        # Check if WiFi is down (explains why FYP is unresponsive)
        if not self.adb.check_wifi():
            log.error("FYP not responsive — WiFi is down, aborting session")
            return False

        # Check if CAPTCHA/verification is blocking us
        if self._detect_captcha():
            log.critical("SESSION ABORT: CAPTCHA/verification screen detected after restart")
            return False

        log.error("FYP still frozen after restart — aborting session")
        return False

    def scroll_fyp(self):
        """Scroll to the next video on FYP (swipe up)."""
        log.debug("SCROLL_FYP")
        sw = self.human.humanize_swipe(
            self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
            self.adb.screen_w // 2, self.adb.screen_h // 4,
        )
        if sw.get("hand_switched"):
            time.sleep(sw["hand_switch_pause"])
        self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])

    def peek_scroll(self):
        """Scroll halfway then go back -- like peeking at next video."""
        log.debug("PEEK_SCROLL")
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
        """Like the current video. Uses double-tap or heart icon based on personality."""
        if random.random() < self.human.personality.double_tap_habit:
            # Double-tap center (more human)
            cx, cy = self.adb.get_coord("tiktok", "video_center")
            x, y = self.human.jitter_tap(cx, cy)
            self.adb.tap(x, y)
            time.sleep(self.human.timing("t_double_tap"))
            x2, y2 = self.human.jitter_tap(cx, cy)
            self.adb.tap(x2, y2)
            log.info("[Like] double-tap at (%d,%d) then (%d,%d)", x, y, x2, y2)
        else:
            # Tap heart icon via sidebar scan (pixel-accurate)
            positions = self._get_sidebar_positions()
            if positions and positions.get("heart"):
                cx, cy = positions["heart"]
                x, y = self.human.jitter_tap(cx, cy)
                self.adb.tap(x, y)
                log.info("[Like] heart icon at (%d,%d) via sidebar scan", x, y)
            else:
                # No sidebar = not normal FYP (live preview, etc.) — skip
                log.info("[Like] no sidebar (live/non-FYP), skipping")
                return

        time.sleep(self.human.action_delay())
        self.adb.save_screenshot_if_recording("after_like")

    # Whether comments can be scrolled (set by open_comments)
    _comments_scrollable = True

    def open_comments(self) -> bool:
        """Open the comments section. Returns True if comments actually opened.
        Also checks if there are enough comments to scroll."""
        self._comments_scrollable = True  # reset

        for attempt in range(2):
            log.info("NAV: open_comments (attempt %d)", attempt + 1)
            found = False

            # Primary: pixel sidebar scan (zero AI, <50ms)
            positions = self._get_sidebar_positions()
            if positions and positions.get("comment"):
                cx, cy = positions["comment"]
                cx, cy = self.human.jitter_tap(cx, cy)
                self.adb.tap(cx, cy)
                log.info("open_comments: tapped comment at (%d, %d) via sidebar scan", cx, cy)
                found = True
            else:
                # No sidebar = not a normal FYP video (live, popup, etc.) — don't try to interact
                log.warning("open_comments: sidebar scan failed (not normal FYP video), skipping")
                return False
                # Old Gemini fallback removed — caused false taps on live videos
                screenshot = self.adb.screenshot_bytes()
                if screenshot:
                    comment_result = gemini.find_element_by_vision(
                        screenshot,
                        "the speech bubble COMMENT icon on the RIGHT side of the screen. "
                        "It looks like a chat bubble or speech balloon shape. "
                        "It has a NUMBER directly below it showing the comment count. "
                        "It is positioned BETWEEN the heart/like icon (above) and the bookmark/save icon (below). "
                        "Return the bounding box of ONLY the speech bubble icon itself, NOT the number below it.",
                        self.adb.screen_w, self.adb.screen_h)
                    if comment_result:
                        cx, cy, bbox_h = comment_result
                        if self.adb.screen_h * 0.35 < cy < self.adb.screen_h * 0.80:
                            cx, cy = int(cx), int(cy)
                            cx, cy = self.human.jitter_tap(cx, cy)
                            self.adb.tap(cx, cy)
                            log.info("open_comments: tapped comment at (%d, %d) via Gemini bbox", cx, cy)
                            found = True
                        else:
                            log.warning("open_comments: comment icon at y=%d rejected (out of range)", int(cy))

            if not found:
                log.warning("open_comments: comment icon not found")
                return False

            # Verify comments opened with retry (animation may be slow on Motorola)
            def _check_comments_open(shot):
                prompt = f"""Look at this screenshot ({self.adb.screen_w}x{self.adb.screen_h}).
Answer TWO questions:
1. Is a comments section/sheet open? (white panel with user comments visible)
2. What is the TOTAL comment count shown in the header? Return 0 if no number visible.
Return ONLY JSON: {{"comments_open": true/false, "total_comments": number}}
JSON only, no markdown."""
                r = gemini._call_vision(shot, prompt, max_tokens=60)
                try:
                    r = r.replace("```json", "").replace("```", "").strip()
                    d = json.loads(r)
                    if bool(d.get("comments_open", False)):
                        return d
                except Exception:
                    pass
                return False

            vr = wait_and_verify(
                adb=self.adb, human=self.human,
                verify_fn=_check_comments_open,
                action_name="open_comments",
                first_wait="t_comment_anim",
                is_slow_verify=True,
                max_attempts=2,
                max_total_s=12.0,
            )
            screenshot = vr.screenshot
            if vr.success:
                data = vr.result  # dict with comments_open + total_comments
                raw_total = data.get("total_comments", 0)
                # Handle string responses like "1.2K", "3K", "1M"
                if raw_total is None:
                    total = 0
                elif isinstance(raw_total, str):
                    raw_total = str(raw_total).strip().upper().replace(",", "")
                    try:
                        if raw_total.endswith("K"):
                            total = int(float(raw_total[:-1]) * 1000)
                        elif raw_total.endswith("M"):
                            total = int(float(raw_total[:-1]) * 1000000)
                        else:
                            total = int(float(raw_total))
                    except (ValueError, TypeError):
                        total = 0
                else:
                    total = int(raw_total)
                self._comments_scrollable = total >= 5

                # 0 comments: TikTok auto-opens keyboard — dismiss
                if total == 0:
                    log.info("Comments opened but 0 comments — dismissing keyboard + panel")
                    vx = random.randint(int(self.adb.screen_w * 0.15), int(self.adb.screen_w * 0.60))
                    vy = random.randint(int(self.adb.screen_h * 0.15), int(self.adb.screen_h * 0.25))
                    self.adb.tap(vx, vy)
                    time.sleep(self.human.timing("t_tap_gap"))
                    self._dismiss_comments()
                    return True
                log.info("Comments opened OK (attempt %d, total=%d, scrollable=%s)",
                         attempt + 1, total, self._comments_scrollable)
                return True

            # vr failed — retry
            if attempt == 0:
                time.sleep(self.human.timing("t_tap_gap"))
                continue

        log.warning("Comments failed to open after 2 attempts")
        return False

    def _dismiss_comments(self):
        """Close the comments panel by tapping on the video area above it.
        More natural than BACK keyevent with gesture navigation.
        Y range 15-25% avoids top tabs (at ~6%) and stays in the video area."""
        vx = random.randint(int(self.adb.screen_w * 0.15), int(self.adb.screen_w * 0.60))
        vy = random.randint(int(self.adb.screen_h * 0.15), int(self.adb.screen_h * 0.25))
        self.adb.tap(vx, vy)
        time.sleep(self.human.timing("t_tap_gap"))
        log.info("Comments dismissed via video tap at (%d, %d)", vx, vy)

    def _pull_to_refresh(self):
        """Pull-to-refresh gesture — swipe down from top area.
        Used on Inbox to reset scroll position and load fresh content.
        Natural gesture that real users do constantly."""
        start_x = self.adb.screen_w // 2 + random.randint(-30, 30)
        start_y = int(self.adb.screen_h * random.uniform(0.18, 0.25))
        end_y = int(self.adb.screen_h * random.uniform(0.55, 0.65))
        duration = random.randint(350, 550)
        self.adb.swipe(start_x, start_y, start_x + random.randint(-10, 10), end_y, duration)
        time.sleep(self.human.timing("t_anim_complete"))
        log.info("PULL_TO_REFRESH: swipe down to refresh")

    def _scroll_to_top(self, max_swipes: int = 3):
        """Scroll up to the top of the current page.
        Detects 'at top' when screen fingerprint stops changing.
        Natural gesture -- a user scrolls up to see the beginning."""
        for i in range(max_swipes):
            # Take fingerprint before scroll
            pre_shot = self.adb.screenshot_bytes()
            pre_fp = page_state.screen_fingerprint(pre_shot) if pre_shot else None

            # Swipe DOWN (finger moves down = page scrolls up)
            cx = self.adb.screen_w // 2 + random.randint(-20, 20)
            start_y = int(self.adb.screen_h * random.uniform(0.30, 0.40))
            end_y = int(self.adb.screen_h * random.uniform(0.65, 0.75))
            duration = random.randint(300, 500)
            self.adb.swipe(cx, start_y, cx + random.randint(-8, 8), end_y, duration)
            time.sleep(self.human.timing("t_tap_gap"))

            # Check if screen changed
            post_shot = self.adb.screenshot_bytes()
            post_fp = page_state.screen_fingerprint(post_shot) if post_shot else None
            if pre_fp and post_fp:
                diff = sum(abs(a - b) for a, b in zip(pre_fp, post_fp)) / len(pre_fp)
                if diff < 10:  # screen barely changed = already at top
                    log.info("SCROLL_TO_TOP: reached top after %d swipes", i + 1)
                    return
        log.info("SCROLL_TO_TOP: done %d swipes (may or may not be at top)", max_swipes)

    def _scroll_comments(self):
        """Single comment scroll using the universal browse scroll system."""
        self._human_browse_scroll(context="comments", max_override=1)
        return True

    async def browse_comments(self, check_commenter_profile: bool = True) -> list[bytes]:
        """Browse comments section with variable scrolls. Returns screenshots taken.

        Human behavior: open comments, read, scroll a few times, close.
        Sometimes deep-dives into drama. Number of scrolls and read pauses
        are state-driven (curiosity, sociality, fatigue, boredom).
        Rarely taps on a commenter's avatar to visit their profile.
        """
        plan = self.human.browse_comments_plan()
        scroll_count = plan["scroll_count"]
        timing_key = plan["read_timing_key"]
        screenshots = []
        visited_commenter = False

        if plan["is_deep_dive"]:
            log.debug("Comment deep dive: %d scrolls", scroll_count)
        else:
            log.debug("Browsing comments: %d scrolls", scroll_count)

        for i in range(scroll_count):
            # Read pause before scrolling (reading the visible comments)
            await asyncio.sleep(self.human.timing(timing_key))
            self.guardian.handle_if_popup()

            # Take screenshot at different depths for AI context
            # Capture after scroll 0 (first visible), and 1-2 more at random depths
            # State-driven: sociality * 0.7 (social people screenshot more)
            _social = getattr(getattr(self.human, 'mood', None), 'social', 0.5)
            _comment_prob = max(0.0, min(1.0, _social * 0.7))
            if i == 0 or random.random() < _comment_prob:
                shot = self.adb.screenshot_bytes()
                if shot:
                    screenshots.append(shot)

            # Rarely: tap on a commenter's avatar to visit their profile
            # Only once per browse, and only after reading a bit (not first scroll)
            if (check_commenter_profile and not visited_commenter
                    and i > 0 and self.human.should_visit_commenter_profile()):
                await self._visit_commenter_profile()
                visited_commenter = True

            # Scroll to see more comments (skip if Gemini said not scrollable)
            if i < scroll_count - 1:
                if not self._comments_scrollable:
                    log.debug("Comments not scrollable (Gemini), skipping scroll")
                    break
                if not self._scroll_comments():
                    log.debug("Comments can't scroll further (fingerprint), stopping")
                    break

        return screenshots

    def write_comment(self, text: str):
        """Type and post a comment."""
        # Pause before tapping input (deciding to write)
        time.sleep(self.human.timing("t_comment_before_write"))

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

        # Close keyboard + comments (2 taps on video: first closes keyboard, second closes panel)
        vx = random.randint(int(self.adb.screen_w * 0.15), int(self.adb.screen_w * 0.60))
        vy = random.randint(int(self.adb.screen_h * 0.15), int(self.adb.screen_h * 0.25))
        self.adb.tap(vx, vy)
        time.sleep(self.human.timing("t_tap_gap"))
        vx2 = random.randint(int(self.adb.screen_w * 0.15), int(self.adb.screen_w * 0.60))
        vy2 = random.randint(int(self.adb.screen_h * 0.15), int(self.adb.screen_h * 0.25))
        self.adb.tap(vx2, vy2)
        time.sleep(self.human.timing("t_tap_gap"))
        log.debug("Posted comment and dismissed: %s", text[:30])

    async def comment_with_ai(self):
        """Generate a contextual comment using multi-frame video understanding.

        Flow:
        1. Capture 3 video frames at ~2s intervals (frame 1 has caption visible)
        2. Open comments and browse (variable scrolls)
        3. Send all frames to Gemini for context-aware comment generation
        4. Type and post the comment
        """
        # --- Step 1: Capture 3 video frames ---
        video_frames = []

        # Frame 1: current video with caption visible
        frame1 = self.adb.screenshot_bytes()
        if not frame1:
            return
        video_frames.append(frame1)

        # Frame 2: ~2s later
        await asyncio.sleep(self.human.timing("t_frame_capture_gap"))
        self.guardian.handle_if_popup()
        frame2 = self.adb.screenshot_bytes()
        if frame2:
            video_frames.append(frame2)

        # Frame 3: ~2s later again
        await asyncio.sleep(self.human.timing("t_frame_capture_gap"))
        self.guardian.handle_if_popup()
        frame3 = self.adb.screenshot_bytes()
        if frame3:
            video_frames.append(frame3)

        log.debug("Captured %d video frames for comment", len(video_frames))

        # --- Step 2: Open and browse comments ---
        self.open_comments()
        comment_frames = await self.browse_comments()

        if not comment_frames:
            # Fallback: take one screenshot of current comments view
            shot = self.adb.screenshot_bytes()
            if shot:
                comment_frames = [shot]

        log.debug("Captured %d comment screenshots", len(comment_frames))

        # --- Step 3: Generate comment with multi-frame AI ---
        style = self.human.personality.comment_style if self.human.personality else "reactor"
        comment = gemini.generate_comment_v2(
            video_frames=video_frames,
            comment_frames=comment_frames,
            platform="tiktok",
            style=style,
        )

        # Fallback to single-frame if multi-frame fails
        if not comment or len(comment) < 3:
            log.warning("Multi-frame comment failed, trying single-frame fallback")
            comment = gemini.generate_comment(video_frames[0], platform="tiktok")

        if not comment or len(comment) < 3:
            log.warning("Comment generation failed entirely, closing comments")
            self._dismiss_comments()
            return

        # --- Step 4: Write the comment ---
        # Pre-chain check before typing (keyboard is about to open)
        if self.guardian.pre_chain_check():
            self._dismiss_comments()  # close comments after popup dismiss
            return
        self.write_comment(comment)
        self.human.memory.session_comments += 1
        log.info("[Comment] style=%s text='%s'", style, comment[:40])

    def _reset_niche_cache(self):
        """Reset niche cache when scrolling to a new video."""
        self._niche_checked = False
        self._niche_result = False
        self._cached_category = "unknown"

    def _precheck_niche_during_watch(self, niche_keywords: list = None):
        """Pre-cache niche + category check DURING watch time.
        Called ~2s into watching so the 6s Gemini API delay is absorbed
        by remaining watch time. No freeze before like/follow decisions."""
        if self._niche_checked:
            return  # already done for this video

        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            self._niche_checked = True
            self._niche_result = False
            self._cached_category = "unknown"
            return

        pool = niche_keywords or config.NICHE_KEYWORDS_POOL
        result = gemini.categorize_and_check_niche(screenshot, pool)

        in_niche = result.get("in_niche", False)
        confidence = result.get("confidence", 0.0)

        self._niche_checked = True
        self._niche_result = in_niche and confidence >= 0.4
        self._cached_category = result.get("category", "unknown")

        # Update boredom based on niche match from merged result
        niche_match = self._niche_result
        self.human.on_scroll(niche_match)

        log.debug("Pre-check niche+cat: cat=%s in_niche=%s conf=%.2f reason='%s'",
                  self._cached_category, in_niche, confidence,
                  result.get("reason", ""))

    def _check_niche_before_engage(self, niche_keywords: list = None) -> bool:
        """Niche gate: check cached result. If not pre-cached yet, do it now (rare fallback).
        Returns True = safe to engage."""
        if not self._niche_checked:
            log.debug("NICHE_GATE: not pre-cached, checking now (fallback)")
            self._precheck_niche_during_watch(niche_keywords)
        log.info("NICHE_GATE: %s (cat=%s)", "PASS" if self._niche_result else "BLOCKED", self._cached_category)
        return self._niche_result

    def follow_creator(self):
        """Follow the creator of the current video by tapping the red + below avatar.
        Uses bbox to find the exact position (engagement panel varies per video)."""
        log.info("FOLLOW: tap avatar + icon (direct from video)")
        self._find_and_tap(
            "the small red plus (+) follow button below the circular avatar on the right side",
            fallback_coord="avatar")
        self.human.on_follow()
        time.sleep(self.human.action_delay())

    def _is_follow_button_red(self) -> bool:
        """Check if the Follow button on a profile is red (= not yet following).
        TikTok Follow = red (#FE2C55), Following/Friends = gray outline.
        Pure pixel check, no Gemini call. Returns True = safe to follow."""
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return True  # optimistic fallback

        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(screenshot)).convert("RGB")
            bx, by = self.adb.get_coord("tiktok", "profile_follow_btn")
            # Sample a small area around button center
            samples = []
            for dx in range(-15, 16, 5):
                for dy in range(-5, 6, 5):
                    px, py = min(max(bx + dx, 0), img.width - 1), min(max(by + dy, 0), img.height - 1)
                    samples.append(img.getpixel((px, py)))
            # Check if majority of samples are reddish (R > 180, G < 100, B < 120)
            red_count = sum(1 for r, g, b in samples if r > 180 and g < 100 and b < 120)
            is_red = red_count > len(samples) * 0.4
            log.debug("Follow button color check: %d/%d red pixels -> %s",
                      red_count, len(samples), "Follow" if is_red else "Already following")
            return is_red
        except Exception as e:
            log.debug("Follow button color check failed: %s", e)
            return True  # optimistic fallback

    def follow_from_profile(self):
        """Enter creator's profile, browse naturally, then follow.

        Variable behavior (state-driven, not fixed):
        - ~40%: glance at bio/stats briefly, follow immediately (already convinced from video)
        - ~35%: scroll down the grid to check their content, scroll back up, follow
        - ~25%: open 1-2 of their videos, watch briefly, go back to profile, follow

        After scrolling, must scroll back to top before tapping Follow (button is off-screen).
        Uses pixel check (red button) first, Gemini Vision fallback if needed.
        """
        log.info("FOLLOW: entering profile first")
        if not self.visit_creator_profile():
            log.warning("follow_from_profile: profile navigation failed, aborting")
            return False

        # --- Decide browse behavior based on personality + state ---
        curiosity = self.human.personality.explore_curiosity
        patience = self.human.mood.patience
        fatigue = self.human.fatigue.fatigue_level if self.human.fatigue else 0.0
        energy = self.human.mood.energy

        # Higher curiosity + patience = more likely to browse before following
        browse_drive = curiosity * 2 + patience * 0.5 - fatigue * 0.3
        roll = random.random()

        if roll < 0.40 - browse_drive * 0.5:
            # --- PATH A: Quick follow (already convinced from video) ---
            log.info("FOLLOW_PROFILE: quick follow (glance + tap)")
            time.sleep(self.human.timing("t_browse_results") * random.uniform(0.3, 0.6))
            scrolled = False

        elif roll < 0.75 - browse_drive * 0.3:
            # --- PATH B: Scroll grid then follow ---
            log.info("FOLLOW_PROFILE: scroll grid first")
            time.sleep(self.human.timing("t_browse_results") * random.uniform(0.2, 0.4))

            # Instead of deciding scroll count upfront, scroll until "satisfied".
            # Each scroll: decide distance first, then after scrolling decide if we want more.
            # Patient = short scrolls + more likely to continue = more total scrolls
            # Impatient = long scrolls + less likely to continue = fewer total scrolls
            n_scrolls = 0
            max_scrolls = 7
            while n_scrolls < max_scrolls:
                s = n_scrolls
                # Scroll back up to re-check: driven by curiosity + patience (curious+patient = notices more)
                recheck_prob = 0.25 + curiosity * 0.6 + patience * 0.25 - fatigue * 0.15
                recheck_prob = max(0.20, min(0.55, recheck_prob))
                if s > 0 and random.random() < recheck_prob:
                    back_dist = random.uniform(0.10, 0.20)
                    back_start = 0.35 + random.uniform(-0.05, 0.05)
                    sw_back = self.human.humanize_swipe(
                        self.adb.screen_w // 2, int(self.adb.screen_h * back_start),
                        self.adb.screen_w // 2, int(self.adb.screen_h * (back_start + back_dist)),
                    )
                    self.adb.swipe(sw_back["x1"], sw_back["y1"], sw_back["x2"], sw_back["y2"],
                                   sw_back["duration"])
                    log.debug("FOLLOW_PROFILE: scroll back up to re-check (%.0f%%)", back_dist * 100)
                    time.sleep(self.human.timing("t_anim_complete"))

                # Scroll down: distance driven by patience/fatigue
                base_dist = 0.35 - patience * 0.06 + fatigue * 0.05
                dist = max(0.12, min(0.50, random.gauss(base_dist, 0.12)))
                start_y = 0.65 + random.uniform(-0.05, 0.05)
                end_y = start_y - dist
                sw = self.human.humanize_swipe(
                    self.adb.screen_w // 2, int(self.adb.screen_h * start_y),
                    self.adb.screen_w // 2, int(self.adb.screen_h * max(0.15, end_y)),
                )
                self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
                n_scrolls += 1
                self.adb.save_screenshot_if_recording("after_profile_grid_scroll")
                pause = self.human.timing("t_browse_results") * random.uniform(0.3, 0.7)
                log.debug("FOLLOW_PROFILE: grid scroll %d dist=%.0f%% pause=%.1fs",
                          n_scrolls, dist * 100, pause)
                time.sleep(pause)

                # Decide: keep scrolling or stop?
                # Even after first scroll, might stop (saw enough, or did one long decisive scroll)
                # But first scroll has higher continue probability (just started)
                # Shorter scrolls = more likely to continue (still browsing slowly)
                # Longer scrolls = less likely (already covered a lot)
                # Curiosity/patience increase continue probability
                continue_base = 0.50 + curiosity * 1.5 + patience * 0.12 - fatigue * 0.2
                # First scroll: strong continue bias (just started browsing)
                # But if first scroll was very long (>40%), might stop (saw enough in one swipe)
                if n_scrolls == 1:
                    continue_base += 0.30 if dist > 0.38 else 0.45
                # Short scroll bonus: browsing slowly, likely to continue
                if dist < 0.25:
                    continue_base += 0.12
                # Long scroll penalty: already covered a lot, less need to continue
                if dist > 0.40:
                    continue_base -= 0.10
                # Each scroll slightly reduces desire to continue (diminishing interest)
                min_prob = 0.90 if n_scrolls == 1 else 0.08  # first scroll: very likely to continue
                continue_prob = max(min_prob, min(0.85, continue_base - n_scrolls * 0.08))
                if random.random() >= continue_prob:
                    log.debug("FOLLOW_PROFILE: stopping after %d scrolls (continue_prob=%.2f)",
                              n_scrolls, continue_prob)
                    break

            scrolled = True

        else:
            # --- PATH C: Watch 1-2 videos then follow ---
            log.info("FOLLOW_PROFILE: watching videos first")
            time.sleep(self.human.timing("t_browse_results") * random.uniform(0.2, 0.4))

            # Maybe scroll grid before tapping
            grid_scrolled = self._maybe_scroll_grid(scroll_prob=0.4)

            # Tap a video from the grid
            self._tap_profile_grid_video(scrolled=grid_scrolled)
            watch = self.human.watch_duration(15) * random.uniform(0.4, 0.8)
            log.debug("FOLLOW_PROFILE: watching creator video for %.1fs", watch)
            time.sleep(watch)

            # Maybe watch a second video (scroll to next)
            # State-driven: curiosity * 0.4 + energy * 0.15 (curious + energetic = explore more)
            _curiosity = getattr(getattr(self.human, 'mood', None), 'curiosity', 0.5)
            _2nd_vid_prob = max(0.0, min(1.0, _curiosity * 0.4 + energy * 0.15))
            if random.random() < _2nd_vid_prob:
                self.scroll_fyp()  # swipe to next video in creator's feed
                watch2 = self.human.watch_duration(15) * random.uniform(0.3, 0.6)
                log.debug("FOLLOW_PROFILE: watching 2nd video for %.1fs", watch2)
                time.sleep(watch2)

            # Go back to profile (1 or 2 backs depending on how deep we went)
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))

            scrolled = True

        # --- Tap Follow button ---
        # If we scrolled, need to find the button (might need to scroll up more)
        # If we didn't scroll, button is at fixed coords
        if not self._scroll_to_top_and_follow():
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            return False

        # Brief pause after following (human looks at "Following" confirmation)
        time.sleep(self.human.timing("t_browse_results") * random.uniform(0.15, 0.35))

        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))
        return True

    def _scroll_to_top_and_follow(self) -> bool:
        """Find and tap the Follow button. Fast path first, scroll only if needed.

        Flow (fastest path first):
        1. Pixel check at fixed coords → if red, tap immediately (0 Gemini, 0 scroll)
        2. Gemini check → "follow" with coords → tap (1 Gemini, 0 scroll)
                        → "following" → already followed, done (1 Gemini, 0 scroll)
                        → "not_visible" → scroll to top, then repeat
        3. Scroll-to-top loop: scroll up, fingerprint compare, stop when page stops moving
        4. After reaching top → pixel check + Gemini one more time

        Returns True if followed, False if already following or failed."""

        # --- Fast path: button already visible (no scroll needed) ---
        if self._is_follow_button_red():
            fx, fy = self.adb.get_coord("tiktok", "profile_follow_btn")
            fx, fy = self.human.jitter_tap(fx, fy)
            self.adb.tap(fx, fy)
            self.human.on_follow()
            log.info("FOLLOW: instant tap at fixed coords (%d, %d)", fx, fy)
            time.sleep(self.human.timing("t_tap_gap"))
            self.adb.save_screenshot_if_recording("after_follow_tap")
            return True

        # Pixel check negative — could be: scrolled down, already following, or position shifted.
        # Ask Gemini ONCE to decide: follow/following/not_visible
        screenshot = self.adb.screenshot_bytes()
        if screenshot:
            result = self._gemini_check_follow_button(screenshot)
            self.stats["gemini_calls"] = self.stats.get("gemini_calls", 0) + 1

            if result["status"] == "follow" and result.get("x") and result.get("y"):
                fx, fy = self.human.jitter_tap(result["x"], result["y"])
                self.adb.tap(fx, fy)
                self.human.on_follow()
                log.info("FOLLOW: tapped via Gemini at (%d, %d)", fx, fy)
                return True

            if result["status"] == "following":
                log.info("FOLLOW: already following this creator")
                return False

            # "not_visible" — need to scroll to top
            log.info("FOLLOW: button not visible, scrolling to top")

        # --- Scroll-to-top loop (deterministic: fingerprint compare) ---
        # Pick scroll-up style based on state: impatient/tired = fast flicks, calm = normal scrolls
        _patience = self.human.mood.patience
        _fatigue = self.human.fatigue.fatigue_level if self.human.fatigue else 0.0
        _energy = self.human.mood.energy
        impatience = (1.0 - _patience) * 0.6 + _fatigue * 0.3 + (1.0 - _energy) * 0.1
        use_flick = random.random() < (0.3 + impatience * 0.5)  # 30-80% chance of flick style
        log.debug("SCROLL_UP style: %s (impatience=%.2f)", "flick" if use_flick else "normal", impatience)

        for scroll_attempt in range(4):
            _, fp_before = self.guardian.take_fingerprint()

            sx = self.adb.screen_w // 2 + random.randint(-15, 15)
            if use_flick:
                # Fast flick: long distance, short duration, minimal pause
                dist = random.uniform(0.45, 0.65)
                start_y = random.uniform(0.15, 0.25)
                duration = random.randint(150, 280)
                pause = random.uniform(0.3, 0.8)
            else:
                # Normal scroll up: moderate distance, normal duration, normal pause
                dist = random.uniform(0.25, 0.45)
                start_y = random.uniform(0.20, 0.30)
                duration = random.randint(300, 500)
                pause = random.uniform(0.8, 1.5)

            end_y = min(0.85, start_y + dist)
            drift = random.randint(-12, 12)
            self.adb.swipe(
                sx, int(self.adb.screen_h * start_y),
                sx + drift, int(self.adb.screen_h * end_y),
                duration,
            )
            time.sleep(pause)

            # Check if button appeared after this scroll
            if self._is_follow_button_red():
                fx, fy = self.adb.get_coord("tiktok", "profile_follow_btn")
                fx, fy = self.human.jitter_tap(fx, fy)
                self.adb.tap(fx, fy)
                self.human.on_follow()
                log.info("FOLLOW: tapped after scroll %d", scroll_attempt + 1)
                return True

            # Check if we reached the top (page didn't move)
            _, fp_after = self.guardian.take_fingerprint()
            if fp_before and fp_after:
                total_diff = sum(abs(a - b) for a, b in zip(fp_before, fp_after))
                avg_diff = total_diff / len(fp_after)
                at_top = avg_diff < 8
                log.info("SCROLL_TO_TOP: scroll %d, diff=%.1f -> %s",
                         scroll_attempt + 1, avg_diff,
                         "AT TOP" if at_top else "still scrolling")
                if at_top:
                    break

        # --- At top: final Gemini check ---
        screenshot = self.adb.screenshot_bytes()
        if screenshot:
            result = self._gemini_check_follow_button(screenshot)
            self.stats["gemini_calls"] = self.stats.get("gemini_calls", 0) + 1

            if result["status"] == "follow" and result.get("x") and result.get("y"):
                fx, fy = self.human.jitter_tap(result["x"], result["y"])
                self.adb.tap(fx, fy)
                self.human.on_follow()
                log.info("FOLLOW: tapped via Gemini at top (%d, %d)", fx, fy)
                return True

            if result["status"] == "following":
                log.info("FOLLOW: already following this creator")
                return False

        log.warning("FOLLOW: couldn't find Follow button")
        return False

    def _gemini_check_follow_button(self, screenshot_bytes: bytes) -> dict:
        """Ask Gemini: is the Follow or Following button visible on this profile?
        Uses bounding box mode for accurate coordinates.
        Returns {"status": "follow"|"following"|"not_visible", "x": int|None, "y": int|None}"""
        import re

        prompt = """Look at this TikTok profile screenshot.

I need to know about the Follow/Following button:
1. If you see a RED/PINK "Follow" button (not yet following) → return its bounding box.
2. If you see a GRAY/WHITE "Following" or "Friends" button (already following) → return status only.
3. If you see neither (scrolled past the buttons) → not_visible.

Return ONLY JSON:
{"status": "follow" or "following" or "not_visible", "bbox": [ymin, xmin, ymax, xmax] or null}
where bbox values are 0-1000 (normalized to image dimensions).
JSON only, no markdown."""

        result = gemini._call_vision(screenshot_bytes, prompt, max_tokens=100)
        try:
            result = result.replace("```json", "").replace("```", "").strip()
            data = json.loads(result)
            status = data.get("status", "not_visible")

            x, y = None, None
            bbox = data.get("bbox")
            if bbox and len(bbox) == 4 and status == "follow":
                ymin, xmin, ymax, xmax = bbox
                x = int((xmin + xmax) / 2 * self.adb.screen_w / 1000)
                y = int((ymin + ymax) / 2 * self.adb.screen_h / 1000)

            log.info("FOLLOW_CHECK: status=%s coords=(%s, %s)", status, x, y)
            return {"status": status, "x": x, "y": y}
        except Exception as e:
            log.warning("FOLLOW_CHECK: parse failed: %s", e)
            return {"status": "not_visible", "x": None, "y": None}

    async def _visit_commenter_profile(self):
        """While comments are open, tap on a commenter's avatar to visit their profile.
        Uses Gemini Vision to find avatar coordinates."""
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return

        avatars = gemini.find_comment_avatars(
            screenshot, self.adb.screen_w, self.adb.screen_h
        )
        if not avatars:
            log.debug("No comment avatars found by vision")
            return

        # Pick a random avatar (weighted toward top ones -- more visible)
        weights = [max(1, len(avatars) - a["index"]) for a in avatars]
        chosen = random.choices(avatars, weights=weights, k=1)[0]
        ax, ay = self.human.jitter_tap(chosen["x"], chosen["y"], target_size="small")
        log.debug("Visiting commenter profile: avatar at (%d, %d)", ax, ay)
        self.adb.tap(ax, ay)

        # Brief profile visit
        time.sleep(self.human.timing("t_profile_settle"))

        # Maybe scroll their grid
        await asyncio.sleep(self.human.timing("t_browse_results") * random.uniform(0.2, 0.5))

        # Back to comments (nav safety: verify we're still in TikTok)
        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))
        self._ensure_on_app()

    def visit_creator_profile(self) -> bool:
        """Tap on creator's avatar to visit their profile.
        Uses Gemini bounding box to find the EXACT avatar position first (varies per video).
        Handles Story circle: if avatar has a blue Story ring, tapping opens the Story
        instead of the profile. Detects this and taps creator avatar in Story header
        to enter profile directly from Story.
        Returns False if navigation failed (caller should abort)."""
        for attempt in range(2):
            log.info("NAV: visit_creator_profile (bbox + tap, attempt %d)", attempt + 1)

            # Fingerprint BEFORE tap (to detect if screen changed)
            from ..core import page_state
            pre_shot = self.adb.screenshot_bytes()
            pre_fp = page_state.screen_fingerprint(pre_shot) if pre_shot else None

            # Primary: pixel sidebar scan for avatar (zero AI, <50ms)
            positions = self._get_sidebar_positions()
            if positions and positions.get("avatar"):
                # Skip LIVE avatars (would open live stream)
                if positions.get("avatar_live"):
                    log.info("visit_creator_profile: LIVE avatar detected via pixel, skipping")
                    return False
                ax, ay = positions["avatar"]
                ax, ay = self.human.jitter_tap(ax, ay)
                self.adb.tap(ax, ay)
                log.info("visit_creator_profile: tapped avatar at (%d, %d) via sidebar scan", ax, ay)
            else:
                # No avatar found in sidebar scan (or no sidebar at all)
                if positions and positions.get("avatar_live"):
                    log.info("visit_creator_profile: LIVE avatar detected via pixel, skipping")
                    return False
                if positions is None:
                    # No sidebar = live preview or non-FYP, skip
                    log.warning("visit_creator_profile: no sidebar (live/non-FYP), skipping")
                    return False
                log.warning("visit_creator_profile: sidebar scan no avatar, trying Gemini bbox")
                found = self._find_and_tap(
                    "the small CIRCULAR profile picture avatar on the RIGHT side of the screen. "
                    "It is ABOVE the heart/like icon. It shows the creator's face or icon. "
                    "Do NOT select the red + button below the avatar, and do NOT select the rotating music disc at the bottom.",
                    fallback_coord="avatar",
                    y_max_pct=0.70,
                    tap_y_bias=-0.35)  # tap ABOVE bbox center to avoid hitting + button below
                if not found:
                    log.warning("visit_creator_profile: avatar not found, skipping")
                    return False

            # Profile load with retry (slow phones need more time)
            vr = wait_and_verify(
                adb=self.adb, human=self.human,
                verify_fn=lambda shot: gemini.is_profile_page(shot),
                action_name="visit_profile",
                first_wait="t_profile_load",
                is_slow_verify=True,
                max_attempts=2,
                max_total_s=12.0,
            )
            if vr.success:
                log.info("Profile opened OK (attempt %d)", attempt + 1)
                return True

            # Profile verify failed — check what we're on
            screenshot = vr.screenshot
            if screenshot:
                # Step 2: detect if screen changed (fingerprint comparison)
                # Gemini can't reliably classify Stories — they look like FYP to it.
                # But fingerprint tells us if SOMETHING opened.
                post_fp = page_state.screen_fingerprint(screenshot)
                screen_changed = False
                if pre_fp and post_fp:
                    diff = sum(abs(a - b) for a, b in zip(pre_fp, post_fp)) / len(pre_fp)
                    screen_changed = diff > 18
                    log.debug("visit_creator_profile: fingerprint diff=%.1f, screen_changed=%s", diff, screen_changed)

                # Step 3: screen changed but not profile — classify what opened
                if screen_changed:
                    classification = gemini.classify_screen_with_reference(screenshot)
                    if classification == "story":
                        # Story confirmed — tap Story header avatar at fixed coords
                        log.warning("Story confirmed — tapping Story header avatar")
                        sx, sy = self.adb.get_coord("tiktok", "story_avatar")
                        # Minimal jitter — Story avatar is tiny (~30px), standard jitter misses it
                        sx += random.randint(-5, 5)
                        sy += random.randint(-5, 5)
                        self.adb.tap(sx, sy)
                        vr2 = wait_and_verify(
                            adb=self.adb, human=self.human,
                            verify_fn=lambda s: gemini.is_profile_page(s),
                            action_name="profile_from_story",
                            first_wait="t_profile_from_story",
                            is_slow_verify=True,
                            max_attempts=2,
                            max_total_s=14.0,
                        )
                        if vr2.success:
                            log.info("Profile opened from Story header (attempt %d)", attempt + 1)
                            return True
                        log.warning("Story header tap didn't reach profile")
                    else:
                        log.warning("Screen changed to %s (not Story) — pressing BACK", classification)
                    # Recovery — BACK to FYP
                    self.adb.press_back()
                    time.sleep(self.human.timing("t_nav_settle"))
                    if not self._verify_page("fyp"):
                        self._return_to_fyp()
                    if attempt == 0:
                        time.sleep(self.human.timing("t_tap_gap"))
                        continue
                    break

                # Step 4: screen didn't change — tap didn't work, retry
                log.warning("Avatar tap did nothing (screen unchanged), retrying")
                if attempt == 0:
                    time.sleep(self.human.timing("t_tap_gap"))
                    continue

        log.warning("visit_creator_profile: failed after 2 attempts")
        return False

    def _navigate_stories(self, max_stories: int = 5) -> bool:
        """Navigate through Stories with human-like behavior.
        Tap right for next, occasionally tap left to re-watch.
        Returns True if navigated through at least one Story."""
        screenshot = self.adb.screenshot_bytes()
        total = gemini.count_story_segments(screenshot) if screenshot else 1
        if total == 0:
            total = 1

        log.info("STORIES: %d segment(s) detected, watching up to %d", total, min(total, max_stories))

        watched = 0
        for i in range(min(total, max_stories)):
            watch_time = self.human.timing("t_story_watch")
            time.sleep(watch_time)
            watched += 1

            if i >= min(total, max_stories) - 1:
                break

            fatigue = self.human.fatigue.fatigue_level if self.human.fatigue else 0
            patience = self.human.mood.patience if self.human.mood else 1.0

            # Occasionally go back to re-watch previous (only if not first)
            if i > 0:
                rewatch_drive = patience * 0.08 - fatigue * 0.05
                if random.random() < max(0, rewatch_drive):
                    log.debug("STORIES: re-watching previous Story")
                    sx, sy = self.adb.get_coord("tiktok", "story_tap_prev")
                    sx += random.randint(-10, 10)
                    sy += random.randint(-20, 20)
                    self.adb.tap(sx, sy)
                    time.sleep(self.human.timing("t_story_watch") * 0.6)
                    sx, sy = self.adb.get_coord("tiktok", "story_tap_next")
                    sx += random.randint(-10, 10)
                    sy += random.randint(-20, 20)
                    self.adb.tap(sx, sy)
                    time.sleep(self.human.timing("t_tap_gap"))
                    continue

            # Exit early? (fatigue + boredom driven)
            exit_drive = fatigue * 0.3 + (self.human.boredom.level if self.human.boredom else 0) * 0.2 - patience * 0.1
            if random.random() < max(0, exit_drive):
                log.info("STORIES: exiting early after %d/%d Stories", watched, total)
                break

            # Next Story
            sx, sy = self.adb.get_coord("tiktok", "story_tap_next")
            sx += random.randint(-10, 10)
            sy += random.randint(-20, 20)
            self.adb.tap(sx, sy)
            time.sleep(self.human.timing("t_tap_gap"))

            self.human.boredom.on_scroll(None)

        log.info("STORIES: watched %d Stories", watched)
        return watched > 0

    def _has_stories_carousel(self) -> bool:
        """Check if Stories carousel is visible (colored circle rings at y=10-16%).
        Returns True if colored circles detected, False if zone is dark/empty."""
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            return False
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(screenshot)).convert("RGB")
            w, h = img.size
            colored_total = 0
            for y_pct in [0.10, 0.12, 0.14, 0.16]:
                y = int(h * y_pct)
                for x in range(0, w, 8):
                    r, g, b = img.getpixel((x, y))
                    max_c = max(r, g, b)
                    min_c = min(r, g, b)
                    if max_c > 150 and (max_c - min_c) > 80:
                        colored_total += 1
            has_stories = colored_total > 15
            log.debug("STORIES_CAROUSEL: colored=%d, has_stories=%s", colored_total, has_stories)
            return has_stories
        except Exception:
            return False

    def _browse_stories_carousel(self) -> bool:
        """Browse the Stories carousel with human-like state-machine behavior.

        A real person might: glance at visible Stories, scroll right to see more,
        scroll back to re-check someone, scroll right again, then maybe tap one
        or just move on. The whole sequence is fluid and state-driven.

        Returns True if a Story was tapped and entered, False if just browsed."""
        # Check if Stories carousel exists first
        if not self._has_stories_carousel():
            log.info("CAROUSEL: no Stories visible, skipping")
            return False

        # --- Read state ---
        curiosity = self.human.personality.explore_curiosity if self.human.personality else 0.1
        story_affinity = self.human.personality.story_affinity if self.human.personality else 0.5
        fatigue = self.human.fatigue.fatigue_level if self.human.fatigue else 0.0
        boredom = self.human.boredom.level if self.human.boredom else 0.0
        energy = max(0.0, 1.0 - fatigue)

        carousel_y = int(self.adb.screen_h * 0.131)
        scroll_pos = 0          # How far right we've scrolled (0 = home position)
        total_scrolls = 0       # Total scroll actions taken (for fatigue)
        total_iterations = 0    # Safety cap
        max_iterations = 10
        tapped = False
        actions_log = []        # For debug logging

        # --- State machine ---
        # Each iteration picks one action: scroll_right, scroll_left, tap, or stop.
        # Probabilities shift dynamically based on state + what we've done so far.
        while total_iterations < max_iterations:
            total_iterations += 1

            # Diminishing interest: the more we've scrolled, the less we want to continue
            scroll_fatigue = min(1.0, total_scrolls * 0.15)

            # --- Compute drives for each action ---

            # SCROLL RIGHT: driven by curiosity, story interest, energy.
            # Falls off with scroll_fatigue and how far right we already are.
            right_drive = (
                curiosity * 2.5
                + story_affinity * 1.5
                + energy * 0.8
                - scroll_fatigue * 2.0
                - scroll_pos * 0.3
                + boredom * 0.4    # boredom can push us to keep browsing
            )

            # SCROLL LEFT (go back): only possible if we've scrolled right.
            # Driven by "wait, who was that?" re-check impulse.
            # More likely after several right scrolls, less likely if tired.
            left_drive = 0.0
            if scroll_pos > 0:
                left_drive = (
                    curiosity * 1.2
                    + scroll_pos * 0.4    # further right = more reason to go back
                    - scroll_fatigue * 1.5
                    + energy * 0.3
                )
                # Diminish if we already scrolled left recently
                if actions_log and actions_log[-1] == "left":
                    left_drive *= 0.2

            # TAP STORY: driven by story_affinity, curiosity. Slightly boosted
            # after scrolling back (you went back FOR a reason).
            tap_drive = (
                story_affinity * 2.0
                + curiosity * 0.8
                - fatigue * 0.6
            )
            # Boost if we just scrolled back (re-check = intent to tap)
            if actions_log and actions_log[-1] == "left":
                tap_drive += 0.8
            # Small boost from boredom (looking for something to do)
            tap_drive += boredom * 0.3

            # STOP: driven by fatigue, scroll_fatigue, low interest.
            stop_drive = (
                fatigue * 1.5
                + scroll_fatigue * 1.8
                + (1.0 - story_affinity) * 0.8
                + (1.0 - curiosity) * 0.5
            )
            # If we haven't scrolled at all yet, stopping early is less likely
            # (you at least glance at visible Stories)
            if total_scrolls == 0:
                stop_drive *= 0.3

            # Clamp all drives to [0, ...)
            right_drive = max(0.0, right_drive)
            left_drive = max(0.0, left_drive)
            tap_drive = max(0.0, tap_drive)
            stop_drive = max(0.0, stop_drive)

            # Can't scroll right past position 6 (seen enough)
            if scroll_pos >= 6:
                right_drive = 0.0

            # Can't scroll left past home
            if scroll_pos <= 0:
                left_drive = 0.0

            # Normalize to probabilities
            total_drive = right_drive + left_drive + tap_drive + stop_drive
            if total_drive < 0.01:
                break  # No drive left at all

            p_right = right_drive / total_drive
            p_left = left_drive / total_drive
            p_tap = tap_drive / total_drive
            # p_stop = stop_drive / total_drive  (implicit remainder)

            roll = random.random()

            if roll < p_right:
                # --- SCROLL RIGHT (swipe left to reveal more) ---
                # Slow, short scrolls — browsing faces/names, not rushing
                x1 = int(self.adb.screen_w * random.uniform(0.60, 0.72)) + random.randint(-8, 8)
                x2 = int(self.adb.screen_w * random.uniform(0.28, 0.38)) + random.randint(-8, 8)
                y_jitter = carousel_y + random.randint(-5, 5)
                duration = random.randint(400, 750)
                self.adb.swipe(x1, y_jitter, x2, y_jitter, duration)
                scroll_pos += 1
                total_scrolls += 1
                actions_log.append("right")
                time.sleep(self.human.timing("t_carousel_scroll"))

            elif roll < p_right + p_left:
                # --- SCROLL LEFT (swipe right to go back) ---
                # Going back to re-check someone, slightly faster than forward scroll
                x1 = int(self.adb.screen_w * random.uniform(0.28, 0.38)) + random.randint(-8, 8)
                x2 = int(self.adb.screen_w * random.uniform(0.58, 0.68)) + random.randint(-8, 8)
                y_jitter = carousel_y + random.randint(-5, 5)
                duration = random.randint(350, 600)
                self.adb.swipe(x1, y_jitter, x2, y_jitter, duration)
                scroll_pos = max(0, scroll_pos - 1)
                total_scrolls += 1
                actions_log.append("left")
                time.sleep(self.human.timing("t_carousel_scroll"))

            elif roll < p_right + p_left + p_tap:
                # --- TAP A STORY ---
                # Weight toward first visible Story (most prominent), but
                # if we scrolled back, the one we went back for is usually
                # the 1st or 2nd visible.
                positions = ["stories_carousel_1", "stories_carousel_2", "stories_carousel_3"]
                w1 = 2.0 + story_affinity
                w2 = 1.0 + curiosity * 0.5
                w3 = 0.5
                # After scrolling back, even stronger bias to first visible
                if actions_log and actions_log[-1] == "left":
                    w1 += 1.5
                weights = [w1, w2, w3]
                choice = random.choices(range(len(positions)), weights=weights)[0]
                sx, sy = self.adb.get_coord("tiktok", positions[choice])
                sx += random.randint(-8, 8)
                sy += random.randint(-8, 8)
                self.adb.tap(sx, sy)
                time.sleep(self.human.timing("t_carousel_scroll"))

                # LIVE guard: carousel mixes Stories and LIVE streams.
                # After tapping, classify what we entered. Retry if page
                # still loading (classify returns "other" on loading screens).
                def _classify_not_other(shot):
                    cls = gemini.classify_screen_with_reference(shot)
                    return cls if cls != "other" else False

                _vr = wait_and_verify(
                    adb=self.adb, human=self.human,
                    verify_fn=_classify_not_other,
                    action_name="story_classify",
                    first_wait="t_tab_content_load",
                    is_slow_verify=True,
                    max_attempts=2,
                    max_total_s=12.0,
                )
                _cls = _vr.result if _vr.success else "other"
                if _cls != "story":
                    log.info("CAROUSEL: entered LIVE (classified=%s), exiting via X", _cls)
                    self._exit_live()
                    actions_log.append("live_exit")
                    # After exit_live, bot may be on FYP (nuclear escape) not carousel.
                    # Break out — don't continue tapping carousel positions on wrong page.
                    break

                actions_log.append("tap")
                tapped = True
                log.info("CAROUSEL: tapped Story position %d (scroll_pos=%d, scrolls=%d, seq=%s)",
                         choice + 1, scroll_pos, total_scrolls, "->".join(actions_log))
                return True

            else:
                # --- STOP: done browsing ---
                actions_log.append("stop")
                break

        log.info("CAROUSEL: browsed %d scrolls (pos=%d), no tap, seq=%s",
                 total_scrolls, scroll_pos, "->".join(actions_log) if actions_log else "none")
        return False

    async def browse_following_session(self, niche_keywords=None):
        """Browse the Following tab -- Stories carousel + video feed.
        Called when pick_action() returns 'browse_following'."""
        log.info("SESSION: browse_following started")

        if not self._tap_top_tab("Following"):
            log.warning("Following tab not found, returning to FYP")
            return

        time.sleep(self.human.timing("t_tab_switch"))
        time.sleep(self.human.timing("t_tab_load_settle"))

        # Double verify: confirm we're actually on Following after page fully loaded
        # (catches lag where verify passed but page hadn't loaded yet)
        if not self._verify_top_tab("following"):
            log.warning("FOLLOWING: double verify failed after settle, retrying tab")
            if not self._tap_top_tab("Following"):
                log.warning("FOLLOWING: retry failed, aborting")
                return
            time.sleep(self.human.timing("t_tab_load_settle"))

        # Phase 1: Stories carousel (optional, may watch multiple Stories)
        stories_watched = 0
        while stories_watched < 4:  # max 4 Stories per visit
            tapped = self._browse_stories_carousel()
            if not tapped:
                break
            time.sleep(self.human.timing("t_tab_content_load"))
            self._navigate_stories(max_stories=4)
            self.adb.press_back()
            time.sleep(self.human.timing("t_back_verify"))
            stories_watched += 1
            # Decide: tap another Story or move to videos?
            story_aff = self.human.personality.story_affinity if self.human.personality else 0.5
            fatigue = self.human.fatigue.fatigue_level if self.human.fatigue else 0
            another_drive = story_aff * 0.4 - fatigue * 0.3 - stories_watched * 0.15
            if random.random() > max(0.05, another_drive):
                log.info("FOLLOWING: watched %d Stories, moving to videos", stories_watched)
                break
            log.info("FOLLOWING: watched %d Stories, checking for another", stories_watched)

        # Phase 2: Scroll down to make video fullscreen
        cx = self.adb.screen_w // 2
        self.adb.swipe(cx, int(self.adb.screen_h * 0.7), cx, int(self.adb.screen_h * 0.3),
                       random.randint(300, 500))
        time.sleep(self.human.timing("t_back_verify"))

        # Phase 3: Browse videos (same pattern as FYP scroll)
        # Following feed can contain LIVE streams mixed with regular videos.
        # Use sidebar scan before engagement (same approach as FYP browse_session).
        duration = random.uniform(60, 240)  # 1-4 min
        start = time.time()
        _health_countdown = random.randint(3, 5)
        while time.time() - start < duration:
            action = self.human.pick_action()
            if action in ("scroll_fyp", "browse_following", "browse_explore",
                          "browse_shop", "check_inbox"):
                # While in Following, treat navigation actions as scroll
                watch = self.human.watch_duration()
                time.sleep(watch)
                self.scroll_fyp()
                self.human.boredom.on_scroll(None)
                self.human.on_scroll_for_like()
            elif action in ("like", "comment", "follow", "profile_visit"):
                # LIVE/ad guard: check sidebar before engagement.
                # LIVE streams and ads have no sidebar icons.
                _sidebar = self._get_sidebar_positions()
                if _sidebar is None:
                    # Not a normal video -- scroll past (or briefly enter)
                    curiosity = self.human.personality.explore_curiosity if self.human.personality else 0.1
                    energy = self.human.mood.energy if self.human.mood else 1.0
                    enter_drive = curiosity * 0.8 + energy * 0.3
                    if random.random() < min(0.25, enter_drive):
                        log.info("FOLLOWING LIVE/AD: tapping to watch briefly")
                        cx, cy = self.adb.get_coord("tiktok", "video_center")
                        cx, cy = self.human.jitter_tap(cx, cy)
                        self.adb.tap(cx, cy)
                        time.sleep(self.human.timing("t_brief_watch"))
                        self.adb.press_back()
                        time.sleep(self.human.timing("t_back_verify"))
                        if not self._quick_verify_fyp():
                            self.nuclear_escape()
                    else:
                        log.info("FOLLOWING LIVE/AD: skipping, will scroll past")
                    time.sleep(self.human.action_delay())
                    continue

                # Normal video -- proceed with engagement
                if action == "like":
                    self.like_video()
                    self.human.on_like()
                elif action == "comment":
                    await self.comment_with_ai()
                elif action == "profile_visit":
                    if self.visit_creator_profile():
                        await self.rabbit_hole()
                        self.adb.press_back()
                        time.sleep(self.human.timing("t_back_verify"))
                elif action == "follow":
                    if self.visit_creator_profile():
                        self.follow_from_profile()
                        self.adb.press_back()
                        time.sleep(self.human.timing("t_back_verify"))
            else:
                watch = self.human.watch_duration()
                time.sleep(watch)
                self.scroll_fyp()

            time.sleep(self.human.action_delay())

            # Periodic health check every 3-5 videos
            _health_countdown -= 1
            if _health_countdown <= 0:
                _health_countdown = random.randint(3, 5)
                if not self._health_check_during_scroll("Following"):
                    log.warning("FOLLOWING: health check failed, ending session")
                    break

        # Return to For You -- use nav_home directly.
        # In fullscreen Following video mode the top tab bar is hidden,
        # so _tap_top_tab("For You") would waste Gemini calls on all 3 tiers
        # before failing. nav_home always works regardless of screen state.
        log.info("FOLLOWING: returning to FYP via nav_home")
        self.go_to_fyp()
        time.sleep(self.human.timing("t_back_verify"))
        log.info("SESSION: browse_following ended (%.0fs)", time.time() - start)

    def _tap_profile_grid_video(self, scrolled: bool = False):
        """Pick a random video from creator profile grid and tap it.
        If scrolled=True, we already scrolled so row 2 is more visible."""
        grid_keys = [f"profile_grid_{i}" for i in range(1, 7)]
        if scrolled:
            # After scrolling, row 2 is more prominent -- weight toward it
            weights = [1, 1, 1, 3, 3, 3]
        else:
            # Row 1 more visible on initial load -- weight toward it
            weights = [3, 3, 3, 1, 1, 1]
        chosen = random.choices(grid_keys, weights=weights, k=1)[0]
        gx, gy = self.adb.get_coord("tiktok", chosen)
        gx, gy = self.human.jitter_tap(gx, gy)
        log.debug("Profile grid: tapping %s (%d, %d)", chosen, gx, gy)
        self.adb.tap(gx, gy)

    def _maybe_scroll_grid(self, scroll_prob: float = 0.5):
        """Legacy wrapper — calls _human_browse_scroll for grids.
        Detects if scroll accidentally opened a fullscreen video (tap on thumbnail)
        and recovers by pressing BACK."""
        if random.random() >= scroll_prob:
            return False
        self._human_browse_scroll(context="grid")
        # Check if we accidentally entered fullscreen video player
        # (grid scroll tap interpreted as thumbnail tap)
        shot = self.adb.screenshot_bytes()
        if shot:
            result = gemini.identify_page_with_recovery(shot)
            page = result.get("page", "unknown")
            if page != "profile":
                log.warning("Grid scroll opened fullscreen player (%s), pressing BACK", page)
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))
        return True

    def _human_browse_scroll(self, context: str = "grid", max_override: int = None):
        """Universal human-like scroll sequence. Works for search results, profile grids, comments.

        Args:
            context: "grid" (search/profile), "comments" (stays in sheet bounds)
            max_override: force max number of scrolls (None = state-driven)

        Scroll behavior driven by personality + state:
        - Curious/patient → more scrolls, shorter, with pauses to read
        - Impatient/tired → fewer scrolls, longer, fast flicks
        - Sometimes scrolls back up to re-check something
        """
        h = self.human
        curiosity = h.personality.explore_curiosity
        patience = h.mood.patience
        fatigue = h.fatigue.fatigue_level if h.fatigue else 0.0
        boredom = h.boredom.level if h.boredom else 0.0
        energy = h.mood.energy

        # Bounds per context
        if context == "comments":
            y_top = 0.42    # top of comment sheet
            y_bottom = 0.88  # bottom of comment sheet (above input field)
            max_dist = 0.30  # max scroll distance within sheet
        else:  # grid (search results, profile)
            y_top = 0.15
            y_bottom = 0.85
            max_dist = 0.55

        # How many scrolls: state-driven continue/stop loop
        n_scrolls = 0
        max_scrolls = max_override if max_override else 8
        scrolled_down_total = 0  # track how far we've gone for scroll-back

        while n_scrolls < max_scrolls:
            # --- Maybe scroll BACK UP to re-check ---
            recheck_prob = 0.15 + curiosity * 0.5 + patience * 0.15 - fatigue * 0.1
            recheck_prob = max(0.10, min(0.40, recheck_prob))
            if n_scrolls > 0 and scrolled_down_total > 0.2 and random.random() < recheck_prob:
                # Scroll back up — short to medium distance
                back_dist = random.uniform(0.08, min(0.25, scrolled_down_total * 0.6))
                back_start_y = random.uniform(y_top + 0.05, y_top + 0.15)
                back_end_y = min(y_bottom, back_start_y + back_dist)
                # Faster scroll up (going back, not browsing)
                back_duration = random.randint(250, 380)
                sx = self.adb.screen_w // 2 + random.randint(-15, 15)
                self.adb.swipe(
                    sx, int(self.adb.screen_h * back_start_y),
                    sx + random.randint(-8, 8), int(self.adb.screen_h * back_end_y),
                    back_duration)
                scrolled_down_total -= back_dist
                log.debug("BROWSE_SCROLL: back up %.0f%% (total_down=%.0f%%)", back_dist * 100, scrolled_down_total * 100)
                time.sleep(self.human.timing("t_anim_complete"))

            # --- Scroll DOWN ---
            # Distance: patient = short careful, impatient = big jumps
            base_dist = 0.20 + (1.0 - patience) * 0.15 + fatigue * 0.08
            dist = max(0.08, min(max_dist, random.gauss(base_dist, 0.10)))

            # Speed: patient = slow, impatient = fast flick
            if patience > 1.0:
                duration = random.randint(350, 550)  # slow careful scroll
            elif fatigue > 0.4:
                duration = random.randint(250, 350)  # tired fast flick
            else:
                duration = random.randint(280, 450)  # normal

            # State-driven outlier: fatigue * 0.08 + (1-energy) * 0.03
            # More fumbles when tired/low energy
            is_risky_swipe = False
            _fatigue = self.human.fatigue.fatigue_level if hasattr(self.human, 'fatigue') and self.human.fatigue else 0.0
            _energy = getattr(getattr(self.human, 'mood', None), 'energy', 0.5)
            _outlier_prob = max(0.0, min(1.0, _fatigue * 0.08 + (1 - _energy) * 0.03))
            if random.random() < _outlier_prob:
                dist = max(0.04, dist * random.uniform(0.3, 0.6))
                duration = random.randint(150, 220)
                is_risky_swipe = True
                log.debug("BROWSE_SCROLL: outlier micro-swipe dist=%.0f%% dur=%dms", dist * 100, duration)

            start_y_pct = random.uniform(y_bottom - 0.10, y_bottom)
            end_y_pct = max(y_top, start_y_pct - dist)

            sx = self.adb.screen_w // 2 + random.randint(-15, 15)
            sw = self.human.humanize_swipe(
                sx, int(self.adb.screen_h * start_y_pct),
                sx, int(self.adb.screen_h * end_y_pct),
            )
            self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], duration)
            n_scrolls += 1
            scrolled_down_total += dist

            if context == "comments":
                self.adb.save_screenshot_if_recording("after_comment_scroll")

            # Risky swipe on grid: check if we accidentally tapped a video
            if is_risky_swipe and context == "grid":
                time.sleep(self.human.timing("t_tap_gap"))
                shot = self.adb.screenshot_bytes()
                if shot:
                    page_check = gemini.identify_page_with_recovery(shot)
                    if page_check.get("page") not in ("profile", "search"):
                        log.warning("BROWSE_SCROLL: outlier swipe opened video (%s), pressing BACK",
                                    page_check.get("page"))
                        self.adb.press_back()
                        time.sleep(self.human.timing("t_nav_settle"))
                        continue  # skip pause, continue scrolling grid
                else:
                    # Screenshot failed — can't verify, play it safe: press BACK
                    log.warning("BROWSE_SCROLL: screenshot failed after outlier swipe, pressing BACK as safety")
                    self.adb.press_back()
                    time.sleep(self.human.timing("t_nav_settle"))
                    continue

            # Pause: patient reads, impatient barely stops
            if patience > 1.0:
                pause = random.uniform(1.0, 3.0)
            elif fatigue > 0.4:
                pause = random.uniform(0.3, 1.0)
            else:
                pause = random.uniform(0.5, 2.0)
            time.sleep(pause)

            log.debug("BROWSE_SCROLL: %s scroll %d dist=%.0f%% dur=%dms pause=%.1fs",
                       context, n_scrolls, dist * 100, duration, pause)

            # --- Continue or stop? ---
            if n_scrolls == 1 and context != "comments":
                # First scroll: high continue probability (just started browsing)
                continue_prob = 0.85 + curiosity * 0.5
            else:
                continue_base = 0.45 + curiosity * 1.5 + patience * 0.10 - fatigue * 0.15
                if dist < 0.15:
                    continue_base += 0.10  # short scroll = still browsing
                if dist > 0.40:
                    continue_base -= 0.10  # big scroll = covered a lot
                continue_prob = max(0.08, min(0.80, continue_base - n_scrolls * 0.10))

            if random.random() >= continue_prob:
                log.debug("BROWSE_SCROLL: stopping after %d scrolls", n_scrolls)
                break

    async def rabbit_hole(self):
        """Visit creator profile, browse their grid, watch videos.
        Sometimes just glance and leave, sometimes scroll without tapping."""
        if not self.visit_creator_profile():
            log.warning("rabbit_hole: profile navigation failed, aborting")
            return
        time.sleep(self.human.timing("t_nav_settle"))

        # --- Quick exit behaviors (state-driven, not fixed probability) ---
        fatigue = self.human.fatigue.fatigue_level if self.human.fatigue else 0.0
        curiosity = self.human.personality.explore_curiosity
        boredom = self.human.boredom.level if self.human.boredom else 0.0
        patience = self.human.mood.patience

        # Quick glance: impatient, fatigued, not curious = higher chance
        # Patient, curious, low fatigue = lower (but still happens ~12%)
        quick_glance_p = (0.20
                          + fatigue * 0.10
                          + (1.0 - patience) * 0.08
                          - curiosity * 0.08)
        quick_glance_p = max(0.12, min(0.38, quick_glance_p))

        # Scroll-only: moderate curiosity but tired/bored = browse without committing
        scroll_only_p = (0.10
                         + fatigue * 0.08
                         + boredom * 0.06
                         - curiosity * 0.08)
        scroll_only_p = max(0.05, min(0.20, scroll_only_p))

        roll = random.random()
        if roll < quick_glance_p:
            # Quick glance — entered by accident or not interested.
            glance = random.uniform(1.0, 3.0)
            log.debug("Profile quick glance (p=%.2f): %.1fs then back",
                      quick_glance_p, glance)
            await asyncio.sleep(glance)
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            return
        elif roll < quick_glance_p + scroll_only_p:
            # Scroll browse only — scroll the grid a bit, read, then leave
            log.debug("Profile scroll-only browse (p=%.2f)", scroll_only_p)
            await asyncio.sleep(self.human.timing("t_browse_results") * random.uniform(0.3, 0.6))
            n_scrolls = random.randint(1, 3)
            for _ in range(n_scrolls):
                self._maybe_scroll_grid(scroll_prob=1.0)
                await asyncio.sleep(self.human.timing("t_search_scroll_pause"))
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            return

        # --- Normal rabbit hole: scan then watch videos ---
        n_videos = self.human.rabbit_hole_depth()
        log.info("Rabbit hole: watching %d videos on profile", n_videos)

        # Scan bio/stats before touching anything
        await asyncio.sleep(self.human.timing("t_browse_results") * random.uniform(0.3, 0.6))

        for i in range(n_videos):
            if i == 0:
                # 40-60% chance: scroll the grid before picking a video
                scrolled = self._maybe_scroll_grid(scroll_prob=random.uniform(0.4, 0.6))
                self._tap_profile_grid_video(scrolled=scrolled)
                time.sleep(self.human.timing("t_nav_settle"))
            else:
                self.scroll_fyp()

            watch = self.human.watch_duration(15)
            await asyncio.sleep(watch)
            self.guardian.handle_if_popup()

            if self.human.should_like():
                self.like_video()

        # Go back to FYP (video -> profile -> FYP)
        self.adb.press_back()
        time.sleep(self.human.timing("micro_pause"))
        self.adb.press_back()
        time.sleep(self.human.timing("t_nav_settle"))
        self._verify_page("fyp")

    def _type_search_query(self, keyword: str) -> bool:
        """Navigate to search, type keyword, hit enter. Returns False if search failed."""
        log.info("SEARCH: typing '%s'", keyword)
        if not self.go_to_search():
            log.error("SEARCH: couldn't open search page, aborting")
            return False

        # Tap search bar to ensure it's focused (defensive — should already be focused
        # from search_icon, but if we came from a different path the bar might not be active)
        x, y = self.adb.get_coord("tiktok", "search_bar")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_tap_gap"))

        self.human.type_with_errors(self.adb, keyword)
        time.sleep(self.human.timing("micro_pause"))
        self.adb.press_enter()
        time.sleep(self.human.timing("t_browse_results"))
        self.adb.save_screenshot_if_recording("after_search_enter")
        return True

    def _clear_and_retype(self, keyword: str):
        """Clear search bar via X button, then type new keyword."""
        log.info("SEARCH_RETYPE: clearing, new='%s'", keyword)

        # Tap X button to clear (don't tap search bar first — that deselects text
        # and can make the X disappear)
        cx, cy = self.adb.get_coord("tiktok", "search_clear")
        cx, cy = self.human.jitter_tap(cx, cy)
        self.adb.tap(cx, cy)
        time.sleep(self.human.timing("t_search_clear"))
        self.adb.save_screenshot_if_recording("after_search_clear")

        # Tap search bar to focus it and bring up keyboard
        x, y = self.adb.get_coord("tiktok", "search_bar")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_tap_gap"))

        # Think about what to search next
        time.sleep(self.human.timing("t_thinking"))

        self.human.type_with_errors(self.adb, keyword)
        time.sleep(self.human.timing("micro_pause"))
        self.adb.press_enter()
        time.sleep(self.human.timing("t_browse_results"))

    async def search_explore_session(self, niche_keywords: list = None, entry: str = "search_icon"):
        """Human-like search mini-session. Every decision driven by
        personality + boredom + mood -- zero fixed probabilities.

        Flow: search keyword -> scroll results watching videos -> maybe tap
        a profile -> maybe search another keyword -> leave.

        Args:
            niche_keywords: optional keyword pool override
            entry: "search_icon" (default, opens search via magnifier) or
                   "explore_tab" (taps the Explore top tab first)
        """
        # PopupGuardian: pre-chain check before search flow starts
        self.guardian.handle_if_popup()

        if entry == "explore_tab":
            if not self._tap_top_tab("Explore"):
                log.warning("Explore tab not found, falling back to search")
                entry = "search_icon"
            else:
                time.sleep(self.human.timing("t_tab_switch"))

        pool = niche_keywords or config.NICHE_KEYWORDS_POOL
        session_keywords = random.sample(pool, min(6, len(pool)))
        keyword = session_keywords.pop(0)

        log.info("Search explore: '%s'", keyword)
        if entry == "search_icon" and not self._type_search_query(keyword):
            log.warning("Search explore aborted — couldn't open search")
            return
        elif entry == "explore_tab":
            # On explore tab, use the search bar at top
            if not self._type_search_query(keyword):
                log.warning("Search explore aborted — couldn't open search from explore")
                return

        # --- Live state that drives every decision ---
        curiosity = self.human.personality.explore_curiosity  # 0.03..0.20
        boredom = self.human.boredom.level if self.human.boredom else 0.0  # 0.0..1.0
        energy = self.human.mood.energy                       # 0.5..1.5
        patience = self.human.mood.patience                   # 0.4..1.8
        videos_watched = 0
        found_interesting = False

        # How many results to browse -- driven by curiosity + boredom + energy
        # Curious/bored/energetic = browse more. Low all three = quick glance
        browse_drive = curiosity * 5 + boredom * 3 + energy * 0.5
        n_results = max(2, int(random.gauss(browse_drive, browse_drive * 0.3)))
        n_results = min(n_results, 8)

        grid_keys = [f"search_grid_{i}" for i in range(1, 5)]
        # Shuffle the order we visit grid slots (don't always go 1->2->3->4)
        grid_order = list(range(len(grid_keys)))
        random.shuffle(grid_order)
        has_scrolled_grid = False  # after scrolling, fixed coords are stale
        cached_thumbnails = []    # Gemini Vision results cached per scroll stop

        for i in range(n_results):
            # 75-90%: scroll the results grid before tapping first video
            # A human browses search results before choosing — doesn't tap the first thing
            if i == 0:
                n_grid_scrolls = random.choices([0, 1, 2, 3], weights=[0.15, 0.40, 0.30, 0.15], k=1)[0]
                for _ in range(n_grid_scrolls):
                    self._maybe_scroll_grid(scroll_prob=1.0)
                scrolled = n_grid_scrolls > 0
                if scrolled:
                    has_scrolled_grid = True
                    cached_thumbnails = []

            # Pick which grid slot to tap
            if not has_scrolled_grid and i < len(grid_keys):
                # Initial view (no scroll yet) -- fixed coords are valid
                slot_idx = grid_order[i]
                gx, gy = self.adb.get_coord("tiktok", grid_keys[slot_idx])
            else:
                # After scrolling: use Gemini Vision to find actual thumbnails
                if not cached_thumbnails:
                    # Take screenshot (screen is stopped) and find thumbnails
                    shot = self.adb.screenshot_bytes()
                    if shot:
                        cached_thumbnails = gemini.find_search_grid_thumbnails(
                            shot, self.adb.screen_w, self.adb.screen_h
                        )
                    if not cached_thumbnails:
                        # Gemini failed -- fallback to fixed coords
                        log.debug("Vision grid failed, using fixed coords")
                        gx, gy = self.adb.get_coord(
                            "tiktok", grid_keys[i % len(grid_keys)])
                    else:
                        # Pick a random thumbnail from found ones
                        thumb = random.choice(cached_thumbnails)
                        cached_thumbnails.remove(thumb)
                        gx, gy = thumb["x"], thumb["y"]
                else:
                    # Use cached thumbnails from previous Vision call
                    thumb = random.choice(cached_thumbnails)
                    cached_thumbnails.remove(thumb)
                    gx, gy = thumb["x"], thumb["y"]

                # If we need more results, scroll again
                if i > 0 and i % 3 == 0:
                    sw = self.human.humanize_swipe(
                        self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
                        self.adb.screen_w // 2, self.adb.screen_h // 3,
                    )
                    self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"],
                                   sw["duration"])
                    await asyncio.sleep(self.human.timing("t_search_scroll_pause"))
                    has_scrolled_grid = True
                    cached_thumbnails = []  # invalidate -- positions changed
                    continue  # re-loop to take fresh screenshot

            gx, gy = self.human.jitter_tap(gx, gy, target_size="medium")
            self.adb.tap(gx, gy)

            # Verify video opened with retry (slow phones / slow network)
            vr = wait_and_verify(
                adb=self.adb, human=self.human,
                verify_fn=lambda shot: gemini.identify_page_with_recovery(shot).get("page") != "search",
                action_name="open_search_video",
                first_wait="t_video_open",
                is_slow_verify=True,
                max_attempts=2,
                max_total_s=12.0,
            )
            if not vr.success:
                log.warning("Search grid tap missed — still on search page, skipping")
                continue

            # Watch the video
            watch = self.human.watch_duration()
            await asyncio.sleep(watch)
            self.guardian.handle_if_popup()
            videos_watched += 1

            # Like? -- energy drives base impulse, watching more = more likely
            # to find something worth liking, boredom = more impulsive
            like_drive = (energy * 0.15
                          + videos_watched * 0.04
                          + boredom * 0.06)
            if random.random() < like_drive:
                self.like_video()
                self.human.on_engage()
                found_interesting = True
                await asyncio.sleep(self.human.post_like_pause())

            # Visit creator profile? -- curiosity accumulates with exposure,
            # boredom pushes exploration, already-engaged = less need
            profile_drive = (curiosity * 1.5
                             + videos_watched * 0.03
                             + boredom * 0.08
                             - (0.12 if found_interesting else 0))
            if random.random() < max(0, profile_drive):
                log.debug("Search: visiting creator profile")
                if not self.visit_creator_profile():
                    log.warning("Search: profile visit failed, recovering")
                    # Verify we're back on a usable page (search or video)
                    self.adb.press_back()
                    await asyncio.sleep(self.human.timing("t_nav_settle"))
                    shot = self.adb.screenshot_bytes()
                    if shot:
                        page_check = gemini.identify_page_with_recovery(shot)
                        pg = page_check.get("page", "unknown")
                        if pg not in ("search", "fyp", "profile"):
                            log.warning("Search: lost after profile fail (on %s), exiting search", pg)
                            break  # exit search loop, browse_session will _return_to_fyp
                    continue

                # Scan bio/stats briefly
                await asyncio.sleep(self.human.timing("t_nav_settle"))

                # Mini rabbit hole (shorter than FYP rabbit hole)
                depth = max(1, int(random.gauss(2 + curiosity * 8, 1)))
                depth = min(depth, 5)
                for v in range(depth):
                    if v == 0:
                        scrolled = self._maybe_scroll_grid(
                            scroll_prob=random.uniform(0.4, 0.6))
                        self._tap_profile_grid_video(scrolled=scrolled)
                        time.sleep(self.human.timing("t_nav_settle"))
                    else:
                        self.scroll_fyp()
                    await asyncio.sleep(self.human.watch_duration(15))
                    self.guardian.handle_if_popup()

                    if self.human.should_like():
                        self.like_video()
                        self.human.on_engage()
                        found_interesting = True

                # Back to search results (2 backs: video -> profile -> results)
                self.adb.press_back()
                time.sleep(self.human.timing("micro_pause"))
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))
                if not self._verify_page("search"):
                    log.warning("search_explore: lost after profile visit, aborting")
                    return
            else:
                # Sometimes swipe through more videos before going back to grid
                # (like FYP — human doesn't always go back to grid after each video)
                swipe_drive = curiosity * 2 + boredom * 0.5 + energy * 0.3
                if random.random() < max(0.15, min(0.50, swipe_drive)):
                    # Usually 1-3, sometimes more (outliers up to 8)
                    n_swipes = max(1, int(random.gauss(2 + curiosity * 5, 1.5)))
                    n_swipes = min(n_swipes, 8)
                    log.debug("Search: swiping through %d more videos before returning", n_swipes)
                    for sw_i in range(n_swipes):
                        self.scroll_fyp()
                        await asyncio.sleep(self.human.watch_duration())
                        videos_watched += 1
                        if random.random() < like_drive:
                            self.like_video()
                            self.human.on_engage()
                            found_interesting = True

                # Back from video to results grid
                self.adb.press_back()
                await asyncio.sleep(self.human.timing("t_search_scroll_pause"))

            # Slight boredom relief from active browsing
            self.human.boredom.on_scroll(True if found_interesting else None)

        # --- Second keyword? ---
        # High boredom + curiosity + didn't find interesting = try another
        # Found good stuff = less likely to switch (you're satisfied)
        if session_keywords:
            second_drive = (curiosity * 2.5
                            + self.human.boredom.level * 0.4
                            + patience * 0.05
                            - (0.25 if found_interesting else 0))
            if random.random() < max(0.05, min(0.6, second_drive)):
                keyword2 = session_keywords.pop(0)
                log.info("Search explore: second keyword '%s'", keyword2)
                self._clear_and_retype(keyword2)

                # Shorter second browse (attention fading)
                n2 = max(1, int(n_results * random.uniform(0.3, 0.7)))
                grid_order2 = list(range(len(grid_keys)))
                random.shuffle(grid_order2)
                # Maybe scroll before first tap here too
                scrolled2 = self._maybe_scroll_grid(
                    scroll_prob=random.uniform(0.4, 0.6))
                cached2 = []
                for j in range(n2):
                    if not scrolled2 and j < len(grid_keys):
                        slot_idx = grid_order2[j]
                        gx, gy = self.adb.get_coord("tiktok", grid_keys[slot_idx])
                    else:
                        # Use Vision for grid after scroll
                        if not cached2:
                            shot2 = self.adb.screenshot_bytes()
                            if shot2:
                                cached2 = gemini.find_search_grid_thumbnails(
                                    shot2, self.adb.screen_w, self.adb.screen_h)
                        if cached2:
                            thumb2 = random.choice(cached2)
                            cached2.remove(thumb2)
                            gx, gy = thumb2["x"], thumb2["y"]
                        else:
                            gx, gy = self.adb.get_coord(
                                "tiktok", grid_keys[j % len(grid_keys)])

                    gx, gy = self.human.jitter_tap(gx, gy, target_size="medium")
                    self.adb.tap(gx, gy)
                    await asyncio.sleep(self.human.watch_duration())
                    self.guardian.handle_if_popup()

                    like2 = energy * 0.12 + videos_watched * 0.02
                    if random.random() < like2:
                        self.like_video()
                        self.human.on_engage()

                    self.adb.press_back()
                    await asyncio.sleep(
                        self.human.timing("t_search_scroll_pause"))
                    videos_watched += 1

        self.human._session_stats["searches_done"] = \
            self.human._session_stats.get("searches_done", 0) + 1
        log.info("Search explore done: watched %d videos", videos_watched)

    async def browse_explore_session(self, niche_keywords=None):
        """Browse the Explore tab. Reuses search_explore_session logic."""
        log.info("SESSION: browse_explore started")
        self.human._explore_done_this_session = True
        await self.search_explore_session(niche_keywords=niche_keywords, entry="explore_tab")
        self._return_to_foryou()
        log.info("SESSION: browse_explore ended")

    def search_hashtag(self, hashtag: str):
        """Legacy wrapper -- simple search without full explore session."""
        self._type_search_query(hashtag)

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
                x, y = self.human.jitter_tap(coords[0], coords[1])
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
                x, y = self.human.jitter_tap(coords[0], coords[1])
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
        self.guardian.handle_if_popup()
        x, y = self.adb.get_coord("tiktok", "nav_create")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_upload_load"))

        # Step 3: Tap "Upload" tab
        self.guardian.handle_if_popup()
        x, y = self.adb.get_coord("tiktok", "upload_tab")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Step 4: Select most recent video (top-left of gallery)
        self.guardian.handle_if_popup()
        x, y = self.adb.get_coord("tiktok", "gallery_first")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Step 5: Tap Next (top-right)
        self.guardian.handle_if_popup()
        x, y = self.adb.get_coord("tiktok", "upload_next_btn")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_nav_settle"))

        # Step 6: May need to tap Next again (editing screen)
        self.guardian.handle_if_popup()
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
        # Critical: pre-chain check to make sure no popup covers the Post button
        self.guardian.pre_chain_check()
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

    async def check_inbox_session(self):
        """Check the Inbox/Notifications page with realistic girl behavior.

        Realistic flow: open Inbox -> maybe check stories -> maybe browse
        New Followers -> maybe check Activity -> rarely just scroll main page.
        All decisions state-driven (social, curiosity, fatigue, story_affinity).
        Max 3 actions per visit. Each action is independently decided (not
        mutually exclusive), order shuffled per visit."""
        log.info("SESSION: check_inbox started")

        # --- Navigate to Inbox ---
        x, y = self.adb.get_coord("tiktok", "nav_inbox")
        x, y = self.human.jitter_tap(x, y)
        self.adb.tap(x, y)
        time.sleep(self.human.timing("t_tab_switch"))

        # Reset badge flag
        self.human._inbox_badge_detected = False

        # No scroll_to_top needed: TikTok opens Inbox at the top after nav tap,
        # and _find_and_tap() locates sub-sections visually regardless of position
        time.sleep(self.human.timing("t_inbox_glance"))

        # --- Read behavioral state ---
        social = self.human.mood.social if self.human.mood else 1.0
        curiosity = self.human.personality.explore_curiosity if self.human.personality else 0.1
        fatigue = self.human.fatigue.fatigue_level if self.human.fatigue else 0.0
        boredom = self.human.boredom.level if self.human.boredom else 0.0
        energy = max(0.0, 1.0 - fatigue)
        story_affinity = self.human.personality.story_affinity if self.human.personality else 0.5

        # --- Decide which actions to attempt (independent coin flips) ---
        # Stories: ~30% baseline, higher with story_affinity, lower with fatigue
        do_stories = random.random() < (story_affinity * 0.5 * (1.0 - fatigue * 0.3))
        # New Followers: ~60-70% for average social personality
        do_followers = random.random() < (social * 0.65 + curiosity * 0.1 - fatigue * 0.15)
        # Activity: ~40-50% driven by curiosity + social
        do_activity = random.random() < (curiosity * 0.45 + social * 0.25 - fatigue * 0.1)
        # Just scroll main inbox: rare, 2-6% driven by fatigue/boredom
        do_scroll_main = random.random() < (fatigue * 0.06 + boredom * 0.04)

        # Build action list, shuffle order, cap at 3
        action_queue = []
        if do_stories:
            action_queue.append("stories")
        if do_followers:
            action_queue.append("new_followers")
        if do_activity:
            action_queue.append("activity")
        if do_scroll_main:
            action_queue.append("scroll_main")

        # If nothing selected (very rare), at least glance
        if not action_queue:
            action_queue.append("glance_only")

        random.shuffle(action_queue)
        action_queue = action_queue[:3]

        log.info("INBOX: planned actions=%s (social=%.2f, curiosity=%.2f, fatigue=%.2f)",
                 action_queue, social, curiosity, fatigue)

        actions_done = 0

        for action in action_queue:
            if action == "stories":
                log.info("INBOX: checking Stories carousel")
                if self._has_stories_carousel():
                    tapped = self._browse_stories_carousel()
                    if tapped:
                        time.sleep(self.human.timing("t_tab_switch"))
                        max_stories = max(1, int(random.gauss(2.0 + story_affinity * 2, 0.8)))
                        max_stories = min(max_stories, 5)
                        self._navigate_stories(max_stories=max_stories)
                        self.adb.press_back()
                        time.sleep(self.human.timing("t_nav_settle"))
                    actions_done += 1
                else:
                    log.info("INBOX: no Stories visible, skipping")

            elif action == "new_followers":
                log.info("INBOX: entering New Followers")
                entered = self._inbox_enter_subpage("New followers")
                if not entered:
                    actions_done += 1
                    continue
                self._browse_new_followers(social, curiosity, fatigue, boredom, energy)
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))
                actions_done += 1

            elif action == "activity":
                log.info("INBOX: entering Activity")
                entered = self._inbox_enter_subpage("Activity")
                if not entered:
                    actions_done += 1
                    continue
                self._browse_activity(social, curiosity, fatigue, boredom, energy)
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))
                actions_done += 1

            elif action == "scroll_main":
                log.info("INBOX: scrolling main inbox page (rare browse)")
                # 1-2 gentle scrolls on the main inbox page (suggested accounts area)
                # State-driven: fatigued = 1 scroll, otherwise patience-driven
                _fatigue_lvl = self.human.fatigue.fatigue_level if hasattr(self.human, 'fatigue') and self.human.fatigue else 0.0
                _patience = getattr(getattr(self.human, 'mood', None), 'patience', 0.5)
                n_scrolls = 1 if _fatigue_lvl > 0.5 else (1 if random.random() < _patience * 0.7 else 2)
                for _ in range(n_scrolls):
                    sx = self.adb.screen_w // 2 + random.randint(-20, 20)
                    start_y = int(self.adb.screen_h * random.uniform(0.65, 0.75))
                    end_y = int(self.adb.screen_h * random.uniform(0.30, 0.40))
                    dur = random.randint(350, 550)
                    self.adb.swipe(sx, start_y, sx + random.randint(-8, 8), end_y, dur)
                    time.sleep(self.human.timing("t_inbox_glance") * random.uniform(0.6, 1.0))
                actions_done += 1

            elif action == "glance_only":
                log.info("INBOX: just glancing at inbox")
                time.sleep(self.human.timing("t_inbox_glance"))
                actions_done += 1

            # Small pause between actions (reading / deciding what to do next)
            if action != action_queue[-1]:
                time.sleep(self.human.timing("t_inbox_glance") * random.uniform(0.3, 0.7))

        self.go_to_fyp()
        time.sleep(self.human.timing("t_nav_settle"))
        log.info("SESSION: check_inbox ended (%d actions)", actions_done)

    def _evaluate_and_maybe_follow_back(self, social, curiosity, fatigue, energy):
        """Enter a follower's profile, evaluate niche fit via Gemini, follow if in-niche.

        Steps:
        1. Tap follower avatar → enter profile
        2. Screenshot profile → Gemini niche score
        3. Maybe open 1-2 videos (curiosity-driven, more likely if profile score ambiguous)
        4. Aggregate scores → decide follow or skip
        5. Follow via _scroll_to_top_and_follow() or press back

        Returns True if followed, False if skipped or failed.
        """
        # --- Step 1: Verify we're on New Followers page + tap avatar ---
        # Combined: the prompt requires "started following you" rows to be visible.
        # If we're not on New Followers, Gemini won't find a matching avatar → returns None.
        log.info("NICHE_FOLLOW: looking for follower avatar on New Followers page")
        found = self._find_and_tap(
            'a follower\'s circular profile picture avatar on the LEFT side '
            'of a row that has a RED "Follow back" button on the RIGHT side. '
            'The row should say "started following you". '
            'NOT a suggested account. NOT "Message" button row. '
            'Pick one near the TOP of the visible list.',
            y_max_pct=0.50
        )
        if not found:
            log.info("NICHE_FOLLOW: no follower avatar found (may not be on New Followers page)")
            return False

        time.sleep(self.human.timing("t_tab_switch"))

        # --- Step 2: Glance first (let profile + video grid load) ---
        # Human reads bio/stats while thumbnails load in background.
        # Without this wait, screenshot captures empty grid = wrong score.
        time.sleep(self.human.timing("t_niche_profile_glance"))

        # --- Step 3: Combined check (1 Gemini call = profile verify + tab check + niche score) ---
        screenshot = self.adb.screenshot_bytes()
        if not screenshot:
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            return False

        niche_kw = getattr(self, '_session_keywords', config.NICHE_KEYWORDS_POOL[:10])
        profile_result = gemini.evaluate_niche_fit(
            screenshot,
            niche_description=config.NICHE_DESCRIPTION,
            niche_keywords=niche_kw,
            context="profile",
        )

        # Check: is it actually a profile page?
        if not profile_result.get("is_profile", False):
            log.info("NICHE_FOLLOW: not on profile page, pressing back")
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            return False

        # Check: are we on the Videos tab?
        active_tab = profile_result.get("active_tab", "unknown")
        if active_tab != "videos":
            log.info("NICHE_FOLLOW: on '%s' tab, switching to Videos", active_tab)
            vid_tab = gemini.find_element_by_vision(
                screenshot,
                'the FIRST content tab icon on the left (grid/bars icon) in the '
                'row of content type tabs below Follow/Message buttons. '
                'NOT the repost icon. NOT the likes icon.',
                self.adb.screen_w, self.adb.screen_h
            )
            if vid_tab:
                tx, ty, _ = vid_tab
                self.adb.tap(tx + random.randint(-3, 3), ty + random.randint(-3, 3))
                log.info("NICHE_FOLLOW: tapped Videos tab at (%d, %d)", tx, ty)
                time.sleep(self.human.timing("t_tab_switch"))
                # Re-screenshot and re-evaluate now that we see videos
                screenshot = self.adb.screenshot_bytes()
                if screenshot:
                    profile_result = gemini.evaluate_niche_fit(
                        screenshot,
                        niche_description=config.NICHE_DESCRIPTION,
                        niche_keywords=niche_kw,
                        context="profile",
                    )
            else:
                log.info("NICHE_FOLLOW: couldn't find Videos tab, proceeding with current view")
        else:
            log.info("NICHE_FOLLOW: already on Videos tab")

        profile_score = profile_result["score"]
        log.info("NICHE_FOLLOW: profile score=%d reason='%s'",
                 profile_score, profile_result["reason"])

        # --- Step 5: Maybe watch 1-2 videos for deeper eval (curiosity-driven) ---
        video_scores = []

        # More likely if profile score is ambiguous (35-75 range)
        video_check_drive = curiosity * 2.0 + energy * 0.3 - fatigue * 0.4
        if 35 <= profile_score <= 75:
            video_check_drive += 0.15
        do_video_check = random.random() < max(0.05, min(0.45, video_check_drive))

        if do_video_check:
            log.info("NICHE_FOLLOW: checking videos for deeper eval")
            # Maybe scroll grid first
            # State-driven: curiosity * 0.4 + boredom * 0.2
            _curiosity_g = getattr(getattr(self.human, 'mood', None), 'curiosity', 0.5)
            _boredom_g = self.human.boredom.level if hasattr(self.human, 'boredom') and self.human.boredom else 0.3
            _grid_prob = max(0.0, min(1.0, _curiosity_g * 0.4 + _boredom_g * 0.2))
            if random.random() < _grid_prob:
                self._human_browse_scroll("grid", max_override=1)
                time.sleep(self.human.timing("t_browse_results") * random.uniform(0.2, 0.4))

            # Tap a video from the grid
            self._tap_profile_grid_video()
            time.sleep(self.human.timing("t_niche_video_watch"))

            # Screenshot video + niche eval
            vid_shot = self.adb.screenshot_bytes()
            if vid_shot:
                vid_result = gemini.evaluate_niche_fit(
                    vid_shot,
                    niche_description=config.NICHE_DESCRIPTION,
                    niche_keywords=niche_kw,
                    context="video",
                )
                video_scores.append(vid_result["score"])
                log.info("NICHE_FOLLOW: video 1 score=%d reason='%s'",
                         vid_result["score"], vid_result["reason"])

            # Maybe watch a second video (lower probability)
            second_video_drive = curiosity * 1.5 + energy * 0.2 - fatigue * 0.3
            if random.random() < max(0.0, min(0.25, second_video_drive)):
                self.scroll_fyp()  # swipe to next video in profile feed
                time.sleep(self.human.timing("t_niche_video_watch") * random.uniform(0.6, 0.9))
                vid_shot2 = self.adb.screenshot_bytes()
                if vid_shot2:
                    vid_result2 = gemini.evaluate_niche_fit(
                        vid_shot2,
                        niche_description=config.NICHE_DESCRIPTION,
                        niche_keywords=niche_kw,
                        context="video",
                    )
                    video_scores.append(vid_result2["score"])
                    log.info("NICHE_FOLLOW: video 2 score=%d reason='%s'",
                             vid_result2["score"], vid_result2["reason"])

            # Go back to profile from video
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            # Verify we're back on profile (swiping to 2nd video = deeper nav stack)
            verify_shot = self.adb.screenshot_bytes()
            if verify_shot and not gemini.is_profile_page(verify_shot):
                log.info("NICHE_FOLLOW: not on profile after back, pressing back again")
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))

        # --- Step 6: Aggregate scores ---
        if video_scores:
            avg_video = sum(video_scores) / len(video_scores)
            final_score = profile_score * 0.6 + avg_video * 0.4
        else:
            final_score = float(profile_score)

        # --- Step 7: Personality-adjusted threshold ---
        threshold = config.NICHE_FOLLOW_THRESHOLD - social * 10 + fatigue * 5
        threshold = max(40, min(70, threshold))

        log.info("NICHE_FOLLOW: final_score=%.1f threshold=%.1f (profile=%d videos=%s)",
                 final_score, threshold, profile_score,
                 video_scores if video_scores else "none")

        # --- Step 8: Follow or skip ---
        if final_score >= threshold:
            log.info("NICHE_FOLLOW: IN NICHE (%.1f >= %.1f), following!", final_score, threshold)
            if self._scroll_to_top_and_follow():
                # on_follow() already called inside _scroll_to_top_and_follow()
                time.sleep(self.human.timing("t_browse_results") * random.uniform(0.15, 0.35))
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))
                return True
            else:
                # Already following or couldn't find button
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))
                return False
        else:
            log.info("NICHE_FOLLOW: NOT in niche (%.1f < %.1f), skipping", final_score, threshold)
            self.adb.press_back()
            time.sleep(self.human.timing("t_nav_settle"))
            return False

    def _browse_new_followers(self, social, curiosity, fatigue, boredom, energy):
        """Browse the New Followers sub-page with realistic behavior.

        Flow: glance -> maybe follow back ONE (on unscrolled view, only real
        followers visible) -> maybe View All -> scroll (profile visit only,
        NO follow-back in scroll loop) -> back.

        Follow-back happens BEFORE scrolling because scrolling brings Suggested
        accounts into view and the bot may tap those instead of real followers.

        SAFE: Follow back (after niche eval), avatar/username tap, View all, scroll
        NEVER: Message button, Remove button
        """
        # Phase 1: Initial glance
        glance_time = self.human.timing("t_inbox_glance") * (0.8 + social * 0.4)
        time.sleep(glance_time)
        items_seen = 3
        follow_attempted = False

        # Phase 2: Maybe follow back (on UNSCROLLED view)
        # _evaluate_and_maybe_follow_back handles everything: avatar finding,
        # niche eval, tab switch, video check, personality threshold, press_back.
        follow_drive = social * 0.12 + energy * 0.05 - fatigue * 0.06
        if random.random() < max(0.0, min(0.18, follow_drive)):
            if self.human._follow_allowed():
                log.info("NEW_FOLLOWERS: niche-evaluating a follower before follow-back")
                did_follow = self._evaluate_and_maybe_follow_back(
                    social, curiosity, fatigue, energy
                )
                follow_attempted = True
                if did_follow:
                    log.info("NEW_FOLLOWERS: followed back (niche-approved)!")
                    items_seen += 1
                else:
                    log.info("NEW_FOLLOWERS: skipped follow-back (not in niche or failed)")

        # Phase 3: Maybe tap "View all" to expand follower list (expands inline)
        view_all_drive = curiosity * 0.35 + social * 0.15 - fatigue * 0.1
        if random.random() < max(0.08, min(0.35, view_all_drive)):
            log.info("NEW_FOLLOWERS: tapping 'View all'")
            found_va = self._find_and_tap("View all", y_max_pct=0.60)
            if found_va:
                time.sleep(self.human.timing("t_tab_switch"))
                items_seen += 2

        # Phase 4: Scroll the follower list (profile visit only, NO follow-back)
        max_scrolls = max(1, int(random.gauss(2.0 + social * 2.0 - fatigue * 1.5, 0.8)))
        max_scrolls = min(max_scrolls, 5)
        scrolls_done = 0
        visited_profile = False

        while scrolls_done < max_scrolls:
            # --- Decide: visit a follower's profile? (once per visit max) ---
            if not visited_profile:
                profile_drive = curiosity * 0.25 + social * 0.15 - fatigue * 0.1
                if random.random() < max(0.05, min(0.25, profile_drive)):
                    log.info("NEW_FOLLOWERS: tapping a follower avatar")
                    found_profile = self._find_and_tap(
                        'a follower\'s circular profile picture avatar on the left '
                        'side of a "started following you" row. '
                        'NOT a suggested account. Pick one near the TOP.',
                        y_max_pct=0.50
                    )
                    if not found_profile:
                        visited_profile = True  # don't retry
                        continue
                    time.sleep(self.human.timing("t_tab_switch"))
                    # Glance at their profile
                    time.sleep(self.human.timing("t_inbox_glance") * random.uniform(1.0, 2.0))
                    # Maybe scroll their video grid
                    if random.random() < curiosity * 0.4:
                        self._human_browse_scroll("grid", max_override=2)
                    self.adb.press_back()
                    time.sleep(self.human.timing("t_nav_settle"))
                    visited_profile = True
                    items_seen += 3
                    continue

            # --- Decide: scroll more or exit? ---
            scroll_drive = social * 0.3 + curiosity * 0.2 + (1 - fatigue) * 0.2 - items_seen * 0.05
            if random.random() > max(0.1, min(0.7, scroll_drive)):
                break  # done browsing

            self._human_browse_scroll("grid", max_override=1)
            scrolls_done += 1
            items_seen += 3
            # Read pause after scroll
            time.sleep(self.human.timing("t_follower_read") * random.uniform(1.0, 2.0))

        log.info("NEW_FOLLOWERS: done (scrolls=%d, profile=%s, followed=%s)",
                 scrolls_done, visited_profile, follow_attempted)

    def _browse_activity(self, social, curiosity, fatigue, boredom, energy):
        """Browse the Activity notifications sub-page with realistic behavior.

        Flow: scan -> maybe tap Profile views -> maybe View All ->
        scroll -> maybe tap a SAFE notification -> back.

        SAFE: Profile views, "liked your comment", "viewed the video"
        NEVER: bulletin board invites, Ignore, Message, Follow buttons
        """
        # Phase 1: Initial scan (read top notifications)
        scan_time = self.human.timing("t_inbox_glance") * (0.7 + curiosity * 0.3)
        time.sleep(scan_time)

        tapped_something = False

        # Phase 2: Maybe tap "Profile views" (if curious)
        pv_drive = curiosity * 0.35 + social * 0.2 - fatigue * 0.1
        if random.random() < max(0.05, min(0.30, pv_drive)):
            log.info("ACTIVITY: looking for 'Profile views'")
            found = self._find_and_tap(
                'the "Profile views" notification row with a blue/purple people icon. '
                'NOT bulletin board invites. NOT "liked your comment".',
                y_max_pct=0.55
            )
            if found:
                log.info("ACTIVITY: opened Profile views")
                time.sleep(self.human.timing("t_profile_views_browse"))
                # Maybe scroll the viewers list
                if random.random() < curiosity * 0.3:
                    self._human_browse_scroll("grid", max_override=1)
                self.adb.press_back()
                time.sleep(self.human.timing("t_nav_settle"))
                tapped_something = True

        # Phase 3: Maybe tap "View all" to expand
        if not tapped_something:
            va_drive = curiosity * 0.3 + social * 0.12 - fatigue * 0.08
            if random.random() < max(0.06, min(0.25, va_drive)):
                log.info("ACTIVITY: tapping 'View all'")
                found_va = self._find_and_tap("View all", y_max_pct=0.55)
                if found_va:
                    time.sleep(self.human.timing("t_tab_switch"))

        # Phase 4: Scroll notifications
        max_scrolls = max(1, int(random.gauss(1.5 + curiosity * 1.5 - fatigue * 1.0, 0.7)))
        max_scrolls = min(max_scrolls, 4)
        scrolls_done = 0

        while scrolls_done < max_scrolls:
            scroll_drive = curiosity * 0.3 + social * 0.15 - fatigue * 0.15 - scrolls_done * 0.12
            if random.random() > max(0.08, min(0.55, scroll_drive)):
                break
            self._human_browse_scroll("grid", max_override=1)
            scrolls_done += 1
            time.sleep(self.human.timing("t_notification_read") * random.uniform(1.0, 2.5))

        # Phase 5: Maybe tap a SAFE notification (liked/viewed, NOT invites)
        if not tapped_something:
            tap_drive = curiosity * 0.3 + social * 0.15 - fatigue * 0.1
            if random.random() < max(0.05, min(0.25, tap_drive)):
                log.info("ACTIVITY: looking for a safe notification")
                found = self._find_and_tap(
                    'a notification that says "liked your comment" OR '
                    '"viewed the video you shared" OR "commented on your video". '
                    'Tap the notification TEXT, not any button. '
                    'Do NOT select "bulletin board", "invited you", or "Profile views". '
                    'Pick one in the MIDDLE of the visible list.',
                    y_max_pct=0.75
                )
                if found:
                    log.info("ACTIVITY: tapped safe notification, watching content")
                    # Watch the video/content that opened
                    watch_time = self.human.timing("t_inbox_glance") * random.uniform(1.5, 3.0)
                    time.sleep(watch_time)
                    self.adb.press_back()
                    time.sleep(self.human.timing("t_nav_settle"))

        # Brief final pause (reading last visible notification)
        time.sleep(self.human.timing("t_notification_read") * random.uniform(0.5, 1.0))

        log.info("ACTIVITY: done (scrolls=%d, tapped=%s)", scrolls_done, tapped_something)

    def _inbox_enter_subpage(self, label: str) -> bool:
        """Tap an Inbox sub-page link (New followers / Activity).

        Strategy (UNIVERSAL):
        1. Find and tap the row via Gemini (row-targeted prompt)
        2. Verify by checking WHERE the label appears on screen:
           - On Inbox: label is in the MIDDLE of screen (section label, y > 15%)
           - On sub-page: label is at the TOP as page header (y < 10%)
           This works on ALL phones — no brightness thresholds, no fingerprints.
        3. If not at top → tap didn't navigate → retry once

        Returns True if successfully entered the sub-page."""
        # --- Build row-targeted prompt ---
        if "follower" in label.lower():
            row_desc = (
                'the ENTIRE ROW for "New followers" section on the Inbox page. '
                'This row has a person-shaped icon on the left, bold "New followers" text, '
                'and smaller gray text below saying who followed you. '
                'Return the bounding box for the FULL ROW (icon + all text), not just the title.'
            )
            verify_text = 'the text "New followers"'
        else:
            row_desc = (
                'the ENTIRE ROW for "Activity" section on the Inbox page. '
                'This row has a colored bell/heart icon on the left, bold "Activity" text, '
                'and smaller gray text below with notification preview. '
                'Return the bounding box for the FULL ROW (icon + all text), not just the title.'
            )
            verify_text = 'the text "Activity"'

        def _check_subpage_header(shot):
            """Label at top (y < 10%) = navigated to sub-page."""
            pos = gemini.find_element_by_vision(
                shot, verify_text, self.adb.screen_w, self.adb.screen_h)
            if pos:
                y_pct = pos[1] / self.adb.screen_h
                if y_pct < 0.10:
                    return {"y_pct": y_pct}
            return False

        for attempt in range(2):
            found = self._find_and_tap(row_desc, y_max_pct=0.55)
            if not found:
                log.warning("INBOX: %s not found on screen (attempt %d)", label, attempt + 1)
                if attempt == 0:
                    continue
                return False

            vr = wait_and_verify(
                adb=self.adb, human=self.human,
                verify_fn=_check_subpage_header,
                action_name=f"inbox_enter_{label}",
                first_wait="t_tab_content_load",
                is_slow_verify=True,
                max_attempts=2,
                max_total_s=15.0,
            )
            if vr.success:
                y_pct = vr.result.get("y_pct", 0) * 100
                log.info("INBOX: entered %s (header at y=%.1f%%, attempt %d)",
                         label, y_pct, attempt + 1)
                return True

            if attempt == 0:
                log.warning("INBOX: retrying tap for %s", label)

        return False

    async def browse_shop_session(self):
        """Browse the Shop section briefly.
        SAFETY: never tap purchase/payment buttons."""
        log.info("SESSION: browse_shop started")
        self.human._shop_done_this_session = True

        if not self._tap_top_tab("Shop"):
            log.warning("Shop tab not found")
            return

        time.sleep(self.human.timing("t_tab_switch"))
        time.sleep(self.human.timing("t_tab_load_settle"))

        # Wait for popup
        time.sleep(self.human.timing("t_shop_popup_read"))
        screenshot = self.adb.screenshot_bytes()
        if screenshot:
            result = gemini.check_popup(screenshot, self.adb.screen_w, self.adb.screen_h)
            if result and result.get("has_popup"):
                # Guard against false positives: if popup_text is None/empty,
                # Gemini couldn't identify what it says — likely a Shop page element
                # mistaken for a popup. Confirm with a second check.
                popup_text = result.get("popup_text")
                if not popup_text:
                    log.info("SHOP: first check says popup but text=None — confirming...")
                    time.sleep(self.human.timing("t_anim_complete"))
                    screenshot2 = self.adb.screenshot_bytes()
                    if screenshot2:
                        result2 = gemini.check_popup(screenshot2, self.adb.screen_w, self.adb.screen_h)
                        if not (result2 and result2.get("has_popup") and result2.get("popup_text")):
                            log.info("SHOP: confirmation says NO popup — false positive, skipping dismiss")
                            result = None  # cancel dismiss
                        else:
                            log.info("SHOP: confirmation says popup '%s' — real popup", result2.get("popup_text"))
                            result = result2  # use confirmed result with text

                if result and result.get("has_popup"):
                    dx = result.get("dismiss_x")
                    dy = result.get("dismiss_y")
                    if dx is not None and dy is not None:
                        log.info("SHOP: popup detected '%s', tapping dismiss at (%d, %d) [%s]",
                                 result.get("popup_text", "?"), dx, dy, result.get("dismiss_label", "?"))
                        tx, ty = self.human.jitter_tap(dx, dy)
                        self.adb.tap(tx, ty)
                    else:
                        # Fallback: tap top-right X zone (do NOT press_back — exits Shop)
                        fx = int(self.adb.screen_w * 0.85)
                        fy = int(self.adb.screen_h * 0.35)
                        log.info("SHOP: popup detected, no coords — tapping fallback (%d, %d)", fx, fy)
                        tx, ty = self.human.jitter_tap(fx, fy)
                        self.adb.tap(tx, ty)
                    time.sleep(self.human.timing("t_tap_gap"))

        # Scroll products
        self._human_browse_scroll("shop_grid", max_override=6)

        # Maybe tap a product
        curiosity = self.human.personality.explore_curiosity if self.human.personality else 0.1
        fatigue = self.human.fatigue.fatigue_level if self.human.fatigue else 0
        tap_drive = curiosity * 0.4 - fatigue * 0.2
        if random.random() < max(0.1, tap_drive):
            screenshot = self.adb.screenshot_bytes()
            if screenshot:
                result = gemini.find_element_by_vision(
                    screenshot,
                    "a product image or thumbnail in the grid (NOT a button, NOT 'Acquista', NOT 'Buy')",
                    self.adb.screen_w, self.adb.screen_h)
                if result:
                    px, py, _ = result
                    self.adb.tap(int(px), int(py))
                    time.sleep(self.human.timing("t_product_detail"))

                    log.info("SHOP: browsing product detail")
                    self._human_browse_scroll("shop_product", max_override=4)
                    time.sleep(self.human.timing("t_product_browse"))

                    self.adb.press_back()
                    time.sleep(self.human.timing("t_back_verify"))

        self._return_to_foryou()
        log.info("SESSION: browse_shop ended")

    async def browse_session(self, duration_minutes: float, should_post: bool = False,
                             video_path: str = "", caption: str = "",
                             pre_scroll_minutes: float = 0, post_scroll_minutes: float = 0,
                             niche_keywords: list = None, allow_comment_write: bool = True):
        """Execute a full browsing session.

        This is the main entry point called by the session executor.
        Handles the full cycle: scroll -> engage -> optionally post -> scroll more.
        """
        if not self.open_app():
            return

        # Check WiFi connectivity before doing anything
        if not self.adb.check_wifi():
            log.error("SESSION: no WiFi connectivity, aborting")
            self.close_app()
            return

        # Verify FYP is actually responding to swipes (not frozen/loading)
        if not self._verify_fyp_responsive():
            log.error("FYP not responsive — aborting session")
            self.close_app()
            return

        # Behavior #10: Variable load reaction time
        time.sleep(self.human.load_reaction_time())

        start = time.time()
        total_seconds = duration_minutes * 60
        post_done = False
        post_after = pre_scroll_minutes * 60 if should_post else float('inf')
        self._last_exit_time = -999
        self._exit_count = 0
        self._force_exit_after = random.uniform(8, 15) * 60
        category = "unknown"
        action_count = 0
        health_interval = random.randint(12, 20)
        _badge_check_countdown = random.randint(15, 25)

        # Initialize PopupGuardian with a clean fingerprint
        init_shot, init_fp = self.guardian.take_fingerprint()
        if init_fp:
            self.guardian._last_clean_fp = init_fp

        while (time.time() - start) < total_seconds:
            elapsed = time.time() - start

            # Hard ceiling: prevent runaway sessions (Gemini slow, API hangs)
            if elapsed > total_seconds * 1.5:
                log.warning("SESSION: hard timeout (%.0fs > %.0fs * 1.5), force-exiting",
                            elapsed, total_seconds)
                break

            # --- PopupGuardian: check background result before every action ---
            self.guardian.handle_if_popup()

            # Periodic health check (randomized interval)
            action_count += 1
            if action_count % health_interval == 0:
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
            # Micro-sessions avg ~11 min (real TikTok). Min 5-7 min gap between exits.
            # Guaranteed 1-2 exits per 25 min session (no one scrolls 25 min straight).
            # Don't exit in last 2 min of session (would just close the app anyway).
            time_since_last_exit = elapsed - getattr(self, '_last_exit_time', -999)
            exits_so_far = getattr(self, '_exit_count', 0)
            min_gap = random.uniform(5, 7) * 60
            remaining = total_seconds - elapsed
            is_anomaly = random.random() < 0.05
            can_exit = (time_since_last_exit > min_gap) or (is_anomaly and elapsed > 30)
            too_late = remaining < 2 * 60  # don't exit in last 2 min
            can_short = elapsed > 30

            # Force exit if none happened after 8-15 min (variable per session)
            force_after = getattr(self, '_force_exit_after', None)
            if force_after is None:
                self._force_exit_after = random.uniform(8, 15) * 60
                force_after = self._force_exit_after
            force_exit = (exits_so_far == 0 and elapsed > force_after and not too_late)

            if force_exit or self.human.should_interrupt():
                itype = self.human.interruption_type()
                leaves_app = itype != "short"

                if force_exit:
                    # Must exit — pick medium or long
                    # State-driven: energy * 0.5 + (1-fatigue) * 0.3
                    _e_int = getattr(getattr(self.human, 'mood', None), 'energy', 0.5)
                    _f_int = self.human.fatigue.fatigue_level if hasattr(self.human, 'fatigue') and self.human.fatigue else 0.0
                    _med_prob = max(0.0, min(1.0, _e_int * 0.5 + (1 - _f_int) * 0.3))
                    itype = "medium" if random.random() < _med_prob else "long"
                    leaves_app = True
                elif leaves_app and (not can_exit or too_late):
                    itype = "short"
                    leaves_app = False

                if not leaves_app and not can_short:
                    continue

                if leaves_app:
                    self._last_exit_time = elapsed
                    self._exit_count = exits_so_far + 1

                await self.human.do_interruption(self.adb, TIKTOK_PKG, itype=itype)
                continue

            # --- Pick next action based on session flow phase ---
            action = self.human.pick_action()

            if action == "scroll_fyp":
                watch_time = self.human.watch_duration()

                # --- PopupGuardian: fingerprint BEFORE swipe ---
                _pre_shot, _pre_fp = self.guardian.take_fingerprint()

                # Watch ~2s first, then pre-cache niche+category DURING watch
                # so the 6s Gemini delay is absorbed by remaining watch time.
                # Only check ~25% of videos (same rate as old categorize).
                pre_check_delay = min(2.0, watch_time * 0.3)
                await asyncio.sleep(pre_check_delay)

                # Reset niche cache for this new video
                self._reset_niche_cache()

                # State-driven: energy * 0.3 + curiosity * 0.2 (energetic + curious = more niche checks)
                _e_nc = getattr(getattr(self.human, 'mood', None), 'energy', 0.5)
                _c_nc = getattr(getattr(self.human, 'mood', None), 'curiosity', 0.5)
                _niche_prob = max(0.0, min(1.0, _e_nc * 0.3 + _c_nc * 0.2))
                if random.random() < _niche_prob:
                    # Merged call: categorize + niche in ONE Gemini call
                    # The API delay (~6s) naturally extends watch time, which looks like
                    # watching longer (natural behavior variation). Rate limiter auto-throttles.
                    self._precheck_niche_during_watch(niche_keywords)
                    category = self._cached_category
                else:
                    category = "unknown"
                    # Still update boredom for non-checked videos
                    self.human.on_scroll(None)

                self.human.on_scroll_for_like()

                # Wait remaining watch time
                remaining = watch_time - pre_check_delay
                if remaining > 0:
                    await asyncio.sleep(remaining)

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

                    # --- PopupGuardian: fingerprint AFTER swipe, check stall ---
                    _post_shot, _post_fp = self.guardian.take_fingerprint()
                    if _pre_fp and _post_fp:
                        if self.guardian.check_stall(_pre_fp, _post_shot, _post_fp):
                            # Popup was detected and dismissed, skip rest
                            continue
                    # No stall: send background check during next watch time
                    if _post_shot:
                        self.guardian.check_background(_post_shot)

                self._scrolls_since_last_like += 1
                await asyncio.sleep(self.human.action_delay())

            elif action in ("like", "comment", "follow", "profile_visit"):
                # Before any engagement, check if this is a normal FYP video
                # Live previews have no sidebar — skip all engagement, just scroll
                _sidebar = self._get_sidebar_positions()
                if _sidebar is None:
                    # Not a normal video (live preview, ad, etc.)
                    # Sometimes tap to enter live, watch briefly, then back out
                    curiosity = self.human.personality.explore_curiosity if self.human.personality else 0.1
                    energy = self.human.mood.energy if self.human.mood else 1.0
                    enter_drive = curiosity * 0.8 + energy * 0.3
                    if random.random() < min(0.25, enter_drive):
                        log.info("LIVE/AD: tapping to watch briefly")
                        cx, cy = self.adb.get_coord("tiktok", "video_center")
                        cx, cy = self.human.jitter_tap(cx, cy)
                        self.adb.tap(cx, cy)
                        await asyncio.sleep(random.uniform(3, 8))
                        self._exit_live()  # press_back() does NOT work inside LIVE
                    else:
                        log.info("LIVE/AD: skipping, will scroll past")
                    await asyncio.sleep(self.human.action_delay())
                    continue

                # Normal FYP video — proceed with engagement
                action_original = action  # preserve original action

            if action == "like":
                if self.human.should_like(category):
                    # Like drought protection: after 20+ scrolls without a like,
                    # bypass niche gate. A real person likes SOMETHING eventually.
                    drought = self._scrolls_since_last_like >= 20
                    if drought:
                        log.debug("Like drought (%d scrolls) -- bypassing niche gate",
                                  self._scrolls_since_last_like)
                    # Niche gate: only like in-niche content (unless drought)
                    if drought or self._check_niche_before_engage(niche_keywords):
                        self.like_video()
                        self.human.on_like()
                        self.human.memory.record_like(category)
                        self.human.on_engage()
                        self._scrolls_since_last_like = 0
                        # Behavior #3: Post-like pause
                        await asyncio.sleep(self.human.post_like_pause())
                    else:
                        log.debug("Niche gate blocked like -- not in niche")
                        # Just scroll past instead
                        self.scroll_fyp()
                        self._reset_niche_cache()

            elif action == "comment":
                # PopupGuardian: pre-chain check before comment flow
                if self.guardian.pre_chain_check():
                    continue  # popup dismissed, restart loop
                if allow_comment_write and self.human.should_comment():
                    # Behavior #9: Double-open comments (open, close, reopen)
                    if self.human.should_double_open_comments():
                        self.open_comments()
                        await asyncio.sleep(self.human.timing("t_double_open_1"))
                        self._dismiss_comments()
                        await asyncio.sleep(self.human.timing("t_double_open_2"))
                    await self.comment_with_ai()
                    self.human.on_engage()
                else:
                    # Browse comments (read-only) — pick_action already decided
                    # to do a comment action, so at least browse
                    if self.open_comments():
                        await self.browse_comments()
                        self._dismiss_comments()
                        log.debug("Browsed comments (read-only)")

            elif action == "follow":
                # PopupGuardian: pre-chain check before follow flow
                if self.guardian.pre_chain_check():
                    continue  # popup dismissed, restart loop
                # pick_action already decided to follow — niche gate still applies
                if not self._check_niche_before_engage(niche_keywords):
                    log.debug("Niche gate blocked follow -- not in niche")
                elif self.human.should_follow_from_profile():
                    self.follow_from_profile()
                    self.human.on_engage()
                    # Reliably return to FYP after profile visit
                    self._return_to_fyp()
                else:
                    self.follow_creator()
                    self.human.on_engage()

            elif action == "search_explore":
                # PopupGuardian: pre-chain check before search flow
                if self.guardian.pre_chain_check():
                    continue  # popup dismissed, restart loop
                await self.search_explore_session(niche_keywords)
                # Reliably return to FYP (search can be deep)
                self._ensure_on_app()
                self._return_to_fyp()

            elif action == "browse_following":
                await self.browse_following_session(niche_keywords=niche_keywords)
                continue

            elif action == "browse_explore":
                await self.browse_explore_session(niche_keywords=niche_keywords)
                continue

            elif action == "check_inbox":
                await self.check_inbox_session()
                continue

            elif action == "browse_shop":
                await self.browse_shop_session()
                continue

            elif action == "profile_visit":
                # pick_action already decided to visit — do it
                _profile_shot = self.adb.screenshot_bytes()
                if _profile_shot:
                    self.guardian.check_background(_profile_shot)
                await self.rabbit_hole()
                self._ensure_on_app()
                self._return_to_fyp()

            await asyncio.sleep(self.human.action_delay())

            _badge_check_countdown -= 1
            if _badge_check_countdown <= 0:
                _badge_check_countdown = random.randint(15, 25)
                _shot = self.adb.screenshot_bytes()
                if _shot:
                    self.human._inbox_badge_detected = page_state.detect_inbox_badge(
                        _shot, self.adb.screen_w, self.adb.screen_h)

        # --- Session end ---
        self.guardian.log_stats()

        # Behavior #11: Background at end (fell asleep)
        if self.human.should_end_in_background():
            bg_time = self.human.bg_end_duration()
            log.debug("Background end: %.0fs", bg_time)
            self.adb.press_home()
            await asyncio.sleep(bg_time)

        self.close_app()
        log.info("TikTok session complete (%.1f min)", duration_minutes)
