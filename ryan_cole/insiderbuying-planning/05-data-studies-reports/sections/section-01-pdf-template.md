# Section 01: PDF Template

## Objective
Create shared HTML/CSS PDF template with InsiderBuying.ai branding for data studies, premium reports, and lead magnets.

## Implementation

### 1. Create template directory
Create `pdf-templates/` at project root.

### 2. Base template HTML
Create `pdf-templates/base-template.html`:
- Header: EarlyInsider logo, report title, date, type badge (data-study/premium/lead-magnet)
- Colors: Navy #002A5E header, white body, #00D26A for positive, #FF3B3B for negative
- Fonts: Google Fonts CDN — Montaga for headings, Inter for body, Space Mono for data/numbers
- Chart placeholder divs (populated by render-pdf.js)
- Footer: disclaimer ("This report is for informational purposes only and does not constitute financial advice."), page numbers, earlyinsider.com URL
- Cover page: title, period, key stat highlight, subtle background pattern
- Page size: US Letter (8.5x11), 50px margins
- CSS in style tag (inline, for Puppeteer)

### 3. Report-specific templates
Create `pdf-templates/data-study.html` — extends base with: key findings grid, methodology section, charts area, implications section
Create `pdf-templates/premium-report.html` — extends base with: executive summary, per-ticker analysis sections, risk assessment, conclusion
Create `pdf-templates/lead-magnet.html` — extends base with: backtest summary, performance table, top 5 performers, cluster analysis, CTA box

### 4. Template rendering helper
Create `pdf-templates/render-template.js` (CommonJS):
- loadTemplate(type) — reads HTML file, returns string
- populateTemplate(html, data) — replaces {{placeholders}} with data values
- Exports: loadTemplate, populateTemplate

## Tests
- Test: loadTemplate('data-study') returns string containing 'EarlyInsider'
- Test: loadTemplate('premium-report') returns string containing 'Executive Summary'
- Test: loadTemplate('lead-magnet') returns string containing 'backtest'
- Test: populateTemplate replaces {{title}} correctly
- Test: populateTemplate handles missing placeholder gracefully (leaves as-is)
- Test: All templates contain disclaimer text

## Acceptance Criteria
- [ ] 3 PDF templates with consistent branding
- [ ] Templates render in browser (manual check)
- [ ] Disclaimer present on all templates
- [ ] Fonts load from Google Fonts CDN
