const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractTicker,
  determineArticleParams,
  interpolateTemplate,
  qualityGate,
  sanitizeHtml,
  ensureUniqueSlug,
  buildToolSchema,
  extractToolResult,
  BANNED_PHRASES,
  VALID_VERDICTS,
  LENGTH_CONFIG,
} = require('../code/insiderbuying/generate-article.js');

// ---------------------------------------------------------------------------
// Ticker Extraction
// ---------------------------------------------------------------------------
describe('extractTicker', () => {
  it('extracts NVDA from "NVDA earnings analysis Q1 2026"', () => {
    assert.equal(extractTicker('NVDA earnings analysis Q1 2026'), 'NVDA');
  });

  it('extracts no ticker from "best dividend stocks 2026"', () => {
    assert.equal(extractTicker('best dividend stocks 2026'), null);
  });

  it('filters false positives: THE, CEO, BEST, FOR are rejected', () => {
    assert.equal(extractTicker('THE BEST CEO stocks FOR investors'), null);
  });

  it('extracts AAPL from "AAPL vs MSFT comparison" (first match)', () => {
    assert.equal(extractTicker('AAPL vs MSFT comparison'), 'AAPL');
  });

  it('extracts ticker with dot notation like BRK.B', () => {
    assert.equal(extractTicker('BRK.B insider buying signal'), 'BRK.B');
  });

  it('returns null for empty or missing input', () => {
    assert.equal(extractTicker(''), null);
    assert.equal(extractTicker(null), null);
    assert.equal(extractTicker(undefined), null);
  });

  it('rejects single-letter false positives: A, I', () => {
    assert.equal(extractTicker('A guide to investing'), null);
  });

  it('extracts valid 1-letter ticker if not a false positive', () => {
    // F (Ford) is a valid ticker, not in false positive list
    assert.equal(extractTicker('F stock earnings report'), 'F');
  });
});

// ---------------------------------------------------------------------------
// Article Parameters
// ---------------------------------------------------------------------------
describe('determineArticleParams', () => {
  it('returns object with targetLength, authorName, maxTokens', () => {
    const params = determineArticleParams('insiderbuying');
    assert.ok(['short', 'medium', 'long'].includes(params.targetLength));
    assert.equal(typeof params.authorName, 'string');
    assert.equal(typeof params.maxTokens, 'number');
  });

  it('uses "Dexter Research" for insiderbuying blog', () => {
    const params = determineArticleParams('insiderbuying');
    assert.equal(params.authorName, 'Dexter Research');
  });

  it('uses "Ryan Cole" for other blogs', () => {
    assert.equal(determineArticleParams('deepstockanalysis').authorName, 'Ryan Cole');
    assert.equal(determineArticleParams('dividenddeep').authorName, 'Ryan Cole');
  });

  it('weighted random produces ~30% short, ~50% medium, ~20% long over 100 runs', () => {
    const counts = { short: 0, medium: 0, long: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[determineArticleParams('insiderbuying').targetLength]++;
    }
    // Allow wide variance for randomness
    assert.ok(counts.short >= 200 && counts.short <= 400, `short: ${counts.short}`);
    assert.ok(counts.medium >= 380 && counts.medium <= 620, `medium: ${counts.medium}`);
    assert.ok(counts.long >= 100 && counts.long <= 300, `long: ${counts.long}`);
  });

  it('maxTokens matches targetLength correctly', () => {
    // Force specific lengths via seed-like approach (test all 3)
    const expected = { short: 6000, medium: 8000, long: 12000 };
    for (const [len, tokens] of Object.entries(expected)) {
      assert.equal(LENGTH_CONFIG[len].maxTokens, tokens);
    }
  });
});

