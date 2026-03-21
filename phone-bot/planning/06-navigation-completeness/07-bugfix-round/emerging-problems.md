# Emerging Problems

## EP-04 (resolved 2026-03-21): PAGE_ID parse fails with Gemini 2.5 Flash — bot nuclear-escapes from valid search page

**Discovered during**: Section-08 run 3/3 (2026-03-21)
**Frame evidence**: f_020 shows search page clearly open; log shows `PAGE_ID: parse failed` × 2 → nuclear escape
**Root cause**: gemini.py:491 uses bare `json.loads(result)`. With `gemini-2.5-flash` (new `google.genai` SDK), responses can include reasoning preamble before the JSON object. `json.loads` fails on non-JSON prefix. bbox calls work (use regex parser), CONTENT_CHECK works (returns single word). Only JSON-parse functions are broken.
**Reproduction**: Any `identify_page_with_recovery()` call with gemini-2.5-flash → response has preamble → json.loads raises JSONDecodeError → returns page="unknown" → bot thinks it's not on search → nuclear escape
**Impact**: HIGH — blocks section-08 test and any flow using PAGE_ID classification
**Fix idea**: In `identify_page_with_recovery()` (and all other JSON-parsing functions), extract JSON slice: `result = result[result.find('{'):result.rfind('}')+1]` before `json.loads()`

## EP-03 (resolved 2026-03-20): _maybe_scroll_grid() presses BACK unnecessarily after every scroll

**Discovered during**: Section-08 grid scroll test (2026-03-19)
**Frame evidence**: f_060 shows search history (BACK navigated away from Videos tab) after scroll 1/5
**Root cause**: tiktok.py:3501 — `if page != "profile":` triggers BACK for ANY page that isn't "profile", including "search" (which IS the correct state after a grid scroll). Should check for fullscreen video player specifically.
**Reproduction**: Any call to `_maybe_scroll_grid()` when on Videos search tab → Gemini returns page="search" → `page != "profile"` is True → BACK pressed unnecessarily
**Impact**: MEDIUM — BACK from Videos tab goes to Top tab or search home, disrupting grid browsing. Bot recovers but wastes time and Gemini calls.
**Fix idea**: Change condition to `if page not in ("search", "profile", "unknown"):` or check for explicit fullscreen video page. Read `identify_page_with_recovery()` to understand all possible page values.

## EP-01 (resolved 2026-03-19): Reveal tap opens Android notification panel on Shop page

## EP-01: Reveal tap opens Android notification panel on Shop page

**Discovered during**: Search fix test from Shop page (2026-03-19)
**Frame evidence**: f_004 of Shop test — Android notification shade visible
**Root cause**: Reveal tap at y=1.5% (36px) on Shop page hits the Android status bar area, which opens the notification panel. On FYP/Following the top bar is fullscreen-overlay, but on Shop the TikTok UI starts lower (has search bar below top tabs), so y=36px is in the system status bar.
**Reproduction**: Start on Shop tab → run go_to_search() → first tap at y=1.5% opens notifications
**Impact**: LOW — notifications auto-dismiss when TikTok gets focus back, doesn't break the flow
**Fix idea**: Skip the reveal tap when NOT on a fullscreen video page (Shop, Explore, Profile have static top bars that don't need revealing)

## EP-02: Gemini bbox confuses cart icon (🛒) with search icon (🔍) on Shop page

**Discovered during**: Search fix test from Shop page (2026-03-19)
**Frame evidence**: f_007 — Cart page "Your cart is empty" opened instead of search
**Root cause**: On Shop page, the 🛒 cart icon is at x=91.8% y=7% — same area where the 🔍 search icon would be on other pages. Gemini bbox with x_min_pct=0.80 does NOT filter this because cart IS at x>80%.
**Reproduction**: Start on Shop tab → go_to_search() → Gemini finds "magnifier" at cart position → taps → Cart page opens
**Impact**: MEDIUM — wastes one attempt, nuclear_escape recovers. Search still opens on attempt 2.
**Fix idea**: Either (a) detect Shop via top bar text before attempting bbox, or (b) add "NOT cart/shopping bag" more aggressively to prompt, or (c) accept the recovery as sufficient since go_to_search is only called once per search session

## EP-AUTO 2026-03-21 (false positive — closed): scroll count discrepancy
- **Status**: FALSE POSITIVE. Gemini analysis misread 5 discrete grid scrolls with ~15s pauses (Gemini API calls between each) as "many continuous scrolls". Frame-by-frame analysis confirms exactly 5 scrolls.

## EP-AUTO 2026-03-21: 14 scroll gestures vs 5 log events — FALSE POSITIVE (closed 2026-03-21)
- **Status**: FALSE POSITIVE. `_human_browse_scroll("grid")` intentionally executes N physical swipes per logical scroll (human simulation). 16 physical swipes = 5 logical scrolls. Gemini counted physical sub-swipes, not logical scrolls. Verified by cross-referencing SWIPE log entries with BROWSE_SCROLL counters: 4+5+2+3+2=16 physical → 5 logical. No bug.

## EP-AUTO 2026-03-21: TikTok app loop + grid scroll mismatch — FALSE POSITIVE (closed 2026-03-21)
- **Status**: FALSE POSITIVE. forge_verify --gemini-analysis was called with stale section-08 filtered log while analyzing section-10 video. Gemini saw section-10 video (reveal tap + close app once) but compared against section-08 log (grid scrolls) → invented "app loop" that doesn't exist. Root fix: always run --filter-logs BEFORE --gemini-analysis with the correct section log.

## EP-AUTO 2026-03-21: sidebar detection + Story classification + BACK gesture + PASS claim — FALSE POSITIVE batch (closed 2026-03-21)
- **Status**: ALL FALSE POSITIVE. These 4 EPs were from section-13 run 3 (invalid run — creator had LIVE not Story). Gemini misinterpreted the video: logs confirm bot pressed BACK → FYP restored (nav_bar_scan fyp=246, conf=0.95). Contradicted by subsequent valid runs (run 4+5) where Story was correctly detected and handled.

## EP-AUTO 2026-03-21: extra scrolls after test PASS + stuck on initial post — FALSE POSITIVE (closed 2026-03-21)
- **Status**: FALSE POSITIVE. "Extra scrolls after PASS" = HOME gestures from close_app_natural() misidentified as TikTok scrolls. "Stuck on initial post" = Gemini miscounted the ~5s humanized watch time between scroll_fyp() calls as "stuck" behavior. Logs confirm 5 clean scrolls with t_video_glance timing between each.
