/**
 * W1 -- Keyword Selection Workflow (n8n Code Node)
 *
 * Weekly workflow that generates seed keywords, fetches SEO data from
 * Keywords Everywhere (primary) or DataForSEO (fallback), classifies intent,
 * scores priority, deduplicates against existing NocoDB entries, and selects
 * the top 21 keywords per blog.
 *
 * Trigger: Schedule -- every Sunday at midnight EST
 */

'use strict';

// n8n sandbox requires these built-in module references even when using injected fetchFn
var _https = require('https');
var _http = require('http');
var { URL } = require('url');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var TYPE_MAP = {
  A: ['earnings', 'analysis', 'forecast', 'valuation', 'revenue', 'results', 'financials'],
  B: ['why', 'how', 'signal', 'insider', 'buying', 'selling', 'pattern', 'meaning'],
  C: ['vs', 'compare', 'best', 'top', 'alternative', 'which'],
  D: ['strategy', 'guide', 'opinion', 'approach', 'should', 'when'],
};

var INTENT_MULTIPLIERS = {
  A: 1.0,
  B: 1.2,
  C: 0.8,
  D: 0.9,
};

var KEYWORDS_PER_BLOG = 21; // 3/day * 7 days

var BLOG_SEED_PATTERNS = {
  insiderbuying: [
    function(ticker) { return 'insider buying ' + ticker; },
    function(ticker) { return 'insider selling ' + ticker; },
    function(ticker) { return 'Form 4 filing ' + ticker; },
    function(ticker) { return 'insider trading signal ' + ticker; },
    function(ticker) { return ticker + ' insider transactions'; },
  ],
  deepstockanalysis: [
    function(ticker) { return ticker + ' earnings analysis'; },
    function(ticker) { return ticker + ' stock forecast'; },
    function(ticker) { return ticker + ' valuation'; },
    function(ticker) { return ticker + ' revenue growth'; },
  ],
  dividenddeep: [
    function(ticker) { return ticker + ' dividend safety'; },
    function(ticker) { return 'best dividend stocks ' + ticker; },
    function(ticker) { return ticker + ' payout ratio'; },
    function(ticker) { return ticker + ' dividend yield analysis'; },
  ],
};

// Sector-level seeds (no ticker needed)
var BLOG_SECTOR_SEEDS = {
  insiderbuying: [
    'insider buying signals this week',
    'most significant insider purchases',
    'insider selling warnings',
    'Form 4 cluster buys',
  ],
  deepstockanalysis: [
    'undervalued stocks analysis',
    'growth stocks forecast',
    'stock comparison sector',
  ],
  dividenddeep: [
    'best dividend stocks ' + new Date().getFullYear(),
    'dividend aristocrats analysis',
    'high yield dividend safety',
  ],
};

var DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

// Default KD when KWE omits both seo_difficulty and on_page_difficulty.
// 50 = median difficulty: neither optimistic (0) nor pessimistic (100).
// Penalizes score by 50% relative to kd=0 keywords of equal volume.
var KWE_UNKNOWN_KD = 50;

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

function classifyIntent(keyword) {
  if (!keyword || typeof keyword !== 'string') return 'A';

  var lower = keyword.toLowerCase();

  // Check types in priority order: C and D first (more specific),
  // then B, then A. This prevents "insider buying strategy guide"
  // from matching B (insider/buying) instead of D (strategy/guide).
  for (var i = 0; i < ['C', 'D', 'B', 'A'].length; i++) {
    var type = ['C', 'D', 'B', 'A'][i];
    for (var j = 0; j < TYPE_MAP[type].length; j++) {
      var signal = TYPE_MAP[type][j];
      var re = new RegExp('\\b' + signal + '\\b', 'i');
      if (re.test(lower)) {
        return type;
      }
    }
  }

  return 'A'; // default
}

// ---------------------------------------------------------------------------
// Priority scoring
// Returns score in [0, ~N] range: (volume/1000) * (1 - kd/100)
// Examples: vol=1000 kd=30 -> 0.7 | vol=5000 kd=20 -> 4.0
// INTENT_MULTIPLIERS are not applied here (removed per spec -- use kd+volume only)
// ---------------------------------------------------------------------------

function computePriorityScore(opts) {
  var vol = (opts && opts.volume) || 0;
  var kd = Math.min((opts && opts.kd) || 0, 100);
  return (vol / 1000) * (1 - kd / 100);
}

// ---------------------------------------------------------------------------
// Seed keyword generation
// ---------------------------------------------------------------------------

