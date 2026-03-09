// NODE: Image to Video (kie.ai primary + PoYo secondary â€” escalating dual-provider)
// Converts an approved hook/outro image into an animated video clip.
// Three paths:
//   1. outro + speaking â†’ Kling Avatar V2 via fal.ai (native lipsync, no FFmpeg overlay)
//   2. hook + speaking â†’ escalatingGenerate (kie.ai primary, PoYo after 3 min)
//   3. reaction â†’ escalatingGenerate motion (kie.ai primary, PoYo after 3 min)
// Self-healing: on failure, returns the original image as fallback (FFmpeg will loop).
// Mode: Run Once for All Items
//
// WIRING: After hook/outro image approved â†’ this Code node â†’ Send Video Preview (Telegram)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// â”€â”€â”€ fetch polyfill (n8n Code node sandbox lacks global fetch) â”€â”€â”€
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
      // Follow redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); // drain response
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
          statusCode: res.statusCode,
          headers: res.headers,
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

// â”€â”€â”€ Multipart video upload helper for Telegram sendVideo â”€â”€â”€
function sendTelegramVideo(botToken, chatId, videoBuffer, filename, caption, replyMarkup) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now() + Math.random().toString(36).slice(2);
    const parts = [];
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n' + chatId + '\r\n');
    if (caption) {
      parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="caption"\r\n\r\n' + caption + '\r\n');
    }
    if (replyMarkup) {
      parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="reply_markup"\r\n\r\n' + JSON.stringify(replyMarkup) + '\r\n');
    }
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="video"; filename="' + filename + '"\r\nContent-Type: video/mp4\r\n\r\n');
    const bodyBuf = Buffer.concat([
      Buffer.from(parts.join('')),
      videoBuffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const req = _https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + botToken + '/sendVideo',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': bodyBuf.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(body)); } catch(e) { resolve({ ok: false, description: body }); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

// â”€â”€â”€ Temp image upload (0x0.st â€” no API key, widely accessible by AI APIs) â”€â”€â”€
function uploadToTempHost(buffer, filename, mimeType = 'image/png') {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const bodyBuf = Buffer.concat([
      Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
        'Content-Type: ' + mimeType + '\r\n\r\n'
      ),
      buffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const req = _https.request({
      hostname: '0x0.st',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': bodyBuf.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const url = Buffer.concat(chunks).toString().trim();
        if (url.startsWith('https://')) resolve(url);
        else reject(new Error('0x0.st upload failed: ' + url));
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

// â”€â”€â”€ fal.ai shared polling helper â”€â”€â”€
async function falSubmitAndPoll(falKey, endpoint, payload, timeoutMs = 600000) {
  const FAL_BASE = 'https://queue.fal.run';

  // Submit
  const submitRes = await fetch(FAL_BASE + '/' + endpoint, {
    method: 'POST',
    headers: { 'Authorization': 'Key ' + falKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!submitRes.ok) throw new Error('fal.ai submit: ' + submitRes.status + ' ' + (await submitRes.text()));
  const submitData = await submitRes.json();
  const requestId = submitData.request_id;
  if (!requestId) throw new Error('No request_id from fal.ai');

  // Use URLs from submit response (most reliable) or construct fallback
  const statusUrl = submitData.status_url || (FAL_BASE + '/' + endpoint + '/requests/' + requestId + '/status');
  const responseUrl = submitData.response_url || (FAL_BASE + '/' + endpoint + '/requests/' + requestId);
  console.log('[fal.ai] request_id: ' + requestId);
  console.log('[fal.ai] status_url: ' + statusUrl);
  console.log('[fal.ai] response_url: ' + responseUrl);

  // Poll until complete
  const pollStart = Date.now();
  let pollCount = 0;
  while (Date.now() - pollStart < timeoutMs) {
    await new Promise(r => setTimeout(r, 5000));
    pollCount++;
    try {
      const statusRes = await fetch(statusUrl, {
        headers: { 'Authorization': 'Key ' + falKey },
      });
      if (!statusRes.ok) {
        console.log('[fal.ai poll #' + pollCount + '] HTTP ' + statusRes.status);
        continue;
      }
      const statusData = await statusRes.json();
      const st = (statusData.status || '').toUpperCase();
      console.log('[fal.ai poll #' + pollCount + '] ' + st + (statusData.queue_position != null ? ' (pos ' + statusData.queue_position + ')' : ''));
      if (st === 'COMPLETED') {
        const resultRes = await fetch(responseUrl, {
          headers: { 'Authorization': 'Key ' + falKey },
        });
        if (!resultRes.ok) throw new Error('fal.ai result fetch: HTTP ' + resultRes.status);
        return await resultRes.json();
      }
      if (st === 'FAILED') throw new Error('fal.ai FAILED: ' + JSON.stringify(statusData));
    } catch (err) {
      console.log('[fal.ai poll #' + pollCount + '] error: ' + err.message);
      if (err.message.includes('FAILED')) throw err;
    }
  }
  throw new Error('fal.ai timeout (' + (timeoutMs / 60000) + ' min)');
}

// â”€â”€â”€ Config â”€â”€â”€
const DEFAULT_PROMPTS = {
  hook: 'locked off tripod shot, static camera, zero camera movement, girl eyes fixed on phone screen, shakes head slightly, concerned expression, subtle facial movement only, not typing on phone, no tears',
  outro: 'locked off tripod shot, static camera, zero camera movement, girl looking at camera, gentle expression change, subtle movement, not typing on phone, no tears',
};
// â”€â”€â”€ Escalating Dual-Provider: kie.ai (primary) + PoYo (secondary) â”€â”€â”€
// Submit to kie.ai first. If still generating after 3 min, also submit to PoYo.
// If kie.ai fails mid-generation, instantly escalate to PoYo.
// First provider to complete wins. Minimizes double-pay risk.
const KIE_KEY = '7670ade582cc72601f388dbdc0525b9e';
const POYO_KEY = (typeof $env !== 'undefined' && $env.POYO_API_KEY) || 'sk-vJqqGNNTcH9g89DnEYum48LHkdR0R6sZ-qQCFoiWzCJQlPmXKtbIdOWiRGnhB-';
const ESCALATE_AFTER_MS = 3 * 60 * 1000;    // 3 min before firing secondary
const PROVIDER_TIMEOUT_MS = 12 * 60 * 1000; // 12 min total timeout

// â”€â”€ kie.ai Sora 2 submit â”€â”€
async function kieVideoSubmit(imageUrl, prompt) {
  const body = {
    model: 'sora-2',
    input: {
      prompt: prompt,
      image_urls: imageUrl ? [imageUrl] : [],
      n_frames: 15,
      aspect_ratio: 'portrait',
      remove_watermark: true,
    },
  };
  const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + KIE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('[kie.ai submit] HTTP ' + res.status + ': ' + text.slice(0, 200));
  var data;
  try { data = JSON.parse(text); } catch(e) { throw new Error('[kie.ai submit] Invalid JSON: ' + text.slice(0, 200)); }
  if (data.code !== 200 || !data.data || !data.data.taskId) {
    throw new Error('[kie.ai submit] Rejected: ' + text.slice(0, 200));
  }
  return data.data.taskId;
}

// â”€â”€ kie.ai single poll (non-blocking) â”€â”€
async function kieVideoPollOnce(taskId) {
  try {
    const res = await fetch('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=' + taskId, {
      headers: { 'Authorization': 'Bearer ' + KIE_KEY },
    });
    if (!res.ok) return { status: 'generating' };
    const data = await res.json();
    const state = data.data && data.data.state;
    if (state === 'success') {
      try {
        var resultJson = JSON.parse(data.data.resultJson);
        var videoUrl = resultJson.resultUrls && resultJson.resultUrls[0];
        if (videoUrl) return { status: 'completed', videoUrl: videoUrl };
      } catch(e) {}
      return { status: 'failed', error: 'No video URL in kie.ai response' };
    }
    if (state === 'fail') {
      return { status: 'failed', error: (data.data && data.data.failMsg) || 'kie.ai video failed' };
    }
    return { status: 'generating' };
  } catch(e) {
    return { status: 'generating' }; // network blip â€” keep polling
  }
}

// â”€â”€ PoYo submit â”€â”€
async function poyoSubmit(imageUrl, prompt) {
  const input = { prompt: prompt, duration: 15, aspect_ratio: '9:16' };
  if (imageUrl) input.image_url = imageUrl;
  const body = { model: 'sora-2', input: input };
  const res = await fetch('https://api.poyo.ai/api/generate/submit', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + POYO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('[PoYo submit] HTTP ' + res.status + ': ' + text.slice(0, 200));
  var data;
  try { data = JSON.parse(text); } catch(e) { throw new Error('[PoYo submit] Invalid JSON: ' + text.slice(0, 200)); }
  if (data.code !== 200 || !data.data || !data.data.task_id) {
    throw new Error('[PoYo submit] Rejected: ' + text.slice(0, 200));
  }
  return data.data.task_id;
}

// â”€â”€ PoYo single poll (non-blocking) â”€â”€
async function poyoPollOnce(taskId) {
  try {
    const res = await fetch('https://api.poyo.ai/api/generate/status/' + taskId, {
      headers: { 'Authorization': 'Bearer ' + POYO_KEY },
    });
    if (!res.ok) return { status: 'generating' };
    const data = await res.json();
    const st = data.data && data.data.status;
    if (st === 'finished') {
      var videoUrl = data.data.files && data.data.files[0] && data.data.files[0].file_url;
      if (videoUrl) return { status: 'completed', videoUrl: videoUrl };
      return { status: 'failed', error: 'No video URL in PoYo response' };
    }
    if (st === 'failed') return { status: 'failed', error: 'PoYo task failed' };
    return { status: 'generating' };
  } catch(e) {
    return { status: 'generating' }; // network blip â€” keep polling
  }
}

// â”€â”€ Escalating orchestrator â”€â”€
// Primary (kie.ai) â†’ after 3 min or failure â†’ also Secondary (PoYo) â†’ first wins
async function escalatingGenerate(imageUrl, prompt) {
  const POLL_INTERVAL = 5000;
  const TBOT = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
  const _chatId = (() => { try { return $('Prepare Production').first().json.chatId || ''; } catch(e) { return ''; } })();

  function notifyTg(text) {
    if (!TBOT || !_chatId) return Promise.resolve();
    return fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: _chatId, text: text }),
    }).catch(function() {});
  }

  // Phase 1: Submit to kie.ai (primary)
  var kieTaskId = null;
  var kieError = null;
  try {
    console.log('[escalate] Submitting to kie.ai (primary)...');
    kieTaskId = await kieVideoSubmit(imageUrl, prompt);
    console.log('[escalate] kie.ai accepted, taskId: ' + kieTaskId);
  } catch(e) {
    kieError = e.message;
    console.log('[escalate] kie.ai submit failed: ' + kieError);
  }

  // If kie.ai refused, try PoYo immediately
  var poyoTaskId = null;
  if (!kieTaskId) {
    try {
      console.log('[escalate] kie.ai refused â€” trying PoYo immediately...');
      poyoTaskId = await poyoSubmit(imageUrl, prompt);
      console.log('[escalate] PoYo accepted, taskId: ' + poyoTaskId);
    } catch(e) {
      throw new Error('Both providers refused: kie.ai=' + kieError + ', PoYo=' + e.message);
    }
  }

  var poyoEscalated = !kieTaskId; // true if we already submitted to PoYo
  var pollCount = 0;
  var startTime = Date.now();

  // Main polling loop
  while (Date.now() - startTime < PROVIDER_TIMEOUT_MS) {
    await new Promise(function(r) { setTimeout(r, POLL_INTERVAL); });
    pollCount++;
    var elapsed = Date.now() - startTime;

    // Escalation trigger: if kie.ai still running after 3 min, fire PoYo
    if (kieTaskId && !poyoTaskId && !poyoEscalated && elapsed >= ESCALATE_AFTER_MS) {
      poyoEscalated = true;
      console.log('[escalate] 3 min elapsed â€” escalating to PoYo...');
      await notifyTg('Video generation still in progress â€” escalating to backup provider...');
      try {
        poyoTaskId = await poyoSubmit(imageUrl, prompt);
        console.log('[escalate] PoYo escalation accepted, taskId: ' + poyoTaskId);
      } catch(e) {
        console.log('[escalate] PoYo escalation failed: ' + e.message);
      }
    }

    // Poll kie.ai
    if (kieTaskId) {
      var kieResult = await kieVideoPollOnce(kieTaskId);
      if (kieResult.status === 'completed') {
        console.log('[escalate] kie.ai completed! URL: ' + kieResult.videoUrl);
        return kieResult.videoUrl;
      }
      if (kieResult.status === 'failed') {
        console.log('[escalate] kie.ai failed: ' + kieResult.error);
        kieTaskId = null;
        // Instantly escalate to PoYo on kie.ai failure
        if (!poyoTaskId && !poyoEscalated) {
          poyoEscalated = true;
          console.log('[escalate] kie.ai failed â€” escalating to PoYo now...');
          try {
            poyoTaskId = await poyoSubmit(imageUrl, prompt);
            console.log('[escalate] PoYo emergency accepted: ' + poyoTaskId);
          } catch(e2) {
            console.log('[escalate] PoYo emergency also failed: ' + e2.message);
          }
        }
      }
      if (pollCount % 6 === 0 && kieTaskId) {
        console.log('[escalate] kie.ai poll #' + pollCount + ': generating (' + Math.round(elapsed / 1000) + 's)');
      }
    }

    // Poll PoYo
    if (poyoTaskId) {
      var poyoResult = await poyoPollOnce(poyoTaskId);
      if (poyoResult.status === 'completed') {
        console.log('[escalate] PoYo completed! URL: ' + poyoResult.videoUrl);
        return poyoResult.videoUrl;
      }
      if (poyoResult.status === 'failed') {
        console.log('[escalate] PoYo failed: ' + poyoResult.error);
        poyoTaskId = null;
      }
      if (pollCount % 6 === 0 && poyoTaskId) {
        console.log('[escalate] PoYo poll #' + pollCount + ': generating');
      }
    }

    // Both failed
    if (!kieTaskId && !poyoTaskId) {
      throw new Error('Both providers failed mid-generation');
    }
  }

  throw new Error('escalatingGenerate timeout after ' + (PROVIDER_TIMEOUT_MS / 60000) + ' min');
}

// Strip ElevenLabs emotion tags from VO text for Sora 2 prompt
function stripVoTags(text) {
  if (!text) return '';
  return text.replace(/\[(gasps?|sighs?|laughs?|whispers?|sarcastic|frustrated|curious|excited)\]/gi, '').replace(/\s{2,}/g, ' ').trim();
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// Main logic
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?

const input = $input.first().json;
const inputBinary = $input.first().binary || {};

// Auto-detect asset type: if Generate Outro has already run, we're in the outro path
const assetType = (() => {
  if (input.assetType) return input.assetType;
  try {
    const od = $('Generate Outro').first().json;
    if ('outroReady' in od || 'outroSource' in od || 'outroSkipped' in od) return 'outro';
  } catch(e) {}
  return 'hook';
})();

// Get chatId/scenarioName from input or fallback to Prepare Production
const chatId = input.chatId || (() => { try { return $('Prepare Production').first().json.chatId; } catch(e) { return ''; } })();
const scenarioName = input.scenarioName || (() => { try { return $('Prepare Production').first().json.scenarioName; } catch(e) { return ''; } })();

// Detect source type from upstream Generate Hook/Outro node
const sourceType = (() => {
  if (assetType === 'hook') {
    try { return $('Generate Hook').first().json.hookSource || ''; } catch(e) { return ''; }
  } else {
    try { return $('Generate Outro').first().json.outroSource || ''; } catch(e) { return ''; }
  }
})();

// â”€â”€â”€ Pool passthrough: hook was already consumed from Hook Pool in Generate Hook â”€â”€â”€
// Both 'pool' (speaking, has audio) and 'pool_reaction' (silent) skip Sora 2
if (sourceType === 'pool' || sourceType === 'pool_reaction') {
  // hookVideo binary was already output by Generate Hook â€” this node is a no-op.
  // Download Assets will find hookVideo in Generate Hook's binary output.
  console.log('[Img2Vid] Pool hook (' + sourceType + ') â€” passthrough (no Sora 2 needed)');
  return [{
    json: {
      success: true,
      assetType: 'hook',
      videoSource: 'pool_passthrough',
      chatId,
      scenarioName,
    }
  }];
}

const FAL_KEY = (typeof $env !== 'undefined' && $env.FAL_KEY) || '1f90e772-6c27-4772-9c31-9fb0efd2ccb7:e1ae20a74cf0ad9a5be03baefd1603e0';

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// DEBUG MODE â€” skip API calls, generate dummy video via FFmpeg
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
const DEBUG_FAST = false;  // SET TO true FOR FAST TESTING
if (DEBUG_FAST) {
  const debugPath = '/tmp/debug_' + assetType + '_vid_' + Date.now() + '.mp4';
  const color = assetType === 'hook' ? '0xC83232' : '0x3232C8';
  execSync('ffmpeg -y -f lavfi -i color=c=' + color + ':s=1080x1920:d=3 -r 24 -c:v libx264 -pix_fmt yuv420p "' + debugPath + '"', { timeout: 15000 });
  const videoBase64 = fs.readFileSync(debugPath).toString('base64');
  try { fs.unlinkSync(debugPath); } catch(e) {}

  return [{
    json: {
      success: true,
      assetType,
      videoSource: 'debug',
      chatId,
      scenarioName,
    },
    binary: {
      [assetType + 'Video']: {
        data: videoBase64,
        mimeType: 'video/mp4',
        fileName: assetType + '_video.mp4',
      }
    }
  }];
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// KLING AVATAR V2 â€” OUTRO LIPSYNC (native audio baked in, no FFmpeg overlay)
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
const FAL_AVATAR_ENDPOINT = 'fal-ai/kling-video/ai-avatar/v2/standard';

if (assetType === 'outro' && sourceType === 'speaking') {
  // Get image URL from Generate Outro
  let outroImageUrl = '';
  try { outroImageUrl = $('Generate Outro').first().json.outroImageUrl || ''; } catch(e) {}

  const outroBinary = (inputBinary || {}).outroImage;
  if (!outroImageUrl && outroBinary) {
    const imageBuffer = Buffer.from(outroBinary.data, 'base64');
    outroImageUrl = await uploadToTempHost(imageBuffer, 'outro_for_kling.png');
  }

  // Get VO audio URL from Generate VO
  const voData = (() => { try { return $('Generate VO').first().json; } catch(e) { return {}; } })();
  const outroAudioUrl = voData.voOutroFileUrl;

  if (outroImageUrl && outroAudioUrl) {
    // Send Telegram status
    try {
      const TELEGRAM_BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
      if (TELEGRAM_BOT_TOKEN && chatId) {
        await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: '\u23F3 Generating outro via Kling Avatar V2 (native lipsync)... (~3-6 min)' }),
        });
      }
    } catch(e) { /* non-fatal */ }

    try {
      const outroMotionPrompt = 'Young woman speaking naturally to camera, slight natural head movement, composed expression';

      console.log('[Kling Avatar V2] Submitting outro: image=' + outroImageUrl.slice(0, 60) + '... audio=' + outroAudioUrl.slice(0, 60) + '...');
      const falResult = await falSubmitAndPoll(FAL_KEY, FAL_AVATAR_ENDPOINT, {
        image_url: outroImageUrl,
        audio_url: outroAudioUrl,
        prompt: outroMotionPrompt,
      }, 600000);

      const klingVideoUrl = (falResult.video && falResult.video.url) || null;
      if (!klingVideoUrl) {
        throw new Error('Kling Avatar V2 returned no video URL: ' + JSON.stringify(falResult).slice(0, 200));
      }

      console.log('[Kling Avatar V2] Video URL: ' + klingVideoUrl);

      // Download video â€” audio is baked in by Kling, no FFmpeg overlay needed
      const vidRes = await fetch(klingVideoUrl);
      if (!vidRes.ok) throw new Error('Kling video download failed: ' + vidRes.status);
      const videoBuffer = Buffer.from(await vidRes.arrayBuffer());

      if (videoBuffer.length < 1000) {
        throw new Error('Kling video too small (' + videoBuffer.length + ' bytes)');
      }

      return [{
        json: {
          success: true,
          assetType: 'outro',
          videoSource: 'kling_avatar_v2',
          videoSizeMB: (videoBuffer.length / (1024 * 1024)).toFixed(1),
          chatId,
          scenarioName,
        },
        binary: {
          outroVideo: {
            data: videoBuffer.toString('base64'),
            mimeType: 'video/mp4',
            fileName: 'outro_kling_avatar.mp4',
          }
        }
      }];
    } catch(err) {
      console.log('[Kling Avatar V2] Failed: ' + err.message + ' â€” falling back to escalatingGenerate');
      // Fall through to speaking block below
    }
  } else {
    console.log('[Kling Avatar V2] Skipped â€” missing ' + (!outroImageUrl ? 'image' : 'audio') + ' URL, falling back to escalatingGenerate');
  }
  // Fall through: if Kling Avatar failed or missing audio, use speaking block as fallback
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// SPEAKING â€” image + VO text in prompt â†’ video with lip movement
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
if (sourceType === 'speaking') {
  // Get image URL (kie.ai URL from Generate Hook/Outro, or upload binary to temp host)
  let imageUrl = '';
  if (assetType === 'hook') {
    try { imageUrl = $('Generate Hook').first().json.hookImageUrl || ''; } catch(e) {}
  } else {
    try { imageUrl = $('Generate Outro').first().json.outroImageUrl || ''; } catch(e) {}
  }

  const imageBinaryKey = assetType + 'Image';
  const imageBinary = inputBinary[imageBinaryKey];

  if (!imageUrl && imageBinary) {
    const imageBuffer = Buffer.from(imageBinary.data, 'base64');
    imageUrl = await uploadToTempHost(imageBuffer, assetType + '_for_sora2.png');
  }

  if (!imageUrl) {
    return [{ json: { error: true, chatId, message: '\u274C No image URL for Sora 2' } }];
  }

  // Get VO text from copyJson for the lipsync prompt
  const production = (() => { try { return $('Prepare Production').first().json; } catch(e) { return {}; } })();
  const copyJson = production.copyJson || {};
  const voText = stripVoTags(assetType === 'hook' ? (copyJson.hookVO || '') : (copyJson.outroVO || ''));

  // Get VO audio URL from Generate VO node (for overlay after video gen)
  const voData = (() => { try { return $('Generate VO').first().json; } catch(e) { return {}; } })();
  const audioUrl = assetType === 'hook' ? voData.voHookFileUrl : voData.voOutroFileUrl;

  // Build Sora 2 prompt â€” use Airtable template if available, else fallback
  let sora2Prompt;
  const sora2Template = production.sora2SpeakingPrompt || '';
  if (sora2Template && voText) {
    // Split VO into 3 segments for the 3-moment template
    const sentences = voText.match(/[^.!?]+[.!?]*/g) || [voText];
    const thirds = [];
    if (sentences.length >= 3) {
      thirds.push(sentences.slice(0, Math.ceil(sentences.length / 3)).join(' ').trim());
      thirds.push(sentences.slice(Math.ceil(sentences.length / 3), Math.ceil(sentences.length * 2 / 3)).join(' ').trim());
      thirds.push(sentences.slice(Math.ceil(sentences.length * 2 / 3)).join(' ').trim());
    } else {
      thirds.push(sentences[0] || voText);
      thirds.push(sentences[1] || '');
      thirds.push(sentences[2] || '');
    }
    // Extract CAPS emphasis words and build action lines
    const extractCaps = (t) => {
      const words = (t || '').match(/\b[A-Z]{2,}\b/g) || [];
      const ignore = new Set(['POV', 'DM', 'DMS', 'IG', 'OK', 'II', 'III']);
      return words.filter(w => !ignore.has(w));
    };
    const buildAction = (caps) => {
      if (caps.length === 0) return 'Slight pause for emphasis';
      if (caps.length === 1) return 'Emphasis on "' + caps[0] + '"';
      return 'Emphasis on "' + caps.slice(0, 2).join('" and "') + '"';
    };
    sora2Prompt = sora2Template;
    for (let i = 0; i < 3; i++) {
      const text = thirds[i] || '';
      const capsWords = extractCaps(text);
      const actionLine = buildAction(capsWords);
      sora2Prompt = sora2Prompt.replace('{{SPEECH_' + (i + 1) + '}}', text);
      sora2Prompt = sora2Prompt.replace('{{ACTION_' + (i + 1) + '}}', actionLine);
    }
  } else if (voText) {
    sora2Prompt = 'A young woman saying "' + voText + '" to the camera with subtle facial expressions, slight natural handheld sway, no text, no watermark, no subtitles';
  } else {
    sora2Prompt = 'A young woman speaking naturally to the camera with subtle facial expressions, slight natural handheld sway, no text, no watermark, no subtitles';
  }

  // Send status to Telegram
  try {
    const TELEGRAM_BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
    if (TELEGRAM_BOT_TOKEN && chatId) {
      await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '\u23F3 Generating ' + assetType + ' video (lip-sync, kie.ai + PoYo)... (~3-8 min)' }),
      });
    }
  } catch (e) { /* non-fatal */ }

  try {
    const videoUrl = await escalatingGenerate(imageUrl, sora2Prompt);
    console.log('[Sora 2 lipsync] Video URL: ' + videoUrl);

    // Download generated video
    const vidRes = await fetch(videoUrl);
    if (!vidRes.ok) throw new Error('Video download failed: ' + vidRes.status);
    const videoBuffer = Buffer.from(await vidRes.arrayBuffer());

    let finalVideoBuffer = videoBuffer;

    // Overlay ElevenLabs VO audio on the video
    if (audioUrl) {
      try {
        const audioRes = await fetch(audioUrl);
        if (audioRes.ok) {
          const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
          const tmpVideo = '/tmp/sora2_vid_' + Date.now() + '.mp4';
          const tmpAudio = '/tmp/sora2_aud_' + Date.now() + '.mp3';
          const tmpOutput = '/tmp/sora2_out_' + Date.now() + '.mp4';

          fs.writeFileSync(tmpVideo, videoBuffer);
          fs.writeFileSync(tmpAudio, audioBuffer);

          // Get audio duration for trimming video to match
          let audioDur = 3;
          try {
            const probe = execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 "' + tmpAudio + '"', { timeout: 10000 }).toString().trim();
            audioDur = Math.ceil(parseFloat(probe) * 10) / 10;
          } catch(e) { console.log('[ffprobe] error: ' + e.message); }

          // Overlay audio, trim video to audio duration + 0.5s buffer
          const trimDur = Math.min(audioDur + 0.5, 10);
          execSync('ffmpeg -y -i "' + tmpVideo + '" -i "' + tmpAudio + '" -t ' + trimDur + ' -c:v libx264 -preset fast -crf 22 -c:a aac -map 0:v:0 -map 1:a:0 -movflags +faststart "' + tmpOutput + '"', { timeout: 60000 });
          finalVideoBuffer = fs.readFileSync(tmpOutput);
          console.log('[Sora 2] Audio overlay done, duration: ' + trimDur + 's');

          try { fs.unlinkSync(tmpVideo); } catch(e) {}
          try { fs.unlinkSync(tmpAudio); } catch(e) {}
          try { fs.unlinkSync(tmpOutput); } catch(e) {}
        }
      } catch(e) {
        console.log('[Sora 2] Audio overlay failed: ' + e.message + ' \u2014 using video without audio');
      }
    }

    return [{
      json: {
        success: true,
        assetType,
        videoSource: 'sora2_lipsync',
        videoSizeMB: (finalVideoBuffer.length / (1024 * 1024)).toFixed(1),
        chatId,
        scenarioName,
      },
      binary: {
        [assetType + 'Video']: {
          data: finalVideoBuffer.toString('base64'),
          mimeType: 'video/mp4',
          fileName: assetType + '_sora2_lipsync.mp4',
        }
      }
    }];
  } catch (err) {
    // Fallback to static image (FFmpeg will loop it)
    const fallbackBinary = imageBinary ? { [imageBinaryKey]: imageBinary } : undefined;
    return [{
      json: {
        success: false,
        assetType,
        videoSource: 'fallback_image',
        error: err.message,
        chatId,
        scenarioName,
        warning: '\u26A0\uFE0F Sora 2 lipsync ' + assetType + ' failed: ' + err.message + '. Using static image.',
      },
      binary: fallbackBinary,
    }];
  }
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// SORA 2 REACTION â€” image + motion prompt â†’ video (no speech, no audio)
// Used for reaction sourceType AND as default fallback for any other type.
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?

// Get image URL or binary
let imageUrl = '';
if (assetType === 'hook') {
  try { imageUrl = $('Generate Hook').first().json.hookImageUrl || ''; } catch(e) {}
} else {
  try { imageUrl = $('Generate Outro').first().json.outroImageUrl || ''; } catch(e) {}
}

const imageBinaryKey = assetType + 'Image';
const imageBinary = inputBinary[imageBinaryKey];

if (!imageUrl && imageBinary) {
  const imageBuffer = Buffer.from(imageBinary.data, 'base64');
  imageUrl = await uploadToTempHost(imageBuffer, assetType + '_for_sora2.png');
}

if (!imageUrl) {
  return [{ json: { error: true, chatId, message: '\u274C No image URL for Sora 2' } }];
}

// Get prompt from Prepare Production or default
const production = (() => { try { return $('Prepare Production').first().json; } catch(e) { return {}; } })();
const motionPrompt = (assetType === 'hook'
  ? (production.sora2ReactionPrompt || production.hookKlingPrompt || DEFAULT_PROMPTS.hook)
  : (production.outroKlingPrompt || DEFAULT_PROMPTS.outro));

// Send status to Telegram
try {
  const TELEGRAM_BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
  if (TELEGRAM_BOT_TOKEN && chatId) {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '\u23F3 Generating ' + assetType + ' video (kie.ai + PoYo)... (~3-8 min)' }),
    });
  }
} catch (e) { /* non-fatal */ }

