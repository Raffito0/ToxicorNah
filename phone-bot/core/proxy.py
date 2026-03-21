"""Proxy Queue Manager — ensures only 1 phone uses the SOCKS5 proxy at a time.

How it works:
1. All 4 phones are connected via USB (always)
2. The PC runs SSTap (SOCKS5) + MyPublicWiFi (hotspot)
3. Only 1 phone connects to the WiFi hotspot at a time
4. When switching phones: disconnect current → rotate proxy IP → connect next
"""
import logging
import math
import random
import time
import httpx


def _hw_delay(median: float, sigma: float = 0.3, lo: float = 0.1, hi: float = 10.0) -> float:
    """Hardware-level log-normal delay."""
    val = random.lognormvariate(math.log(max(median, 0.01)), sigma)
    return max(lo, min(hi, val))

from .. import config
from .adb import ADBController

log = logging.getLogger(__name__)


def ssid_matches(expected: str, connected: str) -> bool:
    """Check if connected SSID matches expected (case-insensitive, stripped, exact)."""
    if not expected or not connected:
        return False
    return expected.strip().lower() == connected.strip().lower()


class ProxyQueue:
    """Manages which phone is currently connected to the proxy WiFi."""

    def __init__(self, controllers: dict[int, ADBController]):
        """controllers: {phone_id: ADBController}"""
        self.controllers = controllers
        self.active_phone_id: int | None = None
        self._proxies: list[dict] = config.PROXIES

    def _get_proxy_for_phone(self, phone_id: int) -> dict:
        """Return the proxy config assigned to this phone's account.

        Looks up the account for phone_id, reads its proxy_id, then finds
        the matching entry in config.PROXIES.
        Raises ValueError if proxy_id not found in PROXIES list.
        """
        account = next((a for a in config.ACCOUNTS if a["phone_id"] == phone_id), None)
        if account is None:
            raise ValueError(f"No account found for phone_id={phone_id}")

        proxy_id = account.get("proxy_id")
        if proxy_id is None:
            raise ValueError(f"Account '{account['name']}' missing proxy_id")

        proxy = next((p for p in self._proxies if p["id"] == proxy_id), None)
        if proxy is None:
            raise ValueError(f"proxy_id '{proxy_id}' not found in config.PROXIES")

        return proxy

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

        # Look up the proxy assigned to this phone
        proxy_config = self._get_proxy_for_phone(phone_id)

        # Step 2: Rotate proxy IP (retry once on failure)
        if rotate_ip:
            if not self._rotate_proxy_ip(proxy_config):
                log.warning("Proxy rotation failed, retrying in 3s...")
                time.sleep(_hw_delay(3.0, 0.3, 1, 6))
                if not self._rotate_proxy_ip(proxy_config):
                    log.error("Proxy rotation failed twice -- aborting phone switch "
                              "(risk: two phones on same IP)")
                    return False
            time.sleep(_hw_delay(2.5, 0.3, 1, 6))  # wait for new IP to stabilize

        # Step 3: Connect new phone
        ctrl = self.controllers.get(phone_id)
        if not ctrl:
            log.error("Phone %d not found in controllers", phone_id)
            return False

        ssid = proxy_config["hotspot_ssid"]
        password = proxy_config["hotspot_password"]

        log.info("Connecting Phone %d to WiFi '%s'...", phone_id, ssid)
        ctrl.connect_wifi(ssid, password)
        time.sleep(_hw_delay(3.5, 0.3, 2, 8))  # wait for connection

        # Verify connection
        connected_ssid = ctrl.get_wifi_ssid()
        if ssid_matches(ssid, connected_ssid):
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
            time.sleep(_hw_delay(1.0, 0.3, 0.3, 3))

        self.active_phone_id = None

    def disconnect_all(self):
        """Disconnect all phones from WiFi (cleanup)."""
        for phone_id, ctrl in self.controllers.items():
            try:
                ctrl.disconnect_wifi()
            except Exception as e:
                log.warning("Failed to disconnect Phone %d: %s", phone_id, e)
        self.active_phone_id = None

    def _rotate_proxy_ip(self, proxy_config: dict) -> bool:
        """Call the proxy rotation URL to get a new IP. Returns True on success."""
        url = proxy_config["rotation_url"]
        try:
            resp = httpx.get(url, timeout=10)
            if resp.status_code == 200:
                log.info("Proxy IP rotated: %s", resp.text.strip()[:100])
                return True
            log.warning("Proxy rotation returned status %d: %s",
                        resp.status_code, resp.text.strip()[:100])
            return False
        except Exception as e:
            log.warning("Proxy rotation failed: %s", e)
            return False

    def switch_to_phone(self, phone_id: int) -> bool:
        """High-level: switch proxy connection from current phone to another."""
        if phone_id == self.active_phone_id:
            return True
        return self.connect_phone(phone_id, rotate_ip=True)
