diff --git a/ryan_cole/insiderbuying-site/.env.example b/ryan_cole/insiderbuying-site/.env.example
index de1096b..aafbfbb 100644
--- a/ryan_cole/insiderbuying-site/.env.example
+++ b/ryan_cole/insiderbuying-site/.env.example
@@ -28,3 +28,8 @@ RESEND_API_KEY=                       # re_... (SERVER ONLY)
 
 # === Site ===
 NEXT_PUBLIC_SITE_URL=                 # https://insiderbuying.ai
+
+# === SEO Tools ===
+KWE_API_KEY=                          # Keywords Everywhere API key (Bronze plan, $1.75/month)
+DATAFORSEO_LOGIN=                     # DataForSEO fallback for keyword overview
+DATAFORSEO_PASSWORD=                  # DataForSEO fallback for keyword overview
diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/select-keyword.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/select-keyword.js
index ae8585b..232d9ef 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/select-keyword.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/select-keyword.js
@@ -1,59 +1,64 @@
 /**
- * W1 — Keyword Selection Workflow (n8n Code Node)
+ * W1 -- Keyword Selection Workflow (n8n Code Node)
  *
  * Weekly workflow that generates seed keywords, fetches SEO data from
- * DataForSEO, classifies intent, scores priority, deduplicates against
- * existing NocoDB entries, and selects the top 21 keywords per blog.
+ * Keywords Everywhere (primary) or DataForSEO (fallback), classifies intent,
+ * scores priority, deduplicates against existing NocoDB entries, and selects
+ * the top 21 keywords per blog.
  *
- * Trigger: Schedule — every Sunday at midnight EST
+ * Trigger: Schedule -- every Sunday at midnight EST
  */
 
 'use strict';
 
+var _https = require('https');
+var _http = require('http');
+var { URL } = require('url');
+
 // ---------------------------------------------------------------------------
 // Constants
 // ---------------------------------------------------------------------------
 
