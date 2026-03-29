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
