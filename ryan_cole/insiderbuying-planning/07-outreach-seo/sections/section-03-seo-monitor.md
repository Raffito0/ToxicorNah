# Section 03: W14 SEO Monitoring

## Objective
Build W14 n8n workflow code: daily GSC data pull, rank tracking, change detection, Telegram alerts.

## Implementation

### 1. Create seo-monitor.js
File: n8n/code/insiderbuying/seo-monitor.js

Functions:
- fetchGSCData(auth, siteUrl, days) — Google Search Console API:
  - Last 7 days of search analytics
  - Dimensions: query, page
  - Metrics: position, clicks, impressions, ctr
  Returns: rows array
- mapToKeywords(gscRows, nocodbApi) — match GSC queries to NocoDB Keywords table
  Returns: mapped array with keyword record IDs
- writeRankings(rankings, nocodbApi) — write to NocoDB SEO_Rankings table
- detectChanges(current, previous) — compare today vs 7 days ago:
  - Improvements: keyword moved up 5+ positions
  - Drops: keyword dropped 5+ positions
  - New rankings: first time in top 100
  - Top 10 entries: entered first page
  Returns: { improvements[], drops[], newRankings[], top10Entries[] }
- sendAlerts(changes, chatId) — Telegram messages:
  - Green: keyword improved significantly
  - Red: keyword dropped significantly
  - Celebrate top 10 entries
  Returns: { sent }
- buildWeeklySummary(nocodbApi) — Monday summary:
  - Total organic traffic
  - Top 10 keywords by clicks
  - Biggest movers up/down
  - Keywords positions 11-20 (opportunity)
  Returns: summary text
- Exports: fetchGSCData, mapToKeywords, writeRankings, detectChanges, sendAlerts, buildWeeklySummary

## Tests
- Test: fetchGSCData returns rows with query, position, clicks, impressions
- Test: detectChanges identifies improvement when position drops by 5+
- Test: detectChanges identifies drop when position increases by 5+
- Test: detectChanges identifies new ranking (present today, absent before)
- Test: sendAlerts includes green emoji for improvements
- Test: sendAlerts includes red emoji for drops
- Test: buildWeeklySummary includes top 10 keywords section

## Acceptance Criteria
- [ ] Daily GSC data written to NocoDB
- [ ] Significant changes trigger Telegram alerts
- [ ] Weekly summary is accurate and actionable
- [ ] No false positives (5+ position threshold)
