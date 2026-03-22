# Section 02: Warmup Session Interleaving

## Overview

This section adds warmup awareness to the planner's session generation flow. When an account has an active (incomplete) warmup, the planner produces sessions with special types (`warmup`, `warmup_lazy`) and engagement caps instead of regular session types. Dead days produce no session at all. Warmup accounts are limited to 1 session per day and never receive aborted or extended variants.

**Depends on:** Section 01 (Planner Parameterization) -- accounts are passed as a parameter with optional `warmup_state` dict.

**Blocks:** Section 03 (Planner Service) -- which reads warmup state from DB and passes it into the planner.

## Background

The existing warmup system lives in `phone-bot/planner/warmup.py`. It generates a per-account warmup plan via `generate_warmup_plan()`, stored as `AccountWarmupState.warmup_plan`. The plan is a dict keyed by day number (1-based int), where each day has a type (dead/lazy/normal) and engagement caps.

Key warmup rules:
- Duration is 5-8 days (randomized per account)
- Days 1-2: zero likes (absolute rule)
- 1-2 dead days (no session at all)
- 1-2 lazy days (3-6 min scroll, zero or minimal engagement)
- Non-monotonic engagement progression
- Each account gets a DIFFERENT warmup schedule

## Files to Modify

| File | Change |
|------|--------|
| `Weekly & Daily Plan/planner/models.py` | Add `engagement_caps` field to `Session` dataclass |
| `Weekly & Daily Plan/planner/scheduler.py` | Modify `_build_session()` to handle warmup states; modify `generate_daily_plan()` to limit warmup accounts to 1 session |

## Tests

File: `Weekly & Daily Plan/tests/test_warmup_interleaving.py`

```python
# Test: warmup account (day 1) gets session_type='warmup' with scroll_only=True caps
# Test: warmup account (day 3) gets engagement_caps with likes=(0,10)
# Test: warmup account (dead day) returns None from _build_session
# Test: warmup account (lazy day) gets session_type='warmup_lazy', duration 3-5 min
# Test: warmup account gets max 1 session/day (never 2)
# Test: warmup account never gets aborted/extended session types
# Test: mixed plan with 3 warmup + 3 regular accounts has correct session types
# Test: engagement_caps key present in warmup session dict, None in regular session dict
# Test: warmup sessions get normal time slot assignment (no special weighting)
# Test: Session.engagement_caps defaults to None
# Test: Session.to_dict() includes engagement_caps key
```

## Implementation Details

### 1. Engagement Caps Dict Shape

When present, the `engagement_caps` dict has this shape (values come from the warmup plan for that day):

```python
{
    "scroll_only": True,
    "likes": 0,           # int max, or [min, max] range
    "comments": 0,
    "follows": 0,
    "searches": 0,
    "can_post": False,
    "duration_range": [5, 10],
}
```

### 2. Modify `_build_session()` for Warmup Awareness

At the top of `_build_session()`, before abort/extend checks, add warmup handling:

1. Check if `account.get("warmup_state")` exists and `warmup_state["completed"] == False`
2. Look up `warmup_plan[current_day]` for the day type
3. Based on day type:
   - `"dead"` -- return `None` (caller skips)
   - `"lazy"` -- return dict with `session_type="warmup_lazy"`, duration from `duration_range`, zero caps
   - `"normal"` -- return dict with `session_type="warmup"`, caps from warmup plan
4. Skip `force_abort` and `maybe_extend_session` checks entirely for warmup accounts

Key details:
- `post_scheduled`: `True` only if warmup plan day has `can_post: True`
- `total_duration_minutes`: Random within plan's `duration_range`
- `scroll_only`: True if likes=0 AND comments=0 AND follows=0 AND searches=0

### 3. Modify `generate_daily_plan()` for Warmup Limits

In Step 1 (determine session/post counts), if account has active warmup:
- Force `session_count = 1`
- If day type is "dead", set `active = False` (account skipped)
- Set `post_count` based on warmup plan's `can_post` field

### 4. Determining Current Warmup Day

The `warmup_state` dict includes `current_day` (int). The planner reads it and looks up the warmup plan entry. The planner does NOT advance the day -- that is the executor's job.

If `current_day == 0`, treat as day 1. If exceeds `total_days`, treat as regular (safety fallback).

### 5. Passing engagement_caps to Session Constructor

In `generate_daily_plan()` Step 5 where Session objects are created from dicts:

```python
session = Session(
    # ... existing fields ...
    engagement_caps=sd.get("engagement_caps"),
)
```

## Edge Cases

- **All accounts in warmup**: Valid plan with only warmup session types
- **Dead day for ALL accounts**: Day has zero sessions (valid)
- **Mixed phone**: warmup account gets 1 session, regular can get 1 or 2
- **Account finishes warmup mid-week**: If `completed == True` when planner runs, treated as regular
