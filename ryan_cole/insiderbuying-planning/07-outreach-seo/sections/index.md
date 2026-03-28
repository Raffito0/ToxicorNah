<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npx jest
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-prospect-finder
section-02-outreach-email
section-03-seo-monitor
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-prospect-finder | - | 02 | Yes |
| section-02-outreach-email | 01 | - | No |
| section-03-seo-monitor | - | - | Yes |

## Execution Order

1. section-01-prospect-finder, section-03-seo-monitor (parallel)
2. section-02-outreach-email (after 01)

## Section Summaries

### section-01-prospect-finder
Build W10 n8n workflow code: Google Search API prospect discovery, Hunter.io/Snov.io/Apollo email finding, relevance scoring, dedup against NocoDB, weekly schedule.

### section-02-outreach-email
Build W11 n8n workflow code: personalized email generation via Claude Haiku, Gmail SMTP sending with random delays, follow-up logic (Day 5), rate limiting (10/day), NocoDB logging.

### section-03-seo-monitor
Build W14 n8n workflow code: Google Search Console API data pull, keyword mapping, rank change detection, Telegram alerts for significant moves, weekly summary.
