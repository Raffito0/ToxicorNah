const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// Import the module under test
const dexterModule = require('../code/insiderbuying/dexter-research.js');
const {
  aggregateDexterData,
  computePriceSummary,
  computeDataCompleteness,
  buildCacheKey,
  isCacheValid,
  formatMarketCap,
  parsePreAnalysis,
  dexterResearch,
  validateTicker,
  DATA_TYPES,
  // Section 4 new exports
  TokenBucket,
  readCache,
  writeCache,
  makeNocoClient,
  DATA_WEIGHTS,
  fetchFinancialData,
  getQuote,
  getProfile,
  getBasicFinancials,
  getInsiderTransactions,
} = dexterModule;

// ---------------------------------------------------------------------------
// Test: Price data aggregation
// Given 252-day OHLCV array, output contains only the 9 summary fields
// ---------------------------------------------------------------------------
describe('computePriceSummary', () => {
  it('returns exactly 9 summary fields from 252-day OHLCV array', () => {
    const prices = generateMockPrices(252);
    const summary = computePriceSummary(prices);

    const expectedKeys = [
      'high_52w', 'low_52w', 'current_price',
      'ma_50', 'ma_200',
      'return_1m', 'return_6m', 'return_1y',
      'avg_volume_30d',
    ];
    assert.deepStrictEqual(Object.keys(summary).sort(), expectedKeys.sort());
  });

  it('does not include raw daily data in output', () => {
    const prices = generateMockPrices(252);
    const summary = computePriceSummary(prices);
    assert.equal(summary.daily, undefined);
    assert.equal(summary.prices, undefined);
    assert.equal(summary.ohlcv, undefined);
  });

  it('computes 52-week high/low correctly', () => {
    const prices = generateMockPrices(252, { highDay: 100, lowDay: 200 });
    const summary = computePriceSummary(prices);
    // highDay=100 means day 100 has the highest close (200)
    // lowDay=200 means day 200 has the lowest close (50)
    assert.equal(summary.high_52w, 200);
    assert.equal(summary.low_52w, 50);
  });

  it('computes moving averages correctly', () => {
    // Constant price = MA equals that price
    const prices = generateConstantPrices(252, 100);
    const summary = computePriceSummary(prices);
    assert.equal(summary.ma_50, 100);
    assert.equal(summary.ma_200, 100);
  });

  it('computes returns correctly', () => {
    // Linear price from 100 to 200 over 252 days
    const prices = generateLinearPrices(252, 100, 200);
    const summary = computePriceSummary(prices);
    // 1Y return: (200 - 100) / 100 = 100%
    assert.ok(Math.abs(summary.return_1y - 100) < 1);
    // Current price = last day
    assert.ok(Math.abs(summary.current_price - 200) < 1);
  });

  it('handles fewer than 252 days gracefully', () => {
    const prices = generateMockPrices(30);
    const summary = computePriceSummary(prices);
    assert.ok(summary.current_price > 0);
    // 1y return should be null or based on available data
    assert.equal(summary.ma_200, null); // not enough data for 200-day MA
  });
});

