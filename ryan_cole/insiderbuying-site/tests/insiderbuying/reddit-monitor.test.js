'use strict';

const {
  SUBREDDITS,
  SEARCH_KEYWORDS,
  buildSearchQueries,
  filterByScore,
  draftComment,
  validateComment,
  logComment,
} = require('../../n8n/code/insiderbuying/reddit-monitor');

// ─── SUBREDDITS / SEARCH_KEYWORDS ─────────────────────────────────────────

describe('SUBREDDITS', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(SUBREDDITS)).toBe(true);
    expect(SUBREDDITS.length).toBeGreaterThan(0);
  });

  test('contains expected finance subreddits', () => {
    expect(SUBREDDITS).toContain('wallstreetbets');
    expect(SUBREDDITS).toContain('stocks');
    expect(SUBREDDITS).toContain('investing');
  });
});

describe('SEARCH_KEYWORDS', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(SEARCH_KEYWORDS)).toBe(true);
    expect(SEARCH_KEYWORDS.length).toBeGreaterThan(0);
  });

  test('contains core insider-buying keywords', () => {
    expect(SEARCH_KEYWORDS).toContain('insider buying');
    expect(SEARCH_KEYWORDS).toContain('Form 4');
    expect(SEARCH_KEYWORDS).toContain('insider activity');
  });
});

// ─── buildSearchQueries ────────────────────────────────────────────────────

describe('buildSearchQueries()', () => {
  test('returns at least SEARCH_KEYWORDS when no tickers provided', () => {
    const queries = buildSearchQueries([]);
    SEARCH_KEYWORDS.forEach((kw) => expect(queries).toContain(kw));
  });

  test('appends $TICKER insider for each ticker', () => {
    const queries = buildSearchQueries(['AAPL', 'TSLA']);
    expect(queries).toContain('$AAPL insider');
    expect(queries).toContain('$TSLA insider');
  });

  test('appends TICKER insider buying for each ticker', () => {
    const queries = buildSearchQueries(['AAPL', 'TSLA']);
    expect(queries).toContain('AAPL insider buying');
    expect(queries).toContain('TSLA insider buying');
  });

  test('handles null/undefined gracefully', () => {
    expect(() => buildSearchQueries(null)).not.toThrow();
    expect(() => buildSearchQueries(undefined)).not.toThrow();
    const queries = buildSearchQueries(null);
    expect(Array.isArray(queries)).toBe(true);
  });

  test('ignores non-string ticker entries', () => {
    const queries = buildSearchQueries([null, 42, 'MSFT']);
    expect(queries).toContain('$MSFT insider');
    expect(queries).toContain('MSFT insider buying');
  });
});

// ─── filterByScore ────────────────────────────────────────────────────────

describe('filterByScore()', () => {
  test('returns empty array for null/non-array input', () => {
    expect(filterByScore(null)).toEqual([]);
    expect(filterByScore(undefined)).toEqual([]);
    expect(filterByScore('string')).toEqual([]);
  });

  test('filters posts below default threshold (7)', () => {
    const posts = [
      { score: 10, title: 'high' },
      { score: 5, title: 'low' },
      { score: 7, title: 'at threshold' },
    ];
    const result = filterByScore(posts);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.title)).toContain('high');
    expect(result.map((p) => p.title)).toContain('at threshold');
  });

  test('respects custom minScore', () => {
    const posts = [{ score: 20 }, { score: 50 }, { score: 5 }];
    const result = filterByScore(posts, 25);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(50);
  });

  test('keeps all posts if all meet threshold', () => {
    const posts = [{ score: 100 }, { score: 200 }, { score: 50 }];
    expect(filterByScore(posts, 7)).toHaveLength(3);
  });

  test('returns empty array if no posts meet threshold', () => {
    const posts = [{ score: 1 }, { score: 2 }];
    expect(filterByScore(posts, 10)).toHaveLength(0);
  });
});

// ─── draftComment ─────────────────────────────────────────────────────────

