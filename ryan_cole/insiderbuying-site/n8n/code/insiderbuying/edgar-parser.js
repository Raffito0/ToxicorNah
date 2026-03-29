'use strict';

const https = require('https');
const zlib = require('zlib');

// ─── Rate Limiter ──────────────────────────────────────────────────────────────

/** @type {number} */
let failureCount = 0;

class TokenBucket {
  constructor({ capacity, refillRate, refillInterval }) {
    this._capacity = capacity;
    this._tokens = capacity;
    this._refillRate = refillRate;
    this._refillInterval = refillInterval;
    this._waitQueue = [];
    this._interval = setInterval(() => this._refill(), refillInterval);
    // Allow the interval to be GC'd without keeping the process alive
    if (this._interval.unref) this._interval.unref();
  }

  _refill() {
    const toAdd = this._refillRate;
    this._tokens = Math.min(this._capacity, this._tokens + toAdd);
    while (this._waitQueue.length > 0 && this._tokens > 0) {
      this._tokens -= 1;
      this._waitQueue.shift()();
    }
  }

  /** @returns {Promise<void>} */
  acquire() {
    if (this._tokens > 0) {
      this._tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._waitQueue.push(resolve);
    });
  }
}

const edgarBucket = new TokenBucket({ capacity: 58, refillRate: 58, refillInterval: 60000 });
const EDGAR_REQUEST_DELAY_MS = 110;
const EDGAR_USER_AGENT = 'EarlyInsider/1.0 (contact@earlyinsider.com)';

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Internal HTTP Helper ──────────────────────────────────────────────────────

/**
 * GET a URL with EDGAR headers, gzip decompression, redirect following, timeout.
 * @param {string} url
 * @param {object} [extraHeaders]
 * @returns {Promise<string>}
 */
async function httpsGet(url, extraHeaders = {}, _hops = 0) {
  if (_hops > 3) throw new Error('Too many redirects');
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': EDGAR_USER_AGENT,
        'Accept-Encoding': 'gzip, deflate',
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(httpsGet(res.headers.location, extraHeaders, _hops + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const isGzip = res.headers['content-encoding'] === 'gzip';
      const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });

    req.setTimeout(10000, () => req.destroy());
    req.on('error', reject);
    req.end();
  });
}

// ─── Section 1: EDGAR RSS Feed Discovery ──────────────────────────────────────

/**
 * Build EFTS search URL for Form 4 filings.
 * @param {object} opts
 * @param {number} [opts.hours=6]
 * @returns {string}
 */
function buildEdgarRssUrl(opts) {
  const hours = (opts && opts.hours != null) ? opts.hours : 6;
  const now = new Date();
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);

  function toEdgarIso(d) {
    return d.toISOString().replace(/\.\d{3}Z$/, '').replace('Z', '');
  }

  const params = new URLSearchParams({
    forms: '4',
    dateRange: 'custom',
    startdt: toEdgarIso(start),
    enddt: toEdgarIso(now),
    size: '2000',
  });

  return `https://efts.sec.gov/LATEST/search-index?${params.toString()}`;
}

/**
 * Fetch recent Form 4 filings from EDGAR EFTS.
 * @param {number} hours
 * @param {Function} [fetchFn] - Optional override for testing
 * @returns {Promise<Array<{accessionNumber, filedAt, issuerName, issuerCik, ticker}>>}
 */
async function fetchRecentFilings(hours, fetchFn) {
  try {
    const url = buildEdgarRssUrl({ hours });

    // Rate limiting (skip acquire when fetchFn provided — tests don't wait for bucket)
    if (!fetchFn) {
      await edgarBucket.acquire();
    }

    let body;
    if (fetchFn) {
      const res = await fetchFn(url);
      body = await res.text();
    } else {
      body = await httpsGet(url);
    }

    if (!fetchFn) {
      await _sleep(EDGAR_REQUEST_DELAY_MS);
    }

    const data = JSON.parse(body);
    const hits = (data && data.hits && data.hits.hits) ? data.hits.hits : [];

    const results = [];
    for (const hit of hits) {
      const src = hit._source;
      if (!src) continue;

      const displayName = (src.display_names && src.display_names[0]) || '';

      // Extract ticker and CIK
      const fullMatch = displayName.match(/\(([A-Z]{1,5})\)\s+\(CIK (\d+)\)/);
      let ticker = null;
      let issuerCik = null;

      if (fullMatch) {
        ticker = fullMatch[1];
        issuerCik = fullMatch[2];
      } else {
        const cikMatch = displayName.match(/\(CIK (\d+)\)/);
        if (cikMatch) {
          issuerCik = cikMatch[1];
        }
      }

      // Skip if no CIK at all
      if (!issuerCik) continue;

      results.push({
        accessionNumber: src.file_num || null,
        filedAt: src.file_date || null,
        issuerName: src.entity_name || null,
        issuerCik,
        ticker,
      });
    }

    return results;
  } catch (err) {
    console.error('[edgar-parser] fetchRecentFilings error:', err.message);
    failureCount += 1;
    return [];
  }
}

