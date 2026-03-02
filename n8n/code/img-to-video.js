// NODE: Image to Video (Sora 2 via APIMart.ai — $0.025/video)
// Converts an approved hook/outro image into an animated video clip.
// Two paths:
//   1. speaking → Sora 2 (image + VO text in prompt → video with lip movement + baked audio)
//   2. reaction → Sora 2 (image + motion prompt → motion video, 10s, no audio)
// Default (no sourceType) → Sora 2 motion as fallback.
// Single node for BOTH hook and outro (assetType auto-detected).
// Self-healing: on failure, returns the original image as fallback (FFmpeg will loop).
// Mode: Run Once for All Items
//
// WIRING: After hook/outro image approved → this Code node → Send Video Preview (Telegram)

const fs = require('fs');
const path = require('path');
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

// ─── Multipart video upload helper for Telegram sendVideo ───
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

// ─── Temp image upload (0x0.st — no API key, widely accessible by AI APIs) ───
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

// ─── fal.ai shared polling helper ───
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

// ─── Config ───
const DEFAULT_PROMPTS = {
  hook: 'locked off tripod shot, static camera, zero camera movement, girl eyes fixed on phone screen, shakes head slightly, concerned expression, subtle facial movement only, not typing on phone, no tears',
  outro: 'locked off tripod shot, static camera, zero camera movement, girl looking at camera, gentle expression change, subtle movement, not typing on phone, no tears',
};
// ─── Sora 2 via APIMart.ai — Shotgun + Escalating Backoff Strategy ───
// Dual-model concurrent (sora-2 + sora-2-vip), 10 rounds, jittered backoff
// $0.00 for failed attempts — only charges on success ($0.025/video)
const APIMART_KEY = (typeof $env !== 'undefined' && $env.APIMART_API_KEY) || 'sk-kQeBOTjXlRbsutwcFSbjtDPmqLO5vZpFIFWkkW97WJYT5Y9l';
const APIMART_MODELS = ['sora-2', 'sora-2-vip']; // different backend channel pools

// Submit a single task to one model — returns { taskId, model } or throws
async function apimartSubmit(model, imageUrl, prompt, options = {}) {
  const { duration = 15, style, storyboard = false } = options;
  const reqBody = {
    model,
    prompt,
    duration,
    aspect_ratio: '9:16',
    watermark: false,
    private: true,
  };
  if (imageUrl) reqBody.image_urls = [imageUrl];
  if (style) reqBody.style = style;
  if (storyboard) reqBody.storyboard = true;

  const submitRes = await fetch('https://api.apimart.ai/v1/videos/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + APIMART_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(reqBody),
  });

  const bodyText = await submitRes.text();
  if (!submitRes.ok) throw new Error('[' + model + '] HTTP ' + submitRes.status + ': ' + bodyText.slice(0, 300));

  let submitData;
  try { submitData = JSON.parse(bodyText); } catch(e) { throw new Error('[' + model + '] Invalid JSON: ' + bodyText.slice(0, 300)); }

  if (submitData.code !== 200 || !submitData.data || !submitData.data[0] || !submitData.data[0].task_id) {
    throw new Error('[' + model + '] No task_id: ' + bodyText.slice(0, 300));
  }

  return { taskId: submitData.data[0].task_id, model };
}

// Poll a submitted task until completed — returns video URL or throws
async function apimartPoll(taskId, model, timeoutMs = 600000) {
  const pollStart = Date.now();
  let pollCount = 0;

  while (Date.now() - pollStart < timeoutMs) {
    await new Promise(r => setTimeout(r, 5000));
    pollCount++;

    try {
      const statusRes = await fetch('https://api.apimart.ai/v1/tasks/' + taskId, {
        headers: { 'Authorization': 'Bearer ' + APIMART_KEY },
      });

      if (!statusRes.ok) {
        console.log('[' + model + ' poll #' + pollCount + '] HTTP ' + statusRes.status);
        continue;
      }

      const statusData = await statusRes.json();
      const taskData = statusData.data || {};
      const st = taskData.status || '';
      const progress = taskData.progress || 0;

      if (pollCount % 3 === 0 || st === 'completed' || st === 'failed') {
        console.log('[' + model + ' poll #' + pollCount + '] ' + st + ' (' + progress + '%)');
      }

      if (st === 'completed') {
        const videos = taskData.result && taskData.result.videos;
        if (videos && videos[0] && videos[0].url && videos[0].url[0]) {
          return videos[0].url[0];
        }
        throw new Error('[' + model + '] Completed but no video URL: ' + JSON.stringify(taskData).slice(0, 500));
      }

      if (st === 'failed' || st === 'cancelled') {
        throw new Error('[' + model + '] Task ' + st + ': ' + JSON.stringify(taskData).slice(0, 500));
      }
    } catch (err) {
      if (err.message.includes('failed') || err.message.includes('cancelled') || err.message.includes('no video URL')) throw err;
      console.log('[' + model + ' poll #' + pollCount + '] error: ' + err.message);
    }
  }

  throw new Error('[' + model + '] Poll timeout (' + (timeoutMs / 60000) + ' min)');
}

