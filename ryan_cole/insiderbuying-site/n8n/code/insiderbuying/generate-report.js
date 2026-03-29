'use strict';
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// --------------------------------------------------------------------------
// W15 Premium Report workflow code
// --------------------------------------------------------------------------

/**
 * Parse Stripe checkout.session.completed webhook event.
 * Extracts user_id, report_type, payment_id, customer_email.
 * @param {object} event - Stripe webhook event object
 * @returns {object} { userId, reportType, paymentId, customerEmail }
 */
function parseWebhook(event) {
  var session = event.data && event.data.object ? event.data.object : event;

  var metadata = session.metadata || {};
  var userId = metadata.user_id || metadata.userId || null;
  var paymentId = session.payment_intent || session.id || null;
  var customerEmail = session.customer_email || session.customer_details && session.customer_details.email || null;

  // Report type comes from product metadata or line items metadata
  var reportType = metadata.report_type || metadata.reportType || 'deep-dive';

  // Validate report type
  var validTypes = ['deep-dive', 'sector', 'watchlist'];
  if (validTypes.indexOf(reportType) === -1) {
    reportType = 'deep-dive';
  }

  return {
    userId: userId,
    reportType: reportType,
    paymentId: paymentId,
    customerEmail: customerEmail,
    metadata: metadata,
  };
}

/**
 * Determine report parameters based on type and metadata.
 * @param {string} reportType - 'deep-dive' | 'sector' | 'watchlist'
 * @param {object} metadata - Stripe session metadata
 * @returns {object} { tickers, sector, reportTitle }
 */
function determineReportParams(reportType, metadata) {
  var tickers = [];
  var sector = '';
  var reportTitle = '';

  if (reportType === 'deep-dive') {
    // Deep dive into specific tickers
    var tickerStr = metadata.tickers || metadata.ticker || '';
    tickers = tickerStr.split(',').map(function(t) { return t.trim().toUpperCase(); }).filter(Boolean);
    if (tickers.length === 0) tickers = ['AAPL']; // fallback
    reportTitle = 'Insider Intelligence Deep Dive: ' + tickers.join(', ');

  } else if (reportType === 'sector') {
    // Sector-wide analysis
    sector = metadata.sector || 'Technology';
    reportTitle = 'Insider Intelligence Sector Report: ' + sector;

  } else if (reportType === 'watchlist') {
    // User's watchlist tickers
    var wlStr = metadata.watchlist_tickers || metadata.tickers || '';
    tickers = wlStr.split(',').map(function(t) { return t.trim().toUpperCase(); }).filter(Boolean);
    reportTitle = 'Insider Intelligence Watchlist Report';
    if (tickers.length > 0) {
      reportTitle += ': ' + tickers.slice(0, 5).join(', ');
      if (tickers.length > 5) reportTitle += ' +' + (tickers.length - 5) + ' more';
    }
  }

  return {
    tickers: tickers,
    sector: sector,
    reportTitle: reportTitle,
  };
}

/**
 * Build Claude Sonnet prompt for a premium 12K-token report.
 * @param {object} data - Aggregated insider trading data for the tickers/sector
 *   { transactions: [], statistics: {}, sectorBreakdown: [], topPerformers: [] }
 * @param {string} reportType - 'deep-dive' | 'sector' | 'watchlist'
 * @returns {string} Prompt for Claude Sonnet
 */
