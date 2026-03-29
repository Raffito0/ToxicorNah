'use strict';
// DISABLED: superseded by the monthly backtest lead magnet (unit 17 A1).
// DISABLED flag is in module.exports at bottom of file.

const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// --------------------------------------------------------------------------
// W3 Data Study workflow code
// --------------------------------------------------------------------------

/**
 * Rotating study topics -- one per month, cycles every 6 months.
 */
const STUDY_TOPICS = [
  {
    id: 'cluster-buying',
    title: 'Cluster Buying Analysis',
    description: 'When 3+ insiders buy within 14 days, how does the stock perform?',
    methodology: 'Identify clusters of 3+ insider purchases within a 14-day window. Track 30/60/90 day returns from cluster end date.',
  },
  {
    id: 'ceo-vs-directors',
    title: 'CEO vs. Director Purchases',
    description: 'Do CEO purchases outperform board member purchases?',
    methodology: 'Compare 30/60/90 day returns for CEO purchases vs. director purchases. Control for purchase size and market cap.',
  },
  {
    id: 'sector-rotation',
    title: 'Sector Rotation Signals',
    description: 'Which sectors see the most insider buying before outperformance?',
    methodology: 'Aggregate insider purchase volume by sector over trailing 30 days. Correlate with subsequent 60-day sector returns.',
  },
  {
    id: 'purchase-size',
    title: 'Purchase Size vs. Returns',
    description: 'Do larger insider purchases signal stronger conviction?',
    methodology: 'Bucket purchases by dollar amount (<$100K, $100K-$500K, $500K-$1M, >$1M). Compare average returns across buckets.',
  },
  {
    id: 'first-time-buyers',
    title: 'First-Time Insider Buyers',
    description: 'When an insider buys for the first time, is the signal stronger?',
    methodology: 'Identify insiders with no prior purchases in the last 2 years. Compare their purchase returns to repeat buyers.',
  },
  {
    id: 'market-cap-effect',
    title: 'Small Cap vs. Large Cap Insider Buying',
    description: 'Is insider buying more predictive in smaller companies?',
    methodology: 'Split universe by market cap (<$1B, $1-10B, >$10B). Compare insider purchase hit rates and average returns.',
  },
];

/**
 * Select study topic by month index (0-based). Cycles every 6 months.
 * @param {number} monthIndex - 0-11 month of year
 * @returns {object} Study topic from STUDY_TOPICS
 */
function selectStudyTopic(monthIndex) {
  const idx = monthIndex % STUDY_TOPICS.length;
  return STUDY_TOPICS[idx];
}

/**
 * Aggregate insider trading data for a given study topic.
 * @param {object} topic - Study topic from STUDY_TOPICS
 * @param {Array} alerts - Array of alert records with fields: ticker, insider_name, insider_title, shares, value, filing_date, significance_score, sector
 * @param {Array} financialCache - Array of price records with fields: ticker, date, close, return_30d, return_60d, return_90d
 * @returns {object} { transactions, statistics, sectorBreakdown, topPerformers }
 */
