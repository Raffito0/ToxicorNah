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

# Section 10 — Reveal Tap Test (`--test search-reveal`)

## Overview

**Problem**: `go_to_search()` in `actions/tiktok.py` taps at `y=5%` of screen height to reveal the hidden top bar before tapping the search icon. This reveal tap has never been visually verified. Every prior test ran search as the very first action after opening TikTok, so the top bar was always already visible.

**Fix type**: Test addition only. No changes to main bot logic unless the test reveals a bug in `go_to_search()`.

**Priority**: MEDIUM (Batch 2). No dependencies on other sections.

**Files modified**:
- `phone-bot/main.py` — add `--test search-reveal` argument and `run_search_reveal_test()` function
- `phone-bot/actions/tiktok.py` — fix `go_to_search()` only if the test reveals a bug

---

## Background

When TikTok plays a fullscreen video, the top UI bar (containing the search/magnifier icon, "For You" tab, etc.) auto-hides after a few seconds of inactivity. The bar reappears on any interaction in the top portion of the screen.

The current `go_to_search()` implementation taps at `y=5%` to reveal the bar, waits 0.3-0.6s, then taps the search icon. If the wait is too short for the bar animation to complete, the subsequent `search_icon` tap lands on the video instead.

---

## Tests

From `claude-plan-tdd.md`, Section 10:

**Test: `--test search-reveal`**

Frame verify: top bar hidden → tap at y=5% → top bar appears → search icon visible → search opens. Fail condition: top bar doesn't appear after tap.

**Verification protocol** (standard):
```bash
scrcpy --no-window --record tmp_search_reveal.mkv --time-limit 60
python -m phone_bot.main --test search-reveal --phone <N>
ffmpeg -y -i tmp_search_reveal.mkv -vf "fps=0.5,scale=720:-2" tmp_search_reveal_frames/f_%03d.jpg
```

Always use `scale=720:-2`. Samsung screens are 1080x2220+ (>2000px height) — without this filter the Claude API crashes when viewing many frames in context.

---

## Implementation

### Step 1 — Add argument to `main()` in `phone-bot/main.py`

```python
parser.add_argument(
    "--search-reveal",
    action="store_true",
    help="TEST: verify y=5%% reveal tap unhides top bar before search (requires --phone)",
)
```

Dispatch block (after existing `--tap-test` block):

```python
if args.search_reveal:
    if not args.phone:
        log.error("--search-reveal requires --phone (e.g. --phone 4)")
        sys.exit(1)
    asyncio.run(run_search_reveal_test(controllers, args.phone))
    return
```

### Step 2 — Implement `run_search_reveal_test()` in `phone-bot/main.py`

```python
async def run_search_reveal_test(controllers: dict[int, ADBController], phone_id: int):
    """TEST MODE: Verify that go_to_search() correctly reveals the hidden top bar.

    Sequence:
      1. Navigate to FYP
      2. Watch a video for 10s (long enough for top bar to auto-hide)
      3. Capture screenshot — verify top bar IS hidden (search icon not visible)
      4. Call go_to_search()
      5. Capture screenshot — verify search page opened
      6. Log PASS or FAIL with evidence
    """
```

The test body:

1. **Initialize**: get `adb` from controllers, create `HumanEngine`, call `human.start_session(...)`, create `TikTokBot(adb, human)`. Call `init_monitor(test_mode=True)` per Section 14.

2. **Navigate to FYP**: call `bot.go_to_fyp()`, wait `human.timing("t_back_verify")`.

3. **Watch until top bar hides**: wait 10s. TikTok top bar auto-hides after ~4-6 seconds of no interaction.

4. **Capture pre-reveal screenshot** and Gemini Vision call:
   - Prompt: `"Is the TikTok top navigation bar (containing the search icon and 'For You' tab) visible at the top of the screen? Answer yes or no only."`
   - Temperature: 0.1, max_tokens: 5
   - Log: `"pre_reveal_bar_visible: <yes/no>"`
   - If bar already visible: log warning `"Top bar already visible before reveal tap — test cannot verify reveal behavior"` but continue

5. **Call `bot.go_to_search()`**: capture return value (`True`/`False`).

6. **Capture post-search screenshot** and Gemini Vision call:
   - Prompt: `"Is the TikTok search/discover page currently open? Look for a search input field at the top and content below. Answer yes or no only."`
   - Temperature: 0.1, max_tokens: 5
   - Log: `"search_page_open: <yes/no>"`

7. **Determine PASS/FAIL**:
   - PASS: `go_to_search()` returned `True` AND Gemini confirms search page is open
   - FAIL: `go_to_search()` returned `False` OR Gemini says search page not open
   - PARTIAL: top bar was already visible before reveal tap — mark as `"PARTIAL (bar was already visible, search still worked)"`

8. **Log summary** using `"=" * 60` banner pattern.

### Step 3 — Potential fixes in `go_to_search()` (only if test reveals a bug)

**Bug hypothesis A — Delay too short**: `random.uniform(0.3, 0.6)` after reveal tap may be insufficient. Animation takes ~300ms on fast devices but up to 600ms on Samsung S9 Android 10. Fix: replace with `time.sleep(self.human.timing("t_reveal_tap_settle"))` and add config param `"t_reveal_tap_settle": (0.5, 0.2, 0.35, 0.9)` in `config.py`.

**Bug hypothesis B — y% too close to edge**: `y=5%` on Samsung S9 (2220px) = ~111px from top. On some Samsung builds, tapping near the status bar (top ~30dp) doesn't register as a bar-reveal gesture. Fix: change to `y=8%`.

**Bug hypothesis C — Tap not registering**: status bar intercepts the tap. Fix: add `time.sleep(0.1)` BEFORE the reveal tap and ensure `ty >= screen_h * 0.06`.

The function signature for `go_to_search()` does not change. All fixes are internal.

---

## Expected Log Output on PASS

```
[INFO] SEARCH REVEAL TEST: Phone 1
[INFO] Navigated to FYP, waiting for top bar to auto-hide...
[INFO] pre_reveal_bar_visible: no
[INFO] go_to_search() returned: True
[INFO] search_page_open: yes
[INFO] RESULT: PASS — reveal tap successfully showed top bar and opened search
```

---

## Acceptance Criteria

1. `--test search-reveal --phone <N>` runs without errors
2. At least one test run starts with `pre_reveal_bar_visible: no` (top bar was actually hidden)
3. In that run, `search_page_open: yes` (reveal tap + search icon tap succeeded)
4. scrcpy frames show: top bar hidden → top bar visible → search page open
5. No frames show search icon tap landing on video content (which would pause the video)
