# Section 01: W10 Outreach Prospect Finder

## Objective
Build W10 n8n workflow code: weekly prospect discovery via Google Search + email finding tools.

## Implementation

### 1. Create find-prospects.js
File: n8n/code/insiderbuying/find-prospects.js

Functions:
- searchProspects(queries, serpApiKey) — Google Search via SerpAPI:
  - Queries: "insider trading blog", "stock market newsletter", "finance podcast guests", "{ticker} analysis"
  - Extract: domain, page title, snippet, URL
  - Filter: English language, active (published recently)
  Returns: prospects array
- findEmail(domain, tools) — try in order:
  - Hunter.io (25 free/month)
  - Snov.io (50 free/month)
  - Apollo.io (60 free/month)
  - Fallback: extract from /about or /contact page
  Returns: { email, source, verified }
- scoreProspect(prospect) — calculate priority:
  - domain_authority * 0.3 + relevance * 0.3 + contact_quality * 0.2 + recency * 0.2
  Returns: scored prospect with priority field
- dedup(prospects, nocodbApi) — check NocoDB Outreach_Prospects by domain
  Returns: only new prospects
- saveProspects(prospects, nocodbApi) — write to NocoDB, status='found'
- Exports: searchProspects, findEmail, scoreProspect, dedup, saveProspects

## Tests
- Test: searchProspects returns array of prospects with domain and title
- Test: findEmail tries Hunter first, then Snov, then Apollo
- Test: scoreProspect returns number between 0-100
- Test: scoreProspect weights sum to 1.0
- Test: dedup removes prospects with matching domain
- Test: saveProspects creates records with status='found'

## Acceptance Criteria
- [ ] Finds 50+ prospects per week
- [ ] Email discovery cascades through 3 tools
- [ ] Priority scoring produces reasonable rankings
- [ ] Dedup prevents double-contacting
