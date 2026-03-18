# 03 — Popup Arsenal & CAPTCHA Solving

## Priority: HIGH (depends on 01-session-infrastructure)

## Problem

TikTok displays 10+ types of popups, overlays, and dialogs during normal use. PopupGuardian handles some via Gemini classification, but many new types are unrecognized — causing the bot to get stuck or waste time with incorrect dismissal attempts. Additionally, TikTok CAPTCHAs (puzzle slide, rotate) appear during suspicious activity and currently cause session abort.

## Scope

8 gaps to close:

### Gap 1: Cookie Consent (EU) (HIGH)
**Current**: Not handled. EU GDPR requires cookie consent dialog on fresh sessions/installs. Appears as modal with "Accept All" / "Manage" buttons.
**Detection**: Dark overlay + bottom button band (cookie consent has distinctive layout: text block + 2 large buttons at bottom). PopupGuardian's `detect_dark_overlay()` + `detect_bottom_buttons()` should catch the pre-filter. Gemini classifies the specific type.
**Dismissal**: Tap "Accept All" button via Gemini bbox.
**Files**: `actions/tiktok.py` (PopupGuardian `_tier1_auto_dismiss`), `core/gemini.py` (classify prompt update)

### Gap 2: Content Warning Overlays (MEDIUM)
**Current**: Not handled. TikTok shows "This post is age protected" black overlay with "View anyway" button on mature content.
**Detection**: Full-screen dark overlay with centered text. Very different from normal video (all black/dark with white text).
**Dismissal**: Tap "View anyway" to proceed, OR swipe up to skip the video entirely. Bot should prefer swipe-up (skip) to avoid engaging with age-restricted content.
**Files**: `actions/tiktok.py`, `core/gemini.py`

### Gap 3: "Choose Your Interests" (HIGH)
**Current**: Not handled. Appears on new accounts during first sessions. Shows category tiles (pets, food, comedy, etc.) user can select.
**Detection**: Full-screen modal with grid of category tiles and "Next" / "Skip" button. Distinctive layout.
**Dismissal**: Two strategies:
- **Option A (recommended)**: Select 2-4 categories aligned with NICHE_DESCRIPTION, then tap "Next". Makes algorithm serve relevant content faster.
- **Option B**: Tap "Skip" if available.
**Implementation**: Gemini identifies visible categories → match against niche keywords → tap matching categories → tap "Next". Fallback: find and tap "Skip".
**Files**: `actions/tiktok.py` (new `_handle_interests_popup()`), `core/gemini.py`

### Gap 4: Account Verification Prompts (HIGH)
**Current**: `_detect_captcha()` exists but only catches CAPTCHA. TikTok also asks to verify phone number, add email, or verify identity with ID.
**Detection**: Modal with "Verify" / "Add phone number" / "Verify your identity" text.
**Handling**: Cannot auto-solve (requires actual phone number / email / ID). Send Telegram alert + screenshot + abort gracefully (close popup, continue scrolling if possible, or end session).
**Files**: `actions/tiktok.py`, `core/gemini.py`

### Gap 5: App Not Responding (ANR) Dialog (HIGH)
**Current**: Not handled. Android system dialog "TikTok isn't responding" with "Wait" / "Close app" buttons.
**Detection**: This is a SYSTEM dialog, not a TikTok overlay. The dialog has a distinctive look: gray background, app icon, 2 buttons.
**Handling**:
- If within first 60s of session: tap "Wait" (app still loading)
- If mid-session: tap "Close app" → reopen TikTok → resume
- Detection via Gemini (system dialogs have different styling than TikTok popups)
**Files**: `actions/tiktok.py` (PopupGuardian), `core/gemini.py`

### Gap 6: TikTok Update Popups (HIGH)
**Current**: Not handled. "What's New in TikTok" / "Update Available" modals after app updates.
**Detection**: Modal with feature list/screenshots and "Got it" / "Update" / "OK" button.
**Dismissal**: Tap "Got it" / "OK" / dismiss button. Never tap "Update" (would leave app).
**Files**: `actions/tiktok.py` (PopupGuardian), `core/gemini.py`

### Gap 7: Wind-Down Mode Prompts (MEDIUM)
**Current**: Not handled. After 10 PM, TikTok may show calming content prompts or usage reminders.
**Detection**: Overlay with sleep/moon icon, "Time to take a break?" text, "Dismiss" or "Set reminder" buttons.
**Dismissal**: Tap "Dismiss" / close button.
**Files**: `actions/tiktok.py` (PopupGuardian), `core/gemini.py`

### Gap 8: Basic CAPTCHA Auto-Solve (HIGH)
**Current**: CAPTCHAs detected → session aborts with Telegram alert.
**Fix**: Implement solving for 2 most common types:

#### Puzzle Slide CAPTCHA
- Appearance: image with a missing piece + draggable piece at bottom
- Solution: Gemini Vision identifies target position → `adb.swipe()` the puzzle piece horizontally to correct position
- Algorithm:
  1. Screenshot → Gemini: "Where should the puzzle piece go? Reply with x_percent (0-100) of the horizontal position"
  2. Calculate pixel X from percent
  3. Swipe slider from left to target X with human-like speed (not instant)
  4. Verify solved (take screenshot, check if CAPTCHA gone)
  5. Retry up to 2x if failed

#### Rotate CAPTCHA
- Appearance: circular image that needs rotation to correct orientation
- Solution: Gemini Vision identifies rotation angle → `adb.swipe()` the rotation slider
- Algorithm:
  1. Screenshot → Gemini: "How many degrees clockwise should this image be rotated? Reply with a number 0-360"
  2. Convert degrees to slider position (0°=left, 360°=right)
  3. Swipe slider to position
  4. Verify solved
  5. Retry up to 2x

**Fallback**: If auto-solve fails after 2 attempts → fall back to current behavior (abort + Telegram alert with screenshot for human solving).

**Files**: `actions/tiktok.py` (new `_solve_captcha_puzzle()`, `_solve_captcha_rotate()`), `core/gemini.py` (new prompts)

## PopupGuardian Enhancement

The existing `classify_overlay()` Gemini prompt needs expansion to recognize all new popup types:

```python
POPUP_CLASSIFICATION_PROMPT = """
Classify this overlay/popup. Reply with ONE word:
- permission: app permission request (camera, microphone, notifications, contacts)
- cookie: cookie consent / privacy dialog
- interests: "Choose your interests" category selection
- age_warning: content warning / age-protected overlay
- update: "What's New" / app update popup
- captcha_puzzle: slide puzzle CAPTCHA
- captcha_rotate: rotation CAPTCHA
- captcha_other: other CAPTCHA type
- verification: phone/email/identity verification
- anr: "App not responding" system dialog
- winddown: break/sleep reminder
- login: login/register prompt
- other: anything else
"""
```

Each type maps to a handler:
```python
POPUP_HANDLERS = {
    "permission": "_tier1_auto_dismiss",     # tap Allow/Deny
    "cookie": "_tier1_auto_dismiss",          # tap Accept All
    "interests": "_handle_interests_popup",   # select niche categories
    "age_warning": "_dismiss_age_warning",    # swipe up to skip
    "update": "_tier1_auto_dismiss",          # tap Got it/OK
    "captcha_puzzle": "_solve_captcha_puzzle",
    "captcha_rotate": "_solve_captcha_rotate",
    "captcha_other": "_tier2_human_intervention",
    "verification": "_handle_verification",   # alert + abort
    "anr": "_handle_anr",                     # Wait or Close
    "winddown": "_tier1_auto_dismiss",        # tap Dismiss
    "login": "_tier1_auto_dismiss",           # tap X/close
    "other": "_tier1_auto_dismiss",           # generic dismiss
}
```

## Config Additions

```python
# config.py
CAPTCHA = {
    "max_solve_attempts": 2,
    "solve_timeout_s": 15,
    "slider_speed_ms": (800, 1500),  # human-like slider drag duration
}

# Timing params
"t_captcha_screenshot": (0.5, 0.2, 0.3, 1.0),  # wait before CAPTCHA screenshot
"t_captcha_verify": (1.5, 0.3, 0.8, 3.0),       # wait after solve attempt
"t_popup_dismiss_verify": (1.0, 0.3, 0.5, 2.0),  # wait after popup dismiss
```

## Testing

1. **Cookie consent**: Inject cookie consent screenshot → verify classification + dismiss
2. **Content warning**: Encounter age-protected video → verify swipe-up skip
3. **Interests popup**: Fresh account first session → verify category selection or skip
4. **Verification prompt**: Inject verification screenshot → verify Telegram alert sent
5. **ANR dialog**: Force TikTok freeze → verify dialog handled
6. **Update popup**: Inject "What's New" screenshot → verify dismiss
7. **Puzzle CAPTCHA**: Inject puzzle CAPTCHA → verify slider drag to correct position
8. **Rotate CAPTCHA**: Inject rotation CAPTCHA → verify rotation to correct angle

## Acceptance Criteria

- [ ] Cookie consent detected and accepted automatically
- [ ] Content warnings handled (skip video)
- [ ] "Choose your interests" handled (select niche or skip)
- [ ] Verification prompts trigger Telegram alert without crash
- [ ] ANR dialog handled (Wait or Close + reopen)
- [ ] Update popups dismissed without clicking Update
- [ ] Puzzle slide CAPTCHA solved >60% of the time
- [ ] Rotate CAPTCHA solved >50% of the time
- [ ] Failed CAPTCHA falls back to abort + Telegram alert
- [ ] All popup types classified correctly by enhanced PopupGuardian
