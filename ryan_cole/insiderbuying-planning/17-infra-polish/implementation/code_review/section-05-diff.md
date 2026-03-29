warning: in the working copy of 'ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'ryan_cole/insiderbuying-site/next.config.ts', LF will be replaced by CRLF the next time Git touches it
diff --git a/ryan_cole/insiderbuying-site/.env.example b/ryan_cole/insiderbuying-site/.env.example
index aafbfbb..fd9ee09 100644
--- a/ryan_cole/insiderbuying-site/.env.example
+++ b/ryan_cole/insiderbuying-site/.env.example
@@ -33,3 +33,18 @@ NEXT_PUBLIC_SITE_URL=                 # https://insiderbuying.ai
 KWE_API_KEY=                          # Keywords Everywhere API key (Bronze plan, $1.75/month)
 DATAFORSEO_LOGIN=                     # DataForSEO fallback for keyword overview
 DATAFORSEO_PASSWORD=                  # DataForSEO fallback for keyword overview
+
+# === VPS Setup (run once on Hostinger VPS after provisioning) ===
+# free -h  -> must show >= 4GB RAM available
+# Shared VPS services: Toxic or Nah n8n, InsiderBuying n8n, NocoDB
+# If < 4GB: upgrade VPS tier or reduce via EXECUTIONS_DATA_PRUNE and
+#           EXECUTIONS_PROCESS_TIMEOUT
+#
+# Required for content-calendar.js RSS parsing (fast-xml-parser npm package):
+# NODE_FUNCTION_ALLOW_EXTERNAL=fast-xml-parser
+# Add to n8n container .env and restart:
+#   docker-compose -f /docker/n8n/docker-compose.yml up -d
+#
+# For earnings calendar integration (Alpha Vantage delay loop, ~4-5 min/run):
+# EXECUTIONS_PROCESS_TIMEOUT=600
+# ================================================================
diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js
index 0655ed0..1fd894d 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js
@@ -177,6 +177,7 @@ async function getRedditLog(dateStr) {
     var where = '(posted_at,gte,' + dateStr + 'T00:00:00)~and(posted_at,lte,' + dateStr + 'T23:59:59)~and(status,eq,posted)';
     var url = base + '/api/v1/db/data/noco/reddit/Reddit_Log?where=' + encodeURIComponent(where) + '&limit=100';
     var res = await _deps.fetch(url, { headers: { 'xc-token': tok } });
+    if (res.status !== 200) return [];
     var data = res.json();
     return data.list || [];
   } catch (_) { return []; }