-const TYPE_MAP = {
+var TYPE_MAP = {
   A: ['earnings', 'analysis', 'forecast', 'valuation', 'revenue', 'results', 'financials'],
   B: ['why', 'how', 'signal', 'insider', 'buying', 'selling', 'pattern', 'meaning'],
   C: ['vs', 'compare', 'best', 'top', 'alternative', 'which'],
   D: ['strategy', 'guide', 'opinion', 'approach', 'should', 'when'],
 };
 
-const INTENT_MULTIPLIERS = {
+var INTENT_MULTIPLIERS = {
   A: 1.0,
   B: 1.2,
   C: 0.8,
   D: 0.9,
 };
 
-const KEYWORDS_PER_BLOG = 21; // 3/day * 7 days
+var KEYWORDS_PER_BLOG = 21; // 3/day * 7 days
 
-const BLOG_SEED_PATTERNS = {
+var BLOG_SEED_PATTERNS = {
   insiderbuying: [
-    (ticker) => `insider buying ${ticker}`,
-    (ticker) => `insider selling ${ticker}`,
-    (ticker) => `Form 4 filing ${ticker}`,
-    (ticker) => `insider trading signal ${ticker}`,
-    (ticker) => `${ticker} insider transactions`,
+    function(ticker) { return 'insider buying ' + ticker; },
+    function(ticker) { return 'insider selling ' + ticker; },
+    function(ticker) { return 'Form 4 filing ' + ticker; },
+    function(ticker) { return 'insider trading signal ' + ticker; },
+    function(ticker) { return ticker + ' insider transactions'; },
   ],
   deepstockanalysis: [
-    (ticker) => `${ticker} earnings analysis`,
-    (ticker) => `${ticker} stock forecast`,
-    (ticker) => `${ticker} valuation`,
-    (ticker) => `${ticker} revenue growth`,
+    function(ticker) { return ticker + ' earnings analysis'; },
+    function(ticker) { return ticker + ' stock forecast'; },
+    function(ticker) { return ticker + ' valuation'; },
+    function(ticker) { return ticker + ' revenue growth'; },
   ],
   dividenddeep: [
-    (ticker) => `${ticker} dividend safety`,
-    (ticker) => `best dividend stocks ${ticker}`,
-    (ticker) => `${ticker} payout ratio`,
-    (ticker) => `${ticker} dividend yield analysis`,
+    function(ticker) { return ticker + ' dividend safety'; },
+    function(ticker) { return 'best dividend stocks ' + ticker; },
+    function(ticker) { return ticker + ' payout ratio'; },
+    function(ticker) { return ticker + ' dividend yield analysis'; },
   ],
 };
 
 // Sector-level seeds (no ticker needed)
-const BLOG_SECTOR_SEEDS = {
+var BLOG_SECTOR_SEEDS = {
   insiderbuying: [
     'insider buying signals this week',
     'most significant insider purchases',
@@ -66,13 +71,13 @@ const BLOG_SECTOR_SEEDS = {
     'stock comparison sector',
   ],
   dividenddeep: [
-    `best dividend stocks ${new Date().getFullYear()}`,
+    'best dividend stocks ' + new Date().getFullYear(),
     'dividend aristocrats analysis',
     'high yield dividend safety',
   ],
 };
 
-const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
+var DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
 
 // ---------------------------------------------------------------------------
 // Intent classification
@@ -81,16 +86,16 @@ const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';
 function classifyIntent(keyword) {
   if (!keyword || typeof keyword !== 'string') return 'A';
 
-  const lower = keyword.toLowerCase();
-  const words = lower.split(/\s+/);
+  var lower = keyword.toLowerCase();
 
   // Check types in priority order: C and D first (more specific),
   // then B, then A. This prevents "insider buying strategy guide"
   // from matching B (insider/buying) instead of D (strategy/guide).
-  // Use word-boundary matching to avoid "top" matching inside "stopped".
-  for (const type of ['C', 'D', 'B', 'A']) {
-    for (const signal of TYPE_MAP[type]) {
-      const re = new RegExp(`\\b${signal}\\b`, 'i');
+  for (var i = 0; i < ['C', 'D', 'B', 'A'].length; i++) {
+    var type = ['C', 'D', 'B', 'A'][i];
+    for (var j = 0; j < TYPE_MAP[type].length; j++) {
+      var signal = TYPE_MAP[type][j];
+      var re = new RegExp('\\b' + signal + '\\b', 'i');
       if (re.test(lower)) {
         return type;
       }
@@ -104,11 +109,10 @@ function classifyIntent(keyword) {
 // Priority scoring
 // ---------------------------------------------------------------------------
 
-function computePriorityScore(searchVolume, difficulty, intentMultiplier) {
-  const vol = searchVolume || 0;
-  const diff = difficulty || 0;
-  const mult = intentMultiplier || 1.0;
-  return Math.round(vol * (1 - diff / 100) * mult * 100) / 100;
+function computePriorityScore(opts) {
+  var vol = (opts && opts.volume) || 0;
+  var kd = Math.min((opts && opts.kd) || 0, 100);
+  return (vol / 1000) * (1 - kd / 100);
 }
 
 // ---------------------------------------------------------------------------
@@ -116,21 +120,25 @@ function computePriorityScore(searchVolume, difficulty, intentMultiplier) {
 // ---------------------------------------------------------------------------
 
 function generateSeedKeywords(blog, tickers) {
-  const patterns = BLOG_SEED_PATTERNS[blog];
+  var patterns = BLOG_SEED_PATTERNS[blog];
   if (!patterns) return [];
 
-  const seeds = [];
+  var seeds = [];
 
   // Ticker-based seeds
-  for (const ticker of (tickers || [])) {
-    for (const pattern of patterns) {
-      seeds.push(pattern(ticker));
+  var tickerList = tickers || [];
+  for (var i = 0; i < tickerList.length; i++) {
+    var ticker = tickerList[i];
+    for (var j = 0; j < patterns.length; j++) {
+      seeds.push(patterns[j](ticker));
     }
   }
 
   // Sector-level seeds
-  const sectorSeeds = BLOG_SECTOR_SEEDS[blog] || [];
-  seeds.push(...sectorSeeds);
+  var sectorSeeds = BLOG_SECTOR_SEEDS[blog] || [];
+  for (var k = 0; k < sectorSeeds.length; k++) {
+    seeds.push(sectorSeeds[k]);
+  }
 
   return seeds;
 }
@@ -141,62 +149,83 @@ function generateSeedKeywords(blog, tickers) {
 
 function isDuplicate(keyword, existingKeywords) {
   if (!keyword || !existingKeywords || existingKeywords.length === 0) return false;
-  const lower = keyword.toLowerCase().trim();
-  return existingKeywords.some((existing) =>
-    existing.toLowerCase().trim() === lower
-  );
+  var lower = keyword.toLowerCase().trim();
+  for (var i = 0; i < existingKeywords.length; i++) {
+    if (existingKeywords[i].toLowerCase().trim() === lower) return true;
+  }
+  return false;
 }
 
 // ---------------------------------------------------------------------------
 // Top keyword selection
 // ---------------------------------------------------------------------------
 
-function selectTopKeywords(candidates, limit = KEYWORDS_PER_BLOG) {
-  return [...candidates]
-    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
-    .slice(0, limit);
+function selectTopKeywords(candidates, limit) {
+  var cap = limit !== undefined ? limit : KEYWORDS_PER_BLOG;
+  return candidates.slice().sort(function(a, b) {
+    return ((b.priority_score || 0) - (a.priority_score || 0));
+  }).slice(0, cap);
 }
 
 // ---------------------------------------------------------------------------
-// DataForSEO API helpers
+// Keywords Everywhere (KWE) primary fetch function
 // ---------------------------------------------------------------------------
 
-function buildDataForSEOAuth(login, password) {
-  const encoded = Buffer.from(`${login}:${password}`).toString('base64');
-  return `Basic ${encoded}`;
-}
-
-async function fetchSearchVolume(keywords, auth, opts = {}) {
-  const { fetchFn } = opts;
+async function fetchKWEKeywords(keywords, opts) {
+  var fetchFn = (opts || {}).fetchFn;
   if (!fetchFn) throw new Error('fetchFn is required');
 
-  const response = await fetchFn(
-    `${DATAFORSEO_BASE}/keywords_data/google_ads/search_volume/live`,
+  if (!keywords || keywords.length === 0) return [];
+
+  var response = await fetchFn(
+    'https://api.keywordseverywhere.com/v1/get_keyword_data',
     {
       method: 'POST',
       headers: {
-        'Authorization': auth,
+        'Authorization': 'Bearer ' + process.env.KWE_API_KEY,
+        'Accept': 'application/json',
         'Content-Type': 'application/json',
       },
-      body: JSON.stringify([{
-        keywords,
-        location_code: 2840, // US
-        language_code: 'en',
-      }]),
+      body: JSON.stringify({
+        country: 'us',
+        currency: 'usd',
+        dataSource: 'gkp',
+        'kw[]': keywords,
+      }),
     }
   );
 
-  if (!response.ok) return null;
-  const data = await response.json();
-  return data?.tasks?.[0]?.result || [];
+  if (!response.ok) {
+    throw new Error('KWE API error ' + response.status);
+  }
+
+  var json = await response.json();
+  return (json.data || []).map(function(item) {
+    return {
+      keyword: item.keyword,
+      kd: item.seo_difficulty != null ? item.seo_difficulty
+        : (item.on_page_difficulty != null ? item.on_page_difficulty : 50),
+      volume: item.vol != null ? item.vol : 0,
+      cpc: (item.competition && item.competition.value != null) ? item.competition.value : null,
+    };
+  });
 }
 
-async function fetchRelatedKeywords(keywords, auth, opts = {}) {
-  const { fetchFn } = opts;
+// ---------------------------------------------------------------------------
+// DataForSEO fallback (only invoked inside fetchKeywordData wrapper)
+// Uses dataforseo_labs/google/keyword_overview/live endpoint
+// ---------------------------------------------------------------------------
+
+async function fetchDataForSEOFallback(keywords, opts) {
+  var fetchFn = (opts || {}).fetchFn;
   if (!fetchFn) throw new Error('fetchFn is required');
 
-  const response = await fetchFn(
-    `${DATAFORSEO_BASE}/keywords_data/google_ads/keywords_for_keywords/live`,
+  var login = process.env.DATAFORSEO_LOGIN || '';
+  var password = process.env.DATAFORSEO_PASSWORD || '';
+  var auth = 'Basic ' + Buffer.from(login + ':' + password).toString('base64');
+
+  var response = await fetchFn(
+    DATAFORSEO_BASE + '/dataforseo_labs/google/keyword_overview/live',
     {
       method: 'POST',
       headers: {
@@ -204,126 +233,129 @@ async function fetchRelatedKeywords(keywords, auth, opts = {}) {
         'Content-Type': 'application/json',
       },
       body: JSON.stringify([{
-        keywords,
-        location_code: 2840,
+        keywords: keywords,
+        language_code: 'en',
+        location_code: 2840, // US
       }]),
     }
   );
 
-  if (!response.ok) return [];
-  const data = await response.json();
-  return data?.tasks?.[0]?.result || [];
+  if (!response.ok) {
+    throw new Error('DataForSEO API error ' + response.status);
+  }
+
+  var data = await response.json();
+  var results = (data && data.tasks && data.tasks[0] && data.tasks[0].result) || [];
+
+  return results.map(function(item) {
+    return {
+      keyword: item.keyword,
+      kd: (item.keyword_properties && item.keyword_properties.keyword_difficulty) || 0,
+      volume: (item.keyword_info && item.keyword_info.search_volume) || 0,
+      cpc: (item.keyword_info && item.keyword_info.cpc) || null,
+    };
+  });
+}
+
+// ---------------------------------------------------------------------------
+// Combined fetch wrapper -- transparent KWE -> DataForSEO fallback
+// This is the only function callers inside runKeywordPipeline should use.
+// ---------------------------------------------------------------------------
+
+async function fetchKeywordData(keywords, opts) {
+  try {
+    return await fetchKWEKeywords(keywords, opts);
+  } catch (err) {
+    console.warn('[SEO] KWE failed, falling back to DataForSEO:', err.message);
+    return await fetchDataForSEOFallback(keywords, opts);
+  }
 }
 
 // ---------------------------------------------------------------------------
 // Full keyword pipeline for one blog
 // ---------------------------------------------------------------------------
 
-async function runKeywordPipeline(blog, tickers, existingKeywords, opts = {}) {
-  const { fetchFn, dataForSEOAuth } = opts;
+async function runKeywordPipeline(blog, tickers, existingKeywords, opts) {
+  var fetchFn = (opts || {}).fetchFn;
 
   // Step 1: Generate seeds
-  const seeds = generateSeedKeywords(blog, tickers);
+  var seeds = generateSeedKeywords(blog, tickers);
   if (seeds.length === 0) {
-    return { blog, keywords: [], warning: `No seed patterns for blog: ${blog}` };
+    return { blog: blog, keywords: [], warning: 'No seed patterns for blog: ' + blog };
   }
 
-  let allCandidates = [];
+  var allCandidates = [];
 
-  // Step 2: Fetch SEO data (if DataForSEO available)
-  if (fetchFn && dataForSEOAuth) {
+  // Step 2: Fetch SEO data via fetchKeywordData (KWE primary, DataForSEO fallback)
+  if (fetchFn) {
     try {
-      const [volumeResults, relatedResults] = await Promise.allSettled([
-        fetchSearchVolume(seeds, dataForSEOAuth, { fetchFn }),
-        fetchRelatedKeywords(seeds, dataForSEOAuth, { fetchFn }),
-      ]);
-
-      // Process volume results
-      if (volumeResults.status === 'fulfilled' && volumeResults.value) {
-        for (const item of volumeResults.value) {
-          if (!item?.keyword) continue;
-          const type = classifyIntent(item.keyword);
+      var kwData = await fetchKeywordData(seeds, { fetchFn: fetchFn });
+
+      if (!kwData || kwData.length === 0) {
+        console.warn('[SEO] No keyword data returned for blog: ' + blog);
+      } else {
+        for (var i = 0; i < kwData.length; i++) {
+          var item = kwData[i];
+          if (!item || !item.keyword) continue;
+          var type = classifyIntent(item.keyword);
           allCandidates.push({
             keyword: item.keyword,
-            blog,
-            search_volume: item.search_volume || 0,
-            difficulty: item.keyword_info?.keyword_difficulty || 0,
-            cpc: item.cpc || 0,
+            blog: blog,
+            kd: item.kd,
+            volume: item.volume,
+            cpc: item.cpc,
             article_type: type,
             intent_multiplier: INTENT_MULTIPLIERS[type],
-            priority_score: computePriorityScore(
-              item.search_volume || 0,
-              item.keyword_info?.keyword_difficulty || 0,
-              INTENT_MULTIPLIERS[type]
-            ),
-          });
-        }
-      }
-
-      // Process related keywords
-      if (relatedResults.status === 'fulfilled' && relatedResults.value) {
-        for (const item of relatedResults.value) {
-          if (!item?.keyword) continue;
-          const type = classifyIntent(item.keyword);
-          allCandidates.push({
-            keyword: item.keyword,
-            blog,
-            search_volume: item.search_volume || 0,
-            difficulty: item.keyword_info?.keyword_difficulty || 0,
-            cpc: item.cpc || 0,
-            article_type: type,
-            intent_multiplier: INTENT_MULTIPLIERS[type],
-            priority_score: computePriorityScore(
-              item.search_volume || 0,
-              item.keyword_info?.keyword_difficulty || 0,
-              INTENT_MULTIPLIERS[type]
-            ),
+            priority_score: computePriorityScore({ kd: item.kd, volume: item.volume }),
           });
         }
       }
     } catch (err) {
-      console.warn(`DataForSEO failed for ${blog}: ${err.message}. Falling back to seeds only.`);
+      console.warn('[SEO] Keyword data fetch failed for ' + blog + ': ' + err.message + '. Falling back to seeds only.');
     }
   }
 
-  // Fallback: if no API results, use seeds with default scores
+  // Fallback: if no API results, use seeds with zero scores
   if (allCandidates.length === 0) {
-    for (const seed of seeds) {
-      const type = classifyIntent(seed);
+    for (var j = 0; j < seeds.length; j++) {
+      var seed = seeds[j];
+      var seedType = classifyIntent(seed);
       allCandidates.push({
         keyword: seed,
-        blog,
-        search_volume: 0,
-        difficulty: 0,
+        blog: blog,
+        kd: 0,
+        volume: 0,
         cpc: 0,
-        article_type: type,
-        intent_multiplier: INTENT_MULTIPLIERS[type],
+        article_type: seedType,
+        intent_multiplier: INTENT_MULTIPLIERS[seedType],
         priority_score: 0,
       });
     }
   }
 
-  // Step 3a: Self-dedup within candidate pool (API may return same keyword twice)
-  const seen = new Set();
-  allCandidates = allCandidates.filter((c) => {
-    const key = c.keyword.toLowerCase().trim();
+  // Step 3a: Self-dedup within candidate pool
+  var seen = new Set();
+  allCandidates = allCandidates.filter(function(c) {
+    var key = c.keyword.toLowerCase().trim();
     if (seen.has(key)) return false;
     seen.add(key);
     return true;
   });
 
   // Step 3b: Dedup against existing NocoDB keywords
-  allCandidates = allCandidates.filter((c) => !isDuplicate(c.keyword, existingKeywords || []));
+  allCandidates = allCandidates.filter(function(c) {
+    return !isDuplicate(c.keyword, existingKeywords || []);
+  });
 
   // Step 4: Select top 21
-  const selected = selectTopKeywords(allCandidates, KEYWORDS_PER_BLOG);
+  var selected = selectTopKeywords(allCandidates, KEYWORDS_PER_BLOG);
 
   // Step 5: Warning if too few
-  const warning = selected.length < 7
-    ? `WARNING: Blog "${blog}" has only ${selected.length} new keywords (< 7 minimum)`
+  var warning = selected.length < 7
+    ? 'WARNING: Blog "' + blog + '" has only ' + selected.length + ' new keywords (< 7 minimum)'
     : null;
 
-  return { blog, keywords: selected, warning };
+  return { blog: blog, keywords: selected, warning: warning };
 }
 
 // ---------------------------------------------------------------------------
@@ -331,30 +363,24 @@ async function runKeywordPipeline(blog, tickers, existingKeywords, opts = {}) {
 // ---------------------------------------------------------------------------
 
 async function selectKeywords(input, helpers) {
-  const activeBlogs = input.active_blogs || ['insiderbuying'];
-  const tickers = input.tickers || [];
-  const existingKeywords = input.existing_keywords || [];
-  const dataForSEOLogin = helpers?.env?.DATAFORSEO_LOGIN;
-  const dataForSEOPassword = helpers?.env?.DATAFORSEO_PASSWORD;
-
-  const auth = dataForSEOLogin && dataForSEOPassword
-    ? buildDataForSEOAuth(dataForSEOLogin, dataForSEOPassword)
-    : null;
+  var activeBlogs = input.active_blogs || ['insiderbuying'];
+  var tickers = input.tickers || [];
+  var existingKeywords = input.existing_keywords || [];
 
-  const results = [];
+  var results = [];
 
-  for (const blog of activeBlogs) {
-    const result = await runKeywordPipeline(blog, tickers, existingKeywords, {
-      fetchFn: helpers?.fetchFn,
-      dataForSEOAuth: auth,
+  for (var i = 0; i < activeBlogs.length; i++) {
+    var blog = activeBlogs[i];
+    var result = await runKeywordPipeline(blog, tickers, existingKeywords, {
+      fetchFn: helpers && helpers.fetchFn,
     });
     results.push(result);
   }
 
   return {
-    total_keywords: results.reduce((sum, r) => sum + r.keywords.length, 0),
+    total_keywords: results.reduce(function(sum, r) { return sum + r.keywords.length; }, 0),
     blogs: results,
-    warnings: results.filter((r) => r.warning).map((r) => r.warning),
+    warnings: results.filter(function(r) { return r.warning; }).map(function(r) { return r.warning; }),
   };
 }
 
@@ -371,9 +397,9 @@ module.exports = {
   selectTopKeywords,
   runKeywordPipeline,
   selectKeywords,
-  buildDataForSEOAuth,
-  fetchSearchVolume,
-  fetchRelatedKeywords,
+  fetchKWEKeywords,
+  fetchDataForSEOFallback,
+  fetchKeywordData,
 
   // Constants
   TYPE_MAP,
diff --git a/ryan_cole/insiderbuying-site/n8n/tests/select-keyword.test.js b/ryan_cole/insiderbuying-site/n8n/tests/select-keyword.test.js
index 575b0b6..7533343 100644
--- a/ryan_cole/insiderbuying-site/n8n/tests/select-keyword.test.js
+++ b/ryan_cole/insiderbuying-site/n8n/tests/select-keyword.test.js
@@ -1,4 +1,4 @@
-const { describe, it } = require('node:test');
+const { describe, it, before, after } = require('node:test');
 const assert = require('node:assert/strict');
 
 const {
@@ -7,6 +7,7 @@ const {
   generateSeedKeywords,
   isDuplicate,
   selectTopKeywords,
+  fetchKWEKeywords,
   INTENT_MULTIPLIERS,
   TYPE_MAP,
   BLOG_SEED_PATTERNS,
@@ -51,29 +52,46 @@ describe('classifyIntent', () => {
 });
 
 // ---------------------------------------------------------------------------
-// Test: Priority scoring
+// Test: Priority scoring (updated: {kd, volume} signature, new formula)
 // ---------------------------------------------------------------------------
 describe('computePriorityScore', () => {
-  it('volume=1000, difficulty=30, multiplier=1.2 -> 840', () => {
-    const score = computePriorityScore(1000, 30, 1.2);
-    assert.equal(score, 840);
+  it('{volume:1000, kd:30} -> 0.7', () => {
+    const score = computePriorityScore({ volume: 1000, kd: 30 });
+    assert.ok(Math.abs(score - 0.7) < 0.001, `expected ~0.7, got ${score}`);
   });
 
-  it('volume=500, difficulty=0, multiplier=1.0 -> 500', () => {
-    assert.equal(computePriorityScore(500, 0, 1.0), 500);
+  it('{volume:500, kd:0} -> 0.5', () => {
+    assert.ok(Math.abs(computePriorityScore({ volume: 500, kd: 0 }) - 0.5) < 0.001);
   });
 
-  it('volume=0 -> 0 regardless of other params', () => {
-    assert.equal(computePriorityScore(0, 50, 1.2), 0);
+  it('{volume:0} -> 0 regardless of kd', () => {
+    assert.equal(computePriorityScore({ volume: 0, kd: 50 }), 0);
   });
 
-  it('difficulty=100 -> 0 regardless of volume', () => {
-    assert.equal(computePriorityScore(1000, 100, 1.0), 0);
+  it('{kd:100} -> 0 regardless of volume', () => {
+    assert.equal(computePriorityScore({ volume: 1000, kd: 100 }), 0);
   });
 
   it('handles missing/null inputs gracefully', () => {
-    assert.equal(computePriorityScore(null, 30, 1.0), 0);
-    assert.equal(computePriorityScore(1000, null, 1.0), 1000);
+    assert.equal(computePriorityScore({ volume: null, kd: 30 }), 0);
+    assert.ok(Math.abs(computePriorityScore({ volume: 1000, kd: null }) - 1.0) < 0.001);
+  });
+
+  it('low-kd/high-volume scores higher than high-kd/low-volume', () => {
+    const good = computePriorityScore({ volume: 2000, kd: 10 });
+    const poor = computePriorityScore({ volume: 100, kd: 80 });
+    assert.ok(good > poor, `expected ${good} > ${poor}`);
+  });
+
+  it('DataForSEO field names not in function body', () => {
+    const src = require('fs').readFileSync(
+      require('path').join(__dirname, '../code/insiderbuying/select-keyword.js'), 'utf8'
+    );
+    const fnStart = src.indexOf('function computePriorityScore');
+    const fnEnd = src.indexOf('}', fnStart);
+    const fnBody = src.slice(fnStart, fnEnd + 1);
+    assert.ok(!fnBody.includes('competition_index'), 'competition_index should not be in computePriorityScore');
+    assert.ok(!fnBody.includes('search_volume'), 'search_volume should not be in computePriorityScore');
   });
 });
 
@@ -83,7 +101,6 @@ describe('computePriorityScore', () => {
 describe('generateSeedKeywords', () => {
   it('insiderbuying seeds contain insider buying / Form 4 / insider trading patterns', () => {
     const seeds = generateSeedKeywords('insiderbuying', ['AAPL', 'NVDA']);
-    const joined = seeds.join(' ');
     assert.ok(seeds.some((s) => s.toLowerCase().includes('insider buying')),
       'Should contain "insider buying"');
     assert.ok(seeds.some((s) => s.includes('Form 4')),
@@ -137,7 +154,7 @@ describe('isDuplicate', () => {
 });
 
 // ---------------------------------------------------------------------------
-// Test: Batch output — selectTopKeywords produces exactly 21
+// Test: Batch output -- selectTopKeywords produces exactly 21
 // ---------------------------------------------------------------------------
 describe('selectTopKeywords', () => {
   it('returns exactly 21 keywords from larger pool', () => {
@@ -145,12 +162,12 @@ describe('selectTopKeywords', () => {
     for (let i = 0; i < 50; i++) {
       candidates.push({
         keyword: `keyword ${i}`,
-        search_volume: 1000 - i * 10,
-        difficulty: 20 + i,
+        volume: 1000 - i * 10,
+        kd: 20 + i,
         cpc: 1.5,
         article_type: 'A',
         intent_multiplier: 1.0,
-        priority_score: computePriorityScore(1000 - i * 10, 20 + i, 1.0),
+        priority_score: computePriorityScore({ volume: 1000 - i * 10, kd: 20 + i }),
       });
     }
     const selected = selectTopKeywords(candidates, 21);
@@ -180,7 +197,7 @@ describe('selectTopKeywords', () => {
 });
 
 // ---------------------------------------------------------------------------
-// Test: Multi-blog — 2 blogs produce 42 keywords
+// Test: Multi-blog -- 2 blogs produce 42 keywords
 // ---------------------------------------------------------------------------
 describe('multi-blog keyword selection', () => {
   it('2 active blogs produce separate keyword sets', () => {
@@ -249,3 +266,122 @@ describe('TYPE_MAP', () => {
     assert.ok(TYPE_MAP.D.includes('should'));
   });
 });
+
+// ---------------------------------------------------------------------------
+// Test: fetchKWEKeywords
+// ---------------------------------------------------------------------------
+describe('fetchKWEKeywords', () => {
+  let savedKWEKey;
+
+  before(() => {
+    savedKWEKey = process.env.KWE_API_KEY;
+    process.env.KWE_API_KEY = 'test-kwe-key';
+  });
+
+  after(() => {
+    if (savedKWEKey === undefined) delete process.env.KWE_API_KEY;
+    else process.env.KWE_API_KEY = savedKWEKey;
+  });
+
+  it('happy path: returns {keyword, kd, volume, cpc} mapped from KWE response', async () => {
+    const mockFetch = async () => ({
+      ok: true,
+      status: 200,
+      json: async () => ({
+        data: [
+          { keyword: 'insider buying AAPL', seo_difficulty: 35, vol: 1000, competition: { value: 0.45 } },
+          { keyword: 'form 4 NVDA', seo_difficulty: 50, vol: 500, competition: { value: 0.30 } },
+        ],
+      }),
+    });
+
+    const result = await fetchKWEKeywords(['insider buying AAPL', 'form 4 NVDA'], { fetchFn: mockFetch });
+    assert.equal(result.length, 2);
+    assert.equal(result[0].keyword, 'insider buying AAPL');
+    assert.equal(result[0].kd, 35);
+    assert.equal(result[0].volume, 1000);
+    assert.equal(result[0].cpc, 0.45);
+    // exactly 4 fields, no extras
+    assert.deepStrictEqual(Object.keys(result[0]).sort(), ['cpc', 'kd', 'keyword', 'volume']);
+  });
+
+  it('kd falls back to on_page_difficulty when seo_difficulty is absent', async () => {
+    const mockFetch = async () => ({
+      ok: true,
+      status: 200,
+      json: async () => ({
+        data: [
+          { keyword: 'test kw', on_page_difficulty: 42, vol: 200, competition: { value: 0.1 } },
+        ],
+      }),
+    });
+
+    const result = await fetchKWEKeywords(['test kw'], { fetchFn: mockFetch });
+    assert.equal(result[0].kd, 42);
+  });
+
+  it('request shape: POST to KWE URL with Authorization Bearer and correct body', async () => {
+    process.env.KWE_API_KEY = 'my-test-api-key';
+    let capturedUrl, capturedOpts;
+    const mockFetch = async (url, options) => {
+      capturedUrl = url;
+      capturedOpts = options;
+      return { ok: true, status: 200, json: async () => ({ data: [] }) };
+    };
+
+    await fetchKWEKeywords(['insider buying'], { fetchFn: mockFetch });
+
+    assert.equal(capturedUrl, 'https://api.keywordseverywhere.com/v1/get_keyword_data');
+    assert.equal(capturedOpts.method, 'POST');
+    assert.ok(capturedOpts.headers['Authorization'].includes('my-test-api-key'),
+      'Authorization header must include KWE_API_KEY');
+    assert.ok(capturedOpts.headers['Authorization'].startsWith('Bearer '),
+      'Authorization header must use Bearer scheme');
+    const body = JSON.parse(capturedOpts.body);
+    assert.equal(body.country, 'us');
+    assert.equal(body.currency, 'usd');
+    assert.equal(body.dataSource, 'gkp');
+    assert.deepStrictEqual(body['kw[]'], ['insider buying']);
+  });
+
+  it('empty keyword list returns [] without making HTTP call', async () => {
+    let called = false;
+    const mockFetch = async () => { called = true; return {}; };
+    const result = await fetchKWEKeywords([], { fetchFn: mockFetch });
+    assert.deepStrictEqual(result, []);
+    assert.equal(called, false, 'fetchFn should not be called for empty list');
+  });
+
+  it('HTTP 5xx throws a descriptive error (not silent empty array)', async () => {
+    const mockFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
+    await assert.rejects(
+      () => fetchKWEKeywords(['test'], { fetchFn: mockFetch }),
+      /503/
+    );
+  });
+
+  it('HTTP 429 throws with "429" in error message', async () => {
+    const mockFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
+    await assert.rejects(
+      () => fetchKWEKeywords(['test'], { fetchFn: mockFetch }),
+      /429/
+    );
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Test: DataForSEO fallback static check
+// ---------------------------------------------------------------------------
+describe('DataForSEO fallback static check', () => {
+  it('fetchSearchVolume and fetchRelatedKeywords are removed; fetchDataForSEOFallback exists', () => {
+    const src = require('fs').readFileSync(
+      require('path').join(__dirname, '../code/insiderbuying/select-keyword.js'), 'utf8'
+    );
+    assert.ok(!src.includes('fetchSearchVolume'),
+      'fetchSearchVolume should be removed from select-keyword.js');
+    assert.ok(!src.includes('fetchRelatedKeywords'),
+      'fetchRelatedKeywords should be removed from select-keyword.js');
+    assert.ok(src.includes('fetchDataForSEOFallback'),
+      'fetchDataForSEOFallback named fallback must exist');
+  });
+});
