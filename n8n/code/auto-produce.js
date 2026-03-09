// NODE: Auto Produce (Schedule Trigger -- quota check + dispatch via webhook)
// Runs every 30 min. For each phone needing content, triggers a separate
// production execution via internal webhook (true parallelism).
//
// WIRING: Auto Produce Schedule -> this Code node

// --- fetch polyfill (n8n Code node sandbox lacks global fetch) ---
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
      hostname: u.hostname, port: u.port || undefined,
      path: u.pathname + u.search, method: opts.method || 'GET',
      headers: { ...(opts.headers || {}) },
    };
    if (body && !ro.headers['Content-Length']) {
      ro.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = lib.request(ro, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetch(res.headers.location, opts, _redirectCount + 1).then(resolve, reject);
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

const AIRTABLE_BASE = 'https://api.airtable.com/v0/appsgjIdkpak2kaXq';
const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
const PHONES_TABLE = 'tblCvT47GpZv29jz9';
const CONTENT_LIBRARY_TABLE = 'tblx1KX7mlTX5QyGb';
const VIDEO_RUNS_TABLE = 'tbltCYcVXrLYvyIJL';
const SCENARIOS_TABLE = 'tblcQaMBBPcOAy0NF';

// Buffer: produce enough videos to cover this many days per phone
const BUFFER_DAYS = 7;

// Internal n8n webhook (runs inside same container on port 5678)
const WEBHOOK_BASE = (typeof $env !== 'undefined' && $env.N8N_WEBHOOK_URL)
  || 'http://localhost:5678';
const WEBHOOK_PATH = '/webhook/auto-produce';

async function airtableGet(tableId, params = {}) {
  const qs = Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
  const url = AIRTABLE_BASE + '/' + tableId + (qs ? '?' + qs : '');
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + ATOKEN } });
  if (!res.ok) throw new Error('Airtable ' + res.status + ': ' + (await res.text()));
  return res.json();
}

// --- 1. Load active phones ---
const phonesData = await airtableGet(PHONES_TABLE, {
  filterByFormula: "{is_active}=TRUE()",
});
const phones = (phonesData.records || []).map(r => ({
  recordId: r.id,
  chatId: r.fields.telegram_chat_id || '',
  phoneName: r.fields.phone_name || '',
  phoneId: r.fields.phone_id || '',
  videosPerDay: r.fields.videos_per_day || 2,
}));

if (phones.length === 0) {
  console.log('[auto-produce] No active phones found');
  return [{ json: { triggered: 0, log: ['No active phones'], timestamp: new Date().toISOString() } }];
}

const log = [];
let triggered = 0;

for (const phone of phones) {
  if (!phone.chatId) {
    log.push(phone.phoneName + ': skip (no chatId)');
    continue;
  }

  // --- 2. Check for active Video Runs (status = 'started') ---
  try {
    const runsData = await airtableGet(VIDEO_RUNS_TABLE, {
      filterByFormula: "AND({telegram_chat_id}='" + phone.chatId + "', {status}='started')",
      maxRecords: '1',
      'fields[]': 'status',
    });
    if ((runsData.records || []).length > 0) {
      log.push(phone.phoneName + ': skip (production in progress)');
      continue;
    }
  } catch (e) {
    log.push(phone.phoneName + ': skip (runs check error: ' + e.message + ')');
    continue;
  }

  // --- 3. Count pending videos in Content Library ---
  const targetPending = phone.videosPerDay * BUFFER_DAYS;
  let pendingCount = 0;
  try {
    const contentData = await airtableGet(CONTENT_LIBRARY_TABLE, {
      filterByFormula: "AND(FIND('" + phone.phoneName + "', {content_label}), OR({platform_status_tiktok}='pending', {platform_status_instagram}='pending'))",
      'fields[]': 'content_label',
    });
    pendingCount = (contentData.records || []).length;
  } catch (e) {
    log.push(phone.phoneName + ': skip (content check error: ' + e.message + ')');
    continue;
  }

  if (pendingCount >= targetPending) {
    log.push(phone.phoneName + ': skip (' + pendingCount + '/' + targetPending + ' pending)');
    continue;
  }

  // --- 4. Check if any ready scenarios exist ---
  try {
    const scenarioData = await airtableGet(SCENARIOS_TABLE, {
      filterByFormula: "{status}='ready'",
      maxRecords: '1',
      'fields[]': 'status',
    });
    if ((scenarioData.records || []).length === 0) {
      log.push(phone.phoneName + ': skip (no ready scenarios)');
      continue;
    }
  } catch (e) {
    log.push(phone.phoneName + ': skip (scenario check error: ' + e.message + ')');
    continue;
  }

  // --- 5. Trigger production via internal webhook ---
  const hour = new Date().getHours();
  const timeOfDay = (hour >= 18 || hour < 6) ? 'night' : 'day';
  const payload = JSON.stringify({
    chatId: String(phone.chatId),
    scenarioName: '',
    timeOfDay,
    phoneName: phone.phoneName,
    isAuto: true,
  });

  try {
    const res = await fetch(WEBHOOK_BASE + WEBHOOK_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    if (res.ok) {
      log.push(phone.phoneName + ': TRIGGERED (' + pendingCount + '/' + targetPending + ' pending)');
      triggered++;
    } else {
      log.push(phone.phoneName + ': webhook error ' + res.status);
    }
  } catch (e) {
    log.push(phone.phoneName + ': webhook failed: ' + e.message);
  }
}

console.log('[auto-produce] ' + log.join(' | '));

return [{ json: { triggered, log, timestamp: new Date().toISOString() } }];