/**
 * Remove filings already processed (filedAt <= lastCheckTimestamp).
 * @param {Array<{filedAt: string}>} filings
 * @param {string|null|undefined} lastCheckTimestamp
 * @returns {Array}
 */
function deduplicateFilings(filings, lastCheckTimestamp) {
  if (lastCheckTimestamp == null) return filings;
  return filings.filter((f) => f.filedAt > lastCheckTimestamp);
}

// ─── Section 2: Form 4 XML Parser ─────────────────────────────────────────────

/**
 * Build primary and index URLs for a Form 4 filing.
 * @param {string} issuerCik
 * @param {string} accessionNumber  e.g. '0001193125-25-123456'
 * @returns {{ primaryUrl: string, indexUrl: string }}
 */
function buildForm4XmlUrl(issuerCik, accessionNumber) {
  const accNoDash = accessionNumber.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${accNoDash}`;
  return {
    primaryUrl: `${base}/${accNoDash}.xml`,
    indexUrl: `${base}/index.json`,
  };
}

/**
 * Fetch raw Form 4 XML. Tries predictable primary URL first; falls back to index.json.
 * Never throws. Returns null on all failure paths.
 * @param {string} issuerCik
 * @param {string} accessionNumber
 * @param {Function} [fetchFn]  Optional override for testing: (url, headers) => Promise<{status, text}>
 * @returns {Promise<string|null>}
 */
async function fetchForm4Xml(issuerCik, accessionNumber, fetchFn) {
  const HEADERS = { 'User-Agent': EDGAR_USER_AGENT };

  async function doFetch(url) {
    if (fetchFn) return fetchFn(url, HEADERS);
    const body = await httpsGet(url);
    return { status: 200, text: async () => body };
  }

  try {
    const { primaryUrl, indexUrl } = buildForm4XmlUrl(issuerCik, accessionNumber);
    const accNoDash = accessionNumber.replace(/-/g, '');

    // Try primary URL
    if (!fetchFn) await edgarBucket.acquire();
    let res;
    try {
      res = await doFetch(primaryUrl);
    } catch (_) {
      return null;
    }
    if (!fetchFn) await _sleep(EDGAR_REQUEST_DELAY_MS);

    if (res.status === 200) {
      return res.text();
    }

    if (res.status !== 404) return null;

    // Fall back to index.json
    if (!fetchFn) await edgarBucket.acquire();
    let indexRes;
    try {
      indexRes = await doFetch(indexUrl);
    } catch (_) {
      return null;
    }
    if (!fetchFn) await _sleep(EDGAR_REQUEST_DELAY_MS);

    if (indexRes.status !== 200) return null;

    const indexBody = await indexRes.text();
    let indexData;
    try {
      indexData = JSON.parse(indexBody);
    } catch (_) {
      return null;
    }

    const items = (indexData.directory && indexData.directory.item) ? indexData.directory.item : [];
    const xmlItem =
      items.find((i) => i.name && i.name.endsWith('.xml') && i.type === '4') ||
      items.find((i) => i.name && i.name.endsWith('.xml'));

    if (!xmlItem) return null;

    const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${accNoDash}/${xmlItem.name}`;

    if (!fetchFn) await edgarBucket.acquire();
    let xmlRes;
    try {
      xmlRes = await doFetch(xmlUrl);
    } catch (_) {
      return null;
    }
    if (!fetchFn) await _sleep(EDGAR_REQUEST_DELAY_MS);

    if (xmlRes.status !== 200) return null;
    return xmlRes.text();

  } catch (err) {
    console.error('[edgar-parser] fetchForm4Xml error:', err.message);
    return null;
  }
}

// ─── XML Parsing Helpers ───────────────────────────────────────────────────────

