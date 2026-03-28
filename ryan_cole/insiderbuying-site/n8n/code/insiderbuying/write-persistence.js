'use strict';

// ─── write-persistence.js ──────────────────────────────────────────────────
// Persistence layer for the W4 InsiderBuying.ai pipeline.
// Runs after scoring (score-alert.js) and AI analysis (analyze-alert.js).
// Writes each filing individually to Airtable then Supabase, updates
// Monitor_State, creates cluster summaries, and handles error alerting.
// ────────────────────────────────────────────────────────────────────────────

// ─── 5.1 Create Airtable Record ────────────────────────────────────────────

/**
 * Create a record in Airtable Insider_Alerts for a scored+analyzed filing.
 * Returns the Airtable record ID on success, throws on failure.
 */
async function createAirtableRecord(filing, opts) {
  const { fetchFn, env } = opts;
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}`;

  const fields = {
    dedup_key: filing.dedup_key,
    ticker: filing.ticker,
    company_name: filing.company_name,
    insider_name: filing.insider_name,
    insider_title: filing.insider_title,
    insider_category: filing.insider_category,
    transaction_type: filing.transaction_type,
    shares: filing.shares,
    price_per_share: filing.price_per_share,
    total_value: filing.total_value,
    transaction_date: filing.transaction_date,
    filing_date: filing.filing_date,
    significance_score: filing.significance_score,
    score_reasoning: filing.score_reasoning,
    ai_analysis: filing.ai_analysis || '',
    is_cluster_buy: filing.is_cluster_buy || false,
    cluster_size: filing.cluster_size || 0,
    raw_filing_data: typeof filing.raw_filing_data === 'string'
      ? filing.raw_filing_data
      : JSON.stringify(filing.raw_filing_data),
    status: 'processed',
  };

  // Only include cluster_id if present
  if (filing.cluster_id) {
    fields.cluster_id = filing.cluster_id;
  }

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  const data = await res.json();
  if (!data.id) {
    throw new Error(`Airtable create failed: ${JSON.stringify(data)}`);
  }
  return data.id;
}

// ─── 5.2 Insert to Supabase ────────────────────────────────────────────────

/**
 * Insert filing into Supabase insider_alerts.
 * Uses ON CONFLICT (dedup_key) DO NOTHING via Prefer header.
 * Returns the UUID on insert, null on conflict (graceful dedup).
 */
async function insertToSupabase(filing, opts) {
  const { fetchFn, env } = opts;
  const url =
    `${env.SUPABASE_URL}/rest/v1/insider_alerts?on_conflict=dedup_key`;

  const body = {
    dedup_key: filing.dedup_key,
    ticker: filing.ticker,
    company_name: filing.company_name,
    insider_name: filing.insider_name,
    insider_title: filing.insider_title,
    insider_category: filing.insider_category,
    transaction_type: filing.transaction_type,
    shares: filing.shares,
    price_per_share: filing.price_per_share,
    total_value: filing.total_value,
    transaction_date: filing.transaction_date,
    filing_date: filing.filing_date,
    significance_score: filing.significance_score,
    score_reasoning: filing.score_reasoning,
    ai_analysis: filing.ai_analysis || null,
    is_cluster_buy: filing.is_cluster_buy || false,
    cluster_id: filing.cluster_id || null,
    cluster_size: filing.cluster_size || 0,
    raw_filing_data: typeof filing.raw_filing_data === 'string'
      ? filing.raw_filing_data
      : JSON.stringify(filing.raw_filing_data),
    status: 'processed',
  };

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=ignore-duplicates',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (Array.isArray(data) && data.length > 0 && data[0].id) {
    return data[0].id;
  }
  // Conflict / empty = graceful no-op
  return null;
}

// ─── 5.1+5.2 Combined per-filing write ──────────────────────────────────────

/**
 * Write a single filing to Airtable then Supabase, cross-reference IDs.
 * Mutates ctx (failureCount, firstError, failedFilings, successfulFilings).
 */
async function writeFilingPersistence(filing, ctx, opts) {
  const { fetchFn, env } = opts;
  let airtableRecordId = null;

  // Step 1: Create Airtable record
  try {
    airtableRecordId = await createAirtableRecord(filing, { fetchFn, env });
  } catch (err) {
    ctx.failureCount++;
    if (!ctx.firstError) ctx.firstError = `Airtable create for ${filing.dedup_key}: ${err.message}`;
    ctx.failedFilings.push({ ...filing, _lastError: err.message });
    return;
  }

  // Step 2: Insert to Supabase
  let supabaseId = null;
  try {
    supabaseId = await insertToSupabase(filing, { fetchFn, env });
  } catch (err) {
    ctx.failureCount++;
    if (!ctx.firstError) ctx.firstError = `Supabase insert for ${filing.dedup_key}: ${err.message}`;
    ctx.failedFilings.push({ ...filing, airtable_record_id: airtableRecordId, _lastError: err.message });
    // Attempt to mark Airtable record as failed
    try {
      await patchAirtableRecord(airtableRecordId, { status: 'failed' }, { fetchFn, env });
    } catch (_) { /* non-critical */ }
    return;
  }

  // Step 3: Patch Airtable with supabase_id (non-critical)
  if (supabaseId) {
    try {
      await patchAirtableRecord(airtableRecordId, { supabase_id: supabaseId }, { fetchFn, env });
    } catch (err) {
      console.warn(`[write-persistence] Failed to patch supabase_id on ${airtableRecordId}: ${err.message}`);
    }
  }

  // Step 4: Success
  ctx.successfulFilings.push({ ...filing, airtable_record_id: airtableRecordId, supabase_id: supabaseId });
}

// ─── Helper: PATCH Airtable record ──────────────────────────────────────────

async function patchAirtableRecord(recordId, fields, opts) {
  const { fetchFn, env } = opts;
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}/${recordId}`;
  const res = await fetchFn(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (res && !res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Airtable PATCH failed (${res.status}): ${errBody}`);
  }
}

// ─── 5.3 Monitor_State Update ───────────────────────────────────────────────

/**
 * Update Monitor_State after all filings processed.
 * Rolls back timestamp to min(failed_filing.filing_date) on partial failure,
 * excluding dead-letter filings (retry_count > 3).
 */
async function updateMonitorState(workflowName, successfulFilings, failedFilings, firstError, opts) {
  const { fetchFn, env } = opts;

  // Fetch the Monitor_State record for this workflow
  const stateUrl =
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.MONITOR_STATE_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent(`{name}='${workflowName}'`)}`;

  const stateRes = await fetchFn(stateUrl, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
  });
  const stateData = await stateRes.json();
  const stateRecord = stateData.records && stateData.records[0];
  if (!stateRecord) {
    console.warn(`[write-persistence] No Monitor_State record found for workflow '${workflowName}'`);
    return;
  }

  // Filter out dead-letter filings from timestamp rollback
  const retryableFailures = failedFilings.filter((f) => !f.retry_count || f.retry_count <= 3);

  let timestamp;
  let status;

  if (failedFilings.length === 0) {
    // All succeeded
    timestamp = new Date().toISOString();
    status = 'success';
  } else if (retryableFailures.length === 0) {
    // All failures are dead-lettered — advance timestamp
    timestamp = new Date().toISOString();
    status = 'error';
  } else {
    // Roll back to earliest retryable failed filing date
    const dates = retryableFailures
      .map((f) => f.filing_date)
      .filter(Boolean)
      .sort();
    timestamp = dates[0] || new Date().toISOString();
    status = 'error';
  }

  const fields = {
    last_check_timestamp: timestamp,
    last_run_status: status,
  };
  if (firstError && failedFilings.length > 0) {
    fields.last_run_error = firstError;
  }

  await fetchFn(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.MONITOR_STATE_TABLE_ID}/${stateRecord.id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    },
  );
}

