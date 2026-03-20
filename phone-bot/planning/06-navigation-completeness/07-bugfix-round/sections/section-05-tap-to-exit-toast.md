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

# Section 05 — Tap-to-Exit Toast Fix

## Overview

**Problem (P5, HIGH priority):** `_return_to_fyp()` unconditionally presses BACK as its first action, even when the bot is already watching a video on the FYP. When on the FYP, pressing BACK triggers Android's "Tap again to exit" toast notification for 1.5–2 seconds. The `wait_and_verify()` fingerprint comparison runs during this window and fails (the toast alters screen pixels), causing unnecessary escalation to Tier 2 navigation. This is also suspicious behavior — a real user does not double-tap BACK while watching a FYP video.

**Fix summary:** Add a pre-check at the very top of `_return_to_fyp()` that calls `_quick_verify_fyp_from_shot()` on a fresh screenshot. If already on FYP, skip the BACK press entirely and return immediately.

**Dependencies**: none. This section is self-contained.

**Primary file:** `phone-bot/actions/tiktok.py`

---

## Tests (Write and Verify BEFORE Merging)

### Test mode: `--test return-to-fyp-on-fyp`

Add this test mode to `phone-bot/main.py`.

1. Initialize `TikTokBot` with the target phone id
2. Ensure the bot is on FYP (call `go_to_fyp()` and confirm via `_quick_verify_fyp()`)
3. Wait 3–5 seconds to simulate "watching a video"
4. Call `_return_to_fyp()` directly
5. Check logs and frames for the expected outcome

**Frame verification** (ALL frames must pass):
- No "Tap again to exit" toast appears in any frame at any point
- No BACK gesture/animation visible in any frame
- FYP remains stable throughout — no screen transition occurs

**Log verification:**
- Must contain: `"_return_to_fyp: already on FYP (quick verify), no BACK needed"`
- Must NOT contain any `return_to_fyp_back` action log entries

**Fail conditions:**
- Toast visible in any frame
- Log shows bot pressed BACK when already on FYP
- Tier 2 or Tier 3 escalation triggered from FYP

### Regression check

After implementing the fix, also run any existing smoke test that exercises `_return_to_fyp()` from a non-FYP screen (profile page, search page, comment drawer). Confirm that the BACK logic still fires correctly when NOT on FYP — the pre-check must be a no-op in that case.

---

## Implementation

### File to modify

`phone-bot/actions/tiktok.py` — method `_return_to_fyp()`.

### Current behavior (what exists today)

```python
def _return_to_fyp(self):
    """Reliably return to FYP from anywhere. 3-tier escalation:
    Tier 1: press_back + Story X button (free, fast)
    Tier 2: nav_home tap (works when nav bar visible)
    Tier 3: nuclear_escape (guaranteed, any state)"""
    # Tier 1: press_back (up to 2 attempts) with retry verification
    for attempt in range(2):
        self.adb.press_back()
        # ... verify, escalate ...
```

### Required change

At the very top of `_return_to_fyp()`, BEFORE the Tier 1 loop, insert:

```python
def _return_to_fyp(self):
    """..."""
    # Pre-check: if already on FYP, do nothing (avoids "Tap again to exit" toast)
    shot = self.adb.screenshot_bytes()
    if shot and self._quick_verify_fyp_from_shot(shot):
        log.debug("_return_to_fyp: already on FYP (quick verify), no BACK needed")
        return True

    # Tier 1: press_back (up to 2 attempts) with retry verification
    for attempt in range(2):
        ...  # existing code unchanged
```

The rest of the method (Tier 1, Tier 2, Tier 3) is completely unchanged.

### Why `_quick_verify_fyp_from_shot()` is the correct check

`_quick_verify_fyp_from_shot()` already exists in `tiktok.py`. It calls `page_state.detect_page()` and returns `True` only if `page == "fyp"`. This is FYP-specific — it correctly distinguishes the FYP from the Following tab video feed (which also shows full-screen videos with a sidebar but is NOT the FYP).

Using a raw `find_sidebar_icons()` check would return non-None on the Following tab feed and incorrectly conclude "already on FYP."

Properties of the check:
- Zero API cost: pixel-based via `page_state.detect_page()`
- Fast: under 50ms
- Universal: uses proportional logic, works on all target phones
- FYP-specific: correctly excludes Following tab

### Screenshot cost

This adds one `adb.screenshot_bytes()` call at the top of every `_return_to_fyp()` invocation. Acceptable — `_return_to_fyp()` is a recovery function, not a tight loop. The screenshot is cheap compared to the BACK press + `wait_and_verify()` it avoids.

If the screenshot call fails (returns None or falsy), the pre-check is skipped and the method proceeds with BACK as before — safe default.

---

## Checklist

- [ ] Add pre-check block at the top of `_return_to_fyp()` in `actions/tiktok.py`
- [ ] Log message uses `log.debug` (not `log.info`) — fires every browse cycle, must not flood logs
- [ ] `shot` falsy guard in place: if screenshot fails, skip pre-check and proceed with BACK
- [ ] Add `--test return-to-fyp-on-fyp` test mode in `main.py`
- [ ] Record scrcpy session during test, extract frames at `fps=0.5,scale=720:-2`
- [ ] Verify ALL frames: no toast, no BACK, FYP stable
- [ ] Verify regression: `_return_to_fyp()` still navigates correctly from profile / search / comment drawer
- [ ] Tier 1 / Tier 2 / Tier 3 logic below the pre-check completely unchanged
