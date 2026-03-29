---

# Section 04 — Visual Templates 9–15 + renderTemplate() (visual-templates.js, Part B)

## Overview

Complete `n8n/code/insiderbuying/visual-templates.js` with templates T9–T15 and the main `renderTemplate()` orchestrator. This section extends the file created in Section 03.

## Dependencies

- Section 01 (`visual-css.js`) must be complete
- Section 03 (T1–T8 in `visual-templates.js`) must be complete

## File to Extend

```
n8n/code/insiderbuying/visual-templates.js
```

(Add T9–T15 functions and `renderTemplate()` to the existing file)

## Tests to Add

Add to the existing `tests/insiderbuying/visual-templates.test.js`:

### Templates T9–T15

```
# Test: T9 Market Movers renders all movers in table format
# Test: T10 Contrarian Card includes narrative text and evidence metrics
# Test: T11 Newsletter Stats shows subscriber count and rates
# Test: T12 Sector Heatmap renders grid cells with scaled opacity
# Test: T12 empty sectors array does not throw
# Test: T13 Article Hero is 1200x630 and includes title/category
# Test: T14 Alert Score Badge is 400x400 with score number
# Test: T15 Weekly Leaderboard renders ranked leaders list
```

### renderTemplate() Integration (mocked screenshot server)

```
# Test: renderTemplate(1, data, {}, helpers) calls screenshot server
# Test: renderTemplate invalid templateId (0, 16, "foo") throws Error
# Test: renderTemplate with opts.upload=true calls uploadChart and returns URL
# Test: renderTemplate with opts.upload=false returns PNG buffer directly
# Test: renderTemplate passes correct viewport dimensions per template ID
```

Run: `npm test -- tests/insiderbuying/visual-templates.test.js`

## Template Definitions (T9–T15)

All templates follow the same patterns as T1–T8: `escapeHtml()` on all dynamic strings, optional chaining with fallbacks, `normalizeVerdict()` for verdicts, `wrapTemplate()` for HTML document.

### T9 — Market Movers (1200×675)

**Purpose**: Weekly digest showing top 3 insider buys.

**Data**:
```javascript
{
  title: string,            // escapeHtml required
  weekLabel: string,        // e.g. "Week of March 10, 2025"
  movers: [{
    rank: number,           // 1, 2, 3
    ticker: string,
    insiderName: string,    // escapeHtml required
    amount: string,         // pre-formatted
    verdict: string,        // normalized via normalizeVerdict()
  }],
}
```

**Layout**: Ranked table with colored rank pills (gold/silver/bronze for top 3), ticker in bold, verdict badge per row.

### T10 — Contrarian Card (1200×675)

**Purpose**: When signals are bearish despite insider activity — contrarian narrative card.

**Data**:
```javascript
{
  ticker: string,
  narrative: string,        // escapeHtml required — 1-2 sentence analysis
  evidence: [{
    metric: string,         // escapeHtml required
    value: string,          // escapeHtml required
    interpretation: string, // escapeHtml required
  }],
  verdict: string,          // typically CAUTION or WAIT
}
```

**Layout**: Verdict badge prominent top-right. Narrative in large italic. Evidence list: metric name + value + interpretation in rows with subtle separators.

### T11 — Newsletter Stats (1200×675)

**Purpose**: Performance dashboard for the weekly newsletter.

**Data**:
```javascript
{
  weekLabel: string,
  subscribers: string,    // e.g. "12,450"
  openRate: string,       // e.g. "42.3%"
  clickRate: string,      // e.g. "8.1%"
  topArticle: {
    title: string,        // escapeHtml required
    clicks: string,       // e.g. "2,341"
  },
}
```

**Layout**: 3 large stat cards (glassmorphism) in a row: subscribers / open rate / click rate. Below: "Top Article This Week" section with title and click count.

### T12 — Sector Activity Heatmap (1200×675)

**Purpose**: Visualize insider buying activity across market sectors.

**Data**:
```javascript
{
  sectors: [{
    name: string,         // escapeHtml required
    activity: number,     // 0–100 (activity intensity)
    topTicker: string,    // e.g. "NVDA"
  }],
}
```

**Layout**: CSS grid (3-4 columns). Each cell: sector name (top) + top ticker (center) + activity number (small bottom). Cell background: `rgba(40, 167, 69, ${activity/100})` — higher activity = more opaque green.

Empty `sectors` array → renders grid container with no cells (no throw).

### T13 — Article Hero (1200×630)

**Purpose**: OG image / blog post header for EarlyInsider article pages.

**Data**:
```javascript
{
  title: string,          // escapeHtml required — up to 80 chars
  subtitle?: string,      // escapeHtml required
  category: string,       // escapeHtml required — e.g. "Insider Activity"
  date: string,
  authorName?: string,    // escapeHtml required
}
```

**Dimensions**: 1200×630 (standard OG image size — slightly different from other 1200×675 cards)

**Layout**: Category badge (top-left). Title in large serif or bold sans. Subtitle below. Date and author at bottom. Subtle gradient background from `#0A1128` to `#1A2238`.

### T14 — Alert Score Badge (400×400)

