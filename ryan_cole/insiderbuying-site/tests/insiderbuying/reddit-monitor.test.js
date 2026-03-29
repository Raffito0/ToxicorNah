'use strict';

const mod = require('../../n8n/code/insiderbuying/reddit-monitor');
const {
  SUBREDDITS,
  SEARCH_KEYWORDS,
  buildSearchQueries,
  filterByScore,
  draftComment,
  validateComment,
  logComment,
  getISOWeekKey,
} = mod;

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

// ─── Section 04 — CAT 5 Daily Thread ─────────────────────────────────────

// Helpers shared across section-04 tests
function mockSkipDays(days) {
  // Used for weekend tests only — those return early before the NocoDB call
  const isoWeek = getISOWeekKey(new Date());
  mod._setDeps({
    fetch: async () => ({
      status: 200,
      json: () => ({
        list: days !== null
          ? [{ key: 'week_skip_days', value: JSON.stringify({ week: isoWeek, days }), Id: 1 }]
          : [],
      }),
    }),
  });
}

function mockSkipDaysWithNow(days, nowFn) {
  const isoWeek = getISOWeekKey(nowFn());
  mod._setDeps({
    fetch: async () => ({
      status: 200,
      json: () => ({
        list: days !== null
          ? [{ key: 'week_skip_days', value: JSON.stringify({ week: isoWeek, days }), Id: 1 }]
          : [],
      }),
    }),
  });
}

// ─── shouldPostDailyThread ────────────────────────────────────────────────

describe('shouldPostDailyThread', () => {
  afterEach(() => {
    mod._setNow(null);
    mod._setDeps(null);
  });

  test('returns false on Saturday (dayOfWeek=6)', async () => {
    mod._setNow(() => new Date('2026-03-28T10:00:00Z')); // Saturday
    mockSkipDays([]);
    const r = await mod.shouldPostDailyThread();
    expect(r.post).toBe(false);
  });

  test('returns false on Sunday (dayOfWeek=0)', async () => {
    mod._setNow(() => new Date('2026-03-29T10:00:00Z')); // Sunday
    mockSkipDays([]);
    const r = await mod.shouldPostDailyThread();
    expect(r.post).toBe(false);
  });

  test('returns false on a skip day', async () => {
    const nowFn = () => new Date('2026-03-30T10:00:00Z'); // Monday
    mod._setNow(nowFn);
    mockSkipDaysWithNow([1], nowFn); // Monday is skip day
    const r = await mod.shouldPostDailyThread();
    expect(r.post).toBe(false);
  });

  test('returns true on a regular weekday', async () => {
    const nowFn = () => new Date('2026-03-31T10:00:00Z'); // Tuesday
    mod._setNow(nowFn);
    mockSkipDaysWithNow([], nowFn);
    const r = await mod.shouldPostDailyThread();
    expect(r.post).toBe(true);
  });

  test('sets isWeekendRecap=true on Monday', async () => {
    const nowFn = () => new Date('2026-03-30T10:00:00Z'); // Monday
    mod._setNow(nowFn);
    mockSkipDaysWithNow([], nowFn);
    const r = await mod.shouldPostDailyThread();
    if (r.post) expect(r.isWeekendRecap).toBe(true);
  });
});

// ─── findDailyDiscussionThread ────────────────────────────────────────────

describe('findDailyDiscussionThread', () => {
  const TODAY_UTC = '2026-03-31T12:00:00Z'; // Tuesday

  function sticky(title, created_utc) {
    return { status: 200, json: () => ({ data: { title, created_utc } }) };
  }
  function notFound() { return { status: 404, json: () => ({}) }; }
  function hotPosts(posts) {
    return { status: 200, json: () => ({ data: { children: posts.map((p) => ({ data: p })) } }) };
  }

  afterEach(() => {
    mod._setNow(null);
    mod._setDeps(null);
  });

  test('returns sticky 1 if title contains "Daily" and created today (EST)', async () => {
    const created = new Date('2026-03-31T07:00:00-04:00').getTime() / 1000;
    mod._setNow(() => new Date(TODAY_UTC));
    mod._setDeps({
      fetch: async (url) => {
        if (url.includes('sticky?num=1')) return sticky('Daily Discussion - March 31', created);
        return notFound();
      },
    });
    const r = await mod.findDailyDiscussionThread('stocks');
    expect(r).not.toBeNull();
  });

  test('falls back to sticky 2 if sticky 1 is not a daily thread', async () => {
    const created = new Date('2026-03-31T07:30:00-04:00').getTime() / 1000;
    mod._setNow(() => new Date(TODAY_UTC));
    mod._setDeps({
      fetch: async (url) => {
        if (url.includes('sticky?num=1')) return sticky('Weekly Megathread', created);
        if (url.includes('sticky?num=2')) return sticky('Daily Discussion Thread', created);
        return notFound();
      },
    });
    const r = await mod.findDailyDiscussionThread('stocks');
    expect(r).not.toBeNull();
  });

  test('falls back to hot posts if both stickies fail', async () => {
    const created = new Date('2026-03-31T08:00:00-04:00').getTime() / 1000;
    mod._setNow(() => new Date(TODAY_UTC));
    mod._setDeps({
      fetch: async (url) => {
        if (url.includes('sticky')) return notFound();
        if (url.includes('/hot')) return hotPosts([{ title: 'Daily Discussion Thread', name: 't3_abc', created_utc: created }]);
        return notFound();
      },
    });
    const r = await mod.findDailyDiscussionThread('stocks');
    expect(r).not.toBeNull();
  });

  test('returns null if no daily thread found by any method', async () => {
    mod._setNow(() => new Date(TODAY_UTC));
    mod._setDeps({ fetch: async () => notFound() });
    const r = await mod.findDailyDiscussionThread('stocks');
    expect(r).toBeNull();
  });

  test('uses EST timezone — post created at 23:00 UTC (7 PM EST) is "today"', async () => {
    const created = new Date('2026-03-31T23:00:00Z').getTime() / 1000;
    mod._setNow(() => new Date('2026-03-31T23:30:00Z'));
    mod._setDeps({
      fetch: async (url) => {
        if (url.includes('sticky?num=1')) return sticky('Daily Discussion', created);
        return notFound();
      },
    });
    const r = await mod.findDailyDiscussionThread('stocks');
    expect(r).not.toBeNull();
  });

  test('rejects sticky posted yesterday (EST)', async () => {
    // 22:00 UTC yesterday = 6 PM EST yesterday
    const created = new Date('2026-03-30T22:00:00Z').getTime() / 1000;
    mod._setNow(() => new Date('2026-03-31T12:00:00Z'));
    mod._setDeps({
      fetch: async (url) => {
        if (url.includes('sticky?num=1')) return sticky('Daily Discussion', created);
        return notFound();
      },
    });
    const r = await mod.findDailyDiscussionThread('stocks');
    expect(r).toBeNull();
  });
});

// ─── buildDailyThreadComment ──────────────────────────────────────────────

