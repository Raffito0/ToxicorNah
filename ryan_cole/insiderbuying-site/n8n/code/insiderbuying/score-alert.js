'use strict';

// ─── score-alert.js ─────────────────────────────────────────────────────────
// Significance scoring node for the W4 InsiderBuying.ai pipeline.
// Runs after sec-monitor.js, before analyze-alert.js.
// Computes a 1-10 significance score using DeepSeek plus insider track
// record from NocoDB Insider_History and Yahoo Finance 30-day price returns.
// ────────────────────────────────────────────────────────────────────────────

const { createDeepSeekClient } = require('./ai-client');
const { NocoDB } = require('./nocodb-client');

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
 * Queries NocoDB Insider_History for past buys by this insider (past 24 months),
 * then fetches 30-day returns from Yahoo Finance for each.
 *
 * Returns { past_buy_count, hit_rate, avg_gain_30d }
 * hit_rate and avg_gain_30d are null if Yahoo data unavailable.
 */
async function computeTrackRecord(insiderName, nocodb, { fetchFn } = {}) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const normalizedName = normalizeInsiderName(insiderName);
  // Use ilike for case-insensitive matching (equivalent to Supabase ilike).
  // Do not pre-encode — the NocoDB client's list() handles URL encoding.
  const where = `(insider_name,ilike,%${normalizedName}%)~and(filing_date,gt,${cutoffStr})`;

  let rows = [];
  try {
    const result = await nocodb.list('Insider_History', {
      where,
      fields: 'ticker,filing_date,total_value',
      limit: 100,
    });
    rows = result.list || [];
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

// ─── computeBaseScore ────────────────────────────────────────────────────────

const ROLE_WEIGHT = {
  'ceo': 2.5, 'chief executive officer': 2.5,
  'cfo': 2.0, 'chief financial officer': 2.0,
  'president': 2.0,
  'coo': 1.8, 'chief operating officer': 1.8,
  'director': 1.0,
};

/**
 * Deterministic 5-factor weighted base score for a filing.
 * Returns 0 for excluded transaction codes (G/F).
 * Returns a number in [1, 10] rounded to one decimal.
 * Never throws — null fields are skipped gracefully.
 */
function computeBaseScore(filing) {
  if (!filing) return 1;

  const {
    transactionValue, transactionCode, canonicalRole,
    marketCapUsd, clusterCount7Days, clusterCount14Days,
    historicalAvgReturn, historicalCount,
  } = filing;

  if (transactionCode === 'G' || transactionCode === 'F') return 0;

  let score = 5.0;

  // Factor 1 — Transaction Value (~30%)
  // Guard: negative/zero treated as missing data — skip factor without penalty
  if (transactionValue != null && transactionValue > 0) {
    if (transactionValue >= 10_000_000)      score += 3.0;
    else if (transactionValue >= 5_000_000)  score += 2.4;
    else if (transactionValue >= 2_500_000)  score += 1.9;
    else if (transactionValue >= 1_000_000)  score += 1.5;
    else if (transactionValue >= 500_000)    score += 1.2;
    else if (transactionValue >= 250_000)    score += 0.9;
    else if (transactionValue >= 100_000)    score += 0.6;
    else                                     score -= 1.0;
  }

  // Factor 2 — Insider Role (~25%)
  const roleKey = (canonicalRole || '').toLowerCase().trim();
  score += ROLE_WEIGHT[roleKey] ?? 0.5;

  // Factor 3 — Market Cap (~20%)
  if (marketCapUsd == null) {
    console.warn('[score-alert] marketCapUsd null — skipping market cap factor');
  } else if (marketCapUsd >= 100_000_000_000) score += 0.6;   // mega-cap >= $100B
  else if (marketCapUsd >= 10_000_000_000)    score += 0.8;   // large-cap $10B-$100B
  else if (marketCapUsd >= 2_000_000_000)     score += 1.0;   // mid-cap $2B-$10B
  else                                        score += 1.5;   // small/micro-cap < $2B

  // Factor 4 — Cluster Signal (~15%)
  if (clusterCount7Days != null) {
    if (clusterCount7Days >= 3)      score += 0.5;
    else if (clusterCount7Days >= 2) score += 0.3;
  } else if (clusterCount14Days != null) {
    if (clusterCount14Days >= 3) score += 0.2;
  }

  // Factor 5 — Track Record (~5%)
  if (historicalAvgReturn != null && historicalCount != null && historicalCount >= 2) {
    if (historicalAvgReturn > 20 && historicalCount >= 3)              score += 0.5;
    else if (historicalAvgReturn > 10 && historicalCount >= 2)         score += 0.3;
  }

  return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
}

// ─── callDeepSeekForRefinement ───────────────────────────────────────────────

const REFINEMENT_FALLBACK_REASON = 'AI refinement failed after 2 attempts — using base score';

/**
 * Builds direction-aware refinement prompt for the AI ±1 adjustment layer.
 * @internal
 */
function _buildRefinementPrompt(filing, baseScore) {
  const direction = filing.direction === 'D' ? 'sell' : 'buy';
  const ticker = filing.ticker || 'unknown';
  const name = filing.insider_name || 'insider';
  const value = filing.transactionValue ? `$${(filing.transactionValue / 1_000_000).toFixed(1)}M` : 'unknown value';

  let factors;
  if (direction === 'buy') {
    factors = `1. Is this the insider's first purchase in 2+ years after a long period of no buying?
2. Did the insider buy into a recent earnings miss or analyst downgrade (buying a dip)?
3. Did the insider significantly increase their position size vs. their typical trade size?
4. Is there an unusual timing signal (bought right before a product launch or deal announcement window)?`;
  } else {
    factors = `1. Is this the insider's first sale in 2+ years after a long period of no selling?
2. Did the insider sell into strength (stock near all-time highs) suggesting bearish conviction?
3. Is the sell size unusually large relative to their typical sale history?
4. Is there a timing signal suggesting informed selling rather than routine tax planning?`;
  }

  return `You are evaluating an insider ${direction} trade for ${name} at ${ticker} (${value}).
The deterministic base score is ${baseScore} / 10.

Assess only the following qualitative factors (answer YES/NO mentally, do not state them):
${factors}

Based on these factors, apply a constrained adjustment:
- +1 if 2 or more factors clearly indicate exceptional conviction
- -1 if 2 or more factors clearly indicate this is routine / low-conviction
- 0 otherwise

Respond with ONLY a JSON object, no prose, no markdown:
{"adjustment": 0, "reason": "one sentence explanation"}`;
}

/**
 * Strips markdown code fences from a string.
 * @internal
 */
function _stripFences(text) {
  return text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
}

/**
 * Calls DeepSeek for a constrained ±1 AI adjustment to the base score.
 *
 * @param {object} filing   - Filing object (needs: is10b5Plan, direction, ticker, insider_name, transactionValue)
 * @param {number} baseScore - Score from computeBaseScore(), e.g. 7.3
 * @param {object} deps     - { client: AIClient, sleep: fn }
 * @returns {{ base_score, ai_adjustment, ai_reason, final_score }}
 */
async function callDeepSeekForRefinement(filing, baseScore, deps = {}) {
  const { client, sleep } = deps;

  // 10b5-1 plan: skip AI entirely, apply cap
  if (filing.is10b5Plan) {
    const final_score = parseFloat(Math.min(5, Math.max(1, baseScore)).toFixed(1));
    return {
      base_score: baseScore,
      ai_adjustment: 0,
      ai_reason: '10b5-1 plan — cap applied, refinement skipped',
      final_score,
    };
  }

  const prompt = _buildRefinementPrompt(filing, baseScore);

  let rawText = null;
  let parsed = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0 && sleep) await sleep(2000);
      // null first arg = no system prompt, user-turn only
      const response = await client.complete(null, prompt, { temperature: 0.0 });
      rawText = _stripFences((response.content || '').trim());
      // continue jumps to attempt=1 where sleep fires — delay is still applied
      if (!rawText) continue;
      parsed = JSON.parse(rawText);
      break;
    } catch {
      rawText = null;
      parsed = null;
    }
  }

  if (!parsed || typeof parsed.adjustment !== 'number') {
    console.warn('[score-alert] ' + REFINEMENT_FALLBACK_REASON);
    const final_score = parseFloat(Math.min(10, Math.max(1, baseScore)).toFixed(1));
    return { base_score: baseScore, ai_adjustment: 0, ai_reason: REFINEMENT_FALLBACK_REASON, final_score };
  }

  // Clamp adjustment to valid range
  const ai_adjustment = Math.max(-1, Math.min(1, Math.round(parsed.adjustment)));
  const ai_reason = (parsed.reason && typeof parsed.reason === 'string' && parsed.reason.trim())
    ? parsed.reason.trim()
    : 'No reason provided';

  const raw = baseScore + ai_adjustment;
  const final_score = parseFloat(Math.min(10, Math.max(1, raw)).toFixed(1));

  return { base_score: baseScore, ai_adjustment, ai_reason, final_score };
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
 * Calls DeepSeek via ai-client with prompt.
 * Returns { score, reasoning } or HAIKU_DEFAULT on any error.
 * Retry logic is delegated to the ai-client layer.
 *
 * @param {string} prompt
 * @param {object} deepseekClient - AIClient instance from createDeepSeekClient()
 */
