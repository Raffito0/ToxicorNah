# Section 03: W8 X Engagement Monitor

## Objective
Build W8 n8n workflow code: monitor X for replies and mentions, draft AI replies, queue for Telegram review.

## Implementation

### 1. Create x-engagement.js
File: n8n/code/insiderbuying/x-engagement.js

Functions:
- fetchEngagementData(twitterApiKey) — twitterapi.io queries:
  - Replies to our tweets (last check timestamp)
  - Mentions of our handle
  - Search: "insider buying", "form 4", "SEC filing" + recent article tickers
  Returns: { replies[], mentions[], conversations[] }
- filterRelevant(items) — remove:
  - Bots (follower/following ratio > 10, account age < 30 days)
  - Already-replied threads (check NocoDB X_Engagement_Log)
  - Irrelevant mentions
  Returns: filtered array
- draftReply(context, originalTweet) — Claude Haiku:
  - For our tweet replies: engage with additional data, answer questions
  - For conversations: value-add reply with data (NO brand, NO link)
  - Sound like a knowledgeable trader, not a brand
  Returns: { draftText, confidence }
- sendToTelegramReview(original, draft, chatId) — send for human approval
  - Original tweet/thread text
  - Drafted reply
  - Inline keyboard: Approve / Edit / Skip
  Returns: { messageId }
- Exports: fetchEngagementData, filterRelevant, draftReply, sendToTelegramReview

## Tests
- Test: filterRelevant removes accounts with follower/following > 10
- Test: filterRelevant removes accounts younger than 30 days
- Test: draftReply returns text <= 280 chars
- Test: draftReply contains no URLs
- Test: sendToTelegramReview includes inline keyboard with 3 buttons

## Acceptance Criteria
- [ ] Finds relevant conversations every 15 minutes
- [ ] Filters bots and duplicates
- [ ] AI replies sound human
- [ ] Telegram review flow works
