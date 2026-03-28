'use strict';

// ─── deliver-alert.js ──────────────────────────────────────────────────────
// W5 Alert Delivery node for InsiderBuying.ai pipeline.
// Sends email via Resend and push via OneSignal to eligible subscribers,
// then updates Airtable with delivery tracking.
// ────────────────────────────────────────────────────────────────────────────

const POSTAL_ADDRESS = '123 Market Street, Suite 100, San Francisco, CA 94105';

// ─── Pure helpers ───────────────────────────────────────────────────────────

function formatMoney(value) {
  if (value == null || isNaN(value)) return '$0';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${value}`;
}

function chunkArray(arr, maxSize) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += maxSize) {
    chunks.push(arr.slice(i, i + maxSize));
  }
  return chunks;
}

// ─── 6.1 Fetch Eligible Users ───────────────────────────────────────────────

async function fetchEligibleUsers(alertScore, ticker, opts) {
  const { fetchFn, env } = opts;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Get all preferences where email_enabled=true
  const prefUrl = `${env.SUPABASE_URL}/rest/v1/user_alert_preferences?email_enabled=eq.true&select=user_id,min_significance_score,watched_tickers`;
  const prefRes = await fetchFn(prefUrl, { headers });
  if (!prefRes.ok) {
    console.warn(`[deliver-alert] Preferences query failed (${prefRes.status})`);
    return [];
  }
  const allPrefs = await prefRes.json();
  if (!Array.isArray(allPrefs)) return [];

  // Filter: score threshold OR watched ticker match
  const eligible = allPrefs.filter((p) => {
    const scoreMatch = (p.min_significance_score || 10) <= alertScore;
    const tickerMatch = Array.isArray(p.watched_tickers) && p.watched_tickers.includes(ticker);
    return scoreMatch || tickerMatch;
  });

  if (eligible.length === 0) return [];

  // Step 2: Get subscription tiers
  const userIds = eligible.map((p) => p.user_id);
  const profileUrl = `${env.SUPABASE_URL}/rest/v1/profiles?user_id=in.(${userIds.join(',')})&select=user_id,subscription_tier`;
  const profileRes = await fetchFn(profileUrl, { headers });
  const profiles = await profileRes.json();
  const tierMap = new Map();
  if (Array.isArray(profiles)) {
    for (const p of profiles) tierMap.set(p.user_id, p.subscription_tier || 'free');
  }

  // Step 3: Get emails via admin API (one per user)
  const users = [];
  for (const pref of eligible) {
    try {
      const userUrl = `${env.SUPABASE_URL}/auth/v1/admin/users/${pref.user_id}`;
      const userRes = await fetchFn(userUrl, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      const userData = await userRes.json();
      const email = userData?.user?.email;
      if (email) {
        users.push({
          userId: pref.user_id,
          email,
          subscriptionTier: tierMap.get(pref.user_id) || 'free',
        });
      }
    } catch (err) {
      // Log only user_id, NEVER email
      console.warn(`[deliver-alert] Failed to get user ${pref.user_id}: ${err.message}`);
    }
  }

  return users;
}

// ─── 6.2 Build Email ────────────────────────────────────────────────────────

function buildEmailHtml(alertData, analysisContent, isPro) {
  const truncated = !isPro && analysisContent && analysisContent.length > 150;
  const displayAnalysis = truncated
    ? analysisContent.slice(0, 150) + '... <a href="https://earlyinsider.com/pricing" style="color:#4A90D9;">upgrade to Pro to read full analysis</a>'
    : (analysisContent || 'No analysis available for this alert.');

  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#111;color:#eee;">
  <h2 style="color:#4A90D9;">EarlyInsider Alert</h2>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:8px;color:#aaa;">Ticker</td><td style="padding:8px;font-weight:bold;">${alertData.ticker}</td></tr>
    <tr><td style="padding:8px;color:#aaa;">Insider</td><td style="padding:8px;">${alertData.insider_name} (${alertData.insider_title})</td></tr>
    <tr><td style="padding:8px;color:#aaa;">Value</td><td style="padding:8px;">${formatMoney(alertData.total_value)}</td></tr>
    <tr><td style="padding:8px;color:#aaa;">Score</td><td style="padding:8px;"><span style="background:${alertData.significance_score >= 7 ? '#27AE60' : '#F39C12'};padding:2px 8px;border-radius:4px;">${alertData.significance_score}/10</span></td></tr>
  </table>
  <div style="margin:16px 0;line-height:1.6;">${displayAnalysis}</div>
  <hr style="border-color:#333;">
  <p style="font-size:12px;color:#666;">
    <a href="https://earlyinsider.com/preferences?unsubscribe=1" style="color:#888;">Unsubscribe</a> |
    <a href="https://earlyinsider.com/preferences" style="color:#888;">Manage preferences</a><br>
    ${POSTAL_ADDRESS}
  </p>
</div>`;
}

