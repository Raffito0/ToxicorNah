# Section 04: W9 Reddit Monitor

## Objective
Build W9 n8n workflow code: scan investing subreddits, score relevance, draft value-add comments, queue for Telegram review.

## Implementation

### 1. Create reddit-monitor.js
File: n8n/code/insiderbuying/reddit-monitor.js

Functions:
- scanSubreddits(redditAuth) — Reddit API OAuth:
  - Subreddits: r/stocks, r/ValueInvesting, r/wallstreetbets, r/investing, r/StockMarket
  - Hot + new posts from each
  - Search keywords: "insider buying", "insider trading", "form 4", "SEC filing" + recent tickers
  Returns: posts array with title, body, subreddit, url, score, num_comments
- scoreRelevance(posts) — Claude Haiku:
  - Score each post 1-10 for relevance to insider trading / our coverage
  - Skip posts where comment would feel forced
  Returns: scored posts (only >= 7)
- draftComment(post, insiderData) — Claude Sonnet (quality matters):
  - 80% pure value: specific data, historical context, analysis
  - 20% soft organic: "saw this on an insider tracking site" or similar
  - NEVER mention InsiderBuying.ai by name
  - NEVER link to the site
  - Sound like a knowledgeable redditor
  - 3-5 sentences (Reddit penalizes walls)
  - Include specific numbers from insiderData
  Returns: { commentText, confidence }
- postComment(postUrl, text, redditAuth) — Reddit API POST comment
- sendToTelegramReview(post, draft, chatId) — Telegram with inline keyboard
- logComment(postUrl, subreddit, text, status, nocodbApi) — NocoDB Reddit_Log
- Exports: scanSubreddits, scoreRelevance, draftComment, postComment, sendToTelegramReview, logComment

## Tests
- Test: scanSubreddits queries all 5 subreddits
- Test: scoreRelevance filters posts with score < 7
- Test: draftComment returns text with 3-5 sentences
- Test: draftComment contains no URL
- Test: draftComment does not contain 'InsiderBuying' or 'EarlyInsider'
- Test: logComment creates record with all required fields

## Acceptance Criteria
- [ ] Scans 5 subreddits every 2 hours
- [ ] Relevance scoring filters noise
- [ ] Comments sound human and provide value
- [ ] Zero brand mentions or links
- [ ] All activity logged in NocoDB