function generateSeedKeywords(blog, tickers) {
  var patterns = BLOG_SEED_PATTERNS[blog];
  if (!patterns) return [];

  var seeds = [];

  // Ticker-based seeds
  var tickerList = tickers || [];
  for (var i = 0; i < tickerList.length; i++) {
    var ticker = tickerList[i];
    for (var j = 0; j < patterns.length; j++) {
      seeds.push(patterns[j](ticker));
    }
  }

  // Sector-level seeds
  var sectorSeeds = BLOG_SECTOR_SEEDS[blog] || [];
  for (var k = 0; k < sectorSeeds.length; k++) {
    seeds.push(sectorSeeds[k]);
  }

  return seeds;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function isDuplicate(keyword, existingKeywords) {
  if (!keyword || !existingKeywords || existingKeywords.length === 0) return false;
  var lower = keyword.toLowerCase().trim();
  for (var i = 0; i < existingKeywords.length; i++) {
    if (existingKeywords[i].toLowerCase().trim() === lower) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Top keyword selection
// ---------------------------------------------------------------------------

function selectTopKeywords(candidates, limit) {
  var cap = limit !== undefined ? limit : KEYWORDS_PER_BLOG;
  return candidates.slice().sort(function(a, b) {
    return ((b.priority_score || 0) - (a.priority_score || 0));
  }).slice(0, cap);
}

// ---------------------------------------------------------------------------
// Keywords Everywhere (KWE) primary fetch function
// ---------------------------------------------------------------------------

async function fetchKWEKeywords(keywords, opts) {
  var fetchFn = (opts || {}).fetchFn;
  if (!fetchFn) throw new Error('fetchFn is required');

  if (!keywords || keywords.length === 0) return [];

  if (!process.env.KWE_API_KEY) {
    throw new Error('KWE_API_KEY environment variable not set');
  }

  // KWE limit: 100 keywords per request
  var batch = keywords.length > 100 ? keywords.slice(0, 100) : keywords;
  if (keywords.length > 100) {
    console.warn('[SEO] fetchKWEKeywords: truncated to 100 keywords (got ' + keywords.length + ')');
  }

  var response = await fetchFn(
    'https://api.keywordseverywhere.com/v1/get_keyword_data',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.KWE_API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        country: 'us',
        currency: 'usd',
        dataSource: 'gkp',
        'kw[]': batch,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('KWE API error ' + response.status);
  }

  var json = await response.json();
  return (json.data || []).map(function(item) {
    return {
      keyword: item.keyword,
      kd: item.seo_difficulty != null ? item.seo_difficulty
        : (item.on_page_difficulty != null ? item.on_page_difficulty : KWE_UNKNOWN_KD),
      volume: item.vol != null ? item.vol : 0,
      cpc: (item.competition && item.competition.value != null) ? item.competition.value : null,
    };
  });
}

// ---------------------------------------------------------------------------
// DataForSEO fallback (only invoked inside fetchKeywordData wrapper)
// Uses dataforseo_labs/google/keyword_overview/live endpoint
// ---------------------------------------------------------------------------

async function fetchDataForSEOFallback(keywords, opts) {
  var fetchFn = (opts || {}).fetchFn;
  if (!fetchFn) throw new Error('fetchFn is required');

  var login = process.env.DATAFORSEO_LOGIN;
  var password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error('DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD environment variables not set');
  }
  var auth = 'Basic ' + Buffer.from(login + ':' + password).toString('base64');

  var response = await fetchFn(
    DATAFORSEO_BASE + '/dataforseo_labs/google/keyword_overview/live',
    {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        keywords: keywords,
        language_code: 'en',
        location_code: 2840, // US
      }]),
    }
  );

  if (!response.ok) {
    throw new Error('DataForSEO API error ' + response.status);
  }

  var data = await response.json();
  var results = (data && data.tasks && data.tasks[0] && data.tasks[0].result) || [];

  return results.map(function(item) {
    return {
      keyword: item.keyword,
      kd: (item.keyword_properties && item.keyword_properties.keyword_difficulty) || 0,
      volume: (item.keyword_info && item.keyword_info.search_volume) || 0,
      cpc: (item.keyword_info && item.keyword_info.cpc) || null,
    };
  });
}

// ---------------------------------------------------------------------------
// Combined fetch wrapper -- transparent KWE -> DataForSEO fallback
// This is the only function callers inside runKeywordPipeline should use.
// ---------------------------------------------------------------------------

