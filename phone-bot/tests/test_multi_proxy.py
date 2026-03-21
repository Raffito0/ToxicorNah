"""Tests for multi-proxy support (section-07).

Validates that ProxyQueue selects the correct proxy config based on
each account's proxy_id, and that config validation catches orphan ids.
"""
import pytest
from unittest.mock import MagicMock, patch

from core.proxy import ProxyQueue, ssid_matches


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_proxies():
    """Two proxy configs for testing."""
    return [
        {
            "id": "proxy-1",
            "host": "proxy1.example.com",
            "port": 20001,
            "username": "user1",
            "password": "pass1",
            "rotation_url": "https://proxy1.example.com/rotate",
            "socks5_url": "socks5://user1:pass1@proxy1.example.com:20001",
            "hotspot_ssid": "Hotspot_Proxy1",
            "hotspot_password": "hp1",
        },
        {
            "id": "proxy-2",
            "host": "proxy2.example.com",
            "port": 20002,
            "username": "user2",
            "password": "pass2",
            "rotation_url": "https://proxy2.example.com/rotate",
            "socks5_url": "socks5://user2:pass2@proxy2.example.com:20002",
            "hotspot_ssid": "Hotspot_Proxy2",
            "hotspot_password": "hp2",
        },
    ]


def _make_accounts():
    """Accounts: phone 1 → proxy-1, phone 2 → proxy-2."""
    return [
        {"name": "ph1_tiktok",    "phone_id": 1, "platform": "tiktok",    "proxy_id": "proxy-1"},
        {"name": "ph1_instagram", "phone_id": 1, "platform": "instagram", "proxy_id": "proxy-1"},
        {"name": "ph2_tiktok",    "phone_id": 2, "platform": "tiktok",    "proxy_id": "proxy-2"},
        {"name": "ph2_instagram", "phone_id": 2, "platform": "instagram", "proxy_id": "proxy-2"},
    ]


def _make_controller(phone_id: int) -> MagicMock:
    """Create a mock ADBController that reports successful WiFi connection."""
    ctrl = MagicMock()
    ctrl.get_wifi_ssid.return_value = ""  # will be overridden per test
    return ctrl


@pytest.fixture
def patched_config():
    """Patch config.PROXIES and config.ACCOUNTS for test isolation."""
    proxies = _make_proxies()
    accounts = _make_accounts()
    with patch("core.proxy.config") as mock_cfg:
        mock_cfg.PROXIES = proxies
        mock_cfg.ACCOUNTS = accounts
        yield mock_cfg, proxies, accounts


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestProxyLookupByPhoneId:
    """ProxyQueue._get_proxy_for_phone selects correct proxy via proxy_id."""

    def test_phone2_uses_proxy2_hotspot(self, patched_config):
        mock_cfg, proxies, accounts = patched_config
        ctrl1 = _make_controller(1)
        ctrl2 = _make_controller(2)
        ctrl2.get_wifi_ssid.return_value = "Hotspot_Proxy2"

        pq = ProxyQueue({1: ctrl1, 2: ctrl2})

        proxy = pq._get_proxy_for_phone(2)
        assert proxy["id"] == "proxy-2"
        assert proxy["hotspot_ssid"] == "Hotspot_Proxy2"

    def test_phone1_uses_proxy1_hotspot(self, patched_config):
        mock_cfg, proxies, accounts = patched_config
        ctrl1 = _make_controller(1)
        pq = ProxyQueue({1: ctrl1})

        proxy = pq._get_proxy_for_phone(1)
        assert proxy["id"] == "proxy-1"
        assert proxy["hotspot_ssid"] == "Hotspot_Proxy1"


