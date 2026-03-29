diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-report.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-report.js
index 06d8a23..5605524 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-report.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/generate-report.js
@@ -276,6 +276,237 @@ function escapeHTML(str) {
     .replace(/'/g, '&#39;');
 }
 
+// ---------------------------------------------------------------------------
+// Section 04 — Constants
+// ---------------------------------------------------------------------------
+
+var REPORT_SECTIONS = [
+  { id: 'company_overview',     wordTarget: 600 },
+  { id: 'insider_intelligence', wordTarget: 800 },
+  { id: 'financial_analysis',   wordTarget: 700 },
+  { id: 'valuation_analysis',   wordTarget: 600 },
+  { id: 'bull_case',            wordTarget: 500 },
+  { id: 'bear_case',            wordTarget: 500 },
+  { id: 'peer_comparison',      wordTarget: 600 },
+  { id: 'catalysts_timeline',   wordTarget: 400 },
+  { id: 'investment_thesis',    wordTarget: 400 },
+];
+
+var BEAR_CASE_SYSTEM_PROMPT =
+  'You are a skeptical short seller writing a bear case analysis.\n' +
+  'Your job is to argue AGAINST buying this stock.\n\n' +
+  'Requirements:\n' +
+  '- Identify 3 genuine fundamental risks (NOT "market uncertainty" or "macro headwinds")\n' +
+  '- Include 1 bear scenario with a specific downside price target\n' +
+  '- Reference at least one historical precedent where similar insider buying preceded a price decline\n' +
+  '- Be direct and adversarial - do not hedge or soften the case';
+
+var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
+var CLAUDE_MODEL = 'claude-opus-4-6';
+
+// ---------------------------------------------------------------------------
+// Section 04 — Per-section system prompts
+// ---------------------------------------------------------------------------
+
+function buildSectionSystemPrompt(sectionId) {
+  var prompts = {
+    company_overview:
+      'You are a professional equity research analyst. Write a company overview covering business description, ' +
+      'competitive position, revenue breakdown by segment, and key financial metrics. Be specific and data-driven.',
+
+    insider_intelligence:
+      'You are a professional equity research analyst specializing in insider transaction analysis. ' +
+      'Analyze insider buying/selling patterns, cluster detection, transaction sizes relative to compensation, ' +
+      'and historical patterns. This is the core section - be thorough.',
+
+    financial_analysis:
+      'You are a professional equity research analyst. Analyze revenue trends (YoY growth, CAGR), ' +
+      'margin progression (gross, operating, net), balance sheet health, and free cash flow generation. ' +
+      'Include specific figures and trends.',
+
+    valuation_analysis:
+      'You are a professional equity research analyst. Analyze current valuation using P/E, EV/EBITDA, ' +
+      'P/S, and P/FCF multiples versus historical averages and peers. Include a DCF summary. ' +
+      'State a fair value range explicitly.',
+
+    bull_case:
+      'You are a professional equity research analyst writing the bull case. Identify exactly 3 specific, ' +
+      'fundamental catalysts. For each, state the expected impact and a specific upside price target.',
+
+    peer_comparison:
+      'You are a professional equity research analyst. Compare the company against 3-5 direct peers on ' +
+      'revenue growth, margins, valuation multiples, return on equity, and insider activity.',
+
+    catalysts_timeline:
+      'You are a professional equity research analyst. List upcoming catalysts in chronological order: ' +
+      'earnings dates, product launches, regulatory decisions, contract renewals. For each, state direction and magnitude.',
+
+    investment_thesis:
+      'You are a professional equity research analyst writing the investment thesis. ' +
+      'Synthesize all prior sections into a directional recommendation (Buy / Hold / Watch / Avoid). ' +
+      'State a specific 12-month price target range. Be direct - no hedging language.',
+  };
+
+  return prompts[sectionId] || 'You are a professional equity research analyst. Write this section concisely and accurately.';
+}
+
+// ---------------------------------------------------------------------------
+// Section 04 — Internal helpers
+// ---------------------------------------------------------------------------
+
+function countWordsInText(text) {
+  return (text || '').split(/\s+/).filter(Boolean).length;
+}
+
+function buildPriorSectionsXml(completedSections) {
+  if (!completedSections || completedSections.length === 0) return '';
+  var inner = completedSections.map(function(s) {
+    return '<section name="' + s.id + '">\n' + s.text + '\n</section>';
+  }).join('\n');
+  return '<prior_sections>\n' + inner + '\n</prior_sections>\n\n';
+}
+
+async function claudeTextCall(systemPrompt, userPrompt, maxTokens, fetchFn) {
+  var res = await fetchFn(CLAUDE_API_URL, {
+    method: 'POST',
+    headers: {
+      'Content-Type': 'application/json',
+      'x-api-key': '',
+      'anthropic-version': '2023-06-01',
+    },
+    body: JSON.stringify({
+      model: CLAUDE_MODEL,
+      max_tokens: maxTokens || 1500,
+      system: systemPrompt,
+      messages: [{ role: 'user', content: userPrompt }],
+    }),
+  });
+  if (!res.ok) throw new Error('Claude API error: ' + res.status);
+  var data = await res.json();
+  return (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : '';
+}
+
+// ---------------------------------------------------------------------------
+// Section 04 — generateReportSection
+// ---------------------------------------------------------------------------
+
+async function generateReportSection(sectionId, wordTarget, completedSections, data, fetchFn) {
+  var systemPrompt = sectionId === 'bear_case'
+    ? BEAR_CASE_SYSTEM_PROMPT
+    : buildSectionSystemPrompt(sectionId);
+
+  var priorXml = buildPriorSectionsXml(completedSections);
+  var baseUserPrompt =
+    (priorXml || '') +
+    'Now write the ' + sectionId + ' section. Target: ' + wordTarget + ' words. ' +
+    (completedSections.length > 0 ? 'Do not repeat content from prior sections. ' : '') +
+    'Data available: ' + JSON.stringify(data || {}).slice(0, 500);
+
+  var low = Math.floor(wordTarget * 0.8);
+  var high = Math.ceil(wordTarget * 1.2);
+  var callMaxTokens = Math.ceil(wordTarget * 1.5 + 200);
+
+  // First attempt
+  var firstText = await claudeTextCall(systemPrompt, baseUserPrompt, callMaxTokens, fetchFn);
+  var firstWc = countWordsInText(firstText);
+
+  if (firstWc >= low && firstWc <= high) return firstText;
+
+  // Retry once with explicit guidance
+  var retryPrompt = baseUserPrompt +
+    '\n\nYour previous response was ' + firstWc + ' words. The target is ' + wordTarget + ' words. Rewrite to hit the target.';
+  return claudeTextCall(systemPrompt, retryPrompt, callMaxTokens, fetchFn);
+}
+
+// ---------------------------------------------------------------------------
+// Section 04 — reviewBearCaseAuthenticity
+// ---------------------------------------------------------------------------
+
+async function reviewBearCaseAuthenticity(bearCaseText, fetchFn) {
+  var systemPrompt =
+    'You are a senior analyst reviewing a bear case analysis for quality. ' +
+    'Score it 1-10. Score LOW (below 7) if: it uses generic risks like "market uncertainty", ' +
+    'it lacks a specific downside price target, it does not reference a historical precedent, ' +
+    'or it uses hedging language. ' +
+    'Respond with valid JSON only: {"score": <number>, "reasoning": "<string>"}';
+
+  var userPrompt = 'Review this bear case:\n\n' + bearCaseText;
+  var raw = await claudeTextCall(systemPrompt, userPrompt, 300, fetchFn);
+
+  // Strip markdown fences before JSON.parse
+  var cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
+  try {
+    var parsed = JSON.parse(cleaned);
+    return { score: Number(parsed.score) || 0, reasoning: parsed.reasoning || '' };
+  } catch (e) {
+    return { score: 5, reasoning: 'Parse failed' };
+  }
+}
+
+// ---------------------------------------------------------------------------
+// Section 04 — generateExecSummary
+// ---------------------------------------------------------------------------
+
+async function generateExecSummary(allSections, fetchFn) {
+  var systemPrompt =
+    'You are a senior equity research analyst writing an executive summary of a full investment report. ' +
+    'Lead with the key verdict (Buy / Hold / Watch / Avoid) and the top insider transaction signal ' +
+    '(who bought, how much, when). State the price target range from the investment_thesis section. ' +
+    'Summarize the bull and bear cases in 2-3 sentences each. Keep the total to 400-500 words.';
+
+  var priorXml = buildPriorSectionsXml(allSections);
+  var userPrompt =
+    priorXml +
+    'Now write the executive summary based on the above sections. 400-500 words. Lead with verdict and insider signal.';
+
+  return claudeTextCall(systemPrompt, userPrompt, 800, fetchFn);
+}
+
+// ---------------------------------------------------------------------------
+// Section 04 — Orchestration
+// ---------------------------------------------------------------------------
+
+async function generateReport(data, fetchFn) {
+  var completedSections = [];
+  var failedSections = 0;
+  var failedIds = [];
+
+  for (var i = 0; i < REPORT_SECTIONS.length; i++) {
+    var section = REPORT_SECTIONS[i];
+    try {
+      var text;
+      if (section.id === 'bear_case') {
+        text = await generateReportSection(section.id, section.wordTarget, completedSections, data, fetchFn);
+        var review = await reviewBearCaseAuthenticity(text, fetchFn);
+        if (review.score < 7) {
+          text = await generateReportSection(section.id, section.wordTarget, completedSections, data, fetchFn);
+        }
+      } else {
+        text = await generateReportSection(section.id, section.wordTarget, completedSections, data, fetchFn);
+      }
+      completedSections.push({ id: section.id, wordTarget: section.wordTarget, text: text });
+    } catch (err) {
+      failedSections++;
+      failedIds.push(section.id);
+      if (failedSections > 2) {
+        throw new Error(
+          'Report generation aborted: ' + failedSections + ' sections failed. Failed sections: ' + failedIds.join(', '),
+        );
+      }
+      console.warn('[generate-report] Section ' + section.id + ' failed: ' + err.message);
+    }
+  }
+
+  var execSummaryText = await generateExecSummary(completedSections, fetchFn);
+  completedSections.push({ id: 'exec_summary', wordTarget: 450, text: execSummaryText });
+
+  return completedSections;
+}
+
+// ---------------------------------------------------------------------------
+// Exports
+// ---------------------------------------------------------------------------
+
 module.exports = {
   parseWebhook: parseWebhook,
   determineReportParams: determineReportParams,
@@ -283,4 +514,13 @@ module.exports = {
   buildReportHTML: buildReportHTML,
   buildDeliveryEmail: buildDeliveryEmail,
   buildReportRecord: buildReportRecord,
+
+  // Section 04
+  generateReportSection: generateReportSection,
+  buildSectionSystemPrompt: buildSectionSystemPrompt,
+  reviewBearCaseAuthenticity: reviewBearCaseAuthenticity,
+  generateExecSummary: generateExecSummary,
+  generateReport: generateReport,
+  REPORT_SECTIONS: REPORT_SECTIONS,
+  BEAR_CASE_SYSTEM_PROMPT: BEAR_CASE_SYSTEM_PROMPT,
 };
diff --git a/ryan_cole/insiderbuying-site/n8n/tests/generate-report.test.js b/ryan_cole/insiderbuying-site/n8n/tests/generate-report.test.js
index 05792d4..5537bfe 100644
--- a/ryan_cole/insiderbuying-site/n8n/tests/generate-report.test.js
+++ b/ryan_cole/insiderbuying-site/n8n/tests/generate-report.test.js
@@ -8,6 +8,12 @@ const {
   buildReportHTML,
   buildDeliveryEmail,
   buildReportRecord,
+  generateReportSection,
+  buildSectionSystemPrompt,
+  reviewBearCaseAuthenticity,
+  generateExecSummary,
+  REPORT_SECTIONS,
+  BEAR_CASE_SYSTEM_PROMPT,
 } = require('../code/insiderbuying/generate-report.js');
 
 // ---------------------------------------------------------------------------
@@ -126,3 +132,236 @@ describe('buildReportRecord', () => {
     assert.ok(record.created_at);
   });
 });
+
+// ---------------------------------------------------------------------------
+// Section 04 — REPORT_SECTIONS constant + buildSectionSystemPrompt
+// ---------------------------------------------------------------------------
+
+describe('REPORT_SECTIONS', () => {
+  it('has exactly 9 sections (exec_summary not in array)', () => {
+    assert.equal(REPORT_SECTIONS.length, 9);
+  });
+
+  it('first section is company_overview', () => {
+    assert.equal(REPORT_SECTIONS[0].id, 'company_overview');
+  });
+
+  it('last section is investment_thesis', () => {
+    assert.equal(REPORT_SECTIONS[8].id, 'investment_thesis');
+  });
+
+  it('all sections have id and wordTarget', () => {
+    for (const s of REPORT_SECTIONS) {
+      assert.ok(s.id && typeof s.id === 'string');
+      assert.ok(s.wordTarget && typeof s.wordTarget === 'number');
+    }
+  });
+
+  it('insider_intelligence has wordTarget 800', () => {
+    const s = REPORT_SECTIONS.find((x) => x.id === 'insider_intelligence');
+    assert.equal(s.wordTarget, 800);
+  });
+});
+
+describe('buildSectionSystemPrompt', () => {
+  it('returns non-empty string for company_overview', () => {
+    const p = buildSectionSystemPrompt('company_overview');
+    assert.ok(typeof p === 'string' && p.length > 20);
+  });
+
+  it('returns non-empty string for each of the 9 section IDs', () => {
+    for (const s of REPORT_SECTIONS) {
+      if (s.id === 'bear_case') continue; // bear_case uses adversarial prompt, not this fn
+      const p = buildSectionSystemPrompt(s.id);
+      assert.ok(typeof p === 'string' && p.length > 20, `Empty prompt for ${s.id}`);
+    }
+  });
+});
+
+describe('BEAR_CASE_SYSTEM_PROMPT', () => {
+  it('contains "skeptical short seller"', () => {
+    assert.ok(BEAR_CASE_SYSTEM_PROMPT.toLowerCase().includes('skeptical short seller'));
+  });
+
+  it('instructs to include a downside price target', () => {
+    assert.ok(
+      BEAR_CASE_SYSTEM_PROMPT.toLowerCase().includes('price target') ||
+      BEAR_CASE_SYSTEM_PROMPT.toLowerCase().includes('downside'),
+    );
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Section 04 — generateReportSection
+// ---------------------------------------------------------------------------
+
+describe('generateReportSection', () => {
+  function makeOkFetch(text) {
+    return async () => ({
+      ok: true,
+      json: async () => ({ content: [{ text }] }),
+      text: async () => JSON.stringify({ content: [{ text }] }),
+    });
+  }
+
+  it('returns section text when word count is within ±20% of target', async () => {
+    // Build a ~600 word response
+    const text = 'word '.repeat(600).trim();
+    const result = await generateReportSection('company_overview', 600, [], {}, makeOkFetch(text));
+    assert.ok(typeof result === 'string');
+    assert.ok(result.length > 0);
+  });
+
+  it('retries once when response is 25% below target word count', async () => {
+    let callCount = 0;
+    // First call returns 300 words (50% of 600 target — below 20% tolerance floor of 480)
+    // Second call returns 600 words
+    const shortText = 'word '.repeat(300).trim();
+    const goodText = 'word '.repeat(600).trim();
+    const fetchFn = async () => {
+      callCount++;
+      const text = callCount === 1 ? shortText : goodText;
+      return { ok: true, json: async () => ({ content: [{ text }] }), text: async () => '' };
+    };
+    await generateReportSection('company_overview', 600, [], {}, fetchFn);
+    assert.equal(callCount, 2);
+  });
+
+  it('returns text anyway on 2nd attempt even if still below target', async () => {
+    const shortText = 'word '.repeat(200).trim();
+    const fetchFn = makeOkFetch(shortText);
+    const result = await generateReportSection('company_overview', 600, [], {}, fetchFn);
+    assert.ok(typeof result === 'string');
+    assert.ok(result.length > 0);
+  });
+
+  it('includes prior sections as XML context in user prompt', async () => {
+    let capturedBody = '';
+    const fetchFn = async (url, opts) => {
+      capturedBody = opts.body || '';
+      const text = 'word '.repeat(700).trim();
+      return { ok: true, json: async () => ({ content: [{ text }] }), text: async () => '' };
+    };
+    const prior = [{ id: 'company_overview', text: 'OVERVIEW TEXT HERE' }];
+    await generateReportSection('insider_intelligence', 800, prior, {}, fetchFn);
+    const parsed = JSON.parse(capturedBody);
+    const userContent = parsed.messages.find((m) => m.role === 'user')?.content || '';
+    assert.ok(userContent.includes('<section name="company_overview">'));
+    assert.ok(userContent.includes('OVERVIEW TEXT HERE'));
+  });
+
+  it('first section has no XML prior-sections block', async () => {
+    let capturedBody = '';
+    const fetchFn = async (url, opts) => {
+      capturedBody = opts.body || '';
+      const text = 'word '.repeat(600).trim();
+      return { ok: true, json: async () => ({ content: [{ text }] }), text: async () => '' };
+    };
+    await generateReportSection('company_overview', 600, [], {}, fetchFn);
+    const parsed = JSON.parse(capturedBody);
+    const userContent = parsed.messages.find((m) => m.role === 'user')?.content || '';
+    assert.ok(!userContent.includes('<prior_sections>'));
+  });
+
+  it('section text is a plain string (not JSON object)', async () => {
+    const text = 'word '.repeat(600).trim();
+    const result = await generateReportSection('company_overview', 600, [], {}, makeOkFetch(text));
+    assert.equal(typeof result, 'string');
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Section 04 — reviewBearCaseAuthenticity
+// ---------------------------------------------------------------------------
+
+describe('reviewBearCaseAuthenticity', () => {
+  it('returns score and reasoning from Claude response', async () => {
+    const fetchFn = async () => ({
+      ok: true,
+      json: async () => ({ content: [{ text: '{"score": 8, "reasoning": "Strong bear case"}' }] }),
+      text: async () => '',
+    });
+    const result = await reviewBearCaseAuthenticity('bear case text', fetchFn);
+    assert.equal(result.score, 8);
+    assert.equal(result.reasoning, 'Strong bear case');
+  });
+
+  it('score < 7 when Claude returns score 4', async () => {
+    const fetchFn = async () => ({
+      ok: true,
+      json: async () => ({ content: [{ text: '{"score": 4, "reasoning": "Too generic"}' }] }),
+      text: async () => '',
+    });
+    const result = await reviewBearCaseAuthenticity('bear case text', fetchFn);
+    assert.ok(result.score < 7);
+  });
+
+  it('strips markdown fences before JSON.parse', async () => {
+    const fetchFn = async () => ({
+      ok: true,
+      json: async () => ({ content: [{ text: '```json\n{"score":8,"reasoning":"good"}\n```' }] }),
+      text: async () => '',
+    });
+    const result = await reviewBearCaseAuthenticity('bear case text', fetchFn);
+    assert.equal(result.score, 8);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Section 04 — generateExecSummary
+// ---------------------------------------------------------------------------
+
+describe('generateExecSummary', () => {
+  const allSections = REPORT_SECTIONS.map((s) => ({
+    id: s.id,
+    text: `Content for ${s.id} section goes here with some details.`,
+  }));
+
+  it('returns a non-empty string', async () => {
+    const fetchFn = async () => ({
+      ok: true,
+      json: async () => ({ content: [{ text: 'Executive summary text here.' }] }),
+      text: async () => '',
+    });
+    const result = await generateExecSummary(allSections, fetchFn);
+    assert.ok(typeof result === 'string' && result.length > 0);
+  });
+
+  it('receives all 9 sections as XML context', async () => {
+    let capturedBody = '';
+    const fetchFn = async (url, opts) => {
+      capturedBody = opts.body || '';
+      return {
+        ok: true,
+        json: async () => ({ content: [{ text: 'summary' }] }),
+        text: async () => '',
+      };
+    };
+    await generateExecSummary(allSections, fetchFn);
+    const parsed = JSON.parse(capturedBody);
+    const userContent = parsed.messages.find((m) => m.role === 'user')?.content || '';
+    // All 9 sections should appear
+    for (const s of allSections) {
+      assert.ok(userContent.includes(`<section name="${s.id}">`), `Missing section ${s.id} in exec summary context`);
+    }
+  });
+
+  it('system prompt instructs to lead with verdict and insider signal', async () => {
+    let capturedBody = '';
+    const fetchFn = async (url, opts) => {
+      capturedBody = opts.body || '';
+      return { ok: true, json: async () => ({ content: [{ text: 'summary' }] }), text: async () => '' };
+    };
+    await generateExecSummary(allSections, fetchFn);
+    const parsed = JSON.parse(capturedBody);
+    const systemContent = (parsed.system || '').toLowerCase();
+    assert.ok(
+      systemContent.includes('verdict') || systemContent.includes('buy') || systemContent.includes('hold'),
+      'System prompt should mention verdict',
+    );
+    assert.ok(
+      systemContent.includes('insider') || systemContent.includes('signal'),
+      'System prompt should mention insider signal',
+    );
+  });
+});
