'use strict';

const { createOpusClient, createDeepSeekClient } = require('./ai-client');

// Try to import finnhub client (section 07). Stub if not yet available.
let _getQuote = async () => null;
let _getNextEarningsDate = async () => null;
try {
  const finnhub = require('./finnhub-client');
  _getQuote = finnhub.getQuote;
  _getNextEarningsDate = finnhub.getNextEarningsDate;
} catch {
  // finnhub-client.js not yet complete (section 07) — quote/earnings data unavailable
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BANNED_PHRASES = ["guaranteed", "will moon", "to the moon", "can't lose", "sure thing"];
const CAUTIONARY_WORDS = ["however", "risk", "caution", "could", "routine", "consider"];

// ─── stripMarkdownFences ─────────────────────────────────────────────────────

/**
 * Removes markdown code fences (```json ... ``` or ``` ... ```) from a string.
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFences(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/s, '$1').trim();
}

// ─── getWordTarget ────────────────────────────────────────────────────────────

/**
 * Maps a final alert score to a word budget for the analysis prompt.
 * @param {number} score
 * @returns {{ target: number, max: number }}
 */
function getWordTarget(score) {
  if (score >= 8) return { target: 225, max: 300 };
  if (score >= 6) return { target: 200, max: 275 };
  if (score >= 4) return { target: 125, max: 175 };
  return { target: 100, max: 150 };
}

// ─── buildAnalysisPrompt (S05) ───────────────────────────────────────────────

/**
 * Builds the direction-aware analysis prompt for DeepSeek.
 *
 * Supports both old (snake_case from analyze()) and new (camelCase) field naming
 * so that existing tests using legacy field names continue to pass.
 *
 * @param {object} alert       - Alert object (new or old field format accepted)
 * @param {object} marketData  - { currentPrice, pctChangeToday, daysToEarnings, portfolioPct }
 * @param {object} wordTarget  - { target, max } from getWordTarget()
 * @returns {string} Prompt string ready to send to DeepSeek
 */
function buildAnalysisPrompt(alert, marketData = {}, wordTarget = null) {
  // Support both old (snake_case) and new (camelCase) field naming
  const insiderName = alert.insiderName || alert.insider_name || 'Unknown insider';
  const ticker = alert.ticker || 'Unknown';
  const canonicalRole = alert.canonicalRole || alert.insider_title || 'insider';
  const insiderCategory = alert.insiderCategory || alert.insider_category || '';
  const sharesTraded = alert.sharesTraded != null ? alert.sharesTraded : alert.transaction_shares;
  const pricePerShare = alert.pricePerShare != null ? alert.pricePerShare : alert.price_per_share;
  const transactionValue = alert.transactionValue != null ? alert.transactionValue : alert.total_value;
  const direction = alert.direction || 'A';
  const finalScore = alert.finalScore != null ? alert.finalScore : (alert.significance_score != null ? alert.significance_score : 5);
  const companyName = alert.companyName || alert.company_name || ticker;
  const transactionDate = alert.transactionDate || alert.transaction_date || '';

  const wt = wordTarget || getWordTarget(finalScore);

  const isBuy = direction === 'A';
  const directionLabel = isBuy ? 'BUY' : 'SELL';
  const actionVerb = isBuy ? 'bought' : 'sold';

  // ── Filing data lines ────────────────────────────────────────────────────
  const filingLines = [
    `- Company: ${companyName} (${ticker})`,
    `- Insider: ${insiderName}, ${canonicalRole}${insiderCategory ? ` (${insiderCategory})` : ''}`,
    `- Transaction: ${actionVerb} ${sharesTraded != null ? sharesTraded + ' shares' : 'shares'} at $${pricePerShare} per share, total value $${transactionValue}`,
    `- Date: ${transactionDate}`,
    `- Significance score: ${finalScore}/10`,
  ];

  // ── Market data (only include if available) ──────────────────────────────
  if (marketData.currentPrice != null) {
    const pctStr = marketData.pctChangeToday != null
      ? `, ${marketData.pctChangeToday >= 0 ? 'up' : 'down'} ${Math.abs(marketData.pctChangeToday).toFixed(1)}% today`
      : '';
    filingLines.push(`- Current price: $${marketData.currentPrice}${pctStr}`);
  }
  if (marketData.daysToEarnings != null && marketData.daysToEarnings > 0 && marketData.daysToEarnings <= 90) {
    filingLines.push(`- Earnings in ${marketData.daysToEarnings} days`);
  }
  if (marketData.portfolioPct != null) {
    filingLines.push(`- This trade represents ${marketData.portfolioPct}% of their current holdings`);
  }

  // ── Track record ─────────────────────────────────────────────────────────
  const tr = alert.track_record;
  if (tr && tr.past_buy_count > 0) {
    const hitRatePct = tr.hit_rate != null ? Math.round(tr.hit_rate * 100) + '%' : 'unknown';
    const avgGain = tr.avg_gain_30d != null ? Math.round(tr.avg_gain_30d * 100) + '%' : 'unknown';
    filingLines.push(`- Track record: ${tr.past_buy_count} past buys, hit rate ${hitRatePct}, avg 30-day gain ${avgGain}`);
  } else if (!tr) {
    filingLines.push('- This insider has no track record of prior purchases in our database.');
  }

  // ── Cluster buy ──────────────────────────────────────────────────────────
  if (alert.is_cluster_buy) {
    const clusterSize = alert.cluster_size != null ? alert.cluster_size : 'multiple';
    filingLines.push(`- This is a cluster buy: ${clusterSize} insiders buying within a 7-day window.`);
  }

  // ── Direction-aware section guidance ─────────────────────────────────────
  let hookGuidance, contextGuidance;
  if (isBuy) {
    hookGuidance = 'Frame the conviction behind this buy. Why is the insider buying now? What makes the timing or size significant?';
    contextGuidance = 'Explain why this purchase may signal confidence in the company\'s direction. Note any timing signals (near earnings, after a price dip, first buy in years).';
  } else {
    hookGuidance = 'Frame the ambiguity: is this a tax plan or bearish signal? What context explains this sale? Avoid assuming bearish intent without clear evidence.';
    contextGuidance = 'Insiders sell for many reasons: tax planning, diversification, liquidity needs. Explain the most likely explanation for this sale based on available data.';
  }

  return `You are a financial analyst writing about an SEC insider ${directionLabel} trade for retail investors.

FILING DATA:
${filingLines.join('\n')}

INSTRUCTIONS:
Write ${wt.target} words covering these three sections:

**Hook**: ${hookGuidance}

**Context**: ${contextGuidance}

**What-to-Watch**: Provide a SPECIFIC catalyst with a date or price level. Vague statements are NOT acceptable. Examples:
  - "Earnings on April 15"
  - "FDA decision expected May"
  - "Next resistance: $52.30"
  - "Watch for Form 4 follow-on filings by other insiders before month-end"

WORD TARGET: Write approximately ${wt.target} words, do not exceed ${wt.max}.

CRITICAL: Do NOT use generic phrases like "insiders have information about their company" or "this is significant because insiders know more than the market". Be specific. Reference the actual numbers: ${sharesTraded != null ? sharesTraded + ' shares at $' + pricePerShare + ' per share for a total of $' + transactionValue : 'the transaction details'}. Name the insider's role. If cluster data is present, reference how many insiders are buying.

Return ONLY the analysis prose. No JSON, no markdown headers, no bullet points.`;
}

// ─── validateAnalysis (S06) ──────────────────────────────────────────────────

/**
 * Validates analysis text against 5 rules.
 * All rules are checked — no short-circuit on first failure.
 *
 * @param {string}  text           - Analysis text to validate
 * @param {number}  [score]        - Alert score; if undefined, Rule 1 is skipped
 * @param {string}  [direction]    - 'A' or 'D' (reserved for future use)
 * @param {boolean} [pctAvailable] - If true, Rule 4 requires a "%" in text
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAnalysis(text, score, direction, pctAvailable) {
  const errors = [];

  if (!text || typeof text !== 'string') {
    return { valid: false, errors: ['text is required'] };
  }

  const stripped = stripMarkdownFences(text);
  const words = stripped.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Rule 1 — Word count (skip if score undefined/null)
  if (score != null) {
    const { target, max } = getWordTarget(score);
    const minWords = Math.floor(target * 0.70);
    if (wordCount < minWords) {
      errors.push(`too short: ${wordCount} words (minimum ${minWords} for score ${score})`);
    } else if (wordCount > max) {
      errors.push(`too long: ${wordCount} words (maximum ${max} for score ${score})`);
    }
  }

  // Rule 2 — Banned phrases (case-insensitive)
  for (const phrase of BANNED_PHRASES) {
    if (stripped.toLowerCase().includes(phrase.toLowerCase())) {
      errors.push(`banned phrase detected: "${phrase}"`);
    }
  }

  // Rule 3 — Dollar amount present
  if (!/\$\d/.test(stripped)) {
    errors.push('missing dollar amount: text must contain at least one "$" followed by a digit');
  }

  // Rule 4 — Percentage present (conditional)
  if (pctAvailable) {
    if (!/%/.test(stripped)) {
      errors.push('missing percentage: prompt injected percentage data but no "%" found in text');
    }
  }

  // Rule 5 — Cautionary language
  const hasCautionary = CAUTIONARY_WORDS.some(w => stripped.toLowerCase().includes(w.toLowerCase()));
  if (!hasCautionary) {
    errors.push(`missing cautionary language: text must contain at least one of [${CAUTIONARY_WORDS.join(', ')}]`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Legacy prompt builder (used by analyze() for backward compat) ────────────

function _buildLegacyPrompt(filing) {
  const trackRecordSection = filing.track_record
    ? `Track record: ${filing.track_record.past_buy_count} past buys, ` +
      `${Math.round((filing.track_record.hit_rate || 0) * 100)}% hit rate, ` +
      `${Math.round((filing.track_record.avg_gain_30d || 0) * 100)}% avg 30-day gain.`
    : 'This insider has no track record of prior purchases in our database.';

  const clusterSection = filing.is_cluster_buy
    ? `This is a CLUSTER BUY: ${filing.cluster_size} insiders are buying within a 7-day window.`
    : '';

  return `You are a financial analyst writing about an SEC insider trading filing for retail investors.

FILING DATA:
- Company: ${filing.company_name} (${filing.ticker})
- Insider: ${filing.insider_name}, ${filing.insider_title} (${filing.insider_category})
- Transaction: ${filing.transaction_shares} shares at $${filing.price_per_share} per share, total value $${filing.total_value}
- Date: ${filing.transaction_date}
- Significance score: ${filing.significance_score}/10
- Score reasoning: ${filing.score_reasoning}
${clusterSection ? `- ${clusterSection}` : ''}
- ${trackRecordSection}

INSTRUCTIONS:
Write 2-3 paragraphs covering these three angles:
1. TRADE SIGNAL: Why would this insider make this specific trade now? What context explains the timing or size? Stick to what the data supports.
2. HISTORICAL CONTEXT: This insider's track record. How does this trade compare to past behavior? If no track record, acknowledge it neutrally.
3. RISK FACTORS: Why this trade might be less meaningful than it appears (scheduled 10b5-1 plan, routine compensation, sector headwinds, diversification).

TONE: Informative, not alarmist. Written for a retail investor who understands basic market concepts.

CRITICAL: Do NOT use generic phrases like "insiders have information about their company" or "this is significant because insiders know more than the market". Be specific. Reference the actual numbers: ${filing.transaction_shares} shares at $${filing.price_per_share} per share for a total of $${filing.total_value}. Name the insider's role. If track record data is available, cite it. If cluster data is present, reference how many insiders are buying.

Return ONLY the analysis prose. No JSON, no markdown headers, no bullet points.`;
}

// ─── analyze (legacy — kept for backward compat) ─────────────────────────────

/**
 * Legacy entry point. New callers should use runAnalyzeAlert().
 *
 * @param {object} filing - Enriched filing object from score-alert.js
 * @param {object} helpers - { deepSeekApiKey, kieaiApiKey, fetchFn }
 * @returns {Promise<string|null>} - Prose analysis string, or null on skip/failure
 */
async function analyze(filing, helpers) {
  if (filing.significance_score < 4) {
    return null;
  }

  const prompt = _buildLegacyPrompt(filing);
  const client = filing.significance_score >= 9
    ? createOpusClient(helpers.fetchFn, helpers.kieaiApiKey)
    : createDeepSeekClient(helpers.fetchFn, helpers.deepSeekApiKey);

  try {
    let result = await client.complete(null, prompt);
    let text = result.content;

    if (validateAnalysis(text).valid) {
      return text;
    }

    console.warn(
      `[analyze-alert] Validation failed for ${filing.dedup_key}, retrying. ` +
      `Response: ${(text || '').slice(0, 200)}`
    );
    result = await client.complete(null, prompt);
    text = result.content;

    if (validateAnalysis(text).valid) {
      return text;
    }

    console.warn(
      `[analyze-alert] Retry also failed validation for ${filing.dedup_key}. ` +
      `Response: ${(text || '').slice(0, 200)}`
    );
    return null;
  } catch (err) {
    console.warn(`[analyze-alert] Error for ${filing.dedup_key}: ${err.message}`);
    return null;
  }
}

// ─── runAnalyzeAlert (S05) ───────────────────────────────────────────────────

/**
 * Generates structured Hook/Context/What-to-Watch analysis for a scored alert.
 * Called by w4-market.json and w4-afterhours.json n8n workflow nodes.
 *
 * @param {object} alert  - Scored alert with { ticker, finalScore, direction, ... }
 * @param {object} deps   - { fetchFn, sleep, env, deepSeekApiKey }
 * @returns {Promise<{ analysisText, percentageDataAvailable, wordTarget, attemptCount } | null>}
 */
async function runAnalyzeAlert(alert, deps = {}) {
  const { fetchFn, sleep, env } = deps;

  const finalScore = alert.finalScore != null ? alert.finalScore : (alert.significance_score || 1);
  const direction = alert.direction || 'A';
  const ticker = alert.ticker;

  // Score gate
  if (finalScore < 4) return null;

  // Step 1: Word target
  const wordTarget = getWordTarget(finalScore);

  // Step 2: Finnhub market data
  const quote = await _getQuote(ticker, fetchFn, env);
  const currentPrice = quote ? quote.c : null;
  const pctChangeToday = quote ? quote.dp : null;

  // Step 3: Earnings date
  const earningsDateStr = await _getNextEarningsDate(ticker, fetchFn, env);
  let daysToEarnings = null;
  if (earningsDateStr) {
    const d = Math.ceil((Date.parse(earningsDateStr) - Date.now()) / 86400000);
    if (d > 0 && d <= 90) daysToEarnings = d;
  }

  // Step 4: Portfolio percentage
  const sharesTraded = alert.sharesTraded || alert.transaction_shares;
  const sharesOwnedAfter = alert.sharesOwnedAfter;
  let portfolioPct = null;
  if (sharesOwnedAfter && sharesOwnedAfter > 0 && sharesTraded) {
    portfolioPct = parseFloat(((sharesTraded / sharesOwnedAfter) * 100).toFixed(1));
  }

  // Step 5: percentageDataAvailable flag
  const percentageDataAvailable = pctChangeToday != null || portfolioPct != null;

  // Step 6: Build prompt
  const marketData = { currentPrice, pctChangeToday, daysToEarnings, portfolioPct };
  const promptString = buildAnalysisPrompt(alert, marketData, wordTarget);

  // Step 7: Route to Opus (score >= 9) or DeepSeek (score < 9)
  const client = finalScore >= 9
    ? createOpusClient(fetchFn, (env && env.KIEAI_API_KEY))
    : createDeepSeekClient(fetchFn, deps.deepSeekApiKey || (env && env.DEEPSEEK_API_KEY));

  const insiderName = alert.insiderName || alert.insider_name || 'The insider';
  const actionVerb = direction === 'A' ? 'bought' : 'sold';
  const rawPrice = alert.pricePerShare || alert.price_per_share;
  const priceStr = rawPrice != null ? `$${rawPrice}` : 'N/A';

  let text = null;
  let attemptCount = 0;

  try {
    // Attempt 1
    attemptCount++;
    let result = await client.complete(null, promptString, { temperature: 0.3 });
    text = result.content;

    const v1 = validateAnalysis(text, finalScore, direction, percentageDataAvailable);
    console.log(JSON.stringify({
      event: 'analysis_validation',
      attempt: 1,
      valid: v1.valid,
      errors: v1.errors,
      wordCount: (text || '').split(/\s+/).filter(Boolean).length,
      ticker,
      timestamp: new Date().toISOString(),
    }));

    if (v1.valid) {
      return { analysisText: text, percentageDataAvailable, wordTarget, attemptCount };
    }

    // Attempt 2 — append error list to prompt
    attemptCount++;
    if (sleep) await sleep(2000);
    const retryPrompt = promptString +
      `\n\nPrevious attempt failed validation: [${v1.errors.join(', ')}]. Fix these issues.`;
    result = await client.complete(null, retryPrompt, { temperature: 0.3 });
    text = result.content;

    const v2 = validateAnalysis(text, finalScore, direction, percentageDataAvailable);
    console.log(JSON.stringify({
      event: 'analysis_validation',
      attempt: 2,
      valid: v2.valid,
      errors: v2.errors,
      wordCount: (text || '').split(/\s+/).filter(Boolean).length,
      ticker,
      timestamp: new Date().toISOString(),
    }));

    if (v2.valid) {
      return { analysisText: text, percentageDataAvailable, wordTarget, attemptCount };
    }

    // Both attempts failed — use fallback template (no third validateAnalysis call)
    console.log(JSON.stringify({
      event: 'analysis_fallback_used',
      reason: 'double_validation_failure',
      attempt1Errors: v1.errors,
      attempt2Errors: v2.errors,
      ticker,
      timestamp: new Date().toISOString(),
    }));

    const sharesStr = sharesTraded != null ? sharesTraded + ' shares' : 'shares';
    text = `${insiderName} ${actionVerb} ${sharesStr} at ${priceStr}. Score: ${finalScore}/10.`;

  } catch (err) {
    console.warn(`[analyze-alert] runAnalyzeAlert error for ${ticker}: ${err.message}`);
    return null;
  }

  return { analysisText: text, percentageDataAvailable, wordTarget, attemptCount };
}

// ─── n8n Code node wrapper (commented) ──────────────────────────────────────
//
// Usage inside an n8n Code node (new):
//
//   const deps = {
//     deepSeekApiKey: $env.DEEPSEEK_API_KEY,
//     fetchFn: (url, opts) => fetch(url, opts),
//     env: { FINNHUB_API_KEY: $env.FINNHUB_API_KEY, ... },
//   };
//   for (const item of $input.all()) {
//     item.json.analysis = await runAnalyzeAlert(item.json, deps);
//   }
//   return $input.all();
// ─────────────────────────────────────────────────────────────────────────────

// ─── Exports (for testing) ───────────────────────────────────────────────────

module.exports = {
  buildAnalysisPrompt,
  validateAnalysis,
  analyze,
  getWordTarget,
  runAnalyzeAlert,
};