// ---------------------------------------------------------------------------
// Test: Data completeness score
// ---------------------------------------------------------------------------
describe('computeDataCompleteness', () => {
  it('returns 1.0 when all 7 data types present', () => {
    const data = {
      income_statements: [{ ticker: 'AAPL' }],
      balance_sheets: [{ ticker: 'AAPL' }],
      cash_flow: [{ ticker: 'AAPL' }],
      ratios: [{ ticker: 'AAPL' }],
      insider_trades: [{ ticker: 'AAPL' }],
      stock_prices: [{ close: 150 }],
      competitors: [{ ticker: 'MSFT' }],
    };
    assert.equal(computeDataCompleteness(data), 1.0);
  });

  it('returns <= 0.5 when income_stmt + prices missing (abort threshold)', () => {
    const data = {
      income_statements: null,
      balance_sheets: [{ ticker: 'AAPL' }],
      cash_flow: [{ ticker: 'AAPL' }],
      ratios: [{ ticker: 'AAPL' }],
      insider_trades: [{ ticker: 'AAPL' }],
      stock_prices: null,
      competitors: [{ ticker: 'MSFT' }],
    };
    const score = computeDataCompleteness(data);
    assert.ok(score <= 0.5, `Expected <= 0.5, got ${score}`);
  });

  it('returns 0 when all data types are null', () => {
    const data = {
      income_statements: null,
      balance_sheets: null,
      cash_flow: null,
      ratios: null,
      insider_trades: null,
      stock_prices: null,
      competitors: null,
    };
    assert.equal(computeDataCompleteness(data), 0);
  });

  it('returns fractional score for partial data', () => {
    const data = {
      income_statements: [{ ticker: 'AAPL' }],
      balance_sheets: null,
      cash_flow: [{ ticker: 'AAPL' }],
      ratios: null,
      insider_trades: null,
      stock_prices: [{ close: 150 }],
      competitors: null,
    };
    const score = computeDataCompleteness(data);
    assert.ok(score > 0 && score < 1, `Expected fractional, got ${score}`);
  });
});

// ---------------------------------------------------------------------------
// Test: Cache key building and validation
// ---------------------------------------------------------------------------
describe('buildCacheKey / isCacheValid', () => {
  it('builds correct cache key', () => {
    const key = buildCacheKey('AAPL', 'income_stmt');
    assert.equal(key.ticker, 'AAPL');
    assert.equal(key.data_type, 'income_stmt');
  });

  it('cache with future expires_at is valid', () => {
    const entry = {
      ticker: 'AAPL',
      data_type: 'income_stmt',
      data_json: '{}',
      expires_at: new Date(Date.now() + 3600000).toISOString(), // 1h from now
    };
    assert.equal(isCacheValid(entry), true);
  });

  it('cache with past expires_at is invalid', () => {
    const entry = {
      ticker: 'AAPL',
      data_type: 'income_stmt',
      data_json: '{}',
      expires_at: new Date(Date.now() - 3600000).toISOString(), // 1h ago
    };
    assert.equal(isCacheValid(entry), false);
  });

  it('null cache entry is invalid', () => {
    assert.equal(isCacheValid(null), false);
    assert.equal(isCacheValid(undefined), false);
  });
});

// ---------------------------------------------------------------------------
// Test: Aggregation produces correct output structure
// ---------------------------------------------------------------------------
describe('aggregateDexterData', () => {
  it('returns complete JSON matching template variable structure', () => {
    const result = aggregateDexterData({
      financialData: {
        income_statements: [{ revenue: 1000000 }],
        balance_sheets: [{ total_assets: 5000000 }],
        cash_flow: [{ operating_cash_flow: 300000 }],
        ratios: [{ pe_ratio: 25 }],
      },
      insiderTrades: [{ insider_name: 'John CEO', transaction_type: 'P-Purchase' }],
      stockPrices: generateMockPrices(252),
      competitorData: [{ ticker: 'MSFT', market_cap: 3000000000 }],
      managementQuotes: [{ speaker: 'CEO', quote: 'Great quarter' }],
      newsResults: [{ title: 'AAPL beats earnings', url: 'https://example.com' }],
      ticker: 'AAPL',
      companyName: 'Apple Inc.',
      sector: 'Technology',
      marketCap: '$3.2T',
    });

    // Check required top-level fields
    assert.ok(result.company_name);
    assert.ok(result.ticker);
    assert.ok(result.sector);
    assert.ok(result.market_cap);
    assert.ok(result.financial_data);
    assert.ok(result.insider_trades);
    assert.ok(result.stock_prices);
    assert.ok(result.competitor_data);
    assert.ok(result.management_quotes);
  });

  it('price data in output uses summary (not raw array)', () => {
    const result = aggregateDexterData({
      financialData: {
        income_statements: [{ revenue: 1000000 }],
        balance_sheets: [],
        cash_flow: [],
        ratios: [],
      },
      insiderTrades: [],
      stockPrices: generateMockPrices(252),
      competitorData: [],
      managementQuotes: [],
      newsResults: [],
      ticker: 'AAPL',
      companyName: 'Apple Inc.',
      sector: 'Technology',
      marketCap: '$3.2T',
    });

    // stock_prices should be the summary, not the raw array
    assert.ok(result.stock_prices.current_price);
    assert.ok(result.stock_prices.high_52w);
    assert.equal(result.stock_prices.length, undefined); // not an array
  });
});

