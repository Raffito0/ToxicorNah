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

# Section 13 — Story Follow: Verification of Section 1 Fix

## Overview

**Problem 13 (MEDIUM priority):** During test 6, the bot accidentally followed a creator named "bT" while navigating a Story. Video frames showed the Follow button changing to "Following" during Story interaction. This is a symptom of Problem 1 (Story DM bug) — the bot was stuck in Story view and a tap action landed on the Follow button in the bottom portion of the screen (y > 80%).

**Resolution:** This section contains **no new code changes.** The root cause is fully addressed by Section 1 (`section-01-story-exit`). This section is a verification protocol confirming that after Section 1 is implemented, the Story-triggered accidental follow cannot occur.

**Dependency:** Section 13 must be executed **after** Section 1 is complete and passing its own tests.

---

## Why Section 1 Fully Resolves This

The accidental follow happened through this causal chain:

1. `visit_creator_profile()` tapped the creator avatar, which opened a Story (blue ring on avatar)
2. Profile verify failed. The bot did not cleanly exit the Story
3. Still in Story view, the bot made further tap attempts. One landed in the y > 80% zone where the Story Follow button lives
4. TikTok recorded a Follow from that tap

Section 1 breaks this chain at step 2: after the first failed profile verify, the bot immediately detects the Story via `classify_screen_with_reference()`, attempts the Story header avatar tap exactly once (at x=12%, y=8% — well above the y > 80% exclusion zone), and then exits via `_exit_story_safely()` if the profile still doesn't open.

The `INVARIANT` rule enforced throughout `visit_creator_profile()` is: **never tap y > 0.80 × screen_h while in Story view.** With this invariant enforced, no tap can land on the Story Follow button (located in the bottom 20%).

---

## Tests

From `claude-plan-tdd.md`, Section 13:

> No new tests. Verified by Section 1 test. Frame check: confirm no account gets "Following" status from Story interaction.

---

## Verification Protocol

After Section 1 is implemented and passing its own `--test story-exit` test, perform the following confirmation check for Problem 13 specifically.

### Setup

```bash
scrcpy --no-window --record tmp_story_follow_verify.mkv --time-limit 120
# Run the existing Section 1 test:
python main.py --test story-exit --phone <phone_id>
# Extract frames:
ffmpeg -y -i tmp_story_follow_verify.mkv -vf "fps=0.5,scale=720:-2" tmp_story_follow_frames/f_%03d.jpg
```

### Frame-Level Verification

Examine every extracted frame. For each frame where a Story screen is visible (identifiable by the progress bar at y=5-6% of screen):

**PASS conditions (all must be true):**
- No frame shows a Follow button that changed to "Following" for an account not explicitly followed via `_scroll_to_top_and_follow()`
- No tap action occurs below y=80% while the Story progress bar is visible
- After the Story sequence, the Following count has not increased by any unexpected amount

**FAIL conditions (any one = fail):**
- Any frame shows a "Following" label that was not there before the Story interaction
- Log contains a `follow` event attributed to a Story context rather than the niche-check follow path
- The bot makes any tap in the bottom 20% while Story progress bar is visible

### Log Correlation

The Section 1 fix produces these log messages during Story interaction:

```
[INFO] visit_creator_profile: avatar tap → story detected (classify result: story)
[INFO] visit_creator_profile: story header tap attempt (x=12%, y=8%, jitter ±5px)
[INFO] visit_creator_profile: story header tap → profile verified   # success path
   OR
[INFO] visit_creator_profile: story header tap failed, calling _exit_story_safely()
[INFO] _exit_story_safely: pressing BACK, verifying FYP restored
[INFO] visit_creator_profile: returning False (story exit)
```

**For Problem 13 specifically**, the key message confirming the fix:
- `"visit_creator_profile: returning False (story exit)"` — bot gave up cleanly, never touching y > 80%
- Absence of any `follow` log event during the Story sequence

### Following Count Audit

Before the test run, note the following count of the test account. After the test, if the count increased, inspect which account was followed. If the new follow is "bT" or any account only encountered during a Story (not via the niche follow-back path), Problem 13 is not resolved and Section 1 has a bug.

---

## Files to Verify (No Modifications)

| File | What to confirm |
|------|-----------------|
| `phone-bot/actions/tiktok.py` | `visit_creator_profile()` has Story detection + `INVARIANT: Never tap y > 0.80 * screen_h while in Story view`. `_exit_story_safely()` exists. |
| `phone-bot/core/coords.py` | All `get_coord("tiktok", "story_*")` entries satisfy y < 0.80 × screen_h (verified by `--test story-coord-audit` from Section 1). |

If either condition is not present, Section 1 was not fully implemented — resolve Section 1 first.

---

## Expected Outcome

After Section 1 is correctly implemented:
- The bot never spends time interacting with Story UI elements beyond the one controlled header tap at y=8%
- The y > 80% zone (Follow button, reply field, sticker bar) is never touched during Story navigation
- Problem 13 (accidental follow "bT") is structurally impossible
- Test result: all frames show Story → clean exit → FYP restored. Zero unexpected new follows
