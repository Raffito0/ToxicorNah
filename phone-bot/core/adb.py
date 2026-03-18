"""Raw ADB controller -- zero detectable footprint.

Every interaction goes through `adb shell input` (taps, swipes, text).
App launch via `am start` (NOT monkey -- monkey is detectable).
App close via natural gestures (NOT am force-stop -- detectable).
Screenshots via `adb exec-out screencap -p` for Gemini Vision when needed.

NO uiautomator, NO APKs, NO accessibility services.
"""
import logging
import math
import random
import re
import subprocess
import time


class DeviceLostError(Exception):
    """Raised when ADB device disconnects mid-session."""
    pass


class DeviceConfigError(Exception):
    """Raised when device screen parameters cannot be determined."""
    pass


def _parse_wm_size(output: str) -> tuple[int, int] | None:
    """Parse `wm size` output. Returns (width, height) preferring Override, or None."""
    matches = {}
    for m in re.finditer(r'(\w+)\s+size:\s*(\d+)x(\d+)', output):
        matches[m.group(1)] = (int(m.group(2)), int(m.group(3)))
    if "Override" in matches:
        return matches["Override"]
    if "Physical" in matches:
        return matches["Physical"]
    return None


def _parse_wm_density(output: str) -> int | None:
    """Parse `wm density` output. Returns int preferring Override, or None."""
    matches = {}
    for m in re.finditer(r'(\w+)\s+density:\s*(\d+)', output):
        matches[m.group(1)] = int(m.group(2))
    if "Override" in matches:
        return matches["Override"]
    if "Physical" in matches:
        return matches["Physical"]
    return None


def _hw_delay(median: float, sigma: float = 0.3, lo: float = 0.1, hi: float = 5.0) -> float:
    """Hardware-level log-normal delay (no HumanEngine dependency)."""
    val = random.lognormvariate(math.log(max(median, 0.01)), sigma)
    return max(lo, min(hi, val))
from io import BytesIO
from typing import Optional

from PIL import Image

from .. import config
from .coords import get_coords

log = logging.getLogger(__name__)


