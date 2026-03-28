<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npx jest
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-pdf-template
section-02-render-pdf
section-03-data-study
section-04-premium-report
section-05-lead-magnet
section-06-reports-page-integration
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-pdf-template | - | 02, 03, 04, 05 | Yes |
| section-02-render-pdf | 01 | 03, 04, 05 | No |
| section-03-data-study | 02 | 06 | Yes |
| section-04-premium-report | 02 | 06 | Yes |
| section-05-lead-magnet | 02 | 06 | Yes |
| section-06-reports-page-integration | 03, 04, 05 | - | No |

## Execution Order

1. section-01-pdf-template (foundation)
2. section-02-render-pdf (shared renderer)
3. section-03-data-study, section-04-premium-report, section-05-lead-magnet (parallel)
4. section-06-reports-page-integration (final)

## Section Summaries

### section-01-pdf-template
Create shared HTML/CSS PDF template with InsiderBuying.ai branding (Navy header, Montaga headings, Inter body, Space Mono data, chart placeholders, disclaimer footer, page numbers).

### section-02-render-pdf
Build shared Puppeteer-based PDF rendering logic for n8n Code Node. Takes HTML string → generates PDF buffer → returns base64. Handles page.pdf() with Letter format.

### section-03-data-study
Build W3 n8n workflow code: topic selection, NocoDB data aggregation, Claude AI analysis, charts data generation, NocoDB write. Schedule: 1st and 15th of each month.

### section-04-premium-report
Build W15 n8n workflow code: Stripe webhook parsing, report type determination, Dexter data gathering, Claude long-form generation, PDF rendering, R2 upload, email delivery via Resend.

### section-05-lead-magnet
Build W16 n8n workflow code: monthly backtest data aggregation, AI narrative, PDF rendering, R2 upload at stable URL, Airtable logging.

### section-06-reports-page-integration
Wire /reports page to display data studies from NocoDB and premium report cards. Add charts rendering with Recharts for data study visualizations.
