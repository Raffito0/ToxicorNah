# Section 04: W15 Premium Report Generation

## Objective
Build W15 n8n workflow code: Stripe webhook-triggered premium report generation with PDF delivery.

## Implementation

### 1. Create generate-report.js
File: `n8n/code/insiderbuying/generate-report.js`

Functions:
- parseWebhook(event) — extract user_id, report_type, payment_id, customer_email from Stripe checkout.session.completed
  Report types from product metadata: 'deep-dive', 'sector', 'watchlist'
- gatherReportData(reportType, params, dexterUrl) — call Dexter sub-workflow for each ticker
  - deep-dive: single ticker comprehensive
  - sector: all tickers in sector
  - watchlist: user's watched tickers from user_alert_preferences
- generateReportContent(data, reportType) — Claude Sonnet (12K tokens)
  - Structure: Executive Summary, Key Findings, Detailed Analysis per ticker, Risk Assessment, Conclusion
  - Include chart/table data inline
- buildReportHTML(content, templateType) — populate premium-report template
- deliverReport(pdfUrl, email, reportTitle) — send via Resend API
- saveReport(userId, reportType, pdfUrl, paymentId) — write to Supabase reports table + NocoDB log
- Exports: parseWebhook, gatherReportData, generateReportContent, buildReportHTML, deliverReport, saveReport

### 2. Stripe webhook trigger
n8n Webhook node catches checkout.session.completed for report products.
Product metadata contains report_type and optional ticker/sector params.

### 3. Report delivery
- PDF: rendered by render-pdf.js, uploaded to R2 (behind auth check)
- Email: Resend with PDF attachment link + download button
- Supabase: save record for user's report library

## Tests
- Test: parseWebhook extracts correct fields from Stripe event
- Test: parseWebhook identifies report_type from metadata
- Test: gatherReportData calls Dexter for each ticker in params
- Test: generateReportContent returns object with executive_summary, key_findings, analysis sections
- Test: buildReportHTML returns HTML string containing report title
- Test: deliverReport constructs correct Resend API payload
- Test: saveReport creates record with all required fields

## Acceptance Criteria
- [ ] Stripe webhook triggers report generation
- [ ] PDF generated within 2 minutes
- [ ] Email delivered with PDF link
- [ ] Report saved in Supabase for user access