function buildEmailObject(user, alertData) {
  const isPro = user.subscriptionTier === 'pro';
  const html = buildEmailHtml(alertData, alertData.ai_analysis, isPro);

  let subject;
  if (alertData.transaction_type === 'cluster') {
    subject = `\u{1F525} CLUSTER BUY: ${alertData.cluster_size} insiders buying ${alertData.ticker}`;
  } else {
    subject = `[INSIDER BUY] ${alertData.insider_name} (${alertData.insider_title}) buys ${formatMoney(alertData.total_value)} of ${alertData.ticker}`;
  }

  return {
    from: 'EarlyInsider <alerts@earlyinsider.com>',
    to: user.email,
    subject,
    html,
  };
}

// ─── Send Resend Batch ──────────────────────────────────────────────────────

async function sendResendBatch(emails, opts) {
  const { fetchFn, env, _sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  const chunks = chunkArray(emails, 100);
  let totalSent = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await _sleep(200);

    const res = await fetchFn('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunks[i]),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Resend API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    // Resend returns { data: [{ id }] } for batch
    totalSent += chunks[i].length;
  }

  return totalSent;
}

// ─── 6.3 OneSignal Push ─────────────────────────────────────────────────────

async function sendOneSignalPush(alertData, supabaseAlertId, opts) {
  const { fetchFn, env } = opts;

  const typeLabel = alertData.transaction_type === 'cluster' ? 'cluster buy' : 'buys';
  const heading = alertData.transaction_type === 'cluster'
    ? `CLUSTER: ${alertData.ticker}`
    : `${alertData.ticker} Insider Buy`;

  const body = {
    app_id: env.ONESIGNAL_APP_ID,
    filters: [
      { field: 'tag', key: 'alert_score_min', relation: '<=', value: String(alertData.significance_score) },
    ],
    headings: { en: heading },
    contents: {
      en: `${alertData.ticker}: ${alertData.insider_title} ${typeLabel} ${formatMoney(alertData.total_value)}`,
    },
    url: `https://earlyinsider.com/alerts#${supabaseAlertId}`,
  };

  const res = await fetchFn('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${env.ONESIGNAL_REST_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OneSignal API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.recipients || 0;
}

// ─── 6.4 Delivery Tracking ──────────────────────────────────────────────────

async function updateDeliveryStatus(recordId, fields, opts) {
  const { fetchFn, env } = opts;
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.INSIDER_ALERTS_TABLE_ID}/${recordId}`;
  await fetchFn(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

async function deliverAlert(alertData, opts) {
  const { fetchFn, env, _sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;

  let totalEmailsSent = 0;
  let pushSentCount = 0;
  const errors = [];

  // Fetch eligible users
  const users = await fetchEligibleUsers(alertData.significance_score, alertData.ticker, {
    fetchFn,
    env,
  });

  // Send emails
  if (users.length > 0) {
    const emails = users.map((u) => buildEmailObject(u, alertData));
    try {
      totalEmailsSent = await sendResendBatch(emails, { fetchFn, env, _sleep });
    } catch (err) {
      errors.push(`Email: ${err.message}`);
    }
  }

  // Send push
  try {
    pushSentCount = await sendOneSignalPush(
      alertData,
      alertData.supabase_alert_id,
      { fetchFn, env },
    );
  } catch (err) {
    errors.push(`Push: ${err.message}`);
  }

  // Determine status
  const finalStatus = errors.length > 0 ? 'delivery_failed' : 'delivered';
  const deliveredAt = new Date().toISOString();

  const trackingFields = {
    status: finalStatus,
    emails_sent: totalEmailsSent,
    push_sent: pushSentCount,
  };

  if (finalStatus === 'delivered') {
    trackingFields.delivered_at = deliveredAt;
  }
  if (errors.length > 0) {
    trackingFields.error_log = errors.join('; ');
  }

  // Update Airtable delivery tracking
  try {
    await updateDeliveryStatus(alertData.airtable_record_id, trackingFields, { fetchFn, env });
  } catch (err) {
    console.warn(`[deliver-alert] Failed to update delivery status: ${err.message}`);
  }

  return {
    airtable_record_id: alertData.airtable_record_id,
    supabase_alert_id: alertData.supabase_alert_id,
    ticker: alertData.ticker,
    emails_sent: totalEmailsSent,
    push_sent: pushSentCount,
    status: finalStatus,
    delivered_at: deliveredAt,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  fetchEligibleUsers,
  buildEmailObject,
  buildEmailHtml,
  chunkArray,
  formatMoney,
  sendResendBatch,
  sendOneSignalPush,
  updateDeliveryStatus,
  deliverAlert,
};