async function callHaiku(prompt, deepseekClient) {
  try {
    const result = await deepseekClient.complete(null, prompt, { temperature: 0.3 });
    return parseHaikuResponse(result.content);
  } catch (err) {
    console.log(`[score-alert] scoring failed: ${err.message}`);
    return { ...HAIKU_DEFAULT };
  }
}

// ─── emitScoreLog ───────────────────────────────────────────────────────────

/**
 * Emits a structured JSON log line for every scoring decision.
 * Required fields: ticker, insiderName, transactionCode, direction, finalScore, timestamp.
 * Optional: baseScore, aiAdjustment (scored alerts), skipReason (G/F), overrideReason (M/X).
 */
function emitScoreLog(data) {
  const log = {
    ticker: data.ticker,
    insiderName: data.insider_name || null,
    transactionCode: data.transactionCode,
    direction: data.direction || null,
    finalScore: data.finalScore !== undefined ? data.finalScore : null,
    timestamp: new Date().toISOString(),
  };
  if (data.baseScore !== undefined)    log.baseScore = data.baseScore;
  if (data.aiAdjustment !== undefined) log.aiAdjustment = data.aiAdjustment;
  if (data.skipReason)                 log.skipReason = data.skipReason;
  if (data.overrideReason)             log.overrideReason = data.overrideReason;
  console.log(JSON.stringify(log));
}

