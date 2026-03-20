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

# Section 08 — Grid Scroll Fix (Grid Scroll Opens Fullscreen Player)

## Priority and Batch

MEDIUM priority. Part of Batch 2. No dependencies on other sections.

## Problem Summary

`_maybe_scroll_grid()` in `phone-bot/actions/tiktok.py` calls `_human_browse_scroll(context="grid")`. The grid context has `max_dist = 0.55` (55% of screen height) — inherited from FYP-style full-screen video scrolling.

Search result grids have small thumbnails — roughly 100–150 px tall in the 2-column layout. A swipe distance of 50%+ of screen height on a 100px thumbnail is interpreted by TikTok as a "tap-to-open" gesture rather than a scroll gesture. This opens the fullscreen video player 3–4 times per search session instead of scrolling the grid.

There is already partial recovery: `_maybe_scroll_grid()` calls `gemini.identify_page_with_recovery()` after each swipe and presses BACK if fullscreen opened. However this fires AFTER the damage is done. The fix prevents the long swipe from triggering fullscreen entry.

## Tests First

**Test mode**: `--test search-grid-scroll` in `phone-bot/main.py`

The test searches for any keyword, then calls `_maybe_scroll_grid()` 5 times with `scroll_prob=1.0` (force all 5 to execute). It verifies that none of the 5 scrolls opens the fullscreen player.

### Test stub for `main.py`

```python
def test_search_grid_scroll(bot: TikTokBot):
    """
    Test that 5 consecutive grid scrolls never open the fullscreen video player.
    PASS: all 5 scrolls leave the search grid visible with shifted thumbnails.
    FAIL: even 1 fullscreen video opens (grid scroll max_dist still too large).
    """
```

### Frame verification protocol

1. Start scrcpy recording
2. Bot searches "relationship goals" → taps Videos tab → waits for grid
3. Calls `_maybe_scroll_grid(scroll_prob=1.0)` 5 times with 1s pause between calls
4. Extract frames: `ffmpeg -y -i test.mkv -vf "fps=2,scale=720:-2" frames/f_%03d.jpg`
5. ALL frames must show the search grid (2-column thumbnail layout), never the fullscreen video player
6. Log check: zero "Grid scroll opened fullscreen player" warnings

**Fail condition**: even 1 frame shows a fullscreen video with sidebar icons → reduce `max_dist` further below 0.20 and re-test.

---

## Implementation

### Files to modify

- `phone-bot/actions/tiktok.py` — `_human_browse_scroll()` context dispatch and duration blocks
- `phone-bot/config.py` — `HUMAN` dict, add one new timing param

### Change 1 — `config.py`: add `t_grid_scroll_duration`

In the `HUMAN` dict, add:

```python
"t_grid_scroll_duration": (0.35, 0.1, 0.25, 0.55),   # scroll duration for search/profile grids (slower than FYP)
```

Log-normal `(median, sigma, min, max)` tuple. 350ms median is slower than FYP swipe — appropriate for a tighter grid where slower movement is less likely to trigger tap recognition.

### Change 2 — `_human_browse_scroll()`: reduce `max_dist` for grid context

Current `else` branch:

```python
if context == "comments":
    y_top = 0.42
    y_bottom = 0.88
    max_dist = 0.30
else:  # grid (search results, profile)
    y_top = 0.15
    y_bottom = 0.85
    max_dist = 0.55
```

Change to:

```python
if context == "comments":
    y_top = 0.42
    y_bottom = 0.88
    max_dist = 0.30
elif context == "grid":
    y_top = 0.15
    y_bottom = 0.85
    max_dist = 0.20   # was 0.55 — large swipes open fullscreen on small thumbnails
else:
    # shop_grid, shop_product, or future contexts
    y_top = 0.15
    y_bottom = 0.85
    max_dist = 0.55
```

`max_dist = 0.20` (20% of screen height) means max scroll on Samsung S9 (2220px) = 444px = ~3-4 thumbnail heights. Enough to advance the grid while staying below the fullscreen-trigger threshold.

The `base_dist` formula uses `min(max_dist, ...)` — with `max_dist = 0.20`, state-driven variations in patience/fatigue scale proportionally from this lower ceiling.

### Change 3 — `_human_browse_scroll()`: use `t_grid_scroll_duration` for grid context

In the duration selection block:

```python
if context == "grid":
    duration = int(self.human.timing("t_grid_scroll_duration") * 1000)
elif patience > 1.0:
    duration = random.randint(350, 550)
elif fatigue > 0.4:
    duration = random.randint(250, 350)
else:
    duration = random.randint(280, 450)
```

Routes grid scroll timing through the log-normal distribution system. Leaves FYP and other context timings unchanged.

### Why the existing recovery in `_maybe_scroll_grid()` is not removed

The recovery call remains as a safety net. With `max_dist = 0.20` the fullscreen open should not occur, but the recovery is cheap and guards against edge cases — e.g., a state-driven outlier swipe that could still occasionally land on a thumbnail.

With `max_dist` reduced, the outlier path `dist = max(0.04, dist * random.uniform(0.3, 0.6))` will be at most `0.20 × 0.6 = 0.12` — well within safe territory.

---

## Universality Check

All changes are proportional:
- `max_dist = 0.20` is a ratio of `screen_h`
- `t_grid_scroll_duration` is device-agnostic timing
- No per-device calibration needed
- Safe on all target phones: Samsung S9 (2220px), Samsung S22 (2340px), Motorola (1600px)

---

## Summary of Changes

| File | Location | Change |
|------|----------|--------|
| `phone-bot/config.py` | `HUMAN` dict | Add `"t_grid_scroll_duration": (0.35, 0.1, 0.25, 0.55)` |
| `phone-bot/actions/tiktok.py` | `_human_browse_scroll()` context dispatch | Split `else` into `elif context == "grid"` with `max_dist = 0.20` and fallback `else` |
| `phone-bot/actions/tiktok.py` | `_human_browse_scroll()` duration block | Add `if context == "grid": duration = int(self.human.timing("t_grid_scroll_duration") * 1000)` |