// ─── 5.3 Dead-Letter Handler ────────────────────────────────────────────────

/**
 * Mark a filing as dead_letter in Airtable and send Telegram notification.
 */
async function handleDeadLetter(filing, airtableRecordId, workflowName, opts) {
  const { fetchFn, env } = opts;

  // PATCH Airtable status
  await patchAirtableRecord(airtableRecordId, { status: 'dead_letter' }, { fetchFn, env });

  // Send Telegram notification
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_MONITORING_CHAT_ID) {
    const msg = encodeURIComponent(
      `Dead letter: ${workflowName}\n` +
      `Key: ${filing.dedup_key}\n` +
      `Ticker: ${filing.ticker}\n` +
      `Error: ${filing._lastError || 'unknown'}`,
    );
    await fetchFn(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage` +
      `?chat_id=${env.TELEGRAM_MONITORING_CHAT_ID}&text=${msg}`,
    ).catch(() => {});
  }
}

// ─── 5.4 Cluster Alert Creation ─────────────────────────────────────────────

/**
 * Create or update a cluster summary record in Airtable + Supabase.
 * Returns { created: bool, triggerW5: bool }.
 */
async function createOrUpdateClusterSummary(clusterId, clusterFilings, opts) {
  const { fetchFn, env } = opts;

  // Calculate cluster score
  const maxScore = Math.max(...clusterFilings.map((f) => f.significance_score || 0));
  const newScore = Math.min(10, maxScore + 3);
  const clusterSize = clusterFilings.length;
  const ticker = clusterFilings[0].ticker;

  // Build composite analysis
  const memberSummaries = clusterFilings
    .map((f) => `${f.insider_name} (${f.insider_title}): $${(f.total_value || 0).toLocaleString()}`)
    .join('; ');
  const analysisText = `Cluster buy alert: ${clusterSize} insiders at ${ticker} buying within 7 days. ${memberSummaries}.`;

  // Check for existing cluster summary in Airtable
  const searchUrl =
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent(`AND({transaction_type}='cluster',{cluster_id}='${clusterId}')`)}`;

  const searchRes = await fetchFn(searchUrl, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
  });
  const searchData = await searchRes.json();
  const existing = searchData.records && searchData.records[0];

  if (!existing) {
    // Create new cluster summary
    const fields = {
      dedup_key: `cluster_${clusterId}`,
      ticker,
      company_name: clusterFilings[0].company_name,
      insider_name: `${clusterSize} Insiders`,
      insider_title: 'Multiple',
      insider_category: 'Cluster',
      transaction_type: 'cluster',
      cluster_id: clusterId,
      is_cluster_buy: true,
      cluster_size: clusterSize,
      significance_score: newScore,
      ai_analysis: analysisText,
      status: 'processed',
    };

    const createRes = await fetchFn(
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      },
    );
    const createData = await createRes.json();

    // Also insert to Supabase
    const supabaseId = await insertToSupabase(
      { ...fields, raw_filing_data: JSON.stringify({ cluster_members: memberSummaries }) },
      { fetchFn, env },
    );

    // Patch Airtable with supabase_id
    if (supabaseId && createData.id) {
      try {
        await patchAirtableRecord(createData.id, { supabase_id: supabaseId }, { fetchFn, env });
      } catch (_) { /* non-critical */ }
    }

    return { created: true, triggerW5: true };
  }

  // Update existing cluster summary
  const oldScore = existing.fields.significance_score || 0;

  // Use max of old size + new members or new total — dedup prevents double-writes,
  // so additive is safe in the normal flow. Reruns with same filings won't re-insert
  // due to Supabase dedup_key constraint.
  const newSize = (existing.fields.cluster_size || 0) + clusterFilings.length;

  const updateFields = {
    cluster_size: newSize,
    significance_score: newScore,
    ai_analysis: analysisText,
  };

  await fetchFn(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}/${existing.id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: updateFields }),
    },
  );

  // Only re-trigger W5 if score increased by >= 2
  const scoreDelta = newScore - oldScore;
  return { created: false, triggerW5: scoreDelta >= 2 };
}

