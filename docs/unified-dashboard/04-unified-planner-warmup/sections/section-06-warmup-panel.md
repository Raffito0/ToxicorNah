# Section 06: Warmup Panel

## Overview

This section adds warmup visibility and control in two locations:

1. **Weekly Plan page** (right panel) -- summary cards showing warmup progress per account
2. **Phone Settings page** -- full warmup management per BotAccount: reset, skip, complete, caps display

Both consume the warmup API endpoints from section 04.

**Depends on:** Section 04 (API routes), Section 03 (warmup service functions)

## Tests (Visual/Manual)

```
# Verify: warmup summary cards appear in right panel of Today's Timeline tab
# Verify: each card shows account name, progress bar, day type badge
# Verify: progress bar fills proportionally (day 3/7 = ~43%)
# Verify: day type badges: dead=red, lazy=orange, normal=green
# Verify: phone-settings warmup section appears per BotAccount
# Verify: caps table displays likes, comments, follows ranges
# Verify: Reset/Skip/Complete buttons trigger confirmation before POST
# Verify: completed warmup shows badge, controls disabled
# Verify: dark theme consistent with dashboard
```

## Implementation

### Part 1: Warmup Summary Cards (Weekly Plan page)

Add right panel in Today's Timeline tab (`weekly-plan.html`):

```html
<div id="warmup-summary-panel" class="warmup-summary-panel" style="display: none;">
    <h6 class="text-muted mb-3">WARMUP STATUS</h6>
    <div id="warmup-cards-container"></div>
</div>
```

Layout: flex row with timeline (flex: 1) + warmup panel (280px). Mobile: stack below.

Each card shows: account name, progress bar (`current_day / total_days`), day type badge (color-coded), caps summary line.

### Part 2: Warmup Controls (Phone Settings)

Add to `phone-settings.html` inside `#settingsContent`:

- Status header: day counter + day type badge + "Complete" badge
- Progress bar (8px height)
- Profile pic / bio milestones (day + done/pending)
- Engagement caps table (Action / Min / Max columns)
- Collapsible full plan summary table
- Action buttons: Reset (warning), Skip to Day (info), Mark Complete (success)

### Part 3: JavaScript

**In `weekly-plan.js`:**
- `loadWarmupSummary(accountNames)` -- fetch warmup status per account, render cards
- `renderWarmupCard(warmupStatus)` -- build card HTML
- `dayTypeBadgeClass(dayType)` -- dead=bg-danger, lazy=bg-warning, normal=bg-success

**In `phone-settings-main.js`:**
- `loadWarmupPanel(accountName)` -- fetch, populate all fields
- `renderWarmupCaps(caps)` -- build caps table rows
- `renderWarmupMilestones(profilePic, bio)` -- inline badges
- `renderWarmupPlanSummary(planSummary)` -- full plan table
- `warmupReset()` -- confirm + POST reset
- `warmupSkipPrompt()` -- prompt for day + POST skip
- `warmupComplete()` -- confirm + POST complete

### Part 4: CSS (in `weekly-plan.css`)

```css
.warmup-summary-panel { width: 280px; flex-shrink: 0; padding: 1rem; border-left: 1px solid rgba(255,255,255,0.1); }
.warmup-summary-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.warmup-settings-section { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 16px; margin-bottom: 20px; }
.warmup-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.warmup-actions { display: flex; gap: 8px; }
@media (max-width: 768px) { .warmup-summary-panel { width: 100%; border-left: none; border-top: 1px solid rgba(255,255,255,0.1); } }
```

## Edge Cases

- No warmup accounts: panel hidden
- All completed: panel hidden, phone settings shows "Complete" badge
- API errors: show toast, keep previous state visible
- Skip validation: target must be > current_day and <= total_days
