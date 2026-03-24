diff --git a/phone-bot/core/intervention.py b/phone-bot/core/intervention.py
new file mode 100644
index 0000000..a173adb
--- /dev/null
+++ b/phone-bot/core/intervention.py
@@ -0,0 +1,116 @@
+"""
+InterventionGate: thread-safe pre-post pause mechanism.
+
+Blocks a phone-bot worker thread before posting, waiting for an external
+resolve() signal (Telegram handler, dashboard HTTP, or timeout).
+"""
+
+import threading
+import time
+import logging
+from typing import Optional, Dict, Any
+
+log = logging.getLogger(__name__)
+
+
+class InterventionGate:
+    """
+    Thread-safe gate that blocks a phone-bot worker thread before posting,
+    waiting for an external resolve() signal (Telegram, dashboard, or timeout).
+
+    Usage (worker thread):
+        gate.request_pause(phone_id=2, reason="Warmup day 7 first post")
+        decision = gate.check_and_wait(phone_id=2, timeout_s=1800)
+        if decision == "approve":
+            bot.post_video(...)
+
+    Usage (Telegram handler or dashboard):
+        gate.resolve(phone_id=2, decision="approve")
+    """
+
+    def __init__(self):
+        self._pending: Dict[int, Dict[str, Any]] = {}
+        self._lock = threading.Lock()
+
+    def request_pause(self, phone_id: int, reason: str = "") -> None:
+        """
+        Register a pause request for phone_id.
+        Replaces any existing pending entry for this phone.
+        """
+        with self._lock:
+            self._pending[phone_id] = {
+                "state": "pending",
+                "reason": reason,
+                "since": time.time(),
+                "resolution": None,
+                "_event": threading.Event(),
+            }
+        log.info("InterventionGate: pause requested for phone %d — %s", phone_id, reason)
+
+    def check_and_wait(self, phone_id: int, timeout_s: float = 1800) -> str:
+        """
+        Block until resolve() is called or timeout_s elapses.
+        Returns 'approve' | 'skip' | 'timeout'.
+        """
+        with self._lock:
+            entry = self._pending.get(phone_id)
+            if entry is None:
+                return "timeout"
+            event = entry["_event"]
+
+        # Wait WITHOUT holding the lock
+        event.wait(timeout=timeout_s)
+
+        with self._lock:
+            entry = self._pending.pop(phone_id, None)
+            if entry is None:
+                return "timeout"
+            resolution = entry.get("resolution")
+            if resolution is None:
+                # Event timed out
+                return "timeout"
+            return resolution
+
+    def resolve(self, phone_id: int, decision: str) -> None:
+        """
+        Resolve a pending pause with 'approve' or 'skip'.
+        No-op if no pending state exists.
+        """
+        with self._lock:
+            entry = self._pending.get(phone_id)
+            if entry is None:
+                return
+            entry["resolution"] = decision
+            entry["_event"].set()
+        log.info("InterventionGate: phone %d resolved — %s", phone_id, decision)
+
+    def get_pending(self, phone_id: int) -> Optional[Dict[str, Any]]:
+        """Return a copy of the pending dict (without _event), or None."""
+        with self._lock:
+            entry = self._pending.get(phone_id)
+            if entry is None:
+                return None
+            return {k: v for k, v in entry.items() if k != "_event"}
+
+    def get_all_pending(self) -> Dict[int, Dict[str, Any]]:
+        """Return a copy of all pending entries (without _event keys)."""
+        with self._lock:
+            return {
+                pid: {k: v for k, v in entry.items() if k != "_event"}
+                for pid, entry in self._pending.items()
+            }
+
+
+# --- Module-level singleton ---
+_gate: Optional[InterventionGate] = None
+_gate_lock = threading.Lock()
+
+
+def get_gate() -> InterventionGate:
+    """Return the module-level singleton InterventionGate (thread-safe)."""
+    global _gate
+    if _gate is None:
+        with _gate_lock:
+            if _gate is None:
+                _gate = InterventionGate()
+    return _gate
diff --git a/phone-bot/tests/test_intervention_gate.py b/phone-bot/tests/test_intervention_gate.py
new file mode 100644
index 0000000..83308e9
--- /dev/null
+++ b/phone-bot/tests/test_intervention_gate.py
@@ -0,0 +1,180 @@
+"""
+Tests for InterventionGate: thread-safe pre-post pause mechanism.
+
+Each test creates a fresh gate instance (not the singleton) to avoid state leakage.
+"""
+
+import threading
+import time
+import pytest
+
+from phone_bot.core.intervention import InterventionGate
+
+
+def test_request_pause_stores_pending_state():
+    """request_pause() must store state='pending', reason, and a since timestamp."""
+    gate = InterventionGate()
+    gate.request_pause(phone_id=1, reason="warmup first post")
+    pending = gate.get_pending(1)
+    assert pending is not None
+    assert pending["state"] == "pending"
+    assert pending["reason"] == "warmup first post"
+    assert "since" in pending
+    assert isinstance(pending["since"], float)
+
+
+def test_check_and_wait_unblocked_by_approve():
+    """
+    check_and_wait() must block until resolve() is called from another thread.
+    When resolved with 'approve', returns 'approve'.
+    """
+    gate = InterventionGate()
+    gate.request_pause(phone_id=2, reason="test")
+    result = [None]
+
+    def resolver():
+        time.sleep(0.2)
+        gate.resolve(phone_id=2, decision="approve")
+
+    t = threading.Thread(target=resolver)
+    t.start()
+    result[0] = gate.check_and_wait(phone_id=2, timeout_s=5)
+    t.join()
+    assert result[0] == "approve"
+
+
+def test_check_and_wait_unblocked_by_skip():
+    """Same as above, but resolve() called with 'skip' — returns 'skip'."""
+    gate = InterventionGate()
+    gate.request_pause(phone_id=3, reason="test")
+
+    def resolver():
+        time.sleep(0.2)
+        gate.resolve(phone_id=3, decision="skip")
+
+    t = threading.Thread(target=resolver)
+    t.start()
+    result = gate.check_and_wait(phone_id=3, timeout_s=5)
+    t.join()
+    assert result == "skip"
+
+
+def test_check_and_wait_returns_timeout():
+    """
+    check_and_wait(timeout_s=0.1) returns 'timeout' when no resolve() is called.
+    Verify the return value and that it does NOT block longer than ~0.5s.
+    """
+    gate = InterventionGate()
+    gate.request_pause(phone_id=4, reason="test")
+    start = time.monotonic()
+    result = gate.check_and_wait(phone_id=4, timeout_s=0.1)
+    elapsed = time.monotonic() - start
+    assert result == "timeout"
+    assert elapsed < 0.5
+
+
+def test_resolve_unknown_phone_id_is_noop():
+    """resolve() on a phone_id with no pending state must not raise."""
+    gate = InterventionGate()
+    gate.resolve(phone_id=99, decision="approve")  # should not raise
+
+
+def test_get_pending_returns_none_when_absent():
+    """get_pending(phone_id) returns None when no pause requested."""
+    gate = InterventionGate()
+    assert gate.get_pending(1) is None
+
+
+def test_get_pending_returns_dict_when_pending():
+    """get_pending(phone_id) returns the pending dict after request_pause()."""
+    gate = InterventionGate()
+    gate.request_pause(phone_id=5, reason="check")
+    pending = gate.get_pending(5)
+    assert pending is not None
+    assert pending["state"] == "pending"
+    assert pending["reason"] == "check"
+    # _event must NOT be exposed
+    assert "_event" not in pending
+
+
+def test_thread_safe_resolve_unblocks_waiting_thread():
+    """
+    Concurrent scenario: main thread calls check_and_wait() while a second thread
+    calls resolve() after 0.2s. Main thread must unblock with the correct resolution.
+    """
+    gate = InterventionGate()
+    gate.request_pause(phone_id=6, reason="concurrent test")
+    result = [None]
+    unblocked = threading.Event()
+
+    def waiter():
+        result[0] = gate.check_and_wait(phone_id=6, timeout_s=5)
+        unblocked.set()
+
+    def resolver():
+        time.sleep(0.2)
+        gate.resolve(phone_id=6, decision="approve")
+
+    t_wait = threading.Thread(target=waiter)
+    t_resolve = threading.Thread(target=resolver)
+    t_wait.start()
+    t_resolve.start()
+    assert unblocked.wait(timeout=2), "Waiter thread was not unblocked in time"
+    t_wait.join()
+    t_resolve.join()
+    assert result[0] == "approve"
+
+
+def test_second_request_pause_replaces_first():
+    """
+    Calling request_pause() twice for the same phone_id replaces the first pending
+    state. Only one pending entry per phone at a time.
+    """
+    gate = InterventionGate()
+    gate.request_pause(phone_id=7, reason="first")
+    gate.request_pause(phone_id=7, reason="second")
+    pending = gate.get_pending(7)
+    assert pending["reason"] == "second"
+
+
+def test_short_timeout_does_not_block():
+    """
+    Integration: request_pause() then check_and_wait(timeout_s=0.05).
+    Must return 'timeout' within 0.5s wall time.
+    """
+    gate = InterventionGate()
+    gate.request_pause(phone_id=8, reason="quick")
+    start = time.monotonic()
+    result = gate.check_and_wait(phone_id=8, timeout_s=0.05)
+    elapsed = time.monotonic() - start
+    assert result == "timeout"
+    assert elapsed < 0.5
+
+
+def test_get_all_pending():
+    """get_all_pending() returns all pending entries without _event keys."""
+    gate = InterventionGate()
+    gate.request_pause(phone_id=1, reason="one")
+    gate.request_pause(phone_id=2, reason="two")
+    all_pending = gate.get_all_pending()
+    assert len(all_pending) == 2
+    assert 1 in all_pending
+    assert 2 in all_pending
+    for entry in all_pending.values():
+        assert "_event" not in entry
+
+
+def test_pending_cleaned_up_after_wait():
+    """After check_and_wait() returns, get_pending() returns None (cleanup)."""
+    gate = InterventionGate()
+    gate.request_pause(phone_id=9, reason="cleanup test")
+
+    def resolver():
+        time.sleep(0.1)
+        gate.resolve(phone_id=9, decision="approve")
+
+    t = threading.Thread(target=resolver)
+    t.start()
+    gate.check_and_wait(phone_id=9, timeout_s=5)
+    t.join()
+    assert gate.get_pending(9) is None
diff --git a/phone-bot/actions/tiktok.py b/phone-bot/actions/tiktok.py
index 16271eb..d4564e5 100644
--- a/phone-bot/actions/tiktok.py
+++ b/phone-bot/actions/tiktok.py
@@ -239,92 +239,168 @@ class PopupGuardian:
         return False
 
     def _dismiss(self, result):