// ─── detectSameDaySell ───────────────────────────────────────────────────────

const EXERCISE_SELL_THRESHOLD = 0.80;

/**
 * Detects the "exercise-and-sell" pattern: insider exercises options and
 * immediately sells >= 80% of exercised shares on the same calendar day.
 *
 * Returns 0 if exercise-and-sell confirmed (financial housekeeping, not conviction).
 * Returns undefined if: partial sell, no matching sell found, or NocoDB unavailable.
 *
 * @param {object} filing - must have: insiderCik, transactionDate, sharesExercised
 * @param {object} deps   - must have: nocodb
 */
async function detectSameDaySell(filing, deps = {}) {
  const { nocodb, alertsTableId = 'Alerts' } = deps;
  const { insiderCik, transactionDate, sharesExercised } = filing || {};

  if (!nocodb || !insiderCik || !transactionDate) return undefined;

  try {
    const where = `(insiderCik,eq,${insiderCik})~and(transactionDate,eq,${transactionDate})~and(transactionCode,eq,S)`;
    const { list } = await nocodb.list(alertsTableId, { where });

    if (!list || list.length === 0) return undefined;

    const exercised = Number(sharesExercised) || 0;
    if (exercised <= 0) return undefined;

    for (const row of list) {
      const sold = Number(row.transactionShares) || 0;
      if (sold >= exercised * EXERCISE_SELL_THRESHOLD) return 0;
    }

    return undefined;
  } catch (err) {
    console.warn(`[score-alert] detectSameDaySell failed: ${err.message}`);
    return undefined;
  }
}