function aggregateData(topic, alerts, financialCache) {
  if (!alerts || alerts.length === 0) {
    return {
      transactions: [],
      statistics: { count: 0, avgReturn30d: 0, avgReturn60d: 0, avgReturn90d: 0, hitRate30d: 0, medianReturn30d: 0 },
      sectorBreakdown: [],
      topPerformers: [],
    };
  }

  // Build price lookup: ticker -> latest price record
  var priceLookup = {};
  (financialCache || []).forEach(function(p) {
    var t = p.ticker || p.symbol;
    if (t) {
      if (!priceLookup[t] || p.date > priceLookup[t].date) {
        priceLookup[t] = p;
      }
    }
  });

  // Enrich alerts with return data
  var transactions = alerts.map(function(a) {
    var price = priceLookup[a.ticker] || {};
    return {
      ticker: a.ticker,
      insiderName: a.insider_name || a.insiderName || 'Unknown',
      insiderTitle: a.insider_title || a.insiderTitle || '',
      shares: a.shares || 0,
      value: a.value || 0,
      filingDate: a.filing_date || a.filingDate || '',
      significance: a.significance_score || a.significance || 0,
      sector: a.sector || 'Unknown',
      return30d: parseFloat(price.return_30d) || 0,
      return60d: parseFloat(price.return_60d) || 0,
      return90d: parseFloat(price.return_90d) || 0,
    };
  });

  // Compute statistics
  var count = transactions.length;
  var sum30 = 0, sum60 = 0, sum90 = 0, positive30 = 0;
  var returns30 = [];

  transactions.forEach(function(t) {
    sum30 += t.return30d;
    sum60 += t.return60d;
    sum90 += t.return90d;
    returns30.push(t.return30d);
    if (t.return30d > 0) positive30++;
  });

  returns30.sort(function(a, b) { return a - b; });
  var median30 = count > 0 ? returns30[Math.floor(count / 2)] : 0;

  var statistics = {
    count: count,
    avgReturn30d: count > 0 ? Math.round((sum30 / count) * 100) / 100 : 0,
    avgReturn60d: count > 0 ? Math.round((sum60 / count) * 100) / 100 : 0,
    avgReturn90d: count > 0 ? Math.round((sum90 / count) * 100) / 100 : 0,
    hitRate30d: count > 0 ? Math.round((positive30 / count) * 100) : 0,
    medianReturn30d: Math.round(median30 * 100) / 100,
  };

  // Sector breakdown
  var sectorMap = {};
  transactions.forEach(function(t) {
    if (!sectorMap[t.sector]) {
      sectorMap[t.sector] = { sector: t.sector, count: 0, totalValue: 0, avgReturn30d: 0, sumReturn: 0 };
    }
    sectorMap[t.sector].count++;
    sectorMap[t.sector].totalValue += t.value;
    sectorMap[t.sector].sumReturn += t.return30d;
  });

  var sectorBreakdown = Object.keys(sectorMap).map(function(key) {
    var s = sectorMap[key];
    s.avgReturn30d = Math.round((s.sumReturn / s.count) * 100) / 100;
    delete s.sumReturn;
    return s;
  }).sort(function(a, b) { return b.count - a.count; });

  // Top performers (top 10 by 30d return)
  var topPerformers = transactions
    .slice()
    .sort(function(a, b) { return b.return30d - a.return30d; })
    .slice(0, 10)
    .map(function(t) {
      return {
        ticker: t.ticker,
        insiderName: t.insiderName,
        insiderTitle: t.insiderTitle,
        value: t.value,
        return30d: t.return30d,
        sector: t.sector,
      };
    });

  return { transactions: transactions, statistics: statistics, sectorBreakdown: sectorBreakdown, topPerformers: topPerformers };
}

/**
 * Build Claude prompt for AI analysis of insider trading data.
 * @param {object} data - Output from aggregateData()
 * @param {object} topic - Study topic from STUDY_TOPICS
 * @returns {string} Prompt string for Claude
 */
function generateAnalysisPrompt(data, topic) {
  var stats = data.statistics;
  var sectors = data.sectorBreakdown;
  var top = data.topPerformers;

  var sectorLines = sectors.map(function(s) {
    return '  - ' + s.sector + ': ' + s.count + ' transactions, avg 30d return ' + s.avgReturn30d + '%, total value $' + Math.round(s.totalValue / 1000) + 'K';
  }).join('\n');

  var topLines = top.map(function(t, i) {
    return '  ' + (i + 1) + '. ' + t.ticker + ' (' + t.insiderName + ', ' + t.insiderTitle + ') - $' + Math.round(t.value / 1000) + 'K purchase -> ' + t.return30d + '% return';
  }).join('\n');

  var prompt = 'You are a financial analyst writing a data study for InsiderBuying.ai.\n\n'
    + 'STUDY TOPIC: ' + topic.title + '\n'
    + 'QUESTION: ' + topic.description + '\n'
    + 'METHODOLOGY: ' + topic.methodology + '\n\n'
    + 'DATA SUMMARY:\n'
    + '- Total transactions analyzed: ' + stats.count + '\n'
    + '- Average 30-day return: ' + stats.avgReturn30d + '%\n'
    + '- Average 60-day return: ' + stats.avgReturn60d + '%\n'
    + '- Average 90-day return: ' + stats.avgReturn90d + '%\n'
    + '- 30-day hit rate (% positive): ' + stats.hitRate30d + '%\n'
    + '- Median 30-day return: ' + stats.medianReturn30d + '%\n\n'
    + 'SECTOR BREAKDOWN:\n' + sectorLines + '\n\n'
    + 'TOP PERFORMERS:\n' + topLines + '\n\n'
    + 'Write a thorough data study analysis (2000-3000 words) with these sections:\n'
    + '1. Executive Summary (3-4 sentences answering the core question with specific numbers)\n'
    + '2. Methodology (how the data was collected and analyzed)\n'
    + '3. Key Findings (3-5 numbered findings with supporting data)\n'
    + '4. Sector Analysis (which sectors showed strongest insider buying signals)\n'
    + '5. Notable Transactions (highlight 3-5 standout purchases and outcomes)\n'
    + '6. Limitations & Caveats (honest about data limitations)\n'
    + '7. Conclusion & Actionable Takeaways (what readers should do with this information)\n\n'
    + 'RULES:\n'
    + '- Use specific numbers from the data, never fabricate statistics\n'
    + '- Write in a professional but accessible tone\n'
    + '- Include percentage returns with one decimal place\n'
    + '- Mention that this is not financial advice\n'
    + '- Reference the S&P 500 benchmark where relevant\n';

  return prompt;
}

