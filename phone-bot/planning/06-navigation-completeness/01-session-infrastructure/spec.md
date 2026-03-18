# 01 — Session Infrastructure & Device Resilience

## Priority: CRITICAL (prerequisite for all other splits)

## Problem

Sessions can fail silently due to infrastructure gaps: screen turns off mid-session, phone volume is muted (detectable pattern), WiFi isn't toggled between sessions (IP correlation), feed doesn't refresh after reopen, and a static class variable bug causes multi-phone mode to fail. Additionally, TikTok enforces dynamic rate limits that the bot doesn't track, risking temporary blocks.

## Scope

7 gaps to close:

### Gap 1: Screen Stay-On (CRITICAL)
**Current**: No screen-off prevention. Phone screen turns off after system timeout (30s-2min default) during long video watches or zona morta pauses.
**Fix**: At session start, call `adb shell settings put system screen_off_timeout 1800000` (30 min). At session end, restore original value. Store original in instance variable.
**Files**: `planner/executor.py` (session setup/teardown), `core/adb.py` (new methods)
**Code**:
```python
# adb.py — new methods
def get_screen_timeout(self) -> int:
    """Get current screen-off timeout in ms."""
    result = self.shell("settings get system screen_off_timeout")
    return int(result.strip()) if result.strip().isdigit() else 30000

def set_screen_timeout(self, ms: int):
    """Set screen-off timeout."""
    self.shell(f"settings put system screen_off_timeout {ms}")

# executor.py — in execute_session() setup
original_timeout = adb.get_screen_timeout()
adb.set_screen_timeout(1800000)  # 30 min
try:
    # ... session ...
finally:
    adb.set_screen_timeout(original_timeout)
```

### Gap 2: Volume at Realistic Level (HIGH)
**Current**: Volume not set. Muted phones or max-volume phones are patterns.
**Fix**: At session start, set media volume to ~40-70% (randomized per session). Use `adb shell cmd media_session volume --set N` or `adb shell media volume --stream 3 --set N`.
**Files**: `core/adb.py` (new method), `planner/executor.py` (session setup)
**Code**:
```python
# adb.py
def set_media_volume(self, level: int):
    """Set media volume (0-15 typical range)."""
    self.shell(f"media volume --stream 3 --set {level}")

def get_max_volume(self) -> int:
    """Get max media volume."""
    result = self.shell("media volume --stream 3 --get")
    # Parse "Volume is X out of Y" → return Y
    ...
```

### Gap 3: Feed Refresh After Reopen (HIGH)
**Current**: After WiFi toggle or app reopen, TikTok may show loading spinner or "Refresh" button. Bot tries to interact with non-loaded content.
**Fix**: After `open_app()`, take fingerprint, wait 2s, take another fingerprint. If diff < 10 (screen frozen), wait and retry up to 10s. Check for "Refresh" text via Gemini if still frozen.
**Files**: `actions/tiktok.py` (`_verify_fyp_responsive()` — already exists, enhance it)
**Enhancement**: Add Gemini check for "Refresh" / "No Internet" / loading spinner to existing `_verify_fyp_responsive()`. Already has fingerprint comparison + CAPTCHA check. Add:
```python
# In _verify_fyp_responsive(), after fingerprint check fails:
result = gemini.classify_screen_with_reference(shot, "What do you see? Reply: fyp, loading, refresh_button, no_internet, error, other")
if result in ("refresh_button", "no_internet"):
    self.adb.tap(*self.adb.get_coord("tiktok", "screen_center"))  # tap to refresh
    time.sleep(self.human.timing("t_feed_refresh"))
```

### Gap 4: `_device_lost` Static Variable Bug (CRITICAL)
**Current**: `_device_lost` is a static class variable in `ADBController`. When one phone disconnects, ALL ADBController instances see `_device_lost = True`.
**Fix**: Move to instance variable in `__init__`.
**Files**: `core/adb.py`
**Code change**: Find the class-level declaration and move it to `__init__`:
```python
# BEFORE (broken):
class ADBController:
    _device_lost = False  # CLASS variable — shared across all instances!

# AFTER (fixed):
class ADBController:
    def __init__(self, serial, ...):
        self._device_lost = False  # INSTANCE variable — per-device
```

