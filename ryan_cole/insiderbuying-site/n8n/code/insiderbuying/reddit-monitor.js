'use strict';

// Fetch polyfill for n8n sandbox
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// W9 Reddit Monitoring
// ---------------------------------------------------------------------------

var SUBREDDITS = [
  'wallstreetbets',
  'stocks',
  'investing',
  'SecurityAnalysis',
  'stockmarket',
];

var SEARCH_KEYWORDS = [
  'insider buying',
  'insider selling',
  'SEC filing',
  'Form 4',
  'insider trading',
  'insider purchase',
  'officer bought',
  'director bought',
  'CEO bought shares',
  'insider activity',
];

var CAT5_SUBREDDITS = ['stocks', 'investing', 'ValueInvesting'];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'http://nocodb:8080';
var NOCODB_TOKEN = process.env.NOCODB_TOKEN || '';
var NOCODB_PROJECT_ID = process.env.NOCODB_PROJECT_ID || '';
var REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
var REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
var REDDIT_REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN || '';

// ---------------------------------------------------------------------------
// HTTP helper (n8n sandbox-compatible)
// ---------------------------------------------------------------------------

function _httpFetch(url, opts) {
  return new Promise(function(resolve, reject) {
    var parsedUrl = new URL(url);
    var lib = parsedUrl.protocol === 'https:' ? _https : _http;
    var method = (opts && opts.method) || 'GET';
    var headers = (opts && opts.headers) ? Object.assign({}, opts.headers) : {};
    var body = (opts && opts.body) || null;
    if (body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    var reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: method,
      headers: headers,
    };
    var req = lib.request(reqOpts, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        var status = res.statusCode;
        var bodyText = data;
        resolve({
          status: status,
          ok: status >= 200 && status < 300,
          json: function() { try { return JSON.parse(bodyText); } catch (e) { return {}; } },
          text: function() { return bodyText; },
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

var _deps = { fetch: _httpFetch };
function _setDeps(overrides) { _deps = overrides || { fetch: _httpFetch }; }

var _nowFn = function() { return new Date(); };
function _setNow(fn) { _nowFn = fn || function() { return new Date(); }; }
function _now() { return _nowFn(); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns an ISO week key like "2026-W13" for the given date.
 */
function getISOWeekKey(date) {
  var d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  var yearStart = new Date(d.getFullYear(), 0, 1);
  var week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
}

/**
 * Returns "YYYY-MM-DD" for the given date in EST (America/New_York).
 */
function getESTDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

// ---------------------------------------------------------------------------
// NocoDB state helpers
// ---------------------------------------------------------------------------

async function getState(key) {
  try {
    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
      + '/Reddit_State?where=(key,eq,' + encodeURIComponent(key) + ')&limit=1';
    var r = await _deps.fetch(url, { headers: { 'xc-token': NOCODB_TOKEN } });
    if (r.status === 200) {
      var data = r.json();
      var items = (data && data.list) ? data.list : [];
      if (items.length > 0 && items[0].value !== undefined) {
        try { return JSON.parse(items[0].value); } catch (_) { return items[0].value; }
      }
    }
    return null;
  } catch (_) { return null; }
}

async function setState(key, value) {
  try {
    var serialized = typeof value === 'string' ? value : JSON.stringify(value);
    var checkUrl = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
      + '/Reddit_State?where=(key,eq,' + encodeURIComponent(key) + ')&limit=1';
    var checkR = await _deps.fetch(checkUrl, { headers: { 'xc-token': NOCODB_TOKEN } });
    var checkData = (checkR.status === 200) ? checkR.json() : { list: [] };
    var existing = ((checkData && checkData.list) || [])[0];
    if (existing && existing.Id) {
      var patchUrl = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
        + '/Reddit_State/' + existing.Id;
      await _deps.fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: serialized }),
      });
    } else {
      var postUrl2 = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
        + '/Reddit_State';
      await _deps.fetch(postUrl2, {
        method: 'POST',
        headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, value: serialized }),
      });
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Reddit auth
// ---------------------------------------------------------------------------

async function getRedditToken() {
  try {
    var cached = await getState('reddit_token');
    if (cached && cached.access_token && cached.expires_at > Date.now()) {
      return cached.access_token;
    }
  } catch (_) {}

  try {
    var creds = Buffer.from(REDDIT_CLIENT_ID + ':' + REDDIT_CLIENT_SECRET).toString('base64');
    var r = await _deps.fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + creds,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'EarlyInsider/1.0',
      },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(REDDIT_REFRESH_TOKEN),
    });
    if (r.status === 200) {
      var data = r.json();
      if (data && data.access_token) {
        await setState('reddit_token', {
          access_token: data.access_token,
          expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
        });
        return data.access_token;
      }
    }
  } catch (_) {}

  return '';
}

// ---------------------------------------------------------------------------
// Skip day check
// ---------------------------------------------------------------------------

async function shouldSkipToday() {
  try {
    var stored = await getState('week_skip_days');
    if (!stored || !Array.isArray(stored.days)) return { skip: false };
    var dayOfWeek = _now().getDay();
    return { skip: stored.days.indexOf(dayOfWeek) !== -1 };
  } catch (_) { return { skip: false }; }
}

// ---------------------------------------------------------------------------
// Job scheduling stub
// ---------------------------------------------------------------------------

async function scheduleThreadReply(commentName, subreddit, threadName) {
  try {
    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID + '/Scheduled_Jobs';
    await _deps.fetch(url, {
      method: 'POST',
      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_type: 'reddit_thread_reply',
        comment_name: commentName,
        subreddit: subreddit,
        thread_name: threadName,
        status: 'pending',
        created_at: new Date().toISOString(),
      }),
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Reddit_Log helper
// ---------------------------------------------------------------------------

async function _logToRedditLog(postUrl, subreddit, text, status) {
  try {
    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID + '/Reddit_Log';
    await _deps.fetch(url, {
      method: 'POST',
      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_url: postUrl || '',
        subreddit: subreddit || '',
        comment_text: text || '',
        status: status || 'posted',
        posted_at: new Date().toISOString(),
      }),
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Filings data fetch
// ---------------------------------------------------------------------------

async function _fetchFilingsForPeriod(days) {
  try {
    var cutoff = new Date(_now().getTime() - days * 86400000).toISOString().split('T')[0];
    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
      + '/Insider_Filings?where=(date,gte,' + cutoff + ')&sort=-value_usd&limit=10';
    var r = await _deps.fetch(url, { headers: { 'xc-token': NOCODB_TOKEN } });
    if (r.status === 200) {
      var data = r.json();
      return (data && data.list) ? data.list : [];
    }
  } catch (_) {}
  return [];
}

// ---------------------------------------------------------------------------
// Section 00 stubs — existing helpers
// ---------------------------------------------------------------------------

/**
 * Combine SEARCH_KEYWORDS with recent ticker names for Reddit search queries.
 */
function buildSearchQueries(recentTickers) {
  var queries = SEARCH_KEYWORDS.slice();

  if (recentTickers && Array.isArray(recentTickers)) {
    recentTickers.forEach(function(ticker) {
      if (ticker && typeof ticker === 'string') {
        queries.push('$' + ticker + ' insider');
        queries.push(ticker + ' insider buying');
      }
    });
  }

  return queries;
}

/**
 * Filter posts by minimum score.
 */
function filterByScore(posts, minScore) {
  if (!posts || !Array.isArray(posts)) return [];
  var threshold = (typeof minScore === 'number') ? minScore : 7;

  return posts.filter(function(post) {
    return post && (post.score || 0) >= threshold;
  });
}

/**
 * Build Claude prompt for drafting a Reddit comment.
 */
function draftComment(post, insiderData) {
  var postTitle = (post && post.title) || '';
  var postBody = (post && post.selftext) || '';
  var subreddit = (post && post.subreddit) || '';

  var ticker = (insiderData && insiderData.ticker) || '';
  var insider = (insiderData && insiderData.insider_name) || '';
  var txType = (insiderData && insiderData.transaction_type) || 'purchased';
  var shares = (insiderData && insiderData.shares) || 0;
  var value = (insiderData && insiderData.value_usd) || 0;
  var date = (insiderData && insiderData.date) || '';

  var dataContext = '';
  if (ticker) {
    dataContext = 'Relevant insider data: ' + insider + ' ' + txType + ' '
      + shares.toLocaleString() + ' shares of $' + ticker;
    if (value > 0) {
      dataContext += ' worth $' + value.toLocaleString();
    }
    if (date) {
      dataContext += ' on ' + date;
    }
    dataContext += '.';
  }

  var prompt = 'You are a knowledgeable retail investor who closely follows SEC insider filings. '
    + 'Write a Reddit comment for r/' + subreddit + ' in response to this post:\n\n'
    + 'Title: "' + postTitle + '"\n'
    + (postBody ? 'Body: "' + postBody.slice(0, 500) + '"\n' : '')
    + '\n'
    + (dataContext ? dataContext + '\n\n' : '')
    + 'RULES:\n'
    + '- 80% genuine value (share the insider data as your own DD/research)\n'
    + '- 20% soft organic (naturally position yourself as someone who tracks this data)\n'
    + '- ABSOLUTELY NO brand names (never mention InsiderBuying, EarlyInsider, or any website)\n'
    + '- ABSOLUTELY NO links or URLs\n'
    + '- Sound like a real Reddit user, match r/' + subreddit + ' tone\n'
    + '- 3-5 sentences only\n'
    + '- If you mention insider filing data, present it as something you found in SEC filings yourself\n'
    + '- Do not say "I track insider buying" or anything that sounds like a pitch\n\n'
    + 'Comment:';

  return {
    prompt: prompt,
    maxTokens: 200,
  };
}

/**
 * Validate a drafted comment before posting.
 */
function validateComment(text) {
  var issues = [];

  if (!text || typeof text !== 'string') {
    return { valid: false, issues: ['Comment text is empty'] };
  }

  var urlPattern = /https?:\/\/|www\.|\.com|\.io|\.ai|\.org|\.net/i;
  if (urlPattern.test(text)) {
    issues.push('Contains a URL or domain name');
  }

  var brandNames = ['InsiderBuying', 'EarlyInsider', 'earlyinsider.com', 'insiderbuying.ai'];
  brandNames.forEach(function(brand) {
    if (text.toLowerCase().indexOf(brand.toLowerCase()) !== -1) {
      issues.push('Contains brand name: ' + brand);
    }
  });

  var sentences = text.split('. ').filter(function(s) {
    return s.trim().length > 0;
  });
  if (sentences.length < 3) {
    issues.push('Too few sentences (got ' + sentences.length + ', need 3-5)');
  }
  if (sentences.length > 5) {
    issues.push('Too many sentences (got ' + sentences.length + ', need 3-5)');
  }

  return {
    valid: issues.length === 0,
    issues: issues,
  };
}

/**
 * Build NocoDB record for Reddit_Log table.
 */
function logComment(postUrl, subreddit, text, status) {
  return {
    post_url: postUrl || '',
    subreddit: subreddit || '',
    comment_text: text || '',
    status: status || 'posted',
    posted_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Section 04 — CAT 5 Daily Thread
// ---------------------------------------------------------------------------

async function getDailyThreadTarget() {
  var stored = await getState('daily_thread_sub_index');
  var index = typeof stored === 'number' ? stored : 0;
  var subreddit = CAT5_SUBREDDITS[index % CAT5_SUBREDDITS.length];
  await setState('daily_thread_sub_index', (index + 1) % CAT5_SUBREDDITS.length);
  return subreddit;
}

async function shouldPostDailyThread() {
  var now = _now();
  // Derive weekday in EST — n8n VPS runs UTC so getDay() would be UTC
  var estStr = getESTDateString(now); // "YYYY-MM-DD" in EST
  var parts = estStr.split('-');
  var estUtc = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  var dayOfWeek = estUtc.getUTCDay(); // 0=Sun, 6=Sat, timezone-safe
  if (dayOfWeek === 0 || dayOfWeek === 6) return { post: false };

  var skipResult = await shouldSkipToday();
  if (skipResult.skip) return { post: false };

  var isWeekendRecap = dayOfWeek === 1; // Monday
  return { post: true, isWeekendRecap: isWeekendRecap };
}

async function findDailyDiscussionThread(subreddit) {
  var token = await getRedditToken();
  var now = _now();
  var todayEST = getESTDateString(now);

  function isToday(created_utc) {
    return getESTDateString(new Date(created_utc * 1000)) === todayEST;
  }

  function isDailyThread(title) {
    return /daily\s*(discussion|thread)/i.test(title);
  }

  var headers = { 'Authorization': 'Bearer ' + token, 'User-Agent': 'EarlyInsider/1.0' };

  // Layer 1: sticky 1
  try {
    var r1 = await _deps.fetch(
      'https://oauth.reddit.com/r/' + subreddit + '/about/sticky?num=1',
      { headers: headers }
    );
    if (r1.status === 200) {
      var d1 = r1.json().data;
      if (d1 && isDailyThread(d1.title) && isToday(d1.created_utc)) return d1;
    }
  } catch (_) {}

  // Layer 2: sticky 2
  try {
    var r2 = await _deps.fetch(
      'https://oauth.reddit.com/r/' + subreddit + '/about/sticky?num=2',
      { headers: headers }
    );
    if (r2.status === 200) {
      var d2 = r2.json().data;
      if (d2 && isDailyThread(d2.title) && isToday(d2.created_utc)) return d2;
    }
  } catch (_) {}

  // Layer 3: hot posts
  try {
    var r3 = await _deps.fetch(
      'https://oauth.reddit.com/r/' + subreddit + '/hot?limit=5',
      { headers: headers }
    );
    if (r3.status === 200) {
      var posts3 = r3.json().data.children.map(function(c) { return c.data; });
      var match3 = posts3.find(function(p) { return isDailyThread(p.title) && isToday(p.created_utc); });
      if (match3) return match3;
    }
  } catch (_) {}

  // Layer 4: search (last resort, may lag 2+ hours)
  try {
    var q = encodeURIComponent('Daily Discussion');
    var r4 = await _deps.fetch(
      'https://oauth.reddit.com/r/' + subreddit + '/search?q=' + q + '&sort=new&restrict_sr=1&limit=10',
      { headers: headers }
    );
    if (r4.status === 200) {
      var posts4 = r4.json().data.children.map(function(c) { return c.data; });
      var match4 = posts4.find(function(p) { return isDailyThread(p.title) && isToday(p.created_utc); });
      if (match4) return match4;
    }
  } catch (_) {}

  return null;
}

function _formatDollar(usd) {
  if (usd >= 1000000) return '$' + (usd / 1000000).toFixed(1) + 'M';
  if (usd >= 1000) return '$' + (usd / 1000).toFixed(0) + 'K';
  return '$' + usd;
}

var CAT5_TEMPLATES = [
  // 0: notable_buys
  function(data) {
    if (!data.filings || data.filings.length === 0) {
      return 'No notable insider buying activity in the last trading session.';
    }
    var lines = data.filings.slice(0, 4).map(function(f) {
      return '- **$' + f.ticker + '** — ' + f.role + ' bought ' + _formatDollar(f.value_usd) + ' on ' + f.date;
    }).join('\n');
    return '**Notable insider buying ' + (data.period || 'yesterday') + ':**\n\n'
      + lines + '\n\nForm 4 data via SEC EDGAR. Make of it what you will.';
  },
  // 1: confidence_index
  function(data) {
    var count = data.filings ? data.filings.length : 0;
    var topFiling = data.filings && data.filings[0];
    var topLine = topFiling
      ? 'Top filing: ' + topFiling.role + ' at $' + topFiling.ticker + ' — ' + _formatDollar(topFiling.value_usd)
      : 'No standout filing.';
    return '**Insider Confidence Index — ' + (data.period || 'yesterday') + ':** '
      + count + ' significant Form 4 purchases filed.\n\n'
      + topLine + '\n\nHigher count = more executives putting their own money in.';
  },
  // 2: unusual_activity
  function(data) {
    if (!data.filings || data.filings.length === 0) {
      return 'No unusual insider activity patterns detected in recent filings.';
    }
    var top = data.filings[0];
    return '**Unusual Form 4 pattern flagged — $' + top.ticker + ':** '
      + top.role + ' (' + top.insider_name + ') purchased '
      + _formatDollar(top.value_usd) + ' on ' + top.date
      + '. This represents an unusual cluster relative to baseline.'
      + ' Worth watching price action over the next 30 days.';
  },
];

function buildDailyThreadComment(data, templateIndex) {
  var fn = CAT5_TEMPLATES[templateIndex % 3];
  return fn(data);
}

async function postDailyThread() {
  var shouldPost = await shouldPostDailyThread();
  if (!shouldPost.post) { console.log('[CAT5] no post today'); return; }

  var subreddit = await getDailyThreadTarget();

  var thread = await findDailyDiscussionThread(subreddit);
  if (!thread) {
    console.log('[CAT5] no daily thread found for ' + subreddit + ' — skipping');
    return;
  }

  var period = shouldPost.isWeekendRecap ? 'Fri-Sun' : 'yesterday';
  var filings = await _fetchFilingsForPeriod(shouldPost.isWeekendRecap ? 3 : 1);

  var storedIndex = await getState('daily_thread_template_index');
  var templateIndex = typeof storedIndex === 'number' ? storedIndex : 0;
  await setState('daily_thread_template_index', (templateIndex + 1) % 3);

  var commentText = buildDailyThreadComment({ filings: filings, period: period }, templateIndex);

  var token = await getRedditToken();
  var res = await _deps.fetch('https://oauth.reddit.com/api/comment', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'EarlyInsider/1.0',
    },
    body: 'thing_id=' + encodeURIComponent(thread.name) + '&text=' + encodeURIComponent(commentText),
  });

  var result = res.json();
  var comment = result && result.json && result.json.data && result.json.data.things
    && result.json.data.things[0] && result.json.data.things[0].data;
  if (!comment) {
    console.warn('[CAT5] Reddit post comment returned no data — skipping');
    return;
  }

  await _logToRedditLog(
    thread.url || ('https://www.reddit.com/r/' + subreddit),
    subreddit,
    commentText,
    'posted'
  );
  await scheduleThreadReply(comment.name, subreddit, thread.name);

  console.log('[CAT5] posted to ' + subreddit + ' daily thread, comment ' + comment.name);
}

// ---------------------------------------------------------------------------
// Section 06 constants (defined early — used by _callClaude default system)
// ---------------------------------------------------------------------------

var NEGATIVE_EXAMPLES = 'STYLE GUIDE — FEW-SHOT EXAMPLES:\n\n'
  + 'BAD (do not write like this):\n'
  + '"It\'s worth noting that insider buying activity has increased significantly, which could'
  + ' potentially indicate positive sentiment from company leadership regarding future prospects.'
  + ' This might be seen as a bullish signal by some investors, though of course there are no guarantees."\n\n'
  + 'Why it\'s bad: passive voice, hedge stacking, vague corporate language, no specific data, says nothing.\n\n'
  + 'GOOD (write like this):\n'
  + '"CEO just dropped $2M on this at $142. Last 3 times he bought, stock was up 20%+ within 6 months.'
  + ' Whether that continues — who knows. But it\'s the data."\n\n'
  + 'Why it\'s good: direct, specific dollar amounts, specific timeframes, personality, no recommendation.\n\n'
  + 'AVOID: "it is worth noting", "it is important to consider", "one could argue", "this may suggest",\n'
  + '"in conclusion", "furthermore", "it should be noted", "as we can see".';

var ANTI_PUMP_RULE = 'NEVER explicitly recommend buying or say a stock will go up.'
  + ' Present data only. Let the data speak. You are sharing an observation, not giving financial advice.';

var SUBREDDIT_TONE_MAP = {
  stocks: { style: 'balanced, conversational', wordLimit: [100, 150] },
  wallstreetbets: { style: 'casual, degen energy, brief, emojis OK', wordLimit: [50, 100] },
  investing: { style: 'measured, analytical, cite sources', wordLimit: [100, 200] },
  ValueInvesting: { style: 'analytical, precise, cite key ratios', wordLimit: [150, 250] },
  SecurityAnalysis: { style: 'formal, data-driven, academic tone', wordLimit: [150, 300] },
};

// ---------------------------------------------------------------------------
// _callClaude — shared Claude API helper
// ---------------------------------------------------------------------------

async function _callClaude(userMessage, options) {
  var opts = options || {};
  var defaultSystem = NEGATIVE_EXAMPLES + '\n\n' + ANTI_PUMP_RULE;
  var system = opts.system !== undefined ? opts.system : defaultSystem;
  var maxTokens = opts.maxTokens || 300;
  var temperature = (opts.temperature !== undefined) ? opts.temperature : 0.7;

  var res = await _deps.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      temperature: temperature,
      system: system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (res.status !== 200) throw new Error('Claude API error: HTTP ' + res.status);
  var data = res.json();
  var text = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : '';
  if (!text) console.warn('[_callClaude] empty response from Claude API');
  return text;
}

// ---------------------------------------------------------------------------
// Section 05 — CAT 6 DD Posts
// ---------------------------------------------------------------------------

/**
 * Validate a long-form DD post. Requires word count >= 400 and a Bear Case section.
 */
function validateDDPost(text) {
  var issues = [];
  if (!text || typeof text !== 'string') {
    return { valid: false, issues: ['Empty text'] };
  }
  var words = text.trim().split(/\s+/).length;
  if (words < 400) {
    issues.push('Too short: ' + words + ' words (need 400+)');
  }
  if (!/##\s*Bear Case/i.test(text)) {
    issues.push('Missing Bear Case section');
  }
  return { valid: issues.length === 0, issues: issues };
}

/**
 * Check NocoDB Reddit_DD_Posts for rate-limit constraints.
 * Returns { allowed: true } or { allowed: false, reason: 'too_recent'|'monthly_limit' }.
 */
async function checkDDPostLimit() {
  try {
    var now = _now();
    var threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    var where = encodeURIComponent('(status,eq,posted)~and(posted_at,gte,' + monthStart + ')');
    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
      + '/Reddit_DD_Posts?where=' + where + '&limit=20';
    var res = await _deps.fetch(url, { headers: { 'xc-token': NOCODB_TOKEN } });
    var rows = (res.json().list || []);
    var posted = rows.filter(function(r) { return r.status === 'posted'; });

    if (posted.length >= 8) return { allowed: false, reason: 'monthly_limit' };
    if (posted.some(function(r) { return new Date(r.posted_at) >= new Date(threeDaysAgo); })) {
      return { allowed: false, reason: 'too_recent' };
    }
  } catch (_) {}
  return { allowed: true };
}

/**
 * Build a long-form DD post via 4 sequential Claude calls.
 * Returns post text string or null on validation failure.
 */
async function buildDDPost(ticker, data) {
  var NFA = '\n\nNot financial advice. Do your own research.';

  // Step 1: Outline
  var outline = await _callClaude(
    'Generate a detailed outline for a due-diligence Reddit post on $' + ticker
    + '. Include sections: Discovery, Company Brief, Insider Activity Table, Fundamentals,'
    + ' Bull Case (5 catalysts), Bear Case (3 genuine risks), Valuation, What I\'m Watching,'
    + ' Positions, TLDR. 2-3 bullet points per section.',
    { maxTokens: 300 }
  );

  // Step 2: Full draft
  var draftPrompt = 'Using this outline:\n' + outline + '\n\nAnd this insider data:\n'
    + JSON.stringify(data) + '\n\nWrite a full Reddit DD post. First person. You are a retail'
    + ' investor who found this while screening Form 4s.'
    + ' Start with: "I was screening Form 4s last week when I noticed...".'
    + ' Bear Case must be >= 400 words and genuinely skeptical.';
  var draft = await _callClaude(draftPrompt, { maxTokens: 3500 });

  // Validate — retry once if needed
  var validation = validateDDPost(draft);
  if (!validation.valid) {
    var failReason = validation.issues.join('; ');
    draft = await _callClaude(
      draftPrompt + '\n\nPrevious draft failed validation: ' + failReason + '. Fix these issues.',
      { maxTokens: 3500 }
    );
    validation = validateDDPost(draft);
    if (!validation.valid) {
      console.error('[CAT6] buildDDPost validation failed after retry for ' + ticker);
      return null;
    }
  }

  // Step 3: Bear case review
  var bearMatch = draft.match(/##\s*Bear Case\s*\n([\s\S]*?)(?=\n##|$)/i);
  var bearCase = bearMatch ? bearMatch[0] : '';
  var bearReview = await _callClaude(
    'Review this bear case section:\n\n' + bearCase
    + '\n\nRate its authenticity 1-10. If < 7, provide a rewritten version with genuine,'
    + ' specific risks. Format: "Score: N\\n[rewrite if needed]"',
    { maxTokens: 1000 }
  );
  var scoreMatch = bearReview.match(/Score:\s*(\d+)/i);
  var score = scoreMatch ? parseInt(scoreMatch[1]) : 8;
  if (score < 7 && bearReview.length > 50) {
    var rewriteStart = bearReview.indexOf('\n') + 1;
    var rewrite = bearReview.slice(rewriteStart).trim();
    if (rewrite.length > 100) {
      draft = draft.replace(/##\s*Bear Case\s*\n[\s\S]*?(?=\n##|$)/i, rewrite);
    }
  }

  // Step 4: TLDR
  var tldr = await _callClaude(
    'Write a 3-4 bullet TLDR for this DD post. Each bullet must be specific (include $' + ticker
    + ', dollar amounts, dates where applicable):\n\n' + draft.slice(0, 2000),
    { maxTokens: 200 }
  );
  var tldrBlock = tldr.startsWith('## TLDR') ? tldr : '## TLDR\n' + tldr;

  return tldrBlock + '\n\n' + draft;
}

/**
 * Select target subreddits for a DD post based on score, marketCap, and metric count.
 */
function _selectDDSubreddits(score, marketCapUsd, fundamentalMetricCount) {
  var subs = ['stocks'];
  if (score >= 8 && marketCapUsd >= 5000000000) subs.push('wallstreetbets');
  if (fundamentalMetricCount >= 3) subs.push('ValueInvesting');
  return subs;
}

var NFA_DISCLAIMER = '\n\nNot financial advice. Do your own research.';
var MAX_REDDIT_CHARS = 38000;

/**
 * Build per-subreddit text variants. stocks = body unchanged. Others get a 1-2 sentence opener.
 */
async function _buildSubredditVariants(subreddits, body, ticker) {
  var variants = {};
  for (var i = 0; i < subreddits.length; i++) {
    var sub = subreddits[i];
    var text;
    if (sub === 'stocks') {
      text = body;
    } else {
      var toneMap = {
        wallstreetbets: 'WSB-style intro (casual degen, brief, emoji OK)',
        ValueInvesting: 'ValueInvesting-style intro (analytical, measured, cite one key ratio)',
      };
      var tone = toneMap[sub] || 'conversational intro';
      var opener = await _callClaude(
        'Write a ' + tone + ' for a DD post on $' + ticker + '. 1-2 sentences only. No hype.',
        { maxTokens: 100 }
      );
      text = opener.trim() + '\n\n' + body;
    }
    text = text + NFA_DISCLAIMER;
    if (text.length > MAX_REDDIT_CHARS) {
      var trimTo = MAX_REDDIT_CHARS - NFA_DISCLAIMER.length;
      text = text.slice(0, trimTo) + NFA_DISCLAIMER;
    }
    variants[sub] = text;
  }
  return variants;
}

/**
 * Upload DD post visuals to Imgur. Returns array of { label, url } links.
 * Skips gracefully if visual-templates return null or Imgur fails.
 */
async function _uploadDDVisuals(ticker, filings, priceData, peers) {
  var vt = require('./visual-templates.js');
  var visuals = [
    { label: 'Insider Transaction Table', base64: vt.generateInsiderTable(filings) },
    { label: 'Price Chart', base64: vt.generatePriceChart(ticker, priceData) },
    { label: 'Peer Radar', base64: vt.generatePeerRadar(ticker, peers) },
  ];
  var links = [];
  for (var i = 0; i < visuals.length; i++) {
    var v = visuals[i];
    if (!v.base64) continue;
    try {
      var res = await _deps.fetch('https://api.imgur.com/3/image', {
        method: 'POST',
        headers: {
          'Authorization': 'Client-ID ' + (process.env.IMGUR_CLIENT_ID || ''),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: v.base64, type: 'base64', title: v.label }),
      });
      var data = res.json();
      if (data.data && data.data.link) links.push({ label: v.label, url: data.data.link });
    } catch (err) {
      console.warn('[CAT6] Imgur upload failed for ' + v.label + ': ' + (err && err.message));
    }
  }
  return links;
}

/**
 * Select the best ticker for today's DD post from NocoDB Insider_Filings.
 * Returns null if no suitable ticker found.
 */
async function _selectDDTicker() {
  try {
    var cutoff = new Date(_now().getTime() - 7 * 86400000).toISOString().split('T')[0];
    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID
      + '/Insider_Filings?where=(date,gte,' + cutoff + ')&sort=-score&limit=5';
    var r = await _deps.fetch(url, { headers: { 'xc-token': NOCODB_TOKEN } });
    if (r.status !== 200) return null;
    var data = r.json();
    var list = (data && data.list) ? data.list : [];
    if (list.length === 0) return null;
    var record = list[0];
    return {
      ticker: record.ticker,
      filings: [record],
      score: record.score || 7,
      marketCapUsd: record.marketCapUsd || 0,
      priceAtPost: record.price || 0,
      priceHistory: [],
      peers: [],
    };
  } catch (_) { return null; }
}

/**
 * Insert a record to NocoDB Reddit_DD_Posts.
 */
async function _insertDDPostLog(info) {
  try {
    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID + '/Reddit_DD_Posts';
    await _deps.fetch(url, {
      method: 'POST',
      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: info.ticker || '',
        post_url: info.post_url || '',
        subreddit: info.subreddit || '',
        price_at_post: info.price_at_post || 0,
        authenticity_score: info.authenticity_score || 0,
        status: info.status || 'posted',
        posted_at: new Date().toISOString(),
      }),
    });
  } catch (_) {}
}

/**
 * Count fundamental metric keywords in post text (P/E, EV/EBITDA, ROE, etc.).
 */
function _countFundamentalMetrics(text) {
  if (!text) return 0;
  var metrics = ['P/E', 'EV/EBITDA', 'ROE', 'ROA', 'ROIC', 'P/S', 'P/B', 'debt/equity',
    'free cash flow', 'FCF', 'gross margin', 'net margin', 'revenue growth', 'earnings growth'];
  var lower = text.toLowerCase();
  return metrics.filter(function(m) { return lower.includes(m.toLowerCase()); }).length;
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Insert a scheduled job to NocoDB Scheduled_Jobs.
 */
async function insertJob(jobType, data, delayMs) {
  try {
    var url = NOCODB_BASE_URL + '/api/v1/db/data/noco/' + NOCODB_PROJECT_ID + '/Scheduled_Jobs';
    await _deps.fetch(url, {
      method: 'POST',
      headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_type: jobType,
        payload: JSON.stringify(data),
        run_after_ms: delayMs || 0,
        status: 'pending',
        created_at: new Date().toISOString(),
      }),
    });
  } catch (_) {}
}

/**
 * Schedule follow-up DD reply jobs.
 */
async function scheduleDDReplies(postName, subreddit, ticker) {
  try {
    var delays = [1800000, 3600000, 7200000]; // 30 min, 1 hr, 2 hr
    for (var i = 0; i < delays.length; i++) {
      await insertJob('reddit_dd_reply', { postName: postName, subreddit: subreddit, ticker: ticker }, delays[i]);
    }
  } catch (_) {}
}

/**
 * CAT 6 entry point — post a long-form DD post to relevant subreddits.
 */
async function postDDPost() {
  // 1. Frequency gate
  var limitResult = await checkDDPostLimit();
  if (!limitResult.allowed) {
    console.log('[CAT6] limit: ' + limitResult.reason);
    return;
  }

  // 2. Day/time gate (Tue-Thu, 10AM-2PM EST)
  var now = _now();
  var estDay = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(now);
  var estHourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(now);
  var estHour = parseInt(estHourStr);
  if (['Tue', 'Wed', 'Thu'].indexOf(estDay) === -1) {
    console.log('[CAT6] wrong day: ' + estDay);
    return;
  }
  if (estHour < 10 || estHour >= 14) {
    console.log('[CAT6] outside window: ' + estHour + ':00 EST');
    return;
  }

  // 3. Select ticker
  var data = await _selectDDTicker();
  if (!data) { console.log('[CAT6] no suitable ticker'); return; }
  var ticker = data.ticker;
  var filings = data.filings;
  var score = data.score;
  var marketCapUsd = data.marketCapUsd;
  var priceAtPost = data.priceAtPost;

  // 4. Build DD post (4 Claude calls)
  var ddBody = await buildDDPost(ticker, data);
  if (!ddBody) return;

  // 5. Human-likeness check
  var humanCheck = await _callClaude(
    'Rate this post\'s human-likeness 1-10. If < 7, identify 3 specific AI-sounding phrases'
    + ' and provide rewritten versions:\n\n' + ddBody.slice(0, 3000),
    { maxTokens: 500 }
  );
  var humanMatch = humanCheck.match(/\b([0-9]|10)\b/);
  var humanScore = humanMatch ? parseInt(humanMatch[0]) : 8;
  var finalBody = ddBody;
  if (humanScore < 7) {
    finalBody = await _callClaude(
      'Apply these rewrites to the post:\n' + humanCheck + '\n\nOriginal:\n' + ddBody,
      { maxTokens: 3500 }
    );
    var recheckText = await _callClaude(
      'Rate human-likeness 1-10:\n' + finalBody.slice(0, 2000),
      { maxTokens: 50 }
    );
    var recheckMatch = recheckText.match(/\b([0-9]|10)\b/);
    var recheckScore = recheckMatch ? parseInt(recheckMatch[0]) : 8;
    if (recheckScore < 7) {
      console.error('[CAT6] human-likeness < 7 after rewrite — aborting');
      return;
    }
  }

  // 6. Upload visuals
  var imageLinks = await _uploadDDVisuals(ticker, filings, data.priceHistory, data.peers);
  if (imageLinks.length > 0) {
    var markdownImages = imageLinks.map(function(l) { return '[' + l.label + '](' + l.url + ')'; }).join('\n');
    finalBody = finalBody.replace('## Bull Case', markdownImages + '\n\n## Bull Case');
  }

  // 7. Determine target subreddits and build per-sub variants
  var fundamentalMetricCount = _countFundamentalMetrics(finalBody);
  var targetSubs = _selectDDSubreddits(score, marketCapUsd, fundamentalMetricCount);
  var variants = await _buildSubredditVariants(targetSubs, finalBody, ticker);

  // 8. Post to each subreddit
  var token = await getRedditToken();
  var subEntries = Object.keys(variants);
  for (var si = 0; si < subEntries.length; si++) {
    var sub = subEntries[si];
    var text = variants[sub];
    try {
      var postRes = await _deps.fetch('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'EarlyInsider/1.0',
        },
        body: 'sr=' + sub + '&kind=self&title='
          + encodeURIComponent('$' + ticker + ' DD: Insider cluster buy — ' + (score >= 8 ? 'high conviction' : 'notable'))
          + '&text=' + encodeURIComponent(text),
      });
      var postData = postRes.json();
      var postName = postData && postData.json && postData.json.data && postData.json.data.name;
      var postUrl = (postData && postData.json && postData.json.data && postData.json.data.url)
        || ('https://www.reddit.com/r/' + sub);

      // 9. Log to Reddit_DD_Posts
      await _insertDDPostLog({
        ticker: ticker,
        post_url: postUrl,
        subreddit: sub,
        price_at_post: priceAtPost,
        authenticity_score: humanScore,
        status: 'posted',
      });

      // 10. Schedule AMA and follow-up replies
      await insertJob('reddit_ama', { postId: postName, subreddit: sub, ticker: ticker }, randomBetween(300000, 600000));
      await scheduleDDReplies(postName, sub, ticker);

      console.log('[CAT6] posted DD on ' + sub + ': ' + postUrl);
    } catch (err) {
      console.error('[CAT6] failed to post to ' + sub + ': ' + (err && err.message));
    }
  }
}

// ---------------------------------------------------------------------------
// Section 06 — Anti-AI Detection
// ---------------------------------------------------------------------------

/**
 * Build and send a comment prompt via Claude API.
 * Replaces the old draftComment() stub with a real Claude call.
 */
async function buildCommentPrompt(post, insiderData, subreddit, structure) {
  var cfg = SUBREDDIT_TONE_MAP[subreddit] || {};
  var wordRange = cfg.wordLimit ? (cfg.wordLimit[0] + '-' + cfg.wordLimit[1] + ' words') : '100-150 words';

  var systemParts = [
    NEGATIVE_EXAMPLES,
    ANTI_PUMP_RULE,
    '\nSUBREDDIT TONE: ' + (cfg.style || 'balanced, conversational'),
    'WORD LIMIT: ' + wordRange,
    'STRUCTURE: ' + (structure && structure.systemPromptInstruction ? structure.systemPromptInstruction : 'Write a relevant reply.'),
  ];
  if (cfg.example) systemParts.push('\nEXAMPLE OF GOOD STYLE FOR THIS SUBREDDIT:\n' + cfg.example);
  var systemPrompt = systemParts.filter(Boolean).join('\n\n');

  var valueMil = insiderData && insiderData.value_usd ? (insiderData.value_usd / 1000000).toFixed(1) : '0';
  var userMessage = 'Reddit post you are replying to:\n'
    + 'Title: ' + ((post && post.title) || '') + '\n'
    + 'Body: ' + ((post && post.selftext) || '(no body)') + '\n'
    + 'Subreddit: r/' + (subreddit || '') + '\n\n'
    + 'Insider filing data:\n'
    + 'Ticker: $' + ((insiderData && insiderData.ticker) || '') + '\n'
    + 'Insider: ' + ((insiderData && insiderData.insider_name) || '') + ' (' + ((insiderData && insiderData.role) || '') + ')\n'
    + 'Transaction: purchased $' + valueMil + 'M worth on ' + ((insiderData && insiderData.date) || '') + '\n'
    + (insiderData && insiderData.track_record ? 'Track record: ' + insiderData.track_record + '\n' : '')
    + '\nWrite a reply that adds value to this thread. Follow the style guide and structure above.';

  var res = await _callClaude(userMessage, {
    system: systemPrompt,
    maxTokens: 300,
    temperature: 0.7,
  });

  if (!res || res.trim().length === 0) {
    console.warn('[buildCommentPrompt] Claude returned empty response');
    return null;
  }

  return res.trim();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Constants
  SUBREDDITS: SUBREDDITS,
  SEARCH_KEYWORDS: SEARCH_KEYWORDS,
  CAT5_SUBREDDITS: CAT5_SUBREDDITS,

  // Section 06 constants
  NEGATIVE_EXAMPLES: NEGATIVE_EXAMPLES,
  ANTI_PUMP_RULE: ANTI_PUMP_RULE,

  // Original helpers
  buildSearchQueries: buildSearchQueries,
  filterByScore: filterByScore,
  draftComment: draftComment,
  validateComment: validateComment,
  logComment: logComment,

  // Test seams
  _setDeps: _setDeps,
  _setNow: _setNow,

  // Utility (exported for test helpers)
  getISOWeekKey: getISOWeekKey,
  getESTDateString: getESTDateString,

  // State helpers
  getState: getState,
  setState: setState,
  shouldSkipToday: shouldSkipToday,
  getRedditToken: getRedditToken,
  scheduleThreadReply: scheduleThreadReply,

  // Section 04 — CAT 5
  getDailyThreadTarget: getDailyThreadTarget,
  shouldPostDailyThread: shouldPostDailyThread,
  findDailyDiscussionThread: findDailyDiscussionThread,
  buildDailyThreadComment: buildDailyThreadComment,
  postDailyThread: postDailyThread,

  // Section 05 — CAT 6 DD Posts
  validateDDPost: validateDDPost,
  checkDDPostLimit: checkDDPostLimit,
  buildDDPost: buildDDPost,
  _selectDDSubreddits: _selectDDSubreddits,
  _buildSubredditVariants: _buildSubredditVariants,
  _uploadDDVisuals: _uploadDDVisuals,
  postDDPost: postDDPost,

  // Section 06 — Anti-AI Detection
  buildCommentPrompt: buildCommentPrompt,
};
