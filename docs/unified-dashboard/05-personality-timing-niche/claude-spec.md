# Spec -- 05 Personality + Timing Presets + Niche Config

## Goal
Dashboard editors for TikTok behavioral configuration: personality trait viewer with evolution graphs, timing parameter presets with advanced slider editor, and niche keyword/threshold config.

## System Context

### Personality (7 traits per account)
- Stored in `BotAccount.personality_json`
- Traits: reels_preference, story_affinity, double_tap_habit, explore_curiosity, boredom_rate, boredom_relief, switch_threshold
- Each has a range (e.g., 0.2-0.8), evolves ~1.5% per session based on behavior
- 2 categorical traits (dominant_hand, comment_style) -- display-only, not editable

### Timing (72 log-normal params)
- Format: (median, sigma, min, max) in config.HUMAN dict
- 4 presets: Normal (1x), Cautious (1.3x), Aggressive (0.7x), Stealth (1.5x)
- Per-bot overrides via TimingOverride table
- DB models already exist: TimingPreset, TimingOverride

### Niche
- Description text + 21 keywords pool + follow-back threshold (55 base)
- Stored in BotAccount.niche_json
- Session samples 6-10 keywords randomly

## Requirements

### R1: Personality Viewer/Editor (phone-settings page)
- 7 trait sliders with range bounds
- Lock toggle per trait (prevents auto-evolution)
- Evolution line chart (Chart.js, last 30 sessions)
- Randomize All, Reset to Defaults, Save buttons
- Auto-save on slider drag (debounced 500ms)

### R2: Timing Editor (separate page /timing-editor)
- Preset selector dropdown with Apply button
- Advanced editor: 72 params in 7 category groups
- Each param: median slider, sigma slider, min/max inputs
- Live preview: 5 sample values from distribution
- Per-bot overrides saved to TimingOverride
- Override badge + Clear All Overrides button

### R3: Niche Config (phone-settings page)
- Niche description textarea
- Keywords tag input (add/remove)
- Follow-back threshold slider (40-70)
- Session keywords count slider (4-12)

### R4: Session Phase Display (phone-settings page)
- 5 phases shown as horizontal stacked bar
- Duration ranges displayed
- Read-only in v1

## Architecture Decisions
- Personality history: add personality_history_json to BotAccount (30-entry rolling)
- Chart.js via CDN for evolution graphs
- Timing editor: separate page (too many params for modal)
- Phase weights: display-only v1
- API pattern: follow existing /api/bots/<id>/... conventions
