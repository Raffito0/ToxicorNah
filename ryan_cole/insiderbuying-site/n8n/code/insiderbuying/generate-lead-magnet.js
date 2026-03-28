'use strict';
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// --------------------------------------------------------------------------
// W16 Lead Magnet workflow code
// --------------------------------------------------------------------------

/**
 * Stable R2 key for the latest lead magnet PDF.
 * Overwritten each month so the landing page URL never changes.
 */
var STABLE_R2_KEY = 'reports/lead-magnet-latest.pdf';

/**
 * Gather and compute backtest data from last month's alerts.
 * @param {Array} alerts - Last month's alerts with significance >= 7.
 *   Each: { ticker, insider_name, insider_title, shares, value, filing_date, significance_score, sector }
 * @param {Array} priceData - Price records with return data.
 *   Each: { ticker, date, close, return_30d }
 * @returns {object} Backtest results
 */
function gatherBacktestData(alerts, priceData) {
  if (!alerts || alerts.length === 0) {
    return {
      alerts: [],
      hitRate: 0,
      avgReturn: 0,
      bestPerformer: null,
      worstPerformer: null,
      clusterPerformance: { count: 0, avgReturn: 0, hitRate: 0 },
      individualPerformance: { count: 0, avgReturn: 0, hitRate: 0 },
    };
  }

  // Build price lookup
  var priceLookup = {};
  (priceData || []).forEach(function(p) {
    var t = p.ticker || p.symbol;
    if (t) {
      if (!priceLookup[t] || p.date > priceLookup[t].date) {
        priceLookup[t] = p;
      }
    }
  });

  // Enrich alerts with returns
  var enriched = alerts.map(function(a) {
    var price = priceLookup[a.ticker] || {};
    return {
      ticker: a.ticker,
      insiderName: a.insider_name || a.insiderName || 'Unknown',
      insiderTitle: a.insider_title || a.insiderTitle || '',
      value: a.value || 0,
      filingDate: a.filing_date || a.filingDate || '',
      significance: a.significance_score || a.significance || 0,
      sector: a.sector || 'Unknown',
      return30d: parseFloat(price.return_30d) || 0,
    };
  });

  // Overall stats
  var totalReturn = 0;
  var positiveCount = 0;
  var best = null;
  var worst = null;

  enriched.forEach(function(a) {
    totalReturn += a.return30d;
    if (a.return30d > 0) positiveCount++;
    if (!best || a.return30d > best.return30d) best = a;
    if (!worst || a.return30d < worst.return30d) worst = a;
  });

  var count = enriched.length;
  var hitRate = count > 0 ? Math.round((positiveCount / count) * 100) : 0;
  var avgReturn = count > 0 ? Math.round((totalReturn / count) * 100) / 100 : 0;

  // Cluster vs individual performance
  // Cluster = tickers with 3+ insider purchases in the month
  var tickerCounts = {};
  enriched.forEach(function(a) {
    tickerCounts[a.ticker] = (tickerCounts[a.ticker] || 0) + 1;
  });

  var clusterTickers = {};
  Object.keys(tickerCounts).forEach(function(t) {
    if (tickerCounts[t] >= 3) clusterTickers[t] = true;
  });

  var clusterAlerts = [];
  var individualAlerts = [];

  enriched.forEach(function(a) {
    if (clusterTickers[a.ticker]) {
      clusterAlerts.push(a);
    } else {
      individualAlerts.push(a);
    }
  });

  function computeGroupStats(group) {
    if (group.length === 0) return { count: 0, avgReturn: 0, hitRate: 0 };
    var sum = 0, pos = 0;
    group.forEach(function(a) {
      sum += a.return30d;
      if (a.return30d > 0) pos++;
    });
    return {
      count: group.length,
      avgReturn: Math.round((sum / group.length) * 100) / 100,
      hitRate: Math.round((pos / group.length) * 100),
    };
  }

  return {
    alerts: enriched,
    hitRate: hitRate,
    avgReturn: avgReturn,
    bestPerformer: best ? { ticker: best.ticker, insiderName: best.insiderName, value: best.value, return30d: best.return30d } : null,
    worstPerformer: worst ? { ticker: worst.ticker, insiderName: worst.insiderName, value: worst.value, return30d: worst.return30d } : null,
    clusterPerformance: computeGroupStats(clusterAlerts),
    individualPerformance: computeGroupStats(individualAlerts),
  };
}

/**
 * Build Claude Sonnet prompt for the lead magnet backtest narrative.
 * @param {object} data - Output from gatherBacktestData()
 * @returns {string} Prompt string
 */
