/**
 * Dexter Research Agent — n8n Code Node
 *
 * Aggregates financial data from Finnhub API, caches results in
 * NocoDB Financial_Cache, and returns structured JSON matching the
 * FINANCIAL-ARTICLE-SYSTEM-PROMPT.md template variables.
 *
 * Called by W2 (Article Generation) via webhook with:
 *   { ticker, keyword, article_type, blog }
 *
 * Required env vars:
 *   FINNHUB_API_KEY
 *   NOCODB_BASE_URL, NOCODB_API_TOKEN, NOCODB_PROJECT_ID
 *   NOCODB_FINANCIAL_CACHE_TABLE_ID (e.g. 'Financial_Cache')
 */

'use strict';

const https = require('https');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// TokenBucket — shared rate limiter (60 req/min = 5 tokens per 5000ms)
// ---------------------------------------------------------------------------

class TokenBucket {
  constructor({ capacity, refillRate, refillInterval }) {
    this._capacity = capacity;
    this._tokens = capacity;
    this._refillRate = refillRate;
    this._refillInterval = refillInterval;
    this._waitQueue = [];
    this._interval = setInterval(() => this._refill(), refillInterval);
    if (this._interval.unref) this._interval.unref();
  }

  _refill() {
    this._tokens = Math.min(this._capacity, this._tokens + this._refillRate);
    while (this._waitQueue.length > 0 && this._tokens > 0) {
      this._tokens -= 1;
      this._waitQueue.shift()();
    }
  }

  acquire() {
    if (this._tokens > 0) {
      this._tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._waitQueue.push(resolve);
    });
  }
}

const finnhubBucket = new TokenBucket({ capacity: 5, refillRate: 5, refillInterval: 5000 });
const FINNHUB_BASE = 'https://api.finnhub.io';

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

function _httpsRequest(url, method, headers, body, _hops) {
  if ((_hops || 0) > 3) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: {
        'User-Agent': 'EarlyInsider/1.0 (contact@earlyinsider.com)',
        'Accept-Encoding': 'gzip, deflate',
        'Accept': 'application/json',
        ...headers,
        ...(bodyBuf ? { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(_httpsRequest(res.headers.location, method, headers, body, (_hops || 0) + 1));
        return;
      }
      const isGzip = res.headers['content-encoding'] === 'gzip';
      const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const parsedBody = text ? JSON.parse(text) : {};
          resolve({ statusCode: res.statusCode, body: parsedBody });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: {} });
        }
      });
      stream.on('error', reject);
    });
    req.setTimeout(10000, () => req.destroy());
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function httpsGet(url, headers) {
  return _httpsRequest(url, 'GET', headers || {}, null);
}

// ---------------------------------------------------------------------------
// Minimal NocoDB client for Financial_Cache table
// ---------------------------------------------------------------------------

function makeNocoClient({ baseUrl, token, tableId, projectId }) {
  const base = `${baseUrl}/api/v1/db/data/noco/${projectId || 'noco'}/${tableId}`;
  const headers = { 'xc-token': token, 'Content-Type': 'application/json' };

  return {
    async search(where) {
      const url = `${base}?where=${encodeURIComponent(where)}&limit=1`;
      const res = await _httpsRequest(url, 'GET', headers);
      return (res.body && res.body.list) ? res.body.list : [];
    },
    async create(fields) {
      const res = await _httpsRequest(base + '/', 'POST', headers, fields);
      return res.body || {};
    },
    async update(rowId, fields) {
      const res = await _httpsRequest(`${base}/${rowId}`, 'PATCH', headers, fields);
      return res.body || {};
    },
  };
}

// ---------------------------------------------------------------------------
// NocoDB Cache helpers
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function readCache(ticker, dataType, nocoClient) {
  const where = `(ticker,eq,${ticker})~and(data_type,eq,${dataType})`;
  const records = await nocoClient.search(where);
  if (!records || records.length === 0) return null;
  const rec = records[0];
  if (!rec || !rec.expires_at || rec.expires_at <= Date.now()) return null;
  try {
    return JSON.parse(rec.data_json);
  } catch (_) {
    return null;
  }
}

async function writeCache(ticker, dataType, data, nocoClient) {
  const where = `(ticker,eq,${ticker})~and(data_type,eq,${dataType})`;
  const records = await nocoClient.search(where);
  const expiresAt = Date.now() + CACHE_TTL_MS;
  const dataJson = JSON.stringify(data);
  if (records && records.length > 0 && records[0].Id != null) {
    return nocoClient.update(records[0].Id, { data_json: dataJson, expires_at: expiresAt });
  }
  return nocoClient.create({ ticker, data_type: dataType, data_json: dataJson, expires_at: expiresAt });
}

