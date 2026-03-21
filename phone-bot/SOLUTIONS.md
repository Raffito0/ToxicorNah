# Phone-Bot Solutions Database

Confirmed solutions that passed 3/3 consecutive test runs.
**Search this file BEFORE diagnosing any problem.** Use keywords from the problem type.

Format per entry:
- **Root cause**: exact file:line
- **Tried & failed**: what was attempted before and why it didn't work
- **Solution**: what fixed it
- **Why it works**: the reasoning
- **Code**: files/functions changed
- **Date**: YYYY-MM-DD · Section: XX

---

## LIVE Detection

### LIVE video in FYP feed — skip engagement without entering stream
- **Root cause**: tiktok.py — sidebar scan returns `None` on LIVE videos (no engagement icons present). No reliable pixel/bbox signal to distinguish LIVE from normal without entering.
- **Tried & failed**: pixel brightness threshold for red ring → false positives on dark videos with red tones. Gemini bbox on avatar ring → inconsistent, ring too small.
- **Solution**: `sidebar=None` is the primary signal. If sidebar is None → run `should_skip_content()` (Gemini classify). If Gemini confirms LIVE → double-scroll (skip without entering). Three detection paths: Case 1: sidebar=None directly, Case 2: sidebar present but no avatar + Gemini confirms, Case 3: sidebar=None again.
- **Why it works**: LIVE videos never have a standard engagement sidebar (like/comment/share icons) because the UI is replaced by live chat. `None` from sidebar scan is a definitive signal unique to LIVE.
- **Code**: `tiktok.py` — new `_post_swipe_live_check()` method called from `browse_session()` after every `scroll_fyp()`. Uses `_get_sidebar_with_shot()` + `_should_skip_content()`. `config.py` — added `t_swipe_settle`, `t_live_skip_pause` timing params.
- **Date**: 2026-03-19 · Section: 06

---

## Search Grid Scroll

### _human_browse_scroll("grid") — scrolls open fullscreen video player instead of scrolling grid
- **Root cause**: tiktok.py — `_human_browse_scroll("grid")` used `max_dist=0.55` (55% of screen height). On Samsung S9 (2220px) that's ~1220px, far exceeding the ~150px thumbnail height. TikTok interprets any swipe > ~30% screen height on a grid thumbnail as a "open video" tap-drag, opening fullscreen player.
- **Tried & failed**: N/A — first attempt was correct.
- **Solution**: Reduced `max_dist` to `0.20` for grid context (20% screen height = ~444px on S9 = 3-4 thumbnail heights). Also added `t_grid_scroll_duration` timing param `(0.35, 0.1, 0.25, 0.55)` for slower, more deliberate grid scrolls.
- **Why it works**: 20% swipe is far below TikTok's open-video threshold (~30-35%). Slower duration reduces gesture velocity, further reducing false-open rate.
- **Code**: `tiktok.py` — `_human_browse_scroll("grid")` branch, `max_dist=0.20`. `config.py` — `t_grid_scroll_duration` param.
- **Date**: 2026-03-21 · Section: 08

---

## Gemini 2.5 Flash JSON Parse Failure

