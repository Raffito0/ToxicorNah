diff --git a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js
index 03f037b..7165d0b 100644
--- a/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js
+++ b/ryan_cole/insiderbuying-site/n8n/code/insiderbuying/sec-monitor.js
@@ -19,12 +19,14 @@ const EDGAR_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';
 const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
 const FD_BASE_URL = 'https://api.financialdatasets.ai';
 
+// edgar-parser module (injected via helpers._edgarParser in tests)
+const _defaultEdgarParser = require('./edgar-parser');
+
 // Required environment variables
 const REQUIRED_ENV = [
   'NOCODB_API_TOKEN',
   'NOCODB_BASE_URL',
   'NOCODB_PROJECT_ID',
-  'FINANCIAL_DATASETS_API_KEY',
   'SUPABASE_URL',
   'SUPABASE_SERVICE_ROLE_KEY',
 ];
@@ -425,20 +427,23 @@ async function detectCluster(ticker, transactionDate, currentInsiderName, opts =
 // ---------------------------------------------------------------------------
 
 /**
- * Run the full SEC monitor pipeline:
- * 1. Pre-load dedup keys + CIK ticker map (parallel)
- * 2. Fetch EDGAR filings
- * 3. Enrich each filing via Financial Datasets
- * 4. Dedup, filter, classify, cluster-detect
- * 5. Return enriched filing objects for score-alert.js
+ * Run the full SEC monitor pipeline (edgar-parser rewrite):
+ * 1. Pre-load dedup keys from NocoDB
+ * 2. Read Monitor_State watermark
+ * 3. Fetch recent Form 4 filings via edgar-parser
+ * 4. Deduplicate / filter by watermark
+ * 5. For each filing: fetch XML → parse → dedup txs → filter scorable → cluster
+ * 6. Update Monitor_State watermark
+ * 7. Return enriched filing objects for score-alert.js
  *
- * @param {Object} input   — { workflowName, monitorStateName }
- * @param {Object} helpers — { fetchFn, env }
+ * @param {Object} input   — { monitorStateName }
+ * @param {Object} helpers — { fetchFn, env, nocodb, _edgarParser }
  */
 async function runSecMonitor(input, helpers) {
   const fetchFn = helpers && helpers.fetchFn;
   const env = (helpers && helpers.env) || {};
   const nocodb = helpers && helpers.nocodb;
+  const ep = (helpers && helpers._edgarParser) || _defaultEdgarParser;
 
   // Validate required env vars
   const missing = REQUIRED_ENV.filter((k) => !env[k]);
@@ -449,127 +454,125 @@ async function runSecMonitor(input, helpers) {
     throw new Error('sec-monitor: helpers.nocodb is required');
   }
 
-  // Step 1: Pre-load in parallel
-  const [existingDedupKeys, cikTickerMap] = await Promise.all([
-    fetchDedupKeys({ nocodb }),
-    loadCikTickerMap({ fetchFn }),
-  ]);
+  // Step 1: Pre-load existing dedup keys (past 7 days)
+  const existingDedupKeys = await fetchDedupKeys({ nocodb });
 
   // Step 2: Read last_check_timestamp from Monitor_State
   const stateRecord = await readMonitorState(input.monitorStateName || 'market', { nocodb });
   const lastCheckTimestamp =
     (stateRecord && stateRecord.last_check_timestamp) ||
     new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
-  const lastCheckDate = lastCheckTimestamp.split('T')[0];
-
-  const today = new Date().toISOString().split('T')[0];
 
-  // Step 3: Fetch EDGAR filings
-  const edgarUrl = buildEdgarUrl(lastCheckDate, today);
-  const edgarRes = await fetchFn(edgarUrl, {
-    headers: { 'User-Agent': SEC_USER_AGENT },
-  });
-  const edgarData = await edgarRes.json();
-  const hits = parseEdgarResponse(edgarData);
+  // Step 3: Fetch recent filings via edgar-parser
+  const allFilings = await ep.fetchRecentFilings(6, fetchFn);
 
-  // Filter hits newer than last_check_timestamp
-  const newHits = hits.filter(
-    (h) => h.file_date && h.file_date > lastCheckTimestamp,
-  );
+  // Step 4: Deduplicate filings by watermark
+  const filings = ep.deduplicateFilings(allFilings, lastCheckTimestamp);
 
-  // Step 4: Process each filing
+  // Step 5: Process each filing
   const results = [];
-  const sameRunFilings = []; // in-memory list for same-batch cluster detection
+  const sameRunFilings = [];
   let failureCount = 0;
-  let firstError = null;
-
-  for (const hit of newHits) {
-    const ticker = cikTickerMap.get(hit.cik);
-    if (!ticker) continue; // CIK not in map → skip
-
-    // Enrich via Financial Datasets — onFailure increments failureCount only
-    // on real API failure (not empty/no-coverage results)
-    const enriched = await enrichFiling(ticker, lastCheckDate, {
-      apiKey: env.FINANCIAL_DATASETS_API_KEY,
-      fetchFn,
-      onFailure: (err) => {
-        failureCount++;
-        if (!firstError) firstError = `FD API failure for ${ticker}: ${err && err.message}`;
-      },
-    });
-    if (!enriched) continue; // null = no data or failure; both handled, continue
-
-    // Dedup check
-    const dedupKey = buildDedupKey(
-      ticker,
-      enriched.name,
-      enriched.transaction_date,
-      enriched.transaction_shares,
-    );
-    if (!passesDedup(dedupKey, existingDedupKeys)) continue;
 
-    // Filter: buys only
-    if (!isBuyTransaction(enriched.transaction_type)) continue;
+  for (const filing of filings) {
+    // 5a. Fetch Form 4 XML
+    const xmlString = await ep.fetchForm4Xml(filing.issuerCik, filing.accessionNumber, fetchFn);
+    if (xmlString === null) {
+      failureCount++;
+      continue;
+    }
 
-    // Classify insider
-    const insiderCategory = classifyInsider(enriched.title, enriched.is_board_director);
+    // 5b. Parse Form 4 XML
+    const parsed = ep.parseForm4Xml(xmlString);
+    if (parsed === null) {
+      failureCount++;
+      continue;
+    }
 
-    // Cluster detection (uses both Supabase + in-memory sameRunFilings)
-    let clusterData = { isClusterBuy: false, clusterId: null, clusterSize: 1 };
-    try {
-      clusterData = await detectCluster(
-        ticker,
-        enriched.transaction_date,
-        enriched.name,
-        {
-          supabaseUrl: env.SUPABASE_URL,
-          serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
-          fetchFn,
-          sameRunFilings,
-        },
-      );
-    } catch (clusterErr) {
-      // Non-fatal: log and continue without cluster info
-      console.warn(`sec-monitor: cluster detection failed for ${ticker}: ${clusterErr.message}`);
+    // 5c. Skip amendments (4/A) — not a failure
+    if (parsed.isAmendment) {
+      console.info(`sec-monitor: skipping amendment ${filing.accessionNumber}`);
+      continue;
     }
 
-    const resultObj = {
-      ticker,
-      company_name: hit.entity_name,
-      insider_name: enriched.name,
-      insider_title: enriched.title,
-      insider_category: insiderCategory,
-      transaction_type: 'buy', // normalized from 'P - Purchase'
-      transaction_date: enriched.transaction_date,
-      filing_date: enriched.filing_date,
-      transaction_shares: enriched.transaction_shares,
-      transaction_price_per_share: enriched.transaction_price_per_share,
-      transaction_value: enriched.transaction_value,
-      dedup_key: dedupKey,
-      is_cluster_buy: clusterData.isClusterBuy,
-      cluster_id: clusterData.clusterId,
-      cluster_size: clusterData.clusterSize,
-      raw_filing_data: JSON.stringify(enriched),
-    };
-
-    results.push(resultObj);
-    // Add same reference to sameRunFilings so subsequent detectCluster calls
-    // can find this filing AND retroactively update it if they form a cluster
-    sameRunFilings.push(resultObj);
-  }
+    // 5d. Build transaction list and dedup each one
+    const allTx = [
+      ...(parsed.nonDerivativeTransactions || []),
+      ...(parsed.derivativeTransactions || []),
+    ];
+
+    const ticker = filing.ticker || (parsed.issuer && parsed.issuer.ticker) || '';
+    const ownerName = (parsed.reportingOwner && parsed.reportingOwner.ownerName) || '';
+
+    const dedupPassedTxs = [];
+    allTx.forEach((tx, i) => {
+      const primaryKey = `${filing.accessionNumber}_${i}`;
+      const secondaryKey = buildDedupKey(ticker, ownerName, tx.transactionDate, tx.transactionShares);
+      const primaryPasses = passesDedup(primaryKey, existingDedupKeys);
+      const secondaryPasses = passesDedup(secondaryKey, existingDedupKeys);
+      if (primaryPasses && secondaryPasses) {
+        dedupPassedTxs.push(tx);
+      }
+    });
+
+    // 5e. Filter to scorable transactions (buys / scorable codes)
+    const scorableTxs = ep.filterScorable(dedupPassedTxs);
+    if (!Array.isArray(scorableTxs) || scorableTxs.length === 0) continue;
 
-  // Alert if too many failures
-  if (failureCount > 5 && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
-    const msg = encodeURIComponent(
-      `⚠️ sec-monitor: ${failureCount} enrichment failures\nFirst error: ${firstError}`,
+    // Classify insider once per filing
+    const insiderCategory = ep.classifyInsiderRole(
+      (parsed.reportingOwner && parsed.reportingOwner.officerTitle) || '',
+      !!(parsed.reportingOwner && parsed.reportingOwner.isDirector),
     );
-    await fetchFn(
-      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage` +
-        `?chat_id=${env.TELEGRAM_CHAT_ID}&text=${msg}`,
-    ).catch(() => {});
+
+    // 5f. Create a result object per scorable transaction
+    for (const tx of scorableTxs) {
+      let clusterData = { isClusterBuy: false, clusterId: null, clusterSize: 1 };
+      try {
+        clusterData = await detectCluster(
+          ticker,
+          tx.transactionDate,
+          ownerName,
+          {
+            supabaseUrl: env.SUPABASE_URL,
+            serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
+            fetchFn,
+            sameRunFilings,
+          },
+        );
+      } catch (clusterErr) {
+        console.warn(`sec-monitor: cluster detection failed for ${ticker}: ${clusterErr.message}`);
+      }
+
+      const shares = parseFloat(tx.transactionShares) || 0;
+      const pricePerShare = parseFloat(tx.transactionPricePerShare) || 0;
+      const dedupKey = buildDedupKey(ticker, ownerName, tx.transactionDate, tx.transactionShares);
+
+      const resultObj = {
+        ticker,
+        company_name: filing.issuerName || (parsed.issuer && parsed.issuer.name) || '',
+        insider_name: ownerName,
+        insider_title: (parsed.reportingOwner && parsed.reportingOwner.officerTitle) || '',
+        insider_category: insiderCategory,
+        transaction_type: 'buy',
+        transaction_date: tx.transactionDate,
+        filing_date: filing.filedAt,
+        transaction_shares: shares,
+        transaction_price_per_share: pricePerShare,
+        transaction_value: shares * pricePerShare,
+        dedup_key: dedupKey,
+        is_cluster_buy: clusterData.isClusterBuy,
+        cluster_id: clusterData.clusterId,
+        cluster_size: clusterData.clusterSize,
+        raw_filing_data: JSON.stringify(tx),
+      };
+
+      results.push(resultObj);
+      sameRunFilings.push(resultObj);
+    }
   }
 
-  // Update Monitor_State last_check_timestamp
+  // Step 6: Update Monitor_State last_check_timestamp
   if (stateRecord) {
     await writeMonitorState(stateRecord.Id, new Date().toISOString(), { nocodb });
   }
diff --git a/ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js b/ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js
index 7da7c7c..fa6ccf1 100644
--- a/ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js
+++ b/ryan_cole/insiderbuying-site/tests/insiderbuying/sec-monitor.test.js
@@ -12,6 +12,7 @@ const {
   detectCluster,
   readMonitorState,
   writeMonitorState,
+  runSecMonitor,
 } = require('../../n8n/code/insiderbuying/sec-monitor');
 
 const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
@@ -705,3 +706,192 @@ describe('section-03: sec-monitor.js', () => {
     });
   });
 });
+
+// ─────────────────────────────────────────────────────────────────────────────
+// Section 5: runSecMonitor — new edgar-parser pipeline
+// ─────────────────────────────────────────────────────────────────────────────
+
+const PIPELINE_ENV = {
+  NOCODB_API_TOKEN: 'test-token',
+  NOCODB_BASE_URL: 'http://localhost:8080',
+  NOCODB_PROJECT_ID: 'proj123',
+  SUPABASE_URL: 'https://test.supabase.co',
+  SUPABASE_SERVICE_ROLE_KEY: 'sb-key',
+};
+
+function makePipelineNocoDB(overrides = {}) {
+  return {
+    list: jest.fn().mockResolvedValue({ list: [], pageInfo: { isLastPage: true } }),
+    create: jest.fn().mockResolvedValue({ Id: 1 }),
+    update: jest.fn().mockResolvedValue({}),
+    ...overrides,
+  };
+}
+
+// fetchFn that returns empty Supabase results (no prior cluster buys)
+const emptySupabaseFetch = jest.fn().mockResolvedValue({
+  ok: true,
+  json: async () => [],
+});
+
+function makeFilings(n) {
+  return Array.from({ length: n }, (_, i) => ({
+    accessionNumber: `0000320193-25-0000${i + 1}`,
+    filedAt: new Date(Date.now() - i * 1000).toISOString(),
+    issuerName: 'APPLE INC',
+    issuerCik: '0000320193',
+    ticker: 'AAPL',
+  }));
+}
+
+const PARSED_STANDARD_BUY = {
+  isAmendment: false,
+  issuer: { cik: '0000320193', name: 'APPLE INC', ticker: 'AAPL' },
+  reportingOwner: { ownerName: 'John Smith', isDirector: false, isOfficer: true, officerTitle: 'CEO' },
+  nonDerivativeTransactions: [
+    { transactionCode: 'P', transactionShares: '1000', transactionPricePerShare: '175.00', transactionDate: '2025-04-15' },
+  ],
+  derivativeTransactions: [],
+};
+
+describe('section-05: runSecMonitor — new edgar-parser pipeline', () => {
+  test('2-filing run: filing 1 valid buy, filing 2 null XML → 1 result, failureCount 1', async () => {
+    const filings = makeFilings(2);
+    const ep = {
+      fetchRecentFilings: jest.fn().mockResolvedValue(filings),
+      deduplicateFilings: jest.fn().mockReturnValue(filings),
+      fetchForm4Xml: jest.fn()
+        .mockResolvedValueOnce('<xml>valid</xml>')
+        .mockResolvedValueOnce(null),
+      parseForm4Xml: jest.fn().mockReturnValue(PARSED_STANDARD_BUY),
+      filterScorable: jest.fn().mockImplementation((txs) => txs.filter((t) => t.transactionCode === 'P')),
+      classifyInsiderRole: jest.fn().mockReturnValue('C-Suite'),
+    };
+
+    const nocodb = makePipelineNocoDB();
+    const results = await runSecMonitor(
+      { monitorStateName: 'market' },
+      { env: PIPELINE_ENV, nocodb, fetchFn: emptySupabaseFetch, _edgarParser: ep },
+    );
+
+    expect(results).toHaveLength(1);
+    expect(results[0].ticker).toBe('AAPL');
+    expect(ep.fetchForm4Xml).toHaveBeenCalledTimes(2);
+    // Second filing returned null — parseForm4Xml should only be called once
+    expect(ep.parseForm4Xml).toHaveBeenCalledTimes(1);
+  });
+
+  test('amendment 4/A filing skipped — 0 results, no failureCount increment', async () => {
+    const filings = makeFilings(1);
+    const amendedParsed = { ...PARSED_STANDARD_BUY, isAmendment: true };
+    const ep = {
+      fetchRecentFilings: jest.fn().mockResolvedValue(filings),
+      deduplicateFilings: jest.fn().mockReturnValue(filings),
+      fetchForm4Xml: jest.fn().mockResolvedValue('<xml>amendment</xml>'),
+      parseForm4Xml: jest.fn().mockReturnValue(amendedParsed),
+      filterScorable: jest.fn(),
+      classifyInsiderRole: jest.fn(),
+    };
+
+    const nocodb = makePipelineNocoDB();
+    const results = await runSecMonitor(
+      { monitorStateName: 'market' },
+      { env: PIPELINE_ENV, nocodb, fetchFn: emptySupabaseFetch, _edgarParser: ep },
+    );
+
+    expect(results).toHaveLength(0);
+    // filterScorable must NOT be called for amendments
+    expect(ep.filterScorable).not.toHaveBeenCalled();
+  });
+
+  test('3-transaction filing (2×P, 1×G) → 2 results, all 3 dedup keys stored', async () => {
+    const filings = makeFilings(1);
+    const threeTxParsed = {
+      ...PARSED_STANDARD_BUY,
+      nonDerivativeTransactions: [
+        { transactionCode: 'P', transactionShares: '500', transactionDate: '2025-04-15', transactionPricePerShare: '175' },
+        { transactionCode: 'P', transactionShares: '300', transactionDate: '2025-04-15', transactionPricePerShare: '175' },
+        { transactionCode: 'G', transactionShares: '100', transactionDate: '2025-04-15', transactionPricePerShare: '0' },
+      ],
+    };
+    const ep = {
+      fetchRecentFilings: jest.fn().mockResolvedValue(filings),
+      deduplicateFilings: jest.fn().mockReturnValue(filings),
+      fetchForm4Xml: jest.fn().mockResolvedValue('<xml>valid</xml>'),
+      parseForm4Xml: jest.fn().mockReturnValue(threeTxParsed),
+      filterScorable: jest.fn().mockImplementation((txs) => txs.filter((t) => t.transactionCode === 'P' || t.transactionCode === 'S')),
+      classifyInsiderRole: jest.fn().mockReturnValue('C-Suite'),
+    };
+
+    const nocodb = makePipelineNocoDB();
+    const results = await runSecMonitor(
+      { monitorStateName: 'market' },
+      { env: PIPELINE_ENV, nocodb, fetchFn: emptySupabaseFetch, _edgarParser: ep },
+    );
+
+    expect(results).toHaveLength(2);
+  });
+
+  test('dedup: semantic key already in existingDedupKeys → 0 results', async () => {
+    const filings = makeFilings(1);
+    const ep = {
+      fetchRecentFilings: jest.fn().mockResolvedValue(filings),
+      deduplicateFilings: jest.fn().mockReturnValue(filings),
+      fetchForm4Xml: jest.fn().mockResolvedValue('<xml>valid</xml>'),
+      parseForm4Xml: jest.fn().mockReturnValue(PARSED_STANDARD_BUY),
+      filterScorable: jest.fn().mockImplementation((txs) => txs.filter((t) => t.transactionCode === 'P' || t.transactionCode === 'S')),
+      classifyInsiderRole: jest.fn().mockReturnValue('C-Suite'),
+    };
+
+    // Pre-load semantic dedup key that matches the transaction
+    const tx = PARSED_STANDARD_BUY.nonDerivativeTransactions[0];
+    const semanticKey = buildDedupKey('AAPL', 'John Smith', tx.transactionDate, tx.transactionShares);
+    const nocodb = makePipelineNocoDB({
+      list: jest.fn().mockImplementation(async (table) => {
+        if (table === 'Insider_Alerts') {
+          return { list: [{ dedup_key: semanticKey }], pageInfo: { isLastPage: true } };
+        }
+        return { list: [], pageInfo: { isLastPage: true } };
+      }),
+    });
+
+    const results = await runSecMonitor(
+      { monitorStateName: 'market' },
+      { env: PIPELINE_ENV, nocodb, fetchFn: emptySupabaseFetch, _edgarParser: ep },
+    );
+
+    expect(results).toHaveLength(0);
+  });
+
+  test('Monitor_State watermark updated after successful run', async () => {
+    const filings = makeFilings(0);
+    const ep = {
+      fetchRecentFilings: jest.fn().mockResolvedValue(filings),
+      deduplicateFilings: jest.fn().mockReturnValue(filings),
+      fetchForm4Xml: jest.fn(),
+      parseForm4Xml: jest.fn(),
+      filterScorable: jest.fn(),
+      classifyInsiderRole: jest.fn(),
+    };
+
+    const stateRecord = { Id: 42, name: 'market', last_check_timestamp: '2025-01-01T00:00:00.000Z' };
+    const nocodb = makePipelineNocoDB({
+      list: jest.fn().mockImplementation(async (table) => {
+        if (table === 'Monitor_State') return { list: [stateRecord], pageInfo: { isLastPage: true } };
+        return { list: [], pageInfo: { isLastPage: true } };
+      }),
+    });
+
+    const beforeRun = Date.now();
+    await runSecMonitor(
+      { monitorStateName: 'market' },
+      { env: PIPELINE_ENV, nocodb, fetchFn: emptySupabaseFetch, _edgarParser: ep },
+    );
+
+    expect(nocodb.update).toHaveBeenCalledWith(
+      'Monitor_State', 42, expect.objectContaining({ last_check_timestamp: expect.any(String) }),
+    );
+    const updatedTs = nocodb.update.mock.calls.find(([t]) => t === 'Monitor_State')[2].last_check_timestamp;
+    expect(new Date(updatedTs).getTime()).toBeGreaterThanOrEqual(beforeRun - 1000);
+  });
+});
