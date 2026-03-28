const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  generateArticleTweet,
  generateAlertTweet,
  postToX,
  checkDailyLimit,
  logTweet,
} = require('../code/insiderbuying/x-auto-post.js');

// ---------------------------------------------------------------------------
// generateArticleTweet
// ---------------------------------------------------------------------------
describe('generateArticleTweet', () => {
  it('returns string <= 280 chars', () => {
    const article = {
      title: 'AAPL Insider Analysis',
      ticker: 'AAPL',
      verdict_type: 'bullish',
      key_takeaways: 'CEO bought 500K shares worth $75M. This is the largest insider purchase in 3 years. Multiple directors followed with purchases of their own.',
    };
    const tweet = generateArticleTweet(article);
    assert.ok(typeof tweet === 'string');
    assert.ok(tweet.length <= 280, 'Tweet too long: ' + tweet.length);
  });

  it('contains no URLs', () => {
    const article = {
      title: 'Test',
      ticker: 'TSLA',
      verdict_type: 'bearish',
      key_takeaways: 'Insiders are selling.',
    };
    const tweet = generateArticleTweet(article);
    assert.ok(tweet.indexOf('http') === -1, 'Tweet should not contain URLs');
    assert.ok(tweet.indexOf('www.') === -1, 'Tweet should not contain www.');
    assert.ok(tweet.indexOf('.com') === -1, 'Tweet should not contain .com');
  });

  it('includes ticker symbol with $ prefix', () => {
    const article = { ticker: 'NVDA', verdict_type: 'bullish', key_takeaways: '' };
    const tweet = generateArticleTweet(article);
    assert.ok(tweet.indexOf('$NVDA') !== -1);
  });

  it('truncates very long tweets with ellipsis', () => {
    const article = {
      ticker: 'AAPL',
      verdict_type: 'bullish',
      key_takeaways: 'A'.repeat(300),
    };
    const tweet = generateArticleTweet(article);
    assert.ok(tweet.length <= 280);
    assert.ok(tweet.endsWith('...'));
  });
});

// ---------------------------------------------------------------------------
// generateAlertTweet
// ---------------------------------------------------------------------------
describe('generateAlertTweet', () => {
  it('returns null for score < 8', () => {
    const alert = { ticker: 'AAPL', significance_score: 5, insider_name: 'Tim Cook', shares: 100 };
    const result = generateAlertTweet(alert);
    assert.equal(result, null);
  });

  it('returns null for missing significance_score', () => {
    const alert = { ticker: 'AAPL', insider_name: 'Tim Cook', shares: 100 };
    const result = generateAlertTweet(alert);
    assert.equal(result, null);
  });

  it('returns string for score >= 8', () => {
    const alert = {
      ticker: 'AAPL',
      significance_score: 9,
      insider_name: 'Tim Cook',
      transaction_type: 'bought',
      shares: 50000,
      value_usd: 5000000,
    };
    const result = generateAlertTweet(alert);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    assert.ok(result.length <= 280);
  });

  it('formats large values as $M', () => {
    const alert = {
      ticker: 'MSFT',
      significance_score: 10,
      insider_name: 'Satya Nadella',
      transaction_type: 'purchased',
      shares: 100000,
      value_usd: 2500000,
    };
    const result = generateAlertTweet(alert);
    assert.ok(result.indexOf('$2.5M') !== -1);
  });
});

// ---------------------------------------------------------------------------
// checkDailyLimit
// ---------------------------------------------------------------------------
describe('checkDailyLimit', () => {
  it('returns canPost=false when >= 10 posts', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = checkDailyLimit(entries);
    assert.equal(result.canPost, false);
    assert.equal(result.postsToday, 10);
  });

  it('returns canPost=true when < 10 posts', () => {
    const entries = [{ id: 1 }, { id: 2 }];
    const result = checkDailyLimit(entries);
    assert.equal(result.canPost, true);
    assert.equal(result.postsToday, 2);
  });

  it('handles empty/null input', () => {
    const result = checkDailyLimit(null);
    assert.equal(result.canPost, true);
    assert.equal(result.postsToday, 0);
  });
});

// ---------------------------------------------------------------------------
// logTweet
// ---------------------------------------------------------------------------
describe('logTweet', () => {
  it('returns record with correct fields', () => {
    const record = logTweet('tweet123', 'Hello world', 'article', 'art456');
    assert.equal(record.tweet_id, 'tweet123');
    assert.equal(record.text, 'Hello world');
    assert.equal(record.source_type, 'article');
    assert.equal(record.source_id, 'art456');
    assert.equal(record.status, 'posted');
    assert.ok(typeof record.posted_at === 'string');
  });
});