### Gap 5: Rate Limit Tracking (HIGH)
**Current**: No tracking of follow/like counts. Bot can exceed TikTok's limits and trigger 24-hour blocks.
**Fix**: Add `RateLimiter` class that tracks per-session and per-day counts. Conservative caps: 150 follows/day (TikTok limit ~200), 400 likes/day (TikTok limit ~500), 25 follows/hour.
**Files**: `config.py` (caps), `core/human.py` or new `core/rate_limiter.py`, `actions/tiktok.py` (gate checks)
**Design**:
```python
class SessionRateLimiter:
    def __init__(self, account_name: str):
        self.follows_today = self._load_today_count(account_name, "follows")
        self.likes_today = self._load_today_count(account_name, "likes")
        self.follows_this_hour = 0
        self.follows_hour_start = time.time()

    def can_follow(self) -> bool:
        if self.follows_today >= config.RATE_LIMITS["max_follows_day"]:
            return False
        if self._follows_this_hour() >= config.RATE_LIMITS["max_follows_hour"]:
            return False
        return True

    def on_follow(self):
        self.follows_today += 1
        self.follows_this_hour += 1
        self._persist()
```
**Persistence**: JSON file per account in `data/rate_limits/{account_name}_{date}.json`. Reset daily.

### Gap 6: WiFi Toggle Wiring (MEDIUM)
**Current**: `adb.wifi_off()` and `adb.wifi_on()` exist but executor never calls them. WiFi stays on between sessions, allowing background tracking.
**Fix**: In executor, call `wifi_off()` between sessions (after close_app) and `wifi_on()` before next session. Add `check_wifi()` after `wifi_on()` with retry.
**Files**: `planner/executor.py`
**Note**: SIM cards are disabled on all phones. WiFi off = total network isolation. This is already the intended behavior per CLAUDE.md but not wired.

### Gap 7: Production Hardening Verification (CRITICAL)
**Current**: Plan 02 (production hardening) items may or may not be implemented. Need verification.
**Audit findings**:
- PopupGuardian: EXISTS (lines 42-706 in tiktok.py) — 4-level dismissal, 3-tier overlay ✅
- Gemini circuit breaker: EXISTS (gemini.py line 39) — 3 timeouts in 5min → 2min cooldown ✅
- Session hard timeout: EXISTS (executor.py) — duration * 1.5 + 5min grace ✅
- Device lost tracking: EXISTS (executor.py) — dead_phones set ✅
- ADB subprocess cleanup: EXISTS (adb.py) — timeout handling + server restart ✅
- Telegram alerts: EXISTS (executor.py) — init_alerts() called ✅
**Status**: All Plan 02 items are implemented. No additional work needed here.

## Config Additions

```python
# config.py additions
RATE_LIMITS = {
    "max_follows_day": 150,     # TikTok limit ~200, conservative
    "max_follows_hour": 25,      # ~15-30 safe range
    "max_likes_day": 400,        # TikTok limit ~500, conservative
    "max_comments_day": 50,      # Conservative
}

# New timing params in HUMAN dict
"t_feed_refresh": (3.0, 0.4, 1.5, 8.0),   # wait for feed to load after refresh
"t_screen_setup": (0.5, 0.2, 0.2, 1.5),    # wait after screen settings change
```

## Testing

1. **Screen stay-on**: Start session, verify `settings get system screen_off_timeout` = 1800000, end session, verify restored to original
2. **Volume**: Start session, verify `media volume --stream 3` output shows set level
3. **Feed refresh**: Kill TikTok → reopen → verify `_verify_fyp_responsive()` handles loading state
4. **`_device_lost`**: With 2 phones, disconnect phone 1 → verify phone 2 still works
5. **Rate limits**: Run session, verify follow/like counts tracked in JSON, verify cap enforcement
6. **WiFi toggle**: Verify WiFi off after session end, on before next session, check_wifi passes

## Acceptance Criteria

- [ ] Screen never turns off during a 30-min session
- [ ] Volume set to random 40-70% range at session start
- [ ] Feed loads correctly after app reopen (no stale content interaction)
- [ ] Multi-phone mode works correctly after _device_lost fix
- [ ] Rate limits tracked per account per day, caps enforced
- [ ] WiFi toggles between sessions (off after close, on before open)
- [ ] All Plan 02 production hardening items verified present
