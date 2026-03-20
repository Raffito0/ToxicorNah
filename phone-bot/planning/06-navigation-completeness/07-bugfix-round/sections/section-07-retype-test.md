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

# Section 07 — Triple-Tap Retype Test (`--test search-retype`)

## Summary

This section is a **test addition only**. `_clear_and_retype()` in `actions/tiktok.py` has never been triggered in any live test because every past run searched only one keyword. The function may silently produce wrong results (appended text, stale results, search bar with mixed content). This section adds a dedicated `--test search-retype` mode to `main.py` that calls the function directly and verifies the result via Gemini Vision.

If the test passes with the existing implementation, this section is complete. If the test reveals a bug, fix `_clear_and_retype()` in `actions/tiktok.py` and re-run.

---

## Background: How `_clear_and_retype()` Works

File: `phone-bot/actions/tiktok.py`

Current strategy:
1. Tap search bar to focus it
2. Triple-tap the same position with 50-140ms inter-tap spacing (to trigger "select all" on Android)
3. Type new keyword via `human.type_with_errors()` — overwrites the selection
4. Press Enter
5. Tap the "Videos" tab in the horizontal filter bar

Known risks this test is designed to surface:
- Triple-tap may not trigger "select all" on all Android versions (S9 Android 10 and S22 Android 16 behave differently)
- New text may be **appended** to old text (select-all didn't work)
- Search bar may still show old keyword visually
- `_find_and_tap()` for Videos tab may fail if results loaded before tap target was ready

---

## Files Modified

| File | Change |
|------|--------|
| `phone-bot/main.py` | Add `--test search-retype` argument + `run_search_retype_test()` function |
| `phone-bot/actions/tiktok.py` | Fix `_clear_and_retype()` ONLY if the test reveals a bug |

---

## Dependencies

None. Section 07 is independent of all other sections in this bug-fix round.

---

## Tests (TDD — implement these first)

### Test: `--test search-retype`

**Invocation**:
```
python -m phone_bot.main --test search-retype --phone <N>
```

**Precondition**: TikTok is not open (test opens it). Phone connected via ADB.

**Test procedure**:
1. Initialize `TikTokBot` (same pattern as all other test modes)
2. Call `_type_search_query("girlfriend goals")` — navigates to search, types, submits, waits for Videos tab
3. Wait 2s for results to load
4. Save screenshot as `tmp_search_retype_before.png`
5. Call `_clear_and_retype("breakup story")` directly
6. Wait 2s for results to update
7. Save screenshot as `tmp_search_retype_after.png`
8. Make a Gemini Vision call on the "after" screenshot:
   - Prompt: `"What text is currently shown in the TikTok search bar at the top of this screen? Reply with only the exact text, nothing else."`
   - Temperature: 0.1 (deterministic read)
9. Normalize response: `.strip().lower()`
10. PASS if normalized response contains `"breakup story"` (case-insensitive substring)
11. FAIL if: old text remains, text is combined (`"girlfriend goalsbreakup"`), or response is empty
12. Log `PASS` or `FAIL` with raw Gemini response as evidence
13. Close app

**Frame verification** (always run alongside):
```bash
scrcpy --no-window --record tmp_search_retype.mkv --time-limit 60
ffmpeg -y -i tmp_search_retype.mkv -vf "fps=0.5,scale=720:-2" tmp_search_retype_frames/f_%03d.jpg
```

Frame verification checklist:
- Frame at step 2: search bar shows "girlfriend goals", Videos tab active, grid thumbnails visible
- Frame at step 5 (triple-tap): text highlighted/selected in search bar (blue selection visible)
- Frame at step 6: search bar shows "breakup story", NOT "girlfriend goalsbreakup story"
- Frame at step 7: grid results change (different thumbnails from keyword 1)
- No frame shows keyboard unexpectedly dismissed mid-typing

**FAIL conditions** (any one = fail):
- Gemini reads search bar as anything containing "girlfriend" alongside "breakup"
- Search results grid does not change between before/after screenshots
- Any frame shows keyboard unexpectedly dismissed mid-typing
- `_clear_and_retype()` raises an exception

---

## Implementation

### Step 1 — Add `run_search_retype_test()` to `main.py`

Add a new async function following the pattern of existing test functions:

```python
async def run_search_retype_test(controllers: dict[int, ADBController], phone_id: int):
    """TEST: Verify _clear_and_retype() replaces search bar text correctly.
    Types keyword 1, then calls _clear_and_retype(keyword 2), verifies via Gemini.
    PASS: Gemini reads 'breakup story' in search bar (not 'girlfriend goals').
    FAIL: old text remains, appended, or search results unchanged.
    """
```

Inside the function:
- Guard: `if phone_id not in controllers: log.error(...); return`
- Initialize `HumanEngine` + `TikTokBot` (same boilerplate as other test functions)
- Enable screenshot saving so all intermediate states are captured
- Log test header clearly: `"=== SEARCH RETYPE TEST: Phone %d ==="`
- Call `bot.open_app()`, wait `human.timing("t_app_load")`
- Call `bot._type_search_query("girlfriend goals")` — if returns False, log error and abort
- `time.sleep(2.0)` — let results settle
- Save screenshot as `tmp_search_retype_before.png`
- Log: `"Step: calling _clear_and_retype('breakup story')"`
- Call `bot._clear_and_retype("breakup story")`
- `time.sleep(2.0)` — let new results load
- Save screenshot as `tmp_search_retype_after.png`
- Make Gemini call to read the search bar (use existing `_call_vision()` or equivalent)
- Evaluate result, log `PASS` or `FAIL` with raw Gemini response
- Call `bot.close_app()`

### Step 2 — Wire `--test search-retype` into `main()`

```python
parser.add_argument("--search-retype-test", action="store_true",
                    help="TEST: verify _clear_and_retype() replaces search text (requires --phone)")
```

Dispatch block:
```python
if args.search_retype_test:
    if not args.phone:
        log.error("--search-retype-test requires --phone (e.g. --phone 4)")
        sys.exit(1)
    asyncio.run(run_search_retype_test(controllers, args.phone))
    return
```

### Step 3 — Fix `_clear_and_retype()` if test reveals a bug

Only modify `actions/tiktok.py` if the test fails.

**Bug A: Triple-tap does not select all text** (most likely on Android 10)
- Symptom: Gemini reads "girlfriend goalsbreakup story" (text appended)
- Fix: Before triple-tapping, send `KEYCODE_CTRL_A` via `adb shell input keyevent 29` to force select-all, then type. Safest cross-version fallback.

**Bug B: Keyboard dismissed before typing starts** (timing issue)
- Symptom: Gemini reads empty or partial text; frames show keyboard disappearing
- Fix: After triple-tap, add explicit `time.sleep(0.3)` before starting `type_with_errors()`. If keyboard is gone, re-tap search bar before typing.

**Bug C: "Videos" tab tap fires before results loaded** (timing issue)
- Symptom: `_find_and_tap()` at end of `_clear_and_retype()` fails silently
- Fix: Call `_ensure_search_tab("Videos")` at end of `_clear_and_retype()` instead of `_find_and_tap()` (leverages Section 04's fix if already implemented)

---

## Verification Protocol

**Run order**:
1. Start scrcpy recording
2. Run `python -m phone_bot.main --search-retype-test --phone <N>`
3. Stop recording after test completes
4. Extract: `ffmpeg -y -i tmp_search_retype.mkv -vf "fps=0.5,scale=720:-2" tmp_srtype_frames/f_%03d.jpg`
5. Review all frames against checklist above
6. Check logs for PASS/FAIL line and Gemini raw response

**PASS criteria** (both must be true):
- Logs show `"SEARCH RETYPE TEST: PASS"` with Gemini response containing `"breakup story"`
- No frame shows appended text in the search bar

**FAIL criteria** (any one = fail):
- Log shows `"SEARCH RETYPE TEST: FAIL"` with Gemini response showing old/mixed text
- Any frame shows keyboard dismissed unexpectedly mid-typing
- Search results grid is identical before and after retype (same thumbnails = same query)

If the test fails, fix the underlying bug (see Step 3), re-run, and verify again. Section is complete only when both logs AND frames confirm correct behavior.