function buildNarrativePrompt(data) {
  var bestStr = data.bestPerformer
    ? data.bestPerformer.ticker + ' (+' + data.bestPerformer.return30d + '%, $' + Math.round(data.bestPerformer.value / 1000) + 'K purchase by ' + data.bestPerformer.insiderName + ')'
    : 'N/A';

  var worstStr = data.worstPerformer
    ? data.worstPerformer.ticker + ' (' + data.worstPerformer.return30d + '%, $' + Math.round(data.worstPerformer.value / 1000) + 'K purchase by ' + data.worstPerformer.insiderName + ')'
    : 'N/A';

  var top5 = data.alerts
    .slice()
    .sort(function(a, b) { return b.return30d - a.return30d; })
    .slice(0, 5)
    .map(function(a, i) {
      return (i + 1) + '. ' + a.ticker + ' (' + a.insiderName + ', ' + a.insiderTitle + ') - $' + Math.round(a.value / 1000) + 'K -> ' + a.return30d + '% in 30 days';
    })
    .join('\n');

  var prompt = 'You are writing a free monthly backtest report for InsiderBuying.ai.\n'
    + 'This PDF is a lead magnet -- it should be genuinely valuable and make readers want to subscribe to Pro.\n\n'
    + 'BACKTEST DATA (last month):\n'
    + '- Total high-significance alerts tracked: ' + data.alerts.length + '\n'
    + '- Overall hit rate (% positive after 30 days): ' + data.hitRate + '%\n'
    + '- Average 30-day return: ' + data.avgReturn + '%\n'
    + '- Best performer: ' + bestStr + '\n'
    + '- Worst performer: ' + worstStr + '\n'
    + '- Cluster buying (3+ insiders, same stock): ' + data.clusterPerformance.count + ' alerts, '
    + data.clusterPerformance.avgReturn + '% avg return, ' + data.clusterPerformance.hitRate + '% hit rate\n'
    + '- Individual buying: ' + data.individualPerformance.count + ' alerts, '
    + data.individualPerformance.avgReturn + '% avg return, ' + data.individualPerformance.hitRate + '% hit rate\n\n'
    + 'TOP 5 PERFORMERS:\n' + top5 + '\n\n'
    + 'Write a 1500-2000 word backtest report with these sections:\n'
    + '1. Opening Hook (2-3 sentences that make the reader go "whoa")\n'
    + '2. The Numbers (present the real data honestly -- include losses too)\n'
    + '3. "What If You Followed Every Alert?" scenario\n'
    + '   - If you put $10,000 into each high-significance alert, what would your portfolio look like?\n'
    + '   - Show both the wins AND the losses honestly\n'
    + '4. Cluster Buying vs. Individual: Which Signal is Stronger?\n'
    + '5. The Losers (be honest about which alerts lost money and why)\n'
    + '6. Key Takeaways (3-4 actionable insights)\n'
    + '7. CTA: "Get these alerts in real-time with InsiderBuying Pro"\n\n'
    + 'TONE:\n'
    + '- Data-driven but conversational, not stuffy\n'
    + '- Honest about losses -- this builds trust\n'
    + '- Show real dollar amounts in the "What If" scenario\n'
    + '- Make cluster buying the hero insight (it usually outperforms)\n'
    + '- End with a soft CTA for Pro, not salesy\n'
    + '- This is NOT investment advice -- include brief disclaimer\n';

  return prompt;
}

/**
 * Build lead magnet HTML from narrative and data.
 * @param {string} narrative - AI-generated narrative text
 * @param {object} data - Output from gatherBacktestData()
 * @param {string} monthYear - e.g., 'March 2026'
 * @returns {string} HTML string ready for PDF rendering
 */
