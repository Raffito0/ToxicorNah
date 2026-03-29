diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/02-article-pipeline.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/02-article-pipeline.test.js
new file mode 100644
index 0000000..643ce85
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/e2e/02-article-pipeline.test.js
@@ -0,0 +1,226 @@
+'use strict';
+
+const { makeRouter, makeFetch, makeNoSleep, BASE_ENV } = require('./helpers');
+
+const {
+  pickKeyword,
+  lockKeyword,
+  generateArticleOutline,
+  qualityGate,
+  writeArticle,
+  checkContentFreshness,
+  BANNED_PHRASES,
+} = require('../../../n8n/code/insiderbuying/generate-article');
+
+// ---------------------------------------------------------------------------
+// Shared helpers
+// ---------------------------------------------------------------------------
+
+function makeNocodbOpts(fetchFn) {
+  return {
+    fetchFn,
+    baseUrl: BASE_ENV.NOCODB_BASE_URL,
+    token: BASE_ENV.NOCODB_API_TOKEN,
+  };
+}
+
+// Keyword fixture — matches SAMPLE_KEYWORD shape used in generate-article.test.js
+const MOCK_KEYWORD = {
+  id: 42,
+  keyword: 'NVDA insider buying',
+  ticker: 'NVDA',
+  article_type: 'A',
+  status: 'new',
+  priority_score: 100,
+  blog: 'earlyinsider',
+};
+
+// Outline that passes validateOutline for ticker 'NVDA'
+const OUTLINE_OBJ = {
+  headline: 'NVDA Insider Buying: CEO Jensen Huang Signals Strong Conviction',
+  sections: [
+    { h2: 'Why This NVDA Insider Buying Matters', h3s: ['Signal Strength', 'Context'] },
+    { h2: 'Financial Data Behind the NVDA Signal', h3s: [] },
+    { h2: 'Historical Track Record Analysis', h3s: [] },
+    { h2: 'Risk Factors to Consider', h3s: [] },
+    { h2: 'NVDA Investment Thesis and Conclusion', h3s: [] },
+  ],
+  tldr: ['CEO purchased 50,000 shares worth $5M', 'Signal rates 8.4/10 conviction'],
+  required_data_points: ['transaction value', 'share count', 'price per share'],
+};
+
+// Claude text-response body: content[0].text is the JSON outline string
+const OUTLINE_CLAUDE_BODY = {
+  content: [{ type: 'text', text: JSON.stringify(OUTLINE_OBJ) }],
+  usage: { input_tokens: 300, output_tokens: 100 },
+};
+
+// ---------------------------------------------------------------------------
+// Tests
+// ---------------------------------------------------------------------------
+
+describe('Article Pipeline E2E (Chain 2)', () => {
+
+  // -------------------------------------------------------------------------
+  // Test 2.1 — pickKeyword → lockKeyword → generateArticleOutline → writeArticle
+  // -------------------------------------------------------------------------
+  describe('Test 2.1 - keyword → outline → write integration', () => {
+    it('locks keyword, generates outline containing ticker, and writes article to NocoDB', async () => {
+      // -- Stage 1: pickKeyword from NocoDB --
+      const pickFetchFn = makeRouter({
+        'Keywords': { list: [MOCK_KEYWORD] },
+      });
+      const nocodbPickOpts = makeNocodbOpts(pickFetchFn);
+      const keyword = await pickKeyword(MOCK_KEYWORD.blog, nocodbPickOpts);
+
+      expect(keyword).not.toBeNull();
+      expect(keyword.ticker).toBe('NVDA');
+      expect(keyword.id).toBe(42);
+      expect(pickFetchFn.mock.calls.length).toBe(1);
+
+      // -- Stage 2: lockKeyword via NocoDB PATCH --
+      const lockFetchFn = makeFetch({ id: keyword.id, status: 'in_progress' });
+      const nocodbLockOpts = makeNocodbOpts(lockFetchFn);
+      await lockKeyword(keyword.id, nocodbLockOpts);
+
+      expect(lockFetchFn.mock.calls.length).toBe(1);
+      const lockCallArgs = lockFetchFn.mock.calls[0];
+      expect(lockCallArgs[1].method).toBe('PATCH');
+      const lockBody = JSON.parse(lockCallArgs[1].body);
+      expect(lockBody.status).toBe('in_progress');
+
+      // -- Stage 3: generateArticleOutline (Claude text call) --
+      const claudeFetchFn = makeFetch(OUTLINE_CLAUDE_BODY);
+      const outline = await generateArticleOutline(
+        keyword.ticker,
+        keyword.article_type,
+        {}, // dexterData
+        claudeFetchFn,
+        'test-anthropic-key',
+      );
+
+      expect(outline).not.toBeNull();
+      expect(outline.headline).toMatch(/NVDA/i);
+      expect(Array.isArray(outline.sections)).toBe(true);
+      expect(outline.sections.length).toBeGreaterThanOrEqual(5);
+      // Claude API was called (POST to anthropic.com)
+      expect(claudeFetchFn.mock.calls.length).toBeGreaterThanOrEqual(1);
+      const outlineCall = claudeFetchFn.mock.calls[0];
+      expect(outlineCall[1].method).toBe('POST');
+
+      // -- Stage 4: writeArticle to NocoDB --
+      const writeFetchFn = makeFetch({ id: 99, status: 'enriching' });
+      const nocodbWriteOpts = makeNocodbOpts(writeFetchFn);
+      const articleToWrite = {
+        slug: 'nvda-insider-buying-ceo-2026',
+        title: 'NVDA CEO Buys $5M: What Insiders Know Now',
+        meta_description: 'NVDA insider buying signals strong conviction.',
+        body_html: '<p>Article body.</p>',
+        verdict_type: 'BUY',
+        verdict_text: 'Buy NVDA below $110 targeting 25% upside.',
+        key_takeaways: ['CEO bought 50K shares at $100'],
+        word_count: 2000,
+        primary_keyword: MOCK_KEYWORD.keyword,
+      };
+      await writeArticle(articleToWrite, keyword, nocodbWriteOpts);
+
+      expect(writeFetchFn.mock.calls.length).toBe(1);
+      const writeCallArgs = writeFetchFn.mock.calls[0];
+      expect(writeCallArgs[1].method).toBe('POST');
+      const writeBody = JSON.parse(writeCallArgs[1].body);
+      expect(writeBody.slug).toBe(articleToWrite.slug);
+      expect(writeBody.verdict_type).toBe('BUY');
+    });
+  });
+
+  // -------------------------------------------------------------------------
+  // Test 2.2 — Quality gate fail with banned phrase; error usable in retry prompt
+  // -------------------------------------------------------------------------
+  describe('Test 2.2 - quality gate error surfaces banned phrase', () => {
+    it('returns valid:false with a descriptive error string containing the banned phrase', () => {
+      const bannedPhrase = BANNED_PHRASES[0]; // e.g. "it's worth noting"
+
+      const failingArticle = {
+        title: 'A'.repeat(60),
+        meta_description: 'B'.repeat(147),
+        key_takeaways: ['Buy signal 1', 'Signal 2 at $100', 'Signal 3 returns 20%'],
+        verdict_type: 'BUY',
+        verdict_text: 'Buy at $100 target',
+        body_html: `<p>${bannedPhrase} This article tests the quality gate validation system.</p>`,
+      };
+
+      const result = qualityGate(failingArticle, {
+        primaryKeyword: 'NVDA insider buying',
+        daysSinceFiling: 5,
+      });
+
+      expect(result.valid).toBe(false);
+      expect(Array.isArray(result.errors)).toBe(true);
+      expect(result.errors.length).toBeGreaterThan(0);
+
+      // Banned phrase error is present and contains the exact phrase
+      const bannedError = result.errors.find((e) => e.includes('Banned phrase'));
+      expect(bannedError).toBeTruthy();
+      expect(bannedError).toContain(bannedPhrase);
+
+      // All errors are strings — they can be concatenated into a Claude retry prompt
+      for (const err of result.errors) {
+        expect(typeof err).toBe('string');
+        expect(err.length).toBeGreaterThan(0);
+      }
+    });
+
+    it('quality gate errors provide enough information to construct a retry prompt', () => {
+      // Simulate the retry pattern: collect errors[0] and pass it to the next Claude call
+      const article = {
+        title: 'X'.repeat(50), // wrong length — below 55 chars
+        meta_description: 'M'.repeat(147),
+        key_takeaways: ['Item with 1 number', 'Item with 2', 'Three items'],
+        verdict_type: 'BUY',
+        verdict_text: 'Buy at $100',
+        body_html: '<p>Short body.</p>',
+      };
+
+      const result = qualityGate(article, { primaryKeyword: 'NVDA', daysSinceFiling: 2 });
+
+      expect(result.valid).toBe(false);
+      // errors can be joined and sent as a retry prompt
+      const retryPromptFeedback = result.errors.join('; ');
+      expect(retryPromptFeedback.length).toBeGreaterThan(10);
+      // Title error is present and mentions the actual length
+      expect(retryPromptFeedback).toMatch(/title/i);
+    });
+  });
+
+  // -------------------------------------------------------------------------
+  // Test 2.3 — Freshness check returns contrarian type for duplicate ticker
+  // -------------------------------------------------------------------------
+  describe('Test 2.3 - freshness check redirects article type', () => {
+    it('returns contrarian effectiveArticleType when recent article exists for ticker', async () => {
+      // NocoDB returns a recent NVDA article (2026-02-20 = 9 days before frozen date 2026-03-01)
+      const recentArticle = { ticker: 'NVDA', published_at: '2026-02-20T10:00:00Z' };
+      const freshnessFetchFn = makeFetch({ list: [recentArticle] });
+
+      const nocodbOpts = makeNocodbOpts(freshnessFetchFn);
+      const freshness = await checkContentFreshness('NVDA', nocodbOpts);
+
+      expect(freshness.fresh).toBe(false);
+      expect(freshness.effectiveArticleType).toBe('contrarian');
+      expect(freshness.effectiveArticleType).not.toBe('insider_buying');
+      expect(typeof freshness.lastPublished).toBe('string');
+      // NocoDB was queried exactly once
+      expect(freshnessFetchFn.mock.calls.length).toBe(1);
+    });
+
+    it('returns insider_buying effectiveArticleType when no recent article exists', async () => {
+      // NocoDB returns empty list — no recent articles for this ticker
+      const freshnessFetchFn = makeFetch({ list: [] });
+      const nocodbOpts = makeNocodbOpts(freshnessFetchFn);
+      const freshness = await checkContentFreshness('TSLA', nocodbOpts);
+
+      expect(freshness.fresh).toBe(true);
+      expect(freshness.effectiveArticleType).toBe('insider_buying');
+    });
+  });
+
+});
