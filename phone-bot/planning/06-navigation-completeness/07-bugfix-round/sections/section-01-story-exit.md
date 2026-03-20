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

# Section 1 — Story Exit (CRITICAL)

## Problem Summary

`visit_creator_profile()` can get stuck in a TikTok Story view when a creator has an active Story (blue ring on their avatar). Tapping the avatar opens the Story instead of the profile. After two failed profile verifications the bot may remain inside the Story view. From that stuck state, any subsequent text input action (comment, search query) types into the Story reply bar at the bottom of the screen — sending an unintended DM to a stranger.

This is **CRITICAL** priority. Fix it before any other section.

---

## Tests First

Two test modes must be added to `main.py` before implementing:

### Test mode: `--test story-exit`

Requires a phone with TikTok open on the FYP containing a creator with an active Story (blue ring visible on their sidebar avatar).

1. Initialize `TikTokBot` with the test phone's `phone_id`
2. Call `init_monitor()` with temp directories (see Section 14)
3. Call `visit_creator_profile()` once
4. Capture result (True/False)
5. Log full outcome

**Frame verification** (scrcpy record the entire test):
```
ffmpeg -y -i test.mkv -vf "fps=0.5,scale=720:-2" frames/f_%03d.jpg
```
- Verify Story opens in an early frame (blue Story UI, progress bar at top)
- Verify NO frame shows a keyboard or text input field activated
- Verify NO frame shows text being typed
- Verify a later frame shows FYP restored (full-screen video with sidebar icons)
- `visit_creator_profile()` must return `False`

**Log verification** (both must appear):
- `"Story confirmed"` or `"Story detected"`
- Either `"Story header tap attempt"` or `"Story exit, skip profile"`

**Fail condition**: ANY frame showing a keyboard OR `"Message [creator]..."` reply bar with text in it → test FAILS regardless of the return value.

### Test mode: `--test story-coord-audit`

Static audit, no phone required. Iterates over all `get_coord("tiktok", "story_*")` entries in `coords.py` and checks their y-values against all three target phone screen heights.

For each story coord:
- Compute `y_pct = y / screen_h` for each phone (Samsung S9 h=2220, Samsung S22 h=2340, Motorola h=1600)
- Log each entry: `story_avatar: y=0.08 (S9=178px, S22=187px, Moto=128px) → PASS`
- Any coord with `y_pct > 0.80` on any phone → `FAIL: <coord_name> y=<value>% exceeds 0.80 limit`

No phone or ADB connection needed for this test.

---

## What to Modify

**Primary file**: `phone-bot/actions/tiktok.py`

**Secondary file** (only if coord audit reveals a coord above 80%): `phone-bot/core/coords.py`

---

## Background: Current Code Behavior

The current `visit_creator_profile()` already has partial Story handling:

1. Taps avatar (via pixel sidebar scan or Gemini bbox fallback)
2. Calls `wait_and_verify()` with `is_profile_page()` — up to 2 attempts, 12s timeout
3. If verify fails AND fingerprint diff > 18 (screen changed): calls `classify_screen_with_reference()`
4. If classification is `"story"`: taps `story_avatar` coord with ±5px jitter, waits for profile verify again
5. If story header tap also fails: falls through to `press_back()` + `_return_to_fyp()` recovery
6. Retries the entire attempt loop once (outer `for attempt in range(2)`)

**The bug**: When the Story header tap fails profile verification (step 4), the current code calls `press_back()` followed by `_return_to_fyp()` — but the outer loop `for attempt in range(2)` means after recovering to FYP the bot retries the entire avatar tap, potentially entering a second Story interaction. The no-tap-below-80% invariant is not explicitly enforced.

---

## Fix Design

### Layer 1 — Story-aware profile verification

After each failed `wait_and_verify()` call in `visit_creator_profile()`, classify the current screen for Story even when fingerprint diff is low. A Story has a similar brightness profile to a FYP video — fingerprint comparison may report "no change" while the Story is open. Take a fresh screenshot and call `classify_screen_with_reference()` specifically when `wait_and_verify()` fails, regardless of fingerprint diff.

### Layer 2 — One controlled Story exit attempt

When Story is confirmed:
1. Log: `"visit_creator_profile: Story detected, attempting header tap"`
2. Get `story_avatar` coord: `sx, sy = self.adb.get_coord("tiktok", "story_avatar")`
3. Apply ±5px jitter (NOT standard jitter — story avatar is ~30px diameter)
4. **Invariant guard**: assert `sy < 0.80 * self.adb.screen_h` before tapping — log CRITICAL and skip if violated
5. Tap
6. Call `wait_and_verify()` with `is_profile_page()`, `first_wait="t_profile_from_story"`, `max_attempts=2`
7. If success → return `True`

### Layer 3 — Safe exit when header tap fails

