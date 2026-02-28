// NODE: Generate Hook (Self-Contained + Env Frame Extraction)
// Routes by hook type from concept config:
//   - manual_clip → pass through the already-uploaded hook clip file_id
//   - ai_image / ai_single_girl → extract env frame from 1st body clip → kie.ai
//   - ai_multi_image → kie.ai x3 images
//   - chat_screenshot → Puppeteer screenshot
//
// Self-contained: downloads first body clip from Telegram, extracts env frame,
// uploads to temp host, then uses [girl_ref, env_frame] as kie.ai references.
// Prompt NEVER describes the girl — only "same exact girl in reference image".
// Mode: Run Once for All Items

// ─── fetch polyfill (n8n Code node sandbox lacks global fetch) ───
const _https = require('https');
const _http = require('http');
const { URL } = require('url');
const fs = require('fs');
const { execSync } = require('child_process');

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

// ─── Temp image upload (litterbox.catbox.moe — no API key, 1h expiry) ───
function uploadToTempHost(buffer, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const parts = [
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="reqtype"\r\n\r\n' +
      'fileupload\r\n',
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="time"\r\n\r\n' +
      '1h\r\n',
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="fileToUpload"; filename="' + filename + '"\r\n' +
      'Content-Type: image/png\r\n\r\n',
    ];
    const bodyBuf = Buffer.concat([
      Buffer.from(parts.join('')),
      buffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const req = _https.request({
      hostname: 'litterbox.catbox.moe',
      path: '/resources/internals/api.php',
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
        else reject(new Error('Upload failed: ' + url));
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

const KIE_API_KEY = '7670ade582cc72601f388dbdc0525b9e';
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';
const SCREENSHOT_URL = 'http://host.docker.internal:3456/screenshot';
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 5000;

// ─── Hook Girls Pose/Style Reference Catalog ───
// 35 reference photos categorized by mood — passed as 2nd image_input to kie.ai
// so the AI matches pose/vibe/setting while keeping the girl's face from ref #1
const HOOK_GIRLS = {
  // Sad, looking down, soft/vulnerable expression
  vulnerable: [
    'https://files.catbox.moe/wzyi1d.jpg', // dcb67e92 — lying on pillow, looking down, melancholic
    'https://files.catbox.moe/dxg8hn.jpg', // bd868982 — lying on pillow, looking up, vulnerable
    'https://files.catbox.moe/j02ssk.jpg', // 5c2b4ca5 — lying on pillow, eyes looking away, soft
    'https://files.catbox.moe/3xvja6.jpg', // 4bed58d5 — lying on bed, side angle, dim light
  ],
  // Thoughtful, hand on chin, looking away
  pensive: [
    'https://files.catbox.moe/i5oqts.jpg', // 7f4d2417 — sitting on couch, hand to face, pensive
    'https://files.catbox.moe/n4j85d.jpg', // 9b71be19 — sitting, looking down, natural light
    'https://files.catbox.moe/qyslwz.jpg', // 9c2c3792 — sitting on bed, hand on chin, reflective
    'https://files.catbox.moe/8k26yp.jpg', // dcfa4f0a — lying down close-up, natural light, pensive
    'https://files.catbox.moe/j1m03k.jpg', // 3a6b9e9a — sitting on bed, hand on face, neutral
    'https://files.catbox.moe/va26lo.jpg', // b353eca7 — lying on bed, hand to face, contemplative
    'https://files.catbox.moe/elqv0d.jpg', // ca2cfb7f — sitting on bed, hand to chin, contemplative
    'https://files.catbox.moe/txb4fr.jpg', // 015dac25 — sitting, hand on face, bored/unimpressed
    'https://files.catbox.moe/h1ujow.jpg', // a109cb5d — lying on bed, hand on chin, sultry
  ],
  // Intense gaze, slightly pouty, sultry
  pouty: [
    'https://files.catbox.moe/u80lq7.jpg', // 19b1e645 — lying on pillow, head tilted, sleepy
    'https://files.catbox.moe/rrw6jx.jpg', // f3ef337f — lying on pillow with glasses, sultry
    'https://files.catbox.moe/mmtkks.jpg', // db40e1c2 — lying on bed, face close-up, intimate
    'https://files.catbox.moe/cih8oa.jpg', // 32b72f71 — lying on bed, pink/purple lighting, seductive
    'https://files.catbox.moe/7492ey.jpg', // 15317131 — bedroom with decor, hand to chin, sultry gaze
    'https://files.catbox.moe/uj0rmj.jpg', // 90165a53 — lying down, very close up, intimate
    'https://files.catbox.moe/595i5z.jpg', // 9501a693 — dark background, intense gaze
  ],
  // Direct camera gaze, assertive posture
  confident: [
    'https://files.catbox.moe/q5tnuo.jpg', // 3c94dd4f — sitting on bed, leaning forward, confident
    'https://files.catbox.moe/onj7r0.jpg', // cf3497e3 — sitting on bed, hand on chin, thoughtful
    'https://files.catbox.moe/fc189o.jpg', // 4095715a — sitting with arm raised, confident pose
    'https://files.catbox.moe/pvh9pt.jpg', // 76e90492 — lying on bed, looking over shoulder, confident
    'https://files.catbox.moe/lekpnf.jpg', // 5e8aad81 — direct look
  ],
  // Finger gestures, slight smile, playful
  playful: [
    'https://files.catbox.moe/ftuxf2.jpg', // 43389bcb — lying on bed, finger gesture, playful
    'https://files.catbox.moe/rd2tsn.jpg', // 70zl40bh — lying on bed, flirty
    'https://files.catbox.moe/hb5fo1.jpg', // 26467a69 — lying on floor, edgy
    'https://files.catbox.moe/vb8gu0.jpg', // 16cec123 — lying on couch, playful smile
  ],
  // Tired, looking away, bored expression
  bored: [
    'https://files.catbox.moe/6l76qo.jpg', // c40b14e4 — leaning on couch, looking away, tired
    'https://files.catbox.moe/1gcb8l.jpg', // e5b48c82 — sitting on bed, looking up, dim
  ],
  // Lying back, comfortable, natural vibe
  relaxed: [
    'https://files.catbox.moe/gbgcm4.jpg', // 2091a872 — sitting at table, relaxed
    'https://files.catbox.moe/zrfvwm.jpg', // 6a6c552d — lying on bed, arm up, relaxed
    'https://files.catbox.moe/pppe0f.jpg', // 4a8eef5d — lying on side, intimate angle
    'https://files.catbox.moe/vkrmtc.jpg', // a109da5a — mirror selfie, standing
  ],
};

// Select a pose mood category based on toxicity score + emotion override
function selectPoseCategory(production) {
  if (production.hookEmotionRule === 'always_sad') return 'vulnerable';
  if (production.hookEmotionRule === 'always_shocked') return 'vulnerable';
  const score = production.scenarioJson
    ? (production.scenarioJson.overallScore || production.scenarioJson.toxicityScore || 50)
    : 50;
  if (score <= 20) return 'vulnerable';  // very toxic → sad/upset
  if (score <= 35) return 'pensive';     // worried/hurt → thoughtful
  if (score <= 50) return 'bored';       // frustrated → bored/unimpressed
  if (score <= 65) return 'pouty';       // skeptical → pouty/sultry
  if (score <= 80) return 'confident';   // neutral → confident/direct
  return 'relaxed';                      // low toxicity → relaxed
}

// Pick a random pose reference URL from the given category
function pickPoseRef(category) {
  const pool = HOOK_GIRLS[category];
  if (!pool || pool.length === 0) {
    const all = Object.values(HOOK_GIRLS).flat();
    return all[Math.floor(Math.random() * all.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Bot token for downloading clips from Telegram (extractEnvFrame)
const TELEGRAM_BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';

// AI-generated prompt from Hook Prompt Agent (upstream AI Agent node)
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
  const { aspectRatio = '9:16', resolution = '2K' } = options;
  const res = await fetch(KIE_API_URL + '/createTask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + KIE_API_KEY,
    },
    body: JSON.stringify({
      model: 'nano-banana-pro',
      input: { prompt, image_input: imageRefs, aspect_ratio: aspectRatio, resolution, output_format: 'png' },
    }),
  });
  if (!res.ok) throw new Error('kie.ai createTask: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  if (data.code !== 200) throw new Error('kie.ai: ' + JSON.stringify(data));
  return data.data.taskId;
}

async function kiePoll(taskId) {
  // Max 100 attempts × 5s = ~8 minutes before giving up cleanly
  const POLL_INTERVAL = 5000;
  const MAX_ATTEMPTS = 100;
  let attempt = 0;
  while (true) {
    attempt++;
    if (attempt > MAX_ATTEMPTS) {
      throw new Error('kie.ai timeout: still pending after ' + MAX_ATTEMPTS + ' polls (~8 min). taskId=' + taskId);
    }
    try {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
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
      // state === 'waiting' → keep polling
    } catch (err) {
      if (err.message.includes('failed') || err.message.includes('Generation') || err.message.includes('timeout')) throw err;
      // Network error → wait longer and retry
      await new Promise(r => setTimeout(r, POLL_INTERVAL * 2));
    }
  }
}

// ─── Extract env frame from first body clip ───
async function extractEnvFrame(bodyClips) {
  if (!TELEGRAM_BOT_TOKEN) return null;
  if (!bodyClips || bodyClips.length === 0) return null;

  const firstClipFileId = bodyClips[0].fileId;
  if (!firstClipFileId) return null;

  const tmpDir = '/tmp/toxicornah_' + Date.now();
  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Get file path from Telegram
    const fileInfoRes = await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/getFile?file_id=' + firstClipFileId);
    const fileInfo = await fileInfoRes.json();
    const filePath = fileInfo.result?.file_path;
    if (!filePath) return null;

    // 2. Download the video
    const videoRes = await fetch('https://api.telegram.org/file/bot' + TELEGRAM_BOT_TOKEN + '/' + filePath);
    if (!videoRes.ok) return null;
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    // 3. Extract first frame with FFmpeg
    const videoPath = tmpDir + '/clip.mp4';
    const framePath = tmpDir + '/frame.png';
    fs.writeFileSync(videoPath, videoBuffer);
    execSync('ffmpeg -y -i "' + videoPath + '" -frames:v 1 -q:v 2 "' + framePath + '"', { timeout: 30000 });

    if (!fs.existsSync(framePath)) return null;
    const frameBuffer = fs.readFileSync(framePath);

    // 4. Upload to temp host to get a URL
    const frameUrl = await uploadToTempHost(frameBuffer, 'env_frame.png');

    // 5. Cleanup
    try { fs.unlinkSync(videoPath); fs.unlinkSync(framePath); fs.rmdirSync(tmpDir); } catch(e) {}

    return frameUrl;
  } catch (err) {
    // Non-fatal: cleanup and return null
    try { fs.rmdirSync(tmpDir, { recursive: true }); } catch(e) {}
    return null;
  }
}

// ─── Fallback template prompt builder (used when AI Agent output is empty) ───
function buildHookPromptFallback(production, hasEnvFrame, hasPoseRef) {
  let emotion = 'concerned';
  const scenarioJson = production.scenarioJson;
  if (scenarioJson) {
    const score = scenarioJson.overallScore || scenarioJson.toxicityScore || 50;
    if (score <= 20) emotion = 'shocked and upset';
    else if (score <= 35) emotion = 'worried and hurt';
    else if (score <= 50) emotion = 'confused and concerned';
    else if (score <= 70) emotion = 'thoughtful and curious';
    else emotion = 'relieved but cautious';
  }
  if (production.hookEmotionRule === 'always_sad') emotion = 'sad and hurt';
  if (production.hookEmotionRule === 'always_shocked') emotion = 'shocked and upset';

  const furniture = production.environmentFurniture || 'bed';
  const envDesc = hasEnvFrame
    ? 'in the same room as the environment frame'
    : (production.environmentDescription || 'cozy bedroom, warm lighting');

  // Multi-reference guidance: tell kie.ai which ref is face vs pose
  const refGuide = hasPoseRef
    ? 'IMPORTANT: Use the FIRST reference image for the girl\'s face and appearance ONLY. ' +
      'Use the SECOND reference image for the body pose, camera angle, and setting/vibe ONLY. ' +
      'Do NOT blend the faces — the girl must look exactly like the first reference. '
    : '';

  // Pick a random camera angle to avoid copying the reference photo
  const angles = [
    'Low angle shot from floor level, looking up at',
    'Close-up shot from slightly above, looking down at',
    'Side profile shot from 45 degrees, showing',
    'Wide shot from across the room, showing',
  ];
  const angle = angles[Math.floor(Math.random() * angles.length)];

  return refGuide + angle + ' a girl sitting on ' + furniture + ', ' + envDesc +
    '. She is hunched forward over her phone, ' + emotion +
    ' expression. Realistic, candid, shot on iPhone, 9:16 vertical';
}
// ─── End helpers ───

const production = $('Prepare Production').first().json;
const hookType = production.effectiveHookType || production.hookType;
const chatId = production.chatId;
const scenarioName = production.scenarioName;

// ═══════════════════════════════════════
// DEBUG MODE — skip AI generation, return dummy image instantly
// Set to true for fast testing of approval flow, false for production
// ═══════════════════════════════════════
const DEBUG_FAST = false;  // ← SET TO true FOR FAST TESTING
if (DEBUG_FAST && hookType !== 'manual_clip') {
  // Generate a 200x200 debug PNG (Telegram rejects tiny images)
  const zlib = require('zlib');
  const W = 200, H = 200;
  const raw = Buffer.alloc((1 + W * 3) * H);
  for (let y = 0; y < H; y++) {
    const off = y * (1 + W * 3);
    raw[off] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      raw[off + 1 + x * 3] = 200;     // R
      raw[off + 1 + x * 3 + 1] = 50;  // G
      raw[off + 1 + x * 3 + 2] = 50;  // B
    }
  }
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  function pngChunk(type, data) {
    const t = Buffer.from(type);
    const all = Buffer.concat([t, data]);
    let c = 0xFFFFFFFF;
    for (const b of all) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); }
    c ^= 0xFFFFFFFF;
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(c >>> 0);
    return Buffer.concat([len, t, data, crc]);
  }
  const png = Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
  const DUMMY_PNG = png.toString('base64');

  return [{
    json: {
      hookReady: false,
      hookSource: 'debug',
      hookPromptUsed: 'DEBUG MODE - 200x200 dummy image',
      chatId,
      scenarioName,
    },
    binary: {
      hookImage: {
        data: DUMMY_PNG,
        mimeType: 'image/png',
        fileName: 'debug_hook.png',
      }
    }
  }];
}

// ═══════════════════════════════════════
// MANUAL CLIP — already uploaded via #hook
// ═══════════════════════════════════════
if (hookType === 'manual_clip') {
  if (!production.hookClipFileId) {
    return [{ json: { error: true, chatId, message: '\u274C No hook clip uploaded. Send: #hook ' + scenarioName + ' + video' } }];
  }
  return [{
    json: {
      hookReady: true,
      hookSource: 'manual_clip',
      hookFileId: production.hookClipFileId,
      hookDuration: production.hookClipDuration,
      chatId,
      scenarioName,
    }
  }];
}

// ═══════════════════════════════════════
// AI SINGLE IMAGE — ai_image OR ai_single_girl
// Extracts env frame from first body clip, generates girl in that environment
// ═══════════════════════════════════════
if (hookType === 'ai_image' || hookType === 'ai_single_girl') {
  if (!KIE_API_KEY) {
    return [{ json: { error: true, chatId, message: 'kie.ai API key not configured' } }];
  }

  const girlRefUrl = production.girlRefUrl || '';
  if (!girlRefUrl) {
    return [{ json: { error: true, chatId, message: 'No girl_ref_url configured on concept.' } }];
  }

  // Pose/style reference from Hook Girls catalog
  const poseCategory = selectPoseCategory(production);
  const poseRefUrl = pickPoseRef(poseCategory);

  // Use AI-generated prompt from upstream Agent, fallback to template
  let hookPrompt = (AI_GENERATED_PROMPT && AI_GENERATED_PROMPT.length > 20) ? AI_GENERATED_PROMPT : null;
  const promptSource = hookPrompt ? 'deepseek' : 'template';
  if (!hookPrompt) {
    hookPrompt = buildHookPromptFallback(production, false, !!poseRefUrl);
  } else if (poseRefUrl) {
    // Prepend multi-ref guidance to the AI-generated prompt
    hookPrompt = 'IMPORTANT: Use the FIRST reference for the girl\'s face ONLY. Use the SECOND reference for pose/vibe ONLY. Do NOT blend faces. ' + hookPrompt;
  }

  // Image references: girl ref + pose ref
  const imageRefs = poseRefUrl ? [girlRefUrl, poseRefUrl] : [girlRefUrl];

  try {
    const result = await withRetry(async () => {
      const taskId = await kieGenerate(hookPrompt, imageRefs);
      const imageUrl = await kiePoll(taskId);
      if (!imageUrl) throw new Error('kie.ai returned no image');
      return imageUrl;
    }, 'kie.ai hook');

    const imgRes = await fetch(result);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        hookReady: false, // needs Telegram approval (sent by native Telegram node)
        hookSource: 'ai_image',
        hookImageUrl: result,
        hookPromptUsed: hookPrompt,
        hookPromptSource: promptSource,
        hookPoseCategory: poseCategory,
        hookPoseRef: poseRefUrl || null,
        envFrameUsed: false,
        chatId,
        scenarioName,
      },
      binary: {
        hookImage: {
          data: imgBuffer.toString('base64'),
          mimeType: 'image/png',
          fileName: 'hook_ai.png',
        }
      }
    }];
  } catch (err) {
    return [{
      json: {
        hookReady: true,
        hookSource: 'fallback_blank',
        hookFailed: true,
        hookError: err.message,
        chatId,
        scenarioName,
        warning: '\u26A0\uFE0F Hook AI failed: ' + err.message + '. Skipping hook image.',
      }
    }];
  }
}