async function fetchKeywordData(keywords, opts) {
  try {
    return await fetchKWEKeywords(keywords, opts);
  } catch (kweErr) {
    console.warn('[SEO] KWE failed, falling back to DataForSEO:', kweErr.message);
    try {
      return await fetchDataForSEOFallback(keywords, opts);
    } catch (dfsErr) {
      throw new Error('[SEO] BOTH providers failed. KWE: ' + kweErr.message + ' | DataForSEO: ' + dfsErr.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Full keyword pipeline for one blog
// ---------------------------------------------------------------------------

async function runKeywordPipeline(blog, tickers, existingKeywords, opts) {
  var fetchFn = (opts || {}).fetchFn;

  // Step 1: Generate seeds
  var seeds = generateSeedKeywords(blog, tickers);
  if (seeds.length === 0) {
    return { blog: blog, keywords: [], warning: 'No seed patterns for blog: ' + blog };
  }

  var allCandidates = [];

  // Step 2: Fetch SEO data via fetchKeywordData (KWE primary, DataForSEO fallback)
  if (fetchFn) {
    try {
      var kwData = await fetchKeywordData(seeds, { fetchFn: fetchFn });

      if (!kwData || kwData.length === 0) {
        console.warn('[SEO] No keyword data returned for blog: ' + blog);
      } else {
        for (var i = 0; i < kwData.length; i++) {
          var item = kwData[i];
          if (!item || !item.keyword) continue;
          var type = classifyIntent(item.keyword);
          allCandidates.push({
            keyword: item.keyword,
            blog: blog,
            kd: item.kd,
            volume: item.volume,
            cpc: item.cpc,
            article_type: type,
            intent_multiplier: INTENT_MULTIPLIERS[type],
            priority_score: computePriorityScore({ kd: item.kd, volume: item.volume }),
          });
        }
      }
    } catch (err) {
      console.warn('[SEO] Keyword data fetch failed for ' + blog + ': ' + err.message + '. Falling back to seeds only.');
    }
  }

  // Fallback: if no API results, use seeds with zero scores
  if (allCandidates.length === 0) {
    for (var j = 0; j < seeds.length; j++) {
      var seed = seeds[j];
      var seedType = classifyIntent(seed);
      allCandidates.push({
        keyword: seed,
        blog: blog,
        kd: 0,
        volume: 0,
        cpc: 0,
        article_type: seedType,
        intent_multiplier: INTENT_MULTIPLIERS[seedType],
        priority_score: 0,
      });
    }
  }

  // Step 3a: Self-dedup within candidate pool
  var seen = new Set();
  allCandidates = allCandidates.filter(function(c) {
    var key = c.keyword.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Step 3b: Dedup against existing NocoDB keywords
  allCandidates = allCandidates.filter(function(c) {
    return !isDuplicate(c.keyword, existingKeywords || []);
  });

  // Step 4: Select top 21
  var selected = selectTopKeywords(allCandidates, KEYWORDS_PER_BLOG);

  // Step 5: Warning if too few
  var warning = selected.length < 7
    ? 'WARNING: Blog "' + blog + '" has only ' + selected.length + ' new keywords (< 7 minimum)'
    : null;

  return { blog: blog, keywords: selected, warning: warning };
}

// ---------------------------------------------------------------------------
// Main entry point (for n8n Code node)
// ---------------------------------------------------------------------------

async function selectKeywords(input, helpers) {
  var activeBlogs = input.active_blogs || ['insiderbuying'];
  var tickers = input.tickers || [];
  var existingKeywords = input.existing_keywords || [];

  var results = [];

  for (var i = 0; i < activeBlogs.length; i++) {
    var blog = activeBlogs[i];
    var result = await runKeywordPipeline(blog, tickers, existingKeywords, {
      fetchFn: helpers && helpers.fetchFn,
    });
    results.push(result);
  }

  return {
    total_keywords: results.reduce(function(sum, r) { return sum + r.keywords.length; }, 0),
    blogs: results,
    warnings: results.filter(function(r) { return r.warning; }).map(function(r) { return r.warning; }),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Core functions (tested)
  classifyIntent,
  computePriorityScore,
  generateSeedKeywords,
  isDuplicate,
  selectTopKeywords,
  runKeywordPipeline,
  selectKeywords,
  fetchKWEKeywords,
  fetchDataForSEOFallback,
  fetchKeywordData,

  // Constants
  TYPE_MAP,
  INTENT_MULTIPLIERS,
  KEYWORDS_PER_BLOG,
  BLOG_SEED_PATTERNS,
  BLOG_SECTOR_SEEDS,
};
