---

# Section 05 — Report Covers (report-covers.js)

## Overview

Create `n8n/code/insiderbuying/report-covers.js` — 4 HTML/CSS report cover templates rendered via screenshot server with upload to R2. Used by `generate-report.js` (W15) and `generate-lead-magnet.js` (W16).

## Dependency

Requires Section 01 (`visual-css.js`) to be complete first.

## File to Create

```
n8n/code/insiderbuying/report-covers.js
```

## Test File

```
tests/insiderbuying/report-covers.test.js
```

## Tests to Write First

```
# Test: renderCoverA returns HTML with ticker and company name
# Test: renderCoverA escapes HTML in thesis text
# Test: renderCoverA uses 1240x1754 viewport for A4
# Test: renderCoverA screenshot request includes deviceScaleFactor: 2
# Test: renderCoverB renders 6 stock cards in data grid
# Test: renderCoverB with fewer than 6 stocks does not throw
# Test: renderCoverC renders 10 ticker pills in 2 rows
# Test: renderCoverC includes metric bar with stats
# Test: renderCoverD uses 1200x675 viewport (web size)
# Test: renderCoverD does NOT use deviceScaleFactor: 2 (web only)
# Test: renderCoverD includes mesh gradient CSS
# Test: all covers call uploadChart and return R2 URL on success
# Test: cover render propagates screenshot server error
```

Write the test file first, then implement. Run: `npm test -- tests/insiderbuying/report-covers.test.js`

## Sizes and Scale Factors

| Cover | Width | Height | deviceScaleFactor | Purpose |
|-------|-------|--------|-------------------|---------|
| A (Single Stock) | 1240 | 1754 | **2** | A4 print quality |
| B (Sector) | 1240 | 1754 | **2** | A4 print quality |
| C (Bundle) | 1240 | 1754 | **2** | A4 print quality |
| D (Hero Featured) | 1200 | 675 | 1 | Web/social |

The `deviceScaleFactor: 2` on print covers means the actual pixel output is 2480×3508, providing crisp print text. Web cover (D) does NOT use `deviceScaleFactor: 2`.

## Screenshot Server Call Pattern

Each cover function POSTs to the screenshot server with:

```javascript
// For print covers (A, B, C):
{
  html: htmlString,
  viewport: { width: 1240, height: 1754, deviceScaleFactor: 2 },
  format: 'png'
}

// For web cover (D):
{
  html: htmlString,
  viewport: { width: 1200, height: 675 },
  format: 'png'
}
```

Screenshot server URL: `http://host.docker.internal:3456/screenshot`

After screenshot, upload PNG buffer to R2 via `uploadChart(buffer, name, helpers)` (from `generate-chart.js`). Return the R2 URL.

## Cover Definitions

### Cover A — Single Stock Report ($14.99)

**Function**: `renderCoverA(data, helpers)` → Promise\<string\> (R2 URL)

**Data**:
```javascript
{
  ticker: string,           // hero center text, e.g. "NVDA"
  companyName: string,      // escapeHtml required
  logoUrl: string | null,   // company logo top-left (from getCompanyLogo)
  verdict: string,          // normalized to VERDICTS key
  price: string,            // e.g. "$875.40"
  marketCap: string,        // e.g. "$2.1T"
  insiderScore: number,     // 1–5, used for star rating display
  thesis: string,           // escapeHtml required — italic hook statement
  date: string,             // report date
}
```

**Layout**:
- Full bleed dark navy background (`#0A1128`)
- Top bar: company logo (48px) top-left + "INSIDER INTELLIGENCE REPORT" label + date top-right
- Center: ticker in 64px bold white hero text
- Verdict badge (glassmorphism container, colored border)
- 3 metric cards side by side: current price / market cap / insider signal (star rating 1–5)
- Hook thesis in italic below metrics (80% width, centered)
- Abstract network SVG decorative pattern at bottom (inline SVG, no external dependencies)
- EarlyInsider branding strip at bottom

**Network SVG**: A simple decorative pattern made of connected dots/lines. Inline SVG, no external dependencies. Semi-transparent (`opacity: 0.15`). Example:
```html
<svg viewBox="0 0 400 100" ...>
  <circle cx="50" cy="50" r="3" fill="#4A9EFF" opacity="0.4"/>
  <!-- more circles and lines connecting them -->
</svg>
```

### Cover B — Sector Report ($19.99)

**Function**: `renderCoverB(data, helpers)` → Promise\<string\> (R2 URL)

**Data**:
```javascript
{
  sectorName: string,       // escapeHtml required, e.g. "Technology"
  title: string,            // escapeHtml required, creative report title
  stocks: [{
    ticker: string,
    verdict: string,        // normalized to VERDICTS key
    upside: string,         // e.g. "+34%" — pre-formatted
  }],                       // 1–6 stocks; fewer than 6 does not throw
}
```

**Layout**:
- Two zones split by a gradient separator bar
- Top zone (40% height): editorial. Sector name in large text + creative title. "SECTOR ANALYSIS" chip in yellow top-right.
- Bottom zone (60% height): data grid. Up to 6 stock cards in a 3×2 grid. Each card: ticker (bold) + verdict badge + upside percentage. Cards use glassmorphism.
- Fewer than 6 stocks: grid renders with available cards, empty cells are omitted (no placeholder)

