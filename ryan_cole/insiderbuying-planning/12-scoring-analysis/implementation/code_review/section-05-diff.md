warning: in the working copy of 'ryan_cole/insiderbuying-site/n8n/code/insiderbuying/analyze-alert.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'ryan_cole/insiderbuying-site/tests/insiderbuying/analyze-alert.test.js', LF will be replaced by CRLF the next time Git touches it
diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/analyze-alert.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/analyze-alert.js
index 52f4126..055a22a 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/analyze-alert.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/analyze-alert.js
@@ -2,9 +2,159 @@
 
 const { createDeepSeekClient } = require('./ai-client');
 
-// ─── Prompt builder ─────────────────────────────────────────────────────────
+// Try to import finnhub client (section 07). Stub if not yet available.
+let _getQuote = async () => null;
+let _getNextEarningsDate = async () => null;
+try {
+  const finnhub = require('./finnhub-client');
+  _getQuote = finnhub.getQuote;
+  _getNextEarningsDate = finnhub.getNextEarningsDate;
+} catch {
+  // finnhub-client.js not yet complete (section 07) — quote/earnings data unavailable
+}
+
+// ─── getWordTarget ────────────────────────────────────────────────────────────
+
+/**
+ * Maps a final alert score to a word budget for the analysis prompt.
+ * @param {number} score
+ * @returns {{ target: number, max: number }}
+ */
+function getWordTarget(score) {
+  if (score >= 8) return { target: 225, max: 300 };
+  if (score >= 6) return { target: 200, max: 275 };
+  if (score >= 4) return { target: 125, max: 175 };
+  return { target: 100, max: 150 };
+}
+
+// ─── buildAnalysisPrompt (S05) ───────────────────────────────────────────────
+
+/**
+ * Builds the direction-aware analysis prompt for DeepSeek.
+ *
+ * Supports both old (snake_case from analyze()) and new (camelCase) field naming
+ * so that existing tests using legacy field names continue to pass.
+ *
+ * @param {object} alert       - Alert object (new or old field format accepted)
+ * @param {object} marketData  - { currentPrice, pctChangeToday, daysToEarnings, portfolioPct }
+ * @param {object} wordTarget  - { target, max } from getWordTarget()
+ * @returns {string} Prompt string ready to send to DeepSeek
+ */
+function buildAnalysisPrompt(alert, marketData = {}, wordTarget = null) {
+  // Support both old (snake_case) and new (camelCase) field naming
+  const insiderName = alert.insiderName || alert.insider_name || 'Unknown insider';
+  const ticker = alert.ticker || 'Unknown';
+  const canonicalRole = alert.canonicalRole || alert.insider_title || 'insider';
+  const insiderCategory = alert.insiderCategory || alert.insider_category || '';
+  const sharesTraded = alert.sharesTraded != null ? alert.sharesTraded : alert.transaction_shares;
+  const pricePerShare = alert.pricePerShare != null ? alert.pricePerShare : alert.price_per_share;
+  const transactionValue = alert.transactionValue != null ? alert.transactionValue : alert.total_value;
+  const direction = alert.direction || 'A';
+  const finalScore = alert.finalScore != null ? alert.finalScore : (alert.significance_score != null ? alert.significance_score : 5);
+  const companyName = alert.companyName || alert.company_name || ticker;
+  const transactionDate = alert.transactionDate || alert.transaction_date || '';
+
+  const wt = wordTarget || getWordTarget(finalScore);
+
+  const isBuy = direction === 'A';
+  const directionLabel = isBuy ? 'BUY' : 'SELL';
+  const actionVerb = isBuy ? 'bought' : 'sold';
+
+  // ── Filing data lines ────────────────────────────────────────────────────
+  const filingLines = [
+    `- Company: ${companyName} (${ticker})`,
+    `- Insider: ${insiderName}, ${canonicalRole}${insiderCategory ? ` (${insiderCategory})` : ''}`,
+    `- Transaction: ${actionVerb} ${sharesTraded != null ? sharesTraded + ' shares' : 'shares'} at $${pricePerShare} per share, total value $${transactionValue}`,
+    `- Date: ${transactionDate}`,
+    `- Significance score: ${finalScore}/10`,
+  ];
+
+  // ── Market data (only include if available) ──────────────────────────────
+  if (marketData.currentPrice != null) {
+    const pctStr = marketData.pctChangeToday != null
+      ? `, ${marketData.pctChangeToday >= 0 ? 'up' : 'down'} ${Math.abs(marketData.pctChangeToday).toFixed(1)}% today`
+      : '';
+    filingLines.push(`- Current price: $${marketData.currentPrice}${pctStr}`);
+  }
+  if (marketData.daysToEarnings != null && marketData.daysToEarnings > 0 && marketData.daysToEarnings <= 90) {
+    filingLines.push(`- Earnings in ${marketData.daysToEarnings} days`);
+  }
+  if (marketData.portfolioPct != null) {
+    filingLines.push(`- This trade represents ${marketData.portfolioPct}% of their current holdings`);
+  }
+
+  // ── Track record ─────────────────────────────────────────────────────────
+  const tr = alert.track_record;
+  if (tr && tr.past_buy_count > 0) {
+    const hitRatePct = tr.hit_rate != null ? Math.round(tr.hit_rate * 100) + '%' : 'unknown';
+    const avgGain = tr.avg_gain_30d != null ? Math.round(tr.avg_gain_30d * 100) + '%' : 'unknown';
+    filingLines.push(`- Track record: ${tr.past_buy_count} past buys, hit rate ${hitRatePct}, avg 30-day gain ${avgGain}`);
+  } else if (!tr) {
+    filingLines.push('- This insider has no track record of prior purchases in our database.');
+  }
+
+  // ── Cluster buy ──────────────────────────────────────────────────────────
+  if (alert.is_cluster_buy) {
+    filingLines.push(`- This is a cluster buy: ${alert.cluster_size} insiders buying within a 7-day window.`);
+  }
+
+  // ── Direction-aware section guidance ─────────────────────────────────────
+  let hookGuidance, contextGuidance;
+  if (isBuy) {
+    hookGuidance = 'Frame the conviction behind this buy. Why is the insider buying now? What makes the timing or size significant?';
+    contextGuidance = 'Explain why this purchase may signal confidence in the company\'s direction. Note any timing signals (near earnings, after a price dip, first buy in years).';
+  } else {
+    hookGuidance = 'Frame the ambiguity: is this a tax plan or bearish signal? What context explains this sale? Avoid assuming bearish intent without clear evidence.';
+    contextGuidance = 'Insiders sell for many reasons: tax planning, diversification, liquidity needs. Explain the most likely explanation for this sale based on available data.';
+  }
+
+  return `You are a financial analyst writing about an SEC insider ${directionLabel} trade for retail investors.
+
+FILING DATA:
+${filingLines.join('\n')}
+
+INSTRUCTIONS:
+Write ${wt.target} words covering these three sections:
+
+**Hook**: ${hookGuidance}
+
+**Context**: ${contextGuidance}
+
+**What-to-Watch**: Provide a SPECIFIC catalyst with a date or price level. Vague statements are NOT acceptable. Examples:
+  - "Earnings on April 15"
+  - "FDA decision expected May"
+  - "Next resistance: $52.30"
+  - "Watch for Form 4 follow-on filings by other insiders before month-end"
+
+WORD TARGET: Write approximately ${wt.target} words, do not exceed ${wt.max}.
+
+CRITICAL: Do NOT use generic phrases like "insiders have information about their company" or "this is significant because insiders know more than the market". Be specific. Reference the actual numbers: ${sharesTraded != null ? sharesTraded + ' shares at $' + pricePerShare + ' per share for a total of $' + transactionValue : 'the transaction details'}. Name the insider's role. If cluster data is present, reference how many insiders are buying.
+
+Return ONLY the analysis prose. No JSON, no markdown headers, no bullet points.`;
+}
+
+// ─── validateAnalysis ────────────────────────────────────────────────────────
+
+/**
+ * Basic structural validation of analysis text.
+ * Section 06 extends this with additional rules (word count, banned phrases, etc.)
+ *
+ * @param {string} text
+ * @param {number} [score]         - Alert score (used by S06 extension)
+ * @param {string} [direction]     - 'A' or 'D' (used by S06 extension)
+ * @param {boolean} [pctAvailable] - Whether percentage data was available (S06)
+ * @returns {boolean}
+ */
+function validateAnalysis(text, score, direction, pctAvailable) {
+  if (!text || typeof text !== 'string') return false;
+  if (text.length < 50) return false;
+  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
+  return paragraphs.length >= 2;
+}
+
+// ─── Legacy prompt builder (used by analyze() for backward compat) ────────────
 
