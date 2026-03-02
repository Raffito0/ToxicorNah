// NODE: Monitor Availability (Schedule Trigger — every 30 minutes)
// Probes PoYo Sora 2 API availability and records results in Airtable.
// After several days of data, patterns emerge showing best hours/days for generation.
//
// Probes both models: sora-2 and sora-2-private (different capacity pools)
// Each successful probe submits a minimal generation request.
//
// At 23:30 CET (21:30 UTC), also runs daily analysis and sends Telegram summary.
//
// WIRING: Schedule Trigger (*/30 * * * *) → this Code node
// Mode: Run Once for All Items

// ─── fetch polyfill ───
const _https = require('https');
const _http = require('http');
const { URL } = require('url');

function fetch(url, opts = {}, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (_redirectCount > 5) return reject(new Error('Too many redirects'));
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? _https : _http;
    const body = opts.body || null;
    const ro = {
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { ...(opts.headers || {}) },
    };
    if (body) ro.headers['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(ro, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : u.protocol + '//' + u.host + res.headers.location;
        return fetch(redirectUrl, opts, _redirectCount + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(buf.toString()),
          json: () => Promise.resolve(JSON.parse(buf.toString())),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Config ───
const ABASE = 'appsgjIdkpak2kaXq';
const MONITOR_TABLE = 'tbluInOlQ1Biyg1CB';
const POYO_KEY = (typeof $env !== 'undefined' && $env.POYO_API_KEY) || 'sk-vJqqGNNTcH9g89DnEYum48LHkdR0R6sZ-qQCFoiWzCJQlPmXKtbIdOWiRGnhB-';
const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
const TBOT = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '8686184447:AAH688Be7c19XdzwFzOmONyrnrTCc-q8VHg';
const ADMIN_CHAT = (typeof $env !== 'undefined' && $env.ADMIN_CHAT_ID) || '5120450288';

const MODELS_TO_PROBE = ['sora-2'];

// ─── CET time helpers ───
function getCETTime() {
  const now = new Date();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  let isCEST = false;
  if (month > 2 && month < 9) isCEST = true;
  if (month === 2) {
    const lastSun = 31 - ((new Date(now.getUTCFullYear(), 2, 31).getDay()) % 7);
    if (day > lastSun || (day === lastSun && now.getUTCHours() >= 1)) isCEST = true;
  }
  if (month === 9) {
    const lastSun = 31 - ((new Date(now.getUTCFullYear(), 9, 31).getDay()) % 7);
    if (day < lastSun || (day === lastSun && now.getUTCHours() < 1)) isCEST = true;
  }
  const offsetHours = isCEST ? 2 : 1;
  const cetDate = new Date(now.getTime() + offsetHours * 3600000);
  return {
    isoString: now.toISOString(),
    date: cetDate.toISOString().slice(0, 10),
    hour: cetDate.getUTCHours(),
    minute: cetDate.getUTCMinutes(),
    dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][cetDate.getUTCDay()],
  };
}

// ─── Probe PoYo ───
async function probePoyo(model) {
  const start = Date.now();
  try {
    const res = await fetch('https://api.poyo.ai/api/generate/submit', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + POYO_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: {
          prompt: 'Static shot of a person standing still in a room, minimal movement, locked camera',
          duration: 5,
          aspect_ratio: '9:16',
        },
      }),
    });

    const elapsed = Date.now() - start;
    const bodyText = await res.text();

    if (!res.ok) {
      return { status: 'rejected', error: bodyText.slice(0, 200), responseMs: elapsed, taskId: '' };
    }

    let data;
    try { data = JSON.parse(bodyText); } catch(e) {
      return { status: 'error', error: 'Invalid JSON: ' + bodyText.slice(0, 100), responseMs: elapsed, taskId: '' };
    }

    // PoYo returns { code: 200, data: { task_id, status } } on success
    if (data.code === 200 && data.data && data.data.task_id) {
      return { status: 'accepted', error: '', responseMs: elapsed, taskId: data.data.task_id };
    }

    // API returned 200 HTTP but non-200 code (capacity issue)
    return { status: 'rejected', error: (data.message || JSON.stringify(data)).slice(0, 200), responseMs: elapsed, taskId: '' };

  } catch (err) {
    return { status: 'error', error: err.message.slice(0, 200), responseMs: Date.now() - start, taskId: '' };
  }
}

