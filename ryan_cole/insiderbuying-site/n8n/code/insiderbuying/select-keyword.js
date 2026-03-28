/**
 * W1 — Keyword Selection Workflow (n8n Code Node)
 *
 * Weekly workflow that generates seed keywords, fetches SEO data from
 * DataForSEO, classifies intent, scores priority, deduplicates against
 * existing NocoDB entries, and selects the top 21 keywords per blog.
 *
 * Trigger: Schedule — every Sunday at midnight EST
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_MAP = {
  A: ['earnings', 'analysis', 'forecast', 'valuation', 'revenue', 'results', 'financials'],
  B: ['why', 'how', 'signal', 'insider', 'buying', 'selling', 'pattern', 'meaning'],
  C: ['vs', 'compare', 'best', 'top', 'alternative', 'which'],
  D: ['strategy', 'guide', 'opinion', 'approach', 'should', 'when'],
};

const INTENT_MULTIPLIERS = {
  A: 1.0,
  B: 1.2,
  C: 0.8,
  D: 0.9,
};

const KEYWORDS_PER_BLOG = 21; // 3/day * 7 days

const BLOG_SEED_PATTERNS = {
  insiderbuying: [
    (ticker) => `insider buying ${ticker}`,
    (ticker) => `insider selling ${ticker}`,
    (ticker) => `Form 4 filing ${ticker}`,
    (ticker) => `insider trading signal ${ticker}`,
    (ticker) => `${ticker} insider transactions`,
  ],
  deepstockanalysis: [
    (ticker) => `${ticker} earnings analysis`,
    (ticker) => `${ticker} stock forecast`,
    (ticker) => `${ticker} valuation`,
    (ticker) => `${ticker} revenue growth`,
  ],
  dividenddeep: [
    (ticker) => `${ticker} dividend safety`,
    (ticker) => `best dividend stocks ${ticker}`,
    (ticker) => `${ticker} payout ratio`,
    (ticker) => `${ticker} dividend yield analysis`,
  ],
};

// Sector-level seeds (no ticker needed)
const BLOG_SECTOR_SEEDS = {
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
    `best dividend stocks ${new Date().getFullYear()}`,
    'dividend aristocrats analysis',
    'high yield dividend safety',
  ],
};

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

function classifyIntent(keyword) {
  if (!keyword || typeof keyword !== 'string') return 'A';

  const lower = keyword.toLowerCase();
  const words = lower.split(/\s+/);

  // Check types in priority order: C and D first (more specific),
  // then B, then A. This prevents "insider buying strategy guide"
  // from matching B (insider/buying) instead of D (strategy/guide).
  // Use word-boundary matching to avoid "top" matching inside "stopped".
  for (const type of ['C', 'D', 'B', 'A']) {
    for (const signal of TYPE_MAP[type]) {
      const re = new RegExp(`\\b${signal}\\b`, 'i');
      if (re.test(lower)) {
        return type;
      }
    }
  }

  return 'A'; // default
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

function computePriorityScore(searchVolume, difficulty, intentMultiplier) {
  const vol = searchVolume || 0;
  const diff = difficulty || 0;
  const mult = intentMultiplier || 1.0;
  return Math.round(vol * (1 - diff / 100) * mult * 100) / 100;
}

// ---------------------------------------------------------------------------
// Seed keyword generation
// ---------------------------------------------------------------------------

function generateSeedKeywords(blog, tickers) {
  const patterns = BLOG_SEED_PATTERNS[blog];
  if (!patterns) return [];

  const seeds = [];

  // Ticker-based seeds
  for (const ticker of (tickers || [])) {
    for (const pattern of patterns) {
      seeds.push(pattern(ticker));
    }
  }

  // Sector-level seeds
  const sectorSeeds = BLOG_SECTOR_SEEDS[blog] || [];
  seeds.push(...sectorSeeds);

  return seeds;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function isDuplicate(keyword, existingKeywords) {
  if (!keyword || !existingKeywords || existingKeywords.length === 0) return false;
  const lower = keyword.toLowerCase().trim();
  return existingKeywords.some((existing) =>
    existing.toLowerCase().trim() === lower
  );
}

// ---------------------------------------------------------------------------
// Top keyword selection
// ---------------------------------------------------------------------------

function selectTopKeywords(candidates, limit = KEYWORDS_PER_BLOG) {
  return [...candidates]
    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// DataForSEO API helpers
// ---------------------------------------------------------------------------

function buildDataForSEOAuth(login, password) {
  const encoded = Buffer.from(`${login}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

async function fetchSearchVolume(keywords, auth, opts = {}) {
  const { fetchFn } = opts;
  if (!fetchFn) throw new Error('fetchFn is required');

  const response = await fetchFn(
    `${DATAFORSEO_BASE}/keywords_data/google_ads/search_volume/live`,
    {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        keywords,
        location_code: 2840, // US
        language_code: 'en',
      }]),
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data?.tasks?.[0]?.result || [];
}

async function fetchRelatedKeywords(keywords, auth, opts = {}) {
  const { fetchFn } = opts;
  if (!fetchFn) throw new Error('fetchFn is required');

  const response = await fetchFn(
    `${DATAFORSEO_BASE}/keywords_data/google_ads/keywords_for_keywords/live`,
    {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        keywords,
        location_code: 2840,
      }]),
    }
  );

  if (!response.ok) return [];
  const data = await response.json();
  return data?.tasks?.[0]?.result || [];
}

// ---------------------------------------------------------------------------
// Full keyword pipeline for one blog
// ---------------------------------------------------------------------------

async function runKeywordPipeline(blog, tickers, existingKeywords, opts = {}) {
  const { fetchFn, dataForSEOAuth } = opts;

  // Step 1: Generate seeds
  const seeds = generateSeedKeywords(blog, tickers);
  if (seeds.length === 0) {
    return { blog, keywords: [], warning: `No seed patterns for blog: ${blog}` };
  }

  let allCandidates = [];

  // Step 2: Fetch SEO data (if DataForSEO available)
  if (fetchFn && dataForSEOAuth) {
    try {
      const [volumeResults, relatedResults] = await Promise.allSettled([
        fetchSearchVolume(seeds, dataForSEOAuth, { fetchFn }),
        fetchRelatedKeywords(seeds, dataForSEOAuth, { fetchFn }),
      ]);

      // Process volume results
      if (volumeResults.status === 'fulfilled' && volumeResults.value) {
        for (const item of volumeResults.value) {
          if (!item?.keyword) continue;
          const type = classifyIntent(item.keyword);
          allCandidates.push({
            keyword: item.keyword,
            blog,
            search_volume: item.search_volume || 0,
            difficulty: item.keyword_info?.keyword_difficulty || 0,
            cpc: item.cpc || 0,
            article_type: type,
            intent_multiplier: INTENT_MULTIPLIERS[type],
            priority_score: computePriorityScore(
              item.search_volume || 0,
              item.keyword_info?.keyword_difficulty || 0,
              INTENT_MULTIPLIERS[type]
            ),
          });
        }
      }

      // Process related keywords
      if (relatedResults.status === 'fulfilled' && relatedResults.value) {
        for (const item of relatedResults.value) {
          if (!item?.keyword) continue;
          const type = classifyIntent(item.keyword);
          allCandidates.push({
            keyword: item.keyword,
            blog,
            search_volume: item.search_volume || 0,
            difficulty: item.keyword_info?.keyword_difficulty || 0,
            cpc: item.cpc || 0,
            article_type: type,
            intent_multiplier: INTENT_MULTIPLIERS[type],
            priority_score: computePriorityScore(
              item.search_volume || 0,
              item.keyword_info?.keyword_difficulty || 0,
              INTENT_MULTIPLIERS[type]
            ),
          });
        }
      }
    } catch (err) {
      console.warn(`DataForSEO failed for ${blog}: ${err.message}. Falling back to seeds only.`);
    }
  }

  // Fallback: if no API results, use seeds with default scores
  if (allCandidates.length === 0) {
    for (const seed of seeds) {
      const type = classifyIntent(seed);
      allCandidates.push({
        keyword: seed,
        blog,
        search_volume: 0,
        difficulty: 0,
        cpc: 0,
        article_type: type,
        intent_multiplier: INTENT_MULTIPLIERS[type],
        priority_score: 0,
      });
    }
  }

  // Step 3a: Self-dedup within candidate pool (API may return same keyword twice)
  const seen = new Set();
  allCandidates = allCandidates.filter((c) => {
    const key = c.keyword.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Step 3b: Dedup against existing NocoDB keywords
  allCandidates = allCandidates.filter((c) => !isDuplicate(c.keyword, existingKeywords || []));

  // Step 4: Select top 21
  const selected = selectTopKeywords(allCandidates, KEYWORDS_PER_BLOG);

  // Step 5: Warning if too few
  const warning = selected.length < 7
    ? `WARNING: Blog "${blog}" has only ${selected.length} new keywords (< 7 minimum)`
    : null;

  return { blog, keywords: selected, warning };
}

// ---------------------------------------------------------------------------
// Main entry point (for n8n Code node)
// ---------------------------------------------------------------------------

async function selectKeywords(input, helpers) {
  const activeBlogs = input.active_blogs || ['insiderbuying'];
  const tickers = input.tickers || [];
  const existingKeywords = input.existing_keywords || [];
  const dataForSEOLogin = helpers?.env?.DATAFORSEO_LOGIN;
  const dataForSEOPassword = helpers?.env?.DATAFORSEO_PASSWORD;

  const auth = dataForSEOLogin && dataForSEOPassword
    ? buildDataForSEOAuth(dataForSEOLogin, dataForSEOPassword)
    : null;

  const results = [];

  for (const blog of activeBlogs) {
    const result = await runKeywordPipeline(blog, tickers, existingKeywords, {
      fetchFn: helpers?.fetchFn,
      dataForSEOAuth: auth,
    });
    results.push(result);
  }

  return {
    total_keywords: results.reduce((sum, r) => sum + r.keywords.length, 0),
    blogs: results,
    warnings: results.filter((r) => r.warning).map((r) => r.warning),
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
  buildDataForSEOAuth,
  fetchSearchVolume,
  fetchRelatedKeywords,

  // Constants
  TYPE_MAP,
  INTENT_MULTIPLIERS,
  KEYWORDS_PER_BLOG,
  BLOG_SEED_PATTERNS,
  BLOG_SECTOR_SEEDS,
};
