<!-- PROJECT_CONFIG
runtime: typescript-npm
test_command: npx jest
END_PROJECT_CONFIG -->

<!-- SECTION_MANIFEST
section-01-weekly-newsletter
section-02-x-auto-post
section-03-x-engagement
section-04-reddit-monitor
section-05-telegram-review-flow
END_MANIFEST -->

# Implementation Sections Index

## Dependency Graph

| Section | Depends On | Blocks | Parallelizable |
|---------|------------|--------|----------------|
| section-01-weekly-newsletter | - | - | Yes |
| section-02-x-auto-post | - | 03 | Yes |
| section-03-x-engagement | 02 | - | No |
| section-04-reddit-monitor | - | - | Yes |
| section-05-telegram-review-flow | 02, 03, 04 | - | No |

## Execution Order

1. section-01-weekly-newsletter, section-02-x-auto-post, section-04-reddit-monitor (parallel)
2. section-03-x-engagement (after 02)
3. section-05-telegram-review-flow (after all, shared handler)

## Section Summaries

### section-01-weekly-newsletter
Build W6 n8n workflow code: gather articles + alerts from NocoDB, Claude Haiku summaries, assemble newsletter template, Beehiiv API integration.

### section-02-x-auto-post
Build W7 n8n workflow code: tweet generation for articles and high-score alerts, X API posting, rate limiting (10/day max), NocoDB logging.

### section-03-x-engagement
Build W8 n8n workflow code: twitterapi.io monitoring, bot filtering, Claude Haiku reply drafting, Telegram review queue.

### section-04-reddit-monitor
Build W9 n8n workflow code: multi-subreddit scanning, relevance scoring, Claude Sonnet comment drafting, Telegram review queue, Reddit API posting.

### section-05-telegram-review-flow
Build shared Telegram approval handler for X replies and Reddit comments: inline keyboard callbacks, approve/edit/skip flow, posting on approval, NocoDB logging.
