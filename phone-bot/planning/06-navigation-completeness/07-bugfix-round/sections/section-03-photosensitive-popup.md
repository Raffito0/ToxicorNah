<!--forge
forge:
  risk_level: medium
  autonomy_gate: continue
  solutions_md_checked: []
  solutions_md_match: []
  solution_selected:
    approach: "TBD -- filled by forge_planner analysis"
    score: 0
  test_protocol:
    type: "physical_device"
    pre_condition: "FYP must be visible on phone"
    commands:
      - "scrcpy --record tmp_forge_{section}.mkv"
      - "python phone-bot/main.py --test {mode} --phone 3"
    frame_extraction: "ffmpeg -y -i {mkv} -vf fps=0.5,scale=720:-2 {frames}/f_%03d.jpg"
    pass_threshold: "3"
    scenarios:
      - "FYP"
      - "Following"
      - "Explore"
      - "Shop"
    gemini_analysis: true
  regression_scope: []
  cross_section_deps: []
  attempt_count: 0
forge-->

# Section 03 — Photosensitive Warning Popup (HIGH)

## Overview

TikTok shows a full-screen "Photosensitive warning" overlay before videos with rapid flashing content. This overlay has a lightning bolt icon, seizure/flashing-lights warning text, and two buttons: "Watch video" (red, prominent) and "Skip all" (gray, secondary). The existing overlay handler in `handle_overlay()` already handles `"content_warning"` with a swipe-up action, but there is no branch for `photosensitive_warning`. When this overlay appears, the current handler either misclassifies it as `"unknown"` or as `"dismissible_safe"` (neither correct).

The correct action is to tap "Skip all".

**Dependencies**: none. This section is fully self-contained and parallelizable.

**Files modified**:
- `phone-bot/core/gemini.py` — extend `classify_overlay()` prompt and `valid_types` set
- `phone-bot/actions/tiktok.py` — add handler branch in `handle_overlay()` (inside `PopupGuardian`)

---

## Tests First

**Test mode**: `--test overlay-photosensitive` in `main.py`

**What to test**:
- Trigger the photosensitive overlay (browse videos with known flashing content, or use a saved screenshot replayed through the vision path)
- Frame-by-frame verify: overlay visible → "Skip all" tapped (NOT "Watch video") → overlay disappears → video plays
- Log verify: `"overlay: photosensitive_warning detected"` and `"tapping Skip all"` must appear
- Fail conditions: "Watch video" tapped, BACK pressed instead, overlay not dismissed

**Recording and extraction**:
```bash
scrcpy --no-window --record test_photosensitive.mkv --time-limit 60
ffmpeg -y -i test_photosensitive.mkv -vf "fps=0.5,scale=720:-2" frames/f_%03d.jpg
```

Inspect all frames sequentially. PASS requires both logs AND frames to confirm "Skip all" was tapped.

---

## Implementation

### Step 1 — Extend `classify_overlay()` in `core/gemini.py`

Locate `classify_overlay()`. It has a large prompt string listing all overlay types and a `valid_types` set.

**Change 1 — Prompt addition**: Add `"photosensitive_warning"` immediately after the `"content_warning"` entry:

```
- "photosensitive_warning": full-screen overlay with a lightning bolt icon and warning
  text about seizures, flashing lights, or photosensitive epilepsy. Has exactly two
  buttons: one red/prominent labeled "Watch video" and one gray/secondary labeled
  "Skip all" or "Skip". This is NOT "content_warning" (which has different button labels
  and no lightning bolt icon).
```

**Change 2 — Action mapping**: Add to the prompt's action section:

```
- photosensitive_warning -> "tap_skip_all" (find the gray "Skip all" button coords)
```

**Change 3 — Valid types set**: Add `"photosensitive_warning"` to the `valid_types` set so it is not silently replaced with `"unknown"`:

```python
valid_types = {"dismissible_safe", "captcha_simple", "captcha_puzzle",
               "captcha_rotate", "captcha_complex", "permission", "anr",
               "content_warning", "photosensitive_warning",   # <-- add here
               "account_warning", "login_expired", "unknown"}
```

No other changes to `classify_overlay()`. The function already returns `dismiss_coords` from the Gemini response — the model will populate this with the "Skip all" button position when it classifies the overlay as `photosensitive_warning`.

