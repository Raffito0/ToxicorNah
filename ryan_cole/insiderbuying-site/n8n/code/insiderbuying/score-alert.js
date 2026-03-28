'use strict';

// ─── score-alert.js ─────────────────────────────────────────────────────────
// Significance scoring node for the W4 InsiderBuying.ai pipeline.
// Runs after sec-monitor.js, before analyze-alert.js.
// Computes a 1-10 significance score using Claude Haiku plus insider track
// record from Supabase history and Yahoo Finance 30-day price returns.
// ────────────────────────────────────────────────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const YAHOO_API = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HISTORY_MONTHS = 24;

// ─── 3.1 Insider Name Normalization ─────────────────────────────────────────

/**
 * Strips middle initials (single uppercase letter followed by period),
 * common suffixes (Jr., Sr., II, III, IV), lowercases and trims.
 * 'John A. Smith' and 'John Smith' both normalize to 'john smith'.
 */
function normalizeInsiderName(name) {
  return name
    .replace(/\b[A-Z]\.\s*/g, '')        // remove middle initials like "A. "
    .replace(/\b(Jr|Sr|II|III|IV|V)\b\.?/gi, '')  // remove suffixes
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

// ─── 3.1 Yahoo Finance Price Fetch ──────────────────────────────────────────

/**
 * Returns 30-day return for a given ticker and filing date.
 * Returns null if data unavailable (graceful degradation).
 */
async function fetch30DayReturn(ticker, filingDateStr, fetchFn) {
  const start = Math.floor(new Date(filingDateStr).getTime() / 1000);
  const end = start + 31 * 86400;
  const url = `${YAHOO_API}/${ticker}?interval=1d&period1=${start}&period2=${end}`;

  let resp;
  try {
    resp = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch {
    return null; // network error — graceful per-filing degradation
  }

  if (!resp.ok) return null;

  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  // Find first valid close (start price) and last valid close (end price)
  const validPairs = timestamps
    .map((ts, i) => ({ ts, price: closes[i] }))
    .filter(({ price }) => price != null && price > 0);

  if (validPairs.length < 2) return null;

  const startPrice = validPairs[0].price;
  const endPrice = validPairs[validPairs.length - 1].price;

  return (endPrice - startPrice) / startPrice;
}

// ─── 3.1 computeTrackRecord ─────────────────────────────────────────────────

/**
 * Queries Supabase for past buys by this insider (past 24 months),
 * then fetches 30-day returns from Yahoo Finance for each.
 *
 * Returns { past_buy_count, hit_rate, avg_gain_30d }
 * hit_rate and avg_gain_30d are null if Yahoo data unavailable.
 */
async function computeTrackRecord(insiderName, supabaseUrl, supabaseKey, { fetchFn } = {}) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const normalizedName = normalizeInsiderName(insiderName);
  // PostgREST ilike uses SQL LIKE syntax: % is wildcard, not *
  const namePattern = `%${normalizedName.split(' ').join('%')}%`;

  let rows = [];
  try {
    const params = new URLSearchParams({
      select: 'ticker,filing_date,total_value',
      transaction_type: 'eq.buy',
      'filing_date': `gte.${cutoffStr}`,
      'insider_name': `ilike.${namePattern}`,
    });
    const url = `${supabaseUrl}/rest/v1/insider_alerts?${params}`;
    const resp = await fetchFn(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!resp.ok) {
      return { past_buy_count: 0, hit_rate: null, avg_gain_30d: null };
    }
    rows = await resp.json();
  } catch {
    return { past_buy_count: 0, hit_rate: null, avg_gain_30d: null };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { past_buy_count: 0, hit_rate: null, avg_gain_30d: null };
  }

  // Fetch 30-day returns for each past buy (sequentially — gentle on Yahoo Finance).
  // fetch30DayReturn handles its own exceptions and returns null on any failure,
  // so each filing is isolated — one flaky ticker doesn't abort the rest.
  const returns = [];
  for (const row of rows) {
    const ret = await fetch30DayReturn(row.ticker, row.filing_date, fetchFn);
    returns.push(ret);
  }

  const validReturns = returns.filter(r => r !== null);
  if (validReturns.length === 0) {
    return { past_buy_count: rows.length, hit_rate: null, avg_gain_30d: null };
  }

  // Note: hit_rate and avg_gain_30d use validReturns.length as denominator
  // (trades where Yahoo had price data), which may be less than past_buy_count.
  // The prompt context includes past_buy_count separately so Haiku has the full picture.
  const hits = validReturns.filter(r => r > 0.05);
  const hit_rate = hits.length / validReturns.length;
  const avg_gain_30d = validReturns.reduce((sum, r) => sum + r, 0) / validReturns.length;

  return { past_buy_count: rows.length, hit_rate, avg_gain_30d };
}

// ─── 3.2 buildHaikuPrompt ───────────────────────────────────────────────────

/**
 * Builds the prompt string for Claude Haiku significance scoring.
 */
function buildHaikuPrompt(filing, trackRecord) {
  const {
    ticker, insider_name, insider_category, transaction_type,
    transaction_shares, transaction_price_per_share, total_value,
    filing_date, transaction_date, is_cluster_buy, cluster_size,
  } = filing;

  const { past_buy_count, hit_rate, avg_gain_30d } = trackRecord;

  const trackStr = past_buy_count === 0
    ? 'No historical purchases found for this insider in the past 24 months.'
    : `Past buys (24 months): ${past_buy_count}` +
      (hit_rate !== null ? `, hit_rate (>5% gain in 30d): ${hit_rate} (${(hit_rate * 100).toFixed(1)}%)` : ', hit_rate: unknown') +
      (avg_gain_30d !== null ? `, avg_gain_30d: ${avg_gain_30d} (${(avg_gain_30d * 100).toFixed(1)}%)` : ', avg_gain_30d: unknown') + '.';

  const clusterStr = is_cluster_buy
    ? `CLUSTER BUY: Yes — ${cluster_size} insiders bought this stock within a 7-day window.`
    : 'Cluster buy: No (single insider purchase).';

  return `You are an expert insider trading analyst. Score the significance of this insider purchase from 1 to 10.

FILING DATA:
- Ticker: ${ticker}
- Insider Name: ${insider_name}
- Insider Category: ${insider_category}
- Transaction Type: ${transaction_type}
- Shares: ${transaction_shares ?? 'unknown'}
- Price per Share: $${transaction_price_per_share ?? 'unknown'}
- Total Value: $${total_value ?? 'unknown'}
- Filing Date: ${filing_date}
- Transaction Date: ${transaction_date}

CLUSTER SIGNAL:
${clusterStr}

INSIDER TRACK RECORD:
${trackStr}
(If hit_rate is null/unknown, treat as neutral — do not penalize for lack of data.)

SCORING CRITERIA:
1. Role weight: C-Suite (+3), Board (+2), VP (+1), Officer = baseline
2. Transaction size: $500K+ = notable, $1M+ = significant, $5M+ = highly significant
3. Track record: hit_rate >60% with positive avg_gain_30d boosts score; null = neutral
4. Cluster bonus: Multiple insiders buying same stock in 7-day window = highly significant (+3)
5. Timing signals: near earnings window, first buy in 2+ years, buy after >15% price drop = boost
6. Purchase type: Open-market purchase (P - Purchase) scores higher than option exercise

Respond with ONLY a JSON object in this exact format:
{"score": <integer 1-10>, "reasoning": "<1-2 sentence explanation>"}`;
}

// ─── 3.2 parseHaikuResponse ──────────────────────────────────────────────────

/**
 * Repairs and parses the raw text response from Haiku.
 * Strips markdown fences, fixes smart quotes, extracts first {...} object.
 * Returns { score: number, reasoning: string } with score clamped to [1,10].
 * Throws on parse failure.
 */
function parseHaikuResponse(rawText) {
  let text = rawText;

  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '');

  // Fix smart quotes
  text = text
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'");

  // Extract first {...} object
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in Haiku response: ${rawText.slice(0, 100)}`);
  }
  text = text.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse Haiku JSON: ${e.message}. Raw: ${rawText.slice(0, 100)}`);
  }

  if (parsed.score === undefined || parsed.score === null) {
    throw new Error('Haiku response missing "score" field');
  }
  if (!parsed.reasoning || typeof parsed.reasoning !== 'string' || parsed.reasoning.trim() === '') {
    throw new Error('Haiku response missing or empty "reasoning" field');
  }

  // Clamp and round score to integer [1, 10]
  const score = Math.min(10, Math.max(1, Math.round(Number(parsed.score))));

  return { score, reasoning: parsed.reasoning };
}

