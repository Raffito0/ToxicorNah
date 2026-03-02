// NODE: Continuous Hook Generator (Schedule Trigger — every 2 min, 24/7)
// State machine that runs once per tick. Each tick advances the pipeline:
//   Phase 0: QUOTA CHECK — exit early if enough hooks ready
//   Phase 1: POLL PENDING — check provider status for submitted jobs
//   Phase 2: DELIVER COMPLETED — download finished video, send to Telegram
//   Phase 3: PROCESS REVIEWS — non-blocking getUpdates, trim clips, save to pool
//   Phase 4: SUBMIT NEW — kie.ai image + provider submit (if quota allows)
//
// Multi-provider: PoYo (active), APIMart (disabled), laozhang (disabled)
// State stored in Airtable "Hook Generation Queue" table.
// Telegram review is non-blocking — videos queue up, user reviews at their pace.
//
// WIRING: Schedule Trigger (*/2 * * * *) → this Code node
// Mode: Run Once for All Items

const fs = require('fs');
const { execSync } = require('child_process');

// ─── fetch polyfill (n8n Code node sandbox lacks global fetch) ───
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
          arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
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
const CONCEPTS_TABLE = 'tblhhTVI4EYofdY32';
const SCENARIOS_TABLE = 'tblcQaMBBPcOAy0NF';
const HOOK_POOL_TABLE = 'tbl3q91o3l0isSX9w';
const QUEUE_TABLE = 'tblXpyxSLN2vSJ4i3'; // Hook Generation Queue

const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';

const PREP01_BOT = '8686184447:AAH688Be7c19XdzwFzOmONyrnrTCc-q8VHg';
const ADMIN_CHAT = '5120450288';

const KIE_API_KEY = '7670ade582cc72601f388dbdc0525b9e';
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';

const CLIP_DURATION = 3;

// ─── Quota constants ───
const VIDEOS_PER_DAY = 10;
const BUFFER_DAYS = 2;
const TARGET_HOOKS = VIDEOS_PER_DAY * BUFFER_DAYS; // 20
const MAX_CONCURRENT = 3; // max simultaneous provider submissions
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000; // 20 min — mark as failed after this

// ─── Multi-Provider Config ───
const POYO_KEY = (typeof $env !== 'undefined' && $env.POYO_API_KEY) || 'sk-vJqqGNNTcH9g89DnEYum48LHkdR0R6sZ-qQCFoiWzCJQlPmXKtbIdOWiRGnhB-';
const APIMART_KEY = (typeof $env !== 'undefined' && $env.APIMART_API_KEY) || '';
const LAOZHANG_KEY = (typeof $env !== 'undefined' && $env.LAOZHANG_API_KEY) || '';

const PROVIDERS = [
  {
    name: 'poyo',
    enabled: true,
    submitUrl: 'https://api.poyo.ai/api/generate/submit',
    statusUrl: 'https://api.poyo.ai/api/generate/status/',
    apiKey: POYO_KEY,
    authPrefix: 'Bearer ',
    buildBody: function(prompt, imageUrl) {
      const input = { prompt: prompt, duration: 15, aspect_ratio: '9:16' };
      if (imageUrl) input.image_url = imageUrl;
      return { model: 'sora-2', input: input };
    },
    parseSubmitTaskId: function(data) { return data.data && data.data.task_id; },
    isSubmitOk: function(data) { return data.code === 200 && data.data && data.data.task_id; },
    parseStatus: function(data) { return data.data && data.data.status; },
    parseVideoUrl: function(data) { return data.data && data.data.files && data.data.files[0] && data.data.files[0].file_url; },
    isComplete: function(status) { return status === 'finished'; },
    isFailed: function(status) { return status === 'failed'; },
  },
  {
    name: 'apimart',
    enabled: false,
    submitUrl: 'https://api.apimart.ai/v1/videos/generations',
    statusUrl: 'https://api.apimart.ai/v1/tasks/',
    apiKey: APIMART_KEY,
    authPrefix: 'Bearer ',
    buildBody: function(prompt, imageUrl) {
      return {
        model: 'sora-2', prompt: prompt, duration: 15, aspect_ratio: '9:16',
        watermark: false, private: true,
        image_urls: imageUrl ? [imageUrl] : [],
      };
    },
    parseSubmitTaskId: function(data) { return data.data && data.data[0] && data.data[0].task_id; },
    isSubmitOk: function(data) { return data.code === 200 && data.data && data.data[0] && data.data[0].task_id; },
    parseStatus: function(data) { return data.data && data.data.status; },
    parseVideoUrl: function(data) {
      try { return data.data.result.videos[0].url[0]; } catch (e) { return null; }
    },
    isComplete: function(status) { return status === 'completed'; },
    isFailed: function(status) { return status === 'failed' || status === 'cancelled'; },
  },
  {
    name: 'laozhang',
    enabled: false,
    submitUrl: '',
    statusUrl: '',
    apiKey: LAOZHANG_KEY,
    authPrefix: 'Bearer ',
    buildBody: function() { return {}; },
    parseSubmitTaskId: function() { return null; },
    isSubmitOk: function() { return false; },
    parseStatus: function() { return null; },
    parseVideoUrl: function() { return null; },
    isComplete: function() { return false; },
    isFailed: function() { return true; },
  },
];

// ─── Static data (persists across n8n executions) ───
const staticData = $getWorkflowStaticData('global');
if (!staticData.hookGenOffset) staticData.hookGenOffset = 0;
if (!staticData.lastProviderIndex) staticData.lastProviderIndex = 0;
// Track last quota notification to avoid spam
if (!staticData.lastQuotaNotification) staticData.lastQuotaNotification = '';
// Track daily summary (YYYY-MM-DD of last summary sent)
if (!staticData.lastDailySummary) staticData.lastDailySummary = '';

