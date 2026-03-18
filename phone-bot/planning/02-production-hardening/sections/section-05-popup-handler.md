# Section 05: Universal Popup/Overlay Handler

## Overview

Extends existing `PopupGuardian` in `tiktok.py` with: hybrid pixel-detect + Gemini-classify, three-tier action system (auto-solve / human intervention via Telegram / graceful degradation), and safety constraints for Gemini-driven taps.

**Dependencies:** Section 02 (Gemini timeout), Section 04 (session lifecycle), Section 08 (Telegram alerts -- degrade if not ready).
**Files modified:** `actions/tiktok.py`, `core/gemini.py`, `config.py`
**Files created:** `tests/test_popup_handler.py`

---

## Actual Implementation

### Pixel Detection (PopupGuardian methods in tiktok.py)

**`detect_dark_overlay(fp_current, fp_baseline)`**: Compares fingerprint brightness to baseline. Returns True if brightness dropped >40% AND stdev < 25 (uniform dark = overlay, not dark video). Uses pre-computed fingerprints from `page_state.screen_fingerprint()` (10x18 grid).

**Deviation from plan**: Uses fingerprints instead of raw pixel sampling. The fingerprint grid provides sufficient resolution for overlay detection and avoids re-reading screenshot bytes.

**`detect_bottom_buttons(fp_current)`**: Checks last 3 rows of fingerprint grid (bottom region). Returns True if avg brightness > 180.

**`detect_overlay_combined(fp_before, fp_after)`**: Combines dark overlay + bottom buttons (NOT stall detection). Returns True if either fires.

**Deviation from plan**: Removed stall from combined detector per code review. Stall is already handled by `check_stall()` which sends to Gemini directly — including it here would cause duplicate Gemini calls on every buffering video.

### Classification (gemini.py — `classify_overlay()`)

Added at line 753. Returns `{type, subtype, dismiss_coords, action, description}`. Types: dismissible_safe, captcha_simple, captcha_complex, permission, account_warning, login_expired, unknown. Temperature 0.1, timeout 6s, max_tokens 120. Validates coords within screen bounds and type against valid set.

### Three-Tier Action System (PopupGuardian methods)

**`handle_overlay(screenshot_bytes, bot_ref)`** — entry point. Rate-limited (max 3/60s). Classifies via `classify_overlay()`, then routes:

**Tier 1 (`_tier1_auto_dismiss`, `_tier1_auto_captcha`)**:
- dismissible_safe/permission → clamp coords → tap dismiss → verify FYP → fallback press_back
- captcha_simple tap_to_verify → tap button → verify
- captcha_simple drag_slider → swipe left→right at slider Y → verify

**Tier 2 (`_tier2_human_intervention`)**:
- Tries `from ..core import telegram_alerts` — gracefully skips to Tier 3 if not available (Section 08)
- Sends interactive alert with [SOLVED][SKIP][ABORT] buttons
- Polls callback every 10s, 5-min timeout
- Checks `adb._device_lost` each iteration (prevents 5-min zombie wait)

**Tier 3 (`_tier3_degrade`)**:
- CAPTCHA/warning/login → close_app + needs_attention=True
- unknown → press_back → nuclear_escape → needs_attention=True if all fail

### Safety Constraints

- `_clamp_coords()`: Clamps to [screen*0.05, screen*0.95] margin
- Rate limiting: `_overlay_timestamps` list, max 3 per 60s rolling window (initialized in `__init__`)
- FYP verification via `_verify_fyp_restored()` after every dismiss action

**Deviation from plan**: No quadrant validation for dismissible taps (Gemini coords + clamping is sufficient safety).

### Integration

- `_dismiss()` now returns bool (True=success, False=failed all 4 levels)
- `check_stall()`: if `_dismiss()` fails → escalates to `handle_overlay()` via `_bot_ref`
- `_check_health()`: runs pixel overlay detection → `handle_overlay()` if detected
- `_bot_ref`: back-reference from PopupGuardian to TikTokBot, set in TikTokBot.__init__

### Config (config.py)

Added 6 constants: `POPUP_DARK_OVERLAY_BRIGHTNESS_DROP=0.40`, `POPUP_DARK_OVERLAY_MAX_STDEV=25`, `POPUP_BOTTOM_BUTTON_BRIGHTNESS=180`, `POPUP_HANDLER_RATE_LIMIT=3`, `POPUP_TIER2_TIMEOUT_SEC=300`, `POPUP_COORD_MARGIN_PCT=0.05`.

Added timing: `"t_captcha_drag": (1.2, 0.3, 0.6, 2.5)` in HUMAN dict.

### Tests (tests/test_popup_handler.py) — 19 tests

- Detection: 6 tests (dark overlay brightness drop, false positive prevention, stdev validation, bottom buttons, stall fingerprint)
- Classification: 5 tests (promo, drag captcha, image puzzle, account warning, timeout fallback)
- Tier 1: 3 tests (auto-dismiss coords, tap-to-verify, escalation)
- Tier 3: 2 tests (captcha needs_attention, unknown tries back)
- Safety: 3 tests (coord clamping, rate limit, expected regions)

Tier 2 tests are lightweight stubs — telegram_alerts module (Section 08) is not built yet.
