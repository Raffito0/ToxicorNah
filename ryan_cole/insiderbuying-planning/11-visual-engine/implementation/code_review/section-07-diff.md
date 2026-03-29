diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js
index a5550e0..d80730d 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/identity-assets.js
@@ -192,10 +192,151 @@ async function prefetchLogos(domains, helpers) {
   }
 }
 
+// ─── normalizeInsiderName ─────────────────────────────────────────────────────
+
+/**
+ * Normalize a full name for use as a NocoDB cache key.
+ * Strips honorific prefixes (Dr., Mr., etc.) and generational suffixes (Jr., III, etc.).
+ * @param {string|null|undefined} fullName
+ * @returns {string}
+ */
+function normalizeInsiderName(fullName) {
+  if (!fullName) return '';
+  // NFKD normalization + strip combining characters (accents)
+  let name = fullName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
+  // Strip honorific prefixes
+  name = name.replace(/^\s*(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '');
+  // Strip generational suffixes (standalone tokens at end)
+  name = name.replace(/\s+(Jr\.?|Sr\.?|III|IV|II|I)\s*$/i, '');
+  return name.toLowerCase().trim();
+}
+
+// ─── Insider Photo helpers ────────────────────────────────────────────────────
+
+const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
+const WIKIDATA_USER_AGENT = 'EarlyInsiderBot/1.0 (contact@earlyinsider.com)';
+
+async function _tryWikidata(fullName, helpers) {
+  const sparql = `SELECT ?image WHERE { ?entity wdt:P31 wd:Q5 . ?entity rdfs:label "${fullName}"@en . ?entity wdt:P18 ?image . } LIMIT 1`;
+  const res = await helpers.fetchFn(WIKIDATA_SPARQL_URL, {
+    method: 'POST',
+    headers: {
+      'Accept': 'application/sparql-results+json',
+      'User-Agent': WIKIDATA_USER_AGENT,
+      'Content-Type': 'application/x-www-form-urlencoded',
+    },
+    body: `query=${encodeURIComponent(sparql)}`,
+  });
+  if (!res.ok) throw new Error(`Wikidata SPARQL error: ${res.status}`);
+  const data = await res.json();
+  const imageValue = data.results && data.results.bindings && data.results.bindings[0] && data.results.bindings[0].image && data.results.bindings[0].image.value;
+  if (!imageValue) return null;
+
+  const imageUrl = `${imageValue}?width=300`;
+  const head = await helpers.fetchFn(imageUrl, { method: 'HEAD', redirect: 'follow' });
+  if (!head.ok || !(head.headers.get('content-type') || '').startsWith('image/')) return null;
+  return imageUrl;
+}
+
+async function _tryGoogleKG(fullName, title, helpers) {
+  const kgUrl = `https://kgsearch.googleapis.com/v1/entities:search?query=${encodeURIComponent(fullName + ' ' + title)}&types=Person&key=${helpers.env.GOOGLE_KG_API_KEY}&limit=1`;
+  const res = await helpers.fetchFn(kgUrl);
+  if (!res.ok) throw new Error(`Google KG error: ${res.status}`);
+  const data = await res.json();
+  const imageUrl = data.itemListElement && data.itemListElement[0] && data.itemListElement[0].result && data.itemListElement[0].result.image && data.itemListElement[0].result.image.contentUrl;
+  if (!imageUrl) return null;
+
+  const head = await helpers.fetchFn(imageUrl, { method: 'HEAD', redirect: 'follow' });
+  if (head.status === 403) throw new Error('KG image returned 403');
+  if (!head.ok || !(head.headers.get('content-type') || '').startsWith('image/')) throw new Error('KG image verification failed');
+  return imageUrl;
+}
+
+// ─── getInsiderPhoto ──────────────────────────────────────────────────────────
+
+/**
+ * Resolve an insider/executive photo URL with 3-tier cascade.
+ * Wikidata SPARQL → Google Knowledge Graph → UI Avatars fallback.
+ * Always returns a URL string.
+ * @param {string} fullName - e.g. "Jensen Huang"
+ * @param {string} title - e.g. "CEO"
+ * @param {object} helpers - { fetchFn, env, _sleep }
+ * @returns {Promise<string>}
+ */
+async function getInsiderPhoto(fullName, title, helpers) {
+  const tableId = helpers.env.NOCODB_PHOTOS_TABLE_ID;
+  const normalizedName = normalizeInsiderName(fullName);
+
+  // Step 1: Check cache
+  const cached = await _cacheGet(tableId, 'name_normalized', normalizedName, helpers);
+  if (cached) return cached.photo_url;
+
+  // Step 2: Wikidata
+  try {
+    const url = await _tryWikidata(fullName, helpers);
+    if (url) {
+      try {
+        await _cacheSet(tableId, 'name_normalized', normalizedName, {
+          name_normalized: normalizedName,
+          photo_url: url,
+          source: 'wikidata',
+          fetched_at: new Date().toISOString(),
+          ttl_seconds: TTL_SECONDS,
+        }, helpers);
+      } catch (err) {
+        console.warn(`[identity-assets] cache write failed for ${normalizedName}: ${err.message}`);
+      }
+      return url;
+    }
+  } catch (err) {
+    console.warn(`[identity-assets] Wikidata failed for "${fullName}": ${err.message}`);
+  }
+
+  // Step 3: Google Knowledge Graph
+  try {
+    const url = await _tryGoogleKG(fullName, title, helpers);
+    if (url) {
+      try {
+        await _cacheSet(tableId, 'name_normalized', normalizedName, {
+          name_normalized: normalizedName,
+          photo_url: url,
+          source: 'google_kg',
+          fetched_at: new Date().toISOString(),
+          ttl_seconds: TTL_SECONDS,
+        }, helpers);
+      } catch (err) {
+        console.warn(`[identity-assets] cache write failed for ${normalizedName}: ${err.message}`);
+      }
+      return url;
+    }
+  } catch (err) {
+    console.warn(`[identity-assets] Google KG failed for "${fullName}": ${err.message}`);
+  }
+
+  // Step 4: UI Avatars fallback
+  const nameParts = normalizedName.split(' ');
+  const firstName = nameParts[0] || 'U';
+  const lastName = nameParts[1] || 'I';
+  const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName + '+' + lastName)}&background=0A1128&color=fff&size=128&bold=true&rounded=true`;
+  try {
+    await _cacheSet(tableId, 'name_normalized', normalizedName, {
+      name_normalized: normalizedName,
+      photo_url: uiAvatarsUrl,
+      source: 'ui_avatars',
+      fetched_at: new Date().toISOString(),
+      ttl_seconds: TTL_SECONDS,
+    }, helpers);
+  } catch (err) {
+    console.warn(`[identity-assets] cache write failed for ${normalizedName}: ${err.message}`);
+  }
+  return uiAvatarsUrl;
+}
+
 // ─── Exports ──────────────────────────────────────────────────────────────────
 
 module.exports = {
   getCompanyLogo,
   prefetchLogos,
-  // getInsiderPhoto added in Section 07
+  getInsiderPhoto,
+  normalizeInsiderName,
 };
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js
index 2784866..71b8c48 100644
--- a/ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/identity-assets.test.js
@@ -5,7 +5,7 @@ jest.mock('../../n8n/code/insiderbuying/render-pdf', () => ({
 }));
 
 const { uploadToR2 } = require('../../n8n/code/insiderbuying/render-pdf');
-const { getCompanyLogo, prefetchLogos } = require('../../n8n/code/insiderbuying/identity-assets');
+const { getCompanyLogo, prefetchLogos, getInsiderPhoto, normalizeInsiderName } = require('../../n8n/code/insiderbuying/identity-assets');
 
 const PNG_BUFFER = Buffer.alloc(100);
 const LARGE_BUFFER = Buffer.alloc(600 * 1024); // > 500KB
@@ -14,7 +14,9 @@ const ENV = {
   NOCODB_API_URL: 'http://nocodb.test',
   NOCODB_API_TOKEN: 'test-token',
   NOCODB_LOGO_TABLE_ID: 'tbl_logos_test',
+  NOCODB_PHOTOS_TABLE_ID: 'tbl_photos_test',
   SCREENSHOT_SERVER_URL: 'http://host.docker.internal:3456',
+  GOOGLE_KG_API_KEY: 'test-kg-key',
 };
 
 function makeHelpers(fetchMocks) {
@@ -286,3 +288,273 @@ describe('prefetchLogos', () => {
     expect(brandfetchTracker).toHaveLength(4);
   });
 });
+
+// ─── normalizeInsiderName ─────────────────────────────────────────────────────
+
+describe('normalizeInsiderName', () => {
+  test('strips Dr. prefix and Jr. suffix', () => {
+    expect(normalizeInsiderName('Dr. Jensen Huang Jr.')).toBe('jensen huang');
+  });
+
+  test('strips Mr. prefix and III suffix', () => {
+    expect(normalizeInsiderName('Mr. John Smith III')).toBe('john smith');
+  });
+
+  test('plain name passes through lowercased', () => {
+    expect(normalizeInsiderName('Elon Musk')).toBe('elon musk');
+  });
+
+  test('preserves hyphen and apostrophe in name', () => {
+    expect(normalizeInsiderName("mary-jane o'connor")).toBe("mary-jane o'connor");
+  });
+
+  test('normalizes unicode accented characters via NFKD', () => {
+    expect(normalizeInsiderName('José García')).toBe('jose garcia');
+  });
+
+  test('empty string returns empty string', () => {
+    expect(normalizeInsiderName('')).toBe('');
+  });
+
+  test('null returns empty string', () => {
+    expect(normalizeInsiderName(null)).toBe('');
+  });
+
+  test('undefined returns empty string', () => {
+    expect(normalizeInsiderName(undefined)).toBe('');
+  });
+});
+
+// ─── getInsiderPhoto — helper factories ──────────────────────────────────────
+
+function photosCacheMiss() {
+  return { ok: true, json: async () => ({ list: [] }) };
+}
+
+function photosCacheHit(name_normalized, photo_url, ttl_seconds = 2592000) {
+  const fetched_at = new Date(Date.now() - 1000).toISOString();
+  return {
+    ok: true,
+    json: async () => ({ list: [{ Id: 55, name_normalized, photo_url, source: 'wikidata', fetched_at, ttl_seconds }] }),
+  };
+}
+
+function wikidataHit(imageUrl = 'http://commons.wikimedia.org/wiki/Special:FilePath/JensenHuang.jpg') {
+  return {
+    ok: true,
+    json: async () => ({
+      results: { bindings: [{ image: { value: imageUrl } }] },
+    }),
+  };
+}
+
+function wikidataNoResult() {
+  return {
+    ok: true,
+    json: async () => ({ results: { bindings: [] } }),
+  };
+}
+
+function headOk() {
+  return {
+    ok: true,
+    status: 200,
+    headers: { get: () => 'image/jpeg' },
+  };
+}
+
+function head403() {
+  return {
+    ok: false,
+    status: 403,
+    headers: { get: () => null },
+  };
+}
+
+function kgHit(imageUrl = 'https://kg.example.com/jensen_huang.jpg') {
+  return {
+    ok: true,
+    json: async () => ({
+      itemListElement: [{ result: { image: { contentUrl: imageUrl } } }],
+    }),
+  };
+}
+
+function kgNoResult() {
+  return {
+    ok: true,
+    json: async () => ({ itemListElement: [] }),
+  };
+}
+
+function makePhotoHelpers(fetchMocks) {
+  return makeHelpers(fetchMocks);
+}
+
+// ─── getInsiderPhoto — cache hit ──────────────────────────────────────────────
+
+describe('getInsiderPhoto — cache hit', () => {
+  test('returns cached URL without calling Wikidata', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheHit('jensen huang', 'https://r2.dev/photos/jensen-huang.jpg'),
+    ]);
+    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    expect(url).toBe('https://r2.dev/photos/jensen-huang.jpg');
+    expect(helpers.fetchFn).toHaveBeenCalledTimes(1); // only NocoDB GET
+  });
+});
+
+// ─── getInsiderPhoto — Wikidata hit ───────────────────────────────────────────
+
+describe('getInsiderPhoto — Wikidata hit', () => {
+  test('Wikidata SPARQL returns image → verifies via HEAD → caches with source wikidata', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),   // initial cache check
+      wikidataHit(),       // Wikidata SPARQL
+      headOk(),            // HEAD verify
+      photosCacheMiss(),   // _cacheSet existence check
+      nocoDone(),          // NocoDB POST
+    ]);
+    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    expect(url).toContain('commons.wikimedia.org');
+    // Find the NocoDB POST (not the Wikidata SPARQL POST)
+    const postCall = helpers.fetchFn.mock.calls.find(
+      c => c[1] && c[1].method === 'POST' && c[0].includes('nocodb')
+    );
+    const posted = JSON.parse(postCall[1].body);
+    expect(posted.source).toBe('wikidata');
+  });
+
+  test('Wikidata SPARQL request includes descriptive User-Agent header', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),
+      wikidataHit(),
+      headOk(),
+      photosCacheMiss(),
+      nocoDone(),
+    ]);
+    await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    const wikidataCall = helpers.fetchFn.mock.calls.find(c => c[0].includes('wikidata.org'));
+    expect(wikidataCall).toBeDefined();
+    const headers = wikidataCall[1] && wikidataCall[1].headers;
+    expect(headers['User-Agent'] || headers['user-agent']).toMatch(/EarlyInsiderBot/);
+  });
+
+  test('Wikidata HEAD request uses redirect: follow', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),
+      wikidataHit(),
+      headOk(),
+      photosCacheMiss(),
+      nocoDone(),
+    ]);
+    await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    // Find the HEAD call (not the SPARQL POST)
+    const headCall = helpers.fetchFn.mock.calls.find(
+      c => c[1] && c[1].method === 'HEAD'
+    );
+    expect(headCall).toBeDefined();
+    expect(headCall[1].redirect).toBe('follow');
+  });
+});
+
+// ─── getInsiderPhoto — Wikidata miss → Google KG ─────────────────────────────
+
+describe('getInsiderPhoto — Wikidata miss → Google KG', () => {
+  test('Wikidata SPARQL no image → falls to Google KG', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),
+      wikidataNoResult(),  // Wikidata: no results
+      kgHit(),             // Google KG hit
+      headOk(),            // HEAD verify
+      photosCacheMiss(),   // _cacheSet existence check
+      nocoDone(),          // NocoDB POST
+    ]);
+    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    expect(url).toContain('kg.example.com');
+    // Find the NocoDB POST (not the Wikidata SPARQL POST)
+    const postCall = helpers.fetchFn.mock.calls.find(
+      c => c[1] && c[1].method === 'POST' && c[0].includes('nocodb')
+    );
+    const posted = JSON.parse(postCall[1].body);
+    expect(posted.source).toBe('google_kg');
+  });
+
+  test('Wikidata timeout → falls to Google KG', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),
+      () => Promise.reject(new Error('AbortError: timeout')), // Wikidata timeout
+      kgHit(),
+      headOk(),
+      photosCacheMiss(),
+      nocoDone(),
+    ]);
+    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    expect(url).toContain('kg.example.com');
+  });
+});
+
+// ─── getInsiderPhoto — Google KG failures → UI Avatars ────────────────────────
+
+describe('getInsiderPhoto — Google KG failures → UI Avatars', () => {
+  test('Google KG image URL returns 403 → falls to UI Avatars', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),
+      wikidataNoResult(),  // Wikidata: no results
+      kgHit(),             // Google KG returns URL
+      head403(),           // HEAD returns 403 — blocked image
+      photosCacheMiss(),   // _cacheSet existence check (UI Avatars)
+      nocoDone(),          // NocoDB POST
+    ]);
+    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    expect(url).toContain('ui-avatars.com');
+  });
+
+  test('Google KG timeout → falls to UI Avatars', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),
+      wikidataNoResult(),
+      () => Promise.reject(new Error('AbortError: timeout')), // KG timeout
+      photosCacheMiss(),
+      nocoDone(),
+    ]);
+    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    expect(url).toContain('ui-avatars.com');
+  });
+});
+
+// ─── getInsiderPhoto — UI Avatars fallback ────────────────────────────────────
+
+describe('getInsiderPhoto — UI Avatars fallback', () => {
+  test('UI Avatars URL includes firstName+lastName from normalized name', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),
+      wikidataNoResult(),
+      kgNoResult(),
+      photosCacheMiss(),
+      nocoDone(),
+    ]);
+    const url = await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    expect(url).toContain('ui-avatars.com');
+    // normalized "jensen huang" → firstName=jensen, lastName=huang
+    expect(url).toContain('jensen');
+    expect(url).toContain('huang');
+  });
+
+  test('UI Avatars result cached with source ui_avatars', async () => {
+    const helpers = makePhotoHelpers([
+      photosCacheMiss(),
+      wikidataNoResult(),
+      kgNoResult(),
+      photosCacheMiss(),
+      nocoDone(),
+    ]);
+    await getInsiderPhoto('Jensen Huang', 'CEO', helpers);
+    // Find the NocoDB POST (not the Wikidata SPARQL POST)
+    const postCall = helpers.fetchFn.mock.calls.find(
+      c => c[1] && c[1].method === 'POST' && c[0].includes('nocodb')
+    );
+    const posted = JSON.parse(postCall[1].body);
+    expect(posted.source).toBe('ui_avatars');
+  });
+});
