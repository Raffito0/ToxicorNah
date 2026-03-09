// NODE: Generate Outro (Self-Contained)
// Uses the selectedOutro from Prepare Production (weighted random from outroPool):
//   - manual_clip ' pass through the already-uploaded outro clip file_id
//   - ai_generated ' fal.ai nano-banana-2 with girl ref, prompt built from outroPromptTemplate
//   - none ' skip outro
//
// Self-contained: builds prompt internally from concept's outroPromptTemplate
// No dependency on external LLM nodes
// Mode: Run Once for All Items
//
// WIRING: Generate Hook ' this node ' Telegram Approval (if AI) or [outro ready]

// """ fetch polyfill (n8n Code node sandbox lacks global fetch) """
const _https = require('https');
const _http = require('http');
const { URL } = require('url');
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');
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

const KIE_API_KEY = '7670ade582cc72601f388dbdc0525b9e';
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';
const FAL_KEY = (typeof $env !== 'undefined' && $env.FAL_KEY) || '1f90e772-6c27-4772-9c31-9fb0efd2ccb7:e1ae20a74cf0ad9a5be03baefd1603e0';
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 5000;

// AI-generated prompt from Outro Prompt Agent (upstream AI Agent node)
const AI_GENERATED_PROMPT = $input.first().json.output || '';