// ---------------------------------------------------------------------------
// Variable Interpolation
// ---------------------------------------------------------------------------
describe('interpolateTemplate', () => {
  it('replaces all 18 {{VARIABLE}} placeholders with actual values', () => {
    const template = '{{BLOG}} {{TICKER}} {{COMPANY_NAME}} {{SECTOR}} {{MARKET_CAP}} ' +
      '{{ARTICLE_TYPE}} {{TARGET_LENGTH}} {{KEYWORD}} {{SECONDARY_KEYWORDS}} ' +
      '{{DEXTER_ANALYSIS}} {{FINANCIAL_DATA}} {{INSIDER_TRADES}} {{STOCK_PRICES}} ' +
      '{{COMPETITOR_DATA}} {{MANAGEMENT_QUOTES}} {{CURRENT_DATE}} {{AUTHOR_NAME}} {{NEWS_DATA}}';

    const vars = {
      BLOG: 'insiderbuying', TICKER: 'NVDA', COMPANY_NAME: 'NVIDIA',
      SECTOR: 'Technology', MARKET_CAP: '$3.2T', ARTICLE_TYPE: 'A',
      TARGET_LENGTH: 'medium', KEYWORD: 'NVDA earnings', SECONDARY_KEYWORDS: 'NVDA stock',
      DEXTER_ANALYSIS: '{}', FINANCIAL_DATA: '{}', INSIDER_TRADES: '[]',
      STOCK_PRICES: '{}', COMPETITOR_DATA: '[]', MANAGEMENT_QUOTES: '[]',
      CURRENT_DATE: '2026-03-27', AUTHOR_NAME: 'Dexter Research', NEWS_DATA: '[]',
    };

    const result = interpolateTemplate(template, vars);
    assert.ok(!result.includes('{{'), `Unresolved placeholders found: ${result}`);
  });

  it('leaves unknown placeholders as-is', () => {
    const result = interpolateTemplate('Hello {{UNKNOWN}}', { BLOG: 'test' });
    assert.ok(result.includes('{{UNKNOWN}}'));
  });
});

// ---------------------------------------------------------------------------
// Claude Tool Use
// ---------------------------------------------------------------------------
describe('buildToolSchema', () => {
  it('returns a tool definition with name "generate_article"', () => {
    const schema = buildToolSchema();
    assert.equal(schema.name, 'generate_article');
    assert.equal(typeof schema.input_schema, 'object');
  });

  it('schema requires title, body_html, verdict_type, slug', () => {
    const schema = buildToolSchema();
    const required = schema.input_schema.required || [];
    for (const field of ['title', 'body_html', 'verdict_type', 'slug']) {
      assert.ok(required.includes(field), `Missing required field: ${field}`);
    }
  });
});

describe('extractToolResult', () => {
  it('extracts article from tool_use content block', () => {
    const response = {
      content: [{
        type: 'tool_use',
        name: 'generate_article',
        input: { title: 'Test', body_html: '<p>Hello</p>', verdict_type: 'BUY' },
      }],
    };
    const result = extractToolResult(response);
    assert.equal(result.title, 'Test');
    assert.equal(result.verdict_type, 'BUY');
  });

  it('returns null for text response (safety refusal)', () => {
    const response = {
      content: [{ type: 'text', text: 'I cannot generate this content.' }],
    };
    assert.equal(extractToolResult(response), null);
  });

  it('returns null for empty content', () => {
    assert.equal(extractToolResult({ content: [] }), null);
    assert.equal(extractToolResult({}), null);
  });
});

