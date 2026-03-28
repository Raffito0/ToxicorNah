# Section 01: W6 Weekly Newsletter

## Objective
Build W6 n8n workflow code: Monday 7AM EST newsletter via Beehiiv with article teasers, alert digest, and data study highlights.

## Implementation

### 1. Create weekly-newsletter.js
File: n8n/code/insiderbuying/weekly-newsletter.js

Functions:
- gatherWeeklyContent(nocodbApi) — query NocoDB:
  - Articles published in last 7 days (status='published', published_at >= 7 days ago)
  - Top 3-5 insider alerts by significance_score (last 7 days)
  - Latest data study if published this week
  Returns: { articles, topAlerts, dataStudy }
- generateSummaries(content) — Claude Haiku (fast, cheap):
  - For each article: 2-sentence teaser (hooks without spoiling)
  - Alert digest: 1-paragraph summary of week's most significant activity
  - Newsletter intro: 2-3 sentences about the week's theme
  - Subject line: compelling, specific, 40-60 chars
  Returns: { intro, articleTeasers[], alertDigest, subjectLine, previewText }
- assembleNewsletter(summaries, content) — build HTML from template:
  - Intro paragraph
  - THIS WEEK'S ANALYSIS section with article cards
  - INSIDER SIGNAL SPOTLIGHT with top alerts
  - Data study card if applicable
  - CTA: upgrade to Pro
  Returns: HTML string
- sendViaBeehiiv(html, subject, previewText) — POST to Beehiiv API
  - Requires BEEHIIV_API_KEY and BEEHIIV_PUBLICATION_ID env vars
  Returns: { success, newsletterId }
- Exports: gatherWeeklyContent, generateSummaries, assembleNewsletter, sendViaBeehiiv

## Tests
- Test: gatherWeeklyContent returns object with articles, topAlerts, dataStudy
- Test: generateSummaries returns articleTeasers array matching articles length
- Test: generateSummaries subjectLine is 40-60 characters
- Test: assembleNewsletter returns HTML containing 'THIS WEEK' heading
- Test: assembleNewsletter includes CTA section
- Test: sendViaBeehiiv constructs correct API payload

## Acceptance Criteria
- [ ] Gathers last 7 days of content
- [ ] AI summaries are concise and compelling
- [ ] Newsletter HTML renders correctly
- [ ] Beehiiv API integration works