// ═══════════════════════════════════════
// AI MULTI IMAGE — 3 images for before_after
// ═══════════════════════════════════════
if (hookType === 'ai_multi_image') {
  if (!KIE_API_KEY) {
    return [{ json: { error: true, chatId, message: 'kie.ai API key not configured' } }];
  }

  const girlRefUrl = production.girlRefUrl || '';

  // Pose/style reference (same for all 3 scenes for consistency)
  const poseCategory = selectPoseCategory(production);
  const poseRefUrl = pickPoseRef(poseCategory);

  let basePrompt = (AI_GENERATED_PROMPT && AI_GENERATED_PROMPT.length > 20) ? AI_GENERATED_PROMPT : null;
  if (!basePrompt) {
    basePrompt = buildHookPromptFallback(production, false, !!poseRefUrl);
  } else if (poseRefUrl) {
    basePrompt = 'IMPORTANT: Use the FIRST reference for the girl\'s face ONLY. Use the SECOND reference for pose/vibe ONLY. Do NOT blend faces. ' + basePrompt;
  }

  const scenes = [
    basePrompt + ', happy couple moment, laughing together',
    basePrompt + ', intimate moment, looking into each other eyes',
    basePrompt + ', sad moment, looking away from each other',
  ];

  const imageRefs = poseRefUrl ? [girlRefUrl, poseRefUrl] : [girlRefUrl];
  const generatedImages = [];

  try {
    for (let i = 0; i < scenes.length; i++) {
      const imageUrl = await withRetry(async () => {
        const taskId = await kieGenerate(scenes[i], imageRefs);
        const url = await kiePoll(taskId);
        if (!url) throw new Error('Image ' + (i + 1) + ' returned no URL');
        return url;
      }, 'kie.ai multi-hook #' + (i + 1));

      const imgRes = await fetch(imageUrl);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      generatedImages.push({ url: imageUrl, base64: imgBuffer.toString('base64') });
    }

    const binaryData = {};
    generatedImages.forEach((img, i) => {
      binaryData['hookImage' + (i + 1)] = {
        data: img.base64,
        mimeType: 'image/png',
        fileName: 'hook_' + (i + 1) + '.png',
      };
    });

    return [{
      json: {
        hookReady: false,
        hookSource: 'ai_multi_image',
        hookImageUrls: generatedImages.map(i => i.url),
        hookPoseCategory: poseCategory,
        hookPoseRef: poseRefUrl || null,
        imageCount: generatedImages.length,
        chatId,
        scenarioName,
      },
      binary: binaryData,
    }];
  } catch (err) {
    return [{
      json: {
        hookReady: true,
        hookSource: 'fallback_blank',
        hookFailed: true,
        hookError: err.message,
        chatId,
        scenarioName,
        warning: '\u26A0\uFE0F Multi-image hook failed: ' + err.message + '. Skipping hook.',
      }
    }];
  }
}

