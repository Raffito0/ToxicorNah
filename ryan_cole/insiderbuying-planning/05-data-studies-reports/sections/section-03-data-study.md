# Section 03: W3 Data Study Workflow

## Objective
Build W3 n8n workflow code: bi-monthly data studies with real insider trading data, AI analysis, and chart data for site rendering.

## Implementation

### 1. Create data-study.js
File: `n8n/code/insiderbuying/data-study.js`

Functions:
- selectStudyTopic(monthIndex) — picks topic from rotating list based on month
  Topics: "Top Insider Buys by Significance", "Cluster Buy Signals by Sector", "CEO vs CFO Buying Patterns", "Small Cap Insider Buying", "Insider Buying After Earnings Misses", "Quarterly Volume Analysis"
- aggregateData(topic, nocodbApi) — queries NocoDB Insider_Alerts + Financial_Cache for topic-relevant data
  - Returns: transactions array, statistics object, sector breakdown
- generateAnalysis(data, topic) — calls Claude Sonnet via Anthropic API
  - Input: aggregated data + topic context
  - Output: { title, key_findings, methodology, implications, charts_data }
  - charts_data: array of { type: 'bar'|'line'|'scatter', title, data: [{label, value}] }
- buildStudyRecord(analysis) — formats for NocoDB Data_Studies table write
- Exports: selectStudyTopic, aggregateData, generateAnalysis, buildStudyRecord

### 2. NocoDB queries
- Insider_Alerts: filter by date range, significance_score, transaction_type as needed per topic
- Financial_Cache: price performance data for backtesting calculations
- Calculate: average return, hit rate, sector breakdown, top performers

### 3. Charts data format
```json
{
  "charts": [
    { "type": "bar", "title": "Top 10 Insider Buys", "data": [{"label": "$NVDA", "value": 847000000}] },
    { "type": "line", "title": "Cumulative Return vs S&P 500", "data": [{"date": "2026-01", "insider": 12.3, "sp500": 8.1}] }
  ]
}
```
This JSON is stored in NocoDB and rendered client-side on /reports with Recharts.

## Tests
- Test: selectStudyTopic returns valid topic for each month (0-11)
- Test: selectStudyTopic cycles through all 6 topics
- Test: aggregateData returns object with transactions array and statistics
- Test: generateAnalysis returns object with title, key_findings, charts_data
- Test: charts_data items have type, title, and data array
- Test: buildStudyRecord has all required NocoDB fields

## Acceptance Criteria
- [ ] Study topic selection is deterministic per month
- [ ] Data aggregation queries correct NocoDB tables
- [ ] AI analysis produces structured output with charts data
- [ ] Record written to Data_Studies table
