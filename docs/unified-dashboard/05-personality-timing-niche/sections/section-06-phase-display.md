# Section 06 -- Session Phase Display

## Overview
Read-only session phase visualization in phone-settings: horizontal stacked bar showing 5 phases (Arrival, Warmup, Peak, Fatigue, Exit) with duration ranges and action weight breakdowns. Data is hardcoded in JS (phases are global, not per-bot in v1).

## Dependencies
- None (fully parallel).

## Implementation

### HTML (phone-settings.html)
Add `#phasesSection` div with:
- Stacked bar container (`#phaseBar`)
- Expandable details panel (`#phaseDetails`)

### JavaScript (personality.js)
Hardcoded phase data mirroring config.SESSION_PHASES:
```javascript
const SESSION_PHASES = {
    arrival:  { duration: [2, 3],  color: '#4a6fa5', actions: { 'FYP Scroll': 93, 'Like': 3, 'Inbox': 3 } },
    warmup:   { duration: [3, 5],  color: '#e8a838', actions: { 'FYP Scroll': 77, 'Like': 6, ... } },
    peak:     { duration: [7, 12], color: '#e05555', actions: { 'FYP Scroll': 69, 'Like': 6, ... } },
    fatigue:  { duration: [5, 10], color: '#7c6bbf', actions: { 'FYP Scroll': 85, 'Like': 5, ... } },
    exit:     { duration: [2, 3],  color: '#5a8a6a', actions: { 'FYP Scroll': 94, 'Like': 4, ... } },
};
```

`renderSessionPhases()`:
- Segment width proportional to duration midpoint
- Click segment -> show action weights as mini horizontal bars
- Duration ranges below each segment

### CSS
- Phase bar: flex, 36px height, rounded
- Segments: cursor pointer, hover highlight
- Details: compact table or mini bars

## Tests (visual)
```
# Verify: 5 colored segments render proportionally
# Verify: click shows action weight breakdown
# Verify: duration ranges displayed
# Verify: read-only (no edit controls)
```
