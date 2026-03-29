'use strict';

// Fetch polyfill for n8n sandbox
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal HTTPS GET returning a fetch-like response object.
 * Used as the default fetchFn for Alpha Vantage calls when no _fetchFn is injected.
 */
function _httpsGet(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? _https : _http;
    proto.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          json: () => Promise.resolve(JSON.parse(data)),
          text: () => Promise.resolve(data),
        });
      });
    }).on('error', reject);
  });
}

/**
 * Parse a CSV string into an array of objects using the first line as headers.
 * Handles CRLF and LF line endings. RFC-4180 compliant: quoted fields with
 * embedded commas are parsed correctly (e.g. "Alphabet Inc, Class A").
 */
function _parseCsv(text) {
  const lines = text.trim().replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 2) return [];

  function splitCsvLine(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i++; } // escaped quote
          else { inQuotes = false; }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { fields.push(field.trim()); field = ''; }
        else { field += ch; }
      }
    }
    fields.push(field.trim());
    return fields;
  }

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const values = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] !== undefined ? values[i] : ''; });
    return obj;
  });
}

/**
 * Create a default Finnhub client using process.env and internal HTTPS.
 * Returns null quotes gracefully on any error.
 */
function _createDefaultFinnhubClient() {
  const finnhub = require('./finnhub-client');
  const env = { FINNHUB_API_KEY: process.env.FINNHUB_API_KEY || '' };
  return {
    getQuote: (ticker) => finnhub.getQuote(ticker, _httpsGet, env).catch(() => null),
  };
}

// ---------------------------------------------------------------------------
// computeAlertPerformance
// ---------------------------------------------------------------------------

/**
 * For each alert, fetch the current price from Finnhub and compute the
 * percentage return since filing.
 *
 * @param {object[]} alerts         Alert records with `ticker` and `price_at_filing` fields
 * @param {{ getQuote: (ticker: string) => Promise<object|null> }} finnhubClient
 * @param {object}  [_opts]
 * @param {Function} [_opts._sleep]  Injectable sleep (default: real setTimeout)
 * @returns {Promise<{ ticker: string, return: string, winner: boolean }[]>}
 */