// ---------------------------------------------------------------------------
// Test: Insider trades filtering (last 90 days)
// ---------------------------------------------------------------------------
describe('aggregateDexterData insider trade filtering', () => {
  it('filters insider trades to last 90 days', () => {
    const now = new Date();
    const recent = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const old = new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = aggregateDexterData({
      financialData: { income_statements: [], balance_sheets: [], cash_flow: [], ratios: [] },
      insiderTrades: [
        { insider_name: 'Recent', transaction_date: recent, transaction_type: 'P-Purchase' },
        { insider_name: 'Old', transaction_date: old, transaction_type: 'P-Purchase' },
      ],
      stockPrices: generateMockPrices(30),
      competitorData: [],
      managementQuotes: [],
      newsResults: [],
      ticker: 'TEST',
      companyName: 'Test Inc.',
      sector: 'Tech',
      marketCap: '$1B',
    });

    assert.equal(result.insider_trades.length, 1);
    assert.equal(result.insider_trades[0].insider_name, 'Recent');
  });
});

// ---------------------------------------------------------------------------
// Test: Rate limit retry with exponential backoff
// ---------------------------------------------------------------------------
describe('rate limit handling', () => {
  // This tests the retry utility function
  const { fetchWithRetry } = require('../code/insiderbuying/dexter-research.js');

  it('retries on 429 with exponential backoff', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      if (callCount < 3) {
        return { ok: false, status: 429, statusText: 'Too Many Requests' };
      }
      return { ok: true, status: 200, json: async () => ({ data: 'success' }) };
    };

    const result = await fetchWithRetry('https://api.example.com/test', {}, {
      fetchFn: mockFetch,
      maxRetries: 3,
      baseDelay: 10, // 10ms for fast tests
    });

    assert.equal(callCount, 3);
    const json = await result.json();
    assert.equal(json.data, 'success');
  });

  it('gives up after max retries', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return { ok: false, status: 429, statusText: 'Too Many Requests' };
    };

    const result = await fetchWithRetry('https://api.example.com/test', {}, {
      fetchFn: mockFetch,
      maxRetries: 3,
      baseDelay: 10,
    });

    assert.equal(callCount, 4); // initial + 3 retries
    assert.equal(result.ok, false);
    assert.equal(result.status, 429);
  });
});

// ---------------------------------------------------------------------------
// Test: DATA_TYPES constant
// ---------------------------------------------------------------------------
describe('DATA_TYPES', () => {
  it('contains all 7 data types', () => {
    assert.equal(DATA_TYPES.length, 7);
    assert.ok(DATA_TYPES.includes('income_statements'));
    assert.ok(DATA_TYPES.includes('balance_sheets'));
    assert.ok(DATA_TYPES.includes('cash_flow'));
    assert.ok(DATA_TYPES.includes('ratios'));
    assert.ok(DATA_TYPES.includes('insider_trades'));
    assert.ok(DATA_TYPES.includes('stock_prices'));
    assert.ok(DATA_TYPES.includes('competitors'));
  });
});