**Purpose**: Standalone score indicator for alerts/notifications.

**Data**:
```javascript
{
  score: number,   // 0–100
  verdict: string, // drives the ring color
  ticker: string,
}
```

**Dimensions**: 400×400 (square)

**Layout**: Large score number (center, 80px font). Verdict color ring around the score (CSS `border-radius: 50%`). Ticker text below score. Verdict label at bottom.

### T15 — Weekly Leaderboard (1200×675)

**Purpose**: Performance ranking of insider signals from the past week.

**Data**:
```javascript
{
  title: string,         // escapeHtml required
  weekLabel: string,
  leaders: [{
    rank: number,
    ticker: string,
    insiderName: string, // escapeHtml required
    returnPct: string,   // e.g. "+12.4%" — pre-formatted
    verdict: string,
  }],
}
```

**Layout**: Ranked list (not table). Each row: rank pill + ticker (bold) + insider name + return percentage (green for positive, red for negative) + verdict badge. Top performer highlighted with a subtle glow.

## renderTemplate() — Main Entry Point

```javascript
/**
 * Render any template to PNG and optionally upload to R2.
 * @param {number} templateId - 1 through 15
 * @param {object} data - Template-specific data object
 * @param {object} opts - { upload?: boolean, name?: string }
 * @param {object} helpers - { fetchFn, env, _sleep }
 * @returns {Promise<Buffer|string>} PNG buffer if upload=false, R2 URL if upload=true
 */
async function renderTemplate(templateId, data, opts = {}, helpers) { ... }
```

### Implementation Details

1. **Validate templateId**: Must be integer 1–15. Throw `Error('Invalid templateId: must be 1–15')` for anything outside that range (0, 16, null, "foo", etc.)

2. **Template map**: Object mapping templateId → `[templateFn, width, height]`
   ```javascript
   const TEMPLATE_MAP = {
     1:  [t1DataCard, 1200, 675],
     2:  [t2SecFilingMiniCard, 600, 337],
     3:  [t3ComparisonCard, 1200, 675],
     4:  [t4InsiderTransactionTable, 1200, 675],
     5:  [t5PriceChart, 1200, 675],
     6:  [t6RevenueTrend, 1200, 675],
     7:  [t7ValuationFootballField, 1200, 675],
     8:  [t8PeerRadar, 600, 600],
     9:  [t9MarketMovers, 1200, 675],
     10: [t10ContrarianCard, 1200, 675],
     11: [t11NewsletterStats, 1200, 675],
     12: [t12SectorHeatmap, 1200, 675],
     13: [t13ArticleHero, 1200, 630],
     14: [t14AlertScoreBadge, 400, 400],
     15: [t15WeeklyLeaderboard, 1200, 675],
   };
   ```

3. **Call template function**: `const html = templateFn(data)` → full HTML document string

4. **POST to screenshot server**:
   ```javascript
   // URL: http://host.docker.internal:3456/screenshot
   // Body: { html, viewport: { width, height }, format: 'png' }
   // Verify response.ok and Content-Type starts with 'image/'
   // Get PNG buffer from response
   ```

5. **Clamp dimensions** before screenshot: width and height each clamped to [200, 3000]

6. **Return**:
   - If `opts.upload === true`: call `uploadChart(buffer, opts.name || 'template', helpers)` → return R2 URL string
   - Otherwise: return PNG buffer

## Updated Module Exports

```javascript
module.exports = {
  // T1–T8 (from Section 03)
  t1DataCard,
  t2SecFilingMiniCard,
  t3ComparisonCard,
  t4InsiderTransactionTable,
  t5PriceChart,
  t6RevenueTrend,
  t7ValuationFootballField,
  t8PeerRadar,
  // T9–T15 (this section)
  t9MarketMovers,
  t10ContrarianCard,
  t11NewsletterStats,
  t12SectorHeatmap,
  t13ArticleHero,
  t14AlertScoreBadge,
  t15WeeklyLeaderboard,
  // Main entry point
  renderTemplate,
};
```

## Acceptance Criteria

- [x] All test stubs above pass
- [x] `renderTemplate(0, ...)` throws with descriptive message
- [x] `renderTemplate(16, ...)` throws with descriptive message
- [x] `renderTemplate('foo', ...)` throws with descriptive message
- [x] `renderTemplate(1, data, { upload: false }, helpers)` returns Buffer
- [x] `renderTemplate(1, data, { upload: true }, helpers)` returns string URL
- [x] `renderTemplate(13, ...)` posts viewport `{ width: 1200, height: 630 }` (not 675)
- [x] `renderTemplate(14, ...)` posts viewport `{ width: 400, height: 400 }`
- [x] `t12SectorHeatmap({ sectors: [] })` does not throw

## Implementation Notes (Actual)

- Extended `n8n/code/insiderbuying/visual-templates.js` with T9-T15 + renderTemplate
- Code review auto-fixes: T12 activity value wrapped in escapeHtml; T11 ?? guards at stat call sites; renderTemplate data=null guard; T15 returnPct ?? null-safe; error message truncated to 20 chars
- 87/87 tests pass
