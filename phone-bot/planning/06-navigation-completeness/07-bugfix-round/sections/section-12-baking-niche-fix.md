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

# Section 12 — Baking Niche Fix

## Overview

This section fixes a false-positive in the niche classification prompt inside `evaluate_niche_fit()` in `core/gemini.py`. A baking video was incorrectly classified as in-niche because its caption contained "love language" — words that loosely match the target niche description. The fix adds two-step visual reasoning to both prompt branches (`context="video"` and `context="profile"`) so that content type is identified from what is VISUALLY SHOWN before any niche match decision is made.

**Priority**: MEDIUM
**File modified**: `phone-bot/core/gemini.py` (function `evaluate_niche_fit`)
**No other files changed.**
**Dependencies**: None — independently implementable.

---

## Background

The target niche is:
> "Relationship and dating content: toxic relationships, red flags, situationships, dating advice, couples content, heartbreak, love advice, breakups, boyfriend/girlfriend dynamics, relationship drama, talking stage."

A baking video with the caption "my love language is baking" and hashtags `#baking #lovelanguage` has surface-level caption overlap with "love" and "language". The current video branch prompt treats caption and visual content as equally weighted signals. Gemini, seeing "love" in the caption, returns a score of 60-65 ("probably in-niche"). This is wrong.

The fix: require Gemini to explicitly identify the PRIMARY content type from what is VISUALLY SHOWN first, then apply niche matching as a second step. If the visual content type is cooking/food/baking, the video is automatically out-of-niche regardless of what the caption says.

The `context="profile"` branch has the same vulnerability. The fix applies to both branches.

---

## Tests (Add Before Implementing)

The test requires no phone or scrcpy recording — direct Gemini API calls with saved screenshots.

### Test mode: `--test niche-baking`

Add to `main.py`. Required test screenshots (save to `phone-bot/calibration/` or similar):
- `niche_test_baking_video.png` — baking/cooking video whose caption mentions "love" or "love language"
- `niche_test_cooking_profile.png` — cooking creator profile whose bio might mention food or love
- `niche_test_relationship_video.png` — genuine relationship/dating video (in-niche ground truth)
- `niche_test_relationship_profile.png` — genuine relationship content creator profile (in-niche ground truth)

**Test stub**:
```python
def test_niche_baking(phone_id: str):
    """
    Verify baking/cooking content is correctly classified as out-of-niche
    even when captions contain relationship keywords.

    Asserts:
    - baking video screenshot -> score < 30
    - cooking profile screenshot -> score < 40
    - relationship video screenshot -> score >= 60
    - relationship profile screenshot -> score >= 60
    """
```

**Pass criteria**:
- Baking video: `score < 30` — visual content type overrides caption keywords
- Cooking profile: `score < 40` — content type from thumbnail grid, not bio text alone
- Relationship video: `score >= 60` — genuine in-niche content still scores correctly
- Relationship profile: `score >= 60` — genuine in-niche profile still scores correctly

**Fail conditions**:
- Baking video scores >= 40 after the fix
- Any genuine relationship content drops below 55 after the fix

---

## Implementation

### File: `phone-bot/core/gemini.py`

Modify the `evaluate_niche_fit()` function. The function signature and return types do NOT change. Only the prompt strings inside each branch change.

### `context="video"` branch — primary fix location

Replace the current `prompt` string in the `else` block (lines ~1050-1066) with a new prompt that adds two explicit reasoning steps before scoring:

```
STEP 1 — CONTENT TYPE:
First identify the PRIMARY content type based ONLY on what is visually shown
(not what the caption says). Choose the single best match from:
- cooking_baking_food: cooking, baking, food preparation, kitchen scenes, eating
- fashion_beauty: clothing, makeup, hair, styling
- fitness_gym: exercise, working out, gym, sports
- relationship_dating: human relationship dynamics, couple behavior, emotional
  conversations between people, reactions to texts/calls
- comedy_entertainment: sketches, jokes, memes
- dance_music: dancing, singing, music performance
- travel_lifestyle: travel, scenery, daily vlog
- other: anything not listed above

STEP 2 — NICHE MATCH:
The video is in-niche ONLY IF the content type is "relationship_dating" AND
humans are the primary visual subject AND the content shows relationship dynamics
(conversation, reactions, emotional behavior between people).

EXPLICIT EXCLUSION RULES:
- cooking_baking_food content is NEVER in-niche, even if caption says "love
  language", "my love", "heartbreak", or any relationship word
- A video is in-niche ONLY if humans are the primary subject AND the content
  is about their relationship dynamics, emotions toward each other, or
  communication patterns
- If food, kitchen equipment, or food preparation is the primary visual element,
  return out-of-niche regardless of caption

SCORING RULES:
- 80-100: Clearly in-niche (relationship/dating content type + human dynamics shown)
- 60-79: Probably in-niche (adjacent: drama storytime, emotional reactions, advice)
- 40-59: Ambiguous
- 20-39: Probably NOT in niche
- 0-19: Clearly NOT in niche (cooking, sports, gaming, fashion, pets, tech, etc.)

TARGET NICHE: {niche_description}
Reference keywords (context only, NOT the primary classification signal):
{', '.join(niche_keywords[:12])}

Return ONLY JSON:
{"content_type": "<type from list above>", "score": 0-100, "reason": "brief 8-word reason"}
JSON only, no markdown.
```

After the prompt change, update the JSON parsing block to include `content_type` (log it for diagnostics, but it does not need to be in the return dict). Add a log line: `NICHE_FIT: video content_type=%s score=%d reason=%s`.

The video branch `max_tokens=80` may need to increase to 100 to accommodate the `content_type` field in the response JSON.

### `context="profile"` branch — secondary fix location

Add the same content-type exclusion logic to step 3 (NICHE SCORE) of the profile prompt (lines ~1001-1030). The profile prompt already has 3 steps; extend step 3 with explicit exclusion rules:

After the existing "SCORING RULES" block in the profile prompt, add:

```
CONTENT TYPE RULE: Before scoring, identify the PRIMARY content type shown in
the thumbnail grid. If the grid shows cooking/food/baking thumbnails, score <= 15
regardless of bio text. A cooking creator is NOT in-niche even if their bio
mentions "love" or "love language".

A profile is in-niche ONLY IF the content grid primarily shows human
relationship dynamics OR the bio explicitly mentions the relationship/dating niche.
Food, fashion, fitness, or gaming thumbnails = out-of-niche.
```

The profile branch return schema (`is_profile`, `active_tab`, `score`, `reason`) is unchanged. The content-type reasoning is an internal step Gemini performs before outputting the score.

### Key Implementation Principle

All exclusion rules use **ABSOLUTE language** ("is NEVER", "ONLY IF", "regardless of caption"). This mirrors the established pattern in this codebase. From CLAUDE.md: "Gemini ignores soft instructions ('Do NOT assume') — must use ABSOLUTE BAN language + inline schema hints + hard code filters as safety net."

Keep both branches at `temperature=0.3` (no change needed).

---

## Verification

After implementing, run `--test niche-baking`:

1. Pass saved baking video screenshot to `evaluate_niche_fit(screenshot, NICHE_DESCRIPTION, NICHE_KEYWORDS, context="video")`
2. Confirm returned score is < 30 and `reason` references food/cooking content type
3. Pass saved cooking profile screenshot to `evaluate_niche_fit(screenshot, NICHE_DESCRIPTION, NICHE_KEYWORDS, context="profile")`
4. Confirm returned score is < 40
5. Pass genuine relationship video and profile screenshots — confirm scores remain >= 60

Check logs for the new `content_type` log line in the video branch output — gives ongoing visibility during live sessions.

No phone or scrcpy recording required. The fix is prompt-only; the verification is a direct API call comparison.