-        """Dismiss a popup with 4-level escalation. Fastest path first.
+        """Dismiss a popup using the right tool for each dismiss method.
 
-        Level 1: press_back (free, ~0.7s total, works 95% of cases)
-        Level 2: Gemini coords from original detection (~2.5s, for stubborn popups)
-        Level 3: find_element_by_vision focused search (~2s, precise button finding)
-        Level 4: Hardcoded fallback zones (~0.6s, last resort)
+        Gemini classifies the popup and returns dismiss_method + dismiss_text.
+        This function uses the appropriate tool for each method:
+        - tap_button: OCR finds exact text coords → tap (fallback: Gemini bbox)
+        - tap_x: Gemini bbox with focused prompt → tap
+        - press_back: BACK + same-page verification
+        - tap_outside: tap on backdrop area
 
-        Verification between levels uses fingerprint comparison (free, ~0.05s)
-        instead of Gemini API calls. Only escalates to Gemini verify if fingerprint
-        is ambiguous.
+        Escalation: primary method → fallback methods → log error.
         """
-        # Simulate reading the popup (human behavior)
-        time.sleep(self.human.timing("t_popup_read"))
+        from ..core import ocr as ocr_mod
 
-        # Snapshot fingerprint BEFORE dismiss attempt (with popup on screen)
-        _, fp_with_popup = self.take_fingerprint()
+        time.sleep(self.human.timing("t_popup_read"))
 
-        # ── Level 1: press_back ──────────────────────────────────────────
-        log.info("PopupGuardian: L1 press_back")
-        self.adb.press_back()
-        time.sleep(self.human.timing("t_popup_dismiss"))
+        # Single screenshot for fingerprint + page detection
+        pre_shot = self.adb.screenshot_bytes()
+        fp_with_popup = page_state.screen_fingerprint(pre_shot) if pre_shot else None
+        pre_page = page_state.detect_page(
+            pre_shot, self.adb.screen_w, self.adb.screen_h
+        ).get("page", "unknown") if pre_shot else "unknown"
 
-        if self._verify_dismissed(fp_with_popup, "L1"):
-            return True
+        method = result.get("dismiss_method", "press_back")
+        dismiss_text = result.get("dismiss_text")
+        sw, sh = self.adb.screen_w, self.adb.screen_h
 
-        # ── Level 2: Gemini coords from original detection ───────────────
-        dx = result.get("dismiss_x")
-        dy = result.get("dismiss_y")
-        if dx is not None and dy is not None:
-            self.stats["dismiss_retries"] += 1
-            log.info("PopupGuardian: L2 tap Gemini coords (%d, %d) [%s]",
-                     dx, dy, result.get("dismiss_label", "?"))
-            time.sleep(self.human.timing("t_popup_read") * 0.3)
-            tx, ty = self.human.jitter_tap(dx, dy)
-            self.adb.tap(tx, ty)
-            time.sleep(self.human.timing("t_popup_dismiss"))
+        # Build ordered list of strategies based on primary method
+        strategies = []
+        if method == "tap_button" and dismiss_text:
+            strategies.append(("ocr_text", dismiss_text))
+            strategies.append(("gemini_bbox_button", dismiss_text))
+            strategies.append(("press_back_safe", None))
+        elif method == "tap_x":
+            strategies.append(("gemini_bbox_x", None))
+            strategies.append(("press_back_safe", None))
+            strategies.append(("tap_outside", None))
+        elif method == "press_back":
+            strategies.append(("press_back_safe", None))
+            strategies.append(("gemini_find_button", None))
+            strategies.append(("tap_outside", None))
+        elif method == "tap_outside":
+            strategies.append(("tap_outside", None))
+            strategies.append(("press_back_safe", None))
+            strategies.append(("gemini_find_button", None))
+        else:
+            strategies.append(("press_back_safe", None))
+            strategies.append(("gemini_find_button", None))
 
-            if self._verify_dismissed(fp_with_popup, "L2"):
-                return True
+        for strategy, param in strategies:
+            log.info("PopupGuardian: trying strategy '%s' (param=%s)", strategy, param)
 
-        # ── Level 3: find_element_by_vision (focused button search) ──────
-        self.stats["dismiss_retries"] += 1
-        log.info("PopupGuardian: L3 find_element_by_vision for dismiss button")
-        screenshot = self.adb.screenshot_bytes()
-        if screenshot:
-            coords = gemini.find_element_by_vision(
-                screenshot,
-                "the X, Close, Not now, Don't allow, Cancel, or dismiss button on the popup",
-                self.adb.screen_w, self.adb.screen_h)
-            self.stats["gemini_calls"] += 1
+            if strategy == "ocr_text":
+                # OCR finds exact text coordinates (~300ms)
+                shot = self.adb.screenshot_bytes()
+                if shot:
+                    import cv2, numpy as np
+                    arr = np.frombuffer(shot, np.uint8)
+                    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
+                    coords = ocr_mod.find_text_coord(bgr, param, (0.0, 0.0, 1.0, 1.0))
+                    if coords:
+                        tx, ty = self.human.jitter_tap(coords[0], coords[1])
+                        log.info("PopupGuardian: OCR found '%s' at (%d,%d)", param, tx, ty)
+                        self.adb.tap(tx, ty)
+                        time.sleep(self.human.timing("t_popup_dismiss"))
+                        if self._verify_dismissed(fp_with_popup, f"ocr_{param}"):
+                            return True
+                    else:
+                        log.info("PopupGuardian: OCR could not find '%s'", param)
 
-            if coords:
-                tx, ty = self.human.jitter_tap(coords[0], coords[1])
-                log.info("PopupGuardian: L3 tapping found button at (%d, %d)", tx, ty)
-                self.adb.tap(tx, ty)
-                time.sleep(self.human.timing("t_popup_dismiss"))
+            elif strategy == "gemini_bbox_button":
+                # Gemini bbox for a specific button text — hyper-focused prompt
+                shot = self.adb.screenshot_bytes()
+                if shot:
+                    popup_desc = result.get("popup_text", "popup")
+                    bbox = gemini.find_element_by_vision(
+                        shot,
+                        f"the button or text that says exactly '{param}' "
+                        f"on the '{popup_desc}' dialog/popup. "
+                        f"Find ONLY the '{param}' button, nothing else.",
+                        sw, sh)
+                    self.stats["gemini_calls"] += 1
+                    if bbox:
+                        tx, ty = self.human.jitter_tap(bbox[0], bbox[1])
+                        log.info("PopupGuardian: bbox found '%s' at (%d,%d)", param, tx, ty)
+                        self.adb.tap(tx, ty)
+                        time.sleep(self.human.timing("t_popup_dismiss"))
+                        if self._verify_dismissed(fp_with_popup, f"bbox_{param}"):
+                            return True
 
-                if self._verify_dismissed(fp_with_popup, "L3"):
-                    return True
+            elif strategy == "gemini_bbox_x":
+                # Gemini bbox for X close button — hyper-focused with popup context
+                shot = self.adb.screenshot_bytes()
+                if shot:
+                    popup_desc = result.get("popup_text", "popup")
+                    bbox = gemini.find_element_by_vision(
+                        shot,
+                        f"the small X close/dismiss icon on the '{popup_desc}' "
+                        f"banner or popup. This is a tiny X or x symbol, "
+                        f"NOT a search icon, NOT a magnifying glass, NOT a navigation icon. "
+                        f"It is the dismiss/close control for the '{popup_desc}' element only.",
+                        sw, sh)
+                    self.stats["gemini_calls"] += 1
+                    if bbox:
+                        tx, ty = self.human.jitter_tap(bbox[0], bbox[1])
+                        log.info("PopupGuardian: bbox X at (%d,%d) for '%s'",
+                                 tx, ty, popup_desc)
+                        self.adb.tap(tx, ty)
+                        time.sleep(self.human.timing("t_popup_dismiss"))
+                        if self._verify_dismissed(fp_with_popup, "bbox_x"):
+                            return True
 
-        # ── Level 4: Hardcoded fallback zones ────────────────────────────
-        self.stats["dismiss_retries"] += 1
-        sw, sh = self.adb.screen_w, self.adb.screen_h
-        fallback_zones = [
-            # Top-right X button (common on bottom sheets, dialogs)
-            (int(sw * 0.92), int(sh * 0.38), "top-right X"),
-            # Bottom-center button (OK, Accept, Not now)
-            (int(sw * 0.50), int(sh * 0.58), "bottom-center button"),
-            # press_back one more time
-            (None, None, "press_back"),
-        ]
+            elif strategy == "gemini_find_button":
+                # Fresh Gemini search for ANY dismiss button
+                shot = self.adb.screenshot_bytes()
+                if shot:
+                    coords = gemini.find_element_by_vision(
+                        shot,
+                        "the X, Close, Not now, Don't allow, Cancel, Skip, "
+                        "or dismiss button on the popup/banner/overlay",
+                        sw, sh)
+                    self.stats["gemini_calls"] += 1
+                    if coords:
+                        tx, ty = self.human.jitter_tap(coords[0], coords[1])
+                        log.info("PopupGuardian: Gemini find_button at (%d,%d)", tx, ty)
+                        self.adb.tap(tx, ty)
+                        time.sleep(self.human.timing("t_popup_dismiss"))
+                        if self._verify_dismissed(fp_with_popup, "find_button"):
+                            return True
 
-        for fx, fy, desc in fallback_zones:
-            log.info("PopupGuardian: L4 fallback: %s", desc)
-            if fx is not None:
-                tx, ty = self.human.jitter_tap(fx, fy)
-                self.adb.tap(tx, ty)
-            else:
+            elif strategy == "press_back_safe":
+                # BACK with same-page verification
                 self.adb.press_back()
-            time.sleep(self.human.timing("t_popup_dismiss") * 0.7)
+                time.sleep(self.human.timing("t_popup_dismiss"))
+                post_shot = self.adb.screenshot_bytes()
+                post_page = page_state.detect_page(
+                    post_shot, sw, sh
+                ).get("page", "unknown") if post_shot else "unknown"
+
+                if pre_page != "unknown" and post_page != "unknown" and pre_page != post_page:
+                    log.warning("PopupGuardian: BACK navigated away (%s -> %s), "
+                                "popup still on %s — aborting dismiss (caller will retry)",
+                                pre_page, post_page, pre_page)
+                    return False
+                if self._verify_dismissed(fp_with_popup, "back_safe"):
+                    return True
 
-            if self._verify_dismissed(fp_with_popup, "L4"):
-                return True
+            elif strategy == "tap_outside":
+                # Tap backdrop areas (above and below modal)
+                for fx, fy, desc in [
+                    (int(sw * 0.50), int(sh * 0.10), "above"),
+                    (int(sw * 0.50), int(sh * 0.90), "below"),
+                ]:
+                    tx, ty = self.human.jitter_tap(fx, fy)
+                    log.info("PopupGuardian: tap outside %s (%d,%d)", desc, tx, ty)
+                    self.adb.tap(tx, ty)
+                    time.sleep(self.human.timing("t_popup_dismiss") * 0.7)
+                    if self._verify_dismissed(fp_with_popup, f"outside_{desc}"):
+                        return True
+
+            self.stats["dismiss_retries"] += 1
 
-        # If we're here, nothing worked.
-        log.error("PopupGuardian: ALL dismiss levels failed. Popup may still be on screen.")
+        log.error("PopupGuardian: ALL strategies failed. Popup may still be on screen.")
         _, fp = self.take_fingerprint()
         if fp:
             self._last_clean_fp = fp
@@ -878,6 +954,8 @@ class TikTokBot:
         # Dynamic tab cache (scanned once per session)
         self._cached_bottom_tabs = None  # list of detected bottom tab names
         self._cached_top_tabs = None     # list of detected top tab names
+        # Pre-post intervention callback (set by Flask worker for Telegram notification)
+        self._pre_post_callback = None  # callable(reason) -> None
         # Set screen-specific params for page_state (dynamic _NAV_Y based on density)
         from ..core import page_state
         page_state.set_screen_params(adb.screen_h, adb._density)
@@ -913,6 +991,31 @@ class TikTokBot:
         )
         monitor_log(event)
 
+    # --- Pre-post intervention gate -------------------------------------------
+
+    def _check_pre_post_pause(self, reason: str = "") -> str:
+        """
+        If an intervention gate is available, signal it and block until resolved.
+        Returns 'approve' | 'skip' | 'timeout'.
+        If gate is not available, returns 'approve' (normal operation unaffected).
+        """
+        try:
+            from ..core.intervention import get_gate
+        except ImportError:
+            return "approve"
+        gate = get_gate()
+        phone_id = self.adb.phone.get("id", 0)
+        gate.request_pause(phone_id=phone_id, reason=reason)
+        # Fire notification callback (e.g. Telegram approval request)
+        if self._pre_post_callback:
+            try:
+                self._pre_post_callback(reason)
+            except Exception as e:
+                log.warning("Pre-post callback error: %s", e)
+        decision = gate.check_and_wait(phone_id=phone_id, timeout_s=1800)
+        log.info("Pre-post pause decision for phone %d: %s", phone_id, decision)
+        return decision
+
     # --- Sidebar pixel scan (zero AI, <50ms) --------------------------------
 
     def _get_sidebar_positions(self) -> dict | None:
@@ -2133,7 +2236,7 @@ class TikTokBot:
     def _browse_messages_glance(self):
         """Brief DM/Messages glance — open, look, close. NEVER interact with conversations."""
         log.info("[DM] opening messages for brief glance")
-        if self._inbox_enter_subpage("Messages", "Messages"):
+        if self._inbox_enter_subpage("Messages"):
             time.sleep(self.human.timing("t_message_glance"))
             # Maybe scroll once (40% chance)
             if random.random() < 0.4:
@@ -5291,12 +5394,17 @@ JSON only, no markdown."""
             # --- Post video at the right time ---
             if should_post and not post_done and elapsed >= post_after:
                 if video_path:
-                    result = self.post_video(video_path, caption)
-                    post_done = True
-                    self._last_post_result = result
-                    if result == "success":
-                        self.go_to_fyp()
-                        time.sleep(self.human.timing("t_nav_settle"))
+                    decision = self._check_pre_post_pause(reason="browse_session post")
+                    if decision == "approve":
+                        result = self.post_video(video_path, caption)
+                        post_done = True
+                        self._last_post_result = result
+                        if result == "success":
+                            self.go_to_fyp()
+                            time.sleep(self.human.timing("t_nav_settle"))
+                    else:
+                        log.info("Pre-post pause: decision=%s — skipping post", decision)
+                        post_done = True
                     continue
 
             # Behavior #1: Zona morta (dead stare, no touch)
diff --git a/phone-bot/planner/executor.py b/phone-bot/planner/executor.py
index 5f48798..d8e5aed 100644
--- a/phone-bot/planner/executor.py
+++ b/phone-bot/planner/executor.py
@@ -811,6 +811,23 @@ class SessionExecutor:
         pkg = TIKTOK_PKG if platform == "tiktok" else INSTAGRAM_PKG
         post_fn = bot.post_video if platform == "tiktok" else bot.post_reel
 
+        # Pre-post intervention gate check
+        try:
+            from ..core.intervention import get_gate
+            gate = get_gate()
+            gate.request_pause(phone_id=phone_id, reason="executor post")
+            if bot._pre_post_callback:
+                try:
+                    bot._pre_post_callback("executor post")
+                except Exception as e:
+                    log.warning("Pre-post callback error: %s", e)
+            decision = gate.check_and_wait(phone_id=phone_id, timeout_s=1800)
+            if decision != "approve":
+                log.info("Pre-post pause: decision=%s — skipping post for phone %d", decision, phone_id)
+                return "skipped"
+        except ImportError:
+            pass  # gate not available, proceed normally
+
         for attempt in range(2):
             result = post_fn(video_path, caption)
             log.info("Post attempt %d/%d: %s (platform=%s, phone=%d)",