// ═══════════════════════════════════════
// CHAT SCREENSHOT — Puppeteer screenshot of the chat conversation
// ═══════════════════════════════════════
if (hookType === 'chat_screenshot') {
  const scenarioJson = production.scenarioJson;
  if (!scenarioJson || !scenarioJson.chat) {
    return [{ json: { error: true, chatId, message: '\u274C No chat data in scenario for screenshot' } }];
  }

  try {
    const screenshotBuffer = await withRetry(async () => {
      const res = await fetch(SCREENSHOT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenarioJson),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error('Screenshot server ' + res.status + ': ' + errText);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) throw new Error('Screenshot too small (' + buffer.length + ' bytes)');
      return buffer;
    }, 'Screenshot server');

    return [{
      json: {
        hookReady: true,
        hookSource: 'chat_screenshot',
        chatId,
        scenarioName,
      },
      binary: {
        hookImage: {
          data: screenshotBuffer.toString('base64'),
          mimeType: 'image/png',
          fileName: 'hook_screenshot.png',
        }
      }
    }];
  } catch (err) {
    return [{
      json: {
        hookReady: true,
        hookSource: 'fallback_blank',
        hookFailed: true,
        hookError: err.message,
        chatId,
        scenarioName,
        warning: '\u26A0\uFE0F Screenshot server failed: ' + err.message + '. Skipping hook.',
      }
    }];
  }
}