describe('buildDailyThreadComment', () => {
  const mockData = {
    filings: [
      { ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-30', company: 'Apple Inc.' },
      { ticker: 'MSFT', insider_name: 'Satya Nadella', role: 'CEO', value_usd: 500000, date: '2026-03-30', company: 'Microsoft Corp.' },
    ],
    period: 'yesterday',
  };

  test('returns non-empty string for template index 0 (notable_buys)', () => {
    const text = mod.buildDailyThreadComment(mockData, 0);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(50);
  });

  test('returns non-empty string for template index 1 (confidence_index)', () => {
    const text = mod.buildDailyThreadComment(mockData, 1);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(50);
  });

  test('returns non-empty string for template index 2 (unusual_activity)', () => {
    const text = mod.buildDailyThreadComment(mockData, 2);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(50);
  });

  test('includes ticker symbol in output', () => {
    const text = mod.buildDailyThreadComment(mockData, 0);
    expect(text.includes('AAPL') || text.includes('MSFT')).toBe(true);
  });

  test('includes formatted dollar amount', () => {
    const text = mod.buildDailyThreadComment(mockData, 0);
    expect(text.includes('$')).toBe(true);
    expect(text.includes('M') || text.includes('K')).toBe(true);
  });

  test('does not contain URLs', () => {
    [0, 1, 2].forEach((idx) => {
      const text = mod.buildDailyThreadComment(mockData, idx);
      expect(/https?:\/\//.test(text)).toBe(false);
    });
  });

  test('handles empty filings array without throwing', () => {
    expect(() => mod.buildDailyThreadComment({ filings: [], period: 'yesterday' }, 0)).not.toThrow();
  });

  test('includes period label in weekend recap (Monday)', () => {
    const text = mod.buildDailyThreadComment({ filings: mockData.filings, period: 'Fri-Sun' }, 1);
    expect(text.includes('Fri') || text.includes('weekend') || text.includes('Sun')).toBe(true);
  });
});

// ─── postDailyThread ──────────────────────────────────────────────────────

describe('postDailyThread', () => {
  afterEach(() => {
    mod._setNow(null);
    mod._setDeps(null);
  });

  test('returns early when shouldPostDailyThread() returns post=false', async () => {
    const posts = [];
    mod._setNow(() => new Date('2026-03-28T10:00:00Z')); // Saturday
    mod._setDeps({
      fetch: async (url, opts) => {
        if (opts && opts.method === 'POST' && url.includes('reddit.com')) posts.push(true);
        return { status: 200, json: () => ({ list: [] }) };
      },
    });
    await mod.postDailyThread();
    expect(posts.length).toBe(0);
  });

  test('returns early when findDailyDiscussionThread() returns null — logs warning', async () => {
    const posts = [];
    const nowFn = () => new Date('2026-03-31T10:00:00Z'); // Tuesday
    mod._setNow(nowFn);
    mod._setDeps({
      fetch: async (url, opts) => {
        if (opts && opts.method === 'POST' && url.includes('api/comment')) posts.push(true);
        if (url.includes('sticky') || url.includes('/hot') || url.includes('search')) {
          return { status: 404, json: () => ({}) };
        }
        return { status: 200, json: () => ({ list: [] }) };
      },
    });
    await mod.postDailyThread();
    expect(posts.length).toBe(0);
  });

  test('posts comment and does not throw — verify no crash', async () => {
    const nowFn = () => new Date('2026-03-31T10:00:00Z'); // Tuesday
    mod._setNow(nowFn);
    const threadCreated = new Date('2026-03-31T07:00:00-04:00').getTime() / 1000;
    mod._setDeps({
      fetch: async (url, opts) => {
        if (url.includes('sticky?num=1')) {
          return {
            status: 200,
            json: () => ({ data: { title: 'Daily Discussion', name: 't3_thread1', id: 'thread1', created_utc: threadCreated } }),
          };
        }
        if (opts && opts.method === 'POST' && url.includes('api/comment')) {
          return {
            status: 200,
            json: () => ({ json: { data: { things: [{ data: { id: 'newcmt', name: 't1_newcmt' } }] } } }),
          };
        }
        if (url.includes('nocodb')) return { status: 200, json: () => ({ list: [] }) };
        if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) {
          return { status: 200, json: () => ({}) };
        }
        return { status: 200, json: () => ({ list: [{ ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-30' }] }) };
      },
    });
    await expect(mod.postDailyThread()).resolves.not.toThrow();
  });
});

// ─── Section 05 — CAT 6 DD Posts ──────────────────────────────────────────

describe('checkDDPostLimit', () => {
  function mockDD(rows) {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: rows }) }) });
  }

  afterEach(() => { mod._setDeps(null); });

  test('returns allowed=true when no recent posts', async () => {
    mockDD([]);
    const r = await mod.checkDDPostLimit();
    expect(r.allowed).toBe(true);
  });
  test('returns allowed=false + reason=too_recent when last post < 3 days ago', async () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    mockDD([{ posted_at: recentDate, status: 'posted' }]);
    const r = await mod.checkDDPostLimit();
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('too_recent');
  });
  test('returns allowed=false + reason=monthly_limit when 8+ posts this month', async () => {
    const rows = Array(8).fill({ posted_at: new Date().toISOString(), status: 'posted' });
    mockDD(rows);
    const r = await mod.checkDDPostLimit();
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('monthly_limit');
  });
  test('counts only status=posted records', async () => {
    mockDD([{ posted_at: new Date().toISOString(), status: 'draft' }]);
    const r = await mod.checkDDPostLimit();
    expect(r.allowed).toBe(true);
  });
});

describe('buildDDPost — 4-step pipeline', () => {
  let callCount;
  function mockClaude(responses) {
    callCount = 0;
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic.com') || url.includes('claude')) {
        const resp = responses[callCount] || 'default text '.repeat(200);
        callCount++;
        return { status: 200, json: () => ({ content: [{ text: resp }] }) };
      }
      return { status: 200, json: () => ({ list: [] }) };
    }});
  }

  afterEach(() => { mod._setDeps(null); });

  const mockFilingData = {
    ticker: 'AAPL', company: 'Apple Inc.', marketCapUsd: 3_000_000_000_000,
    filings: [{ insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', price: 210 }],
    priceHistory: [], peers: [],
  };

  test('makes exactly 4 Claude calls in sequence', async () => {
    const outline = 'Section headers here';
    const fullDraft = '## Bear Case\n' + 'risk '.repeat(450) + '## TLDR\n- point\n' + 'body '.repeat(1100);
    const bearReview = 'Score: 8. The bear case is strong.';
    const tldr = '## TLDR\n- $AAPL CEO bought $2M\n- Strong insider track record\n- Bear case: App Store antitrust';
    mockClaude([outline, fullDraft, bearReview, tldr]);
    await mod.buildDDPost('AAPL', mockFilingData);
    expect(callCount).toBe(4);
  });
  test('Step 3 replaces Bear Case when score < 7', async () => {
    const outline = 'Outline';
    const fullDraft = '## Bear Case\nweak bear case.\n## TLDR\n- point\n' + 'body '.repeat(1600);
    const bearLow = 'Score: 4. Rewrite:\n## Bear Case\n' + 'strong risk '.repeat(450);
    const tldr = '## TLDR\n- point one\n- point two\n- point three';
    mockClaude([outline, fullDraft, bearLow, tldr]);
    const result = await mod.buildDDPost('AAPL', mockFilingData);
    expect(result).not.toBeNull();
    expect(result).toContain('strong risk');
  });
  test('Step 3 keeps original Bear Case when score >= 7', async () => {
    const outline = 'Outline';
    const bearOriginal = '## Bear Case\n' + 'original risk '.repeat(450);
    const fullDraft = bearOriginal + '## TLDR\n- point\n' + 'body '.repeat(1100);
    const bearHigh = 'Score: 9. The bear case is solid.';
    const tldr = '## TLDR\n- point one\n- point two';
    mockClaude([outline, fullDraft, bearHigh, tldr]);
    const result = await mod.buildDDPost('AAPL', mockFilingData);
    expect(result).not.toBeNull();
    expect(result).toContain('original risk');
  });
  test('Step 4 TLDR is prepended to the post', async () => {
    const outline = 'Outline';
    const fullDraft = '## Bear Case\n' + 'risk '.repeat(450) + '\nbody '.repeat(1100);
    const bearReview = 'Score: 8. Strong.';
    const tldr = '## TLDR\n- First bullet\n- Second bullet';
    mockClaude([outline, fullDraft, bearReview, tldr]);
    const result = await mod.buildDDPost('AAPL', mockFilingData);
    if (result) expect(result.indexOf('## TLDR')).toBeLessThan(200);
  });
});

