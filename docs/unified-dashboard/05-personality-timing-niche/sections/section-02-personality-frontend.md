# Section 02 -- Personality Frontend

## Overview
Personality editor UI in phone-settings: 7 trait sliders with lock toggles, Chart.js evolution graph, randomize/reset/save buttons. New `personality.js` file.

## Dependencies
- Section 01 (personality API endpoints must exist).

## Files
- `app/static/js/personality.js` -- NEW: sliders, chart, debounced auto-save
- `app/templates/phone-settings.html` -- MODIFY: add personality section + Chart.js CDN

## Implementation

### HTML (phone-settings.html)
- Add `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>` to head
- Add `#personalitySection` div after warmup section with:
  - 7 trait slider rows (data-driven from API response)
  - Each row: name label, range slider, value display, lock toggle icon
  - `<canvas id="personalityChart">` for evolution graph
  - Randomize All / Reset / Save buttons
- Add `<script src="personality.js"></script>` (non-module)

### JavaScript (personality.js)
Key functions:
- `loadPersonalityPanel(accountId)` -- GET personality, show section, render sliders + chart
- `renderTraitSliders(traits, lockedTraits)` -- create slider rows dynamically
- `renderEvolutionChart(history)` -- Chart.js line chart, 7 datasets, dark theme
- `debouncedSave()` -- 500ms debounce on slider change -> PUT traits
- `toggleLock(traitKey)` -- PUT lock endpoint, toggle UI
- `randomizePersonality()` -- POST randomize, refresh
- `resetPersonality()` -- POST reset, refresh

### Chart.js Config
- Type: line, 7 datasets with distinct colors
- X-axis: session numbers, Y-axis: 0-1
- Dark grid (#333), light ticks (#999), tension 0.3
- Legend toggleable, tooltip with value + date

### Integration
Add `loadPersonalityPanel(accountId)` call in `phone-settings-main.js` after `loadWarmupPanel()`.

## Tests (visual)
```
# Verify: 7 sliders with correct ranges
# Verify: lock toggle changes icon and disables slider
# Verify: Chart.js renders with history data
# Verify: debounced auto-save works (500ms)
# Verify: randomize skips locked traits
```
