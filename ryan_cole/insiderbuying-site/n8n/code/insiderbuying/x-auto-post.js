'use strict';

// Fetch polyfill for n8n sandbox
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// W7 X (Twitter) Auto-Posting
// ---------------------------------------------------------------------------

var MAX_DAILY_POSTS = 10;
var MAX_TWEET_LENGTH = 280;

/**
 * Generate tweet text from an article.
 * Rules: no links, no brand name, pure data, max 280 chars.
 * @param {object} article - { title, ticker, verdict_type, key_takeaways, significance_score }
 * @returns {string} Tweet text
 */
function generateArticleTweet(article) {
  var ticker = article.ticker || '';
  var verdict = article.verdict_type || '';
  var takeaways = article.key_takeaways || '';

  // Build data-first tweet
  var parts = [];

  if (ticker) {
    parts.push('$' + ticker);
  }

  if (verdict) {
    var verdictMap = {
      'bullish': 'insiders are loading up',
      'bearish': 'insiders are heading for the exits',
      'mixed': 'insider signals are mixed',
      'neutral': 'insider activity worth watching',
    };
    parts.push(verdictMap[verdict.toLowerCase()] || 'insider activity detected');
  }

  if (takeaways) {
    // Take first sentence of takeaways
    var firstSentence = takeaways.split('. ')[0];
    if (firstSentence) {
      parts.push(firstSentence);
    }
  }

  var text = parts.join(' -- ');

  // Truncate to max length
  if (text.length > MAX_TWEET_LENGTH) {
    text = text.slice(0, MAX_TWEET_LENGTH - 3) + '...';
  }

  return text;
}

/**
 * Generate tweet from an alert. Only for significance_score >= 8.
 * Rules: no links, no brand name, pure data, max 280 chars.
 * @param {object} alert - { ticker, insider_name, transaction_type, shares, value_usd, significance_score }
 * @returns {string|null} Tweet text or null if score < 8
 */
function generateAlertTweet(alert) {
  if (!alert || !alert.significance_score || alert.significance_score < 8) {
    return null;
  }

  var ticker = alert.ticker || 'unknown';
  var insider = alert.insider_name || 'An insider';
  var txType = (alert.transaction_type || 'bought').toLowerCase();
  var shares = alert.shares || 0;
  var value = alert.value_usd || 0;

  var valueStr = '';
  if (value >= 1000000) {
    valueStr = '$' + (value / 1000000).toFixed(1) + 'M';
  } else if (value >= 1000) {
    valueStr = '$' + (value / 1000).toFixed(0) + 'K';
  } else if (value > 0) {
    valueStr = '$' + value.toLocaleString();
  }

  var text = '$' + ticker + ': ' + insider + ' just ' + txType + ' '
    + shares.toLocaleString() + ' shares';

  if (valueStr) {
    text += ' worth ' + valueStr;
  }

  text += '. This is a significance ' + alert.significance_score + '/10 signal.';

  if (text.length > MAX_TWEET_LENGTH) {
    text = text.slice(0, MAX_TWEET_LENGTH - 3) + '...';
  }

  return text;
}

/**
 * Build X API v2 POST request payload.
 * Does not actually post -- n8n HTTP Request node handles that.
 * @param {string} text - Tweet text
 * @returns {object} { method, url, body, headers }
 */
function postToX(text) {
  return {
    method: 'POST',
    url: 'https://api.twitter.com/2/tweets',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      text: text,
    },
  };
}

/**
 * Check if we can still post today.
 * @param {Array} logEntries - Today's X_Engagement_Log entries
 * @returns {object} { canPost: boolean, postsToday: number }
 */
function checkDailyLimit(logEntries) {
  var entries = logEntries || [];
  var postsToday = entries.length;

  return {
    canPost: postsToday < MAX_DAILY_POSTS,
    postsToday: postsToday,
  };
}

/**
 * Build NocoDB record for X_Engagement_Log.
 * @param {string} tweetId - X tweet ID
 * @param {string} text - Tweet text
 * @param {string} sourceType - 'article' or 'alert'
 * @param {string} sourceId - NocoDB record ID of source
 * @returns {object} NocoDB record object
 */
function logTweet(tweetId, text, sourceType, sourceId) {
  return {
    tweet_id: tweetId,
    text: text,
    source_type: sourceType,
    source_id: sourceId,
    posted_at: new Date().toISOString(),
    status: 'posted',
  };
}

module.exports = {
  generateArticleTweet: generateArticleTweet,
  generateAlertTweet: generateAlertTweet,
  postToX: postToX,
  checkDailyLimit: checkDailyLimit,
  logTweet: logTweet,
};
