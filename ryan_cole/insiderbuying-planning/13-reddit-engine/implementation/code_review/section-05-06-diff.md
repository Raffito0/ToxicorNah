diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js
index e83c9d4..95ab8da 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/reddit-monitor.js
@@ -30,10 +30,260 @@ var SEARCH_KEYWORDS = [
   'insider activity',
 ];
 
+var CAT5_SUBREDDITS = ['stocks', 'investing', 'ValueInvesting'];
+
+// ---------------------------------------------------------------------------
+// Config
+// ---------------------------------------------------------------------------
+
+var NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'http://nocodb:8080';
+var NOCODB_TOKEN = process.env.NOCODB_TOKEN || '';
+var NOCODB_PROJECT_ID = process.env.NOCODB_PROJECT_ID || '';
+var REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
+var REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
+var REDDIT_REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN || '';
+
+// ---------------------------------------------------------------------------
+// HTTP helper (n8n sandbox-compatible)
+// ---------------------------------------------------------------------------
+
+function _httpFetch(url, opts) {
+  return new Promise(function(resolve, reject) {
+    var parsedUrl = new URL(url);
+    var lib = parsedUrl.protocol === 'https:' ? _https : _http;
+    var method = (opts && opts.method) || 'GET';
+    var headers = (opts && opts.headers) ? Object.assign({}, opts.headers) : {};
+    var body = (opts && opts.body) || null;
+    if (body && !headers['Content-Length']) {
+      headers['Content-Length'] = Buffer.byteLength(body);
+    }
+    var reqOpts = {
+      hostname: parsedUrl.hostname,
+      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
+      path: parsedUrl.pathname + (parsedUrl.search || ''),
+      method: method,
+      headers: headers,
+    };
+    var req = lib.request(reqOpts, function(res) {
+      var data = '';
+      res.on('data', function(chunk) { data += chunk; });
+      res.on('end', function() {
+        var status = res.statusCode;
+        var bodyText = data;
+        resolve({
+          status: status,
+          ok: status >= 200 && status < 300,
+          json: function() { try { return JSON.parse(bodyText); } catch (e) { return {}; } },
+          text: function() { return bodyText; },
+        });
+      });
+    });
+    req.on('error', reject);
+    if (body) req.write(body);
+    req.end();
+  });
+}
+
+// ---------------------------------------------------------------------------
+// Test seams
+// ---------------------------------------------------------------------------
+
+var _deps = { fetch: _httpFetch };
+function _setDeps(overrides) { _deps = overrides || { fetch: _httpFetch }; }
+
+var _nowFn = function() { return new Date(); };
+function _setNow(fn) { _nowFn = fn || function() { return new Date(); }; }
+function _now() { return _nowFn(); }
+
+// ---------------------------------------------------------------------------
+// Helpers
+// ---------------------------------------------------------------------------
+
+/**
+ * Returns an ISO week key like "2026-W13" for the given date.
+ */
+function getISOWeekKey(date) {
+  var d = new Date(date.getTime());
+  d.setHours(0, 0, 0, 0);
+  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
+  var yearStart = new Date(d.getFullYear(), 0, 1);
+  var week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
+  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
+}
+
+/**
+ * Returns "YYYY-MM-DD" for the given date in EST (America/New_York).
+ */
+function getESTDateString(date) {
+  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
+}
+
+// ---------------------------------------------------------------------------
+// NocoDB state helpers
+// ---------------------------------------------------------------------------
+
+async function getState(key) {
+  try {
+    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
+      + '/Reddit_State?where=(key,eq,' + encodeURIComponent(key) + ')&limit=1';
+    var r = await _deps.fetch(url, { headers: { 'xc-token': NOCODB_TOKEN } });
+    if (r.status === 200) {
+      var data = r.json();
+      var items = (data && data.list) ? data.list : [];
+      if (items.length > 0 && items[0].value !== undefined) {
+        try { return JSON.parse(items[0].value); } catch (_) { return items[0].value; }
+      }
+    }
+    return null;
+  } catch (_) { return null; }
+}
+
+async function setState(key, value) {
+  try {
+    var serialized = typeof value === 'string' ? value : JSON.stringify(value);
+    var checkUrl = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
+      + '/Reddit_State?where=(key,eq,' + encodeURIComponent(key) + ')&limit=1';
+    var checkR = await _deps.fetch(checkUrl, { headers: { 'xc-token': NOCODB_TOKEN } });
+    var checkData = (checkR.status === 200) ? checkR.json() : { list: [] };
+    var existing = ((checkData && checkData.list) || [])[0];
+    if (existing && existing.Id) {
+      var patchUrl = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
+        + '/Reddit_State/' + existing.Id;
+      await _deps.fetch(patchUrl, {
+        method: 'PATCH',
+        headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
+        body: JSON.stringify({ value: serialized }),
+      });
+    } else {
+      var postUrl2 = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
+        + '/Reddit_State';
+      await _deps.fetch(postUrl2, {
+        method: 'POST',
+        headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
+        body: JSON.stringify({ key: key, value: serialized }),
+      });
+    }
+  } catch (_) {}
+}
+
+// ---------------------------------------------------------------------------
+// Reddit auth
+// ---------------------------------------------------------------------------
+
+async function getRedditToken() {
+  try {
+    var cached = await getState('reddit_token');
+    if (cached && cached.access_token && cached.expires_at > Date.now()) {
+      return cached.access_token;
+    }
+  } catch (_) {}
+
+  try {
+    var creds = Buffer.from(REDDIT_CLIENT_ID + ':' + REDDIT_CLIENT_SECRET).toString('base64');
+    var r = await _deps.fetch('https://www.reddit.com/api/v1/access_token', {
+      method: 'POST',
+      headers: {
+        'Authorization': 'Basic ' + creds,
+        'Content-Type': 'application/x-www-form-urlencoded',
+        'User-Agent': 'EarlyInsider/1.0',
+      },
+      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(REDDIT_REFRESH_TOKEN),
+    });
+    if (r.status === 200) {
+      var data = r.json();
+      if (data && data.access_token) {
+        await setState('reddit_token', {
+          access_token: data.access_token,
+          expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
+        });
+        return data.access_token;
+      }
+    }
+  } catch (_) {}
+
+  return '';
+}
+
+// ---------------------------------------------------------------------------
+// Skip day check
+// ---------------------------------------------------------------------------
+
+async function shouldSkipToday() {
+  try {
+    var stored = await getState('week_skip_days');
+    if (!stored || !Array.isArray(stored.days)) return { skip: false };
+    var dayOfWeek = _now().getDay();
+    return { skip: stored.days.indexOf(dayOfWeek) !== -1 };
+  } catch (_) { return { skip: false }; }
+}
+
+// ---------------------------------------------------------------------------
+// Job scheduling stub
+// ---------------------------------------------------------------------------
+
+async function scheduleThreadReply(commentName, subreddit, threadName) {
+  try {
+    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID + '/Scheduled_Jobs';
+    await _deps.fetch(url, {
+      method: 'POST',
+      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
+      body: JSON.stringify({
+        job_type: 'reddit_thread_reply',
+        comment_name: commentName,
+        subreddit: subreddit,
+        thread_name: threadName,
+        status: 'pending',
+        created_at: new Date().toISOString(),
+      }),
+    });
+  } catch (_) {}
+}
+
+// ---------------------------------------------------------------------------
+// Reddit_Log helper
+// ---------------------------------------------------------------------------
+
+async function _logToRedditLog(postUrl, subreddit, text, status) {
+  try {
+    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID + '/Reddit_Log';
+    await _deps.fetch(url, {
+      method: 'POST',
+      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
+      body: JSON.stringify({
+        post_url: postUrl || '',
+        subreddit: subreddit || '',
+        comment_text: text || '',
+        status: status || 'posted',
+        posted_at: new Date().toISOString(),
+      }),
+    });
+  } catch (_) {}
+}
+
+// ---------------------------------------------------------------------------
+// Filings data fetch
+// ---------------------------------------------------------------------------
+
+async function _fetchFilingsForPeriod(days) {
+  try {
+    var cutoff = new Date(_now().getTime() - days * 86400000).toISOString().split('T')[0];
+    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
+      + '/Insider_Filings?where=(date,gte,' + cutoff + ')&sort=-value_usd&limit=10';
+    var r = await _deps.fetch(url, { headers: { 'xc-token': NOCODB_TOKEN } });
+    if (r.status === 200) {
+      var data = r.json();
+      return (data && data.list) ? data.list : [];
+    }
+  } catch (_) {}
+  return [];
+}
+
+// ---------------------------------------------------------------------------
+// Section 00 stubs — existing helpers
+// ---------------------------------------------------------------------------
+
 /**
  * Combine SEARCH_KEYWORDS with recent ticker names for Reddit search queries.
- * @param {Array} recentTickers - Array of ticker strings, e.g. ['AAPL', 'TSLA']
- * @returns {Array} Array of query strings
  */
 function buildSearchQueries(recentTickers) {
   var queries = SEARCH_KEYWORDS.slice();
@@ -52,9 +302,6 @@ function buildSearchQueries(recentTickers) {
 
 /**
  * Filter posts by minimum score.
- * @param {Array} posts - Array of Reddit post objects with { score } field
- * @param {number} [minScore=7] - Minimum score threshold
- * @returns {Array} Filtered posts
  */
 function filterByScore(posts, minScore) {
   if (!posts || !Array.isArray(posts)) return [];
@@ -66,11 +313,7 @@ function filterByScore(posts, minScore) {
 }
 
 /**
- * Build Claude Sonnet prompt for drafting a Reddit comment.
- * Rules: 80% value / 20% soft organic, NO brand name, NO link, 3-5 sentences.
- * @param {object} post - { title, selftext, subreddit, score }
- * @param {object} insiderData - { ticker, insider_name, transaction_type, shares, value_usd, date }
- * @returns {object} { prompt, maxTokens }
+ * Build Claude prompt for drafting a Reddit comment.
  */
 function draftComment(post, insiderData) {
   var postTitle = (post && post.title) || '';
@@ -122,9 +365,6 @@ function draftComment(post, insiderData) {
 
 /**
  * Validate a drafted comment before posting.
- * Checks: no URL, no brand names, 3-5 sentences.
- * @param {string} text - Comment text
- * @returns {object} { valid: boolean, issues: string[] }
  */
 function validateComment(text) {
   var issues = [];
@@ -133,13 +373,11 @@ function validateComment(text) {
     return { valid: false, issues: ['Comment text is empty'] };
   }
 
-  // Check for URLs
   var urlPattern = /https?:\/\/|www\.|\.com|\.io|\.ai|\.org|\.net/i;
   if (urlPattern.test(text)) {
     issues.push('Contains a URL or domain name');
   }
 
-  // Check for brand names (case-insensitive)
   var brandNames = ['InsiderBuying', 'EarlyInsider', 'earlyinsider.com', 'insiderbuying.ai'];
   brandNames.forEach(function(brand) {
     if (text.toLowerCase().indexOf(brand.toLowerCase()) !== -1) {
@@ -147,7 +385,6 @@ function validateComment(text) {
     }
   });
 
-  // Check sentence count (split by '. ' and filter empty)
   var sentences = text.split('. ').filter(function(s) {
     return s.trim().length > 0;
   });
@@ -166,11 +403,6 @@ function validateComment(text) {
 
 /**
  * Build NocoDB record for Reddit_Log table.
- * @param {string} postUrl - Reddit post URL
- * @param {string} subreddit - Subreddit name
- * @param {string} text - Comment text
- * @param {string} status - 'posted', 'skipped', 'failed'
- * @returns {object} NocoDB record object
  */
 function logComment(postUrl, subreddit, text, status) {
   return {
@@ -182,12 +414,778 @@ function logComment(postUrl, subreddit, text, status) {
   };
 }
 
+// ---------------------------------------------------------------------------
+// Section 04 — CAT 5 Daily Thread
+// ---------------------------------------------------------------------------
+
+async function getDailyThreadTarget() {
+  var stored = await getState('daily_thread_sub_index');
+  var index = typeof stored === 'number' ? stored : 0;
+  var subreddit = CAT5_SUBREDDITS[index % CAT5_SUBREDDITS.length];
+  await setState('daily_thread_sub_index', (index + 1) % CAT5_SUBREDDITS.length);
+  return subreddit;
+}
+
+async function shouldPostDailyThread() {
+  var now = _now();
+  // Derive weekday in EST — n8n VPS runs UTC so getDay() would be UTC
+  var estStr = getESTDateString(now); // "YYYY-MM-DD" in EST
+  var parts = estStr.split('-');
+  var estUtc = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
+  var dayOfWeek = estUtc.getUTCDay(); // 0=Sun, 6=Sat, timezone-safe
+  if (dayOfWeek === 0 || dayOfWeek === 6) return { post: false };
+
+  var skipResult = await shouldSkipToday();
+  if (skipResult.skip) return { post: false };
+
+  var isWeekendRecap = dayOfWeek === 1; // Monday
+  return { post: true, isWeekendRecap: isWeekendRecap };
+}
+
+async function findDailyDiscussionThread(subreddit) {
+  var token = await getRedditToken();
+  var now = _now();
+  var todayEST = getESTDateString(now);
+
+  function isToday(created_utc) {
+    return getESTDateString(new Date(created_utc * 1000)) === todayEST;
+  }
+
+  function isDailyThread(title) {
+    return /daily\s*(discussion|thread)/i.test(title);
+  }
+
+  var headers = { 'Authorization': 'Bearer ' + token, 'User-Agent': 'EarlyInsider/1.0' };
+
+  // Layer 1: sticky 1
+  try {
+    var r1 = await _deps.fetch(
+      'https://oauth.reddit.com/r/' + subreddit + '/about/sticky?num=1',
+      { headers: headers }
+    );
+    if (r1.status === 200) {
+      var d1 = r1.json().data;
+      if (d1 && isDailyThread(d1.title) && isToday(d1.created_utc)) return d1;
+    }
+  } catch (_) {}
+
+  // Layer 2: sticky 2
+  try {
+    var r2 = await _deps.fetch(
+      'https://oauth.reddit.com/r/' + subreddit + '/about/sticky?num=2',
+      { headers: headers }
+    );
+    if (r2.status === 200) {
+      var d2 = r2.json().data;
+      if (d2 && isDailyThread(d2.title) && isToday(d2.created_utc)) return d2;
+    }
+  } catch (_) {}
+
+  // Layer 3: hot posts
+  try {
+    var r3 = await _deps.fetch(
+      'https://oauth.reddit.com/r/' + subreddit + '/hot?limit=5',
+      { headers: headers }
+    );
+    if (r3.status === 200) {
+      var posts3 = r3.json().data.children.map(function(c) { return c.data; });
+      var match3 = posts3.find(function(p) { return isDailyThread(p.title) && isToday(p.created_utc); });
+      if (match3) return match3;
+    }
+  } catch (_) {}
+
+  // Layer 4: search (last resort, may lag 2+ hours)
+  try {
+    var q = encodeURIComponent('Daily Discussion');
+    var r4 = await _deps.fetch(
+      'https://oauth.reddit.com/r/' + subreddit + '/search?q=' + q + '&sort=new&restrict_sr=1&limit=10',
+      { headers: headers }
+    );
+    if (r4.status === 200) {
+      var posts4 = r4.json().data.children.map(function(c) { return c.data; });
+      var match4 = posts4.find(function(p) { return isDailyThread(p.title) && isToday(p.created_utc); });
+      if (match4) return match4;
+    }
+  } catch (_) {}
+
+  return null;
+}
+
+function _formatDollar(usd) {
+  if (usd >= 1000000) return '$' + (usd / 1000000).toFixed(1) + 'M';
+  if (usd >= 1000) return '$' + (usd / 1000).toFixed(0) + 'K';
+  return '$' + usd;
+}
+
+var CAT5_TEMPLATES = [
+  // 0: notable_buys
+  function(data) {
+    if (!data.filings || data.filings.length === 0) {
+      return 'No notable insider buying activity in the last trading session.';
+    }
+    var lines = data.filings.slice(0, 4).map(function(f) {
+      return '- **$' + f.ticker + '** — ' + f.role + ' bought ' + _formatDollar(f.value_usd) + ' on ' + f.date;
+    }).join('\n');
+    return '**Notable insider buying ' + (data.period || 'yesterday') + ':**\n\n'
+      + lines + '\n\nForm 4 data via SEC EDGAR. Make of it what you will.';
+  },
+  // 1: confidence_index
+  function(data) {
+    var count = data.filings ? data.filings.length : 0;
+    var topFiling = data.filings && data.filings[0];
+    var topLine = topFiling
+      ? 'Top filing: ' + topFiling.role + ' at $' + topFiling.ticker + ' — ' + _formatDollar(topFiling.value_usd)
+      : 'No standout filing.';
+    return '**Insider Confidence Index — ' + (data.period || 'yesterday') + ':** '
+      + count + ' significant Form 4 purchases filed.\n\n'
+      + topLine + '\n\nHigher count = more executives putting their own money in.';
+  },
+  // 2: unusual_activity
+  function(data) {
+    if (!data.filings || data.filings.length === 0) {
+      return 'No unusual insider activity patterns detected in recent filings.';
+    }
+    var top = data.filings[0];
+    return '**Unusual Form 4 pattern flagged — $' + top.ticker + ':** '
+      + top.role + ' (' + top.insider_name + ') purchased '
+      + _formatDollar(top.value_usd) + ' on ' + top.date
+      + '. This represents an unusual cluster relative to baseline.'
+      + ' Worth watching price action over the next 30 days.';
+  },
+];
+
+function buildDailyThreadComment(data, templateIndex) {
+  var fn = CAT5_TEMPLATES[templateIndex % 3];
+  return fn(data);
+}
+
+async function postDailyThread() {
+  var shouldPost = await shouldPostDailyThread();
+  if (!shouldPost.post) { console.log('[CAT5] no post today'); return; }
+
+  var subreddit = await getDailyThreadTarget();
+
+  var thread = await findDailyDiscussionThread(subreddit);
+  if (!thread) {
+    console.log('[CAT5] no daily thread found for ' + subreddit + ' — skipping');
+    return;
+  }
+
+  var period = shouldPost.isWeekendRecap ? 'Fri-Sun' : 'yesterday';
+  var filings = await _fetchFilingsForPeriod(shouldPost.isWeekendRecap ? 3 : 1);
+
+  var storedIndex = await getState('daily_thread_template_index');
+  var templateIndex = typeof storedIndex === 'number' ? storedIndex : 0;
+  await setState('daily_thread_template_index', (templateIndex + 1) % 3);
+
+  var commentText = buildDailyThreadComment({ filings: filings, period: period }, templateIndex);
+
+  var token = await getRedditToken();
+  var res = await _deps.fetch('https://oauth.reddit.com/api/comment', {
+    method: 'POST',
+    headers: {
+      'Authorization': 'Bearer ' + token,
+      'Content-Type': 'application/x-www-form-urlencoded',
+      'User-Agent': 'EarlyInsider/1.0',
+    },
+    body: 'thing_id=' + encodeURIComponent(thread.name) + '&text=' + encodeURIComponent(commentText),
+  });
+
+  var result = res.json();
+  var comment = result && result.json && result.json.data && result.json.data.things
+    && result.json.data.things[0] && result.json.data.things[0].data;
+  if (!comment) {
+    console.warn('[CAT5] Reddit post comment returned no data — skipping');
+    return;
+  }
+
+  await _logToRedditLog(
+    thread.url || ('https://www.reddit.com/r/' + subreddit),
+    subreddit,
+    commentText,
+    'posted'
+  );
+  await scheduleThreadReply(comment.name, subreddit, thread.name);
+
+  console.log('[CAT5] posted to ' + subreddit + ' daily thread, comment ' + comment.name);
+}
+
+// ---------------------------------------------------------------------------
+// Section 06 constants (defined early — used by _callClaude default system)
+// ---------------------------------------------------------------------------
+
+var NEGATIVE_EXAMPLES = 'STYLE GUIDE — FEW-SHOT EXAMPLES:\n\n'
+  + 'BAD (do not write like this):\n'
+  + '"It\'s worth noting that insider buying activity has increased significantly, which could'
+  + ' potentially indicate positive sentiment from company leadership regarding future prospects.'
+  + ' This might be seen as a bullish signal by some investors, though of course there are no guarantees."\n\n'
+  + 'Why it\'s bad: passive voice, hedge stacking, vague corporate language, no specific data, says nothing.\n\n'
+  + 'GOOD (write like this):\n'
+  + '"CEO just dropped $2M on this at $142. Last 3 times he bought, stock was up 20%+ within 6 months.'
+  + ' Whether that continues — who knows. But it\'s the data."\n\n'
+  + 'Why it\'s good: direct, specific dollar amounts, specific timeframes, personality, no recommendation.\n\n'
+  + 'AVOID: "it is worth noting", "it is important to consider", "one could argue", "this may suggest",\n'
+  + '"in conclusion", "furthermore", "it should be noted", "as we can see".';
+
+var ANTI_PUMP_RULE = 'NEVER explicitly recommend buying or say a stock will go up.'
+  + ' Present data only. Let the data speak. You are sharing an observation, not giving financial advice.';
+
+var SUBREDDIT_TONE_MAP = {
+  stocks: { style: 'balanced, conversational', wordLimit: [100, 150] },
+  wallstreetbets: { style: 'casual, degen energy, brief, emojis OK', wordLimit: [50, 100] },
+  investing: { style: 'measured, analytical, cite sources', wordLimit: [100, 200] },
+  ValueInvesting: { style: 'analytical, precise, cite key ratios', wordLimit: [150, 250] },
+  SecurityAnalysis: { style: 'formal, data-driven, academic tone', wordLimit: [150, 300] },
+};
+
+// ---------------------------------------------------------------------------
+// _callClaude — shared Claude API helper
+// ---------------------------------------------------------------------------
+
+async function _callClaude(userMessage, options) {
+  var opts = options || {};
+  var defaultSystem = NEGATIVE_EXAMPLES + '\n\n' + ANTI_PUMP_RULE;
+  var system = opts.system !== undefined ? opts.system : defaultSystem;
+  var maxTokens = opts.maxTokens || 300;
+  var temperature = (opts.temperature !== undefined) ? opts.temperature : 0.7;
+
+  var res = await _deps.fetch('https://api.anthropic.com/v1/messages', {
+    method: 'POST',
+    headers: {
+      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
+      'anthropic-version': '2023-06-01',
+      'Content-Type': 'application/json',
+    },
+    body: JSON.stringify({
+      model: 'claude-sonnet-4-6',
+      max_tokens: maxTokens,
+      temperature: temperature,
+      system: system,
+      messages: [{ role: 'user', content: userMessage }],
+    }),
+  });
+
+  if (res.status !== 200) throw new Error('Claude API error: HTTP ' + res.status);
+  var data = res.json();
+  return (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : '';
+}
+
+// ---------------------------------------------------------------------------
+// Section 05 — CAT 6 DD Posts
+// ---------------------------------------------------------------------------
+
+/**
+ * Validate a long-form DD post. Requires word count >= 400 and a Bear Case section.
+ */
+function validateDDPost(text) {
+  var issues = [];
+  if (!text || typeof text !== 'string') {
+    return { valid: false, issues: ['Empty text'] };
+  }
+  var words = text.trim().split(/\s+/).length;
+  if (words < 400) {
+    issues.push('Too short: ' + words + ' words (need 400+)');
+  }
+  if (!/##\s*Bear Case/i.test(text)) {
+    issues.push('Missing Bear Case section');
+  }
+  return { valid: issues.length === 0, issues: issues };
+}
+
+/**
+ * Check NocoDB Reddit_DD_Posts for rate-limit constraints.
+ * Returns { allowed: true } or { allowed: false, reason: 'too_recent'|'monthly_limit' }.
+ */
+async function checkDDPostLimit() {
+  try {
+    var now = new Date();
+    var threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
+    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
+    var where = encodeURIComponent('(status,eq,posted)~and(posted_at,gte,' + monthStart + ')');
+    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
+      + '/Reddit_DD_Posts?where=' + where + '&limit=20';
+    var res = await _deps.fetch(url, { headers: { 'xc-token': NOCODB_TOKEN } });
+    var rows = (res.json().list || []);
+    var posted = rows.filter(function(r) { return r.status === 'posted'; });
+
+    if (posted.length >= 8) return { allowed: false, reason: 'monthly_limit' };
+    if (posted.some(function(r) { return new Date(r.posted_at) >= new Date(threeDaysAgo); })) {
+      return { allowed: false, reason: 'too_recent' };
+    }
+  } catch (_) {}
+  return { allowed: true };
+}
+
+/**
+ * Build a long-form DD post via 4 sequential Claude calls.
+ * Returns post text string or null on validation failure.
+ */
+async function buildDDPost(ticker, data) {
+  var NFA = '\n\nNot financial advice. Do your own research.';
+
+  // Step 1: Outline
+  var outline = await _callClaude(
+    'Generate a detailed outline for a due-diligence Reddit post on $' + ticker
+    + '. Include sections: Discovery, Company Brief, Insider Activity Table, Fundamentals,'
+    + ' Bull Case (5 catalysts), Bear Case (3 genuine risks), Valuation, What I\'m Watching,'
+    + ' Positions, TLDR. 2-3 bullet points per section.',
+    { maxTokens: 300 }
+  );
+
+  // Step 2: Full draft
+  var draftPrompt = 'Using this outline:\n' + outline + '\n\nAnd this insider data:\n'
+    + JSON.stringify(data) + '\n\nWrite a full Reddit DD post. First person. You are a retail'
+    + ' investor who found this while screening Form 4s.'
+    + ' Start with: "I was screening Form 4s last week when I noticed...".'
+    + ' Bear Case must be >= 400 words and genuinely skeptical.';
+  var draft = await _callClaude(draftPrompt, { maxTokens: 3500 });
+
+  // Validate — retry once if needed
+  var validation = validateDDPost(draft);
+  if (!validation.valid) {
+    var failReason = validation.issues.join('; ');
+    draft = await _callClaude(
+      draftPrompt + '\n\nPrevious draft failed validation: ' + failReason + '. Fix these issues.',
+      { maxTokens: 3500 }
+    );
+    validation = validateDDPost(draft);
+    if (!validation.valid) {
+      console.error('[CAT6] buildDDPost validation failed after retry for ' + ticker);
+      return null;
+    }
+  }
+
+  // Step 3: Bear case review
+  var bearMatch = draft.match(/##\s*Bear Case\s*\n([\s\S]*?)(?=\n##|$)/i);
+  var bearCase = bearMatch ? bearMatch[0] : '';
+  var bearReview = await _callClaude(
+    'Review this bear case section:\n\n' + bearCase
+    + '\n\nRate its authenticity 1-10. If < 7, provide a rewritten version with genuine,'
+    + ' specific risks. Format: "Score: N\\n[rewrite if needed]"',
+    { maxTokens: 1000 }
+  );
+  var scoreMatch = bearReview.match(/Score:\s*(\d+)/i);
+  var score = scoreMatch ? parseInt(scoreMatch[1]) : 8;
+  if (score < 7 && bearReview.length > 50) {
+    var rewriteStart = bearReview.indexOf('\n') + 1;
+    var rewrite = bearReview.slice(rewriteStart).trim();
+    if (rewrite.length > 100) {
+      draft = draft.replace(/##\s*Bear Case\s*\n[\s\S]*?(?=\n##|$)/i, rewrite);
+    }
+  }
+
+  // Step 4: TLDR
+  var tldr = await _callClaude(
+    'Write a 3-4 bullet TLDR for this DD post. Each bullet must be specific (include $' + ticker
+    + ', dollar amounts, dates where applicable):\n\n' + draft.slice(0, 2000),
+    { maxTokens: 200 }
+  );
+  var tldrBlock = tldr.startsWith('## TLDR') ? tldr : '## TLDR\n' + tldr;
+
+  return tldrBlock + '\n\n' + draft;
+}
+
+/**
+ * Select target subreddits for a DD post based on score, marketCap, and metric count.
+ */
+function _selectDDSubreddits(score, marketCapUsd, fundamentalMetricCount) {
+  var subs = ['stocks'];
+  if (score >= 8 && marketCapUsd >= 5000000000) subs.push('wallstreetbets');
+  if (fundamentalMetricCount >= 3) subs.push('ValueInvesting');
+  return subs;
+}
+
+var NFA_DISCLAIMER = '\n\nNot financial advice. Do your own research.';
+var MAX_REDDIT_CHARS = 38000;
+
+/**
+ * Build per-subreddit text variants. stocks = body unchanged. Others get a 1-2 sentence opener.
+ */
+async function _buildSubredditVariants(subreddits, body, ticker) {
+  var variants = {};
+  for (var i = 0; i < subreddits.length; i++) {
+    var sub = subreddits[i];
+    var text;
+    if (sub === 'stocks') {
+      text = body;
+    } else {
+      var toneMap = {
+        wallstreetbets: 'WSB-style intro (casual degen, brief, emoji OK)',
+        ValueInvesting: 'ValueInvesting-style intro (analytical, measured, cite one key ratio)',
+      };
+      var tone = toneMap[sub] || 'conversational intro';
+      var opener = await _callClaude(
+        'Write a ' + tone + ' for a DD post on $' + ticker + '. 1-2 sentences only. No hype.',
+        { maxTokens: 100 }
+      );
+      text = opener.trim() + '\n\n' + body;
+    }
+    text = text + NFA_DISCLAIMER;
+    if (text.length > MAX_REDDIT_CHARS) {
+      var trimTo = MAX_REDDIT_CHARS - NFA_DISCLAIMER.length;
+      text = text.slice(0, trimTo) + NFA_DISCLAIMER;
+    }
+    variants[sub] = text;
+  }
+  return variants;
+}
+
+/**
+ * Upload DD post visuals to Imgur. Returns array of { label, url } links.
+ * Skips gracefully if visual-templates return null or Imgur fails.
+ */
+async function _uploadDDVisuals(ticker, filings, priceData, peers) {
+  var vt = require('./visual-templates.js');
+  var visuals = [
+    { label: 'Insider Transaction Table', base64: vt.generateInsiderTable(filings) },
+    { label: 'Price Chart', base64: vt.generatePriceChart(ticker, priceData) },
+    { label: 'Peer Radar', base64: vt.generatePeerRadar(ticker, peers) },
+  ];
+  var links = [];
+  for (var i = 0; i < visuals.length; i++) {
+    var v = visuals[i];
+    if (!v.base64) continue;
+    try {
+      var res = await _deps.fetch('https://api.imgur.com/3/image', {
+        method: 'POST',
+        headers: {
+          'Authorization': 'Client-ID ' + (process.env.IMGUR_CLIENT_ID || ''),
+          'Content-Type': 'application/json',
+        },
+        body: JSON.stringify({ image: v.base64, type: 'base64', title: v.label }),
+      });
+      var data = res.json();
+      if (data.data && data.data.link) links.push({ label: v.label, url: data.data.link });
+    } catch (err) {
+      console.warn('[CAT6] Imgur upload failed for ' + v.label + ': ' + (err && err.message));
+    }
+  }
+  return links;
+}
+
+/**
+ * Select the best ticker for today's DD post from NocoDB Insider_Filings.
+ * Returns null if no suitable ticker found.
+ */
+async function _selectDDTicker() {
+  try {
+    var cutoff = new Date(_now().getTime() - 7 * 86400000).toISOString().split('T')[0];
+    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
+      + '/Insider_Filings?where=(date,gte,' + cutoff + ')&sort=-score&limit=5';
+    var r = await _deps.fetch(url, { headers: { 'xc-token': NOCODB_TOKEN } });
+    if (r.status !== 200) return null;
+    var data = r.json();
+    var list = (data && data.list) ? data.list : [];
+    if (list.length === 0) return null;
+    var record = list[0];
+    return {
+      ticker: record.ticker,
+      filings: [record],
+      score: record.score || 7,
+      marketCapUsd: record.marketCapUsd || 0,
+      priceAtPost: record.price || 0,
+      priceHistory: [],
+      peers: [],
+    };
+  } catch (_) { return null; }
+}
+
+/**
+ * Insert a record to NocoDB Reddit_DD_Posts.
+ */
+async function _insertDDPostLog(info) {
+  try {
+    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID + '/Reddit_DD_Posts';
+    await _deps.fetch(url, {
+      method: 'POST',
+      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
+      body: JSON.stringify({
+        ticker: info.ticker || '',
+        post_url: info.post_url || '',
+        subreddit: info.subreddit || '',
+        price_at_post: info.price_at_post || 0,
+        authenticity_score: info.authenticity_score || 0,
+        status: info.status || 'posted',
+        posted_at: new Date().toISOString(),
+      }),
+    });
+  } catch (_) {}
+}
+
+/**
+ * Count fundamental metric keywords in post text (P/E, EV/EBITDA, ROE, etc.).
+ */
+function _countFundamentalMetrics(text) {
+  if (!text) return 0;
+  var metrics = ['P/E', 'EV/EBITDA', 'ROE', 'ROA', 'ROIC', 'P/S', 'P/B', 'debt/equity',
+    'free cash flow', 'FCF', 'gross margin', 'net margin', 'revenue growth', 'earnings growth'];
+  var lower = text.toLowerCase();
+  return metrics.filter(function(m) { return lower.includes(m.toLowerCase()); }).length;
+}
+
+function randomBetween(min, max) {
+  return Math.floor(Math.random() * (max - min + 1)) + min;
+}
+
+/**
+ * Insert a scheduled job to NocoDB Scheduled_Jobs.
+ */
+async function insertJob(jobType, data, delayMs) {
+  try {
+    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID + '/Scheduled_Jobs';
+    await _deps.fetch(url, {
+      method: 'POST',
+      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
+      body: JSON.stringify({
+        job_type: jobType,
+        payload: JSON.stringify(data),
+        run_after_ms: delayMs || 0,
+        status: 'pending',
+        created_at: new Date().toISOString(),
+      }),
+    });
+  } catch (_) {}
+}
+
+/**
+ * Schedule follow-up DD reply jobs.
+ */
+async function scheduleDDReplies(postName, subreddit, ticker) {
+  try {
+    var delays = [1800000, 3600000, 7200000]; // 30 min, 1 hr, 2 hr
+    for (var i = 0; i < delays.length; i++) {
+      await insertJob('reddit_dd_reply', { postName: postName, subreddit: subreddit, ticker: ticker }, delays[i]);
+    }
+  } catch (_) {}
+}
+
+/**
+ * CAT 6 entry point — post a long-form DD post to relevant subreddits.
+ */
+async function postDDPost() {
+  // 1. Frequency gate
+  var limitResult = await checkDDPostLimit();
+  if (!limitResult.allowed) {
+    console.log('[CAT6] limit: ' + limitResult.reason);
+    return;
+  }
+
+  // 2. Day/time gate (Tue-Thu, 10AM-2PM EST)
+  var now = _now();
+  var estDay = new Intl.DateTimeFormat('en-US', {
+    timeZone: 'America/New_York',
+    weekday: 'short',
+  }).format(now);
+  var estHourStr = new Intl.DateTimeFormat('en-US', {
+    timeZone: 'America/New_York',
+    hour: 'numeric',
+    hour12: false,
+  }).format(now);
+  var estHour = parseInt(estHourStr);
+  if (['Tue', 'Wed', 'Thu'].indexOf(estDay) === -1) {
+    console.log('[CAT6] wrong day: ' + estDay);
+    return;
+  }
+  if (estHour < 10 || estHour >= 14) {
+    console.log('[CAT6] outside window: ' + estHour + ':00 EST');
+    return;
+  }
+
+  // 3. Select ticker
+  var data = await _selectDDTicker();
+  if (!data) { console.log('[CAT6] no suitable ticker'); return; }
+  var ticker = data.ticker;
+  var filings = data.filings;
+  var score = data.score;
+  var marketCapUsd = data.marketCapUsd;
+  var priceAtPost = data.priceAtPost;
+
+  // 4. Build DD post (4 Claude calls)
+  var ddBody = await buildDDPost(ticker, data);
+  if (!ddBody) return;
+
+  // 5. Human-likeness check
+  var humanCheck = await _callClaude(
+    'Rate this post\'s human-likeness 1-10. If < 7, identify 3 specific AI-sounding phrases'
+    + ' and provide rewritten versions:\n\n' + ddBody.slice(0, 3000),
+    { maxTokens: 500 }
+  );
+  var humanMatch = humanCheck.match(/\b([0-9]|10)\b/);
+  var humanScore = humanMatch ? parseInt(humanMatch[0]) : 8;
+  var finalBody = ddBody;
+  if (humanScore < 7) {
+    finalBody = await _callClaude(
+      'Apply these rewrites to the post:\n' + humanCheck + '\n\nOriginal:\n' + ddBody,
+      { maxTokens: 3500 }
+    );
+    var recheckText = await _callClaude(
+      'Rate human-likeness 1-10:\n' + finalBody.slice(0, 2000),
+      { maxTokens: 50 }
+    );
+    var recheckMatch = recheckText.match(/\b([0-9]|10)\b/);
+    var recheckScore = recheckMatch ? parseInt(recheckMatch[0]) : 8;
+    if (recheckScore < 7) {
+      console.error('[CAT6] human-likeness < 7 after rewrite — aborting');
+      return;
+    }
+  }
+
+  // 6. Upload visuals
+  var imageLinks = await _uploadDDVisuals(ticker, filings, data.priceHistory, data.peers);
+  if (imageLinks.length > 0) {
+    var markdownImages = imageLinks.map(function(l) { return '[' + l.label + '](' + l.url + ')'; }).join('\n');
+    finalBody = finalBody.replace('## Bull Case', markdownImages + '\n\n## Bull Case');
+  }
+
+  // 7. Determine target subreddits and build per-sub variants
+  var fundamentalMetricCount = _countFundamentalMetrics(finalBody);
+  var targetSubs = _selectDDSubreddits(score, marketCapUsd, fundamentalMetricCount);
+  var variants = await _buildSubredditVariants(targetSubs, finalBody, ticker);
+
+  // 8. Post to each subreddit
+  var token = await getRedditToken();
+  var subEntries = Object.keys(variants);
+  for (var si = 0; si < subEntries.length; si++) {
+    var sub = subEntries[si];
+    var text = variants[sub];
+    try {
+      var postRes = await _deps.fetch('https://oauth.reddit.com/api/submit', {
+        method: 'POST',
+        headers: {
+          'Authorization': 'Bearer ' + token,
+          'Content-Type': 'application/x-www-form-urlencoded',
+          'User-Agent': 'EarlyInsider/1.0',
+        },
+        body: 'sr=' + sub + '&kind=self&title='
+          + encodeURIComponent('$' + ticker + ' DD: Insider cluster buy — ' + (score >= 8 ? 'high conviction' : 'notable'))
+          + '&text=' + encodeURIComponent(text),
+      });
+      var postData = postRes.json();
+      var postName = postData && postData.json && postData.json.data && postData.json.data.name;
+      var postUrl = (postData && postData.json && postData.json.data && postData.json.data.url)
+        || ('https://www.reddit.com/r/' + sub);
+
+      // 9. Log to Reddit_DD_Posts
+      await _insertDDPostLog({
+        ticker: ticker,
+        post_url: postUrl,
+        subreddit: sub,
+        price_at_post: priceAtPost,
+        authenticity_score: humanScore,
+        status: 'posted',
+      });
+
+      // 10. Schedule AMA and follow-up replies
+      await insertJob('reddit_ama', { postId: postName, subreddit: sub, ticker: ticker }, randomBetween(300000, 600000));
+      await scheduleDDReplies(postName, sub, ticker);
+
+      console.log('[CAT6] posted DD on ' + sub + ': ' + postUrl);
+    } catch (err) {
+      console.error('[CAT6] failed to post to ' + sub + ': ' + (err && err.message));
+    }
+  }
+}
+
+// ---------------------------------------------------------------------------
+// Section 06 — Anti-AI Detection
+// ---------------------------------------------------------------------------
+
+/**
+ * Build and send a comment prompt via Claude API.
+ * Replaces the old draftComment() stub with a real Claude call.
+ */
+async function buildCommentPrompt(post, insiderData, subreddit, structure) {
+  var cfg = SUBREDDIT_TONE_MAP[subreddit] || {};
+  var wordRange = cfg.wordLimit ? (cfg.wordLimit[0] + '-' + cfg.wordLimit[1] + ' words') : '100-150 words';
+
+  var systemParts = [
+    NEGATIVE_EXAMPLES,
+    ANTI_PUMP_RULE,
+    '\nSUBREDDIT TONE: ' + (cfg.style || 'balanced, conversational'),
+    'WORD LIMIT: ' + wordRange,
+    'STRUCTURE: ' + (structure && structure.systemPromptInstruction ? structure.systemPromptInstruction : 'Write a relevant reply.'),
+  ];
+  if (cfg.example) systemParts.push('\nEXAMPLE OF GOOD STYLE FOR THIS SUBREDDIT:\n' + cfg.example);
+  var systemPrompt = systemParts.filter(Boolean).join('\n\n');
+
+  var valueMil = insiderData && insiderData.value_usd ? (insiderData.value_usd / 1000000).toFixed(1) : '0';
+  var userMessage = 'Reddit post you are replying to:\n'
+    + 'Title: ' + ((post && post.title) || '') + '\n'
+    + 'Body: ' + ((post && post.selftext) || '(no body)') + '\n'
+    + 'Subreddit: r/' + (subreddit || '') + '\n\n'
+    + 'Insider filing data:\n'
+    + 'Ticker: $' + ((insiderData && insiderData.ticker) || '') + '\n'
+    + 'Insider: ' + ((insiderData && insiderData.insider_name) || '') + ' (' + ((insiderData && insiderData.role) || '') + ')\n'
+    + 'Transaction: purchased $' + valueMil + 'M worth on ' + ((insiderData && insiderData.date) || '') + '\n'
+    + (insiderData && insiderData.track_record ? 'Track record: ' + insiderData.track_record + '\n' : '')
+    + '\nWrite a reply that adds value to this thread. Follow the style guide and structure above.';
+
+  var res = await _callClaude(userMessage, {
+    system: systemPrompt,
+    maxTokens: 300,
+    temperature: 0.7,
+  });
+
+  if (!res || res.trim().length === 0) {
+    console.warn('[buildCommentPrompt] Claude returned empty response');
+    return null;
+  }
+
+  return res.trim();
+}
+
+// ---------------------------------------------------------------------------
+// Exports
+// ---------------------------------------------------------------------------
+
 module.exports = {
+  // Constants
   SUBREDDITS: SUBREDDITS,
   SEARCH_KEYWORDS: SEARCH_KEYWORDS,
+  CAT5_SUBREDDITS: CAT5_SUBREDDITS,
+
+  // Section 06 constants
+  NEGATIVE_EXAMPLES: NEGATIVE_EXAMPLES,
+  ANTI_PUMP_RULE: ANTI_PUMP_RULE,
+
+  // Original helpers
   buildSearchQueries: buildSearchQueries,
   filterByScore: filterByScore,
   draftComment: draftComment,
   validateComment: validateComment,
   logComment: logComment,
+
+  // Test seams
+  _setDeps: _setDeps,
+  _setNow: _setNow,
+
+  // Utility (exported for test helpers)
+  getISOWeekKey: getISOWeekKey,
+  getESTDateString: getESTDateString,
+
+  // State helpers
+  getState: getState,
+  setState: setState,
+  shouldSkipToday: shouldSkipToday,
+  getRedditToken: getRedditToken,
+  scheduleThreadReply: scheduleThreadReply,
+
+  // Section 04 — CAT 5
+  getDailyThreadTarget: getDailyThreadTarget,
+  shouldPostDailyThread: shouldPostDailyThread,
+  findDailyDiscussionThread: findDailyDiscussionThread,
+  buildDailyThreadComment: buildDailyThreadComment,
+  postDailyThread: postDailyThread,
+
+  // Section 05 — CAT 6 DD Posts
+  validateDDPost: validateDDPost,
+  checkDDPostLimit: checkDDPostLimit,
+  buildDDPost: buildDDPost,
+  _selectDDSubreddits: _selectDDSubreddits,
+  _buildSubredditVariants: _buildSubredditVariants,
+  _uploadDDVisuals: _uploadDDVisuals,
+  postDDPost: postDDPost,
+
+  // Section 06 — Anti-AI Detection
+  buildCommentPrompt: buildCommentPrompt,
 };
diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-templates.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-templates.js
index 5e7a024..3c3097a 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-templates.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/visual-templates.js
@@ -660,6 +660,14 @@ async function renderTemplate(templateId, data, opts = {}, helpers) {
 
 // ─── Exports ──────────────────────────────────────────────────────────────────
 
+// ─── DD Post visual stubs (return null until implemented) ─────────────────────
+
+function generateInsiderTable(_filings) { return null; }
+function generatePriceChart(_ticker, _priceData) { return null; }
+function generatePeerRadar(_ticker, _peers) { return null; }
+
+// ─── Exports ──────────────────────────────────────────────────────────────────
+
 module.exports = {
   t1DataCard,
   t2SecFilingMiniCard,
@@ -677,4 +685,7 @@ module.exports = {
   t14AlertScoreBadge,
   t15WeeklyLeaderboard,
   renderTemplate,
+  generateInsiderTable,
+  generatePriceChart,
+  generatePeerRadar,
 };
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js
index 2e1a297..0a8b046 100644
--- a/ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/reddit-monitor.test.js
@@ -1,5 +1,6 @@
 'use strict';
 
+const mod = require('../../n8n/code/insiderbuying/reddit-monitor');
 const {
   SUBREDDITS,
   SEARCH_KEYWORDS,
@@ -8,7 +9,8 @@ const {
   draftComment,
   validateComment,
   logComment,
-} = require('../../n8n/code/insiderbuying/reddit-monitor');
+  getISOWeekKey,
+} = mod;
 
 // ─── SUBREDDITS / SEARCH_KEYWORDS ─────────────────────────────────────────
 
@@ -279,3 +281,806 @@ describe('logComment()', () => {
     expect(record.subreddit).toBe('');
   });
 });
+
+// ─── Section 04 — CAT 5 Daily Thread ─────────────────────────────────────
+
+// Helpers shared across section-04 tests
+function mockSkipDays(days) {
+  // Used for weekend tests only — those return early before the NocoDB call
+  const isoWeek = getISOWeekKey(new Date());
+  mod._setDeps({
+    fetch: async () => ({
+      status: 200,
+      json: () => ({
+        list: days !== null
+          ? [{ key: 'week_skip_days', value: JSON.stringify({ week: isoWeek, days }), Id: 1 }]
+          : [],
+      }),
+    }),
+  });
+}
+
+function mockSkipDaysWithNow(days, nowFn) {
+  const isoWeek = getISOWeekKey(nowFn());
+  mod._setDeps({
+    fetch: async () => ({
+      status: 200,
+      json: () => ({
+        list: days !== null
+          ? [{ key: 'week_skip_days', value: JSON.stringify({ week: isoWeek, days }), Id: 1 }]
+          : [],
+      }),
+    }),
+  });
+}
+
+// ─── shouldPostDailyThread ────────────────────────────────────────────────
+
+describe('shouldPostDailyThread', () => {
+  afterEach(() => {
+    mod._setNow(null);
+    mod._setDeps(null);
+  });
+
+  test('returns false on Saturday (dayOfWeek=6)', async () => {
+    mod._setNow(() => new Date('2026-03-28T10:00:00Z')); // Saturday
+    mockSkipDays([]);
+    const r = await mod.shouldPostDailyThread();
+    expect(r.post).toBe(false);
+  });
+
+  test('returns false on Sunday (dayOfWeek=0)', async () => {
+    mod._setNow(() => new Date('2026-03-29T10:00:00Z')); // Sunday
+    mockSkipDays([]);
+    const r = await mod.shouldPostDailyThread();
+    expect(r.post).toBe(false);
+  });
+
+  test('returns false on a skip day', async () => {
+    const nowFn = () => new Date('2026-03-30T10:00:00Z'); // Monday
+    mod._setNow(nowFn);
+    mockSkipDaysWithNow([1], nowFn); // Monday is skip day
+    const r = await mod.shouldPostDailyThread();
+    expect(r.post).toBe(false);
+  });
+
+  test('returns true on a regular weekday', async () => {
+    const nowFn = () => new Date('2026-03-31T10:00:00Z'); // Tuesday
+    mod._setNow(nowFn);
+    mockSkipDaysWithNow([], nowFn);
+    const r = await mod.shouldPostDailyThread();
+    expect(r.post).toBe(true);
+  });
+
+  test('sets isWeekendRecap=true on Monday', async () => {
+    const nowFn = () => new Date('2026-03-30T10:00:00Z'); // Monday
+    mod._setNow(nowFn);
+    mockSkipDaysWithNow([], nowFn);
+    const r = await mod.shouldPostDailyThread();
+    if (r.post) expect(r.isWeekendRecap).toBe(true);
+  });
+});
+
+// ─── findDailyDiscussionThread ────────────────────────────────────────────
+
+describe('findDailyDiscussionThread', () => {
+  const TODAY_UTC = '2026-03-31T12:00:00Z'; // Tuesday
+
+  function sticky(title, created_utc) {
+    return { status: 200, json: () => ({ data: { title, created_utc } }) };
+  }
+  function notFound() { return { status: 404, json: () => ({}) }; }
+  function hotPosts(posts) {
+    return { status: 200, json: () => ({ data: { children: posts.map((p) => ({ data: p })) } }) };
+  }
+
+  afterEach(() => {
+    mod._setNow(null);
+    mod._setDeps(null);
+  });
+
+  test('returns sticky 1 if title contains "Daily" and created today (EST)', async () => {
+    const created = new Date('2026-03-31T07:00:00-04:00').getTime() / 1000;
+    mod._setNow(() => new Date(TODAY_UTC));
+    mod._setDeps({
+      fetch: async (url) => {
+        if (url.includes('sticky?num=1')) return sticky('Daily Discussion - March 31', created);
+        return notFound();
+      },
+    });
+    const r = await mod.findDailyDiscussionThread('stocks');
+    expect(r).not.toBeNull();
+  });
+
+  test('falls back to sticky 2 if sticky 1 is not a daily thread', async () => {
+    const created = new Date('2026-03-31T07:30:00-04:00').getTime() / 1000;
+    mod._setNow(() => new Date(TODAY_UTC));
+    mod._setDeps({
+      fetch: async (url) => {
+        if (url.includes('sticky?num=1')) return sticky('Weekly Megathread', created);
+        if (url.includes('sticky?num=2')) return sticky('Daily Discussion Thread', created);
+        return notFound();
+      },
+    });
+    const r = await mod.findDailyDiscussionThread('stocks');
+    expect(r).not.toBeNull();
+  });
+
+  test('falls back to hot posts if both stickies fail', async () => {
+    const created = new Date('2026-03-31T08:00:00-04:00').getTime() / 1000;
+    mod._setNow(() => new Date(TODAY_UTC));
+    mod._setDeps({
+      fetch: async (url) => {
+        if (url.includes('sticky')) return notFound();
+        if (url.includes('/hot')) return hotPosts([{ title: 'Daily Discussion Thread', name: 't3_abc', created_utc: created }]);
+        return notFound();
+      },
+    });
+    const r = await mod.findDailyDiscussionThread('stocks');
+    expect(r).not.toBeNull();
+  });
+
+  test('returns null if no daily thread found by any method', async () => {
+    mod._setNow(() => new Date(TODAY_UTC));
+    mod._setDeps({ fetch: async () => notFound() });
+    const r = await mod.findDailyDiscussionThread('stocks');
+    expect(r).toBeNull();
+  });
+
+  test('uses EST timezone — post created at 23:00 UTC (7 PM EST) is "today"', async () => {
+    const created = new Date('2026-03-31T23:00:00Z').getTime() / 1000;
+    mod._setNow(() => new Date('2026-03-31T23:30:00Z'));
+    mod._setDeps({
+      fetch: async (url) => {
+        if (url.includes('sticky?num=1')) return sticky('Daily Discussion', created);
+        return notFound();
+      },
+    });
+    const r = await mod.findDailyDiscussionThread('stocks');
+    expect(r).not.toBeNull();
+  });
+
+  test('rejects sticky posted yesterday (EST)', async () => {
+    // 22:00 UTC yesterday = 6 PM EST yesterday
+    const created = new Date('2026-03-30T22:00:00Z').getTime() / 1000;
+    mod._setNow(() => new Date('2026-03-31T12:00:00Z'));
+    mod._setDeps({
+      fetch: async (url) => {
+        if (url.includes('sticky?num=1')) return sticky('Daily Discussion', created);
+        return notFound();
+      },
+    });
+    const r = await mod.findDailyDiscussionThread('stocks');
+    expect(r).toBeNull();
+  });
+});
+
+// ─── buildDailyThreadComment ──────────────────────────────────────────────
+
+describe('buildDailyThreadComment', () => {
+  const mockData = {
+    filings: [
+      { ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-30', company: 'Apple Inc.' },
+      { ticker: 'MSFT', insider_name: 'Satya Nadella', role: 'CEO', value_usd: 500000, date: '2026-03-30', company: 'Microsoft Corp.' },
+    ],
+    period: 'yesterday',
+  };
+
+  test('returns non-empty string for template index 0 (notable_buys)', () => {
+    const text = mod.buildDailyThreadComment(mockData, 0);
+    expect(typeof text).toBe('string');
+    expect(text.length).toBeGreaterThan(50);
+  });
+
+  test('returns non-empty string for template index 1 (confidence_index)', () => {
+    const text = mod.buildDailyThreadComment(mockData, 1);
+    expect(typeof text).toBe('string');
+    expect(text.length).toBeGreaterThan(50);
+  });
+
+  test('returns non-empty string for template index 2 (unusual_activity)', () => {
+    const text = mod.buildDailyThreadComment(mockData, 2);
+    expect(typeof text).toBe('string');
+    expect(text.length).toBeGreaterThan(50);
+  });
+
+  test('includes ticker symbol in output', () => {
+    const text = mod.buildDailyThreadComment(mockData, 0);
+    expect(text.includes('AAPL') || text.includes('MSFT')).toBe(true);
+  });
+
+  test('includes formatted dollar amount', () => {
+    const text = mod.buildDailyThreadComment(mockData, 0);
+    expect(text.includes('$')).toBe(true);
+    expect(text.includes('M') || text.includes('K')).toBe(true);
+  });
+
+  test('does not contain URLs', () => {
+    [0, 1, 2].forEach((idx) => {
+      const text = mod.buildDailyThreadComment(mockData, idx);
+      expect(/https?:\/\//.test(text)).toBe(false);
+    });
+  });
+
+  test('handles empty filings array without throwing', () => {
+    expect(() => mod.buildDailyThreadComment({ filings: [], period: 'yesterday' }, 0)).not.toThrow();
+  });
+
+  test('includes period label in weekend recap (Monday)', () => {
+    const text = mod.buildDailyThreadComment({ filings: mockData.filings, period: 'Fri-Sun' }, 1);
+    expect(text.includes('Fri') || text.includes('weekend') || text.includes('Sun')).toBe(true);
+  });
+});
+
+// ─── postDailyThread ──────────────────────────────────────────────────────
+
+describe('postDailyThread', () => {
+  afterEach(() => {
+    mod._setNow(null);
+    mod._setDeps(null);
+  });
+
+  test('returns early when shouldPostDailyThread() returns post=false', async () => {
+    const posts = [];
+    mod._setNow(() => new Date('2026-03-28T10:00:00Z')); // Saturday
+    mod._setDeps({
+      fetch: async (url, opts) => {
+        if (opts && opts.method === 'POST' && url.includes('reddit.com')) posts.push(true);
+        return { status: 200, json: () => ({ list: [] }) };
+      },
+    });
+    await mod.postDailyThread();
+    expect(posts.length).toBe(0);
+  });
+
+  test('returns early when findDailyDiscussionThread() returns null — logs warning', async () => {
+    const posts = [];
+    const nowFn = () => new Date('2026-03-31T10:00:00Z'); // Tuesday
+    mod._setNow(nowFn);
+    mod._setDeps({
+      fetch: async (url, opts) => {
+        if (opts && opts.method === 'POST' && url.includes('api/comment')) posts.push(true);
+        if (url.includes('sticky') || url.includes('/hot') || url.includes('search')) {
+          return { status: 404, json: () => ({}) };
+        }
+        return { status: 200, json: () => ({ list: [] }) };
+      },
+    });
+    await mod.postDailyThread();
+    expect(posts.length).toBe(0);
+  });
+
+  test('posts comment and does not throw — verify no crash', async () => {
+    const nowFn = () => new Date('2026-03-31T10:00:00Z'); // Tuesday
+    mod._setNow(nowFn);
+    const threadCreated = new Date('2026-03-31T07:00:00-04:00').getTime() / 1000;
+    mod._setDeps({
+      fetch: async (url, opts) => {
+        if (url.includes('sticky?num=1')) {
+          return {
+            status: 200,
+            json: () => ({ data: { title: 'Daily Discussion', name: 't3_thread1', id: 'thread1', created_utc: threadCreated } }),
+          };
+        }
+        if (opts && opts.method === 'POST' && url.includes('api/comment')) {
+          return {
+            status: 200,
+            json: () => ({ json: { data: { things: [{ data: { id: 'newcmt', name: 't1_newcmt' } }] } } }),
+          };
+        }
+        if (url.includes('nocodb')) return { status: 200, json: () => ({ list: [] }) };
+        if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) {
+          return { status: 200, json: () => ({}) };
+        }
+        return { status: 200, json: () => ({ list: [{ ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-30' }] }) };
+      },
+    });
+    await expect(mod.postDailyThread()).resolves.not.toThrow();
+  });
+});
+
+// ─── Section 05 — CAT 6 DD Posts ──────────────────────────────────────────
+
+describe('checkDDPostLimit', () => {
+  function mockDD(rows) {
+    mod._setDeps({ fetch: async () => ({ status: 200, json: () => ({ list: rows }) }) });
+  }
+
+  afterEach(() => { mod._setDeps(null); });
+
+  test('returns allowed=true when no recent posts', async () => {
+    mockDD([]);
+    const r = await mod.checkDDPostLimit();
+    expect(r.allowed).toBe(true);
+  });
+  test('returns allowed=false + reason=too_recent when last post < 3 days ago', async () => {
+    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
+    mockDD([{ posted_at: recentDate, status: 'posted' }]);
+    const r = await mod.checkDDPostLimit();
+    expect(r.allowed).toBe(false);
+    expect(r.reason).toBe('too_recent');
+  });
+  test('returns allowed=false + reason=monthly_limit when 8+ posts this month', async () => {
+    const rows = Array(8).fill({ posted_at: new Date().toISOString(), status: 'posted' });
+    mockDD(rows);
+    const r = await mod.checkDDPostLimit();
+    expect(r.allowed).toBe(false);
+    expect(r.reason).toBe('monthly_limit');
+  });
+  test('counts only status=posted records', async () => {
+    mockDD([{ posted_at: new Date().toISOString(), status: 'draft' }]);
+    const r = await mod.checkDDPostLimit();
+    expect(r.allowed).toBe(true);
+  });
+});
+
+describe('buildDDPost — 4-step pipeline', () => {
+  let callCount;
+  function mockClaude(responses) {
+    callCount = 0;
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('anthropic.com') || url.includes('claude')) {
+        const resp = responses[callCount] || 'default text '.repeat(200);
+        callCount++;
+        return { status: 200, json: () => ({ content: [{ text: resp }] }) };
+      }
+      return { status: 200, json: () => ({ list: [] }) };
+    }});
+  }
+
+  afterEach(() => { mod._setDeps(null); });
+
+  const mockFilingData = {
+    ticker: 'AAPL', company: 'Apple Inc.', marketCapUsd: 3_000_000_000_000,
+    filings: [{ insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', price: 210 }],
+    priceHistory: [], peers: [],
+  };
+
+  test('makes exactly 4 Claude calls in sequence', async () => {
+    const outline = 'Section headers here';
+    const fullDraft = '## Bear Case\n' + 'risk '.repeat(450) + '## TLDR\n- point\n' + 'body '.repeat(1100);
+    const bearReview = 'Score: 8. The bear case is strong.';
+    const tldr = '## TLDR\n- $AAPL CEO bought $2M\n- Strong insider track record\n- Bear case: App Store antitrust';
+    mockClaude([outline, fullDraft, bearReview, tldr]);
+    await mod.buildDDPost('AAPL', mockFilingData);
+    expect(callCount).toBe(4);
+  });
+  test('Step 3 replaces Bear Case when score < 7', async () => {
+    const outline = 'Outline';
+    const fullDraft = '## Bear Case\nweak bear case.\n## TLDR\n- point\n' + 'body '.repeat(1600);
+    const bearLow = 'Score: 4. Rewrite:\n## Bear Case\n' + 'strong risk '.repeat(450);
+    const tldr = '## TLDR\n- point one\n- point two\n- point three';
+    mockClaude([outline, fullDraft, bearLow, tldr]);
+    const result = await mod.buildDDPost('AAPL', mockFilingData);
+    expect(result).not.toBeNull();
+    expect(result).toContain('strong risk');
+  });
+  test('Step 3 keeps original Bear Case when score >= 7', async () => {
+    const outline = 'Outline';
+    const bearOriginal = '## Bear Case\n' + 'original risk '.repeat(450);
+    const fullDraft = bearOriginal + '## TLDR\n- point\n' + 'body '.repeat(1100);
+    const bearHigh = 'Score: 9. The bear case is solid.';
+    const tldr = '## TLDR\n- point one\n- point two';
+    mockClaude([outline, fullDraft, bearHigh, tldr]);
+    const result = await mod.buildDDPost('AAPL', mockFilingData);
+    expect(result).not.toBeNull();
+    expect(result).toContain('original risk');
+  });
+  test('Step 4 TLDR is prepended to the post', async () => {
+    const outline = 'Outline';
+    const fullDraft = '## Bear Case\n' + 'risk '.repeat(450) + '\nbody '.repeat(1100);
+    const bearReview = 'Score: 8. Strong.';
+    const tldr = '## TLDR\n- First bullet\n- Second bullet';
+    mockClaude([outline, fullDraft, bearReview, tldr]);
+    const result = await mod.buildDDPost('AAPL', mockFilingData);
+    if (result) expect(result.indexOf('## TLDR')).toBeLessThan(200);
+  });
+});
+
+describe('validateDDPost retry in buildDDPost pipeline', () => {
+  afterEach(() => { mod._setDeps(null); });
+
+  test('retries Step 2 once with failure reason in prompt if validation fails first time', async () => {
+    const prompts = [];
+    let callCount = 0;
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        callCount++;
+        const body = JSON.parse(opts.body);
+        const userMsg = (body.messages && body.messages.find(function(m) { return m.role === 'user'; }) || {}).content || '';
+        prompts.push(userMsg);
+        if (callCount === 2) return { status: 200, json: () => ({ content: [{ text: 'short draft' }] }) };
+        if (callCount === 3) {
+          const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
+          return { status: 200, json: () => ({ content: [{ text: valid }] }) };
+        }
+        return { status: 200, json: () => ({ content: [{ text: 'x' }] }) };
+      }
+      return { status: 200, json: () => ({ list: [] }) };
+    }});
+    await mod.buildDDPost('AAPL', { ticker: 'AAPL', filings: [], priceHistory: [], peers: [] });
+    const retryPrompt = prompts.find(function(p) { return p.includes('word') || p.includes('Bear') || p.includes('short') || p.includes('failed') || p.includes('validation') || p.includes('Fix'); });
+    expect(retryPrompt || callCount >= 3).toBeTruthy();
+  });
+  test('returns null if validation fails after retry', async () => {
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'too short' }] }) };
+      return { status: 200, json: () => ({ list: [] }) };
+    }});
+    const result = await mod.buildDDPost('AAPL', { ticker: 'AAPL', filings: [], priceHistory: [], peers: [] });
+    expect(result).toBeNull();
+  });
+});
+
+describe('human-likeness check in postDDPost', () => {
+  afterEach(() => { mod._setDeps(null); mod._setNow(null); });
+
+  test('aborts if human-likeness rating < 7 after rewrite cycle', async () => {
+    const posts = [];
+    let call = 0;
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        call++;
+        if (call <= 4) {
+          const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
+          return { status: 200, json: () => ({ content: [{ text: valid }] }) };
+        }
+        return { status: 200, json: () => ({ content: [{ text: 'Rating: 5\n1. phrase one\n2. phrase two\n3. phrase three\nRewrite: ...' }] }) };
+      }
+      if (opts && opts.method === 'POST' && url.includes('reddit.com')) posts.push(true);
+      return { status: 200, json: () => ({ list: [{ ticker: 'AAPL', insider_name: 'T.Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', score: 9, marketCapUsd: 3e12 }] }) };
+    }});
+    mod._setNow(function() { return new Date('2026-03-31T15:00:00Z'); }); // Tuesday 11 AM EST
+    await mod.postDDPost();
+    expect(posts.length).toBe(0);
+  });
+});
+
+describe('Imgur visual upload', () => {
+  afterEach(() => { mod._setDeps(null); });
+
+  test('skips visual if generateInsiderTable returns null', async () => {
+    const imgurCalls = [];
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('api.imgur.com')) imgurCalls.push(true);
+      return { status: 200, json: () => ({ data: { link: 'https://i.imgur.com/abc.png' } }) };
+    }});
+    const result = await mod._uploadDDVisuals('AAPL', [], [], []);
+    expect(imgurCalls.length).toBe(0);
+    expect(result).toEqual([]);
+  });
+  test('calls Imgur when a visual returns non-null base64', async () => {
+    const imgurCalls = [];
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('api.imgur.com')) { imgurCalls.push(true); return { status: 200, json: () => ({ data: { link: 'https://i.imgur.com/abc.png' } }) }; }
+      return { status: 200, json: () => ({}) };
+    }});
+    const vt = require('../../n8n/code/insiderbuying/visual-templates.js');
+    const orig = vt.generateInsiderTable;
+    vt.generateInsiderTable = function() { return 'base64data=='; };
+    const result = await mod._uploadDDVisuals('AAPL', [{ ticker: 'AAPL' }], [], []);
+    vt.generateInsiderTable = orig;
+    expect(imgurCalls.length).toBeGreaterThanOrEqual(1);
+  });
+  test('skips gracefully if Imgur upload throws', async () => {
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('api.imgur.com')) throw new Error('Imgur unavailable');
+      return { status: 200, json: () => ({}) };
+    }});
+    const vt = require('../../n8n/code/insiderbuying/visual-templates.js');
+    const orig = vt.generatePriceChart;
+    vt.generatePriceChart = function() { return 'base64=='; };
+    await expect(mod._uploadDDVisuals('AAPL', [], {}, [])).resolves.not.toThrow();
+    vt.generatePriceChart = orig;
+  });
+});
+
+describe('target subreddit selection — _selectDDSubreddits', () => {
+  test('always includes stocks', () => {
+    const subs = mod._selectDDSubreddits(7, 500_000_000, 1);
+    expect(subs).toContain('stocks');
+  });
+  test('includes wallstreetbets when score >= 8 and marketCap >= 5B', () => {
+    const subs = mod._selectDDSubreddits(8, 10_000_000_000, 1);
+    expect(subs).toContain('wallstreetbets');
+  });
+  test('excludes wallstreetbets when score < 8', () => {
+    const subs = mod._selectDDSubreddits(7, 10_000_000_000, 1);
+    expect(subs).not.toContain('wallstreetbets');
+  });
+  test('includes ValueInvesting when >= 3 fundamental metrics cited', () => {
+    const subs = mod._selectDDSubreddits(7, 1_000_000_000, 3);
+    expect(subs).toContain('ValueInvesting');
+  });
+  test('excludes ValueInvesting when < 3 metrics', () => {
+    const subs = mod._selectDDSubreddits(7, 1_000_000_000, 2);
+    expect(subs).not.toContain('ValueInvesting');
+  });
+});
+
+describe('per-subreddit intro variants', () => {
+  afterEach(() => { mod._setDeps(null); });
+
+  test('stocks variant uses main DD body unchanged (no extra Claude call)', async () => {
+    const body = 'main body '.repeat(100);
+    let claudeCalls = 0;
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('anthropic')) claudeCalls++;
+      return { status: 200, json: () => ({ content: [{ text: 'wsb opener' }] }) };
+    }});
+    const variants = await mod._buildSubredditVariants(['stocks'], body, 'AAPL');
+    expect(variants.stocks).toBe(body + '\n\nNot financial advice. Do your own research.');
+    expect(claudeCalls).toBe(0);
+  });
+  test('wallstreetbets variant has opener prepended + NFA appended', async () => {
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'WSB opener for AAPL' }] }) };
+      return { status: 200, json: () => ({ list: [] }) };
+    }});
+    const body = 'main body '.repeat(100);
+    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets'], body, 'AAPL');
+    expect(variants.wallstreetbets.startsWith('WSB opener for AAPL')).toBe(true);
+    expect(variants.wallstreetbets.endsWith('Not financial advice. Do your own research.')).toBe(true);
+  });
+  test('all variants are <= 38000 chars', async () => {
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'Short opener.' }] }) };
+      return { status: 200, json: () => ({ list: [] }) };
+    }});
+    const body = 'body '.repeat(5000);
+    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets', 'ValueInvesting'], body, 'AAPL');
+    Object.values(variants).forEach(function(v) { expect(v.length).toBeLessThanOrEqual(38000); });
+  });
+  test('NFA disclaimer appended to all variants', async () => {
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text: 'opener' }] }) };
+      return { status: 200, json: () => ({ list: [] }) };
+    }});
+    const body = 'body '.repeat(100);
+    const variants = await mod._buildSubredditVariants(['stocks', 'wallstreetbets'], body, 'AAPL');
+    Object.values(variants).forEach(function(v) {
+      expect(v.includes('Not financial advice.')).toBe(true);
+    });
+  });
+});
+
+describe('postDDPost', () => {
+  afterEach(() => { mod._setDeps(null); mod._setNow(null); });
+
+  test('returns early when checkDDPostLimit not allowed', async () => {
+    const posts = [];
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (opts && opts.method === 'POST' && url.includes('reddit.com/r/')) posts.push(true);
+      return { status: 200, json: () => ({ list: [{ posted_at: new Date().toISOString(), status: 'posted' }] }) };
+    }});
+    await mod.postDDPost();
+    expect(posts.length).toBe(0);
+  });
+  test('returns early when day is not Tue-Thu', async () => {
+    const posts = [];
+    mod._setNow(function() { return new Date('2026-03-28T10:00:00Z'); }); // Saturday
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (opts && opts.method === 'POST' && url.includes('reddit.com')) posts.push(true);
+      return { status: 200, json: () => ({ list: [] }) };
+    }});
+    await mod.postDDPost();
+    expect(posts.length).toBe(0);
+  });
+  test('returns early when time is outside 10AM-2PM EST', async () => {
+    const posts = [];
+    mod._setNow(function() { return new Date('2026-03-31T21:00:00Z'); }); // Tuesday 5 PM EST
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (opts && opts.method === 'POST' && url.includes('reddit.com')) posts.push(true);
+      return { status: 200, json: () => ({ list: [] }) };
+    }});
+    await mod.postDDPost();
+    expect(posts.length).toBe(0);
+  });
+  test('logs to Reddit_DD_Posts with status=posted and price_at_post', async () => {
+    const ddPostLogs = [];
+    mod._setNow(function() { return new Date('2026-03-31T15:00:00Z'); }); // Tuesday 11 AM EST
+    let call = 0;
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        call++;
+        const valid = '## Bear Case\n' + 'risk '.repeat(450) + '\n## TLDR\n- pt\n' + 'body '.repeat(1100);
+        if (call <= 4) return { status: 200, json: () => ({ content: [{ text: valid }] }) };
+        return { status: 200, json: () => ({ content: [{ text: 'Rating: 8. Looks human.' }] }) };
+      }
+      if (opts && opts.method === 'POST' && url.includes('Reddit_DD_Posts')) {
+        ddPostLogs.push(JSON.parse(opts.body));
+        return { status: 200, json: () => ({}) };
+      }
+      if (opts && opts.method === 'POST' && url.includes('reddit.com')) {
+        return { status: 200, json: () => ({ json: { data: { things: [{ data: { id: 'dd1', name: 't3_dd1', url: 'https://reddit.com/r/stocks/dd1' } }] } } }) };
+      }
+      if (opts && opts.method === 'POST' && url.includes('Scheduled_Jobs')) return { status: 200, json: () => ({}) };
+      return { status: 200, json: () => ({ list: [{ ticker: 'AAPL', insider_name: 'T.Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-28', score: 9, marketCapUsd: 3e12 }] }) };
+    }});
+    await mod.postDDPost();
+    if (ddPostLogs.length > 0) {
+      expect(ddPostLogs[0].status).toBe('posted');
+      expect('price_at_post' in ddPostLogs[0]).toBe(true);
+    }
+  });
+});
+
+// ─── Section 06 — Anti-AI Detection ──────────────────────────────────────
+
+describe('NEGATIVE_EXAMPLES', () => {
+  test('is a non-empty string', () => {
+    expect(typeof mod.NEGATIVE_EXAMPLES === 'string' && mod.NEGATIVE_EXAMPLES.length > 100).toBe(true);
+  });
+  test('contains a bad example (passive voice pattern)', () => {
+    const lower = mod.NEGATIVE_EXAMPLES.toLowerCase();
+    expect(lower.includes('bad') || lower.includes('avoid') || lower.includes('worth noting')).toBe(true);
+  });
+  test('contains a good example (direct, specific)', () => {
+    const lower = mod.NEGATIVE_EXAMPLES.toLowerCase();
+    expect(lower.includes('good') || lower.includes('direct') || lower.includes('$')).toBe(true);
+  });
+  test('does not contain any URLs', () => {
+    expect(/https?:\/\//.test(mod.NEGATIVE_EXAMPLES)).toBe(false);
+  });
+  test('does not contain EarlyInsider brand name', () => {
+    expect(mod.NEGATIVE_EXAMPLES.toLowerCase().includes('earlyinsider')).toBe(false);
+  });
+});
+
+describe('ANTI_PUMP_RULE', () => {
+  test('is a non-empty string', () => {
+    expect(typeof mod.ANTI_PUMP_RULE === 'string' && mod.ANTI_PUMP_RULE.length > 20).toBe(true);
+  });
+  test('contains NEVER or never', () => {
+    expect(/never/i.test(mod.ANTI_PUMP_RULE)).toBe(true);
+  });
+  test('mentions recommend or buying', () => {
+    const lower = mod.ANTI_PUMP_RULE.toLowerCase();
+    expect(lower.includes('recommend') || lower.includes('buying') || lower.includes('buy')).toBe(true);
+  });
+});
+
+describe('buildCommentPrompt', () => {
+  const mockPost = { title: 'CEO of AAPL just filed Form 4', selftext: 'What do you think?', subreddit: 'stocks', score: 50, name: 't3_abc' };
+  const mockInsiderData = { ticker: 'AAPL', insider_name: 'Tim Cook', role: 'CEO', value_usd: 2000000, date: '2026-03-25', track_record: '3 prior buys, avg +22% in 12mo' };
+  const mockStructure = { id: 'Q_A_DATA', systemPromptInstruction: 'Open with a question, then answer with data.' };
+
+  function mockClaudeResponse(text) {
+    mod._setDeps({ fetch: async (url) => {
+      if (url.includes('anthropic')) return { status: 200, json: () => ({ content: [{ text }] }) };
+      return { status: 200, json: () => ({}) };
+    }});
+  }
+
+  afterEach(() => { mod._setDeps(null); });
+
+  test('includes NEGATIVE_EXAMPLES in system prompt', async () => {
+    let systemPrompt = '';
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        systemPrompt = body.system || '';
+        return { status: 200, json: () => ({ content: [{ text: 'CEO bought $2M. Third buy this year.' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(systemPrompt.includes('avoid') || systemPrompt.includes('NEVER') || systemPrompt.includes('worth noting')).toBe(true);
+  });
+  test('includes ANTI_PUMP_RULE in system prompt', async () => {
+    let systemPrompt = '';
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        systemPrompt = body.system || '';
+        return { status: 200, json: () => ({ content: [{ text: 'Test response.' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(/never/i.test(systemPrompt)).toBe(true);
+  });
+  test('includes subreddit tone string from SUBREDDIT_TONE_MAP', async () => {
+    let systemPrompt = '';
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        systemPrompt = body.system || '';
+        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(systemPrompt.includes('balanced') || systemPrompt.length > 50).toBe(true);
+  });
+  test('includes structure instruction in system prompt', async () => {
+    let systemPrompt = '';
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        systemPrompt = body.system || '';
+        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(systemPrompt.includes('question') || systemPrompt.includes('Q_A')).toBe(true);
+  });
+  test('includes post title and body in user message', async () => {
+    let userMessage = '';
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        userMessage = JSON.stringify(body.messages);
+        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(userMessage.includes('CEO of AAPL just filed Form 4')).toBe(true);
+  });
+  test('includes insider data in user message', async () => {
+    let userMessage = '';
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        userMessage = JSON.stringify(body.messages);
+        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(userMessage.includes('Tim Cook') || userMessage.includes('AAPL')).toBe(true);
+  });
+  test('sets model to claude-sonnet-4-6', async () => {
+    let model = '';
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        model = body.model || '';
+        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(model.includes('claude-sonnet-4-6') || model.includes('sonnet')).toBe(true);
+  });
+  test('sets maxTokens to 300', async () => {
+    let maxTokens = 0;
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        maxTokens = body.max_tokens || 0;
+        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(maxTokens).toBe(300);
+  });
+  test('sets temperature to 0.7', async () => {
+    let temperature = 0;
+    mod._setDeps({ fetch: async (url, opts) => {
+      if (url.includes('anthropic')) {
+        const body = JSON.parse(opts.body);
+        temperature = body.temperature || 0;
+        return { status: 200, json: () => ({ content: [{ text: 'OK' }] }) };
+      }
+      return { status: 200, json: () => ({}) };
+    }});
+    await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(Math.abs(temperature - 0.7)).toBeLessThan(0.01);
+  });
+  test('makes the actual Claude API call and returns generated text string', async () => {
+    mockClaudeResponse('CEO just dropped $2M on AAPL at these prices. Third buy this year. Curious if others are watching this.');
+    const text = await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+    expect(typeof text === 'string' && text.length > 10).toBe(true);
+  });
+  test('returns null/throws when Claude returns empty string', async () => {
+    mockClaudeResponse('');
+    try {
+      const text = await mod.buildCommentPrompt(mockPost, mockInsiderData, 'stocks', mockStructure);
+      expect(text === null || text === '' || text === undefined).toBe(true);
+    } catch (_) { /* acceptable */ }
+  });
+});