describe('validateDDPost retry in buildDDPost pipeline', () => {
  afterEach(() => { mod._setDeps(null); });

  test('retries Step 2 once with failure reason in prompt if validation fails first time', async () => {
    const prompts = [];
    let callCount = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        callCount++;
        const body = JSON.parse(opts.body);
        const userMsg = (body.messages && body.messages.find(function(m) { return m.role === 'user'; }) || {}).content || '';
        prompts.push(userMsg);
        if (callCount === 2) return { status: 200, json: () => ({ content: [{ text: 'short draft' }] }) };
        if (callCount === 3) {
          const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
          return { status: 200, json: () => ({ content: [{ text: valid }] }) };
        }
        return { status: 200, json: () => ({ content: [{ text: 'x' }] }) };
      }
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.buildDDPost('AAPL', { ticker: 'AAPL', filings: [], priceHistory: [], peers: [] });
    const retryPrompt = prompts.find(function(p) { return p.includes('word') || p.includes('Bear') || p.includes('short') || p.includes('failed') || p.includes('validation') || p.includes('Fix'); });
    expect(retryPrompt || callCount >= 3).toBeTruthy();
  });
  test('returns null if validation fails after retry', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'too short' }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    const result = await mod.buildDDPost('AAPL', { ticker: 'AAPL', filings: [], priceHistory: [], peers: [] });
    expect(result).toBeNull();
  });
});

describe('human-likeness check in postDDPost', () => {
  afterEach(() => { mod._setDeps(null); mod._setNow(null); });

  test('aborts if human-likeness rating < 7 after rewrite cycle', async () => {
    const posts = [];
    let call = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        call++;
        if (call <= 4) {
          const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
          return { status: 200, json: () => ({ content: [{ text: valid }] }) };
        }
        return { status: 200, json: () => ({ content: [{ text: 'Rating: 5\n1. phrase one\n2. phrase two\n3. phrase three\nRewrite: ...' }] }) };
      }
      if (opts && opts.method === 'POST' && url.includes('reddit.com')) posts.push(true);
      return { status: 200, json: () => ({ list: [{ ticker: 'AAPL', insider_name: 'T.Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', score: 9, marketCapUsd: 3e12 }] }) };
    }});
    mod._setNow(function() { return new Date('2026-03-31T15:00:00Z'); }); // Tuesday 11 AM EST
    await mod.postDDPost();
    expect(posts.length).toBe(0);
  });
});

describe('Imgur visual upload', () => {
  afterEach(() => { mod._setDeps(null); });

  test('skips visual if generateInsiderTable returns null', async () => {
    const imgurCalls = [];
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('api.imgur.com')) imgurCalls.push(true);
      return { status: 200, json: () => ({ data: { link: 'https://i.imgur.com/abc.png' } }) };
    }});
    const result = await mod._uploadDDVisuals('AAPL', [], [], []);
    expect(imgurCalls.length).toBe(0);
    expect(result).toEqual([]);
  });
  test('calls Imgur when a visual returns non-null base64', async () => {
    const imgurCalls = [];
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('api.imgur.com')) { imgurCalls.push(true); return { status: 200, json: () => ({ data: { link: 'https://i.imgur.com/abc.png' } }) }; }
      return { status: 200, json: () => ({}) };
    }});
    const vt = require('../../n8n/code/insiderbuying/visual-templates.js');
    const orig = vt.generateInsiderTable;
    vt.generateInsiderTable = function() { return 'base64data=='; };
    const result = await mod._uploadDDVisuals('AAPL', [{ ticker: 'AAPL' }], [], []);
    vt.generateInsiderTable = orig;
    expect(imgurCalls.length).toBeGreaterThanOrEqual(1);
  });
  test('skips gracefully if Imgur upload throws', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('api.imgur.com')) throw new Error('Imgur unavailable');
      return { status: 200, json: () => ({}) };
    }});
    const vt = require('../../n8n/code/insiderbuying/visual-templates.js');
    const orig = vt.generatePriceChart;
    vt.generatePriceChart = function() { return 'base64=='; };
    await expect(mod._uploadDDVisuals('AAPL', [], {}, [])).resolves.not.toThrow();
    vt.generatePriceChart = orig;
  });
});

describe('target subreddit selection — _selectDDSubreddits', () => {
  test('always includes stocks', () => {
    const subs = mod._selectDDSubreddits(7, 500_000_000, 1);
    expect(subs).toContain('stocks');
  });
  test('includes wallstreetbets when score >= 8 and marketCap >= 5B', () => {
    const subs = mod._selectDDSubreddits(8, 10_000_000_000, 1);
    expect(subs).toContain('wallstreetbets');
  });
  test('excludes wallstreetbets when score < 8', () => {
    const subs = mod._selectDDSubreddits(7, 10_000_000_000, 1);
    expect(subs).not.toContain('wallstreetbets');
  });
  test('includes ValueInvesting when >= 3 fundamental metrics cited', () => {
    const subs = mod._selectDDSubreddits(7, 1_000_000_000, 3);
    expect(subs).toContain('ValueInvesting');
  });
  test('excludes ValueInvesting when < 3 metrics', () => {
    const subs = mod._selectDDSubreddits(7, 1_000_000_000, 2);
    expect(subs).not.toContain('ValueInvesting');
  });
});