function buildLeadMagnetHTML(narrative, data, monthYear) {
  // Convert markdown to basic HTML
  var htmlContent = narrative
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^- (.*$)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>');

  // Build top 5 performers table
  var top5 = data.alerts
    .slice()
    .sort(function(a, b) { return b.return30d - a.return30d; })
    .slice(0, 5);

  var tableRows = top5.map(function(a) {
    var color = a.return30d >= 0 ? '#16a34a' : '#dc2626';
    var sign = a.return30d >= 0 ? '+' : '';
    return '<tr>'
      + '<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">' + escapeHTML(a.ticker) + '</td>'
      + '<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">' + escapeHTML(a.insiderName) + '</td>'
      + '<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">$' + Math.round(a.value / 1000) + 'K</td>'
      + '<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: ' + color + '; font-weight: 600;">' + sign + a.return30d + '%</td>'
      + '</tr>';
  }).join('');

  var topTable = '<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">'
    + '<thead><tr style="background: #f1f5f9;">'
    + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">Ticker</th>'
    + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">Insider</th>'
    + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">Purchase</th>'
    + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">30-Day Return</th>'
    + '</tr></thead><tbody>' + tableRows + '</tbody></table>';

  // Summary stats bar
  var statsBar = '<div style="display: flex; justify-content: space-around; background: #f8fafc; border-radius: 8px; padding: 20px; margin: 24px 0;">'
    + '<div style="text-align: center;"><div style="font-size: 28px; font-weight: 700; color: #0a1628;">' + data.alerts.length + '</div><div style="font-size: 12px; color: #64748b;">Alerts Tracked</div></div>'
    + '<div style="text-align: center;"><div style="font-size: 28px; font-weight: 700; color: ' + (data.hitRate >= 50 ? '#16a34a' : '#dc2626') + ';">' + data.hitRate + '%</div><div style="font-size: 12px; color: #64748b;">Hit Rate</div></div>'
    + '<div style="text-align: center;"><div style="font-size: 28px; font-weight: 700; color: ' + (data.avgReturn >= 0 ? '#16a34a' : '#dc2626') + ';">' + (data.avgReturn >= 0 ? '+' : '') + data.avgReturn + '%</div><div style="font-size: 12px; color: #64748b;">Avg Return</div></div>'
    + '</div>';

  // Chart data JSON (embedded for frontend rendering if needed)
  var chartsData = JSON.stringify([
    {
      type: 'bar',
      title: 'Cluster vs. Individual Performance',
      data: [
        { label: 'Cluster Avg Return', value: data.clusterPerformance.avgReturn },
        { label: 'Individual Avg Return', value: data.individualPerformance.avgReturn },
      ],
    },
    {
      type: 'bar',
      title: 'Hit Rate Comparison',
      data: [
        { label: 'Cluster Hit Rate', value: data.clusterPerformance.hitRate },
        { label: 'Individual Hit Rate', value: data.individualPerformance.hitRate },
        { label: 'Overall Hit Rate', value: data.hitRate },
      ],
    },
  ]);

  var html = '<!DOCTYPE html>'
    + '<html><head><meta charset="utf-8">'
    + '<style>'
    + 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a2e; line-height: 1.7; margin: 0; padding: 0; }'
    + '.cover { background: linear-gradient(135deg, #0a1628 0%, #1e3a5f 50%, #0a1628 100%); color: white; padding: 60px 50px 50px; text-align: center; }'
    + '.cover h1 { font-size: 32px; margin: 0 0 8px 0; font-weight: 800; }'
    + '.cover .subtitle { font-size: 18px; color: #94a3b8; margin-bottom: 4px; }'
    + '.cover .date { font-size: 14px; color: #64748b; }'
    + '.content { padding: 30px 50px; }'
    + 'h2 { color: #0a1628; font-size: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-top: 30px; }'
    + 'h3 { color: #334155; font-size: 16px; margin-top: 24px; }'
    + 'p { margin: 12px 0; }'
    + 'ul { margin: 8px 0; padding-left: 24px; }'
    + 'li { margin: 4px 0; }'
    + 'strong { color: #0a1628; }'
    + '.cta-box { background: linear-gradient(135deg, #1e3a5f, #2563eb); color: white; padding: 24px 30px; border-radius: 8px; text-align: center; margin: 30px 0; }'
    + '.cta-box h3 { color: white; margin-top: 0; }'
    + '.cta-box a { color: #fbbf24; font-weight: 700; text-decoration: underline; }'
    + '.disclaimer { background: #f8fafc; border-left: 3px solid #94a3b8; padding: 12px 16px; font-size: 11px; color: #64748b; margin-top: 40px; }'
    + '.footer { text-align: center; font-size: 11px; color: #94a3b8; padding: 20px; border-top: 1px solid #e2e8f0; margin-top: 30px; }'
    + '@media print { .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .cta-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'
    + '</style></head><body>'
    + '<div class="cover">'
    + '<h1>Insider Buying Backtest</h1>'
    + '<div class="subtitle">' + escapeHTML(monthYear) + ' Performance Report</div>'
    + '<div class="date">InsiderBuying.ai | Free Monthly Report</div>'
    + '</div>'
    + '<div class="content">'
    + statsBar
    + htmlContent
    + '<h2>Top 5 Performers</h2>'
    + topTable
    + '<div class="cta-box">'
    + '<h3>Get These Alerts in Real-Time</h3>'
    + '<p>Pro members received every one of these alerts within minutes of SEC filing.</p>'
    + '<a href="https://insiderbuying.ai/pricing">Start your free trial</a>'
    + '</div>'
    + '<div class="disclaimer">'
    + '<strong>Disclaimer:</strong> This report is for educational purposes only and does not constitute investment advice. '
    + 'Past performance does not guarantee future results. Insider buying is one signal among many -- always do your own research.'
    + '</div>'
    + '</div>'
    + '<div class="footer">InsiderBuying.ai | Institutional-Grade Insider Intelligence</div>'
    + '<!-- charts_data: ' + chartsData + ' -->'
    + '</body></html>';

  return html;
}

/**
 * Build NocoDB Lead_Magnet_Versions record.
 * @param {string} monthYear - e.g., 'March 2026'
 * @param {string} pdfUrl - Public URL of the PDF on R2
 * @param {object} stats - Summary stats { alertCount, hitRate, avgReturn }
 * @returns {object} NocoDB record
 */
function buildVersionRecord(monthYear, pdfUrl, stats) {
  return {
    month_year: monthYear,
    pdf_url: pdfUrl,
    stable_url: pdfUrl, // Same since we overwrite STABLE_R2_KEY
    alert_count: stats.alertCount || 0,
    hit_rate: stats.hitRate || 0,
    avg_return: stats.avgReturn || 0,
    status: 'published',
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
  STABLE_R2_KEY: STABLE_R2_KEY,
  gatherBacktestData: gatherBacktestData,
  buildNarrativePrompt: buildNarrativePrompt,
  buildLeadMagnetHTML: buildLeadMagnetHTML,
  buildVersionRecord: buildVersionRecord,
};
