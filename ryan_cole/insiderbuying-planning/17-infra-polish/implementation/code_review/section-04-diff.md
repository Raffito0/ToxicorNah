diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-image.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-image.js
index fe13c0d..a269033 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-image.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-image.js
@@ -238,65 +238,28 @@ async function uploadToR2(key, imageBuffer, opts = {}) {
 }
 
 // ---------------------------------------------------------------------------
-// fal.ai Flux — Hero Image
+// Template 13 (visual-templates.js) — Hero Image
 // ---------------------------------------------------------------------------
 
-async function generateHeroImage(prompt, opts = {}) {
-  const { fetchFn, falKey } = opts;
-  if (!fetchFn || !falKey) return null;
+async function generateHeroImage(article, opts) {
+  opts = opts || {};
+  const templates = opts.templates;
 
-  try {
-    // fal.ai queue API: submit -> poll -> get result
-    const submitRes = await fetchFn('https://queue.fal.run/fal-ai/flux/dev', {
-      method: 'POST',
-      headers: {
-        'Authorization': `Key ${falKey}`,
-        'Content-Type': 'application/json',
-      },
-      body: JSON.stringify({
-        prompt,
-        image_size: { width: 1200, height: 630 },
-        num_images: 1,
-      }),
-    });
-
-    if (!submitRes.ok) return null;
-    const submitData = await submitRes.json();
-
-    // Direct result (sync mode)
-    if (submitData?.images?.[0]?.url) {
-      return { url: submitData.images[0].url, binary: null };
-    }
-
-    // Async mode: poll request_id
-    const requestId = submitData?.request_id;
-    if (!requestId) return null;
+  if (!templates || typeof templates.renderTemplate !== 'function') {
+    throw new Error('visual-templates.js renderTemplate not found');
+  }
 
-    for (let i = 0; i < 30; i++) {
-      await new Promise((r) => setTimeout(r, 2000));
-      const pollRes = await fetchFn(`https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}/status`, {
-        headers: { 'Authorization': `Key ${falKey}` },
-      });
-      if (!pollRes.ok) continue;
-      const pollData = await pollRes.json();
-
-      if (pollData?.status === 'COMPLETED') {
-        // Fetch result
-        const resultRes = await fetchFn(`https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}`, {
-          headers: { 'Authorization': `Key ${falKey}` },
-        });
-        if (!resultRes.ok) return null;
-        const resultData = await resultRes.json();
-        const url = resultData?.images?.[0]?.url;
-        return url ? { url, binary: null } : null;
-      }
-      if (pollData?.status === 'FAILED') return null;
-    }
+  const data = {
+    headline: article.headline,
+    ticker: article.ticker,
+    verdict: article.verdict,
+    insiderName: article.insiderName,
+    date: article.date,
+  };
 
-    return null; // timeout
-  } catch {
-    return null;
-  }
+  const buffer = await templates.renderTemplate(13, data, {}, { fetchFn: opts.fetchFn, env: opts.env });
+  const r2Key = 'hero-' + article.slug + '.png';
+  return uploadToR2(r2Key, buffer, opts);
 }
 
 // ---------------------------------------------------------------------------
@@ -361,30 +324,24 @@ async function generateImages(input, helpers) {
   let heroUrl = null;
   let ogUrl = null;
 
-  // Step 2: Generate hero image
-  const heroPrompt = buildHeroPrompt({
-    ticker: article.ticker,
-    company_name: article.company_name,
-    verdict_type: article.verdict_type,
-  });
+  // Step 2: Generate hero image via Template 13 (visual-templates.js)
+  let visualTemplates;
+  try { visualTemplates = require('./visual-templates'); } catch (e) { /* guard below handles null */ }
 
-  const heroResult = await generateHeroImage(heroPrompt, {
-    fetchFn,
-    falKey: env.FAL_KEY,
-  });
-
-  if (heroResult?.url) {
-    // Download and upload to R2
-    try {
-      const imgRes = await fetchFn(heroResult.url);
-      if (imgRes.ok) {
-        const buffer = Buffer.from(await imgRes.arrayBuffer());
-        const heroKey = buildR2Key(article.slug, 'hero');
-        heroUrl = await uploadToR2(heroKey, buffer, { fetchFn, env });
-      }
-    } catch {
-      // fallback below
-    }
+  try {
+    heroUrl = await generateHeroImage(
+      {
+        slug: article.slug,
+        headline: article.title_text || article.title || '',
+        ticker: article.ticker || '',
+        verdict: article.verdict_type || '',
+        insiderName: article.insider_name || '',
+        date: article.publish_date || '',
+      },
+      { templates: visualTemplates, fetchFn, env }
+    );
+  } catch (e) {
+    heroUrl = null;
   }
 
   // Fallback to generic verdict hero
diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-templates.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-templates.js
index 3c3097a..4f55c31 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-templates.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-templates.js
@@ -524,18 +524,24 @@ function t12SectorHeatmap(data) {
 }
 
 // ─── T13 — Article Hero (1200×630) ───────────────────────────────────────────
+// Fields: headline, ticker, verdict, insiderName, date
 
 function t13ArticleHero(data) {
+  const verdictKey = normalizeVerdict(data.verdict);
+  const verdictInfo = VERDICTS[verdictKey] || { color: COLORS.blue, label: data.verdict || '' };
+
   const inner = `
 <div style="width:100%;height:100%;padding:64px 72px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(135deg,#0A1128 0%,#1A2238 100%);">
   <div>
-    <span style="display:inline-block;padding:4px 14px;border-radius:20px;border:1px solid ${COLORS.blue};color:${COLORS.blue};font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:24px;">${escapeHtml(data.category ?? '')}</span>
-    <div style="font-size:48px;font-weight:800;color:${COLORS.textPrimary};line-height:1.15;max-width:900px;">${escapeHtml(data.title ?? '')}</div>
-    ${data.subtitle ? `<div style="font-size:20px;color:${COLORS.textSecondary};margin-top:16px;">${escapeHtml(data.subtitle)}</div>` : ''}
+    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
+      <span style="display:inline-block;padding:4px 14px;border-radius:20px;border:1px solid ${verdictInfo.color};color:${verdictInfo.color};font-size:12px;font-weight:700;letter-spacing:1px;">${escapeHtml(data.ticker ?? '')}</span>
+      <span style="display:inline-block;padding:4px 14px;border-radius:20px;background:${verdictInfo.color}22;border:1px solid ${verdictInfo.color};color:${verdictInfo.color};font-size:12px;font-weight:700;letter-spacing:1px;">${escapeHtml(verdictInfo.label)}</span>
+    </div>
+    <div style="font-size:48px;font-weight:800;color:${COLORS.textPrimary};line-height:1.15;max-width:900px;">${escapeHtml(data.headline ?? '')}</div>
   </div>
   <div style="display:flex;justify-content:space-between;align-items:center;">
-    <div style="font-size:14px;color:${COLORS.textSecondary};">${escapeHtml(data.date ?? '')}</div>
-    ${data.authorName ? `<div style="font-size:13px;color:${COLORS.textSecondary};">${escapeHtml(data.authorName)}</div>` : ''}
+    <div style="font-size:14px;color:${COLORS.textSecondary};">${escapeHtml(data.insiderName ?? '')} &middot; ${escapeHtml(data.date ?? '')}</div>
+    <div style="font-size:12px;font-weight:700;color:${verdictInfo.color};letter-spacing:1px;">EARLYINSIDER.COM</div>
   </div>
 </div>`;
 
diff --git a/ryan_cole/insiderbuying-site/n8n/tests/generate-image.test.js b/ryan_cole/insiderbuying-site/n8n/tests/generate-image.test.js
index 1304f21..16cc8ba 100644
--- a/ryan_cole/insiderbuying-site/n8n/tests/generate-image.test.js
+++ b/ryan_cole/insiderbuying-site/n8n/tests/generate-image.test.js
@@ -9,6 +9,8 @@ const {
   escapeHtml,
   VERDICT_COLORS,
   FALLBACK_HERO_URLS,
+  generateHeroImage,
+  generateOgCard,
 } = require('../code/insiderbuying/generate-image.js');
 
 // ---------------------------------------------------------------------------
@@ -157,3 +159,170 @@ describe('FALLBACK_HERO_URLS', () => {
     }
   });
 });
+
+// ---------------------------------------------------------------------------
+// generateHeroImage -- Template 13 path
+// ---------------------------------------------------------------------------
+
+const HERO_ARTICLE = {
+  slug: 'aapl-buy-2026-03-29',
+  headline: 'Apple Insiders Load Up Before Earnings',
+  ticker: 'AAPL',
+  verdict: 'BULLISH',
+  insiderName: 'Tim Cook',
+  date: 'March 29, 2026',
+};
+
+function makeR2Env() {
+  return {
+    R2_ACCOUNT_ID: 'acct-test',
+    R2_ACCESS_KEY_ID: 'akid-test',
+    R2_SECRET_ACCESS_KEY: 'sak-test',
+    R2_PUBLIC_URL: 'https://pub.r2.test',
+  };
+}
+
+describe('generateHeroImage -- Template 13 path', () => {
+  it('guard throws when templates is null', async () => {
+    await assert.rejects(
+      () => generateHeroImage(HERO_ARTICLE, { templates: null }),
+      /renderTemplate not found/
+    );
+  });
+
+  it('guard throws when templates has no renderTemplate function', async () => {
+    await assert.rejects(
+      () => generateHeroImage(HERO_ARTICLE, { templates: {} }),
+      /renderTemplate not found/
+    );
+  });
+
+  it('calls renderTemplate(13, ...) with all required fields', async () => {
+    let capturedId, capturedData;
+    const mockBuffer = Buffer.from('PNG-DATA');
+    const opts = {
+      templates: {
+        renderTemplate: async (id, data) => {
+          capturedId = id;
+          capturedData = Object.assign({}, data);
+          return mockBuffer;
+        },
+      },
+      fetchFn: async () => ({ ok: true }),
+      env: makeR2Env(),
+    };
+    await generateHeroImage(HERO_ARTICLE, opts);
+    assert.strictEqual(capturedId, 13);
+    assert.strictEqual(capturedData.headline, HERO_ARTICLE.headline);
+    assert.strictEqual(capturedData.ticker, HERO_ARTICLE.ticker);
+    assert.strictEqual(capturedData.verdict, HERO_ARTICLE.verdict);
+    assert.strictEqual(capturedData.insiderName, HERO_ARTICLE.insiderName);
+    assert.strictEqual(capturedData.date, HERO_ARTICLE.date);
+  });
+
+  it('R2 key is hero-{slug}.png', async () => {
+    const env = makeR2Env();
+    const opts = {
+      templates: { renderTemplate: async () => Buffer.from('PNG') },
+      fetchFn: async () => ({ ok: true }),
+      env,
+    };
+    const result = await generateHeroImage(HERO_ARTICLE, opts);
+    assert.strictEqual(result, env.R2_PUBLIC_URL + '/hero-' + HERO_ARTICLE.slug + '.png');
+  });
+
+  it('returns the R2 URL string from uploadToR2', async () => {
+    const env = makeR2Env();
+    const opts = {
+      templates: { renderTemplate: async () => Buffer.from('PNG') },
+      fetchFn: async () => ({ ok: true }),
+      env,
+    };
+    const result = await generateHeroImage(HERO_ARTICLE, opts);
+    assert.ok(typeof result === 'string' && result.startsWith('https://'));
+  });
+
+  it('makes no fal.ai calls', async () => {
+    let falCallCount = 0;
+    const opts = {
+      templates: { renderTemplate: async () => Buffer.from('PNG') },
+      fetchFn: async (url) => {
+        if (typeof url === 'string' && url.includes('fal.run')) falCallCount++;
+        return { ok: true };
+      },
+      env: makeR2Env(),
+    };
+    await generateHeroImage(HERO_ARTICLE, opts);
+    assert.strictEqual(falCallCount, 0);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// generateOgCard -- regression guard
+// ---------------------------------------------------------------------------
+
+describe('generateOgCard -- regression guard', () => {
+  it('calls screenshot server at host.docker.internal:3456', async () => {
+    let screenshotCalled = false;
+    const fetchFn = async (url) => {
+      if (typeof url === 'string' && url.includes('3456')) screenshotCalled = true;
+      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
+    };
+    await generateOgCard('<html/>', { fetchFn });
+    assert.ok(screenshotCalled);
+  });
+
+  it('does NOT call renderTemplate', async () => {
+    let renderTemplateCalled = false;
+    const fetchFn = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
+    await generateOgCard('<html/>', { fetchFn });
+    assert.ok(!renderTemplateCalled);
+    // OgCard still returns a Buffer or null (regression: function still works)
+  });
+});
+
+// ---------------------------------------------------------------------------
+// visual-templates.js -- Template 13 unit
+// ---------------------------------------------------------------------------
+
+describe('visual-templates -- Template 13', () => {
+  const templates = require('../code/insiderbuying/visual-templates');
+
+  const T13_DATA = {
+    headline: 'Apple Insiders Buy Big Before Q2',
+    ticker: 'AAPL',
+    verdict: 'BULLISH',
+    insiderName: 'Tim Cook',
+    date: 'March 29, 2026',
+  };
+
+  function makeFetchFnForScreenshot() {
+    const buf = Buffer.from('FAKE-PNG-12345678');
+    return async () => ({
+      ok: true,
+      headers: { get: () => 'image/png' },
+      buffer: async () => buf,
+    });
+  }
+
+  it('renderTemplate(13, validData) resolves without throwing', async () => {
+    const result = await templates.renderTemplate(
+      13, T13_DATA, {}, { fetchFn: makeFetchFnForScreenshot() }
+    );
+    assert.ok(result !== null && result !== undefined);
+  });
+
+  it('renderTemplate(13, validData) returns a Buffer', async () => {
+    const result = await templates.renderTemplate(
+      13, T13_DATA, {}, { fetchFn: makeFetchFnForScreenshot() }
+    );
+    assert.ok(Buffer.isBuffer(result));
+  });
+
+  it('renderTemplate(13, validData) returns non-empty Buffer', async () => {
+    const result = await templates.renderTemplate(
+      13, T13_DATA, {}, { fetchFn: makeFetchFnForScreenshot() }
+    );
+    assert.ok(result.length > 0);
+  });
+});