// ---------------------------------------------------------------------------
// Test: formatMarketCap
// ---------------------------------------------------------------------------
describe('formatMarketCap', () => {
  it('formats trillions', () => {
    assert.equal(formatMarketCap(3200000000000), '$3.2T');
  });

  it('formats billions', () => {
    assert.equal(formatMarketCap(1500000000), '$1.5B');
  });

  it('formats millions', () => {
    assert.equal(formatMarketCap(450000000), '$450M');
  });

  it('returns Unknown for null/non-number', () => {
    assert.equal(formatMarketCap(null), 'Unknown');
    assert.equal(formatMarketCap('big'), 'Unknown');
    assert.equal(formatMarketCap(undefined), 'Unknown');
  });
});

// ---------------------------------------------------------------------------
// Test: parsePreAnalysis
// ---------------------------------------------------------------------------
describe('parsePreAnalysis', () => {
  it('parses valid JSON', () => {
    const input = JSON.stringify({
      key_findings: ['Revenue up 34%', 'Margin expanded'],
      risks: ['Concentration risk'],
      catalysts: ['New product launch'],
    });
    const result = parsePreAnalysis(input);
    assert.equal(result.key_findings.length, 2);
    assert.equal(result.risks.length, 1);
    assert.equal(result.catalysts.length, 1);
  });

  it('parses markdown-wrapped JSON', () => {
    const input = '```json\n{"key_findings":["A"],"risks":["B"],"catalysts":["C"]}\n```';
    const result = parsePreAnalysis(input);
    assert.ok(result);
    assert.equal(result.key_findings[0], 'A');
  });

  it('returns null for malformed input', () => {
    assert.equal(parsePreAnalysis('not json at all'), null);
    assert.equal(parsePreAnalysis(''), null);
  });

  it('returns null for wrong structure', () => {
    const input = JSON.stringify({ foo: 'bar' });
    assert.equal(parsePreAnalysis(input), null);
  });

  it('caps arrays to max lengths', () => {
    const input = JSON.stringify({
      key_findings: ['1', '2', '3', '4', '5', '6', '7'],
      risks: ['a', 'b', 'c', 'd', 'e'],
      catalysts: ['x', 'y', 'z', 'w'],
    });
    const result = parsePreAnalysis(input);
    assert.equal(result.key_findings.length, 5); // max 5
    assert.equal(result.risks.length, 3); // max 3
    assert.equal(result.catalysts.length, 3); // max 3
  });
});

// ---------------------------------------------------------------------------
// Test: validateTicker
// ---------------------------------------------------------------------------
describe('validateTicker', () => {
  it('accepts valid tickers', () => {
    assert.equal(validateTicker('AAPL'), true);
    assert.equal(validateTicker('MSFT'), true);
    assert.equal(validateTicker('A'), true);
  });

  it('rejects invalid tickers', () => {
    assert.equal(validateTicker(''), false);
    assert.equal(validateTicker(null), false);
    assert.equal(validateTicker('TOOLONG'), false);
    assert.equal(validateTicker('123'), false);
    assert.equal(validateTicker('AAPL&limit=99'), false);
  });
});

