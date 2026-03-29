'use strict';

// ---------------------------------------------------------------------------
// W17 Report Catalog workflow code
// Runs twice weekly (Monday + Thursday) via n8n Schedule Trigger.
// Scans Insider_Alerts and writes prioritized report candidates to NocoDB.
// ---------------------------------------------------------------------------

var SECTOR_MAP = {
  'Tech': 'Technology',
  'Information Technology': 'Technology',
  'IT': 'Technology',
  'Software': 'Technology',
  'Semiconductors': 'Technology',
  'Hardware': 'Technology',
  'Financials': 'Finance',
  'Financial Services': 'Finance',
  'Banking': 'Finance',
  'Insurance': 'Finance',
  'Capital Markets': 'Finance',
  'Health Care': 'Healthcare',
  'Healthcare Equipment': 'Healthcare',
  'Pharmaceuticals': 'Healthcare',
  'Biotech': 'Healthcare',
  'Biotechnology': 'Healthcare',
  'Life Sciences': 'Healthcare',
  'Consumer Discretionary': 'Consumer',
  'Consumer Staples': 'Consumer',
  'Retail': 'Consumer',
  'Media': 'Communication',
  'Communication Services': 'Communication',
  'Telecommunications': 'Communication',
  'Telecom': 'Communication',
  'Real Estate': 'Real Estate',
  'REITs': 'Real Estate',
  'Industrials': 'Industrials',
  'Aerospace & Defense': 'Industrials',
  'Transportation': 'Industrials',
  'Materials': 'Materials',
  'Chemicals': 'Materials',
  'Mining': 'Materials',
  'Metals': 'Materials',
  'Energy': 'Energy',
  'Oil & Gas': 'Energy',
  'Utilities': 'Utilities',
};

/**
 * Maps inconsistent sector names to canonical names.
 * Unknown strings pass through unchanged.
 * @param {string} s
 * @returns {string}
 */
function normalizeSector(s) {
  return SECTOR_MAP[s] || s;
}

/**
 * Main entry function for the W17 report catalog workflow.
 *
 * @param {object} opts
 * @param {function} opts.nocodbGet   async (table, params?) => records[]
 * @param {function} opts.nocodbPost  async (table, record) => inserted record
 * @param {function} opts.telegram    async (message) => void
 */