### identify_page_with_recovery() — PAGE_ID parse fails with Gemini 2.5 Flash
- **Root cause**: gemini.py:479 — Gemini 2.5 Flash uses thinking tokens that count against `max_output_tokens`. With `max_tokens=120`, thinking consumed ~114 tokens, leaving only 6 chars (`{"page`) of actual JSON output — truncated before closing `}`.
- **Tried & failed**: (1) `_extract_json()` helper to extract JSON from preamble — didn't help because response was truncated, not just prefixed. Response was always `'{"page'` (len=6), never a complete JSON.
- **Solution**: Increased `max_output_tokens` to 500 for `identify_page_with_recovery()`. Also added `_extract_json()` as defense for future reasoning preambles. Applied `_extract_json()` to all 13 `json.loads(result)` calls in gemini.py for consistency.
- **Why it works**: 500 tokens is enough for thinking budget + full JSON response (~80 tokens). `_extract_json` handles any reasoning text before/after the JSON object.
- **Code**: `gemini.py` — `_extract_json()` helper at line 130. `identify_page_with_recovery()` — `max_tokens=120→500`. All `json.loads(result)` → `json.loads(_extract_json(result))`.
- **Date**: 2026-03-21 · Section: 08 (EP-04)

---

## Search Bar Retype

### _clear_and_retype() — replacing search text in TikTok search bar
- **Root cause**: tiktok.py:3759 — TikTok uses React Native TextInput. Triple-tap (Android select-all gesture) places cursor mid-word. `input keyevent 29` is KEYCODE_A (not CTRL+A).
- **Tried & failed**: (1) Triple-tap loop → cursor placed mid-word on Android 10 RN input → "girlfriend gobreakup storyals". (2) `input keyevent 29` (KEYCODE_A, not CTRL_A) → typed 'a' mid-word → "girlfriend goabreakup storya".
- **Solution**: `_find_and_tap()` to tap the × (clear) button at the right of the TikTok search bar. Always present when text exists. Prompt: "X or circle-X clear/cancel button at the RIGHT side of the search input bar". After tap, bar is empty, type new keyword normally.
- **Why it works**: UI-level clear bypasses all RN TextInput keyboard shortcut issues. Gemini bbox with x_min_pct=0.60, y_max_pct=0.12 targets the × reliably.
- **Code**: `tiktok.py` — `_clear_and_retype()` — replaced triple-tap+keyevent with `_find_and_tap()` for × button + fallback KEYCODE_MOVE_END+KEYCODE_DEL loop (40 iterations).
- **Date**: 2026-03-19 · Section: 07

---

## Grid Scroll Opens Fullscreen
### _human_browse_scroll("grid") — scroll distance too large triggering fullscreen
- **Root cause**: `tiktok.py` — `_human_browse_scroll()` grid branch used `max_dist=0.55` (55% screen height). On a 2-column thumbnail grid, a 55% swipe is interpreted by TikTok as a tap-to-open-fullscreen gesture instead of a scroll.
- **Tried & failed**: nothing prior — first occurrence.
- **Solution**: Reduced `max_dist` to 0.20 for grid context. Added `t_grid_scroll_duration` config param. Each logical scroll now issues 2-5 physical sub-swipes of 9-20% each (humanized), totaling 18-45% effective scroll — enough to reveal new rows without triggering fullscreen.
- **Why it works**: TikTok's tap-detection threshold for grid items is ~100ms with <20px movement. Our swipes are 285-432ms with 200-455px travel — well above tap threshold. The reduced max_dist keeps each individual swipe under the fullscreen trigger zone.
- **Code**: `tiktok.py` — `_human_browse_scroll()` grid branch. `config.py` — `t_grid_scroll_duration`.
- **Date**: 2026-03-21 · Section: 08

---

## Videos Tab Loading Spinner — Search Grid
### wait_and_verify() spinner detection before grid interaction
- **Root cause**: `tiktok.py` — after tapping "Videos" tab in search results, fixed `time.sleep(t_tab_content_load)` (~1.5s) was insufficient on slow connections. Bot interacted with spinner UI instead of loaded grid.
- **Tried & failed**: nothing prior — first occurrence.
- **Solution**: Replaced fixed sleep with `wait_and_verify("search_videos_tab_load", check_fn=THUMBNAILS_LOADED)`. Pixel stdev sampling at 6 points across grid area: stdev=0.0 (all white=255) = spinner still showing, stdev>15 = thumbnails loaded. Max 4 attempts, ~1.5s between checks.
- **Why it works**: Grid thumbnails have high pixel variance (dark/light content) while spinner is uniform white. stdev>15 reliably distinguishes loaded content from loading state. Works universally — sampling positions are proportional (%).
- **Code**: `tiktok.py` — `_type_search_query()`. `core/verify.py` — `wait_and_verify()`.
- **Date**: 2026-03-21 · Section: 09

---

## Search Reveal Tap — go_to_search() verification
### Verify reveal tap + search icon tap opens search page
- **Root cause**: N/A — test-only section. `go_to_search()` was unverified visually.
- **Tried & failed**: N/A
- **Solution**: Added `--test search-reveal` in `main.py`. Test: open TikTok → FYP → wait 10s → Gemini checks bar visibility → call `go_to_search()` → Gemini confirms search page open.
- **Why it works**: Samsung S9 never auto-hides the top bar, so all 3 runs are PARTIAL (bar always visible). Core result confirmed: `go_to_search()` returns True + search page opens reliably. Reveal tap at y=5% is a no-op when bar is visible (harmless).
- **Code**: `phone-bot/main.py` — `run_search_reveal_test()`.
- **Date**: 2026-03-21 · Section: 10

---

## Screen Size Detection — wm size fallback chain
### ADBController._get_screen_size() — cascading detection methods
- **Root cause**: `adb.py:__init__` used only `wm size` with no fallback. Samsung S9 fails `wm size` silently — logged "wm size failed, using config values" every session. New phones without config values = fatal with no recovery. Also: `_device_lost` was not initialized before `_get_screen_size()` call → crash during init on first discovery.
- **Tried & failed**: (1) Init crash — `_device_lost` not set before screen detection block → AttributeError on `_run()`. Fixed by adding `self._device_lost = False` as first init line.
- **Solution**: Added cascade: Method 1 (`wm size`, 5s) → Method 2 (`dumpsys window`, 8s, parses `DisplayFrames w=W h=H`) → Method 3 (`dumpsys display`, 5s, parses `mBaseDisplayInfo real WxH`) → config fallback → `DeviceConfigError`. Added `DEBUG`-level raw output logging on each method. Added `DeviceConfigError` handling in `executor.py` (both warmup + regular phases) with same `dead_phones.add()` pattern as `DeviceLostError`.
- **Why it works**: Samsung S9 override (1080x2220) is picked up by `wm size` "Override size" line. `dumpsys window` also returns override. `dumpsys display` returns physical (1440x2960) — expected, cascade never reaches it when Method 1 works. `_device_lost = False` must be set before any `_run()` call.
- **Code**: `core/adb.py` — `_get_screen_size()`, `_detect_size_wm()`, `_detect_size_dumpsys_window()`, `_detect_size_dumpsys_display()`. `planner/executor.py` — `except DeviceConfigError`. `main.py` — `run_screen_detect_test()`.
- **Date**: 2026-03-21 · Section: 11

---

## Baking Niche False Positive
### evaluate_niche_fit() — cooking/food content incorrectly scored as in-niche
- **Root cause**: `core/gemini.py:1097` (video branch) — prompt treated caption and visual content as equally weighted. Baking video with "love language" in caption scored 60-65 (in-niche) because Gemini matched "love" keyword against relationship niche description. Profile branch had same vulnerability.
- **Tried & failed**: N/A — first attempt succeeded.
- **Solution**: Video branch: added 2-step reasoning — STEP 1 identifies PRIMARY content type from visuals only (8 categories including `cooking_baking_food`), STEP 2 applies niche match only if type is `relationship_dating`. Added ABSOLUTE EXCLUSION RULES: "cooking_baking_food is NEVER in-niche regardless of caption". Changed `max_tokens=80→100` for `content_type` field. Added `content_type` log for diagnostics. Profile branch: added CONTENT TYPE RULE paragraph before SCORING RULES — grid showing cooking thumbnails → score <= 15 regardless of bio.
- **Why it works**: Visual content type classification uses absolute language ("NEVER", "ONLY IF") which Gemini follows reliably. Test: baking video score=0-10 (was 60-65), cooking profile score=10 (was potentially high), relationship video/profile still 85-95.
- **Code**: `core/gemini.py` — `evaluate_niche_fit()` both branches. `main.py` — `run_niche_baking_test()`. Calibration screenshots: `phone-bot/calibration/niche_test_*.png`.
- **Date**: 2026-03-21 · Section: 12

---

## Story Accidental Follow — Verification
### Section 13: no new code — verified by Section 01
- **Root cause**: Bot stuck in Story view after failed profile verify → subsequent taps landed in y > 80% zone → hit Story Follow button.
- **Solution**: Section 01 (`_exit_story_safely()` + INVARIANT: never tap y > 0.80 while Story progress bar visible) fully resolves this. Section 13 is a verification-only section, confirmed by Section 01 passing 3/3.
- **Date**: 2026-03-21 · Section: 13

---

## Story Accidental Follow — Physical Verification
### Section 13: story-exit test confirms no accidental follows from Story interaction
- **Root cause**: Section 01 fix. Section 13 verifies it with physical phone test.
- **Solution**: `--test story-exit` with precondition "creator with blue Story ring visible". Bot taps avatar → enters Story → `STORY_BAR: detected` + `Story header tap attempt at (x, y=8%)` → profile opened or safe BACK. Zero taps in y>80% zone during Story.
- **Key signatures**: `Story detected, attempting header tap` + `Story header tap attempt at` must appear in log for a valid PASS.
- **Precondition**: Blue ring (Story) ≠ Red ring (LIVE). LIVE triggers `LIVE ring detected` and bot skips — not a valid Story test.
- **Date**: 2026-03-21 · Section: 13

---

## Monitor Not Initialized Warnings in Test Mode
### init_monitor() missing from test functions in main.py
- **Root cause**: `monitor.py:log_event()` checks `_default_logger is None` and logs warning — called by every bot action. `init_monitor()` only called by `executor.py` (production), never by test functions in `main.py`.
- **Solution**: Added `test_mode=True` param to `init_monitor()` (auto-creates temp dirs). Added `init_monitor(test_mode=True)` before `TikTokBot()` in 6 test functions.
- **Code**: `core/monitor.py`, `main.py` — 6 test functions updated.
- **Date**: 2026-03-21 · Section: 14

---

## FYP Swipe End-Y Suggestion Bar Clamp
### scroll_fyp() — defensive clamp to avoid 'Search · username' suggestion bar
- **Root cause**: `tiktok.py:scroll_fyp()` had no ceiling on end_y. TikTok injects a "Search · username" bar at y=92-95% after profile visits. No confirmed incident but no guardrail either.
- **Solution**: After `humanize_swipe()` returns, clamp `sw["y2"] = min(sw["y2"], int(screen_h * 0.88))`. Adds debug log when clamp activates. FYP-specific — no other scroll functions modified.
- **Why 88%**: S9 2220px → 1954px (91px above suggestion bar at ~2045+). S22 2340px → 2059px. Proportional, universal.
- **Result**: In all tests, humanize_swipe() already produces end_y 500-600px (25-27% of screen) — clamp never triggered. The fix documents the constraint in code and prevents future drift.
- **Code**: `actions/tiktok.py` — `scroll_fyp()`. `main.py` — `run_fyp_swipe_clamp_test()`.
- **Date**: 2026-03-21 · Section: 15

---