If Layer 2 also fails to reach a profile:
1. Call `self._exit_story_safely()`
2. Return `False` immediately — do NOT retry (no `continue` back to the outer loop)

The outer retry loop (`for attempt in range(2)`) should NOT re-attempt after a confirmed Story situation.

### `_exit_story_safely()` implementation

New private method in `TikTokBot`. Specifically scoped to the failure path inside `visit_creator_profile()`. Does NOT replace the `_return_to_fyp()` Story handling.

```python
def _exit_story_safely(self) -> None:
    """
    Exit Story view after failed Story header navigation.
    Presses BACK and verifies FYP is restored.
    Called ONLY from visit_creator_profile() when Story navigation fails.
    Does NOT replace Story handling in _return_to_fyp().
    INVARIANT: Does not tap any position while in Story view — uses keyevent only.
    """
```

Implementation steps:
1. Log: `"_exit_story_safely: pressing BACK to exit Story"`
2. `self.adb.press_back()`
3. Call `wait_and_verify()` with `_quick_verify_fyp_from_shot`, `first_wait="t_back_verify"`, `max_attempts=2`
4. If verified: log `"_exit_story_safely: FYP restored"`, return
5. If not verified: log warning `"_exit_story_safely: FYP not confirmed after BACK, escalating"`, call `self._return_to_fyp()`

Key constraint: `_exit_story_safely()` uses BACK keyevent only. It does NOT call `story_close` tap and does NOT tap anything in the Story UI.

---

## Coord Audit — Story Coordinates

Current story coords in `phone-bot/core/coords.py` (TikTok section):
- `story_avatar`: `lambda w, h: (int(w * 0.065), int(h * 0.08))` → y = 8% — PASSES on all phones
- `story_tap_next`: `lambda w, h: (int(w * 0.833), int(h * 0.50))` → y = 50% — PASSES
- `story_tap_prev`: `lambda w, h: (int(w * 0.167), int(h * 0.50))` → y = 50% — PASSES
- `story_close`: `lambda w, h: (int(w * 0.917), int(h * 0.081))` → y = 8.1% — PASSES

All four coords are already below 80%. The coord audit test confirms this at runtime. The invariant guard in Layer 2 is a defensive runtime check for future regression.

---

## Function Signatures

```python
def visit_creator_profile(self) -> bool:
    """
    Navigate to the current video creator's profile.
    Returns True if profile opened successfully, False otherwise.

    Story handling (3-layer fix):
    - Layer 1: After profile verify fails, classify screen for Story even if fingerprint unchanged
    - Layer 2: If Story confirmed, tap story_avatar header once (±5px jitter, y < 80% guard)
    - Layer 3: If header tap also fails, call _exit_story_safely(), return False immediately

    INVARIANT: Never tap y > 0.80 * screen_h while in Story view.
    """

def _exit_story_safely(self) -> None:
    """
    Exit Story view by pressing BACK, verify FYP restored.
    Called ONLY from visit_creator_profile() when Story navigation fails.
    Uses BACK keyevent only — no tap actions while in Story view.
    Does NOT replace the Story handling in _return_to_fyp() (which uses story_close X tap).
    Escalates to _return_to_fyp() if BACK alone doesn't restore FYP.
    """
```

---

## Implementation Checklist

1. Run `--test story-coord-audit` first (static, no phone needed) — confirm all `story_*` coords are y < 80%
2. Add `_exit_story_safely()` method to `TikTokBot` in `actions/tiktok.py`
3. Modify `visit_creator_profile()`:
   - After each failed `wait_and_verify()`, classify screen for Story regardless of fingerprint diff
   - When Story confirmed: enforce `sy < 0.80 * screen_h` guard before tapping
   - When story header tap fails: call `_exit_story_safely()`, `return False` — no outer-loop retry
4. Add `--test story-exit` mode to `main.py`
5. Record with scrcpy, run test on creator with active Story, extract frames at `fps=0.5,scale=720:-2`
6. Verify ALL frames and logs: no keyboard, no text typed, FYP restored
7. Section complete only when both logs AND frames confirm correct behavior

## Implementation Notes

**Files modified**: `phone-bot/actions/tiktok.py`, `phone-bot/main.py`

**Deviations from plan**:
- `--test story-coord-audit` dispatch placed BEFORE `discover_devices()` (was not specified in plan but required for no-phone static test)
- Verbose logging flag extended to cover `args.test` (all modes)
- `_exit_story_safely()` placed immediately before `visit_creator_profile()` (natural co-location)

**Tests**: Manual — requires phone with active Story creator on FYP. Use `--test story-coord-audit` for static coord check (no phone needed).

---

## Dependencies

- Section 13 (Unintentional Follow During Story) is fully resolved by this section — no separate code changes needed for Section 13.
- All other sections are independent of this section.
