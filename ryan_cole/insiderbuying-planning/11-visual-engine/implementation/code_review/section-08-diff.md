diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js
index fe06bd1..e68c105 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js
@@ -8,8 +8,13 @@ const TTL_SECONDS = 2592000;   // 30 days
 
 // ─── Internal NocoDB helpers ──────────────────────────────────────────────────
 
-async function _nocoGet(url, token, fetchFn) {
-  const res = await fetchFn(url, { headers: { 'xc-token': token } });
+async function _nocoGet(url, token, fetchFn, _sleep) {
+  let res = await fetchFn(url, { headers: { 'xc-token': token } });
+  if (res.status === 429) {
+    // Rate-limited — wait 1s and retry once
+    await (_sleep ? _sleep(1000) : new Promise(r => setTimeout(r, 1000)));
+    res = await fetchFn(url, { headers: { 'xc-token': token } });
+  }
   if (!res.ok) throw new Error(`NocoDB GET failed: ${res.status}`);
   return res.json();
 }
@@ -20,7 +25,7 @@ async function _nocoGet(url, token, fetchFn) {
  */
 async function _cacheGet(tableId, keyField, keyValue, helpers) {
   const url = `${helpers.env.NOCODB_API_URL}/api/v2/tables/${tableId}/records?where=(${keyField},eq,${encodeURIComponent(keyValue)})&limit=1`;
-  const body = await _nocoGet(url, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn);
+  const body = await _nocoGet(url, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn, helpers._sleep);
   const record = body.list && body.list[0];
   if (!record) return null;
   const fetchedAt = new Date(record.fetched_at).getTime();
@@ -35,7 +40,7 @@ async function _cacheGet(tableId, keyField, keyValue, helpers) {
  */
 async function _cacheSet(tableId, keyField, keyValue, data, helpers) {
   const url = `${helpers.env.NOCODB_API_URL}/api/v2/tables/${tableId}/records?where=(${keyField},eq,${encodeURIComponent(keyValue)})&limit=1`;
-  const body = await _nocoGet(url, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn);
+  const body = await _nocoGet(url, helpers.env.NOCODB_API_TOKEN, helpers.fetchFn, helpers._sleep);
   const existing = body.list && body.list[0];
   const token = helpers.env.NOCODB_API_TOKEN;
   const baseUrl = helpers.env.NOCODB_API_URL;
diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-engine.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-engine.js
new file mode 100644
index 0000000..f4f6fa6
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-engine.js
@@ -0,0 +1,17 @@
+'use strict';
+
+/**
+ * Visual Engine — unified export for all EarlyInsider visual generation modules.
+ *
+ * Usage from n8n Code nodes:
+ *   const { charts, templates, covers, identity } = require('./visual-engine');
+ *   const buffer = await charts.renderBarChart(opts, helpers);
+ *   const url = await templates.renderTemplate(1, data, { upload: true }, helpers);
+ *   const logoUrl = await identity.getCompanyLogo('nvidia.com', 'NVDA', helpers);
+ */
+module.exports = {
+  charts:    require('./generate-chart'),
+  templates: require('./visual-templates'),
+  covers:    require('./report-covers'),
+  identity:  require('./identity-assets'),
+};
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js
index 2c9fd9e..698c86f 100644
--- a/ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js
@@ -554,3 +554,105 @@ describe('getInsiderPhoto — UI Avatars fallback', () => {
     expect(posted.source).toBe('ui_avatars');
   });
 });
+
+// ─── S08: Cache helper behaviors (tested via getCompanyLogo public API) ────────
+
+describe('_cacheGet behavior (via getCompanyLogo)', () => {
+  test('returns null for non-existent key — triggers fetch cascade', async () => {
+    const helpers = makeHelpers([
+      nocoCacheMiss(),           // _cacheGet: list = []
+      brandfetchHit('image/png'),
+      nocoCacheMiss(),
+      nocoDone(),
+    ]);
+    const url = await getCompanyLogo('example.com', 'EX', helpers);
+    // Cache miss means we fell through to Brandfetch — returns R2 URL
+    expect(url).toContain('r2');
+  });
+
+  test('returns null for expired entry — triggers re-fetch', async () => {
+    const helpers = makeHelpers([
+      nocoCacheExpired('example.com', 'https://old.url/logo.png'),
+      brandfetchHit('image/png'),
+      nocoCacheMiss(),
+      nocoDone(),
+    ]);
+    const url = await getCompanyLogo('example.com', 'EX', helpers);
+    expect(url).toContain('r2');
+    expect(helpers.fetchFn).toHaveBeenCalledTimes(4); // expired → full cascade
+  });
+
+  test('returns cached data for valid TTL entry — skips cascade', async () => {
+    const helpers = makeHelpers([
+      nocoCacheHit('example.com', 'https://r2.dev/logos/example.png'),
+    ]);
+    const url = await getCompanyLogo('example.com', 'EX', helpers);
+    expect(url).toBe('https://r2.dev/logos/example.png');
+    expect(helpers.fetchFn).toHaveBeenCalledTimes(1); // only cache check
+  });
+});
+
+describe('_cacheSet behavior (via getCompanyLogo)', () => {
+  test('creates new row with POST when key does not exist', async () => {
+    const helpers = makeHelpers([
+      nocoCacheMiss(),
+      brandfetchHit('image/png'),
+      nocoCacheMiss(),   // _cacheSet existence check: not found
+      nocoDone(),        // POST
+    ]);
+    await getCompanyLogo('example.com', 'EX', helpers);
+    const postCall = helpers.fetchFn.mock.calls.find(c => c[1] && c[1].method === 'POST');
+    expect(postCall).toBeDefined();
+  });
+
+  test('updates existing row with PATCH when key already exists', async () => {
+    const helpers = makeHelpers([
+      nocoCacheExpired('example.com', 'https://old.url/logo.png'),
+      brandfetchHit('image/png'),
+      nocoCacheHit('example.com', 'https://old.url/logo.png'), // _cacheSet: row exists
+      nocoDone(),        // PATCH
+    ]);
+    await getCompanyLogo('example.com', 'EX', helpers);
+    const patchCall = helpers.fetchFn.mock.calls.find(c => c[1] && c[1].method === 'PATCH');
+    expect(patchCall).toBeDefined();
+    const postCall = helpers.fetchFn.mock.calls.find(c => c[1] && c[1].method === 'POST');
+    expect(postCall).toBeUndefined();
+  });
+
+  test('retries once on NocoDB 429 response', async () => {
+    const sleepFn = jest.fn().mockResolvedValue(undefined);
+    const fetchFn = jest.fn()
+      // initial _cacheGet: miss
+      .mockResolvedValueOnce({ ok: true, json: async () => ({ list: [] }) })
+      // brandfetch hit
+      .mockResolvedValueOnce(brandfetchHit('image/png'))
+      // _cacheSet existence check: 429 first, then success on retry
+      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
+      .mockResolvedValueOnce({ ok: true, json: async () => ({ list: [] }) })
+      // POST
+      .mockResolvedValueOnce({ ok: true, json: async () => ({ Id: 99 }) });
+    const helpers = { fetchFn, env: ENV, _sleep: sleepFn };
+    await getCompanyLogo('example.com', 'EX', helpers);
+    expect(sleepFn).toHaveBeenCalledWith(1000); // retry delay triggered
+  });
+
+  test('NocoDB fetchFn calls include xc-token header', async () => {
+    const helpers = makeHelpers([
+      nocoCacheMiss(),
+      brandfetchHit('image/png'),
+      nocoCacheMiss(),
+      nocoDone(),
+    ]);
+    await getCompanyLogo('example.com', 'EX', helpers);
+    const nocoCalls = helpers.fetchFn.mock.calls.filter(
+      c => c[0].includes('nocodb')
+    );
+    expect(nocoCalls.length).toBeGreaterThan(0);
+    nocoCalls
+      .filter(c => !c[1] || !c[1].method || c[1].method === 'GET')
+      .forEach(call => {
+        const headers = call[1] && call[1].headers;
+        expect(headers && (headers['xc-token'] || headers['xc-Token'])).toBe('test-token');
+      });
+  });
+});
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/visual-engine.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/visual-engine.test.js
new file mode 100644
index 0000000..4cb65fc
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/visual-engine.test.js
@@ -0,0 +1,80 @@
+'use strict';
+
+jest.mock('../../n8n/code/insiderbuying/render-pdf', () => ({
+  uploadToR2: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/test.png'),
+}));
+
+jest.mock('../../n8n/code/insiderbuying/generate-chart', () => ({
+  renderBarChart: jest.fn(),
+  renderLineChart: jest.fn(),
+  renderDonutChart: jest.fn(),
+  uploadChart: jest.fn().mockResolvedValue('https://pub.r2.dev/earlyinsider/chart.png'),
+}));
+
+jest.mock('../../n8n/code/insiderbuying/visual-templates', () => ({
+  renderTemplate: jest.fn(),
+}));
+
+jest.mock('../../n8n/code/insiderbuying/report-covers', () => ({
+  renderCoverA: jest.fn(),
+  renderCoverB: jest.fn(),
+  renderCoverC: jest.fn(),
+  renderCoverD: jest.fn(),
+}));
+
+jest.mock('../../n8n/code/insiderbuying/identity-assets', () => ({
+  getCompanyLogo: jest.fn(),
+  prefetchLogos: jest.fn(),
+  getInsiderPhoto: jest.fn(),
+  normalizeInsiderName: jest.fn(),
+}));
+
+const engine = require('../../n8n/code/insiderbuying/visual-engine');
+
+// ─── Exports ──────────────────────────────────────────────────────────────────
+
+describe('visual-engine exports', () => {
+  test('exports charts namespace', () => {
+    expect(engine.charts).toBeDefined();
+  });
+
+  test('exports templates namespace', () => {
+    expect(engine.templates).toBeDefined();
+  });
+
+  test('exports covers namespace', () => {
+    expect(engine.covers).toBeDefined();
+  });
+
+  test('exports identity namespace', () => {
+    expect(engine.identity).toBeDefined();
+  });
+
+  test('charts.renderBarChart is a function', () => {
+    expect(typeof engine.charts.renderBarChart).toBe('function');
+  });
+
+  test('templates.renderTemplate is a function', () => {
+    expect(typeof engine.templates.renderTemplate).toBe('function');
+  });
+
+  test('covers.renderCoverA is a function', () => {
+    expect(typeof engine.covers.renderCoverA).toBe('function');
+  });
+
+  test('identity.getCompanyLogo is a function', () => {
+    expect(typeof engine.identity.getCompanyLogo).toBe('function');
+  });
+
+  test('identity.getInsiderPhoto is a function', () => {
+    expect(typeof engine.identity.getInsiderPhoto).toBe('function');
+  });
+});
+
+// ─── uploadChart key pattern ───────────────────────────────────────────────────
+
+describe('uploadChart (via generate-chart module)', () => {
+  test('uploadChart is exported from charts namespace', () => {
+    expect(typeof engine.charts.uploadChart).toBe('function');
+  });
+});
