const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// Import the module under test
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
} = require('../code/insiderbuying/dexter-research.js');

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
    assert.ok(result.error.includes('FINANCIAL_DATASETS_API_KEY'));
  });

  it('returns aggregated data on success', async () => {
    const mockFetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => {
        if (url.includes('income-statements')) return { income_statements: [{ revenue: 1000, company_name: 'Apple', sector: 'Tech', market_capitalization: 3000000000000 }] };
        if (url.includes('balance-sheets')) return { balance_sheets: [{ total_assets: 5000 }] };
        if (url.includes('cash-flow')) return { cash_flow_statements: [{ operating_cash_flow: 300 }] };
        if (url.includes('financial-ratios')) return { financial_ratios: [{ pe_ratio: 25 }] };
        if (url.includes('insider-trades')) return { insider_trades: [{ insider_name: 'CEO', transaction_date: new Date().toISOString().split('T')[0], transaction_type: 'P-Purchase' }] };
        if (url.includes('stock-prices')) return { stock_prices: generateMockPrices(252) };
        return {};
      },
    });

    const result = await dexterResearch(
      { ticker: 'AAPL', keyword: 'test', article_type: 'A', blog: 'insiderbuying' },
      { env: { FINANCIAL_DATASETS_API_KEY: 'test-key' }, fetchFn: mockFetch }
    );

    assert.ok(!result.error);
    assert.ok(result.data_completeness >= 0.5);
    assert.equal(result.ticker, 'AAPL');
    assert.ok(result.stock_prices.current_price);
  });

  it('aborts when data_completeness < 0.5', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    const result = await dexterResearch(
      { ticker: 'ZZZZZ', keyword: 'test', article_type: 'A', blog: 'test' },
      { env: { FINANCIAL_DATASETS_API_KEY: 'test-key' }, fetchFn: mockFetch }
    );

    assert.ok(result.error);
    assert.ok(result.data_completeness < 0.5);
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
