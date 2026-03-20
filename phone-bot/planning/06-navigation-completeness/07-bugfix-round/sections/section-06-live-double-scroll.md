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

# Section 06 — LIVE Double-Scroll (Frequent LIVE Entry from FYP)

## Priority

HIGH — Batch 1 (implement with sections 01, 02, 03, 05).

## Dependencies

- **Section 02** (PYMK Carousel) has a cross-reference dependency: both sections modify the same post-swipe block in `browse_session()`. When `sidebar=None`, the decision order is: (1) pixel LIVE ring detector → double-scroll; (2) `_is_pymk_post()` → double-scroll; (3) existing fallback. Coordinate the merge.
- No other sections required before this one.

## Files to Modify

- `phone-bot/actions/tiktok.py` — `browse_session()` method (primary change)
- `phone-bot/config.py` — `HUMAN` dict (two new timing params)

---

## Problem Description

New TikTok accounts have high density of LIVE preview cards in the FYP. When the bot executes `scroll_fyp()` to advance, if the incoming item is a LIVE preview card, the swipe transition enters the LIVE stream. The existing code only calls `find_sidebar_icons()` before engagement actions — not after every scroll. By the time LIVE is detected in the engagement pre-check, the bot has been "in" the LIVE for the full `watch_duration` (5–15 seconds).

The existing `_exit_live()` function handles escape from inside a full LIVE stream. This fix is different — it prevents entering LIVE by detecting the LIVE preview card immediately after the swipe, before `watch_duration` begins.

---

## Fix Design

### Immediate sidebar check after every swipe

In `browse_session()`, the `scroll_fyp` action branch calls `self.scroll_fyp()` then continues the loop. Insert a post-swipe check before `watch_duration` begins:

1. After `self.scroll_fyp()` returns, wait `human.timing("t_swipe_settle")` for screen to settle
2. Take a screenshot
3. Call `self._get_sidebar_positions(screenshot)` (wraps `find_sidebar_icons()`)
4. If result is `None` (LIVE preview or non-standard post):
   - a. Run pixel LIVE ring detector
   - b. If LIVE confirmed → log `"LIVE preview detected, double-scrolling"` → wait `human.timing("t_live_skip_pause")` → call `self.scroll_fyp()` again
   - c. If not LIVE → delegate to Section 02's `_is_pymk_post()`, if PYMK → also double-scroll
   - d. After double-scroll, `continue` to next loop iteration — do NOT start `watch_duration`
5. If sidebar is non-None (normal video) → proceed to `watch_duration` as usual

`watch_duration` only starts after `find_sidebar_icons()` confirms a normal video.

### Distinction from existing LIVE handling

- `_exit_live()` = escape once already INSIDE a LIVE stream
- This fix = prevent entry by detecting LIVE preview BEFORE any watch time
- The existing pre-engagement `_sidebar is None` block (for like/comment/follow) is NOT changed — it remains as a secondary guard

---

## Config Changes

Add two entries to the `HUMAN` dict in `phone-bot/config.py`:

```python
"t_swipe_settle": (0.2, 0.3, 0.1, 0.5),    # settle wait after swipe before sidebar scan
"t_live_skip_pause": (0.4, 0.2, 0.2, 0.8),  # pause before double-scroll past LIVE/PYMK
```

`t_swipe_settle`: replaces any fixed `time.sleep(0.2)` after swipe. Log-normal with sigma=0.3 — most waits are 0.15–0.35s, occasional longer up to 0.5s. Fixed 0.2s would be a timing fingerprint.

`t_live_skip_pause`: median 0.4s, range 0.2–0.8s. Mimics the human pause before swiping past unwanted content. Shared with Section 02.

---

## Implementation Location in `browse_session()`

The change targets the `scroll_fyp` action branch. The post-swipe LIVE check should come immediately after `self.scroll_fyp()` returns and before any watch logic:

```python
def _post_swipe_live_check(self) -> bool:
    """
    Called immediately after scroll_fyp() in browse_session().
    Takes screenshot after t_swipe_settle, checks find_sidebar_icons().
    If None: runs pixel LIVE ring detector, then PYMK check (S02).
    If LIVE or PYMK confirmed: waits t_live_skip_pause, calls scroll_fyp() again.
    Returns True if double-scroll was performed (caller should skip watch_duration).
    Returns False if normal video confirmed (caller proceeds normally).
    """
```

Calling this as a helper keeps `browse_session()` readable. The helper is synchronous (no async needed — timing calls use `time.sleep`, consistent with `scroll_fyp()` itself).

---

## Tests

### Test Mode: `--test live-double-scroll`

Add to `main.py`. Live device test — no simulation.

**Setup**: Browse FYP for 5 minutes on account with many LIVE previews (new account has high LIVE density).

**Frame-by-frame verification**:
- When LIVE preview card appears after swipe → second swipe occurs within 0.5–1.0 seconds
- No full LIVE stream UI appears at any frame (no chat overlay, no heart rain, no full-screen "LIVE" badge)
- Next regular video loads correctly after double-scroll

**Log verification**:
- `"LIVE preview detected, double-scrolling"` appears
- Timing between two swipes: 0.2–0.8s (t_live_skip_pause range)
- Total LIVE entry count in 5 minutes drops from 4+ to 0–1

**Fail condition**: Any frame shows full LIVE stream UI → double-scroll not firing correctly.

**scrcpy recording**:
```bash
scrcpy --no-window --record live_double_scroll_test.mkv --time-limit 300
ffmpeg -y -i live_double_scroll_test.mkv -vf "fps=0.5,scale=720:-2" frames/f_%03d.jpg
```

Review ALL frames sequentially, correlating with log output. Look for LIVE card frame followed immediately by scroll-away frame, with no full-LIVE-stream frame in between.

### Standalone screenshot test

Save a screenshot of a LIVE preview card from a previous recording frame. Pass directly to `_get_sidebar_positions()`. It must return `None`. Confirms the sidebar scanner correctly identifies LIVE preview as non-standard.

---

## Universality Check

- `t_swipe_settle` and `t_live_skip_pause` are time values — device-independent
- `find_sidebar_icons()` uses proportional spacing (confirmed universal for Motorola 720x1600, Samsung S9 1080x2220, Samsung S22 1080x2340)
- The pixel LIVE ring detector uses proportional row scanning — no hardcoded pixel offsets
- `scroll_fyp()` uses proportional start/end coordinates (`screen_h * 3 // 4` and `screen_h // 4`)

No hardcoded pixel values are introduced by this section.

---

## Summary of Changes

| File | Change |
|------|--------|
| `config.py` | Add `t_swipe_settle` and `t_live_skip_pause` to `HUMAN` dict |
| `actions/tiktok.py` | Add `_post_swipe_live_check()` helper method |
| `actions/tiktok.py` | In `browse_session()` `scroll_fyp` branch: call `_post_swipe_live_check()` after `self.scroll_fyp()`, skip `watch_duration` if it returns True |
| `main.py` | Add `--test live-double-scroll` test function |