function buildReportPrompt(data, reportType) {
  var stats = data.statistics || {};
  var transactions = data.transactions || [];
  var topPerformers = data.topPerformers || [];

  // Build transaction summary
  var txSummary = transactions.slice(0, 20).map(function(t) {
    return '- ' + t.ticker + ': ' + t.insiderName + ' (' + t.insiderTitle + ') bought $'
      + Math.round((t.value || 0) / 1000) + 'K on ' + t.filingDate
      + ' | 30d return: ' + (t.return30d || 'N/A') + '%';
  }).join('\n');

  var topLines = topPerformers.map(function(t, i) {
    return (i + 1) + '. ' + t.ticker + ' - ' + t.insiderName + ' ($' + Math.round(t.value / 1000) + 'K) -> ' + t.return30d + '% 30d return';
  }).join('\n');

  var typeInstruction = '';
  if (reportType === 'deep-dive') {
    typeInstruction = 'This is a DEEP DIVE report. Go extremely deep on each ticker. Include:\n'
      + '- Full insider transaction history analysis (patterns, timing, sizing)\n'
      + '- Comparison to company financial performance and earnings\n'
      + '- Historical context of insider buying at this company\n'
      + '- Technical price level analysis around insider purchase dates\n';
  } else if (reportType === 'sector') {
    typeInstruction = 'This is a SECTOR report. Analyze insider buying trends across the entire sector:\n'
      + '- Which sub-industries have the most insider conviction\n'
      + '- Cross-company patterns (are multiple competitors buying?)\n'
      + '- Sector rotation signals from insider activity\n'
      + '- Comparison to sector ETF performance\n';
  } else {
    typeInstruction = 'This is a WATCHLIST report. For each ticker the user is tracking:\n'
      + '- Recent insider activity summary and significance\n'
      + '- Whether current insider behavior is bullish, neutral, or bearish\n'
      + '- Key levels and dates to watch\n'
      + '- Comparison to peer insider activity\n';
  }

  var prompt = 'You are a senior financial analyst at InsiderBuying.ai writing a premium research report.\n\n'
    + 'REPORT TYPE: ' + reportType.toUpperCase() + '\n\n'
    + typeInstruction + '\n'
    + 'DATA SUMMARY:\n'
    + '- Transactions analyzed: ' + stats.count + '\n'
    + '- Average 30-day return: ' + (stats.avgReturn30d || 0) + '%\n'
    + '- Average 60-day return: ' + (stats.avgReturn60d || 0) + '%\n'
    + '- Average 90-day return: ' + (stats.avgReturn90d || 0) + '%\n'
    + '- Hit rate (30d): ' + (stats.hitRate30d || 0) + '%\n\n'
    + 'RECENT TRANSACTIONS:\n' + txSummary + '\n\n'
    + 'TOP PERFORMERS:\n' + topLines + '\n\n'
    + 'REPORT STRUCTURE (follow exactly):\n'
    + '1. Executive Summary (4-6 sentences, the most important takeaways)\n'
    + '2. Key Findings (5-7 numbered findings with data support)\n'
    + '3. Detailed Analysis (per-ticker or per-subsector deep dive, 800-1500 words each)\n'
    + '4. Risk Assessment (what could go wrong, bearish scenarios, data limitations)\n'
    + '5. Conclusion & Recommendations (actionable next steps for the investor)\n\n'
    + 'RULES:\n'
    + '- Write 3000-5000 words total (this is a premium report, be thorough)\n'
    + '- Use specific dollar amounts, dates, and percentages from the data\n'
    + '- Never fabricate transactions or numbers not in the data\n'
    + '- Professional tone, suitable for serious investors\n'
    + '- Include a disclaimer that this is not personalized investment advice\n'
    + '- Reference S&P 500 and relevant benchmarks for context\n'
    + '- Use markdown formatting (##, ###, bold, bullet points)\n';

  return prompt;
}

/**
 * Populate premium report HTML template with content.
 * Polymorphic: accepts either legacy (content, reportTitle, date) or new (sections, charts, config).
 */
function buildReportHTML(sectionsOrContent, chartsOrTitle, configOrDate) {
  if (typeof sectionsOrContent === 'string') {
    return _buildReportHTMLLegacy(sectionsOrContent, chartsOrTitle, configOrDate);
  }
  return _buildReportHTMLFromSections(sectionsOrContent, chartsOrTitle, configOrDate);
}

/**
 * Legacy HTML builder — used by old tests and simple integrations.
 * @param {string} content - markdown content
 * @param {string} reportTitle
 * @param {string} date
 * @returns {string}
 */