// ═══════════════════════════════════════
// KLING LIPSYNC — Step 1: Generate original image with kie.ai
// Image gets approved on Telegram, then Img2Vid node converts via Kling Avatar V2
// ═══════════════════════════════════════
if (hookType === 'kling_lipsync') {
  if (!KIE_API_KEY) {
    return [{ json: { error: true, chatId, message: '❌ kie.ai API key not configured' } }];
  }

  const girlRefUrl = production.girlRefUrl || '';
  if (!girlRefUrl) {
    return [{ json: { error: true, chatId, message: '❌ No girl_ref_url configured on concept.' } }];
  }

  // Pose/style reference from Hook Girls catalog
  const poseCategory = selectPoseCategory(production);
  const poseRefUrl = pickPoseRef(poseCategory);

  try {
    let imagePrompt = production.hookImagePrompt || '';
    if (!imagePrompt || imagePrompt.length < 10) {
      // Lipsync hook = casual iPhone SELFIE taken by the girl herself, close-up face
      const poseGuide = poseRefUrl ? ', in the same pose and vibe as the second reference image' : '';
      const selfieScenes = [
        'Casual iPhone selfie of a girl lying in bed looking sad and upset, close-up face shot, messy hair, warm lamp lighting' + poseGuide,
        'iPhone selfie of a girl on the couch at night looking hurt and teary-eyed, close-up, dim living room lighting' + poseGuide,
        'Casual selfie of a girl sitting on the bathroom floor looking devastated, close-up face, harsh bathroom light' + poseGuide,
        'iPhone selfie of a girl lying on pillows looking disappointed and tired, close-up face, soft warm lighting' + poseGuide,
        'Selfie of a girl sitting at her desk at night looking upset, close-up face, screen glow on face, dark room' + poseGuide,
        'Casual iPhone selfie of a girl in her car looking sad, close-up face shot, natural daylight through window' + poseGuide,
      ];
      const scene = selfieScenes[Math.floor(Math.random() * selfieScenes.length)];
      const refGuide = poseRefUrl
        ? 'Use the FIRST reference for the girl\'s face ONLY. Use the SECOND reference for pose/vibe ONLY. Do NOT blend faces. '
        : '';
      imagePrompt = refGuide + scene + ', taken by herself, realistic candid photo, 9:16 vertical';
    } else if (poseRefUrl) {
      imagePrompt = 'Use the FIRST reference for the girl\'s face ONLY. Use the SECOND reference for pose/vibe ONLY. Do NOT blend faces. ' + imagePrompt;
    }

    const imageRefs = poseRefUrl ? [girlRefUrl, poseRefUrl] : [girlRefUrl];

    const generatedImageUrl = await withRetry(async () => {
      const taskId = await kieGenerate(imagePrompt, imageRefs);
      const url = await kiePoll(taskId);
      if (!url) throw new Error('kie.ai returned no image');
      return url;
    }, 'kie.ai hook for kling_lipsync');

    const imgRes = await fetch(generatedImageUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        hookReady: false, // needs Telegram approval → then Img2Vid (Kling Avatar)
        hookSource: 'kling_lipsync',
        hookImageUrl: generatedImageUrl,
        hookPromptUsed: imagePrompt,
        hookPromptSource: 'kie_ai',
        hookPoseCategory: poseCategory,
        hookPoseRef: poseRefUrl || null,
        envFrameUsed: false,
        chatId,
        scenarioName,
      },
      binary: {
        hookImage: {
          data: imgBuffer.toString('base64'),
          mimeType: 'image/png',
          fileName: 'hook_kling_lipsync.png',
        }
      }
    }];
  } catch (err) {
    return [{
      json: {
        hookReady: true,
        hookSource: 'fallback_blank',
        hookFailed: true,
        hookError: err.message,
        chatId,
        scenarioName,
        warning: '⚠️ Kling lipsync hook image failed: ' + err.message + '. Skipping hook.',
      }
    }];
  }
}