### Cover C — Bundle Report ($24.99–$29.99)

**Function**: `renderCoverC(data, helpers)` → Promise\<string\> (R2 URL)

**Data**:
```javascript
{
  title: string,            // escapeHtml required
  stats: {
    totalPurchases: string, // e.g. "47"
    avgUpside: string,      // e.g. "+28%"
    buyPct: string,         // e.g. "73%"
  },
  stocks: [{
    ticker: string,
    verdict: string,        // drives pill border color
  }],                       // up to 10 stocks
  pageCount: string,        // e.g. "127 pages"
}
```

**Layout**:
- Hero metric bar (glassmorphism, full width): 3 stats in a row — total purchases / avg upside / % rated BUY
- Title (large, emphasizes "collection" or bundle nature)
- 10 ticker pills in 2 rows of 5. Each pill: border colored by verdict (`VERDICTS[key].color`), ticker text white.
- Page count badge bottom-right (small pill)

### Cover D — Hero Featured (Web, 1200×675)

**Function**: `renderCoverD(data, helpers)` → Promise\<string\> (R2 URL)

**Data**:
```javascript
{
  title: string,            // escapeHtml required
  subtitle: string,         // escapeHtml required
  stats: [{
    label: string,          // escapeHtml required
    value: string,          // escapeHtml required
  }],                       // 3 stats
  tickers: string[],        // ticker preview pills
  ctaText?: string,         // escapeHtml required, e.g. "Get the full report →"
}
```

**Dimensions**: 1200×675 (NOT A4). NO `deviceScaleFactor: 2`.

**Layout**:
- Mesh gradient glow background: CSS `radial-gradient` layers in blue/purple tones overlaid on `#0A1128`. Example:
  ```css
  background:
    radial-gradient(ellipse at 20% 50%, rgba(74,158,255,0.15) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(124,58,237,0.12) 0%, transparent 50%),
    #0A1128;
  ```
- "FEATURED REPORT" badge top-right in yellow
- Editorial title (large) + subtitle (secondary text) — left-aligned
- 3 glassmorphism stat cards in a horizontal row
- Ticker pill preview row + CTA text at bottom

## Common Pattern

```javascript
async function renderCoverX(data, helpers) {
  const { escapeHtml, VERDICTS, normalizeVerdict, BASE_CSS, COLORS } = require('./visual-css');
  const { uploadChart } = require('./generate-chart');

  // 1. Build HTML string
  const html = `<!DOCTYPE html>...`;

  // 2. POST to screenshot server
  const screenshotServerUrl = 'http://host.docker.internal:3456/screenshot';
  const viewport = { width: 1240, height: 1754, deviceScaleFactor: 2 }; // or 1200x675 for D
  const response = await helpers.fetchFn(screenshotServerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, viewport, format: 'png' }),
  });
  if (!response.ok) throw new Error(`Screenshot server error: ${response.status}`);
  const buffer = await response.buffer();

  // 3. Upload to R2 and return URL
  return uploadChart(buffer, 'cover-a', helpers);
}
```

## Module Exports

```javascript
'use strict';
const { escapeHtml, normalizeVerdict, VERDICTS, COLORS, BASE_CSS } = require('./visual-css');
const { uploadChart } = require('./generate-chart');

module.exports = {
  renderCoverA,
  renderCoverB,
  renderCoverC,
  renderCoverD,
};
```

## Acceptance Criteria

- [x] All test stubs above pass
- [x] `renderCoverA` screenshot request has `viewport.deviceScaleFactor === 2`
- [x] `renderCoverD` screenshot request does NOT have `deviceScaleFactor` (or it equals 1)
- [x] `renderCoverA(data, helpers)` returns a string (R2 URL)
- [x] `renderCoverB({ stocks: [{ ticker: 'NVDA', verdict: 'BUY', upside: '+20%' }] })` does not throw (only 1 of 6 stocks)
- [x] `renderCoverA` HTML escapes `thesis` field (test with `<script>` injection)
- [x] Error from screenshot server propagates out of the render function
- [x] `renderCoverD` HTML contains `radial-gradient` (mesh gradient CSS)

## Implementation Notes (Actual)

- Files created: `n8n/code/insiderbuying/report-covers.js`, `tests/insiderbuying/report-covers.test.js`
- Shared `takeScreenshot(html, viewport, helpers)` helper extracts fetch+error-check pattern used by all 4 covers
- `helpers.env.SCREENSHOT_SERVER_URL` used for screenshot URL (with fallback to hardcoded default)
- Cover D viewport has no `deviceScaleFactor` property (undefined); test assertion tightened to `.toBeUndefined()`
- Code review auto-fixes: `BASE_CSS` unused import removed; `logoUrl` validated for `http(s)://` scheme before use in `<img src>`; R2 key slugs built from raw ticker/sectorName (not HTML-escaped values); Cover D test assertion tightened from `.not.toBe(2)` to `.toBeUndefined()`
- 19/19 tests pass