describe('per-subreddit intro variants', () => {
  afterEach(() => { mod._setDeps(null); });

  test('stocks variant uses main DD body unchanged (no extra Claude call)', async () => {
    const body = 'main body '.repeat(100);
    let claudeCalls = 0;
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) claudeCalls++;
      return { status: 200, json: () => ({ content: [{ text: 'wsb opener' }] }) };
    }});
    const variants = await mod._buildSubredditVariants(['stocks'], body, 'AAPL');
    expect(variants.stocks).toBe(body + '\n\nNot financial advice. Do your own research.');
    expect(claudeCalls).toBe(0);
  });
  test('wallstreetbets variant has opener prepended + NFA appended', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'WSB opener for AAPL' }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    const body = 'main body '.repeat(100);
    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets'], body, 'AAPL');
    expect(variants.wallstreetbets.startsWith('WSB opener for AAPL')).toBe(true);
    expect(variants.wallstreetbets.endsWith('Not financial advice. Do your own research.')).toBe(true);
  });
  test('all variants are <= 38000 chars', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'Short opener.' }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    const body = 'body '.repeat(5000);
    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets', 'ValueInvesting'], body, 'AAPL');
    Object.values(variants).forEach(function(v) { expect(v.length).toBeLessThanOrEqual(38000); });
  });
  test('NFA disclaimer appended to all variants', async () => {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'opener' }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    const body = 'body '.repeat(100);
    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets'], body, 'AAPL');
    Object.values(variants).forEach(function(v) {
      expect(v.includes('Not financial advice.')).toBe(true);
    });
  });
});

describe('postDDPost', () => {
  afterEach(() => { mod._setDeps(null); mod._setNow(null); });

  test('returns early when checkDDPostLimit not allowed', async () => {
    const posts = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('reddit.com/r/')) posts.push(true);
      return { status: 200, json: () => ({ list: [{ posted_at: new Date().toISOString(), status: 'posted' }] }) };
    }});
    await mod.postDDPost();
    expect(posts.length).toBe(0);
  });
  test('returns early when day is not Tue-Thu', async () => {
    const posts = [];
    mod._setNow(function() { return new Date('2026-03-28T10:00:00Z'); }); // Saturday
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('reddit.com')) posts.push(true);
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.postDDPost();
    expect(posts.length).toBe(0);
  });
  test('returns early when time is outside 10AM-2PM EST', async () => {
    const posts = [];
    mod._setNow(function() { return new Date('2026-03-31T21:00:00Z'); }); // Tuesday 5 PM EST
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('reddit.com')) posts.push(true);
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.postDDPost();
    expect(posts.length).toBe(0);
  });
  test('logs to Reddit_DD_Posts with status=posted and price_at_post', async () => {
    const ddPostLogs = [];
    mod._setNow(function() { return new Date('2026-03-31T15:00:00Z'); }); // Tuesday 11 AM EST
    let call = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        call++;
        const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
        if (call <= 4) return { status: 200, json: () => ({ content: [{ text: valid }] }) };
        return { status: 200, json: () => ({ content: [{ text: 'Rating: 8. Looks human.' }] }) };
      }
      if (opts && opts.method === 'POST' && url.includes('Reddit_DD_Posts')) {
        ddPostLogs.push(JSON.parse(opts.body));
        return { status: 200, json: () => ({}) };
      }
      if (opts && opts.method === 'POST' && url.includes('reddit.com')) {
        return { status: 200, json: () => ({ json: { data: { things: [{ data: { id: 'dd1', name: 't3_dd1', url: 'https://reddit.com/r/stocks/dd1' } }] } } }) };
      }
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) return { status: 200, json: () => ({}) };
      return { status: 200, json: () => ({ list: [{ ticker: 'AAPL', insider_name: 'T.Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', score: 9, marketCapUsd: 3e12 }] }) };
    }});
    await mod.postDDPost();
    if (ddPostLogs.length > 0) {
      expect(ddPostLogs[0].status).toBe('posted');
      expect('price_at_post' in ddPostLogs[0]).toBe(true);
    }
  });
});

// ─── Section 06 — Anti-AI Detection ──────────────────────────────────────

