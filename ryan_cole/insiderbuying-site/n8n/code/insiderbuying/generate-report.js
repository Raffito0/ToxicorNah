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
 * @param {string} content - AI-generated report content (markdown)
 * @param {string} reportTitle - Report title
 * @param {string} date - Report date string (e.g., 'March 28, 2026')
 * @returns {string} HTML string ready for PDF rendering
 */
function buildReportHTML(content, reportTitle, date) {
  // Convert basic markdown to HTML
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

  var html = '<!DOCTYPE html>'
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

  return html;
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

module.exports = {
  parseWebhook: parseWebhook,
  determineReportParams: determineReportParams,
  buildReportPrompt: buildReportPrompt,
  buildReportHTML: buildReportHTML,
  buildDeliveryEmail: buildDeliveryEmail,
  buildReportRecord: buildReportRecord,
};
