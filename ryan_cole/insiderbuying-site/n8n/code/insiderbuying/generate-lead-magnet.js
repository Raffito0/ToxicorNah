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
 * Derives the lead magnet title from real backtest data.
 * @param {Array<{ticker: string, return: number}>} topPerformers - sorted descending by return
 * @returns {string}
 */
function buildDynamicTitle(topPerformers) {
  var count = topPerformers.length;
  var topReturn = count > 0 ? Math.floor(topPerformers[0].return) : 0;
  var months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var now = new Date();
  var monthYear = months[now.getMonth()] + ' ' + now.getFullYear();
  var noun = count === 1 ? 'Insider Buy' : 'Insider Buys';
  return count + ' ' + noun + ' That Jumped ' + topReturn + '%+ \u2014 The ' + monthYear + ' Backtest';
}

/**
 * Pure JS arithmetic for the "What If $10K per Alert" simulation.
 * @param {Array<{ticker: string, return: number}>} topPerformers
 * @returns {{ perPick: Array<{ticker, invested, value}>, totalInvested, totalValue, totalReturn }}
 */
function computeWhatIfSimulation(topPerformers) {
  if (!topPerformers || topPerformers.length === 0) {
    return { perPick: [], totalInvested: 0, totalValue: 0, totalReturn: 0 };
  }
  var perPick = topPerformers.map(function(p) {
    return {
      ticker: p.ticker,
      invested: 10000,
      value: Math.round(10000 * (1 + p.return / 100)),
    };
  });
  var totalInvested = topPerformers.length * 10000;
  var totalValue = perPick.reduce(function(sum, p) { return sum + p.value; }, 0);
  var totalReturn = totalInvested > 0
    ? Math.round(((totalValue - totalInvested) / totalInvested) * 100)
    : 0;
  return { perPick: perPick, totalInvested: totalInvested, totalValue: totalValue, totalReturn: totalReturn };
}

/**
 * Scans Claude's narrative for numeric claims and checks against pre-computed values.
 * @param {string} text
 * @param {{ winRate: number, avgReturn: number, portfolioValue: number }} computedData
 * @returns {string[]}
 */
function verifyMathAccuracy(text, computedData) {
  var errors = [];

  // Check win rate: look for "X% win rate" pattern
  if (computedData.winRate !== undefined) {
    var winRateMatch = text.match(/(\d+)%\s*win\s*rate/i);
    if (winRateMatch) {
      var stated = parseInt(winRateMatch[1], 10);
      var diff = Math.abs(stated - computedData.winRate);
      if (diff > 1) {
        errors.push('Win rate mismatch: text states ' + stated + '% but computed is ' + computedData.winRate + '%');
      }
    }
  }

  // Check portfolio value: look for dollar amounts in the 50%-150% range of the expected total.
  // This window filters out per-pick amounts ($10K each) which are legitimately much smaller,
  // while still catching the total portfolio value that Claude may slightly misstate.
  if (computedData.portfolioValue !== undefined && computedData.portfolioValue > 0) {
    var dollarMatches = text.match(/\$[\d,]+/g);
    if (dollarMatches) {
      dollarMatches.forEach(function(m) {
        var val = parseInt(m.replace(/[\$,]/g, ''), 10);
        var lo = computedData.portfolioValue * 0.5;
        var hi = computedData.portfolioValue * 1.5;
        if (val >= lo && val <= hi) {
          var pct = Math.abs(val - computedData.portfolioValue) / computedData.portfolioValue * 100;
          if (pct > 1) {
            errors.push('Portfolio value mismatch: text states $' + val + ' but computed is $' + computedData.portfolioValue);
          }
        }
      });
    }
  }

  return errors;
}

/**
 * Extract the losers section from generated narrative text.
 * Uses depth-counting to handle nested <div> elements inside the section.
 * @param {string} text
 * @returns {{ content: string, wordCount: number }}
 */
function extractLosersSection(text) {
  var OPEN_TAG = '<div id="losers-section">';
  var start = text.indexOf(OPEN_TAG);
  if (start === -1) return { content: '', wordCount: 0 };
  var afterOpen = text.slice(start + OPEN_TAG.length);
  var depth = 1, i = 0;
  while (i < afterOpen.length && depth > 0) {
    if (afterOpen.slice(i, i + 4) === '<div') {
      depth++;
      i += 4;
    } else if (afterOpen.slice(i, i + 6) === '</div>') {
      depth--;
      if (depth === 0) break;
      i += 6;
    } else {
      i++;
    }
  }
  var content = afterOpen.slice(0, i);
  var wordCount = content.split(/\s+/).filter(Boolean).length;
  return { content: content, wordCount: wordCount };
}

/**
 * Returns the retry prompt for an undersized losers section.
 * @returns {string}
 */
function buildLosersRetryPrompt() {
  return 'The losers section is too short (or missing). Expand each loss with: '
    + 'what went wrong, what the data missed, what we learned. '
    + 'Write at least 500 words for this section. '
    + 'Wrap the entire section in <div id="losers-section">...</div>.';
}

/**
 * Call Anthropic to generate the lead magnet narrative.
 * @param {object} data - Output from gatherBacktestData()
 * @param {object} whatIfData - Output from computeWhatIfSimulation()
 * @param {Function} fetchFn - Injectable fetch (for tests)
 * @returns {Promise<string>} Generated narrative text
 */
