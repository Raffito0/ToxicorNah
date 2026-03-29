const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyIntent,
  computePriorityScore,
  generateSeedKeywords,
  isDuplicate,
  selectTopKeywords,
  fetchKWEKeywords,
  INTENT_MULTIPLIERS,
  TYPE_MAP,
  BLOG_SEED_PATTERNS,
} = require('../code/insiderbuying/select-keyword.js');

// ---------------------------------------------------------------------------
// Test: Intent classification
// ---------------------------------------------------------------------------
describe('classifyIntent', () => {
  it('"NVDA earnings analysis" maps to type A', () => {
    assert.equal(classifyIntent('NVDA earnings analysis'), 'A');
  });

  it('"why insiders are buying" maps to type B', () => {
    assert.equal(classifyIntent('why insiders are buying'), 'B');
  });

  it('"NVDA vs AMD" maps to type C', () => {
    assert.equal(classifyIntent('NVDA vs AMD'), 'C');
  });

  it('"insider buying strategy guide" maps to type D', () => {
    assert.equal(classifyIntent('insider buying strategy guide'), 'D');
  });

  it('keyword with no signal words defaults to type A', () => {
    assert.equal(classifyIntent('AAPL stock'), 'A');
  });

  it('"best dividend stocks technology" maps to type C', () => {
    assert.equal(classifyIntent('best dividend stocks technology'), 'C');
  });

  it('"TSLA revenue results Q1" maps to type A', () => {
    assert.equal(classifyIntent('TSLA revenue results Q1'), 'A');
  });

  it('handles empty/null input', () => {
    assert.equal(classifyIntent(''), 'A');
    assert.equal(classifyIntent(null), 'A');
  });
});

// ---------------------------------------------------------------------------
// Test: Priority scoring (updated: {kd, volume} signature, new formula)
// ---------------------------------------------------------------------------
describe('computePriorityScore', () => {
  it('{volume:1000, kd:30} -> 0.7', () => {
    const score = computePriorityScore({ volume: 1000, kd: 30 });
    assert.ok(Math.abs(score - 0.7) < 0.001, `expected ~0.7, got ${score}`);
  });

  it('{volume:500, kd:0} -> 0.5', () => {
    assert.ok(Math.abs(computePriorityScore({ volume: 500, kd: 0 }) - 0.5) < 0.001);
  });

  it('{volume:0} -> 0 regardless of kd', () => {
    assert.equal(computePriorityScore({ volume: 0, kd: 50 }), 0);
  });

  it('{kd:100} -> 0 regardless of volume', () => {
    assert.equal(computePriorityScore({ volume: 1000, kd: 100 }), 0);
  });

  it('handles missing/null inputs gracefully', () => {
    assert.equal(computePriorityScore({ volume: null, kd: 30 }), 0);
    assert.ok(Math.abs(computePriorityScore({ volume: 1000, kd: null }) - 1.0) < 0.001);
  });

  it('low-kd/high-volume scores higher than high-kd/low-volume', () => {
    const good = computePriorityScore({ volume: 2000, kd: 10 });
    const poor = computePriorityScore({ volume: 100, kd: 80 });
    assert.ok(good > poor, `expected ${good} > ${poor}`);
  });

  it('DataForSEO field names not in function body', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../code/insiderbuying/select-keyword.js'), 'utf8'
    );
    const fnStart = src.indexOf('function computePriorityScore');
    const fnEnd = src.indexOf('}', fnStart);
    const fnBody = src.slice(fnStart, fnEnd + 1);
    assert.ok(!fnBody.includes('competition_index'), 'competition_index should not be in computePriorityScore');
    assert.ok(!fnBody.includes('search_volume'), 'search_volume should not be in computePriorityScore');
  });
});