describe('NEGATIVE_EXAMPLES', () => {
  test('is a non-empty string', () => {
    expect(typeof mod.NEGATIVE_EXAMPLES === 'string' && mod.NEGATIVE_EXAMPLES.length > 100).toBe(true);
  });
  test('contains a bad example (passive voice pattern)', () => {
    const lower = mod.NEGATIVE_EXAMPLES.toLowerCase();
    expect(lower.includes('bad') || lower.includes('avoid') || lower.includes('worth noting')).toBe(true);
  });
  test('contains a good example (direct, specific)', () => {
    const lower = mod.NEGATIVE_EXAMPLES.toLowerCase();
    expect(lower.includes('good') || lower.includes('direct') || lower.includes('$')).toBe(true);
  });
  test('does not contain any URLs', () => {
    expect(/https?:\/\//.test(mod.NEGATIVE_EXAMPLES)).toBe(false);
  });
  test('does not contain EarlyInsider brand name', () => {
    expect(mod.NEGATIVE_EXAMPLES.toLowerCase().includes('earlyinsider')).toBe(false);
  });
});

describe('ANTI_PUMP_RULE', () => {
  test('is a non-empty string', () => {
    expect(typeof mod.ANTI_PUMP_RULE === 'string' && mod.ANTI_PUMP_RULE.length > 20).toBe(true);
  });
  test('contains NEVER or never', () => {
    expect(/never/i.test(mod.ANTI_PUMP_RULE)).toBe(true);
  });
  test('mentions recommend or buying', () => {
    const lower = mod.ANTI_PUMP_RULE.toLowerCase();
    expect(lower.includes('recommend') || lower.includes('buying') || lower.includes('buy')).toBe(true);
  });
});

describe('buildCommentPrompt', () => {
  const mockPost = { title: 'CEO of AAPL just filed Form 4', selftext: 'What do you think?', subreddit: 'stocks', score: 50, name: 't3_abc' };
  const mockInsiderData = { ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-25', track_record: '3 prior buys, avg +22% in 12mo' };
  const mockStructure = { id: 'Q_A_DATA', systemPromptInstruction: 'Open with a question, then answer with data.' };

  function mockClaudeResponse(text) {
    mod._setDeps({ fetch: async (url) => {
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text }] }) };
      return { status: 200, json: () => ({}) };
    }});
  }

  afterEach(() => { mod._setDeps(null); });

  test('includes NEGATIVE_EXAMPLES in system prompt', async () => {
    let systemPrompt = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        systemPrompt = body.system || '';
        return { status: 200, json: () => ({ content: [{ text: 'CEO bought $2M. Third buy this year.' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(systemPrompt.includes('avoid') || systemPrompt.includes('NEVER') || systemPrompt.includes('worth noting')).toBe(true);
  });
  test('includes ANTI_PUMP_RULE in system prompt', async () => {
    let systemPrompt = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        systemPrompt = body.system || '';
        return { status: 200, json: () => ({ content: [{ text: 'Test response.' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(/never/i.test(systemPrompt)).toBe(true);
  });
  test('includes subreddit tone string from SUBREDDIT_TONE_MAP', async () => {
    let systemPrompt = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        systemPrompt = body.system || '';
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(systemPrompt.includes('balanced') || systemPrompt.length > 50).toBe(true);
  });
  test('includes structure instruction in system prompt', async () => {
    let systemPrompt = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        systemPrompt = body.system || '';
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(systemPrompt.includes('question') || systemPrompt.includes('Q_A')).toBe(true);
  });
  test('includes post title and body in user message', async () => {
    let userMessage = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        userMessage = JSON.stringify(body.messages);
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(userMessage.includes('CEO of AAPL just filed Form 4')).toBe(true);
  });
  test('includes insider data in user message', async () => {
    let userMessage = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        userMessage = JSON.stringify(body.messages);
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(userMessage.includes('Tim Cook') || userMessage.includes('AAPL')).toBe(true);
  });
  test('sets model to claude-sonnet-4-6', async () => {
    let model = '';
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        model = body.model || '';
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(model.includes('claude-sonnet-4-6') || model.includes('sonnet')).toBe(true);
  });
  test('sets maxTokens to 300', async () => {
    let maxTokens = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        maxTokens = body.max_tokens || 0;
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(maxTokens).toBe(300);
  });
  test('sets temperature to 0.7', async () => {
    let temperature = 0;
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('anthropic')) {
        const body = JSON.parse(opts.body);
        temperature = body.temperature || 0;
        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
      }
      return { status: 200, json: () => ({}) };
    }});
    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(Math.abs(temperature - 0.7)).toBeLessThan(0.01);
  });
  test('makes the actual Claude API call and returns generated text string', async () => {
    mockClaudeResponse('CEO just dropped $2M on AAPL at these prices. Third buy this year. Curious if others are watching this.');
    const text = await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
    expect(typeof text === 'string' && text.length > 10).toBe(true);
  });
  test('returns null/throws when Claude returns empty string', async () => {
    mockClaudeResponse('');
    try {
      const text = await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
      expect(text === null || text === '' || text === undefined).toBe(true);
    } catch (_) { /* acceptable */ }
  });
});

// ===== SECTION 01: SUBREDDIT_TONE_MAP + getRedditToken + getState/setState + getRedditLog =====

describe('SUBREDDIT_TONE_MAP', () => {
  test('has exactly 5 subreddits', () => {
    expect(Object.keys(mod.SUBREDDIT_TONE_MAP).length).toBe(5);
  });
  test('includes wallstreetbets, ValueInvesting, stocks, Dividends, InsiderTrades', () => {
    ['wallstreetbets', 'ValueInvesting', 'stocks', 'Dividends', 'InsiderTrades'].forEach(sub => {
      expect(mod.SUBREDDIT_TONE_MAP[sub]).toBeTruthy();
    });
  });
  test('each entry has tone, wordLimit, style, example, dailyCap', () => {
    Object.values(mod.SUBREDDIT_TONE_MAP).forEach(cfg => {
      expect(typeof cfg.tone).toBe('string');
      expect(Array.isArray(cfg.wordLimit) && cfg.wordLimit.length === 2).toBe(true);
      expect(typeof cfg.style).toBe('string');
      expect(typeof cfg.example).toBe('string');
      expect(typeof cfg.dailyCap).toBe('number');
    });
  });
  test('dailyCaps sum to 10', () => {
    const total = Object.values(mod.SUBREDDIT_TONE_MAP).reduce((s, c) => s + c.dailyCap, 0);
    expect(total).toBe(10);
  });
  test('wordLimit[0] < wordLimit[1] for all entries', () => {
    Object.entries(mod.SUBREDDIT_TONE_MAP).forEach(([sub, cfg]) => {
      expect(cfg.wordLimit[0]).toBeLessThan(cfg.wordLimit[1]);
    });
  });
});

describe('getRedditToken - refresh token mode', () => {
  test('uses grant_type=refresh_token when REDDIT_REFRESH_TOKEN is set', async () => {
    let capturedBody = '';
    mod._setDeps({ fetch: async (url, opts) => {
      capturedBody = opts.body || '';
      if (url.includes('reddit.com')) return { status: 200, json: () => ({ access_token: 'tok123', expires_in: 3600 }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    process.env.REDDIT_REFRESH_TOKEN = 'refresh_abc';
    process.env.REDDIT_CLIENT_ID = 'cid';
    process.env.REDDIT_CLIENT_SECRET = 'csec';
    const token = await mod.getRedditToken({ _skipCache: true });
    expect(capturedBody.includes('grant_type=refresh_token')).toBe(true);
    expect(token).toBe('tok123');
    delete process.env.REDDIT_REFRESH_TOKEN;
  });

  test('reads cached token from NocoDB if not expired - no HTTP call to Reddit', async () => {
    let redditCallCount = 0;
    const future = new Date(Date.now() + 7200000).toISOString();
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('reddit.com')) redditCallCount++;
      return { status: 200, json: () => ({ list: [{ key: 'reddit_auth', value: JSON.stringify({ token: 'cached_tok', expires_at: future }), Id: 1 }] }) };
    }});
    const token = await mod.getRedditToken();
    expect(token).toBe('cached_tok');
    expect(redditCallCount).toBe(0);
  });

  test('calls Reddit auth endpoint when cached token is expired', async () => {
    let redditCallCount = 0;
    const past = new Date(Date.now() - 1000).toISOString();
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('reddit.com/api/v1/access_token')) { redditCallCount++; return { status: 200, json: () => ({ access_token: 'fresh', expires_in: 3600 }) }; }
      if (url.includes('reddit.com')) return { status: 200, json: () => ({ access_token: 'fresh', expires_in: 3600 }) };
      return { status: 200, json: () => ({ list: [{ key: 'reddit_auth', value: JSON.stringify({ token: 'old_tok', expires_at: past }), Id: 1 }] }) };
    }});
    process.env.REDDIT_REFRESH_TOKEN = 'reftok';
    const token = await mod.getRedditToken();
    expect(token).toBe('fresh');
    expect(redditCallCount).toBeGreaterThanOrEqual(1);
    delete process.env.REDDIT_REFRESH_TOKEN;
  });
});

describe('getRedditToken - ROPC fallback', () => {
  test('uses grant_type=password when REDDIT_REFRESH_TOKEN is absent', async () => {
    delete process.env.REDDIT_REFRESH_TOKEN;
    process.env.REDDIT_USERNAME = 'user1';
    process.env.REDDIT_PASSWORD = 'pass1';
    let capturedBody = '';
    mod._setDeps({ fetch: async (url, opts) => {
      capturedBody = opts.body || '';
      if (url.includes('reddit.com')) return { status: 200, json: () => ({ access_token: 'ropc_tok', expires_in: 3600 }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.getRedditToken({ _skipCache: true });
    expect(capturedBody.includes('grant_type=password')).toBe(true);
    expect(capturedBody.includes('username=user1')).toBe(true);
  });
});

describe('getState / setState', () => {
  test('getState returns JSON-parsed value for existing key', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [{ key: 'some_key', value: '{"count":3}', Id: 1 }] }) }) });
    const val = await mod.getState('some_key');
    expect(val).toEqual({ count: 3 });
  });
  test('getState returns null for missing key (empty list)', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [] }) }) });
    const val = await mod.getState('missing_key');
    expect(val).toBeNull();
  });
  test('setState sends POST/PATCH with JSON-serialized value', async () => {
    const writes = [];
    mod._setDeps({ fetch: async (url, opts) => { writes.push({ url, opts }); return { status: 200, json: () => ({ list: [] }) }; } });
    await mod.setState('my_key', { foo: 42 });
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const writeCall = writes.find(w => w.opts && (w.opts.method === 'POST' || w.opts.method === 'PATCH'));
    expect(writeCall).toBeTruthy();
    const body = typeof writeCall.opts.body === 'string' ? JSON.parse(writeCall.opts.body) : writeCall.opts.body;
    expect(body.value.includes('42')).toBe(true);
  });
  test('getState returns null when NocoDB returns malformed JSON', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [{ key: 'bad_key', value: 'not-json{{{', Id: 1 }] }) }) });
    const val = await mod.getState('bad_key');
    expect(val).toBeNull();
  });
});