// ---------------------------------------------------------------------------
// Finnhub fetchers
// ---------------------------------------------------------------------------

async function getQuote(ticker, apiKey, fetchFn, nocoClient, cacheWrites) {
  const doFetch = fetchFn || httpsGet;
  const cached = await readCache(ticker, 'quote', nocoClient);
  if (cached !== null) return cached;
  await finnhubBucket.acquire();
  const url = `${FINNHUB_BASE}/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await doFetch(url);
  if (res.statusCode !== 200) throw new Error(`Finnhub quote HTTP ${res.statusCode}`);
  const data = res.body;
  cacheWrites.push(writeCache(ticker, 'quote', data, nocoClient));
  return data;
}

async function getProfile(ticker, apiKey, fetchFn, nocoClient, cacheWrites) {
  const doFetch = fetchFn || httpsGet;
  const cached = await readCache(ticker, 'profile', nocoClient);
  if (cached !== null) return cached;
  await finnhubBucket.acquire();
  const url = `${FINNHUB_BASE}/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await doFetch(url);
  if (res.statusCode !== 200) return null;
  const b = res.body || {};
  const data = {
    name: b.name ?? null,
    marketCapitalization: b.marketCapitalization ?? null,
    exchange: b.exchange ?? null,
    finnhubIndustry: b.finnhubIndustry ?? null,
    country: b.country ?? null,
    currency: b.currency ?? null,
  };
  cacheWrites.push(writeCache(ticker, 'profile', data, nocoClient));
  return data;
}

async function getBasicFinancials(ticker, apiKey, fetchFn, nocoClient, cacheWrites) {
  const doFetch = fetchFn || httpsGet;
  const cached = await readCache(ticker, 'basic_financials', nocoClient);
  if (cached !== null) return cached;
  await finnhubBucket.acquire();
  const url = `${FINNHUB_BASE}/api/v1/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${apiKey}`;
  const res = await doFetch(url);
  if (res.statusCode !== 200) return null;
  const m = (res.body && res.body.metric) || {};
  const data = {
    metric: {
      peBasicExclExtraTTM: m.peBasicExclExtraTTM ?? null,
      epsBasicExclExtraAnnual: m.epsBasicExclExtraAnnual ?? null,
      revenueGrowth3Y: m.revenueGrowth3Y ?? null,
      grossMarginTTM: m.grossMarginTTM ?? null,
    },
  };
  cacheWrites.push(writeCache(ticker, 'basic_financials', data, nocoClient));
  return data;
}