// ---------------------------------------------------------------------------
// Test: Seed keyword generation
// ---------------------------------------------------------------------------
describe('generateSeedKeywords', () => {
  it('insiderbuying seeds contain insider buying / Form 4 / insider trading patterns', () => {
    const seeds = generateSeedKeywords('insiderbuying', ['AAPL', 'NVDA']);
    assert.ok(seeds.some((s) => s.toLowerCase().includes('insider buying')),
      'Should contain "insider buying"');
    assert.ok(seeds.some((s) => s.includes('Form 4')),
      'Should contain "Form 4"');
    assert.ok(seeds.some((s) => s.toLowerCase().includes('insider trading')),
      'Should contain "insider trading"');
  });

  it('deepstockanalysis seeds contain earnings / forecast patterns', () => {
    const seeds = generateSeedKeywords('deepstockanalysis', ['AAPL']);
    const joined = seeds.join(' ').toLowerCase();
    assert.ok(joined.includes('earnings'), 'Should contain "earnings"');
    assert.ok(joined.includes('forecast'), 'Should contain "forecast"');
  });

  it('dividenddeep seeds contain dividend / payout ratio patterns', () => {
    const seeds = generateSeedKeywords('dividenddeep', ['AAPL']);
    const joined = seeds.join(' ').toLowerCase();
    assert.ok(joined.includes('dividend'), 'Should contain "dividend"');
    assert.ok(joined.includes('payout ratio'), 'Should contain "payout ratio"');
  });

  it('returns empty array for unknown blog', () => {
    assert.deepStrictEqual(generateSeedKeywords('unknown_blog', ['AAPL']), []);
  });

  it('uses provided tickers in seeds', () => {
    const seeds = generateSeedKeywords('insiderbuying', ['TSLA']);
    assert.ok(seeds.some((s) => s.includes('TSLA')), 'Should include ticker TSLA');
  });
});

// ---------------------------------------------------------------------------
// Test: Dedup
// ---------------------------------------------------------------------------
describe('isDuplicate', () => {
  it('exact match (case-insensitive) is duplicate', () => {
    const existing = ['insider buying AAPL', 'NVDA earnings analysis'];
    assert.equal(isDuplicate('INSIDER BUYING AAPL', existing), true);
    assert.equal(isDuplicate('insider buying aapl', existing), true);
  });

  it('different keyword is not duplicate', () => {
    const existing = ['insider buying AAPL'];
    assert.equal(isDuplicate('insider buying NVDA', existing), false);
  });

  it('handles empty existing list', () => {
    assert.equal(isDuplicate('anything', []), false);
  });
});

// ---------------------------------------------------------------------------
// Test: Batch output -- selectTopKeywords produces exactly 21
// ---------------------------------------------------------------------------
describe('selectTopKeywords', () => {
  it('returns exactly 21 keywords from larger pool', () => {
    const candidates = [];
    for (let i = 0; i < 50; i++) {
      candidates.push({
        keyword: `keyword ${i}`,
        volume: 1000 - i * 10,
        kd: 20 + i,
        cpc: 1.5,
        article_type: 'A',
        intent_multiplier: 1.0,
        priority_score: computePriorityScore({ volume: 1000 - i * 10, kd: 20 + i }),
      });
    }
    const selected = selectTopKeywords(candidates, 21);
    assert.equal(selected.length, 21);
  });

  it('returns all if pool has fewer than 21', () => {
    const candidates = [
      { keyword: 'a', priority_score: 100 },
      { keyword: 'b', priority_score: 50 },
    ];
    const selected = selectTopKeywords(candidates, 21);
    assert.equal(selected.length, 2);
  });

  it('returns keywords sorted by priority_score descending', () => {
    const candidates = [
      { keyword: 'low', priority_score: 10 },
      { keyword: 'high', priority_score: 500 },
      { keyword: 'mid', priority_score: 200 },
    ];
    const selected = selectTopKeywords(candidates, 21);
    assert.equal(selected[0].keyword, 'high');
    assert.equal(selected[1].keyword, 'mid');
    assert.equal(selected[2].keyword, 'low');
  });
});

// ---------------------------------------------------------------------------
// Test: Multi-blog -- 2 blogs produce 42 keywords
// ---------------------------------------------------------------------------
describe('multi-blog keyword selection', () => {
  it('2 active blogs produce separate keyword sets', () => {
    const blog1Candidates = Array.from({ length: 30 }, (_, i) => ({
      keyword: `blog1_kw_${i}`,
      blog: 'insiderbuying',
      priority_score: 1000 - i * 10,
    }));
    const blog2Candidates = Array.from({ length: 30 }, (_, i) => ({
      keyword: `blog2_kw_${i}`,
      blog: 'deepstockanalysis',
      priority_score: 900 - i * 10,
    }));

    const selected1 = selectTopKeywords(blog1Candidates, 21);
    const selected2 = selectTopKeywords(blog2Candidates, 21);
    const total = [...selected1, ...selected2];

    assert.equal(total.length, 42);
    assert.equal(selected1.length, 21);
    assert.equal(selected2.length, 21);
  });
});

