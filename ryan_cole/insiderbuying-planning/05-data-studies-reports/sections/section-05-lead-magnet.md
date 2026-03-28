# Section 05: W16 Lead Magnet PDF

## Objective
Build W16 n8n workflow code: monthly "Insider Buying Backtest Report" — free PDF proving the value of insider signal tracking.

## Implementation

### 1. Create generate-lead-magnet.js
File: `n8n/code/insiderbuying/generate-lead-magnet.js`

Functions:
- gatherBacktestData(nocodbApi) — query last month's insider alerts with significance >= 7
  - For each: calculate return since filing date using Financial_Cache price data
  - Compute: overall hit rate, avg return, best/worst performer, cluster vs individual performance
- generateNarrative(data) — Claude Sonnet
  - Engaging report with real data
  - "What if you followed these signals" scenario
  - Honest: include losses too
  - CTA: upgrade to Pro for real-time alerts
- buildLeadMagnetHTML(narrative, data) — populate lead-magnet template
  - Charts: monthly returns bar chart data, sector pie chart data, top 5 table
  - 4-6 pages
- uploadLeadMagnet(pdfBuffer) — R2 upload at stable key 'reports/lead-magnet-latest.pdf'
- logVersion(stats) — write to NocoDB Lead_Magnet_Versions table
- Exports: gatherBacktestData, generateNarrative, buildLeadMagnetHTML, uploadLeadMagnet, logVersion

### 2. Stable URL
R2 key: 'reports/lead-magnet-latest.pdf' — always same URL, overwritten monthly.
/free-report page links to this URL.

### 3. Schedule
Last day of each month. n8n Schedule Trigger with cron expression.

## Tests
- Test: gatherBacktestData returns object with alerts array, hitRate, avgReturn, bestPerformer, worstPerformer
- Test: gatherBacktestData filters alerts with significance >= 7
- Test: generateNarrative returns object with sections array and cta
- Test: buildLeadMagnetHTML returns HTML containing 'backtest' and chart data
- Test: uploadLeadMagnet uses stable key path
- Test: logVersion creates record with month, title, pdf_url

## Acceptance Criteria
- [ ] Monthly backtest with real data
- [ ] PDF uploaded to stable R2 URL
- [ ] /free-report serves latest version
- [ ] Lead_Magnet_Versions table updated