// ---------------------------------------------------------------------------
// Test: dexterResearch entry point
// ---------------------------------------------------------------------------
describe('dexterResearch', () => {
  it('returns error when ticker missing', async () => {
    const result = await dexterResearch({}, {});
    assert.ok(result.error);
    assert.equal(result.data_completeness, 0);
  });

  it('returns error when API key missing', async () => {
    const result = await dexterResearch({ ticker: 'AAPL' }, { env: {} });
    assert.ok(result.error.includes('FINNHUB_API_KEY'));
  });

  it('returns aggregated data on success', async () => {
    const candleData = { c: [100, 102, 104], h: [105, 107, 109], l: [98, 100, 102], o: [99, 101, 103], t: [1000000, 1001000, 1002000], v: [1e6, 1e6, 1e6], s: 'ok' };
    const mockFetch = async (url) => {
      if (url.includes('/quote')) return { statusCode: 200, body: { c: 150, h: 155, l: 148, o: 149, pc: 147, d: 3, dp: 2.04 } };
      if (url.includes('/profile2')) return { statusCode: 200, body: { name: 'Apple Inc', marketCapitalization: 3000000, exchange: 'NASDAQ', finnhubIndustry: 'Tech', country: 'US', currency: 'USD' } };
      if (url.includes('/metric')) return { statusCode: 200, body: { metric: { peBasicExclExtraTTM: 25, epsBasicExclExtraAnnual: 6.0, revenueGrowth3Y: 0.12, grossMarginTTM: 0.44 } } };
      if (url.includes('/insider-transactions')) return { statusCode: 200, body: { data: [{ name: 'CEO', share: 1000, change: 100, transactionDate: '2025-01-01', transactionPrice: 145 }] } };
      if (url.includes('/candle')) return { statusCode: 200, body: candleData };
      return { statusCode: 200, body: {} };
    };
    const mockNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => ({ Id: 1 }) };

    const result = await dexterResearch(
      { ticker: 'AAPL', keyword: 'test', article_type: 'A', blog: 'insiderbuying' },
      { env: { FINNHUB_API_KEY: 'test-key', NOCODB_BASE_URL: 'http://localhost:8080', NOCODB_API_TOKEN: 'tok', NOCODB_PROJECT_ID: 'p1', NOCODB_FINANCIAL_CACHE_TABLE_ID: 'Financial_Cache' }, fetchFn: mockFetch, _nocoClientOverride: mockNoco }
    );

    assert.ok(!result.error);
    assert.equal(result.ticker, 'AAPL');
  });

  it('aborts when data_completeness < 0.5', async () => {
    const mockFetch = async () => ({ statusCode: 500, body: {} });
    const mockNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => ({ Id: 1 }) };

    const result = await dexterResearch(
      { ticker: 'ZZZZZ', keyword: 'test', article_type: 'A', blog: 'test' },
      { env: { FINNHUB_API_KEY: 'test-key', NOCODB_BASE_URL: 'http://localhost:8080', NOCODB_API_TOKEN: 'tok', NOCODB_PROJECT_ID: 'p1', NOCODB_FINANCIAL_CACHE_TABLE_ID: 'Financial_Cache' }, fetchFn: mockFetch, _nocoClientOverride: mockNoco }
    );

    assert.ok(result.error);
    assert.ok(result.data_completeness < 0.5);
  });
});

// ===========================================================================
// Section 4: Finnhub Integration
// ===========================================================================

describe('TokenBucket rate limiter', () => {
  it('capacity=5: first 5 acquire() resolve immediately', async () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 5000 });
    const start = Date.now();
    await Promise.all([
      bucket.acquire(),
      bucket.acquire(),
      bucket.acquire(),
      bucket.acquire(),
      bucket.acquire(),
    ]);
    assert.ok(Date.now() - start < 100, 'All 5 should resolve immediately');
  });

  it('capacity=5: 6th acquire() waits for refill', async () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 50 });
    // drain the bucket
    for (let i = 0; i < 5; i++) await bucket.acquire();
    const start = Date.now();
    await bucket.acquire(); // 6th - must wait for refill
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `6th acquire should wait >= 40ms, got ${elapsed}ms`);
  });
});

