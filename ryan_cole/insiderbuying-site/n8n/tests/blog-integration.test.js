const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeTickerParam,
  sanitizeSectorParam,
  sanitizeSlugParam,
  validateVerdictType,
  validateBlog,
  buildArticleListQuery,
  buildArticleDetailQuery,
  hasNocoDBInjection,
  parseRelatedArticles,
  computeReadingTime,
  extractH2Headings,
  VALID_VERDICT_TYPES,
  VALID_BLOGS,
} = require('../code/insiderbuying/blog-helpers.js');

// ---------------------------------------------------------------------------
// Input Validation
// ---------------------------------------------------------------------------
describe('sanitizeTickerParam', () => {
  it('strips non-alphanumeric, uppercases, max 5 chars', () => {
    assert.equal(sanitizeTickerParam('nvda'), 'NVDA');
    assert.equal(sanitizeTickerParam('BRK.B'), 'BRKB');
    assert.equal(sanitizeTickerParam('TOOLONG'), 'TOOLO');
  });

  it('returns null for empty/invalid input', () => {
    assert.equal(sanitizeTickerParam(''), null);
    assert.equal(sanitizeTickerParam(null), null);
    assert.equal(sanitizeTickerParam('!!!'), null);
  });
});

describe('sanitizeSectorParam', () => {
  it('strips special characters, max 50 chars', () => {
    assert.equal(sanitizeSectorParam('Technology'), 'Technology');
    assert.equal(sanitizeSectorParam('Health<script>Care'), 'HealthscriptCare');
  });

  it('returns null for empty input', () => {
    assert.equal(sanitizeSectorParam(''), null);
    assert.equal(sanitizeSectorParam(null), null);
  });
});

describe('sanitizeSlugParam', () => {
  it('allows alphanumeric, hyphens, underscores', () => {
    assert.equal(sanitizeSlugParam('nvda-earnings-q1-2026'), 'nvda-earnings-q1-2026');
  });

  it('strips invalid characters', () => {
    assert.equal(sanitizeSlugParam('test<script>slug'), 'testscriptslug');
  });

  it('max 200 chars', () => {
    const long = 'a'.repeat(250);
    assert.equal(sanitizeSlugParam(long).length, 200);
  });
});

describe('validateVerdictType', () => {
  it('accepts valid verdict types', () => {
    for (const v of VALID_VERDICT_TYPES) {
      assert.equal(validateVerdictType(v), v);
    }
  });

  it('rejects invalid verdict types', () => {
    assert.equal(validateVerdictType('STRONG_BUY'), null);
    assert.equal(validateVerdictType(''), null);
  });
});

describe('validateBlog', () => {
  it('accepts valid blog names', () => {
    for (const b of VALID_BLOGS) {
      assert.equal(validateBlog(b), b);
    }
  });

  it('defaults to insiderbuying for invalid', () => {
    assert.equal(validateBlog('unknown'), 'insiderbuying');
    assert.equal(validateBlog(''), 'insiderbuying');
  });
});

describe('hasNocoDBInjection', () => {
  it('detects ~and operator', () => {
    assert.equal(hasNocoDBInjection('test~and(hack)'), true);
  });

  it('detects ~or operator', () => {
    assert.equal(hasNocoDBInjection('~or(status,eq,draft)'), true);
  });

  it('detects parentheses', () => {
    assert.equal(hasNocoDBInjection('(status,eq,draft)'), true);
  });

  it('passes clean input', () => {
    assert.equal(hasNocoDBInjection('NVDA'), false);
    assert.equal(hasNocoDBInjection('Technology'), false);
  });
});

// ---------------------------------------------------------------------------
// Query Building
// ---------------------------------------------------------------------------
describe('buildArticleListQuery', () => {
  it('builds base query with blog and status=published', () => {
    const q = decodeURIComponent(buildArticleListQuery({ blog: 'insiderbuying' }));
    assert.ok(q.includes('(blog,eq,insiderbuying)'));
    assert.ok(q.includes('(status,eq,published)'));
  });

  it('does NOT include body_html in fields', () => {
    const q = buildArticleListQuery({ blog: 'insiderbuying' });
    assert.ok(!q.includes('body_html'));
  });

  it('adds verdict_type filter when provided', () => {
    const q = decodeURIComponent(buildArticleListQuery({ blog: 'insiderbuying', verdict_type: 'BUY' }));
    assert.ok(q.includes('(verdict_type,eq,BUY)'));
  });

  it('adds pagination with limit=12', () => {
    const q = buildArticleListQuery({ blog: 'insiderbuying', page: 2 });
    assert.ok(q.includes('limit=12'));
    assert.ok(q.includes('offset=12'));
  });

  it('sorts by published_at DESC', () => {
    const q = buildArticleListQuery({ blog: 'insiderbuying' });
    assert.ok(q.includes('sort=-published_at'));
  });
});

describe('buildArticleDetailQuery', () => {
  it('queries by slug with status=published', () => {
    const q = decodeURIComponent(buildArticleDetailQuery('nvda-earnings'));
    assert.ok(q.includes('(slug,eq,nvda-earnings)'));
    assert.ok(q.includes('(status,eq,published)'));
  });
});

// ---------------------------------------------------------------------------
// Frontend Helpers
// ---------------------------------------------------------------------------
describe('parseRelatedArticles', () => {
  it('parses JSON string to array', () => {
    const json = JSON.stringify([{ id: 1, slug: 'test', title: 'Test' }]);
    const result = parseRelatedArticles(json);
    assert.equal(result.length, 1);
    assert.equal(result[0].slug, 'test');
  });

  it('returns empty array for null/empty', () => {
    assert.deepStrictEqual(parseRelatedArticles(null), []);
    assert.deepStrictEqual(parseRelatedArticles(''), []);
    assert.deepStrictEqual(parseRelatedArticles('null'), []);
  });

  it('returns empty array for invalid JSON', () => {
    assert.deepStrictEqual(parseRelatedArticles('{broken'), []);
  });
});

describe('computeReadingTime', () => {
  it('calculates from word_count / 200, rounded up', () => {
    assert.equal(computeReadingTime(1350), 7);
    assert.equal(computeReadingTime(200), 1);
    assert.equal(computeReadingTime(0), 1);
  });
});

describe('extractH2Headings', () => {
  it('extracts h2 text from body_html', () => {
    const html = '<h2>First Section</h2><p>text</p><h2>Second Section</h2>';
    const headings = extractH2Headings(html);
    assert.deepStrictEqual(headings, ['First Section', 'Second Section']);
  });

  it('returns empty array for no h2s', () => {
    assert.deepStrictEqual(extractH2Headings('<p>no headings</p>'), []);
    assert.deepStrictEqual(extractH2Headings(''), []);
  });
});
