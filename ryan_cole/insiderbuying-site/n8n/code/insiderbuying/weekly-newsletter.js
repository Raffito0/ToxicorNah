'use strict';

// Fetch polyfill for n8n sandbox
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

const { createOpusClient } = require('./ai-client');

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
 * Minimal HTTPS POST returning a fetch-like response object.
 */
function _httpsPost(url, headersObj, bodyStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const proto = parsed.protocol === 'https:' ? _https : _http;
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }, headersObj),
    };
    const req = proto.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          json: () => { try { return Promise.resolve(JSON.parse(data)); } catch (e) { return Promise.resolve({ _raw: data }); } },
          text: () => Promise.resolve(data),
        });
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
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
// generateNewsletter
// ---------------------------------------------------------------------------

const _NEWSLETTER_SYSTEM_PROMPT = 'You are a financial newsletter writer for EarlyInsider, covering SEC Form 4 insider buying signals. Write engaging, authoritative editorial copy. Respond with raw JSON only — no markdown fences, no explanation, no preamble.';

const _NEWSLETTER_SECTION_DESCRIPTIONS = [
  's1 — Opening Hook (100-150 words): Personal first-person observation, no data yet. Set the tone.',
  's2 — Move of the Week (200-250 words): Deep dive on alerts[0] (or macro context if no alerts).',
  's3 — Scorecard (150-200 words): Last week performance. Include winners AND losers with returns.',
  's4 — Pattern Recognition (150-200 words): Sector rotation or pre-earnings patterns in the data.',
  "s5 — What I'm Watching (100-150 words): 3-4 specific upcoming events with dates from earnings.",
  's6_free — The Wrap P.S.: Invite free subscribers to upgrade. One short paragraph.',
  's6_pro — The Wrap P.S.: Referral ask. Must contain the exact merge tag {{rp_refer_url}}.',
].join('\n');

const _NEWSLETTER_SCHEMA = JSON.stringify({
  sections: { s1: 'string', s2: 'string', s3: 'string', s4: 'string', s5: 'string', s6_free: 'string', s6_pro: 'string' },
  subjectA: 'curiosity-gap subject line (always sent to Beehiiv for delivery)',
  subjectB: 'number-specific subject line (logged to NocoDB only)',
}, null, 2);

/**
 * POST a message to Telegram using native https.
 */