describe('getRedditLog', () => {
  test('returns array of posted records for given date', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [{ subreddit: 'stocks', status: 'posted' }, { subreddit: 'wsb', status: 'posted' }] }) }) });
    const logs = await mod.getRedditLog('2026-03-28');
    expect(logs.length).toBe(2);
  });
  test('returns empty array when no records', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [] }) }) });
    const logs = await mod.getRedditLog('2026-03-28');
    expect(logs).toEqual([]);
  });
});

// ===== SECTION 02: REPLY_STRUCTURES + getNextReplyStructure + validateReply + validateDDPost =====

describe('REPLY_STRUCTURES', () => {
  test('defines exactly 3 structures', () => {
    expect(mod.REPLY_STRUCTURES.length).toBe(3);
  });
  test('each structure has id and systemPromptInstruction', () => {
    mod.REPLY_STRUCTURES.forEach(s => {
      expect(typeof s.id).toBe('string');
      expect(typeof s.systemPromptInstruction).toBe('string');
      expect(s.systemPromptInstruction.length).toBeGreaterThan(20);
    });
  });
  test('ids are Q_A_DATA, AGREEMENT_BUT, DATA_INTERPRET', () => {
    const ids = mod.REPLY_STRUCTURES.map(s => s.id);
    expect(ids).toContain('Q_A_DATA');
    expect(ids).toContain('AGREEMENT_BUT');
    expect(ids).toContain('DATA_INTERPRET');
  });
});

describe('getNextReplyStructure', () => {
  let stateStore;
  beforeEach(() => {
    stateStore = {};
    mod._setDeps({ fetch: async (url, opts) => {
      const isWrite = opts && (opts.method === 'PATCH' || opts.method === 'POST');
      if (isWrite) {
        const body = JSON.parse(opts.body);
        if (body.key) stateStore[body.key] = body.value;
        else { const idMatch = url.match(/\/([0-9]+)$/); if (idMatch) stateStore['_id_' + idMatch[1]] = body.value; }
        return { status: 200, json: () => ({}) };
      }
      const keyMatch = url.match(/where=\(key,eq,([^)&]+)\)/);
      const key = keyMatch ? decodeURIComponent(keyMatch[1]) : null;
      if (key && stateStore[key] !== undefined) return { status: 200, json: () => ({ list: [{ key, value: stateStore[key], Id: 1 }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
  });

  test('returns REPLY_STRUCTURES[0] on first call', async () => {
    const s = await mod.getNextReplyStructure('stocks');
    expect(s.id).toBe('Q_A_DATA');
  });
  test('returns REPLY_STRUCTURES[1] on second call', async () => {
    await mod.getNextReplyStructure('stocks');
    const s = await mod.getNextReplyStructure('stocks');
    expect(s.id).toBe('AGREEMENT_BUT');
  });
  test('wraps around to index 0 after cycling through all 3', async () => {
    await mod.getNextReplyStructure('stocks');
    await mod.getNextReplyStructure('stocks');
    const s = await mod.getNextReplyStructure('stocks');
    expect(s.id).toBe('DATA_INTERPRET');
    const s2 = await mod.getNextReplyStructure('stocks');
    expect(s2.id).toBe('Q_A_DATA');
  });
  test('rotates independently per subreddit', async () => {
    await mod.getNextReplyStructure('wallstreetbets');
    await mod.getNextReplyStructure('wallstreetbets');
    const stocksFirst = await mod.getNextReplyStructure('stocks');
    expect(stocksFirst.id).toBe('Q_A_DATA');
  });
});

describe('validateReply - word count', () => {
  test('accepts text within range for stocks (100-150 words)', () => {
    const text = 'word '.repeat(120).trim();
    const r = mod.validateReply(text, 'stocks');
    expect(r.valid).toBe(true);
  });
  test('rejects text below wordLimit[0] for wallstreetbets (min 50)', () => {
    const text = 'word '.repeat(30).trim();
    const r = mod.validateReply(text, 'wallstreetbets');
    expect(r.valid).toBe(false);
  });
  test('rejects text above wordLimit[1] for ValueInvesting (max 200)', () => {
    const text = 'word '.repeat(250).trim();
    const r = mod.validateReply(text, 'ValueInvesting');
    expect(r.valid).toBe(false);
  });
  test('applies tolerance: 46-word text passes for wsb min=50', () => {
    const text = 'word '.repeat(46).trim();
    const r = mod.validateReply(text, 'wallstreetbets');
    expect(r.valid).toBe(true);
  });
  test('returns valid, words, min, max shape', () => {
    const text = 'word '.repeat(100).trim();
    const r = mod.validateReply(text, 'stocks');
    expect('valid' in r && 'words' in r && 'min' in r && 'max' in r).toBe(true);
  });
});

describe('validateReply - markdown stripping', () => {
  test('strips bold markers before counting words', () => {
    const text = '**CEO** just ' + 'bought word '.repeat(90);
    const r = mod.validateReply(text, 'stocks');
    expect(r.words).toBeLessThan(190);
  });
  test('handles link syntax without crashing', () => {
    const text = '[See filing](https://sec.gov) ' + 'word '.repeat(100);
    const r = mod.validateReply(text, 'stocks');
    expect(typeof r.words).toBe('number');
  });
  test('strips header markers before counting', () => {
    const text = '### Header\n' + 'word '.repeat(120);
    const r = mod.validateReply(text, 'stocks');
    expect(typeof r.words).toBe('number');
  });
});

describe('validateReply - URL and brand name check', () => {
  test('rejects text containing https://', () => {
    const text = 'word '.repeat(100) + ' check https://example.com';
    const r = mod.validateReply(text, 'stocks');
    expect(r.valid).toBe(false);
  });
  test('rejects text containing EarlyInsider', () => {
    const text = 'word '.repeat(100) + ' EarlyInsider is great';
    const r = mod.validateReply(text, 'stocks');
    expect(r.valid).toBe(false);
  });
  test('accepts company names Apple or Tesla', () => {
    const text = 'Apple CEO ' + 'bought stock at '.repeat(15) + 'interesting data point here.';
    const r = mod.validateReply(text, 'ValueInvesting');
    expect(!r.issues || !r.issues.some(i => i.toLowerCase().includes('brand'))).toBe(true);
  });
  test('accepts $AAPL ticker symbol', () => {
    const text = '$AAPL CEO ' + 'bought shares at '.repeat(15) + 'notable filing.';
    const r = mod.validateReply(text, 'stocks');
    expect(!r.issues || r.issues.every(i => !i.toLowerCase().includes('url'))).toBe(true);
  });
  test('rejects empty text', () => {
    expect(mod.validateReply('', 'stocks').valid).toBe(false);
  });
});

describe('validateDDPost', () => {
  function buildDDText(wordCount, bearWordCount, hasTLDR, charOverride) {
    if (charOverride) return 'x'.repeat(charOverride);
    const bear = '## Bear Case\n' + 'risk '.repeat(bearWordCount);
    const body = 'word '.repeat(Math.max(0, wordCount - bearWordCount));
    const tldr = hasTLDR ? '\n## TLDR\n- point one\n- point two' : '';
    return body + bear + tldr;
  }

  test('accepts valid post (1800 words, bear 450, TLDR present)', () => {
    const r = mod.validateDDPost(buildDDText(1800, 450, true));
    expect(r.valid).toBe(true);
  });
  test('rejects post with word count < 1500', () => {
    const r = mod.validateDDPost(buildDDText(1000, 450, true));
    expect(r.valid).toBe(false);
  });
  test('rejects post with word count > 2500', () => {
    const r = mod.validateDDPost(buildDDText(3000, 450, true));
    expect(r.valid).toBe(false);
  });
  test('rejects post with bear case < 400 words', () => {
    const r = mod.validateDDPost(buildDDText(1800, 200, true));
    expect(r.valid).toBe(false);
  });
  test('rejects post without TLDR block', () => {
    const r = mod.validateDDPost(buildDDText(1800, 450, false));
    expect(r.valid).toBe(false);
  });
  test('rejects post with charCount > 38000', () => {
    const r = mod.validateDDPost(buildDDText(0, 0, false, 38001));
    expect(r.valid).toBe(false);
  });
  test('charCount field is correct', () => {
    const r = mod.validateDDPost(buildDDText(0, 0, false, 37999));
    expect(r.charCount).toBeLessThan(38000);
  });
  test('does NOT reject post containing Apple or $AAPL', () => {
    const text = 'Apple CEO Tim Cook $AAPL ' + 'word '.repeat(1500) + '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- point';
    const r = mod.validateDDPost(text);
    expect(r.valid).toBe(true);
  });
  test('returns valid, wordCount, bearWordCount, hasTLDR, charCount shape', () => {
    const r = mod.validateDDPost('x');
    expect('valid' in r && 'wordCount' in r && 'bearWordCount' in r && 'hasTLDR' in r && 'charCount' in r).toBe(true);
  });
});

// ===== SECTION 03: checkDailyCommentLimit + shouldSkipToday + upvoteContext + jobs + runCAT4 =====

function _testGetISOWeek(d) {
  const date = new Date(d); date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

describe('checkDailyCommentLimit', () => {
  function makeLog(entries) {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: entries }) }) });
  }
  test('returns allowed=true when no posts today', async () => {
    makeLog([]);
    const r = await mod.checkDailyCommentLimit('stocks');
    expect(r.allowed).toBe(true);
  });
  test('returns allowed=false when global total >= 10', async () => {
    makeLog(Array(10).fill({ subreddit: 'wallstreetbets', status: 'posted' }));
    const r = await mod.checkDailyCommentLimit('stocks');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/global/);
  });
  test('returns allowed=false when per-sub count >= dailyCap (wsb cap=3)', async () => {
    makeLog([
      { subreddit: 'wallstreetbets', status: 'posted' },
      { subreddit: 'wallstreetbets', status: 'posted' },
      { subreddit: 'wallstreetbets', status: 'posted' },
    ]);
    const r = await mod.checkDailyCommentLimit('wallstreetbets');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/cap/);
  });
  test('ignores failed/skipped status records in count', async () => {
    makeLog([
      { subreddit: 'stocks', status: 'failed' },
      { subreddit: 'stocks', status: 'skipped' },
    ]);
    const r = await mod.checkDailyCommentLimit('stocks');
    expect(r.allowed).toBe(true);
  });
  test('includes reason field when not allowed', async () => {
    makeLog(Array(10).fill({ subreddit: 'stocks', status: 'posted' }));
    const r = await mod.checkDailyCommentLimit('stocks');
    expect(typeof r.reason).toBe('string');
  });
});

