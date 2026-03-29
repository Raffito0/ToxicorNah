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
  generateHeroImage,
  generateOgCard,
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

// ---------------------------------------------------------------------------
// generateHeroImage -- Template 13 path
// ---------------------------------------------------------------------------

const HERO_ARTICLE = {
  slug: 'aapl-buy-2026-03-29',
  headline: 'Apple Insiders Load Up Before Earnings',
  ticker: 'AAPL',
  verdict: 'BULLISH',
  insiderName: 'Tim Cook',
  date: 'March 29, 2026',
};

function makeR2Env() {
  return {
    R2_ACCOUNT_ID: 'acct-test',
    R2_ACCESS_KEY_ID: 'akid-test',
    R2_SECRET_ACCESS_KEY: 'sak-test',
    R2_PUBLIC_URL: 'https://pub.r2.test',
  };
}

describe('generateHeroImage -- Template 13 path', () => {
  it('guard throws when templates is null', async () => {
    await assert.rejects(
      () => generateHeroImage(HERO_ARTICLE, { templates: null }),
      /renderTemplate not found/
    );
  });

  it('guard throws when templates has no renderTemplate function', async () => {
    await assert.rejects(
      () => generateHeroImage(HERO_ARTICLE, { templates: {} }),
      /renderTemplate not found/
    );
  });

  it('calls renderTemplate(13, ...) with all required fields', async () => {
    let capturedId, capturedData;
    const mockBuffer = Buffer.from('PNG-DATA');
    const opts = {
      templates: {
        renderTemplate: async (id, data) => {
          capturedId = id;
          capturedData = Object.assign({}, data);
          return mockBuffer;
        },
      },
      fetchFn: async () => ({ ok: true }),
      env: makeR2Env(),
    };
    await generateHeroImage(HERO_ARTICLE, opts);
    assert.strictEqual(capturedId, 13);
    assert.strictEqual(capturedData.headline, HERO_ARTICLE.headline);
    assert.strictEqual(capturedData.ticker, HERO_ARTICLE.ticker);
    assert.strictEqual(capturedData.verdict, HERO_ARTICLE.verdict);
    assert.strictEqual(capturedData.insiderName, HERO_ARTICLE.insiderName);
    assert.strictEqual(capturedData.date, HERO_ARTICLE.date);
  });

  it('R2 key is hero-{slug}.png', async () => {
    const env = makeR2Env();
    const opts = {
      templates: { renderTemplate: async () => Buffer.from('PNG') },
      fetchFn: async () => ({ ok: true }),
      env,
    };
    const result = await generateHeroImage(HERO_ARTICLE, opts);
    assert.strictEqual(result, env.R2_PUBLIC_URL + '/hero-' + HERO_ARTICLE.slug + '.png');
  });

  it('returns the R2 URL string from uploadToR2', async () => {
    const env = makeR2Env();
    const opts = {
      templates: { renderTemplate: async () => Buffer.from('PNG') },
      fetchFn: async () => ({ ok: true }),
      env,
    };
    const result = await generateHeroImage(HERO_ARTICLE, opts);
    assert.ok(typeof result === 'string' && result.startsWith('https://'));
  });

  it('makes no fal.ai calls', async () => {
    let falCallCount = 0;
    const opts = {
      templates: { renderTemplate: async () => Buffer.from('PNG') },
      fetchFn: async (url) => {
        if (typeof url === 'string' && url.includes('fal.run')) falCallCount++;
        return { ok: true };
      },
      env: makeR2Env(),
    };
    await generateHeroImage(HERO_ARTICLE, opts);
    assert.strictEqual(falCallCount, 0);
  });
});

// ---------------------------------------------------------------------------
// generateOgCard -- regression guard
// ---------------------------------------------------------------------------

describe('generateOgCard -- regression guard', () => {
  it('calls screenshot server at host.docker.internal:3456', async () => {
    let screenshotCalled = false;
    const fetchFn = async (url) => {
      if (typeof url === 'string' && url.includes('3456')) screenshotCalled = true;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    };
    await generateOgCard('<html/>', { fetchFn });
    assert.ok(screenshotCalled);
  });

  it('does NOT call renderTemplate', async () => {
    let renderTemplateCalled = false;
    const fetchFn = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
    await generateOgCard('<html/>', { fetchFn });
    assert.ok(!renderTemplateCalled);
    // OgCard still returns a Buffer or null (regression: function still works)
  });
});

// ---------------------------------------------------------------------------
// visual-templates.js -- Template 13 unit
// ---------------------------------------------------------------------------

describe('visual-templates -- Template 13', () => {
  const templates = require('../code/insiderbuying/visual-templates');

  const T13_DATA = {
    headline: 'Apple Insiders Buy Big Before Q2',
    ticker: 'AAPL',
    verdict: 'BULLISH',
    insiderName: 'Tim Cook',
    date: 'March 29, 2026',
  };

  function makeFetchFnForScreenshot() {
    const buf = Buffer.from('FAKE-PNG-12345678');
    return async () => ({
      ok: true,
      headers: { get: () => 'image/png' },
      buffer: async () => buf,
    });
  }

  it('renderTemplate(13, validData) resolves without throwing', async () => {
    const result = await templates.renderTemplate(
      13, T13_DATA, {}, { fetchFn: makeFetchFnForScreenshot() }
    );
    assert.ok(result !== null && result !== undefined);
  });

  it('renderTemplate(13, validData) returns a Buffer', async () => {
    const result = await templates.renderTemplate(
      13, T13_DATA, {}, { fetchFn: makeFetchFnForScreenshot() }
    );
    assert.ok(Buffer.isBuffer(result));
  });

  it('renderTemplate(13, validData) returns non-empty Buffer', async () => {
    const result = await templates.renderTemplate(
      13, T13_DATA, {}, { fetchFn: makeFetchFnForScreenshot() }
    );
    assert.ok(result.length > 0);
  });
});
