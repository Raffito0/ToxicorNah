'use strict';

// Mock ai-client BEFORE requiring weekly-newsletter (section-02 generateNewsletter uses it)
jest.mock('../../n8n/code/insiderbuying/ai-client', () => ({
  createOpusClient: jest.fn(),
}));
const { createOpusClient } = require('../../n8n/code/insiderbuying/ai-client');

const {
  gatherWeeklyContent,
  computeAlertPerformance,
  getUpcomingEarnings,
  generateNewsletter,
} = require('../../n8n/code/insiderbuying/weekly-newsletter');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noSleep = () => Promise.resolve();

// Stable test "now": 2026-03-15 12:00:00 UTC
const TEST_NOW = Date.UTC(2026, 2, 15, 12, 0, 0);
const TODAY_ISO = '2026-03-15';
const SEVEN_DAYS_ISO = '2026-03-08';
const FOURTEEN_DAYS_ISO = '2026-03-01';

/**
 * Build a mock NocoDB client with sequenced list responses.
 * `listResponses` is an array of values returned in call order.
 * Extra calls beyond the array return { list: [], pageInfo: {} }.
 */
function makeNocoDB(listResponses = []) {
  let idx = 0;
  return {
    list: jest.fn().mockImplementation(() => {
      const resp = listResponses[idx] !== undefined ? listResponses[idx] : { list: [], pageInfo: {} };
      idx++;
      return Promise.resolve(resp);
    }),
    create: jest.fn().mockResolvedValue({ Id: 42 }),
    update: jest.fn().mockResolvedValue({}),
  };
}

/** Build a mock Finnhub client. `resolveMap` maps ticker -> quote data (or rejects if undefined). */
function makeFinnhub(resolveMap = {}) {
  return {
    getQuote: jest.fn().mockImplementation((ticker) => {
      if (ticker in resolveMap) return Promise.resolve(resolveMap[ticker]);
      return Promise.reject(new Error('Finnhub unavailable for ' + ticker));
    }),
  };
}

/** Build a mock Alpha Vantage fetch returning CSV text. */
function makeAlphaFetch(csvBody) {
  return jest.fn().mockImplementation((url) => {
    if (url.includes('alphavantage.co')) {
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(csvBody),
      });
    }
    return Promise.reject(new Error('unexpected URL: ' + url));
  });
}

// CSV with 2 events: one within 14 days, one outside
const SAMPLE_CSV = [
  'symbol,name,reportDate,fiscalDateEnding,estimate,currency',
  'AAPL,Apple Inc,2026-03-20,2026-03-31,1.50,USD',   // within 14 days of 2026-03-15
  'MSFT,Microsoft,2026-04-30,2026-03-31,2.80,USD',   // outside 14 days
].join('\n');

// ---------------------------------------------------------------------------
// gatherWeeklyContent — NocoDB table targets and filters
// ---------------------------------------------------------------------------