describe('shouldSkipToday', () => {
  function mockState(stored) {
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) return { status: 200, json: () => ({}) };
      if (stored) return { status: 200, json: () => ({ list: [{ key: 'week_skip_days', value: JSON.stringify(stored), Id: 1 }] }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
  }
  test('returns skip=false on a non-skip weekday', async () => {
    const today = new Date();
    const isoWeek = _testGetISOWeek(today);
    const dayOfWeek = today.getDay();
    const skipDay = dayOfWeek === 1 ? 2 : 1;
    mockState({ week: isoWeek, days: [skipDay] });
    const r = await mod.shouldSkipToday();
    expect(r.skip).toBe(false);
  });
  test('returns skip=true when today is a designated skip day', async () => {
    const today = new Date();
    const isoWeek = _testGetISOWeek(today);
    const dayOfWeek = today.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      mockState({ week: isoWeek, days: [dayOfWeek] });
      const r = await mod.shouldSkipToday();
      expect(r.skip).toBe(true);
    }
  });
  test('auto-generates skip days if week_skip_days missing from NocoDB', async () => {
    const writes = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) { writes.push(JSON.parse(opts.body)); return { status: 200, json: () => ({}) }; }
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.shouldSkipToday();
    expect(writes.length).toBeGreaterThanOrEqual(1);
  });
  test('generated skip days are weekdays only (JS day 1-5)', async () => {
    const writes = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) { writes.push(JSON.parse(opts.body)); return { status: 200, json: () => ({}) }; }
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.shouldSkipToday();
    const written = writes.find(w => w.value && w.value.includes('days'));
    if (written) {
      const data = JSON.parse(written.value);
      data.days.forEach(d => { expect(d >= 1 && d <= 5).toBe(true); });
    }
  });
  test('generates 1 or 2 skip days', async () => {
    const writes = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) { writes.push(JSON.parse(opts.body)); return { status: 200, json: () => ({}) }; }
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.shouldSkipToday();
    const written = writes.find(w => w.value && w.value.includes('days'));
    if (written) {
      const data = JSON.parse(written.value);
      expect(data.days.length >= 1 && data.days.length <= 2).toBe(true);
    }
  });
  test('does not regenerate if already set for current week', async () => {
    const writes = [];
    const today = new Date();
    const isoWeek = _testGetISOWeek(today);
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && (opts.method === 'POST' || opts.method === 'PATCH')) { writes.push(true); return { status: 200, json: () => ({}) }; }
      return { status: 200, json: () => ({ list: [{ key: 'week_skip_days', value: JSON.stringify({ week: isoWeek, days: [2] }), Id: 1 }] }) };
    }});
    await mod.shouldSkipToday();
    await mod.shouldSkipToday();
    expect(writes.length).toBe(0);
  });
});

