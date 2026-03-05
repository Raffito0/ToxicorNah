// NODE: Generate Outro (Self-Contained)
// Uses the selectedOutro from Prepare Production (weighted random from outroPool):
//   - manual_clip → pass through the already-uploaded outro clip file_id
//   - ai_generated → kie.ai with girl ref, prompt built from outroPromptTemplate
//   - none → skip outro
//
// Self-contained: builds kie.ai prompt internally from concept's outroPromptTemplate
// No dependency on external LLM nodes
// Mode: Run Once for All Items
//
// WIRING: Generate Hook → this node → Telegram Approval (if AI) or [outro ready]

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
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 5000;

// AI-generated prompt from Outro Prompt Agent (upstream AI Agent node)
const AI_GENERATED_PROMPT = $input.first().json.output || '';

// ─── retry helper ───
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

// ─── kie.ai helpers ───
async function kieGenerate(prompt, imageRefs, options = {}) {
  const { aspectRatio = '9:16', resolution = '2K', timeOfDay = 'day', isSelfie = false } = options;

  // V2.0: Lighting continuity with hook
  const lighting = timeOfDay === 'night'
    ? 'soft ambient night lighting, consistent with previous scene'
    : 'natural daylight consistent with previous scene';

  // V2.0: Imperfection layer (20% — lighter than hook's 40%)
  const imperfectionPool = [
    'subtle natural skin texture',
    'slight asymmetry in posture',
    'very faint under-eye shadow',
    'natural uneven shoulder position',
  ];
  const imperfectionSuffix = Math.random() < 0.20
    ? ', ' + imperfectionPool[Math.floor(Math.random() * imperfectionPool.length)]
    : '';

  // V2.0: UGC light suffix (cleaner than hook — outro can be slightly more polished)
  const framingSuffix = isSelfie
    ? 'realistic selfie framing, handheld phone shot, looking directly into camera'
    : 'realistic candid framing';
  const ugcSuffix = ', maintain exact facial features from reference, wearing the exact same outfit and clothing as in the reference image, if holding a phone it must be a black iPhone XS, ' + lighting +
    ', shot on iPhone, natural indoor lighting, ' + framingSuffix + ', 9:16 vertical' + imperfectionSuffix;

  const finalPrompt = prompt + ugcSuffix;

  const res = await fetch(KIE_API_URL + '/createTask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + KIE_API_KEY,
    },
    body: JSON.stringify({
      model: 'nano-banana-2',
      input: { prompt: finalPrompt, image_input: imageRefs, aspect_ratio: aspectRatio, resolution, output_format: 'png' },
    }),
  });
  if (!res.ok) throw new Error('kie.ai: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  if (data.code !== 200) throw new Error('kie.ai: ' + JSON.stringify(data));
  return data.data.taskId;
}

async function kiePoll(taskId) {
  // Infinite polling — no timeout. Retries on network errors with doubled delay.
  const POLL_INTERVAL = 5000;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      const res = await fetch(KIE_API_URL + '/recordInfo?taskId=' + taskId, {
        headers: { 'Authorization': 'Bearer ' + KIE_API_KEY },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const state = data.data?.state;
      if (state === 'success') return JSON.parse(data.data.resultJson).resultUrls?.[0];
      if (state === 'fail') throw new Error(data.data.failMsg || 'Generation failed');
      // state === 'waiting' → keep polling
    } catch (err) {
      if (err.message.includes('failed') || err.message.includes('Generation')) throw err;
      // Network error → wait longer and retry
      await new Promise(r => setTimeout(r, POLL_INTERVAL * 2));
    }
  }
}

// ─── V2.0 Outro prompt builder ───
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

  // Map to outroTone — continues the narrative arc of the hook
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

  // Eye direction (weighted random — eliminates AI stare syndrome)
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

  // Context anchor — progressive, different from hook's "after reading a shocking message"
  const anchors = [
    'after processing what she just read',
    'after realizing what it really means',
    'after letting it sink in',
  ];
  const anchor = anchors[Math.floor(Math.random() * anchors.length)];

  // Position: "10 seconds later" feel — micro-shift ONLY, never a new staged pose
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

  // Angle: mirror hookType for selfie/candid consistency
  const effectiveHookType = production.effectiveHookType || production.hookType || 'reaction';
  const isSelfie = effectiveHookType === 'speaking';
  const anglePool = isSelfie
    ? ['Close-up shot, straight on, of', 'Close-up shot from slightly above, looking down at']
    : ['Side profile shot from 45 degrees, showing', 'Close-up shot from slightly above, looking down at', 'Medium shot from the side, showing'];
  const angle = anglePool[Math.floor(Math.random() * anglePool.length)];

  return angle + ' the same exact girl from the reference image, ' + envDesc +
    ', ' + anchor + ', ' + emotion + ', ' + pickEye();
}
// ─── End helpers ───

const production = $('Prepare Production').first().json;
const selectedOutro = production.selectedOutro || { type: 'none' };
const chatId = production.chatId;
const scenarioName = production.scenarioName;

// Effective outro type: app_store_clip or sub-concept override or original
const effectiveOutroType = production.effectiveOutroType || selectedOutro.type;
const outroCategory = production.outroCategory || 'organic';

// ═══════════════════════════════════════
// DEBUG MODE — skip AI generation, return dummy image instantly
// ═══════════════════════════════════════
const DEBUG_FAST = false;  // ← SET TO true FOR FAST TESTING
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

// ═══════════════════════════════════════
// NONE — no outro for this video
// ═══════════════════════════════════════
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

