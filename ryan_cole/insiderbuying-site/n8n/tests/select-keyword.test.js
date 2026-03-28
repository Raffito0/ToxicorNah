const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyIntent,
  computePriorityScore,
  generateSeedKeywords,
  isDuplicate,
  selectTopKeywords,
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
// Test: Priority scoring
// ---------------------------------------------------------------------------
describe('computePriorityScore', () => {
  it('volume=1000, difficulty=30, multiplier=1.2 -> 840', () => {
    const score = computePriorityScore(1000, 30, 1.2);
    assert.equal(score, 840);
  });

  it('volume=500, difficulty=0, multiplier=1.0 -> 500', () => {
    assert.equal(computePriorityScore(500, 0, 1.0), 500);
  });

  it('volume=0 -> 0 regardless of other params', () => {
    assert.equal(computePriorityScore(0, 50, 1.2), 0);
  });

  it('difficulty=100 -> 0 regardless of volume', () => {
    assert.equal(computePriorityScore(1000, 100, 1.0), 0);
  });

  it('handles missing/null inputs gracefully', () => {
    assert.equal(computePriorityScore(null, 30, 1.0), 0);
    assert.equal(computePriorityScore(1000, null, 1.0), 1000);
  });
});

// ---------------------------------------------------------------------------
// Test: Seed keyword generation
// ---------------------------------------------------------------------------
describe('generateSeedKeywords', () => {
  it('insiderbuying seeds contain insider buying / Form 4 / insider trading patterns', () => {
    const seeds = generateSeedKeywords('insiderbuying', ['AAPL', 'NVDA']);
    const joined = seeds.join(' ');
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
// Test: Batch output — selectTopKeywords produces exactly 21
// ---------------------------------------------------------------------------
describe('selectTopKeywords', () => {
  it('returns exactly 21 keywords from larger pool', () => {
    const candidates = [];
    for (let i = 0; i < 50; i++) {
      candidates.push({
        keyword: `keyword ${i}`,
        search_volume: 1000 - i * 10,
        difficulty: 20 + i,
        cpc: 1.5,
        article_type: 'A',
        intent_multiplier: 1.0,
        priority_score: computePriorityScore(1000 - i * 10, 20 + i, 1.0),
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
// Test: Multi-blog — 2 blogs produce 42 keywords
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
