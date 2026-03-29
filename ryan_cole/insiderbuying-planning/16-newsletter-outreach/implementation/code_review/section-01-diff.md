diff --git a/insiderbuying-site/n8n/code/insiderbuying/weekly-newsletter.js b/insiderbuying-site/n8n/code/insiderbuying/weekly-newsletter.js
index 65bcee3..e09e6c7 100644
--- a/insiderbuying-site/n8n/code/insiderbuying/weekly-newsletter.js
+++ b/insiderbuying-site/n8n/code/insiderbuying/weekly-newsletter.js
@@ -6,29 +6,243 @@ const _http = require('http');
 const { URL } = require('url');
 
 // ---------------------------------------------------------------------------
-// W6 Weekly Newsletter
+// Internal helpers
 // ---------------------------------------------------------------------------
 
+function _sleep(ms) {
+  return new Promise((resolve) => setTimeout(resolve, ms));
+}
+
 /**
- * Gather last 7 days of content from NocoDB.
- * @param {object} nocodbApi - { baseUrl, token }
- * @returns {Promise<object>} { articles, topAlerts, dataStudy }
+ * Minimal HTTPS GET returning a fetch-like response object.
+ * Used as the default fetchFn for Alpha Vantage calls when no _fetchFn is injected.
  */
-async function gatherWeeklyContent(nocodbApi) {
-  var sevenDaysAgo = new Date();
-  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
-  var cutoff = sevenDaysAgo.toISOString().slice(0, 10);
+function _httpsGet(url) {
+  return new Promise((resolve, reject) => {
+    const proto = url.startsWith('https') ? _https : _http;
+    proto.get(url, (res) => {
+      let data = '';
+      res.on('data', (chunk) => { data += chunk; });
+      res.on('end', () => {
+        resolve({
+          status: res.statusCode,
+          json: () => Promise.resolve(JSON.parse(data)),
+          text: () => Promise.resolve(data),
+        });
+      });
+    }).on('error', reject);
+  });
+}
+
+/**
+ * Parse a CSV string into an array of objects using the first line as headers.
+ * Handles CRLF and LF line endings.
+ */
+function _parseCsv(text) {
+  const lines = text.trim().replace(/\r\n/g, '\n').split('\n');
+  if (lines.length < 2) return [];
+  const headers = lines[0].split(',').map((h) => h.trim());
+  return lines.slice(1).filter((l) => l.trim()).map((line) => {
+    const values = line.split(',').map((v) => v.trim());
+    const obj = {};
+    headers.forEach((h, i) => { obj[h] = values[i] !== undefined ? values[i] : ''; });
+    return obj;
+  });
+}
 
-  // In n8n, these would be actual HTTP calls to NocoDB
-  // For testability, we return the structure
+/**
+ * Create a default Finnhub client using process.env and internal HTTPS.
+ * Returns null quotes gracefully on any error.
+ */
+function _createDefaultFinnhubClient() {
+  const finnhub = require('./finnhub-client');
+  const env = { FINNHUB_API_KEY: process.env.FINNHUB_API_KEY || '' };
   return {
-    articles: [], // Articles published in last 7 days
-    topAlerts: [], // Top 3-5 alerts by significance_score
-    dataStudy: null, // Latest data study if published this week
-    cutoffDate: cutoff,
+    getQuote: (ticker) => finnhub.getQuote(ticker, _httpsGet, env).catch(() => null),
   };
 }
 
+// ---------------------------------------------------------------------------
+// computeAlertPerformance
+// ---------------------------------------------------------------------------
+
+/**
+ * For each alert, fetch the current price from Finnhub and compute the
+ * percentage return since filing.
+ *
+ * @param {object[]} alerts         Alert records with `ticker` and `price_at_filing` fields
+ * @param {{ getQuote: (ticker: string) => Promise<object|null> }} finnhubClient
+ * @param {object}  [_opts]
+ * @param {Function} [_opts._sleep]  Injectable sleep (default: real setTimeout)
+ * @returns {Promise<{ ticker: string, return: string, winner: boolean }[]>}
+ */
+async function computeAlertPerformance(alerts, finnhubClient, _opts) {
+  const sleepFn = (_opts && _opts._sleep) ? _opts._sleep : _sleep;
+
+  const settled = await Promise.allSettled(
+    alerts.map(async (alert, i) => {
+      if (i > 0) await sleepFn(250);
+      const ticker = alert.ticker;
+      const quote = await finnhubClient.getQuote(ticker);
+      const currentPrice = quote && typeof quote.c === 'number' ? quote.c : null;
+      const filingPrice = typeof alert.price_at_filing === 'number' ? alert.price_at_filing : null;
+
+      if (currentPrice === null || filingPrice === null || filingPrice === 0) {
+        return { ticker, return: 'N/A', winner: false };
+      }
+
+      const pct = ((currentPrice - filingPrice) / filingPrice) * 100;
+      const sign = pct >= 0 ? '+' : '';
+      return { ticker, return: sign + pct.toFixed(1) + '%', winner: pct > 0 };
+    })
+  );
+
+  return settled.map((result, i) => {
+    if (result.status === 'fulfilled') return result.value;
+    return { ticker: alerts[i].ticker, return: 'N/A', winner: false };
+  });
+}
+
+// ---------------------------------------------------------------------------
+// getUpcomingEarnings
+// ---------------------------------------------------------------------------
+
+/**
+ * Return upcoming earnings events for the next 14 days.
+ * Checks NocoDB `Financial_Cache` first; fetches Alpha Vantage on miss or stale (>24h).
+ *
+ * @param {object} nocodbApi            NocoDB client instance (list, create, update methods)
+ * @param {object} [_opts]
+ * @param {number}   [_opts._nowMs]     Override for Date.now() in tests
+ * @param {Function} [_opts._fetchFn]   Injectable HTTP fetch (url) => Promise<{status,text}>
+ * @returns {Promise<object[]>} Array of earnings events
+ */
+async function getUpcomingEarnings(nocodbApi, _opts) {
+  const nowMs = (_opts && _opts._nowMs) ? _opts._nowMs : Date.now();
+  const fetchFn = (_opts && _opts._fetchFn) ? _opts._fetchFn : _httpsGet;
+  const cacheKey = 'earnings_next14_' + new Date(nowMs).toISOString().slice(0, 10);
+
+  // --- Cache check ---
+  const cacheResult = await nocodbApi.list('Financial_Cache', {
+    where: '(key,eq,' + cacheKey + ')',
+    limit: 1,
+  });
+  const cached = cacheResult.list && cacheResult.list[0];
+  if (cached && cached.updated_at) {
+    const ageMs = nowMs - new Date(cached.updated_at).getTime();
+    if (ageMs < 24 * 60 * 60 * 1000) {
+      return JSON.parse(cached.data);
+    }
+  }
+
+  // --- Fetch from Alpha Vantage ---
+  const apiKey = process.env.ALPHA_VANTAGE_API_KEY || '';
+  const avUrl = 'https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=' + apiKey;
+  const resp = await fetchFn(avUrl);
+  const csvText = await resp.text();
+
+  // Parse CSV and filter to next 14 days
+  const cutoffMs = nowMs + 14 * 24 * 60 * 60 * 1000;
+  const rows = _parseCsv(csvText);
+  const earnings = rows.filter((row) => {
+    if (!row.reportDate) return false;
+    const ms = new Date(row.reportDate).getTime();
+    return ms >= nowMs && ms <= cutoffMs;
+  });
+
+  // --- Upsert cache ---
+  const nowIso = new Date(nowMs).toISOString();
+  if (cached) {
+    await nocodbApi.update('Financial_Cache', cached.Id, {
+      data: JSON.stringify(earnings),
+      updated_at: nowIso,
+    });
+  } else {
+    await nocodbApi.create('Financial_Cache', {
+      key: cacheKey,
+      data: JSON.stringify(earnings),
+      updated_at: nowIso,
+    });
+  }
+
+  return earnings;
+}
+
+// ---------------------------------------------------------------------------
+// gatherWeeklyContent
+// ---------------------------------------------------------------------------
+
+/**
+ * Gather last week's content from NocoDB: top alerts, articles, alert
+ * performance (previous week), and upcoming earnings.
+ *
+ * @param {object} nocodbApi  NocoDB client with list(), create(), update() methods
+ * @param {object} [_opts]
+ * @param {number}   [_opts._nowMs]          Override for Date.now() in tests
+ * @param {object}   [_opts._finnhubClient]  Injectable Finnhub client { getQuote }
+ * @param {Function} [_opts._fetchFn]        Injectable HTTP fetch for Alpha Vantage
+ * @param {Function} [_opts._sleep]          Injectable sleep for computeAlertPerformance
+ * @returns {Promise<object>} { topAlerts, articles, performance, upcomingEarnings, emptyAlertsPrefix? }
+ */
+async function gatherWeeklyContent(nocodbApi, _opts) {
+  const nowMs = (_opts && _opts._nowMs) ? _opts._nowMs : Date.now();
+  const sevenDaysIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
+  const fourteenDaysIso = new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
+
+  // 1. Top alerts: score >= 7, last 7 days
+  const alertsResult = await nocodbApi.list('Insider_Alerts', {
+    where: '(score,gte,7)~and(filing_date,gte,' + sevenDaysIso + ')',
+    sort: '-score',
+    limit: 10,
+  });
+  const topAlerts = alertsResult.list || [];
+
+  // 2. Articles: last 7 days
+  const articlesResult = await nocodbApi.list('Articles', {
+    where: '(published_at,gte,' + sevenDaysIso + ')',
+    sort: '-published_at',
+    limit: 5,
+  });
+  const articles = articlesResult.list || [];
+
+  // 3. Previous week alerts for performance computation
+  const prevAlertsResult = await nocodbApi.list('Insider_Alerts', {
+    where: '(filing_date,gte,' + fourteenDaysIso + ')~and(filing_date,lt,' + sevenDaysIso + ')',
+    limit: 5,
+  });
+  const prevAlerts = prevAlertsResult.list || [];
+
+  // 4. Alert performance
+  let performance = [];
+  if (prevAlerts.length > 0) {
+    const finnhubClient = (_opts && _opts._finnhubClient)
+      ? _opts._finnhubClient
+      : _createDefaultFinnhubClient();
+    performance = await computeAlertPerformance(prevAlerts, finnhubClient, {
+      _sleep: _opts && _opts._sleep,
+    });
+  }
+
+  // 5. Upcoming earnings (with cache)
+  const upcomingEarnings = await getUpcomingEarnings(nocodbApi, {
+    _nowMs: nowMs,
+    _fetchFn: _opts && _opts._fetchFn,
+  });
+
+  const result = { topAlerts, articles, performance, upcomingEarnings };
+
+  // Empty-state guard: prevent AI from hallucinating tickers
+  if (topAlerts.length === 0) {
+    result.emptyAlertsPrefix = 'No major insider moves this week -- focus section 2 on macro trends and market context instead of a specific ticker.';
+  }
+
+  return result;
+}
+
+// ---------------------------------------------------------------------------
+// generateSummaries
+// ---------------------------------------------------------------------------
+
 /**
  * Generate newsletter summaries via Claude Haiku.
  * @param {object} content - Output from gatherWeeklyContent
@@ -65,6 +279,10 @@ function generateSummaries(content) {
   };
 }
 
+// ---------------------------------------------------------------------------
+// assembleNewsletter
+// ---------------------------------------------------------------------------
+
 /**
  * Assemble newsletter HTML from summaries and content.
  * @param {object} summaries - Output from generateSummaries
@@ -106,6 +324,10 @@ function assembleNewsletter(summaries, content) {
   return html;
 }
 
+// ---------------------------------------------------------------------------
+// sendViaBeehiiv
+// ---------------------------------------------------------------------------
+
 /**
  * Send newsletter via Beehiiv API.
  * @param {string} html - Newsletter HTML
@@ -144,8 +366,10 @@ function escapeHTML(str) {
 }
 
 module.exports = {
-  gatherWeeklyContent: gatherWeeklyContent,
-  generateSummaries: generateSummaries,
-  assembleNewsletter: assembleNewsletter,
-  sendViaBeehiiv: sendViaBeehiiv,
+  gatherWeeklyContent,
+  computeAlertPerformance,
+  getUpcomingEarnings,
+  generateSummaries,
+  assembleNewsletter,
+  sendViaBeehiiv,
 };
diff --git a/insiderbuying-site/tests/insiderbuying/weekly-newsletter.test.js b/insiderbuying-site/tests/insiderbuying/weekly-newsletter.test.js
new file mode 100644
index 0000000..6c8d8a1
--- /dev/null
+++ b/insiderbuying-site/tests/insiderbuying/weekly-newsletter.test.js
@@ -0,0 +1,265 @@
+'use strict';
+
+const {
+  gatherWeeklyContent,
+  computeAlertPerformance,
+  getUpcomingEarnings,
+} = require('../../n8n/code/insiderbuying/weekly-newsletter');
+
+// ---------------------------------------------------------------------------
+// Helpers
+// ---------------------------------------------------------------------------
+
+const noSleep = () => Promise.resolve();
+
+// Stable test "now": 2026-03-15 12:00:00 UTC
+const TEST_NOW = Date.UTC(2026, 2, 15, 12, 0, 0);
+const TODAY_ISO = '2026-03-15';
+const SEVEN_DAYS_ISO = '2026-03-08';
+const FOURTEEN_DAYS_ISO = '2026-03-01';
+
+/**
+ * Build a mock NocoDB client with sequenced list responses.
+ * `listResponses` is an array of values returned in call order.
+ * Extra calls beyond the array return { list: [], pageInfo: {} }.
+ */
+function makeNocoDB(listResponses = []) {
+  let idx = 0;
+  return {
+    list: jest.fn().mockImplementation(() => {
+      const resp = listResponses[idx] !== undefined ? listResponses[idx] : { list: [], pageInfo: {} };
+      idx++;
+      return Promise.resolve(resp);
+    }),
+    create: jest.fn().mockResolvedValue({ Id: 42 }),
+    update: jest.fn().mockResolvedValue({}),
+  };
+}
+
+/** Build a mock Finnhub client. `resolveMap` maps ticker -> quote data (or rejects if undefined). */
+function makeFinnhub(resolveMap = {}) {
+  return {
+    getQuote: jest.fn().mockImplementation((ticker) => {
+      if (ticker in resolveMap) return Promise.resolve(resolveMap[ticker]);
+      return Promise.reject(new Error('Finnhub unavailable for ' + ticker));
+    }),
+  };
+}
+
+/** Build a mock Alpha Vantage fetch returning CSV text. */
+function makeAlphaFetch(csvBody) {
+  return jest.fn().mockImplementation((url) => {
+    if (url.includes('alphavantage.co')) {
+      return Promise.resolve({
+        status: 200,
+        text: () => Promise.resolve(csvBody),
+      });
+    }
+    return Promise.reject(new Error('unexpected URL: ' + url));
+  });
+}
+
+// CSV with 2 events: one within 14 days, one outside
+const SAMPLE_CSV = [
+  'symbol,name,reportDate,fiscalDateEnding,estimate,currency',
+  'AAPL,Apple Inc,2026-03-20,2026-03-31,1.50,USD',   // within 14 days of 2026-03-15
+  'MSFT,Microsoft,2026-04-30,2026-03-31,2.80,USD',   // outside 14 days
+].join('\n');
+
+// ---------------------------------------------------------------------------
+// gatherWeeklyContent — NocoDB table targets and filters
+// ---------------------------------------------------------------------------
+
+describe('gatherWeeklyContent — NocoDB table targets and filters', () => {
+  test('queries Insider_Alerts with score >= 7 and 7-day date range', async () => {
+    const db = makeNocoDB([
+      { list: [{ ticker: 'AAPL', score: 8, filing_date: '2026-03-12', price_at_filing: 100 }] },
+      { list: [] },
+      { list: [] },
+      { list: [] }, // Financial_Cache miss
+    ]);
+    await gatherWeeklyContent(db, { _nowMs: TEST_NOW, _fetchFn: makeAlphaFetch(SAMPLE_CSV) });
+
+    const alertsCalls = db.list.mock.calls.filter(c => c[0] === 'Insider_Alerts');
+    expect(alertsCalls.length).toBeGreaterThanOrEqual(1);
+    const [, opts] = alertsCalls[0];
+    expect(opts.where).toMatch(/score/);
+    expect(opts.where).toMatch(/gte,7/);
+    expect(opts.where).toContain(SEVEN_DAYS_ISO);
+    expect(opts.sort).toBe('-score');
+    expect(opts.limit).toBe(10);
+  });
+
+  test('queries Articles table with 7-day filter', async () => {
+    const db = makeNocoDB([
+      { list: [] },
+      { list: [{ title: 'Weekly Recap', published_at: '2026-03-14' }] },
+      { list: [] },
+      { list: [] },
+    ]);
+    await gatherWeeklyContent(db, { _nowMs: TEST_NOW, _fetchFn: makeAlphaFetch(SAMPLE_CSV) });
+
+    const articlesCalls = db.list.mock.calls.filter(c => c[0] === 'Articles');
+    expect(articlesCalls.length).toBeGreaterThanOrEqual(1);
+    const [, opts] = articlesCalls[0];
+    expect(opts.where).toContain(SEVEN_DAYS_ISO);
+    expect(opts.sort).toBe('-published_at');
+    expect(opts.limit).toBe(5);
+  });
+
+  test('queries Insider_Alerts for 7-14 days ago for performance data', async () => {
+    const db = makeNocoDB([
+      { list: [] },
+      { list: [] },
+      { list: [{ ticker: 'TSLA', score: 9, filing_date: '2026-03-05', price_at_filing: 250 }] },
+      { list: [] },
+    ]);
+    const safeFinnhub = { getQuote: () => Promise.resolve(null) };
+    await gatherWeeklyContent(db, { _nowMs: TEST_NOW, _fetchFn: makeAlphaFetch(SAMPLE_CSV), _finnhubClient: safeFinnhub });
+
+    const alertsCalls = db.list.mock.calls.filter(c => c[0] === 'Insider_Alerts');
+    expect(alertsCalls.length).toBeGreaterThanOrEqual(2);
+    const perfCall = alertsCalls[1];
+    const [, opts] = perfCall;
+    expect(opts.where).toContain(FOURTEEN_DAYS_ISO);
+    expect(opts.where).toContain(SEVEN_DAYS_ISO);
+  });
+
+  test('returns all four fields with correct types', async () => {
+    const db = makeNocoDB([
+      { list: [{ ticker: 'AAPL', score: 8, filing_date: '2026-03-12', price_at_filing: 150 }] },
+      { list: [{ title: 'Article 1', published_at: '2026-03-13' }] },
+      { list: [{ ticker: 'TSLA', score: 9, filing_date: '2026-03-06', price_at_filing: 250 }] },
+      { list: [] }, // cache miss
+    ]);
+    const mockFinnhub = makeFinnhub({ AAPL: { c: 160, pc: 155 }, TSLA: { c: 260, pc: 255 } });
+    const result = await gatherWeeklyContent(db, {
+      _nowMs: TEST_NOW,
+      _finnhubClient: mockFinnhub,
+      _fetchFn: makeAlphaFetch(SAMPLE_CSV),
+    });
+
+    expect(Array.isArray(result.topAlerts)).toBe(true);
+    expect(Array.isArray(result.articles)).toBe(true);
+    expect(Array.isArray(result.performance)).toBe(true);
+    expect(Array.isArray(result.upcomingEarnings)).toBe(true);
+  });
+
+  test('sets emptyAlertsPrefix when topAlerts is empty', async () => {
+    const db = makeNocoDB([
+      { list: [] }, // empty alerts
+      { list: [] },
+      { list: [] },
+      { list: [] },
+    ]);
+    const result = await gatherWeeklyContent(db, { _nowMs: TEST_NOW, _fetchFn: makeAlphaFetch(SAMPLE_CSV) });
+    expect(typeof result.emptyAlertsPrefix).toBe('string');
+    expect(result.emptyAlertsPrefix.length).toBeGreaterThan(10);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// computeAlertPerformance
+// ---------------------------------------------------------------------------
+
+describe('computeAlertPerformance', () => {
+  test('maps alerts to { ticker, return, winner } using mocked Finnhub', async () => {
+    const alerts = [
+      { ticker: 'AAPL', price_at_filing: 100 },
+      { ticker: 'TSLA', price_at_filing: 200 },
+    ];
+    const finnhub = makeFinnhub({ AAPL: { c: 120, pc: 110 }, TSLA: { c: 180, pc: 195 } });
+
+    const result = await computeAlertPerformance(alerts, finnhub, { _sleep: noSleep });
+
+    expect(result).toHaveLength(2);
+
+    const aapl = result.find(r => r.ticker === 'AAPL');
+    expect(aapl).toBeDefined();
+    expect(aapl.winner).toBe(true);
+    expect(aapl.return).toMatch(/^\+\d/); // starts with +
+
+    const tsla = result.find(r => r.ticker === 'TSLA');
+    expect(tsla).toBeDefined();
+    expect(tsla.winner).toBe(false);
+    expect(tsla.return).toMatch(/^-\d/); // starts with -
+  });
+
+  test('handles Finnhub failure for one alert gracefully (Promise.allSettled)', async () => {
+    const alerts = [
+      { ticker: 'AAPL', price_at_filing: 100 },
+      { ticker: 'FAIL', price_at_filing: 50 }, // will reject
+    ];
+    // FAIL is not in resolveMap so makeFinnhub rejects it
+    const finnhub = makeFinnhub({ AAPL: { c: 110, pc: 105 } });
+
+    const result = await computeAlertPerformance(alerts, finnhub, { _sleep: noSleep });
+
+    expect(result).toHaveLength(2);
+    const fail = result.find(r => r.ticker === 'FAIL');
+    expect(fail).toBeDefined();
+    expect(fail.return).toBe('N/A');
+    expect(fail.winner).toBe(false);
+
+    // AAPL should still succeed
+    const aapl = result.find(r => r.ticker === 'AAPL');
+    expect(aapl.winner).toBe(true);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// getUpcomingEarnings — cache behaviour
+// ---------------------------------------------------------------------------
+
+describe('getUpcomingEarnings — cache behaviour', () => {
+  const CACHE_KEY = `earnings_next14_${TODAY_ISO}`;
+
+  test('returns cached Financial_Cache data when entry is under 24h old', async () => {
+    const cachedData = [{ symbol: 'AAPL', reportDate: '2026-03-20' }];
+    // Cache record with updated_at = 1 hour ago
+    const freshRecord = {
+      Id: 10,
+      key: CACHE_KEY,
+      data: JSON.stringify(cachedData),
+      updated_at: new Date(TEST_NOW - 60 * 60 * 1000).toISOString(),
+    };
+    const db = makeNocoDB([{ list: [freshRecord] }]);
+    const fetchSpy = jest.fn();
+
+    const result = await getUpcomingEarnings(db, { _nowMs: TEST_NOW, _fetchFn: fetchSpy });
+
+    expect(result).toEqual(cachedData);
+    // Alpha Vantage should NOT be called
+    expect(fetchSpy).not.toHaveBeenCalled();
+  });
+
+  test('calls Alpha Vantage when cache is missing or stale', async () => {
+    // Return empty cache list
+    const db = makeNocoDB([{ list: [] }]);
+    const fetchFn = makeAlphaFetch(SAMPLE_CSV);
+
+    await getUpcomingEarnings(db, { _nowMs: TEST_NOW, _fetchFn: fetchFn });
+
+    expect(fetchFn).toHaveBeenCalledTimes(1);
+    const [calledUrl] = fetchFn.mock.calls[0];
+    expect(calledUrl).toContain('alphavantage.co');
+    expect(calledUrl).toContain('EARNINGS_CALENDAR');
+  });
+
+  test('writes result to Financial_Cache after fetching from Alpha Vantage', async () => {
+    const db = makeNocoDB([{ list: [] }]); // cache miss
+    const fetchFn = makeAlphaFetch(SAMPLE_CSV);
+
+    const result = await getUpcomingEarnings(db, { _nowMs: TEST_NOW, _fetchFn: fetchFn });
+
+    // create or update should be called to persist to cache
+    const persisted = db.create.mock.calls.length > 0 || db.update.mock.calls.length > 0;
+    expect(persisted).toBe(true);
+
+    // result should only include events within 14 days
+    expect(Array.isArray(result)).toBe(true);
+    const symbols = result.map(e => e.symbol);
+    expect(symbols).toContain('AAPL');
+    expect(symbols).not.toContain('MSFT'); // outside 14-day window
+  });
+});
