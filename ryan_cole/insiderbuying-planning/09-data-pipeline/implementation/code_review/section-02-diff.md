diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/edgar-parser.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/edgar-parser.js
new file mode 100644
index 0000000..67691bc
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/edgar-parser.js
@@ -0,0 +1,460 @@
+'use strict';
+
+const https = require('https');
+const zlib = require('zlib');
+
+// ─── Rate Limiter ──────────────────────────────────────────────────────────────
+
+/** @type {number} */
+let failureCount = 0;
+
+class TokenBucket {
+  constructor({ capacity, refillRate, refillInterval }) {
+    this._capacity = capacity;
+    this._tokens = capacity;
+    this._refillRate = refillRate;
+    this._refillInterval = refillInterval;
+    this._waitQueue = [];
+    this._interval = setInterval(() => this._refill(), refillInterval);
+    // Allow the interval to be GC'd without keeping the process alive
+    if (this._interval.unref) this._interval.unref();
+  }
+
+  _refill() {
+    const toAdd = this._refillRate;
+    this._tokens = Math.min(this._capacity, this._tokens + toAdd);
+    while (this._waitQueue.length > 0 && this._tokens > 0) {
+      this._tokens -= 1;
+      this._waitQueue.shift()();
+    }
+  }
+
+  /** @returns {Promise<void>} */
+  acquire() {
+    if (this._tokens > 0) {
+      this._tokens -= 1;
+      return Promise.resolve();
+    }
+    return new Promise((resolve) => {
+      this._waitQueue.push(resolve);
+    });
+  }
+}
+
+const edgarBucket = new TokenBucket({ capacity: 58, refillRate: 58, refillInterval: 60000 });
+const EDGAR_REQUEST_DELAY_MS = 110;
+const EDGAR_USER_AGENT = 'EarlyInsider/1.0 (contact@earlyinsider.com)';
+
+function _sleep(ms) {
+  return new Promise((resolve) => setTimeout(resolve, ms));
+}
+
+// ─── Internal HTTP Helper ──────────────────────────────────────────────────────
+
+/**
+ * GET a URL with EDGAR headers, gzip decompression, redirect following, timeout.
+ * @param {string} url
+ * @param {object} [extraHeaders]
+ * @returns {Promise<string>}
+ */
+async function httpsGet(url, extraHeaders = {}, _hops = 0) {
+  if (_hops > 3) throw new Error('Too many redirects');
+  return new Promise((resolve, reject) => {
+    const parsed = new URL(url);
+    const options = {
+      hostname: parsed.hostname,
+      path: parsed.pathname + parsed.search,
+      method: 'GET',
+      headers: {
+        'User-Agent': EDGAR_USER_AGENT,
+        'Accept-Encoding': 'gzip, deflate',
+        ...extraHeaders,
+      },
+    };
+
+    const req = https.request(options, (res) => {
+      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
+        resolve(httpsGet(res.headers.location, extraHeaders, _hops + 1));
+        return;
+      }
+      if (res.statusCode < 200 || res.statusCode >= 300) {
+        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
+        return;
+      }
+
+      const isGzip = res.headers['content-encoding'] === 'gzip';
+      const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
+      const chunks = [];
+      stream.on('data', (c) => chunks.push(c));
+      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
+      stream.on('error', reject);
+    });
+
+    req.setTimeout(10000, () => req.destroy());
+    req.on('error', reject);
+    req.end();
+  });
+}
+
+// ─── Section 1: EDGAR RSS Feed Discovery ──────────────────────────────────────
+
+/**
+ * Build EFTS search URL for Form 4 filings.
+ * @param {object} opts
+ * @param {number} [opts.hours=6]
+ * @returns {string}
+ */
+function buildEdgarRssUrl(opts) {
+  const hours = (opts && opts.hours != null) ? opts.hours : 6;
+  const now = new Date();
+  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
+
+  function toEdgarIso(d) {
+    return d.toISOString().replace(/\.\d{3}Z$/, '').replace('Z', '');
+  }
+
+  const params = new URLSearchParams({
+    forms: '4',
+    dateRange: 'custom',
+    startdt: toEdgarIso(start),
+    enddt: toEdgarIso(now),
+    size: '2000',
+  });
+
+  return `https://efts.sec.gov/LATEST/search-index?${params.toString()}`;
+}
+
+/**
+ * Fetch recent Form 4 filings from EDGAR EFTS.
+ * @param {number} hours
+ * @param {Function} [fetchFn] - Optional override for testing
+ * @returns {Promise<Array<{accessionNumber, filedAt, issuerName, issuerCik, ticker}>>}
+ */
+async function fetchRecentFilings(hours, fetchFn) {
+  try {
+    const url = buildEdgarRssUrl({ hours });
+
+    // Rate limiting (skip acquire when fetchFn provided — tests don't wait for bucket)
+    if (!fetchFn) {
+      await edgarBucket.acquire();
+    }
+
+    let body;
+    if (fetchFn) {
+      const res = await fetchFn(url);
+      body = await res.text();
+    } else {
+      body = await httpsGet(url);
+    }
+
+    if (!fetchFn) {
+      await _sleep(EDGAR_REQUEST_DELAY_MS);
+    }
+
+    const data = JSON.parse(body);
+    const hits = (data && data.hits && data.hits.hits) ? data.hits.hits : [];
+
+    const results = [];
+    for (const hit of hits) {
+      const src = hit._source;
+      if (!src) continue;
+
+      const displayName = (src.display_names && src.display_names[0]) || '';
+
+      // Extract ticker and CIK
+      const fullMatch = displayName.match(/\(([A-Z]{1,5})\)\s+\(CIK (\d+)\)/);
+      let ticker = null;
+      let issuerCik = null;
+
+      if (fullMatch) {
+        ticker = fullMatch[1];
+        issuerCik = fullMatch[2];
+      } else {
+        const cikMatch = displayName.match(/\(CIK (\d+)\)/);
+        if (cikMatch) {
+          issuerCik = cikMatch[1];
+        }
+      }
+
+      // Skip if no CIK at all
+      if (!issuerCik) continue;
+
+      results.push({
+        accessionNumber: src.file_num || null,
+        filedAt: src.file_date || null,
+        issuerName: src.entity_name || null,
+        issuerCik,
+        ticker,
+      });
+    }
+
+    return results;
+  } catch (err) {
+    console.error('[edgar-parser] fetchRecentFilings error:', err.message);
+    failureCount += 1;
+    return [];
+  }
+}
+
+/**
+ * Remove filings already processed (filedAt <= lastCheckTimestamp).
+ * @param {Array<{filedAt: string}>} filings
+ * @param {string|null|undefined} lastCheckTimestamp
+ * @returns {Array}
+ */
+function deduplicateFilings(filings, lastCheckTimestamp) {
+  if (lastCheckTimestamp == null) return filings;
+  return filings.filter((f) => f.filedAt > lastCheckTimestamp);
+}
+
+// ─── Section 2: Form 4 XML Parser ─────────────────────────────────────────────
+
+/**
+ * Build primary and index URLs for a Form 4 filing.
+ * @param {string} issuerCik
+ * @param {string} accessionNumber  e.g. '0001193125-25-123456'
+ * @returns {{ primaryUrl: string, indexUrl: string }}
+ */
+function buildForm4XmlUrl(issuerCik, accessionNumber) {
+  const accNoDash = accessionNumber.replace(/-/g, '');
+  const base = `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${accNoDash}`;
+  return {
+    primaryUrl: `${base}/${accNoDash}.xml`,
+    indexUrl: `${base}/index.json`,
+  };
+}
+
+/**
+ * Fetch raw Form 4 XML. Tries predictable primary URL first; falls back to index.json.
+ * Never throws. Returns null on all failure paths.
+ * @param {string} issuerCik
+ * @param {string} accessionNumber
+ * @param {Function} [fetchFn]  Optional override for testing: (url, headers) => Promise<{status, text}>
+ * @returns {Promise<string|null>}
+ */
+async function fetchForm4Xml(issuerCik, accessionNumber, fetchFn) {
+  const HEADERS = { 'User-Agent': EDGAR_USER_AGENT };
+
+  async function doFetch(url) {
+    if (fetchFn) return fetchFn(url, HEADERS);
+    const body = await httpsGet(url);
+    return { status: 200, text: async () => body };
+  }
+
+  try {
+    const { primaryUrl, indexUrl } = buildForm4XmlUrl(issuerCik, accessionNumber);
+    const accNoDash = accessionNumber.replace(/-/g, '');
+
+    // Try primary URL
+    if (!fetchFn) await edgarBucket.acquire();
+    let res;
+    try {
+      res = await doFetch(primaryUrl);
+    } catch (_) {
+      return null;
+    }
+    if (!fetchFn) await _sleep(EDGAR_REQUEST_DELAY_MS);
+
+    if (res.status === 200) {
+      return res.text();
+    }
+
+    if (res.status !== 404) return null;
+
+    // Fall back to index.json
+    if (!fetchFn) await edgarBucket.acquire();
+    let indexRes;
+    try {
+      indexRes = await doFetch(indexUrl);
+    } catch (_) {
+      return null;
+    }
+    if (!fetchFn) await _sleep(EDGAR_REQUEST_DELAY_MS);
+
+    if (indexRes.status !== 200) return null;
+
+    const indexBody = await indexRes.text();
+    let indexData;
+    try {
+      indexData = JSON.parse(indexBody);
+    } catch (_) {
+      return null;
+    }
+
+    const items = (indexData.directory && indexData.directory.item) ? indexData.directory.item : [];
+    const xmlItem =
+      items.find((i) => i.name && i.name.endsWith('.xml') && i.type === '4') ||
+      items.find((i) => i.name && i.name.endsWith('.xml'));
+
+    if (!xmlItem) return null;
+
+    const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${accNoDash}/${xmlItem.name}`;
+
+    if (!fetchFn) await edgarBucket.acquire();
+    let xmlRes;
+    try {
+      xmlRes = await doFetch(xmlUrl);
+    } catch (_) {
+      return null;
+    }
+    if (!fetchFn) await _sleep(EDGAR_REQUEST_DELAY_MS);
+
+    if (xmlRes.status !== 200) return null;
+    return xmlRes.text();
+
+  } catch (err) {
+    console.error('[edgar-parser] fetchForm4Xml error:', err.message);
+    return null;
+  }
+}
+
+// ─── XML Parsing Helpers ───────────────────────────────────────────────────────
+
+function extractTag(xml, tagName) {
+  const re = new RegExp(
+    '<(?:\\w+:)?' + tagName + '[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?' + tagName + '>',
+    'i'
+  );
+  const m = xml.match(re);
+  return m ? m[1].trim() : null;
+}
+
+function extractAllBlocks(xml, blockName) {
+  const re = new RegExp(
+    '<(?:\\w+:)?' + blockName + '[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?' + blockName + '>',
+    'gi'
+  );
+  return xml.match(re) || [];
+}
+
+function extractValue(xml, tagName) {
+  const outer = extractTag(xml, tagName);
+  if (outer === null) return null;
+  const inner = extractTag(outer, 'value');
+  return inner !== null ? inner : outer;
+}
+
+function decodeXmlEntities(str) {
+  if (!str) return str;
+  return str
+    .replace(/&amp;/g, '&')
+    .replace(/&lt;/g, '<')
+    .replace(/&gt;/g, '>')
+    .replace(/&apos;/g, "'")
+    .replace(/&quot;/g, '"')
+    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
+}
+
+function parseNum(str) {
+  if (str === null || str === undefined) return null;
+  const val = parseFloat(str.replace(/,/g, ''));
+  return Number.isFinite(val) ? val : null;
+}
+
+function parseTransaction(block) {
+  const transactionDate = extractValue(block, 'transactionDate');
+  const transactionCode = extractValue(block, 'transactionCoding')
+    ? extractTag(extractTag(block, 'transactionCoding') || '', 'transactionCode')
+    : null;
+
+  const sharesStr = extractValue(block, 'transactionShares');
+  const shares = sharesStr !== null ? (parseNum(sharesStr) || 0) : 0;
+
+  // pricePerShare: null (not 0) when the element is absent from XML
+  const priceBlock = extractTag(block, 'transactionPricePerShare');
+  let pricePerShare = null;
+  if (priceBlock !== null) {
+    pricePerShare = parseNum(extractTag(priceBlock, 'value') || priceBlock);
+  }
+
+  const acquiredDisposed = extractValue(block, 'transactionAcquiredDisposedCode');
+  const sharesAfterStr = extractValue(block, 'sharesOwnedFollowingTransaction');
+  const sharesAfter = sharesAfterStr !== null ? (parseNum(sharesAfterStr) || 0) : 0;
+  const directOwnership = extractValue(block, 'directOrIndirectOwnership');
+
+  return {
+    transactionDate,
+    transactionCode,
+    shares,
+    pricePerShare,
+    acquiredDisposed,
+    sharesAfter,
+    directOwnership,
+    is10b5Plan: false, // calculated in Section 3
+  };
+}
+
+/**
+ * Parse raw Form 4 XML into a structured object.
+ * Never throws. Returns null on any parse failure or missing required fields.
+ * @param {string} xmlString
+ * @returns {object|null}
+ */
+function parseForm4Xml(xmlString) {
+  try {
+    if (!xmlString || typeof xmlString !== 'string') return null;
+
+    // issuerTradingSymbol is required — return null if absent
+    const rawTicker = extractTag(xmlString, 'issuerTradingSymbol');
+    if (!rawTicker) return null;
+    const ticker = decodeXmlEntities(rawTicker);
+
+    const documentType = extractTag(xmlString, 'documentType');
+    const periodOfReport = extractTag(xmlString, 'periodOfReport');
+
+    const issuerBlock = extractTag(xmlString, 'issuer') || '';
+    const issuerCik = extractTag(issuerBlock, 'issuerCik');
+    const issuerName = decodeXmlEntities(extractTag(issuerBlock, 'issuerName'));
+
+    const ownerBlock = extractTag(xmlString, 'reportingOwner') || '';
+    const ownerIdBlock = extractTag(ownerBlock, 'reportingOwnerId') || '';
+    const ownerRelBlock = extractTag(ownerBlock, 'reportingOwnerRelationship') || '';
+
+    const ownerCik = extractTag(ownerIdBlock, 'rptOwnerCik');
+    const ownerName = decodeXmlEntities(extractTag(ownerIdBlock, 'rptOwnerName'));
+    const isOfficerStr = extractTag(ownerRelBlock, 'isOfficer') || '0';
+    const isDirectorStr = extractTag(ownerRelBlock, 'isDirector') || '0';
+    const officerTitleRaw = extractTag(ownerRelBlock, 'officerTitle');
+    const officerTitle = officerTitleRaw ? decodeXmlEntities(officerTitleRaw) : null;
+
+    const nonDerivBlocks = extractAllBlocks(xmlString, 'nonDerivativeTransaction');
+    const derivBlocks = extractAllBlocks(xmlString, 'derivativeTransaction');
+
+    return {
+      documentType,
+      isAmendment: documentType === '4/A',
+      periodOfReport,
+      issuer: { cik: issuerCik, name: issuerName, ticker },
+      owner: {
+        cik: ownerCik,
+        name: ownerName,
+        isOfficer: isOfficerStr === '1' || isOfficerStr === 'true',
+        isDirector: isDirectorStr === '1' || isDirectorStr === 'true',
+        officerTitle,
+      },
+      nonDerivativeTransactions: nonDerivBlocks.map(parseTransaction),
+      derivativeTransactions: derivBlocks.map(parseTransaction),
+    };
+  } catch (err) {
+    console.error('[edgar-parser] parseForm4Xml error:', err.message);
+    return null;
+  }
+}
+
+// ─── Section 3: Classification (placeholder, added in Section 03) ─────────────
+
+// ─── Exports ───────────────────────────────────────────────────────────────────
+
+module.exports = {
+  // Section 1
+  buildEdgarRssUrl,
+  fetchRecentFilings,
+  deduplicateFilings,
+  // Section 2
+  buildForm4XmlUrl,
+  fetchForm4Xml,
+  parseForm4Xml,
+  // Test helpers
+  _resetFailureCount: () => { failureCount = 0; },
+  _getFailureCount: () => failureCount,
+};
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/edgar-parser.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/edgar-parser.test.js
new file mode 100644
index 0000000..b9065b2
--- /dev/null
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/edgar-parser.test.js
@@ -0,0 +1,570 @@
+'use strict';
+
+const {
+  buildEdgarRssUrl,
+  fetchRecentFilings,
+  deduplicateFilings,
+  _resetFailureCount,
+  _getFailureCount,
+  buildForm4XmlUrl,
+  fetchForm4Xml,
+  parseForm4Xml,
+} = require('../../n8n/code/insiderbuying/edgar-parser');
+
+// ─── Fixtures (Section 02) ────────────────────────────────────────────────────
+
+const FIXTURE_STANDARD_BUY = `
+<ownershipDocument>
+  <documentType>4</documentType>
+  <periodOfReport>2025-04-15</periodOfReport>
+  <issuer>
+    <issuerCik>0001045810</issuerCik>
+    <issuerName>NVIDIA CORP</issuerName>
+    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
+  </issuer>
+  <reportingOwner>
+    <reportingOwnerId>
+      <rptOwnerCik>0001278495</rptOwnerCik>
+      <rptOwnerName>Jensen Huang</rptOwnerName>
+    </reportingOwnerId>
+    <reportingOwnerRelationship>
+      <isOfficer>1</isOfficer>
+      <officerTitle>President and CEO</officerTitle>
+    </reportingOwnerRelationship>
+  </reportingOwner>
+  <nonDerivativeTable>
+    <nonDerivativeTransaction>
+      <transactionDate><value>2025-04-15</value></transactionDate>
+      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
+      <transactionAmounts>
+        <transactionShares><value>100000</value></transactionShares>
+        <transactionPricePerShare><value>145.23</value></transactionPricePerShare>
+        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
+      </transactionAmounts>
+      <postTransactionAmounts>
+        <sharesOwnedFollowingTransaction><value>1000000</value></sharesOwnedFollowingTransaction>
+      </postTransactionAmounts>
+      <ownershipNature>
+        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
+      </ownershipNature>
+    </nonDerivativeTransaction>
+  </nonDerivativeTable>
+</ownershipDocument>`;
+
+const FIXTURE_AMENDMENT = `
+<ownershipDocument>
+  <documentType>4/A</documentType>
+  <periodOfReport>2025-04-15</periodOfReport>
+  <issuer>
+    <issuerCik>0001045810</issuerCik>
+    <issuerName>NVIDIA CORP</issuerName>
+    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
+  </issuer>
+  <reportingOwner>
+    <reportingOwnerId>
+      <rptOwnerCik>0001278495</rptOwnerCik>
+      <rptOwnerName>Jensen Huang</rptOwnerName>
+    </reportingOwnerId>
+    <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
+  </reportingOwner>
+</ownershipDocument>`;
+
+const FIXTURE_GIFT_NO_PRICE = `
+<ownershipDocument>
+  <documentType>4</documentType>
+  <periodOfReport>2025-04-15</periodOfReport>
+  <issuer>
+    <issuerCik>0001045810</issuerCik>
+    <issuerName>NVIDIA CORP</issuerName>
+    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
+  </issuer>
+  <reportingOwner>
+    <reportingOwnerId>
+      <rptOwnerCik>0001278495</rptOwnerCik>
+      <rptOwnerName>Jensen Huang</rptOwnerName>
+    </reportingOwnerId>
+    <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
+  </reportingOwner>
+  <nonDerivativeTable>
+    <nonDerivativeTransaction>
+      <transactionDate><value>2025-04-15</value></transactionDate>
+      <transactionCoding><transactionCode>G</transactionCode></transactionCoding>
+      <transactionAmounts>
+        <transactionShares><value>5000</value></transactionShares>
+        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
+      </transactionAmounts>
+      <postTransactionAmounts>
+        <sharesOwnedFollowingTransaction><value>995000</value></sharesOwnedFollowingTransaction>
+      </postTransactionAmounts>
+      <ownershipNature>
+        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
+      </ownershipNature>
+    </nonDerivativeTransaction>
+  </nonDerivativeTable>
+</ownershipDocument>`;
+
+const FIXTURE_OPTION_EXERCISE = `
+<ownershipDocument>
+  <documentType>4</documentType>
+  <periodOfReport>2025-04-15</periodOfReport>
+  <issuer>
+    <issuerCik>0001045810</issuerCik>
+    <issuerName>NVIDIA CORP</issuerName>
+    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
+  </issuer>
+  <reportingOwner>
+    <reportingOwnerId>
+      <rptOwnerCik>0001278495</rptOwnerCik>
+      <rptOwnerName>Jensen Huang</rptOwnerName>
+    </reportingOwnerId>
+    <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
+  </reportingOwner>
+  <derivativeTable>
+    <derivativeTransaction>
+      <transactionDate><value>2025-04-15</value></transactionDate>
+      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
+      <transactionAmounts>
+        <transactionShares><value>50000</value></transactionShares>
+        <transactionPricePerShare><value>0</value></transactionPricePerShare>
+        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
+      </transactionAmounts>
+      <postTransactionAmounts>
+        <sharesOwnedFollowingTransaction><value>0</value></sharesOwnedFollowingTransaction>
+      </postTransactionAmounts>
+      <ownershipNature>
+        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
+      </ownershipNature>
+    </derivativeTransaction>
+  </derivativeTable>
+</ownershipDocument>`;
+
+const FIXTURE_MULTI_TRANSACTION = `
+<ownershipDocument>
+  <documentType>4</documentType>
+  <periodOfReport>2025-04-15</periodOfReport>
+  <issuer>
+    <issuerCik>0001045810</issuerCik>
+    <issuerName>NVIDIA CORP</issuerName>
+    <issuerTradingSymbol>NVDA</issuerTradingSymbol>
+  </issuer>
+  <reportingOwner>
+    <reportingOwnerId>
+      <rptOwnerCik>0001278495</rptOwnerCik>
+      <rptOwnerName>Jensen Huang</rptOwnerName>
+    </reportingOwnerId>
+    <reportingOwnerRelationship><isOfficer>1</isOfficer></reportingOwnerRelationship>
+  </reportingOwner>
+  <nonDerivativeTable>
+    <nonDerivativeTransaction>
+      <transactionDate><value>2025-04-15</value></transactionDate>
+      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
+      <transactionAmounts>
+        <transactionShares><value>1000</value></transactionShares>
+        <transactionPricePerShare><value>100.00</value></transactionPricePerShare>
+        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
+      </transactionAmounts>
+      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>1000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
+      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
+    </nonDerivativeTransaction>
+    <nonDerivativeTransaction>
+      <transactionDate><value>2025-04-15</value></transactionDate>
+      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
+      <transactionAmounts>
+        <transactionShares><value>2000</value></transactionShares>
+        <transactionPricePerShare><value>100.00</value></transactionPricePerShare>
+        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
+      </transactionAmounts>
+      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>3000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
+      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
+    </nonDerivativeTransaction>
+    <nonDerivativeTransaction>
+      <transactionDate><value>2025-04-15</value></transactionDate>
+      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
+      <transactionAmounts>
+        <transactionShares><value>3000</value></transactionShares>
+        <transactionPricePerShare><value>100.00</value></transactionPricePerShare>
+        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
+      </transactionAmounts>
+      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>6000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
+      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
+    </nonDerivativeTransaction>
+  </nonDerivativeTable>
+</ownershipDocument>`;
+
+// ─── buildEdgarRssUrl ──────────────────────────────────────────────────────────
+
+describe('buildEdgarRssUrl()', () => {
+  test('URL host is efts.sec.gov', () => {
+    const url = buildEdgarRssUrl({ hours: 6 });
+    expect(url).toContain('efts.sec.gov');
+  });
+
+  test('URL includes forms=4, dateRange=custom, size=2000', () => {
+    const url = buildEdgarRssUrl({ hours: 6 });
+    expect(url).toContain('forms=4');
+    expect(url).toContain('dateRange=custom');
+    expect(url).toContain('size=2000');
+  });
+
+  test('startdt is approximately now minus hours (within 30s tolerance)', () => {
+    const before = Date.now();
+    const url = buildEdgarRssUrl({ hours: 6 });
+    const after = Date.now();
+
+    const params = new URL(url).searchParams;
+    // Append 'Z' to treat as UTC (the implementation outputs UTC without Z marker)
+    const startdt = new Date(params.get('startdt') + 'Z').getTime();
+    const expected = before - 6 * 60 * 60 * 1000;
+    const tolerance = 30000; // 30 seconds
+
+    expect(startdt).toBeGreaterThanOrEqual(expected - tolerance);
+    expect(startdt).toBeLessThanOrEqual(after - 6 * 60 * 60 * 1000 + tolerance);
+  });
+
+  test('defaults hours to 6 when not specified', () => {
+    const url = buildEdgarRssUrl({});
+    const params = new URL(url).searchParams;
+    // Append 'Z' to treat as UTC
+    const startdt = new Date(params.get('startdt') + 'Z').getTime();
+    const enddt = new Date(params.get('enddt') + 'Z').getTime();
+    const diffHours = (enddt - startdt) / (1000 * 60 * 60);
+    expect(diffHours).toBeCloseTo(6, 0);
+  });
+});
+
+// ─── fetchRecentFilings ────────────────────────────────────────────────────────
+
+const EFTS_TWO_HITS = {
+  hits: {
+    total: { value: 2 },
+    hits: [
+      {
+        _source: {
+          file_num: '0001045810-25-000001',
+          file_date: '2025-04-15',
+          entity_name: 'NVIDIA CORP',
+          display_names: ['Jensen Huang (NVDA) (CIK 0001045810)'],
+        },
+      },
+      {
+        _source: {
+          file_num: '0000732834-25-000002',
+          file_date: '2025-04-15',
+          entity_name: 'Vanguard 500 Index Fund',
+          display_names: ['Vanguard Advisers Inc (CIK 0000732834)'],
+        },
+      },
+    ],
+  },
+};
+
+function makeFetch(body) {
+  return jest.fn().mockResolvedValue({
+    ok: true,
+    text: async () => JSON.stringify(body),
+    json: async () => body,
+  });
+}
+
+describe('fetchRecentFilings()', () => {
+  test('2 valid hits → returns array of length 2 with correct fields', async () => {
+    const fetch = makeFetch(EFTS_TWO_HITS);
+    const results = await fetchRecentFilings(6, fetch);
+
+    expect(results).toHaveLength(2);
+    expect(results[0]).toMatchObject({
+      accessionNumber: '0001045810-25-000001',
+      filedAt: '2025-04-15',
+      issuerName: 'NVIDIA CORP',
+      ticker: 'NVDA',
+      issuerCik: '0001045810',
+    });
+  });
+
+  test('display_names without ticker (fund/trust) → ticker=null, CIK extracted', async () => {
+    const fetch = makeFetch(EFTS_TWO_HITS);
+    const results = await fetchRecentFilings(6, fetch);
+
+    expect(results[1].ticker).toBeNull();
+    expect(results[1].issuerCik).toBe('0000732834');
+  });
+
+  test('EFTS returns empty hits array → returns []', async () => {
+    const fetch = makeFetch({ hits: { total: { value: 0 }, hits: [] } });
+    const results = await fetchRecentFilings(6, fetch);
+    expect(results).toEqual([]);
+  });
+
+  test('fetchFn rejects → returns [], failureCount incremented', async () => {
+    _resetFailureCount();
+    const fetch = jest.fn().mockRejectedValue(new Error('Network error'));
+    const results = await fetchRecentFilings(6, fetch);
+    expect(results).toEqual([]);
+    expect(_getFailureCount()).toBe(1);
+  });
+
+  test('EFTS returns unexpected shape (missing hits key) → returns [], no throw', async () => {
+    const fetch = makeFetch({ unexpected: 'structure' });
+    await expect(fetchRecentFilings(6, fetch)).resolves.toEqual([]);
+  });
+});
+
+// ─── deduplicateFilings ────────────────────────────────────────────────────────
+
+describe('deduplicateFilings()', () => {
+  const FILINGS = [
+    { filedAt: '2025-04-14', accessionNumber: 'A' },
+    { filedAt: '2025-04-15', accessionNumber: 'B' },
+    { filedAt: '2025-04-16', accessionNumber: 'C' },
+  ];
+
+  test('filedAt <= lastCheckTimestamp → filing excluded (boundary excluded)', () => {
+    const result = deduplicateFilings(FILINGS, '2025-04-15');
+    expect(result.map((f) => f.accessionNumber)).toEqual(['C']);
+  });
+
+  test('filedAt > lastCheckTimestamp → filing included', () => {
+    const result = deduplicateFilings(FILINGS, '2025-04-13');
+    expect(result).toHaveLength(3);
+  });
+
+  test('lastCheckTimestamp is null → all filings returned unchanged', () => {
+    const result = deduplicateFilings(FILINGS, null);
+    expect(result).toHaveLength(3);
+  });
+
+  test('lastCheckTimestamp is undefined → all filings returned unchanged', () => {
+    const result = deduplicateFilings(FILINGS, undefined);
+    expect(result).toHaveLength(3);
+  });
+
+  test('empty filings array → empty array returned', () => {
+    const result = deduplicateFilings([], '2025-04-15');
+    expect(result).toEqual([]);
+  });
+});
+
+// ─── buildForm4XmlUrl ─────────────────────────────────────────────────────────
+
+describe('buildForm4XmlUrl()', () => {
+  const CIK = '0000320193';
+  const ACC = '0001193125-25-123456';
+  const ACC_NO_DASH = '000119312525123456';
+
+  test('primaryUrl strips dashes from accession and uses correct path', () => {
+    const { primaryUrl } = buildForm4XmlUrl(CIK, ACC);
+    expect(primaryUrl).toBe(
+      `https://www.sec.gov/Archives/edgar/data/${CIK}/${ACC_NO_DASH}/${ACC_NO_DASH}.xml`
+    );
+  });
+
+  test('indexUrl points to index.json', () => {
+    const { indexUrl } = buildForm4XmlUrl(CIK, ACC);
+    expect(indexUrl).toBe(
+      `https://www.sec.gov/Archives/edgar/data/${CIK}/${ACC_NO_DASH}/index.json`
+    );
+  });
+
+  test('returned object has both primaryUrl and indexUrl', () => {
+    const result = buildForm4XmlUrl(CIK, ACC);
+    expect(result).toHaveProperty('primaryUrl');
+    expect(result).toHaveProperty('indexUrl');
+  });
+});
+
+// ─── fetchForm4Xml ────────────────────────────────────────────────────────────
+
+const PRIMARY_URL = 'https://www.sec.gov/Archives/edgar/data/0000320193/000119312525123456/000119312525123456.xml';
+const INDEX_URL = 'https://www.sec.gov/Archives/edgar/data/0000320193/000119312525123456/index.json';
+const INDEX_XML_URL = 'https://www.sec.gov/Archives/edgar/data/0000320193/000119312525123456/form4.xml';
+const SAMPLE_XML = '<ownershipDocument><documentType>4</documentType></ownershipDocument>';
+const SAMPLE_INDEX = JSON.stringify({
+  directory: {
+    item: [{ name: 'form4.xml', type: '4' }],
+  },
+});
+
+function makeRouteFetch(routes) {
+  return jest.fn((url) => {
+    if (routes[url]) return Promise.resolve(routes[url]);
+    return Promise.reject(new Error(`No route for ${url}`));
+  });
+}
+
+describe('fetchForm4Xml()', () => {
+  test('primary URL returns 200 → returns XML string, index.json not called', async () => {
+    const fetch = makeRouteFetch({
+      [PRIMARY_URL]: { status: 200, text: async () => SAMPLE_XML },
+    });
+    const result = await fetchForm4Xml('0000320193', '0001193125-25-123456', fetch);
+    expect(result).toBe(SAMPLE_XML);
+    // index.json should NOT have been called
+    expect(fetch.mock.calls.map((c) => c[0])).not.toContain(INDEX_URL);
+  });
+
+  test('primary URL returns 404 → index.json fetched, XML URL from index returned', async () => {
+    const fetch = makeRouteFetch({
+      [PRIMARY_URL]: { status: 404, text: async () => 'Not Found' },
+      [INDEX_URL]: { status: 200, text: async () => SAMPLE_INDEX },
+      [INDEX_XML_URL]: { status: 200, text: async () => SAMPLE_XML },
+    });
+    const result = await fetchForm4Xml('0000320193', '0001193125-25-123456', fetch);
+    expect(result).toBe(SAMPLE_XML);
+  });
+
+  test('primary URL returns 404, index.json has no .xml item → returns null', async () => {
+    const emptyIndex = JSON.stringify({ directory: { item: [{ name: 'readme.txt', type: '' }] } });
+    const fetch = makeRouteFetch({
+      [PRIMARY_URL]: { status: 404, text: async () => 'Not Found' },
+      [INDEX_URL]: { status: 200, text: async () => emptyIndex },
+    });
+    const result = await fetchForm4Xml('0000320193', '0001193125-25-123456', fetch);
+    expect(result).toBeNull();
+  });
+
+  test('primary URL returns 404, index.json fetch fails → returns null, no throw', async () => {
+    const fetch = makeRouteFetch({
+      [PRIMARY_URL]: { status: 404, text: async () => 'Not Found' },
+      // INDEX_URL not in routes → fetch rejects
+    });
+    await expect(fetchForm4Xml('0000320193', '0001193125-25-123456', fetch)).resolves.toBeNull();
+  });
+
+  test('both fetches fail → returns null, no throw', async () => {
+    const fetch = jest.fn().mockRejectedValue(new Error('Network error'));
+    await expect(fetchForm4Xml('0000320193', '0001193125-25-123456', fetch)).resolves.toBeNull();
+  });
+
+  test('User-Agent header present on requests', async () => {
+    const fetch = jest.fn((url, opts) =>
+      Promise.resolve({ status: 200, text: async () => SAMPLE_XML })
+    );
+    await fetchForm4Xml('0000320193', '0001193125-25-123456', fetch);
+    const headers = fetch.mock.calls[0][1] || {};
+    expect(headers['User-Agent']).toBe('EarlyInsider/1.0 (contact@earlyinsider.com)');
+  });
+});
+
+// ─── parseForm4Xml ────────────────────────────────────────────────────────────
+
+describe('parseForm4Xml() — fixture 1: standard buy', () => {
+  let result;
+  beforeAll(() => { result = parseForm4Xml(FIXTURE_STANDARD_BUY); });
+
+  test('documentType is "4"', () => { expect(result.documentType).toBe('4'); });
+  test('isAmendment is false', () => { expect(result.isAmendment).toBe(false); });
+  test('issuer.ticker is NVDA', () => { expect(result.issuer.ticker).toBe('NVDA'); });
+  test('issuer.name is NVIDIA CORP', () => { expect(result.issuer.name).toBe('NVIDIA CORP'); });
+  test('owner.name is Jensen Huang', () => { expect(result.owner.name).toBe('Jensen Huang'); });
+  test('owner.isOfficer is true', () => { expect(result.owner.isOfficer).toBe(true); });
+  test('owner.officerTitle is President and CEO', () => {
+    expect(result.owner.officerTitle).toBe('President and CEO');
+  });
+  test('nonDerivativeTransactions has length 1', () => {
+    expect(result.nonDerivativeTransactions).toHaveLength(1);
+  });
+  test('transaction[0].transactionCode is P', () => {
+    expect(result.nonDerivativeTransactions[0].transactionCode).toBe('P');
+  });
+  test('transaction[0].shares is 100000', () => {
+    expect(result.nonDerivativeTransactions[0].shares).toBe(100000);
+  });
+  test('transaction[0].pricePerShare is 145.23 (number, not null)', () => {
+    expect(result.nonDerivativeTransactions[0].pricePerShare).toBe(145.23);
+  });
+  test('transaction[0].acquiredDisposed is A', () => {
+    expect(result.nonDerivativeTransactions[0].acquiredDisposed).toBe('A');
+  });
+  test('transaction[0].directOwnership is D', () => {
+    expect(result.nonDerivativeTransactions[0].directOwnership).toBe('D');
+  });
+  test('derivativeTransactions is empty array', () => {
+    expect(result.derivativeTransactions).toEqual([]);
+  });
+});
+
+describe('parseForm4Xml() — fixture 2: amendment', () => {
+  test('documentType is 4/A', () => {
+    const result = parseForm4Xml(FIXTURE_AMENDMENT);
+    expect(result.documentType).toBe('4/A');
+  });
+  test('isAmendment is true', () => {
+    const result = parseForm4Xml(FIXTURE_AMENDMENT);
+    expect(result.isAmendment).toBe(true);
+  });
+});
+
+describe('parseForm4Xml() — fixture 3: gift (no pricePerShare element)', () => {
+  test('transactionCode is G', () => {
+    const result = parseForm4Xml(FIXTURE_GIFT_NO_PRICE);
+    expect(result.nonDerivativeTransactions[0].transactionCode).toBe('G');
+  });
+  test('pricePerShare is null — NOT 0, NOT NaN (element absent from XML)', () => {
+    const result = parseForm4Xml(FIXTURE_GIFT_NO_PRICE);
+    expect(result.nonDerivativeTransactions[0].pricePerShare).toBeNull();
+  });
+});
+
+describe('parseForm4Xml() — fixture 4: option exercise (derivative)', () => {
+  test('derivativeTransactions has 1 item', () => {
+    const result = parseForm4Xml(FIXTURE_OPTION_EXERCISE);
+    expect(result.derivativeTransactions).toHaveLength(1);
+  });
+  test('derivativeTransactions[0].transactionCode is M', () => {
+    const result = parseForm4Xml(FIXTURE_OPTION_EXERCISE);
+    expect(result.derivativeTransactions[0].transactionCode).toBe('M');
+  });
+  test('nonDerivativeTransactions is empty', () => {
+    const result = parseForm4Xml(FIXTURE_OPTION_EXERCISE);
+    expect(result.nonDerivativeTransactions).toEqual([]);
+  });
+});
+
+describe('parseForm4Xml() — fixture 5: multi-transaction', () => {
+  test('nonDerivativeTransactions.length === 3', () => {
+    const result = parseForm4Xml(FIXTURE_MULTI_TRANSACTION);
+    expect(result.nonDerivativeTransactions).toHaveLength(3);
+  });
+});
+
+describe('parseForm4Xml() — edge cases', () => {
+  test('entity encoding: AT&amp;T INC decoded to AT&T INC', () => {
+    const xml = FIXTURE_STANDARD_BUY.replace('NVIDIA CORP', 'AT&amp;T INC');
+    const result = parseForm4Xml(xml);
+    expect(result.issuer.name).toBe('AT&T INC');
+  });
+
+  test('namespace prefix: transactionDate still extracted correctly', () => {
+    const xml = FIXTURE_STANDARD_BUY.replace(
+      '<transactionDate><value>2025-04-15</value></transactionDate>',
+      '<edgar:transactionDate><value>2025-04-15</value></edgar:transactionDate>'
+    );
+    const result = parseForm4Xml(xml);
+    expect(result.nonDerivativeTransactions[0].transactionDate).toBe('2025-04-15');
+  });
+
+  test('missing issuerTradingSymbol → returns null', () => {
+    const xml = FIXTURE_STANDARD_BUY.replace(
+      '<issuerTradingSymbol>NVDA</issuerTradingSymbol>', ''
+    );
+    const result = parseForm4Xml(xml);
+    expect(result).toBeNull();
+  });
+
+  test('malformed XML (empty string) → returns null, no throw', () => {
+    expect(parseForm4Xml('')).toBeNull();
+  });
+
+  test('malformed XML (truncated mid-tag) → returns null, no throw', () => {
+    expect(parseForm4Xml('<ownershipDocument><documentType>4</doc')).toBeNull();
+  });
+
+  test('comma-formatted share count parsed correctly (1,000 → 1000)', () => {
+    const xml = FIXTURE_STANDARD_BUY.replace(
+      '<transactionShares><value>100000</value></transactionShares>',
+      '<transactionShares><value>1,000</value></transactionShares>'
+    );
+    const result = parseForm4Xml(xml);
+    expect(result.nonDerivativeTransactions[0].shares).toBe(1000);
+  });
+});