// ---------------------------------------------------------------------------
// Test: INTENT_MULTIPLIERS constant
// ---------------------------------------------------------------------------
describe('INTENT_MULTIPLIERS', () => {
  it('A=1.0, B=1.2, C=0.8, D=0.9', () => {
    assert.equal(INTENT_MULTIPLIERS.A, 1.0);
    assert.equal(INTENT_MULTIPLIERS.B, 1.2);
    assert.equal(INTENT_MULTIPLIERS.C, 0.8);
    assert.equal(INTENT_MULTIPLIERS.D, 0.9);
  });
});

// ---------------------------------------------------------------------------
// Test: TYPE_MAP has all required signal words
// ---------------------------------------------------------------------------
describe('TYPE_MAP', () => {
  it('type A contains earnings, analysis, forecast, valuation', () => {
    assert.ok(TYPE_MAP.A.includes('earnings'));
    assert.ok(TYPE_MAP.A.includes('analysis'));
    assert.ok(TYPE_MAP.A.includes('forecast'));
    assert.ok(TYPE_MAP.A.includes('valuation'));
  });

  it('type B contains why, signal, insider, pattern', () => {
    assert.ok(TYPE_MAP.B.includes('why'));
    assert.ok(TYPE_MAP.B.includes('signal'));
    assert.ok(TYPE_MAP.B.includes('insider'));
    assert.ok(TYPE_MAP.B.includes('pattern'));
  });

  it('type C contains vs, compare, best, top', () => {
    assert.ok(TYPE_MAP.C.includes('vs'));
    assert.ok(TYPE_MAP.C.includes('compare'));
    assert.ok(TYPE_MAP.C.includes('best'));
    assert.ok(TYPE_MAP.C.includes('top'));
  });

  it('type D contains strategy, guide, opinion, should', () => {
    assert.ok(TYPE_MAP.D.includes('strategy'));
    assert.ok(TYPE_MAP.D.includes('guide'));
    assert.ok(TYPE_MAP.D.includes('opinion'));
    assert.ok(TYPE_MAP.D.includes('should'));
  });
});

// ---------------------------------------------------------------------------
// Test: fetchKWEKeywords
// ---------------------------------------------------------------------------
describe('fetchKWEKeywords', () => {
  let savedKWEKey;

  before(() => {
    savedKWEKey = process.env.KWE_API_KEY;
    process.env.KWE_API_KEY = 'test-kwe-key';
  });

  after(() => {
    if (savedKWEKey === undefined) delete process.env.KWE_API_KEY;
    else process.env.KWE_API_KEY = savedKWEKey;
  });

  it('happy path: returns {keyword, kd, volume, cpc} mapped from KWE response', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { keyword: 'insider buying AAPL', seo_difficulty: 35, vol: 1000, competition: { value: 0.45 } },
          { keyword: 'form 4 NVDA', seo_difficulty: 50, vol: 500, competition: { value: 0.30 } },
        ],
      }),
    });

    const result = await fetchKWEKeywords(['insider buying AAPL', 'form 4 NVDA'], { fetchFn: mockFetch });
    assert.equal(result.length, 2);
    assert.equal(result[0].keyword, 'insider buying AAPL');
    assert.equal(result[0].kd, 35);
    assert.equal(result[0].volume, 1000);
    assert.equal(result[0].cpc, 0.45);
    // exactly 4 fields, no extras
    assert.deepStrictEqual(Object.keys(result[0]).sort(), ['cpc', 'kd', 'keyword', 'volume']);
  });

  it('kd falls back to on_page_difficulty when seo_difficulty is absent', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { keyword: 'test kw', on_page_difficulty: 42, vol: 200, competition: { value: 0.1 } },
        ],
      }),
    });

    const result = await fetchKWEKeywords(['test kw'], { fetchFn: mockFetch });
    assert.equal(result[0].kd, 42);
  });

  it('request shape: POST to KWE URL with Authorization Bearer and correct body', async () => {
    process.env.KWE_API_KEY = 'my-test-api-key';
    let capturedUrl, capturedOpts;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOpts = options;
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };

    await fetchKWEKeywords(['insider buying'], { fetchFn: mockFetch });

    assert.equal(capturedUrl, 'https://api.keywordseverywhere.com/v1/get_keyword_data');
    assert.equal(capturedOpts.method, 'POST');
    assert.ok(capturedOpts.headers['Authorization'].includes('my-test-api-key'),
      'Authorization header must include KWE_API_KEY');
    assert.ok(capturedOpts.headers['Authorization'].startsWith('Bearer '),
      'Authorization header must use Bearer scheme');
    const body = JSON.parse(capturedOpts.body);
    assert.equal(body.country, 'us');
    assert.equal(body.currency, 'usd');
    assert.equal(body.dataSource, 'gkp');
    assert.deepStrictEqual(body['kw[]'], ['insider buying']);
  });

  it('empty keyword list returns [] without making HTTP call', async () => {
    let called = false;
    const mockFetch = async () => { called = true; return {}; };
    const result = await fetchKWEKeywords([], { fetchFn: mockFetch });
    assert.deepStrictEqual(result, []);
    assert.equal(called, false, 'fetchFn should not be called for empty list');
  });

  it('HTTP 5xx throws a descriptive error (not silent empty array)', async () => {
    const mockFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(
      () => fetchKWEKeywords(['test'], { fetchFn: mockFetch }),
      /503/
    );
  });

  it('HTTP 429 throws with "429" in error message', async () => {
    const mockFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await assert.rejects(
      () => fetchKWEKeywords(['test'], { fetchFn: mockFetch }),
      /429/
    );
  });
});

