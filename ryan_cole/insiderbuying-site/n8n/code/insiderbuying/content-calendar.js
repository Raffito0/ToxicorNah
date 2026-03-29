'use strict';

/**
 * content-calendar.js -- Shared Content Utility Module
 *
 * Exported functions consumed by article generators, competitor monitors,
 * and the earnings-driven scheduler. Not a standalone n8n workflow.
 *
 * Dependencies:
 *   - fast-xml-parser (npm) -- must be installed in n8n environment
 *   - NocoDB tables: Content_Calendar, Competitor_Intel, SEO_State
 *   - All external I/O injected via opts for testability
 */

var XMLParser = null;
try {
  XMLParser = require('fast-xml-parser').XMLParser;
} catch (e) {
  console.warn('[content-calendar] fast-xml-parser not available -- RSS parsing will be skipped');
}

var ALPHA_VANTAGE_DELAY_MS = 12000; // 5 calls/min free tier -> 12s gap

// Uppercase tokens that are NOT ticker symbols
var TICKER_STOP_WORDS = new Set([
  // Common English words that appear in all caps
  'THE', 'AND', 'FOR', 'FROM', 'WITH', 'THAT', 'THIS', 'ARE', 'ITS',
  'HOW', 'WHY', 'WHAT', 'WHO', 'NEW', 'BIG', 'HIGH', 'LOW', 'GET',
  'NOT', 'BUT', 'WAS', 'HAS', 'HAD', 'DID', 'CAN', 'MAY', 'WILL',
  'COULD', 'WOULD', 'SHOULD', 'THEIR', 'AFTER', 'ABOUT', 'OVER',
  'INTO', 'ALSO', 'BEEN', 'HAVE', 'SAID', 'MORE', 'THAN', 'WHEN',
  // 2-letter prepositions/articles
  'OF', 'IN', 'AT', 'AN', 'TO', 'AS', 'IS', 'IT', 'BE', 'BY',
  'DO', 'GO', 'NO', 'ON', 'OR', 'SO', 'UP', 'HE', 'ME', 'MY',
  'US', 'WE', 'IF', 'AM',
  // Finance/regulatory abbreviations that are not tickers
  'NYSE', 'SEC', 'CEO', 'CFO', 'COO', 'IPO', 'ETF', 'GDP', 'CPI',
  'USD', 'EUR', 'GBP', 'YOY', 'QOQ', 'EPS', 'TTM', 'YTD', 'ALL',
  'ESG', 'ROI', 'ROE', 'FCF', 'DCF', 'PEG', 'ATH', 'ATL', 'AUM',
  'API', 'SaaS', 'FTC', 'DOJ', 'IRS', 'FED', 'ECB',
]);

// Stop words for TF-IDF similarity computation
var SIMILARITY_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'this', 'that', 'from', 'into', 'as', 'its', 'it', 'he', 'she',
  'they', 'we', 'his', 'her', 'their', 'our', 'my',
  // Financial common words
  'stock', 'company', 'shares', 'insider', 'buy', 'purchase', 'million',
  'billion', 'quarter', 'year', 'market', 'price', 'trading', 'said',
  'also', 'after', 'about', 'over', 'than', 'when', 'more', 'been',
]);

// ---------------------------------------------------------------------------
// Internal: ticker extraction
// ---------------------------------------------------------------------------

