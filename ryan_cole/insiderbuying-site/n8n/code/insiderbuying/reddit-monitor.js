'use strict';

// Fetch polyfill for n8n sandbox
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// W9 Reddit Monitoring
// ---------------------------------------------------------------------------

var SUBREDDITS = [
  'wallstreetbets',
  'stocks',
  'investing',
  'SecurityAnalysis',
  'stockmarket',
];

var SEARCH_KEYWORDS = [
  'insider buying',
  'insider selling',
  'SEC filing',
  'Form 4',
  'insider trading',
  'insider purchase',
  'officer bought',
  'director bought',
  'CEO bought shares',
  'insider activity',
];

/**
 * Combine SEARCH_KEYWORDS with recent ticker names for Reddit search queries.
 * @param {Array} recentTickers - Array of ticker strings, e.g. ['AAPL', 'TSLA']
 * @returns {Array} Array of query strings
 */
function buildSearchQueries(recentTickers) {
  var queries = SEARCH_KEYWORDS.slice();

  if (recentTickers && Array.isArray(recentTickers)) {
    recentTickers.forEach(function(ticker) {
      if (ticker && typeof ticker === 'string') {
        queries.push('$' + ticker + ' insider');
        queries.push(ticker + ' insider buying');
      }
    });
  }

  return queries;
}

/**
 * Filter posts by minimum score.
 * @param {Array} posts - Array of Reddit post objects with { score } field
 * @param {number} [minScore=7] - Minimum score threshold
 * @returns {Array} Filtered posts
 */
function filterByScore(posts, minScore) {
  if (!posts || !Array.isArray(posts)) return [];
  var threshold = (typeof minScore === 'number') ? minScore : 7;

  return posts.filter(function(post) {
    return post && (post.score || 0) >= threshold;
  });
}

/**
 * Build Claude Sonnet prompt for drafting a Reddit comment.
 * Rules: 80% value / 20% soft organic, NO brand name, NO link, 3-5 sentences.
 * @param {object} post - { title, selftext, subreddit, score }
 * @param {object} insiderData - { ticker, insider_name, transaction_type, shares, value_usd, date }
 * @returns {object} { prompt, maxTokens }
 */
function draftComment(post, insiderData) {
  var postTitle = (post && post.title) || '';
  var postBody = (post && post.selftext) || '';
  var subreddit = (post && post.subreddit) || '';

  var ticker = (insiderData && insiderData.ticker) || '';
  var insider = (insiderData && insiderData.insider_name) || '';
  var txType = (insiderData && insiderData.transaction_type) || 'purchased';
  var shares = (insiderData && insiderData.shares) || 0;
  var value = (insiderData && insiderData.value_usd) || 0;
  var date = (insiderData && insiderData.date) || '';

  var dataContext = '';
  if (ticker) {
    dataContext = 'Relevant insider data: ' + insider + ' ' + txType + ' '
      + shares.toLocaleString() + ' shares of $' + ticker;
    if (value > 0) {
      dataContext += ' worth $' + value.toLocaleString();
    }
    if (date) {
      dataContext += ' on ' + date;
    }
    dataContext += '.';
  }

  var prompt = 'You are a knowledgeable retail investor who closely follows SEC insider filings. '
    + 'Write a Reddit comment for r/' + subreddit + ' in response to this post:\n\n'
    + 'Title: "' + postTitle + '"\n'
    + (postBody ? 'Body: "' + postBody.slice(0, 500) + '"\n' : '')
    + '\n'
    + (dataContext ? dataContext + '\n\n' : '')
    + 'RULES:\n'
    + '- 80% genuine value (share the insider data as your own DD/research)\n'
    + '- 20% soft organic (naturally position yourself as someone who tracks this data)\n'
    + '- ABSOLUTELY NO brand names (never mention InsiderBuying, EarlyInsider, or any website)\n'
    + '- ABSOLUTELY NO links or URLs\n'
    + '- Sound like a real Reddit user, match r/' + subreddit + ' tone\n'
    + '- 3-5 sentences only\n'
    + '- If you mention insider filing data, present it as something you found in SEC filings yourself\n'
    + '- Do not say "I track insider buying" or anything that sounds like a pitch\n\n'
    + 'Comment:';

  return {
    prompt: prompt,
    maxTokens: 200,
  };
}

/**
 * Validate a drafted comment before posting.
 * Checks: no URL, no brand names, 3-5 sentences.
 * @param {string} text - Comment text
 * @returns {object} { valid: boolean, issues: string[] }
 */
function validateComment(text) {
  var issues = [];

  if (!text || typeof text !== 'string') {
    return { valid: false, issues: ['Comment text is empty'] };
  }

  // Check for URLs
  var urlPattern = /https?:\/\/|www\.|\.com|\.io|\.ai|\.org|\.net/i;
  if (urlPattern.test(text)) {
    issues.push('Contains a URL or domain name');
  }

  // Check for brand names (case-insensitive)
  var brandNames = ['InsiderBuying', 'EarlyInsider', 'earlyinsider.com', 'insiderbuying.ai'];
  brandNames.forEach(function(brand) {
    if (text.toLowerCase().indexOf(brand.toLowerCase()) !== -1) {
      issues.push('Contains brand name: ' + brand);
    }
  });

  // Check sentence count (split by '. ' and filter empty)
  var sentences = text.split('. ').filter(function(s) {
    return s.trim().length > 0;
  });
  if (sentences.length < 3) {
    issues.push('Too few sentences (got ' + sentences.length + ', need 3-5)');
  }
  if (sentences.length > 5) {
    issues.push('Too many sentences (got ' + sentences.length + ', need 3-5)');
  }

  return {
    valid: issues.length === 0,
    issues: issues,
  };
}

/**
 * Build NocoDB record for Reddit_Log table.
 * @param {string} postUrl - Reddit post URL
 * @param {string} subreddit - Subreddit name
 * @param {string} text - Comment text
 * @param {string} status - 'posted', 'skipped', 'failed'
 * @returns {object} NocoDB record object
 */
function logComment(postUrl, subreddit, text, status) {
  return {
    post_url: postUrl || '',
    subreddit: subreddit || '',
    comment_text: text || '',
    status: status || 'posted',
    posted_at: new Date().toISOString(),
  };
}

module.exports = {
  SUBREDDITS: SUBREDDITS,
  SEARCH_KEYWORDS: SEARCH_KEYWORDS,
  buildSearchQueries: buildSearchQueries,
  filterByScore: filterByScore,
  draftComment: draftComment,
  validateComment: validateComment,
  logComment: logComment,
};
