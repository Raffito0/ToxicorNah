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

# Section 04 — BACK from Search Video Resets to "Top" Tab

## Problem Summary

After `search_explore_session()` opens a video from the search "Videos" tab and the bot presses BACK to return to the results grid, TikTok automatically resets the active search tab from "Videos" to "Top". The "Top" tab has a different grid layout — 2-column with text captions vs. 3-column captionless "Videos" grid. When the bot's next iteration tries to tap a grid item using bounding boxes captured while "Videos" was active, it taps the wrong position.

## Priority

HIGH — Batch 2.

## Dependency

None. This section is independently implementable.

## File Modified

- `phone-bot/actions/tiktok.py` (primary — add `_ensure_search_tab()` and two call sites)

No changes to `config.py`, `gemini.py`, or other files.

---

## Tests First

**Test mode**: `--test search-tab-restore` in `main.py`

### What the test does

1. Initialize `TikTokBot` with phone_id
2. Search "girlfriend goals" via `_type_search_query()`
3. Tap a grid item to open a video
4. Wait 4-6 seconds (simulate watching)
5. Press BACK once
6. Wait `t_nav_settle`
7. Call `_ensure_search_tab("Videos")` — the function being tested
8. Take a screenshot after `_ensure_search_tab()` returns
9. Make a Gemini Vision call: `"In this TikTok search results page, which tab is currently active (underlined or highlighted)? Reply with exactly one word: Top, Videos, Users, or None."`
10. Log PASS if "Videos", FAIL otherwise

### Frame verification (scrcpy)

```bash
scrcpy --no-window --record test_search_tab.mkv --time-limit 60
ffmpeg -y -i test_search_tab.mkv -vf "fps=0.5,scale=720:-2" frames/f_%03d.jpg
```

Sequential frame checks:
- Search grid with "Videos" tab underlined (baseline)
- Video opens fullscreen
- BACK pressed — grid returns, check which tab is underlined
- If "Top" was active: re-tap "Videos" visible in frames → "Videos" becomes underlined
- Next grid tap fires only after "Videos" confirmed

### Log verification

```
_ensure_search_tab: checking active tab
_ensure_search_tab: active tab is "Top", need "Videos"
_ensure_search_tab: tapping "Videos" tab
_ensure_search_tab: "Videos" tab confirmed active
```

OR if tab was already correct:

```
_ensure_search_tab: active tab is "Videos", already correct
```

### Fail condition

ANY frame showing a grid tap firing while the "Top" tab is underlined.

---

## Implementation Details

### New method: `_ensure_search_tab(target_tab)`

Add to `TikTokBot` in `phone-bot/actions/tiktok.py`.

```python
def _ensure_search_tab(self, target_tab: str) -> bool:
    """
    Verify that the specified search results tab is active (underlined/bold).
    If not, find the tab label via Gemini bbox and tap it, then verify.

    Args:
        target_tab: "Videos", "Top", "Users", or "Live"

    Returns:
        True if target tab confirmed active after (at most one) tap.
        False if tab could not be confirmed.

    Universal — Gemini reads tab label text, no fixed pixel positions.
    """
```

#### Internal logic

Step 1 — Take a screenshot.

Step 2 — Gemini Vision classify call:
- Prompt: `"In this TikTok search results page, which tab is currently active (underlined or bold)? Choose from: Top, Videos, Users, Live, or None. Reply with exactly one word."`
- Temperature: 0.1
- max_tokens: 10
- timeout: 6.0 seconds

Step 3 — Parse response. Strip whitespace, lowercase. Check if matches `target_tab.lower()`.

Step 4 — If already matches: log `"_ensure_search_tab: '%s' already active"`, return `True`.

Step 5 — If not match: call `_find_and_tap()` to locate and tap the tab label:
- Prompt: `'the "%s" tab text in the horizontal search filter bar (Top/Videos/Users/Live)' % target_tab`
- `y_max_pct=0.20` (filter bar always in top 20% of screen)

Step 6 — Wait `self.human.timing("t_tab_switch")` for tab to become active.

Step 7 — Verify: take another screenshot, repeat Gemini classify call from Step 2. If matches now: log `"_ensure_search_tab: '%s' confirmed after tap"`, return `True`.

Step 8 — If still not matching: log `WARNING`, return `False`. Do NOT retry.

#### Important constraints

- No hardcoded pixel positions. `_find_and_tap()` uses Gemini bbox — already universal.
- Do NOT add a new Gemini function to `core/gemini.py`. Use `_call_vision()` directly or an existing thin wrapper.
- `t_tab_switch` already exists in `config.py`. No new config entry needed.

### Where to call `_ensure_search_tab()`

There are exactly two BACK-from-video locations in `search_explore_session()`:

**Location 1** — Main loop's "Back from video to results grid":

```python
self.adb.press_back()
await asyncio.sleep(self.human.timing("t_search_scroll_pause"))
# ADD:
self._ensure_search_tab("Videos")
cached_thumbnails = []  # invalidate — layout may have changed
```

**Location 2** — Second-keyword inner loop's back-from-video:

```python
self.adb.press_back()
await asyncio.sleep(self.human.timing("t_search_scroll_pause"))
# ADD:
self._ensure_search_tab("Videos")
cached2 = []  # invalidate
videos_watched += 1
```

**Important**: Always invalidate `cached_thumbnails` after calling `_ensure_search_tab()` — old bounding boxes are stale after any tab change or video exit.

### Failure path handling

When `_ensure_search_tab()` returns `False`, continue to the next loop iteration. Do not break the session — the `cached_thumbnails = []` invalidation means the next iteration takes a fresh screenshot and re-runs Gemini bbox.

---

## Background Context

- `_find_and_tap(prompt, y_max_pct)` — takes natural-language description, calls Gemini bbox, taps center. Already handles jitter. Source: `actions/tiktok.py`.
- `find_search_grid_thumbnails()` — Gemini Vision call returning grid thumbnail bounding boxes. Positions become invalid after tab change — always clear `cached_thumbnails` after `_ensure_search_tab()`.
- `t_tab_switch` — existing config timing param (~1.2s median, log-normal).
- The "Videos" filter bar is the horizontal row of pills (Top / Videos / Users / Sounds / Live) just below the search bar, at approximately 12-18% screen height — hence `y_max_pct=0.20` for `_find_and_tap()`.