// ─── Save probe result to Airtable ───
async function saveProbe(cet, provider, model, result) {
  if (!ATOKEN) return;

  try {
    await fetch('https://api.airtable.com/v0/' + ABASE + '/' + MONITOR_TABLE, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ATOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{
          fields: {
            probe_time: cet.isoString,
            probe_date: cet.date,
            hour_cet: cet.hour,
            minute: cet.minute,
            day_of_week: cet.dayOfWeek,
            provider,
            model,
            status: result.status,
            error_message: result.error || '',
            response_time_ms: result.responseMs,
            task_id: result.taskId || '',
          }
        }],
      }),
    });
  } catch(e) {
    console.log('[monitor] Airtable save error: ' + e.message);
  }
}

// ─── Daily analysis (runs at 23:30 CET) ───
async function runDailyAnalysis() {
  if (!ATOKEN) return null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000).toISOString().slice(0, 10);
  const formula = encodeURIComponent("{probe_date}>='" + sevenDaysAgo + "'");

  let allRecords = [];
  let offset = null;

  do {
    const url = 'https://api.airtable.com/v0/' + ABASE + '/' + MONITOR_TABLE +
      '?filterByFormula=' + formula + '&pageSize=100' + (offset ? '&offset=' + offset : '');

    try {
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + ATOKEN } });
      if (!res.ok) break;
      const data = await res.json();
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || null;
    } catch(e) {
      console.log('[analysis] Fetch error: ' + e.message);
      break;
    }
  } while (offset);

  if (allRecords.length === 0) return 'No data collected yet.';

  const hourStats = {};
  for (let h = 0; h < 24; h++) hourStats[h] = { total: 0, accepted: 0 };

  const dayStats = {};
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (const d of days) dayStats[d] = { total: 0, accepted: 0 };

  const modelStats = {};

  for (const r of allRecords) {
    const f = r.fields;
    const h = f.hour_cet;
    const d = f.day_of_week;
    const m = f.model || 'unknown';
    const accepted = f.status === 'accepted';

    if (h != null && hourStats[h]) {
      hourStats[h].total++;
      if (accepted) hourStats[h].accepted++;
    }

    if (d && dayStats[d]) {
      dayStats[d].total++;
      if (accepted) dayStats[d].accepted++;
    }

    if (!modelStats[m]) modelStats[m] = { total: 0, accepted: 0 };
    modelStats[m].total++;
    if (accepted) modelStats[m].accepted++;
  }

  const hourRanking = Object.entries(hourStats)
    .filter(([_, s]) => s.total >= 2)
    .map(([h, s]) => ({
      hour: parseInt(h),
      rate: s.total > 0 ? Math.round((s.accepted / s.total) * 100) : 0,
      total: s.total,
      accepted: s.accepted,
    }))
    .sort((a, b) => b.rate - a.rate || b.accepted - a.accepted);

  let summary = '\uD83D\uDCCA PoYo Sora 2 Availability Report (last 7 days)\n';
  summary += 'Total probes: ' + allRecords.length + '\n\n';

  summary += '\uD83C\uDF1F Best hours (CET):\n';
  const top5 = hourRanking.slice(0, 5);
  for (const h of top5) {
    const bar = h.rate >= 80 ? '\uD83D\uDFE2' : h.rate >= 50 ? '\uD83D\uDFE1' : '\uD83D\uDD34';
    summary += bar + ' ' + String(h.hour).padStart(2, '0') + ':00 \u2014 ' + h.rate + '% (' + h.accepted + '/' + h.total + ')\n';
  }

  summary += '\n\u26D4 Worst hours (CET):\n';
  const worst3 = hourRanking.slice(-3).reverse();
  for (const h of worst3) {
    summary += '\uD83D\uDD34 ' + String(h.hour).padStart(2, '0') + ':00 \u2014 ' + h.rate + '% (' + h.accepted + '/' + h.total + ')\n';
  }

  summary += '\n\uD83D\uDCC5 By day:\n';
  for (const d of days) {
    const s = dayStats[d];
    if (s.total === 0) continue;
    const rate = Math.round((s.accepted / s.total) * 100);
    const bar = rate >= 80 ? '\uD83D\uDFE2' : rate >= 50 ? '\uD83D\uDFE1' : '\uD83D\uDD34';
    summary += bar + ' ' + d + ' \u2014 ' + rate + '% (' + s.accepted + '/' + s.total + ')\n';
  }

  summary += '\n\uD83E\uDD16 By model:\n';
  for (const [m, s] of Object.entries(modelStats)) {
    const rate = Math.round((s.accepted / s.total) * 100);
    summary += '  ' + m + ': ' + rate + '% (' + s.accepted + '/' + s.total + ')\n';
  }

  if (top5.length > 0) {
    const bestHours = top5.filter(h => h.rate >= 70).map(h => String(h.hour).padStart(2, '0') + ':00');
    if (bestHours.length > 0) {
      summary += '\n\u2705 Recommended batch window: ' + bestHours.join(', ') + ' CET';
    }
  }

  return summary;
}