// ═══════════════════════════════════════
// KLING MOTION — Step 1: Generate original image with kie.ai
// Image gets approved on Telegram, then Img2Vid node converts via Seedance v1.5 Pro
// ═══════════════════════════════════════
if (hookType === 'kling_motion') {
  if (!KIE_API_KEY) {
    return [{ json: { error: true, chatId, message: '❌ kie.ai API key not configured' } }];
  }

  const girlRefUrl = production.girlRefUrl || '';
  if (!girlRefUrl) {
    return [{ json: { error: true, chatId, message: '❌ No girl_ref_url configured on concept.' } }];
  }

  // Pose/style reference from Hook Girls catalog
  const poseCategory = selectPoseCategory(production);
  const poseRefUrl = pickPoseRef(poseCategory);

  try {
    let imagePrompt = production.hookImagePrompt || '';
    if (!imagePrompt || imagePrompt.length < 10) {
      // Motion hook = candid photo taken by someone else, girl reading phone, NOT a selfie
      const vibeGuide = poseRefUrl ? ', with similar intimate bedroom vibe as the second reference image' : '';
      const candidScenes = [
        'Candid iPhone photo of a girl sitting on bed reading her phone with a worried expression, phone screen not visible' + vibeGuide,
        'Candid photo of a girl on the couch hunched over her phone looking upset, screen not visible, side angle' + vibeGuide,
        'Candid iPhone photo of a girl sitting on the floor against the wall reading her phone, concerned face, screen not visible' + vibeGuide,
        'Candid photo of a girl at a kitchen counter reading her phone looking hurt, screen not visible, natural light from window' + vibeGuide,
        'Candid iPhone photo of a girl sitting cross-legged on bed looking at her phone with a sad expression, screen not visible' + vibeGuide,
        'Candid photo of a girl lying sideways on couch reading her phone looking disappointed, screen not visible, dim room' + vibeGuide,
      ];
      const scene = candidScenes[Math.floor(Math.random() * candidScenes.length)];
      const refGuide = poseRefUrl
        ? 'Use the FIRST reference for the girl\'s face ONLY. Use the SECOND reference for setting/vibe ONLY. Do NOT blend faces. '
        : '';
      imagePrompt = refGuide + scene + ', not a selfie, photo taken by someone else, realistic, warm indoor lighting, 9:16 vertical';
    } else if (poseRefUrl) {
      imagePrompt = 'Use the FIRST reference for the girl\'s face ONLY. Use the SECOND reference for setting/vibe ONLY. Do NOT blend faces. ' + imagePrompt;
    }

    const imageRefs = poseRefUrl ? [girlRefUrl, poseRefUrl] : [girlRefUrl];

    const generatedImageUrl = await withRetry(async () => {
      const taskId = await kieGenerate(imagePrompt, imageRefs);
      const url = await kiePoll(taskId);
      if (!url) throw new Error('kie.ai returned no image');
      return url;
    }, 'kie.ai hook for kling_motion');

    const imgRes = await fetch(generatedImageUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        hookReady: false, // needs Telegram approval → then Img2Vid (Seedance)
        hookSource: 'kling_motion',
        hookImageUrl: generatedImageUrl,
        hookPromptUsed: imagePrompt,
        hookPromptSource: 'kie_ai',
        hookPoseCategory: poseCategory,
        hookPoseRef: poseRefUrl || null,
        envFrameUsed: false,
        chatId,
        scenarioName,
      },
      binary: {
        hookImage: {
          data: imgBuffer.toString('base64'),
          mimeType: 'image/png',
          fileName: 'hook_kling_motion.png',
        }
      }
    }];
  } catch (err) {
    return [{
      json: {
        hookReady: true,
        hookSource: 'fallback_blank',
        hookFailed: true,
        hookError: err.message,
        chatId,
        scenarioName,
        warning: '⚠️ Kling motion hook image failed: ' + err.message + '. Skipping hook.',
      }
    }];
  }
}

// Unknown hook type
return [{ json: { error: true, chatId, message: 'Unknown hook_type: ' + hookType } }];