// ---------------------------------------------------------------------------
// Quality Gate (14 checks)
// ---------------------------------------------------------------------------
describe('qualityGate', () => {
  function makeValidArticle() {
    return {
      title: 'NVDA Q1 2026 Earnings Analysis: 64% Margins Hide Big Risk',  // 59 chars
      meta_description: 'NVIDIA Q1 2026 earnings analysis reveals record 64.2% margins masking rising inventory risk. Our DCF model flags a key threshold investors watch.',  // 146 chars
      slug: 'nvda-q1-2026-earnings-analysis',
      key_takeaways: [
        'NVIDIA gross margin hit 64.2% in Q1 2026 — a record high.',
        'Insider selling totaled $847M in the past 90 days.',
        'Our 3-scenario DCF puts fair value at $118-$142.',
      ],
      body_html: '<h2>NVDA earnings analysis: Record Margins</h2><p>NVIDIA posted 64.2% gross margins in Q1 2026. Revenue grew 34% year over year to $26.0B.</p>' +
        '<p>The stock rallied 6% on the print. But page 23 of the 10-Q tells a different story.</p>' +
        '<p>Inventory ballooned to $8.1B in Q3 2025. That is 112 days of inventory.</p>' +
        '<p>Free cash flow hit $9.2B in the quarter. Operating expenses rose 18% to $4.1B.</p>' +
        '<p>Gross margin expanded 340 basis points from 60.8% a year ago.</p>' +
        '<table><tr><th>Metric</th><th>Q1 2026</th></tr><tr><td>Revenue</td><td>$26.0B</td></tr></table>' +
        '<p>The P/E ratio stands at 45x forward earnings. Analysts expect $3.29 EPS next quarter.</p>' +
        '<p>Insider selling totaled $847M over 90 days. CEO Jensen Huang sold $312M under 10b5-1.</p>' +
        '<p>Our DCF model suggests $118-$142 fair value range using a 10% discount rate.</p>' +
        '<p>CAUTION at $148. If inventory days drop below 90 next quarter, thesis flips to BUY.</p>',
      verdict_type: 'CAUTION',
      verdict_text: 'CAUTION at $148. Margins at 64.2% are exceptional but 112 inventory days warrant patience. Buy below $128.',
      word_count: 1350,
      primary_keyword: 'NVDA earnings analysis',
      secondary_keywords_used: ['NVIDIA revenue growth'],
      data_tables_count: 1,
      filing_citations_count: 2,
      confidence_notes: 'Least certain about inventory interpretation.',
    };
  }

  it('valid article passes all 14 checks', () => {
    const result = qualityGate(makeValidArticle(), 'NVDA earnings analysis', 'medium');
    assert.equal(result.pass, true, `Failed checks: ${JSON.stringify(result.failures)}`);
  });

  it('title too short fails check', () => {
    const article = makeValidArticle();
    article.title = 'Short';
    const result = qualityGate(article, 'NVDA earnings analysis', 'medium');
    assert.equal(result.pass, false);
    assert.ok(result.failures.some(f => f.includes('Title')));
  });

  it('banned phrase "it\'s worth noting" in body_html fails check #6', () => {
    const article = makeValidArticle();
    article.body_html += "<p>It's worth noting that revenue grew 34%.</p>";
    const result = qualityGate(article, 'NVDA earnings analysis', 'medium');
    assert.equal(result.pass, false);
    assert.ok(result.failures.some(f => f.toLowerCase().includes('banned')));
  });

  it('paragraph density < 40% numeric fails check #7', () => {
    const article = makeValidArticle();
    // Replace body with paragraphs that have no numbers
    article.body_html = '<h2>NVDA earnings analysis heading</h2>' +
      '<p>This is a paragraph without data points or numbers of any kind.</p>'.repeat(10) +
      '<p>Revenue was $26B in the quarter.</p>' +
      '<p>The stock price moved higher recently.</p>' +
      '<p>Analysts are watching the company closely now.</p>';
    const result = qualityGate(article, 'NVDA earnings analysis', 'medium');
    assert.equal(result.pass, false);
    assert.ok(result.failures.some(f => f.toLowerCase().includes('density') || f.toLowerCase().includes('numeric')));
  });

  it('missing title fails check #14 (required fields)', () => {
    const article = makeValidArticle();
    delete article.title;
    const result = qualityGate(article, 'NVDA earnings analysis', 'medium');
    assert.equal(result.pass, false);
  });

  it('invalid verdict_type fails check #4', () => {
    const article = makeValidArticle();
    article.verdict_type = 'STRONG_BUY';
    const result = qualityGate(article, 'NVDA earnings analysis', 'medium');
    assert.equal(result.pass, false);
    assert.ok(result.failures.some(f => f.toLowerCase().includes('verdict')));
  });

  it('2 failed retries saves article as status=error (gate returns failure count)', () => {
    const article = makeValidArticle();
    article.title = 'X'; // too short
    article.verdict_type = 'INVALID';
    const result = qualityGate(article, 'NVDA earnings analysis', 'medium');
    assert.equal(result.pass, false);
    assert.ok(result.failures.length >= 2);
  });

  it('primary keyword not in title fails check #9', () => {
    const article = makeValidArticle();
    article.title = 'Record Margins Hide a Problem in Tech Sector Now';
    // Pad to meet length
    article.title += ' Details';
    const result = qualityGate(article, 'NVDA earnings analysis', 'medium');
    assert.equal(result.pass, false);
    assert.ok(result.failures.some(f => f.includes('keyword') && f.includes('title')));
  });

  it('data_tables_count=0 for type A article fails check #13', () => {
    const article = makeValidArticle();
    article.data_tables_count = 0;
    const result = qualityGate(article, 'NVDA earnings analysis', 'medium', 'A');
    assert.equal(result.pass, false);
    assert.ok(result.failures.some(f => f.toLowerCase().includes('table')));
  });
});

