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

# Section 02 — People You May Know (PYMK) Carousel

## Priority: CRITICAL

## Problem Summary

TikTok injects "People You May Know" (PYMK) posts into the FYP feed. These are photo carousels — not videos — that show profile suggestions with a "Follow" button in a non-standard position. The pixel-based sidebar scanner (`find_sidebar_icons()`) returns `None` on these posts because they don't have the 4+ sidebar icons a normal FYP video has.

When `find_sidebar_icons()` returns `None`, the current code in `browse_session()` branches into LIVE/ad handling. The engagement action is skipped — correct — but the FYP loop does NOT actively scroll past the PYMK post. If any retry or fallback path fires a tap, it can land on the exposed "Follow" button and follow a stranger.

This section adds a Gemini yes/no PYMK check that fires when `find_sidebar_icons()` returns `None` and the LIVE ring pixel detector is also negative. If PYMK is detected, scroll past immediately.

## Cross-Reference with Section 6

Section 6 (LIVE double-scroll) and this section share the same trigger point: `find_sidebar_icons() == None` after a swipe. The unified check order is:

1. Pixel LIVE ring detector → if LIVE → double-scroll immediately
2. Gemini PYMK check (this section) → if PYMK → double-scroll immediately
3. Existing LIVE/ad curiosity-enter logic for any remaining ambiguous cases

Both sections modify the same area of `browse_session()`. Coordinate with Section 6 to avoid merge conflicts.

## Files to Modify

- `phone-bot/actions/tiktok.py` — add `_is_pymk_post()` method, modify the `_sidebar is None` branch in `browse_session()`
- `phone-bot/core/gemini.py` — optionally add a thin `is_pymk_post()` wrapper, or call `_call_vision` directly from tiktok.py

---

## Tests (Run BEFORE and AFTER implementing)

### Test: `--test pymk-detection`

Add this mode to `main.py`.

1. Initialize `TikTokBot` with phone_id
2. Call `init_monitor()` with temp directories (see Section 14)
3. Browse FYP for up to 15 minutes (or until a PYMK post appears)
4. Record with scrcpy: `scrcpy --no-window --record pymk_test.mkv --time-limit 900`

Frame extraction (mandatory scale for Samsung screens):
```
ffmpeg -y -i pymk_test.mkv -vf "fps=0.5,scale=720:-2" frames/f_%03d.jpg
```

Frame-level pass criteria (ALL must be met):
- PYMK post is visible in frame N (photo carousel, multiple profile photos, Follow button)
- Swipe-up occurs within 0.5s of PYMK detection
- NO frame shows the Follow button changing to "Following"
- Bot does not remain on PYMK post for more than 1s after detection

Log pass criteria:
- `"PYMK post detected, scrolling past"` appears in log
- No `"tapping Follow"` or similar engagement log during that video slot

Fail condition: Any frame shows Follow button pressed, OR bot stays on PYMK post for 2+ frames at fps=0.5.

### Test: Offline Gemini accuracy check (no phone needed)

Before running on-device, validate `_is_pymk_post()` against saved screenshots:
1. Save a real PYMK post screenshot to `phone-bot/calibration/pymk_01.png`
2. Save a normal FYP video screenshot to `phone-bot/calibration/normal_fyp_01.png`
3. Save a LIVE preview screenshot to `phone-bot/calibration/live_preview_01.png`

Pass each through `_is_pymk_post(screenshot_bytes)` and verify:
- PYMK screenshot → `True`
- Normal FYP video → `False`
- LIVE preview → `False`

---

## Implementation Details

### New method: `_is_pymk_post()`

Location: `actions/tiktok.py`, instance method on `TikTokBot`.

```python
def _is_pymk_post(self, screenshot: bytes) -> bool:
    """
    Returns True if the current FYP item is a 'People You May Know' suggestion post.
    Called when find_sidebar_icons() returns None and LIVE detection is negative.
    Uses Gemini Vision yes/no call (temperature=0.1, max_tokens=5).
    Returns True on uncertain/ambiguous responses (conservative default = scroll past).
    Never returns True for LIVE streams or ads.
    """
```

Gemini call parameters:
- **Prompt**: `"Is this a 'People you may know' post — a photo carousel showing multiple profile cards with a Follow button for each person? Answer ONLY 'yes' or 'no'. Do NOT answer yes for: TikTok LIVE streams, video ads, regular videos, or any other content type."`
- **Temperature**: 0.1 (deterministic)
- **max_tokens**: 5
- **timeout**: 6.0 seconds
- **Return True** for: any response starting with `"y"` (covers "yes", "yes.", "yes,")
- **Return True** for: any ambiguous response (empty, parse failure) — conservative default
- **Return False** for: any response starting with `"n"`

### Modification to `browse_session()`

The PYMK check is inserted inside the `_sidebar is None` block, BEFORE the curiosity-based LIVE tap logic:

1. `_sidebar is None` — enter the non-standard-post branch
2. Pixel LIVE ring detector (Section 6 adds this — if Section 6 done first, hook into it)
3. If not LIVE: call `_is_pymk_post(screenshot)`
4. If PYMK: log `"PYMK post detected, scrolling past"`, wait `t_live_skip_pause`, call `scroll_fyp()`, `continue`
5. If not PYMK: fall through to existing LIVE/ad curiosity-enter logic

The screenshot for the PYMK check should reuse the screenshot taken for `_get_sidebar_positions()` to avoid a redundant ADB call.

### Scroll-past implementation

```python
log.info("FYP: PYMK post detected, scrolling past")
time.sleep(self.human.timing("t_live_skip_pause"))  # ~0.4s human pause
self.scroll_fyp()
```

`t_live_skip_pause = (0.4, 0.2, 0.2, 0.8)` — shared with Section 6. If Section 6 is not yet implemented, add this param to `config.py` HUMAN dict yourself.

---

## Config Changes

If Section 6 is not yet implemented, add to `config.py` HUMAN dict:

```python
"t_live_skip_pause": (0.4, 0.2, 0.2, 0.8),   # pause before double-scroll past LIVE/PYMK
```

Do not define this param twice if Section 6 already added it.

---

## Invariants and Constraints

- **Never tap anything** on a PYMK post before scrolling past
- **Gemini is called only when sidebar=None AND LIVE pixel check is negative**
- **Conservative default**: uncertain Gemini responses → scroll past
- **No hardcoded pixel positions** — Gemini Vision reads the screenshot semantically
- **Proportional universality**: no per-device calibration

---

## Verification Checklist

- [ ] `_is_pymk_post()` returns `True` for a real PYMK post screenshot (offline test)
- [ ] `_is_pymk_post()` returns `False` for a normal FYP video screenshot (offline test)
- [ ] `_is_pymk_post()` returns `False` for a LIVE preview screenshot (offline test)
- [ ] On-device: PYMK post scrolled past within 0.5s of detection (frame analysis)
- [ ] On-device: No Follow button tap in any frame (frame analysis)
- [ ] Log contains `"PYMK post detected, scrolling past"` exactly once per PYMK post
- [ ] `t_live_skip_pause` config param present in `config.py` (not duplicated if Section 6 done)
- [ ] No hardcoded pixel values introduced