class ADBController:
    """Controls a single Android device via raw ADB commands.

    Detection-safe: uses ONLY input events, am start, and screencap.
    No uiautomator, no monkey, no force-stop.
    """

    def __init__(self, serial: str, phone_config: dict):
        self.serial = serial
        self.phone = phone_config

        # --- Screen size detection (ADB > config > abort) ---
        config_w = phone_config.get("screen_w")
        config_h = phone_config.get("screen_h")

        detected_size = None
        try:
            size_output = self._run(["shell", "wm", "size"], timeout=5)
            parsed = _parse_wm_size(size_output)
            if parsed:
                w, h = parsed
                if 200 <= w <= 4000 and 200 <= h <= 8000:
                    detected_size = (w, h)
        except Exception:
            pass

        if detected_size:
            self.screen_w, self.screen_h = detected_size
            if config_w is not None and config_h is not None:
                if detected_size != (config_w, config_h):
                    log.info("ADB: screen %dx%d (auto-detected, config had %dx%d -- override)",
                             self.screen_w, self.screen_h, config_w, config_h)
                else:
                    log.info("ADB: screen %dx%d (auto-detected, config match)",
                             self.screen_w, self.screen_h)
            else:
                log.info("ADB: screen %dx%d (auto-detected, config had None)",
                         self.screen_w, self.screen_h)
        elif config_w is not None and config_h is not None:
            self.screen_w, self.screen_h = config_w, config_h
            log.info("ADB: wm size failed, using config values %dx%d", config_w, config_h)
        else:
            raise DeviceConfigError(
                f"Cannot determine screen size for {serial}: "
                f"ADB wm size failed and config has no screen dimensions"
            )

        # --- Density detection (ADB > config > default 280) ---
        config_density = phone_config.get("density")
        detected_density = None
        try:
            density_output = self._run(["shell", "wm", "density"], timeout=5)
            parsed_d = _parse_wm_density(density_output)
            if parsed_d and 100 <= parsed_d <= 800:
                detected_density = parsed_d
        except Exception:
            pass

        if detected_density:
            self._density = detected_density
            log.info("ADB: density %d (auto-detected)", detected_density)
        elif config_density is not None:
            self._density = config_density
        else:
            self._density = 280  # safe default

    # --- Low-level ADB execution -------------------------------------------

    # Flag set when device disconnects — stops ALL further commands
    _device_lost = False

    def _run(self, args: list[str], timeout: int = 15) -> str:
        """Execute an ADB command and return stdout."""
        if self._device_lost:
            return ""
        cmd = [config.ADB_PATH, "-s", self.serial] + args
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0 and result.stderr.strip():
                stderr = result.stderr.strip()
                if "not found" in stderr or "offline" in stderr:
                    log.error("DEVICE LOST: %s — stopping all commands", stderr)
                    self._device_lost = True
                    raise DeviceLostError(f"Device {self.serial} disconnected: {stderr}")
                log.warning("ADB stderr: %s", stderr)
            return result.stdout
        except subprocess.TimeoutExpired:
            log.error("ADB command timed out: %s", " ".join(cmd))
            return ""

    def _run_bytes(self, args: list[str], timeout: int = 15) -> bytes:
        """Execute an ADB command and return raw bytes (for screenshots)."""
        if self._device_lost:
            return b""
        cmd = [config.ADB_PATH, "-s", self.serial] + args
        try:
            result = subprocess.run(
                cmd, capture_output=True, timeout=timeout
            )
            if result.stderr:
                stderr = result.stderr.decode("utf-8", errors="replace").strip()
                if "not found" in stderr or "offline" in stderr:
                    log.error("DEVICE LOST: %s — stopping all commands", stderr)
                    self._device_lost = True
                    raise DeviceLostError(f"Device {self.serial} disconnected: {stderr}")
            return result.stdout
        except subprocess.TimeoutExpired:
            log.error("ADB command timed out: %s", " ".join(cmd))
            return b""

    def shell(self, command: str, timeout: int = 15) -> str:
        """Run a shell command on the device."""
        return self._run(["shell", command], timeout=timeout)

    # --- Device info -------------------------------------------------------

    def is_connected(self) -> bool:
        """Check if this device is connected and responsive."""
        output = self._run(["get-state"], timeout=5)
        return "device" in output

    def get_current_app(self) -> str:
        """Return the package name of the currently focused app.
        Uses dumpsys window (lighter than dumpsys activity)."""
        output = self.shell("dumpsys window | grep mCurrentFocus")
        match = re.search(r"u0\s+([^\s/}]+)", output)
        return match.group(1) if match else ""

    def is_screen_on(self) -> bool:
        """Check if screen is on via sysfs backlight (zero process footprint)."""
        for path in [
            "/sys/class/leds/lcd-backlight/brightness",
            "/sys/class/backlight/panel0/brightness",
            "/sys/class/backlight/panel0-backlight/brightness",
        ]:
            output = self.shell(f"cat {path}").strip()
            if output.isdigit():
                return int(output) > 0
        # Fallback for devices with non-standard paths
        output = self.shell("cat /sys/power/wake_lock").strip()
        return bool(output)

    def wake_screen(self):
        if not self.is_screen_on():
            self.shell("input keyevent KEYCODE_WAKEUP")
            time.sleep(_hw_delay(0.5, 0.3, 0.2, 1.5))

    def unlock_screen(self):
        """Swipe up to unlock (no PIN assumed). Drift added for human realism."""
        self.wake_screen()
        cy = self.screen_h * 3 // 4
        cx = self.screen_w // 2 + random.randint(-15, 15)
        drift = random.randint(-20, 20)
        dur = random.randint(250, 400)
        self.shell(f"input swipe {cx} {cy} {cx + drift} {self.screen_h // 4 + random.randint(-20, 20)} {dur}")
        time.sleep(_hw_delay(0.5, 0.3, 0.2, 1.5))

    # --- Input actions (tap, swipe, type) ----------------------------------

    def tap(self, x: int, y: int):
        """Tap at exact coordinates (human jitter added by HumanEngine)."""
        x = max(0, min(x, self.screen_w))
        y = max(0, min(y, self.screen_h))
        import traceback
        caller = traceback.extract_stack(limit=3)[0]
        log.info("TAP (%d, %d) [from %s:%d %s]", x, y,
                 caller.filename.split("/")[-1].split("\\")[-1], caller.lineno, caller.name)
        self.shell(f"input tap {x} {y}")

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300):
        """Single swipe with slight lateral drift for realism.
        One command = one gesture = no double-skip on any screen size."""
        drift = random.randint(-10, 10)
        log.info("SWIPE (%d,%d)->(%d,%d) %dms drift=%d", x1, y1, x2 + drift, y2, duration_ms, drift)
        self.shell(f"input swipe {x1} {y1} {x2 + drift} {y2} {duration_ms}")

    def long_press(self, x: int, y: int, duration_ms: int = 800):
        """Long press at coordinates."""
        log.info("LONG_PRESS (%d, %d) %dms", x, y, duration_ms)
        self.shell(f"input swipe {x} {y} {x} {y} {duration_ms}")

    def type_text(self, text: str):
        """Type text in small batches (2-4 chars) to reduce per-char process pattern.
        Special chars (space, newline) sent as keyevents."""
        safe = text.encode("ascii", "replace").decode("ascii")
        log.info("TYPE_TEXT: '%s' (%d chars)", safe[:40], len(text))
        i = 0
        while i < len(text):
            c = text[i]
            if c == " ":
                self.shell("input keyevent KEYCODE_SPACE")
                i += 1
            elif c == "\n":
                self.shell("input keyevent KEYCODE_ENTER")
                i += 1
            else:
                # Batch 2-4 consecutive non-special chars
                end = min(i + random.randint(2, 4), len(text))
                batch = []
                for j in range(i, end):
                    if text[j] in (" ", "\n"):
                        break
                    batch.append(text[j])
                if batch:
                    chunk = "".join(batch)
                    escaped = chunk.replace("'", "'\\''")
                    self.shell(f"input text '{escaped}'")
                    i += len(batch)
                else:
                    i += 1

    def press_back(self):
        """Navigate back via edge swipe gesture (Android 10+ gesture nav).
        75% from left edge, 25% from right edge for realism."""
        from_left = random.random() < 0.75
        if from_left:
            start_x = random.randint(0, 8)
            end_x = int(self.screen_w * random.uniform(0.25, 0.40))
        else:
            start_x = self.screen_w - random.randint(0, 8)
            end_x = int(self.screen_w * random.uniform(0.60, 0.75))
        # Y near center with random offset, slight vertical drift
        center_y = self.screen_h // 2
        start_y = center_y + random.randint(-80, 80)
        y_drift = random.randint(-25, 25)
        end_y = start_y + y_drift
        duration = random.randint(120, 250)
        side = "left" if from_left else "right"
        log.info("BACK gesture (%s edge): (%d,%d)->(%d,%d) %dms",
                 side, start_x, start_y, end_x, end_y, duration)
        self.shell(f"input swipe {start_x} {start_y} {end_x} {end_y} {duration}")

    def _keyevent_back(self):
        """Fallback: BACK via keyevent (use only when gesture fails)."""
        log.info("BACK keyevent (fallback)")
        self.shell("input keyevent KEYCODE_BACK")

    def press_home(self):
        """Navigate home via swipe up from bottom edge (Android 10+ gesture nav)."""
        start_x = self.screen_w // 2 + random.randint(-30, 30)
        x_drift = random.randint(-15, 15)
        end_x = start_x + x_drift
        start_y = self.screen_h - random.randint(5, 15)
        end_y = int(self.screen_h * random.uniform(0.25, 0.35))
        duration = random.randint(200, 350)
        log.info("HOME gesture: (%d,%d)->(%d,%d) %dms",
                 start_x, start_y, end_x, end_y, duration)
        self.shell(f"input swipe {start_x} {start_y} {end_x} {end_y} {duration}")

    def _keyevent_home(self):
        """Fallback: HOME via keyevent (use only when gesture fails)."""
        log.info("HOME keyevent (fallback)")
        self.shell("input keyevent KEYCODE_HOME")

    def press_enter(self):
        log.info("ENTER pressed")
        self.shell("input keyevent KEYCODE_ENTER")

    # --- App management (detection-safe) -----------------------------------

    def ensure_background_restricted(self, packages: list[str] = None):
        """Ensure background activity is restricted for specified packages.
        Set once per phone, persists across sessions. Identical to user setting
        Settings -> Apps -> [App] -> Battery -> Restricted.

        This prevents background network requests when apps are closed,
        critical for multi-phone proxy setups where IP rotation could leak."""
        if packages is None:
            packages = ["com.zhiliaoapp.musically", "com.instagram.android"]

        for pkg in packages:
            for op in ["RUN_IN_BACKGROUND", "RUN_ANY_IN_BACKGROUND"]:
                # Check current state
                result = self.shell(f"cmd appops get {pkg} {op}").strip()
                if "ignore" in result.lower():
                    log.debug("BG_RESTRICT: %s %s already restricted", pkg, op)
                    continue
                # Apply restriction
                self.shell(f"cmd appops set {pkg} {op} ignore")
                log.info("BG_RESTRICT: set %s %s to ignore", pkg, op)

    def open_app(self, package: str):
        """Launch an app using am start (NOT monkey -- monkey is detectable)."""
        log.info("OPEN_APP: %s", package)
        activity = config.APP_ACTIVITIES.get(package)
        if activity:
            self.shell(f"am start -n {package}/{activity}")
        else:
            raise ValueError(
                f"Unknown package {package}. "
                f"Add it to config.APP_ACTIVITIES to avoid detectable cmd package calls."
            )

    def close_app(self, package: str):
        """Close an app naturally by going home.
        Background restriction (set at startup) prevents any background activity."""
        log.info("CLOSE_APP: %s", package)
        self.close_app_natural()

    def close_app_natural(self):
        """Close app completely: HOME → open recents → swipe card away.
        KEYCODE_APP_SWITCH is safe because TikTok is already in background
        and system keys are intercepted by SystemUI before reaching any app."""
        log.info("CLOSE_APP: HOME -> recents -> swipe card")
        # Step 1: Gesture HOME (app goes to background)
        self.press_home()
        time.sleep(_hw_delay(0.8, 0.2, 0.5, 1.5))
        # Step 2: Open recents (system key, app can't see it)
        self.shell("input keyevent 187")
        time.sleep(_hw_delay(0.8, 0.2, 0.5, 1.5))
        # Step 3: Swipe card UP to kill app (proportional Y for all screen sizes)
        cx = self.screen_w // 2 + random.randint(-15, 15)
        start_y = int(self.screen_h * 0.44)
        end_y = int(self.screen_h * random.uniform(0.05, 0.09))
        self.shell(f"input swipe {cx} {start_y} {cx + random.randint(-10, 10)} {end_y} {random.randint(250, 400)}")
        time.sleep(_hw_delay(0.5, 0.2, 0.3, 1.0))
        # Step 4: Go back to home (in case recents is still showing)
        self.press_home()
        time.sleep(_hw_delay(0.3, 0.2, 0.2, 0.8))

    def open_tiktok(self):
        self.open_app("com.zhiliaoapp.musically")

    def close_tiktok(self):
        self.close_app("com.zhiliaoapp.musically")

    def open_instagram(self):
        self.open_app("com.instagram.android")

    def close_instagram(self):
        self.close_app("com.instagram.android")

    # --- Coordinate-based element access -----------------------------------

    def get_coord(self, app: str, element: str) -> tuple[int, int]:
        """Get pixel coordinates for a UI element from the coordinate map.

        Usage:
            x, y = self.get_coord("tiktok", "nav_home")
            x, y = human.jitter_tap(x, y)
            self.tap(x, y)
        """
        return get_coords(app, element, self.screen_w, self.screen_h)

    # --- Gemini Vision element finding (complex flows only) ----------------

    def find_on_screen(self, description: str) -> Optional[tuple[int, int]]:
        """Find a UI element using Gemini Vision (screenshot + AI).

        Use ONLY for:
        - Upload flow buttons (Next, Post, Share, Overlay)
        - Popup/dialog handling
        - Error recovery
        NOT for routine navigation (use get_coord instead).
        """
        if not config.GEMINI.get("api_key"):
            return None

        from .gemini import find_element_by_vision
        screenshot = self.screenshot_bytes()
        if not screenshot:
            return None

        return find_element_by_vision(
            screenshot, description, self.screen_w, self.screen_h
        )

    def wait_for_screen(self, description: str, timeout: float = 10.0,
                        poll_interval: float = 3.0) -> Optional[tuple[int, int]]:
        """Wait for a UI element to appear using Gemini Vision polling.

        Polls every poll_interval seconds (default 3s to respect API rate limits).
        Returns (x, y) or None if timeout.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            coords = self.find_on_screen(description)
            if coords:
                return coords
            remaining = deadline - time.time()
            if remaining > poll_interval:
                time.sleep(poll_interval)
            elif remaining > 0:
                time.sleep(remaining)
        return None

    # --- Screenshot --------------------------------------------------------

    def screenshot(self) -> Optional[Image.Image]:
        """Take a screenshot and return as PIL Image.
        Uses exec-out screencap which is invisible to apps."""
        raw = self._run_bytes(["exec-out", "screencap", "-p"], timeout=10)
        if not raw:
            return None
        try:
            return Image.open(BytesIO(raw))
        except Exception as e:
            log.error("Failed to parse screenshot: %s", e)
            return None

    # Counter for screenshot filenames
    _screenshot_counter = 0
    _last_periodic_screenshot = 0

    def screenshot_bytes(self, label: str = "") -> bytes:
        """Take a screenshot and return raw PNG bytes (for Gemini API).
        If _screenshot_save_dir is set, saves a copy to disk for post-test analysis."""
        data = self._run_bytes(["exec-out", "screencap", "-p"], timeout=10)
        # Save copy if test recording is active
        if data and getattr(self, '_screenshot_save_dir', None):
            import os
            from datetime import datetime
            # Auto-detect caller if no label
            if not label:
                import traceback
                caller = traceback.extract_stack(limit=4)
                for frame in reversed(caller):
                    fname = frame.name
                    if fname not in ('screenshot_bytes', '_call_vision', '_call_multi_vision'):
                        label = fname
                        break
            ADBController._screenshot_counter += 1
            tag = f"_{label}" if label else ""
            fname = f"{ADBController._screenshot_counter:03d}_{datetime.now().strftime('%H%M%S')}{tag}.png"
            path = os.path.join(self._screenshot_save_dir, fname)
            try:
                with open(path, 'wb') as f:
                    f.write(data)
            except Exception:
                pass
        return data

    def save_screenshot_if_recording(self, label: str = ""):
        """Save a screenshot during an existing wait (zero extra delay).
        Only call this when the bot is already about to sleep/wait."""
        if not getattr(self, '_screenshot_save_dir', None):
            return
        data = self._run_bytes(["exec-out", "screencap", "-p"], timeout=10)
        if data:
            import os
            from datetime import datetime
            ADBController._screenshot_counter += 1
            tag = f"_{label}" if label else ""
            fname = f"{ADBController._screenshot_counter:03d}_{datetime.now().strftime('%H%M%S')}{tag}.png"
            path = os.path.join(self._screenshot_save_dir, fname)
            try:
                with open(path, 'wb') as f:
                    f.write(data)
            except Exception:
                pass

    # --- Background screen recorder ------------------------------------------

    _recorder_thread = None
    _recorder_stop = False

    def start_screen_recorder(self, output_dir: str, fps: float = 2.0):
        """Start background thread that captures screenshots at N fps.
        Saves JPEG frames to output_dir. Runs independently of bot actions.
        Call stop_screen_recorder() when done."""
        import threading, os
        self._recorder_stop = False
        self._recorder_output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

        def _record_loop():
            frame_num = 0
            interval = 1.0 / fps
            while not self._recorder_stop:
                t0 = time.time()
                try:
                    data = self._run_bytes(["exec-out", "screencap", "-p"], timeout=5)
                    if data and len(data) > 1000:
                        from PIL import Image
                        import io
                        img = Image.open(io.BytesIO(data)).convert("RGB")
                        frame_num += 1
                        from datetime import datetime
                        fname = f"frame_{frame_num:05d}_{datetime.now().strftime('%H%M%S_%f')[:10]}.jpg"
                        img.save(os.path.join(output_dir, fname), "JPEG", quality=70)
                except Exception:
                    pass
                elapsed = time.time() - t0
                sleep_time = max(0, interval - elapsed)
                if sleep_time > 0:
                    time.sleep(sleep_time)

        self._recorder_thread = threading.Thread(target=_record_loop, daemon=True)
        self._recorder_thread.start()
        log.info("Screen recorder started: %s at %.1f fps", output_dir, fps)

    def stop_screen_recorder(self):
        """Stop background screen recorder and return the output directory."""
        self._recorder_stop = True
        if self._recorder_thread:
            self._recorder_thread.join(timeout=5)
            self._recorder_thread = None
        output_dir = getattr(self, '_recorder_output_dir', None)
        if output_dir:
            import os
            n_frames = len([f for f in os.listdir(output_dir) if f.startswith("frame_")])
            log.info("Screen recorder stopped: %d frames saved to %s", n_frames, output_dir)
        return output_dir

    # --- File transfer -----------------------------------------------------

    def push_file(self, local_path: str, device_path: str):
        """Push a file from PC to device (120s timeout for large videos)."""
        self._run(["push", local_path, device_path], timeout=120)

    def pull_file(self, device_path: str, local_path: str):
        """Pull a file from device to PC."""
        self._run(["pull", device_path, local_path])

    # --- WiFi management (for proxy queue) ---------------------------------

    def wifi_off(self):
        """Disable WiFi -- phone completely isolated from network.
        No app can make any network request. Used between sessions to prevent
        background IP leakage when proxy rotates.
        Uses 'svc wifi' which takes effect immediately (unlike settings put)."""
        log.info("WIFI: disabling")
        self.shell("svc wifi disable")

    def wifi_on(self):
        """Enable WiFi -- phone can connect to networks again.
        After enabling, the phone auto-reconnects to the last known hotspot.
        Uses 'svc wifi' which takes effect immediately (unlike settings put)."""
        log.info("WIFI: enabling")
        self.shell("svc wifi enable")

    def check_wifi(self) -> bool:
        """Check if phone has internet connectivity via ping.
        Returns True if phone can reach the internet."""
        try:
            result = self.shell("ping -c 1 -W 2 8.8.8.8", timeout=10)
            return "1 received" in result or "1 packets received" in result
        except Exception:
            return False

    def get_wifi_state(self) -> bool:
        """Check if WiFi is enabled (via settings global, lightweight)."""
        output = self.shell("settings get global wifi_on").strip()
        return output == "1"

    def connect_wifi(self, ssid: str, password: str = ""):
        """Connect to a WiFi network (Android 11+ cmd wifi).
        Enables WiFi first if disabled, then connects."""
        self.wifi_on()
        time.sleep(_hw_delay(1.0, 0.3, 0.5, 3))
        if password:
            self.shell(f'cmd wifi connect-network "{ssid}" wpa2 "{password}"')
        else:
            self.shell(f'cmd wifi connect-network "{ssid}" open')
        log.info("WIFI: connect requested to '%s'", ssid)

    def disconnect_wifi(self):
        """Disconnect from current WiFi by disabling the radio."""
        self.wifi_off()

    def get_wifi_ssid(self) -> str:
        """Get currently connected WiFi SSID via iw (lower profile than dumpsys)."""
        output = self.shell("iw wlan0 link")
        match = re.search(r"SSID:\s+(.+)", output)
        if match:
            return match.group(1).strip()
        # Fallback: wpa_cli (available on most Android)
        output = self.shell("wpa_cli -i wlan0 status | grep ^ssid=")
        match = re.search(r"ssid=(.+)", output)
        return match.group(1).strip() if match else ""
