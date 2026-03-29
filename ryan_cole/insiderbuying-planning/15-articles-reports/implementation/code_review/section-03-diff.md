diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-article.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-article.js
index 9d41646..2cf6c0e 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-article.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-article.js
@@ -1165,6 +1165,13 @@ async function generateArticle(input, helpers) {
     }
   }
 
+  // Step 2.5: Content freshness check (before outline generation)
+  const freshness = await checkContentFreshness(ticker || keyword.ticker || '', nocodbOpts);
+  const effectiveArticleType = freshness.effectiveArticleType;
+  if (!freshness.fresh) {
+    console.log(`[generate-article] ${ticker}: recent article found (${freshness.lastPublished}), using contrarian angle`);
+  }
+
   // Step 3: Call Dexter (via webhook)
   let dexterData = {};
   if (env.DEXTER_WEBHOOK_URL && fetchFn) {
@@ -1308,6 +1315,21 @@ async function generateArticle(input, helpers) {
     retryFeedback = allFailures.join('; ');
   }
 
+  // Step 8.5: Visual placeholder replacement
+  const r2Env = {
+    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
+    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
+    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
+    R2_PUBLIC_URL: env.R2_PUBLIC_URL,
+  };
+  article = await replaceVisualPlaceholders(article, dexterData, fetchFn, r2Env);
+
+  // Step 8.55: Append Schema.org JSON-LD
+  article.body_html = article.body_html + '\n' + generateSchema({
+    ...article,
+    published_at: new Date().toISOString(),
+  });
+
   // Step 8.6: Ensure unique slug
   const existingSlugsRes = await nocodbGet(
     `/Articles?fields=slug&where=(slug,like,${article.slug}%)`,
@@ -1353,6 +1375,181 @@ async function generateArticle(input, helpers) {
   return { status: 'published', article_id: articleId, slug: article.slug };
 }
 
+// ---------------------------------------------------------------------------
+// Section 03 — Schema.org JSON-LD
+// ---------------------------------------------------------------------------
+
+/**
+ * Build a Schema.org JSON-LD <script> block for the article.
+ * @param {Object} article
+ * @returns {string}
+ */
+function generateSchema(article) {
+  const schemaObj = {
+    '@context': 'https://schema.org',
+    '@graph': [
+      {
+        '@type': 'Article',
+        'name': article.title || '',
+        'headline': article.title || '',
+        'description': article.meta_description || '',
+        'datePublished': article.published_at || new Date().toISOString(),
+        'dateModified': article.published_at || new Date().toISOString(),
+        'author': { '@id': '#ryan-chen' },
+        'url': `https://earlyinsider.com/articles/${article.slug || ''}`,
+      },
+      {
+        '@id': '#ryan-chen',
+        '@type': 'Person',
+        'name': 'Ryan Chen',
+        'jobTitle': 'Independent Finance Analyst',
+        'description': 'Former Goldman Sachs equity research analyst covering technology and financial services sectors.',
+      },
+      {
+        '@type': 'FinancialProduct',
+        'name': 'EarlyInsider Insider Intelligence Alerts',
+        'description': 'Real-time insider transaction alerts and analysis for retail investors.',
+        'url': 'https://earlyinsider.com/alerts',
+      },
+    ],
+  };
+  return `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`;
+}
+
+// ---------------------------------------------------------------------------
+// Section 03 — Content Freshness Check
+// ---------------------------------------------------------------------------
+
+/**
+ * Check if an article for this ticker was published in the last 30 days.
+ * @param {string} ticker
+ * @param {Object} nocodbOpts - { token, baseUrl, fetchFn }
+ * @returns {Promise<{ fresh: boolean, effectiveArticleType: string, lastPublished?: string }>}
+ */
+async function checkContentFreshness(ticker, nocodbOpts) {
+  try {
+    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
+    const where = `(ticker,eq,${ticker})~and(published_at,gt,${thirtyDaysAgo})`;
+    const path = `/Articles?where=${encodeURIComponent(where)}&limit=1`;
+    const result = await nocodbGet(path, nocodbOpts.token, nocodbOpts);
+    const records = (result && result.list) ? result.list : [];
+    if (records.length === 0) {
+      return { fresh: true, effectiveArticleType: 'insider_buying' };
+    }
+    return { fresh: false, effectiveArticleType: 'contrarian', lastPublished: records[0].published_at };
+  } catch (e) {
+    // Safe default: treat as fresh so generation proceeds
+    return { fresh: true, effectiveArticleType: 'insider_buying' };
+  }
+}
+
+// ---------------------------------------------------------------------------
+// Section 03 — R2 Chart Upload
+// ---------------------------------------------------------------------------
+
+/**
+ * Upload a PNG chart buffer to Cloudflare R2.
+ * @param {Buffer} buffer - PNG image data
+ * @param {string} key - R2 object key, e.g. "charts/aapl-4-1711234567.png"
+ * @param {Function} fetchFn
+ * @param {Object} env - { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL }
+ * @returns {Promise<string>} Public R2 URL
+ */
+async function uploadChart(buffer, key, fetchFn, env) {
+  const crypto = require('crypto');
+  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
+  const url = `https://${host}/${key}`;
+  const now = new Date();
+  const dateStr = now.toISOString().replace(/[:-]/g, '').replace(/\.\d+/, '');
+  const dateDay = dateStr.slice(0, 8);
+  const region = 'auto';
+  const service = 's3';
+  const scope = `${dateDay}/${region}/${service}/aws4_request`;
+
+  const payloadHash = crypto.createHash('sha256').update(buffer).digest('hex');
+  const canonicalHeaders = [
+    'content-type:image/png',
+    `host:${host}`,
+    `x-amz-content-sha256:${payloadHash}`,
+    `x-amz-date:${dateStr}`,
+  ].join('\n');
+  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
+  const canonicalRequest = ['PUT', `/${key}`, '', canonicalHeaders, '', signedHeaders, payloadHash].join('\n');
+  const stringToSign = ['AWS4-HMAC-SHA256', dateStr, scope,
+    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
+
+  function hmac(k, d) { return crypto.createHmac('sha256', k).update(d).digest(); }
+  const kDate = hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, dateDay);
+  const kRegion = hmac(kDate, region);
+  const kService = hmac(kRegion, service);
+  const kSigning = hmac(kService, 'aws4_request');
+  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
+  const authorization = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
+
+  const res = await fetchFn(url, {
+    method: 'PUT',
+    headers: {
+      'Content-Type': 'image/png',
+      'Host': host,
+      'x-amz-content-sha256': payloadHash,
+      'x-amz-date': dateStr,
+      'Authorization': authorization,
+    },
+    body: buffer,
+  });
+  if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);
+  return `${env.R2_PUBLIC_URL}/${key}`;
+}
+
+// ---------------------------------------------------------------------------
+// Section 03 — Visual Placeholder Replacement
+// ---------------------------------------------------------------------------
+
+const VISUAL_TEMPLATE_MAP = {
+  '{{VISUAL_1}}': { templateId: 4, description: 'Insider Transaction Table' },
+  '{{VISUAL_2}}': { templateId: 5, description: 'Price Chart with buy marker' },
+  '{{VISUAL_3}}': { templateId: 6, description: 'Revenue Trend' },
+};
+
+/**
+ * Replace {{VISUAL_N}} tokens with real chart <img> tags.
+ * @param {Object} article - Article object with body_html
+ * @param {Object} filingData - Insider filing data for chart generation
+ * @param {Function} fetchFn
+ * @param {Object} env - R2 credentials
+ * @param {Object} [templates] - { renderTemplate(templateId, data): Promise<Buffer> }
+ * @returns {Promise<Object>} Updated article object
+ */
+async function replaceVisualPlaceholders(article, filingData, fetchFn, env, templates) {
+  const ticker = (article.primary_keyword || article.slug || 'unknown').split('-')[0].toLowerCase();
+  const ts = Date.now();
+
+  for (const [token, meta] of Object.entries(VISUAL_TEMPLATE_MAP)) {
+    if (!article.body_html.includes(token)) {
+      console.warn(`Missing placeholder: ${token}`);
+      continue;
+    }
+    try {
+      let buffer;
+      if (templates && typeof templates.renderTemplate === 'function') {
+        buffer = await templates.renderTemplate(meta.templateId, { filingData, article });
+      } else {
+        // visual-templates.js not available — leave placeholder (graceful degradation)
+        continue;
+      }
+      const key = `charts/${ticker}-${meta.templateId}-${ts}.png`;
+      const url = await uploadChart(buffer, key, fetchFn, env);
+      article.body_html = article.body_html.replace(
+        token,
+        `<img src="${url}" alt="${meta.description}" class="article-chart" />`,
+      );
+    } catch (e) {
+      console.warn(`Failed to replace ${token}: ${e.message}`);
+    }
+  }
+  return article;
+}
+
 // ---------------------------------------------------------------------------
 // Exports
 // ---------------------------------------------------------------------------
@@ -1380,6 +1577,10 @@ module.exports = {
   aiDetectionScore,
   sanitizeHtml,
   ensureUniqueSlug,
+  generateSchema,
+  checkContentFreshness,
+  uploadChart,
+  replaceVisualPlaceholders,
 
   // Orchestration (integration tested)
   pickKeyword,
diff --git a/ryan_cole/insiderbuying-site/n8n/tests/generate-article.test.js b/ryan_cole/insiderbuying-site/n8n/tests/generate-article.test.js
index 56b87b5..77ae41f 100644
--- a/ryan_cole/insiderbuying-site/n8n/tests/generate-article.test.js
+++ b/ryan_cole/insiderbuying-site/n8n/tests/generate-article.test.js
@@ -21,6 +21,10 @@ const {
   countWords,
   stdDev,
   mean,
+  generateSchema,
+  checkContentFreshness,
+  replaceVisualPlaceholders,
+  uploadChart,
   BANNED_PHRASES,
   VALID_VERDICTS,
   LENGTH_CONFIG,
@@ -1046,3 +1050,223 @@ describe('buildDraftUserMessage', () => {
     assert.ok(msg.includes('{{VISUAL_3}}'));
   });
 });
+
+// ---------------------------------------------------------------------------
+// Section 03 — generateSchema
+// ---------------------------------------------------------------------------
+
+describe('generateSchema', () => {
+  const sampleArticle = {
+    title: 'NVDA Q1 2026 Earnings Analysis',
+    meta_description: 'NVIDIA Q1 2026 earnings analysis reveals strong margins.',
+    slug: 'nvda-q1-2026-earnings',
+    published_at: '2026-03-29T00:00:00.000Z',
+    author_name: 'Ryan Chen',
+  };
+
+  it('returns a string (not null/undefined)', () => {
+    const result = generateSchema(sampleArticle);
+    assert.equal(typeof result, 'string');
+    assert.ok(result.length > 0);
+  });
+
+  it('wrapped in <script type="application/ld+json"> tag', () => {
+    const result = generateSchema(sampleArticle);
+    assert.ok(result.includes('<script type="application/ld+json">'));
+    assert.ok(result.includes('</script>'));
+  });
+
+  it('contains @type Article', () => {
+    const result = generateSchema(sampleArticle);
+    assert.ok(result.includes('"Article"'));
+  });
+
+  it('contains @type Person with name Ryan Chen', () => {
+    const result = generateSchema(sampleArticle);
+    assert.ok(result.includes('"Person"'));
+    assert.ok(result.includes('"Ryan Chen"'));
+  });
+
+  it('contains @type FinancialProduct', () => {
+    const result = generateSchema(sampleArticle);
+    assert.ok(result.includes('"FinancialProduct"'));
+  });
+
+  it('returns parseable JSON-LD inside script tags', () => {
+    const result = generateSchema(sampleArticle);
+    const match = result.match(/<script[^>]*>([\s\S]*?)<\/script>/);
+    assert.ok(match, 'script tag not found');
+    const parsed = JSON.parse(match[1].trim());
+    assert.ok(parsed['@context'] || (Array.isArray(parsed) && parsed[0]['@context']));
+  });
+
+  it('appended to article.body_html is at end', () => {
+    const article = { ...sampleArticle, body_html: '<p>Body content here.</p>' };
+    const schema = generateSchema(article);
+    const combined = article.body_html + '\n' + schema;
+    assert.ok(combined.endsWith('</script>'));
+  });
+
+  it('does not throw when article fields are missing', () => {
+    assert.doesNotThrow(() => generateSchema({}));
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Section 03 — checkContentFreshness
+// ---------------------------------------------------------------------------
+
+describe('checkContentFreshness', () => {
+  it('returns { fresh: true, effectiveArticleType: "insider_buying" } when no recent articles', async () => {
+    const mockFetchFn = async () => ({ ok: true, json: async () => ({ list: [] }), text: async () => '{}' });
+    const opts = { token: 'tok', baseUrl: 'http://localhost:8080', fetchFn: mockFetchFn };
+    const result = await checkContentFreshness('NVDA', opts);
+    assert.equal(result.fresh, true);
+    assert.equal(result.effectiveArticleType, 'insider_buying');
+  });
+
+  it('returns { fresh: false, effectiveArticleType: "contrarian" } when recent article exists', async () => {
+    const mockFetchFn = async () => ({
+      ok: true,
+      json: async () => ({ list: [{ published_at: '2026-03-15T00:00:00.000Z' }] }),
+      text: async () => '{}',
+    });
+    const opts = { token: 'tok', baseUrl: 'http://localhost:8080', fetchFn: mockFetchFn };
+    const result = await checkContentFreshness('NVDA', opts);
+    assert.equal(result.fresh, false);
+    assert.equal(result.effectiveArticleType, 'contrarian');
+    assert.equal(result.lastPublished, '2026-03-15T00:00:00.000Z');
+  });
+
+  it('NocoDB query uses 30-day date filter', async () => {
+    let capturedUrl = '';
+    const mockFetchFn = async (url) => {
+      capturedUrl = url;
+      return { ok: true, json: async () => ({ list: [] }), text: async () => '{}' };
+    };
+    const opts = { token: 'tok', baseUrl: 'http://localhost:8080', fetchFn: mockFetchFn };
+    await checkContentFreshness('AAPL', opts);
+    // Should contain a date roughly 30 days ago
+    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
+    const yearAgo = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
+    // Captured URL should reference a date that is between yearAgo and now
+    const dateMatch = capturedUrl.match(/(\d{4}-\d{2}-\d{2})/);
+    assert.ok(dateMatch, 'No date found in URL: ' + capturedUrl);
+    const urlDate = new Date(dateMatch[1]);
+    assert.ok(urlDate > yearAgo && urlDate < new Date(), 'Date in URL not in expected range');
+  });
+
+  it('returns fresh: true on NocoDB error (safe default)', async () => {
+    const mockFetchFn = async () => { throw new Error('NocoDB unreachable'); };
+    const opts = { token: 'tok', baseUrl: 'http://localhost:8080', fetchFn: mockFetchFn };
+    const result = await checkContentFreshness('NVDA', opts);
+    assert.equal(result.fresh, true);
+    assert.equal(result.effectiveArticleType, 'insider_buying');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Section 03 — replaceVisualPlaceholders
+// ---------------------------------------------------------------------------
+
+describe('replaceVisualPlaceholders', () => {
+  function makeR2Env() {
+    return {
+      R2_ACCOUNT_ID: 'test-account',
+      R2_ACCESS_KEY_ID: 'test-key',
+      R2_SECRET_ACCESS_KEY: 'test-secret',
+      R2_PUBLIC_URL: 'https://pub.r2.dev',
+    };
+  }
+
+  it('replaces {{VISUAL_1}} with an img tag containing R2 URL', async () => {
+    const mockFetchFn = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
+    const article = {
+      body_html: '<p>{{VISUAL_1}}</p>',
+      title: 'Test',
+      slug: 'test-slug',
+    };
+    const result = await replaceVisualPlaceholders(article, {}, mockFetchFn, makeR2Env(), {
+      renderTemplate: async () => Buffer.from('png-data'),
+    });
+    assert.ok(!result.body_html.includes('{{VISUAL_1}}'));
+    assert.ok(result.body_html.includes('<img'));
+  });
+
+  it('replaces all 3 placeholders', async () => {
+    const mockFetchFn = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
+    const article = {
+      body_html: '<p>{{VISUAL_1}}</p><p>{{VISUAL_2}}</p><p>{{VISUAL_3}}</p>',
+      title: 'Test',
+      slug: 'test-slug',
+    };
+    const result = await replaceVisualPlaceholders(article, {}, mockFetchFn, makeR2Env(), {
+      renderTemplate: async () => Buffer.from('png-data'),
+    });
+    assert.ok(!result.body_html.includes('{{VISUAL_'));
+  });
+
+  it('missing {{VISUAL_2}} -> warns but does not throw, others replaced', async () => {
+    const mockFetchFn = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
+    const article = {
+      body_html: '<p>{{VISUAL_1}}</p><p>{{VISUAL_3}}</p>',
+      title: 'Test',
+      slug: 'test-slug',
+    };
+    let warnCalled = false;
+    const origWarn = console.warn;
+    console.warn = () => { warnCalled = true; };
+    try {
+      const result = await replaceVisualPlaceholders(article, {}, mockFetchFn, makeR2Env(), {
+        renderTemplate: async () => Buffer.from('png-data'),
+      });
+      assert.ok(warnCalled || !result.body_html.includes('{{VISUAL_1}}'));
+      assert.ok(!result.body_html.includes('{{VISUAL_1}}'));
+      assert.ok(!result.body_html.includes('{{VISUAL_3}}'));
+    } finally {
+      console.warn = origWarn;
+    }
+  });
+
+  it('no placeholders -> body returned unchanged', async () => {
+    const article = { body_html: '<p>No visuals here.</p>', title: 'Test', slug: 'test' };
+    const result = await replaceVisualPlaceholders(article, {}, async () => ({}), makeR2Env(), {
+      renderTemplate: async () => Buffer.from(''),
+    });
+    assert.equal(result.body_html, '<p>No visuals here.</p>');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Section 03 — uploadChart
+// ---------------------------------------------------------------------------
+
+describe('uploadChart', () => {
+  it('sends Content-Type: image/png in request headers', async () => {
+    let capturedHeaders = {};
+    const mockFetchFn = async (url, opts) => {
+      capturedHeaders = opts.headers || {};
+      return { ok: true, json: async () => ({}), text: async () => '' };
+    };
+    const env = {
+      R2_ACCOUNT_ID: 'test-account',
+      R2_ACCESS_KEY_ID: 'AKIATEST',
+      R2_SECRET_ACCESS_KEY: 'secret',
+      R2_PUBLIC_URL: 'https://pub.r2.dev',
+    };
+    await uploadChart(Buffer.from('data'), 'charts/test.png', mockFetchFn, env);
+    assert.equal(capturedHeaders['Content-Type'], 'image/png');
+  });
+
+  it('returns public R2 URL on success', async () => {
+    const mockFetchFn = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
+    const env = {
+      R2_ACCOUNT_ID: 'acc',
+      R2_ACCESS_KEY_ID: 'key',
+      R2_SECRET_ACCESS_KEY: 'sec',
+      R2_PUBLIC_URL: 'https://pub.r2.dev',
+    };
+    const url = await uploadChart(Buffer.from('data'), 'charts/test.png', mockFetchFn, env);
+    assert.ok(url.startsWith('https://pub.r2.dev/charts/test.png'));
+  });
+});
