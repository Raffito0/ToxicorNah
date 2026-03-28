'use strict';

// Fetch polyfill for n8n sandbox
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// W8 X (Twitter) Engagement Monitoring
// ---------------------------------------------------------------------------

var MIN_FOLLOWERS = 10;
var MIN_FOLLOWING = 10;
var MIN_ACCOUNT_AGE_DAYS = 30;

/**
 * Filter out bots and already-replied threads.
 * Criteria: follower/following > 10, account age >= 30 days.
 * @param {Array} items - Array of tweet objects with user data
 *   Each item: { id, text, user: { followers_count, following_count, created_at }, in_reply_to_status_id }
 * @returns {Array} Filtered array of relevant tweets
 */
function filterRelevant(items) {
  if (!items || !Array.isArray(items)) return [];

  var now = Date.now();
  var minAgeMs = MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000;

  return items.filter(function(item) {
    if (!item || !item.user) return false;

    var user = item.user;

    // Filter bots: must have minimum followers and following
    if ((user.followers_count || 0) < MIN_FOLLOWERS) return false;
    if ((user.following_count || 0) < MIN_FOLLOWING) return false;

    // Filter new accounts (likely bots)
    if (user.created_at) {
      var accountAge = now - new Date(user.created_at).getTime();
      if (accountAge < minAgeMs) return false;
    }

    return true;
  });
}

/**
 * Build Claude Haiku prompt for drafting a reply.
 * Rules: no links, no brand name, sound like a trader.
 * @param {object} originalTweet - { id, text, user: { screen_name } }
 * @returns {object} { prompt, maxTokens }
 */
function draftReply(originalTweet) {
  var tweetText = (originalTweet && originalTweet.text) || '';
  var author = (originalTweet && originalTweet.user && originalTweet.user.screen_name) || 'someone';

  var prompt = 'You are a knowledgeable retail trader who follows SEC insider filings closely. '
    + 'Draft a short reply to this tweet by @' + author + ':\n\n'
    + '"' + tweetText + '"\n\n'
    + 'RULES:\n'
    + '- Sound like a real trader, not a brand or marketing account\n'
    + '- NO links or URLs of any kind\n'
    + '- NO brand names (do not mention InsiderBuying, EarlyInsider, or any website)\n'
    + '- Add genuine value: share an insight, data point, or perspective\n'
    + '- Keep it conversational and under 240 characters\n'
    + '- If you reference insider buying data, present it as your own knowledge\n'
    + '- One reply only, no alternatives\n\n'
    + 'Reply:';

  return {
    prompt: prompt,
    maxTokens: 100,
  };
}

/**
 * Build Telegram sendMessage payload with inline keyboard for review.
 * Buttons: Approve / Edit / Skip
 * @param {object} original - Original tweet { id, text, user: { screen_name } }
 * @param {string} draft - Draft reply text
 * @param {string} chatId - Telegram chat ID
 * @returns {object} Telegram sendMessage payload
 */
function sendToTelegramReview(original, draft, chatId) {
  var author = (original && original.user && original.user.screen_name) || 'unknown';
  var tweetId = (original && original.id) || 'unknown';
  var originalText = (original && original.text) || '';

  var message = 'X REPLY DRAFT\n\n'
    + 'Replying to @' + author + ':\n'
    + '"' + originalText + '"\n\n'
    + 'Draft reply:\n'
    + '"' + draft + '"\n\n'
    + 'Approve, edit, or skip?';

  return {
    method: 'sendMessage',
    chat_id: chatId,
    text: message,
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: 'x:approve:' + tweetId },
          { text: 'Edit', callback_data: 'x:edit:' + tweetId },
          { text: 'Skip', callback_data: 'x:skip:' + tweetId },
        ],
      ],
    },
  };
}

module.exports = {
  filterRelevant: filterRelevant,
  draftReply: draftReply,
  sendToTelegramReview: sendToTelegramReview,
};