function _buildReportHTMLLegacy(content, reportTitle, date) {
  var htmlContent = content
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^- (.*$)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hulo])/gm, '');

  return '<!DOCTYPE html>'
    + '<html><head><meta charset="utf-8">'
    + '<style>'
    + 'body { font-family: Georgia, "Times New Roman", serif; color: #1a1a2e; line-height: 1.7; margin: 0; padding: 0; }'
    + '.header { background: linear-gradient(135deg, #0a1628 0%, #1a2744 100%); color: white; padding: 40px 50px; }'
    + '.header h1 { font-size: 28px; margin: 0 0 8px 0; font-weight: 700; }'
    + '.header .meta { font-size: 13px; color: #94a3b8; }'
    + '.content { padding: 30px 50px; }'
    + 'h2 { color: #0a1628; font-size: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-top: 30px; }'
    + 'h3 { color: #334155; font-size: 16px; margin-top: 24px; }'
    + 'p { margin: 12px 0; }'
    + 'ul { margin: 8px 0; padding-left: 24px; }'
    + 'li { margin: 4px 0; }'
    + 'strong { color: #0a1628; }'
    + '.disclaimer { background: #f8fafc; border-left: 3px solid #94a3b8; padding: 12px 16px; font-size: 11px; color: #64748b; margin-top: 40px; }'
    + '.footer { text-align: center; font-size: 11px; color: #94a3b8; padding: 20px; border-top: 1px solid #e2e8f0; margin-top: 40px; }'
    + '@media print { .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'
    + '</style></head><body>'
    + '<div class="header">'
    + '<h1>' + escapeHTML(reportTitle) + '</h1>'
    + '<div class="meta">InsiderBuying.ai Premium Report | ' + escapeHTML(date) + '</div>'
    + '</div>'
    + '<div class="content">'
    + htmlContent
    + '<div class="disclaimer">'
    + '<strong>Disclaimer:</strong> This report is for informational purposes only and does not constitute investment advice. '
    + 'Past performance of insider buying signals does not guarantee future results. Always conduct your own due diligence '
    + 'before making investment decisions.'
    + '</div>'
    + '</div>'
    + '<div class="footer">InsiderBuying.ai | Institutional-Grade Insider Intelligence</div>'
    + '</body></html>';
}

/**
 * Full premium report HTML builder from sequential sections + charts.
 * Page order: cover → exec summary → insider intelligence → price chart + banner → remaining sections.
 * @param {Object} sections - keyed by section id, values are plain text strings
 * @param {Object} charts - keyed by chart name ('cover','price','revenue','valuation','peer'), values are base64 data URIs or placeholder HTML
 * @param {Object} config - from getReportConfig()
 * @returns {string}
 */
function _buildReportHTMLFromSections(sections, charts, config) {
  var slug = sections.slug || 'report';

  function chartImg(src) {
    if (!src) return '';
    if (src.startsWith('data:')) return '<img src="' + src + '" style="width:100%;display:block;" />';
    return src; // placeholder HTML
  }

  var css = '<style>'
    + 'body { font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; margin: 0; padding: 0; }'
    + '@page { @top-center { content: "EarlyInsider.com | Insider Intelligence Report"; font-size: 10px; color: #64748b; } }'
    + '@page :first { @top-center { content: none; } }'
    + 'section { break-before: page; padding: 30px 50px; }'
    + '.cover-page { break-before: avoid; padding: 0; }'
    + 'h2 { color: #0a1628; font-size: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-top: 0; }'
    + 'p { margin: 12px 0; line-height: 1.7; }'
    + '.continue-reading-banner { background: #0a1628; color: white; padding: 24px 40px; text-align: center; margin-top: 20px; }'
    + '.continue-reading-banner p { margin: 0 0 10px 0; font-size: 18px; font-weight: 700; color: white; }'
    + '.continue-reading-banner a { color: #60a5fa; font-size: 14px; }'
    + '</style>';

  var remainingOrder = [
    'financial_analysis', 'valuation_analysis', 'bull_case', 'bear_case',
    'peer_comparison', 'catalysts_timeline', 'investment_thesis', 'company_overview',
  ];

  function sectionHtml(id, title, extraHtml) {
    var text = sections[id] || '';
    return '<section id="' + id + '">'
      + '<h2>' + title + '</h2>'
      + '<p>' + escapeHTML(text) + '</p>'
      + (extraHtml || '')
      + '</section>';
  }

  var remainingHtml = remainingOrder.map(function(id) {
    var title = id.replace(/_/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); });
    return sectionHtml(id, title, '');
  }).join('\n');

  var banner = '<div class="continue-reading-banner">'
    + '<p>CONTINUE READING - Full report: $' + config.price + '</p>'
    + '<a href="https://earlyinsider.com/reports/' + slug + '">Get Full Access</a>'
    + '</div>';

  return '<!DOCTYPE html><html><head><meta charset="utf-8">' + css + '</head><body>'
    + '<div class="cover-page">' + chartImg(charts.cover) + '</div>'
    + sectionHtml('exec_summary', 'Executive Summary', '')
    + sectionHtml('insider_intelligence', 'Insider Intelligence', '')
    + '<section id="price_chart">'
    + chartImg(charts.price)
    + banner
    + '</section>'
    + remainingHtml
    + '</body></html>';
}