@@ -247,7 +248,11 @@ async function getRedditToken(opts) {
 async function shouldSkipToday() {
   try {
     var now = _now();
-    var dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
+    // Derive weekday in EST (VPS runs UTC — getDay() without conversion gives wrong day around midnight EST)
+    var estStr = getESTDateString(now);
+    var estParts = estStr.split('-');
+    var estUtc = new Date(Date.UTC(+estParts[0], +estParts[1] - 1, +estParts[2]));
+    var dayOfWeek = estUtc.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat, timezone-safe
     var currentWeek = getISOWeekKey(now);
 
     var stored = await getState('week_skip_days');
@@ -705,6 +710,26 @@ var SUBREDDIT_TONE_MAP = {
   },
 };
 
+// ---------------------------------------------------------------------------
+// A10: Runtime cap guard — prevents accidental over-posting if limits edited
+// ---------------------------------------------------------------------------
+
+async function checkCapGuard(toneMap, alertFn) {
+  var total = Object.values(toneMap).reduce(function(sum, s) { return sum + (s.dailyCap || 0); }, 0);
+  if (total > 10) {
+    var msg = 'SUBREDDIT_TONE_MAP total daily limit ' + total + ' exceeds max 10';
+    console.error('[REDDIT-CAP]', msg);
+    if (alertFn) {
+      alertFn('ERROR: reddit-monitor cap exceeded -- ' + msg).catch(function() {});
+    }
+    return { error: msg, skipped: true };
+  }
+  return null;
+}
+
+// Module-level check (fire-and-forget, no alert needed at startup)
+checkCapGuard(SUBREDDIT_TONE_MAP, null);
+
 // ---------------------------------------------------------------------------
 // _callClaude — shared Claude API helper
 // ---------------------------------------------------------------------------
@@ -1068,7 +1093,7 @@ function randomBetween(min, max) {
  */
 async function insertJob(type, payload, delayMs) {
   try {
-    var base = process.env.NOCODB_API_URL;
+    var base = process.env.NOCODB_API_URL || NOCODB_BASE_URL;
     var tok = process.env.NOCODB_API_TOKEN || NOCODB_TOKEN;
     var executeAfter = new Date(Date.now() + (delayMs || 0)).toISOString();
     var url = base + '/api/v1/db/data/noco/reddit/Scheduled_Jobs';
@@ -1287,21 +1312,25 @@ async function checkDailyCommentLimit(subreddit) {
 }
 
 async function upvoteContext(postId, comment1Id, comment2Id) {
-  var token = await getRedditToken();
-  var vote = async function(id) {
-    await _deps.fetch('https://oauth.reddit.com/api/vote', {
-      method: 'POST',
-      headers: {
-        'Authorization': 'Bearer ' + token,
-        'Content-Type': 'application/x-www-form-urlencoded',
-        'User-Agent': 'EarlyInsider/1.0',
-      },
-      body: 'id=' + encodeURIComponent(id) + '&dir=1&rank=2',
-    });
-  };
-  await vote(postId);
-  await vote(comment1Id);
-  await vote(comment2Id);
+  try {
+    var token = await getRedditToken();
+    var vote = async function(id) {
+      await _deps.fetch('https://oauth.reddit.com/api/vote', {
+        method: 'POST',
+        headers: {
+          'Authorization': 'Bearer ' + token,
+          'Content-Type': 'application/x-www-form-urlencoded',
+          'User-Agent': 'EarlyInsider/1.0',
+        },
+        body: 'id=' + encodeURIComponent(id) + '&dir=1&rank=2',
+      });
+    };
+    await vote(postId);
+    await vote(comment1Id);
+    await vote(comment2Id);
+  } catch (err) {
+    console.warn('[upvoteContext] failed: ' + err.message);
+  }
 }
 
 async function scheduleEditUpdate(commentId, ticker, subreddit, priceAtPost) {
@@ -1325,6 +1354,7 @@ async function _processRedditReplyDeferred(payload) {
     headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'EarlyInsider/1.0' },
     body: 'thing_id=' + encodeURIComponent(payload.postId) + '&text=' + encodeURIComponent(comment),
   });
+  if (postRes.status !== 200) { console.warn('[_processRedditReplyDeferred] Reddit comment API returned HTTP ' + postRes.status); return; }
   var postData = postRes.json();
   var newCommentName = postData && postData.json && postData.json.data && postData.json.data.things && postData.json.data.things[0] && postData.json.data.things[0].data && postData.json.data.things[0].data.name;
   await _logToRedditLog('', payload.subreddit, comment, 'posted');
@@ -1384,7 +1414,7 @@ async function _processRedditDDReply(payload) {
 
 async function processScheduledJobs(opts) {
   var options = opts || {};
-  var base = process.env.NOCODB_API_URL;
+  var base = process.env.NOCODB_API_URL || NOCODB_BASE_URL;
   var tok = process.env.NOCODB_API_TOKEN || NOCODB_TOKEN;
   var jobs;
   if (options._fixedJobs) {
@@ -1441,7 +1471,7 @@ async function _fetchInsiderData(ticker) {
     var base = process.env.NOCODB_API_URL || 'http://NocoDB:8080';
     var tok = process.env.NOCODB_API_TOKEN || NOCODB_TOKEN;
     var projectId = process.env.NOCODB_PROJECT_ID || NOCODB_PROJECT_ID;
-    var url = base + '/api/v1/db/data/noco/' + projectId + '/Insider_filings?where=(ticker,eq,' + encodeURIComponent(ticker) + ')&sort=-date&limit=1';
+    var url = base + '/api/v1/db/data/noco/' + projectId + '/Insider_Filings?where=(ticker,eq,' + encodeURIComponent(ticker) + ')&sort=-date&limit=1';
     var res = await _deps.fetch(url, { headers: { 'xc-token': tok } });
     if (res.status !== 200) return null;
     var data = res.json();
@@ -1590,4 +1620,7 @@ module.exports = {
 
   // Section 06 — Anti-AI Detection
   buildCommentPrompt: buildCommentPrompt,
+
+  // A10 — cap guard
+  checkCapGuard: checkCapGuard,
 };
diff --git a/ryan_cole/insiderbuying-site/next.config.ts b/ryan_cole/insiderbuying-site/next.config.ts
index 1f6f6ce..95daf5f 100644
--- a/ryan_cole/insiderbuying-site/next.config.ts
+++ b/ryan_cole/insiderbuying-site/next.config.ts
@@ -1,9 +1,21 @@
 import type { NextConfig } from "next";
 
+// next-sitemap.config.js is the single sitemap source of truth
+// src/app/sitemap.ts has been removed to prevent duplicate sitemap generation
+
 const nextConfig: NextConfig = {
   images: {
     unoptimized: true,
   },
+  async redirects() {
+    return [
+      {
+        source: "/sitemap",
+        destination: "/sitemap.xml",
+        permanent: true,
+      },
+    ];
+  },
 };
 
 export default nextConfig;