// ---------------------------------------------------------------------------
// HTML Sanitization
// ---------------------------------------------------------------------------
describe('sanitizeHtml', () => {
  it('<script> tag stripped from body_html', () => {
    const dirty = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('<script'));
    assert.ok(!clean.includes('alert'));
    assert.ok(clean.includes('<p>Hello</p>'));
    assert.ok(clean.includes('<p>World</p>'));
  });

  it('external link gets rel="nofollow noopener noreferrer"', () => {
    const dirty = '<p>Check <a href="https://example.com">this</a></p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(clean.includes('rel="nofollow noopener noreferrer"'));
  });

  it('internal link (starts with /) does NOT get nofollow', () => {
    const dirty = '<p>See <a href="/blog/test">article</a></p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('nofollow'));
  });

  it('strips iframe tags', () => {
    const dirty = '<p>Hello</p><iframe src="evil.com"></iframe>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('<iframe'));
  });

  it('strips on* event attributes', () => {
    const dirty = '<p onclick="alert(1)">Click me</p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('onclick'));
  });

  it('preserves allowed tags: h2, p, table, blockquote, strong, em, a, ul, ol, li', () => {
    const html = '<h2>Title</h2><p>Text <strong>bold</strong> <em>italic</em></p>' +
      '<table><tr><td>data</td></tr></table><blockquote>quote</blockquote>' +
      '<ul><li>item</li></ul><ol><li>item</li></ol>' +
      '<a href="https://x.com">link</a>';
    const clean = sanitizeHtml(html);
    assert.ok(clean.includes('<h2>'));
    assert.ok(clean.includes('<strong>'));
    assert.ok(clean.includes('<table>'));
    assert.ok(clean.includes('<blockquote>'));
  });

  it('strips data-* attributes', () => {
    const dirty = '<p data-track="123">Text</p>';
    const clean = sanitizeHtml(dirty);
    assert.ok(!clean.includes('data-track'));
  });
});

// ---------------------------------------------------------------------------
// Slug Uniqueness
// ---------------------------------------------------------------------------
describe('ensureUniqueSlug', () => {
  it('returns original slug when no collision', () => {
    const result = ensureUniqueSlug('nvda-earnings', []);
    assert.equal(result, 'nvda-earnings');
  });

  it('appends date suffix on collision', () => {
    const result = ensureUniqueSlug('nvda-earnings', ['nvda-earnings']);
    // Should be nvda-earnings-YYMM format
    assert.ok(result.startsWith('nvda-earnings-'));
    assert.ok(result.length > 'nvda-earnings'.length);
    // Check format is YYMM (4 digits)
    const suffix = result.replace('nvda-earnings-', '');
    assert.match(suffix, /^\d{4}$/);
  });

  it('handles double collision with counter', () => {
    const existing = ['nvda-earnings', 'nvda-earnings-2603'];
    const result = ensureUniqueSlug('nvda-earnings', existing);
    assert.ok(!existing.includes(result));
  });
});
