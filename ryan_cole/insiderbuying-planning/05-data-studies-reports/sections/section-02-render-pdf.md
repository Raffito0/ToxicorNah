# Section 02: PDF Renderer (n8n Code Node)

## Objective
Build shared Puppeteer-based PDF rendering logic for n8n. Takes populated HTML → generates PDF → returns base64 buffer.

## Implementation

### 1. Create render-pdf.js
File: `n8n/code/insiderbuying/render-pdf.js`

Functions:
- renderPDF(html, options) — launches Puppeteer, sets HTML content, calls page.pdf(), returns base64 string
  - options: { format: 'Letter', printBackground: true, margin: { top: '50px', bottom: '60px', left: '50px', right: '50px' } }
  - Headless Chromium (new headless mode)
  - Wait for fonts to load (waitUntil: 'networkidle0')
  - Close browser after rendering
- uploadToR2(buffer, key) — uploads PDF buffer to Cloudflare R2
  - Uses S3-compatible API with AWS Sig V4
  - Returns public URL
  - Key format: 'reports/{type}/{filename}.pdf'

### 2. n8n environment
Puppeteer must be available on VPS. The n8n Docker image doesn't include it by default.
Options: (a) install puppeteer in n8n volume, (b) use external screenshot server, (c) use a sidecar container.
Decision: Use the existing screenshot server pattern (host.docker.internal:3456) — send HTML, receive PDF.

### 3. Screenshot server PDF endpoint
If screenshot server doesn't have PDF endpoint, add one:
POST /pdf with body { html, options } → returns PDF buffer

## Tests
- Test: renderPDF returns non-empty base64 string (mock Puppeteer)
- Test: renderPDF passes correct options to page.pdf()
- Test: uploadToR2 constructs correct S3 key path
- Test: uploadToR2 returns URL with R2 public domain

## Acceptance Criteria
- [ ] PDF renders from HTML with correct formatting
- [ ] PDF uploaded to R2 returns accessible URL
- [ ] US Letter format with proper margins