function _sendTelegramAlert(msg, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return Promise.resolve();
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text: msg });
    const options = {
      hostname: 'api.telegram.org',
      path: '/bot' + token + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = _https.request(options, (res) => { res.resume(); resolve(); });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

/**
 * Generate all six newsletter sections and two subject lines in one Opus call.
 *
 * @param {object} data - Output of gatherWeeklyContent()
 * @param {object} [_opts]
 * @param {object}   [_opts._aiClient]   Injectable Opus client { complete }
 * @param {Function} [_opts._telegramFn] Injectable Telegram sender (msg) => Promise
 * @param {object}   [_opts._env]        Override process.env
 * @returns {Promise<{ sections: object, subjectA: string, subjectB: string }>}
 */
async function generateNewsletter(data, _opts) {
  const MAX_RETRIES = 3;
  const REQUIRED_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6_free', 's6_pro'];

  const env = (_opts && _opts._env) ? _opts._env : process.env;

  // Token budget: clamp inputs before prompt injection
  const alerts = (data.topAlerts || []).slice(0, 5);
  const articles = data.articles || [];
  const performance = data.performance || [];
  const earnings = (data.upcomingEarnings || []).slice(0, 10);

  // Empty-state prefix prevents AI from hallucinating tickers
  const emptyPrefix = alerts.length === 0
    ? 'IMPORTANT: No major insider moves this week. For section s2, write about macro market trends and broader market context instead of a specific ticker. Do not reference or imply any specific insider trade.\n\n'
    : '';

  const dataBlock = 'DATA:\n' + JSON.stringify({ alerts, articles, performance, earnings });
  const basePrompt = emptyPrefix + dataBlock + '\n\nSECTIONS TO WRITE:\n' + _NEWSLETTER_SECTION_DESCRIPTIONS + '\n\nRESPONSE FORMAT (raw JSON only, no fences):\n' + _NEWSLETTER_SCHEMA;

  const aiClient = (_opts && _opts._aiClient)
    ? _opts._aiClient
    : createOpusClient(_httpsGet, (env.KIEAI_API_KEY || ''));

  const telegramFn = (_opts && _opts._telegramFn)
    ? _opts._telegramFn
    : (msg) => _sendTelegramAlert(msg, env);

  let lastError = '';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const prompt = attempt === 0
      ? basePrompt
      : basePrompt + '\n\nPrevious attempt failed: ' + lastError + '. Fix the issue and return valid JSON only.';

    try {
      const aiResult = await aiClient.complete(_NEWSLETTER_SYSTEM_PROMPT, prompt);
      const raw = (aiResult && aiResult.content) ? aiResult.content : '';
      const stripped = raw
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      const parsed = JSON.parse(stripped);

      // Validate shape
      const missing = REQUIRED_KEYS.filter(
        (k) => !parsed.sections || !parsed.sections[k] || typeof parsed.sections[k] !== 'string' || !parsed.sections[k].trim()
      );
      if (missing.length > 0) { lastError = 'Missing or empty section keys: ' + missing.join(', '); continue; }
      if (!parsed.subjectA || typeof parsed.subjectA !== 'string' || !parsed.subjectA.trim()) { lastError = 'subjectA missing or empty'; continue; }
      if (!parsed.subjectB || typeof parsed.subjectB !== 'string' || !parsed.subjectB.trim()) { lastError = 'subjectB missing or empty'; continue; }

      return parsed;
    } catch (e) {
      lastError = (e && e.message) ? e.message : String(e);
    }
  }

  // All attempts failed — alert operator
  const alertMsg = '[EarlyInsider] Newsletter AI generation failed after 3 attempts.\nLast error: ' + lastError;
  try { await telegramFn(alertMsg); } catch (tgErr) {
    console.error('[generateNewsletter] Telegram alert failed:', (tgErr && tgErr.message) || tgErr);
  }
  throw new Error('generateNewsletter failed after ' + MAX_RETRIES + ' attempts: ' + lastError);
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

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Section 03: Quality Gates, HTML Assembly, Send
// ---------------------------------------------------------------------------

/**
 * Validate word count of joined sections is within [1000, 1400].
 * Strips HTML tags before counting so markup does not inflate the count.
 */
function checkWordCount(sections) {
  const s6 = (sections.s6_pro || '').length >= (sections.s6_free || '').length
    ? (sections.s6_pro || '') : (sections.s6_free || '');
  const joined = [
    sections.s1 || '', sections.s2 || '', sections.s3 || '',
    sections.s4 || '', sections.s5 || '', s6,
  ].join(' ');
  const text = joined.replace(/<[^>]+>/g, ' ');
  const count = text.trim().split(/\s+/).filter(Boolean).length;
  if (count < 1000 || count > 1400) {
    throw new Error('Word count out of range: ' + count + ' (expected 1000-1400)');
  }
}

/**
 * Validate <a href count in assembled HTML is <= 7.
 */
function checkLinkCount(html, label) {
  const count = (html.match(/<a href/gi) || []).length;
  if (count > 7) {
    throw new Error('Link count exceeded for ' + label + ': ' + count + ' (max 7)');
  }
}

/** Build the insider alert table (top 3 rows). */
function _buildAlertTable(topAlerts) {
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const rows = (topAlerts || []).slice(0, 3).map(function(a) {
    return '<tr>'
      + '<td style="padding:8px;border-bottom:1px solid #e2e8f0;">' + escapeHTML(a.ticker || '') + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #e2e8f0;">' + escapeHTML(a.insider_name || '') + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #e2e8f0;">' + fmt.format(a.total_value || 0) + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #e2e8f0;">' + escapeHTML(String(a.score || 0)) + '/10</td>'
      + '</tr>';
  });
  if (rows.length === 0) {
    rows.push('<tr><td colspan="4" style="padding:8px;text-align:center;color:#94a3b8;">No major moves this week</td></tr>');
  }
  return '<table style="width:100%;border-collapse:collapse;">'
    + '<thead><tr>'
    + '<th style="padding:8px;text-align:left;border-bottom:2px solid #002A5E;font-size:12px;">Ticker</th>'
    + '<th style="padding:8px;text-align:left;border-bottom:2px solid #002A5E;font-size:12px;">Insider</th>'
    + '<th style="padding:8px;text-align:left;border-bottom:2px solid #002A5E;font-size:12px;">Value</th>'
    + '<th style="padding:8px;text-align:left;border-bottom:2px solid #002A5E;font-size:12px;">Score</th>'
    + '</tr></thead>'
    + '<tbody>' + rows.join('') + '</tbody>'
    + '</table>';
}

var _EMAIL_HEAD = '<!DOCTYPE html><html><head>'
  + '<meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
  + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">'
  + '<style>'
  + 'body{font-family:Inter,sans-serif;background:#f8fafc;margin:0;padding:0;}'
  + '.container{max-width:600px;margin:0 auto;background:#ffffff;padding:32px;}'
  + 'h2{color:#002A5E;margin:24px 0 8px;}'
  + '@media (max-width: 480px) { .container { padding: 16px !important; } }'
  + '</style>'
  + '</head><body><div class="container">';

var _EMAIL_HEADER_BLOCK = '<div style="text-align:center;padding:16px 0;border-bottom:2px solid #002A5E;">'
  + '<h1 style="color:#002A5E;margin:0;">EarlyInsider</h1>'
  + '<p style="color:#64748b;margin:4px 0 0;">Weekly Insider Intelligence</p>'
  + '</div>';

var _EMAIL_FOOTER_CLOSE = '<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;'
  + 'text-align:center;font-size:12px;color:#94a3b8;">'
  + '<p>EarlyInsider | <a href="https://earlyinsider.com" style="color:#94a3b8;">earlyinsider.com</a></p>'
  + '</div>'
  + '</div></body></html>';

/**
 * Assemble the Free-tier newsletter HTML.
 * Includes s1-s3, alert table, upgrade CTA, s6_free, and List-Unsubscribe footer.
 */
function assembleFreeHtml(sections, topAlerts, subjectA) {
  var alertTable = _buildAlertTable(topAlerts);
  return _EMAIL_HEAD
    + _EMAIL_HEADER_BLOCK
    + '<div style="margin:24px 0;">' + escapeHTML(sections.s1 || '') + '</div>'
    + '<h2>Move of the Week</h2>'
    + '<div style="margin:16px 0;">' + escapeHTML(sections.s2 || '') + '</div>'
    + '<h2>Scorecard</h2>'
    + '<div style="margin:16px 0;">' + escapeHTML(sections.s3 || '') + '</div>'
    + '<h2>Top Insider Moves</h2>'
    + alertTable
    + '<div style="margin:32px 0;padding:24px;background:#f0f9ff;border-left:4px solid #002A5E;border-radius:4px;">'
    + '<p style="margin:0 0 12px;font-weight:600;color:#002A5E;">Want the full analysis? Pattern Recognition, What I\'m Watching, and the complete scorecard are available to Pro subscribers.</p>'
    + '<a href="https://earlyinsider.com/pricing" style="display:inline-block;padding:10px 20px;background:#002A5E;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600;">Upgrade to Pro</a>'
    + '</div>'
    + '<div style="margin:24px 0;">' + escapeHTML(sections.s6_free || '') + '</div>'
    + '<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8;">'
    + '<p>EarlyInsider | <a href="https://earlyinsider.com" style="color:#94a3b8;">earlyinsider.com</a></p>'
    + '<p><a href="https://earlyinsider.com/unsubscribe" style="color:#94a3b8;">Unsubscribe</a> | List-Unsubscribe</p>'
    + '</div>'
    + '</div></body></html>';
}

/**
 * Assemble the Pro-tier newsletter HTML.
 * Includes all 6 sections, alert table, "5 more alerts" block, and referral block with {{rp_refer_url}}.
 */
function assembleProHtml(sections, topAlerts, subjectA) {
  var alertTable = _buildAlertTable(topAlerts);
  return _EMAIL_HEAD
    + _EMAIL_HEADER_BLOCK
    + '<div style="margin:24px 0;">' + escapeHTML(sections.s1 || '') + '</div>'
    + '<h2>Move of the Week</h2>'
    + '<div style="margin:16px 0;">' + escapeHTML(sections.s2 || '') + '</div>'
    + '<h2>Scorecard</h2>'
    + '<div style="margin:16px 0;">' + escapeHTML(sections.s3 || '') + '</div>'
    + '<h2>Pattern Recognition</h2>'
    + '<div style="margin:16px 0;">' + escapeHTML(sections.s4 || '') + '</div>'
    + '<h2>What I\'m Watching</h2>'
    + '<div style="margin:16px 0;">' + escapeHTML(sections.s5 || '') + '</div>'
    + '<h2>Top Insider Moves</h2>'
    + alertTable
    + '<div style="margin:24px 0;padding:16px;background:#f8fafc;border-radius:4px;">'
    + '<a href="https://earlyinsider.com/alerts" style="color:#002A5E;font-weight:600;">See 5 more alerts from this week &rarr;</a>'
    + '</div>'
    + '<div style="margin:24px 0;padding:16px;background:#f0f9ff;border-radius:4px;">'
    + '<p style="margin:0;">Share EarlyInsider and earn rewards: <a href="{{rp_refer_url}}" style="color:#002A5E;">{{rp_refer_url}}</a></p>'
    + '</div>'
    + '<div style="margin:24px 0;">' + escapeHTML(sections.s6_pro || '') + '</div>'
    + _EMAIL_FOOTER_CLOSE;
}

/**
 * Send newsletter via Beehiiv API. Falls back to Resend if Beehiiv returns non-confirmed status.
 *
 * @param {string} html
 * @param {string} subjectA
 * @param {string} tier  'free' | 'pro'
 * @param {object} [_opts]
 * @param {Function} [_opts._postFn]    Injectable HTTP POST (url, headers, bodyStr) => Promise
 * @param {Function} [_opts._resendFn]  Injectable fallback (html, subjectA, tier) => Promise
 * @param {object}   [_opts._env]       Override process.env
 */
async function sendViaBeehiiv(html, subjectA, tier, _opts) {
  const env = (_opts && _opts._env) ? _opts._env : process.env;
  const postFn = (_opts && _opts._postFn) ? _opts._postFn : _httpsPost;
  const resendFn = (_opts && _opts._resendFn) ? _opts._resendFn : null;

  const apiKey = env.BEEHIIV_API_KEY || '';
  // NOTE: if BEEHIIV_PUBLICATION_ID is missing the URL becomes /publications//posts (404).
  // The Resend fallback will handle it, but watch for this in env setup.
  const pubId = env.BEEHIIV_PUBLICATION_ID || '';
  const url = 'https://api.beehiiv.com/v2/publications/' + pubId + '/posts';

  const payload = { email_subject_line: subjectA, content_html: html, status: 'confirmed' };
  if (tier === 'pro') {
    const tierIds = (env.BEEHIIV_PREMIUM_TIER_IDS || '').split(',').filter(Boolean);
    if (tierIds.length > 0) payload.tier_ids = tierIds;
  }

  let useFallback = false;
  let fallbackReason = '';
  try {
    const resp = await postFn(url, { 'Authorization': 'Bearer ' + apiKey }, JSON.stringify(payload));
    if (resp.status >= 200 && resp.status < 300) {
      const body = await resp.json();
      if (body && body.data && body.data.status !== 'confirmed') {
        useFallback = true;
        fallbackReason = 'Beehiiv status: ' + body.data.status;
      } else {
        console.log('[sendViaBeehiiv] Sent via Beehiiv (' + tier + ')');
        return;
      }
    } else {
      useFallback = true;
      fallbackReason = 'Beehiiv HTTP ' + resp.status;
    }
  } catch (e) {
    useFallback = true;
    fallbackReason = (e && e.message) ? e.message : String(e);
  }

  if (useFallback) {
    console.warn('[sendViaBeehiiv] Falling back to Resend (' + tier + '): ' + fallbackReason);
    if (resendFn) {
      await resendFn(html, subjectA, tier);
    } else {
      throw new Error('[sendViaBeehiiv] Beehiiv failed and no resendFn provided: ' + fallbackReason);
    }
  }
}

/**
 * Send via Resend batch endpoint in chunks of 500 recipients.
 *
 * @param {string}   html
 * @param {string}   subjectA
 * @param {string}   tier
 * @param {string[]} subscribers  Array of recipient email strings
 * @param {object}   [_opts]
 * @param {Function} [_opts._postFn]  Injectable HTTP POST
 * @param {object}   [_opts._env]     Override process.env
 */
async function sendViaResend(html, subjectA, tier, subscribers, _opts) {
  const env = (_opts && _opts._env) ? _opts._env : process.env;
  const postFn = (_opts && _opts._postFn) ? _opts._postFn : _httpsPost;
  const apiKey = env.RESEND_API_KEY || '';
  const BATCH_SIZE = 500;

  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);
    const payload = batch.map(function(email) {
      return {
        from: 'Ryan from EarlyInsider <ryan@earlyinsider.com>',
        to: [email],
        subject: subjectA,
        html: html,
        headers: { 'List-Unsubscribe': '<mailto:unsubscribe@earlyinsider.com?subject=unsubscribe>' },
      };
    });
    const resp = await postFn('https://api.resend.com/emails/batch', { 'Authorization': 'Bearer ' + apiKey }, JSON.stringify(payload));
    if (resp.status < 200 || resp.status >= 300) {
      const body = await resp.text();
      throw new Error('Resend batch failed with HTTP ' + resp.status + ': ' + body);
    }
  }
  console.log('[sendViaResend] Sent to ' + subscribers.length + ' ' + tier + ' recipients in '
    + Math.ceil(subscribers.length / BATCH_SIZE) + ' batch(es)');
}

