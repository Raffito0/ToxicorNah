diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/dexter-research.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/dexter-research.js
index 75cad1e..e87e204 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/dexter-research.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/dexter-research.js
@@ -1,18 +1,243 @@
 /**
  * Dexter Research Agent — n8n Code Node
  *
- * Aggregates financial data from Financial Datasets API, caches results in
+ * Aggregates financial data from Finnhub API, caches results in
  * NocoDB Financial_Cache, and returns structured JSON matching the
  * FINANCIAL-ARTICLE-SYSTEM-PROMPT.md template variables.
  *
  * Called by W2 (Article Generation) via webhook with:
  *   { ticker, keyword, article_type, blog }
+ *
+ * Required env vars:
+ *   FINNHUB_API_KEY
+ *   NOCODB_BASE_URL, NOCODB_API_TOKEN, NOCODB_PROJECT_ID
+ *   NOCODB_FINANCIAL_CACHE_TABLE_ID (e.g. 'Financial_Cache')
  */
 
 'use strict';
 
+const https = require('https');
+const zlib = require('zlib');
+
+// ---------------------------------------------------------------------------
+// TokenBucket — shared rate limiter (60 req/min = 5 tokens per 5000ms)
+// ---------------------------------------------------------------------------
+
+class TokenBucket {
+  constructor({ capacity, refillRate, refillInterval }) {
+    this._capacity = capacity;
+    this._tokens = capacity;
+    this._refillRate = refillRate;
+    this._refillInterval = refillInterval;
+    this._waitQueue = [];
+    this._interval = setInterval(() => this._refill(), refillInterval);
+    if (this._interval.unref) this._interval.unref();
+  }
+
+  _refill() {
+    this._tokens = Math.min(this._capacity, this._tokens + this._refillRate);
+    while (this._waitQueue.length > 0 && this._tokens > 0) {
+      this._tokens -= 1;
+      this._waitQueue.shift()();
+    }
+  }
+
+  acquire() {
+    if (this._tokens > 0) {
+      this._tokens -= 1;
+      return Promise.resolve();
+    }
+    return new Promise((resolve) => {
+      this._waitQueue.push(resolve);
+    });
+  }
+}
+
+const finnhubBucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 5000 });
+const FINNHUB_BASE = 'https://api.finnhub.io';
+
+// ---------------------------------------------------------------------------
+// Internal HTTP helper
+// ---------------------------------------------------------------------------
+
+function _httpsRequest(url, method, headers, body, _hops) {
+  if ((_hops || 0) > 3) return Promise.reject(new Error('Too many redirects'));
+  return new Promise((resolve, reject) => {
+    const parsed = new URL(url);
+    const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : null;
+    const opts = {
+      hostname: parsed.hostname,
+      path: parsed.pathname + parsed.search,
+      method: method || 'GET',
+      headers: {
+        'User-Agent': 'EarlyInsider/1.0 (contact@earlyinsider.com)',
+        'Accept-Encoding': 'gzip, deflate',
+        'Accept': 'application/json',
+        ...headers,
+        ...(bodyBuf ? { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length } : {}),
+      },
+    };
+    const req = https.request(opts, (res) => {
+      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
+        res.resume();
+        resolve(_httpsRequest(res.headers.location, method, headers, body, (_hops || 0) + 1));
+        return;
+      }
+      const isGzip = res.headers['content-encoding'] === 'gzip';
+      const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
+      const chunks = [];
+      stream.on('data', (c) => chunks.push(c));
+      stream.on('end', () => {
+        try {
+          const text = Buffer.concat(chunks).toString('utf8');
+          const parsedBody = text ? JSON.parse(text) : {};
+          resolve({ statusCode: res.statusCode, body: parsedBody });
+        } catch (e) {
+          resolve({ statusCode: res.statusCode, body: {} });
+        }
+      });
+      stream.on('error', reject);
+    });
+    req.setTimeout(10000, () => req.destroy());
+    req.on('error', reject);
+    if (bodyBuf) req.write(bodyBuf);
+    req.end();
+  });
+}
+
+function httpsGet(url, headers) {
+  return _httpsRequest(url, 'GET', headers || {}, null);
+}
+
+// ---------------------------------------------------------------------------
+// Minimal NocoDB client for Financial_Cache table
+// ---------------------------------------------------------------------------
+
+function makeNocoClient({ baseUrl, token, tableId, projectId }) {
+  const base = `${baseUrl}/api/v1/db/data/noco/${projectId || 'noco'}/${tableId}`;
+  const headers = { 'xc-token': token, 'Content-Type': 'application/json' };
+
+  return {
+    async search(where) {
+      const url = `${base}?where=${encodeURIComponent(where)}&limit=1`;
+      const res = await _httpsRequest(url, 'GET', headers);
+      return (res.body && res.body.list) ? res.body.list : [];
+    },
+    async create(fields) {
+      const res = await _httpsRequest(base + '/', 'POST', headers, fields);
+      return res.body || {};
+    },
+    async update(rowId, fields) {
+      const res = await _httpsRequest(`${base}/${rowId}`, 'PATCH', headers, fields);
+      return res.body || {};
+    },
+  };
+}
+
 // ---------------------------------------------------------------------------