// ─── 3.2 callHaiku ──────────────────────────────────────────────────────────

const HAIKU_DEFAULT = { score: 5, reasoning: 'Scoring unavailable' };

/**
 * Calls Anthropic Haiku API with prompt. Retries up to 2 times on failure.
 * Returns { score, reasoning } or default { score: 5, ... } on exhausted retries.
 */
async function callHaiku(prompt, anthropicApiKey, { fetchFn, _sleep } = {}) {
  const body = JSON.stringify({
    model: HAIKU_MODEL,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': anthropicApiKey,
    'anthropic-version': '2023-06-01',
  };

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      if (attempt > 0 && _sleep) await _sleep(1000 * attempt);

      const resp = await fetchFn(ANTHROPIC_API, { method: 'POST', headers, body });

      if (!resp.ok) {
        if (attempt === 2) return { ...HAIKU_DEFAULT };
        continue;
      }

      const data = await resp.json();
      const rawText = data?.content?.[0]?.text;
      if (!rawText) {
        if (attempt === 2) return { ...HAIKU_DEFAULT };
        continue;
      }

      return parseHaikuResponse(rawText);
    } catch {
      if (attempt === 2) return { ...HAIKU_DEFAULT };
    }
  }

  return { ...HAIKU_DEFAULT };
}