// ─── 3.3 runScoreAlert ──────────────────────────────────────────────────────

/**
 * Main n8n node entry point.
 * Iterates over all filings sequentially. Filters G/F codes and exercise-and-sell trades.
 * Each remaining filing is scored via computeBaseScore + callDeepSeekForRefinement.
 *
 * @param {Array} filings - Array of filing objects from sec-monitor.js
 * @param {Object} helpers - { nocodb, deepseekApiKey, fetchFn }
 * @returns {Array} Scored filings (G/F and exercise-and-sell excluded)
 */
async function runScoreAlert(filings, helpers = {}) {
  const { nocodb, fetchFn, deepseekApiKey } = helpers;
  const deepseek = createDeepSeekClient(fetchFn, deepseekApiKey);

  if (!filings || filings.length === 0) return [];

  const results = [];

  for (const filing of filings) {
    // Belt-and-suspenders G/F filter (upstream unit 09 is primary)
    if (filing.transactionCode === 'G' || filing.transactionCode === 'F') {
      emitScoreLog({ ...filing, skipReason: 'gift/tax', finalScore: null });
      continue;
    }

    // Step 1: compute track record (graceful on any failure)
    const trackRecord = await computeTrackRecord(
      filing.insider_name,
      nocodb,
      { fetchFn }
    );

    // Step 2: deterministic base score + AI refinement
    const baseScore = computeBaseScore(filing);
    const refinement = await callDeepSeekForRefinement(filing, baseScore, {
      client: deepseek,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });

    // Step 3: exercise-and-sell detection for option exercise codes
    if (filing.transactionCode === 'M' || filing.transactionCode === 'X') {
      const sameDayResult = await detectSameDaySell(filing, { nocodb });
      if (sameDayResult === 0) {
        emitScoreLog({ ...filing, overrideReason: 'exercise-and-sell', finalScore: 0 });
        continue;
      }
    }

    // Step 4: emit structured log and push result
    emitScoreLog({
      ...filing,
      baseScore: refinement.base_score,
      aiAdjustment: refinement.ai_adjustment,
      finalScore: refinement.final_score,
    });

    results.push({
      ...filing,
      significance_score: refinement.final_score,
      score_reasoning: refinement.ai_reason,
      base_score: refinement.base_score,
      ai_adjustment: refinement.ai_adjustment,
      track_record: trackRecord,
    });
  }

  return results;
}

// ─── runWeeklyCalibration ────────────────────────────────────────────────────

const ALERTS_TABLE = 'Alerts';
const CALIB_TABLE = 'score_calibration_runs';

/**
 * Queries NocoDB for all scored alerts from the past 7 days, buckets them into
 * four score ranges, fires a Telegram alert if the distribution is unhealthy,
 * and always writes a calibration run record to score_calibration_runs.
 *
 * @param {object} deps  { fetchFn, sleep, env }
 *   env keys: NOCODB_BASE_URL, NOCODB_API_TOKEN, NOCODB_PROJECT_ID,
 *             TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * @returns {{ total, buckets, flagged } | { message } | null}
 */
