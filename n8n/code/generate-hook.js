// NODE: Generate Hook (Self-Contained + Env Frame Extraction)
// Routes by hook type from concept config:
//   - manual_clip → pass through the already-uploaded hook clip file_id
//   - ai_image / ai_single_girl → extract env frame from 1st body clip → fal.ai
//   - ai_multi_image → fal.ai x3 images
//   - chat_screenshot → Puppeteer screenshot
//
// Self-contained: downloads first body clip from Telegram, extracts env frame,
// uploads to temp host, then uses [girl_ref, env_frame] as fal.ai references.
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

// ─── Temp image upload (0x0.st — no API key, 30+ day retention) ───
function uploadToTempHost(buffer, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const parts = [
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
      'Content-Type: image/png\r\n\r\n',
    ];
    const bodyBuf = Buffer.concat([
      Buffer.from(parts.join('')),
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
        if (url.startsWith('http')) resolve(url);
        else reject(new Error('0x0.st upload failed: ' + url.slice(0, 100)));
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

const KIE_API_KEY = '7670ade582cc72601f388dbdc0525b9e';
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';
const FAL_KEY = (typeof $env !== 'undefined' && $env.FAL_KEY) || '1f90e772-6c27-4772-9c31-9fb0efd2ccb7:e1ae20a74cf0ad9a5be03baefd1603e0';
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
  if (production.hookEmotionRule === 'always_sad') return 'cold_calculated';
  if (production.hookEmotionRule === 'always_shocked') return 'cold_calculated';
  const score = production.scenarioJson
    ? (production.scenarioJson.overallScore || production.scenarioJson.toxicityScore || 15)
    : 15;
  // Tier B = displayed toxicity 85–99 (overallScore 0–15): glacial, cold, frozen
  // Tier A = displayed toxicity 70–84 (overallScore 16–30): explosive, visible energy
  return score <= 15 ? 'cold_calculated' : 'explosive_control';
}

// Get a text description of the expression — emotion only, no furniture/position.
// TikTok viral formula: the girl doesn't look destroyed — she looks like she's about to say something.
// V2.0: separate pools for selfie (speaking) vs candid (reaction) energy.
// 80% pre-speech suffix, 20% micro-breath alternative to break pattern repetition.
function getPoseDescription(category, hookType) {
  // 80% pre-speech / 20% micro-breath variation — prevents "always lips parting" pattern
  const microBreathAlts = [
    'inhales slightly through nose',
    'tongue briefly presses against inner lip',
    'swallows once before reacting',
  ];
  const useMicroBreath = Math.random() < 0.20;
  const breathSuffix = useMicroBreath
    ? microBreathAlts[Math.floor(Math.random() * microBreathAlts.length)]
    : 'lips slightly parting as if about to speak';

  const isSelfie = hookType === 'speaking';

  const pools = {
    // Tier B — Glacial / Cold Calculated (displayed toxicity 85–99)
    cold_calculated: {
      selfie: [
        // Core — frozen energy, direct eye contact into camera
        'frozen stare, direct eye contact, completely still, eyes cold and intense, slight lean toward camera, ' + breathSuffix,
        'slow controlled expression, slight deadpan smirk forming, direct gaze into camera, like she already knows exactly what to say, ' + breathSuffix,
        'eyes locked directly at camera, micro head tilt, emotionless except for jaw slightly set, ' + breathSuffix,
        'cold unreadable face looking straight into camera, one eyebrow barely raised, long pause before reaction, ' + breathSuffix,
        // Secondary
        'composed but visibly restraining herself, direct camera gaze, lips pressed tight, anticipation of speaking, ' + breathSuffix,
        'blank stare into the camera, processing, ' + breathSuffix,
        // Rare
        'quiet, almost amused realization, eyes narrowing slightly while looking directly at camera, like she already knew',
      ],
      candid: [
        // Core — internal energy, eyes slightly off-camera
        'frozen expression, eyes slightly off-camera, completely still, reacting internally to what she just read, ' + breathSuffix,
        'slow controlled expression, slight deadpan smirk, looking past the phone, like she already knows exactly what to say, ' + breathSuffix,
        'eyes slightly past camera, micro head tilt, emotionless except for jaw slightly set, processing internally, ' + breathSuffix,
        'cold unreadable face, eyes looking just past the lens, one eyebrow barely raised, processing what she read, ' + breathSuffix,
        // Secondary
        'composed but visibly restraining herself, gaze slightly off-camera, reacting internally before looking up, ' + breathSuffix,
        'blank stare away from camera, reacting internally, ' + breathSuffix,
        // Rare
        'quiet, almost amused realization, eyes narrowing slightly, looking past the phone, like she already knew',
      ],
    },
    // Tier A — Explosive Control (displayed toxicity 70–84)
    explosive_control: {
      selfie: [
        // Core — visible energy, direct camera
        'jaw tight, direct eye contact, short sharp exhale visible, barely containing it, ' + breathSuffix,
        'eyebrow raised with a micro head tilt, looking directly at camera, "really?" sarcastic energy, ' + breathSuffix,
        'quick disbelief blink, direct gaze into camera, lips pressed then parting, "I cannot believe this" expression, ' + breathSuffix,
        'restrained fury in jaw and eyes, slight lean toward camera, controlled breath, on the verge of responding, ' + breathSuffix,
        // Secondary
        'composed disappointed look, direct camera gaze, quiet before the storm, ' + breathSuffix,
        'done with it energy, eyes snapping up direct to camera, ' + breathSuffix,
        // Rare
        'confused hurt expression, brows furrowed, looking directly at camera, taken aback, not yet ready to react',
      ],
      candid: [
        // Core — contained energy, eyes off-camera
        'jaw tight, eyes slightly off-camera, short sharp exhale visible, barely containing it, ' + breathSuffix,
        'eyebrow raised with a micro head tilt, looking past the phone, "really?" energy, ' + breathSuffix,
        'quick disbelief blink, eyes looking away briefly then back, "I cannot believe this" expression, ' + breathSuffix,
        'restrained fury in jaw and eyes, reacting internally, controlled breath, ' + breathSuffix,
        // Secondary
        'composed disappointed look, eyes slightly off-camera, quiet before the storm, ' + breathSuffix,
        'done with it energy, eyes glancing to the side then refocusing, ' + breathSuffix,
        // Rare
        'confused hurt expression, brows furrowed, looking past the phone, processing internally',
      ],
    },
  };
  const categoryPool = pools[category] || pools.explosive_control;
  const pool = isSelfie ? categoryPool.selfie : categoryPool.candid;
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

// ─── kie.ai nano-banana-2 (async: createTask → poll) ───
async function kieGenerate(prompt, imageRefs, options = {}) {
  const { aspectRatio = '9:16', resolution = '2K', timeOfDay = 'day', isSelfie = false } = options;
  const lighting = timeOfDay === 'night' ? 'nighttime' : 'daytime';
  const imperfections = [
    'natural uneven posture', 'one shoulder slightly higher than the other',
    'subtle natural skin texture', 'slight under-eye shadow', 'pillow slightly creased beside her',
  ];
  const imperfectionSuffix = Math.random() < 0.40
    ? ', ' + imperfections[Math.floor(Math.random() * imperfections.length)] : '';
  const phoneClause = isSelfie ? 'no phone visible in frame, hands relaxed'
    : 'if holding a phone it must be a black iPhone XS';
  const finalPrompt = prompt + ', maintain exact facial features from reference, ' + phoneClause + ', ' + lighting +
    ', shot on iPhone 13 Pro, no background blur, no bokeh, sharp background throughout, no color grading, raw UGC phone footage style' + imperfectionSuffix;
  const res = await fetch(KIE_API_URL + '/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KIE_API_KEY },
    body: JSON.stringify({
      model: 'nano-banana-2',
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

// ─── fal.ai nano-banana-2 (synchronous — no polling needed) ───
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

// ─── generateImage: kie.ai primary → fal.ai fallback ───
async function generateImage(prompt, imageRefs, options = {}) {
  try {
    console.log('[imageGen] Trying kie.ai...');
    const taskId = await kieGenerate(prompt, imageRefs, options);
    const url = await kiePoll(taskId);
    if (!url) throw new Error('kie.ai returned no image URL');
    console.log('[imageGen] kie.ai OK: ' + url);
    return url;
  } catch (kieErr) {
    console.log('[imageGen] kie.ai failed: ' + kieErr.message + ' — falling back to fal.ai');
    const url = await falGenerate(prompt, imageRefs, options);
    console.log('[imageGen] fal.ai fallback OK: ' + url);
    return url;
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
function buildHookPromptFallback(production, hasEnvFrame, poseDesc, timeOfDay, hookTypeHint) {
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
  const defaultEnv = (timeOfDay === 'night') ? 'bedroom, nighttime, dim lamp light' : 'bedroom, natural daylight lighting';
  const envDesc = hasEnvFrame
    ? 'in the same room as the environment frame'
    : (production.environmentDescription || defaultEnv);

  // Angle logic tied to hookType — never use wide shot (reduces hook intensity)
  let angles;
  if (hookTypeHint === 'speaking') {
    // Selfie = close-up only
    angles = [
      'Close-up shot from slightly above, looking down at',
      'Close-up shot, straight on, of',
    ];
  } else {
    // Candid / other = side angles, no wide room shot
    angles = [
      'Side profile shot from 45 degrees, showing',
      'Close-up shot from slightly above, looking down at',
      'Medium shot from the side, showing',
    ];
  }
  const angle = angles[Math.floor(Math.random() * angles.length)];

  const poseText = poseDesc ? ' ' + poseDesc + ',' : '';

  return angle + ' a girl sitting on ' + furniture + ', ' + envDesc +
    '. She is hunched forward over her phone,' + poseText + ' ' + emotion +
    ' expression. Realistic, candid, shot on iPhone 13 Pro, 9:16 vertical';
}
// ─── Hook Pool helpers (pre-generated Sora 2 hooks for instant /produce) ───
const HOOK_POOL_TABLE = 'tbl3q91o3l0isSX9w';

async function checkHookPool(scenarioRecordId, phoneId, conceptId) {
  const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
  if (!ATOKEN || (!scenarioRecordId && !conceptId)) return null;

  const ABASE = 'appsgjIdkpak2kaXq';
  // Try concept_id first (batch generator), fallback to scenario_id (legacy)
  const idFilter = conceptId
    ? "{concept_id}='" + conceptId + "'"
    : "{scenario_id}='" + scenarioRecordId + "'";
  // Search with phone_id first, then fallback to shared clips (no phone_id)
  const queries = [];
  if (phoneId) {
    queries.push("{status}='ready'," + idFilter + ",{phone_id}='" + phoneId + "'");
  }
  // Also try clips without phone_id (shared pool from batch generator)
  queries.push("{status}='ready'," + idFilter + ",{phone_id}=BLANK()");
  // Legacy: clips without phone_id field at all
  queries.push("{status}='ready'," + idFilter);

  try {
    let data = null;
    for (const q of queries) {
      const formula = encodeURIComponent("AND(" + q + ")");
      const res = await fetch(
        'https://api.airtable.com/v0/' + ABASE + '/' + HOOK_POOL_TABLE + '?filterByFormula=' + formula + '&maxRecords=1',
        { headers: { 'Authorization': 'Bearer ' + ATOKEN } }
      );
      if (!res.ok) continue;
      const d = await res.json();
      if (d.records && d.records.length > 0) { data = d; break; }
    }
    if (!data || !data.records || data.records.length === 0) return null;

    const record = data.records[0];
    const fields = record.fields;
    const videoFiles = fields.video_file;
    if (!Array.isArray(videoFiles) || videoFiles.length === 0) return null;

    return {
      recordId: record.id,
      videoUrl: videoFiles[0].url,
      hookText: fields.hook_text || '',
      sourceImageUrl: fields.source_image_url || '',
      hookType: fields.hook_type || 'speaking', // 'speaking' or 'reaction'
    };
  } catch(e) {
    console.log('[Hook Pool] Check error: ' + e.message);
    return null;
  }
}

async function markPoolUsed(recordId, usedByRunId) {
  const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
  if (!ATOKEN) return;

  const ABASE = 'appsgjIdkpak2kaXq';
  try {
    await fetch('https://api.airtable.com/v0/' + ABASE + '/' + HOOK_POOL_TABLE + '/' + recordId, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + ATOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          status: 'used',
          used_by_run_id: usedByRunId || '',
          used_at: new Date().toISOString(),
        }
      }),
    });
  } catch(e) {
    console.log('[Hook Pool] Mark used error: ' + e.message);
  }
}

// ─── End helpers ───

const production = $('Prepare Production').first().json;
const hookType = production.effectiveHookType || production.hookType;
const chatId = production.chatId;
const scenarioName = production.scenarioName;
const timeOfDay = production.timeOfDay || 'day'; // 'night' | 'day' — from /produce command

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
  if (!KIE_API_KEY && !FAL_KEY) {
    return [{ json: { error: true, chatId, message: 'No image gen API key configured' } }];
  }

  const girlRefUrl = production.phoneGirlRefUrl || production.girlRefUrl || '';
  if (!girlRefUrl) {
    return [{ json: { error: true, chatId, message: 'No girl_ref_url configured on concept.' } }];
  }

  // Pose/style reference — text description (image refs cause kie.ai 422 from catbox.moe)
  const poseCategory = selectPoseCategory(production);
  const poseDesc = getPoseDescription(poseCategory, hookType);

  // Use AI-generated prompt from upstream Agent, fallback to template
  let hookPrompt = (AI_GENERATED_PROMPT && AI_GENERATED_PROMPT.length > 20) ? AI_GENERATED_PROMPT : null;
  const promptSource = hookPrompt ? 'deepseek' : 'template';
  if (!hookPrompt) {
    hookPrompt = buildHookPromptFallback(production, false, poseDesc, timeOfDay, hookType);
  } else {
    // Append pose description to AI-generated prompt
    hookPrompt = hookPrompt + ', ' + poseDesc;
  }

  // Image references: girl face ref only (pose handled via text description)
  const imageRefs = [girlRefUrl];

  try {
    const result = await withRetry(async () => {
      const imageUrl = await generateImage(hookPrompt, imageRefs, { timeOfDay });
      if (!imageUrl) throw new Error('Image gen returned no image');
      return imageUrl;
    }, 'hook image');

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
        hookPoseDesc: poseDesc,
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
  if (!KIE_API_KEY && !FAL_KEY) {
    return [{ json: { error: true, chatId, message: 'No image gen API key configured' } }];
  }

  const girlRefUrl = production.phoneGirlRefUrl || production.girlRefUrl || '';

  // Pose/style reference — text description (same for all 3 scenes for consistency)
  const poseCategory = selectPoseCategory(production);
  const poseDesc = getPoseDescription(poseCategory, hookType);

  let basePrompt = (AI_GENERATED_PROMPT && AI_GENERATED_PROMPT.length > 20) ? AI_GENERATED_PROMPT : null;
  if (!basePrompt) {
    basePrompt = buildHookPromptFallback(production, false, poseDesc, timeOfDay, hookType);
  } else {
    basePrompt = basePrompt + ', ' + poseDesc;
  }

  const scenes = [
    basePrompt + ', happy couple moment, laughing together',
    basePrompt + ', intimate moment, looking into each other eyes',
    basePrompt + ', sad moment, looking away from each other',
  ];

  // Image references: girl face ref only
  const imageRefs = [girlRefUrl];
  const generatedImages = [];

  try {
    for (let i = 0; i < scenes.length; i++) {
      const imageUrl = await withRetry(async () => {
        const url = await generateImage(scenes[i], imageRefs, { timeOfDay });
        if (!url) throw new Error('Image ' + (i + 1) + ' returned no URL');
        return url;
      }, 'multi-hook image #' + (i + 1));

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
        hookPoseDesc: poseDesc,
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
// HOOK POOL CHECK — instant hook from pre-generated pool (no AI calls needed)
// V3: clips are pre-trimmed 3s with baked ElevenLabs VO audio. No FFmpeg needed.
// Query by scenario_id (each clip is linked to a specific scenario's hookText).
// ═══════════════════════════════════════
if (hookType === 'reaction' || hookType === 'speaking') {
  const scenarioRecordId = production.scenarioRecordId || '';

  if (scenarioRecordId) {
    const poolResult = await checkHookPool(scenarioRecordId, production.phoneId || '', production.conceptId || '');
    if (poolResult) {
      console.log('[Hook Pool] Found pre-generated clip for scenario ' + scenarioRecordId + ': ' + poolResult.recordId);

      try {
        // Download 3s clip directly (already trimmed)
        // Speaking clips have audio baked in; reaction clips are silent
        const vidRes = await fetch(poolResult.videoUrl);
        if (!vidRes.ok) throw new Error('Video download failed: ' + vidRes.status);
        const videoBuffer = Buffer.from(await vidRes.arrayBuffer());

        // Determine hookSource based on pool clip's hook_type
        // 'pool' = speaking (has baked audio) → VO skipped, assemble uses embedded audio
        // 'pool_reaction' = reaction (silent) → VO still needed, assemble overlays VO
        const poolHookSource = poolResult.hookType === 'speaking' ? 'pool' : 'pool_reaction';

        // Mark clip as used
        const runRecordId = (() => { try { return $('Create Video Run').first().json.id; } catch(e) { return 'unknown'; } })();
        await markPoolUsed(poolResult.recordId, runRecordId);

        // Auto-approve hook in Video Run (skip Telegram approval flow)
        const ATOKEN_POOL = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
        if (ATOKEN_POOL && runRecordId !== 'unknown') {
          try {
            await fetch('https://api.airtable.com/v0/appsgjIdkpak2kaXq/tbltCYcVXrLYvyIJL/' + runRecordId, {
              method: 'PATCH',
              headers: { 'Authorization': 'Bearer ' + ATOKEN_POOL, 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { hook_approval: 'approved', hook_vid_approval: 'approved' } }),
            });
          } catch(e) { /* non-fatal */ }
        }

        // Notify user
        const poolLabel = poolResult.hookType === 'speaking' ? '(speaking, audio baked)' : '(reaction, silent)';
        if (TELEGRAM_BOT_TOKEN && chatId) {
          try {
            await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: '\u26A1 Hook from pool ' + poolLabel + ' \u2014 instant, no AI wait!' }),
            });
          } catch(e) { /* non-fatal */ }
        }

        return [{
          json: {
            hookReady: true,
            hookSource: poolHookSource,
            hookPoolRecordId: poolResult.recordId,
            hookImageUrl: poolResult.sourceImageUrl,
            chatId,
            scenarioName,
          },
          binary: {
            hookVideo: {
              data: videoBuffer.toString('base64'),
              mimeType: 'video/mp4',
              fileName: 'hook_pool.mp4',
            }
          }
        }];
      } catch (poolErr) {
        console.log('[Hook Pool] Error consuming pool hook: ' + poolErr.message + ' \u2014 falling through to normal generation');
      }
    } else {
      console.log('[Hook Pool] No pool clip for scenario ' + scenarioRecordId + ' \u2014 generating on-demand');
    }
  }
  // No pool available or pool error → fall through to normal on-demand generation below
}

// ═══════════════════════════════════════
// SPEAKING HOOK — Step 1: Generate original image with fal.ai
// Image gets approved on Telegram, then Img2Vid node converts via Sora 2 (speaking)
// ═══════════════════════════════════════
if (hookType === 'speaking') {
  if (!KIE_API_KEY && !FAL_KEY) {
    return [{ json: { error: true, chatId, message: '❌ No image gen API key configured' } }];
  }

  const girlRefUrl = production.phoneGirlRefUrl || production.girlRefUrl || '';
  if (!girlRefUrl) {
    return [{ json: { error: true, chatId, message: '❌ No girl_ref_url configured on concept.' } }];
  }

  // Pose/style reference — selfie energy (direct eye contact, slight lean toward camera)
  const poseCategory = selectPoseCategory(production);
  const poseDesc = getPoseDescription(poseCategory, 'speaking');

  try {
    let imagePrompt = production.hookImagePrompt || '';
    if (!imagePrompt || imagePrompt.length < 10) {
      // Lipsync hook = casual iPhone SELFIE, close-up face, direct camera gaze
      const selfieScenes = [
        'iPhone 13 Pro selfie of a girl lying in bed, close-up face from slightly above, direct eye contact with camera, natural room lighting',
        'iPhone 13 Pro selfie of a girl on the couch, close-up face, straight on, direct camera gaze, natural indoor lighting',
        'iPhone 13 Pro selfie of a girl lying on pillows, close-up face from slightly above, slight lean toward camera, neutral lighting',
        'iPhone 13 Pro selfie of a girl sitting at her desk, close-up face, subtle laptop glow, looking directly into camera',
      ];
      const scene = selfieScenes[Math.floor(Math.random() * selfieScenes.length)];
      imagePrompt = scene + ', ' + poseDesc + ', taken by herself, realistic candid photo, 9:16 vertical';
    } else {
      imagePrompt = imagePrompt + ', ' + poseDesc;
    }

    // Context anchor phrase — always appended, anchors the scene narratively
    const contextAnchors = [
      'after reading a shocking message',
      'right after seeing the text',
      'in the moment she realizes what it says',
    ];
    imagePrompt = imagePrompt + ', ' + contextAnchors[Math.floor(Math.random() * contextAnchors.length)];

    // Image references: girl face ref only
    const imageRefs = [girlRefUrl];

    const generatedImageUrl = await withRetry(async () => {
      const url = await generateImage(imagePrompt, imageRefs, { timeOfDay, isSelfie: true });
      if (!url) throw new Error('Image gen returned no image');
      return url;
    }, 'speaking hook image');

    const imgRes = await fetch(generatedImageUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        hookReady: false, // needs Telegram approval → then Img2Vid (Sora 2)
        hookSource: 'speaking',
        hookImageUrl: generatedImageUrl,
        hookPromptUsed: imagePrompt,
        hookPromptSource: 'fal_ai',
        hookPoseCategory: poseCategory,
        hookPoseDesc: poseDesc,
        envFrameUsed: false,
        chatId,
        scenarioName,
      },
      binary: {
        hookImage: {
          data: imgBuffer.toString('base64'),
          mimeType: 'image/png',
          fileName: 'hook_speaking.png',
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
        warning: '⚠️ Speaking hook image failed: ' + err.message + '. Skipping hook.',
      }
    }];
  }
}

// ═══════════════════════════════════════
// REACTION HOOK — Step 1: Generate original image with fal.ai
// Image gets approved on Telegram, then Img2Vid node converts via Sora 2 (reaction)
// ═══════════════════════════════════════
if (hookType === 'reaction') {
  if (!KIE_API_KEY && !FAL_KEY) {
    return [{ json: { error: true, chatId, message: '❌ No image gen API key configured' } }];
  }

  const girlRefUrl = production.phoneGirlRefUrl || production.girlRefUrl || '';
  if (!girlRefUrl) {
    return [{ json: { error: true, chatId, message: '❌ No girl_ref_url configured on concept.' } }];
  }

  // Pose/style reference — candid energy (eyes slightly off-camera, internal reaction)
  const poseCategory = selectPoseCategory(production);
  const poseDesc = getPoseDescription(poseCategory, 'reaction');

  try {
    let imagePrompt = production.hookImagePrompt || '';
    if (!imagePrompt || imagePrompt.length < 10) {
      // Motion hook = candid photo, side/45-degree angle, NOT a selfie — no wide shots
      const candidScenes = [
        'Candid iPhone 13 Pro photo of a girl sitting on bed, side angle, phone held up after reading a message, screen not visible, mid shot',
        'Candid photo of a girl on the couch, 45 degree angle, leaning slightly forward over her phone, screen not visible',
        'Candid iPhone 13 Pro photo of a girl sitting on the floor against the wall, side profile angle, phone light on her face, screen not visible',
        'Candid iPhone 13 Pro photo of a girl sitting cross-legged on bed, shot from the side, phone just lowered after reading, screen not visible',
        'Candid photo of a girl lying sideways on couch, 45 degree shot from front, phone in hand, just finished reading, screen not visible, dim room',
      ];
      const scene = candidScenes[Math.floor(Math.random() * candidScenes.length)];
      imagePrompt = scene + ', ' + poseDesc + ', not a selfie, photo taken by someone else, realistic, natural indoor lighting, 9:16 vertical';
    } else {
      imagePrompt = imagePrompt + ', ' + poseDesc;
    }

    // Context anchor phrase — always appended, anchors the scene narratively
    const contextAnchors = [
      'after reading a shocking message',
      'right after seeing the text',
      'in the moment she realizes what it says',
    ];
    imagePrompt = imagePrompt + ', ' + contextAnchors[Math.floor(Math.random() * contextAnchors.length)];

    // Image references: girl face ref only
    const imageRefs = [girlRefUrl];

    const generatedImageUrl = await withRetry(async () => {
      const url = await generateImage(imagePrompt, imageRefs, { timeOfDay });
      if (!url) throw new Error('Image gen returned no image');
      return url;
    }, 'reaction hook image');

    const imgRes = await fetch(generatedImageUrl);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    return [{
      json: {
        hookReady: false, // needs Telegram approval → then Img2Vid (Seedance)
        hookSource: 'reaction',
        hookImageUrl: generatedImageUrl,
        hookPromptUsed: imagePrompt,
        hookPromptSource: 'fal_ai',
        hookPoseCategory: poseCategory,
        hookPoseDesc: poseDesc,
        envFrameUsed: false,
        chatId,
        scenarioName,
      },
      binary: {
        hookImage: {
          data: imgBuffer.toString('base64'),
          mimeType: 'image/png',
          fileName: 'hook_reaction.png',
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
        warning: '⚠️ Reaction hook image failed: ' + err.message + '. Skipping hook.',
      }
    }];
  }
}

// Unknown hook type
return [{ json: { error: true, chatId, message: 'Unknown hook_type: ' + hookType } }];
