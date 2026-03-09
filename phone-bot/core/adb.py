"""Raw ADB controller — no uiautomator2, no APKs, no detectable footprint.

Every interaction goes through `adb shell input` (taps, swipes, text) and
`adb shell uiautomator dump` (UI tree reading).  Screenshots via
`adb exec-out screencap -p` for Gemini Vision when needed.
"""
import asyncio
import logging
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from io import BytesIO
from typing import Optional

from PIL import Image

from .. import config

log = logging.getLogger(__name__)


@dataclass
class UIElement:
    """A parsed element from the Android UI tree."""
    resource_id: str = ""
    text: str = ""
    content_desc: str = ""
    class_name: str = ""
    bounds: tuple = (0, 0, 0, 0)  # x1, y1, x2, y2
    clickable: bool = False
    scrollable: bool = False
    package: str = ""

    @property
    def center(self) -> tuple:
        x1, y1, x2, y2 = self.bounds
        return ((x1 + x2) // 2, (y1 + y2) // 2)

    @property
    def width(self) -> int:
        return self.bounds[2] - self.bounds[0]

    @property
    def height(self) -> int:
        return self.bounds[3] - self.bounds[1]


class ADBController:
    """Controls a single Android device via raw ADB commands."""

    def __init__(self, serial: str, phone_config: dict):
        self.serial = serial
        self.phone = phone_config
        self.screen_w = phone_config["screen_w"]
        self.screen_h = phone_config["screen_h"]
        self._ui_cache: list[UIElement] = []
        self._ui_cache_time: float = 0

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
        """Type text character by character (for human-like typing, use HumanEngine).
        Handles special characters by escaping them for ADB."""
        # ADB input text doesn't handle spaces and special chars well
        # Use character-by-character input via keyevents for reliability
        for char in text:
            if char == " ":
                self.shell("input keyevent KEYCODE_SPACE")
            elif char == "\n":
                self.shell("input keyevent KEYCODE_ENTER")
            elif char == "@":
                self.shell("input text '@'")
            else:
                # Escape shell-special characters
                escaped = char.replace("'", "'\\''")
                self.shell(f"input text '{escaped}'")

    def press_back(self):
        self.shell("input keyevent KEYCODE_BACK")

    def press_home(self):
        self.shell("input keyevent KEYCODE_HOME")

    def press_enter(self):
        self.shell("input keyevent KEYCODE_ENTER")

    # --- App management ----------------------------------------------------

    def open_app(self, package: str):
        """Launch an app by package name."""
        self.shell(f"monkey -p {package} -c android.intent.category.LAUNCHER 1")

    def close_app(self, package: str):
        """Force-stop an app."""
        self.shell(f"am force-stop {package}")

    def open_tiktok(self):
        self.open_app("com.zhiliaoapp.musically")

    def close_tiktok(self):
        self.close_app("com.zhiliaoapp.musically")

    def open_instagram(self):
        self.open_app("com.instagram.android")

    def close_instagram(self):
        self.close_app("com.instagram.android")

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

    # --- UI Tree (uiautomator dump) ----------------------------------------

    def dump_ui(self, force: bool = False) -> list[UIElement]:
        """Dump the current UI tree using native uiautomator (no APK needed).
        Caches for 2 seconds to avoid hammering the device."""
        now = time.time()
        if not force and self._ui_cache and (now - self._ui_cache_time) < 2.0:
            return self._ui_cache

        # Dump to device, then pull
        self.shell("uiautomator dump /sdcard/ui_dump.xml")
        xml_str = self.shell("cat /sdcard/ui_dump.xml")
        self.shell("rm /sdcard/ui_dump.xml")

        elements = self._parse_ui_xml(xml_str)
        self._ui_cache = elements
        self._ui_cache_time = now
        return elements

    def _parse_ui_xml(self, xml_str: str) -> list[UIElement]:
        """Parse uiautomator XML dump into UIElement objects."""
        elements = []
        if not xml_str or "<hierarchy" not in xml_str:
            return elements

        try:
            root = ET.fromstring(xml_str)
        except ET.ParseError:
            log.warning("Failed to parse UI XML")
            return elements

        for node in root.iter("node"):
            bounds_str = node.get("bounds", "[0,0][0,0]")
            bounds_match = re.findall(r"\[(\d+),(\d+)\]", bounds_str)
            if len(bounds_match) == 2:
                x1, y1 = int(bounds_match[0][0]), int(bounds_match[0][1])
                x2, y2 = int(bounds_match[1][0]), int(bounds_match[1][1])
            else:
                x1 = y1 = x2 = y2 = 0

            elements.append(UIElement(
                resource_id=node.get("resource-id", ""),
                text=node.get("text", ""),
                content_desc=node.get("content-desc", ""),
                class_name=node.get("class", ""),
                bounds=(x1, y1, x2, y2),
                clickable=node.get("clickable", "false") == "true",
                scrollable=node.get("scrollable", "false") == "true",
                package=node.get("package", ""),
            ))
        return elements

    # --- Element finding (3-level fallback chain) ---------------------------
    #   Level 1: UI tree (instant, free)
    #   Level 2: Gemini Vision (screenshot + AI, ~1-2s, costs API call)
    #   Level 3: None (caller handles fallback coordinates)

    def find_element(self, resource_id: str = "", text: str = "",
                     content_desc: str = "", class_name: str = "",
                     force_dump: bool = False,
                     vision_fallback: bool = True) -> Optional[UIElement]:
        """Find a single element. Uses UI tree first, then Vision AI as fallback."""

        # Level 1: UI tree
        elements = self.dump_ui(force=force_dump)
        for el in elements:
            if resource_id and resource_id not in el.resource_id:
                continue
            if text and text.lower() not in el.text.lower():
                continue
            if content_desc and content_desc.lower() not in el.content_desc.lower():
                continue
            if class_name and class_name not in el.class_name:
                continue
            return el

        # Level 2: Gemini Vision (only if enabled and we have a description)
        if vision_fallback and config.GEMINI.get("api_key"):
            description = text or content_desc or resource_id.split("/")[-1] if resource_id else ""
            if description:
                log.info("UI tree miss for '%s', trying Vision fallback", description)
                from .gemini import find_element_by_vision
                screenshot = self.screenshot_bytes()
                if screenshot:
                    coords = find_element_by_vision(
                        screenshot, description, self.screen_w, self.screen_h
                    )
                    if coords:
                        # Return a synthetic UIElement with Vision-found coordinates
                        x, y = coords
                        return UIElement(
                            text=f"[vision] {description}",
                            bounds=(x - 30, y - 30, x + 30, y + 30),
                            clickable=True,
                        )

        # Level 3: None — caller provides hardcoded fallback coordinates
        return None

    def find_elements(self, resource_id: str = "", text: str = "",
                      content_desc: str = "", class_name: str = "",
                      force_dump: bool = False) -> list[UIElement]:
        """Find all elements matching the given criteria."""
        elements = self.dump_ui(force=force_dump)
        results = []
        for el in elements:
            if resource_id and resource_id not in el.resource_id:
                continue
            if text and text.lower() not in el.text.lower():
                continue
            if content_desc and content_desc.lower() not in el.content_desc.lower():
                continue
            if class_name and class_name not in el.class_name:
                continue
            results.append(el)
        return results

    def wait_for_element(self, timeout: float = 10.0, poll_interval: float = 1.0,
                         **kwargs) -> Optional[UIElement]:
        """Wait for an element to appear on screen."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            el = self.find_element(force_dump=True, **kwargs)
            if el:
                return el
            time.sleep(poll_interval)
        return None

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