/**
 * Create chart-ready JSON array for the study.
 * @param {object} statistics - Statistics object from aggregateData
 * @returns {Array} Array of chart spec objects
 */
function buildChartsData(statistics) {
  var charts = [];

  // Chart 1: Return comparison bar chart
  charts.push({
    type: 'bar',
    title: 'Average Returns by Time Period',
    data: [
      { label: '30-Day', value: statistics.avgReturn30d },
      { label: '60-Day', value: statistics.avgReturn60d },
      { label: '90-Day', value: statistics.avgReturn90d },
    ],
  });

  // Chart 2: Hit rate gauge (simplified as bar)
  charts.push({
    type: 'bar',
    title: 'Hit Rate (% Positive After 30 Days)',
    data: [
      { label: 'Positive', value: statistics.hitRate30d },
      { label: 'Negative', value: 100 - statistics.hitRate30d },
    ],
  });

  // Chart 3: Mean vs median comparison
  charts.push({
    type: 'bar',
    title: 'Mean vs. Median 30-Day Return',
    data: [
      { label: 'Mean', value: statistics.avgReturn30d },
      { label: 'Median', value: statistics.medianReturn30d },
    ],
  });

  return charts;
}

/**
 * Build NocoDB-ready record for the Data Studies table.
 * @param {string} title - Study title
 * @param {string} analysis - AI-generated analysis text
 * @param {Array} chartsData - Output from buildChartsData()
 * @returns {object} NocoDB record object
 */
function buildStudyRecord(title, analysis, chartsData) {
  var now = new Date().toISOString();

  // Extract key findings from analysis (first 500 chars of Key Findings section)
  var keyFindings = '';
  var kfMatch = analysis.match(/Key Findings[\s\S]*?(?=\n#{1,3}\s|\n\d+\.\s*Sector|\n\d+\.\s*Notable)/i);
  if (kfMatch) {
    keyFindings = kfMatch[0].slice(0, 500).trim();
  } else {
    // Fallback: first 500 chars
    keyFindings = analysis.slice(0, 500).trim();
  }

  // Extract methodology
  var methodology = '';
  var methMatch = analysis.match(/Methodology[\s\S]*?(?=\n#{1,3}\s|\n\d+\.\s*Key)/i);
  if (methMatch) {
    methodology = methMatch[0].slice(0, 300).trim();
  }

  // Determine data period (current month range)
  var endDate = new Date();
  var startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 1);
  var dataPeriod = startDate.toISOString().slice(0, 10) + ' to ' + endDate.toISOString().slice(0, 10);

  return {
    title: title,
    study_type: 'monthly_data_study',
    content: analysis,
    data_period: dataPeriod,
    key_findings: keyFindings,
    methodology: methodology,
    charts_data: JSON.stringify(chartsData),
    status: 'published',
    published_at: now,
    created_at: now,
  };
}

module.exports = {
  DISABLED: true,
  STUDY_TOPICS: STUDY_TOPICS,
  selectStudyTopic: selectStudyTopic,
  aggregateData: aggregateData,
  generateAnalysisPrompt: generateAnalysisPrompt,
  buildChartsData: buildChartsData,
  buildStudyRecord: buildStudyRecord,
};
