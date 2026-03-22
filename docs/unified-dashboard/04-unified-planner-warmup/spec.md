# 04 — Unified Planner + Warmup

## Goal
Integrate the weekly/daily session planner into the dashboard with warmup sessions interleaved in the same plan. Provide a visual timeline of today's sessions and controls for plan generation and warmup management.

## Context
- Planner module: `Weekly & Daily Plan/planner/` (Python 3.14 package)
- Currently generates JSON files: `output/weekly_plan_YYYY-WNN.json`
- Warmup is currently a separate phase in phone-bot (warmup_state.json)
- CRITICAL DECISION: warmup sessions MUST be interleaved with regular sessions in ONE unified plan
- Phone order randomized daily
- Adding a phone mid-week regenerates remaining days
- All times in US/Eastern (proxy is Florida-based)

## Dependencies
- 01-db-schema-migration (WeeklyPlan table, warmup fields in BotAccount)
- 02-tiktok-engine-integration (executor reads plan from DB)

## Requirements

### R1: Planner module integration
- Import planner from `Weekly & Daily Plan/planner/` into Flask app
- Create `app/planner_service.py` that wraps planner calls:
  - `generate_weekly_plan(week_date=None)` -> returns plan dict, stores in WeeklyPlan table
  - `regenerate_remaining_days(from_date)` -> regenerates from given date forward
  - `get_today_sessions()` -> returns today's sessions from active plan
  - `get_current_plan()` -> returns active WeeklyPlan record

### R2: Unified plan generation (planner refactoring)
Modify the planner module to unify warmup and regular sessions:

**Phone Groups** (proxy-based):
- Phones sharing the same `proxy_id` form an implicit group
- Each group gets its OWN auto-generated weekly plan (separate plan per proxy)
- Groups run in PARALLEL (different proxies = no conflict)
- Phones WITHIN a group run SEQUENTIALLY (same proxy = one phone at a time)
- No separate PhoneGroup table — `Bot.proxy_id` is the grouping key
- `generate_weekly_plan()` accepts a proxy_id and generates plan for that group only
- WeeklyPlan table gets `proxy_id` FK to track which group the plan belongs to

**Input**: all accounts in a proxy group (warmup + regular) with their current state
**Output**: single plan for that group where:
- Warmup accounts get sessions with warmup-appropriate caps
- Regular accounts get normal sessions
- ALL accounts' sessions are interleaved in chronological order
- Phone order within the group is randomized per day
- Same phone's TikTok and Instagram sessions are consecutive (proxy efficiency)
- Session type field indicates: 'normal', 'warmup', 'warmup_lazy', 'warmup_dead', 'rest_only'

**Warmup integration rules**:
- **Warmup day 1-2: ONLY FYP scroll. Zero likes, zero searches, zero explore, zero follows, zero comments, zero profile visits. ONLY passive scroll.** This rule already exists in warmup.py — the planner refactoring MUST preserve it exactly. No engagement actions of any kind on days 1-2.
- Warmup day 3-4: few likes (0-10), some scroll (8-12 min), no posts
- Warmup day 5-7: moderate engagement, first post possible
- Dead days: account has 0 sessions (skipped entirely in plan)
- Lazy days: 1 short session (3-5 min scroll, 0 engagement)
- Warmup accounts get 1 session/day (never 2)

**Mid-week phone addition**:
- User adds Phone 4 on Wednesday
- `regenerate_remaining_days("2026-03-19")` regenerates Wed-Sun for that phone's proxy group
- Phone 4's warmup sessions appear in the new plan
- Mon-Tue sessions for existing phones are unchanged

### R3: Weekly Plan page
New sidebar item "Weekly Plan" with:

**Today's Timeline** (main view):
- Horizontal timeline bar showing 24h (Eastern Time)
- Session blocks: colored by platform (TikTok blue, Instagram pink)
- Warmup sessions: dashed border
- Each block shows: account name, time slot, duration
- Click block -> detail modal:
  - Account, phone, platform
  - Session type, time slot
  - Pre/post activity minutes
  - Post scheduled? Outcome?
  - Engagement caps (if warmup)
- Current time indicator (red line)
- Completed sessions: green checkmark
- Running session: pulsing animation
- Upcoming: normal display
- Failed/skipped: red X

**Week Overview** (secondary tab):
- 7-column grid (Mon-Sun)
- Each column shows session count per phone
- Rest days highlighted
- One-post days marked
- "Generate New Week" button

**Controls**:
- "Generate This Week" button -> calls planner, stores in DB
- "Regenerate From Today" button -> regenerates remaining days
- Week selector: previous/next week navigation
- "Download JSON" -> export current plan as JSON file

### R4: Warmup panel
In phone settings (per account) or as sub-section of Weekly Plan:

**Per-account warmup status**:
- Progress bar: "Day 3 of 7"
- Current day type: "Normal Day" / "Lazy Day" / "Dead Day (no app)"
- Daily caps: Likes 0-10, Comments 0, Follows 0, Posts 0
- Profile pic status: "Set on Day 2" / "Pending (Day 4)"
- Bio status: "Set on Day 1" / "Pending (Day 3)"
- "Warmup Completed" badge when done

**Controls**:
- "Reset Warmup" -> restart from Day 1 (re-randomize plan)
- "Skip to Day N" -> jump ahead (for testing)
- "Mark Completed" -> force-complete warmup
- "View Full Plan" -> expandable table showing all days with details

### R5: Timezone handling
- All times stored in DB as UTC
- All times displayed in UI as US/Eastern
- Timeline shows Eastern Time labels
- "Next session at 19:45 ET" format
- Server-side: `pytz.timezone('US/Eastern')` for conversions
- Client-side: JavaScript `Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York'})`

## Non-goals
- No drag-and-drop session reordering (plan is auto-generated)
- No manual session creation (planner generates all sessions)
- No Instagram planner integration yet (Instagram sessions are managed by existing system)

## Acceptance Criteria
1. "Generate This Week" creates a unified plan with warmup+regular sessions
2. Today's timeline shows sessions in Eastern Time with correct colors
3. Warmup accounts have appropriate engagement caps in the plan
4. Phone order varies daily (not deterministic)
5. Adding a phone mid-week regenerates remaining days correctly
6. Warmup panel shows progress per account
7. Reset/Skip warmup controls work
8. All times display in Eastern Time

## Files to Create/Modify
- `app/planner_service.py` — NEW: planner wrapper
- `app/planner_routes.py` — NEW: planner blueprint
- `app/templates/weekly-plan.html` — NEW: timeline page
- `app/static/js/weekly-plan.js` — NEW: timeline rendering
- `app/static/css/weekly-plan.css` — NEW: timeline styles
- `app/templates/phone-settings.html` — warmup panel in account section
- `Weekly & Daily Plan/planner/scheduler.py` — modify to unify warmup+regular
- `Weekly & Daily Plan/planner/rules_engine.py` — warmup rules integration