async function generateLeadMagnetNarrative(data, whatIfData, fetchFn) {
  var prompt = buildNarrativePrompt(data, whatIfData);

  async function callApi(messages) {
    var res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        messages: messages,
      }),
    });
    var json = await res.json();
    return json.content[0].text;
  }

  var text = await callApi([{ role: 'user', content: prompt }]);

  // Word count check — retry once if too short
  var wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3800) {
    var retryPrompt = prompt + '\n\nWrite at least 4000 words. Current draft was too short.';
    text = await callApi([{ role: 'user', content: retryPrompt }]);
  }

  return text;
}

/**
 * Build Claude Sonnet prompt for the lead magnet backtest narrative.
 * @param {object} data - Output from gatherBacktestData()
 * @param {object} [whatIfData] - Output from computeWhatIfSimulation()
 * @returns {string} Prompt string
 */
function buildNarrativePrompt(data, whatIfData) {
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

  var whatIfSection = '';
  if (whatIfData) {
    whatIfSection = 'PRE-COMPUTED SIMULATION RESULTS (use these numbers verbatim, do not recalculate):\n'
      + '- Total invested ($10K per alert): $' + whatIfData.totalInvested + '\n'
      + '- Total portfolio value after 30 days: $' + whatIfData.totalValue + '\n'
      + '- Total return: ' + whatIfData.totalReturn + '%\n\n';
  }

  var prompt = 'You are writing a free monthly backtest report for EarlyInsider.com.\n'
    + 'This PDF is a lead magnet -- it should be genuinely valuable and make readers want to subscribe for real-time alerts.\n\n'
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
    + whatIfSection
    + 'Write a 4000-4500 word backtest report with these sections in order:\n'
    + '1. Opening Hook (2-3 sentences that make the reader go "whoa")\n'
    + '2. Quick Wins (5 actionable insights from this month\'s data)\n'
    + '3. The Numbers (present the real data honestly -- include losses too)\n'
    + '4. What If $10K per Alert (use the pre-computed simulation results above)\n'
    + '5. Cluster vs. Individual: Which Signal is Stronger?\n'
    + '6. The Losers -- IMPORTANT: wrap this entire section in <div id="losers-section">...</div>\n'
    + '   Be honest about which alerts lost money and why. At least 500 words.\n'
    + '7. Key Takeaways (3-4 actionable insights)\n'
    + '8. CTA: "Get these alerts in real-time at earlyinsider.com/alerts"\n\n'
    + 'TONE:\n'
    + '- Data-driven but conversational, not stuffy\n'
    + '- Honest about losses -- this builds trust\n'
    + '- Use the pre-computed dollar amounts in the "What If" scenario exactly as given\n'
    + '- Make cluster buying the hero insight (it usually outperforms)\n'
    + '- End with a soft CTA, not salesy\n'
    + '- This is NOT investment advice -- include brief disclaimer\n';

  return prompt;
}

/**
 * Build lead magnet HTML from narrative and data.
 * @param {string} narrative - AI-generated narrative text
 * @param {object} data - Output from gatherBacktestData()
 * @param {string} monthYear - e.g., 'March 2026'
 * @param {string[]} [chartUrls] - R2 URLs for chart images (optional)
 * @param {Array} [worstPerformers] - worst performers with whatWentWrong field (optional)
 * @returns {string} HTML string ready for PDF rendering
 */
function buildLeadMagnetHTML(narrative, data, monthYear, chartUrls, worstPerformers) {
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

  var topTable = '<table class="top-performers-table" style="width: 100%; border-collapse: collapse; margin: 20px 0;">'
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

  // Worst performers table
  var worstTable = '';
  if (worstPerformers && worstPerformers.length > 0) {
    var worstRows = worstPerformers.map(function(a) {
      return '<tr>'
        + '<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">' + escapeHTML(a.ticker) + '</td>'
        + '<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">' + escapeHTML(a.insiderName) + '</td>'
        + '<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">$' + Math.round((a.value || 0) / 1000) + 'K</td>'
        + '<td class="negative-return" style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #dc2626; font-weight: 600;">' + a.return30d + '%</td>'
        + '<td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">' + escapeHTML(a.whatWentWrong || '') + '</td>'
        + '</tr>';
    }).join('');
    worstTable = '<h2>Worst Performers</h2>'
      + '<table class="worst-performers-table" style="width: 100%; border-collapse: collapse; margin: 20px 0;">'
      + '<thead><tr style="background: #fef2f2;">'
      + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">Ticker</th>'
      + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">Insider</th>'
      + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">Purchase</th>'
      + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">30-Day Return</th>'
      + '<th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #64748b;">What Went Wrong</th>'
      + '</tr></thead><tbody>' + worstRows + '</tbody></table>';
  }

  // CTA blocks (both link to earlyinsider.com/alerts)
  var ctaBlock = '<div class="cta-block" style="background: linear-gradient(135deg, #1e3a5f, #2563eb); color: white; padding: 24px 30px; border-radius: 8px; text-align: center; margin: 30px 0;">'
    + '<p style="margin: 0 0 12px 0; font-size: 16px;">Get real-time alerts when insiders make moves like these.</p>'
    + '<a href="https://earlyinsider.com/alerts" style="color: #fbbf24; font-weight: 700; text-decoration: underline; font-size: 15px;">Get Early Access &rarr;</a>'
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
    + ctaBlock
    + statsBar
    + htmlContent
    + '<h2>Top 5 Performers</h2>'
    + topTable
    + worstTable
    + ctaBlock
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
  // Section 06
  buildDynamicTitle: buildDynamicTitle,
  computeWhatIfSimulation: computeWhatIfSimulation,
  verifyMathAccuracy: verifyMathAccuracy,
  extractLosersSection: extractLosersSection,
  buildLosersRetryPrompt: buildLosersRetryPrompt,
  generateLeadMagnetNarrative: generateLeadMagnetNarrative,
};
