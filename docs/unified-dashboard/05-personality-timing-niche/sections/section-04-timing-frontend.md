# Section 04 -- Timing Editor Frontend

## Overview
Standalone `/timing-editor` page with preset selector, 7 collapsible category cards grouping ~72 params, sliders with live log-normal distribution preview, override tracking, and auto-save.

## Dependencies
- Section 03 (timing API endpoints).

## Files
- `app/templates/timing-editor.html` -- NEW: standalone page
- `app/static/js/timing-editor.js` -- NEW: all JS logic
- `app/static/css/timing-editor.css` -- NEW: dark theme styles

## Implementation

### Template (timing-editor.html)
- Sidebar with timing icon active
- Top bar: bot selector, preset selector, Apply/Save Custom/Clear Overrides buttons
- 7 collapsible category cards (Bootstrap accordion)
- Each card: param rows with median slider, sigma slider, min/max inputs, preview dots, reset icon

### JavaScript (timing-editor.js)

**Category grouping** by param name prefix:
1. Cosmetic Waits (t_app_load, t_tab_switch, etc.)
2. Verification (t_verify_*, t_fingerprint_*, t_bbox_*)
3. Recovery (t_recovery_*, t_popup_*, t_nuclear_*)
4. Touch Physics (touch_*)
5. Session Timing (t_session_*, zona_morta_*)
6. Engagement (t_like_*, t_comment_*, t_follow_*)
7. Search/Explore (t_search_*, t_grid_*, t_niche_*)

**Log-normal sampling** (client-side):
```javascript
function sampleLogNormal(median, sigma, min, max) {
    const mu = Math.log(Math.max(median, 0.001));
    const val = Math.exp(mu + sigma * gaussianRandom());
    return Math.max(min, Math.min(max, val));
}
```

**Distribution preview**: 5 dots on a mini number line per param.

**Auto-save**: 300ms debounce per param -> POST override or DELETE if matching preset.

**Override detection**: compare current values to preset defaults, show/hide badge.

### CSS (timing-editor.css)
- Dark theme (#121212 bg, #1e1e1e cards)
- Param rows: grid layout, border-bottom #333
- Sliders: accent-color #d62976
- Preview dots: 6px circles, pink with varying opacity
- Override badge: small pill, pink bg

## Tests (visual)
```
# Verify: 7 categories with correct param grouping
# Verify: distribution preview updates on slider change
# Verify: override badge appears/disappears
# Verify: Apply Preset repopulates all sliders
# Verify: Clear All Overrides restores preset values
# Verify: Save as Custom creates new preset
```
