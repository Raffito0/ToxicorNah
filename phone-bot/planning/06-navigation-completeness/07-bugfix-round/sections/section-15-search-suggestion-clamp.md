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

# Section 15 — Search Suggestion Bar Clamp (LOW)

## Background

After the bot visits a creator profile and returns to FYP, TikTok sometimes injects a "Search · [username]" suggestion bar at approximately y=92-95% of screen height. FYP scroll gestures already use a y-range of roughly [0.25, 0.75], which does not reach y=92% under normal parameters. However, there is currently no explicit hard ceiling on the swipe end Y coordinate — a future parameter change or edge-case state mutation could push end_y into the suggestion bar zone without any guardrail.

This section adds a one-line defensive clamp in `scroll_fyp()` so the constraint is documented in code and cannot be violated by future parameter drift.

## Priority

LOW. Defensive fix — no confirmed incident on Samsung S9. Part of Batch 3.

## Files to Modify

- `phone-bot/actions/tiktok.py` — `scroll_fyp()` method

No other files require changes.

## Dependencies

None. Standalone one-line addition.

---

## Test First

**Test mode**: `--test fyp-swipe-clamp`

Add to `main.py` before implementing the clamp.

**Test procedure:**
1. Initialize `TikTokBot` with phone_id and call `init_monitor()` (per Section 14)
2. Navigate to FYP
3. Visit a creator profile (to trigger the suggestion bar appearing on return)
4. Press BACK to return to FYP
5. Run 30 FYP scroll cycles via `scroll_fyp()` in rapid succession
6. After each swipe, log the computed `sw["y2"]` value

**Frame verification** (scrcpy recording):
```bash
scrcpy --no-window --record test_clamp.mkv --time-limit 120
ffmpeg -y -i test_clamp.mkv -vf "fps=0.5,scale=720:-2" test_clamp_frames/f_%03d.jpg
```
- NO frame shows the suggestion bar highlighted, pressed, or expanded into a search view
- Scroll end positions all remain visually above the bottom navigation area

**Log verification:**
- All logged `sw["y2"]` values must be `< screen_h * 0.88`
- If any `sw["y2"] >= screen_h * 0.88` before the fix → clamp is necessary

**Pass condition:** 30 scroll cycles complete with zero suggestion bar interactions and all end-Y values below 88% of screen_h.

Low-priority: pass if no incidents occur in 30 scroll cycles. This is a defensive fix, not a response to an observed critical incident.

---

## Implementation

**Location**: `actions/tiktok.py`, inside `scroll_fyp()`.

**What to change**: After `humanize_swipe()` returns the `sw` dict, clamp `sw["y2"]` before passing it to `self.adb.swipe()`.

```python
def scroll_fyp(self):
    """
    Scroll to the next video on FYP (swipe up).
    end_y is clamped to screen_h * 0.88 to avoid the 'Search · username'
    suggestion bar injected at y=92-95% after profile visits.
    This clamp is FYP-specific: humanize_swipe() is NOT modified.
    """
    sw = self.human.humanize_swipe(
        self.adb.screen_w // 2, self.adb.screen_h * 3 // 4,
        self.adb.screen_w // 2, self.adb.screen_h // 4,
    )
    # Clamp end_y: FYP-specific guard against suggestion bar at y=92-95%
    end_y_max = int(self.adb.screen_h * 0.88)
    sw["y2"] = min(sw["y2"], end_y_max)
    if sw.get("hand_switched"):
        time.sleep(sw["hand_switch_pause"])
    self.adb.swipe(sw["x1"], sw["y1"], sw["x2"], sw["y2"], sw["duration"])
```

**Optional debug log** (recommended for test verification):
```python
if sw["y2"] < original_y2:
    log.debug("scroll_fyp: end_y clamped %d -> %d", original_y2, sw["y2"])
```

**Critical scope constraint**: The clamp is applied ONLY inside `scroll_fyp()`, AFTER `humanize_swipe()` returns. Do NOT:
- Add any clamp to `humanize_swipe()` itself (in `core/human.py`)
- Add any clamp to `self.adb.swipe()` (in `core/adb.py`)
- Apply this clamp to grid scrolls, comment scrolls, or story navigation — those functions have different legitimate y-range needs

**Why 88%**: On Samsung S9 at 2220px: `0.88 × 2220 = 1954px` — 91px above the suggestion bar at ~y=2045+. On Samsung S22 at 2340px: `0.88 × 2340 = 2059px`. The value is proportional and works universally on all target phones.

---

## Verification After Implementation

Run `--test fyp-swipe-clamp` again after the fix:
1. All logged `sw["y2"]` values are `<= screen_h * 0.88`
2. No frames show the suggestion bar activated
3. Normal scroll behavior visually unchanged (swipes look identical to pre-fix)