// ─── 5.5 Post-Processing (Monitor State + Error Alert + Clusters) ──────────

/**
 * Run all post-processing after filings are written.
 * Called once at end of run.
 */
async function runPostProcessing(
  workflowName,
  successfulFilings,
  failedFilings,
  failureCount,
  firstError,
  allFilings,
  opts,
) {
  const { fetchFn, env } = opts;

  // Handle dead-letter filings (retry_count > 3)
  for (const f of failedFilings) {
    if (f.retry_count && f.retry_count > 3 && f.airtable_record_id) {
      try {
        await handleDeadLetter(f, f.airtable_record_id, workflowName, { fetchFn, env });
      } catch (err) {
        console.warn(`[write-persistence] Dead-letter handling failed for ${f.dedup_key}: ${err.message}`);
      }
    }
  }

  // Update Monitor_State
  await updateMonitorState(workflowName, successfulFilings, failedFilings, firstError, {
    fetchFn,
    env,
  });

  // Telegram alert if too many failures
  if (failureCount > 5 && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_MONITORING_CHAT_ID) {
    const msg = encodeURIComponent(
      `W4 ${workflowName}: ${failureCount} failures\nFirst error: ${firstError}`,
    );
    await fetchFn(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage` +
      `?chat_id=${env.TELEGRAM_MONITORING_CHAT_ID}&text=${msg}`,
    ).catch(() => {});
  }

  // Cluster summaries
  const clusterGroups = new Map();
  for (const f of allFilings) {
    if (f.cluster_id) {
      if (!clusterGroups.has(f.cluster_id)) clusterGroups.set(f.cluster_id, []);
      clusterGroups.get(f.cluster_id).push(f);
    }
  }

  const clusterResults = [];
  for (const [cid, filings] of clusterGroups) {
    try {
      const result = await createOrUpdateClusterSummary(cid, filings, { fetchFn, env });
      clusterResults.push({ clusterId: cid, ...result });
    } catch (err) {
      console.warn(`[write-persistence] Cluster summary failed for ${cid}: ${err.message}`);
    }
  }

  return clusterResults;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  createAirtableRecord,
  insertToSupabase,
  writeFilingPersistence,
  updateMonitorState,
  handleDeadLetter,
  createOrUpdateClusterSummary,
  runPostProcessing,
  patchAirtableRecord,
};
