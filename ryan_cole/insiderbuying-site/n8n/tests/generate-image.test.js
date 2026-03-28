const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHeroPrompt,
  buildOgCardHtml,
  getVerdictColor,
  buildR2Key,
  escapeHtml,
  VERDICT_COLORS,
  FALLBACK_HERO_URLS,
} = require('../code/insiderbuying/generate-image.js');

// ---------------------------------------------------------------------------
// Hero Image Prompt
// ---------------------------------------------------------------------------
describe('buildHeroPrompt', () => {
  it('contains ticker and company name', () => {
    const prompt = buildHeroPrompt({ ticker: 'NVDA', company_name: 'NVIDIA', verdict_type: 'BUY' });
    assert.ok(prompt.includes('NVDA'));
    assert.ok(prompt.includes('NVIDIA'));
  });

  it('contains verdict sentiment', () => {
    const prompt = buildHeroPrompt({ ticker: 'AAPL', company_name: 'Apple', verdict_type: 'CAUTION' });
    assert.ok(prompt.toLowerCase().includes('caution'));
  });

  it('specifies 1200x630 dimensions', () => {
    const prompt = buildHeroPrompt({ ticker: 'AAPL', company_name: 'Apple', verdict_type: 'BUY' });
    assert.ok(prompt.includes('1200x630') || prompt.includes('1200') && prompt.includes('630'));
  });
});

// ---------------------------------------------------------------------------
// Verdict Colors
// ---------------------------------------------------------------------------
describe('getVerdictColor', () => {
  it('BUY returns green', () => {
    assert.equal(getVerdictColor('BUY'), '#22C55E');
  });

  it('SELL returns red', () => {
    assert.equal(getVerdictColor('SELL'), '#EF4444');
  });

  it('CAUTION returns amber', () => {
    assert.equal(getVerdictColor('CAUTION'), '#F59E0B');
  });

  it('WAIT returns blue', () => {
    assert.equal(getVerdictColor('WAIT'), '#3B82F6');
  });

  it('NO_TRADE returns gray', () => {
    assert.equal(getVerdictColor('NO_TRADE'), '#6B7280');
  });

  it('unknown verdict returns gray', () => {
    assert.equal(getVerdictColor('UNKNOWN'), '#6B7280');
  });
});

// ---------------------------------------------------------------------------
// OG Card HTML Template
// ---------------------------------------------------------------------------
describe('buildOgCardHtml', () => {
  const article = {
    title: 'NVDA Q1 2026 Earnings: 64% Margins Hide Big Risk',
    ticker: 'NVDA',
    verdict_type: 'CAUTION',
    key_takeaways: ['NVIDIA gross margin hit 64.2% in Q1 2026.'],
    company_name: 'NVIDIA Corporation',
  };

  it('contains article title', () => {
    const html = buildOgCardHtml(article);
    assert.ok(html.includes('NVDA Q1 2026 Earnings'));
  });

  it('contains ticker symbol', () => {
    const html = buildOgCardHtml(article);
    assert.ok(html.includes('NVDA'));
  });

  it('contains verdict badge with color', () => {
    const html = buildOgCardHtml(article);
    assert.ok(html.includes('CAUTION'));
    assert.ok(html.includes('#F59E0B')); // amber
  });

  it('contains first key takeaway', () => {
    const html = buildOgCardHtml(article);
    assert.ok(html.includes('64.2%'));
  });

  it('contains earlyinsider.com URL', () => {
    const html = buildOgCardHtml(article);
    assert.ok(html.includes('earlyinsider.com'));
  });

  it('HTML-escapes company name with special characters', () => {
    const atnt = { ...article, company_name: 'AT&T Inc.', title: 'AT&T Dividend Safety: 6.8% Yield Under Close Watch' };
    const html = buildOgCardHtml(atnt);
    assert.ok(html.includes('AT&amp;T'), 'AT&T should be escaped');
    assert.ok(!html.includes('AT&T Inc.'), 'Raw AT&T should not appear unescaped');
  });

  it('sets viewport to 1200x630', () => {
    const html = buildOgCardHtml(article);
    assert.ok(html.includes('1200') && html.includes('630'));
  });
});

// ---------------------------------------------------------------------------
// R2 Key Builder
// ---------------------------------------------------------------------------
describe('buildR2Key', () => {
  it('hero path: earlyinsider/images/{slug}_hero.png', () => {
    assert.equal(buildR2Key('nvda-earnings', 'hero'), 'earlyinsider/images/nvda-earnings_hero.png');
  });

  it('og path: earlyinsider/images/{slug}_og.png', () => {
    assert.equal(buildR2Key('nvda-earnings', 'og'), 'earlyinsider/images/nvda-earnings_og.png');
  });
});

// ---------------------------------------------------------------------------
// HTML Escaping
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    assert.equal(escapeHtml('AT&T'), 'AT&amp;T');
  });

  it('escapes angle brackets', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  });

  it('escapes quotes', () => {
    assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
  });

  it('returns empty string for null input', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

// ---------------------------------------------------------------------------
// Fallback hero URLs
// ---------------------------------------------------------------------------
describe('FALLBACK_HERO_URLS', () => {
  it('has entries for all 5 verdict types', () => {
    for (const v of ['BUY', 'SELL', 'CAUTION', 'WAIT', 'NO_TRADE']) {
      assert.ok(FALLBACK_HERO_URLS[v], `Missing fallback for ${v}`);
    }
  });
});