// ─── Telegram helpers ───
async function sendTelegram(text) {
  try {
    const res = await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT, text: text }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result ? json.result.message_id : null;
  } catch (e) { console.log('[hookgen] Telegram send error: ' + e.message); return null; }
}

async function sendTelegramVideo(videoBuffer, caption) {
  const boundary = '----HookGenBoundary' + Date.now();
  const parts = [];
  parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n' + ADMIN_CHAT);
  if (caption) {
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="caption"\r\n\r\n' + caption);
  }
  parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="video"; filename="hook_video.mp4"\r\nContent-Type: video/mp4\r\n\r\n');

  const prefix = Buffer.from(parts.join('\r\n'));
  const suffix = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([prefix, videoBuffer, suffix]);

  try {
    const res = await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendVideo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: body,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result ? json.result.message_id : null;
  } catch (e) {
    console.log('[hookgen] Telegram video send error: ' + e.message);
    return null;
  }
}

async function deleteTelegramMessage(messageId) {
  try {
    await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/deleteMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT, message_id: messageId }),
    });
  } catch (e) { console.log('[hookgen] Telegram delete error: ' + e.message); }
}

// ─── kie.ai helpers ───
async function kieGenerate(prompt, imageRefs) {
  const finalPrompt = prompt + ', maintain exact facial features from reference, shot on iPhone 13 Pro, no background blur, no bokeh, sharp background throughout, no color grading, raw UGC phone footage style';
  const res = await fetch(KIE_API_URL + '/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KIE_API_KEY },
    body: JSON.stringify({
      model: 'nano-banana-2',
      input: { prompt: finalPrompt, image_input: imageRefs, aspect_ratio: '9:16', resolution: '2K', output_format: 'png' },
    }),
  });
  if (!res.ok) throw new Error('kie.ai create: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  if (data.code !== 200) throw new Error('kie.ai: ' + JSON.stringify(data));
  return data.data.taskId;
}

async function kiePoll(taskId) {
  const POLL_INTERVAL = 5000;
  const TIMEOUT = 120000; // 2 min max for kie.ai
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    try {
      const res = await fetch(KIE_API_URL + '/recordInfo?taskId=' + taskId, {
        headers: { 'Authorization': 'Bearer ' + KIE_API_KEY },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const state = data.data && data.data.state;
      if (state === 'success') return JSON.parse(data.data.resultJson).resultUrls[0];
      if (state === 'fail') throw new Error(data.data.failMsg || 'kie.ai generation failed');
    } catch (err) {
      if (err.message.includes('failed') || err.message.includes('kie.ai')) throw err;
    }
  }
  throw new Error('kie.ai poll timeout after 120s');
}

// ─── FFmpeg burn timecode overlay (best-effort) ───
function burnTimecode(videoPath) {
  const outPath = videoPath.replace('.mp4', '_tc.mp4');
  try {
    execSync(
      'ffmpeg -y -i "' + videoPath + '"' +
      ' -vf "drawtext=text=\'%{pts\\:hms}\':fontsize=48:fontcolor=white:x=24:y=24' +
      ':box=1:boxcolor=black@0.6:boxborderw=8"' +
      ' -c:v libx264 -preset fast -crf 22 -c:a copy -movflags +faststart "' + outPath + '"',
      { timeout: 60000 }
    );
    return outPath;
  } catch (e) {
    console.log('[hookgen] burnTimecode failed (drawtext not available?): ' + e.message);
    return null; // caller will use raw video
  }
}

// ─── FFmpeg trim ───
function trimClip(videoPath, startSec, keepAudio) {
  const outPath = videoPath.replace('.mp4', '_trim_' + startSec + '.mp4');
  const audioFlag = keepAudio ? ' -c:a aac -b:a 128k' : ' -an';
  execSync(
    'ffmpeg -y -ss ' + startSec + ' -i "' + videoPath + '" -t ' + CLIP_DURATION +
    ' -c:v libx264 -preset fast -crf 22' + audioFlag + ' -movflags +faststart "' + outPath + '"',
    { timeout: 30000 }
  );
  return outPath;
}

// ─── Upload to catbox.moe ───
async function uploadCatbox(buffer, filename) {
  const boundary = '----CatboxBoundary' + Date.now();
  const parts = [];
  parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload');
  parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="fileToUpload"; filename="' + filename + '"\r\nContent-Type: video/mp4\r\n\r\n');
  const prefix = Buffer.from(parts.join('\r\n') + '\r\n');
  const suffix = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([prefix, buffer, suffix]);

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body: body,
  });
  if (!res.ok) throw new Error('catbox upload: ' + res.status);
  const url = await res.text();
  if (!url.startsWith('http')) throw new Error('catbox invalid response: ' + url.slice(0, 100));
  return url.trim();
}

// ─── Airtable helpers ───
async function airtableFetch(tablePath, options) {
  options = options || {};
  const res = await fetch('https://api.airtable.com/v0/' + ABASE + '/' + tablePath, {
    method: options.method || 'GET',
    headers: { 'Authorization': 'Bearer ' + ATOKEN, 'Content-Type': 'application/json' },
    body: options.body || undefined,
  });
  if (!res.ok) throw new Error('Airtable ' + tablePath + ': ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

async function queueCreate(fields) {
  return airtableFetch(QUEUE_TABLE, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: fields }] }),
  });
}

async function queueUpdate(recordId, fields) {
  return airtableFetch(QUEUE_TABLE, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: recordId, fields: fields }] }),
  });
}

async function poolCreate(fields) {
  return airtableFetch(HOOK_POOL_TABLE, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: fields }] }),
  });
}