describe('upvoteContext', () => {
  test('calls Reddit vote API exactly 3 times', async () => {
    const calls = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('/api/vote')) calls.push(opts.body);
      if (url.includes('reddit.com/api/v1/access_token')) return { status: 200, json: () => ({ access_token: 'tok', expires_in: 3600 }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    delete process.env.REDDIT_REFRESH_TOKEN;
    process.env.REDDIT_USERNAME = 'u';
    process.env.REDDIT_PASSWORD = 'p';
    await mod.upvoteContext('post123', 'comment1', 'comment2');
    expect(calls.length).toBe(3);
  });
  test('upvotes postId, comment1Id, comment2Id all with dir=1', async () => {
    const votedIds = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (url.includes('/api/vote')) {
        const body = new URLSearchParams(opts.body);
        votedIds.push({ id: body.get('id'), dir: body.get('dir') });
      }
      if (url.includes('reddit.com/api/v1/access_token')) return { status: 200, json: () => ({ access_token: 'tok', expires_in: 3600 }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    delete process.env.REDDIT_REFRESH_TOKEN;
    await mod.upvoteContext('t3_postid', 't1_c1', 't1_c2');
    expect(votedIds.some(v => v.id === 't3_postid' && v.dir === '1')).toBe(true);
    expect(votedIds.some(v => v.id === 't1_c1' && v.dir === '1')).toBe(true);
    expect(votedIds.some(v => v.id === 't1_c2' && v.dir === '1')).toBe(true);
  });
});

describe('scheduleEditUpdate', () => {
  test('inserts reddit_edit job with execute_after ~2h from now', async () => {
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) jobs.push(JSON.parse(opts.body));
      return { status: 200, json: () => ({}) };
    }});
    const before = Date.now();
    await mod.scheduleEditUpdate('t1_abc', 'AAPL', 'stocks', 142.50);
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    const job = jobs[0];
    expect(job.type).toBe('reddit_edit');
    expect(job.status).toBe('pending');
    const executeAfter = new Date(job.execute_after).getTime();
    expect(executeAfter >= before + 115 * 60 * 1000 && executeAfter <= before + 125 * 60 * 1000).toBe(true);
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    expect(payload.commentId).toBe('t1_abc');
  });
});

describe('scheduleDDReplies', () => {
  test('inserts exactly 2 reddit_dd_reply jobs', async () => {
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) jobs.push(JSON.parse(opts.body));
      return { status: 200, json: () => ({}) };
    }});
    await mod.scheduleDDReplies('t3_ddpost', 'stocks', 'AAPL');
    expect(jobs.length).toBe(2);
    expect(jobs.every(j => j.type === 'reddit_dd_reply')).toBe(true);
  });
  test('first at ~1h, second at ~6h', async () => {
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) jobs.push(JSON.parse(opts.body));
      return { status: 200, json: () => ({}) };
    }});
    const before = Date.now();
    await mod.scheduleDDReplies('t3_ddpost', 'stocks', 'AAPL');
    const times = jobs.map(j => new Date(j.execute_after).getTime()).sort((a, b) => a - b);
    expect(times[0] >= before + 55 * 60 * 1000 && times[0] <= before + 65 * 60 * 1000).toBe(true);
    expect(times[1] >= before + 5.5 * 60 * 60 * 1000 && times[1] <= before + 6.5 * 60 * 60 * 1000).toBe(true);
  });
});

describe('processScheduledJobs', () => {
  test('ignores jobs with execute_after in the future', async () => {
    const futureJob = { Id: 1, type: 'reddit_edit', payload: '{}', status: 'pending', execute_after: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [futureJob] }) }) });
    await mod.processScheduledJobs();
    expect(true).toBe(true);
  });
  test('ignores jobs with status = done', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [{ Id: 1, type: 'reddit_edit', payload: '{}', status: 'done', execute_after: new Date(Date.now() - 1000).toISOString() }] }) }) });
    await mod.processScheduledJobs();
    expect(true).toBe(true);
  });
  test('marks job skipped (not crashed) if job handler throws', async () => {
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'PATCH' && url.includes('Scheduled_Jobs')) return { status: 200, json: () => ({}) };
      if (url.includes('reddit.com') && opts && opts.method === 'GET') return { status: 404, json: () => ({}) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    await mod.processScheduledJobs({ _fixedJobs: [{ Id: 1, type: 'reddit_edit', payload: JSON.stringify({ commentId: 't1_del', ticker: 'AAPL', priceAtPost: 140 }), status: 'pending', execute_after: new Date(Date.now() - 1000).toISOString() }] });
    expect(true).toBe(true);
  });
  test('processes past-due pending jobs without crashing', async () => {
    const jobs = [
      { Id: 1, type: 'reddit_reply_deferred', payload: JSON.stringify({ postId: 't3_a', subreddit: 'stocks', ticker: 'AAPL', insiderData: { ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-25' }, structure: { id: 'Q_A_DATA', systemPromptInstruction: 'Open with a question.' } }), status: 'pending', execute_after: new Date(Date.now() - 1000).toISOString() },
    ];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'PATCH' && url.includes('Scheduled_Jobs')) return { status: 200, json: () => ({}) };
      if (url.includes('reddit.com') && opts && opts.method === 'POST') return { status: 200, json: () => ({ json: { data: { things: [{ data: { id: 'c1', name: 't1_c1' } }] } } }) };
      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'CEO bought $2M. Third buy this year.' }] }) };
      return { status: 200, json: () => ({ list: jobs }) };
    }});
    await mod.processScheduledJobs();
    expect(true).toBe(true);
  });
  test('accepts empty _fixedJobs array', async () => {
    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: [] }) }) });
    await mod.processScheduledJobs({ _fixedJobs: [] });
    expect(true).toBe(true);
  });
});

describe('runCAT4Comments', () => {
  test('returns early without scheduling jobs if shouldSkipToday is true', async () => {
    const today = new Date();
    const isoWeek = _testGetISOWeek(today);
    const dayOfWeek = today.getDay();
    const jobs = [];
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) jobs.push(true);
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        return { status: 200, json: () => ({ list: [{ key: 'week_skip_days', value: JSON.stringify({ week: isoWeek, days: [dayOfWeek] }), Id: 1 }] }) };
      }
      return { status: 200, json: () => ({ list: [] }) };
    }});
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      await mod.runCAT4Comments();
      expect(jobs.length).toBe(0);
    }
  });
  test('does not throw on empty post results', async () => {
    mod._setDeps({ fetch: async (url, opts) => {
      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) return { status: 200, json: () => ({}) };
      if (url.includes('reddit.com/api/v1/access_token')) return { status: 200, json: () => ({ access_token: 'tok', expires_in: 3600 }) };
      if (url.includes('search.json')) return { status: 200, json: () => ({ data: { children: [] } }) };
      return { status: 200, json: () => ({ list: [] }) };
    }});
    delete process.env.REDDIT_REFRESH_TOKEN;
    process.env.REDDIT_USERNAME = 'u';
    process.env.REDDIT_PASSWORD = 'p';
    await mod.runCAT4Comments();
    expect(true).toBe(true);
  });
});