/**
 * Write a Newsletter_Sends record to NocoDB after a successful send.
 */
async function logSendToNocodb(nocodbApi, logData) {
  await nocodbApi.create('Newsletter_Sends', {
    sent_at: new Date().toISOString(),
    subject_a: logData.subjectA,
    subject_b: logData.subjectB,
    send_path: logData.sendPath || 'beehiiv',
    word_count: logData.wordCount,
    free_link_count: logData.freeLinkCount,
    pro_link_count: logData.proLinkCount,
  });
}

/**
 * Top-level orchestrator: gathers content → generates AI copy → gates → assembles → sends → logs.
 *
 * @param {object} nocodbApi  NocoDB client
 * @param {object} [_opts]
 * @param {Function} [_opts._gatherFn]    Override gatherWeeklyContent (for tests)
 * @param {object}   [_opts._aiClient]    Passed to generateNewsletter
 * @param {Function} [_opts._telegramFn]  Passed to generateNewsletter
 * @param {Function} [_opts._postFn]      Injectable HTTP POST for Beehiiv + Resend
 * @param {object}   [_opts._env]         Override process.env
 */
async function sendWeeklyNewsletter(nocodbApi, _opts) {
  const env = (_opts && _opts._env) ? _opts._env : process.env;
  const postFn = (_opts && _opts._postFn) ? _opts._postFn : _httpsPost;

  // 1. Gather content
  const gatherFn = (_opts && _opts._gatherFn)
    ? _opts._gatherFn
    : function() { return gatherWeeklyContent(nocodbApi, { _env: env }); };
  const content = await gatherFn();

  // 2. Generate AI sections
  const aiResult = await generateNewsletter(content, {
    _aiClient: _opts && _opts._aiClient,
    _telegramFn: _opts && _opts._telegramFn,
    _env: env,
  });
  const sections = aiResult.sections;
  const subjectA = aiResult.subjectA;
  const subjectB = aiResult.subjectB;

  // 3. Quality gates
  checkWordCount(sections);

  // 4. Assemble HTML variants
  const freeHtml = assembleFreeHtml(sections, content.topAlerts, subjectA);
  const proHtml = assembleProHtml(sections, content.topAlerts, subjectA);
  checkLinkCount(freeHtml, 'free');
  checkLinkCount(proHtml, 'pro');

  const s6forCount = (sections.s6_pro || '').length >= (sections.s6_free || '').length
    ? (sections.s6_pro || '') : (sections.s6_free || '');
  const wordCountText = [sections.s1, sections.s2, sections.s3, sections.s4, sections.s5, s6forCount]
    .join(' ').replace(/<[^>]+>/g, ' ');
  const wordCount = wordCountText.trim().split(/\s+/).filter(Boolean).length;
  const freeLinkCount = (freeHtml.match(/<a href/gi) || []).length;
  const proLinkCount = (proHtml.match(/<a href/gi) || []).length;

  // Build Resend fallback closures (lazy subscriber fetch)
  let sendPath = 'beehiiv';
  function makeResendFallback(tier) {
    return async function(html, subject) {
      // NOTE: capped at 5000 subscribers — no pagination. Sufficient for pre-launch scale.
      const subResult = await nocodbApi.list('Newsletter_Subscribers', {
        where: '(tier,eq,' + tier + ')',
        limit: 5000,
      });
      const subscribers = (subResult.list || []).map(function(s) { return s.email; }).filter(Boolean);
      await sendViaResend(html, subject, tier, subscribers, { _postFn: postFn, _env: env });
      sendPath = 'resend';
    };
  }

  // 5. Send both tiers in parallel
  await Promise.all([
    sendViaBeehiiv(freeHtml, subjectA, 'free', {
      _postFn: postFn, _resendFn: makeResendFallback('free'), _env: env,
    }),
    sendViaBeehiiv(proHtml, subjectA, 'pro', {
      _postFn: postFn, _resendFn: makeResendFallback('pro'), _env: env,
    }),
  ]);

  // 6. Log
  await logSendToNocodb(nocodbApi, { subjectA, subjectB, sendPath, wordCount, freeLinkCount, proLinkCount });
}

module.exports = {
  gatherWeeklyContent,
  computeAlertPerformance,
  getUpcomingEarnings,
  generateNewsletter,
  generateSummaries,
  assembleNewsletter,
  checkWordCount,
  checkLinkCount,
  assembleFreeHtml,
  assembleProHtml,
  sendViaBeehiiv,
  sendViaResend,
  logSendToNocodb,
  sendWeeklyNewsletter,
};