async function runReportCatalog(opts) {
  var nocodbGet = opts.nocodbGet;
  var nocodbPost = opts.nocodbPost;
  var telegram = opts.telegram;

  var now = new Date();
  var thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

  // -------------------------------------------------------------------------
  // Pre-flight deduplication: tickers/sectors already cataloged in last 30 days
  // -------------------------------------------------------------------------
  var existingRecords = await nocodbGet('Report_Catalog', {
    where: '(created_at,gt,' + thirtyDaysAgo + ')',
    limit: 1000,
  });
  // H2: normalize to lowercase for case-insensitive dedup (sector name variants across runs)
  var existingSet = new Set();
  (existingRecords || []).forEach(function(r) {
    if (r.ticker_or_sector) existingSet.add(r.ticker_or_sector.toLowerCase());
  });

  // -------------------------------------------------------------------------
  // Query Insider_Alerts: clusters >= 3 AND score >= 8, last 30 days
  // -------------------------------------------------------------------------
  var rawAlerts = await nocodbGet('Insider_Alerts', {
    where: '(created_at,gt,' + thirtyDaysAgo + ')',
    limit: 1000,
  });

  // Filter by quality thresholds and apply sector normalization
  var alerts = (rawAlerts || []).filter(function(a) {
    return a.clusters >= 3 && a.score >= 8;
  }).map(function(a) {
    return Object.assign({}, a, { sector: normalizeSector(a.sector || '') });
  });

  // Apply deduplication filter (case-insensitive)
  alerts = alerts.filter(function(a) {
    return !existingSet.has((a.ticker || '').toLowerCase());
  });

  // L1: filter out alerts with empty/missing sector before grouping
  alerts = alerts.filter(function(a) { return a.sector && a.sector.length > 0; });

  var singleInserts = 0;
  var sectorInserts = 0;
  var bundleInserts = 0;

  if (alerts.length === 0) {
    await telegram('Report catalog updated: 0 candidates (0 single, 0 sector, 0 bundle).');
    return;
  }

  // -------------------------------------------------------------------------
  // Pass 1 -- Single-stock reports (top 5 by score)
  // -------------------------------------------------------------------------
  var sortedByScore = alerts.slice().sort(function(a, b) { return b.score - a.score; });
  var topSingles = sortedByScore.slice(0, 5);

  for (var i = 0; i < topSingles.length; i++) {
    var alert = topSingles[i];
    await nocodbPost('Report_Catalog', {
      ticker_or_sector: alert.ticker,
      report_type: 'single',
      priority_score: alert.score,
      status: 'pending',
      created_at: now.toISOString(),
    });
    singleInserts++;
  }

  // -------------------------------------------------------------------------
  // Pass 2 -- Sector reports (sectors with >= 3 qualifying alerts)
  // -------------------------------------------------------------------------
  var sectorGroups = {};
  alerts.forEach(function(a) {
    var s = a.sector;
    if (!sectorGroups[s]) sectorGroups[s] = [];
    sectorGroups[s].push(a);
  });

  var sectorNames = Object.keys(sectorGroups);
  for (var j = 0; j < sectorNames.length; j++) {
    var sector = sectorNames[j];
    var group = sectorGroups[sector];
    if (group.length < 3) continue;
    // Already deduped individual tickers; also check sector name deduplication (case-insensitive)
    if (existingSet.has(sector.toLowerCase())) continue;

    var avgScore = group.reduce(function(acc, a) { return acc + a.score; }, 0) / group.length;
    await nocodbPost('Report_Catalog', {
      ticker_or_sector: sector,
      report_type: 'sector',
      priority_score: Math.round(avgScore * 10) / 10,
      status: 'pending',
      created_at: now.toISOString(),
    });
    sectorInserts++;
  }

  // -------------------------------------------------------------------------
  // Pass 3 -- Bundle candidates (cross-tier pairs in same sector)
  // Skip entirely if market_cap is absent on any alert
  // -------------------------------------------------------------------------
  var hasMktCap = alerts.every(function(a) {
    return a.market_cap !== undefined && a.market_cap !== null;
  });

  if (hasMktCap && alerts.length >= 2) {
    // L2: bundleInserts tracks count; no separate bundleCount needed
    var seen = new Set();

    for (var bi = 0; bi < alerts.length && bundleInserts < 5; bi++) {
      for (var bj = bi + 1; bj < alerts.length && bundleInserts < 5; bj++) {
        var aA = alerts[bi];
        var aB = alerts[bj];
        // Same sector
        if (aA.sector !== aB.sector) continue;
        // Different market cap tiers
        var aALarge = aA.market_cap >= 10000000000;
        var aBLarge = aB.market_cap >= 10000000000;
        if (aALarge === aBLarge) continue;
        // Both score >= 8 (already filtered, but belt-and-suspenders)
        if (aA.score < 8 || aB.score < 8) continue;

        var pairKey = [aA.ticker, aB.ticker].sort().join('+');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        var largeFirst = aALarge ? aA : aB;
        var smallFirst = aALarge ? aB : aA;
        await nocodbPost('Report_Catalog', {
          ticker_or_sector: largeFirst.ticker + '+' + smallFirst.ticker,
          report_type: 'bundle',
          priority_score: Math.min(aA.score, aB.score),
          status: 'pending',
          created_at: now.toISOString(),
        });
        bundleInserts++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Telegram summary
  // -------------------------------------------------------------------------
  // M1: wrap in try/catch so Telegram alert fires even on partial insert failures
  try {
    await telegram(
      'Report catalog updated: ' +
      singleInserts + ' single, ' +
      sectorInserts + ' sector, ' +
      bundleInserts + ' bundle candidates.'
    );
  } catch (e) {
    // Telegram alert failure is non-fatal; inserts already completed
    // eslint-disable-next-line no-console
    console.error('[report-catalog] Telegram alert failed: ' + (e && e.message));
  }
}

module.exports = {
  normalizeSector: normalizeSector,
  runReportCatalog: runReportCatalog,
};
