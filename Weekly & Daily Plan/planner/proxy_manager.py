"""Proxy rotation management.

Handles the shared USA Mobile SOCKS5 proxy.
Rotation is triggered only when switching between accounts on DIFFERENT phones.
"""
import urllib.request
import urllib.error

from . import config


def should_rotate(previous_phone_id, next_phone_id):
    """Return True if proxy IP needs to be rotated (phone switch)."""
    if previous_phone_id is None:
        return False
    return previous_phone_id != next_phone_id


def rotate_proxy():
    """Call the proxy rotation URL to get a new IP.
    Returns (success: bool, message: str)."""
    url = config.PROXY["rotation_url"]
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=15) as response:
            body = response.read().decode("utf-8", errors="replace")
            return True, f"IP rotated successfully: {body.strip()}"
    except urllib.error.URLError as e:
        return False, f"Rotation failed: {e}"
    except Exception as e:
        return False, f"Rotation error: {e}"


def get_proxy_config():
    """Return proxy configuration strings."""
    p = config.PROXY
    return {
        "socks5": f"socks5://{p['username']}:{p['password']}@{p['host']}:{p['port']}",
        "host": p["host"],
        "port": p["port"],
        "username": p["username"],
        "password": p["password"],
    }
