<!-- PROJECT_CONFIG
runtime: python-pip
test_command: pytest
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-personality-api
section-02-personality-frontend
section-03-timing-api
section-04-timing-frontend
section-05-niche-config
section-06-phase-display
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-personality-api | - | 02 | Yes |
| section-02-personality-frontend | 01 | - | No |
| section-03-timing-api | - | 04 | Yes |
| section-04-timing-frontend | 03 | - | No |
| section-05-niche-config | - | - | Yes |
| section-06-phase-display | - | - | Yes |

## Execution Order

1. section-01-personality-api, section-03-timing-api, section-05-niche-config, section-06-phase-display (parallel -- no dependencies)
2. section-02-personality-frontend (after 01)
3. section-04-timing-frontend (after 03)

## Section Summaries

### section-01-personality-api
DB columns (personality_history_json, personality_locked_traits). Blueprint personality_bp with CRUD for traits, history, lock, randomize, reset. Tests for all endpoints.

### section-02-personality-frontend
Personality section in phone-settings.html: 7 trait sliders with lock toggles, Chart.js evolution graph, randomize/reset/save buttons. personality.js for slider handling, chart rendering, debounced auto-save.

### section-03-timing-api
Blueprint timing_bp: preset listing, bot preset assignment, override CRUD, custom preset creation. Timing editor template route.

### section-04-timing-frontend
timing-editor.html standalone page: preset selector, 7 category collapsible cards, param sliders with distribution preview. timing-editor.js for log-normal sampling, slider handling, override tracking. timing-editor.css for dark theme styles.

### section-05-niche-config
Niche API endpoints (GET/PUT on BotAccount.niche_json). Niche UI section in phone-settings: description textarea, keywords tag input, threshold slider, session count slider.

### section-06-phase-display
Read-only phase display in phone-settings: horizontal stacked bar with 5 phases, duration ranges, action weights. Static data from config or hardcoded.