// ---------------------------------------------------------------------------
// Test: fetchKeywordData -- fallback chain
// ---------------------------------------------------------------------------
describe('fetchKeywordData fallback chain', () => {
  const { fetchKeywordData } = require('../code/insiderbuying/select-keyword.js');
  let savedKWEKey;

  before(() => {
    savedKWEKey = process.env.KWE_API_KEY;
    process.env.KWE_API_KEY = 'test-kwe-key';
  });

  after(() => {
    if (savedKWEKey === undefined) delete process.env.KWE_API_KEY;
    else process.env.KWE_API_KEY = savedKWEKey;
  });

  it('when KWE throws, calls DataForSEO fallback and returns its results', async () => {
    let dataForSEOCalled = false;
    const mockFetch = async (url) => {
      if (url.includes('keywordseverywhere')) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      // DataForSEO fallback call
      dataForSEOCalled = true;
      return {
        ok: true, status: 200,
        json: async () => ({
          tasks: [{
            result: [
              {
                keyword: 'insider buying',
                keyword_info: { search_volume: 800, cpc: 1.2 },
                keyword_properties: { keyword_difficulty: 40 },
              },
            ],
          }],
        }),
      };
    };

    // Set DataForSEO credentials so fallback doesn't throw on missing creds
    const origLogin = process.env.DATAFORSEO_LOGIN;
    const origPass = process.env.DATAFORSEO_PASSWORD;
    process.env.DATAFORSEO_LOGIN = 'test-login';
    process.env.DATAFORSEO_PASSWORD = 'test-pass';

    try {
      const result = await fetchKeywordData(['insider buying'], { fetchFn: mockFetch });
      assert.equal(dataForSEOCalled, true, 'DataForSEO fallback should be called when KWE fails');
      assert.equal(result.length, 1);
      assert.equal(result[0].keyword, 'insider buying');
      assert.equal(result[0].volume, 800);
      assert.equal(result[0].kd, 40);
    } finally {
      if (origLogin === undefined) delete process.env.DATAFORSEO_LOGIN;
      else process.env.DATAFORSEO_LOGIN = origLogin;
      if (origPass === undefined) delete process.env.DATAFORSEO_PASSWORD;
      else process.env.DATAFORSEO_PASSWORD = origPass;
    }
  });
});

// ---------------------------------------------------------------------------
// Test: DataForSEO fallback static check
// ---------------------------------------------------------------------------
describe('DataForSEO fallback static check', () => {
  it('fetchSearchVolume and fetchRelatedKeywords are removed; fetchDataForSEOFallback exists', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../code/insiderbuying/select-keyword.js'), 'utf8'
    );
    assert.ok(!src.includes('fetchSearchVolume'),
      'fetchSearchVolume should be removed from select-keyword.js');
    assert.ok(!src.includes('fetchRelatedKeywords'),
      'fetchRelatedKeywords should be removed from select-keyword.js');
    assert.ok(src.includes('fetchDataForSEOFallback'),
      'fetchDataForSEOFallback named fallback must exist');
  });
});
