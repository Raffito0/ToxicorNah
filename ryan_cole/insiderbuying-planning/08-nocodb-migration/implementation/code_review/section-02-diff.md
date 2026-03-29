diff --git a/insiderbuying-site/n8n/code/insiderbuying/deliver-alert.js b/insiderbuying-site/n8n/code/insiderbuying/deliver-alert.js
index 6c1b6e9..5976824 100644
--- a/insiderbuying-site/n8n/code/insiderbuying/deliver-alert.js
+++ b/insiderbuying-site/n8n/code/insiderbuying/deliver-alert.js
@@ -3,7 +3,7 @@
 // ─── deliver-alert.js ──────────────────────────────────────────────────────
 // W5 Alert Delivery node for InsiderBuying.ai pipeline.
 // Sends email via Resend and push via OneSignal to eligible subscribers,
-// then updates Airtable with delivery tracking.
+// then updates NocoDB with delivery tracking.
 // ────────────────────────────────────────────────────────────────────────────
 
 const POSTAL_ADDRESS = '123 Market Street, Suite 100, San Francisco, CA 94105';
@@ -214,22 +214,14 @@ async function sendOneSignalPush(alertData, supabaseAlertId, opts) {
 // ─── 6.4 Delivery Tracking ──────────────────────────────────────────────────
 
 async function updateDeliveryStatus(recordId, fields, opts) {
-  const { fetchFn, env } = opts;
-  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}/${recordId}`;
-  await fetchFn(url, {
-    method: 'PATCH',
-    headers: {
-      Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
-      'Content-Type': 'application/json',
-    },
-    body: JSON.stringify({ fields }),
-  });
+  const { nocodb } = opts;
+  await nocodb.update('Insider_Alerts', recordId, fields);
 }
 
 // ─── Main orchestrator ──────────────────────────────────────────────────────
 
 async function deliverAlert(alertData, opts) {
-  const { fetchFn, env, _sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
+  const { fetchFn, env, nocodb, _sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
 
   let totalEmailsSent = 0;
   let pushSentCount = 0;
@@ -279,15 +271,15 @@ async function deliverAlert(alertData, opts) {
     trackingFields.error_log = errors.join('; ');
   }
 
-  // Update Airtable delivery tracking
+  // Update NocoDB delivery tracking
   try {
-    await updateDeliveryStatus(alertData.airtable_record_id, trackingFields, { fetchFn, env });
+    await updateDeliveryStatus(alertData.nocodb_record_id, trackingFields, { nocodb });
   } catch (err) {
     console.warn(`[deliver-alert] Failed to update delivery status: ${err.message}`);
   }
 
   return {
-    airtable_record_id: alertData.airtable_record_id,
+    nocodb_record_id: alertData.nocodb_record_id,
     supabase_alert_id: alertData.supabase_alert_id,
     ticker: alertData.ticker,
     emails_sent: totalEmailsSent,
diff --git a/insiderbuying-site/n8n/code/insiderbuying/score-alert.js b/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
index c781e81..879f417 100644
--- a/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
+++ b/insiderbuying-site/n8n/code/insiderbuying/score-alert.js
@@ -4,7 +4,7 @@
 // Significance scoring node for the W4 InsiderBuying.ai pipeline.
 // Runs after sec-monitor.js, before analyze-alert.js.
 // Computes a 1-10 significance score using Claude Haiku plus insider track
-// record from Supabase history and Yahoo Finance 30-day price returns.
+// record from NocoDB Insider_History and Yahoo Finance 30-day price returns.
 // ────────────────────────────────────────────────────────────────────────────
 
 const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
@@ -71,40 +71,30 @@ async function fetch30DayReturn(ticker, filingDateStr, fetchFn) {
 // ─── 3.1 computeTrackRecord ─────────────────────────────────────────────────
 
 /**
- * Queries Supabase for past buys by this insider (past 24 months),
+ * Queries NocoDB Insider_History for past buys by this insider (past 24 months),
  * then fetches 30-day returns from Yahoo Finance for each.
  *
  * Returns { past_buy_count, hit_rate, avg_gain_30d }
  * hit_rate and avg_gain_30d are null if Yahoo data unavailable.
  */
-async function computeTrackRecord(insiderName, supabaseUrl, supabaseKey, { fetchFn } = {}) {
+async function computeTrackRecord(insiderName, nocodb, { fetchFn } = {}) {
   const cutoff = new Date();
   cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
   const cutoffStr = cutoff.toISOString().slice(0, 10);
 
   const normalizedName = normalizeInsiderName(insiderName);
-  // PostgREST ilike uses SQL LIKE syntax: % is wildcard, not *
-  const namePattern = `%${normalizedName.split(' ').join('%')}%`;
+  // NocoDB like is case-sensitive — lowercase and encode the name
+  const encodedName = encodeURIComponent(normalizedName.toLowerCase());
+  const where = `(insider_name,like,%${encodedName}%)~and(filing_date,gt,${cutoffStr})`;
 
   let rows = [];
   try {
-    const params = new URLSearchParams({
-      select: 'ticker,filing_date,total_value',
-      transaction_type: 'eq.buy',
-      'filing_date': `gte.${cutoffStr}`,
-      'insider_name': `ilike.${namePattern}`,
+    const result = await nocodb.list('Insider_History', {
+      where,
+      fields: 'ticker,filing_date,total_value',
+      limit: 100,
     });
-    const url = `${supabaseUrl}/rest/v1/insider_alerts?${params}`;
-    const resp = await fetchFn(url, {
-      headers: {
-        apikey: supabaseKey,
-        Authorization: `Bearer ${supabaseKey}`,
-      },
-    });
-    if (!resp.ok) {
-      return { past_buy_count: 0, hit_rate: null, avg_gain_30d: null };
-    }
-    rows = await resp.json();
+    rows = result.list || [];
   } catch {
     return { past_buy_count: 0, hit_rate: null, avg_gain_30d: null };
   }
@@ -298,11 +288,11 @@ async function callHaiku(prompt, anthropicApiKey, { fetchFn, _sleep } = {}) {
  * and returns the enriched filing array.
  *
  * @param {Array} filings - Array of filing objects from sec-monitor.js
- * @param {Object} helpers - { supabaseUrl, supabaseKey, anthropicApiKey, fetchFn, _sleep }
+ * @param {Object} helpers - { nocodb, anthropicApiKey, fetchFn, _sleep }
  * @returns {Array} filings enriched with significance_score, score_reasoning, track_record
  */
 async function runScoreAlert(filings, helpers = {}) {
-  const { supabaseUrl, supabaseKey, anthropicApiKey, fetchFn, _sleep } = helpers;
+  const { nocodb, anthropicApiKey, fetchFn, _sleep } = helpers;
 
   if (!filings || filings.length === 0) return [];
 
@@ -312,8 +302,7 @@ async function runScoreAlert(filings, helpers = {}) {
     // Step 1: compute track record (graceful on any failure)
     const trackRecord = await computeTrackRecord(
       filing.insider_name,
-      supabaseUrl,
-      supabaseKey,
+      nocodb,
       { fetchFn }
     );
 
@@ -347,9 +336,12 @@ async function runScoreAlert(filings, helpers = {}) {
 // Entry block for n8n Code node:
 //
 //   const filings = $input.all().map(item => item.json);
+//   const nocodb = new NocoDB(
+//     $env.NOCODB_BASE_URL, $env.NOCODB_API_TOKEN, $env.NOCODB_PROJECT_ID,
+//     (url, opts) => fetch(url, opts)
+//   );
 //   const helpers = {
-//     supabaseUrl: $env.SUPABASE_URL,
-//     supabaseKey: $env.SUPABASE_SERVICE_ROLE_KEY,
+//     nocodb,
 //     anthropicApiKey: $env.ANTHROPIC_API_KEY,
 //     fetchFn: (url, opts) => fetch(url, opts),
 //     _sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
diff --git a/insiderbuying-site/n8n/code/insiderbuying/write-persistence.js b/insiderbuying-site/n8n/code/insiderbuying/write-persistence.js
index 765c807..d1ad011 100644
--- a/insiderbuying-site/n8n/code/insiderbuying/write-persistence.js
+++ b/insiderbuying-site/n8n/code/insiderbuying/write-persistence.js
@@ -3,19 +3,18 @@
 // ─── write-persistence.js ──────────────────────────────────────────────────
 // Persistence layer for the W4 InsiderBuying.ai pipeline.
 // Runs after scoring (score-alert.js) and AI analysis (analyze-alert.js).
-// Writes each filing individually to Airtable then Supabase, updates
+// Writes each filing individually to NocoDB then Supabase, updates
 // Monitor_State, creates cluster summaries, and handles error alerting.
 // ────────────────────────────────────────────────────────────────────────────
 
-// ─── 5.1 Create Airtable Record ────────────────────────────────────────────
+// ─── 5.1 Create NocoDB Record ────────────────────────────────────────────────
 
 /**
- * Create a record in Airtable Insider_Alerts for a scored+analyzed filing.
- * Returns the Airtable record ID on success, throws on failure.
+ * Create a record in NocoDB Insider_Alerts for a scored+analyzed filing.
+ * Returns the NocoDB integer Id on success, throws on failure.
  */
 async function createAirtableRecord(filing, opts) {
-  const { fetchFn, env } = opts;
-  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}`;
+  const { nocodb } = opts;
 
   const fields = {
     dedup_key: filing.dedup_key,
@@ -46,20 +45,11 @@ async function createAirtableRecord(filing, opts) {
     fields.cluster_id = filing.cluster_id;
   }
 
-  const res = await fetchFn(url, {
-    method: 'POST',
-    headers: {
-      Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
-      'Content-Type': 'application/json',
-    },
-    body: JSON.stringify({ fields }),
-  });
-
-  const data = await res.json();
-  if (!data.id) {
-    throw new Error(`Airtable create failed: ${JSON.stringify(data)}`);
+  const data = await nocodb.create('Insider_Alerts', fields);
+  if (!data.Id) {
+    throw new Error(`NocoDB create failed: ${JSON.stringify(data)}`);
   }
-  return data.id;
+  return data.Id;
 }
 
 // ─── 5.2 Insert to Supabase ────────────────────────────────────────────────
@@ -121,68 +111,55 @@ async function insertToSupabase(filing, opts) {
 // ─── 5.1+5.2 Combined per-filing write ──────────────────────────────────────
 
 /**
- * Write a single filing to Airtable then Supabase, cross-reference IDs.
+ * Write a single filing to NocoDB then Supabase, cross-reference IDs.
  * Mutates ctx (failureCount, firstError, failedFilings, successfulFilings).
  */
 async function writeFilingPersistence(filing, ctx, opts) {
-  const { fetchFn, env } = opts;
-  let airtableRecordId = null;
+  let nocoRecordId = null;
 
-  // Step 1: Create Airtable record
+  // Step 1: Create NocoDB record
   try {
-    airtableRecordId = await createAirtableRecord(filing, { fetchFn, env });
+    nocoRecordId = await createAirtableRecord(filing, opts);
   } catch (err) {
     ctx.failureCount++;
-    if (!ctx.firstError) ctx.firstError = `Airtable create for ${filing.dedup_key}: ${err.message}`;
+    if (!ctx.firstError) ctx.firstError = `NocoDB create for ${filing.dedup_key}: ${err.message}`;
     ctx.failedFilings.push({ ...filing, _lastError: err.message });
     return;
   }
 
-  // Step 2: Insert to Supabase
+  // Step 2: Insert to Supabase (cast integer Id to string for Supabase column)
   let supabaseId = null;
   try {
-    supabaseId = await insertToSupabase(filing, { fetchFn, env });
+    supabaseId = await insertToSupabase(filing, opts);
   } catch (err) {
     ctx.failureCount++;
     if (!ctx.firstError) ctx.firstError = `Supabase insert for ${filing.dedup_key}: ${err.message}`;
-    ctx.failedFilings.push({ ...filing, airtable_record_id: airtableRecordId, _lastError: err.message });
-    // Attempt to mark Airtable record as failed
+    ctx.failedFilings.push({ ...filing, airtable_record_id: nocoRecordId, _lastError: err.message });
+    // Attempt to mark NocoDB record as failed
     try {
-      await patchAirtableRecord(airtableRecordId, { status: 'failed' }, { fetchFn, env });
+      await patchAirtableRecord(nocoRecordId, { status: 'failed' }, opts);
     } catch (_) { /* non-critical */ }
     return;
   }
 
-  // Step 3: Patch Airtable with supabase_id (non-critical)
+  // Step 3: Patch NocoDB with supabase_id (non-critical)
   if (supabaseId) {
     try {
-      await patchAirtableRecord(airtableRecordId, { supabase_id: supabaseId }, { fetchFn, env });
+      await patchAirtableRecord(nocoRecordId, { supabase_id: supabaseId }, opts);
     } catch (err) {
-      console.warn(`[write-persistence] Failed to patch supabase_id on ${airtableRecordId}: ${err.message}`);
+      console.warn(`[write-persistence] Failed to patch supabase_id on ${nocoRecordId}: ${err.message}`);
     }
   }
 
   // Step 4: Success
-  ctx.successfulFilings.push({ ...filing, airtable_record_id: airtableRecordId, supabase_id: supabaseId });
+  ctx.successfulFilings.push({ ...filing, airtable_record_id: nocoRecordId, supabase_id: supabaseId });
 }
 
-// ─── Helper: PATCH Airtable record ──────────────────────────────────────────
+// ─── Helper: PATCH NocoDB record ────────────────────────────────────────────
 
 async function patchAirtableRecord(recordId, fields, opts) {
-  const { fetchFn, env } = opts;
-  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}/${recordId}`;
-  const res = await fetchFn(url, {
-    method: 'PATCH',
-    headers: {
-      Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
-      'Content-Type': 'application/json',
-    },
-    body: JSON.stringify({ fields }),
-  });
-  if (res && !res.ok) {
-    const errBody = await res.text().catch(() => '');
-    throw new Error(`Airtable PATCH failed (${res.status}): ${errBody}`);
-  }
+  const { nocodb } = opts;
+  await nocodb.update('Insider_Alerts', recordId, fields);
 }
 
 // ─── 5.3 Monitor_State Update ───────────────────────────────────────────────
@@ -193,18 +170,12 @@ async function patchAirtableRecord(recordId, fields, opts) {
  * excluding dead-letter filings (retry_count > 3).
  */
 async function updateMonitorState(workflowName, successfulFilings, failedFilings, firstError, opts) {
-  const { fetchFn, env } = opts;
+  const { nocodb } = opts;
 
   // Fetch the Monitor_State record for this workflow
-  const stateUrl =
-    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.MONITOR_STATE_TABLE_ID}` +
-    `?filterByFormula=${encodeURIComponent(`{name}='${workflowName}'`)}`;
-
-  const stateRes = await fetchFn(stateUrl, {
-    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
-  });
-  const stateData = await stateRes.json();
-  const stateRecord = stateData.records && stateData.records[0];
+  const where = `(name,eq,${encodeURIComponent(workflowName)})`;
+  const stateResult = await nocodb.list('Monitor_State', { where, limit: 1 });
+  const stateRecord = stateResult.list && stateResult.list[0];
   if (!stateRecord) {
     console.warn(`[write-persistence] No Monitor_State record found for workflow '${workflowName}'`);
     return;
@@ -242,29 +213,19 @@ async function updateMonitorState(workflowName, successfulFilings, failedFilings
     fields.last_run_error = firstError;
   }
 
-  await fetchFn(
-    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.MONITOR_STATE_TABLE_ID}/${stateRecord.id}`,
-    {
-      method: 'PATCH',
-      headers: {
-        Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
-        'Content-Type': 'application/json',
-      },
-      body: JSON.stringify({ fields }),
-    },
-  );
+  await nocodb.update('Monitor_State', stateRecord.Id, fields);
 }
 
 // ─── 5.3 Dead-Letter Handler ────────────────────────────────────────────────
 
 /**
- * Mark a filing as dead_letter in Airtable and send Telegram notification.
+ * Mark a filing as dead_letter in NocoDB and send Telegram notification.
  */
-async function handleDeadLetter(filing, airtableRecordId, workflowName, opts) {
+async function handleDeadLetter(filing, nocoRecordId, workflowName, opts) {
   const { fetchFn, env } = opts;
 
-  // PATCH Airtable status
-  await patchAirtableRecord(airtableRecordId, { status: 'dead_letter' }, { fetchFn, env });
+  // PATCH NocoDB status
+  await patchAirtableRecord(nocoRecordId, { status: 'dead_letter' }, opts);
 
   // Send Telegram notification
   if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_MONITORING_CHAT_ID) {
@@ -284,11 +245,11 @@ async function handleDeadLetter(filing, airtableRecordId, workflowName, opts) {
 // ─── 5.4 Cluster Alert Creation ─────────────────────────────────────────────
 
 /**
- * Create or update a cluster summary record in Airtable + Supabase.
+ * Create or update a cluster summary record in NocoDB + Supabase.
  * Returns { created: bool, triggerW5: bool }.
  */
 async function createOrUpdateClusterSummary(clusterId, clusterFilings, opts) {
-  const { fetchFn, env } = opts;
+  const { nocodb } = opts;
 
   // Calculate cluster score
   const maxScore = Math.max(...clusterFilings.map((f) => f.significance_score || 0));
@@ -302,16 +263,10 @@ async function createOrUpdateClusterSummary(clusterId, clusterFilings, opts) {
     .join('; ');
   const analysisText = `Cluster buy alert: ${clusterSize} insiders at ${ticker} buying within 7 days. ${memberSummaries}.`;
 
-  // Check for existing cluster summary in Airtable
-  const searchUrl =
-    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}` +
-    `?filterByFormula=${encodeURIComponent(`AND({transaction_type}='cluster',{cluster_id}='${clusterId}')`)}`;
-
-  const searchRes = await fetchFn(searchUrl, {
-    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
-  });
-  const searchData = await searchRes.json();
-  const existing = searchData.records && searchData.records[0];
+  // Check for existing cluster summary in NocoDB
+  const where = `(transaction_type,eq,cluster)~and(cluster_id,eq,${encodeURIComponent(clusterId)})`;
+  const searchResult = await nocodb.list('Insider_Alerts', { where, limit: 1 });
+  const existing = searchResult.list && searchResult.list[0];
 
   if (!existing) {
     // Create new cluster summary
@@ -331,29 +286,18 @@ async function createOrUpdateClusterSummary(clusterId, clusterFilings, opts) {
       status: 'processed',
     };
 
-    const createRes = await fetchFn(
-      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}`,
-      {
-        method: 'POST',
-        headers: {
-          Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
-          'Content-Type': 'application/json',
-        },
-        body: JSON.stringify({ fields }),
-      },
-    );
-    const createData = await createRes.json();
+    const createData = await nocodb.create('Insider_Alerts', fields);
 
     // Also insert to Supabase
     const supabaseId = await insertToSupabase(
       { ...fields, raw_filing_data: JSON.stringify({ cluster_members: memberSummaries }) },
-      { fetchFn, env },
+      opts,
     );
 
-    // Patch Airtable with supabase_id
-    if (supabaseId && createData.id) {
+    // Patch NocoDB with supabase_id
+    if (supabaseId && createData.Id) {
       try {
-        await patchAirtableRecord(createData.id, { supabase_id: supabaseId }, { fetchFn, env });
+        await patchAirtableRecord(createData.Id, { supabase_id: supabaseId }, opts);
       } catch (_) { /* non-critical */ }
     }
 
@@ -361,12 +305,12 @@ async function createOrUpdateClusterSummary(clusterId, clusterFilings, opts) {
   }
 
   // Update existing cluster summary
-  const oldScore = existing.fields.significance_score || 0;
+  const oldScore = existing.significance_score || 0;
 
   // Use max of old size + new members or new total — dedup prevents double-writes,
   // so additive is safe in the normal flow. Reruns with same filings won't re-insert
   // due to Supabase dedup_key constraint.
-  const newSize = (existing.fields.cluster_size || 0) + clusterFilings.length;
+  const newSize = (existing.cluster_size || 0) + clusterFilings.length;
 
   const updateFields = {
     cluster_size: newSize,
@@ -374,17 +318,7 @@ async function createOrUpdateClusterSummary(clusterId, clusterFilings, opts) {
     ai_analysis: analysisText,
   };
 
-  await fetchFn(
-    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}/${existing.id}`,
-    {
-      method: 'PATCH',
-      headers: {
-        Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
-        'Content-Type': 'application/json',
-      },
-      body: JSON.stringify({ fields: updateFields }),
-    },
-  );
+  await nocodb.update('Insider_Alerts', existing.Id, updateFields);
 
   // Only re-trigger W5 if score increased by >= 2
   const scoreDelta = newScore - oldScore;
@@ -412,7 +346,7 @@ async function runPostProcessing(
   for (const f of failedFilings) {
     if (f.retry_count && f.retry_count > 3 && f.airtable_record_id) {
       try {
-        await handleDeadLetter(f, f.airtable_record_id, workflowName, { fetchFn, env });
+        await handleDeadLetter(f, f.airtable_record_id, workflowName, opts);
       } catch (err) {
         console.warn(`[write-persistence] Dead-letter handling failed for ${f.dedup_key}: ${err.message}`);
       }
@@ -420,10 +354,7 @@ async function runPostProcessing(
   }
 
   // Update Monitor_State
-  await updateMonitorState(workflowName, successfulFilings, failedFilings, firstError, {
-    fetchFn,
-    env,
-  });
+  await updateMonitorState(workflowName, successfulFilings, failedFilings, firstError, opts);
 
   // Telegram alert if too many failures
   if (failureCount > 5 && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_MONITORING_CHAT_ID) {
@@ -448,7 +379,7 @@ async function runPostProcessing(
   const clusterResults = [];
   for (const [cid, filings] of clusterGroups) {
     try {
-      const result = await createOrUpdateClusterSummary(cid, filings, { fetchFn, env });
+      const result = await createOrUpdateClusterSummary(cid, filings, opts);
       clusterResults.push({ clusterId: cid, ...result });
     } catch (err) {
       console.warn(`[write-persistence] Cluster summary failed for ${cid}: ${err.message}`);
diff --git a/insiderbuying-site/tests/insiderbuying/deliver-alert.test.js b/insiderbuying-site/tests/insiderbuying/deliver-alert.test.js
index a8c2827..d3e0d93 100644
--- a/insiderbuying-site/tests/insiderbuying/deliver-alert.test.js
+++ b/insiderbuying-site/tests/insiderbuying/deliver-alert.test.js
@@ -12,6 +12,8 @@ const {
   deliverAlert,
 } = require('../../n8n/code/insiderbuying/deliver-alert');
 
+const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
+
 // --- helpers ----------------------------------------------------------------
 
 function makeFetch(response, ok = true, status = 200) {
@@ -39,9 +41,9 @@ function makeFetchSeq(...calls) {
 const noSleep = jest.fn().mockResolvedValue(undefined);
 
 const BASE_ENV = {
-  AIRTABLE_API_KEY: 'at-key',
-  AIRTABLE_BASE_ID: 'appXXX',
-  INSIDER_ALERTS_TABLE_ID: 'tblAlerts',
+  NOCODB_API_TOKEN: 'test-token',
+  NOCODB_BASE_URL: 'http://localhost:8080',
+  NOCODB_PROJECT_ID: 'test-project-id',
   SUPABASE_URL: 'https://test.supabase.co',
   SUPABASE_SERVICE_ROLE_KEY: 'sb-key',
   RESEND_API_KEY: 'resend-key',
@@ -49,8 +51,12 @@ const BASE_ENV = {
   ONESIGNAL_REST_API_KEY: 'os-rest-key',
 };
 
+function makeNocoDB(fetchFn) {
+  return new NocoDB(BASE_ENV.NOCODB_BASE_URL, BASE_ENV.NOCODB_API_TOKEN, BASE_ENV.NOCODB_PROJECT_ID, fetchFn);
+}
+
 const SAMPLE_ALERT = {
-  airtable_record_id: 'recABC',
+  nocodb_record_id: 1,
   supabase_alert_id: 'uuid-123',
   ticker: 'AAPL',
   insider_name: 'Timothy D. Cook',
@@ -236,14 +242,16 @@ describe('6.2: Resend email', () => {
       { response: { error: 'rate limited' }, ok: false, status: 429 },
       // OneSignal succeeds
       { response: { id: 'notif-1', recipients: 5 } },
-      // Airtable delivery tracking
-      { response: {} },
+      // NocoDB delivery tracking
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const result = await deliverAlert(SAMPLE_ALERT, {
       fetchFn,
       env: BASE_ENV,
       _sleep: noSleep,
+      nocodb,
     });
 
     expect(result.push_sent).toBe(5);
@@ -306,14 +314,16 @@ describe('6.3: OneSignal push', () => {
       { response: { data: [{ id: 'e1' }] } },
       // OneSignal FAILS
       { response: { error: 'invalid key' }, ok: false, status: 401 },
-      // Airtable delivery tracking
-      { response: {} },
+      // NocoDB delivery tracking
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const result = await deliverAlert(SAMPLE_ALERT, {
       fetchFn,
       env: BASE_ENV,
       _sleep: noSleep,
+      nocodb,
     });
 
     expect(result.emails_sent).toBe(1);
@@ -324,45 +334,51 @@ describe('6.3: OneSignal push', () => {
 
 describe('6.4: Delivery tracking', () => {
   test('full success sets status=delivered with emails_sent and push_sent', async () => {
-    const fetchFn = makeFetch({});
-    await updateDeliveryStatus('recABC', {
+    const fetchFn = makeFetch({ Id: 1 });
+    const nocodb = makeNocoDB(fetchFn);
+    await updateDeliveryStatus(1, {
       status: 'delivered',
       emails_sent: 10,
       push_sent: 5,
       delivered_at: '2026-03-28T12:00:00Z',
-    }, { fetchFn, env: BASE_ENV });
+    }, { fetchFn, env: BASE_ENV, nocodb });
 
-    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
-    expect(body.fields.status).toBe('delivered');
-    expect(body.fields.emails_sent).toBe(10);
-    expect(body.fields.push_sent).toBe(5);
-    expect(body.fields.delivered_at).toBe('2026-03-28T12:00:00Z');
+    const call = fetchFn.mock.calls[0];
+    const body = JSON.parse(call[1].body);
+    expect(body.status).toBe('delivered');
+    expect(body.emails_sent).toBe(10);
+    expect(body.push_sent).toBe(5);
+    expect(body.delivered_at).toBe('2026-03-28T12:00:00Z');
   });
 
   test('email failure sets status=delivery_failed with error_log', async () => {
-    const fetchFn = makeFetch({});
-    await updateDeliveryStatus('recABC', {
+    const fetchFn = makeFetch({ Id: 1 });
+    const nocodb = makeNocoDB(fetchFn);
+    await updateDeliveryStatus(1, {
       status: 'delivery_failed',
       error_log: 'Resend API returned 429',
       push_sent: 5,
-    }, { fetchFn, env: BASE_ENV });
+    }, { fetchFn, env: BASE_ENV, nocodb });
 
-    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
-    expect(body.fields.status).toBe('delivery_failed');
-    expect(body.fields.error_log).toContain('Resend');
+    const call = fetchFn.mock.calls[0];
+    const body = JSON.parse(call[1].body);
+    expect(body.status).toBe('delivery_failed');
+    expect(body.error_log).toContain('Resend');
   });
 
   test('push failure sets status=delivery_failed with error_log', async () => {
-    const fetchFn = makeFetch({});
-    await updateDeliveryStatus('recABC', {
+    const fetchFn = makeFetch({ Id: 1 });
+    const nocodb = makeNocoDB(fetchFn);
+    await updateDeliveryStatus(1, {
       status: 'delivery_failed',
       error_log: 'OneSignal API returned 401',
       emails_sent: 10,
-    }, { fetchFn, env: BASE_ENV });
+    }, { fetchFn, env: BASE_ENV, nocodb });
 
-    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
-    expect(body.fields.status).toBe('delivery_failed');
-    expect(body.fields.error_log).toContain('OneSignal');
+    const call = fetchFn.mock.calls[0];
+    const body = JSON.parse(call[1].body);
+    expect(body.status).toBe('delivery_failed');
+    expect(body.error_log).toContain('OneSignal');
   });
 });
 
diff --git a/insiderbuying-site/tests/insiderbuying/score-alert.test.js b/insiderbuying-site/tests/insiderbuying/score-alert.test.js
index 4cd2adb..21f923e 100644
--- a/insiderbuying-site/tests/insiderbuying/score-alert.test.js
+++ b/insiderbuying-site/tests/insiderbuying/score-alert.test.js
@@ -9,6 +9,8 @@ const {
   runScoreAlert,
 } = require('../../n8n/code/insiderbuying/score-alert');
 
+const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
+
 // ─── helpers ────────────────────────────────────────────────────────────────
 
 function makeFetch(response, ok = true, status = 200) {
@@ -29,10 +31,15 @@ function makeFetchSeq(...calls) {
 
 const noSleep = jest.fn().mockResolvedValue(undefined);
 
-const SUPABASE_URL = 'https://test.supabase.co';
-const SUPABASE_KEY = 'test-key';
+const NOCODB_BASE_URL = 'http://localhost:8080';
+const NOCODB_TOKEN = 'test-token';
+const NOCODB_PROJECT_ID = 'test-project-id';
 const ANTHROPIC_KEY = 'test-anthropic';
 
+function makeNocoDB(fetchFn) {
+  return new NocoDB(NOCODB_BASE_URL, NOCODB_TOKEN, NOCODB_PROJECT_ID, fetchFn);
+}
+
 const SAMPLE_FILING = {
   ticker: 'AAPL',
   insider_name: 'Timothy D. Cook',
@@ -50,7 +57,7 @@ const SAMPLE_FILING = {
 
 const HAIKU_JSON_RESPONSE = '{"score": 8, "reasoning": "Large C-Suite purchase signals confidence."}';
 
-// ─── 3.1 normalizeInsiderName ───────────────────────────────────────────────
+// ─── 3.1 normalizeInsiderName ───────────────────────────────────────────────────
 
 describe('normalizeInsiderName', () => {
   test('strips middle initial and lowercases', () => {
@@ -80,38 +87,38 @@ describe('normalizeInsiderName', () => {
   });
 });
 
-// ─── 3.1 computeTrackRecord ─────────────────────────────────────────────────
+// ─── 3.1 computeTrackRecord ─────────────────────────────────────────────────────
 
 describe('computeTrackRecord', () => {
-  test('returns zero-nulls when no Supabase history', async () => {
-    const fetchFn = makeFetch([]);
-    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
+  test('returns zero-nulls when no NocoDB history', async () => {
+    const fetchFn = makeFetch({ list: [], pageInfo: { isLastPage: true } });
+    const nocodb = makeNocoDB(fetchFn);
+    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
     expect(result).toEqual({ past_buy_count: 0, hit_rate: null, avg_gain_30d: null });
   });
 
-  test('returns past_buy_count matching Supabase rows', async () => {
+  test('returns past_buy_count matching NocoDB rows', async () => {
     const rows = [
-      { ticker: 'AAPL', filing_date: '2023-06-01', total_value: 500000 },
-      { ticker: 'AAPL', filing_date: '2023-09-01', total_value: 300000 },
+      { Id: 1, ticker: 'AAPL', filing_date: '2023-06-01', total_value: 500000 },
+      { Id: 2, ticker: 'AAPL', filing_date: '2023-09-01', total_value: 300000 },
     ];
-    // Supabase returns rows; Yahoo returns no useful data (empty) → skip price step
     const fetchFn = jest.fn()
-      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows })
+      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) })
       // Yahoo calls fail gracefully
       .mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
+    const nocodb = makeNocoDB(fetchFn);
 
-    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
+    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
     expect(result.past_buy_count).toBe(2);
   });
 
   test('computes hit_rate: 2 of 3 buys gained >5% → 0.67', async () => {
     const rows = [
-      { ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 },
-      { ticker: 'AAPL', filing_date: '2023-04-01', total_value: 200000 },
-      { ticker: 'AAPL', filing_date: '2023-07-01', total_value: 150000 },
+      { Id: 1, ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 },
+      { Id: 2, ticker: 'AAPL', filing_date: '2023-04-01', total_value: 200000 },
+      { Id: 3, ticker: 'AAPL', filing_date: '2023-07-01', total_value: 150000 },
     ];
 
-    // Build Yahoo response factory: price at filing_date=100, price at +30d varies
     function makeYahoo(startPrice, endPrice) {
       const now = Date.now() / 1000;
       return {
@@ -126,57 +133,68 @@ describe('computeTrackRecord', () => {
     }
 
     const fetchFn = jest.fn()
-      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows })
+      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) })
       .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 107) }) // +7% hit
       .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 103) }) // +3% miss
       .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 112) }); // +12% hit
+    const nocodb = makeNocoDB(fetchFn);
 
-    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
+    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
     expect(result.past_buy_count).toBe(3);
     expect(result.hit_rate).toBeCloseTo(2 / 3, 2);
   });
 
   test('Yahoo Finance network error → returns null track record without throwing', async () => {
-    const rows = [{ ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 }];
+    const rows = [{ Id: 1, ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 }];
     const fetchFn = jest.fn()
-      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows })
+      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) })
       .mockRejectedValueOnce(new Error('network timeout'));
+    const nocodb = makeNocoDB(fetchFn);
 
-    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
+    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
     expect(result).toEqual({ past_buy_count: 1, hit_rate: null, avg_gain_30d: null });
   });
 
   test('Yahoo Finance 429 → returns null without throwing', async () => {
-    const rows = [{ ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 }];
+    const rows = [{ Id: 1, ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 }];
     const fetchFn = jest.fn()
-      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows })
+      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) })
       .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
+    const nocodb = makeNocoDB(fetchFn);
 
-    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
+    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
     expect(result.hit_rate).toBeNull();
     expect(result.avg_gain_30d).toBeNull();
   });
 
-  test('Supabase failure → returns zero-nulls without throwing', async () => {
+  test('NocoDB failure → returns zero-nulls without throwing', async () => {
     const fetchFn = jest.fn().mockRejectedValue(new Error('connection refused'));
-    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
+    const nocodb = makeNocoDB(fetchFn);
+    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
     expect(result).toEqual({ past_buy_count: 0, hit_rate: null, avg_gain_30d: null });
   });
 
-  test('Supabase URL uses % wildcards for ilike (not * globs)', async () => {
-    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
-    await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
+  test('NocoDB where clause uses lowercase name with like operator', async () => {
+    const fetchFn = jest.fn().mockResolvedValue({
+      ok: true,
+      status: 200,
+      json: async () => ({ list: [], pageInfo: { isLastPage: true } }),
+    });
+    const nocodb = makeNocoDB(fetchFn);
+    await computeTrackRecord('John Smith', nocodb, { fetchFn });
     const url = fetchFn.mock.calls[0][0];
-    // URLSearchParams encodes % as %25, so %john%smith% appears as %25john%25smith%25 in the URL
     const decoded = decodeURIComponent(url);
-    expect(decoded).toContain('%john%smith%');
-    expect(url).not.toContain('*john*');
+    // NocoDB where clause uses (field,like,%value%) syntax with lowercase name
+    expect(decoded).toContain('insider_name');
+    expect(decoded).toContain('like');
+    expect(decoded.toLowerCase()).toContain('john');
+    expect(decoded.toLowerCase()).toContain('smith');
   });
 
   test('one Yahoo failure does not abort remaining filings in loop', async () => {
     const rows = [
-      { ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 },
-      { ticker: 'MSFT', filing_date: '2023-04-01', total_value: 200000 },
+      { Id: 1, ticker: 'AAPL', filing_date: '2023-01-01', total_value: 100000 },
+      { Id: 2, ticker: 'MSFT', filing_date: '2023-04-01', total_value: 200000 },
     ];
 
     function makeYahoo(startPrice, endPrice) {
@@ -193,11 +211,12 @@ describe('computeTrackRecord', () => {
     }
 
     const fetchFn = jest.fn()
-      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => rows }) // Supabase
+      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ list: rows, pageInfo: { isLastPage: true } }) }) // NocoDB
       .mockRejectedValueOnce(new Error('AAPL Yahoo timeout'))           // AAPL Yahoo fails
       .mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeYahoo(100, 115) }); // MSFT succeeds
+    const nocodb = makeNocoDB(fetchFn);
 
-    const result = await computeTrackRecord('John Smith', SUPABASE_URL, SUPABASE_KEY, { fetchFn });
+    const result = await computeTrackRecord('John Smith', nocodb, { fetchFn });
     // past_buy_count=2, but only 1 valid return (MSFT +15%)
     expect(result.past_buy_count).toBe(2);
     expect(result.hit_rate).toBeCloseTo(1.0); // 1/1 valid return
@@ -205,7 +224,7 @@ describe('computeTrackRecord', () => {
   });
 });
 
-// ─── 3.2 buildHaikuPrompt ───────────────────────────────────────────────────
+// ─── 3.2 buildHaikuPrompt ───────────────────────────────────────────────────────
 
 describe('buildHaikuPrompt', () => {
   const trackRecord = { past_buy_count: 3, hit_rate: 0.67, avg_gain_30d: 0.12 };
@@ -256,7 +275,7 @@ describe('buildHaikuPrompt', () => {
   });
 });
 
-// ─── 3.2 parseHaikuResponse ─────────────────────────────────────────────────
+// ─── 3.2 parseHaikuResponse ─────────────────────────────────────────────────────
 
 describe('parseHaikuResponse', () => {
   test('parses clean JSON response', () => {
@@ -290,7 +309,7 @@ describe('parseHaikuResponse', () => {
   });
 });
 
-// ─── 3.2 score clamping / rounding ──────────────────────────────────────────
+// ─── 3.2 score clamping / rounding ──────────────────────────────────────────────
 
 describe('score clamping and rounding', () => {
   test('score 11 is clamped to 10', () => {
@@ -314,7 +333,7 @@ describe('score clamping and rounding', () => {
   });
 });
 
-// ─── 3.2 callHaiku ──────────────────────────────────────────────────────────
+// ─── 3.2 callHaiku ──────────────────────────────────────────────────────────────
 
 describe('callHaiku', () => {
   test('calls Anthropic messages endpoint with correct model', async () => {
@@ -362,36 +381,22 @@ describe('callHaiku', () => {
   });
 });
 
-// ─── 3.3 runScoreAlert integration ──────────────────────────────────────────
+// ─── 3.3 runScoreAlert integration ──────────────────────────────────────────────
 
 describe('runScoreAlert', () => {
   test('returns scored filing with significance_score, score_reasoning, track_record', async () => {
-    const supabaseFetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
-    const haikuResponse = {
-      content: [{ type: 'text', text: '{"score": 7, "reasoning": "Good signal."}' }],
-    };
-    const fetchFn = jest.fn()
-      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // Supabase history
-      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => haikuResponse.content[0] }) // won't happen
-      .mockResolvedValue({ ok: true, status: 200, json: async () => haikuResponse }); // Haiku
+    const nocodbFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) });
+    const nocodb = makeNocoDB(nocodbFn);
 
-    // Use separate fetchFn per service to simplify
-    const supabaseFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
     const haikuFn = jest.fn().mockResolvedValue({
       ok: true, status: 200,
       json: async () => ({ content: [{ type: 'text', text: '{"score": 7, "reasoning": "Good signal."}' }] }),
     });
 
     const result = await runScoreAlert([SAMPLE_FILING], {
-      supabaseUrl: SUPABASE_URL,
-      supabaseKey: SUPABASE_KEY,
+      nocodb,
       anthropicApiKey: ANTHROPIC_KEY,
-      fetchFn: (url, opts) => {
-        if (url.includes('supabase') || url.includes('insider_alerts') || url.includes('finance.yahoo')) {
-          return supabaseFn(url, opts);
-        }
-        return haikuFn(url, opts);
-      },
+      fetchFn: haikuFn,
       _sleep: noSleep,
     });
 
@@ -406,23 +411,18 @@ describe('runScoreAlert', () => {
 
   test('processes multiple filings sequentially', async () => {
     const filing2 = { ...SAMPLE_FILING, ticker: 'MSFT', insider_name: 'Satya Nadella' };
-    const supabaseFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
+    const nocodbFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) });
+    const nocodb = makeNocoDB(nocodbFn);
+
     const haikuFn = jest.fn().mockResolvedValue({
       ok: true, status: 200,
       json: async () => ({ content: [{ type: 'text', text: '{"score": 6, "reasoning": "Moderate."}' }] }),
     });
-    const fetchFn = (url) => {
-      if (url.includes('supabase') || url.includes('finance.yahoo') || url.includes('insider_alerts')) {
-        return supabaseFn(url);
-      }
-      return haikuFn(url);
-    };
 
     const results = await runScoreAlert([SAMPLE_FILING, filing2], {
-      supabaseUrl: SUPABASE_URL,
-      supabaseKey: SUPABASE_KEY,
+      nocodb,
       anthropicApiKey: ANTHROPIC_KEY,
-      fetchFn,
+      fetchFn: haikuFn,
       _sleep: noSleep,
     });
 
@@ -432,18 +432,18 @@ describe('runScoreAlert', () => {
   });
 
   test('preserves all original filing fields in output', async () => {
-    const supabaseFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
+    const nocodbFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ list: [], pageInfo: { isLastPage: true } }) });
+    const nocodb = makeNocoDB(nocodbFn);
+
     const haikuFn = jest.fn().mockResolvedValue({
       ok: true, status: 200,
       json: async () => ({ content: [{ type: 'text', text: '{"score": 5, "reasoning": "Test."}' }] }),
     });
-    const fetchFn = (url) => url.includes('anthropic') ? haikuFn(url) : supabaseFn(url);
 
     const results = await runScoreAlert([SAMPLE_FILING], {
-      supabaseUrl: SUPABASE_URL,
-      supabaseKey: SUPABASE_KEY,
+      nocodb,
       anthropicApiKey: ANTHROPIC_KEY,
-      fetchFn,
+      fetchFn: haikuFn,
       _sleep: noSleep,
     });
 
@@ -454,8 +454,7 @@ describe('runScoreAlert', () => {
 
   test('handles empty filings array', async () => {
     const results = await runScoreAlert([], {
-      supabaseUrl: SUPABASE_URL,
-      supabaseKey: SUPABASE_KEY,
+      nocodb: makeNocoDB(jest.fn()),
       anthropicApiKey: ANTHROPIC_KEY,
       fetchFn: jest.fn(),
       _sleep: noSleep,
diff --git a/insiderbuying-site/tests/insiderbuying/write-persistence.test.js b/insiderbuying-site/tests/insiderbuying/write-persistence.test.js
index e8dd7ea..10db6ea 100644
--- a/insiderbuying-site/tests/insiderbuying/write-persistence.test.js
+++ b/insiderbuying-site/tests/insiderbuying/write-persistence.test.js
@@ -10,6 +10,8 @@ const {
   runPostProcessing,
 } = require('../../n8n/code/insiderbuying/write-persistence');
 
+const { NocoDB } = require('../../n8n/code/insiderbuying/nocodb-client');
+
 // --- helpers ----------------------------------------------------------------
 
 function makeFetch(response, ok = true, status = 200) {
@@ -37,16 +39,19 @@ function makeFetchSeq(...calls) {
 const noSleep = jest.fn().mockResolvedValue(undefined);
 
 const BASE_ENV = {
-  AIRTABLE_API_KEY: 'at-key',
-  AIRTABLE_BASE_ID: 'appXXX',
-  INSIDER_ALERTS_TABLE_ID: 'tblAlerts',
-  MONITOR_STATE_TABLE_ID: 'tblState',
+  NOCODB_API_TOKEN: 'test-token',
+  NOCODB_BASE_URL: 'http://localhost:8080',
+  NOCODB_PROJECT_ID: 'test-project-id',
   SUPABASE_URL: 'https://test.supabase.co',
   SUPABASE_SERVICE_ROLE_KEY: 'sb-key',
   TELEGRAM_BOT_TOKEN: 'tg-token',
   TELEGRAM_MONITORING_CHAT_ID: '-100123',
 };
 
+function makeNocoDB(fetchFn) {
+  return new NocoDB(BASE_ENV.NOCODB_BASE_URL, BASE_ENV.NOCODB_API_TOKEN, BASE_ENV.NOCODB_PROJECT_ID, fetchFn);
+}
+
 const SAMPLE_FILING = {
   ticker: 'AAPL',
   company_name: 'Apple Inc.',
@@ -69,69 +74,74 @@ const SAMPLE_FILING = {
   raw_filing_data: '{"name":"Timothy D. Cook"}',
 };
 
-// ─── 5.1 Airtable Record ──────────────────────────────────────────────────
+// ─── 5.1 NocoDB Record ───────────────────────────────────────────────────────
 
 describe('5.1: createAirtableRecord', () => {
   test('includes all required fields including dedup_key and status=processed', async () => {
-    const fetchFn = makeFetch({ id: 'recABC123', fields: {} });
+    const fetchFn = makeFetch({ Id: 1, ticker: 'AAPL', status: 'processed' });
+    const nocodb = makeNocoDB(fetchFn);
     const result = await createAirtableRecord(SAMPLE_FILING, {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
-    expect(result).toBe('recABC123');
+    expect(result).toBe(1);
     expect(fetchFn).toHaveBeenCalledTimes(1);
 
     const call = fetchFn.mock.calls[0];
     const body = JSON.parse(call[1].body);
-    expect(body.fields.dedup_key).toBe(SAMPLE_FILING.dedup_key);
-    expect(body.fields.status).toBe('processed');
-    expect(body.fields.ticker).toBe('AAPL');
-    expect(body.fields.company_name).toBe('Apple Inc.');
-    expect(body.fields.insider_name).toBe('Timothy D. Cook');
-    expect(body.fields.insider_title).toBe('Chief Executive Officer');
-    expect(body.fields.insider_category).toBe('C-Suite');
-    expect(body.fields.transaction_type).toBe('buy');
-    expect(body.fields.shares).toBe(10000);
-    expect(body.fields.price_per_share).toBe(150.25);
-    expect(body.fields.total_value).toBe(1502500);
-    expect(body.fields.transaction_date).toBe('2026-03-20');
-    expect(body.fields.filing_date).toBe('2026-03-22');
+    expect(body.dedup_key).toBe(SAMPLE_FILING.dedup_key);
+    expect(body.status).toBe('processed');
+    expect(body.ticker).toBe('AAPL');
+    expect(body.company_name).toBe('Apple Inc.');
+    expect(body.insider_name).toBe('Timothy D. Cook');
+    expect(body.insider_title).toBe('Chief Executive Officer');
+    expect(body.insider_category).toBe('C-Suite');
+    expect(body.transaction_type).toBe('buy');
+    expect(body.shares).toBe(10000);
+    expect(body.price_per_share).toBe(150.25);
+    expect(body.total_value).toBe(1502500);
+    expect(body.transaction_date).toBe('2026-03-20');
+    expect(body.filing_date).toBe('2026-03-22');
   });
 
   test('includes score_reasoning from Haiku', async () => {
-    const fetchFn = makeFetch({ id: 'recABC123', fields: {} });
-    await createAirtableRecord(SAMPLE_FILING, { fetchFn, env: BASE_ENV });
+    const fetchFn = makeFetch({ Id: 1, status: 'processed' });
+    const nocodb = makeNocoDB(fetchFn);
+    await createAirtableRecord(SAMPLE_FILING, { fetchFn, nocodb, env: BASE_ENV });
 
     const body = JSON.parse(fetchFn.mock.calls[0][1].body);
-    expect(body.fields.score_reasoning).toBe('Large C-Suite purchase signals confidence.');
+    expect(body.score_reasoning).toBe('Large C-Suite purchase signals confidence.');
   });
 
   test('includes ai_analysis (may be null)', async () => {
-    const fetchFn = makeFetch({ id: 'recABC123', fields: {} });
+    const fetchFn = makeFetch({ Id: 1, status: 'processed' });
+    const nocodb = makeNocoDB(fetchFn);
 
     // With analysis
-    await createAirtableRecord(SAMPLE_FILING, { fetchFn, env: BASE_ENV });
+    await createAirtableRecord(SAMPLE_FILING, { fetchFn, nocodb, env: BASE_ENV });
     let body = JSON.parse(fetchFn.mock.calls[0][1].body);
-    expect(body.fields.ai_analysis).toBe(SAMPLE_FILING.ai_analysis);
+    expect(body.ai_analysis).toBe(SAMPLE_FILING.ai_analysis);
 
     // With null analysis
     const filingNoAnalysis = { ...SAMPLE_FILING, ai_analysis: null };
-    await createAirtableRecord(filingNoAnalysis, { fetchFn, env: BASE_ENV });
+    await createAirtableRecord(filingNoAnalysis, { fetchFn, nocodb, env: BASE_ENV });
     body = JSON.parse(fetchFn.mock.calls[1][1].body);
-    expect(body.fields.ai_analysis).toBe('');
+    expect(body.ai_analysis).toBe('');
   });
 
   test('stores raw_filing_data as JSON string', async () => {
-    const fetchFn = makeFetch({ id: 'recABC123', fields: {} });
-    await createAirtableRecord(SAMPLE_FILING, { fetchFn, env: BASE_ENV });
+    const fetchFn = makeFetch({ Id: 1, status: 'processed' });
+    const nocodb = makeNocoDB(fetchFn);
+    await createAirtableRecord(SAMPLE_FILING, { fetchFn, nocodb, env: BASE_ENV });
 
     const body = JSON.parse(fetchFn.mock.calls[0][1].body);
-    expect(body.fields.raw_filing_data).toBe('{"name":"Timothy D. Cook"}');
+    expect(body.raw_filing_data).toBe('{"name":"Timothy D. Cook"}');
   });
 });
 
-// ─── 5.2 Supabase Insert ─────────────────────────────────────────────────
+// ─── 5.2 Supabase Insert ─────────────────────────────────────────────────────
 
 describe('5.2: insertToSupabase', () => {
   test('uses onConflict dedup_key with ignore-duplicates header', async () => {
@@ -159,30 +169,32 @@ describe('5.2: insertToSupabase', () => {
   });
 });
 
-// ─── 5.3 Monitor_State Update ────────────────────────────────────────────
+// ─── 5.3 Monitor_State Update ────────────────────────────────────────────────
 
 describe('5.3: updateMonitorState', () => {
   test('all-success run sets last_check_timestamp to approximately now()', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { records: [{ id: 'recState1', fields: { name: 'market' } }] } },
-      { response: {} }, // PATCH response
+      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
+      { response: { Id: 1 } }, // NocoDB update response
     );
+    const nocodb = makeNocoDB(fetchFn);
 
-    await updateMonitorState('market', [], [], null, { fetchFn, env: BASE_ENV });
+    await updateMonitorState('market', [], [], null, { fetchFn, nocodb, env: BASE_ENV });
 
     const patchCall = fetchFn.mock.calls[1];
     const body = JSON.parse(patchCall[1].body);
-    expect(body.fields.last_run_status).toBe('success');
+    expect(body.last_run_status).toBe('success');
     // Timestamp should be close to now
-    const ts = new Date(body.fields.last_check_timestamp);
+    const ts = new Date(body.last_check_timestamp);
     expect(Date.now() - ts.getTime()).toBeLessThan(5000);
   });
 
   test('partial-failure run rolls back timestamp to min(failed_filing.filing_date)', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { records: [{ id: 'recState1', fields: { name: 'market' } }] } },
-      { response: {} },
+      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
     const failedFilings = [
       { filing_date: '2026-03-20' },
       { filing_date: '2026-03-18' },
@@ -191,50 +203,54 @@ describe('5.3: updateMonitorState', () => {
 
     await updateMonitorState('market', [], failedFilings, 'some error', {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
     const body = JSON.parse(fetchFn.mock.calls[1][1].body);
-    expect(body.fields.last_check_timestamp).toBe('2026-03-18');
-    expect(body.fields.last_run_status).toBe('error');
-    expect(body.fields.last_run_error).toBe('some error');
+    expect(body.last_check_timestamp).toBe('2026-03-18');
+    expect(body.last_run_status).toBe('error');
+    expect(body.last_run_error).toBe('some error');
   });
 
   test('filing with retry_count > 3 is marked dead_letter, timestamp NOT held back', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { records: [{ id: 'recState1', fields: { name: 'market' } }] } },
-      { response: {} },
+      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
     const failedFilings = [
-      { filing_date: '2026-03-18', retry_count: 4, airtable_record_id: 'recDL1' },
+      { filing_date: '2026-03-18', retry_count: 4, airtable_record_id: 1 },
     ];
 
     await updateMonitorState('market', [{ filing_date: '2026-03-22' }], failedFilings, 'err', {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
     // Dead letter filing should not hold back the timestamp
     const body = JSON.parse(fetchFn.mock.calls[1][1].body);
-    const ts = new Date(body.fields.last_check_timestamp);
+    const ts = new Date(body.last_check_timestamp);
     // Should advance to now() since the only failed filing is dead-lettered
     expect(Date.now() - ts.getTime()).toBeLessThan(5000);
   });
 
   test('dead-letter filing triggers Telegram notification', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { id: 'recDL1', fields: {} } }, // Airtable PATCH
+      { response: { Id: 1, status: 'dead_letter' } }, // NocoDB update
       { response: {} }, // Telegram sendMessage
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     await handleDeadLetter(
       { dedup_key: 'AAPL_Cook_2026-03-20_10000', ticker: 'AAPL', _lastError: 'FD API down' },
-      'recDL1',
+      1,
       'market',
-      { fetchFn, env: BASE_ENV },
+      { fetchFn, nocodb, env: BASE_ENV },
     );
 
-    // Should have called Airtable PATCH and Telegram
+    // Should have called NocoDB update and Telegram
     expect(fetchFn).toHaveBeenCalledTimes(2);
     const tgCall = fetchFn.mock.calls[1][0];
     expect(tgCall).toContain('api.telegram.org');
@@ -243,21 +259,23 @@ describe('5.3: updateMonitorState', () => {
 
   test('last_run_status = error when any filing fails', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { records: [{ id: 'recState1', fields: { name: 'market' } }] } },
-      { response: {} },
+      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     await updateMonitorState('market', [SAMPLE_FILING], [{ filing_date: '2026-03-18' }], 'err', {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
     const body = JSON.parse(fetchFn.mock.calls[1][1].body);
-    expect(body.fields.last_run_status).toBe('error');
+    expect(body.last_run_status).toBe('error');
   });
 });
 
-// ─── 5.4 Cluster Alert Creation ──────────────────────────────────────────
+// ─── 5.4 Cluster Alert Creation ──────────────────────────────────────────────
 
 describe('5.4: createOrUpdateClusterSummary', () => {
   const clusterFilings = [
@@ -268,18 +286,20 @@ describe('5.4: createOrUpdateClusterSummary', () => {
 
   test('3 cluster members in one run creates exactly 1 cluster summary record', async () => {
     const fetchFn = makeFetchSeq(
-      // Search for existing cluster summary: none found
-      { response: { records: [] } },
-      // Create new Airtable record
-      { response: { id: 'recCluster1', fields: {} } },
+      // Search for existing cluster summary: none found (NocoDB list)
+      { response: { list: [], pageInfo: { isLastPage: true } } },
+      // Create new NocoDB record
+      { response: { Id: 1, ticker: 'AAPL', transaction_type: 'cluster' } },
       // Insert to Supabase
       { response: [{ id: 'uuid-cluster-1' }] },
-      // Patch Airtable with supabase_id
-      { response: {} },
+      // NocoDB update with supabase_id
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const result = await createOrUpdateClusterSummary('cluster-1', clusterFilings, {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
@@ -289,63 +309,68 @@ describe('5.4: createOrUpdateClusterSummary', () => {
 
   test('cluster summary has transaction_type = cluster', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { records: [] } },
-      { response: { id: 'recCluster1', fields: {} } },
+      { response: { list: [], pageInfo: { isLastPage: true } } },
+      { response: { Id: 1, transaction_type: 'cluster' } },
       { response: [{ id: 'uuid-cluster-1' }] },
-      { response: {} },
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     await createOrUpdateClusterSummary('cluster-1', clusterFilings, {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
-    // The CREATE call is the second call
+    // The CREATE call is the second call (index 1)
     const createBody = JSON.parse(fetchFn.mock.calls[1][1].body);
-    expect(createBody.fields.transaction_type).toBe('cluster');
+    expect(createBody.transaction_type).toBe('cluster');
   });
 
   test('cluster summary significance_score = min(10, max_individual_score + 3)', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { records: [] } },
-      { response: { id: 'recCluster1', fields: {} } },
+      { response: { list: [], pageInfo: { isLastPage: true } } },
+      { response: { Id: 1 } },
       { response: [{ id: 'uuid-cluster-1' }] },
-      { response: {} },
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     await createOrUpdateClusterSummary('cluster-1', clusterFilings, {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
     const createBody = JSON.parse(fetchFn.mock.calls[1][1].body);
     // max individual score = 7, so cluster score = min(10, 7+3) = 10
-    expect(createBody.fields.significance_score).toBe(10);
+    expect(createBody.significance_score).toBe(10);
   });
 
   test('second run with 4th member updates existing summary (not new row)', async () => {
     const fetchFn = makeFetchSeq(
-      // Search finds existing cluster summary with score 8
+      // Search finds existing cluster summary (NocoDB list)
       {
         response: {
-          records: [{
-            id: 'recCluster1',
-            fields: {
-              transaction_type: 'cluster',
-              cluster_id: 'cluster-1',
-              significance_score: 8,
-              cluster_size: 3,
-            },
+          list: [{
+            Id: 1,
+            transaction_type: 'cluster',
+            cluster_id: 'cluster-1',
+            significance_score: 8,
+            cluster_size: 3,
           }],
+          pageInfo: { isLastPage: true },
         },
       },
-      // PATCH existing record
-      { response: {} },
+      // NocoDB update existing record
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const newMember = { ...SAMPLE_FILING, cluster_id: 'cluster-1', is_cluster_buy: true, significance_score: 6 };
     const result = await createOrUpdateClusterSummary('cluster-1', [newMember], {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
@@ -357,18 +382,23 @@ describe('5.4: createOrUpdateClusterSummary', () => {
     const fetchFn = makeFetchSeq(
       {
         response: {
-          records: [{
-            id: 'recCluster1',
-            fields: { significance_score: 9, cluster_size: 3, cluster_id: 'cluster-1', transaction_type: 'cluster' },
+          list: [{
+            Id: 1,
+            significance_score: 9,
+            cluster_size: 3,
+            cluster_id: 'cluster-1',
+            transaction_type: 'cluster',
           }],
+          pageInfo: { isLastPage: true },
         },
       },
-      { response: {} },
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const result = await createOrUpdateClusterSummary('cluster-1',
       [{ ...SAMPLE_FILING, significance_score: 7 }],
-      { fetchFn, env: BASE_ENV },
+      { fetchFn, nocodb, env: BASE_ENV },
     );
 
     // new score = min(10, 7+3) = 10, old = 9, delta = 1 < 2
@@ -379,18 +409,23 @@ describe('5.4: createOrUpdateClusterSummary', () => {
     const fetchFn = makeFetchSeq(
       {
         response: {
-          records: [{
-            id: 'recCluster1',
-            fields: { significance_score: 7, cluster_size: 2, cluster_id: 'cluster-1', transaction_type: 'cluster' },
+          list: [{
+            Id: 1,
+            significance_score: 7,
+            cluster_size: 2,
+            cluster_id: 'cluster-1',
+            transaction_type: 'cluster',
           }],
+          pageInfo: { isLastPage: true },
         },
       },
-      { response: {} },
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const result = await createOrUpdateClusterSummary('cluster-1',
       [{ ...SAMPLE_FILING, significance_score: 8 }],
-      { fetchFn, env: BASE_ENV },
+      { fetchFn, nocodb, env: BASE_ENV },
     );
 
     // new score = min(10, 8+3) = 10, old = 7, delta = 3 >= 2
@@ -398,93 +433,97 @@ describe('5.4: createOrUpdateClusterSummary', () => {
   });
 });
 
-// ─── writeFilingPersistence happy path ───────────────────────────────────
+// ─── writeFilingPersistence happy path ───────────────────────────────────────
 
 describe('writeFilingPersistence happy path', () => {
-  test('creates Airtable record, inserts to Supabase, patches cross-reference', async () => {
+  test('creates NocoDB record, inserts to Supabase, patches cross-reference', async () => {
     const fetchFn = makeFetchSeq(
-      // Airtable create
-      { response: { id: 'recAAA', fields: {} } },
+      // NocoDB create
+      { response: { Id: 1, ticker: 'AAPL', status: 'processed' } },
       // Supabase insert
       { response: [{ id: 'uuid-123' }] },
-      // Airtable patch supabase_id
-      { response: { id: 'recAAA', fields: {} } },
+      // NocoDB update supabase_id
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const ctx = { failureCount: 0, firstError: null, failedFilings: [], successfulFilings: [] };
-    await writeFilingPersistence(SAMPLE_FILING, ctx, { fetchFn, env: BASE_ENV });
+    await writeFilingPersistence(SAMPLE_FILING, ctx, { fetchFn, nocodb, env: BASE_ENV });
 
     expect(ctx.failureCount).toBe(0);
     expect(ctx.successfulFilings).toHaveLength(1);
-    expect(ctx.successfulFilings[0].airtable_record_id).toBe('recAAA');
+    expect(ctx.successfulFilings[0].airtable_record_id).toBe(1);
     expect(ctx.successfulFilings[0].supabase_id).toBe('uuid-123');
     expect(fetchFn).toHaveBeenCalledTimes(3);
   });
 });
 
-// ─── runPostProcessing dead-letter integration ──────────────────────────
+// ─── runPostProcessing dead-letter integration ────────────────────────────────
 
 describe('runPostProcessing dead-letter integration', () => {
   test('calls handleDeadLetter for failed filings with retry_count > 3', async () => {
     const fetchFn = makeFetchSeq(
-      // dead-letter: Airtable PATCH status
-      { response: { id: 'recDL1', fields: {} } },
+      // dead-letter: NocoDB update status
+      { response: { Id: 1, status: 'dead_letter' } },
       // dead-letter: Telegram
       { response: {} },
-      // updateMonitorState: lookup
-      { response: { records: [{ id: 'recState1', fields: { name: 'market' } }] } },
-      // updateMonitorState: PATCH
-      { response: {} },
+      // updateMonitorState: NocoDB list
+      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
+      // updateMonitorState: NocoDB update
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const failedFilings = [
       {
         ...SAMPLE_FILING,
         retry_count: 4,
-        airtable_record_id: 'recDL1',
+        airtable_record_id: 1,
         _lastError: 'FD API gone',
       },
     ];
 
     await runPostProcessing('market', [], failedFilings, 1, 'err', [], {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
-    // Should have 4 calls: DL airtable patch, DL telegram, state lookup, state patch
+    // Should have 4 calls: DL NocoDB update, DL telegram, state NocoDB list, state NocoDB update
     expect(fetchFn).toHaveBeenCalledTimes(4);
     const dlPatchCall = fetchFn.mock.calls[0];
     const dlPatchBody = JSON.parse(dlPatchCall[1].body);
-    expect(dlPatchBody.fields.status).toBe('dead_letter');
+    expect(dlPatchBody.status).toBe('dead_letter');
   });
 });
 
-// ─── runPostProcessing cluster grouping ─────────────────────────────────
+// ─── runPostProcessing cluster grouping ──────────────────────────────────────
 
 describe('runPostProcessing cluster grouping', () => {
   test('groups filings by cluster_id and calls createOrUpdateClusterSummary per group', async () => {
     const fetchFn = makeFetchSeq(
-      // updateMonitorState: lookup
-      { response: { records: [{ id: 'recState1', fields: { name: 'market' } }] } },
-      // updateMonitorState: PATCH
-      { response: {} },
-      // Cluster A: search for existing
-      { response: { records: [] } },
-      // Cluster A: create
-      { response: { id: 'recCA', fields: {} } },
+      // updateMonitorState: NocoDB list
+      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
+      // updateMonitorState: NocoDB update
+      { response: { Id: 1 } },
+      // Cluster A: NocoDB list (search for existing)
+      { response: { list: [], pageInfo: { isLastPage: true } } },
+      // Cluster A: NocoDB create
+      { response: { Id: 2 } },
       // Cluster A: Supabase insert
       { response: [{ id: 'uuid-ca' }] },
-      // Cluster A: patch supabase_id
-      { response: {} },
-      // Cluster B: search for existing
-      { response: { records: [] } },
-      // Cluster B: create
-      { response: { id: 'recCB', fields: {} } },
+      // Cluster A: NocoDB update (supabase_id)
+      { response: { Id: 2 } },
+      // Cluster B: NocoDB list (search for existing)
+      { response: { list: [], pageInfo: { isLastPage: true } } },
+      // Cluster B: NocoDB create
+      { response: { Id: 3 } },
       // Cluster B: Supabase insert
       { response: [{ id: 'uuid-cb' }] },
-      // Cluster B: patch supabase_id
-      { response: {} },
+      // Cluster B: NocoDB update (supabase_id)
+      { response: { Id: 3 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     const allFilings = [
       { ...SAMPLE_FILING, cluster_id: 'cluster-A', significance_score: 7 },
@@ -494,6 +533,7 @@ describe('runPostProcessing cluster grouping', () => {
 
     const results = await runPostProcessing('market', allFilings, [], 0, null, allFilings, {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
@@ -503,47 +543,52 @@ describe('runPostProcessing cluster grouping', () => {
   });
 });
 
-// ─── 5.5 Error Counting ──────────────────────────────────────────────────
+// ─── 5.5 Error Counting ──────────────────────────────────────────────────────
 
 describe('5.5: writeFilingPersistence error counting', () => {
   test('failureCount increments on each filing failure', async () => {
-    const fetchFn = jest.fn().mockRejectedValue(new Error('Airtable down'));
+    const fetchFn = jest.fn().mockRejectedValue(new Error('NocoDB down'));
+    const nocodb = makeNocoDB(fetchFn);
 
     const ctx = { failureCount: 0, firstError: null, failedFilings: [], successfulFilings: [] };
-    await writeFilingPersistence(SAMPLE_FILING, ctx, { fetchFn, env: BASE_ENV });
+    await writeFilingPersistence(SAMPLE_FILING, ctx, { fetchFn, nocodb, env: BASE_ENV });
 
     expect(ctx.failureCount).toBe(1);
-    expect(ctx.firstError).toContain('Airtable down');
+    expect(ctx.firstError).toContain('NocoDB down');
   });
 
   test('failureCount <= 5 does NOT trigger Telegram alert in runPostProcessing', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { records: [{ id: 'recState1', fields: { name: 'market' } }] } },
-      { response: {} },
+      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
+      { response: { Id: 1 } },
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     await runPostProcessing('market', [SAMPLE_FILING], [], 3, 'err', [], {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
-    // Only 2 calls: state lookup + state update. No Telegram call
+    // Only 2 calls: state NocoDB list + state NocoDB update. No Telegram call
     expect(fetchFn).toHaveBeenCalledTimes(2);
   });
 
   test('failureCount > 5 triggers Telegram alert in runPostProcessing', async () => {
     const fetchFn = makeFetchSeq(
-      { response: { records: [{ id: 'recState1', fields: { name: 'market' } }] } },
-      { response: {} }, // state update
+      { response: { list: [{ Id: 1, name: 'market' }], pageInfo: { isLastPage: true } } },
+      { response: { Id: 1 } }, // state update
       { response: {} }, // Telegram alert
     );
+    const nocodb = makeNocoDB(fetchFn);
 
     await runPostProcessing('market', [SAMPLE_FILING], [], 6, 'big error', [], {
       fetchFn,
+      nocodb,
       env: BASE_ENV,
     });
 
-    // 3 calls: state lookup + state update + Telegram alert
+    // 3 calls: state NocoDB list + state NocoDB update + Telegram alert
     expect(fetchFn).toHaveBeenCalledTimes(3);
     const tgCall = fetchFn.mock.calls[2][0];
     expect(tgCall).toContain('api.telegram.org');
