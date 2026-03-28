# EarlyInsider Brand Consistency System

## Problem

The site has 13 pages built independently. While the overall design looks good, computed styles vary wildly across pages: 23 font sizes, 26 text colors, 34 background colors, 8 border-radius values, 12 letter-spacing values, and inconsistent section padding (40-390px horizontal, 48-128px vertical). This creates a subtle "something feels off" impression that undermines the institutional credibility EarlyInsider needs.

## Goal

Standardize all visual properties into a single design token system applied via `globals.css` and Tailwind `@theme`. No layout changes, no redesign — only consistency.

## Audit Data

Full Playwright audit of all 13 pages at https://earlyinsider.com (2026-03-28). Raw data in `tmp_brand_audit/audit_data.json`, summary in `tmp_brand_audit/audit_summary.md`.

### Key inconsistencies found

| Category | Current state | Target |
|----------|--------------|--------|
| Font sizes | 23 unique values (8px-60px) | 7 tokens |
| Text colors | 26 unique values | 3 tokens + 2 brand |
| Background colors | 34 unique values (4 near-identical off-whites) | 3 tokens + 2 brand |
| Border colors | 16 unique values | 2 tokens |
| Border radii | 8 values (2px-16px) | 2 tokens (0px + pill) |
| Letter spacings | 12 values | 2 values (normal + 0.5px) |
| H1 sizes | 42px, 48px, 54px, 60px across pages | 54px everywhere |
| H2 weights | 400 on some pages, 700 on others | 400 for section titles, 700 for sub-sections |
| H2 margin-bottom | 12+ different values (0-80px) | 24px uniform |
| Section vertical padding | 48px to 128px randomly | 96px standard, 128px hero |
| Section horizontal padding | 32px to 390px randomly | max-w-[1200px] container |

---

## Design Tokens

### Fonts

Three font families, unchanged from current:

| Token | Family | Role |
|-------|--------|------|
| `--font-montaga` | Montaga, serif | Headings (display, title, heading, subheading) |
| `--font-inter` | Inter, sans-serif | Body text, UI, buttons |
| `--font-mono` | Space Mono, monospace | Ticker symbols, prices, financial data |

### Typography Scale

7 levels. All heading levels use Montaga. Body/small/caption use Inter.

| Token | Tag | Size | Weight | Line-Height | Letter-Spacing | Margin-Bottom | Use |
|-------|-----|------|--------|-------------|----------------|---------------|-----|
| `display` | h1 | 54px | 400 | 1.15 | normal | 24px | Page title (one per page) |
| `title` | h2 | 42px | 400 | 1.2 | normal | 24px | Section headers |
| `heading` | h3 | 24px | 700 | 1.3 | normal | 16px | Sub-section titles, card group labels |
| `subheading` | h4 | 18px | 700 | 1.4 | normal | 12px | Card titles, feature names |
| `body` | p | 16px | 400 | 1.6 | normal | 0 | Default paragraph text |
| `small` | - | 14px | 400 | 1.5 | normal | 0 | Captions, metadata, secondary info |
| `caption` | - | 12px | 500 | 1.4 | 0.5px | 0 | Overlines, labels, badges |

Rules:
- `display` and `title` are always Montaga weight 400 (elegant, not heavy)
- `heading` and `subheading` are Montaga weight 700 (functional, scannable)
- No other font sizes should exist. Map any outlier to the nearest token
- No other letter-spacing values. Only `normal` and `0.5px` for captions

### Colors

#### Brand

| Token | Hex | RGB | Use |
|-------|-----|-----|-----|
| `--color-primary` | `#000592` | 0, 5, 146 | CTAs, active states, link hover, highlights |
| `--color-primary-dark` | `#000250` | 0, 2, 80 | Dark CTA section backgrounds |
| `--color-navy` | `#002A5E` | 0, 42, 94 | Blog subscribe banner, premium accent sections |

#### Text (3 tokens, replacing 26 values)

| Token | Hex | RGB | Use |
|-------|-----|-----|-----|
| `--color-text` | `#1C1B1B` | 28, 27, 27 | Headings, primary body text |
| `--color-text-secondary` | `#454556` | 69, 69, 86 | Descriptions, subtitles, secondary paragraphs |
| `--color-text-muted` | `#94A3B8` | 148, 163, 184 | Timestamps, metadata, placeholders, disabled |

Eliminated colors: `#5C6670`, `#757788`, `#1A1A1A`, `#9FAAB6`, `#C6C5D9` (as text), and all `lab()`/`oklab()` values. Each maps to the nearest of the 3 tokens above.

#### Backgrounds (3 tokens, replacing 4+ near-identical off-whites)

| Token | Hex | Use |
|-------|-----|-----|
| `--color-bg-white` | `#FFFFFF` | Primary content sections |
| `--color-bg-alt` | `#F6F3F2` | Alternating sections (zebra pattern) |
| `--color-bg-dark` | `#151414` | Footer |