// Orchestrator: shotgun dual-model + escalating backoff + Telegram status
async function sora2Generate(imageUrl, prompt, options = {}) {
  const BACKOFFS_SEC = [20, 35, 50, 60, 60, 60, 60, 60, 60, 60]; // 10 rounds
  const MAX_ROUNDS = 10;

  // Telegram config for retry status updates
  const TBOT = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
  const _chatId = (() => { try { return $('Prepare Production').first().json.chatId || ''; } catch(e) { return ''; } })();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roundLabel = (round + 1) + '/' + MAX_ROUNDS;

    // ── Shotgun: fire both models concurrently ──
    console.log('[Round ' + roundLabel + '] Submitting to ' + APIMART_MODELS.join(' + ') + '...');
    const submitResults = await Promise.allSettled(
      APIMART_MODELS.map(m => apimartSubmit(m, imageUrl, prompt, options))
    );

    // Check which submits succeeded (got a task_id)
    const successes = submitResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    const failures = submitResults
      .filter(r => r.status === 'rejected')
      .map(r => r.reason.message || String(r.reason));

    if (successes.length > 0) {
      // At least one model accepted — poll the first one (cheapest: sora-2 preferred)
      const winner = successes[0];
      console.log('[Round ' + roundLabel + '] \u2705 ' + winner.model + ' accepted! task_id: ' + winner.taskId);

      if (successes.length > 1) {
        console.log('[Round ' + roundLabel + '] (Also accepted: ' + successes[1].model + ' — ignoring, using first)');
      }

      // Poll until video is ready
      return await apimartPoll(winner.taskId, winner.model);
    }

    // ── Both failed — log and backoff ──
    console.log('[Round ' + roundLabel + '] \u274C Both models rejected: ' + failures.join(' | '));

    if (round < MAX_ROUNDS - 1) {
      const baseSec = BACKOFFS_SEC[round];
      const jitterSec = Math.floor(Math.random() * 21) - 10; // ±10s
      const delaySec = Math.max(10, baseSec + jitterSec);

      console.log('[Round ' + roundLabel + '] Retrying in ' + delaySec + 's...');

      // Telegram status every 3 rounds (not too spammy)
      if (TBOT && _chatId && (round === 0 || round % 3 === 0)) {
        try {
          await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: _chatId,
              text: '\u26A1 Sora 2 at capacity — retry ' + roundLabel + ', next attempt in ' + delaySec + 's...',
            }),
          });
        } catch(e) { /* non-fatal */ }
      }

      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }

  throw new Error('APIMart: all ' + MAX_ROUNDS + ' rounds failed (' + (MAX_ROUNDS * 2) + ' attempts across ' + APIMART_MODELS.join('+') + ')');
}

// Strip ElevenLabs emotion tags from VO text for Sora 2 prompt
function stripVoTags(text) {
  if (!text) return '';
  return text.replace(/\[(gasps?|sighs?|laughs?|whispers?|sarcastic|frustrated|curious|excited)\]/gi, '').replace(/\s{2,}/g, ' ').trim();
}

// ═══════════════════════════════════════
// Main logic
// ═══════════════════════════════════════

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

// ─── Pool passthrough: hook was already consumed from Hook Pool in Generate Hook ───
// Both 'pool' (speaking, has audio) and 'pool_reaction' (silent) skip Sora 2
if (sourceType === 'pool' || sourceType === 'pool_reaction') {
  // hookVideo binary was already output by Generate Hook — this node is a no-op.
  // Download Assets will find hookVideo in Generate Hook's binary output.
  console.log('[Img2Vid] Pool hook (' + sourceType + ') — passthrough (no Sora 2 needed)');
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

// ═══════════════════════════════════════
// DEBUG MODE — skip API calls, generate dummy video via FFmpeg
// ═══════════════════════════════════════
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

// ═══════════════════════════════════════
// SORA 2 SPEAKING — image + VO text in prompt → video with lip movement + baked audio
// ═══════════════════════════════════════
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

  // Build Sora 2 prompt — include VO text so lip movements match
  let sora2Prompt;
  if (voText) {
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
        body: JSON.stringify({ chat_id: chatId, text: '\u23F3 Generating ' + assetType + ' video via Sora 2 (lip-sync)... (~2-5 min)' }),
      });
    }
  } catch (e) { /* non-fatal */ }

  try {
    const videoUrl = await sora2Generate(imageUrl, sora2Prompt, { duration: 15, style: 'selfie' });
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

// ═══════════════════════════════════════
// SORA 2 REACTION — image + motion prompt → video (no speech, no audio)
// Used for reaction sourceType AND as default fallback for any other type.
// ═══════════════════════════════════════

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
  ? (production.hookKlingPrompt || DEFAULT_PROMPTS.hook)
  : (production.outroKlingPrompt || DEFAULT_PROMPTS.outro));

// Send status to Telegram
try {
  const TELEGRAM_BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
  if (TELEGRAM_BOT_TOKEN && chatId) {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '\u23F3 Generating ' + assetType + ' video via Sora 2... (~2-5 min)' }),
    });
  }
} catch (e) { /* non-fatal */ }

// 25% micro asymmetry — breaks puppet effect
let motionPromptFinal = motionPrompt;
if (!motionPromptFinal.includes('no text')) {
  motionPromptFinal += ', no text, no watermark, no subtitles';
}
if (Math.random() < 0.25) motionPromptFinal += ', slight asymmetrical micro expression, uneven muscle movement';

try {
  const videoUrl = await sora2Generate(imageUrl, motionPromptFinal, { duration: 15 });
  console.log('[Sora 2 motion] Video URL: ' + videoUrl);

  const vidRes = await fetch(videoUrl);
  if (!vidRes.ok) throw new Error('Video download failed: ' + vidRes.status);
  const videoBuffer = Buffer.from(await vidRes.arrayBuffer());

  if (videoBuffer.length < 1000) {
    throw new Error('Generated video too small (' + videoBuffer.length + ' bytes)');
  }

  // ─── Sora 2 trim selection: save raw 10s, create 3 clips, let user pick ───
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

  // Poll Airtable for trim choice — no timeout, wait as long as needed (10s intervals)
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
      console.log('[trim] hook_vid_approval set to approved — downstream poll will auto-pass');
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