-function buildAnalysisPrompt(filing) {
+function _buildLegacyPrompt(filing) {
   const trackRecordSection = filing.track_record
     ? `Track record: ${filing.track_record.past_buy_count} past buys, ` +
       `${Math.round((filing.track_record.hit_rate || 0) * 100)}% hit rate, ` +
@@ -40,45 +190,31 @@ CRITICAL: Do NOT use generic phrases like "insiders have information about their
 Return ONLY the analysis prose. No JSON, no markdown headers, no bullet points.`;
 }
 
-// ─── Validation ─────────────────────────────────────────────────────────────
-
-function validateAnalysis(text) {
-  if (!text || typeof text !== 'string') return false;
-  if (text.length < 50) return false;
-  // Check for at least 2 paragraphs (separated by double newline or multiple newlines)
-  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
-  return paragraphs.length >= 2;
-}
-
-// ─── Main function ──────────────────────────────────────────────────────────
+// ─── analyze (legacy — kept for backward compat) ─────────────────────────────
 
 /**
- * Generate AI prose analysis for a qualifying filing.
+ * Legacy entry point. New callers should use runAnalyzeAlert().
  *
  * @param {object} filing - Enriched filing object from score-alert.js
  * @param {object} helpers - { deepSeekApiKey, fetchFn }
  * @returns {Promise<string|null>} - Prose analysis string, or null on skip/failure
  */
 async function analyze(filing, helpers) {
-  // Score gate
   if (filing.significance_score < 4) {
     return null;
   }
 
-  const prompt = buildAnalysisPrompt(filing);
+  const prompt = _buildLegacyPrompt(filing);
   const client = createDeepSeekClient(helpers.fetchFn, helpers.deepSeekApiKey);
 
   try {
-    // First attempt
     let result = await client.complete(null, prompt);
     let text = result.content;
 
-    // Validate
     if (validateAnalysis(text)) {
       return text;
     }
 
-    // One retry on validation failure
     console.warn(
       `[analyze-alert] Validation failed for ${filing.dedup_key}, retrying. ` +
       `Response: ${(text || '').slice(0, 200)}`
@@ -101,16 +237,104 @@ async function analyze(filing, helpers) {
   }
 }
 
+// ─── runAnalyzeAlert (S05) ───────────────────────────────────────────────────
+
+/**
+ * Generates structured Hook/Context/What-to-Watch analysis for a scored alert.
+ * Called by w4-market.json and w4-afterhours.json n8n workflow nodes.
+ *
+ * @param {object} alert  - Scored alert with { ticker, finalScore, direction, ... }
+ * @param {object} deps   - { fetchFn, sleep, env, deepSeekApiKey }
+ * @returns {Promise<{ analysisText, percentageDataAvailable, wordTarget, attemptCount } | null>}
+ */
+async function runAnalyzeAlert(alert, deps = {}) {
+  const { fetchFn, sleep, env } = deps;
+
+  const finalScore = alert.finalScore != null ? alert.finalScore : (alert.significance_score || 1);
+  const direction = alert.direction || 'A';
+  const ticker = alert.ticker;
+
+  // Score gate
+  if (finalScore < 4) return null;
+
+  // Step 1: Word target
+  const wordTarget = getWordTarget(finalScore);
+
+  // Step 2: Finnhub market data
+  const quote = await _getQuote(ticker, fetchFn, env);
+  const currentPrice = quote ? quote.c : null;
+  const pctChangeToday = quote ? quote.dp : null;
+
+  // Step 3: Earnings date
+  const earningsDateStr = await _getNextEarningsDate(ticker, fetchFn, env);
+  let daysToEarnings = null;
+  if (earningsDateStr) {
+    const d = Math.ceil((Date.parse(earningsDateStr) - Date.now()) / 86400000);
+    if (d > 0 && d <= 90) daysToEarnings = d;
+  }
+
+  // Step 4: Portfolio percentage
+  const sharesTraded = alert.sharesTraded || alert.transaction_shares;
+  const sharesOwnedAfter = alert.sharesOwnedAfter;
+  let portfolioPct = null;
+  if (sharesOwnedAfter && sharesOwnedAfter > 0 && sharesTraded) {
+    portfolioPct = parseFloat(((sharesTraded / sharesOwnedAfter) * 100).toFixed(1));
+  }
+
+  // Step 5: percentageDataAvailable flag
+  const percentageDataAvailable = pctChangeToday != null || portfolioPct != null;
+
+  // Step 6: Build prompt
+  const marketData = { currentPrice, pctChangeToday, daysToEarnings, portfolioPct };
+  const promptString = buildAnalysisPrompt(alert, marketData, wordTarget);
+
+  // Step 7: Call DeepSeek
+  const apiKey = deps.deepSeekApiKey || (env && env.DEEPSEEK_API_KEY);
+  const client = createDeepSeekClient(fetchFn, apiKey);
+
+  let text = null;
+  let attemptCount = 0;
+
+  try {
+    attemptCount++;
+    let result = await client.complete(null, promptString, { temperature: 0.3 });
+    text = result.content;
+
+    // Step 8: Validate (S06 extends this to use score/direction/pctAvailable)
+    if (!validateAnalysis(text, finalScore, direction, percentageDataAvailable)) {
+      attemptCount++;
+      if (sleep) await sleep(2000);
+      result = await client.complete(null, promptString, { temperature: 0.3 });
+      text = result.content;
+
+      if (!validateAnalysis(text, finalScore, direction, percentageDataAvailable)) {
+        // Minimal fallback template (S06 provides richer fallback)
+        const insiderName = alert.insiderName || alert.insider_name || 'The insider';
+        const actionVerb = direction === 'A' ? 'bought' : 'sold';
+        const sharesStr = sharesTraded != null ? sharesTraded + ' shares' : 'shares';
+        const priceStr = alert.pricePerShare || alert.price_per_share || '';
+        text = `${insiderName} ${actionVerb} ${sharesStr} at $${priceStr}. Score: ${finalScore}/10.`;
+      }
+    }
+  } catch (err) {
+    console.warn(`[analyze-alert] runAnalyzeAlert error for ${ticker}: ${err.message}`);
+    return null;
+  }
+
+  return { analysisText: text, percentageDataAvailable, wordTarget, attemptCount };
+}
+
 // ─── n8n Code node wrapper (commented) ──────────────────────────────────────
 //
-// Usage inside an n8n Code node:
+// Usage inside an n8n Code node (new):
 //
-//   const helpers = {
+//   const deps = {
 //     deepSeekApiKey: $env.DEEPSEEK_API_KEY,
 //     fetchFn: (url, opts) => fetch(url, opts),
+//     env: { FINNHUB_API_KEY: $env.FINNHUB_API_KEY, ... },
 //   };
 //   for (const item of $input.all()) {
-//     item.json.ai_analysis = await analyze(item.json, helpers);
+//     item.json.analysis = await runAnalyzeAlert(item.json, deps);
 //   }
 //   return $input.all();
 // ─────────────────────────────────────────────────────────────────────────────
@@ -121,4 +345,6 @@ module.exports = {
   buildAnalysisPrompt,
   validateAnalysis,
   analyze,
+  getWordTarget,
+  runAnalyzeAlert,
 };
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/analyze-alert.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/analyze-alert.test.js
index 6cabad3..5236bff 100644
--- a/ryan_cole/insiderbuying-site/tests/insiderbuying/analyze-alert.test.js
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/analyze-alert.test.js
@@ -13,6 +13,8 @@ const {
   buildAnalysisPrompt,
   validateAnalysis,
   analyze,
+  getWordTarget,
+  runAnalyzeAlert,
 } = require('../../n8n/code/insiderbuying/analyze-alert');
 
 // ─── helpers ────────────────────────────────────────────────────────────────
@@ -302,3 +304,195 @@ describe('analyze-alert', () => {
     expect(validateAnalysis(undefined)).toBe(false);
   });
 });
+
+// ─── Structured Analysis (Section 05) ────────────────────────────────────────
+
+describe('Structured Analysis (Section 05)', () => {
+  const SAMPLE_ALERT_S05 = {
+    ticker: 'NVDA',
+    companyName: 'NVIDIA Corporation',
+    insiderName: 'Jensen Huang',
+    canonicalRole: 'Chief Executive Officer',
+    insiderCategory: 'C-Suite',
+    sharesTraded: 10000,
+    pricePerShare: 490.00,
+    transactionValue: 4900000,
+    transactionDate: '2026-03-15',
+    finalScore: 8,
+    direction: 'A',
+    sharesOwnedAfter: null,
+  };
+
+  beforeEach(() => {
+    jest.clearAllMocks();
+  });
+
+  // ── getWordTarget ──────────────────────────────────────────────────────────
+
+  describe('getWordTarget', () => {
+    test('score 9 → { target: 225, max: 300 }', () => {
+      expect(getWordTarget(9)).toEqual({ target: 225, max: 300 });
+    });
+
+    test('score 8 → { target: 225, max: 300 } (lower boundary)', () => {
+      expect(getWordTarget(8)).toEqual({ target: 225, max: 300 });
+    });
+
+    test('score 7 → { target: 200, max: 275 }', () => {
+      expect(getWordTarget(7)).toEqual({ target: 200, max: 275 });
+    });
+
+    test('score 6 → { target: 200, max: 275 } (lower boundary)', () => {
+      expect(getWordTarget(6)).toEqual({ target: 200, max: 275 });
+    });
+
+    test('score 5 → { target: 125, max: 175 }', () => {
+      expect(getWordTarget(5)).toEqual({ target: 125, max: 175 });
+    });
+
+    test('score 4 → { target: 125, max: 175 } (lower boundary)', () => {
+      expect(getWordTarget(4)).toEqual({ target: 125, max: 175 });
+    });
+
+    test('score 2 → { target: 100, max: 150 }', () => {
+      expect(getWordTarget(2)).toEqual({ target: 100, max: 150 });
+    });
+
+    test('undefined score → default { target: 100, max: 150 }', () => {
+      expect(getWordTarget(undefined)).toEqual({ target: 100, max: 150 });
+    });
+  });
+
+  // ── direction-aware prompt ─────────────────────────────────────────────────
+
+  describe('direction-aware prompt', () => {
+    test('direction A → prompt contains BUY label and "bought" verb', () => {
+      const alert = { ...SAMPLE_ALERT_S05, direction: 'A' };
+      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
+      expect(prompt).toContain('BUY');
+      expect(prompt).toContain('bought');
+    });
+
+    test('direction A → prompt does not contain sell ambiguity framing', () => {
+      const alert = { ...SAMPLE_ALERT_S05, direction: 'A' };
+      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
+      expect(prompt).not.toContain('tax plan or bearish signal');
+    });
+
+    test('direction D → prompt contains SELL label and "sold" verb', () => {
+      const alert = { ...SAMPLE_ALERT_S05, direction: 'D' };
+      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
+      expect(prompt).toContain('SELL');
+      expect(prompt).toContain('sold');
+    });
+
+    test('direction D → sell prompt includes "tax plan or bearish signal"', () => {
+      const alert = { ...SAMPLE_ALERT_S05, direction: 'D' };
+      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
+      expect(prompt).toContain('tax plan or bearish signal');
+    });
+
+    test('direction D → prompt does not contain buy conviction framing', () => {
+      const alert = { ...SAMPLE_ALERT_S05, direction: 'D' };
+      const prompt = buildAnalysisPrompt(alert, {}, getWordTarget(8));
+      expect(prompt).not.toContain('conviction behind this buy');
+    });
+  });
+
+  // ── data injection ─────────────────────────────────────────────────────────
+
+  describe('data injection', () => {
+    test('current price injected into prompt when Finnhub quote is available', () => {
+      const marketData = { currentPrice: 52.30, pctChangeToday: 3.1 };
+      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
+      expect(prompt).toContain('52.3');
+      expect(prompt).toContain('3.1');
+    });
+
+    test('price fields omitted from prompt when currentPrice is null', () => {
+      const marketData = { currentPrice: null, pctChangeToday: null };
+      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
+      expect(prompt).not.toContain('Current price');
+    });
+
+    test('portfolio pct injected when portfolioPct is provided', () => {
+      const marketData = { portfolioPct: 12.4 };
+      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
+      expect(prompt).toContain('12.4');
+      expect(prompt).toContain('current holdings');
+    });
+
+    test('portfolio pct omitted when portfolioPct is null', () => {
+      const marketData = { portfolioPct: null };
+      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
+      expect(prompt).not.toContain('current holdings');
+    });
+
+    test('"Earnings in X days" present when daysToEarnings is within range', () => {
+      const marketData = { daysToEarnings: 42 };
+      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
+      expect(prompt).toContain('42');
+      expect(prompt).toContain('Earnings in');
+    });
+
+    test('earnings sentence omitted when daysToEarnings is null', () => {
+      const marketData = { daysToEarnings: null };
+      const prompt = buildAnalysisPrompt(SAMPLE_ALERT_S05, marketData);
+      expect(prompt).not.toContain('Earnings in');
+    });
+  });
+
+  // ── runAnalyzeAlert integration ────────────────────────────────────────────
+
+  describe('runAnalyzeAlert', () => {
+    test('returns null when finalScore < 4', async () => {
+      const alert = { ...SAMPLE_ALERT_S05, finalScore: 3 };
+      const result = await runAnalyzeAlert(alert, {
+        fetchFn: jest.fn(),
+        sleep: () => Promise.resolve(),
+        env: {},
+      });
+      expect(result).toBeNull();
+    });
+
+    test('returns object with required keys when score >= 4', async () => {
+      const mockClient = makeMockClient(GOOD_ANALYSIS);
+      createDeepSeekClient.mockReturnValue(mockClient);
+      const alert = { ...SAMPLE_ALERT_S05, finalScore: 7 };
+      const result = await runAnalyzeAlert(alert, {
+        fetchFn: jest.fn(),
+        sleep: () => Promise.resolve(),
+        env: { DEEPSEEK_API_KEY: 'test-key' },
+      });
+      expect(result).not.toBeNull();
+      expect(result).toHaveProperty('analysisText');
+      expect(result).toHaveProperty('wordTarget');
+      expect(result).toHaveProperty('percentageDataAvailable');
+      expect(result).toHaveProperty('attemptCount');
+    });
+
+    test('percentageDataAvailable is false when Finnhub data and sharesOwnedAfter are absent', async () => {
+      const mockClient = makeMockClient(GOOD_ANALYSIS);
+      createDeepSeekClient.mockReturnValue(mockClient);
+      const alert = { ...SAMPLE_ALERT_S05, finalScore: 7, sharesOwnedAfter: null };
+      const result = await runAnalyzeAlert(alert, {
+        fetchFn: jest.fn(),
+        sleep: () => Promise.resolve(),
+        env: { DEEPSEEK_API_KEY: 'test-key' },
+      });
+      expect(result.percentageDataAvailable).toBe(false);
+    });
+
+    test('percentageDataAvailable is true when sharesOwnedAfter is provided', async () => {
+      const mockClient = makeMockClient(GOOD_ANALYSIS);
+      createDeepSeekClient.mockReturnValue(mockClient);
+      const alert = { ...SAMPLE_ALERT_S05, finalScore: 7, sharesOwnedAfter: 200000 };
+      const result = await runAnalyzeAlert(alert, {
+        fetchFn: jest.fn(),
+        sleep: () => Promise.resolve(),
+        env: { DEEPSEEK_API_KEY: 'test-key' },
+      });
+      expect(result.percentageDataAvailable).toBe(true);
+    });
+  });
+});