async function getInsiderTransactions(ticker, apiKey, fetchFn, nocoClient, cacheWrites) {
  const doFetch = fetchFn || httpsGet;
  const cached = await readCache(ticker, 'insider_transactions', nocoClient);
  if (cached !== null) return cached;
  await finnhubBucket.acquire();
  const url = `${FINNHUB_BASE}/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const res = await doFetch(url);
  if (res.statusCode !== 200) return null;
  const data = res.body || { data: [] };
  cacheWrites.push(writeCache(ticker, 'insider_transactions', data, nocoClient));
  return data;
}

// ---------------------------------------------------------------------------
// Alpha Vantage — Earnings Calendar (Section 5)
// ---------------------------------------------------------------------------

const AV_BASE = 'https://www.alphavantage.co';
const CACHE_TTL_EARNINGS_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Split a CSV line while respecting double-quoted fields (handles commas inside quotes).
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
}

/**
 * Strip surrounding double-quotes from a CSV field value.
 */
function stripQuotes(s) {
  return (s || '').replace(/^"|"$/g, '');
}

/**
 * Fetch the Alpha Vantage 3-month earnings calendar CSV, cache in NocoDB
 * under ticker='__all__' / data_type='earnings_calendar'.
 *
 * @param {string} apiKey
 * @param {Object} nocoClient  — NocoDB client (search/create/update)
 * @param {Function} [fetchFn] — optional override for testing
 * @returns {Promise<Map<string, {reportDate, fiscalDateEnding, estimate}>>}
 */
async function getEarningsCalendar(apiKey, nocoClient, fetchFn) {
  // 1. Check cache
  try {
    const cached = await readCache('__all__', 'earnings_calendar', nocoClient);
    if (cached !== null) {
      // cached.data_json is a JSON string of Map entries array
      const entries = typeof cached === 'string' ? JSON.parse(cached) : Object.entries(cached);
      return new Map(Array.isArray(cached) ? cached : entries);
    }
  } catch (_) {
    // Cache read failure: fall through to API
  }

  // 2. Fetch from Alpha Vantage
  try {
    const url = `${AV_BASE}/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${encodeURIComponent(apiKey)}`;
    const doFetch = fetchFn || (async (u) => {
      // For production: raw text (CSV), not JSON
      return new Promise((resolve, reject) => {
        const parsed = new URL(u);
        const opts = {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            'User-Agent': 'EarlyInsider/1.0 (contact@earlyinsider.com)',
            'Accept': 'text/csv,text/plain,*/*',
          },
        };
        const req = https.request(opts, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', reject);
        });
        req.setTimeout(15000, () => req.destroy());
        req.on('error', reject);
        req.end();
      });
    });

    const res = await doFetch(url);
    if (res.statusCode !== 200 || typeof res.body !== 'string') return new Map();

    // 3. Parse CSV
    const lines = res.body.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return new Map();

    const calendar = new Map();
    // Skip header row (index 0)
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      if (cols.length < 4) continue;
      const symbol = stripQuotes(cols[0]).trim();
      const reportDate = stripQuotes(cols[2]).trim();
      const fiscalDateEnding = stripQuotes(cols[3]).trim();
      const estimateRaw = stripQuotes(cols[4] || '').trim();
      const estimate = estimateRaw === '' ? null : estimateRaw;
      if (symbol) calendar.set(symbol, { reportDate, fiscalDateEnding, estimate });
    }

    // 4. Write to cache — serialize Map as JSON array of entries
    const dataJson = JSON.stringify([...calendar.entries()]);
    const expiry = Date.now() + CACHE_TTL_EARNINGS_MS;
    const existing = await nocoClient.search(`(ticker,eq,__all__),(data_type,eq,earnings_calendar)`).catch(() => []);
    if (existing && existing.length > 0) {
      await nocoClient.update(existing[0].Id, { data_json: dataJson, expires_at: expiry });
    } else {
      await nocoClient.create({ ticker: '__all__', data_type: 'earnings_calendar', data_json: dataJson, expires_at: expiry });
    }

    return calendar;
  } catch (_) {
    return new Map();
  }
}

/**
 * Pure function — look up next earnings report date for a ticker.
 * @param {string} ticker
 * @param {Map|null|undefined} calendarMap
 * @returns {string|null}
 */
function getNextEarningsDate(ticker, calendarMap) {
  if (!calendarMap) return null;
  return calendarMap.get(ticker)?.reportDate ?? null;
}

// ---------------------------------------------------------------------------
// Constants (Section 4)
// ---------------------------------------------------------------------------

const DATA_TYPES = [
  'income_statements',
  'balance_sheets',
  'cash_flow',
  'ratios',
  'insider_trades',
  'stock_prices',
  'competitors',
];

// New Finnhub-based weights (sum = 1.0)
const DATA_WEIGHTS = {
  quote_profile:  0.25,
  basic_metrics:  0.25,
  stock_prices:   0.25,
  competitors:    0.10,
  insider_trades: 0.15,
};

const API_BASE = 'https://api.financialdatasets.ai';

// Validate ticker format: 1-5 uppercase letters, optionally with a dot (BRK.B)
function validateTicker(ticker) {
  if (!ticker || typeof ticker !== 'string') return false;
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test(ticker.toUpperCase());
}

function safeTicker(ticker) {
  return encodeURIComponent(ticker);
}

const ENDPOINTS = {
  income_statements: (ticker) =>
    `${API_BASE}/api/v1/financial-statements/income-statements?ticker=${safeTicker(ticker)}&period=quarterly&limit=4`,
  income_statements_annual: (ticker) =>
    `${API_BASE}/api/v1/financial-statements/income-statements?ticker=${safeTicker(ticker)}&period=annual&limit=3`,
  balance_sheets: (ticker) =>
    `${API_BASE}/api/v1/financial-statements/balance-sheets?ticker=${safeTicker(ticker)}&period=quarterly&limit=1`,
  cash_flow: (ticker) =>
    `${API_BASE}/api/v1/financial-statements/cash-flow-statements?ticker=${safeTicker(ticker)}&period=quarterly&limit=4`,
  ratios: (ticker) =>
    `${API_BASE}/api/v1/financial-ratios?ticker=${safeTicker(ticker)}&period=quarterly&limit=12`,
  insider_trades: (ticker) =>
    `${API_BASE}/api/v1/insider-trades?ticker=${safeTicker(ticker)}&limit=50`,
  stock_prices: (ticker) =>
    `${API_BASE}/api/v1/stock-prices?ticker=${safeTicker(ticker)}&interval=day&limit=252`,
};

// ---------------------------------------------------------------------------
// Cache utilities
// ---------------------------------------------------------------------------

function buildCacheKey(ticker, dataType) {
  return { ticker, data_type: dataType };
}

function isCacheValid(entry) {
  if (!entry || !entry.expires_at) return false;
  return new Date(entry.expires_at).getTime() > Date.now();
}

function buildCacheExpiry() {
  return new Date(Date.now() + CACHE_TTL_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

async function fetchWithRetry(url, options = {}, config = {}) {
  const {
    fetchFn,
    maxRetries = 3,
    baseDelay = 1000,
  } = config;

  if (!fetchFn) {
    throw new Error('fetchFn is required (n8n Code node does not have global fetch)');
  }

  let lastResponse;
  const totalAttempts = maxRetries + 1;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    lastResponse = await fetchFn(url, options);

    if (lastResponse.ok || lastResponse.status !== 429) {
      return lastResponse;
    }

    // 429 — wait with exponential backoff before retrying
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return lastResponse; // return last 429 response after exhausting retries
}

// ---------------------------------------------------------------------------
// Price data aggregation
// ---------------------------------------------------------------------------

function computePriceSummary(prices) {
  if (!prices || prices.length === 0) {
    return {
      high_52w: null, low_52w: null, current_price: null,
      ma_50: null, ma_200: null,
      return_1m: null, return_6m: null, return_1y: null,
      avg_volume_30d: null,
    };
  }

  // Prices are ordered oldest-first
  const closes = prices.map((p) => p.close);
  const n = closes.length;

  const currentPrice = closes[n - 1];
  const high52w = Math.max(...closes);
  const low52w = Math.min(...closes);

  // Moving averages
  const ma50 = n >= 50
    ? closes.slice(n - 50).reduce((a, b) => a + b, 0) / 50
    : null;
  const ma200 = n >= 200
    ? closes.slice(n - 200).reduce((a, b) => a + b, 0) / 200
    : null;

  // Returns (percentage)
  const return1m = n >= 21
    ? ((currentPrice - closes[n - 21]) / closes[n - 21]) * 100
    : null;
  const return6m = n >= 126
    ? ((currentPrice - closes[n - 126]) / closes[n - 126]) * 100
    : null;
  const return1y = n >= 252
    ? ((currentPrice - closes[0]) / closes[0]) * 100
    : null;

  // Average volume (30 trading days)
  const volumes = prices.slice(-30).map((p) => p.volume);
  const avgVolume30d = volumes.length > 0
    ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length)
    : null;

  return {
    high_52w: high52w,
    low_52w: low52w,
    current_price: currentPrice,
    ma_50: ma50 !== null ? Math.round(ma50 * 100) / 100 : null,
    ma_200: ma200 !== null ? Math.round(ma200 * 100) / 100 : null,
    return_1m: return1m !== null ? Math.round(return1m * 100) / 100 : null,
    return_6m: return6m !== null ? Math.round(return6m * 100) / 100 : null,
    return_1y: return1y !== null ? Math.round(return1y * 100) / 100 : null,
    avg_volume_30d: avgVolume30d,
  };
}

// ---------------------------------------------------------------------------
// Data completeness scoring
// ---------------------------------------------------------------------------

// Legacy weights used by computeDataCompleteness (backward compat with old data format)
const _LEGACY_WEIGHTS = {
  income_statements: 0.25,
  balance_sheets: 0.10,
  cash_flow: 0.10,
  ratios: 0.10,
  insider_trades: 0.10,
  stock_prices: 0.25,
  competitors: 0.10,
};

function computeDataCompleteness(data) {
  let score = 0;
  for (const dtype of DATA_TYPES) {
    const value = data[dtype];
    if (Array.isArray(value) && value.length > 0) {
      score += _LEGACY_WEIGHTS[dtype] || 0;
    }
  }
  return Math.round(score * 100) / 100;
}

// Finnhub-specific completeness using new DATA_WEIGHTS
function _computeFinnhubCompleteness({ quote, profile, basicFinancials, stockPrices, competitors, insiderTransactions }) {
  let score = 0;
  if (quote != null || profile != null) score += DATA_WEIGHTS.quote_profile;
  if (basicFinancials != null) score += DATA_WEIGHTS.basic_metrics;
  if (stockPrices != null && Array.isArray(stockPrices) && stockPrices.length > 0) score += DATA_WEIGHTS.stock_prices;
  if (competitors != null && Array.isArray(competitors) && competitors.length > 0) score += DATA_WEIGHTS.competitors;
  if (insiderTransactions != null) score += DATA_WEIGHTS.insider_trades;
  return Math.round(score * 100) / 100;
}

// ---------------------------------------------------------------------------
// Insider trade filtering (last 90 days)
// ---------------------------------------------------------------------------

function filterRecentInsiderTrades(trades, daysBack = 90) {
  if (!trades || !Array.isArray(trades)) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  return trades.filter((t) => {
    if (!t.transaction_date) return false;
    return new Date(t.transaction_date) >= cutoff;
  });
}

// ---------------------------------------------------------------------------
// Main aggregation
// ---------------------------------------------------------------------------

function aggregateDexterData({
  financialData,
  insiderTrades,
  stockPrices,
  competitorData,
  managementQuotes,
  newsResults,
  ticker,
  companyName,
  sector,
  marketCap,
}) {
  const priceSummary = computePriceSummary(stockPrices);
  const filteredTrades = filterRecentInsiderTrades(insiderTrades);

  return {
    company_name: companyName,
    ticker,
    sector,
    market_cap: marketCap,
    financial_data: {
      income_statements: financialData.income_statements || [],
      balance_sheets: financialData.balance_sheets || [],
      cash_flow: financialData.cash_flow || [],
      ratios: financialData.ratios || [],
    },
    insider_trades: filteredTrades,
    stock_prices: priceSummary,
    competitor_data: competitorData || [],
    management_quotes: managementQuotes || [],
    news: newsResults || [],
    data_completeness: computeDataCompleteness({
      income_statements: financialData.income_statements,
      balance_sheets: financialData.balance_sheets,
      cash_flow: financialData.cash_flow,
      ratios: financialData.ratios,
      insider_trades: insiderTrades,
      stock_prices: stockPrices,
      competitors: competitorData,
    }),
  };
}

// ---------------------------------------------------------------------------
// Finnhub fetchFinancialData
// ---------------------------------------------------------------------------

async function fetchFinancialData(ticker, context, fetchFn) {
  const { apiKey, nocoClient, competitorsData } = context || {};
  const cacheWrites = [];

  // Fire all 5 data fetches in parallel
  const [quoteRes, profileRes, metricsRes, insiderRes, candleRes] = await Promise.allSettled([
    getQuote(ticker, apiKey, fetchFn, nocoClient, cacheWrites),
    getProfile(ticker, apiKey, fetchFn, nocoClient, cacheWrites),
    getBasicFinancials(ticker, apiKey, fetchFn, nocoClient, cacheWrites),
    getInsiderTransactions(ticker, apiKey, fetchFn, nocoClient, cacheWrites),
    (async () => {
      const doFetch = fetchFn || httpsGet;
      const cached = await readCache(ticker, 'stock_prices', nocoClient);
      if (cached !== null) return cached;
      await finnhubBucket.acquire();
      const url = `${FINNHUB_BASE}/api/v1/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=D&count=252&token=${apiKey}`;
      const res = await doFetch(url);
      if (res.statusCode !== 200 || !res.body || res.body.s !== 'ok') return null;
      const b = res.body;
      const prices = (b.t || []).map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        open: b.o[i], high: b.h[i], low: b.l[i], close: b.c[i], volume: b.v[i],
      }));
      cacheWrites.push(writeCache(ticker, 'stock_prices', prices, nocoClient));
      return prices;
    })(),
  ]);

  const safeVal = (res) => (res.status === 'fulfilled' ? res.value : null);
  const quote = safeVal(quoteRes);
  const profile = safeVal(profileRes);
  const basicFinancials = safeVal(metricsRes);
  const insiderTransactions = safeVal(insiderRes);
  const stockPrices = safeVal(candleRes);
  const competitors = Array.isArray(competitorsData) && competitorsData.length > 0 ? competitorsData : null;

  // Await all cache writes before returning (n8n kills background promises)
  await Promise.allSettled(cacheWrites);

  return {
    quote,
    profile,
    basicFinancials,
    insiderTransactions,
    stockPrices,
    competitors,
    data_completeness: _computeFinnhubCompleteness({ quote, profile, basicFinancials, stockPrices, competitors, insiderTransactions }),
  };
}

// ---------------------------------------------------------------------------
// LLM Pre-Analysis (Dexter Analysis)
// ---------------------------------------------------------------------------

function buildPreAnalysisPrompt(aggregatedData) {
  // Support both legacy aggregateDexterData shape and new Finnhub shape
  const companyName = aggregatedData.company_name || aggregatedData.profile?.name || aggregatedData.ticker || 'Unknown';
  const sector = aggregatedData.sector || aggregatedData.profile?.finnhubIndustry || 'Unknown';
  const financials = aggregatedData.financial_data || aggregatedData.basicFinancials || null;
  const insiderTrades = aggregatedData.insider_trades || aggregatedData.insiderTransactions || null;
  const stockPrices = aggregatedData.stock_prices || aggregatedData.stockPrices || null;
  const competitors = aggregatedData.competitor_data || aggregatedData.competitors || null;

  return `You are a financial research assistant. Analyze this data and return JSON only.

Company: ${companyName} (${aggregatedData.ticker || 'N/A'})
Sector: ${sector}

Financial Data: ${JSON.stringify(financials, null, 0).slice(0, 3000)}
Insider Trades: ${JSON.stringify(insiderTrades, null, 0).slice(0, 1000)}
Stock Prices: ${JSON.stringify(stockPrices, null, 0)}
Competitor Data: ${JSON.stringify(competitors, null, 0).slice(0, 500)}

Return ONLY valid JSON:
{
  "key_findings": ["3-5 notable data points"],
  "risks": ["2-3 identified risks"],
  "catalysts": ["2-3 potential catalysts"]
}`;
}

function parsePreAnalysis(llmResponse) {
  try {
    // Handle both raw JSON and markdown-wrapped JSON
    let text = typeof llmResponse === 'string' ? llmResponse : JSON.stringify(llmResponse);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!Array.isArray(parsed.key_findings) || !Array.isArray(parsed.risks) || !Array.isArray(parsed.catalysts)) {
      return null;
    }

    return {
      key_findings: parsed.key_findings.slice(0, 5),
      risks: parsed.risks.slice(0, 3),
      catalysts: parsed.catalysts.slice(0, 3),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point (for n8n Code node)
// ---------------------------------------------------------------------------

async function dexterResearch(input, helpers) {
  const { ticker } = input;

  if (!ticker) {
    return { error: 'Missing ticker', data_completeness: 0 };
  }

  const apiKey = helpers?.env?.FINNHUB_API_KEY;
  if (!apiKey) {
    return { error: 'Missing FINNHUB_API_KEY', data_completeness: 0 };
  }

  const nocoClient = helpers?._nocoClientOverride || makeNocoClient({
    baseUrl: helpers?.env?.NOCODB_BASE_URL,
    token: helpers?.env?.NOCODB_API_TOKEN,
    tableId: helpers?.env?.NOCODB_FINANCIAL_CACHE_TABLE_ID,
    projectId: helpers?.env?.NOCODB_PROJECT_ID,
  });

  const rawData = await fetchFinancialData(
    ticker,
    { apiKey, nocoClient, competitorsData: [] },
    helpers?.fetchFn,
  );

  if (rawData.data_completeness < 0.5) {
    return {
      error: `Insufficient data for ${ticker}`,
      data_completeness: rawData.data_completeness,
      ticker,
    };
  }

  return {
    ...rawData,
    ticker,
    dexter_analysis_prompt: buildPreAnalysisPrompt(rawData),
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatMarketCap(value) {
  if (!value || typeof value !== 'number') return 'Unknown';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value}`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Core functions (tested)
  aggregateDexterData,
  computePriceSummary,
  computeDataCompleteness,
  buildCacheKey,
  isCacheValid,
  buildCacheExpiry,
  fetchWithRetry,
  filterRecentInsiderTrades,
  fetchFinancialData,
  buildPreAnalysisPrompt,
  parsePreAnalysis,
  dexterResearch,
  formatMarketCap,
  validateTicker,

  // Section 04 — Finnhub integration
  TokenBucket,
  makeNocoClient,
  readCache,
  writeCache,
  getQuote,
  getProfile,
  getBasicFinancials,
  getInsiderTransactions,
  _computeFinnhubCompleteness,

  // Section 05 — Alpha Vantage earnings calendar
  getEarningsCalendar,
  getNextEarningsDate,

  // Constants
  DATA_TYPES,
  DATA_WEIGHTS,
  CACHE_TTL_MS,
  ENDPOINTS,
};
