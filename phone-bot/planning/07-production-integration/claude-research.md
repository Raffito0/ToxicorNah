# Research: Production Integration

## Codebase Research

### Executor Integration Status

**`executor.run_today()`** è completo e funzionante:
- Phase 1: Warmup (accounts in rampa)
- Phase 2: Production (weekly plan JSON)
- Phase 3: Cleanup (WiFi off, logger close)
- `_wait_until(HH:MM)` polling ogni 60s, async, day-wrap safe

**Posting flow in `_execute_normal()`**:
- `get_next_video(phone_id, platform)` → Airtable query
- `download_video()` via ThreadPoolExecutor (30s timeout)
- Video path passed to `browse_session()` → `post_video()`/`post_reel()`
- `mark_posted()` called after session completes (not after post)

**Error handling gaps**:
- Download failure → graceful (skips post, continues session)
- `mark_posted()` exception → crashes session (no try/except)
- Post failure → returns False but executor doesn't retry
- `push_to_phone()` imported but NEVER called in executor

### Delivery Module

- `get_next_video()`: Airtable formula `AND(FIND('Phone N', {content_label}), {platform_status}='pending')`
- `download_video()`: R2 with User-Agent header, chunks 8KB
- `push_to_phone()`: Requires `ADB_SERIAL_PHONE{N}` env vars — currently empty, raises ValueError
- `mark_posted/draft/skipped()`: Raw Airtable PATCH, no error handling

**Note**: `push_to_phone()` pushes to `/sdcard/DCIM/Camera/` but `post_video()` pushes to `/sdcard/Download/`. These are different paths — `push_to_phone()` is unused and the actual posting flow uses `adb.push_file()` directly.

### Posting Code

**TikTok `post_video()`**: Push to `/sdcard/Download/` → create menu → upload tab → select video → next → caption → post → verify → delete video. Returns bool.

**Instagram `post_reel()`**: Same pattern, REEL tab instead of Upload.

### Proxy System

- SOCKS5 via `sinister.services:20002`
- Rotation API: `GET /selling/rotate?token={token}`
- WiFi hotspot on PC, phones connect via WiFi
- Only 1 phone at a time (proxy rotates on phone switch)
- Retry once on rotation failure, skip session if both fail

### Telegram Watchdog

- Send-only via raw HTTP POST to Bot API
- Currently for FORGE workflow only
- Has `send()`, `notify_precondition()`, `wait_for_ready()`
- Needs: `PHONEBOT_TELEGRAM_TOKEN`, `PHONEBOT_TELEGRAM_CHAT`

### Required Env Vars

```
PROXY_USERNAME, PROXY_PASSWORD, PROXY_ROTATION_TOKEN
HOTSPOT_SSID, HOTSPOT_PASSWORD
AIRTABLE_API_KEY
GEMINI_API_KEY (has hardcoded default)
ADB_SERIAL_PHONE1/2/3 (for delivery push — currently unused by executor)
PHONEBOT_TEST=0 (production mode)
PHONEBOT_TELEGRAM_TOKEN, PHONEBOT_TELEGRAM_CHAT
```

---

## Web Research

### 1. Windows Task Scheduler

**Recommended**: Task Scheduler + `.bat` wrapper (not calling python.exe directly).

```batch
@echo off
cd C:\Users\rafca\OneDrive\Desktop\project
C:\path\to\python.exe main.py %*
```

**Key settings**:
- "Run whether user is logged in or not" (headless)
- "If task fails, restart every: 1 hour" up to 3 times
- "If task runs longer than X hours, stop it"
- Always absolute paths (Task Scheduler has different working dir)

**Alternatives**:
- Servy (maintained Windows service manager, auto-restart, dashboard)
- NSSM (abandoned since 2014, still works)
- APScheduler (Python-native, persistent job stores, survives restarts)

**Recommendation**: Task Scheduler for daily "fire and forget". If need continuous daemon → Servy.

### 2. Telegram Monitoring

**Recommended**: Raw HTTP via `requests` (no framework needed for send-only).

```python
def send_telegram(text, parse_mode="MarkdownV2"):
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    resp = requests.post(url, json={"chat_id": CHAT, "text": text, "parse_mode": parse_mode}, timeout=10)
    if resp.status_code == 429:
        time.sleep(resp.json()["parameters"]["retry_after"])
        return send_telegram(text, parse_mode)
```

**MarkdownV2 escaping**: Must escape `_*[]()~`>#+-=|{}.!` with `\`.

**Rate limits**: 1 msg/sec per chat, 20 msg/min per group, 429 with `retry_after`.

### 3. ADB Push Reliability

**Common failures**: Device sleep, storage full, permission denied, cable quality, stale ADB server.

**Reliable pattern**:
1. Check device connected (`adb get-state`)
2. Check storage space (`adb shell df /sdcard`)
3. Push file with timeout
4. Verify size matches (`adb shell stat -c %s`)
5. Trigger media scanner broadcast

**Key tips**:
- Enable "Stay awake while charging" in Developer Options
- Short USB cables (< 1m), thick gauge
- Always set `timeout` on subprocess calls
- `adb kill-server && adb start-server` as nuclear option

### 4. Retry Patterns

**Tenacity** is the standard. Key patterns:

**Exponential backoff with jitter**:
```python
@retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=60),
       retry=retry_if_exception_type((ConnectionError, TimeoutError)))
```

**Retryable vs permanent errors**:
- Retryable: timeout, disconnect, rate limit, 5xx
- Permanent: permission denied, invalid file, 4xx, storage full

**Circuit breaker**: After N consecutive failures, stop retrying for M seconds. Prevents hammering dead services.

**Failed queue**: Persist failed items to JSON, pick up next session. Max 3 attempts total, then permanent failure + Telegram alert.

---

## Testing Setup

The project uses:
- `pytest` (implied by test files in `forge/tests/`)
- Physical device tests via `--test` CLI modes
- FORGE v2 workflow for phone-bot testing (scrcpy record → Gemini analysis)
- No unit test framework for executor/delivery integration yet
