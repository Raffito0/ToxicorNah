'use strict';

const {
  seoScore,
  aiDetectionScore,
  BANNED_PHRASES,
  AI_SIGNAL_WORDS,
} = require('../../n8n/code/insiderbuying/generate-article');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeArticle(overrides = {}) {
  const defaultBody = `
    <h2>NVDA Revenue Growth Accelerates in Q4 2026</h2>
    <p>NVIDIA reported $38.2 billion in revenue for Q4 2026, a 78% increase year-over-year.
    The data center segment contributed $30.8 billion, representing 80.6% of total revenue.</p>
    <p>Gross margins expanded to 73.5%, up from 66.1% in the prior year quarter.
    Operating income reached $22.1 billion, a 95% jump from $11.3 billion a year ago.</p>
    <h2>Insider Buying Activity Signals Confidence</h2>
    <p>Three NVDA directors purchased a combined $4.2 million in shares during January 2026.
    The average purchase price of $142.50 sits 12% below the current $159.80 trading price.</p>
    <p>CFO Colette Kress sold $8.1 million under a 10b5-1 plan in December, representing
    less than 2% of her total holdings. This scheduled sale follows a consistent pattern.</p>
    <h2>Valuation Remains Stretched but Supported</h2>
    <p>At 45x forward earnings, NVDA trades at a 35% premium to the semiconductor sector median.
    However, the PEG ratio of 1.2 suggests growth justifies the premium.</p>
    <h3>Key Metrics Comparison</h3>
    <p>Revenue growth of 78% dwarfs AMD's 24% and Intel's -8% in the same period.
    Free cash flow of $18.5 billion gives NVDA a 48.4% FCF margin.</p>
    <p>The stock has returned 215% over 12 months. The <a href="/blog/nvda-q3-analysis">Q3 analysis</a>
    predicted this trajectory. See also our <a href="/blog/semiconductor-outlook">sector outlook</a>
    and <a href="/blog/insider-buying-guide">insider buying guide</a> for context.</p>
  `.trim();

  return {
    title: overrides.title || 'NVDA Insider Buying Surges as Revenue Hits $38.2B Record',
    meta_description: overrides.meta_description || 'NVIDIA insiders bought $4.2M in shares as Q4 revenue hit $38.2B. Analysis of insider patterns, valuation, and what it means for investors.',
    slug: overrides.slug || 'nvda-insider-buying-q4-2026',
    body_html: overrides.body_html || defaultBody,
    key_takeaways: overrides.key_takeaways || ['Revenue hit $38.2B, up 78% YoY', 'Insiders bought $4.2M in January', 'Valuation at 45x forward earnings'],
    verdict_type: overrides.verdict_type || 'BUY',
    verdict_text: overrides.verdict_text || 'Buy below $165 with 12-month target of $200',
    word_count: overrides.word_count || 250,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('SEO Score (step 8.7)', () => {

  test('well-optimized article scores >= 70', () => {
    const article = makeArticle();
    const result = seoScore(article, 'NVDA insider buying');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.pass).toBe(true);
  });

  test('breakdown has all expected categories', () => {
    const result = seoScore(makeArticle(), 'NVDA insider buying');
    expect(result.breakdown).toHaveProperty('keywordDensity');
    expect(result.breakdown).toHaveProperty('headingStructure');
    expect(result.breakdown).toHaveProperty('internalLinks');
    expect(result.breakdown).toHaveProperty('readability');
    expect(result.breakdown).toHaveProperty('metaCompleteness');
    expect(result.breakdown).toHaveProperty('contentLength');
  });

  test('article with no headings scores lower on heading structure', () => {
    const article = makeArticle({ body_html: '<p>Just a paragraph with NVDA data showing 78% growth.</p>' });
    const result = seoScore(article, 'NVDA');
    expect(result.breakdown.headingStructure).toBeLessThan(10);
  });

  test('article with no internal links scores 0 on links', () => {
    const article = makeArticle({
      body_html: '<h2>NVDA Analysis</h2><p>Revenue hit $38.2B in Q4 2026, an NVDA record.</p>',
    });
    const result = seoScore(article, 'NVDA');
    expect(result.breakdown.internalLinks).toBe(0);
  });

  test('article with 3+ internal links scores full points', () => {
    const article = makeArticle(); // default body has 3 internal links
    const result = seoScore(article, 'NVDA');
    expect(result.breakdown.internalLinks).toBe(10);
  });

  test('keyword density rewards 1-2.5% range', () => {
    // Build body with controlled keyword density
    const sentences = [];
    for (let i = 0; i < 50; i++) {
      if (i % 7 === 0) {
        sentences.push('<p>The NVDA stock price rose 12% this quarter.</p>');
      } else {
        sentences.push('<p>Revenue growth of 78% exceeded analyst estimates by $2.1 billion.</p>');
      }
    }
    const article = makeArticle({ body_html: '<h2>NVDA Analysis</h2>' + sentences.join('') });
    const result = seoScore(article, 'NVDA stock');
    expect(result.breakdown.keywordDensity).toBeGreaterThanOrEqual(5);
  });

  test('meta completeness awards points for title/meta/slug', () => {
    const article = makeArticle();
    const result = seoScore(article, 'NVDA');
    expect(result.breakdown.metaCompleteness).toBeGreaterThanOrEqual(10);
  });

  test('empty article scores very low', () => {
    const article = makeArticle({ body_html: '', title: '', meta_description: '', slug: '' });
    const result = seoScore(article, 'NVDA');
    expect(result.score).toBeLessThan(30);
    expect(result.pass).toBe(false);
  });

  test('pass=false blocks publishing (score < 70 is a hard gate)', () => {
    // Verify the contract: pass is strictly boolean based on >= 70
    const low = seoScore(makeArticle({ body_html: '<p>short</p>', title: 'x', meta_description: 'x', slug: '' }), 'test');
    expect(low.pass).toBe(false);
    expect(low.score).toBeLessThan(70);

    const high = seoScore(makeArticle(), 'NVDA insider buying');
    expect(high.pass).toBe(true);
    expect(high.score).toBeGreaterThanOrEqual(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AI Detection Score (step 8.8)', () => {

  test('well-written finance article scores <= 40 (passes)', () => {
    const article = makeArticle();
    const result = aiDetectionScore(article);
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.pass).toBe(true);
  });

  test('article stuffed with AI vocabulary scores high', () => {
    const aiBody = `
      <h2>Comprehensive Analysis</h2>
      <p>Additionally, this comprehensive analysis delves into the intricate interplay
      of market forces. The pivotal shift underscores the crucial role of fostering
      innovation. Furthermore, the robust landscape showcases noteworthy developments.</p>
      <p>Moreover, the nuanced tapestry of financial metrics highlights the multifaceted
      nature of this groundbreaking paradigm. The meticulous approach garnered attention
      while emphasizing the vibrant ecosystem and enhancing overall outcomes.</p>
      <p>Additionally, the comprehensive framework fosters alignment and showcases
      the intricate dynamics. Furthermore, the pivotal developments underscore the
      crucial importance of delving into these nuanced territories.</p>
    `;
    const article = makeArticle({ body_html: aiBody });
    const result = aiDetectionScore(article);
    expect(result.score).toBeGreaterThan(40);
    expect(result.pass).toBe(false);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  test('detects uniform sentence lengths', () => {
    // AI pattern: all sentences roughly same length
    const uniformBody = Array(10).fill(
      '<p>The company reported strong results. Revenue growth was quite solid. Margins expanded by twelve percent. The outlook remains fairly positive.</p>'
    ).join('');
    const article = makeArticle({ body_html: uniformBody });
    const result = aiDetectionScore(article);
    // Should detect uniformity
    expect(result.signals.some(s => s.includes('uniform') || s.includes('repetition'))).toBe(true);
  });

  test('detects em dash overuse', () => {
    const dashBody = `
      <p>The company\u2014which reported earnings\u2014beat estimates by a wide margin\u2014surprising analysts.
      Revenue\u2014up 45%\u2014drove the gains. Margins\u2014at 73%\u2014exceeded forecasts.
      The CEO\u2014speaking on the call\u2014mentioned expansion\u2014into new markets\u2014next quarter.</p>
    `;
    const article = makeArticle({ body_html: dashBody });
    const result = aiDetectionScore(article);
    expect(result.signals.some(s => s.includes('dash'))).toBe(true);
  });

  test('detects negative parallelism', () => {
    const body = `
      <p>It's not just about the revenue growth; it's about the margin expansion.</p>
      <p>Not only did insiders buy shares, but they also increased their positions significantly.</p>
    `;
    const article = makeArticle({ body_html: body });
    const result = aiDetectionScore(article);
    expect(result.signals.some(s => s.includes('parallelism'))).toBe(true);
  });

  test('empty body returns score 0 and passes', () => {
    const article = makeArticle({ body_html: '' });
    const result = aiDetectionScore(article);
    expect(result.score).toBe(0);
    expect(result.pass).toBe(true);
  });

  test('pass=false blocks publishing (score > 40 is a hard gate)', () => {
    // Heavily AI-saturated text with uniform sentences and repeated openers
    const aiBody = `
      <p>Additionally, this comprehensive analysis delves into the intricate interplay of market forces. The pivotal shift underscores the crucial role of fostering innovation. Furthermore, the robust landscape showcases noteworthy developments.</p>
      <p>The nuanced tapestry of financial metrics highlights the multifaceted nature of this groundbreaking paradigm. The meticulous approach garnered attention while emphasizing the vibrant ecosystem and enhancing overall outcomes.</p>
      <p>The comprehensive framework fosters alignment and showcases the intricate dynamics. The pivotal developments underscore the crucial importance of delving into nuanced territories.</p>
      <p>The robust analysis additionally reveals comprehensive patterns. The noteworthy findings furthermore demonstrate pivotal insights. The crucial data moreover highlights enhanced understanding.</p>
      <p>The landscape of opportunities showcases vibrant potential. The testament to innovation underscores multifaceted growth. The paradigm of excellence fosters comprehensive development.</p>
      <p>The intricate interplay of factors furthermore garners attention. The comprehensive tapestry of results additionally demonstrates pivotal achievements. The crucial framework moreover highlights robust outcomes.</p>
    `;
    const result = aiDetectionScore(makeArticle({ body_html: aiBody }));
    expect(result.pass).toBe(false);
    expect(result.score).toBeGreaterThan(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Expanded BANNED_PHRASES', () => {

  test('contains original phrases', () => {
    expect(BANNED_PHRASES).toContain("it's worth noting");
    expect(BANNED_PHRASES).toContain("let's dive in");
    expect(BANNED_PHRASES).toContain("that being said");
  });

  test('contains Humanizer significance inflation phrases', () => {
    expect(BANNED_PHRASES).toContain("pivotal moment");
    expect(BANNED_PHRASES).toContain("is a testament");
    expect(BANNED_PHRASES).toContain("enduring legacy");
  });

  test('contains Humanizer AI vocabulary', () => {
    expect(BANNED_PHRASES).toContain("delve");
    expect(BANNED_PHRASES).toContain("tapestry");
    expect(BANNED_PHRASES).toContain("interplay");
  });

  test('contains Humanizer promotional language', () => {
    expect(BANNED_PHRASES).toContain("vibrant");
    expect(BANNED_PHRASES).toContain("groundbreaking");
    expect(BANNED_PHRASES).toContain("nestled");
  });

  test('contains Humanizer chat artifacts', () => {
    expect(BANNED_PHRASES).toContain("i hope this helps");
    expect(BANNED_PHRASES).toContain("great question");
  });

  test('contains Humanizer filler phrases', () => {
    expect(BANNED_PHRASES).toContain("in order to");
    expect(BANNED_PHRASES).toContain("due to the fact that");
  });

  test('has significantly more phrases than original 24', () => {
    expect(BANNED_PHRASES.length).toBeGreaterThan(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AI_SIGNAL_WORDS', () => {

  test('contains high-frequency AI words', () => {
    expect(AI_SIGNAL_WORDS).toContain('additionally');
    expect(AI_SIGNAL_WORDS).toContain('delve');
    expect(AI_SIGNAL_WORDS).toContain('crucial');
    expect(AI_SIGNAL_WORDS).toContain('landscape');
    expect(AI_SIGNAL_WORDS).toContain('testament');
  });

  test('has at least 30 signal words', () => {
    expect(AI_SIGNAL_WORDS.length).toBeGreaterThanOrEqual(30);
  });
});