async function computeAlertPerformance(alerts, finnhubClient, _opts) {
  const sleepFn = (_opts && _opts._sleep) ? _opts._sleep : _sleep;

  const results = [];
  for (let i = 0; i < alerts.length; i++) {
    if (i > 0) await sleepFn(250);
    try {
      const alert = alerts[i];
      const quote = await finnhubClient.getQuote(alert.ticker);
      const currentPrice = quote && typeof quote.c === 'number' ? quote.c : null;
      const filingPrice = typeof alert.price_at_filing === 'number' ? alert.price_at_filing : null;

      if (currentPrice === null || filingPrice === null || filingPrice === 0) {
        results.push({ ticker: alert.ticker, return: 'N/A', winner: false });
      } else {
        const pct = ((currentPrice - filingPrice) / filingPrice) * 100;
        const sign = pct >= 0 ? '+' : '';
        results.push({ ticker: alert.ticker, return: sign + pct.toFixed(1) + '%', winner: pct > 0 });
      }
    } catch (e) {
      results.push({ ticker: alerts[i].ticker, return: 'N/A', winner: false });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// getUpcomingEarnings
// ---------------------------------------------------------------------------

/**
 * Return upcoming earnings events for the next 14 days.
 * Checks NocoDB `Financial_Cache` first; fetches Alpha Vantage on miss or stale (>24h).
 *
 * @param {object} nocodbApi            NocoDB client instance (list, create, update methods)
 * @param {object} [_opts]
 * @param {number}   [_opts._nowMs]     Override for Date.now() in tests
 * @param {Function} [_opts._fetchFn]   Injectable HTTP fetch (url) => Promise<{status,text}>
 * @returns {Promise<object[]>} Array of earnings events
 */
async function getUpcomingEarnings(nocodbApi, _opts) {
  const nowMs = (_opts && _opts._nowMs) ? _opts._nowMs : Date.now();
  const fetchFn = (_opts && _opts._fetchFn) ? _opts._fetchFn : _httpsGet;
  const cacheKey = 'earnings_next14_' + new Date(nowMs).toISOString().slice(0, 10);

  // --- Cache check ---
  const cacheResult = await nocodbApi.list('Financial_Cache', {
    where: '(key,eq,' + cacheKey + ')',
    limit: 1,
  });
  const cached = cacheResult.list && cacheResult.list[0];
  if (cached && cached.updated_at) {
    const ageMs = nowMs - new Date(cached.updated_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      try { return JSON.parse(cached.data); } catch (e) { /* corrupt cache — fall through to fetch */ }
    }
  }

  // --- Fetch from Alpha Vantage ---
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY || '';
  const avUrl = 'https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=' + apiKey;
  const resp = await fetchFn(avUrl);
  if (resp.status !== 200) {
    console.warn('[weekly-newsletter] Alpha Vantage returned HTTP ' + resp.status + ' — skipping cache write');
    return [];
  }
  const csvText = await resp.text();

  // Parse CSV and filter to next 14 days
  const cutoffMs = nowMs + 14 * 24 * 60 * 60 * 1000;
  const rows = _parseCsv(csvText);
  const earnings = rows.filter((row) => {
    if (!row.reportDate) return false;
    const ms = new Date(row.reportDate).getTime();
    return ms >= nowMs && ms <= cutoffMs;
  });

  // --- Upsert cache ---
  const nowIso = new Date(nowMs).toISOString();
  if (cached) {
    await nocodbApi.update('Financial_Cache', cached.Id, {
      data: JSON.stringify(earnings),
      updated_at: nowIso,
    });
  } else {
    await nocodbApi.create('Financial_Cache', {
      key: cacheKey,
      data: JSON.stringify(earnings),
      updated_at: nowIso,
    });
  }

  return earnings;
}

// ---------------------------------------------------------------------------
// gatherWeeklyContent
// ---------------------------------------------------------------------------

/**
 * Gather last week's content from NocoDB: top alerts, articles, alert
 * performance (previous week), and upcoming earnings.
 *
 * @param {object} nocodbApi  NocoDB client with list(), create(), update() methods
 * @param {object} [_opts]
 * @param {number}   [_opts._nowMs]          Override for Date.now() in tests
 * @param {object}   [_opts._finnhubClient]  Injectable Finnhub client { getQuote }
 * @param {Function} [_opts._fetchFn]        Injectable HTTP fetch for Alpha Vantage
 * @param {Function} [_opts._sleep]          Injectable sleep for computeAlertPerformance
 * @returns {Promise<object>} { topAlerts, articles, performance, upcomingEarnings, emptyAlertsPrefix? }
 */
async function gatherWeeklyContent(nocodbApi, _opts) {
  const nowMs = (_opts && _opts._nowMs) ? _opts._nowMs : Date.now();
  const sevenDaysIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fourteenDaysIso = new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 1. Top alerts: score >= 7, last 7 days
  const alertsResult = await nocodbApi.list('Insider_Alerts', {
    where: '(score,gte,7)~and(filing_date,gte,' + sevenDaysIso + ')',
    sort: '-score',
    limit: 10,
  });
  const topAlerts = alertsResult.list || [];

  // 2. Articles: last 7 days
  const articlesResult = await nocodbApi.list('Articles', {
    where: '(published_at,gte,' + sevenDaysIso + ')',
    sort: '-published_at',
    limit: 5,
  });
  const articles = articlesResult.list || [];

  // 3. Previous week alerts for performance computation
  const prevAlertsResult = await nocodbApi.list('Insider_Alerts', {
    where: '(filing_date,gte,' + fourteenDaysIso + ')~and(filing_date,lt,' + sevenDaysIso + ')',
    limit: 5,
  });
  const prevAlerts = prevAlertsResult.list || [];

  // 4. Alert performance
  let performance = [];
  if (prevAlerts.length > 0) {
    const finnhubClient = (_opts && _opts._finnhubClient)
      ? _opts._finnhubClient
      : _createDefaultFinnhubClient();
    performance = await computeAlertPerformance(prevAlerts, finnhubClient, {
      _sleep: _opts && _opts._sleep,
    });
  }

  // 5. Upcoming earnings (with cache)
  const upcomingEarnings = await getUpcomingEarnings(nocodbApi, {
    _nowMs: nowMs,
    _fetchFn: _opts && _opts._fetchFn,
  });

  const result = { topAlerts, articles, performance, upcomingEarnings };

  // Empty-state guard: prevent AI from hallucinating tickers
  if (topAlerts.length === 0) {
    result.emptyAlertsPrefix = 'No major insider moves this week -- focus section 2 on macro trends and market context instead of a specific ticker.';
  }

  return result;
}

// ---------------------------------------------------------------------------
// generateSummaries
// ---------------------------------------------------------------------------

/**
 * Generate newsletter summaries via Claude Haiku.
 * @param {object} content - Output from gatherWeeklyContent
 * @returns {object} { intro, articleTeasers, alertDigest, subjectLine, previewText }
 */
function generateSummaries(content) {
  var articleTeasers = (content.articles || []).map(function(a) {
    return {
      title: a.title || '',
      teaser: a.meta_description || a.key_takeaways || '',
      slug: a.slug || '',
      ticker: a.ticker || '',
      verdict: a.verdict_type || '',
    };
  });

  // Subject line: specific, compelling, 40-60 chars
  var subjectLine = 'This Week in Insider Buying';
  if (content.topAlerts && content.topAlerts.length > 0) {
    var topAlert = content.topAlerts[0];
    subjectLine = '$' + (topAlert.ticker || 'XYZ') + ' insiders just made a big move';
  }

  // Ensure 40-60 char range
  if (subjectLine.length > 60) subjectLine = subjectLine.slice(0, 57) + '...';
  if (subjectLine.length < 40) subjectLine = subjectLine + ' -- weekly insider digest';

  return {
    intro: 'Here is what insiders were buying and selling this week.',
    articleTeasers: articleTeasers,
    alertDigest: 'This week saw ' + (content.topAlerts || []).length + ' significant insider transactions.',
    subjectLine: subjectLine,
    previewText: 'The top insider moves you need to know about.',
  };
}

// ---------------------------------------------------------------------------
// assembleNewsletter
// ---------------------------------------------------------------------------

/**
 * Assemble newsletter HTML from summaries and content.
 * @param {object} summaries - Output from generateSummaries
 * @param {object} content - Output from gatherWeeklyContent
 * @returns {string} HTML string for Beehiiv
 */
function assembleNewsletter(summaries, content) {
  var articleCards = summaries.articleTeasers.map(function(t) {
    return '<div style="margin-bottom:16px;padding:16px;border:1px solid #e2e8f0;border-radius:8px;">'
      + '<h3 style="margin:0 0 8px;color:#002A5E;">' + escapeHTML(t.title) + '</h3>'
      + (t.verdict ? '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;background:#002A5E;color:white;">' + escapeHTML(t.verdict) + '</span> ' : '')
      + (t.ticker ? '<span style="font-family:monospace;color:#64748b;">$' + escapeHTML(t.ticker) + '</span>' : '')
      + '<p style="margin:8px 0 0;color:#475569;">' + escapeHTML(t.teaser) + '</p>'
      + '<a href="https://earlyinsider.com/blog/' + encodeURIComponent(t.slug) + '" style="color:#002A5E;font-weight:600;">Read Analysis &rarr;</a>'
      + '</div>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
    + '<div style="text-align:center;padding:20px 0;border-bottom:2px solid #002A5E;">'
    + '<h1 style="color:#002A5E;margin:0;">EarlyInsider</h1>'
    + '<p style="color:#64748b;margin:4px 0 0;">Weekly Insider Intelligence</p>'
    + '</div>'
    + '<div style="padding:20px 0;">'
    + '<p style="color:#1a1a2e;line-height:1.6;">' + escapeHTML(summaries.intro) + '</p>'
    + '</div>'
    + '<h2 style="color:#002A5E;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">THIS WEEK\'S ANALYSIS</h2>'
    + articleCards
    + '<h2 style="color:#002A5E;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">INSIDER SIGNAL SPOTLIGHT</h2>'
    + '<p style="color:#1a1a2e;line-height:1.6;">' + escapeHTML(summaries.alertDigest) + '</p>'
    + '<div style="margin-top:30px;padding:20px;background:#002A5E;border-radius:8px;text-align:center;">'
    + '<p style="color:white;margin:0 0 12px;font-size:18px;">Get real-time alerts as they happen</p>'
    + '<a href="https://earlyinsider.com/pricing" style="display:inline-block;padding:12px 24px;background:#00D26A;color:white;text-decoration:none;border-radius:6px;font-weight:600;">Upgrade to Pro</a>'
    + '</div>'
    + '<div style="margin-top:20px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:12px;">'
    + '<p>EarlyInsider -- earlyinsider.com</p>'
    + '</div>'
    + '</body></html>';

  return html;
}

// ---------------------------------------------------------------------------
// sendViaBeehiiv
// ---------------------------------------------------------------------------

/**
 * Send newsletter via Beehiiv API.
 * @param {string} html - Newsletter HTML
 * @param {string} subject - Subject line
 * @param {string} previewText - Preview text
 * @returns {object} { success, newsletterId }
 */
function sendViaBeehiiv(html, subject, previewText) {
  var apiKey = process.env.BEEHIIV_API_KEY;
  var pubId = process.env.BEEHIIV_PUBLICATION_ID;

  if (!apiKey || !pubId) {
    return { success: false, error: 'Beehiiv credentials not configured' };
  }

  return {
    method: 'POST',
    url: 'https://api.beehiiv.com/v2/publications/' + pubId + '/posts',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: {
      title: subject,
      subtitle: previewText,
      content: html,
      status: 'confirmed',
    },
    success: true,
  };
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
  gatherWeeklyContent,
  computeAlertPerformance,
  getUpcomingEarnings,
  generateSummaries,
  assembleNewsletter,
  sendViaBeehiiv,
};
