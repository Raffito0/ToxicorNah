# Section 05: Timeline Frontend

## Overview

This section creates the visual frontend for the weekly plan page: a Jinja2 template (`weekly-plan.html`), JavaScript module (`weekly-plan.js`), and CSS stylesheet (`weekly-plan.css`). The page has two tabs -- Today's Timeline (vertical 24-hour layout with session blocks) and Week Overview (7-column grid).

**Depends on:** Section 04 (API routes at `/api/planner/*`). Section 08 adds live polling on top of this.

## Files to Create

| File | Purpose |
|------|---------|
| `insta-phone-SAAS-sneder/app/templates/weekly-plan.html` | Jinja2 template |
| `insta-phone-SAAS-sneder/app/static/js/weekly-plan.js` | Timeline rendering, actions, detail modal |
| `insta-phone-SAAS-sneder/app/static/css/weekly-plan.css` | Dark theme styles |

## Files to Modify

| File | Change |
|------|--------|
| `insta-phone-SAAS-sneder/app/templates/after-login.html` | Add sidebar icon for "Weekly Plan" |

## Tests (Visual Verification)

```
# Verify: session blocks positioned proportionally by start/end time
# Verify: TikTok sessions blue (#25F4EE), Instagram pink (#E1306C)
# Verify: warmup sessions have dashed border
# Verify: clicking block opens detail modal
# Verify: current time marker (red line) updates position
# Verify: completed=green check, running=pulse, failed=red X
# Verify: 7 columns for Mon-Sun in Week Overview
# Verify: rest days highlighted orange
# Verify: Generate button calls POST /api/planner/weekly-plan/generate
# Verify: week navigation updates displayed week
```

## Implementation Details

### 1. Template (`weekly-plan.html`)

Standalone page (not a tab in after-login.html). Same head block: Bootstrap 5.3, Font Awesome 6.5, existing dashboard CSS, plus `weekly-plan.css`.

**Top bar:** Proxy group selector dropdown, week navigator (arrows + "Week N, YYYY" label), action buttons (Generate, Regenerate from Today, Download JSON).

**Tab switcher:** Bootstrap nav-tabs -- "Today" and "Week Overview".

**Today tab:** `div.timeline-container` with hour labels (00:00-23:00) and `div.timeline-track` for absolutely positioned session blocks. `div.time-marker` for current time red line. Empty state with "Generate This Week" button.

**Week Overview tab:** 7-column CSS grid. Each cell: date, session count, platform dots, rest/one-post badges.

**Detail modal:** Bootstrap 5 dark modal showing account, platform, phone, time range, duration, session type, post info, engagement caps, execution status.

### 2. JavaScript (`weekly-plan.js`)

State variables: `currentProxyId`, `currentWeekOffset`, `currentPlan`.

Core functions:
- `loadTodaySessions()` -- fetch `/api/planner/today-sessions`, call `renderTimeline()`
- `loadWeekPlan()` -- fetch `/api/planner/weekly-plan`, call `renderWeekOverview()`
- `renderTimeline(sessions)` -- position blocks by start/end time
- `renderWeekOverview(plan)` -- build 7-column grid
- `showSessionDetail(session)` -- populate and show modal
- `updateTimeMarker()` -- position red line, called every 60s
- `generatePlan()` -- POST generate, reload on 201
- `regeneratePlan()` -- POST regenerate with today's date
- `downloadJSON()` -- fetch export, trigger blob download
- `navigateWeek(direction)` -- change week offset, reload

**Block positioning:**
```
top = (startMinutes / 1440) * timelineHeight
height = (durationMinutes / 1440) * timelineHeight
minimum height = 20px
```

Parse `start_time_et` "HH:MM" to minutes from midnight for positioning.

**Block classes:** `.session-block`, `.platform-tiktok` / `.platform-instagram`, `.session-warmup` (dashed), `.status-completed` / `.status-running` / `.status-failed`.

**Page init (DOMContentLoaded):** Load today sessions, load week plan, start time marker interval.

### 3. CSS (`weekly-plan.css`)

Dark theme (#1a1a2e background, consistent with dashboard).

**Timeline:** `.timeline-container` flex layout. `.timeline-track` position relative, 960px height (40px/hour).

**Session blocks:** Absolute position, platform colors (TikTok: rgba(37,244,238,0.2) with solid #25F4EE left border, Instagram: rgba(225,48,108,0.2) with #E1306C border). Warmup: dashed border. Hover: scale(1.02) + shadow.

**Status indicators:** `::after` pseudo-elements. Completed: green check. Running: blue pulsing dot with `@keyframes pulse`. Failed: red X.

**Time marker:** 2px solid red line, z-index 10, with 8px red circle at left edge.

**Week grid:** `grid-template-columns: repeat(7, 1fr)`. Day cells: #1e1e1e background, rest days orange border, today accent border.

**Modal:** Dark card, blur backdrop.

**Responsive (<768px):** Full-width timeline, 2-column week grid, near-full-screen modal.

### 4. Sidebar Addition

Add to `after-login.html` sidebar:
```html
<div class="sidebar-icon" title="Weekly Plan" onclick="window.location.href='/weekly-plan'">
    <i class="fas fa-calendar-week"></i>
</div>
```

## Key Decisions

1. **Standalone page** -- complex enough to warrant its own page (like phone-settings.html)
2. **960px timeline height** -- 40px per hour, good density without excessive scrolling
3. **No client-side timezone math** -- API provides Eastern Time strings directly
4. **No WebSocket** -- initial load renders static. Section 08 adds 30s polling
