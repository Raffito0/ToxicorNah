---

# Section 01 — Shared CSS Utilities (visual-css.js)

## Overview

Create `n8n/code/insiderbuying/visual-css.js` — the design foundation shared by all 15 templates, 4 covers, and the chart generation module. This is a pure data/utility CommonJS module with no external dependencies and no network calls.

**This section must be implemented first.** All other sections depend on it.

## File to Create

```
n8n/code/insiderbuying/visual-css.js
```

## Dependencies

None. This is the root module.

## Tests to Write First

File: tests for visual-css.js functions are tested indirectly via template and chart tests. However write direct unit tests inline in `tests/insiderbuying/visual-css.test.js`:

```
# Test: escapeHtml escapes & to &amp;
# Test: escapeHtml escapes < to &lt; and > to &gt;
# Test: escapeHtml escapes " to &quot; and ' to &#39;
# Test: escapeHtml returns empty string for null/undefined input
# Test: normalizeVerdict("buy") returns "BUY"
# Test: normalizeVerdict("SELL") returns "SELL"
# Test: normalizeVerdict("unknown") returns "HOLD" (safe default)
# Test: normalizeVerdict(undefined) returns "HOLD"
# Test: wrapTemplate wraps inner HTML in <!DOCTYPE html> with BASE_CSS
# Test: wrapTemplate output contains Inter @font-face declarations
# Test: VERDICTS.BUY.color equals #28A745
# Test: COLORS.bg equals #0A1128
```

Write the test file first, then implement until tests pass. Run: `npm test -- tests/insiderbuying/visual-css.test.js`

## Exports

The module exports these values and functions:

### `COLORS` (Object)

All hex values from the design system:

```javascript
const COLORS = {
  bg: '#0A1128',
  bgSecondary: '#1A2238',
  bgCard: '#1A2238',
  bgBorder: '#2A3548',
  textPrimary: '#FFFFFF',
  textSecondary: '#8892A4',
  green: '#28A745',
  red: '#DC3545',
  yellow: '#FFC107',
  blue: '#4A9EFF',
  purple: '#7C3AED',
};
```

### `VERDICTS` (Object)

Centralized verdict definitions. All templates MUST use this — never hardcode verdict colors.

```javascript
const VERDICTS = {
  BUY:     { label: 'BUY',     color: '#28A745' },
  SELL:    { label: 'SELL',    color: '#DC3545' },
  HOLD:    { label: 'HOLD',    color: '#FFC107' },
  CAUTION: { label: 'CAUTION', color: '#FF6B35' },
  WAIT:    { label: 'WAIT',    color: '#8892A4' },
};
```

### `escapeHtml(str)` (Function)

**Critical utility** — every dynamic string in every template MUST be wrapped in this.

```javascript
// Escapes: & → &amp;  < → &lt;  > → &gt;  " → &quot;  ' → &#39;
// Returns '' for null/undefined input
function escapeHtml(str) { ... }
```

### `normalizeVerdict(str)` (Function)

Normalizes free-text verdict strings to VERDICTS keys. Returns 'HOLD' for unknown/undefined values.

```javascript
// Examples: "buy" → "BUY", "Buy" → "BUY", "SELL" → "SELL", undefined → "HOLD"
function normalizeVerdict(str) { ... }
```

### `INTER_FONT_CSS` (String)

Base64-encoded `@font-face` declarations for Inter font weights 400, 500, 600, 700 in WOFF2 format. This eliminates the Google Fonts CDN dependency — the screenshot server renders the correct font without any network requests.

**How to obtain the base64 data**: Download Inter WOFF2 files from `https://fonts.google.com/specimen/Inter` or `https://rsms.me/inter/`. Base64-encode each file: `base64 -w 0 inter-400.woff2`. Embed as data URIs in `@font-face` declarations.

The CSS structure:
```css
@font-face {
  font-family: 'Inter';
  font-weight: 400;
  src: url('data:font/woff2;base64,{BASE64_DATA}') format('woff2');
}
/* repeat for 500, 600, 700 */
```