function extractTag(xml, tagName) {
  const re = new RegExp(
    '<(?:\\w+:)?' + tagName + '[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?' + tagName + '>',
    'i'
  );
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractAllBlocks(xml, blockName) {
  const re = new RegExp(
    '<(?:\\w+:)?' + blockName + '[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?' + blockName + '>',
    'gi'
  );
  return xml.match(re) || [];
}

function extractValue(xml, tagName) {
  const outer = extractTag(xml, tagName);
  if (outer === null) return null;
  const inner = extractTag(outer, 'value');
  return inner !== null ? inner : outer;
}

function decodeXmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseNum(str) {
  if (str === null || str === undefined) return null;
  const val = parseFloat(str.replace(/,/g, ''));
  return Number.isFinite(val) ? val : null;
}

function parseTransaction(block) {
  const transactionDate = extractValue(block, 'transactionDate');
  const codingBlock = extractTag(block, 'transactionCoding');
  const transactionCode = codingBlock ? extractTag(codingBlock, 'transactionCode') : null;

  const sharesStr = extractValue(block, 'transactionShares');
  const shares = sharesStr !== null ? (parseNum(sharesStr) || 0) : 0;

  // pricePerShare: null (not 0) when the element is absent from XML
  const priceBlock = extractTag(block, 'transactionPricePerShare');
  let pricePerShare = null;
  if (priceBlock !== null) {
    pricePerShare = parseNum(extractTag(priceBlock, 'value') || priceBlock);
  }

  const acquiredDisposed = extractValue(block, 'transactionAcquiredDisposedCode');
  const sharesAfterStr = extractValue(block, 'sharesOwnedFollowingTransaction');
  const sharesAfter = sharesAfterStr !== null ? (parseNum(sharesAfterStr) || 0) : 0;
  const directOwnership = extractValue(block, 'directOrIndirectOwnership');

  return {
    transactionDate,
    transactionCode,
    shares,
    pricePerShare,
    acquiredDisposed,
    sharesAfter,
    directOwnership,
    is10b5Plan: false, // calculated in Section 3
  };
}

/**
 * Parse raw Form 4 XML into a structured object.
 * Never throws. Returns null on any parse failure or missing required fields.
 * @param {string} xmlString
 * @returns {object|null}
 */
function parseForm4Xml(xmlString) {
  try {
    if (!xmlString || typeof xmlString !== 'string') return null;

    // issuerTradingSymbol is required — return null if absent
    const rawTicker = extractTag(xmlString, 'issuerTradingSymbol');
    if (!rawTicker) return null;
    const ticker = decodeXmlEntities(rawTicker);

    const documentType = extractTag(xmlString, 'documentType');
    const periodOfReport = extractTag(xmlString, 'periodOfReport');

    const issuerBlock = extractTag(xmlString, 'issuer') || '';
    const issuerCik = extractTag(issuerBlock, 'issuerCik');
    const issuerName = decodeXmlEntities(extractTag(issuerBlock, 'issuerName'));

    const ownerBlock = extractTag(xmlString, 'reportingOwner') || '';
    const ownerIdBlock = extractTag(ownerBlock, 'reportingOwnerId') || '';
    const ownerRelBlock = extractTag(ownerBlock, 'reportingOwnerRelationship') || '';

    const ownerCik = extractTag(ownerIdBlock, 'rptOwnerCik');
    const ownerName = decodeXmlEntities(extractTag(ownerIdBlock, 'rptOwnerName'));
    const isOfficerStr = extractTag(ownerRelBlock, 'isOfficer') || '0';
    const isDirectorStr = extractTag(ownerRelBlock, 'isDirector') || '0';
    const officerTitleRaw = extractTag(ownerRelBlock, 'officerTitle');
    const officerTitle = officerTitleRaw ? decodeXmlEntities(officerTitleRaw) : null;

    const nonDerivBlocks = extractAllBlocks(xmlString, 'nonDerivativeTransaction');
    const derivBlocks = extractAllBlocks(xmlString, 'derivativeTransaction');

    return {
      documentType,
      isAmendment: documentType === '4/A',
      periodOfReport,
      issuer: { cik: issuerCik, name: issuerName, ticker },
      owner: {
        cik: ownerCik,
        name: ownerName,
        isOfficer: isOfficerStr === '1' || isOfficerStr === 'true',
        isDirector: isDirectorStr === '1' || isDirectorStr === 'true',
        officerTitle,
      },
      nonDerivativeTransactions: nonDerivBlocks.map(parseTransaction),
      derivativeTransactions: derivBlocks.map(parseTransaction),
    };
  } catch (err) {
    console.error('[edgar-parser] parseForm4Xml error:', err.message);
    return null;
  }
}

// ─── Section 3: Classification (placeholder, added in Section 03) ─────────────

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Section 1
  buildEdgarRssUrl,
  fetchRecentFilings,
  deduplicateFilings,
  // Section 2
  buildForm4XmlUrl,
  fetchForm4Xml,
  parseForm4Xml,
  // Test helpers
  _resetFailureCount: () => { failureCount = 0; },
  _getFailureCount: () => failureCount,
};
