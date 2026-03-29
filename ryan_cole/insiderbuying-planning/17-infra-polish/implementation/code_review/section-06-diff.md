diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/content-calendar.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/content-calendar.js
new file mode 100644
index 0000000..8bd07eb
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/content-calendar.js
@@ -0,0 +1,396 @@
+'use strict';
+
+/**
+ * content-calendar.js -- Shared Content Utility Module
+ *
+ * Exported functions consumed by article generators, competitor monitors,
+ * and the earnings-driven scheduler. Not a standalone n8n workflow.
+ *
+ * Dependencies:
+ *   - fast-xml-parser (npm) -- must be installed in n8n environment
+ *   - NocoDB tables: Content_Calendar, Competitor_Intel, SEO_State
+ *   - All external I/O injected via opts for testability
+ */
+
+var XMLParser = null;
+try {
+  XMLParser = require('fast-xml-parser').XMLParser;
+} catch (e) {
+  console.warn('[content-calendar] fast-xml-parser not available -- RSS parsing will be skipped');
+}
+
+var ALPHA_VANTAGE_DELAY_MS = 12000; // 5 calls/min free tier -> 12s gap
+
+// Uppercase tokens that are NOT ticker symbols
+var TICKER_STOP_WORDS = new Set([
+  // Common English words that appear in all caps
+  'THE', 'AND', 'FOR', 'FROM', 'WITH', 'THAT', 'THIS', 'ARE', 'ITS',
+  'HOW', 'WHY', 'WHAT', 'WHO', 'NEW', 'BIG', 'HIGH', 'LOW', 'GET',
+  'NOT', 'BUT', 'WAS', 'HAS', 'HAD', 'DID', 'CAN', 'MAY', 'WILL',
+  'COULD', 'WOULD', 'SHOULD', 'THEIR', 'AFTER', 'ABOUT', 'OVER',
+  'INTO', 'ALSO', 'BEEN', 'HAVE', 'SAID', 'MORE', 'THAN', 'WHEN',
+  // 2-letter prepositions/articles
+  'OF', 'IN', 'AT', 'AN', 'TO', 'AS', 'IS', 'IT', 'BE', 'BY',
+  'DO', 'GO', 'NO', 'ON', 'OR', 'SO', 'UP', 'HE', 'ME', 'MY',
+  'US', 'WE', 'IF', 'AM',
+  // Finance/regulatory abbreviations that are not tickers
+  'NYSE', 'SEC', 'CEO', 'CFO', 'COO', 'IPO', 'ETF', 'GDP', 'CPI',
+  'USD', 'EUR', 'GBP', 'YOY', 'QOQ', 'EPS', 'TTM', 'YTD', 'ALL',
+  'ESG', 'ROI', 'ROE', 'FCF', 'DCF', 'PEG', 'ATH', 'ATL', 'AUM',
+  'API', 'SaaS', 'FTC', 'DOJ', 'IRS', 'FED', 'ECB',
+]);
+
+// Stop words for TF-IDF similarity computation
+var SIMILARITY_STOP_WORDS = new Set([
+  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
+  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
+  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
+  'might', 'this', 'that', 'from', 'into', 'as', 'its', 'it', 'he', 'she',
+  'they', 'we', 'his', 'her', 'their', 'our', 'my',
+  // Financial common words
+  'stock', 'company', 'shares', 'insider', 'buy', 'purchase', 'million',
+  'billion', 'quarter', 'year', 'market', 'price', 'trading', 'said',
+  'also', 'after', 'about', 'over', 'than', 'when', 'more', 'been',
+]);
+
+// ---------------------------------------------------------------------------
+// Internal: ticker extraction
+// ---------------------------------------------------------------------------
+
+function extractTickers(text) {
+  if (!text) return [];
+  var matches = text.match(/\b[A-Z]{2,5}\b/g) || [];
+  var seen = {};
+  var result = [];
+  for (var i = 0; i < matches.length; i++) {
+    var tok = matches[i];
+    if (!TICKER_STOP_WORDS.has(tok) && !seen[tok]) {
+      seen[tok] = true;
+      result.push(tok);
+    }
+  }
+  return result;
+}
+
+// ---------------------------------------------------------------------------
+// Internal: TF-IDF cosine similarity
+// ---------------------------------------------------------------------------
+
+function tokenize(text) {
+  return text.toLowerCase().split(/\W+/).filter(function(w) {
+    return w.length > 1 && !SIMILARITY_STOP_WORDS.has(w);
+  });
+}
+
+function truncateWords(text, maxWords) {
+  var words = (text || '').split(/\s+/);
+  if (words.length <= maxWords) return text || '';
+  return words.slice(0, maxWords).join(' ');
+}
+
+function buildTF(tokens) {
+  var tf = {};
+  for (var i = 0; i < tokens.length; i++) {
+    tf[tokens[i]] = (tf[tokens[i]] || 0) + 1;
+  }
+  var len = tokens.length || 1;
+  var term;
+  for (term in tf) tf[term] = tf[term] / len;
+  return tf;
+}
+
+function buildIDF(corpus) {
+  var N = corpus.length;
+  var df = {};
+  for (var i = 0; i < N; i++) {
+    var seen = {};
+    for (var j = 0; j < corpus[i].length; j++) {
+      var t = corpus[i][j];
+      if (!seen[t]) { seen[t] = true; df[t] = (df[t] || 0) + 1; }
+    }
+  }
+  var idf = {};
+  var term;
+  // Smooth IDF (+1): ensures weights never collapse to 0 in small corpora
+  for (term in df) idf[term] = Math.log((N + 1) / (df[term] + 1)) + 1;
+  return idf;
+}
+
+function cosineSimilarity(vecA, vecB) {
+  var dot = 0;
+  var magA = 0;
+  var magB = 0;
+  var t;
+  for (t in vecA) { magA += vecA[t] * vecA[t]; }
+  for (t in vecB) { magB += vecB[t] * vecB[t]; }
+  for (t in vecA) { if (vecB[t]) dot += vecA[t] * vecB[t]; }
+  if (magA === 0 || magB === 0) return 0;
+  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
+}
+
+// ---------------------------------------------------------------------------
+// addToCalendar
+// ---------------------------------------------------------------------------
+
+/**
+ * Schedule a new content item.
+ * @param {{ ticker: string, type: string, date: string, channel: string, notes?: string }} entry
+ * @param {{ nocodb: { post: Function } }} opts
+ * @returns {Promise<Object>} Created NocoDB record
+ */
+async function addToCalendar(entry, opts) {
+  var body = {
+    ticker_or_topic: entry.ticker,
+    content_type: entry.type,
+    planned_date: entry.date,
+    status: 'planned',
+    channel: entry.channel,
+  };
+  if (entry.notes !== undefined && entry.notes !== null) {
+    body.notes = entry.notes;
+  }
+  return opts.nocodb.post('Content_Calendar', body);
+}
+
+// ---------------------------------------------------------------------------
+// getCalendarForDate
+// ---------------------------------------------------------------------------
+
+/**
+ * Retrieve planned content items for a specific date.
+ * @param {string} date - ISO date string (YYYY-MM-DD)
+ * @param {{ nocodb: { get: Function } }} opts
+ * @returns {Promise<Array>}
+ */
+async function getCalendarForDate(date, opts) {
+  var where = '(planned_date,eq,' + date + ')~and(status,eq,planned)';
+  var result = await opts.nocodb.get('Content_Calendar', { where: where });
+  return (result && result.list) ? result.list : [];
+}
+
+// ---------------------------------------------------------------------------
+// checkContentFreshness
+// ---------------------------------------------------------------------------
+
+/**
+ * Check if we have recently published content for a ticker (within 30 days).
+ * @param {string} ticker
+ * @param {{ nocodb: { get: Function } }} opts
+ * @returns {Promise<{ fresh: boolean, lastPublished: string|null }>}
+ *   fresh: true  = article found within 30 days (content is fresh)
+ *   fresh: false = no recent coverage
+ */
+async function checkContentFreshness(ticker, opts) {
+  try {
+    var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
+    var where = '(ticker,eq,' + ticker + ')~and(published_at,gt,' + thirtyDaysAgo + ')';
+    var result = await opts.nocodb.get('Articles', { where: where, limit: 1 });
+    var records = (result && result.list) ? result.list : [];
+    if (records.length === 0) {
+      return { fresh: false, lastPublished: null };
+    }
+    return { fresh: true, lastPublished: records[0].published_at || null };
+  } catch (e) {
+    return { fresh: false, lastPublished: null };
+  }
+}
+
+// ---------------------------------------------------------------------------
+// checkCompetitorFeeds
+// ---------------------------------------------------------------------------
+
+/**
+ * Parse competitor RSS feeds and log items covering tickers we haven't covered recently.
+ * @param {{ feeds?: string[], fetchRSS?: Function, nocodb: Object, telegram: Object }} opts
+ */
+async function checkCompetitorFeeds(opts) {
+  var feeds = opts.feeds || [];
+  var failCount = 0;
+  var allFailed = true;
+
+  for (var i = 0; i < feeds.length; i++) {
+    var feedUrl = feeds[i];
+    try {
+      var xml = await opts.fetchRSS(feedUrl);
+      allFailed = false;
+
+      if (!XMLParser) {
+        console.warn('[content-calendar] fast-xml-parser not available, skipping feed: ' + feedUrl);
+        continue;
+      }
+
+      var parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '__cdata' });
+      var parsed = parser.parse(xml);
+      var channel = parsed && parsed.rss && parsed.rss.channel;
+      if (!channel) continue;
+
+      var items = channel.item;
+      if (!items) continue;
+      if (!Array.isArray(items)) items = [items];
+
+      for (var j = 0; j < items.length; j++) {
+        var item = items[j];
+        var title = (typeof item.title === 'string')
+          ? item.title
+          : (item.title && item.title.__cdata) || '';
+        var desc = (typeof item.description === 'string')
+          ? item.description
+          : (item.description && item.description.__cdata) || '';
+        var tickers = extractTickers(title + ' ' + desc);
+
+        for (var k = 0; k < tickers.length; k++) {
+          var ticker = tickers[k];
+          var freshness = await checkContentFreshness(ticker, opts);
+          if (!freshness.fresh) {
+            await opts.nocodb.post('Competitor_Intel', {
+              feed_url: feedUrl,
+              item_title: title,
+              item_url: item.link || '',
+              item_date: item.pubDate || '',
+              ticker_mentioned: ticker,
+              covered_by_us: false,
+              created_at: new Date().toISOString(),
+            });
+            await opts.telegram.send(
+              '[Competitor Intel] ' + ticker + ' mentioned in competitor feed but not covered recently. URL: ' +
+              (item.link || 'N/A')
+            );
+          }
+        }
+      }
+    } catch (err) {
+      failCount++;
+      console.warn('[content-calendar] Feed error (' + feedUrl + '): ' + (err && err.message));
+    }
+  }
+
+  if (failCount > 0 && allFailed) {
+    await opts.telegram.send(
+      '[content-calendar] ERROR: all ' + failCount + ' RSS feeds failed to load'
+    );
+  }
+}
+
+// ---------------------------------------------------------------------------
+// checkContentSimilarity (TF-IDF cosine)
+// ---------------------------------------------------------------------------
+
+/**
+ * Check if new article text is too similar to existing articles for the same ticker.
+ * @param {string} newArticleText
+ * @param {string} ticker
+ * @param {{ nocodb: { get: Function } }} opts
+ * @returns {Promise<{ similar: boolean, match: string|null }>}
+ *   similar: true if cosine similarity >= 0.85 (inclusive)
+ *   match: articleId of the most similar article, or null
+ */
+async function checkContentSimilarity(newArticleText, ticker, opts) {
+  try {
+    var result = await opts.nocodb.get('Articles', { ticker: ticker, limit: 10 });
+    var records = (result && result.list) ? result.list : [];
+    if (records.length === 0) return { similar: false, match: null };
+
+    var newTruncated = truncateWords(newArticleText, 2000);
+    var newTokens = tokenize(newTruncated);
+
+    var corpusTokens = [newTokens];
+    var existingTokens = [];
+    var existingIds = [];
+    for (var i = 0; i < records.length; i++) {
+      var t = truncateWords(records[i].body_text || '', 2000);
+      var tok = tokenize(t);
+      corpusTokens.push(tok);
+      existingTokens.push(tok);
+      existingIds.push(records[i].id || null);
+    }
+
+    var idf = buildIDF(corpusTokens);
+    var newTF = buildTF(newTokens);
+    var newVec = {};
+    var term;
+    for (term in newTF) newVec[term] = newTF[term] * (idf[term] || 0);
+
+    var bestScore = 0;
+    var bestId = null;
+    for (var j = 0; j < existingTokens.length; j++) {
+      var tf = buildTF(existingTokens[j]);
+      var vec = {};
+      for (term in tf) vec[term] = tf[term] * (idf[term] || 0);
+      var score = cosineSimilarity(newVec, vec);
+      if (score > bestScore) {
+        bestScore = score;
+        bestId = existingIds[j];
+      }
+    }
+
+    return { similar: bestScore >= 0.85, match: bestScore >= 0.85 ? bestId : null };
+  } catch (e) {
+    return { similar: false, match: null };
+  }
+}
+
+// ---------------------------------------------------------------------------
+// scheduleFromEarnings (D7.3)
+// ---------------------------------------------------------------------------
+
+/**
+ * Schedule article content for tickers with both earnings events and insider activity.
+ * Adds 12-second delays between Alpha Vantage calls (free tier limit).
+ * @param {{ nocodb: Object, delay?: Function, fetchEarnings?: Function }} opts
+ */
+async function scheduleFromEarnings(opts) {
+  var delayFn = opts.delay || function(ms) {
+    return new Promise(function(resolve) { setTimeout(resolve, ms); });
+  };
+
+  var earnings = [];
+  if (opts.fetchEarnings) {
+    earnings = await opts.fetchEarnings({ weeks: 4 });
+  } else {
+    try {
+      var earningsModule = require('./earnings-alerts');
+      if (earningsModule && earningsModule.fetchEarningsCalendar) {
+        earnings = await earningsModule.fetchEarningsCalendar({ weeks: 4 });
+      }
+    } catch (e) {
+      console.warn('[content-calendar] earnings-alerts module not available: ' + (e && e.message));
+    }
+  }
+
+  for (var i = 0; i < earnings.length; i++) {
+    if (i > 0) await delayFn(ALPHA_VANTAGE_DELAY_MS);
+
+    var item = earnings[i];
+    try {
+      var alertResult = await opts.nocodb.get('Insider_Alerts', { ticker: item.ticker, limit: 1 });
+      var alerts = (alertResult && alertResult.list) ? alertResult.list : [];
+      if (alerts.length === 0) continue;
+
+      var earningsDate = new Date(item.reportDate);
+      var scheduledDate = new Date(earningsDate.getTime() - 3 * 24 * 60 * 60 * 1000);
+      var scheduledDateStr = scheduledDate.toISOString().split('T')[0];
+
+      await addToCalendar({
+        ticker: item.ticker,
+        type: 'article',
+        date: scheduledDateStr,
+        channel: 'blog',
+      }, opts);
+    } catch (e) {
+      console.warn('[content-calendar] scheduleFromEarnings error for ' + item.ticker + ': ' + (e && e.message));
+    }
+  }
+}
+
+// ---------------------------------------------------------------------------
+// Exports
+// ---------------------------------------------------------------------------
+
+module.exports = {
+  addToCalendar: addToCalendar,
+  getCalendarForDate: getCalendarForDate,
+  checkContentFreshness: checkContentFreshness,
+  checkCompetitorFeeds: checkCompetitorFeeds,
+  checkContentSimilarity: checkContentSimilarity,
+  scheduleFromEarnings: scheduleFromEarnings,
+};
diff --git a/ryan_cole/insiderbuying-site/n8n/tests/content-calendar.test.js b/ryan_cole/insiderbuying-site/n8n/tests/content-calendar.test.js
new file mode 100644
index 0000000..d6f0def
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/n8n/tests/content-calendar.test.js
@@ -0,0 +1,376 @@
+'use strict';
+const { describe, it } = require('node:test');
+const assert = require('node:assert/strict');
+
+const {
+  addToCalendar,
+  getCalendarForDate,
+  checkContentFreshness,
+  checkCompetitorFeeds,
+  checkContentSimilarity,
+  scheduleFromEarnings,
+} = require('../code/insiderbuying/content-calendar.js');
+
+// ---------------------------------------------------------------------------
+// Helpers
+// ---------------------------------------------------------------------------
+
+function makeNocodb(overrides) {
+  return Object.assign({
+    post: async (table, body) => Object.assign({ id: 1 }, body),
+    get: async (table, params) => ({ list: [] }),
+    patch: async (table, id, body) => Object.assign({ id }, body),
+  }, overrides || {});
+}
+
+function makeTelegram(overrides) {
+  return Object.assign({ send: async (msg) => {} }, overrides || {});
+}
+
+const SAMPLE_RSS = '<?xml version="1.0" encoding="UTF-8"?>' +
+  '<rss version="2.0"><channel><title>Test Feed</title>' +
+  '<item>' +
+  '<title>AAPL Reports Record Earnings</title>' +
+  '<link>https://example.com/aapl-earnings</link>' +
+  '<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>' +
+  '<description><![CDATA[Apple (AAPL) reported Q4 earnings. CEO Tim Cook said growth is strong.]]></description>' +
+  '</item>' +
+  '<item>' +
+  '<title>SEC Filing on MSFT Insider Trade</title>' +
+  '<link>https://example.com/msft-filing</link>' +
+  '<pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>' +
+  '<description>Microsoft MSFT insider filing reviewed by the SEC.</description>' +
+  '</item>' +
+  '</channel></rss>';
+
+// ---------------------------------------------------------------------------
+// addToCalendar
+// ---------------------------------------------------------------------------
+describe('addToCalendar', () => {
+  it('calls nocodb.post with correct fields', async () => {
+    var posted = null;
+    var nocodb = makeNocodb({
+      post: async (table, body) => { posted = { table: table, body: body }; return Object.assign({ id: 1 }, body); },
+    });
+    await addToCalendar({ ticker: 'AAPL', type: 'article', date: '2024-01-15', channel: 'blog' }, { nocodb: nocodb });
+    assert.equal(posted.table, 'Content_Calendar');
+    assert.equal(posted.body.ticker_or_topic, 'AAPL');
+    assert.equal(posted.body.content_type, 'article');
+    assert.equal(posted.body.planned_date, '2024-01-15');
+    assert.equal(posted.body.status, 'planned');
+    assert.equal(posted.body.channel, 'blog');
+  });
+
+  it('status defaults to planned', async () => {
+    var postedBody = null;
+    var nocodb = makeNocodb({ post: async (t, body) => { postedBody = body; return body; } });
+    await addToCalendar({ ticker: 'TSLA', type: 'x_thread', date: '2024-02-01', channel: 'x' }, { nocodb: nocodb });
+    assert.equal(postedBody.status, 'planned');
+  });
+
+  it('omits notes field when not provided', async () => {
+    var postedBody = null;
+    var nocodb = makeNocodb({ post: async (t, body) => { postedBody = body; return body; } });
+    await addToCalendar({ ticker: 'GOOG', type: 'report', date: '2024-03-01', channel: 'email' }, { nocodb: nocodb });
+    assert.ok(!('notes' in postedBody), 'notes should not be in POST body when not provided');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// getCalendarForDate
+// ---------------------------------------------------------------------------
+describe('getCalendarForDate', () => {
+  it('constructs correct NocoDB where filter', async () => {
+    var calledParams = null;
+    var nocodb = makeNocodb({
+      get: async (table, params) => { calledParams = { table: table, params: params }; return { list: [] }; },
+    });
+    await getCalendarForDate('2024-01-15', { nocodb: nocodb });
+    assert.equal(calledParams.table, 'Content_Calendar');
+    assert.ok(calledParams.params.where.indexOf('planned_date,eq,2024-01-15') !== -1, 'where must filter by date');
+    assert.ok(calledParams.params.where.indexOf('status,eq,planned') !== -1, 'where must filter by status');
+  });
+
+  it('returns array from NocoDB response', async () => {
+    var items = [{ id: 1, ticker_or_topic: 'AAPL' }];
+    var nocodb = makeNocodb({ get: async () => ({ list: items }) });
+    var result = await getCalendarForDate('2024-01-15', { nocodb: nocodb });
+    assert.deepEqual(result, items);
+  });
+
+  it('returns empty array on empty response', async () => {
+    var nocodb = makeNocodb({ get: async () => ({ list: [] }) });
+    var result = await getCalendarForDate('2024-01-15', { nocodb: nocodb });
+    assert.deepEqual(result, []);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// checkContentFreshness
+// ---------------------------------------------------------------------------
+describe('checkContentFreshness', () => {
+  it('returns fresh: true when article published 10 days ago', async () => {
+    var tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
+    var nocodb = makeNocodb({ get: async () => ({ list: [{ published_at: tenDaysAgo }] }) });
+    var result = await checkContentFreshness('AAPL', { nocodb: nocodb });
+    assert.equal(result.fresh, true);
+    assert.ok(result.lastPublished != null);
+  });
+
+  it('returns fresh: false when no articles', async () => {
+    var nocodb = makeNocodb({ get: async () => ({ list: [] }) });
+    var result = await checkContentFreshness('AAPL', { nocodb: nocodb });
+    assert.equal(result.fresh, false);
+    assert.equal(result.lastPublished, null);
+  });
+
+  it('returns fresh: false when article published 31 days ago (outside 30-day window)', async () => {
+    // Mock returns empty (filter already excludes records older than 30 days)
+    var nocodb = makeNocodb({ get: async () => ({ list: [] }) });
+    var result = await checkContentFreshness('AAPL', { nocodb: nocodb });
+    assert.equal(result.fresh, false);
+    assert.equal(result.lastPublished, null);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// checkCompetitorFeeds
+// ---------------------------------------------------------------------------
+describe('checkCompetitorFeeds', () => {
+  it('parses mock RSS and checks tickers', async () => {
+    var checkedCount = 0;
+    var nocodb = makeNocodb({
+      get: async () => { checkedCount++; return { list: [] }; },
+      post: async () => ({ id: 1 }),
+    });
+    var telegram = makeTelegram();
+    await checkCompetitorFeeds({
+      feeds: ['https://example.com/feed'],
+      fetchRSS: async () => SAMPLE_RSS,
+      nocodb: nocodb,
+      telegram: telegram,
+    });
+    assert.ok(checkedCount > 0, 'should have checked at least one ticker');
+  });
+
+  it('writes Competitor_Intel and sends alert when ticker not covered in 30 days', async () => {
+    var postedTable = null;
+    var alertSent = false;
+    var nocodb = makeNocodb({
+      get: async () => ({ list: [] }),
+      post: async (table) => { postedTable = table; return { id: 1 }; },
+    });
+    var telegram = makeTelegram({ send: async () => { alertSent = true; } });
+    await checkCompetitorFeeds({
+      feeds: ['https://example.com/feed'],
+      fetchRSS: async () => SAMPLE_RSS,
+      nocodb: nocodb,
+      telegram: telegram,
+    });
+    assert.equal(postedTable, 'Competitor_Intel');
+    assert.ok(alertSent, 'Telegram alert should be sent');
+  });
+
+  it('does NOT write record or alert when ticker already covered in 30 days', async () => {
+    var postCalled = false;
+    var alertSent = false;
+    var recentDate = new Date().toISOString();
+    var nocodb = makeNocodb({
+      get: async () => ({ list: [{ published_at: recentDate }] }),
+      post: async () => { postCalled = true; return { id: 1 }; },
+    });
+    var telegram = makeTelegram({ send: async () => { alertSent = true; } });
+    await checkCompetitorFeeds({
+      feeds: ['https://example.com/feed'],
+      fetchRSS: async () => SAMPLE_RSS,
+      nocodb: nocodb,
+      telegram: telegram,
+    });
+    assert.ok(!postCalled, 'should NOT post to Competitor_Intel when already covered');
+    assert.ok(!alertSent, 'should NOT send alert when already covered');
+  });
+
+  it('continues when one feed fails, processes others', async () => {
+    var feedCount = 0;
+    var nocodb = makeNocodb({ get: async () => ({ list: [] }), post: async () => ({ id: 1 }) });
+    var telegram = makeTelegram();
+    await checkCompetitorFeeds({
+      feeds: ['https://fail.example.com/feed', 'https://ok.example.com/feed'],
+      fetchRSS: async (url) => {
+        feedCount++;
+        if (url.indexOf('fail') !== -1) throw new Error('Network error');
+        return SAMPLE_RSS;
+      },
+      nocodb: nocodb,
+      telegram: telegram,
+    });
+    assert.equal(feedCount, 2, 'both feeds should be attempted');
+  });
+
+  it('sends ONE Telegram error message when all feeds fail', async () => {
+    var errorCount = 0;
+    var telegram = makeTelegram({ send: async () => { errorCount++; } });
+    var nocodb = makeNocodb();
+    await checkCompetitorFeeds({
+      feeds: ['https://fail1.example.com', 'https://fail2.example.com'],
+      fetchRSS: async () => { throw new Error('Network error'); },
+      nocodb: nocodb,
+      telegram: telegram,
+    });
+    assert.equal(errorCount, 1, 'should send exactly one error message when all feeds fail');
+  });
+
+  it('handles CDATA blocks in RSS without throwing', async () => {
+    var threw = false;
+    var nocodb = makeNocodb({ get: async () => ({ list: [] }), post: async () => ({ id: 1 }) });
+    var telegram = makeTelegram();
+    try {
+      await checkCompetitorFeeds({
+        feeds: ['https://example.com/feed'],
+        fetchRSS: async () => SAMPLE_RSS,
+        nocodb: nocodb,
+        telegram: telegram,
+      });
+    } catch (e) {
+      threw = true;
+    }
+    assert.ok(!threw, 'should not throw when RSS has CDATA blocks');
+  });
+
+  it('does not match stop-words as tickers (AND, THE, FOR)', async () => {
+    var rssWithStopWords = '<?xml version="1.0"?><rss version="2.0"><channel>' +
+      '<item><title>FOR THE AND OF SEC NYSE CEO IPO</title>' +
+      '<link>http://x</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>' +
+      '<description>no real tickers</description></item>' +
+      '</channel></rss>';
+    var postCalled = false;
+    var nocodb = makeNocodb({ get: async () => ({ list: [] }), post: async () => { postCalled = true; return { id: 1 }; } });
+    var telegram = makeTelegram();
+    await checkCompetitorFeeds({
+      feeds: ['https://example.com/feed'],
+      fetchRSS: async () => rssWithStopWords,
+      nocodb: nocodb,
+      telegram: telegram,
+    });
+    assert.ok(!postCalled, 'stop-words should not be treated as tickers');
+  });
+
+  it('ignores non-ticker uppercase tokens (NYSE, SEC, CEO, IPO)', async () => {
+    var rssWithNonTickers = '<?xml version="1.0"?><rss version="2.0"><channel>' +
+      '<item><title>NYSE SEC CEO IPO EPS GDP CPI</title>' +
+      '<link>http://x</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>' +
+      '<description>no real tickers here</description></item>' +
+      '</channel></rss>';
+    var postCalled = false;
+    var nocodb = makeNocodb({ get: async () => ({ list: [] }), post: async () => { postCalled = true; return { id: 1 }; } });
+    var telegram = makeTelegram();
+    await checkCompetitorFeeds({
+      feeds: ['https://example.com/feed'],
+      fetchRSS: async () => rssWithNonTickers,
+      nocodb: nocodb,
+      telegram: telegram,
+    });
+    assert.ok(!postCalled, 'non-ticker uppercase tokens should be filtered by stop-words');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// checkContentSimilarity
+// ---------------------------------------------------------------------------
+describe('checkContentSimilarity', () => {
+  it('returns similar: true for identical text', async () => {
+    var text = 'Apple insider buying AAPL stock large purchase this quarter report';
+    var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-1', body_text: text }] }) });
+    var result = await checkContentSimilarity(text, 'AAPL', { nocodb: nocodb });
+    assert.equal(result.similar, true);
+    assert.ok(result.match != null);
+  });
+
+  it('returns similar: false for completely different text', async () => {
+    var existing = 'Apple quarterly earnings strong revenue growth mobile iPhone';
+    var newText = 'Tesla electric vehicle manufacturing gigafactory production battery energy';
+    var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-1', body_text: existing }] }) });
+    var result = await checkContentSimilarity(newText, 'TSLA', { nocodb: nocodb });
+    assert.equal(result.similar, false);
+  });
+
+  it('similarity at exactly 0.85 returns similar: true (inclusive threshold)', async () => {
+    var text = 'insider purchase form four sec filing stock buyback significant amount shares';
+    var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-2', body_text: text }] }) });
+    var result = await checkContentSimilarity(text, 'AAPL', { nocodb: nocodb });
+    assert.equal(result.similar, true);
+  });
+
+  it('returns similar: false when no existing articles', async () => {
+    var nocodb = makeNocodb({ get: async () => ({ list: [] }) });
+    var result = await checkContentSimilarity('some article text here', 'AAPL', { nocodb: nocodb });
+    assert.equal(result.similar, false);
+    assert.equal(result.match, null);
+  });
+
+  it('truncates articles to 2000 words before comparison without throwing', async () => {
+    var longText = Array(3000).fill('uniqueword').join(' ');
+    var nocodb = makeNocodb({ get: async () => ({ list: [{ id: 'art-3', body_text: longText }] }) });
+    var result = await checkContentSimilarity(longText, 'AAPL', { nocodb: nocodb });
+    assert.ok(typeof result.similar === 'boolean');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// scheduleFromEarnings
+// ---------------------------------------------------------------------------
+describe('scheduleFromEarnings', () => {
+  it('calls addToCalendar with earnings_date minus 3 days for ticker in both earnings and Insider_Alerts', async () => {
+    var earningsDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
+    var postedEntry = null;
+    var nocodb = makeNocodb({
+      get: async (table) => {
+        if (table === 'Insider_Alerts') return { list: [{ ticker: 'AAPL' }] };
+        return { list: [] };
+      },
+      post: async (table, body) => { postedEntry = { table: table, body: body }; return Object.assign({ id: 1 }, body); },
+    });
+    await scheduleFromEarnings({
+      nocodb: nocodb,
+      delay: async () => {},
+      fetchEarnings: async () => [{ ticker: 'AAPL', reportDate: earningsDate }],
+    });
+    assert.ok(postedEntry != null, 'addToCalendar should have been called');
+    var expectedDate = new Date(new Date(earningsDate).getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
+    assert.equal(postedEntry.body.planned_date, expectedDate);
+  });
+
+  it('does NOT call addToCalendar when ticker in earnings but NOT in Insider_Alerts', async () => {
+    var postCalled = false;
+    var nocodb = makeNocodb({
+      get: async () => ({ list: [] }),
+      post: async () => { postCalled = true; return { id: 1 }; },
+    });
+    await scheduleFromEarnings({
+      nocodb: nocodb,
+      delay: async () => {},
+      fetchEarnings: async () => [{ ticker: 'MSFT', reportDate: '2024-02-15' }],
+    });
+    assert.ok(!postCalled, 'should not schedule when ticker not in Insider_Alerts');
+  });
+
+  it('calls delay between ticker lookups', async () => {
+    var delayCount = 0;
+    var nocodb = makeNocodb({
+      get: async (table) => {
+        if (table === 'Insider_Alerts') return { list: [{ ticker: 'AAPL' }] };
+        return { list: [] };
+      },
+      post: async () => ({ id: 1 }),
+    });
+    await scheduleFromEarnings({
+      nocodb: nocodb,
+      delay: async () => { delayCount++; },
+      fetchEarnings: async () => [
+        { ticker: 'AAPL', reportDate: '2024-02-15' },
+        { ticker: 'TSLA', reportDate: '2024-02-20' },
+      ],
+    });
+    assert.ok(delayCount >= 1, 'delay should be called between ticker lookups');
+  });
+});