describe('NocoDB cache layer', () => {
  function makeNoco(records) {
    return {
      search: async () => records,
      create: async (fields) => ({ Id: 1, ...fields }),
      update: async (id, fields) => ({ Id: id, ...fields }),
    };
  }

  it('readCache: valid unexpired record → returns parsed data', async () => {
    const noco = makeNoco([{ expires_at: Date.now() + 86400000, data_json: JSON.stringify({ c: 100 }) }]);
    const result = await readCache('AAPL', 'quote', noco);
    assert.deepStrictEqual(result, { c: 100 });
  });

  it('readCache: expired record → returns null', async () => {
    const noco = makeNoco([{ expires_at: Date.now() - 1000, data_json: JSON.stringify({ c: 99 }) }]);
    const result = await readCache('AAPL', 'quote', noco);
    assert.equal(result, null);
  });

  it('readCache: no record → returns null', async () => {
    const noco = makeNoco([]);
    const result = await readCache('AAPL', 'quote', noco);
    assert.equal(result, null);
  });

  it('writeCache: no existing record → create called, update not called', async () => {
    let createCalled = false;
    let updateCalled = false;
    const noco = {
      search: async () => [],
      create: async (fields) => { createCalled = true; return { Id: 1, ...fields }; },
      update: async () => { updateCalled = true; return {}; },
    };
    const data = { price: 150 };
    await writeCache('AAPL', 'quote', data, noco);
    assert.equal(createCalled, true, 'create should be called on cache miss');
    assert.equal(updateCalled, false, 'update should NOT be called');
  });

  it('writeCache: existing record → update called, create not called', async () => {
    let createCalled = false;
    let updateCalled = false;
    const noco = {
      search: async () => [{ Id: 42, ticker: 'AAPL', data_type: 'quote' }],
      create: async () => { createCalled = true; return {}; },
      update: async (id, fields) => { updateCalled = true; return { Id: id, ...fields }; },
    };
    await writeCache('AAPL', 'quote', { price: 155 }, noco);
    assert.equal(createCalled, false, 'create should NOT be called');
    assert.equal(updateCalled, true, 'update should be called on cache hit');
  });

  it('writeCache: expires_at written is approx Date.now() + 86400000', async () => {
    let writtenExpiresAt = null;
    const noco = {
      search: async () => [],
      create: async (fields) => { writtenExpiresAt = fields.expires_at; return { Id: 1 }; },
      update: async () => {},
    };
    const before = Date.now();
    await writeCache('AAPL', 'quote', { price: 150 }, noco);
    const after = Date.now();
    assert.ok(writtenExpiresAt >= before + 86400000 - 5000 && writtenExpiresAt <= after + 86400000 + 5000,
      `expires_at ${writtenExpiresAt} should be ~Date.now() + 86400000`);
  });
});

describe('finnhub.getQuote', () => {
  function makeMissNoco() {
    return { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };
  }

  it('cache miss → fetchFn called with Finnhub quote URL and returns data', async () => {
    let fetchedUrl = null;
    const fetchFn = async (url) => { fetchedUrl = url; return { statusCode: 200, body: { c: 150, h: 155, l: 148, o: 149, pc: 147, d: 3, dp: 2.04 } }; };
    const cacheWrites = [];
    const result = await getQuote('AAPL', 'test-key', fetchFn, makeMissNoco(), cacheWrites);
    assert.ok(fetchedUrl.includes('finnhub.io'));
    assert.ok(fetchedUrl.includes('AAPL'));
    assert.equal(result.c, 150);
    assert.equal(cacheWrites.length, 1, 'writeCache should be pushed to cacheWrites');
  });

  it('cache hit → fetchFn NOT called', async () => {
    let fetchCalled = false;
    const fetchFn = async () => { fetchCalled = true; return { statusCode: 200, body: {} }; };
    const noco = { search: async () => [{ expires_at: Date.now() + 86400000, data_json: JSON.stringify({ c: 99 }) }], create: async () => {}, update: async () => {} };
    const cacheWrites = [];
    const result = await getQuote('AAPL', 'test-key', fetchFn, noco, cacheWrites);
    assert.equal(fetchCalled, false, 'Finnhub should NOT be called on cache hit');
    assert.equal(result.c, 99);
    assert.equal(cacheWrites.length, 0, 'no cache write on hit');
  });

  it('fetchFn rejects with HTTP 429 → error propagates', async () => {
    const fetchFn = async () => { throw new Error('HTTP 429'); };
    const cacheWrites = [];
    await assert.rejects(() => getQuote('AAPL', 'test-key', fetchFn, makeMissNoco(), cacheWrites));
  });
});

