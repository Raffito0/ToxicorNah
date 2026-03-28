/**
 * Dexter Research Agent — n8n Code Node
 *
 * Aggregates financial data from Financial Datasets API, caches results in
 * NocoDB Financial_Cache, and returns structured JSON matching the
 * FINANCIAL-ARTICLE-SYSTEM-PROMPT.md template variables.
 *
 * Called by W2 (Article Generation) via webhook with:
 *   { ticker, keyword, article_type, blog }
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
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

// Weights for data completeness score — income_statements and stock_prices
// are weighted higher because articles cannot be written without them.
// Note: 'competitors' has no ENDPOINTS entry — fetched by a separate n8n node
// using sector from income statement response. The weight still applies so
// completeness reflects whether competitor data was provided externally.
const DATA_WEIGHTS = {
  income_statements: 0.25,
  balance_sheets: 0.10,
  cash_flow: 0.10,
  ratios: 0.10,
  insider_trades: 0.10,
  stock_prices: 0.25,
  competitors: 0.10,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

function computeDataCompleteness(data) {
  let score = 0;
  for (const dtype of DATA_TYPES) {
    const value = data[dtype];
    if (Array.isArray(value) && value.length > 0) {
      score += DATA_WEIGHTS[dtype];
    }
  }
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
// Financial Datasets API fetcher (for n8n Code node usage)
// ---------------------------------------------------------------------------

async function fetchFinancialData(ticker, apiKey, opts = {}) {
  const { fetchFn, nocodbBaseUrl, nocodbToken } = opts;

  const headers = { 'X-API-Key': apiKey };

  // Parallel fetch all 7 data types
  const [
    incomeRes,
    incomeAnnualRes,
    balanceRes,
    cashFlowRes,
    ratiosRes,
    insiderRes,
    pricesRes,
  ] = await Promise.allSettled([
    fetchWithRetry(ENDPOINTS.income_statements(ticker), { headers }, { fetchFn }),
    fetchWithRetry(ENDPOINTS.income_statements_annual(ticker), { headers }, { fetchFn }),
    fetchWithRetry(ENDPOINTS.balance_sheets(ticker), { headers }, { fetchFn }),
    fetchWithRetry(ENDPOINTS.cash_flow(ticker), { headers }, { fetchFn }),
    fetchWithRetry(ENDPOINTS.ratios(ticker), { headers }, { fetchFn }),
    fetchWithRetry(ENDPOINTS.insider_trades(ticker), { headers }, { fetchFn }),
    fetchWithRetry(ENDPOINTS.stock_prices(ticker), { headers }, { fetchFn }),
  ]);

  const safeJson = async (settled) => {
    if (settled.status === 'rejected') return null;
    const res = settled.value;
    if (!res.ok) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  const income = await safeJson(incomeRes);
  const incomeAnnual = await safeJson(incomeAnnualRes);
  const balance = await safeJson(balanceRes);
  const cashFlow = await safeJson(cashFlowRes);
  const ratios = await safeJson(ratiosRes);
  const insider = await safeJson(insiderRes);
  const prices = await safeJson(pricesRes);

  return {
    income_statements: [
      ...(income?.income_statements || []),
      ...(incomeAnnual?.income_statements || []),
    ],
    balance_sheets: balance?.balance_sheets || [],
    cash_flow: cashFlow?.cash_flow_statements || [],
    ratios: ratios?.financial_ratios || [],
    insider_trades: insider?.insider_trades || [],
    stock_prices: prices?.stock_prices || [],
  };
}

// ---------------------------------------------------------------------------
// LLM Pre-Analysis (Dexter Analysis)
// ---------------------------------------------------------------------------

function buildPreAnalysisPrompt(aggregatedData) {
  return `You are a financial research assistant. Analyze this data and return JSON only.

Company: ${aggregatedData.company_name} (${aggregatedData.ticker})
Sector: ${aggregatedData.sector}

Financial Data: ${JSON.stringify(aggregatedData.financial_data, null, 0).slice(0, 3000)}
Insider Trades: ${JSON.stringify(aggregatedData.insider_trades, null, 0).slice(0, 1000)}
Stock Prices: ${JSON.stringify(aggregatedData.stock_prices, null, 0)}
Competitor Data: ${JSON.stringify(aggregatedData.competitor_data, null, 0).slice(0, 500)}

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
  const { ticker, keyword, article_type, blog } = input;

  if (!ticker) {
    return { error: 'Missing ticker', data_completeness: 0 };
  }

  const apiKey = helpers?.env?.FINANCIAL_DATASETS_API_KEY;
  if (!apiKey) {
    return { error: 'Missing FINANCIAL_DATASETS_API_KEY', data_completeness: 0 };
  }

  // Step 1-2: Fetch all financial data (cache check would happen here in n8n)
  const rawData = await fetchFinancialData(ticker, apiKey, {
    fetchFn: helpers?.fetchFn,
  });

  // Step 3-4: News + transcripts would be fetched here via separate HTTP nodes in n8n

  // Step 5: Aggregate
  const companyName = rawData.income_statements?.[0]?.company_name || ticker;
  const sector = rawData.income_statements?.[0]?.sector || 'Unknown';
  const marketCap = rawData.income_statements?.[0]?.market_capitalization
    ? formatMarketCap(rawData.income_statements[0].market_capitalization)
    : 'Unknown';

  const aggregated = aggregateDexterData({
    financialData: {
      income_statements: rawData.income_statements,
      balance_sheets: rawData.balance_sheets,
      cash_flow: rawData.cash_flow,
      ratios: rawData.ratios,
    },
    insiderTrades: rawData.insider_trades,
    stockPrices: rawData.stock_prices,
    competitorData: [], // competitors fetched separately in n8n
    managementQuotes: [], // transcripts fetched separately
    newsResults: [], // news fetched separately
    ticker,
    companyName,
    sector,
    marketCap,
  });

  // Abort if data too incomplete
  if (aggregated.data_completeness < 0.5) {
    return {
      error: `Insufficient data for ${ticker}`,
      data_completeness: aggregated.data_completeness,
      ticker,
    };
  }

  // Step 6: Pre-analysis prompt (LLM call happens in n8n via separate node)
  aggregated.dexter_analysis_prompt = buildPreAnalysisPrompt(aggregated);

  return aggregated;
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

  // Constants
  DATA_TYPES,
  DATA_WEIGHTS,
  CACHE_TTL_MS,
  ENDPOINTS,
};