/**
 * Build Resend API payload for report delivery email.
 * @param {string} reportTitle - Report title
 * @param {string} pdfUrl - Public URL of the PDF on R2
 * @param {string} customerEmail - Recipient email
 * @returns {object} Resend API payload
 */
function buildDeliveryEmail(reportTitle, pdfUrl, customerEmail) {
  var htmlBody = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">'
    + '<div style="background: linear-gradient(135deg, #0a1628, #1a2744); padding: 30px; border-radius: 8px 8px 0 0;">'
    + '<h1 style="color: white; margin: 0; font-size: 22px;">Your Report is Ready</h1>'
    + '</div>'
    + '<div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">'
    + '<p style="color: #334155; font-size: 16px;">Hi there,</p>'
    + '<p style="color: #334155; font-size: 16px;">Your premium report <strong>"' + escapeHTML(reportTitle) + '"</strong> has been generated and is ready for download.</p>'
    + '<div style="text-align: center; margin: 30px 0;">'
    + '<a href="' + escapeHTML(pdfUrl) + '" style="background: #2563eb; color: white; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Download Report (PDF)</a>'
    + '</div>'
    + '<p style="color: #64748b; font-size: 13px;">This link will remain active. You can also access your reports from your dashboard at any time.</p>'
    + '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">'
    + '<p style="color: #94a3b8; font-size: 12px;">InsiderBuying.ai | Institutional-Grade Insider Intelligence</p>'
    + '</div></div>';

  return {
    from: 'InsiderBuying.ai <reports@insiderbuying.ai>',
    to: customerEmail,
    subject: 'Your Report: ' + reportTitle,
    html: htmlBody,
  };
}

/**
 * Build Supabase reports table record.
 * @param {string} userId - User UUID
 * @param {string} reportType - 'deep-dive' | 'sector' | 'watchlist'
 * @param {string} pdfUrl - Public URL of the PDF
 * @param {string} paymentId - Stripe payment intent ID
 * @returns {object} Supabase record
 */
