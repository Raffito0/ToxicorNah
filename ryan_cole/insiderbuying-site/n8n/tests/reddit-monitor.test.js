const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SUBREDDITS,
  SEARCH_KEYWORDS,
  buildSearchQueries,
  filterByScore,
  draftComment,
  validateComment,
  logComment,
} = require('../code/insiderbuying/reddit-monitor.js');

// ---------------------------------------------------------------------------
// SUBREDDITS
// ---------------------------------------------------------------------------
describe('SUBREDDITS', () => {
  it('has 5 entries', () => {
    assert.equal(SUBREDDITS.length, 5);
  });

  it('includes wallstreetbets and stocks', () => {
    assert.ok(SUBREDDITS.indexOf('wallstreetbets') !== -1);
    assert.ok(SUBREDDITS.indexOf('stocks') !== -1);
  });
});

// ---------------------------------------------------------------------------
// buildSearchQueries
// ---------------------------------------------------------------------------
describe('buildSearchQueries', () => {
  it('includes base SEARCH_KEYWORDS', () => {
    const queries = buildSearchQueries([]);
    assert.ok(queries.length >= SEARCH_KEYWORDS.length);
  });

  it('includes ticker-based queries', () => {
    const queries = buildSearchQueries(['AAPL', 'TSLA']);
    assert.ok(queries.some(q => q.indexOf('$AAPL') !== -1));
    assert.ok(queries.some(q => q.indexOf('TSLA insider buying') !== -1));
  });

  it('handles null tickers', () => {
    const queries = buildSearchQueries(null);
    assert.ok(queries.length >= SEARCH_KEYWORDS.length);
  });
});

// ---------------------------------------------------------------------------
// filterByScore
// ---------------------------------------------------------------------------
describe('filterByScore', () => {
  it('removes posts below default threshold (7)', () => {
    const posts = [
      { title: 'Low', score: 3 },
      { title: 'High', score: 15 },
    ];
    const result = filterByScore(posts);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'High');
  });

  it('uses custom minScore', () => {
    const posts = [
      { title: 'A', score: 5 },
      { title: 'B', score: 10 },
    ];
    const result = filterByScore(posts, 5);
    assert.equal(result.length, 2);
  });

  it('handles null input', () => {
    assert.deepEqual(filterByScore(null), []);
  });
});

// ---------------------------------------------------------------------------
// draftComment
// ---------------------------------------------------------------------------
describe('draftComment', () => {
  it('returns prompt containing rules', () => {
    const post = { title: 'AAPL insider buying', selftext: 'What do you think?', subreddit: 'stocks', score: 50 };
    const insiderData = { ticker: 'AAPL', insider_name: 'Tim Cook', transaction_type: 'purchased', shares: 10000, value_usd: 500000 };
    const result = draftComment(post, insiderData);
    assert.ok(typeof result.prompt === 'string');
    assert.ok(result.prompt.indexOf('RULES') !== -1 || result.prompt.indexOf('Rules') !== -1);
    assert.ok(result.prompt.indexOf('NO brand names') !== -1 || result.prompt.indexOf('ABSOLUTELY NO brand') !== -1);
    assert.ok(typeof result.maxTokens === 'number');
  });

  it('prompt includes post title', () => {
    const post = { title: 'Big insider move on TSLA', subreddit: 'wallstreetbets' };
    const result = draftComment(post, {});
    assert.ok(result.prompt.indexOf('Big insider move on TSLA') !== -1);
  });
});

// ---------------------------------------------------------------------------
// validateComment
// ---------------------------------------------------------------------------
describe('validateComment', () => {
  it('rejects text with URLs', () => {
    const result = validateComment('Check out https://example.com for more info. This is great. Three sentences here.');
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.toLowerCase().indexOf('url') !== -1 || i.toLowerCase().indexOf('domain') !== -1));
  });

  it('rejects text with InsiderBuying', () => {
    const result = validateComment('I use InsiderBuying to track SEC filings. Great tool. Very useful for analysis.');
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.indexOf('brand') !== -1 || i.indexOf('InsiderBuying') !== -1));
  });

  it('rejects text with EarlyInsider', () => {
    const result = validateComment('Check EarlyInsider for alerts. They have good data. Really helpful service.');
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.indexOf('brand') !== -1 || i.indexOf('EarlyInsider') !== -1));
  });

  it('accepts valid text with 3-5 sentences', () => {
    const text = 'The CEO just filed a Form 4 showing a massive purchase. '
      + 'This is the largest insider buy in 2 years. '
      + 'Worth keeping an eye on the stock this week.';
    const result = validateComment(text);
    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  });

  it('rejects empty text', () => {
    const result = validateComment('');
    assert.equal(result.valid, false);
  });
});

// ---------------------------------------------------------------------------
// logComment
// ---------------------------------------------------------------------------
describe('logComment', () => {
  it('returns record with all fields', () => {
    const record = logComment('https://reddit.com/r/stocks/abc', 'stocks', 'My comment text', 'posted');
    assert.equal(record.post_url, 'https://reddit.com/r/stocks/abc');
    assert.equal(record.subreddit, 'stocks');
    assert.equal(record.comment_text, 'My comment text');
    assert.equal(record.status, 'posted');
    assert.ok(typeof record.posted_at === 'string');
  });

  it('defaults status to posted', () => {
    const record = logComment('url', 'sub', 'text');
    assert.equal(record.status, 'posted');
  });
});
