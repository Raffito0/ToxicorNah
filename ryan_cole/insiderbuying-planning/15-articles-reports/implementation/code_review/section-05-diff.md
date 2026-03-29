# Section 05 Diff — Charts, PDF, Preview

## New functions added to generate-report.js

### getReportConfig(reportType)
- 4-key lookup table: single/complex/sector/bundle → price + coverTemplate
- Throws `'Unrecognized report type: X'` for unknown types (no silent wrong pricing)

### resolveCharts(settledResults)
- Maps `Promise.allSettled` results → base64 data URIs or placeholder HTML
- Fulfilled: `Buffer.from(result.value).toString('base64')` → `data:image/png;base64,...`
- Rejected: logs warn, returns `<div class="chart-unavailable">Chart temporarily unavailable</div>`
- Never throws — entire array always resolves

### buildReportHTML — polymorphic dispatch
- `typeof sectionsOrContent === 'string'` → delegates to `_buildReportHTMLLegacy` (old tests unchanged)
- Object first arg → delegates to `_buildReportHTMLFromSections` (new S05 path)

### _buildReportHTMLFromSections(sections, charts, config)
- Page order: cover img → exec_summary → insider_intelligence → price chart + banner → remaining 8 sections
- `escapeHTML` applied to all section text
- Banner: `<div class="continue-reading-banner"><p>CONTINUE READING - Full report: $${config.price}</p>...`
- CSS: `@page`, `@page :first`, `section { break-before: page }`, banner styles

### generateReportPDF(htmlString, config, fetchFn)
- POST to `http://host.docker.internal:3456/weasyprint` with `Content-Type: text/html`
- `res.arrayBuffer()` → `Buffer.from(arrayBuf)`
- Size check: `buffer.length > 8 * 1024 * 1024` → throws with MB size in message

### generatePreviewPDF(fullPdfBuffer)
- `require('pdf-lib')` inside function (safe for n8n sandbox — only loads when called)
- `Math.min(sourceDoc.getPageCount(), 5)` — handles short PDFs correctly
- 0-page: indices array is empty, `copyPages` receives `[]`, no throw
- Returns `Buffer.from(bytes)` not raw `Uint8Array`

## Tests: 55/55 passing (node:test) + 15/15 (Jest)
