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

# Section 09 — Videos Tab Loading Spinner

## Problem Summary

After tapping the "Videos" search tab in `search_explore_session()`, TikTok shows a loading spinner for 1-3 seconds before thumbnails appear. The current code waits a fixed `t_tab_content_load` delay (~2.5s) then proceeds to grid interaction. On slow connections or lower-end phones, the spinner is still visible when that delay expires. When `find_search_grid_thumbnails()` fires against a screen still showing the spinner, it finds no thumbnail bboxes and the search session skips all grid interaction for that keyword.

**Priority**: MEDIUM — affects search session reliability, not account safety.

**Dependency**: None. This section is fully independent.

---

## Files to Modify

- `phone-bot/actions/tiktok.py` — replace fixed wait with `wait_and_verify()` call in `_type_and_search()` and in `_clear_and_retype()`
- `phone-bot/core/verify.py` — no changes needed; `wait_and_verify()` already supports this pattern

---

## Tests First

### Test mode: `--test search-tab-wait`

Add to `phone-bot/main.py`. The test must be added before any implementation work begins. Run once to observe baseline behavior (spinner timing), then again after the fix to confirm correct behavior.

**Test flow:**
1. Initialize `TikTokBot` with phone_id (and call `init_monitor()` per Section 14)
2. Call `go_to_search()` to open search page
3. Type a keyword (e.g. `"girlfriend goals"`) and submit
4. Tap the "Videos" tab via `_find_and_tap()`
5. Start a timer
6. Loop: take screenshot every 0.4s, call `thumbnails_loaded_fn(screenshot)`, log result + elapsed time
7. First frame where function returns True: log "thumbnails ready at {elapsed}s"
8. If thumbnails not ready after 6s: log FAIL "spinner still showing after 6s"

**Frame verification (scrcpy recording required):**
- Early frames: spinner visible (white/gray uniform area where grid should be)
- Mid frames: thumbnails begin to appear
- Final frames: full grid visible, thumbnails loaded
- Bot must NOT take a grid action until at least one frame shows thumbnails loaded

**Log verification:**
- `"thumbnails_loaded_fn: stdev=X.X at attempt N — waiting..."` while spinner is up
- `"thumbnails_loaded_fn: stdev=X.X at attempt N — READY"` when thumbnails appear
- `"VERIFY[search_tab_load]: PASS on attempt N"` from `wait_and_verify()` internals

**Fail conditions:**
- `find_search_grid_thumbnails()` fires while spinner still visible (stdev < 30)
- Bot finds zero thumbnails and skips grid browsing on a keyword with video results

---

## Implementation

### Design Rationale — Why Color Variance, Not Brightness

A simple brightness check fails here. A loading spinner is white/light gray — high brightness. A loaded thumbnail grid also contains bright pixels. The distinction is **variance across multiple sample points**:

- **Spinner**: uniform white/gray across the entire grid area → low stdev across 6 sample points
- **Thumbnails**: varied colors per cell (faces, text, backgrounds) → high stdev across same 6 points

This is the same approach used by `page_state.detect_bottom_bar()`, which checks stdev < 15 at y=86%. Here the logic is inverted: stdev > 30 means thumbnails are loaded.

### New Helper: `_thumbnails_loaded`

Add as a method of `TikTokBot` in `phone-bot/actions/tiktok.py`:

```python
def _thumbnails_loaded(self, screenshot: bytes) -> bool:
    """Check if search grid thumbnails have loaded (spinner is gone).

    Samples 6 proportional positions in the 2-column thumbnail grid area.
    Uses color variance (stdev), NOT brightness threshold.
    Spinner = uniform white/gray = low stdev.
    Thumbnails = varied colors per cell = high stdev (> 30).

    Sampling positions (proportional, universal across all screen sizes):
      Left column (x=25%):  y=40%, 55%, 70%
      Right column (x=75%): y=40%, 55%, 70%

    Returns True if stdev > 30 across all 6 sample points.
    """
```

Implementation uses `PIL.Image` (same pattern as `page_state.py`). Sample each of the 6 (x%, y%) positions as a small region (e.g. 10x10px), compute average brightness of each region, then compute stdev of those 6 values. Log stdev at DEBUG level.

The stdev threshold of 30:
- Excludes spinner (stdev ~2-8 on uniform gray/white)
- Includes thumbnails (stdev ~40-90 from varied video content)
- Above "still animating" transition (stdev ~15-25 during fade-in)

### Changes to `_type_and_search()` (tiktok.py)

After the `_find_and_tap("Videos")` call, replace the two `time.sleep` calls with a single `wait_and_verify()` call:

```python
result = wait_and_verify(
    adb=self.adb,
    human=self.human,
    verify_fn=self._thumbnails_loaded,
    action_name="search_tab_load",
    first_wait="t_tab_content_load",   # existing param: median 2.5s
    retry_wait="t_tab_content_load",   # reuse same param for retries
    max_attempts=4,
    is_slow_verify=False,              # pixel-based, fast
    max_total_s=6.0,
)
if not result.success:
    log.warning("SEARCH: thumbnails never loaded after %.1fs, proceeding anyway",
                result.elapsed_s)
return True
```

`wait_and_verify()` parameters:
- `first_wait="t_tab_content_load"` (median 2.5s, range 1.5-5.0) — keeps median behavior identical to before
- `retry_wait="t_tab_content_load"` — same param for retry delays
- `max_attempts=4` — initial + 3 retries
- `max_total_s=6.0` — hard cap to prevent hanging on network outage
- `is_slow_verify=False` — pixel-based check is <5ms per call

### Changes to `_clear_and_retype()` (tiktok.py)

Apply the same replacement for the `t_tab_switch` wait after tapping the "Videos" tab — same `wait_and_verify()` call with same parameters. This ensures the second keyword's grid is also fully loaded before interaction.

### No config.py changes needed

`t_tab_content_load = (2.5, 0.3, 1.5, 5.0)` is already the right timing for both `first_wait` and `retry_wait`. No new config keys required.

Note: Section 8 adds `t_grid_scroll_duration` — that is a separate param for grid scroll speed, not related to this fix.

### Import note

Verify the import exists at top of `tiktok.py`:

```python
from ..core.verify import wait_and_verify, VerifyResult
```

If not present, add it.

---

## Verification Protocol

After implementing:

```bash
scrcpy --no-window --record tmp_search_tab_wait.mkv --time-limit 60
python main.py --test search-tab-wait --phone 1
ffmpeg -y -i tmp_search_tab_wait.mkv -vf "fps=0.5,scale=720:-2" tmp_frames/f_%03d.jpg
```

Frame-by-frame review confirms:
1. Videos tab tap visible (tab label highlighted)
2. Spinner/blank grid visible in subsequent frames
3. Thumbnail grid fully rendered
4. No grid action fires during spinner frames

Test PASSES when: thumbnails are loaded before any `find_search_grid_thumbnails()` call, verified by log timestamps showing `VERIFY[search_tab_load]: PASS` before `"Vision found N search grid thumbnails"`.