-// Constants
+// NocoDB Cache helpers
+// ---------------------------------------------------------------------------
+
+const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
+
+async function readCache(ticker, dataType, nocoClient) {
+  const where = `(ticker,eq,${ticker})~and(data_type,eq,${dataType})`;
+  const records = await nocoClient.search(where);
+  if (!records || records.length === 0) return null;
+  const rec = records[0];
+  if (!rec || !rec.expires_at || rec.expires_at <= Date.now()) return null;
+  try {
+    return JSON.parse(rec.data_json);
+  } catch (_) {
+    return null;
+  }
+}
+
+async function writeCache(ticker, dataType, data, nocoClient) {
+  const where = `(ticker,eq,${ticker})~and(data_type,eq,${dataType})`;
+  const records = await nocoClient.search(where);
+  const expiresAt = Date.now() + CACHE_TTL_MS;
+  const dataJson = JSON.stringify(data);
+  if (records && records.length > 0 && records[0].Id != null) {
+    return nocoClient.update(records[0].Id, { data_json: dataJson, expires_at: expiresAt });
+  }
+  return nocoClient.create({ ticker, data_type: dataType, data_json: dataJson, expires_at: expiresAt });
+}
+
+// ---------------------------------------------------------------------------
+// Finnhub fetchers
+// ---------------------------------------------------------------------------
+
+async function getQuote(ticker, apiKey, fetchFn, nocoClient, cacheWrites) {
+  const doFetch = fetchFn || httpsGet;
+  const cached = await readCache(ticker, 'quote', nocoClient);
+  if (cached !== null) return cached;
+  await finnhubBucket.acquire();
+  const url = `${FINNHUB_BASE}/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
+  const res = await doFetch(url);
+  if (res.statusCode !== 200) throw new Error(`Finnhub quote HTTP ${res.statusCode}`);
+  const data = res.body;
+  cacheWrites.push(writeCache(ticker, 'quote', data, nocoClient));
+  return data;
+}
+
+async function getProfile(ticker, apiKey, fetchFn, nocoClient, cacheWrites) {
+  const doFetch = fetchFn || httpsGet;
+  const cached = await readCache(ticker, 'profile', nocoClient);
+  if (cached !== null) return cached;
+  await finnhubBucket.acquire();
+  const url = `${FINNHUB_BASE}/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
+  const res = await doFetch(url);
+  if (res.statusCode !== 200) return null;
+  const b = res.body || {};
+  const data = {
+    name: b.name ?? null,
+    marketCapitalization: b.marketCapitalization ?? null,
+    exchange: b.exchange ?? null,
+    finnhubIndustry: b.finnhubIndustry ?? null,
+    country: b.country ?? null,
+    currency: b.currency ?? null,
+  };
+  cacheWrites.push(writeCache(ticker, 'profile', data, nocoClient));
+  return data;
+}
+
+async function getBasicFinancials(ticker, apiKey, fetchFn, nocoClient, cacheWrites) {
+  const doFetch = fetchFn || httpsGet;
+  const cached = await readCache(ticker, 'basic_financials', nocoClient);
+  if (cached !== null) return cached;
+  await finnhubBucket.acquire();
+  const url = `${FINNHUB_BASE}/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${apiKey}`;
+  const res = await doFetch(url);
+  if (res.statusCode !== 200) return null;
+  const m = (res.body && res.body.metric) || {};
+  const data = {
+    metric: {
+      peBasicExclExtraTTM: m.peBasicExclExtraTTM ?? null,
+      epsBasicExclExtraAnnual: m.epsBasicExclExtraAnnual ?? null,
+      revenueGrowth3Y: m.revenueGrowth3Y ?? null,
+      grossMarginTTM: m.grossMarginTTM ?? null,
+    },
+  };
+  cacheWrites.push(writeCache(ticker, 'basic_financials', data, nocoClient));
+  return data;
+}
+
+async function getInsiderTransactions(ticker, apiKey, fetchFn, nocoClient, cacheWrites) {
+  const doFetch = fetchFn || httpsGet;
+  const cached = await readCache(ticker, 'insider_transactions', nocoClient);
+  if (cached !== null) return cached;
+  await finnhubBucket.acquire();
+  const url = `${FINNHUB_BASE}/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
+  const res = await doFetch(url);
+  if (res.statusCode !== 200) return null;
+  const data = res.body || { data: [] };
+  cacheWrites.push(writeCache(ticker, 'insider_transactions', data, nocoClient));
+  return data;
+}
+
+// ---------------------------------------------------------------------------
+// Constants (Section 4)
 // ---------------------------------------------------------------------------
 
 const DATA_TYPES = [
@@ -25,23 +250,15 @@ const DATA_TYPES = [
   'competitors',
 ];
 
-// Weights for data completeness score — income_statements and stock_prices
-// are weighted higher because articles cannot be written without them.
-// Note: 'competitors' has no ENDPOINTS entry — fetched by a separate n8n node
-// using sector from income statement response. The weight still applies so
-// completeness reflects whether competitor data was provided externally.
+// New Finnhub-based weights (sum = 1.0)
 const DATA_WEIGHTS = {
-  income_statements: 0.25,
-  balance_sheets: 0.10,
-  cash_flow: 0.10,
-  ratios: 0.10,
-  insider_trades: 0.10,
-  stock_prices: 0.25,
-  competitors: 0.10,
+  quote_profile:  0.25,
+  basic_metrics:  0.25,
+  stock_prices:   0.25,
+  competitors:    0.10,
+  insider_trades: 0.15,
 };
 
-const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
-
 const API_BASE = 'https://api.financialdatasets.ai';
 
 // Validate ticker format: 1-5 uppercase letters, optionally with a dot (BRK.B)
@@ -187,17 +404,39 @@ function computePriceSummary(prices) {
 // Data completeness scoring
 // ---------------------------------------------------------------------------
 
+// Legacy weights used by computeDataCompleteness (backward compat with old data format)
+const _LEGACY_WEIGHTS = {
+  income_statements: 0.25,
+  balance_sheets: 0.10,
+  cash_flow: 0.10,
+  ratios: 0.10,
+  insider_trades: 0.10,
+  stock_prices: 0.25,
+  competitors: 0.10,
+};
+
 function computeDataCompleteness(data) {
   let score = 0;
   for (const dtype of DATA_TYPES) {
     const value = data[dtype];
     if (Array.isArray(value) && value.length > 0) {
-      score += DATA_WEIGHTS[dtype];
+      score += _LEGACY_WEIGHTS[dtype] || 0;
     }
   }
   return Math.round(score * 100) / 100;
 }
 
+// Finnhub-specific completeness using new DATA_WEIGHTS
+function _computeFinnhubCompleteness({ quote, profile, basicFinancials, stockPrices, competitors, insiderTransactions }) {
+  let score = 0;
+  if (quote != null || profile != null) score += DATA_WEIGHTS.quote_profile;
+  if (basicFinancials != null) score += DATA_WEIGHTS.basic_metrics;
+  if (stockPrices != null && Array.isArray(stockPrices) && stockPrices.length > 0) score += DATA_WEIGHTS.stock_prices;
+  if (competitors != null && Array.isArray(competitors) && competitors.length > 0) score += DATA_WEIGHTS.competitors;
+  if (insiderTransactions != null) score += DATA_WEIGHTS.insider_trades;
+  return Math.round(score * 100) / 100;
+}
+
 // ---------------------------------------------------------------------------
 // Insider trade filtering (last 90 days)
 // ---------------------------------------------------------------------------
@@ -260,62 +499,56 @@ function aggregateDexterData({
 }
 
 // ---------------------------------------------------------------------------
-// Financial Datasets API fetcher (for n8n Code node usage)
+// Finnhub fetchFinancialData
 // ---------------------------------------------------------------------------
 
-async function fetchFinancialData(ticker, apiKey, opts = {}) {
-  const { fetchFn, nocodbBaseUrl, nocodbToken } = opts;
-
-  const headers = { 'X-API-Key': apiKey };
-
-  // Parallel fetch all 7 data types
-  const [
-    incomeRes,
-    incomeAnnualRes,
-    balanceRes,
-    cashFlowRes,
-    ratiosRes,
-    insiderRes,
-    pricesRes,
-  ] = await Promise.allSettled([
-    fetchWithRetry(ENDPOINTS.income_statements(ticker), { headers }, { fetchFn }),
-    fetchWithRetry(ENDPOINTS.income_statements_annual(ticker), { headers }, { fetchFn }),
-    fetchWithRetry(ENDPOINTS.balance_sheets(ticker), { headers }, { fetchFn }),
-    fetchWithRetry(ENDPOINTS.cash_flow(ticker), { headers }, { fetchFn }),
-    fetchWithRetry(ENDPOINTS.ratios(ticker), { headers }, { fetchFn }),
-    fetchWithRetry(ENDPOINTS.insider_trades(ticker), { headers }, { fetchFn }),
-    fetchWithRetry(ENDPOINTS.stock_prices(ticker), { headers }, { fetchFn }),
+async function fetchFinancialData(ticker, context, fetchFn) {
+  const { apiKey, nocoClient, competitorsData } = context || {};
+  const cacheWrites = [];
+
+  // Fire all 5 data fetches in parallel
+  const [quoteRes, profileRes, metricsRes, insiderRes, candleRes] = await Promise.allSettled([
+    getQuote(ticker, apiKey, fetchFn, nocoClient, cacheWrites),
+    getProfile(ticker, apiKey, fetchFn, nocoClient, cacheWrites),
+    getBasicFinancials(ticker, apiKey, fetchFn, nocoClient, cacheWrites),
+    getInsiderTransactions(ticker, apiKey, fetchFn, nocoClient, cacheWrites),
+    (async () => {
+      const doFetch = fetchFn || httpsGet;
+      const cached = await readCache(ticker, 'stock_prices', nocoClient);
+      if (cached !== null) return cached;
+      await finnhubBucket.acquire();
+      const url = `${FINNHUB_BASE}/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=D&count=252&token=${apiKey}`;
+      const res = await doFetch(url);
+      if (res.statusCode !== 200 || !res.body || res.body.s !== 'ok') return null;
+      const b = res.body;
+      const prices = (b.t || []).map((ts, i) => ({
+        date: new Date(ts * 1000).toISOString().split('T')[0],
+        open: b.o[i], high: b.h[i], low: b.l[i], close: b.c[i], volume: b.v[i],
+      }));
+      cacheWrites.push(writeCache(ticker, 'stock_prices', prices, nocoClient));
+      return prices;
+    })(),
   ]);
 
-  const safeJson = async (settled) => {
-    if (settled.status === 'rejected') return null;
-    const res = settled.value;
-    if (!res.ok) return null;
-    try {
-      return await res.json();
-    } catch {
-      return null;
-    }
-  };
+  const safeVal = (res) => (res.status === 'fulfilled' ? res.value : null);
+  const quote = safeVal(quoteRes);
+  const profile = safeVal(profileRes);
+  const basicFinancials = safeVal(metricsRes);
+  const insiderTransactions = safeVal(insiderRes);
+  const stockPrices = safeVal(candleRes);
+  const competitors = Array.isArray(competitorsData) && competitorsData.length > 0 ? competitorsData : null;
 
-  const income = await safeJson(incomeRes);
-  const incomeAnnual = await safeJson(incomeAnnualRes);
-  const balance = await safeJson(balanceRes);
-  const cashFlow = await safeJson(cashFlowRes);
-  const ratios = await safeJson(ratiosRes);
-  const insider = await safeJson(insiderRes);
-  const prices = await safeJson(pricesRes);
+  // Await all cache writes before returning (n8n kills background promises)
+  await Promise.allSettled(cacheWrites);
 
   return {
-    income_statements: [
-      ...(income?.income_statements || []),
-      ...(incomeAnnual?.income_statements || []),
-    ],
-    balance_sheets: balance?.balance_sheets || [],
-    cash_flow: cashFlow?.cash_flow_statements || [],
-    ratios: ratios?.financial_ratios || [],
-    insider_trades: insider?.insider_trades || [],
-    stock_prices: prices?.stock_prices || [],
+    quote,
+    profile,
+    basicFinancials,
+    insiderTransactions,
+    stockPrices,
+    competitors,
+    data_completeness: _computeFinnhubCompleteness({ quote, profile, basicFinancials, stockPrices, competitors, insiderTransactions }),
   };
 }
 
@@ -324,15 +557,23 @@ async function fetchFinancialData(ticker, apiKey, opts = {}) {
 // ---------------------------------------------------------------------------
 
 function buildPreAnalysisPrompt(aggregatedData) {
+  // Support both legacy aggregateDexterData shape and new Finnhub shape
+  const companyName = aggregatedData.company_name || aggregatedData.profile?.name || aggregatedData.ticker || 'Unknown';
+  const sector = aggregatedData.sector || aggregatedData.profile?.finnhubIndustry || 'Unknown';
+  const financials = aggregatedData.financial_data || aggregatedData.basicFinancials || null;
+  const insiderTrades = aggregatedData.insider_trades || aggregatedData.insiderTransactions || null;
+  const stockPrices = aggregatedData.stock_prices || aggregatedData.stockPrices || null;
+  const competitors = aggregatedData.competitor_data || aggregatedData.competitors || null;
+
   return `You are a financial research assistant. Analyze this data and return JSON only.
 
-Company: ${aggregatedData.company_name} (${aggregatedData.ticker})
-Sector: ${aggregatedData.sector}
+Company: ${companyName} (${aggregatedData.ticker || 'N/A'})
+Sector: ${sector}
 
-Financial Data: ${JSON.stringify(aggregatedData.financial_data, null, 0).slice(0, 3000)}
-Insider Trades: ${JSON.stringify(aggregatedData.insider_trades, null, 0).slice(0, 1000)}
-Stock Prices: ${JSON.stringify(aggregatedData.stock_prices, null, 0)}
-Competitor Data: ${JSON.stringify(aggregatedData.competitor_data, null, 0).slice(0, 500)}
+Financial Data: ${JSON.stringify(financials, null, 0).slice(0, 3000)}
+Insider Trades: ${JSON.stringify(insiderTrades, null, 0).slice(0, 1000)}
+Stock Prices: ${JSON.stringify(stockPrices, null, 0)}
+Competitor Data: ${JSON.stringify(competitors, null, 0).slice(0, 500)}
 
 Return ONLY valid JSON:
 {
@@ -370,62 +611,43 @@ function parsePreAnalysis(llmResponse) {
 // ---------------------------------------------------------------------------
 
 async function dexterResearch(input, helpers) {
-  const { ticker, keyword, article_type, blog } = input;
+  const { ticker } = input;
 
   if (!ticker) {
     return { error: 'Missing ticker', data_completeness: 0 };
   }
 
-  const apiKey = helpers?.env?.FINANCIAL_DATASETS_API_KEY;
+  const apiKey = helpers?.env?.FINNHUB_API_KEY;
   if (!apiKey) {
-    return { error: 'Missing FINANCIAL_DATASETS_API_KEY', data_completeness: 0 };
+    return { error: 'Missing FINNHUB_API_KEY', data_completeness: 0 };
   }
 
-  // Step 1-2: Fetch all financial data (cache check would happen here in n8n)
-  const rawData = await fetchFinancialData(ticker, apiKey, {
-    fetchFn: helpers?.fetchFn,
+  const nocoClient = helpers?._nocoClientOverride || makeNocoClient({
+    baseUrl: helpers?.env?.NOCODB_BASE_URL,
+    token: helpers?.env?.NOCODB_API_TOKEN,
+    tableId: helpers?.env?.NOCODB_FINANCIAL_CACHE_TABLE_ID,
+    projectId: helpers?.env?.NOCODB_PROJECT_ID,
   });
 
-  // Step 3-4: News + transcripts would be fetched here via separate HTTP nodes in n8n
-
-  // Step 5: Aggregate
-  const companyName = rawData.income_statements?.[0]?.company_name || ticker;
-  const sector = rawData.income_statements?.[0]?.sector || 'Unknown';
-  const marketCap = rawData.income_statements?.[0]?.market_capitalization
-    ? formatMarketCap(rawData.income_statements[0].market_capitalization)
-    : 'Unknown';
-
-  const aggregated = aggregateDexterData({
-    financialData: {
-      income_statements: rawData.income_statements,
-      balance_sheets: rawData.balance_sheets,
-      cash_flow: rawData.cash_flow,
-      ratios: rawData.ratios,
-    },
-    insiderTrades: rawData.insider_trades,
-    stockPrices: rawData.stock_prices,
-    competitorData: [], // competitors fetched separately in n8n
-    managementQuotes: [], // transcripts fetched separately
-    newsResults: [], // news fetched separately
+  const rawData = await fetchFinancialData(
     ticker,
-    companyName,
-    sector,
-    marketCap,
-  });
+    { apiKey, nocoClient, competitorsData: [] },
+    helpers?.fetchFn,
+  );
 
-  // Abort if data too incomplete
-  if (aggregated.data_completeness < 0.5) {
+  if (rawData.data_completeness < 0.5) {
     return {
       error: `Insufficient data for ${ticker}`,
-      data_completeness: aggregated.data_completeness,
+      data_completeness: rawData.data_completeness,
       ticker,
     };
   }
 
-  // Step 6: Pre-analysis prompt (LLM call happens in n8n via separate node)
-  aggregated.dexter_analysis_prompt = buildPreAnalysisPrompt(aggregated);
-
-  return aggregated;
+  return {
+    ...rawData,
+    ticker,
+    dexter_analysis_prompt: buildPreAnalysisPrompt(rawData),
+  };
 }
 
 // ---------------------------------------------------------------------------
@@ -459,9 +681,19 @@ module.exports = {
   parsePreAnalysis,
   dexterResearch,
   formatMarketCap,
-
   validateTicker,
 
+  // Section 04 — Finnhub integration
+  TokenBucket,
+  makeNocoClient,
+  readCache,
+  writeCache,
+  getQuote,
+  getProfile,
+  getBasicFinancials,
+  getInsiderTransactions,
+  _computeFinnhubCompleteness,
+
   // Constants
   DATA_TYPES,
   DATA_WEIGHTS,
diff --git a/ryan_cole/insiderbuying-site/n8n/tests/dexter-research.test.js b/ryan_cole/insiderbuying-site/n8n/tests/dexter-research.test.js
index c2d3b81..bfdb693 100644
--- a/ryan_cole/insiderbuying-site/n8n/tests/dexter-research.test.js
+++ b/ryan_cole/insiderbuying-site/n8n/tests/dexter-research.test.js
@@ -2,6 +2,7 @@ const { describe, it, before, after, mock } = require('node:test');
 const assert = require('node:assert/strict');
 
 // Import the module under test
+const dexterModule = require('../code/insiderbuying/dexter-research.js');
 const {
   aggregateDexterData,
   computePriceSummary,
@@ -13,7 +14,18 @@ const {
   dexterResearch,
   validateTicker,
   DATA_TYPES,
-} = require('../code/insiderbuying/dexter-research.js');
+  // Section 4 new exports
+  TokenBucket,
+  readCache,
+  writeCache,
+  makeNocoClient,
+  DATA_WEIGHTS,
+  fetchFinancialData,
+  getQuote,
+  getProfile,
+  getBasicFinancials,
+  getInsiderTransactions,
+} = dexterModule;
 
 // ---------------------------------------------------------------------------
 // Test: Price data aggregation
@@ -426,45 +438,37 @@ describe('dexterResearch', () => {
 
   it('returns error when API key missing', async () => {
     const result = await dexterResearch({ ticker: 'AAPL' }, { env: {} });
-    assert.ok(result.error.includes('FINANCIAL_DATASETS_API_KEY'));
+    assert.ok(result.error.includes('FINNHUB_API_KEY'));
   });
 
   it('returns aggregated data on success', async () => {
-    const mockFetch = async (url) => ({
-      ok: true,
-      status: 200,
-      json: async () => {
-        if (url.includes('income-statements')) return { income_statements: [{ revenue: 1000, company_name: 'Apple', sector: 'Tech', market_capitalization: 3000000000000 }] };
-        if (url.includes('balance-sheets')) return { balance_sheets: [{ total_assets: 5000 }] };
-        if (url.includes('cash-flow')) return { cash_flow_statements: [{ operating_cash_flow: 300 }] };
-        if (url.includes('financial-ratios')) return { financial_ratios: [{ pe_ratio: 25 }] };
-        if (url.includes('insider-trades')) return { insider_trades: [{ insider_name: 'CEO', transaction_date: new Date().toISOString().split('T')[0], transaction_type: 'P-Purchase' }] };
-        if (url.includes('stock-prices')) return { stock_prices: generateMockPrices(252) };
-        return {};
-      },
-    });
+    const candleData = { c: [100, 102, 104], h: [105, 107, 109], l: [98, 100, 102], o: [99, 101, 103], t: [1000000, 1001000, 1002000], v: [1e6, 1e6, 1e6], s: 'ok' };
+    const mockFetch = async (url) => {
+      if (url.includes('/quote')) return { statusCode: 200, body: { c: 150, h: 155, l: 148, o: 149, pc: 147, d: 3, dp: 2.04 } };
+      if (url.includes('/profile2')) return { statusCode: 200, body: { name: 'Apple Inc', marketCapitalization: 3000000, exchange: 'NASDAQ', finnhubIndustry: 'Tech', country: 'US', currency: 'USD' } };
+      if (url.includes('/metric')) return { statusCode: 200, body: { metric: { peBasicExclExtraTTM: 25, epsBasicExclExtraAnnual: 6.0, revenueGrowth3Y: 0.12, grossMarginTTM: 0.44 } } };
+      if (url.includes('/insider-transactions')) return { statusCode: 200, body: { data: [{ name: 'CEO', share: 1000, change: 100, transactionDate: '2025-01-01', transactionPrice: 145 }] } };
+      if (url.includes('/candle')) return { statusCode: 200, body: candleData };
+      return { statusCode: 200, body: {} };
+    };
+    const mockNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => ({ Id: 1 }) };
 
     const result = await dexterResearch(
       { ticker: 'AAPL', keyword: 'test', article_type: 'A', blog: 'insiderbuying' },
-      { env: { FINANCIAL_DATASETS_API_KEY: 'test-key' }, fetchFn: mockFetch }
+      { env: { FINNHUB_API_KEY: 'test-key', NOCODB_BASE_URL: 'http://localhost:8080', NOCODB_API_TOKEN: 'tok', NOCODB_PROJECT_ID: 'p1', NOCODB_FINANCIAL_CACHE_TABLE_ID: 'Financial_Cache' }, fetchFn: mockFetch, _nocoClientOverride: mockNoco }
     );
 
     assert.ok(!result.error);
-    assert.ok(result.data_completeness >= 0.5);
     assert.equal(result.ticker, 'AAPL');
-    assert.ok(result.stock_prices.current_price);
   });
 
   it('aborts when data_completeness < 0.5', async () => {
-    const mockFetch = async () => ({
-      ok: false,
-      status: 404,
-      json: async () => ({}),
-    });
+    const mockFetch = async () => ({ statusCode: 500, body: {} });
+    const mockNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => ({ Id: 1 }) };
 
     const result = await dexterResearch(
       { ticker: 'ZZZZZ', keyword: 'test', article_type: 'A', blog: 'test' },
-      { env: { FINANCIAL_DATASETS_API_KEY: 'test-key' }, fetchFn: mockFetch }
+      { env: { FINNHUB_API_KEY: 'test-key', NOCODB_BASE_URL: 'http://localhost:8080', NOCODB_API_TOKEN: 'tok', NOCODB_PROJECT_ID: 'p1', NOCODB_FINANCIAL_CACHE_TABLE_ID: 'Financial_Cache' }, fetchFn: mockFetch, _nocoClientOverride: mockNoco }
     );
 
     assert.ok(result.error);
@@ -472,6 +476,247 @@ describe('dexterResearch', () => {
   });
 });
 
+// ===========================================================================
+// Section 4: Finnhub Integration
+// ===========================================================================
+
+describe('TokenBucket rate limiter', () => {
+  it('capacity=5: first 5 acquire() resolve immediately', async () => {
+    const bucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 5000 });
+    const start = Date.now();
+    await Promise.all([
+      bucket.acquire(),
+      bucket.acquire(),
+      bucket.acquire(),
+      bucket.acquire(),
+      bucket.acquire(),
+    ]);
+    assert.ok(Date.now() - start < 100, 'All 5 should resolve immediately');
+  });
+
+  it('capacity=5: 6th acquire() waits for refill', async () => {
+    const bucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 50 });
+    // drain the bucket
+    for (let i = 0; i < 5; i++) await bucket.acquire();
+    const start = Date.now();
+    await bucket.acquire(); // 6th - must wait for refill
+    const elapsed = Date.now() - start;
+    assert.ok(elapsed >= 40, `6th acquire should wait >= 40ms, got ${elapsed}ms`);
+  });
+});
+
+describe('NocoDB cache layer', () => {
+  function makeNoco(records) {
+    return {
+      search: async () => records,
+      create: async (fields) => ({ Id: 1, ...fields }),
+      update: async (id, fields) => ({ Id: id, ...fields }),
+    };
+  }
+
+  it('readCache: valid unexpired record → returns parsed data', async () => {
+    const noco = makeNoco([{ expires_at: Date.now() + 86400000, data_json: JSON.stringify({ c: 100 }) }]);
+    const result = await readCache('AAPL', 'quote', noco);
+    assert.deepStrictEqual(result, { c: 100 });
+  });
+
+  it('readCache: expired record → returns null', async () => {
+    const noco = makeNoco([{ expires_at: Date.now() - 1000, data_json: JSON.stringify({ c: 99 }) }]);
+    const result = await readCache('AAPL', 'quote', noco);
+    assert.equal(result, null);
+  });
+
+  it('readCache: no record → returns null', async () => {
+    const noco = makeNoco([]);
+    const result = await readCache('AAPL', 'quote', noco);
+    assert.equal(result, null);
+  });
+
+  it('writeCache: no existing record → create called, update not called', async () => {
+    let createCalled = false;
+    let updateCalled = false;
+    const noco = {
+      search: async () => [],
+      create: async (fields) => { createCalled = true; return { Id: 1, ...fields }; },
+      update: async () => { updateCalled = true; return {}; },
+    };
+    const data = { price: 150 };
+    await writeCache('AAPL', 'quote', data, noco);
+    assert.equal(createCalled, true, 'create should be called on cache miss');
+    assert.equal(updateCalled, false, 'update should NOT be called');
+  });
+
+  it('writeCache: existing record → update called, create not called', async () => {
+    let createCalled = false;
+    let updateCalled = false;
+    const noco = {
+      search: async () => [{ Id: 42, ticker: 'AAPL', data_type: 'quote' }],
+      create: async () => { createCalled = true; return {}; },
+      update: async (id, fields) => { updateCalled = true; return { Id: id, ...fields }; },
+    };
+    await writeCache('AAPL', 'quote', { price: 155 }, noco);
+    assert.equal(createCalled, false, 'create should NOT be called');
+    assert.equal(updateCalled, true, 'update should be called on cache hit');
+  });
+
+  it('writeCache: expires_at written is approx Date.now() + 86400000', async () => {
+    let writtenExpiresAt = null;
+    const noco = {
+      search: async () => [],
+      create: async (fields) => { writtenExpiresAt = fields.expires_at; return { Id: 1 }; },
+      update: async () => {},
+    };
+    const before = Date.now();
+    await writeCache('AAPL', 'quote', { price: 150 }, noco);
+    const after = Date.now();
+    assert.ok(writtenExpiresAt >= before + 86400000 - 5000 && writtenExpiresAt <= after + 86400000 + 5000,
+      `expires_at ${writtenExpiresAt} should be ~Date.now() + 86400000`);
+  });
+});
+
+describe('finnhub.getQuote', () => {
+  function makeMissNoco() {
+    return { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };
+  }
+
+  it('cache miss → fetchFn called with Finnhub quote URL and returns data', async () => {
+    let fetchedUrl = null;
+    const fetchFn = async (url) => { fetchedUrl = url; return { statusCode: 200, body: { c: 150, h: 155, l: 148, o: 149, pc: 147, d: 3, dp: 2.04 } }; };
+    const cacheWrites = [];
+    const result = await getQuote('AAPL', 'test-key', fetchFn, makeMissNoco(), cacheWrites);
+    assert.ok(fetchedUrl.includes('finnhub.io'));
+    assert.ok(fetchedUrl.includes('AAPL'));
+    assert.equal(result.c, 150);
+    assert.equal(cacheWrites.length, 1, 'writeCache should be pushed to cacheWrites');
+  });
+
+  it('cache hit → fetchFn NOT called', async () => {
+    let fetchCalled = false;
+    const fetchFn = async () => { fetchCalled = true; return { statusCode: 200, body: {} }; };
+    const noco = { search: async () => [{ expires_at: Date.now() + 86400000, data_json: JSON.stringify({ c: 99 }) }], create: async () => {}, update: async () => {} };
+    const cacheWrites = [];
+    const result = await getQuote('AAPL', 'test-key', fetchFn, noco, cacheWrites);
+    assert.equal(fetchCalled, false, 'Finnhub should NOT be called on cache hit');
+    assert.equal(result.c, 99);
+    assert.equal(cacheWrites.length, 0, 'no cache write on hit');
+  });
+
+  it('fetchFn rejects with HTTP 429 → error propagates', async () => {
+    const fetchFn = async () => { throw new Error('HTTP 429'); };
+    const cacheWrites = [];
+    await assert.rejects(() => getQuote('AAPL', 'test-key', fetchFn, makeMissNoco(), cacheWrites));
+  });
+});
+
+describe('finnhub.getProfile', () => {
+  const missNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };
+
+  it('cache miss → fetches profile2 and returns object', async () => {
+    const profileData = { name: 'Apple Inc', marketCapitalization: 3000000, exchange: 'NASDAQ', finnhubIndustry: 'Technology', country: 'US', currency: 'USD' };
+    const fetchFn = async () => ({ statusCode: 200, body: profileData });
+    const cacheWrites = [];
+    const result = await getProfile('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
+    assert.equal(result.name, 'Apple Inc');
+    assert.equal(result.finnhubIndustry, 'Technology');
+  });
+
+  it('missing finnhubIndustry in response → returns null, not crash', async () => {
+    const fetchFn = async () => ({ statusCode: 200, body: { name: 'NoIndustry Corp', marketCapitalization: 100 } });
+    const cacheWrites = [];
+    const result = await getProfile('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
+    assert.equal(result.finnhubIndustry, null);
+  });
+});
+
+describe('finnhub.getBasicFinancials', () => {
+  const missNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };
+
+  it('cache miss → fetches metric=all and returns metric fields', async () => {
+    const metricData = { metric: { peBasicExclExtraTTM: 25, epsBasicExclExtraAnnual: 6.0, revenueGrowth3Y: 0.12, grossMarginTTM: 0.44 } };
+    const fetchFn = async () => ({ statusCode: 200, body: metricData });
+    const cacheWrites = [];
+    const result = await getBasicFinancials('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
+    assert.equal(result.metric.peBasicExclExtraTTM, 25);
+    assert.equal(result.metric.revenueGrowth3Y, 0.12);
+  });
+
+  it('missing revenueGrowth3Y → returns null, not undefined or crash', async () => {
+    const fetchFn = async () => ({ statusCode: 200, body: { metric: { peBasicExclExtraTTM: 25 } } });
+    const cacheWrites = [];
+    const result = await getBasicFinancials('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
+    assert.equal(result.metric.revenueGrowth3Y, null);
+  });
+
+  it('cache hit → fetchFn NOT called', async () => {
+    let fetchCalled = false;
+    const fetchFn = async () => { fetchCalled = true; return { statusCode: 200, body: {} }; };
+    const noco = { search: async () => [{ expires_at: Date.now() + 86400000, data_json: JSON.stringify({ metric: { pe: 20 } }) }], create: async () => {}, update: async () => {} };
+    const cacheWrites = [];
+    await getBasicFinancials('AAPL', 'test-key', fetchFn, noco, cacheWrites);
+    assert.equal(fetchCalled, false);
+  });
+});
+
+describe('finnhub.getInsiderTransactions', () => {
+  it('cache miss → fetches insider-transactions URL and returns data', async () => {
+    let fetchedUrl = null;
+    const txData = { data: [{ name: 'CEO', share: 1000, change: 100, transactionDate: '2025-01-01', transactionPrice: 145 }] };
+    const fetchFn = async (url) => { fetchedUrl = url; return { statusCode: 200, body: txData }; };
+    const missNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };
+    const cacheWrites = [];
+    const result = await getInsiderTransactions('AAPL', 'test-key', fetchFn, missNoco, cacheWrites);
+    assert.ok(fetchedUrl.includes('insider-transactions'));
+    assert.ok(result.data);
+    assert.equal(cacheWrites.length, 1);
+  });
+});
+
+describe('fetchFinancialData integration', () => {
+  const missNoco = { search: async () => [], create: async () => ({ Id: 1 }), update: async () => {} };
+
+  it('DATA_WEIGHTS values sum to exactly 1.0', () => {
+    const sum = Object.values(DATA_WEIGHTS).reduce((a, b) => a + b, 0);
+    assert.equal(parseFloat(sum.toFixed(10)), 1.0);
+  });
+
+  it('all 4+ Finnhub fetchers invoked in a single fetchFinancialData call', async () => {
+    const fetchedUrls = [];
+    const fetchFn = async (url) => {
+      fetchedUrls.push(url);
+      if (url.includes('/quote')) return { statusCode: 200, body: { c: 100, h: 105, l: 95, o: 99, pc: 98, d: 2, dp: 1 } };
+      if (url.includes('/profile2')) return { statusCode: 200, body: { name: 'T', marketCapitalization: 100, exchange: 'NYSE', finnhubIndustry: null, country: 'US', currency: 'USD' } };
+      if (url.includes('/metric')) return { statusCode: 200, body: { metric: {} } };
+      if (url.includes('/insider-transactions')) return { statusCode: 200, body: { data: [] } };
+      if (url.includes('/candle')) return { statusCode: 200, body: { s: 'ok', c: [100], t: [1e9], o: [99], h: [105], l: [95], v: [1e6] } };
+      return { statusCode: 200, body: {} };
+    };
+    await fetchFinancialData('AAPL', { apiKey: 'k', nocoClient: missNoco, competitorsData: [] }, fetchFn);
+    assert.ok(fetchedUrls.some((u) => u.includes('/quote')), 'quote endpoint should be called');
+    assert.ok(fetchedUrls.some((u) => u.includes('/profile2')), 'profile endpoint should be called');
+    assert.ok(fetchedUrls.some((u) => u.includes('/metric')), 'metric endpoint should be called');
+    assert.ok(fetchedUrls.some((u) => u.includes('/insider-transactions')), 'insider-transactions endpoint should be called');
+  });
+
+  it('data_completeness = 1.0 when all 5 data types present', async () => {
+    const fetchFn = async (url) => {
+      if (url.includes('/quote')) return { statusCode: 200, body: { c: 150, h: 155, l: 148, o: 149, pc: 147, d: 3, dp: 2 } };
+      if (url.includes('/profile2')) return { statusCode: 200, body: { name: 'Apple', marketCapitalization: 3e6, exchange: 'NASDAQ', finnhubIndustry: 'Tech', country: 'US', currency: 'USD' } };
+      if (url.includes('/metric')) return { statusCode: 200, body: { metric: { peBasicExclExtraTTM: 25 } } };
+      if (url.includes('/insider-transactions')) return { statusCode: 200, body: { data: [{ name: 'CEO', share: 100, change: 10, transactionDate: '2025-01-01', transactionPrice: 100 }] } };
+      if (url.includes('/candle')) return { statusCode: 200, body: { s: 'ok', c: [100, 102], t: [1e9, 2e9], o: [99, 101], h: [105, 106], l: [95, 97], v: [1e6, 2e6] } };
+      return { statusCode: 200, body: {} };
+    };
+    const result = await fetchFinancialData('AAPL', { apiKey: 'k', nocoClient: missNoco, competitorsData: [{ ticker: 'MSFT' }] }, fetchFn);
+    assert.equal(result.data_completeness, 1.0);
+  });
+
+  it('data_completeness < 1.0 when some data types null', async () => {
+    const fetchFn = async () => ({ statusCode: 500, body: {} });
+    const result = await fetchFinancialData('AAPL', { apiKey: 'k', nocoClient: missNoco, competitorsData: [] }, fetchFn);
+    assert.ok(result.data_completeness < 1.0);
+  });
+});
+
 // ===========================================================================
 // Helper functions for generating mock data
 // ===========================================================================
