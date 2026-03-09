"""Proxy Queue Manager — ensures only 1 phone uses the SOCKS5 proxy at a time.

How it works:
1. All 4 phones are connected via USB (always)
2. The PC runs SSTap (SOCKS5) + MyPublicWiFi (hotspot)
3. Only 1 phone connects to the WiFi hotspot at a time
4. When switching phones: disconnect current → rotate proxy IP → connect next
"""
import logging
import time
import httpx

from .. import config
from .adb import ADBController

log = logging.getLogger(__name__)


class ProxyQueue:
    """Manages which phone is currently connected to the proxy WiFi."""

    def __init__(self, controllers: dict[int, ADBController]):
        """controllers: {phone_id: ADBController}"""
        self.controllers = controllers
        self.active_phone_id: int | None = None
        self._proxy_config = config.PROXY

    @property
    def active_controller(self) -> ADBController | None:
        if self.active_phone_id:
            return self.controllers.get(self.active_phone_id)
        return None

    def connect_phone(self, phone_id: int, rotate_ip: bool = True) -> bool:
        """Connect a phone to the proxy WiFi.
        1. Disconnects current phone (if any)
        2. Rotates proxy IP (if switching phones)
        3. Connects new phone to WiFi hotspot
        """
        if phone_id == self.active_phone_id:
            log.info("Phone %d already connected to proxy", phone_id)
            return True

        # Step 1: Disconnect current phone
        if self.active_phone_id:
            self.disconnect_current()

        # Step 2: Rotate proxy IP
        if rotate_ip:
            self._rotate_proxy_ip()
            time.sleep(2)  # wait for new IP to stabilize

        # Step 3: Connect new phone
        ctrl = self.controllers.get(phone_id)
        if not ctrl:
            log.error("Phone %d not found in controllers", phone_id)
            return False

        ssid = self._proxy_config["hotspot_ssid"]
        password = self._proxy_config["hotspot_password"]

        log.info("Connecting Phone %d to WiFi '%s'...", phone_id, ssid)
        ctrl.connect_wifi(ssid, password)
        time.sleep(3)  # wait for connection

        # Verify connection
        connected_ssid = ctrl.get_wifi_ssid()
        if ssid.lower() in connected_ssid.lower():
            self.active_phone_id = phone_id
            log.info("Phone %d connected to proxy WiFi", phone_id)
            return True
        else:
            log.warning("Phone %d failed to connect (got SSID: '%s')", phone_id, connected_ssid)
            return False

    def disconnect_current(self):
        """Disconnect the currently active phone from WiFi."""
        if not self.active_phone_id:
            return

        ctrl = self.active_controller
        if ctrl:
            log.info("Disconnecting Phone %d from WiFi", self.active_phone_id)
            ctrl.disconnect_wifi()
            time.sleep(1)

        self.active_phone_id = None

    def disconnect_all(self):
        """Disconnect all phones from WiFi (cleanup)."""
        for phone_id, ctrl in self.controllers.items():
            try:
                ctrl.disconnect_wifi()
            except Exception as e:
                log.warning("Failed to disconnect Phone %d: %s", phone_id, e)
        self.active_phone_id = None

    def _rotate_proxy_ip(self):
        """Call the proxy rotation URL to get a new IP."""
        url = self._proxy_config["rotation_url"]
        try:
            resp = httpx.get(url, timeout=10)
            log.info("Proxy IP rotated: %s", resp.text.strip()[:100])
        except Exception as e:
            log.warning("Proxy rotation failed: %s", e)

    def switch_to_phone(self, phone_id: int) -> bool:
        """High-level: switch proxy connection from current phone to another."""
        if phone_id == self.active_phone_id:
            return True
        return self.connect_phone(phone_id, rotate_ip=True)