function buildReportRecord(userId, reportType, pdfUrl, paymentId) {
  return {
    user_id: userId,
    report_type: reportType,
    pdf_url: pdfUrl,
    payment_id: paymentId,
    status: 'delivered',
    generated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Section 04 — Constants
// ---------------------------------------------------------------------------

var REPORT_SECTIONS = [
  { id: 'company_overview',     wordTarget: 600 },
  { id: 'insider_intelligence', wordTarget: 800 },
  { id: 'financial_analysis',   wordTarget: 700 },
  { id: 'valuation_analysis',   wordTarget: 600 },
  { id: 'bull_case',            wordTarget: 500 },
  { id: 'bear_case',            wordTarget: 500 },
  { id: 'peer_comparison',      wordTarget: 600 },
  { id: 'catalysts_timeline',   wordTarget: 400 },
  { id: 'investment_thesis',    wordTarget: 400 },
];

var BEAR_CASE_SYSTEM_PROMPT =
  'You are a skeptical short seller writing a bear case analysis.\n' +
  'Your job is to argue AGAINST buying this stock.\n\n' +
  'Requirements:\n' +
  '- Identify 3 genuine fundamental risks (NOT "market uncertainty" or "macro headwinds")\n' +
  '- Include 1 bear scenario with a specific downside price target\n' +
  '- Reference at least one historical precedent where similar insider buying preceded a price decline\n' +
  '- Be direct and adversarial - do not hedge or soften the case';

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODEL = 'claude-opus-4-6';

// ---------------------------------------------------------------------------
// Section 04 — Per-section system prompts
// ---------------------------------------------------------------------------

function buildSectionSystemPrompt(sectionId) {
  var prompts = {
    company_overview:
      'You are a professional equity research analyst. Write a company overview covering business description, ' +
      'competitive position, revenue breakdown by segment, and key financial metrics. Be specific and data-driven.',

    insider_intelligence:
      'You are a professional equity research analyst specializing in insider transaction analysis. ' +
      'Analyze insider buying/selling patterns, cluster detection, transaction sizes relative to compensation, ' +
      'and historical patterns. This is the core section - be thorough.',

    financial_analysis:
      'You are a professional equity research analyst. Analyze revenue trends (YoY growth, CAGR), ' +
      'margin progression (gross, operating, net), balance sheet health, and free cash flow generation. ' +
      'Include specific figures and trends.',

    valuation_analysis:
      'You are a professional equity research analyst. Analyze current valuation using P/E, EV/EBITDA, ' +
      'P/S, and P/FCF multiples versus historical averages and peers. Include a DCF summary. ' +
      'State a fair value range explicitly.',

    bull_case:
      'You are a professional equity research analyst writing the bull case. Identify exactly 3 specific, ' +
      'fundamental catalysts. For each, state the expected impact and a specific upside price target.',

    peer_comparison:
      'You are a professional equity research analyst. Compare the company against 3-5 direct peers on ' +
      'revenue growth, margins, valuation multiples, return on equity, and insider activity.',

    catalysts_timeline:
      'You are a professional equity research analyst. List upcoming catalysts in chronological order: ' +
      'earnings dates, product launches, regulatory decisions, contract renewals. For each, state direction and magnitude.',

    investment_thesis:
      'You are a professional equity research analyst writing the investment thesis. ' +
      'Synthesize all prior sections into a directional recommendation (Buy / Hold / Watch / Avoid). ' +
      'State a specific 12-month price target range. Be direct - no hedging language.',
  };

  return prompts[sectionId] || 'You are a professional equity research analyst. Write this section concisely and accurately.';
}

// ---------------------------------------------------------------------------
// Section 04 — Internal helpers
// ---------------------------------------------------------------------------

function countWordsInText(text) {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

function buildPriorSectionsXml(completedSections) {
  if (!completedSections || completedSections.length === 0) return '';
  var inner = completedSections.map(function(s) {
    return '<section name="' + s.id + '">\n' + s.text + '\n</section>';
  }).join('\n');
  return '<prior_sections>\n' + inner + '\n</prior_sections>\n\n';
}

async function claudeTextCall(systemPrompt, userPrompt, maxTokens, fetchFn) {
  var res = await fetchFn(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens || 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error('Claude API error: ' + res.status);
  var data = await res.json();
  return (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : '';
}

// ---------------------------------------------------------------------------
// Section 04 — generateReportSection
// ---------------------------------------------------------------------------

async function generateReportSection(sectionId, wordTarget, completedSections, data, fetchFn) {
  var systemPrompt = sectionId === 'bear_case'
    ? BEAR_CASE_SYSTEM_PROMPT
    : buildSectionSystemPrompt(sectionId);

  var priorXml = buildPriorSectionsXml(completedSections);
  var baseUserPrompt =
    (priorXml || '') +
    'Now write the ' + sectionId + ' section. Target: ' + wordTarget + ' words. ' +
    (completedSections.length > 0 ? 'Do not repeat content from prior sections. ' : '') +
    'Data available: ' + JSON.stringify(data || {}).slice(0, 500);

  var low = Math.floor(wordTarget * 0.8);
  var high = Math.ceil(wordTarget * 1.2);
  var callMaxTokens = Math.ceil(wordTarget * 1.5 + 200);

  // First attempt
  var firstText = await claudeTextCall(systemPrompt, baseUserPrompt, callMaxTokens, fetchFn);
  var firstWc = countWordsInText(firstText);

  if (firstWc >= low && firstWc <= high) return firstText;

  // Retry once with explicit guidance
  var retryPrompt = baseUserPrompt +
    '\n\nYour previous response was ' + firstWc + ' words. The target is ' + wordTarget + ' words. Rewrite to hit the target.';
  return claudeTextCall(systemPrompt, retryPrompt, callMaxTokens, fetchFn);
}

// ---------------------------------------------------------------------------
// Section 04 — reviewBearCaseAuthenticity
// ---------------------------------------------------------------------------

async function reviewBearCaseAuthenticity(bearCaseText, fetchFn) {
  var systemPrompt =
    'You are a senior analyst reviewing a bear case analysis for quality. ' +
    'Score it 1-10. Score LOW (below 7) if: it uses generic risks like "market uncertainty", ' +
    'it lacks a specific downside price target, it does not reference a historical precedent, ' +
    'or it uses hedging language. ' +
    'Respond with valid JSON only: {"score": <number>, "reasoning": "<string>"}';

  var userPrompt = 'Review this bear case:\n\n' + bearCaseText;
  var raw = await claudeTextCall(systemPrompt, userPrompt, 300, fetchFn);

  // Strip markdown fences before JSON.parse
  var cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    var parsed = JSON.parse(cleaned);
    return { score: Number(parsed.score) || 0, reasoning: parsed.reasoning || '' };
  } catch (e) {
    return { score: 5, reasoning: 'Parse failed' };
  }
}

// ---------------------------------------------------------------------------
// Section 04 — generateExecSummary
// ---------------------------------------------------------------------------

async function generateExecSummary(allSections, fetchFn) {
  var systemPrompt =
    'You are a senior equity research analyst writing an executive summary of a full investment report. ' +
    'Lead with the key verdict (Buy / Hold / Watch / Avoid) and the top insider transaction signal ' +
    '(who bought, how much, when). State the price target range from the investment_thesis section. ' +
    'Summarize the bull and bear cases in 2-3 sentences each. Keep the total to 400-500 words.';

  var priorXml = buildPriorSectionsXml(allSections);
  var userPrompt =
    priorXml +
    'Now write the executive summary based on the above sections. 400-500 words. Lead with verdict and insider signal.';

  return claudeTextCall(systemPrompt, userPrompt, 800, fetchFn);
}

// ---------------------------------------------------------------------------
// Section 04 — Orchestration
// ---------------------------------------------------------------------------

async function generateReport(data, fetchFn) {
  var completedSections = [];
  var failedSections = 0;
  var failedIds = [];

  for (var i = 0; i < REPORT_SECTIONS.length; i++) {
    var section = REPORT_SECTIONS[i];
    try {
      var text;
      if (section.id === 'bear_case') {
        text = await generateReportSection(section.id, section.wordTarget, completedSections, data, fetchFn);
        var review = await reviewBearCaseAuthenticity(text, fetchFn);
        if (review.score < 7) {
          text = await generateReportSection(section.id, section.wordTarget, completedSections, data, fetchFn);
        }
      } else {
        text = await generateReportSection(section.id, section.wordTarget, completedSections, data, fetchFn);
      }
      completedSections.push({ id: section.id, wordTarget: section.wordTarget, text: text });
    } catch (err) {
      failedSections++;
      failedIds.push(section.id);
      if (failedSections > 2) {
        throw new Error(
          'Report generation aborted: ' + failedSections + ' sections failed. Failed sections: ' + failedIds.join(', '),
        );
      }
      console.warn('[generate-report] Section ' + section.id + ' failed: ' + err.message);
    }
  }

  var execSummaryText = await generateExecSummary(completedSections, fetchFn);
  completedSections.push({ id: 'exec_summary', wordTarget: 450, text: execSummaryText });

  return completedSections;
}

// ---------------------------------------------------------------------------
// Section 05 — Price Tier Configuration
// ---------------------------------------------------------------------------

/**
 * Maps report type to price and cover template.
 * @param {string} reportType - 'single' | 'complex' | 'sector' | 'bundle'
 * @returns {{ price: number, coverTemplate: 'A' | 'B' | 'C' }}
 * @throws if reportType is unrecognized
 */
function getReportConfig(reportType) {
  var configs = {
    'single':  { price: 14.99, coverTemplate: 'A' },
    'complex': { price: 19.99, coverTemplate: 'A' },
    'sector':  { price: 19.99, coverTemplate: 'B' },
    'bundle':  { price: 24.99, coverTemplate: 'C' },
  };
  var cfg = configs[reportType];
  if (!cfg) throw new Error('Unrecognized report type: ' + reportType);
  return cfg;
}

// ---------------------------------------------------------------------------
// Section 05 — Chart Resolution (Promise.allSettled results → base64 or placeholder)
// ---------------------------------------------------------------------------

/**
 * Converts Promise.allSettled results into base64 data URIs or placeholder HTML.
 * Never throws — rejected charts become placeholder divs.
 * @param {Array} settledResults - array of { status, value | reason }
 * @returns {string[]} array of data URIs or placeholder HTML strings
 */
function resolveCharts(settledResults) {
  return (settledResults || []).map(function(result) {
    if (result.status === 'fulfilled' && result.value) {
      var b64 = Buffer.from(result.value).toString('base64');
      return 'data:image/png;base64,' + b64;
    }
    var reason = result.reason && result.reason.message ? result.reason.message : String(result.reason || 'unknown');
    console.warn('[generate-report] Chart generation failed: ' + reason);
    return '<div class="chart-unavailable">Chart temporarily unavailable</div>';
  });
}

// ---------------------------------------------------------------------------
// Section 05 — WeasyPrint PDF Generation
// ---------------------------------------------------------------------------

var WEASYPRINT_URL = 'http://host.docker.internal:3456/weasyprint';

/**
 * Generates a PDF via the screenshot server's WeasyPrint endpoint.
 * @param {string} htmlString - full HTML from buildReportHTML()
 * @param {Object} config - from getReportConfig()
 * @param {Function} [fetchFn] - injectable fetch for testing
 * @returns {Promise<Buffer>}
 * @throws if response buffer exceeds 8MB
 */
async function generateReportPDF(htmlString, config, fetchFn) {
  if (!fetchFn) fetchFn = fetch;

  var res = await fetchFn(WEASYPRINT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/html' },
    body: htmlString,
  });

  if (!res.ok) throw new Error('WeasyPrint error: ' + res.status);

  var arrayBuf = await res.arrayBuffer();
  var buffer = Buffer.from(arrayBuf);

  var MAX_SIZE = 8 * 1024 * 1024;
  if (buffer.length > MAX_SIZE) {
    throw new Error('PDF too large: ' + (buffer.length / 1024 / 1024).toFixed(1) + 'MB exceeds 8MB limit');
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// Section 05 — 5-Page Preview Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the first min(pageCount, 5) pages from a full PDF using pdf-lib.
 * @param {Buffer} fullPdfBuffer
 * @returns {Promise<Buffer>}
 */
async function generatePreviewPDF(fullPdfBuffer) {
  var pdfLib = require('pdf-lib');
  var PDFDocument = pdfLib.PDFDocument;

  var sourceDoc = await PDFDocument.load(fullPdfBuffer);
  var pageCount = Math.min(sourceDoc.getPageCount(), 5);
  var previewDoc = await PDFDocument.create();

  if (pageCount > 0) {
    var indices = Array.from({ length: pageCount }, function(_, i) { return i; });
    var pages = await previewDoc.copyPages(sourceDoc, indices);
    pages.forEach(function(p) { previewDoc.addPage(p); });
  }

  var bytes = await previewDoc.save();
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseWebhook: parseWebhook,
  determineReportParams: determineReportParams,
  buildReportPrompt: buildReportPrompt,
  buildReportHTML: buildReportHTML,
  buildDeliveryEmail: buildDeliveryEmail,
  buildReportRecord: buildReportRecord,

  // Section 04
  generateReportSection: generateReportSection,
  buildSectionSystemPrompt: buildSectionSystemPrompt,
  reviewBearCaseAuthenticity: reviewBearCaseAuthenticity,
  generateExecSummary: generateExecSummary,
  generateReport: generateReport,
  REPORT_SECTIONS: REPORT_SECTIONS,
  BEAR_CASE_SYSTEM_PROMPT: BEAR_CASE_SYSTEM_PROMPT,

  // Section 05
  getReportConfig: getReportConfig,
  resolveCharts: resolveCharts,
  generateReportPDF: generateReportPDF,
  generatePreviewPDF: generatePreviewPDF,
};
