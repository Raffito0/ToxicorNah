# 05 — Personality + Timing Presets + Niche Config

## Goal
Dashboard editors for TikTok behavioral configuration: personality trait viewer with evolution graphs, timing parameter presets with advanced slider editor, and niche keyword/threshold config.

## Context
- 7 personality traits per account, evolve ~1.5% per session, persistent in BotAccount.personality_json
- 72 log-normal timing parameters in config.HUMAN dict, format: (median, sigma, min, max)
- Niche: description text + 17 keywords pool + follow-back threshold (55 base)
- Decision from interview: presets + advanced edit icon to manually adjust individual params via sliders

## Dependencies
- 01-db-schema-migration (TimingPreset, TimingOverride tables, personality_json/niche_json in BotAccount)

## Requirements

### R1: Personality Viewer/Editor
In account settings modal, TikTok tab:

**Trait display** (7 traits):
| Trait | Range | Description |
|-------|-------|-------------|
| reels_preference | 0.2-0.8 | IG: Reels vs Feed preference |
| story_affinity | 0.05-0.5 | IG: watch stories tendency |
| double_tap_habit | 0.25-0.9 | double-tap vs heart button |
| explore_curiosity | 0.03-0.2 | search/explore tendency |
| boredom_rate | 0.06-0.18 | how fast boredom accumulates |
| boredom_relief | 0.25-0.55 | engagement reduces boredom |
| switch_threshold | 0.55-0.85 | boredom triggers view switch |

Each trait shows:
- Current value as slider (draggable to edit)
- Min/max bounds
- "Lock" toggle icon — prevents auto-evolution for this trait
- Description tooltip

**Evolution graph**:
- Line chart showing trait values over last 30 sessions
- One line per trait (toggleable)
- X-axis: session number, Y-axis: trait value
- Hover shows exact value + session date
- Library: Chart.js (already available or lightweight)

**Controls**:
- "Randomize All" button: generate new personality within bounds
- "Reset to Defaults" button: restore config.py defaults
- "Save" button: update BotAccount.personality_json
- Auto-save on slider drag (debounced 500ms)

### R2: Timing Parameters Editor
New sub-page or modal accessible from phone settings:

**Preset selector** (top of page):
- Dropdown: Cautious / Normal / Aggressive / Stealth / Custom
- "Apply Preset" button: fills all params with preset values
- "Save as Custom Preset" button: save current values as new preset
- Description of selected preset below dropdown

**Preset definitions**:
| Preset | Philosophy | Key differences |
|--------|-----------|-----------------|
| Cautious | Maximum safety, slower but undetectable | 1.3x median delays, 1.2x sigma, longer recovery waits |
| Normal | Balanced (current config.py defaults) | Original values from config.HUMAN |
| Aggressive | Faster sessions, higher throughput | 0.7x median delays, same sigma, shorter verifications |
| Stealth | Minimal Gemini calls, pixel-only where possible | Longer between-action waits, fewer verify retries |

**Advanced editor** (toggle via "Advanced" icon/button):
- Grouped cards by category:
  1. **Cosmetic Waits** (15 params): t_app_load, t_tab_switch, t_before_action, etc.
  2. **Verification Waits** (12 params): t_verify_page, t_fingerprint_wait, t_bbox_wait, etc.
  3. **Recovery Waits** (8 params): t_recovery_back, t_popup_dismiss, t_nuclear_wait, etc.
  4. **Touch Physics** (6 params): pressure_*, contact_size_*
  5. **Session Timing** (10 params): t_session_gap, t_interrupt_*, etc.
  6. **Engagement Timing** (12 params): t_like_delay, t_comment_type, t_follow_wait, etc.
  7. **Search/Explore** (9 params): t_search_type, t_grid_scroll, t_result_watch, etc.

Each param card:
- Name + description
- Median slider (range: 0.1 to param_max*2)
- Sigma slider (range: 0.05 to 1.0)
- Min/Max number inputs
- "Reset" icon (restore to preset value)
- Live preview: 5 sample values from distribution shown as dots on number line

**Per-bot overrides**:
- If a param is changed from preset, it's saved to TimingOverride table
- Override badge shows which params differ from preset
- "Clear All Overrides" button restores pure preset

### R3: Niche Config
In account settings modal, TikTok tab:

**Niche description**:
- Textarea: "Target niche for Gemini evaluation" (e.g. "toxic relationships, red flags, dating drama")
- Used in Gemini prompts for follow-back niche scoring

**Keywords pool**:
- Tag input field: type keyword + Enter to add
- Each tag is removable (X button)
- Current keywords shown as tags
- "Add Suggested" dropdown: pre-built keyword lists (relationships, fitness, comedy, etc.)
- Session sampling: 6-10 keywords per session (display current sample count setting)

**Follow-back threshold**:
- Slider: 40-70 range
- Current value display
- Description: "Minimum niche fit score to follow back. Lower = more follows, higher = stricter"
- Formula display: `threshold = base - social*10 + fatigue*5, clamped [40,70]`

**Session keywords count**:
- Slider: 4-12 range
- Description: "How many keywords to sample per session"

### R4: Session Phase Weights
In account settings modal, TikTok tab (or timing editor):

**Phase display** (5 phases):
- Arrival, Warmup, Peak, Fatigue, Exit
- Duration range per phase
- Action weight breakdown as horizontal stacked bar
- Editable weights per phase (sliders summing to 100%)

## Non-goals
- No A/B testing of presets
- No auto-optimization of timing params based on results
- No per-session personality editing (only per-account)

## Acceptance Criteria
1. Personality traits displayed as sliders with lock toggle
2. Evolution graph shows last 30 sessions of trait values
3. 4 timing presets available, "Apply Preset" fills all params
4. Advanced editor shows 72 params grouped by category
5. Individual param sliders with live distribution preview
6. Per-bot overrides saved to TimingOverride table
7. Niche description, keywords, and threshold editable
8. Session phase weights displayed and editable
9. All changes persist to DB

## Files to Create/Modify
- `app/templates/phone-settings.html` — personality, niche sections in TikTok tab
- `app/static/js/personality.js` — NEW: personality UI + chart
- `app/templates/timing-editor.html` — NEW: timing presets + advanced editor
- `app/static/js/timing-editor.js` — NEW: sliders, presets, distribution preview
- `app/static/css/timing-editor.css` — NEW: timing editor styles
- `app/timing_routes.py` — NEW: timing API endpoints
- `app/routes.py` — personality/niche CRUD endpoints
