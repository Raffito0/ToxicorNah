const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  rankRelatedArticles,
  injectLinks,
  buildRelatedArticlesJson,
  MAX_OUTBOUND_LINKS,
  MAX_INBOUND_LINKS_PER_ARTICLE,
} = require('../code/insiderbuying/cross-link.js');

// ---------------------------------------------------------------------------
// Related Articles Ranking
// ---------------------------------------------------------------------------
describe('rankRelatedArticles', () => {
  const candidates = [
    { id: 1, ticker: 'MSFT', sector: 'Technology', blog: 'insiderbuying', slug: 'msft-earnings', published_at: '2026-03-20' },
    { id: 2, ticker: 'NVDA', sector: 'Technology', blog: 'insiderbuying', slug: 'nvda-insider', published_at: '2026-03-15' },
    { id: 3, ticker: 'NVDA', sector: 'Technology', blog: 'insiderbuying', slug: 'nvda-valuation', published_at: '2026-03-10' },
    { id: 4, ticker: 'AAPL', sector: 'Technology', blog: 'insiderbuying', slug: 'aapl-dividend', published_at: '2026-02-01' },
    { id: 5, ticker: 'JPM', sector: 'Financials', blog: 'insiderbuying', slug: 'jpm-earnings', published_at: '2026-03-25' },
    { id: 6, ticker: 'GOOG', sector: 'Technology', blog: 'deepstockanalysis', slug: 'goog-analysis', published_at: '2026-03-22' },
  ];

  it('same ticker articles ranked first', () => {
    const result = rankRelatedArticles(candidates, { id: 99, ticker: 'NVDA', sector: 'Technology', blog: 'insiderbuying' });
    assert.equal(result[0].ticker, 'NVDA');
    assert.equal(result[1].ticker, 'NVDA');
  });

  it('filters to same blog only', () => {
    const result = rankRelatedArticles(candidates, { id: 99, ticker: 'GOOG', sector: 'Technology', blog: 'insiderbuying' });
    assert.ok(result.every(r => r.blog === 'insiderbuying'));
  });

  it('max 5 results', () => {
    const result = rankRelatedArticles(candidates, { id: 99, ticker: 'NVDA', sector: 'Technology', blog: 'insiderbuying' });
    assert.ok(result.length <= 5);
  });

  it('excludes the article itself', () => {
    const result = rankRelatedArticles(candidates, { id: 2, ticker: 'NVDA', sector: 'Technology', blog: 'insiderbuying' });
    assert.ok(!result.some(r => r.id === 2));
  });

  it('no related articles returns empty array', () => {
    const result = rankRelatedArticles([], { id: 99, ticker: 'ZZZ', sector: 'Foo', blog: 'insiderbuying' });
    assert.deepStrictEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// Cheerio Link Injection
// ---------------------------------------------------------------------------
describe('injectLinks', () => {
  it('inserts anchor tag around matching phrase in text node', () => {
    const html = '<p>NVIDIA posted record earnings in Q1 2026 results.</p>';
    const targets = [{ slug: 'nvda-earnings', matchPhrases: ['record earnings in Q1'] }];
    const result = injectLinks(html, targets, MAX_OUTBOUND_LINKS);
    assert.ok(result.html.includes('<a href="/blog/nvda-earnings">record earnings in Q1</a>'));
  });

  it('does NOT inject inside existing <a> tag', () => {
    const html = '<p>See <a href="/other">NVIDIA record earnings report</a> here.</p>';
    const targets = [{ slug: 'nvda-earnings', matchPhrases: ['NVIDIA record earnings report'] }];
    const result = injectLinks(html, targets, MAX_OUTBOUND_LINKS);
    // Should not have a nested link
    assert.ok(!result.html.includes('<a href="/blog/nvda-earnings">'));
  });

  it('does NOT inject inside <h2> tags', () => {
    const html = '<h2>NVIDIA record earnings analysis report</h2><p>Some other text here now.</p>';
    const targets = [{ slug: 'nvda-earnings', matchPhrases: ['record earnings analysis report'] }];
    const result = injectLinks(html, targets, MAX_OUTBOUND_LINKS);
    assert.ok(!result.html.includes('<h2><a') && !result.html.includes('</a></h2>'));
    assert.ok(result.html.includes('<h2>NVIDIA record earnings analysis report</h2>'));
  });

  it('does NOT inject inside verdict section', () => {
    const html = '<p>Some text.</p><p class="verdict">NVIDIA record earnings are strong indeed.</p>';
    const targets = [{ slug: 'nvda-earnings', matchPhrases: ['record earnings are strong'] }];
    const result = injectLinks(html, targets, MAX_OUTBOUND_LINKS);
    assert.ok(result.html.includes('class="verdict">NVIDIA record earnings are strong'));
  });

  it('max 3 outbound links enforced', () => {
    const html = '<p>Alpha beta gamma one. Delta epsilon zeta two. Theta iota kappa three. Lambda mu nu four.</p>';
    const targets = [
      { slug: 'a', matchPhrases: ['Alpha beta gamma'] },
      { slug: 'b', matchPhrases: ['Delta epsilon zeta'] },
      { slug: 'c', matchPhrases: ['Theta iota kappa'] },
      { slug: 'd', matchPhrases: ['Lambda mu nu'] },
    ];
    const result = injectLinks(html, targets, 3);
    assert.equal(result.linksAdded, 3);
  });

  it('idempotent: re-running on already-linked article does not create duplicates', () => {
    const html = '<p>See <a href="/blog/nvda-earnings">NVIDIA record earnings report</a> here. Also NVIDIA quarterly results summary.</p>';
    const targets = [{ slug: 'nvda-earnings', matchPhrases: ['NVIDIA record earnings report', 'NVIDIA quarterly results summary'] }];
    const result = injectLinks(html, targets, MAX_OUTBOUND_LINKS);
    const matches = result.html.match(/href="\/blog\/nvda-earnings"/g) || [];
    assert.equal(matches.length, 1);
  });

  it('anchor text 3-8 words enforced', () => {
    const html = '<p>A B is here. Also this is a phrase with many words that should not be linked.</p>';
    const targets = [
      { slug: 'short', matchPhrases: ['A B'] },  // 2 words - too short
      { slug: 'long', matchPhrases: ['this is a phrase with many words that should not'] }, // 10 words - too long
    ];
    const result = injectLinks(html, targets, MAX_OUTBOUND_LINKS);
    assert.equal(result.linksAdded, 0);
  });
});

// ---------------------------------------------------------------------------
// Related Articles JSON
// ---------------------------------------------------------------------------
describe('buildRelatedArticlesJson', () => {
  it('returns array with id, slug, title, verdict_type, meta_description', () => {
    const articles = [
      { id: 1, slug: 'test', title_text: 'Test Article', verdict_type: 'BUY', meta_description: 'A test.' },
    ];
    const json = buildRelatedArticlesJson(articles);
    assert.equal(json.length, 1);
    assert.equal(json[0].id, 1);
    assert.equal(json[0].slug, 'test');
    assert.equal(json[0].title, 'Test Article');
    assert.equal(json[0].verdict_type, 'BUY');
  });

  it('max 4 articles in related section', () => {
    const articles = Array.from({ length: 6 }, (_, i) => ({
      id: i, slug: `s-${i}`, title_text: `T${i}`, verdict_type: 'BUY', meta_description: 'X',
    }));
    const json = buildRelatedArticlesJson(articles);
    assert.equal(json.length, 4);
  });

  it('empty input returns empty array', () => {
    assert.deepStrictEqual(buildRelatedArticlesJson([]), []);
    assert.deepStrictEqual(buildRelatedArticlesJson(null), []);
  });
});