// ═══════════════════════════════════════
// Main logic
// ═══════════════════════════════════════

const cet = getCETTime();
console.log('[monitor] Probe at ' + cet.isoString + ' (' + cet.dayOfWeek + ' ' + String(cet.hour).padStart(2, '0') + ':' + String(cet.minute).padStart(2, '0') + ' CET)');

const probeResults = [];

// Probe each PoYo model
for (const model of MODELS_TO_PROBE) {
  console.log('[monitor] Probing poyo/' + model + '...');
  const result = await probePoyo(model);
  console.log('[monitor] poyo/' + model + ': ' + result.status + ' (' + result.responseMs + 'ms)' + (result.error ? ' \u2014 ' + result.error.slice(0, 80) : ''));

  await saveProbe(cet, 'poyo', model, result);
  probeResults.push({ provider: 'poyo', model, ...result });

  // Small delay between probes
  await new Promise(r => setTimeout(r, 2000));
}

// Daily analysis at 23:30 CET
let analysisReport = null;
if (cet.hour === 23 && cet.minute >= 25) {
  console.log('[monitor] Running daily analysis...');
  analysisReport = await runDailyAnalysis();
  if (analysisReport && TBOT && ADMIN_CHAT) {
    try {
      await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_CHAT, text: analysisReport }),
      });
    } catch(e) { console.log('[monitor] Telegram analysis send error: ' + e.message); }
  }
}

// Quick status to Telegram (only on errors or every 6 hours for heartbeat)
const allAccepted = probeResults.every(r => r.status === 'accepted');
const allRejected = probeResults.every(r => r.status !== 'accepted');
const isHeartbeat = (cet.hour % 6 === 0 && cet.minute < 30);

if (TBOT && ADMIN_CHAT && (allRejected || isHeartbeat)) {
  const statusEmoji = allAccepted ? '\uD83D\uDFE2' : allRejected ? '\uD83D\uDD34' : '\uD83D\uDFE1';
  const statusText = probeResults.map(r => r.model + ': ' + r.status + ' (' + r.responseMs + 'ms)').join(', ');
  try {
    await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT,
        text: statusEmoji + ' PoYo ' + String(cet.hour).padStart(2, '0') + ':' + String(cet.minute).padStart(2, '0') + ' CET \u2014 ' + statusText,
      }),
    });
  } catch(e) { /* non-fatal */ }
}

return [{
  json: {
    probeTime: cet.isoString,
    hourCET: cet.hour,
    dayOfWeek: cet.dayOfWeek,
    results: probeResults,
    analysisReport: analysisReport || null,
  }
}];
