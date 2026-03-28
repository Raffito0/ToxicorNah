# Section 02: W7 X Auto-Post

## Objective
Build W7 n8n workflow code: auto-generate and post tweets for new articles and high-significance alerts.

## Implementation

### 1. Create x-auto-post.js
File: n8n/code/insiderbuying/x-auto-post.js

Functions:
- generateArticleTweet(article) — Claude Haiku:
  - Input: title, key_takeaways, verdict_type, ticker
  - Rules: NO links, NO brand name, pure data/insight, max 280 chars
  - A surprising number, contrarian take, or question
  Returns: tweet text string
- generateAlertTweet(alert) — Claude Haiku:
  - Input: ticker, insider_name, insider_title, transaction details, significance_score
  - Only for alerts with score >= 8
  - Same rules: data only, no links, no brand
  Returns: tweet text string
- postToX(text) — X API v2 POST /2/tweets
  - Auth: OAuth 1.0a (API key + secret + access token + secret)
  - Returns: { tweetId, text }
- checkDailyLimit(nocodbApi) — query X_Engagement_Log for today's posts
  - Max 10 tweets/day
  Returns: { canPost, postsToday }
- logTweet(tweetId, text, sourceType, sourceId, nocodbApi) — write to X_Engagement_Log
- Exports: generateArticleTweet, generateAlertTweet, postToX, checkDailyLimit, logTweet

### 2. Rate limiting
Max 10 tweets/day. If limit reached, queue for next day.
Random delay 0-10 min before posting to avoid exact intervals.

## Tests
- Test: generateArticleTweet returns string <= 280 chars
- Test: generateArticleTweet contains no URLs (no http/https)
- Test: generateAlertTweet only processes alerts with score >= 8
- Test: checkDailyLimit returns canPost=false when postsToday >= 10
- Test: logTweet creates record with correct fields
- Test: postToX constructs correct X API payload

## Acceptance Criteria
- [ ] Tweets are data-focused with zero links
- [ ] Zero brand name mentions
- [ ] 10/day rate limit enforced
- [ ] All posts logged in NocoDB