// """ retry helper """
async function withRetry(fn, label = 'API call') {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

// """ R2 upload (for last-frame extraction) """
const R2_PUBLIC_URL = (typeof $env !== 'undefined' && $env.R2_PUBLIC_URL) || 'https://pub-6e119e86bbae4479912db5c9a79d8fed.r2.dev';
function hmacSha256(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data).digest(encoding);
}
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
async function uploadToR2(r2Key, bodyBuffer, contentType) {
  const accessKeyId = (typeof $env !== 'undefined' && $env.R2_ACCESS_KEY_ID) || '';
  const secretAccessKey = (typeof $env !== 'undefined' && $env.R2_SECRET_ACCESS_KEY) || '';
  const accountId = (typeof $env !== 'undefined' && $env.R2_ACCOUNT_ID) || '';
  if (!accessKeyId || !secretAccessKey || !accountId) throw new Error('R2 credentials missing');
  const bucket = 'toxic-or-nah';
  const host = accountId + '.r2.cloudflarestorage.com';
  const path = '/' + bucket + '/' + r2Key;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(bodyBuffer);
  const headers = {
    'Host': host, 'Content-Type': contentType || 'image/jpeg',
    'Content-Length': String(bodyBuffer.length),
    'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate,
  };
  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalHeaders = signedHeaderKeys.map(k => k + ':' + headers[Object.keys(headers).find(h => h.toLowerCase() === k)]).join('\n') + '\n';
  const canonicalRequest = ['PUT', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = dateStamp + '/auto/s3/aws4_request';
  const stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + sha256(canonicalRequest);
  const kDate = hmacSha256('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmacSha256(kDate, 'auto');
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = hmacSha256(kSigning, stringToSign, 'hex');
  const authHeader = 'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  return new Promise((resolve, reject) => {
    const req = _https.request({
      hostname: host, path, method: 'PUT',
      headers: { ...headers, 'Authorization': authHeader },
    }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error('R2 upload HTTP ' + res.statusCode));
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

// """ Extract last frame from hook video """
// Sora 2 reinterprets the input image, so the actual video content differs
// from the original hook image. Using the last frame ensures visual continuity.
async function extractHookLastFrame() {
  try {
    // Get hook video binary: pool hooks have it on Generate Hook,
    // fresh hooks have it on Img2Vid Hook (after Sora 2 conversion)
    let videoBuf = null;
    const hookNode = $('Generate Hook').first();
    if (hookNode && hookNode.binary && hookNode.binary.hookVideo) {
      videoBuf = Buffer.from(hookNode.binary.hookVideo.data, 'base64');
      console.log('[outro] Found hookVideo on Generate Hook (pool hook)');
    }
    if (!videoBuf) {
      try {
        const img2vidNode = $('Img2Vid Hook').first();
        if (img2vidNode && img2vidNode.binary && img2vidNode.binary.hookVideo) {
          videoBuf = Buffer.from(img2vidNode.binary.hookVideo.data, 'base64');
          console.log('[outro] Found hookVideo on Img2Vid Hook (fresh hook)');
        }
      } catch(e) { /* Img2Vid Hook might not have run (pool path) */ }
    }
    if (!videoBuf) {
      console.log('[outro] No hook video binary on Generate Hook or Img2Vid Hook');
      return null;
    }
    const tmpVideo = '/tmp/outro_hook_' + Date.now() + '.mp4';
    const tmpFrame = '/tmp/outro_lastframe_' + Date.now() + '.jpg';
    fs.writeFileSync(tmpVideo, videoBuf);

    // Extract last frame (0.1s before end)
    execSync(
      'ffmpeg -y -sseof -0.1 -i "' + tmpVideo + '" -frames:v 1 -q:v 2 "' + tmpFrame + '"',
      { timeout: 15000 }
    );

    if (!fs.existsSync(tmpFrame)) {
      console.log('[outro] FFmpeg did not produce last frame');
      try { fs.unlinkSync(tmpVideo); } catch(e) {}
      return null;
    }

    const frameBuf = fs.readFileSync(tmpFrame);
    console.log('[outro] Last frame extracted: ' + frameBuf.length + ' bytes');

    // Upload to R2 for a permanent URL that kie.ai/fal.ai can access
    const r2Key = 'hook-last-frames/outro_ref_' + Date.now() + '.jpg';
    await uploadToR2(r2Key, frameBuf, 'image/jpeg');
    const frameUrl = R2_PUBLIC_URL + '/' + r2Key;
    console.log('[outro] Last frame uploaded to R2: ' + frameUrl);

    // Cleanup
    try { fs.unlinkSync(tmpVideo); } catch(e) {}
    try { fs.unlinkSync(tmpFrame); } catch(e) {}

    return frameUrl;
  } catch (err) {
    console.log('[outro] extractHookLastFrame failed: ' + err.message);
    return null;
  }
}

// """ kie.ai nano-banana-2 (async: createTask ' poll) """
async function kieGenerate(prompt, imageRefs, options = {}) {
  const { aspectRatio = '9:16', resolution = '2K', timeOfDay = 'day', isSelfie = false } = options;
  const lighting = timeOfDay === 'night' ? 'nighttime' : 'daytime';
  const imperfections = [
    'natural uneven posture', 'one shoulder slightly higher than the other',
    'subtle natural skin texture', 'slight under-eye shadow', 'pillow slightly creased beside her',
  ];
  const imperfectionSuffix = Math.random() < 0.40
    ? ', ' + imperfections[Math.floor(Math.random() * imperfections.length)] : '';
  const phoneClause = isSelfie ? 'front-facing camera POV, NO phone visible in frame, NO mirror, the viewer IS the phone camera, hands not holding any device'
    : 'if holding a phone it must be a black iPhone XS';
  const finalPrompt = prompt + ', maintain exact facial features from reference, ' + phoneClause + ', ' + lighting +
    ', shot on iPhone 13 Pro, no background blur, no bokeh, sharp background throughout, no color grading, raw UGC phone footage style' + imperfectionSuffix;
  const res = await fetch(KIE_API_URL + '/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KIE_API_KEY },
    body: JSON.stringify({
      model: 'nano-banana-pro',
      input: { prompt: finalPrompt, image_input: imageRefs, aspect_ratio: aspectRatio, resolution, output_format: 'png' },
    }),
  });
  if (!res.ok) throw new Error('kie.ai createTask: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  if (data.code !== 200) throw new Error('kie.ai: ' + JSON.stringify(data));
  return data.data.taskId;
}

async function kiePoll(taskId) {
  const POLL_INTERVAL = 5000;
  const TIMEOUT = 120000;
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    try {
      const res = await fetch(KIE_API_URL + '/recordInfo?taskId=' + taskId, {
        headers: { 'Authorization': 'Bearer ' + KIE_API_KEY },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const state = data.data?.state;
      if (state === 'success') {
        return JSON.parse(data.data.resultJson).resultUrls?.[0];
      }
      if (state === 'fail') throw new Error(data.data.failMsg || 'Generation failed');
    } catch (err) {
      if (err.message.includes('failed') || err.message.includes('Generation')) throw err;
    }
  }
  throw new Error('kie.ai poll timeout after 120s');
}

// """ fal.ai nano-banana-2 (synchronous " no polling needed) """
async function falGenerate(prompt, imageRefs, options = {}) {
  const { aspectRatio = '9:16', resolution = '2K', timeOfDay = 'day', isSelfie = false } = options;
  const lighting = timeOfDay === 'night'
    ? 'soft ambient night lighting, consistent with previous scene'
    : 'natural daylight consistent with previous scene';
  const imperfectionPool = [
    'subtle natural skin texture', 'slight asymmetry in posture',
    'very faint under-eye shadow', 'natural uneven shoulder position',
  ];
  const imperfectionSuffix = Math.random() < 0.20
    ? ', ' + imperfectionPool[Math.floor(Math.random() * imperfectionPool.length)] : '';
  const framingSuffix = isSelfie
    ? 'realistic selfie framing, handheld phone shot, looking directly into camera'
    : 'realistic candid framing';
  const ugcSuffix = ', maintain exact facial features from reference, wearing the exact same outfit and clothing as in the reference image, if holding a phone it must be a black iPhone XS, ' + lighting +
    ', shot on iPhone, natural indoor lighting, ' + framingSuffix + ', 9:16 vertical' + imperfectionSuffix;
  const finalPrompt = prompt + ugcSuffix;
  console.log('[fal.ai] Generating image: ' + finalPrompt.slice(0, 100) + '...');
  const res = await fetch('https://fal.run/fal-ai/nano-banana-2/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Key ' + FAL_KEY },
    body: JSON.stringify({ prompt: finalPrompt, image_urls: imageRefs, resolution, aspect_ratio: aspectRatio, output_format: 'png' }),
  });
  if (!res.ok) throw new Error('fal.ai: ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  if (!data.images?.[0]?.url) throw new Error('fal.ai: no image URL in response: ' + JSON.stringify(data).slice(0, 300));
  console.log('[fal.ai] Image ready: ' + data.images[0].url);
  return data.images[0].url;
}

// """ generateImage: kie.ai primary ' fal.ai fallback """
async function generateImage(prompt, imageRefs, options = {}) {
  try {
    console.log('[imageGen] Trying kie.ai...');
    const taskId = await kieGenerate(prompt, imageRefs, options);
    const url = await kiePoll(taskId);
    if (!url) throw new Error('kie.ai returned no image URL');
    console.log('[imageGen] kie.ai OK: ' + url);
    return url;
  } catch (kieErr) {
    console.log('[imageGen] kie.ai failed: ' + kieErr.message + ' " falling back to fal.ai');
    const url = await falGenerate(prompt, imageRefs, options);
    console.log('[imageGen] fal.ai fallback OK: ' + url);
    return url;
  }
}

// """ V2.0 Outro prompt builder """
// Continuity with hook: outroTone derived from hookPoseCategory
// Hook = tension/reaction. Outro = awareness/decision/follow-through.
function buildOutroPromptFallback(production, hasHookImage) {
  // Derive hookPoseCategory from scenario score (mirrors prepare-production.js logic)
  let hookPoseCategory = 'cold_calculated';
  const scenarioJson = production.scenarioJson;
  if (scenarioJson) {
    const score = scenarioJson.overallScore || scenarioJson.toxicityScore || 15;
    hookPoseCategory = score <= 15 ? 'cold_calculated' : 'explosive_control';
  }

  // Map to outroTone " continues the narrative arc of the hook
  const outroTone = hookPoseCategory === 'cold_calculated' ? 'knowing_dominant' : 'controlled_decisive';

  // Emotion pools by outroTone
  const emotionPools = {
    knowing_dominant: [
      'calm knowing expression, slight narrowing of eyes',
      'faint almost amused realization',
      'composed stillness, confident gaze',
      'subtle micro smirk that fades quickly',
    ],
    controlled_decisive: [
      'steady controlled expression, jaw relaxed now',
      'quiet but firm look, decision already made',
      'composed but no longer shocked',
      'calm direct gaze, settled energy',
    ],
  };
  const emotionPool = emotionPools[outroTone];
  const emotion = emotionPool[Math.floor(Math.random() * emotionPool.length)];

  // Eye direction (weighted random " eliminates AI stare syndrome)
  const eyeOpts = [
    { weight: 40, text: 'direct eye contact' },
    { weight: 25, text: 'eyes slightly past the camera' },
    { weight: 20, text: 'downward glance briefly then settling forward' },
    { weight: 10, text: 'slight side glance' },
    { weight: 5, text: 'micro shift before settling on camera' },
  ];
  function pickEye() {
    const total = eyeOpts.reduce((s, o) => s + o.weight, 0);
    let r = Math.random() * total;
    for (const opt of eyeOpts) { r -= opt.weight; if (r <= 0) return opt.text; }
    return eyeOpts[0].text;
  }

  // Context anchor " progressive, different from hook's "after reading a shocking message"
  const anchors = [
    'after processing what she just read',
    'after realizing what it really means',
    'after letting it sink in',
  ];
  const anchor = anchors[Math.floor(Math.random() * anchors.length)];

  // Position: "10 seconds later" feel " micro-shift ONLY, never a new staged pose
  // Rule: she does NOT stand up, does NOT cross arms, does NOT look out a window
  const positionOpts = [
    'still seated in the same spot, slightly shifted posture, phone now lowered to her lap',
    'still seated, leaning slightly back now, phone loosely held at her side',
    'still seated, now sitting more upright, phone resting in her hand',
    'now sitting on the edge of the bed nearby, phone loosely in hand, not stood up',
  ];
  const position = positionOpts[Math.floor(Math.random() * positionOpts.length)];

  // Environment continuity
  const envDesc = hasHookImage
    ? 'in the exact same room, ' + position
    : ((production.environmentDescription || 'cozy bedroom') + ', ' + position);

  // Angle: always selfie style for outro (girl speaks to camera)
  const anglePool = [
    'Front-facing camera close-up, as if taken from her phone\'s front camera, face filling the frame, of',
    'Close-up from slightly above eye level, front camera perspective, no phone visible, of',
    'Intimate close-up straight on, POV of her phone\'s front camera, of',
  ];
  const angle = anglePool[Math.floor(Math.random() * anglePool.length)];

  const selfieStyle = ', looking directly into camera lens, NO phone visible, NO mirror, camera IS the phone';

  return angle + ' the same exact girl from the reference image, ' + envDesc +
    ', ' + anchor + ', ' + emotion + ', ' + pickEye() + selfieStyle;
}
// """ End helpers """

const production = $('Prepare Production').first().json;
const selectedOutro = production.selectedOutro || { type: 'none' };
const chatId = production.chatId;
const scenarioName = production.scenarioName;

// Effective outro type: app_store_clip or sub-concept override or original
const effectiveOutroType = production.effectiveOutroType || selectedOutro.type;
const outroCategory = production.outroCategory || 'organic';

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// DEBUG MODE " skip AI generation, return dummy image instantly
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
const DEBUG_FAST = false;  // ? SET TO true FOR FAST TESTING
if (DEBUG_FAST && effectiveOutroType !== 'manual_clip' && effectiveOutroType !== 'none' && effectiveOutroType !== 'app_store_clip') {
  // Generate a proper 1080x1920 debug image via FFmpeg (Telegram rejects programmatic PNGs)
  const { execSync } = require('child_process');
  const fs2 = require('fs');
  const debugPath = '/tmp/debug_outro_' + Date.now() + '.png';
  execSync('ffmpeg -y -f lavfi -i color=c=0x3232C8:s=1080x1920 -frames:v 1 "' + debugPath + '"', { timeout: 10000 });
  const debugBase64 = fs2.readFileSync(debugPath).toString('base64');
  try { fs2.unlinkSync(debugPath); } catch(e) {}

  return [{
    json: {
      outroReady: false,
      outroSource: 'debug',
      outroPromptUsed: 'DEBUG MODE - FFmpeg dummy image',
      chatId,
      scenarioName,
    },
    binary: {
      outroImage: {
        data: debugBase64,
        mimeType: 'image/png',
        fileName: 'debug_outro.png',
      }
    }
  }];
}

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// NONE " no outro for this video
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
if (selectedOutro.type === 'none') {
  return [{
    json: {
      outroReady: true,
      outroSkipped: true,
      chatId,
      scenarioName,
    }
  }];
}

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// MANUAL CLIP " already uploaded via #outro
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
if (selectedOutro.type === 'manual_clip') {
  if (!production.outroClipFileId) {
    return [{
      json: {
        error: true,
        chatId,
        message: '\u274C Outro "' + selectedOutro.label + '" selected but no clip uploaded. Send: #outro ' + scenarioName + ' ' + selectedOutro.label + ' + video'
      }
    }];
  }
  return [{
    json: {
      outroReady: true,
      outroSkipped: false,
      outroSource: 'manual_clip',
      outroFileId: production.outroClipFileId,
      outroDuration: production.outroClipDuration,
      outroLabel: selectedOutro.label,
      chatId,
      scenarioName,
    }
  }];
}

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// AI GENERATED " fal.ai with girl ref, prompt from template
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
if (selectedOutro.type === 'ai_generated') {
  if (!KIE_API_KEY && !FAL_KEY) {
    return [{ json: { error: true, chatId, message: 'No image gen API key configured (kie.ai or fal.ai)' } }];
  }

  // Best reference = last frame of hook VIDEO (visual continuity with hook scene)
  const lastFrameUrl = await extractHookLastFrame();
  const hookImageUrl = lastFrameUrl
    || $input.first().json.hookImageUrl
    || (() => { try { return $('Generate Hook').first().json.hookImageUrl || ''; } catch(e) { return ''; } })();
  const girlRefUrl = production.phoneGirlRefUrl || production.girlRefUrl || '';

  if (!hookImageUrl && !girlRefUrl) {
    return [{ json: { error: true, chatId, message: 'No reference image for outro (need hook image or girl_ref_url)' } }];
  }

  // Prefer last frame > hook image > girl ref (visual continuity with hook scene)
  const imageRefs = hookImageUrl ? [hookImageUrl] : [girlRefUrl];
  const hasHookImage = !!hookImageUrl;

  const promptSource = 'template';
  const outroPrompt = buildOutroPromptFallback(production, hasHookImage);

  try {
    const imageUrl = await withRetry(async () => {
      const url = await generateImage(outroPrompt, imageRefs, { timeOfDay: production.timeOfDay || 'day', isSelfie: true });
      if (!url) throw new Error('Image gen returned no outro image');
      return url;
    }, 'outro image');

    const imgRes = await fetch(imageUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        outroReady: false, // needs Telegram approval + img2vid
        outroSkipped: false,
        outroSource: 'speaking', // ai_generated image ' Sora 2 speaking (lipsync + audio)
        outroImageUrl: imageUrl,
        outroPromptUsed: outroPrompt,
        outroPromptSource: promptSource,
        outroLabel: selectedOutro.label,
        chatId,
        scenarioName,
      },
      binary: {
        outroImage: {
          data: imgBuffer.toString('base64'),
          mimeType: 'image/png',
          fileName: 'outro_ai.png',
        }
      }
    }];
  } catch (err) {
    // Self-healing: outro AI failed after retry ' skip outro (video works without it)
    return [{
      json: {
        outroReady: true,
        outroSkipped: true,
        outroSource: 'fallback_skip',
        chatId,
        scenarioName,
        warning: '\u26A0\uFE0F Outro AI failed after retry: ' + err.message + '. Skipping outro.',
      }
    }];
  }
}

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// APP STORE CLIP " select random unused clip from Airtable
// Pre-recorded clips showing the app in the app store. VO overlaid in assembly.
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
if (effectiveOutroType === 'app_store_clip') {
  // App store clips loaded from upstream Airtable node
  // Filter out empty items from alwaysOutputData (node outputs {} when Airtable returns 0 records)
  let appStoreClips = [];
  try {
    appStoreClips = $('Find App Store Clips').all().map(i => i.json).filter(c => c.clip_name || c.clip_file);
  } catch(e) {
    // Node might not exist yet or returned no items
  }

  if (appStoreClips.length === 0) {
    // No clips available " fall back to skipping outro
    return [{
      json: {
        outroReady: true,
        outroSkipped: true,
        outroSource: 'app_store_fallback_skip',
        chatId,
        scenarioName,
        warning: ' ï? App store outro selected but no clips available. Skipping outro.',
      }
    }];
  }

  // Prefer unused clips, fall back to least-used
  const unused = appStoreClips.filter(c => !c.is_used && c.is_active !== false);
  const active = appStoreClips.filter(c => c.is_active !== false);
  let pool = unused.length > 0 ? unused : active;
  if (pool.length === 0) pool = appStoreClips;

  const selected = pool[Math.floor(Math.random() * pool.length)];

  // Get clip file URL from Airtable attachment
  let clipFileUrl = null;
  if (Array.isArray(selected.clip_file) && selected.clip_file.length > 0) {
    clipFileUrl = selected.clip_file[0].url;
  }

  if (!clipFileUrl) {
    // Clip record exists but has no file attachment " skip outro
    return [{
      json: {
        outroReady: true,
        outroSkipped: true,
        outroSource: 'app_store_fallback_skip',
        chatId,
        scenarioName,
        warning: ' ï? App store clip "' + (selected.clip_name || '?') + '" has no file. Skipping outro.',
      }
    }];
  }

  return [{
    json: {
      outroReady: true, // no approval needed, it's a pre-recorded clip
      outroSkipped: false,
      outroSource: 'app_store_clip',
      outroFileUrl: clipFileUrl,
      outroDuration: selected.clip_duration_sec || 3,
      outroLabel: 'app_store',
      appStoreClipRecordId: selected.id, // to mark as used after production
      chatId,
      scenarioName,
    }
  }];
}

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// SPEAKING " Step 1: Generate original image with fal.ai
// Image gets approved on Telegram, then Img2Vid node converts via Sora 2
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
if (effectiveOutroType === 'speaking') {
  if (!KIE_API_KEY && !FAL_KEY) {
    return [{ json: { error: true, chatId, message: '? No image gen API key configured' } }];
  }

  // Girl ref from phone (multi-phone) or concept fallback
  // Best reference = last frame of hook VIDEO (visual continuity with hook scene)
  const lastFrameUrl = await extractHookLastFrame();
  const hookImageUrl = lastFrameUrl
    || $input.first().json.hookImageUrl
    || (() => { try { return $('Generate Hook').first().json.hookImageUrl || ''; } catch(e) { return ''; } })();
  const girlRefUrl = production.phoneGirlRefUrl || production.girlRefUrl || '';

  if (!hookImageUrl && !girlRefUrl) {
    return [{
      json: {
        outroReady: true,
        outroSkipped: true,
        chatId,
        scenarioName,
        warning: 'No reference image for speaking outro (need hook image or girl_ref_url). Skipping.',
      }
    }];
  }

  // Prefer last frame > hook image > girl ref (visual continuity with hook scene)
  const imageRefs = hookImageUrl ? [hookImageUrl] : [girlRefUrl];
  const hasHookImage = !!hookImageUrl;

  try {
    let imagePrompt = production.outroImagePrompt || '';
    if (!imagePrompt || imagePrompt.length < 10) {
      // V2.0 speaking outro: about to speak " confident, not reacting
      const lipsyncAnchors = [
        'after letting it sink in',
        'after processing what she just read',
        'composed and ready to speak her mind',
      ];
      const anchor = lipsyncAnchors[Math.floor(Math.random() * lipsyncAnchors.length)];
      const envDesc = hasHookImage
        ? 'in the exact same room, wearing the exact same outfit'
        : (production.environmentDescription || 'cozy bedroom');
      imagePrompt = 'Close-up shot, straight on, of the same exact girl from the reference image, ' +
        envDesc + ', ' + anchor +
        ', slight lean toward camera, steady eye contact, composed confident stillness';
    }


    const generatedImageUrl = await withRetry(async () => {
      const url = await generateImage(imagePrompt, imageRefs, { timeOfDay: production.timeOfDay || 'day', isSelfie: true });
      if (!url) throw new Error('Image gen returned no image');
      return url;
    }, 'outro speaking image');

    const imgRes = await fetch(generatedImageUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        outroReady: false, // needs Telegram approval ' then Img2Vid (Sora 2)
        outroSkipped: false,
        outroSource: 'speaking',
        outroImageUrl: generatedImageUrl,
        outroPromptUsed: imagePrompt,
        outroPromptSource: 'fal_ai',
        outroLabel: selectedOutro.label || 'speaking',
        chatId,
        scenarioName,
      },
      binary: {
        outroImage: {
          data: imgBuffer.toString('base64'),
          mimeType: 'image/png',
          fileName: 'outro_speaking.png',
        }
      }
    }];
  } catch (err) {
    return [{
      json: {
        outroReady: true,
        outroSkipped: true,
        outroSource: 'fallback_skip',
        chatId,
        scenarioName,
        warning: ' ï? Speaking outro image failed: ' + err.message + '. Skipping outro.',
      }
    }];
  }
}

return [{ json: { error: true, chatId, message: 'Unknown outro type: ' + (effectiveOutroType || selectedOutro.type) } }];
