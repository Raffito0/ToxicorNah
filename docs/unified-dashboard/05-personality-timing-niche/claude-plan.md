# Implementation Plan -- 05 Personality + Timing Presets + Niche Config

## 1. Overview

### What We're Building
Dashboard editors for the three core behavioral systems: personality traits with evolution graphs, timing parameter presets with an advanced slider editor, and niche keyword/threshold configuration. All changes persist to the DB and are applied when the phone-bot starts a session.

### System Boundaries
- **Flask dashboard** (`insta-phone-SAAS-sneder/app/`) -- new routes, templates, JS/CSS
- **DB models** -- already exist (TimingPreset, TimingOverride, BotAccount.personality_json/niche_json). Add personality_history_json column.
- **Phone-bot** -- no changes needed (reads config from DB via tiktok_config.py translation layer)

---

## 2. Personality Editor

### 2.1 API Routes (`app/personality_routes.py`)

New blueprint `personality_bp`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/accounts/<id>/personality` | Get current personality + history |
| PUT | `/api/accounts/<id>/personality` | Update traits (partial update) |
| POST | `/api/accounts/<id>/personality/randomize` | Generate new random personality |
| POST | `/api/accounts/<id>/personality/reset` | Reset to default ranges |
| PUT | `/api/accounts/<id>/personality/lock` | Toggle lock on specific traits |

**Response shape:**
```json
{
  "success": true,
  "personality": {
    "traits": {"reels_preference": 0.65, ...},
    "locked_traits": ["boredom_rate"],
    "categorical": {"dominant_hand": 1, "comment_style": "reactor"},
    "sessions_count": 23
  },
  "history": [
    {"session": 1, "date": "2026-03-15", "traits": {...}},
    ...
  ]
}
```

### 2.2 DB Changes

Add to `ensure_columns()` in `__init__.py`:
```sql
ALTER TABLE bot_account ADD COLUMN personality_history_json JSON;
ALTER TABLE bot_account ADD COLUMN personality_locked_traits JSON;
```

`personality_history_json`: array of max 30 entries, each with session number + date + trait snapshot.
`personality_locked_traits`: array of trait names that should not auto-evolve.

### 2.3 Frontend (`phone-settings.html` + `personality.js`)

Add personality section to phone-settings, below warmup panel:
- 7 trait sliders with current value, min/max labels
- Lock icon toggle per trait
- Chart.js line chart (evolution over 30 sessions)
- Randomize All / Reset / Save buttons
- Debounced auto-save on slider change (500ms)

Chart.js config:
- Type: line
- 7 datasets (one per trait), toggleable via legend
- X-axis: session numbers
- Y-axis: 0-1 normalized
- Dark theme colors
- Tooltip: exact value + date

### 2.4 Personality Service (`personality_routes.py` inline)

Thin service -- read/write personality_json on BotAccount:
- GET: parse personality_json, return traits + history
- PUT: validate ranges, update personality_json, flag_modified
- Randomize: call `Personality.generate()` equivalent (random within ranges)
- Lock: update personality_locked_traits list

---

## 3. Timing Editor

### 3.1 API Routes (`app/timing_routes.py`)

New blueprint `timing_bp`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/timing/presets` | List all presets |
| GET | `/api/timing/presets/<id>` | Get preset params |
| GET | `/api/bots/<id>/timing` | Get bot's preset + overrides |
| PUT | `/api/bots/<id>/timing/preset` | Change bot's preset |
| POST | `/api/bots/<id>/timing/override` | Add/update param override |
| DELETE | `/api/bots/<id>/timing/override/<param>` | Remove override |
| DELETE | `/api/bots/<id>/timing/overrides` | Clear all overrides |
| POST | `/api/timing/presets` | Save custom preset |
| GET | `/timing-editor` | Render timing editor page |

### 3.2 Timing Editor Page (`timing-editor.html`)

Standalone page (like weekly-plan.html):
- Same sidebar with Timing icon active
- Top: Bot selector dropdown + Preset selector + Apply/Save buttons
- Main: 7 collapsible category cards
- Each card: list of param rows with sliders

**Param row layout:**
- Name + description (left)
- Median slider + value display
- Sigma slider + value display
- Min/Max number inputs
- Reset icon (if overridden, shows override badge)
- Live preview: 5 dots on a number line showing sample distribution

### 3.3 Distribution Preview (`timing-editor.js`)

For each param, sample 5 values from the log-normal distribution client-side:
```javascript
function sampleLogNormal(median, sigma, min, max) {
    const mu = Math.log(Math.max(median, 0.001));
    const val = Math.exp(mu + sigma * gaussianRandom());
    return Math.max(min, Math.min(max, val));
}
```

Show 5 dots on a mini number line (inline SVG or absolute-positioned spans).

### 3.4 Category Grouping

| Category | Param prefix/pattern | Count |
|----------|---------------------|-------|
| Cosmetic Waits | t_app_load, t_tab_switch, t_before_action, etc. | ~15 |
| Verification Waits | t_verify_*, t_fingerprint_*, t_bbox_* | ~12 |
| Recovery Waits | t_recovery_*, t_popup_*, t_nuclear_* | ~8 |
| Touch Physics | touch_pressure_*, touch_ramp_*, touch_hold_* | ~4 |
| Session Timing | t_session_gap, t_interrupt_*, zona_morta_* | ~10 |
| Engagement | t_like_*, t_comment_*, t_follow_*, post_like_* | ~12 |
| Search/Explore | t_search_*, t_grid_*, t_result_*, t_niche_* | ~9 |

Grouping is determined by param name prefix matching in the JS.

---

## 4. Niche Config

### 4.1 API (in `personality_routes.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/accounts/<id>/niche` | Get niche config |
| PUT | `/api/accounts/<id>/niche` | Update niche config |

### 4.2 Frontend (phone-settings.html + personality.js)

Below personality section:
- Niche description textarea
- Keywords tag input (Bootstrap-style tags)
- Follow-back threshold slider (40-70)
- Session keywords count slider (4-12)
- Suggested keywords dropdown

---

## 5. Session Phase Display

### 5.1 Frontend (phone-settings.html)

Below niche config:
- Horizontal stacked bar showing 5 phases with colors
- Duration ranges displayed below each phase
- Read-only in v1

Phase data comes from a static config endpoint or hardcoded in JS (phases don't change per-bot in v1).

---

## 6. File Structure

```
insta-phone-SAAS-sneder/
  app/
    __init__.py                    # MODIFY: register blueprints, add columns
    personality_routes.py          # NEW: personality + niche CRUD
    timing_routes.py               # NEW: timing presets + overrides
    templates/
      phone-settings.html         # MODIFY: add personality, niche, phase sections
      timing-editor.html          # NEW: timing editor page
    static/
      js/
        personality.js             # NEW: personality sliders, chart, niche tags
        timing-editor.js           # NEW: timing sliders, distribution preview
      css/
        timing-editor.css          # NEW: timing editor styles
```

---

## 7. Implementation Order

1. **DB columns** -- personality_history_json, personality_locked_traits
2. **Personality API** -- CRUD routes for traits + history
3. **Personality frontend** -- sliders, chart, lock toggles
4. **Timing API** -- preset listing, bot preset, overrides CRUD
5. **Timing frontend** -- editor page with sliders + distribution preview
6. **Niche API + frontend** -- description, keywords, threshold
7. **Phase display** -- stacked bar (read-only)
