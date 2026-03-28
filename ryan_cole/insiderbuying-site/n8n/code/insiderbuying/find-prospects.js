// W10 Prospect Finder -- finds and scores outreach prospects
// n8n Code Node (CommonJS)

const WEIGHT_DA = 0.3;
const WEIGHT_RELEVANCE = 0.3;
const WEIGHT_CONTACT = 0.2;
const WEIGHT_RECENCY = 0.2;

/**
 * Build Google search queries from recent tickers and generic terms.
 * @param {string[]} recentTickers - e.g. ['AAPL', 'TSLA']
 * @returns {string[]} array of search query strings
 */
function buildSearchQueries(recentTickers) {
  const generic = [
    'insider trading blog',
    'stock market newsletter',
    'finance podcast guests',
    'insider buying analysis blog',
    'SEC filing commentary site',
  ];

  const tickerQueries = (recentTickers || []).map(function (t) {
    return t.toUpperCase() + ' analysis';
  });

  return generic.concat(tickerQueries);
}

/**
 * Score a prospect 0-100 based on weighted factors.
 * @param {{ domain_authority: number, relevance_score: number, contact_quality: number, recency_score: number }} prospect
 * @returns {number} priority score 0-100
 */
function scoreProspect(prospect) {
  var da = Number(prospect.domain_authority) || 0;
  var relevance = Number(prospect.relevance_score) || 0;
  var contactQuality = Number(prospect.contact_quality) || 0;
  var recency = Number(prospect.recency_score) || 0;

  var raw =
    da * WEIGHT_DA +
    relevance * WEIGHT_RELEVANCE +
    contactQuality * WEIGHT_CONTACT +
    recency * WEIGHT_RECENCY;

  return Math.max(0, Math.min(100, Math.round(raw * 100) / 100));
}

/**
 * Remove prospects whose domain already exists in our outreach list.
 * @param {object[]} prospects - each must have a .domain string
 * @param {string[]} existingDomains - domains already contacted
 * @returns {object[]} filtered prospects
 */
function dedup(prospects, existingDomains) {
  var domainSet = {};
  (existingDomains || []).forEach(function (d) {
    domainSet[d.toLowerCase()] = true;
  });

  return (prospects || []).filter(function (p) {
    return !domainSet[(p.domain || '').toLowerCase()];
  });
}

/**
 * Build a NocoDB Outreach_Prospects record from a prospect object.
 * @param {object} prospect
 * @returns {object} record ready for NocoDB insert
 */
function buildProspectRecord(prospect) {
  return {
    domain: prospect.domain || '',
    site_name: prospect.site_name || '',
    contact_email: prospect.contact_email || '',
    contact_name: prospect.contact_name || '',
    domain_authority: Number(prospect.domain_authority) || 0,
    relevance_score: Number(prospect.relevance_score) || 0,
    contact_quality: Number(prospect.contact_quality) || 0,
    recency_score: Number(prospect.recency_score) || 0,
    priority: scoreProspect(prospect),
    status: 'found',
    source_query: prospect.source_query || '',
    notes: prospect.notes || '',
    found_at: new Date().toISOString(),
  };
}

module.exports = {
  buildSearchQueries: buildSearchQueries,
  scoreProspect: scoreProspect,
  dedup: dedup,
  buildProspectRecord: buildProspectRecord,
  WEIGHT_DA: WEIGHT_DA,
  WEIGHT_RELEVANCE: WEIGHT_RELEVANCE,
  WEIGHT_CONTACT: WEIGHT_CONTACT,
  WEIGHT_RECENCY: WEIGHT_RECENCY,
};