// ─── Generic provider submit ───
async function providerSubmit(provider, prompt, imageUrl) {
  const body = provider.buildBody(prompt, imageUrl);
  const res = await fetch(provider.submitUrl, {
    method: 'POST',
    headers: {
      'Authorization': provider.authPrefix + provider.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error(provider.name + ' submit parse error: ' + text.slice(0, 200));
  }
  if (!provider.isSubmitOk(data)) {
    throw new Error(provider.name + ' submit failed: ' + (data.message || text).slice(0, 200));
  }
  return provider.parseSubmitTaskId(data);
}

// ─── Generic provider poll (single check, NOT blocking loop) ───
async function providerCheckStatus(provider, taskId) {
  const res = await fetch(provider.statusUrl + taskId, {
    headers: { 'Authorization': provider.authPrefix + provider.apiKey },
  });
  if (!res.ok) return { status: 'unknown', videoUrl: null, error: null };
  const data = await res.json();
  const status = provider.parseStatus(data);
  if (provider.isComplete(status)) {
    const videoUrl = provider.parseVideoUrl(data);
    if (!videoUrl) return { status: 'failed', videoUrl: null, error: 'No video URL in response' };
    return { status: 'completed', videoUrl: videoUrl, error: null };
  }
  if (provider.isFailed(status)) {
    return { status: 'failed', videoUrl: null, error: provider.name + ' task failed' };
  }
  return { status: 'generating', videoUrl: null, error: null };
}

// ─── Image prompt pools ───
const SPEAKING_IMAGE_PROMPTS = [
  'Close-up selfie shot of the same girl from reference, sitting on bed, looking directly at camera, neutral expression, holding phone, natural indoor lighting',
  'Close-up selfie angle of the same girl from reference, seated at desk, direct eye contact, subtle expression, casual home setting',
  'Close-up straight-on shot of the same girl from reference, relaxed on couch, phone in hand, looking into camera, soft ambient light',
  'Close-up selfie of the same girl from reference, leaning against headboard, calm expression, eye contact with camera, bedroom setting',
  'Medium close-up selfie of the same girl from reference, sitting cross-legged on bed, phone visible, natural look, warm lighting',
];

const REACTION_IMAGE_PROMPTS = [
  'Side angle shot of the same girl from reference, sitting on bed reading phone, candid moment, natural indoor lighting',
  'Over-the-shoulder shot of the same girl from reference, looking down at phone screen, bedroom setting, soft light',
  'Medium shot from 45 degrees of the same girl from reference, seated on couch with phone, candid expression, living room',
  'Side profile of the same girl from reference, sitting at desk scrolling phone, ambient room lighting, natural pose',
];

const REACTION_MOTION_PROMPTS = [
  'Girl reading something on her phone, her facial expressions change subtly, she shifts position slightly, natural candid shot from the side, continuous uncut movement',
  'Girl looking at phone screen, expression shifts from neutral to reacting, subtle body language changes, side angle, soft lighting, natural movement',
  'Girl scrolling phone, her eyes widen slightly, jaw tightens, subtle emotional shift, candid side angle, continuous shot, no speech',
  'Girl holding phone still, reading intently, micro-expressions of surprise then concern, natural side angle, soft indoor light',
];

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildSpeakingPrompt(hookTexts) {
  const textLines = hookTexts.map(function(t) { return '[' + t + ']'; }).join('\n');
  return 'A young woman saying:\n' + textLines +
    '\nto the camera with subtle facial expressions, ' +
    'slight natural handheld sway, no text, no watermark, no subtitles';
}


// ═══════════════════════════════════════════════════════
// MAIN STATE MACHINE — runs once per 2-minute tick
// ═══════════════════════════════════════════════════════

console.log('[hookgen] Tick started');

if (!ATOKEN) {
  console.log('[hookgen] No AIRTABLE_API_KEY — exiting');
  return [{ json: { skipped: true, reason: 'no_api_key' } }];
}

const enabledProviders = PROVIDERS.filter(function(p) { return p.enabled; });
if (enabledProviders.length === 0) {
  console.log('[hookgen] No enabled providers — exiting');
  return [{ json: { skipped: true, reason: 'no_providers' } }];
}

const tickResult = {
  phase0: null, phase1: null, phase2: null, phase3: null, phase4: null,
};

try {

// ═══════════════════════════════════════
// PHASE 0 — QUOTA CHECK
// ═══════════════════════════════════════

console.log('[hookgen] Phase 0: Quota check');

// Count ready hooks in pool
let readyCount = 0;
try {
  const formula = encodeURIComponent("{status}='ready'");
  const data = await airtableFetch(HOOK_POOL_TABLE + '?filterByFormula=' + formula + '&pageSize=100');
  readyCount = (data.records || []).length;
  // Handle pagination if more than 100
  if (data.offset) {
    let nextOffset = data.offset;
    while (nextOffset) {
      const more = await airtableFetch(HOOK_POOL_TABLE + '?filterByFormula=' + formula + '&pageSize=100&offset=' + nextOffset);
      readyCount += (more.records || []).length;
      nextOffset = more.offset || null;
    }
  }
} catch (e) {
  console.log('[hookgen] Pool count error: ' + e.message);
}

// Count active queue entries (not yet done or failed)
let pendingRecords = [];
try {
  const formula = encodeURIComponent("AND({status}!='clips_saved',{status}!='failed')");
  const data = await airtableFetch(QUEUE_TABLE + '?filterByFormula=' + formula);
  pendingRecords = data.records || [];
} catch (e) {
  console.log('[hookgen] Queue count error: ' + e.message);
}

const pendingCount = pendingRecords.length;
const submittedOrGenerating = pendingRecords.filter(function(r) {
  return r.fields.status === 'submitted' || r.fields.status === 'generating';
});
const activeSubmissions = submittedOrGenerating.length;
const availableSlots = MAX_CONCURRENT - activeSubmissions;

console.log('[hookgen] Pool ready: ' + readyCount + '/' + TARGET_HOOKS + ', pending: ' + pendingCount + ', active subs: ' + activeSubmissions);

tickResult.phase0 = { readyCount: readyCount, pendingCount: pendingCount, activeSubmissions: activeSubmissions };

// Quota notification (avoid spamming — only notify on state change)
const quotaState = readyCount >= TARGET_HOOKS ? 'full' : 'low';
if (quotaState === 'full' && staticData.lastQuotaNotification !== 'full') {
  await sendTelegram('Pool: ' + readyCount + '/' + TARGET_HOOKS + ' hooks ready. Pausing generation.');
  staticData.lastQuotaNotification = 'full';
} else if (quotaState === 'low' && staticData.lastQuotaNotification === 'full') {
  await sendTelegram('Pool: ' + readyCount + '/' + TARGET_HOOKS + ' — resuming generation');
  staticData.lastQuotaNotification = 'low';
}

// If quota met AND no pending work → exit early
if (readyCount >= TARGET_HOOKS && pendingCount === 0) {
  console.log('[hookgen] Quota met and no pending work — exiting');
  return [{ json: { skipped: true, reason: 'quota_met', readyCount: readyCount } }];
}


// ═══════════════════════════════════════
// PHASE 1 — POLL PENDING SUBMISSIONS
// ═══════════════════════════════════════

console.log('[hookgen] Phase 1: Polling ' + submittedOrGenerating.length + ' pending submissions');

let polledCount = 0;
let newlyCompleted = 0;
let newlyFailed = 0;

for (const record of submittedOrGenerating) {
  const f = record.fields;
  const providerName = f.provider || '';
  const taskId = f.task_id || '';
  if (!taskId) continue;

  const provider = PROVIDERS.find(function(p) { return p.name === providerName; });
  if (!provider) {
    await queueUpdate(record.id, { status: 'failed', error_message: 'Unknown provider: ' + providerName });
    newlyFailed++;
    continue;
  }

  // Check timeout
  const submittedAt = f.submitted_at ? new Date(f.submitted_at).getTime() : 0;
  if (submittedAt > 0 && (Date.now() - submittedAt) > GENERATION_TIMEOUT_MS) {
    await queueUpdate(record.id, { status: 'failed', error_message: 'Timeout after 20 min' });
    newlyFailed++;
    console.log('[hookgen] Task ' + taskId + ' timed out');
    continue;
  }

  try {
    const result = providerCheckStatus(provider, taskId);
    const statusResult = await result;

    if (statusResult.status === 'completed') {
      await queueUpdate(record.id, {
        status: 'completed',
        video_url: statusResult.videoUrl,
        completed_at: new Date().toISOString(),
      });
      newlyCompleted++;
      console.log('[hookgen] Task ' + taskId + ' completed: ' + statusResult.videoUrl);
    } else if (statusResult.status === 'failed') {
      await queueUpdate(record.id, {
        status: 'failed',
        error_message: statusResult.error || 'Provider reported failure',
      });
      newlyFailed++;
      console.log('[hookgen] Task ' + taskId + ' failed: ' + statusResult.error);
    } else if (statusResult.status === 'generating' && f.status === 'submitted') {
      await queueUpdate(record.id, { status: 'generating' });
    }
    // else: still generating, no update needed
  } catch (e) {
    console.log('[hookgen] Poll error for ' + taskId + ': ' + e.message);
    // Don't mark as failed on transient errors — just skip
  }
  polledCount++;
}

tickResult.phase1 = { polled: polledCount, completed: newlyCompleted, failed: newlyFailed };


// ═══════════════════════════════════════
// PHASE 2 — DELIVER COMPLETED VIDEOS (one at a time)
// ═══════════════════════════════════════

console.log('[hookgen] Phase 2: Deliver completed videos');

let delivered = 0;

try {
  // Check if there's already a video being reviewed — only 1 at a time
  const reviewFormula = encodeURIComponent("OR({status}='review_sent',{status}='clips_preview_sent')");
  const reviewData = await airtableFetch(
    QUEUE_TABLE + '?filterByFormula=' + reviewFormula + '&fields%5B%5D=status&maxRecords=1'
  );
  const hasActiveReview = (reviewData.records || []).length > 0;

  if (hasActiveReview) {
    console.log('[hookgen] Phase 2: Already a video in review — waiting');
  } else {
    // Find next completed video
    const formula = encodeURIComponent("{status}='completed'");
    const data = await airtableFetch(
      QUEUE_TABLE + '?filterByFormula=' + formula +
      '&sort%5B0%5D%5Bfield%5D=submitted_at&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=1'
    );
    const completedRecords = data.records || [];

    if (completedRecords.length > 0) {
      const record = completedRecords[0];
      const f = record.fields;
      const videoUrl = f.video_url;
      const conceptName = f.concept_name || f.concept_id || 'unknown';
      const hookMode = f.hook_mode || 'unknown';
      let hookTexts = [];
      try { hookTexts = JSON.parse(f.hook_texts_json || '[]'); } catch (e) {}

      try {
        // Daily summary — send once per day on first delivery after midnight
        const today = new Date().toISOString().slice(0, 10);
        if (staticData.lastDailySummary !== today) {
          // Count all completed videos (waiting for review)
          const allCompFormula = encodeURIComponent("{status}='completed'");
          const allCompData = await airtableFetch(
            QUEUE_TABLE + '?filterByFormula=' + allCompFormula + '&fields%5B%5D=status'
          );
          const totalReady = (allCompData.records || []).length;

          if (totalReady > 0) {
            await sendTelegram('Good morning! ' + totalReady + ' new Sora 2 video' + (totalReady > 1 ? 's' : '') + ' generated overnight. Let\'s review!');
          }
          staticData.lastDailySummary = today;
        }

        // Download video
        const vidRes = await fetch(videoUrl);
        if (!vidRes.ok) throw new Error('Download failed: ' + vidRes.status);
        const videoBuffer = Buffer.from(await vidRes.arrayBuffer());

        // Try timecode overlay, fall back to raw video
        let sendBuffer = videoBuffer;
        try {
          const rawPath = '/tmp/hookgen_preview_' + Date.now() + '.mp4';
          fs.writeFileSync(rawPath, videoBuffer);
          const tcPath = burnTimecode(rawPath);
          if (tcPath && fs.existsSync(tcPath) && fs.statSync(tcPath).size > 1000) {
            sendBuffer = fs.readFileSync(tcPath);
            try { fs.unlinkSync(tcPath); } catch (e) {}
          }
          try { fs.unlinkSync(rawPath); } catch (e) {}
        } catch (e) {
          console.log('[hookgen] Timecode overlay skipped: ' + e.message);
        }

        // Send video to Telegram
        const modeLabel = hookMode === 'speaking' ? 'Speaking' : 'Reaction';
        const videoMsgId = await sendTelegramVideo(sendBuffer, conceptName + ' (' + modeLabel + ')');

        // Only proceed if video was actually sent
        if (!videoMsgId) {
          throw new Error('Telegram video send failed — will retry next tick');
        }

        // Send hook texts
        let textList = hookTexts.map(function(t, i) { return (i + 1) + ': "' + t + '"'; }).join('\n');
        const n = hookTexts.length;
        const tsExample = n === 1 ? '"4.2"' : n === 2 ? '"0.5 4.2"' : '"0.5 4.2 9.8"';
        const textMsgId = await sendTelegram(
          modeLabel + ' hook' + (n > 1 ? 's' : '') + ':\n' + textList +
          '\n\nReply with ' + n + ' start time' + (n > 1 ? 's' : '') + ' in seconds (e.g. ' + tsExample + ') or "skip"'
        );

        // Save message IDs for cleanup after review
        const msgIds = [videoMsgId, textMsgId].filter(Boolean);
        await queueUpdate(record.id, { status: 'review_sent', telegram_msg_id: JSON.stringify(msgIds) });
        delivered++;
        console.log('[hookgen] Delivered video for review: ' + conceptName + ' (' + hookMode + ')');
      } catch (e) {
        console.log('[hookgen] Deliver error: ' + e.message);
        await queueUpdate(record.id, { status: 'failed', error_message: 'Deliver error: ' + e.message });
      }
    }
  }
} catch (e) {
  console.log('[hookgen] Phase 2 query error: ' + e.message);
}

tickResult.phase2 = { delivered: delivered };


// ═══════════════════════════════════════
// PHASE 3 — PROCESS TELEGRAM REVIEWS
// ═══════════════════════════════════════

console.log('[hookgen] Phase 3: Processing Telegram reviews');

let reviewsProcessed = 0;

try {
  // Non-blocking getUpdates with short timeout
  const res = await fetch(
    'https://api.telegram.org/bot' + PREP01_BOT + '/getUpdates?offset=' + staticData.hookGenOffset + '&timeout=5'
  );
  const updateData = await res.json();
  const updates = updateData.result || [];

  for (const update of updates) {
    staticData.hookGenOffset = update.update_id + 1; // always advance offset

    // Only process text messages from admin
    if (!update.message || !update.message.text || update.message.chat.id.toString() !== ADMIN_CHAT) continue;

    const userText = update.message.text.trim();

    // Find the oldest record waiting for review
    let reviewRecord = null;
    try {
      const formula = encodeURIComponent("OR({status}='review_sent',{status}='clips_preview_sent')");
      const qData = await airtableFetch(
        QUEUE_TABLE + '?filterByFormula=' + formula +
        '&sort%5B0%5D%5Bfield%5D=submitted_at&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=1'
      );
      if (qData.records && qData.records.length > 0) reviewRecord = qData.records[0];
    } catch (e) {
      console.log('[hookgen] Review query error: ' + e.message);
      continue;
    }

    if (!reviewRecord) {
      // No pending review — ignore message
      continue;
    }

    const rf = reviewRecord.fields;
    const reviewStatus = rf.status;

    // ─── WAITING FOR TIMESTAMPS ───
    if (reviewStatus === 'review_sent') {
      if (userText.toLowerCase() === 'skip') {
        await queueUpdate(reviewRecord.id, { status: 'failed', error_message: 'Skipped by user' });
        // Delete video + text messages
        let skipMsgIds = [];
        try { skipMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
        for (const mid of skipMsgIds) { await deleteTelegramMessage(mid); }

        let skipRemaining = 0;
        try {
          const remFormula = encodeURIComponent("OR({status}='review_sent',{status}='clips_preview_sent')");
          const remData = await airtableFetch(QUEUE_TABLE + '?filterByFormula=' + remFormula + '&fields%5B%5D=status');
          skipRemaining = (remData.records || []).length;
        } catch (e) {}
        const skipMsg = skipRemaining > 0
          ? 'Skipped. Next video ready (' + skipRemaining + ' left)'
          : 'Skipped. No more videos to review.';
        await sendTelegram(skipMsg);
        reviewsProcessed++;
        continue;
      }

      // Parse timestamps
      const timestamps = userText.split(/[\s,]+/).map(function(t) { return parseFloat(t); }).filter(function(t) { return !isNaN(t); });
      let hookTexts = [];
      try { hookTexts = JSON.parse(rf.hook_texts_json || '[]'); } catch (e) {}
      let scenarioIds = [];
      try { scenarioIds = JSON.parse(rf.scenario_ids_json || '[]'); } catch (e) {}

      if (timestamps.length !== hookTexts.length) {
        await sendTelegram('Expected ' + hookTexts.length + ' timestamps, got ' + timestamps.length + '. Try again or "skip".');
        continue;
      }

      const validTs = timestamps.every(function(t) { return t >= 0 && t <= 12; });
      if (!validTs) {
        await sendTelegram('Timestamps must be 0-12 (each clip = 3s from start). Decimals OK (e.g. 0.5). Try again or "skip".');
        continue;
      }

      // Download video and trim clips
      const videoUrl = rf.video_url;
      const hookMode = rf.hook_mode || 'speaking';
      const isSpeaking = hookMode === 'speaking';

      try {
        const vidRes = await fetch(videoUrl);
        if (!vidRes.ok) throw new Error('Video download failed: ' + vidRes.status);
        const videoBuffer = Buffer.from(await vidRes.arrayBuffer());
        const rawPath = '/tmp/hookgen_raw_' + Date.now() + '.mp4';
        fs.writeFileSync(rawPath, videoBuffer);

        // Collect all message IDs (video + text from Phase 2 + clips + prompt)
        let allMsgIds = [];
        try { allMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}

        for (let ci = 0; ci < timestamps.length; ci++) {
          const ts = timestamps[ci];
          const ht = hookTexts[ci] || '';
          try {
            const trimPath = trimClip(rawPath, ts, isSpeaking);
            const clipBuffer = fs.readFileSync(trimPath);
            const audioLabel = isSpeaking ? '' : ' (silent)';
            const clipMsgId = await sendTelegramVideo(clipBuffer, 'Clip ' + (ci + 1) + '/' + timestamps.length + audioLabel + ': "' + ht.slice(0, 50) + '"');
            if (clipMsgId) allMsgIds.push(clipMsgId);
            try { fs.unlinkSync(trimPath); } catch (e) {}
          } catch (e) {
            await sendTelegram('Clip ' + (ci + 1) + ' trim failed: ' + e.message);
          }
        }

        try { fs.unlinkSync(rawPath); } catch (e) {}

        const promptMsgId = await sendTelegram('Reply "all" or "1 3" to approve, or "skip"');
        if (promptMsgId) allMsgIds.push(promptMsgId);

        await queueUpdate(reviewRecord.id, {
          status: 'clips_preview_sent',
          timestamps_json: JSON.stringify(timestamps),
          telegram_msg_id: JSON.stringify(allMsgIds),
        });
        reviewsProcessed++;

      } catch (e) {
        console.log('[hookgen] Trim error: ' + e.message);
        await queueUpdate(reviewRecord.id, { status: 'failed', error_message: 'Trim error: ' + e.message });
        await sendTelegram('Video processing failed: ' + e.message);
      }

      continue;
    }

    // ─── WAITING FOR APPROVAL ───
    if (reviewStatus === 'clips_preview_sent') {
      if (userText.toLowerCase() === 'skip') {
        await queueUpdate(reviewRecord.id, { status: 'failed', error_message: 'Skipped at approval' });
        // Delete all messages for this video
        let skipMsgIds = [];
        try { skipMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
        for (const mid of skipMsgIds) { await deleteTelegramMessage(mid); }

        // Count remaining
        let skipRemaining = 0;
        try {
          const remFormula = encodeURIComponent("OR({status}='review_sent',{status}='clips_preview_sent')");
          const remData = await airtableFetch(QUEUE_TABLE + '?filterByFormula=' + remFormula + '&fields%5B%5D=status');
          skipRemaining = (remData.records || []).length;
        } catch (e) {}
        const skipMsg = skipRemaining > 0
          ? 'Skipped. Next video ready (' + skipRemaining + ' left)'
          : 'Skipped. No more videos to review.';
        await sendTelegram(skipMsg);
        reviewsProcessed++;
        continue;
      }

      let timestamps = [];
      try { timestamps = JSON.parse(rf.timestamps_json || '[]'); } catch (e) {}
      let hookTexts = [];
      try { hookTexts = JSON.parse(rf.hook_texts_json || '[]'); } catch (e) {}
      let scenarioIds = [];
      try { scenarioIds = JSON.parse(rf.scenario_ids_json || '[]'); } catch (e) {}

      // Parse approval
      let approvedIndices;
      if (userText.toLowerCase() === 'all') {
        approvedIndices = hookTexts.map(function(_, i) { return i; });
      } else {
        approvedIndices = userText.split(/[\s,]+/)
          .map(function(n) { return parseInt(n) - 1; }) // user uses 1-based
          .filter(function(n) { return n >= 0 && n < hookTexts.length; });
      }

      if (approvedIndices.length === 0) {
        await sendTelegram('No valid clips selected. Reply "all", "1 3", or "skip".');
        continue;
      }

      // Download video again for trimming
      const videoUrl = rf.video_url;
      const hookMode = rf.hook_mode || 'speaking';
      const isSpeaking = hookMode === 'speaking';
      const conceptId = rf.concept_id || '';
      const conceptName = rf.concept_name || '';
      const girlRefUrl = rf.girl_ref_url || '';
      const sourceImageUrl = rf.source_image_url || '';
      const motionPrompt = rf.motion_prompt || '';

      let clipsSaved = 0;

      try {
        const vidRes = await fetch(videoUrl);
        if (!vidRes.ok) throw new Error('Video re-download failed: ' + vidRes.status);
        const videoBuffer = Buffer.from(await vidRes.arrayBuffer());
        const rawPath = '/tmp/hookgen_approve_' + Date.now() + '.mp4';
        fs.writeFileSync(rawPath, videoBuffer);

        const batchId = 'gen_' + new Date().toISOString().slice(0, 10) + '_' + reviewRecord.id.slice(-5);

        for (const idx of approvedIndices) {
          const ts = timestamps[idx];
          const ht = hookTexts[idx] || '';
          const scenarioId = scenarioIds[idx] || '';

          try {
            const trimPath = trimClip(rawPath, ts, isSpeaking);
            const clipBuffer = fs.readFileSync(trimPath);
            const clipUrl = await uploadCatbox(clipBuffer, 'hook_' + batchId + '_' + idx + '.mp4');

            await poolCreate({
              batch_id: batchId,
              concept_id: conceptId,
              concept_name: conceptName,
              hook_type: hookMode,
              girl_ref_url: girlRefUrl,
              source_image_url: sourceImageUrl,
              source_video_url: videoUrl,
              video_file: [{ url: clipUrl }],
              clip_start_sec: ts,
              clip_duration_sec: CLIP_DURATION,
              hook_text: ht,
              scenario_id: scenarioId,
              status: 'ready',
              created_at: new Date().toISOString(),
            });

            clipsSaved++;
            console.log('[hookgen] Saved clip: scenario ' + scenarioId + ' at ' + ts + 's');
            try { fs.unlinkSync(trimPath); } catch (e) {}
          } catch (e) {
            console.log('[hookgen] Save error clip ' + idx + ': ' + e.message);
            await sendTelegram('Clip ' + (idx + 1) + ' save failed: ' + e.message);
          }
        }

        try { fs.unlinkSync(rawPath); } catch (e) {}

        // Update ready count for notification
        const newReadyCount = readyCount + clipsSaved;

        await queueUpdate(reviewRecord.id, {
          status: 'clips_saved',
          reviewed_at: new Date().toISOString(),
        });

        // Delete ALL messages for this video (video, text, clips, prompt)
        let allMsgIds = [];
        try { allMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
        for (const mid of allMsgIds) {
          await deleteTelegramMessage(mid);
        }

        // Count remaining videos in queue
        let remainingCount = 0;
        try {
          const remFormula = encodeURIComponent("OR({status}='review_sent',{status}='clips_preview_sent')");
          const remData = await airtableFetch(QUEUE_TABLE + '?filterByFormula=' + remFormula + '&fields%5B%5D=status');
          remainingCount = (remData.records || []).length;
        } catch (e) {}

        let confirmMsg = clipsSaved + ' clip' + (clipsSaved > 1 ? 's' : '') + ' saved (pool: ~' + newReadyCount + '/' + TARGET_HOOKS + ')';
        if (remainingCount > 0) {
          confirmMsg += '\n\nNext video is ready — reply to continue (' + remainingCount + ' left)';
        } else {
          confirmMsg += '\n\nAll done! No more videos to review.';
        }
        await sendTelegram(confirmMsg);
        reviewsProcessed++;

      } catch (e) {
        console.log('[hookgen] Approval processing error: ' + e.message);
        await sendTelegram('Error saving clips: ' + e.message);
      }

      continue;
    }
  }
} catch (e) {
  console.log('[hookgen] Phase 3 error: ' + e.message);
}

tickResult.phase3 = { reviewsProcessed: reviewsProcessed };


// ═══════════════════════════════════════
// PHASE 4 — SUBMIT NEW GENERATION
// ═══════════════════════════════════════

console.log('[hookgen] Phase 4: Submit new generation');

let submitted = 0;

// Skip if no slots or quota met
if (availableSlots <= 0) {
  console.log('[hookgen] No available slots (' + activeSubmissions + '/' + MAX_CONCURRENT + ')');
} else if (readyCount + pendingCount >= TARGET_HOOKS) {
  console.log('[hookgen] Quota covered (ready + pending >= target)');
} else {

  try {
    // Step 1: Get active concepts with batch hooks enabled
    let concepts = [];
    const conceptFormula = encodeURIComponent("AND({is_active}=TRUE(),{girl_ref_url}!='',OR({hook_speaking_enabled}=TRUE(),{hook_reaction_enabled}=TRUE()))");
    const conceptData = await airtableFetch(CONCEPTS_TABLE + '?filterByFormula=' + conceptFormula);
    concepts = (conceptData.records || []).map(function(r) {
      return {
        id: r.id,
        conceptId: r.fields.concept_id || '',
        conceptName: r.fields.concept_name || r.fields.concept_id || '',
        hookSpeakingEnabled: !!r.fields.hook_speaking_enabled,
        hookReactionEnabled: !!r.fields.hook_reaction_enabled,
        girlRefUrl: r.fields.girl_ref_url || '',
      };
    });

    if (concepts.length === 0) {
      console.log('[hookgen] No active concepts with hooks enabled');
    } else {

      // Step 2: Get approved scenarios
      let allScenarios = [];
      const scenFormula = encodeURIComponent("OR({status}='approved',{status}='clips_needed',{status}='ready')");
      let offset = null;
      do {
        const url = SCENARIOS_TABLE + '?filterByFormula=' + scenFormula + '&pageSize=100' + (offset ? '&offset=' + offset : '');
        const sData = await airtableFetch(url);
        allScenarios = allScenarios.concat(sData.records || []);
        offset = sData.offset || null;
      } while (offset);

      // Parse scenarios
      const scenarios = allScenarios.map(function(r) {
        const f = r.fields;
        let copyJson = null;
        try { copyJson = typeof f.generated_copy_json === 'string' ? JSON.parse(f.generated_copy_json) : f.generated_copy_json; } catch (e) {}
        const hookText = (copyJson && copyJson.hookVO) || f.generated_hook_text || '';
        const conceptRecordId = Array.isArray(f.concept_id) ? f.concept_id[0] : '';
        return {
          recordId: r.id,
          scenarioName: f.scenario_name || '',
          hookText: hookText,
          conceptRecordId: conceptRecordId,
        };
      }).filter(function(s) { return s.hookText && s.conceptRecordId; });

      // Build concept map
      const conceptMap = {};
      for (const c of concepts) conceptMap[c.id] = c;

      // Filter: only scenarios from active concepts
      const validScenarios = scenarios.filter(function(s) { return conceptMap[s.conceptRecordId]; });

      // Step 3: Exclude scenarios that already have a pool clip OR a pending queue entry
      const scenariosNeedingClips = [];

      // Get all pending queue scenario IDs (to exclude)
      const pendingScenarioIds = new Set();
      for (const pr of pendingRecords) {
        try {
          const ids = JSON.parse(pr.fields.scenario_ids_json || '[]');
          ids.forEach(function(id) { pendingScenarioIds.add(id); });
        } catch (e) {}
      }

      for (const s of validScenarios) {
        // Skip if already in queue
        if (pendingScenarioIds.has(s.recordId)) continue;

        // Check pool for existing clip
        try {
          const pFormula = encodeURIComponent("AND({status}='ready',{scenario_id}='" + s.recordId + "')");
          const pData = await airtableFetch(HOOK_POOL_TABLE + '?filterByFormula=' + pFormula + '&maxRecords=1');
          if (pData.records && pData.records.length > 0) continue; // already has clip
        } catch (e) {
          // On error, include it (better to try than skip)
        }
        scenariosNeedingClips.push(s);
      }

      if (scenariosNeedingClips.length === 0) {
        console.log('[hookgen] All scenarios have clips or are pending');
      } else {

        // Step 4: Group by concept + hookMode
        const groups = []; // { concept, scenarios, hookMode }

        const byConceptId = {};
        for (const s of scenariosNeedingClips) {
          const c = conceptMap[s.conceptRecordId];
          const key = c.conceptId;
          if (!byConceptId[key]) byConceptId[key] = { concept: c, scenarios: [] };
          byConceptId[key].scenarios.push(s);
        }

        for (const groupKey of Object.keys(byConceptId)) {
          const group = byConceptId[groupKey];
          const concept = group.concept;
          const modes = [];
          if (concept.hookSpeakingEnabled) modes.push('speaking');
          if (concept.hookReactionEnabled) modes.push('reaction');

          for (const mode of modes) {
            // Take up to 3 scenarios per group
            groups.push({
              concept: concept,
              scenarios: group.scenarios.slice(0, 3),
              hookMode: mode,
            });
          }
        }

        if (groups.length > 0) {
          // Pick next group (round-robin)
          const groupIndex = (staticData.lastProviderIndex || 0) % groups.length;
          const group = groups[groupIndex];
          staticData.lastProviderIndex = groupIndex + 1;

          const concept = group.concept;
          const hookMode = group.hookMode;
          const isSpeaking = hookMode === 'speaking';
          const groupScenarios = group.scenarios;

          // Pick provider (round-robin across enabled)
          const providerIndex = (staticData.lastProviderIndex || 0) % enabledProviders.length;
          const provider = enabledProviders[providerIndex];

          console.log('[hookgen] Submitting: ' + concept.conceptId + ' (' + hookMode + ') via ' + provider.name + ', ' + groupScenarios.length + ' scenarios');

          try {
            // kie.ai image generation
            const imagePrompt = isSpeaking ? pickRandom(SPEAKING_IMAGE_PROMPTS) : pickRandom(REACTION_IMAGE_PROMPTS);
            const kieTaskId = await kieGenerate(imagePrompt, [concept.girlRefUrl]);
            const kieImageUrl = await kiePoll(kieTaskId);

            // Build Sora 2 prompt
            let sora2Prompt;
            if (isSpeaking) {
              const hookTexts = groupScenarios.map(function(s) { return s.hookText; });
              sora2Prompt = buildSpeakingPrompt(hookTexts);
            } else {
              sora2Prompt = pickRandom(REACTION_MOTION_PROMPTS);
            }

            // Submit to provider
            const taskId = await providerSubmit(provider, sora2Prompt, kieImageUrl);

            // Save to queue
            await queueCreate({
              task_id: taskId,
              provider: provider.name,
              concept_id: concept.conceptId,
              concept_name: concept.conceptName,
              hook_mode: hookMode,
              scenario_ids_json: JSON.stringify(groupScenarios.map(function(s) { return s.recordId; })),
              hook_texts_json: JSON.stringify(groupScenarios.map(function(s) { return s.hookText; })),
              source_image_url: kieImageUrl,
              girl_ref_url: concept.girlRefUrl,
              motion_prompt: sora2Prompt,
              status: 'submitted',
              submitted_at: new Date().toISOString(),
            });

            submitted++;
            console.log('[hookgen] Submitted task ' + taskId + ' to ' + provider.name);

          } catch (e) {
            console.log('[hookgen] Submit error: ' + e.message);
            // Don't notify on every failure — just log
          }
        }
      }
    }
  } catch (e) {
    console.log('[hookgen] Phase 4 error: ' + e.message);
  }
}

tickResult.phase4 = { submitted: submitted };


} catch (e) {
  console.log('[hookgen] Fatal error: ' + e.message);
  try { await sendTelegram('Hook generator error: ' + e.message); } catch (te) {}
}

console.log('[hookgen] Tick complete: ' + JSON.stringify(tickResult));

return [{ json: tickResult }];
