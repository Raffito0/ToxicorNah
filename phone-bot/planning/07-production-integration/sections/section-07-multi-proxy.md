# Section 07: Multi-Proxy Support

## Overview

This section changes the proxy architecture from a single shared SOCKS5 proxy to a list of named proxies. Each account gets a `proxy_id` field that selects which proxy it uses. This is the foundation for scaling to 4+ phones where a single proxy shared across all phones would create IP conflicts.

**Dependencies**: section-06 (always-on service) must be complete. This section blocks section-08.

**Estimated effort**: Small — two file changes, a handful of new tests.

---

## Tests (write first)

File to create: `phone-bot/tests/test_multi_proxy.py`

```python
# test_multi_proxy.py

# Test: ProxyQueue.switch_to_phone() uses the account's proxy_id to select the correct proxy config
#   → build PROXIES list with 2 entries, ACCOUNTS with phone 2 mapped to "proxy-2"
#   → call switch_to_phone(phone_id=2), verify hotspot_ssid from proxy-2 used

# Test: ProxyQueue.switch_to_phone() raises clear error when proxy_id not found in PROXIES list
#   → set account proxy_id to "proxy-99" (not in PROXIES)
#   → call switch_to_phone(), expect ValueError with "proxy-99" in message

# Test: ProxyQueue correctly cycles to account's assigned proxy when phone changes
#   → switch phone 1 (proxy-1) → phone 2 (proxy-2) → verify correct proxy config each time

# Test: config.PROXIES list parses correctly (id, host, port, username, password all present)
#   → import config.PROXIES, assert each entry has required keys

# Test: each account in config.ACCOUNTS has a valid proxy_id that exists in PROXIES
#   → cross-reference all proxy_id values in ACCOUNTS against PROXIES[*]["id"] list
#   → assert no orphan proxy_id values
```

Each test uses a fixture that builds a minimal `PROXIES` list and `ACCOUNTS` list. The proxy rotation HTTP call should be mocked.

Key assertions:
- When `switch_to_phone(phone_id=2)` is called, the `ProxyQueue` uses the proxy whose `id` matches `account["proxy_id"]` for phone 2 — not always index 0.
- When a `proxy_id` value in `ACCOUNTS` does not exist in `PROXIES`, the method raises a `ValueError` with the missing id in the message.

---

## Implementation

### 1. `phone-bot/config.py` — Change `PROXY` to `PROXIES` list; add `proxy_id` to accounts

Replace the single `PROXY` dict with a `PROXIES` list. Each entry has an `id` key used for lookup. The env var fallback chain (`PROXY_1_*` → `PROXY_*`) means existing `.env` files keep working without any changes.

**Current shape**:
```python
PROXY = {
    "host": "sinister.services",
    "port": 20002,
    "username": _proxy_user,
    "password": _proxy_pass,
    "rotation_url": ...,
    "socks5_url": ...,
    "hotspot_ssid": ...,
    "hotspot_password": ...,
}
```

**New shape**:
```python
PROXIES = [
    {
        "id": "proxy-1",
        "host": "sinister.services",
        "port": 20002,
        "username": os.getenv("PROXY_1_USERNAME", os.getenv("PROXY_USERNAME", "")),
        "password": os.getenv("PROXY_1_PASSWORD", os.getenv("PROXY_PASSWORD", "")),
        "rotation_url": f"https://sinister.services/selling/rotate?token={os.getenv('PROXY_1_ROTATION_TOKEN', os.getenv('PROXY_ROTATION_TOKEN', ''))}",
        "socks5_url": f"socks5://{...}:{...}@sinister.services:20002",
        "hotspot_ssid": os.getenv("PROXY_1_HOTSPOT_SSID", os.getenv("HOTSPOT_SSID", "PhoneBot_Proxy")),
        "hotspot_password": os.getenv("PROXY_1_HOTSPOT_PASSWORD", os.getenv("HOTSPOT_PASSWORD", "")),
    },
    # Add proxy-2, proxy-3 etc. as needed when scaling beyond 3 phones
]
```

**Add `proxy_id` to each account entry in `ACCOUNTS`**:
```python
ACCOUNTS = [
    {"name": "ph1_tiktok",    "phone_id": 1, "platform": "tiktok",    "proxy_id": "proxy-1"},
    {"name": "ph1_instagram", "phone_id": 1, "platform": "instagram", "proxy_id": "proxy-1"},
    {"name": "ph2_tiktok",    "phone_id": 2, "platform": "tiktok",    "proxy_id": "proxy-1"},
    {"name": "ph2_instagram", "phone_id": 2, "platform": "instagram", "proxy_id": "proxy-1"},
    {"name": "ph3_tiktok",    "phone_id": 3, "platform": "tiktok",    "proxy_id": "proxy-1"},
    {"name": "ph3_instagram", "phone_id": 3, "platform": "instagram", "proxy_id": "proxy-1"},
]
```

All accounts default to `"proxy-1"` (the existing single proxy). When a second proxy is added, only change the affected accounts' `proxy_id` values — no code changes required.

---

### 2. `phone-bot/core/proxy.py` — Look up proxy by account's `proxy_id`