### Step 2 — Add handler branch in `handle_overlay()` in `actions/tiktok.py`

Locate `handle_overlay()` inside the `PopupGuardian` class. Add the new branch immediately after the `content_warning` block, before the captcha block.

**Detailed flow for the branch**:

1. Log `"PopupGuardian: photosensitive_warning — tapping Skip all"`
2. Check if `classification["dismiss_coords"]` is non-None and within screen bounds. If valid, tap directly.
3. If `dismiss_coords` is None: make a second Gemini bbox call to locate "Skip all":
   - Prompt: `"Find the bounding box of the gray or secondary button labeled 'Skip all' or 'Skip' in the bottom half of this overlay."`
   - Temperature: 0.1
   - Pattern: same bbox approach used for profile avatar tap and comment icon
4. Apply `_clamp_coords()` on the final tap coords before tapping (existing method in `PopupGuardian`)
5. Tap via `self.adb.tap(cx, cy)`
6. Wait `self.human.timing("t_popup_dismiss")` (existing timing param)
7. Verify overlay dismissed: take screenshot, check `find_sidebar_icons()` returns non-None (full video UI is visible = overlay gone)
8. On success: increment `self.stats["popups_dismissed"]`, return `{"resolved": True, "action_taken": "photosensitive_warning_skipped", "needs_attention": False}`
9. On failure: fall through to Tier 2/3 (existing code path)

**Key constraint**: Do NOT tap "Watch video" (red button) — always prefer "Skip all".

**Key constraint**: Do NOT use `humanize_swipe()` for this overlay — it requires an explicit button tap, not a swipe.

### Step 3 — Add `--test overlay-photosensitive` to `main.py`

Add a new test function following the pattern of existing test functions:

```python
def test_overlay_photosensitive(phone_id: int) -> None:
    """
    Test that photosensitive_warning overlay is handled by tapping 'Skip all'.
    Either triggers overlay live (browse FYP) or replays a saved screenshot.
    Verifies: overlay dismissed, 'Skip all' tapped, video plays after.
    """
```

The test can call `self.guardian.handle_overlay(saved_screenshot_bytes, bot_ref=bot)` directly with a saved overlay screenshot — more reliable than waiting for the overlay to appear naturally.

---

## Background Context

### How `classify_overlay()` works

Single Gemini Vision call (temperature=0.1, max_tokens=120, timeout=6s) returning JSON with: `type`, `subtype`, `dismiss_coords` ([x,y] or None), `action`, `description`. Returned type validated against `valid_types` — anything not in the set becomes `"unknown"`.

### How `handle_overlay()` works

Called from: `PopupGuardian._dismiss()` escalation path, main browse loop, story navigation path. Rate-limited to `config.POPUP_HANDLER_RATE_LIMIT` calls per 60 seconds. Three-tier: Tier 1 (auto-solve, new branch goes here) → Tier 2 (human alert) → Tier 3 (graceful degradation).

### Why "Skip all" not "Watch video"

"Skip all" skips the warning for this AND future videos in the session. "Watch video" would re-show the warning on the next flashing video. "Skip all" simulates a user who doesn't want to see flashing content.

---

## Verification Checklist

- [ ] `classify_overlay()` prompt includes `"photosensitive_warning"` with lightning bolt description
- [ ] `classify_overlay()` prompt includes `photosensitive_warning -> "tap_skip_all"` action mapping
- [ ] `valid_types` set includes `"photosensitive_warning"`
- [ ] `handle_overlay()` has new branch for `overlay_type == "photosensitive_warning"` between `content_warning` block and captcha block
- [ ] Branch uses `dismiss_coords` if valid, falls back to bbox call if None
- [ ] `_clamp_coords()` applied before any tap
- [ ] "Watch video" button is never tapped — only "Skip all"
- [ ] Swipe-up is NOT used (unlike `content_warning`)
- [ ] `wait_and_verify()` or equivalent confirms overlay dismissed before returning
- [ ] `self.stats["popups_dismissed"]` incremented on success
- [ ] Return dict uses `"action_taken": "photosensitive_warning_skipped"`
- [ ] `--test overlay-photosensitive` added to `main.py`
- [ ] scrcpy test: overlay visible → "Skip all" tapped → video plays → zero "Watch video" frames
- [ ] Log confirms: `"photosensitive_warning detected"` and `"tapping Skip all"`
