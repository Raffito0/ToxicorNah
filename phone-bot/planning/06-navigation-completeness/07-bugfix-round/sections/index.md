<!-- PROJECT_CONFIG
runtime: python-pip
test_command: python main.py --test
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-story-exit
section-02-pymk-carousel
section-03-photosensitive-popup
section-04-search-tab-restore
section-05-tap-to-exit-toast
section-06-live-double-scroll
section-07-retype-test
section-08-grid-scroll-fix
section-09-loading-spinner
section-10-reveal-tap-test
section-11-wm-size-fallback
section-12-baking-niche-fix
section-13-story-follow-verify
section-14-monitor-init
section-15-search-suggestion-clamp
END_MANIFEST -->

# Implementation Sections Index

## Project Context

Phone-bot bug fix round: 15 unresolved problems from live testing on Samsung Galaxy S9. Each section is a self-contained bug fix or test addition. All fixes must be universal (proportional coordinates, Gemini Vision-based detection, no hardcoded pixels).

Test framework: manual scrcpy recording + frame-by-frame analysis (not automated pytest). Test command shown above is the Python entry point — each section defines its own `--test <mode>` flag.

---

## Dependency Graph

| Section | Problem | Depends On | File(s) | Parallelizable |
|---------|---------|------------|---------|----------------|
| section-01-story-exit | P1 (CRITICAL) | — | tiktok.py | Yes |
| section-02-pymk-carousel | P2 (CRITICAL) | S6 (cross-ref) | tiktok.py, gemini.py | Yes |
| section-03-photosensitive-popup | P3 (HIGH) | — | gemini.py, tiktok.py | Yes |
| section-04-search-tab-restore | P4 (HIGH) | — | tiktok.py | Yes |
| section-05-tap-to-exit-toast | P5 (HIGH) | — | tiktok.py | Yes |
| section-06-live-double-scroll | P6 (HIGH) | S2 (cross-ref) | tiktok.py, config.py | Yes |
| section-07-retype-test | P7 (HIGH) | — | main.py | Yes |
| section-08-grid-scroll-fix | P8 (MEDIUM) | — | tiktok.py, config.py | Yes |
| section-09-loading-spinner | P9 (MEDIUM) | — | tiktok.py, verify.py | Yes |
| section-10-reveal-tap-test | P10 (MEDIUM) | — | main.py | Yes |
| section-11-wm-size-fallback | P11 (MEDIUM) | — | adb.py, executor.py | Yes |
| section-12-baking-niche-fix | P12 (MEDIUM) | — | gemini.py | Yes |
| section-13-story-follow-verify | P13 (MEDIUM) | S1 | tiktok.py (verify only) | After S1 |
| section-14-monitor-init | P14 (LOW) | — | main.py, monitor.py | Yes |
| section-15-search-suggestion-clamp | P15 (LOW) | — | tiktok.py | Yes |

---

## Execution Order (Batches)

All sections are independent prose files. Batch by priority for implementation order:

**Batch 1** — CRITICAL + first HIGH fixes (implement first):
- section-01-story-exit
- section-02-pymk-carousel
- section-03-photosensitive-popup
- section-05-tap-to-exit-toast
- section-06-live-double-scroll

**Batch 2** — Remaining HIGH + MEDIUM search fixes:
- section-04-search-tab-restore
- section-07-retype-test
- section-08-grid-scroll-fix
- section-09-loading-spinner
- section-10-reveal-tap-test

**Batch 3** — MEDIUM infrastructure + LOW:
- section-11-wm-size-fallback
- section-12-baking-niche-fix
- section-13-story-follow-verify
- section-14-monitor-init
- section-15-search-suggestion-clamp

---

## Section Summaries

### section-01-story-exit
`visit_creator_profile()` Story detection and safe exit. When creator avatar tap opens a Story instead of profile: detect, retry header tap once, exit via BACK if fails. Coord audit for y < 80% invariant.

### section-02-pymk-carousel
"People You May Know" post detection in FYP. When `find_sidebar_icons()` returns None and not LIVE: Gemini yes/no call → if PYMK → scroll past immediately. Cross-referenced with S6 unified post-swipe check.

### section-03-photosensitive-popup
Add `photosensitive_warning` to `classify_overlay()` prompt. Handler: Gemini bbox finds "Skip all" button → tap. Verify overlay dismissed.

### section-04-search-tab-restore
After BACK from search video, `_ensure_search_tab("Videos")`: Gemini classify active tab, re-tap if needed. Prevents grid taps on wrong layout.

### section-05-tap-to-exit-toast
`_return_to_fyp()` pre-check: call `_quick_verify_fyp_from_shot()` before any BACK press. If already on FYP → skip BACK entirely. Prevents "Tap again to exit" toast.

### section-06-live-double-scroll
After every swipe in `browse_session()`: immediate sidebar scan (after `t_swipe_settle`). If None → LIVE ring pixel check → if LIVE → double-scroll (0.3-0.6s pause). Also calls PYMK check if not LIVE.

### section-07-retype-test
`--test search-retype` in `main.py`: search 2 keywords in sequence, verify `_clear_and_retype()` replaces text correctly. Pure test addition, no main logic changes unless test reveals bug.

### section-08-grid-scroll-fix
Reduce `max_dist` for `_human_browse_scroll(context="grid")` from 0.55 to ~0.20. Add `t_grid_scroll_duration` config param. Prevents grid scroll opening fullscreen player.

### section-09-loading-spinner
After tapping "Videos" search tab, use `wait_and_verify()` with `thumbnails_loaded_fn`: samples 6 proportional positions in grid, checks stdev > 30 (variance-based, not brightness). Retries up to 4x.

### section-10-reveal-tap-test
`--test search-reveal` in `main.py`: watch FYP video, then trigger search. Verify y=5% tap reveals hidden top bar. Pure test addition.

### section-11-wm-size-fallback
Cascading fallback chain in `adb.py`: wm size → dumpsys window → dumpsys display → config. All with subprocess timeouts. CRITICAL + skip phone (no adb reboot). `_handle_device_failure()` in executor.

### section-12-baking-niche-fix
Two-step content type reasoning in `evaluate_niche_fit()` both branches (`context="video"` and `context="profile"`). Content type (cooking/fashion/gym/etc.) must be identified visually before niche match. Explicit cooking exclusion rules.

### section-13-story-follow-verify
No code changes. Verification that after S1 fix, no account receives unintended Follow from Story interactions. Frame-check protocol to confirm.

### section-14-monitor-init
Add `init_monitor()` call at start of all test functions in `main.py`. Option A (temp dirs) or Option B (add test_mode param). Eliminates "Monitor not initialized" messages in tests.

### section-15-search-suggestion-clamp
Add `end_y = min(end_y, screen_h * 0.88)` clamp in `scroll_fyp()` before calling `humanize_swipe()`. FYP-specific, does not affect other swipe types.