describe('gatherWeeklyContent — NocoDB table targets and filters', () => {
  test('queries Insider_Alerts with score >= 7 and 7-day date range', async () => {
    const db = makeNocoDB([
      { list: [{ ticker: 'AAPL', score: 8, filing_date: '2026-03-12', price_at_filing: 100 }] },
      { list: [] },
      { list: [] },
      { list: [] }, // Financial_Cache miss
    ]);
    await gatherWeeklyContent(db, { _nowMs: TEST_NOW, _fetchFn: makeAlphaFetch(SAMPLE_CSV) });

    const alertsCalls = db.list.mock.calls.filter(c => c[0] === 'Insider_Alerts');
    expect(alertsCalls.length).toBeGreaterThanOrEqual(1);
    const [, opts] = alertsCalls[0];
    expect(opts.where).toMatch(/score/);
    expect(opts.where).toMatch(/gte,7/);
    expect(opts.where).toContain(SEVEN_DAYS_ISO);
    expect(opts.sort).toBe('-score');
    expect(opts.limit).toBe(10);
  });

  test('queries Articles table with 7-day filter', async () => {
    const db = makeNocoDB([
      { list: [] },
      { list: [{ title: 'Weekly Recap', published_at: '2026-03-14' }] },
      { list: [] },
      { list: [] },
    ]);
    await gatherWeeklyContent(db, { _nowMs: TEST_NOW, _fetchFn: makeAlphaFetch(SAMPLE_CSV) });

    const articlesCalls = db.list.mock.calls.filter(c => c[0] === 'Articles');
    expect(articlesCalls.length).toBeGreaterThanOrEqual(1);
    const [, opts] = articlesCalls[0];
    expect(opts.where).toContain(SEVEN_DAYS_ISO);
    expect(opts.sort).toBe('-published_at');
    expect(opts.limit).toBe(5);
  });

  test('queries Insider_Alerts for 7-14 days ago for performance data', async () => {
    const db = makeNocoDB([
      { list: [] },
      { list: [] },
      { list: [{ ticker: 'TSLA', score: 9, filing_date: '2026-03-05', price_at_filing: 250 }] },
      { list: [] },
    ]);
    const safeFinnhub = { getQuote: () => Promise.resolve(null) };
    await gatherWeeklyContent(db, { _nowMs: TEST_NOW, _fetchFn: makeAlphaFetch(SAMPLE_CSV), _finnhubClient: safeFinnhub });

    const alertsCalls = db.list.mock.calls.filter(c => c[0] === 'Insider_Alerts');
    expect(alertsCalls.length).toBeGreaterThanOrEqual(2);
    const perfCall = alertsCalls[1];
    const [, opts] = perfCall;
    expect(opts.where).toContain(FOURTEEN_DAYS_ISO);
    expect(opts.where).toContain(SEVEN_DAYS_ISO);
  });

  test('returns all four fields with correct types', async () => {
    const db = makeNocoDB([
      { list: [{ ticker: 'AAPL', score: 8, filing_date: '2026-03-12', price_at_filing: 150 }] },
      { list: [{ title: 'Article 1', published_at: '2026-03-13' }] },
      { list: [{ ticker: 'TSLA', score: 9, filing_date: '2026-03-06', price_at_filing: 250 }] },
      { list: [] }, // cache miss
    ]);
    const mockFinnhub = makeFinnhub({ AAPL: { c: 160, pc: 155 }, TSLA: { c: 260, pc: 255 } });
    const result = await gatherWeeklyContent(db, {
      _nowMs: TEST_NOW,
      _finnhubClient: mockFinnhub,
      _fetchFn: makeAlphaFetch(SAMPLE_CSV),
    });

    expect(Array.isArray(result.topAlerts)).toBe(true);
    expect(Array.isArray(result.articles)).toBe(true);
    expect(Array.isArray(result.performance)).toBe(true);
    expect(Array.isArray(result.upcomingEarnings)).toBe(true);
  });

  test('sets emptyAlertsPrefix when topAlerts is empty', async () => {
    const db = makeNocoDB([
      { list: [] }, // empty alerts
      { list: [] },
      { list: [] },
      { list: [] },
    ]);
    const result = await gatherWeeklyContent(db, { _nowMs: TEST_NOW, _fetchFn: makeAlphaFetch(SAMPLE_CSV) });
    expect(typeof result.emptyAlertsPrefix).toBe('string');
    expect(result.emptyAlertsPrefix.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// computeAlertPerformance
// ---------------------------------------------------------------------------

describe('computeAlertPerformance', () => {
  test('T-1: sleepFn called n-1 times (sequential enforcement)', async () => {
    const alerts = [
      { ticker: 'AAPL', price_at_filing: 100 },
      { ticker: 'TSLA', price_at_filing: 200 },
      { ticker: 'MSFT', price_at_filing: 300 },
    ];
    const finnhub = makeFinnhub({ AAPL: { c: 110 }, TSLA: { c: 210 }, MSFT: { c: 310 } });
    const sleepSpy = jest.fn().mockResolvedValue(undefined);

    await computeAlertPerformance(alerts, finnhub, { _sleep: sleepSpy });

    // 3 alerts → sleepFn called 2 times (before alert 1 and alert 2, not before alert 0)
    expect(sleepSpy).toHaveBeenCalledTimes(alerts.length - 1);
    expect(sleepSpy).toHaveBeenCalledWith(250);
  });

  test('maps alerts to { ticker, return, winner } using mocked Finnhub', async () => {
    const alerts = [
      { ticker: 'AAPL', price_at_filing: 100 },
      { ticker: 'TSLA', price_at_filing: 200 },
    ];
    const finnhub = makeFinnhub({ AAPL: { c: 120, pc: 110 }, TSLA: { c: 180, pc: 195 } });

    const result = await computeAlertPerformance(alerts, finnhub, { _sleep: noSleep });

    expect(result).toHaveLength(2);

    const aapl = result.find(r => r.ticker === 'AAPL');
    expect(aapl).toBeDefined();
    expect(aapl.winner).toBe(true);
    expect(aapl.return).toMatch(/^\+\d/); // starts with +

    const tsla = result.find(r => r.ticker === 'TSLA');
    expect(tsla).toBeDefined();
    expect(tsla.winner).toBe(false);
    expect(tsla.return).toMatch(/^-\d/); // starts with -
  });

  test('handles Finnhub failure for one alert gracefully (Promise.allSettled)', async () => {
    const alerts = [
      { ticker: 'AAPL', price_at_filing: 100 },
      { ticker: 'FAIL', price_at_filing: 50 }, // will reject
    ];
    // FAIL is not in resolveMap so makeFinnhub rejects it
    const finnhub = makeFinnhub({ AAPL: { c: 110, pc: 105 } });

    const result = await computeAlertPerformance(alerts, finnhub, { _sleep: noSleep });

    expect(result).toHaveLength(2);
    const fail = result.find(r => r.ticker === 'FAIL');
    expect(fail).toBeDefined();
    expect(fail.return).toBe('N/A');
    expect(fail.winner).toBe(false);

    // AAPL should still succeed
    const aapl = result.find(r => r.ticker === 'AAPL');
    expect(aapl.winner).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getUpcomingEarnings — cache behaviour
// ---------------------------------------------------------------------------

describe('getUpcomingEarnings — cache behaviour', () => {
  const CACHE_KEY = `earnings_next14_${TODAY_ISO}`;

  test('returns cached Financial_Cache data when entry is under 24h old', async () => {
    const cachedData = [{ symbol: 'AAPL', reportDate: '2026-03-20' }];
    // Cache record with updated_at = 1 hour ago
    const freshRecord = {
      Id: 10,
      key: CACHE_KEY,
      data: JSON.stringify(cachedData),
      updated_at: new Date(TEST_NOW - 60 * 60 * 1000).toISOString(),
    };
    const db = makeNocoDB([{ list: [freshRecord] }]);
    const fetchSpy = jest.fn();

    const result = await getUpcomingEarnings(db, { _nowMs: TEST_NOW, _fetchFn: fetchSpy });

    expect(result).toEqual(cachedData);
    // Alpha Vantage should NOT be called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('T-2: Alpha Vantage non-200 → returns [] and does NOT write cache', async () => {
    const db = makeNocoDB([{ list: [] }]); // cache miss
    const fetchFn = jest.fn().mockResolvedValue({
      status: 429,
      text: () => Promise.resolve('Rate limit exceeded'),
    });

    const result = await getUpcomingEarnings(db, { _nowMs: TEST_NOW, _fetchFn: fetchFn });

    expect(result).toEqual([]);
    // create and update must NOT be called — cache should not be written on error
    expect(db.create).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  test('calls Alpha Vantage when cache is missing or stale', async () => {
    // Return empty cache list
    const db = makeNocoDB([{ list: [] }]);
    const fetchFn = makeAlphaFetch(SAMPLE_CSV);

    await getUpcomingEarnings(db, { _nowMs: TEST_NOW, _fetchFn: fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchFn.mock.calls[0];
    expect(calledUrl).toContain('alphavantage.co');
    expect(calledUrl).toContain('EARNINGS_CALENDAR');
  });

  test('writes result to Financial_Cache after fetching from Alpha Vantage', async () => {
    const db = makeNocoDB([{ list: [] }]); // cache miss
    const fetchFn = makeAlphaFetch(SAMPLE_CSV);

    const result = await getUpcomingEarnings(db, { _nowMs: TEST_NOW, _fetchFn: fetchFn });

    // create or update should be called to persist to cache
    const persisted = db.create.mock.calls.length > 0 || db.update.mock.calls.length > 0;
    expect(persisted).toBe(true);

    // result should only include events within 14 days
    expect(Array.isArray(result)).toBe(true);
    const symbols = result.map(e => e.symbol);
    expect(symbols).toContain('AAPL');
    expect(symbols).not.toContain('MSFT'); // outside 14-day window
  });
});

// ---------------------------------------------------------------------------
// generateNewsletter
// ---------------------------------------------------------------------------

const VALID_NEWSLETTER_RESULT = {
  sections: {
    s1: 'Opening hook text.',
    s2: 'Move of the week text.',
    s3: 'Scorecard text.',
    s4: 'Pattern recognition text.',
    s5: 'What I am watching text.',
    s6_free: 'Upgrade to pro today.',
    s6_pro: 'Refer a friend at {{rp_refer_url}}.',
  },
  subjectA: 'This insider just went all in',
  subjectB: '3 insiders bought $4M in stock this week',
};

function makeOpusClient(responses) {
  let idx = 0;
  const complete = jest.fn().mockImplementation(() => {
    const item = responses[idx] !== undefined ? responses[idx] : responses[responses.length - 1];
    idx++;
    if (item instanceof Error) return Promise.reject(item);
    return Promise.resolve({ content: typeof item === 'string' ? item : JSON.stringify(item) });
  });
  return { complete };
}

function makeSampleData(overrides = {}) {
  return {
    topAlerts: [{ ticker: 'AAPL', score: 9, price_at_filing: 150 }],
    articles: [{ title: 'Test Article', published_at: '2026-03-14' }],
    performance: [{ ticker: 'AAPL', return: '+5.0%', winner: true }],
    upcomingEarnings: [{ symbol: 'AAPL', reportDate: '2026-03-20' }],
    ...overrides,
  };
}

describe('generateNewsletter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls AI client exactly once with all 4 data inputs injected into prompt', async () => {
    const client = makeOpusClient([VALID_NEWSLETTER_RESULT]);
    const data = makeSampleData();

    await generateNewsletter(data, { _aiClient: client });

    expect(client.complete).toHaveBeenCalledTimes(1);
    const [, userPrompt] = client.complete.mock.calls[0];
    expect(userPrompt).toContain('AAPL'); // alert ticker in data
    expect(userPrompt).toContain('Test Article'); // article title in data
  });

  test('strips markdown code fences before JSON.parse', async () => {
    const fenced = '```json\n' + JSON.stringify(VALID_NEWSLETTER_RESULT) + '\n```';
    const client = makeOpusClient([fenced]);

    const result = await generateNewsletter(makeSampleData(), { _aiClient: client });

    expect(result.subjectA).toBe(VALID_NEWSLETTER_RESULT.subjectA);
  });

  test('returns all required section keys and both subject lines', async () => {
    const client = makeOpusClient([VALID_NEWSLETTER_RESULT]);

    const result = await generateNewsletter(makeSampleData(), { _aiClient: client });

    const REQUIRED_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6_free', 's6_pro'];
    REQUIRED_KEYS.forEach((k) => {
      expect(result.sections[k]).toBeTruthy();
    });
    expect(typeof result.subjectA).toBe('string');
    expect(result.subjectA.length).toBeGreaterThan(0);
    expect(typeof result.subjectB).toBe('string');
    expect(result.subjectB.length).toBeGreaterThan(0);
  });

  test('retries on malformed AI JSON and resolves on second attempt', async () => {
    const client = makeOpusClient(['not-valid-json{{{', VALID_NEWSLETTER_RESULT]);

    const result = await generateNewsletter(makeSampleData(), { _aiClient: client });

    expect(client.complete).toHaveBeenCalledTimes(2);
    expect(result.subjectA).toBe(VALID_NEWSLETTER_RESULT.subjectA);
  });

  test('retries when response is missing required section keys', async () => {
    const partial = { sections: { s1: 'ok' }, subjectA: 'A', subjectB: 'B' };
    const client = makeOpusClient([partial, VALID_NEWSLETTER_RESULT]);

    const result = await generateNewsletter(makeSampleData(), { _aiClient: client });

    expect(client.complete).toHaveBeenCalledTimes(2);
    expect(result.sections.s2).toBeTruthy();

    // Retry prompt must contain lastError from the first attempt
    const [, retryPrompt] = client.complete.mock.calls[1];
    expect(retryPrompt).toContain('Missing or empty section keys');
  });

  test('sends Telegram alert and throws after 3 consecutive AI failures', async () => {
    const client = makeOpusClient([
      new Error('API timeout'),
      new Error('API timeout'),
      new Error('API timeout'),
    ]);
    const telegramFn = jest.fn().mockResolvedValue(undefined);

    await expect(
      generateNewsletter(makeSampleData(), { _aiClient: client, _telegramFn: telegramFn })
    ).rejects.toThrow(/generateNewsletter failed after 3 attempts/);

    expect(telegramFn).toHaveBeenCalledTimes(1);
    const [msg] = telegramFn.mock.calls[0];
    expect(msg).toContain('[EarlyInsider]');
    expect(msg).toContain('API timeout');
  });

  test('injects empty-state prefix instruction when topAlerts is empty', async () => {
    const client = makeOpusClient([VALID_NEWSLETTER_RESULT]);
    const data = makeSampleData({ topAlerts: [] });

    await generateNewsletter(data, { _aiClient: client });

    const [, userPrompt] = client.complete.mock.calls[0];
    expect(userPrompt).toContain('No major insider moves this week');
    expect(userPrompt).toContain('macro market trends');
  });

  test('prunes alerts to max 5 and earnings to max 10 before sending to AI', async () => {
    const client = makeOpusClient([VALID_NEWSLETTER_RESULT]);
    const manyAlerts = Array.from({ length: 8 }, (_, i) => ({ ticker: 'T' + i, score: 8 }));
    const manyEarnings = Array.from({ length: 15 }, (_, i) => ({ symbol: 'E' + i }));
    const data = makeSampleData({ topAlerts: manyAlerts, upcomingEarnings: manyEarnings });

    await generateNewsletter(data, { _aiClient: client });

    const [, userPrompt] = client.complete.mock.calls[0];
    const injected = JSON.parse(userPrompt.match(/DATA:\n(\{[\s\S]*?\})\n\nSECTIONS/)[1]);
    expect(injected.alerts).toHaveLength(5);
    expect(injected.earnings).toHaveLength(10);
  });
});