async function runWeeklyCalibration(deps) {
  // sleep: accepted for dep-injection consistency with other functions; unused here
  const { fetchFn, env } = deps;

  if (!env.NOCODB_BASE_URL || !env.NOCODB_API_TOKEN) {
    console.warn('[calibration] missing NocoDB env vars — skipping');
    return null;
  }

  const nocodb = new NocoDB(
    env.NOCODB_BASE_URL,
    env.NOCODB_API_TOKEN,
    env.NOCODB_PROJECT_ID,
    fetchFn
  );

  // Step 1: Query alerts from past 7 days with a final score
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let alerts;
  try {
    const response = await nocodb.list(ALERTS_TABLE, {
      where: `(created_at,gte,${sevenDaysAgo})~and(final_score,isnot,null)`,
      fields: 'final_score',
      limit: 1000,
    });
    alerts = response.list || [];
  } catch (err) {
    console.error('[calibration] NocoDB query failed:', err.message);
    return null;
  }

  // Step 2: Guard for empty week
  if (alerts.length === 0) {
    console.log('[calibration] no alerts this week — skipping');
    return { message: 'no alerts this week' };
  }

  // Step 3: Bucket the scores
  const total = alerts.length;
  let count_1_3 = 0, count_4_5 = 0, count_6_7 = 0, count_8_10 = 0;

  for (const alert of alerts) {
    const score = alert.final_score;
    if (score <= 3) count_1_3++;
    else if (score <= 5) count_4_5++;
    else if (score <= 7) count_6_7++;
    else count_8_10++;
  }

  const pct_1_3 = parseFloat((count_1_3 / total * 100).toFixed(1));
  const pct_4_5 = parseFloat((count_4_5 / total * 100).toFixed(1));
  const pct_6_7 = parseFloat((count_6_7 / total * 100).toFixed(1));
  const pct_8_10 = parseFloat((count_8_10 / total * 100).toFixed(1));

  // Step 4: Evaluate alert conditions
  let flagged = false;
  let flagReason = '';

  if (pct_8_10 > 25) {
    flagged = true;
    flagReason = `8-10 bucket is ${pct_8_10}% — formula may be too generous`;
  } else if (pct_8_10 < 5) {
    flagged = true;
    flagReason = `8-10 bucket is ${pct_8_10}% — formula may be too strict`;
  } else if (pct_1_3 === 0 || pct_4_5 === 0 || pct_6_7 === 0 || pct_8_10 === 0) {
    flagged = true;
    flagReason = 'one or more buckets are empty — pipeline anomaly detected';
  }

  // Step 5: Send Telegram alert if flagged
  if (flagged) {
    const weekOf = new Date().toISOString().slice(0, 10);
    const text = [
      `[Score Calibration Alert] Week of ${weekOf}`,
      `Total alerts: ${total}`,
      'Distribution:',
      `  1-3:  ${pct_1_3}%`,
      `  4-5:  ${pct_4_5}%`,
      `  6-7:  ${pct_6_7}%`,
      `  8-10: ${pct_8_10}%`,
      '',
      `Issue: ${flagReason}`,
    ].join('\n');

    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
      const res = await fetchFn(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      });
      if (!res.ok) {
        console.error(`[calibration] Telegram sendMessage returned ${res.status}`);
      }
    } catch (err) {
      console.error('[calibration] Telegram send failed:', err.message);
    }
  }

  // Step 6: Write calibration record to NocoDB (always, even when not flagged)
  const run_date = new Date().toISOString().slice(0, 10);
  try {
    await nocodb.create(CALIB_TABLE, {
      run_date,
      total_alerts: total,
      pct_1_3,
      pct_4_5,
      pct_6_7,
      pct_8_10,
      flagged,
    });
  } catch (err) {
    console.error('[calibration] NocoDB calibration write failed:', err.message);
  }

  return { total, buckets: { pct_1_3, pct_4_5, pct_6_7, pct_8_10 }, flagged };
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
//   const nocodb = new NocoDB(
//     $env.NOCODB_BASE_URL, $env.NOCODB_API_TOKEN, $env.NOCODB_PROJECT_ID,
//     (url, opts) => fetch(url, opts)
//   );
//   const helpers = {
//     nocodb,
//     deepseekApiKey: $env.DEEPSEEK_API_KEY,
//     fetchFn: (url, opts) => fetch(url, opts),
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
  computeBaseScore,
  callDeepSeekForRefinement,
  detectSameDaySell,
  emitScoreLog,
  runWeeklyCalibration,
};