// 25% micro asymmetry â€” breaks puppet effect
let motionPromptFinal = motionPrompt;
if (!motionPromptFinal.includes('no text')) {
  motionPromptFinal += ', no text, no watermark, no subtitles';
}
if (Math.random() < 0.25) motionPromptFinal += ', slight asymmetrical micro expression, uneven muscle movement';

try {
  const videoUrl = await escalatingGenerate(imageUrl, motionPromptFinal);
  console.log('[Sora 2 motion] Video URL: ' + videoUrl);

  const vidRes = await fetch(videoUrl);
  if (!vidRes.ok) throw new Error('Video download failed: ' + vidRes.status);
  const videoBuffer = Buffer.from(await vidRes.arrayBuffer());

  if (videoBuffer.length < 1000) {
    throw new Error('Generated video too small (' + videoBuffer.length + ' bytes)');
  }

  // â”€â”€â”€ Sora 2 trim selection: save raw 10s, create 3 clips, let user pick â”€â”€â”€
  // Trim options from 10s video: [0-3s] [3-6s] [6-9s]
  const TRIM_OPTS = [
    { start: 0, label: '0-3s' },
    { start: 3, label: '3-6s' },
    { start: 6, label: '6-9s' },
  ];

  const rawPath = '/tmp/sora2_raw_' + Date.now() + '.mp4';
  fs.writeFileSync(rawPath, videoBuffer);

  // Create 3 trimmed clips
  const trimPaths = [];
  for (let i = 0; i < TRIM_OPTS.length; i++) {
    const tp = '/tmp/sora2_t' + i + '_' + Date.now() + '.mp4';
    try {
      execSync('ffmpeg -y -ss ' + TRIM_OPTS[i].start + ' -i "' + rawPath + '" -t 3 -c:v libx264 -preset fast -crf 22 -an -movflags +faststart "' + tp + '"', { timeout: 30000 });
      trimPaths.push(tp);
      console.log('[trim ' + TRIM_OPTS[i].label + '] OK (' + (fs.statSync(tp).size / 1024).toFixed(0) + 'KB)');
    } catch (e) {
      console.log('[trim ' + TRIM_OPTS[i].label + '] FAIL: ' + e.message);
      trimPaths.push(null);
    }
  }
  try { fs.unlinkSync(rawPath); } catch(e) {}

  // Get config for Telegram + Airtable
  const TBOT = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
  const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
  const ABASE = 'appsgjIdkpak2kaXq';
  const ATABLE = 'tbltCYcVXrLYvyIJL';
  const recordId = (() => { try { return $('Create Video Run').first().json.id; } catch(e) { return 'unknown'; } })();

  // Clear any stale hook_vid_approval before sending trim options
  if (ATOKEN && recordId !== 'unknown') {
    try {
      const clearBody = JSON.stringify({ fields: { hook_vid_approval: '' } });
      await new Promise((res, rej) => {
        const req = _https.request({
          hostname: 'api.airtable.com',
          path: '/v0/' + ABASE + '/' + ATABLE + '/' + recordId,
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + ATOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(clearBody) },
        }, r => { r.resume(); r.on('end', res); });
        req.on('error', res); // non-fatal
        req.write(clearBody);
        req.end();
      });
    } catch(e) { /* non-fatal */ }
  }

  // Send intro message + all 3 trim options to Telegram
  if (TBOT && chatId) {
    try {
      await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '\uD83C\uDFAC Scegli la parte della hook da usare:' }),
      });
    } catch(e) { /* non-fatal */ }

    for (let i = 0; i < TRIM_OPTS.length; i++) {
      const tp = trimPaths[i];
      if (!tp || !fs.existsSync(tp)) continue;
      const buf = fs.readFileSync(tp);
      const markup = { inline_keyboard: [[{ text: '\u2705 Usa questo', callback_data: 'vpApprove_' + recordId + '_hook_vid_' + i }]] };
      try {
        await sendTelegramVideo(TBOT, chatId, buf, 'hook_' + TRIM_OPTS[i].label + '.mp4', '\uD83D\uDCF9 ' + TRIM_OPTS[i].label, markup);
        if (i < TRIM_OPTS.length - 1) await new Promise(r => setTimeout(r, 600));
      } catch(e) {
        console.log('[trim send ' + i + '] Error: ' + e.message);
      }
    }
  }

  // Poll Airtable for trim choice â€” no timeout, wait as long as needed (10s intervals)
  let chosenBuffer = null;
  let chosenLabel = '1-4s';
  if (ATOKEN && recordId !== 'unknown') {
    for (let poll = 0; poll < 9999; poll++) {
      await new Promise(r => setTimeout(r, 10000));
      try {
        const rec = await new Promise((res, rej) => {
          const req = _https.request({
            hostname: 'api.airtable.com',
            path: '/v0/' + ABASE + '/' + ATABLE + '/' + recordId,
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + ATOKEN },
          }, r => {
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => { try { res(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { rej(e); } });
          });
          req.on('error', rej);
          req.end();
        });
        const approval = (rec.fields && rec.fields.hook_vid_approval) || '';
        if (poll % 6 === 0) console.log('[trim poll #' + (poll + 1) + '] hook_vid_approval: ' + (approval || 'waiting...'));
        if (approval.startsWith('approved_')) {
          const idx = parseInt(approval.replace('approved_', ''), 10);
          if (!isNaN(idx) && idx >= 0 && idx <= 2 && trimPaths[idx] && fs.existsSync(trimPaths[idx])) {
            chosenBuffer = fs.readFileSync(trimPaths[idx]);
            chosenLabel = TRIM_OPTS[idx].label;
            console.log('[trim] User chose ' + chosenLabel);
            break;
          }
        }
      } catch(e) {
        console.log('[trim poll #' + (poll + 1) + '] error: ' + e.message);
      }
    }
  }

  // Fallback if somehow no choice (shouldn't happen with unlimited polling)
  if (!chosenBuffer) {
    const fallbackIdx = trimPaths[1] && fs.existsSync(trimPaths[1]) ? 1 : (trimPaths[0] && fs.existsSync(trimPaths[0]) ? 0 : -1);
    if (fallbackIdx >= 0) {
      chosenBuffer = fs.readFileSync(trimPaths[fallbackIdx]);
      chosenLabel = TRIM_OPTS[fallbackIdx].label;
    } else {
      chosenBuffer = videoBuffer;
      chosenLabel = 'raw';
    }
  }

  // Mark hook_vid_approval = 'approved' immediately so downstream Poll auto-passes (no second tap needed)
  if (ATOKEN && recordId !== 'unknown') {
    try {
      const doneBody = JSON.stringify({ fields: { hook_vid_approval: 'approved' } });
      await new Promise((res, rej) => {
        const req = _https.request({
          hostname: 'api.airtable.com',
          path: '/v0/' + ABASE + '/' + ATABLE + '/' + recordId,
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + ATOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(doneBody) },
        }, r => { r.resume(); r.on('end', res); });
        req.on('error', res);
        req.write(doneBody);
        req.end();
      });
      console.log('[trim] hook_vid_approval set to approved â€” downstream poll will auto-pass');
    } catch(e) { /* non-fatal */ }
  }

  // Cleanup trim files
  for (const tp of trimPaths) { if (tp) try { fs.unlinkSync(tp); } catch(e) {} }

  return [{
    json: {
      success: true,
      assetType,
      videoSource: 'sora2_motion',
      videoSizeMB: (chosenBuffer.length / (1024 * 1024)).toFixed(1),
      videoDuration: 3,
      trimChosen: chosenLabel,
      chatId,
      scenarioName,
    },
    binary: {
      [assetType + 'Video']: {
        data: chosenBuffer.toString('base64'),
        mimeType: 'video/mp4',
        fileName: assetType + '_motion.mp4',
      }
    }
  }];
} catch (err) {
  // Fallback to static image (FFmpeg will loop it)
  const fallbackBinary = imageBinary ? { [imageBinaryKey]: imageBinary } : undefined;
  return [{
    json: {
      success: false,
      assetType,
      videoSource: 'fallback_image',
      error: err.message,
      chatId,
      scenarioName,
      warning: '\u26A0\uFE0F Sora 2 ' + assetType + ' failed: ' + err.message + '. Using static image.',
    },
    binary: fallbackBinary,
  }];
}
