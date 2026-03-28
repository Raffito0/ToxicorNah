# Section 05: Shared Telegram Review Flow

## Objective
Build shared Telegram approval handler for X replies and Reddit comments.

## Implementation

### 1. Create social-telegram-handler.js
File: n8n/code/insiderbuying/social-telegram-handler.js

Functions:
- parseCallback(callbackData) — parse inline keyboard callback:
  - Format: '{platform}:{action}:{itemId}'
  - platform: 'x' or 'reddit'
  - action: 'approve', 'edit', 'skip'
  - itemId: NocoDB record ID
  Returns: { platform, action, itemId }
- handleApprove(platform, itemId, nocodbApi) — post the drafted content:
  - x: call postToX() with draft text
  - reddit: call postComment() with draft text
  - Update NocoDB log status to 'posted'
  Returns: { success, postId }
- handleSkip(platform, itemId, nocodbApi) — mark as skipped in NocoDB
- handleEdit(platform, itemId, chatId) — send message asking for edited text
  - Next message from same chat becomes the new draft
  - Then auto-post the edited version
- buildInlineKeyboard(platform, itemId) — creates Telegram inline keyboard
  - 3 buttons: Approve, Edit, Skip
  - Callback data format: '{platform}:{action}:{itemId}'
  Returns: keyboard markup object
- Exports: parseCallback, handleApprove, handleSkip, handleEdit, buildInlineKeyboard

## Tests
- Test: parseCallback extracts platform, action, itemId from 'x:approve:rec123'
- Test: parseCallback handles 'reddit:skip:rec456'
- Test: handleApprove calls postToX for platform='x'
- Test: handleApprove calls postComment for platform='reddit'
- Test: handleSkip updates NocoDB status to 'skipped'
- Test: buildInlineKeyboard returns 3 buttons with correct callback data

## Acceptance Criteria
- [ ] Callback parsing works for both platforms
- [ ] Approve posts content to correct platform
- [ ] Skip marks as skipped in NocoDB
- [ ] Edit flow captures next message as new draft