function extractTickers(text) {
  if (!text) return [];
  var matches = text.match(/\b[A-Z]{2,5}\b/g) || [];
  var seen = {};
  var result = [];
  for (var i = 0; i < matches.length; i++) {
    var tok = matches[i];
    if (!TICKER_STOP_WORDS.has(tok) && !seen[tok]) {
      seen[tok] = true;
      result.push(tok);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal: TF-IDF cosine similarity
// ---------------------------------------------------------------------------

function tokenize(text) {
  return text.toLowerCase().split(/\W+/).filter(function(w) {
    return w.length > 1 && !SIMILARITY_STOP_WORDS.has(w);
  });
}

function truncateWords(text, maxWords) {
  var words = (text || '').split(/\s+/);
  if (words.length <= maxWords) return text || '';
  return words.slice(0, maxWords).join(' ');
}

function buildTF(tokens) {
  var tf = {};
  for (var i = 0; i < tokens.length; i++) {
    tf[tokens[i]] = (tf[tokens[i]] || 0) + 1;
  }
  var len = tokens.length || 1;
  var term;
  for (term in tf) tf[term] = tf[term] / len;
  return tf;
}

function buildIDF(corpus) {
  var N = corpus.length;
  var df = {};
  for (var i = 0; i < N; i++) {
    var seen = {};
    for (var j = 0; j < corpus[i].length; j++) {
      var t = corpus[i][j];
      if (!seen[t]) { seen[t] = true; df[t] = (df[t] || 0) + 1; }
    }
  }
  var idf = {};
  var term;
  // Smooth IDF (+1): ensures weights never collapse to 0 in small corpora
  for (term in df) idf[term] = Math.log((N + 1) / (df[term] + 1)) + 1;
  return idf;
}

function cosineSimilarity(vecA, vecB) {
  var dot = 0;
  var magA = 0;
  var magB = 0;
  var t;
  for (t in vecA) { magA += vecA[t] * vecA[t]; }
  for (t in vecB) { magB += vecB[t] * vecB[t]; }
  for (t in vecA) { if (vecB[t]) dot += vecA[t] * vecB[t]; }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ---------------------------------------------------------------------------
// addToCalendar
// ---------------------------------------------------------------------------

/**
 * Schedule a new content item.
 * @param {{ ticker: string, type: string, date: string, channel: string, notes?: string }} entry
 * @param {{ nocodb: { post: Function } }} opts
 * @returns {Promise<Object>} Created NocoDB record
 */
async function addToCalendar(entry, opts) {
  var body = {
    ticker_or_topic: entry.ticker,
    content_type: entry.type,
    planned_date: entry.date,
    status: 'planned',
    channel: entry.channel,
  };
  if (entry.notes !== undefined && entry.notes !== null) {
    body.notes = entry.notes;
  }
  return opts.nocodb.post('Content_Calendar', body);
}

// ---------------------------------------------------------------------------
// getCalendarForDate
// ---------------------------------------------------------------------------

/**
 * Retrieve planned content items for a specific date.
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {{ nocodb: { get: Function } }} opts
 * @returns {Promise<Array>}
 */
async function getCalendarForDate(date, opts) {
  var where = '(planned_date,eq,' + date + ')~and(status,eq,planned)';
  var result = await opts.nocodb.get('Content_Calendar', { where: where });
  return (result && result.list) ? result.list : [];
}

// ---------------------------------------------------------------------------
// checkContentFreshness
// ---------------------------------------------------------------------------

/**
 * Check if we have recently published content for a ticker (within 30 days).
 * @param {string} ticker
 * @param {{ nocodb: { get: Function } }} opts
 * @returns {Promise<{ fresh: boolean, lastPublished: string|null }>}
 *   fresh: true  = article found within 30 days (content is fresh)
 *   fresh: false = no recent coverage
 */
async function checkContentFreshness(ticker, opts) {
  try {
    var thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    var where = '(ticker,eq,' + ticker + ')~and(published_at,gt,' + thirtyDaysAgo + ')';
    var result = await opts.nocodb.get('Articles', { where: where, limit: 1 });
    var records = (result && result.list) ? result.list : [];
    if (records.length === 0) {
      return { fresh: false, lastPublished: null };
    }
    return { fresh: true, lastPublished: records[0].published_at || null };
  } catch (e) {
    console.warn('[content-calendar] checkContentFreshness error for ' + ticker + ': ' + (e && e.message));
    return { fresh: false, lastPublished: null };
  }
}

// ---------------------------------------------------------------------------
// checkCompetitorFeeds
// ---------------------------------------------------------------------------

/**
 * Parse competitor RSS feeds and log items covering tickers we haven't covered recently.
 * @param {{ feeds?: string[], fetchRSS?: Function, nocodb: Object, telegram: Object }} opts
 */
async function checkCompetitorFeeds(opts) {
  var feeds = opts.feeds || [];
  var failCount = 0;
  var allFailed = true;

  for (var i = 0; i < feeds.length; i++) {
    var feedUrl = feeds[i];
    try {
      var xml = await opts.fetchRSS(feedUrl);
      allFailed = false;

      if (!XMLParser) {
        console.warn('[content-calendar] fast-xml-parser not available, skipping feed: ' + feedUrl);
        continue;
      }

      var parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '__cdata' });
      var parsed = parser.parse(xml);
      var channel = parsed && parsed.rss && parsed.rss.channel;
      if (!channel) {
        console.warn('[content-calendar] Unrecognised feed structure (not RSS 2.0): ' + feedUrl);
        continue;
      }

      var items = channel.item;
      if (!items) continue;
      if (!Array.isArray(items)) items = [items];

      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var title = (typeof item.title === 'string')
          ? item.title
          : (item.title && item.title.__cdata) || '';
        var desc = (typeof item.description === 'string')
          ? item.description
          : (item.description && item.description.__cdata) || '';
        var tickers = extractTickers(title + ' ' + desc);

        for (var k = 0; k < tickers.length; k++) {
          var ticker = tickers[k];
          var freshness = await checkContentFreshness(ticker, opts);
          if (!freshness.fresh) {
            await opts.nocodb.post('Competitor_Intel', {
              feed_url: feedUrl,
              item_title: title,
              item_url: item.link || '',
              item_date: item.pubDate || '',
              ticker_mentioned: ticker,
              covered_by_us: false,
              created_at: new Date().toISOString(),
            });
            await opts.telegram.send(
              '[Competitor Intel] ' + ticker + ' mentioned in competitor feed but not covered recently. URL: ' +
              (item.link || 'N/A')
            );
          }
        }
      }
    } catch (err) {
      failCount++;
      console.warn('[content-calendar] Feed error (' + feedUrl + '): ' + (err && err.message));
    }
  }

  if (failCount > 0 && allFailed) {
    await opts.telegram.send(
      '[content-calendar] ERROR: all ' + failCount + ' RSS feeds failed to load'
    );
  }
}

// ---------------------------------------------------------------------------
// checkContentSimilarity (TF-IDF cosine)
// ---------------------------------------------------------------------------

/**
 * Check if new article text is too similar to existing articles for the same ticker.
 * @param {string} newArticleText
 * @param {string} ticker
 * @param {{ nocodb: { get: Function } }} opts
 * @returns {Promise<{ similar: boolean, match: string|null }>}
 *   similar: true if cosine similarity >= 0.85 (inclusive)
 *   match: articleId of the most similar article, or null
 */
async function checkContentSimilarity(newArticleText, ticker, opts) {
  try {
    var result = await opts.nocodb.get('Articles', {
      where: '(ticker,eq,' + ticker + ')~and(status,eq,published)',
      limit: 10,
    });
    var records = (result && result.list) ? result.list : [];
    if (records.length === 0) return { similar: false, match: null };

    var newTruncated = truncateWords(newArticleText, 2000);
    var newTokens = tokenize(newTruncated);

    var corpusTokens = [newTokens];
    var existingTokens = [];
    var existingIds = [];
    for (var i = 0; i < records.length; i++) {
      var t = truncateWords(records[i].body_text || '', 2000);
      var tok = tokenize(t);
      corpusTokens.push(tok);
      existingTokens.push(tok);
      existingIds.push(records[i].id || null);
    }

    var idf = buildIDF(corpusTokens);
    var newTF = buildTF(newTokens);
    var newVec = {};
    var term;
    for (term in newTF) newVec[term] = newTF[term] * (idf[term] || 0);

    var bestScore = 0;
    var bestId = null;
    for (var j = 0; j < existingTokens.length; j++) {
      var tf = buildTF(existingTokens[j]);
      var vec = {};
      for (term in tf) vec[term] = tf[term] * (idf[term] || 0);
      var score = cosineSimilarity(newVec, vec);
      if (score > bestScore) {
        bestScore = score;
        bestId = existingIds[j];
      }
    }

    return { similar: bestScore >= 0.85, match: bestScore >= 0.85 ? bestId : null };
  } catch (e) {
    return { similar: false, match: null };
  }
}

// ---------------------------------------------------------------------------
// scheduleFromEarnings (D7.3)
// ---------------------------------------------------------------------------

/**
 * Schedule article content for tickers with both earnings events and insider activity.
 * Adds 12-second delays between Alpha Vantage calls (free tier limit).
 * @param {{ nocodb: Object, delay?: Function, fetchEarnings?: Function }} opts
 */
async function scheduleFromEarnings(opts) {
  var delayFn = opts.delay || function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  };

  var earnings = [];
  if (opts.fetchEarnings) {
    earnings = await opts.fetchEarnings({ weeks: 4 });
  } else {
    try {
      var earningsModule = require('./earnings-alerts');
      if (earningsModule && earningsModule.fetchEarningsCalendar) {
        earnings = await earningsModule.fetchEarningsCalendar({ weeks: 4 });
      }
    } catch (e) {
      console.warn('[content-calendar] earnings-alerts module not available: ' + (e && e.message));
    }
  }

  for (var i = 0; i < earnings.length; i++) {
    if (i > 0) await delayFn(ALPHA_VANTAGE_DELAY_MS);

    var item = earnings[i];
    try {
      var thirtyDaysAgoAlerts = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      var alertResult = await opts.nocodb.get('Insider_Alerts', {
        where: '(ticker,eq,' + item.ticker + ')~and(created_at,gt,' + thirtyDaysAgoAlerts + ')',
        limit: 1,
      });
      var alerts = (alertResult && alertResult.list) ? alertResult.list : [];
      if (alerts.length === 0) continue;

      var earningsDate = new Date(item.reportDate);
      var scheduledDate = new Date(earningsDate.getTime() - 3 * 24 * 60 * 60 * 1000);
      var scheduledDateStr = scheduledDate.toISOString().split('T')[0];

      await addToCalendar({
        ticker: item.ticker,
        type: 'article',
        date: scheduledDateStr,
        channel: 'blog',
      }, opts);
    } catch (e) {
      console.warn('[content-calendar] scheduleFromEarnings error for ' + item.ticker + ': ' + (e && e.message));
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  addToCalendar: addToCalendar,
  getCalendarForDate: getCalendarForDate,
  checkContentFreshness: checkContentFreshness,
  checkCompetitorFeeds: checkCompetitorFeeds,
  checkContentSimilarity: checkContentSimilarity,
  scheduleFromEarnings: scheduleFromEarnings,
};