// ─── 3.3 runScoreAlert ──────────────────────────────────────────────────────

/**
 * Main n8n node entry point.
 * Iterates over all filings sequentially, scores each with Haiku,
 * and returns the enriched filing array.
 *
 * @param {Array} filings - Array of filing objects from sec-monitor.js
 * @param {Object} helpers - { supabaseUrl, supabaseKey, anthropicApiKey, fetchFn, _sleep }
 * @returns {Array} filings enriched with significance_score, score_reasoning, track_record
 */
async function runScoreAlert(filings, helpers = {}) {
  const { supabaseUrl, supabaseKey, anthropicApiKey, fetchFn, _sleep } = helpers;

  if (!filings || filings.length === 0) return [];

  const results = [];

  for (const filing of filings) {
    // Step 1: compute track record (graceful on any failure)
    const trackRecord = await computeTrackRecord(
      filing.insider_name,
      supabaseUrl,
      supabaseKey,
      { fetchFn }
    );

    // Step 2: build prompt and call Haiku
    const prompt = buildHaikuPrompt(filing, trackRecord);
    const { score, reasoning } = await callHaiku(prompt, anthropicApiKey, { fetchFn, _sleep });

    results.push({
      ...filing,
      significance_score: score,
      score_reasoning: reasoning,
      track_record: trackRecord,
    });
  }

  return results;
}

// ─── n8n Code node entry point ───────────────────────────────────────────────
// When running inside n8n, the node receives $input.all() items.
// This block is only executed in n8n context (not in tests).
// n8n Code nodes support top-level await — Jest does not, so the guard
// on typeof $input prevents this from running during tests.

// ── n8n DEPLOYMENT INSTRUCTIONS ─────────────────────────────────────────────
// When deploying to an n8n Code node:
//   1. Copy all function definitions above (normalizeInsiderName through runScoreAlert)
//   2. Append the entry block below (without the comment markers)
//   3. Remove the module.exports line (not needed in n8n sandbox)
//
// Entry block for n8n Code node:
//
//   const filings = $input.all().map(item => item.json);
//   const helpers = {
//     supabaseUrl: $env.SUPABASE_URL,
//     supabaseKey: $env.SUPABASE_SERVICE_ROLE_KEY,
//     anthropicApiKey: $env.ANTHROPIC_API_KEY,
//     fetchFn: (url, opts) => fetch(url, opts),
//     _sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
//   };
//   const results = await runScoreAlert(filings, helpers);
//   return results.map(item => ({ json: item }));
// ─────────────────────────────────────────────────────────────────────────────

// ─── Exports (for testing) ───────────────────────────────────────────────────

module.exports = {
  normalizeInsiderName,
  computeTrackRecord,
  buildHaikuPrompt,
  parseHaikuResponse,
  callHaiku,
  runScoreAlert,
};
