
---

# Section 03 — Visual Templates 1–8 (visual-templates.js, Part A)

## Overview

Create `n8n/code/insiderbuying/visual-templates.js` — the first 8 of 15 HTML data card templates. Each template is a pure function `(data) => htmlString` that builds a standalone HTML page ready for the screenshot server.

Section 04 will add templates T9–T15 and `renderTemplate()` to the same file.

## Dependency

Requires Section 01 (`visual-css.js`) to be complete first.

## File to Create / Extend

```
n8n/code/insiderbuying/visual-templates.js
```

## Test File

```
tests/insiderbuying/visual-templates.test.js
```

## Tests to Write First

### Template HTML Generation (T1–T8)

```
# Test: T1 Data Card returns HTML containing company name
# Test: T1 Data Card escapes HTML in company name ("O'Reilly" → "O&#39;Reilly")
# Test: T1 Data Card includes verdict badge with correct color for "BUY"
# Test: T2 SEC Filing Mini Card returns HTML with ticker and amount
# Test: T3 Comparison Card includes both current and historical sections
# Test: T4 Transaction Table renders all rows from transactions array
# Test: T4 Transaction Table empty transactions array does not throw
# Test: T5 Price Chart includes Chart.js CDN script and canvas element
# Test: T5 Price Chart includes annotation config for buyDate
# Test: T6 Revenue Trend includes Chart.js config with dual axis
# Test: T7 Football Field renders horizontal bars with correct CSS widths
# Test: T7 Football Field shows current price marker
# Test: T8 Peer Radar includes Chart.js radar config with 6 axes
```

### Defensive Data Handling

```
# Test: T1 with undefined stats array renders without throwing (shows "N/A")
# Test: T2 with null insiderPhotoUrl renders without broken img tag
# Test: T3 with missing historical.outcome shows fallback text
# Test: all templates normalize verdict via normalizeVerdict()
```

Write the test file first, then implement. Run: `npm test -- tests/insiderbuying/visual-templates.test.js`

## Core Patterns (apply to ALL templates)

### 1. HTML escaping — required on every dynamic string

```javascript
const { escapeHtml, normalizeVerdict, VERDICTS, COLORS, wrapTemplate } = require('./visual-css');

// BAD — breaks for "O'Reilly" or "Bed Bath & Beyond"
`<span>${data.companyName}</span>`

// GOOD
`<span>${escapeHtml(data.companyName)}</span>`
```

### 2. Optional chaining with fallbacks — required on every data access

```javascript
// BAD — throws if stats is undefined
data.stats[0].label

// GOOD — renders "N/A" instead of crashing
data.stats?.[0]?.label ?? 'N/A'
```

### 3. Verdict normalization

```javascript
const verdictKey = normalizeVerdict(data.verdict);   // always a VERDICTS key
const verdictInfo = VERDICTS[verdictKey];             // { label, color }
```

### 4. Template structure

```javascript
function t1DataCard(data) {
  // 1. Extract + normalize data
  // 2. Build inner HTML
  // 3. Return wrapTemplate(innerHtml, width, height)
}
```

Each template returns a complete HTML document string. NOT a PNG buffer.

## Template Definitions

### T1 — Data Card (1200×675)

**Purpose**: Main social card for X (Twitter) posts. The primary visual for announcing an insider buy.

**Data**:
```javascript
{
  insiderPhotoUrl: string | null,  // circular photo top-left
  companyName: string,             // escapeHtml required
  ticker: string,                  // e.g. "NVDA"
  amount: string,                  // e.g. "$15.2M" — pre-formatted
  verdict: string,                 // normalized via normalizeVerdict()
  stats: [{ label: string, value: string }],  // up to 3 stats
  date: string,                    // e.g. "March 14, 2025"
  watermark?: string,              // "earlyinsider.com"
}
```

**Layout**:
- Dark navy background (`#0A1128`)
- Top bar: insider circular photo (56px) + company name (h2) + ticker badge (pill)
- Center hero: transaction amount in large bold font
- Verdict badge (glassmorphism, colored border matching verdict)
- Stats row: 3 metrics side by side (label in secondary text, value in primary)
- Bottom bar: date (left) + watermark (right)

### T2 — SEC Filing Mini Card (600×337)

**Purpose**: Compact card for replies/Reddit threads where size matters.

**Data**:
```javascript
{
  insiderPhotoUrl: string | null,
  insiderName: string,     // escapeHtml required
  insiderTitle: string,    // escapeHtml required
  ticker: string,
  amount: string,
  date: string,
  verdict: string,
}
```

**Layout**:
- Left half: circular photo (48px) + insider name + title in secondary text
- Right half: ticker (large) + amount + date
- Verdict chip (small pill, verdict color background) centered bottom

### T3 — Comparison Card (1200×675)

**Purpose**: Historical analogy — "Last time this CEO bought this much, the stock was up 34% in 6 months."

**Data**:
```javascript
{
  current: {
    ticker: string,
    amount: string,
    date: string,
  },
  historical: {
    description: string,   // "Previous cluster buy: March 2020" — escapeHtml
    outcome: string,       // "+34% in 6 months" — escapeHtml
    timeframe: string,     // "6 months" — escapeHtml
  },
}
```

**Layout**:
- Two equal columns separated by gradient divider
- Left column: "CURRENT" label + current ticker/amount/date
- Right column: "LAST TIME" label + historical description + outcome in green text
- Fallback: if `historical.outcome` is missing/empty → show "Historical data unavailable"

### T4 — Insider Transaction Table (1200×675)

**Purpose**: Show multiple recent insider buys in a clean dark table.

