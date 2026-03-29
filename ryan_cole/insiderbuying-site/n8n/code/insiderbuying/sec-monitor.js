/**
 * W4 — SEC EDGAR Filing Monitor (n8n Code Node)
 *
 * Discovers new Form 4 insider buy filings, enriches via Financial Datasets,
 * deduplicates, filters buys-only, classifies insider role, and detects
 * cluster buys. Runs within a 60-second n8n Code node timeout.
 *
 * Output: array of enriched filing objects passed to score-alert.js.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEC_USER_AGENT = 'EarlyInsider.com (alerts@earlyinsider.com)';
const EDGAR_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const FD_BASE_URL = 'https://api.financialdatasets.ai';

// Required environment variables
const REQUIRED_ENV = [
  'NOCODB_API_TOKEN',
  'NOCODB_BASE_URL',
  'NOCODB_PROJECT_ID',
  'FINANCIAL_DATASETS_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Build SEC EDGAR full-text search URL for Form 4 filings.
 * Uses narrow q="form 4" query (NOT q=*).
 */
function buildEdgarUrl(lastCheckDate, today) {
  const params = new URLSearchParams({
    q: '"form 4"',
    forms: '4',
    dateRange: 'custom',
    startdt: lastCheckDate,
    enddt: today,
    start: '0',
    count: '40',
    sort: 'file_date:desc',
  });
  return `${EDGAR_SEARCH_URL}?${params.toString()}`;
}

/**
 * Extract filing metadata from EDGAR search response.
 * Returns [] on malformed/empty responses.
 */
function parseEdgarResponse(responseJson) {
  const hits = responseJson && responseJson.hits && responseJson.hits.hits;
  if (!Array.isArray(hits)) return [];
  return hits.map((hit) => ({
    entity_name: (hit._source && hit._source.entity_name) || '',
    file_date: (hit._source && hit._source.file_date) || '',
    accession_number: hit._id || '',
    // CIK is the first segment of the accession number (already zero-padded)
    cik: (hit._id || '').split('-')[0] || '',
  }));
}

/**
 * Build composite dedup key.
 * Format: {ticker}_{insider_name_underscored}_{transaction_date}_{shares}
 */
function buildDedupKey(ticker, insiderName, transactionDate, shares) {
  const normalizedName = String(insiderName || '').replace(/\s+/g, '_');
  return `${ticker}_${normalizedName}_${transactionDate}_${shares}`;
}

/**
 * Check dedup: returns false (skip) if key already in Set.
 * If key is new, adds it to Set immediately (prevents same-run duplicates)
 * and returns true (proceed).
 */
function passesDedup(dedupKey, existingDedupKeys) {
  if (existingDedupKeys.has(dedupKey)) return false;
  existingDedupKeys.add(dedupKey);
  return true;
}

/**
 * True only for P - Purchase transactions (buy-only filter).
 */
function isBuyTransaction(transactionType) {
  return transactionType === 'P - Purchase';
}

/**
 * Map insider title string to one of five category values.
 * VP is checked before C-Suite to prevent "Vice President" matching "president".
 * is_board_director=true overrides only ambiguous titles (no keyword match found).
 * Explicit keyword matches (VP, Board, C-Suite, 10% Owner) are never overridden.
 */
function classifyInsider(title, isBoardDirector) {
  const t = (title || '').toLowerCase();

  // VP first — unambiguous; board director flag does NOT override explicit VP titles
  if (/vice\s*president|svp|evp|senior\s*vice/i.test(t)) {
    return 'VP';
  }

  // C-Suite — safe after VP check (no false-positive on "vice president")
  if (/\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|chief|(?<![Vv]ice\s)\bpresident\b/i.test(t)) {
    return 'C-Suite';
  }

  // Board by title
  if (/director|board\s*member|chairman|chairwoman/i.test(t)) {
    return 'Board';
  }

  // 10% Owner (specific SEC disclosure category)
  if (/10\s*(%|percent)\s*(owner|beneficial)?/i.test(t)) {
    return '10% Owner';
  }

  // Officer keywords
  if (/treasurer|secretary|controller|general\s*counsel/i.test(t)) {
    return 'Officer';
  }

  // Ambiguous/unrecognized title: board director flag overrides default
  if (isBoardDirector) return 'Board';

  // Default: never crash on unknown titles
  return 'Officer';
}