Eliminated: `#FCF9F8`, `#F5F6F8`, `#F5F5F5`, `#F0F1F3`, `#F3F4F6`, `#F5F6F8`, `#FCF9F8`, `#E0E0FF`. All map to either `bg-white` or `bg-alt`.

#### Signals (financial data indicators)

| Token | Hex | Use |
|-------|-----|-----|
| `--color-signal-green` | `#006D34` | Buy signals, positive metrics, green text |
| `--color-signal-green-bg` | `#C4E6D0` | Green badge/chip backgrounds |
| `--color-signal-red` | `#930A0A` | Sell signals, warnings, red text |
| `--color-signal-red-bg` | `#FFDAD6` | Red badge/chip backgrounds |

#### Borders (2 tokens, replacing 16 values)

| Token | Hex | Use |
|-------|-----|-----|
| `--color-border` | `#E5E2E1` | Cards, dividers, table borders |
| `--color-border-light` | `#F0EDED` | Subtle separators within sections |

Eliminated: `#C6C5D9`, `#D1D6DA`, `#E8EAED`, `#E9E7E7`, `#D9D9D9` — all map to `--color-border`.

### Spacing

#### Section-level

| Token | Value | Use |
|-------|-------|-----|
| `section-y` | `96px` (mobile: `64px`) | Vertical padding for all content sections |
| `section-y-hero` | `128px` (mobile: `80px`) | Hero sections with colored backgrounds |
| `section-x` | `max-w-[1200px] mx-auto px-6 md:px-10` | Horizontal content constraint |

Replaces the current chaos of 40px, 72px, 88px, 90px, 98px, 100px, 128px, 150px, 190px, 192px, 222px, 240px, 250px, 256px, 304px, 390px horizontal paddings.

#### Component-level

| Token | Value | Use |
|-------|-------|-----|
| `gap-section` | `64px` | Space between section heading and section content |
| `gap-cards` | `32px` | Gap between cards in a grid |
| `gap-items` | `24px` | Gap between items in a list or stack |
| `gap-tight` | `16px` | Gap within a card or between closely related elements |

### Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `radius-card` | `0px` | Cards, containers, sections — sharp, institutional |
| `radius-pill` | `9999px` | Badges, chips, tags, toggle pills |

All other radius values (2px, 4px, 6px, 8px, 12px, 16px) are eliminated.

### Buttons / CTAs

3 variants. All use Inter 14px weight 700, `0px` border-radius, padding `14px 28px`.

| Variant | Background | Text | Border |
|---------|-----------|------|--------|
| `primary` | `#000592` | `#FFFFFF` | none |
| `outline` | transparent | `#000592` | 1px solid `#000592` |
| `dark` | `#151414` | `#FFFFFF` | none |

### Section Rhythm (zebra pattern)

Every page follows the same background alternation:

```
Hero section     → bg-alt OR primary-dark → py section-y-hero
Section 1        → bg-white              → py section-y
Section 2        → bg-alt                → py section-y
Section 3        → bg-white              → py section-y
...alternating...
CTA section      → primary-dark          → py section-y
Footer           → bg-dark               → py 64px
```

---

## Implementation Approach

### Phase 1: Update globals.css

Expand the `@theme` block with all tokens defined above. Add base styles for `h1`, `h2`, `h3`, `h4` tags and utility classes for sections.

### Phase 2: Page-by-page token replacement

For each of the 13 pages, replace hardcoded Tailwind values with design tokens:
- `text-[54px]` → `text-[length:var(--text-display)]` or a utility class
- `text-[#1c1b1b]` → `text-text` (Tailwind theme token)
- `bg-[#F6F3F2]` → `bg-bg-alt`
- `py-[128px]` → `py-[var(--section-y-hero)]` or utility class
- `rounded-[8px]` → `rounded-none`
- etc.

Order: globals.css first, then pages from simplest to most complex:
1. `privacy`, `terms` (legal pages, simplest)
2. `contact`
3. `faq`
4. `blog`
5. `reports`
6. `free-report`
7. `about`
8. `methodology`
9. `how-it-works`
10. `alerts`
11. `pricing`
12. `page.tsx` (homepage, most sections)

### Phase 3: Verification

Re-run the Playwright audit script. Target: 0 hardcoded color values, 0 off-system font sizes, consistent section padding across all pages.

---

## What Does NOT Change

- Page layouts (no sections moved, added, or removed)
- Content (no text changes)
- Font families (Montaga + Inter + Space Mono stay)
- Responsive breakpoints
- Component structure (no new components created)
- Functionality

## Success Criteria

1. Playwright re-audit shows: max 7 font sizes, max 5 text colors, max 5 background colors, max 2 border-radius values
2. Every page follows the zebra section rhythm (bg-white / bg-alt alternating)
3. All H1s are 54px/400, all section H2s are 42px/400, all sub-section H3s are 24px/700
4. All sections use consistent vertical padding (96px standard, 128px hero)
5. All sections use `max-w-[1200px]` horizontal content constraint
6. Visual diff shows no layout shifts — only color/size/spacing normalization
