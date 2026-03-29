'use strict';

const { createDeepSeekClient } = require('./ai-client');

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

// ─── validateAnalysis ────────────────────────────────────────────────────────

/**
 * Basic structural validation of analysis text.
 * Section 06 extends this with additional rules (word count, banned phrases, etc.)
 *
 * @param {string} text
 * @param {number} [score]         - Alert score (used by S06 extension)
 * @param {string} [direction]     - 'A' or 'D' (used by S06 extension)
 * @param {boolean} [pctAvailable] - Whether percentage data was available (S06)
 * @returns {boolean}
 */
function validateAnalysis(text, score, direction, pctAvailable) {
  if (!text || typeof text !== 'string') return false;
  if (text.length < 50) return false;
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  return paragraphs.length >= 2;
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
 * @param {object} helpers - { deepSeekApiKey, fetchFn }
 * @returns {Promise<string|null>} - Prose analysis string, or null on skip/failure
 */
async function analyze(filing, helpers) {
  if (filing.significance_score < 4) {
    return null;
  }

  const prompt = _buildLegacyPrompt(filing);
  const client = createDeepSeekClient(helpers.fetchFn, helpers.deepSeekApiKey);

  try {
    let result = await client.complete(null, prompt);
    let text = result.content;

    if (validateAnalysis(text)) {
      return text;
    }

    console.warn(
      `[analyze-alert] Validation failed for ${filing.dedup_key}, retrying. ` +
      `Response: ${(text || '').slice(0, 200)}`
    );
    result = await client.complete(null, prompt);
    text = result.content;

    if (validateAnalysis(text)) {
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

  // Step 7: Call DeepSeek
  const apiKey = deps.deepSeekApiKey || (env && env.DEEPSEEK_API_KEY);
  const client = createDeepSeekClient(fetchFn, apiKey);

  let text = null;
  let attemptCount = 0;

  try {
    attemptCount++;
    let result = await client.complete(null, promptString, { temperature: 0.3 });
    text = result.content;

    // Step 8: Validate (S06 extends this to use score/direction/pctAvailable)
    if (!validateAnalysis(text, finalScore, direction, percentageDataAvailable)) {
      attemptCount++;
      if (sleep) await sleep(2000);
      result = await client.complete(null, promptString, { temperature: 0.3 });
      text = result.content;

      if (!validateAnalysis(text, finalScore, direction, percentageDataAvailable)) {
        // Minimal fallback template (S06 provides richer fallback)
        const insiderName = alert.insiderName || alert.insider_name || 'The insider';
        const actionVerb = direction === 'A' ? 'bought' : 'sold';
        const sharesStr = sharesTraded != null ? sharesTraded + ' shares' : 'shares';
        const priceStr = alert.pricePerShare || alert.price_per_share || '';
        text = `${insiderName} ${actionVerb} ${sharesStr} at $${priceStr}. Score: ${finalScore}/10.`;
      }
    }
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