// ---------------------------------------------------------------------------
// UUID generator (crypto.randomUUID preferred, fallback for older envs)
// ---------------------------------------------------------------------------

function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Async: NocoDB — fetch existing dedup keys (past 7 days)
// ---------------------------------------------------------------------------

/**
 * Returns a Set<string> of dedup_key values from NocoDB Insider_Alerts
 * for the past 7 days. Handles NocoDB offset pagination.
 *
 * @param {Object} opts
 * @param {Object} opts.nocodb  — NocoDB client instance
 */
async function fetchDedupKeys(opts = {}) {
  const { nocodb } = opts;
  const keys = new Set();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  const where = `(filing_date,gt,${sevenDaysAgo})`;

  const LIMIT = 100;
  let offset = 0;
  let isLastPage = false;

  while (!isLastPage) {
    const { list, pageInfo } = await nocodb.list('Insider_Alerts', {
      where,
      sort: '-Id',
      fields: 'dedup_key',
      limit: LIMIT,
      offset,
    });
    for (const record of (list || [])) {
      const key = record.dedup_key;
      if (key != null) keys.add(key);
    }
    isLastPage = !pageInfo || pageInfo.isLastPage === true;
    offset += LIMIT;
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Async: NocoDB — Monitor_State read/write helpers
// ---------------------------------------------------------------------------

/**
 * Read the Monitor_State record for a given workflow name.
 * Returns the record (with integer Id) or null if not found.
 *
 * @param {string} stateName  e.g. 'market'
 * @param {Object} opts
 * @param {Object} opts.nocodb
 */
async function readMonitorState(stateName, opts) {
  const { nocodb } = opts;
  const where = `(name,eq,${stateName})`;
  const result = await nocodb.list('Monitor_State', { where, limit: 1 });
  return (result.list && result.list[0]) || null;
}

/**
 * Write the last_check_timestamp back to Monitor_State.
 *
 * @param {number} stateId    NocoDB integer Id of the record
 * @param {string} timestamp  ISO 8601 timestamp string
 * @param {Object} opts
 * @param {Object} opts.nocodb
 */
async function writeMonitorState(stateId, timestamp, opts) {
  const { nocodb } = opts;
  await nocodb.update('Monitor_State', stateId, { last_check_timestamp: timestamp });
}

// ---------------------------------------------------------------------------
// Async: SEC — load CIK ticker map
// ---------------------------------------------------------------------------

/**
 * Fetch SEC company_tickers.json and build a Map<paddedCik, ticker>.
 * Zero-pads CIK to 10 digits. Re-fetched every run (no stale cache).
 *
 * @param {Object} opts
 * @param {Function} opts.fetchFn
 */
async function loadCikTickerMap(opts = {}) {
  const { fetchFn } = opts;
  const data = await fetchFn(SEC_TICKERS_URL, {
    headers: { 'User-Agent': SEC_USER_AGENT },
  }).then((r) => r.json());

  const map = new Map();
  for (const entry of Object.values(data || {})) {
    if (!entry || entry.cik_str == null || !entry.ticker) continue;
    const paddedCik = String(entry.cik_str).padStart(10, '0');
    map.set(paddedCik, entry.ticker);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Async: Financial Datasets — enrich a single filing
// ---------------------------------------------------------------------------

/**
 * Call Financial Datasets API to get insider trade details for a ticker
 * starting from filingDate. Retries 3x (exponential backoff) on 429/500.
 * Returns null after exhausted retries (does not throw). Empty results also
 * return null but are NOT counted as failures — onFailure is only called on
 * actual API error after 3 retries.
 *
 * @param {string} ticker
 * @param {string} filingDate  YYYY-MM-DD
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {Function} opts.fetchFn
 * @param {Function} [opts._sleep]     — injectable for tests (defaults to real setTimeout)
 * @param {Function} [opts.onFailure]  — called only on real API failure (3 retries exhausted)
 */
async function enrichFiling(ticker, filingDate, opts = {}) {
  const {
    apiKey,
    fetchFn,
    _sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    onFailure = () => {},
  } = opts;

  const url = `${FD_BASE_URL}/insider-trades?ticker=${encodeURIComponent(ticker)}&filing_date_gte=${filingDate}&limit=10`;
  const backoffs = [1000, 3000, 9000];

  // Apply 100ms delay between consecutive filing calls (rate limit mitigation).
  // Placed before the retry loop so retries do NOT add extra 100ms on top of
  // their own exponential backoff delay.
  await _sleep(100);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchFn(url, {
        headers: { 'X-API-KEY': apiKey },
      });
      const data = await res.json();
      const trades = data && data.insider_trades;
      // Empty result: not a failure (ticker simply has no coverage in FD)
      if (!Array.isArray(trades) || trades.length === 0) return null;

      // Return first matching trade (most recent filing for this ticker)
      const trade = trades[0];
      return {
        name: trade.name,
        title: trade.title,
        is_board_director: trade.is_board_director || false,
        transaction_date: trade.transaction_date,
        transaction_shares: trade.transaction_shares,
        transaction_price_per_share: trade.transaction_price_per_share,
        transaction_value: trade.transaction_value,
        transaction_type: trade.transaction_type,
        filing_date: trade.filing_date,
      };
    } catch (err) {
      const isRetryable =
        err.statusCode === 429 || err.statusCode === 500 || !err.statusCode;
      if (!isRetryable || attempt === 2) {
        // Real API failure after exhausted retries
        onFailure(err);
        return null;
      }
      await _sleep(backoffs[attempt]);
    }
  }

  // Unreachable, but defensive
  return null;
}

// ---------------------------------------------------------------------------
// Async: Supabase — detect cluster buy
// ---------------------------------------------------------------------------

/**
 * Query Supabase for other insider buys of the same ticker in the past 7 days,
 * excluding the current insider. Also checks sameRunFilings (in-memory list of
 * filings processed earlier in this run) so same-batch clusters are detected
 * before Supabase writes happen. If a cluster is found, assigns/reuses a
 * cluster_id, UPDATEs Supabase rows, and mutates sameRunFilings entries so
 * results already in the array are retroactively updated.
 *
 * @param {string} ticker
 * @param {string} transactionDate  YYYY-MM-DD
 * @param {string} currentInsiderName
 * @param {Object} opts
 * @param {string} opts.supabaseUrl
 * @param {string} opts.serviceKey      — must be service_role key
 * @param {Function} opts.fetchFn
 * @param {Array}  [opts.sameRunFilings] — mutable array of result objects from
 *                                         earlier in this run (for same-batch detection)
 */
async function detectCluster(ticker, transactionDate, currentInsiderName, opts = {}) {
  const { supabaseUrl, serviceKey, fetchFn, sameRunFilings = [] } = opts;

  const sevenDaysAgo = new Date(
    new Date(transactionDate).getTime() - 7 * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .split('T')[0];

  const supabaseHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Query Supabase: other buys of same ticker in last 7 days, excluding current insider
  const selectUrl =
    `${supabaseUrl}/rest/v1/insider_alerts` +
    `?ticker=eq.${encodeURIComponent(ticker)}` +
    `&transaction_type=eq.buy` +
    `&transaction_date=gte.${sevenDaysAgo}` +
    `&insider_name=neq.${encodeURIComponent(currentInsiderName)}` +
    `&select=id,insider_name,cluster_id,is_cluster_buy`;

  const selectRes = await fetchFn(selectUrl, { headers: supabaseHeaders });
  const priorRows = await selectRes.json();

  // Same-run in-memory matches (filings processed earlier this run, not yet in Supabase)
  const inMemoryMatches = sameRunFilings.filter(
    (f) => f.ticker === ticker && f.insider_name !== currentInsiderName,
  );

  const allPriorMatches = [
    ...(Array.isArray(priorRows) ? priorRows : []),
    ...inMemoryMatches,
  ];

  if (allPriorMatches.length === 0) {
    return { isClusterBuy: false, clusterId: null, clusterSize: 1 };
  }

  // Cluster detected — reuse existing cluster_id or generate new one
  const existingClusterId =
    allPriorMatches.find((r) => r.cluster_id)?.cluster_id || null;
  const clusterId = existingClusterId || generateUUID();
  const clusterSize = allPriorMatches.length + 1; // prior insiders + current

  // UPDATE Supabase rows that don't have this cluster_id yet
  const supabaseRowsToUpdate = (Array.isArray(priorRows) ? priorRows : [])
    .filter((r) => !r.cluster_id || r.cluster_id !== clusterId)
    .map((r) => r.id);

  if (supabaseRowsToUpdate.length > 0) {
    const idList = supabaseRowsToUpdate.map((id) => `"${id}"`).join(',');
    const patchUrl = `${supabaseUrl}/rest/v1/insider_alerts?id=in.(${idList})`;
    await fetchFn(patchUrl, {
      method: 'PATCH',
      headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ cluster_id: clusterId, is_cluster_buy: true }),
    });
  }

  // Retroactively update in-memory sameRunFilings entries (same object references
  // as results[], so the results array is updated too)
  for (const match of inMemoryMatches) {
    match.cluster_id = clusterId;
    match.is_cluster_buy = true;
  }

  return { isClusterBuy: true, clusterId, clusterSize };
}

// ---------------------------------------------------------------------------
// Main orchestrator (n8n Code node entry point)
// ---------------------------------------------------------------------------

/**
 * Run the full SEC monitor pipeline:
 * 1. Pre-load dedup keys + CIK ticker map (parallel)
 * 2. Fetch EDGAR filings
 * 3. Enrich each filing via Financial Datasets
 * 4. Dedup, filter, classify, cluster-detect
 * 5. Return enriched filing objects for score-alert.js
 *
 * @param {Object} input   — { workflowName, monitorStateName }
 * @param {Object} helpers — { fetchFn, env }
 */
async function runSecMonitor(input, helpers) {
  const fetchFn = helpers && helpers.fetchFn;
  const env = (helpers && helpers.env) || {};
  const nocodb = helpers && helpers.nocodb;

  // Validate required env vars
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`sec-monitor: missing required env vars: ${missing.join(', ')}`);
  }
  if (!nocodb) {
    throw new Error('sec-monitor: helpers.nocodb is required');
  }

  // Step 1: Pre-load in parallel
  const [existingDedupKeys, cikTickerMap] = await Promise.all([
    fetchDedupKeys({ nocodb }),
    loadCikTickerMap({ fetchFn }),
  ]);

  // Step 2: Read last_check_timestamp from Monitor_State
  const stateRecord = await readMonitorState(input.monitorStateName || 'market', { nocodb });
  const lastCheckTimestamp =
    (stateRecord && stateRecord.last_check_timestamp) ||
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const lastCheckDate = lastCheckTimestamp.split('T')[0];

  const today = new Date().toISOString().split('T')[0];

  // Step 3: Fetch EDGAR filings
  const edgarUrl = buildEdgarUrl(lastCheckDate, today);
  const edgarRes = await fetchFn(edgarUrl, {
    headers: { 'User-Agent': SEC_USER_AGENT },
  });
  const edgarData = await edgarRes.json();
  const hits = parseEdgarResponse(edgarData);

  // Filter hits newer than last_check_timestamp
  const newHits = hits.filter(
    (h) => h.file_date && h.file_date > lastCheckTimestamp,
  );

  // Step 4: Process each filing
  const results = [];
  const sameRunFilings = []; // in-memory list for same-batch cluster detection
  let failureCount = 0;
  let firstError = null;

  for (const hit of newHits) {
    const ticker = cikTickerMap.get(hit.cik);
    if (!ticker) continue; // CIK not in map → skip

    // Enrich via Financial Datasets — onFailure increments failureCount only
    // on real API failure (not empty/no-coverage results)
    const enriched = await enrichFiling(ticker, lastCheckDate, {
      apiKey: env.FINANCIAL_DATASETS_API_KEY,
      fetchFn,
      onFailure: (err) => {
        failureCount++;
        if (!firstError) firstError = `FD API failure for ${ticker}: ${err && err.message}`;
      },
    });
    if (!enriched) continue; // null = no data or failure; both handled, continue

    // Dedup check
    const dedupKey = buildDedupKey(
      ticker,
      enriched.name,
      enriched.transaction_date,
      enriched.transaction_shares,
    );
    if (!passesDedup(dedupKey, existingDedupKeys)) continue;

    // Filter: buys only
    if (!isBuyTransaction(enriched.transaction_type)) continue;

    // Classify insider
    const insiderCategory = classifyInsider(enriched.title, enriched.is_board_director);

    // Cluster detection (uses both Supabase + in-memory sameRunFilings)
    let clusterData = { isClusterBuy: false, clusterId: null, clusterSize: 1 };
    try {
      clusterData = await detectCluster(
        ticker,
        enriched.transaction_date,
        enriched.name,
        {
          supabaseUrl: env.SUPABASE_URL,
          serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
          fetchFn,
          sameRunFilings,
        },
      );
    } catch (clusterErr) {
      // Non-fatal: log and continue without cluster info
      console.warn(`sec-monitor: cluster detection failed for ${ticker}: ${clusterErr.message}`);
    }

    const resultObj = {
      ticker,
      company_name: hit.entity_name,
      insider_name: enriched.name,
      insider_title: enriched.title,
      insider_category: insiderCategory,
      transaction_type: 'buy', // normalized from 'P - Purchase'
      transaction_date: enriched.transaction_date,
      filing_date: enriched.filing_date,
      transaction_shares: enriched.transaction_shares,
      transaction_price_per_share: enriched.transaction_price_per_share,
      transaction_value: enriched.transaction_value,
      dedup_key: dedupKey,
      is_cluster_buy: clusterData.isClusterBuy,
      cluster_id: clusterData.clusterId,
      cluster_size: clusterData.clusterSize,
      raw_filing_data: JSON.stringify(enriched),
    };

    results.push(resultObj);
    // Add same reference to sameRunFilings so subsequent detectCluster calls
    // can find this filing AND retroactively update it if they form a cluster
    sameRunFilings.push(resultObj);
  }

  // Alert if too many failures
  if (failureCount > 5 && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const msg = encodeURIComponent(
      `⚠️ sec-monitor: ${failureCount} enrichment failures\nFirst error: ${firstError}`,
    );
    await fetchFn(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage` +
        `?chat_id=${env.TELEGRAM_CHAT_ID}&text=${msg}`,
    ).catch(() => {});
  }

  // Update Monitor_State last_check_timestamp
  if (stateRecord) {
    await writeMonitorState(stateRecord.Id, new Date().toISOString(), { nocodb });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Exports (pure functions + orchestrator — imported by tests)
// ---------------------------------------------------------------------------

module.exports = {
  // Pure helpers
  buildEdgarUrl,
  parseEdgarResponse,
  buildDedupKey,
  passesDedup,
  isBuyTransaction,
  classifyInsider,
  generateUUID,

  // Async functions
  fetchDedupKeys,
  loadCikTickerMap,
  enrichFiling,
  detectCluster,
  readMonitorState,
  writeMonitorState,

  // Orchestrator
  runSecMonitor,

  // Constants
  SEC_USER_AGENT,
  REQUIRED_ENV,
};