### `DESIGN_TOKENS` (String)

CSS custom properties block as a string, for embedding in templates:

```css
:root {
  --bg: #0A1128;
  --bg-secondary: #1A2238;
  --bg-card: #1A2238;
  --bg-border: #2A3548;
  --text-primary: #FFFFFF;
  --text-secondary: #8892A4;
  --green: #28A745;
  --red: #DC3545;
  --yellow: #FFC107;
  --blue: #4A9EFF;
  --radius: 12px;
  --shadow: 0 4px 24px rgba(0,0,0,0.4);
}
```

### `BASE_CSS` (String)

Complete base stylesheet string. Includes: `INTER_FONT_CSS` + CSS reset + body styles + utility classes.

Body styles:
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0A1128; color: #FFFFFF; font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
```

Utility classes to include: `.glass-card`, `.verdict-badge`, `.stat-row`, `.ticker-pill`

### Glassmorphism CSS constants

CSS strings for reusable UI elements:

- **`glassCard`**: `backdrop-filter: blur(12px); background: rgba(26,34,56,0.85); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.4);`
- **`verdictBadge`**: CSS snippet for verdict badge (pill shape, uses VERDICTS colors). Pass `verdictKey` to get the correct color.
- **`statRow`**: CSS for stat metric rows (label + value side by side, secondary text for label)
- **`tickerPill`**: CSS for ticker pills with colored border

### `wrapTemplate(innerHtml, width, height)` (Function)

Wraps inner HTML in a complete HTML document ready for the screenshot server:

```javascript
function wrapTemplate(innerHtml, width, height) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width}, height=${height}">
  <style>${BASE_CSS}</style>
</head>
<body style="width:${width}px;height:${height}px;overflow:hidden;">
  ${innerHtml}
</body>
</html>`;
}
```

## Module Export

```javascript
module.exports = {
  COLORS,
  VERDICTS,
  DESIGN_TOKENS,
  BASE_CSS,
  INTER_FONT_CSS,
  escapeHtml,
  normalizeVerdict,
  glassCard,
  verdictBadge,
  statRow,
  tickerPill,
  wrapTemplate,
};
```

## Implementation Notes

1. `escapeHtml(null)` and `escapeHtml(undefined)` must return `''` — not throw
2. `normalizeVerdict('unknown_anything')` must return `'HOLD'` — safe default
3. The base64 Inter font data will be large (~200KB+) — this is expected and required for screenshot-server font rendering
4. All CSS classes use design tokens, not hardcoded hex values
5. CommonJS only — `module.exports`, no ES6 `import`/`export`

## Acceptance Criteria

- [x] All 12 test stubs above pass (30 total — test file expanded with additional coverage)
- [x] `escapeHtml("O'Reilly & Company <em>test</em>")` returns `"O&#39;Reilly &amp; Company &lt;em&gt;test&lt;/em&gt;"`
- [x] `normalizeVerdict('buy')` returns `'BUY'`
- [x] `VERDICTS.BUY.color === '#28A745'`
- [x] `COLORS.bg === '#0A1128'`
- [x] `wrapTemplate('<div>hello</div>', 1200, 675)` returns a string starting with `<!DOCTYPE html>`
- [x] The output of `wrapTemplate` contains `@font-face` declarations

## Code Review Findings (auto-fixed)

- Added `--purple: #7C3AED` to DESIGN_TOKENS (was missing despite being in COLORS)
- Added `.stat-row:last-child { border-bottom: none }` to BASE_CSS
- Added width/height clamping in wrapTemplate: clamp to [200, 3000] range

## Deployment Note

`INTER_FONT_CSS` uses placeholder base64 stubs. Before production deployment, embed real Inter WOFF2 base64 data (weights 400/500/600/700). `base64 -w 0 inter-400.woff2` from https://rsms.me/inter/
