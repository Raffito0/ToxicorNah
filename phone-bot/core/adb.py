"""Raw ADB controller -- zero detectable footprint.

Every interaction goes through `adb shell input` (taps, swipes, text).
App launch via `am start` (NOT monkey -- monkey is detectable).
App close via natural gestures (NOT am force-stop -- detectable).
Screenshots via `adb exec-out screencap -p` for Gemini Vision when needed.

NO uiautomator, NO APKs, NO accessibility services.
"""
import logging
import re
import subprocess
import time
from io import BytesIO
from typing import Optional

from PIL import Image

from .. import config
from .coords import get_coords

log = logging.getLogger(__name__)


class ADBController:
    """Controls a single Android device via raw ADB commands.

    Detection-safe: uses ONLY input events, am start, and screencap.
    No uiautomator, no monkey, no force-stop (except emergency recovery).
    """

    def __init__(self, serial: str, phone_config: dict):
        self.serial = serial
        self.phone = phone_config
        self.screen_w = phone_config["screen_w"]
        self.screen_h = phone_config["screen_h"]

    # --- Low-level ADB execution -------------------------------------------

    def _run(self, args: list[str], timeout: int = 15) -> str:
        """Execute an ADB command and return stdout."""
        cmd = [config.ADB_PATH, "-s", self.serial] + args
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0 and result.stderr.strip():
                log.warning("ADB stderr: %s", result.stderr.strip())
            return result.stdout
        except subprocess.TimeoutExpired:
            log.error("ADB command timed out: %s", " ".join(cmd))
            return ""

    def _run_bytes(self, args: list[str], timeout: int = 15) -> bytes:
        """Execute an ADB command and return raw bytes (for screenshots)."""
        cmd = [config.ADB_PATH, "-s", self.serial] + args
        try:
            result = subprocess.run(
                cmd, capture_output=True, timeout=timeout
            )
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
        """Return the package name of the currently focused app."""
        output = self.shell("dumpsys activity activities | grep mResumedActivity")
        match = re.search(r"u0\s+([^\s/]+)", output)
        return match.group(1) if match else ""

    def is_screen_on(self) -> bool:
        output = self.shell("dumpsys power | grep 'Display Power'")
        return "ON" in output

    def wake_screen(self):
        if not self.is_screen_on():
            self.shell("input keyevent KEYCODE_WAKEUP")
            time.sleep(0.5)

    def unlock_screen(self):
        """Swipe up to unlock (no PIN assumed)."""
        self.wake_screen()
        cy = self.screen_h * 3 // 4
        self.shell(f"input swipe {self.screen_w // 2} {cy} {self.screen_w // 2} {self.screen_h // 4} 300")
        time.sleep(0.5)

    # --- Input actions (tap, swipe, type) ----------------------------------

    def tap(self, x: int, y: int):
        """Tap at exact coordinates (human jitter added by HumanEngine)."""
        x = max(0, min(x, self.screen_w))
        y = max(0, min(y, self.screen_h))
        self.shell(f"input tap {x} {y}")

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300):
        """Swipe between two points."""
        self.shell(f"input swipe {x1} {y1} {x2} {y2} {duration_ms}")

    def long_press(self, x: int, y: int, duration_ms: int = 800):
        """Long press at coordinates."""
        self.shell(f"input swipe {x} {y} {x} {y} {duration_ms}")

    def type_text(self, text: str):
        """Type text character by character.
        Handles special characters by escaping them for ADB."""
        for char in text:
            if char == " ":
                self.shell("input keyevent KEYCODE_SPACE")
            elif char == "\n":
                self.shell("input keyevent KEYCODE_ENTER")
            elif char == "@":
                self.shell("input text '@'")
            else:
                escaped = char.replace("'", "'\\''")
                self.shell(f"input text '{escaped}'")

    def press_back(self):
        self.shell("input keyevent KEYCODE_BACK")

    def press_home(self):
        self.shell("input keyevent KEYCODE_HOME")

    def press_enter(self):
        self.shell("input keyevent KEYCODE_ENTER")

    # --- App management (detection-safe) -----------------------------------

    def open_app(self, package: str):
        """Launch an app using am start (NOT monkey -- monkey is detectable)."""
        activity = config.APP_ACTIVITIES.get(package)
        if activity:
            self.shell(f"am start -n {package}/{activity}")
        else:
            # Resolve launcher activity dynamically (Android 8+)
            output = self.shell(
                f"cmd package resolve-activity --brief "
                f"-c android.intent.category.LAUNCHER {package}"
            )
            component = output.strip().split('\n')[-1].strip()
            if '/' in component:
                self.shell(f"am start -n {component}")
            else:
                log.warning("Could not resolve activity for %s", package)
                self.shell(f"am start {package}")

    def close_app(self, package: str):
        """Close an app naturally (Home -> Recent Apps -> swipe away).
        Does NOT use am force-stop which is detectable."""
        self.close_app_natural()

    def close_app_natural(self):
        """Natural app close: Home -> Recent Apps -> swipe top card away -> Home.
        Mimics how a real user closes an app."""
        # Step 1: Go home (app goes to background)
        self.press_home()
        time.sleep(0.8)

        # Step 2: Open Recent Apps
        self.shell("input keyevent KEYCODE_APP_SWITCH")
        time.sleep(1.0)

        # Step 3: Swipe top card up to dismiss
        cx = self.screen_w // 2
        self.swipe(cx, self.screen_h // 2, cx, 100, 250)
        time.sleep(0.5)

        # Step 4: Return to home
        self.press_home()
        time.sleep(0.5)

    def _force_stop(self, package: str):
        """Emergency force-stop (ONLY for error recovery, not normal use)."""
        self.shell(f"am force-stop {package}")

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

    def screenshot_bytes(self) -> bytes:
        """Take a screenshot and return raw PNG bytes (for Gemini API)."""
        return self._run_bytes(["exec-out", "screencap", "-p"], timeout=10)

    # --- File transfer -----------------------------------------------------

    def push_file(self, local_path: str, device_path: str):
        """Push a file from PC to device."""
        self._run(["push", local_path, device_path])

    def pull_file(self, device_path: str, local_path: str):
        """Pull a file from device to PC."""
        self._run(["pull", device_path, local_path])

    # --- WiFi management (for proxy queue) ---------------------------------

    def get_wifi_state(self) -> bool:
        """Check if WiFi is enabled."""
        output = self.shell("dumpsys wifi | grep 'Wi-Fi is'")
        return "enabled" in output.lower()

    def enable_wifi(self):
        self.shell("svc wifi enable")

    def disable_wifi(self):
        self.shell("svc wifi disable")

    def connect_wifi(self, ssid: str, password: str = ""):
        """Connect to a WiFi network (Android 11+)."""
        self.enable_wifi()
        time.sleep(1)
        if password:
            self.shell(f'cmd wifi connect-network "{ssid}" wpa2 "{password}"')
        else:
            self.shell(f'cmd wifi connect-network "{ssid}" open')

    def disconnect_wifi(self):
        """Disconnect from current WiFi."""
        self.disable_wifi()

    def get_wifi_ssid(self) -> str:
        """Get currently connected WiFi SSID."""
        output = self.shell("dumpsys wifi | grep 'mWifiInfo'")
        match = re.search(r'SSID: "?([^",]+)"?', output)
        return match.group(1) if match else ""