describe('draftComment()', () => {
  const SAMPLE_POST = {
    title: 'CEO of AAPL just bought 10,000 shares',
    selftext: 'I saw in the SEC filing that Tim Cook bought a ton of shares.',
    subreddit: 'stocks',
    score: 42,
  };
  const SAMPLE_DATA = {
    ticker: 'AAPL',
    insider_name: 'Tim Cook',
    transaction_type: 'purchased',
    shares: 10000,
    value_usd: 2255000,
    date: '2024-01-15',
  };

  test('returns object with prompt and maxTokens', () => {
    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('maxTokens');
  });

  test('prompt includes the post title', () => {
    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
    expect(result.prompt).toContain(SAMPLE_POST.title);
  });

  test('prompt includes the insider data', () => {
    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
    expect(result.prompt).toContain('Tim Cook');
    expect(result.prompt).toContain('AAPL');
  });

  test('prompt cites the subreddit tone', () => {
    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
    expect(result.prompt).toContain('stocks');
  });

  test('prompt contains NO brand names rule', () => {
    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
    expect(result.prompt.toUpperCase()).toContain('NO BRAND');
  });

  test('prompt contains NO links/URLs rule', () => {
    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
    expect(result.prompt.toUpperCase()).toContain('NO LINKS');
  });

  test('maxTokens is within reasonable range (100-300)', () => {
    const result = draftComment(SAMPLE_POST, SAMPLE_DATA);
    expect(result.maxTokens).toBeGreaterThanOrEqual(100);
    expect(result.maxTokens).toBeLessThanOrEqual(300);
  });

  test('handles null post and data gracefully', () => {
    expect(() => draftComment(null, null)).not.toThrow();
    const result = draftComment(null, null);
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('maxTokens');
  });
});

// ─── validateComment ──────────────────────────────────────────────────────

describe('validateComment()', () => {
  const VALID_COMMENT =
    'I checked the SEC filings and noticed some interesting activity. '
    + 'The director purchased a significant block of shares last week. '
    + 'That kind of conviction from insiders usually signals something.';

  test('returns { valid: false } for null/empty input', () => {
    expect(validateComment(null).valid).toBe(false);
    expect(validateComment('').valid).toBe(false);
    expect(validateComment(undefined).valid).toBe(false);
  });

  test('returns { valid: true } for a clean 3-sentence comment', () => {
    const result = validateComment(VALID_COMMENT);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('detects URLs / domain names', () => {
    const result = validateComment('Check out https://example.com for details. It is great. Very useful.');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('url') || i.toLowerCase().includes('domain'))).toBe(true);
  });

  test('detects brand name InsiderBuying', () => {
    const result = validateComment('InsiderBuying tracks this data. It is a site I use. Very handy for research.');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('InsiderBuying'))).toBe(true);
  });

  test('detects brand name EarlyInsider (case-insensitive)', () => {
    const result = validateComment('earlyinsider has good data. I use it daily. It tracks SEC filings well.');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('earlyinsider'))).toBe(true);
  });

  test('flags comment with fewer than 3 sentences', () => {
    const result = validateComment('Only one sentence here.');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('few sentences') || i.toLowerCase().includes('too few'))).toBe(true);
  });

  test('flags comment with more than 5 sentences', () => {
    const text =
      'First sentence. Second sentence. Third sentence. Fourth sentence. Sixth sentence. Seventh sentence.';
    const result = validateComment(text);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes('many sentences') || i.toLowerCase().includes('too many'))).toBe(true);
  });

  test('result always has issues array', () => {
    expect(Array.isArray(validateComment(VALID_COMMENT).issues)).toBe(true);
    expect(Array.isArray(validateComment(null).issues)).toBe(true);
  });
});

// ─── logComment ───────────────────────────────────────────────────────────

describe('logComment()', () => {
  const URL = 'https://reddit.com/r/stocks/comments/abc123';
  const SUBREDDIT = 'stocks';
  const TEXT = 'Interesting insider activity here.';
  const STATUS = 'posted';

  test('returns flat object — no { fields: {} } wrapper', () => {
    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
    expect(record.fields).toBeUndefined();
  });

  test('includes post_url field', () => {
    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
    expect(record.post_url).toBe(URL);
  });

  test('includes subreddit field', () => {
    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
    expect(record.subreddit).toBe(SUBREDDIT);
  });

  test('includes comment_text field', () => {
    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
    expect(record.comment_text).toBe(TEXT);
  });

  test('includes status field', () => {
    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
    expect(record.status).toBe(STATUS);
  });

  test('posted_at is a valid ISO timestamp', () => {
    const record = logComment(URL, SUBREDDIT, TEXT, STATUS);
    expect(() => new Date(record.posted_at)).not.toThrow();
    expect(new Date(record.posted_at).toISOString()).toBe(record.posted_at);
  });

  test('handles null/missing arguments gracefully', () => {
    expect(() => logComment(null, null, null, null)).not.toThrow();
    const record = logComment(null, null, null, null);
    expect(record.post_url).toBe('');
    expect(record.subreddit).toBe('');
  });
});
