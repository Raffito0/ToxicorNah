'use strict';

// ─── Prompt builder ─────────────────────────────────────────────────────────

function buildAnalysisPrompt(filing) {
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

// ─── Validation ─────────────────────────────────────────────────────────────

function validateAnalysis(text) {
  if (!text || typeof text !== 'string') return false;
  if (text.length < 50) return false;
  // Check for at least 2 paragraphs (separated by double newline or multiple newlines)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  return paragraphs.length >= 2;
}

// ─── API call ───────────────────────────────────────────────────────────────

async function callClaude(prompt, helpers) {
  const response = await helpers.fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': helpers.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1536,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = new Error(`Anthropic API error: ${response.status}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text;
  if (!text) {
    throw new Error('Anthropic API returned empty content');
  }
  return text;
}

// ─── Main function ──────────────────────────────────────────────────────────

/**
 * Generate AI prose analysis for a qualifying filing.
 *
 * @param {object} filing - Enriched filing object from score-alert.js
 * @param {object} helpers - { anthropicApiKey, fetchFn, _sleep }
 * @returns {Promise<string|null>} - Prose analysis string, or null on skip/failure
 */
async function analyze(filing, helpers) {
  // Score gate
  if (filing.significance_score < 4) {
    return null;
  }

  const prompt = buildAnalysisPrompt(filing);

  try {
    // First attempt
    let text = await callWithRetry(prompt, helpers);

    // Validate
    if (validateAnalysis(text)) {
      return text;
    }

    // One retry on validation failure
    console.warn(
      `[analyze-alert] Validation failed for ${filing.dedup_key}, retrying. ` +
      `Response: ${(text || '').slice(0, 200)}`
    );
    text = await callClaude(prompt, helpers);

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

/**
 * Call Claude with error-specific retry logic.
 * Handles 429 (rate limit) with 5s wait and 500/503 with immediate retry.
 */
async function callWithRetry(prompt, helpers) {
  try {
    return await callClaude(prompt, helpers);
  } catch (err) {
    if (err.status === 429) {
      await helpers._sleep(5000);
      return await callClaude(prompt, helpers);
    }
    if (err.status === 500 || err.status === 503) {
      await helpers._sleep(2000);
      return await callClaude(prompt, helpers);
    }
    throw err;
  }
}

// ─── n8n Code node wrapper (commented) ──────────────────────────────────────
//
// Usage inside an n8n Code node:
//
//   const helpers = {
//     anthropicApiKey: $env.ANTHROPIC_API_KEY,
//     fetchFn: (url, opts) => fetch(url, opts),
//     _sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
//   };
//   for (const item of $input.all()) {
//     item.json.ai_analysis = await analyze(item.json, helpers);
//   }
//   return $input.all();
// ─────────────────────────────────────────────────────────────────────────────

// ─── Exports (for testing) ───────────────────────────────────────────────────

module.exports = {
  buildAnalysisPrompt,
  validateAnalysis,
  callClaude,
  analyze,
};