describe('finnhub.getProfile', () => {
  const missNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };

  it('cache miss → fetches profile2 and returns object', async () => {
    const profileData = { name: 'Apple Inc', marketCapitalization: 3000000, exchange: 'NASDAQ', finnhubIndustry: 'Technology', country: 'US', currency: 'USD' };
    const fetchFn = async () => ({ statusCode: 200, body: profileData });
    const cacheWrites = [];
    const result = await getProfile('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
    assert.equal(result.name, 'Apple Inc');
    assert.equal(result.finnhubIndustry, 'Technology');
  });

  it('missing finnhubIndustry in response → returns null, not crash', async () => {
    const fetchFn = async () => ({ statusCode: 200, body: { name: 'NoIndustry Corp', marketCapitalization: 100 } });
    const cacheWrites = [];
    const result = await getProfile('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
    assert.equal(result.finnhubIndustry, null);
  });
});

describe('finnhub.getBasicFinancials', () => {
  const missNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };

  it('cache miss → fetches metric=all and returns metric fields', async () => {
    const metricData = { metric: { peBasicExclExtraTTM: 25, epsBasicExclExtraAnnual: 6.0, revenueGrowth3Y: 0.12, grossMarginTTM: 0.44 } };
    const fetchFn = async () => ({ statusCode: 200, body: metricData });
    const cacheWrites = [];
    const result = await getBasicFinancials('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
    assert.equal(result.metric.peBasicExclExtraTTM, 25);
    assert.equal(result.metric.revenueGrowth3Y, 0.12);
  });

  it('missing revenueGrowth3Y → returns null, not undefined or crash', async () => {
    const fetchFn = async () => ({ statusCode: 200, body: { metric: { peBasicExclExtraTTM: 25 } } });
    const cacheWrites = [];
    const result = await getBasicFinancials('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
    assert.equal(result.metric.revenueGrowth3Y, null);
  });

  it('cache hit → fetchFn NOT called', async () => {
    let fetchCalled = false;
    const fetchFn = async () => { fetchCalled = true; return { statusCode: 200, body: {} }; };
    const noco = { search: async () => [{ expires_at: Date.now() + 86400000, data_json: JSON.stringify({ metric: { pe: 20 } }) }], create: async () => {}, update: async () => {} };
    const cacheWrites = [];
    await getBasicFinancials('AAPL', 'test-key', fetchFn, noco, cacheWrites);
    assert.equal(fetchCalled, false);
  });
});

describe('finnhub.getInsiderTransactions', () => {
  it('cache miss → fetches insider-transactions URL and returns data', async () => {
    let fetchedUrl = null;
    const txData = { data: [{ name: 'CEO', share: 1000, change: 100, transactionDate: '2025-01-01', transactionPrice: 145 }] };
    const fetchFn = async (url) => { fetchedUrl = url; return { statusCode: 200, body: txData }; };
    const missNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };
    const cacheWrites = [];
    const result = await getInsiderTransactions('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
    assert.ok(fetchedUrl.includes('insider-transactions'));
    assert.ok(result.data);
    assert.equal(cacheWrites.length, 1);
  });
});

describe('fetchFinancialData integration', () => {
  const missNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };

  it('DATA_WEIGHTS values sum to exactly 1.0', () => {
    const sum = Object.values(DATA_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(parseFloat(sum.toFixed(10)), 1.0);
  });

  it('all 4+ Finnhub fetchers invoked in a single fetchFinancialData call', async () => {
    const fetchedUrls = [];
    const fetchFn = async (url) => {
      fetchedUrls.push(url);
      if (url.includes('/quote')) return { statusCode: 200, body: { c: 100, h: 105, l: 95, o: 99, pc: 98, d: 2, dp: 1 } };
      if (url.includes('/profile2')) return { statusCode: 200, body: { name: 'T', marketCapitalization: 100, exchange: 'NYSE', finnhubIndustry: null, country: 'US', currency: 'USD' } };
      if (url.includes('/metric')) return { statusCode: 200, body: { metric: {} } };
      if (url.includes('/insider-transactions')) return { statusCode: 200, body: { data: [] } };
      if (url.includes('/candle')) return { statusCode: 200, body: { s: 'ok', c: [100], t: [1e9], o: [99], h: [105], l: [95], v: [1e6] } };
      return { statusCode: 200, body: {} };
    };
    await fetchFinancialData('AAPL', { apiKey: 'k', nocoClient: missNoco, competitorsData: [] }, fetchFn);
    assert.ok(fetchedUrls.some((u) => u.includes('/quote')), 'quote endpoint should be called');
    assert.ok(fetchedUrls.some((u) => u.includes('/profile2')), 'profile endpoint should be called');
    assert.ok(fetchedUrls.some((u) => u.includes('/metric')), 'metric endpoint should be called');
    assert.ok(fetchedUrls.some((u) => u.includes('/insider-transactions')), 'insider-transactions endpoint should be called');
  });

  it('data_completeness = 1.0 when all 5 data types present', async () => {
    const fetchFn = async (url) => {
      if (url.includes('/quote')) return { statusCode: 200, body: { c: 150, h: 155, l: 148, o: 149, pc: 147, d: 3, dp: 2 } };
      if (url.includes('/profile2')) return { statusCode: 200, body: { name: 'Apple', marketCapitalization: 3e6, exchange: 'NASDAQ', finnhubIndustry: 'Tech', country: 'US', currency: 'USD' } };
      if (url.includes('/metric')) return { statusCode: 200, body: { metric: { peBasicExclExtraTTM: 25 } } };
      if (url.includes('/insider-transactions')) return { statusCode: 200, body: { data: [{ name: 'CEO', share: 100, change: 10, transactionDate: '2025-01-01', transactionPrice: 100 }] } };
      if (url.includes('/candle')) return { statusCode: 200, body: { s: 'ok', c: [100, 102], t: [1e9, 2e9], o: [99, 101], h: [105, 106], l: [95, 97], v: [1e6, 2e6] } };
      return { statusCode: 200, body: {} };
    };
    const result = await fetchFinancialData('AAPL', { apiKey: 'k', nocoClient: missNoco, competitorsData: [{ ticker: 'MSFT' }] }, fetchFn);
    assert.equal(result.data_completeness, 1.0);
  });

  it('data_completeness < 1.0 when some data types null', async () => {
    const fetchFn = async () => ({ statusCode: 500, body: {} });
    const result = await fetchFinancialData('AAPL', { apiKey: 'k', nocoClient: missNoco, competitorsData: [] }, fetchFn);
    assert.ok(result.data_completeness < 1.0);
  });
});

// ===========================================================================
// Helper functions for generating mock data
// ===========================================================================

function generateMockPrices(days, opts = {}) {
  const { highDay = -1, lowDay = -1 } = opts;
  const prices = [];
  const baseDate = new Date('2025-03-27');

  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - (days - 1 - i));

    let close = 100 + Math.sin(i / 20) * 30;
    if (i === highDay) close = 200;
    if (i === lowDay) close = 50;

    prices.push({
      date: date.toISOString().split('T')[0],
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1000000 + Math.floor(Math.random() * 500000),
    });
  }
  return prices;
}

function generateConstantPrices(days, price) {
  const prices = [];
  const baseDate = new Date('2025-03-27');
  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - (days - 1 - i));
    prices.push({
      date: date.toISOString().split('T')[0],
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1000000,
    });
  }
  return prices;
}

function generateLinearPrices(days, startPrice, endPrice) {
  const prices = [];
  const baseDate = new Date('2025-03-27');
  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - (days - 1 - i));
    const close = startPrice + (endPrice - startPrice) * (i / (days - 1));
    prices.push({
      date: date.toISOString().split('T')[0],
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000000,
    });
  }
  return prices;
}