class TestMissingProxyId:
    """ValueError raised when proxy_id not in PROXIES list."""

    def test_unknown_proxy_id_raises_valueerror(self, patched_config):
        mock_cfg, proxies, accounts = patched_config
        # Add account with invalid proxy_id
        accounts.append(
            {"name": "ph9_tiktok", "phone_id": 9, "platform": "tiktok", "proxy_id": "proxy-99"}
        )
        ctrl9 = _make_controller(9)
        pq = ProxyQueue({9: ctrl9})

        with pytest.raises(ValueError, match="proxy-99"):
            pq._get_proxy_for_phone(9)

    def test_no_account_for_phone_raises_valueerror(self, patched_config):
        mock_cfg, proxies, accounts = patched_config
        ctrl99 = _make_controller(99)
        pq = ProxyQueue({99: ctrl99})

        with pytest.raises(ValueError, match="phone_id=99"):
            pq._get_proxy_for_phone(99)

    def test_missing_proxy_id_key_raises_valueerror(self, patched_config):
        mock_cfg, proxies, accounts = patched_config
        # Account without proxy_id key
        accounts.append(
            {"name": "ph8_tiktok", "phone_id": 8, "platform": "tiktok"}
        )
        ctrl8 = _make_controller(8)
        pq = ProxyQueue({8: ctrl8})

        with pytest.raises(ValueError, match="missing proxy_id"):
            pq._get_proxy_for_phone(8)


class TestPhoneSwitchingUsesCorrectProxy:
    """Switching phones cycles through the right proxy configs."""

    @patch("core.proxy.httpx")
    @patch("core.proxy._hw_delay", return_value=0.01)
    def test_switch_phone1_then_phone2(self, mock_delay, mock_httpx, patched_config):
        mock_cfg, proxies, accounts = patched_config
        mock_httpx.get.return_value = MagicMock(status_code=200, text="OK")

        ctrl1 = _make_controller(1)
        ctrl1.get_wifi_ssid.return_value = "Hotspot_Proxy1"
        ctrl2 = _make_controller(2)
        ctrl2.get_wifi_ssid.return_value = "Hotspot_Proxy2"

        pq = ProxyQueue({1: ctrl1, 2: ctrl2})

        # Connect phone 1
        result1 = pq.connect_phone(1, rotate_ip=True)
        assert result1 is True
        assert pq.active_phone_id == 1
        ctrl1.connect_wifi.assert_called_with("Hotspot_Proxy1", "hp1")

        # Switch to phone 2
        result2 = pq.connect_phone(2, rotate_ip=True)
        assert result2 is True
        assert pq.active_phone_id == 2
        ctrl2.connect_wifi.assert_called_with("Hotspot_Proxy2", "hp2")


class TestConfigProxiesStructure:
    """config.PROXIES list has required keys in every entry."""

    def test_all_proxies_have_required_keys(self):
        import config
        required = {"id", "host", "port", "username", "password",
                    "rotation_url", "socks5_url", "hotspot_ssid", "hotspot_password"}
        for proxy in config.PROXIES:
            missing = required - set(proxy.keys())
            assert not missing, f"Proxy '{proxy.get('id', '?')}' missing keys: {missing}"


class TestAccountsProxyIdValid:
    """Every account's proxy_id references an existing proxy in PROXIES."""

    def test_no_orphan_proxy_ids(self):
        import config
        valid_ids = {p["id"] for p in config.PROXIES}
        for acct in config.ACCOUNTS:
            pid = acct.get("proxy_id")
            assert pid is not None, f"Account '{acct['name']}' missing proxy_id"
            assert pid in valid_ids, (
                f"Account '{acct['name']}' has proxy_id='{pid}' "
                f"not in PROXIES {valid_ids}"
            )

    def test_same_phone_accounts_share_proxy_id(self):
        """All accounts on the same phone must use the same proxy."""
        import config
        from collections import defaultdict
        phone_proxies = defaultdict(set)
        for acct in config.ACCOUNTS:
            phone_proxies[acct["phone_id"]].add(acct.get("proxy_id"))
        for phone_id, proxy_ids in phone_proxies.items():
            assert len(proxy_ids) == 1, (
                f"Phone {phone_id} has conflicting proxy_ids: {proxy_ids}"
            )
