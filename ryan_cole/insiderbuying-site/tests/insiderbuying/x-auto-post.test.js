'use strict';

const {
  generateArticleTweet,
  generateAlertTweet,
  postToX,
  checkDailyLimit,
  logTweet,
} = require('../../n8n/code/insiderbuying/x-auto-post');

// ─── generateArticleTweet ──────────────────────────────────────────────────

describe('generateArticleTweet()', () => {
  test('includes $ticker in output', () => {
    const tweet = generateArticleTweet({ ticker: 'AAPL', verdict_type: 'bullish', key_takeaways: 'Strong signal.' });
    expect(tweet).toContain('$AAPL');
  });

  test('bullish verdict maps to "insiders are loading up"', () => {
    const tweet = generateArticleTweet({ ticker: 'AAPL', verdict_type: 'bullish', key_takeaways: '' });
    expect(tweet.toLowerCase()).toContain('loading up');
  });

  test('bearish verdict maps to "heading for the exits"', () => {
    const tweet = generateArticleTweet({ ticker: 'TSLA', verdict_type: 'bearish', key_takeaways: '' });
    expect(tweet.toLowerCase()).toContain('exits');
  });

  test('mixed verdict maps to "insider signals are mixed"', () => {
    const tweet = generateArticleTweet({ ticker: 'MSFT', verdict_type: 'mixed', key_takeaways: '' });
    expect(tweet.toLowerCase()).toContain('mixed');
  });

  test('result is never longer than 280 characters', () => {
    const longTakeaway = 'A'.repeat(300);
    const tweet = generateArticleTweet({ ticker: 'AAPL', verdict_type: 'bullish', key_takeaways: longTakeaway });
    expect(tweet.length).toBeLessThanOrEqual(280);
  });

  test('uses first sentence of key_takeaways only', () => {
    const tweet = generateArticleTweet({
      ticker: 'AAPL',
      verdict_type: 'bullish',
      key_takeaways: 'First sentence. Second sentence. Third sentence.',
    });
    expect(tweet).toContain('First sentence');
    expect(tweet).not.toContain('Second sentence');
  });

  test('handles missing fields gracefully', () => {
    expect(() => generateArticleTweet({})).not.toThrow();
    expect(() => generateArticleTweet({ ticker: 'AAPL' })).not.toThrow();
  });
});

// ─── generateAlertTweet ───────────────────────────────────────────────────

describe('generateAlertTweet()', () => {
  const HIGH_SCORE_ALERT = {
    ticker: 'AAPL',
    insider_name: 'Tim Cook',
    transaction_type: 'bought',
    shares: 10000,
    value_usd: 2255000,
    significance_score: 9,
  };

  test('returns null for significance_score < 8', () => {
    expect(generateAlertTweet({ ...HIGH_SCORE_ALERT, significance_score: 7 })).toBeNull();
    expect(generateAlertTweet({ ...HIGH_SCORE_ALERT, significance_score: 5 })).toBeNull();
  });

  test('returns null for missing alert', () => {
    expect(generateAlertTweet(null)).toBeNull();
    expect(generateAlertTweet(undefined)).toBeNull();
  });

  test('returns string for significance_score >= 8', () => {
    const result = generateAlertTweet(HIGH_SCORE_ALERT);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('includes $ticker in output', () => {
    expect(generateAlertTweet(HIGH_SCORE_ALERT)).toContain('$AAPL');
  });

  test('includes insider name', () => {
    expect(generateAlertTweet(HIGH_SCORE_ALERT)).toContain('Tim Cook');
  });

  test('formats million-dollar value with M suffix', () => {
    const tweet = generateAlertTweet(HIGH_SCORE_ALERT);
    expect(tweet).toContain('$2.3M');
  });

  test('formats thousand-dollar value with K suffix', () => {
    const tweet = generateAlertTweet({ ...HIGH_SCORE_ALERT, value_usd: 50000 });
    expect(tweet).toContain('$50K');
  });

  test('result is never longer than 280 characters', () => {
    const tweet = generateAlertTweet(HIGH_SCORE_ALERT);
    expect(tweet.length).toBeLessThanOrEqual(280);
  });

  test('includes significance score in output', () => {
    const tweet = generateAlertTweet(HIGH_SCORE_ALERT);
    expect(tweet).toContain('9');
  });
});

// ─── postToX ──────────────────────────────────────────────────────────────

describe('postToX()', () => {
  test('returns object with method POST', () => {
    const result = postToX('Hello $AAPL');
    expect(result.method).toBe('POST');
  });

  test('targets https://api.twitter.com/2/tweets', () => {
    const result = postToX('Hello $AAPL');
    expect(result.url).toBe('https://api.twitter.com/2/tweets');
  });

  test('body.text matches input text', () => {
    const result = postToX('Hello $AAPL');
    expect(result.body.text).toBe('Hello $AAPL');
  });

  test('includes Content-Type: application/json header', () => {
    const result = postToX('test');
    expect(result.headers['Content-Type']).toBe('application/json');
  });
});

// ─── checkDailyLimit ──────────────────────────────────────────────────────

describe('checkDailyLimit()', () => {
  test('returns canPost=true when entries < MAX_DAILY_POSTS', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const result = checkDailyLimit(entries);
    expect(result.canPost).toBe(true);
  });

  test('returns canPost=false when entries >= MAX_DAILY_POSTS (10)', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = checkDailyLimit(entries);
    expect(result.canPost).toBe(false);
  });

  test('postsToday reflects the count of entries passed', () => {
    const entries = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = checkDailyLimit(entries);
    expect(result.postsToday).toBe(3);
  });

  test('handles null/undefined logEntries gracefully', () => {
    expect(() => checkDailyLimit(null)).not.toThrow();
    expect(() => checkDailyLimit(undefined)).not.toThrow();
    expect(checkDailyLimit(null).canPost).toBe(true);
  });
});

// ─── logTweet ─────────────────────────────────────────────────────────────

describe('logTweet()', () => {
  test('returns object with tweet_id field', () => {
    const record = logTweet('123456', 'test tweet', 'article', '42');
    expect(record.tweet_id).toBe('123456');
  });

  test('sets status to "posted"', () => {
    const record = logTweet('123456', 'test tweet', 'article', '42');
    expect(record.status).toBe('posted');
  });

  test('sets posted_at to a valid ISO timestamp', () => {
    const record = logTweet('123456', 'test tweet', 'article', '42');
    expect(() => new Date(record.posted_at)).not.toThrow();
    expect(new Date(record.posted_at).toISOString()).toBe(record.posted_at);
  });

  test('source_type and source_id match inputs', () => {
    const record = logTweet('tid', 'text', 'alert', '99');
    expect(record.source_type).toBe('alert');
    expect(record.source_id).toBe('99');
  });

  test('body is flat — no { fields: {} } wrapper', () => {
    const record = logTweet('tid', 'text', 'article', '1');
    expect(record.fields).toBeUndefined();
  });
});