**Data**:
```javascript
{
  title: string,         // escapeHtml required
  transactions: [{
    insiderPhotoUrl: string | null,
    name: string,        // escapeHtml required
    title: string,       // escapeHtml required
    date: string,
    shares: string,
    value: string,       // pre-formatted dollar amount
    type: 'purchase' | 'sale',
    change: string,      // stock change e.g. "+4.2%"
  }],
}
```

**Layout**:
- Title bar at top
- Dark HTML table: column headers (Name, Title, Date, Shares, Value, Change)
- Each row: circular photo (32px inline) + name in first column
- Row tint: `type === 'purchase'` → `rgba(40,167,69,0.1)` background; `type === 'sale'` → `rgba(220,53,69,0.1)`
- Empty array: renders table with headers but no data rows (no throw)

### T5 — Price Chart with Buy Marker (1200×675)

**Purpose**: Show stock price history with a vertical "CEO bought here" annotation marker.

**Data**:
```javascript
{
  ticker: string,
  priceHistory: [{ date: string, price: number }],
  buyDate: string,    // x-axis label for annotation
  buyLabel: string,   // annotation text, e.g. "CEO bought $15M"
  volumeData?: [{ date: string, volume: number }],   // optional second axis
}
```

**Layout**: Embeds Chart.js line chart directly in the HTML page (CDN script tag). Annotation plugin included. `buyDate` → vertical line annotation in green. If `volumeData` provided, second y-axis on right side.

This template handles chart embedding inline — it does NOT call `generate-chart.js`. The Chart.js config is built inside the template HTML.

### T6 — Revenue Trend (1200×675)

**Purpose**: 8-quarter revenue bar chart with gross margin line overlay.

**Data**:
```javascript
{
  ticker: string,
  quarters: [{ label: string, revenue: number, margin: number }],  // up to 8 quarters
}
```

**Layout**: Embeds Chart.js inline. Bars = revenue (left y-axis, blue), line = margin% (right y-axis, gold `#FFC107`). Both axes labeled. No annotation plugin needed.

### T7 — Valuation Football Field (1200×675)

**Purpose**: Horizontal range bars showing valuation ranges from different methods.

**Data**:
```javascript
{
  ticker: string,
  currentPrice: number,
  methods: [{ name: string, low: number, high: number }],  // up to 6 methods
}
```

**Layout**: Pure HTML/CSS — NO Chart.js.
- Each method = one row: label (left) + horizontal bar (CSS width % relative to max)
- Bar = gradient from `#2A3548` to `#4A9EFF` spanning low→high range
- Current price marker = thin vertical line (CSS `position: absolute`) at correct %
- Green zone highlighting for ranges below current price (undervalued)

To compute bar positions: `leftPct = (low / maxHigh) * 100`, `widthPct = ((high - low) / maxHigh) * 100`

### T8 — Peer Radar (600×600)

**Purpose**: Spider chart comparing subject company vs peer average on 6 axes.

**Data**:
```javascript
{
  ticker: string,
  subjectScores: { revenueGrowth: number, margins: number, valuation: number, insiderActivity: number, momentum: number, analystRating: number },
  peerAvgScores: { revenueGrowth: number, margins: number, valuation: number, insiderActivity: number, momentum: number, analystRating: number },
}
```

**Layout**: Embeds Chart.js radar inline.
- Always 600×600
- 6 axes: `['Revenue Growth', 'Margins', 'Valuation', 'Insider Activity', 'Momentum', 'Analyst Rating']`
- Dataset 1 (subject): `#4A9EFF` border, `rgba(74,158,255,0.3)` fill
- Dataset 2 (peer avg): `#8892A4` border, `rgba(136,146,164,0.15)` fill

## Module Structure

```javascript
'use strict';
const { escapeHtml, normalizeVerdict, VERDICTS, COLORS, BASE_CSS, wrapTemplate } = require('./visual-css');

function t1DataCard(data) { ... }
function t2SecFilingMiniCard(data) { ... }
function t3ComparisonCard(data) { ... }
function t4InsiderTransactionTable(data) { ... }
function t5PriceChart(data) { ... }
function t6RevenueTrend(data) { ... }
function t7ValuationFootballField(data) { ... }
function t8PeerRadar(data) { ... }

// Section 04 will add t9 through t15 and renderTemplate() to this file

module.exports = {
  t1DataCard,
  t2SecFilingMiniCard,
  t3ComparisonCard,
  t4InsiderTransactionTable,
  t5PriceChart,
  t6RevenueTrend,
  t7ValuationFootballField,
  t8PeerRadar,
  // renderTemplate added in Section 04
};
```

## Acceptance Criteria

- [x] All test stubs above pass
- [x] `t1DataCard({ companyName: "O'Reilly", ... })` HTML contains `O&#39;Reilly`
- [x] `t4InsiderTransactionTable({ transactions: [] })` does not throw
- [x] `t1DataCard({ verdict: 'buy', ... })` HTML contains `#28A745` (BUY color)
- [x] `t5PriceChart(data)` HTML contains `cdn.jsdelivr.net/npm/chart.js`
- [x] `t7ValuationFootballField(data)` HTML does NOT contain `chart.js` (pure CSS)
- [x] All templates return strings starting with `<!DOCTYPE html>`

## Implementation Notes (Actual)

- Files created: `n8n/code/insiderbuying/visual-templates.js`, `tests/insiderbuying/visual-templates.test.js`
- T5/T6/T8 embed Chart.js inline; config serialized via `JSON.stringify()` (not template literal JS object)
- T7 is pure CSS with percentage-based bar widths
- Code review auto-fixes applied: T5 rewritten to use JSON.stringify (removes quote injection); removed escapeHtml from JSON.stringify context (T6/T8); T7 m.low/m.high escaped; T4 change column color sign-aware
- 46/46 tests pass