// ═══════════════════════════════════════
// MANUAL CLIP — already uploaded via #outro
// ═══════════════════════════════════════
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

// ═══════════════════════════════════════
// AI GENERATED — kie.ai with girl ref, prompt from template
// ═══════════════════════════════════════
if (selectedOutro.type === 'ai_generated') {
  if (!KIE_API_KEY) {
    return [{ json: { error: true, chatId, message: 'kie.ai API key not configured' } }];
  }

  // Reference: hook image ONLY (contains girl + room + outfit + lighting — everything needed)
  // Read from Generate Hook node directly (AI Agent nodes swallow upstream fields)
  const hookImageUrl = $input.first().json.hookImageUrl
    || (() => { try { return $('Generate Hook').first().json.hookImageUrl || ''; } catch(e) { return ''; } })();
  const girlRefUrl = production.girlRefUrl || '';

  if (!hookImageUrl && !girlRefUrl) {
    return [{ json: { error: true, chatId, message: 'No reference image for outro (need hook image or girl_ref_url)' } }];
  }

  // Use hook image as sole ref (best continuity); fallback to girl ref if hook not available
  const imageRefs = hookImageUrl ? [hookImageUrl] : [girlRefUrl];
  const hasHookImage = !!hookImageUrl;

  const promptSource = 'template';
  const outroPrompt = buildOutroPromptFallback(production, hasHookImage);

  try {
    const imageUrl = await withRetry(async () => {
      const taskId = await kieGenerate(outroPrompt, imageRefs, { timeOfDay: production.timeOfDay || 'day', isSelfie: true });
      const url = await kiePoll(taskId);
      if (!url) throw new Error('kie.ai returned no outro image');
      return url;
    }, 'kie.ai outro');

    const imgRes = await fetch(imageUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        outroReady: false, // needs Telegram approval + img2vid
        outroSkipped: false,
        outroSource: 'speaking', // ai_generated image → Sora 2 speaking (lipsync + audio)
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
    // Self-healing: outro AI failed after retry → skip outro (video works without it)
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

// ═══════════════════════════════════════
// APP STORE CLIP — select random unused clip from Airtable
// Pre-recorded clips showing the app in the app store. VO overlaid in assembly.
// ═══════════════════════════════════════
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
    // No clips available — fall back to skipping outro
    return [{
      json: {
        outroReady: true,
        outroSkipped: true,
        outroSource: 'app_store_fallback_skip',
        chatId,
        scenarioName,
        warning: '⚠️ App store outro selected but no clips available. Skipping outro.',
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
    // Clip record exists but has no file attachment — skip outro
    return [{
      json: {
        outroReady: true,
        outroSkipped: true,
        outroSource: 'app_store_fallback_skip',
        chatId,
        scenarioName,
        warning: '⚠️ App store clip "' + (selected.clip_name || '?') + '" has no file. Skipping outro.',
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

// ═══════════════════════════════════════
// KLING LIPSYNC — Step 1: Generate original image with kie.ai
// Image gets approved on Telegram, then Img2Vid node converts via Sora 2
// ═══════════════════════════════════════
if (effectiveOutroType === 'speaking') {
  if (!KIE_API_KEY) {
    return [{ json: { error: true, chatId, message: '❌ kie.ai API key not configured' } }];
  }

  const girlRefUrl = production.girlRefUrl || '';
  if (!girlRefUrl) {
    return [{
      json: {
        outroReady: true,
        outroSkipped: true,
        chatId,
        scenarioName,
        warning: '⚠️ No girl_ref_url configured on concept. Skipping speaking outro.',
      }
    }];
  }

  try {
    let imagePrompt = production.outroImagePrompt || '';
    if (!imagePrompt || imagePrompt.length < 10) {
      // AI_GENERATED_PROMPT intentionally not used — always build from template for consistency
      {
        // V2.0 speaking outro: about to speak — confident, not reacting
        // Different from ai_generated outro (which uses outroTone emotion pools)
        const lipsyncAnchors = [
          'after letting it sink in',
          'after processing what she just read',
          'composed and ready to speak her mind',
        ];
        const anchor = lipsyncAnchors[Math.floor(Math.random() * lipsyncAnchors.length)];
        const envDesc = production.environmentDescription || 'cozy bedroom';
        imagePrompt = 'Close-up shot, straight on, of the same exact girl from the reference image, ' +
          envDesc + ', ' + anchor +
          ', slight lean toward camera, steady eye contact, composed confident stillness';
      }
    }

    const imageRefs = [girlRefUrl];

    const generatedImageUrl = await withRetry(async () => {
      const taskId = await kieGenerate(imagePrompt, imageRefs, { timeOfDay: production.timeOfDay || 'day', isSelfie: true });
      const url = await kiePoll(taskId);
      if (!url) throw new Error('kie.ai returned no image');
      return url;
    }, 'kie.ai outro for speaking');

    const imgRes = await fetch(generatedImageUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        outroReady: false, // needs Telegram approval → then Img2Vid (Sora 2)
        outroSkipped: false,
        outroSource: 'speaking',
        outroImageUrl: generatedImageUrl,
        outroPromptUsed: imagePrompt,
        outroPromptSource: 'kie_ai',
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
        warning: '⚠️ Speaking outro image failed: ' + err.message + '. Skipping outro.',
      }
    }];
  }
}

return [{ json: { error: true, chatId, message: 'Unknown outro type: ' + (effectiveOutroType || selectedOutro.type) } }];