The `ProxyQueue.__init__` currently stores `self._proxy_config = config.PROXY`. Change it to store the full list and look up by id at switch time.

**Key changes**:

```python
class ProxyQueue:
    def __init__(self, controllers: dict[int, ADBController]):
        self.controllers = controllers
        self.active_phone_id: int | None = None
        self._proxies: list[dict] = config.PROXIES  # was config.PROXY

    def _get_proxy_for_phone(self, phone_id: int) -> dict:
        """Return the proxy config assigned to this phone's account.

        Looks up the account for phone_id, reads its proxy_id, then finds
        the matching entry in config.PROXIES.
        Raises ValueError if proxy_id not found in PROXIES list.
        """
        # 1. Find account for this phone_id (any platform — they share the same proxy)
        account = next((a for a in config.ACCOUNTS if a["phone_id"] == phone_id), None)
        if account is None:
            raise ValueError(f"No account found for phone_id={phone_id}")

        proxy_id = account.get("proxy_id", "proxy-1")  # fallback for migration

        # 2. Look up proxy by id
        proxy = next((p for p in self._proxies if p["id"] == proxy_id), None)
        if proxy is None:
            raise ValueError(f"proxy_id '{proxy_id}' not found in config.PROXIES")

        return proxy

    def _rotate_proxy_ip(self, proxy_config: dict) -> bool:
        """Call the rotation URL for the given proxy config. Returns True on success."""
        ...

    def connect_phone(self, phone_id: int, rotate_ip: bool = True) -> bool:
        """Connect a phone to its assigned proxy WiFi hotspot."""
        proxy_config = self._get_proxy_for_phone(phone_id)
        # Use proxy_config["hotspot_ssid"], proxy_config["hotspot_password"], etc.
        # instead of self._proxy_config["hotspot_ssid"]
        ...
```

Everywhere `self._proxy_config` is currently accessed (ssid, password, rotation_url, etc.), replace with `proxy_config = self._get_proxy_for_phone(phone_id)` then access `proxy_config["hotspot_ssid"]` etc.

The `switch_to_phone()` method signature does **not** change — it still takes `phone_id: int`.

---

## Context: Why This Structure

The current architecture has SSTap running on the PC forwarding one SOCKS5 connection through a hotspot. Only one phone connects at a time. This constraint remains with multiple proxies — but now different phones can connect to different hotspot SSIDs. Phone 1 might connect to `PhoneBot_Proxy_1` and Phone 4 to `PhoneBot_Proxy_2`, enabling concurrent posting without IP conflicts.

**When to add proxy-2**: When a fourth real phone is added and runs sessions overlapping with phones 1-3. For the current 3-phone setup with sequential sessions, a single proxy is sufficient. Do not pre-create empty entries.

---

## Future: Dashboard Migration

When the Flask dashboard is built, proxy config and account-to-proxy mappings should move from `config.py` to a managed JSON/db file controlled by Flask. The `proxy_id` field and `PROXIES` list structure chosen here maps cleanly to a database schema:

```
proxies:  {id, host, port, username_env_var, rotation_url, hotspot_ssid, hotspot_password_env_var}
accounts: {name, phone_id, platform, proxy_id → FK proxies.id}
```

No code changes will be needed in `proxy.py` for this migration — only the data source for `PROXIES` and `ACCOUNTS` changes.

---

## Files to Modify/Create

| Action | File |
|--------|------|
| Modify | `phone-bot/config.py` — replace `PROXY` dict with `PROXIES` list; add `proxy_id` to each `ACCOUNTS` entry |
| Modify | `phone-bot/core/proxy.py` — store list; add `_get_proxy_for_phone()`; `_rotate_proxy_ip()` takes proxy_config arg; `connect_phone()` calls `_get_proxy_for_phone()` |
| Create | `phone-bot/tests/test_multi_proxy.py` — 5 pytest tests |

---

## Acceptance Criteria

- [x] `pytest phone-bot/tests/test_multi_proxy.py -v` — all 9 tests pass
- [x] `grep -n "config.PROXY[^S]" phone-bot/core/proxy.py` returns no results (old single-proxy ref gone)
- [x] Existing proxy behavior unchanged with only 1 entry in `PROXIES` (backward compatible via `PROXY = PROXIES[0]` alias)
- [x] `ValueError` raised with missing proxy_id in message when proxy_id not found
- [x] `ValueError` raised when account missing proxy_id key entirely (no silent fallback)
- [x] `ValueError` raised when no account exists for phone_id
- [x] All accounts in `config.ACCOUNTS` have valid `proxy_id` (validated by test)
- [x] All accounts on same phone share same proxy_id (validated by test)

## Implementation Notes (post-review)

- **9 tests** instead of spec's 5: added tests for no-account phone, missing proxy_id key, and same-phone consistency
- **No silent fallback**: `_get_proxy_for_phone()` raises ValueError if proxy_id key is missing (code review fix #3)
- **Backward compat alias**: `PROXY = PROXIES[0]` kept for any external code that still references `config.PROXY`
- **Env var fallback chain**: `PROXY_1_USERNAME` → `PROXY_USERNAME` — existing .env files work without changes
