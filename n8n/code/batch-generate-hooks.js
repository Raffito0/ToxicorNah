// NODE: Batch Generate Hooks (Schedule Trigger — 8 AM CET / 6 AM UTC)
// Pre-generates Sora 2 hook videos during off-peak hours (5-15 CET = low error rate).
// Each 15s Sora 2 video = 5 × 3s hook segments stored in Hook Pool.
// /produce pulls from pool instantly instead of waiting for real-time Sora 2 generation.
//
// LOGIC:
//   1. Weighted random pick of concept (batch_weight field on Concepts table)
//   2. Weighted random pick of sub_concept within that concept (weight in sub_concepts_json)
//   3. For ALL active phones in parallel: generate unique kie.ai image + Sora 2 video
//   4. If Sora 2 fails, retry persistently (same combo) — never skip
//   5. Repeat for BATCHES_PER_RUN rounds
//
// Cost: $0.025 per 15s video = $0.005 per hook. At 3 phones × 3 rounds = 9 videos = $0.225/run.
//
// WIRING: Schedule Trigger (0 6 * * *) → this Code node
//
// Airtable tables:
//   - Video Concepts (tblhhTVI4EYofdY32) — source of concept configs + batch_weight
//   - Hook Pool (tbl3q91o3l0isSX9w) — stores pre-generated hook video segments
//   - Phones (tblCvT47GpZv29jz9) — active phones with girl_ref_url
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

// ─── Config ───
const ABASE = 'appsgjIdkpak2kaXq';
const CONCEPTS_TABLE = 'tblhhTVI4EYofdY32';
const HOOK_POOL_TABLE = 'tbl3q91o3l0isSX9w';
const PHONES_TABLE = 'tblCvT47GpZv29jz9';
const KIE_API_KEY = '7670ade582cc72601f388dbdc0525b9e';
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';
const APIMART_KEY = (typeof $env !== 'undefined' && $env.APIMART_API_KEY) || 'sk-kQeBOTjXlRbsutwcFSbjtDPmqLO5vZpFIFWkkW97WJYT5Y9l';
const APIMART_MODELS = ['sora-2', 'sora-2-vip'];
const BATCHES_PER_RUN = 3; // rounds per scheduled execution
const SORA2_RETRY_COOLDOWN_SEC = 120; // wait between full retry cycles when Sora 2 is down

// ─── kie.ai image generation ───
async function kieGenerate(prompt, imageRefs, options = {}) {
  const { timeOfDay = 'day' } = options;
  const lighting = timeOfDay === 'night' ? 'nighttime' : 'daytime';
  const finalPrompt = prompt + ', maintain exact facial features from reference, ' + lighting + ', shot on iPhone 13 Pro, no background blur, no bokeh, sharp background throughout, no color grading, raw UGC phone footage style';
  const res = await fetch(KIE_API_URL + '/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KIE_API_KEY },
    body: JSON.stringify({
      model: 'nano-banana-2',
      input: { prompt: finalPrompt, image_input: imageRefs, aspect_ratio: '9:16', resolution: '2K', output_format: 'png' },
    }),
  });
  if (!res.ok) throw new Error('kie.ai createTask: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  if (data.code !== 200) throw new Error('kie.ai: ' + JSON.stringify(data));
  return data.data.taskId;
}

async function kiePoll(taskId) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await new Promise(r => setTimeout(r, 5000));
      const res = await fetch(KIE_API_URL + '/recordInfo?taskId=' + taskId, {
        headers: { 'Authorization': 'Bearer ' + KIE_API_KEY },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const state = data.data?.state;
      if (state === 'success') return JSON.parse(data.data.resultJson).resultUrls?.[0];
      if (state === 'fail') throw new Error(data.data.failMsg || 'kie.ai generation failed');
    } catch (err) {
      if (err.message.includes('failed') || err.message.includes('Generation')) throw err;
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

// ─── APIMart Sora 2 ───
async function apimartSubmit(model, imageUrl, prompt, options = {}) {
  const { duration = 15 } = options;
  const reqBody = { model, prompt, duration, aspect_ratio: '9:16', watermark: false, private: true };
  if (imageUrl) reqBody.image_urls = [imageUrl];
  const submitRes = await fetch('https://api.apimart.ai/v1/videos/generations', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + APIMART_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  const bodyText = await submitRes.text();
  if (!submitRes.ok) throw new Error('[' + model + '] HTTP ' + submitRes.status + ': ' + bodyText.slice(0, 300));
  let submitData;
  try { submitData = JSON.parse(bodyText); } catch(e) { throw new Error('[' + model + '] Invalid JSON'); }
  if (submitData.code !== 200 || !submitData.data?.[0]?.task_id) {
    throw new Error('[' + model + '] No task_id: ' + bodyText.slice(0, 300));
  }
  return { taskId: submitData.data[0].task_id, model };
}

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
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      const taskData = statusData.data || {};
      const st = taskData.status || '';
      if (pollCount % 3 === 0) console.log('[batch ' + model + ' #' + pollCount + '] ' + st + ' (' + (taskData.progress || 0) + '%)');
      if (st === 'completed') {
        const videos = taskData.result?.videos;
        if (videos?.[0]?.url?.[0]) return videos[0].url[0];
        throw new Error('[' + model + '] Completed but no video URL');
      }
      if (st === 'failed' || st === 'cancelled') throw new Error('[' + model + '] Task ' + st);
    } catch (err) {
      if (err.message.includes('failed') || err.message.includes('cancelled') || err.message.includes('no video URL')) throw err;
    }
  }
  throw new Error('[' + model + '] Poll timeout');
}

// Single attempt at Sora 2 (10 submit rounds with backoff)
async function sora2Attempt(imageUrl, prompt, options = {}) {
  const BACKOFFS_SEC = [20, 35, 50, 60, 60, 60, 60, 60, 60, 60];
  const MAX_ROUNDS = 10;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roundLabel = (round + 1) + '/' + MAX_ROUNDS;
    const submitResults = await Promise.allSettled(
      APIMART_MODELS.map(m => apimartSubmit(m, imageUrl, prompt, options))
    );

    const successes = submitResults.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (successes.length > 0) {
      console.log('[Sora2 Round ' + roundLabel + '] ' + successes[0].model + ' accepted');
      return await apimartPoll(successes[0].taskId, successes[0].model);
    }

    const failures = submitResults.filter(r => r.status === 'rejected').map(r => r.reason.message || String(r.reason));
    console.log('[Sora2 Round ' + roundLabel + '] Both rejected: ' + failures.join(' | '));

    if (round < MAX_ROUNDS - 1) {
      const baseSec = BACKOFFS_SEC[round];
      const jitterSec = Math.floor(Math.random() * 21) - 10;
      const delaySec = Math.max(10, baseSec + jitterSec);
      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }

  throw new Error('Sora 2: all ' + MAX_ROUNDS + ' rounds failed');
}

// Persistent Sora 2: retries indefinitely until success (bounded only by n8n execution timeout)
async function sora2Persistent(imageUrl, prompt, options = {}, label = '', botToken = '', chatId = '') {
  let cycle = 0;
  while (true) {
    cycle++;
    try {
      return await sora2Attempt(imageUrl, prompt, options);
    } catch (err) {
      console.log('[' + label + '] Sora 2 cycle ' + cycle + ' failed: ' + err.message);
      console.log('[' + label + '] Retrying in ' + SORA2_RETRY_COOLDOWN_SEC + 's...');

      if (botToken && chatId && cycle % 2 === 0) {
        try {
          await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '\u26A1 Batch ' + label + ': Sora 2 retry cycle ' + (cycle + 1) + '...' }),
          });
        } catch(e) { /* non-fatal */ }
      }

      await new Promise(r => setTimeout(r, SORA2_RETRY_COOLDOWN_SEC * 1000));
    }
  }
}

// ─── Batch image prompt pools ───
// speaking = kling_lipsync (selfie, direct gaze), reaction = kling_motion (candid, phone reading)
const BATCH_IMAGE_PROMPTS = {
  kling_motion: [
    'Candid iPhone 13 Pro photo of a girl sitting on bed, 45 degree side angle, holding phone still, screen not visible, medium shot, frozen expression, jaw slightly set, realistic, natural indoor lighting, 9:16 vertical',
    'Candid iPhone 13 Pro photo of a girl on couch, side angle, phone in hand, screen not visible, medium-close shot, blank unreadable expression, natural daylight, 9:16 vertical',
    'Candid iPhone 13 Pro photo of a girl sitting cross-legged on bed, shot from the side, phone just lowered, screen not visible, pensive expression, natural room lighting, 9:16 vertical',
    'Candid iPhone 13 Pro photo of a girl lying sideways on couch, 45 degree shot, phone in hand, just finished reading, screen not visible, dim room, realistic, 9:16 vertical',
  ],
  kling_lipsync: [
    'iPhone 13 Pro selfie of a girl lying in bed, close-up face from slightly above, direct eye contact with camera, frozen stare, natural room lighting, realistic candid, 9:16 vertical',
    'iPhone 13 Pro selfie of a girl on couch, close-up face, straight on, direct camera gaze, unreadable expression, natural indoor lighting, realistic, 9:16 vertical',
    'iPhone 13 Pro selfie of a girl lying on pillows, close-up face, slight lean toward camera, blank expression, neutral lighting, realistic candid, 9:16 vertical',
  ],
};

// ─── Batch motion prompt pools ───
const BATCH_MOTION_PROMPTS = {
  kling_motion: [
    'Locked off tripod shot, static camera, continuous uncut 15-second shot — girl sitting on bed holding phone still, not typing, screen not visible. She cycles through distinct micro-reactions: completely motionless with one slow blink, jaw subtly tightens, micro head tilt with eyes narrowing, brief eye-widen then settle, controlled exhale with lips pressing. Each reaction separated by moments of stillness. No tears, dry eyes, no text, no watermark, no subtitles',
    'Locked off tripod shot, static camera, continuous uncut 15-second shot — girl sitting on couch holding phone still, not typing, screen not visible. Subtle shifting reactions: frozen stare, slight head shake, jaw tightens then relaxes, eyes briefly look away then refocus, one slow controlled blink. Natural rhythm between reactions. No tears, dry eyes, no text, no watermark, no subtitles',
    'Locked off tripod shot, static camera, continuous uncut 15-second shot — girl on bed with phone, not typing, screen not visible. Series of contained reactions: blank expression then micro eyebrow raise, slight lean forward, eyes narrow briefly, jaw sets with controlled breath, head tilts slightly. Each beat is distinct. No tears, dry eyes, no text, no watermark, no subtitles',
  ],
  kling_lipsync: [
    'Close-up selfie angle, direct camera gaze, continuous uncut 15-second shot — girl looking directly at camera with subtle shifting micro-expressions: frozen stare with slow blink, slight head tilt with jaw tightening, eyes narrow with one eyebrow raised, slow controlled breath with lips parting slightly, direct intense gaze with jaw set. Each expression natural and unhurried. No text, no watermark, no subtitles',
    'Close-up selfie angle, direct camera gaze, continuous uncut 15-second shot — girl looking into camera with evolving reactions: completely still then micro blink, deadpan smirk forming, eyes widening slightly, controlled exhale through nose, head tilts with narrowed eyes. Natural pace. No text, no watermark, no subtitles',
  ],
};

// Aliases: speaking→lipsync prompts, reaction→motion prompts
BATCH_IMAGE_PROMPTS.speaking = BATCH_IMAGE_PROMPTS.kling_lipsync;
BATCH_IMAGE_PROMPTS.reaction = BATCH_IMAGE_PROMPTS.kling_motion;
BATCH_MOTION_PROMPTS.speaking = BATCH_MOTION_PROMPTS.kling_lipsync;
BATCH_MOTION_PROMPTS.reaction = BATCH_MOTION_PROMPTS.kling_motion;

// ─── Utility functions ───
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Pick N unique items from array (shuffled). If N > arr.length, allows repeats.
function pickUniqueN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  if (n <= arr.length) return shuffled.slice(0, n);
  // More phones than prompts: fill with unique first, then random extras
  const result = [...shuffled];
  while (result.length < n) result.push(pickRandom(arr));
  return result;
}

// Weighted random selection
function weightedPick(items, weightFn) {
  const totalWeight = items.reduce((sum, item) => sum + weightFn(item), 0);
  if (totalWeight <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * totalWeight;
  for (const item of items) {
    r -= weightFn(item);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

// ═══════════════════════════════════════
// Main batch logic
// ═══════════════════════════════════════

const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
const TBOT = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
const ADMIN_CHAT = (typeof $env !== 'undefined' && $env.ADMIN_CHAT_ID) || '5120450288';

if (!ATOKEN) {
  return [{ json: { error: true, message: 'AIRTABLE_API_KEY not set' } }];
}

// Send start notification
if (TBOT && ADMIN_CHAT) {
  try {
    await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT, text: '\uD83D\uDD04 Hook Pool batch starting (' + BATCHES_PER_RUN + ' rounds)...' }),
    });
  } catch(e) { /* non-fatal */ }
}

// 1. Get active phones
const phonesRes = await fetch(
  'https://api.airtable.com/v0/' + ABASE + '/' + PHONES_TABLE + '?filterByFormula=' + encodeURIComponent("{is_active}=TRUE()"),
  { headers: { 'Authorization': 'Bearer ' + ATOKEN } }
);
const activePhones = phonesRes.ok ? ((await phonesRes.json()).records || []).map(r => ({
  phoneId: r.fields.phone_id,
  phoneName: r.fields.phone_name,
  girlRefUrl: r.fields.girl_ref_url,
})).filter(p => p.girlRefUrl) : [];

if (activePhones.length === 0) {
  return [{ json: { error: true, message: 'No active phones with girl_ref_url' } }];
}
console.log('[batch] Found ' + activePhones.length + ' active phones');

// 2. Get active concepts with batch_weight
const SORA2_HOOK_TYPES = ['kling_motion', 'kling_lipsync', 'speaking', 'reaction'];
const conceptsRes = await fetch(
  'https://api.airtable.com/v0/' + ABASE + '/' + CONCEPTS_TABLE + '?filterByFormula=' + encodeURIComponent("{is_active}=TRUE()"),
  { headers: { 'Authorization': 'Bearer ' + ATOKEN } }
);
if (!conceptsRes.ok) {
  return [{ json: { error: true, message: 'Failed to query concepts: ' + conceptsRes.status } }];
}
const conceptRecords = (await conceptsRes.json()).records || [];

// Build concept list with Sora 2 sub_concepts and their weights
const activeConcepts = [];
for (const c of conceptRecords) {
  const conceptId = c.fields.concept_id;
  const conceptName = c.fields.concept_name || conceptId;
  const batchWeight = Number(c.fields.batch_weight) || 100; // default weight = 100

  // Collect Sora 2 hook types from main + sub_concepts with weights
  const sora2SubConcepts = [];
  const mainHookType = c.fields.hook_type;
  if (SORA2_HOOK_TYPES.includes(mainHookType)) {
    sora2SubConcepts.push({ hookType: mainHookType, weight: 100 });
  }

  let subConcepts = c.fields.sub_concepts_json;
  if (typeof subConcepts === 'string') {
    try { subConcepts = JSON.parse(subConcepts); } catch(e) { subConcepts = null; }
  }
  if (Array.isArray(subConcepts)) {
    for (const sc of subConcepts) {
      if (sc.enabled !== false && SORA2_HOOK_TYPES.includes(sc.hook_type)) {
        sora2SubConcepts.push({
          hookType: sc.hook_type,
          weight: Number(sc.weight) || 100, // default sub_concept weight = 100
        });
      }
    }
  }

  if (sora2SubConcepts.length === 0) continue;

  activeConcepts.push({
    recordId: c.id,
    conceptId,
    conceptName,
    batchWeight,
    sora2SubConcepts,
  });
}

if (activeConcepts.length === 0) {
  return [{ json: { error: true, message: 'No active concepts with Sora 2 hook types' } }];
}

console.log('[batch] ' + activeConcepts.length + ' concept(s) with Sora 2 hooks: ' +
  activeConcepts.map(c => c.conceptName + ' (w=' + c.batchWeight + ', subs=' + c.sora2SubConcepts.length + ')').join(', '));

// 3. Run batch rounds
const results = [];

for (let round = 0; round < BATCHES_PER_RUN; round++) {
  const roundLabel = 'Round ' + (round + 1) + '/' + BATCHES_PER_RUN;
  console.log('\n[' + roundLabel + '] ─────────────────────');

  // a. Weighted pick of concept
  const concept = weightedPick(activeConcepts, c => c.batchWeight);
  console.log('[' + roundLabel + '] Concept: ' + concept.conceptName + ' (w=' + concept.batchWeight + ')');

  // b. Weighted pick of sub_concept (hook type)
  const subConcept = weightedPick(concept.sora2SubConcepts, sc => sc.weight);
  const hookType = subConcept.hookType;
  console.log('[' + roundLabel + '] Hook type: ' + hookType + ' (w=' + subConcept.weight + ')');

  // c. Pick unique prompts for each phone
  const imagePromptPool = BATCH_IMAGE_PROMPTS[hookType] || BATCH_IMAGE_PROMPTS.kling_motion;
  const motionPromptPool = BATCH_MOTION_PROMPTS[hookType] || BATCH_MOTION_PROMPTS.kling_motion;
  const imagePrompts = pickUniqueN(imagePromptPool, activePhones.length);
  const motionPrompts = pickUniqueN(motionPromptPool, activePhones.length);

  // d. Generate for ALL phones in parallel
  const batchId = 'batch_' + new Date().toISOString().slice(0, 10) + '_' + concept.conceptId + '_' + hookType + '_r' + round;

  const phoneResults = await Promise.allSettled(
    activePhones.map(async (phone, idx) => {
      const phoneLabel = batchId + '/' + phone.phoneId;
      const imagePrompt = imagePrompts[idx];
      const motionPrompt = motionPrompts[idx];

      // Step 1: Generate kie.ai image
      console.log('[' + phoneLabel + '] Generating kie.ai image...');
      const taskId = await kieGenerate(imagePrompt, [phone.girlRefUrl]);
      const sourceImageUrl = await kiePoll(taskId);
      console.log('[' + phoneLabel + '] kie.ai image ready');

      // Step 2: Generate Sora 2 video (persistent retry)
      console.log('[' + phoneLabel + '] Generating Sora 2 video (15s)...');
      const videoUrl = await sora2Persistent(sourceImageUrl, motionPrompt, { duration: 15 }, phoneLabel, TBOT, ADMIN_CHAT);
      console.log('[' + phoneLabel + '] Sora 2 video ready');

      // Step 3: Save to Hook Pool
      const segments = Array.from({ length: 5 }, (_, i) => ({
        index: i,
        start: i * 3,
        duration: 3,
        status: 'available',
      }));

      const createBody = JSON.stringify({
        records: [{
          fields: {
            batch_id: batchId,
            concept_id: concept.conceptId,
            concept_name: concept.conceptName,
            hook_type: hookType,
            girl_ref_url: phone.girlRefUrl,
            source_image_url: sourceImageUrl,
            video_file: [{ url: videoUrl }],
            motion_prompt: motionPrompt,
            total_segments: 5,
            available_segments: 5,
            segments_json: JSON.stringify(segments),
            phone_id: phone.phoneId,
            status: 'ready',
            created_at: new Date().toISOString(),
          },
        }],
      });

      const createRes = await fetch(
        'https://api.airtable.com/v0/' + ABASE + '/' + HOOK_POOL_TABLE,
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + ATOKEN, 'Content-Type': 'application/json' },
          body: createBody,
        }
      );

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error('Airtable create failed: ' + createRes.status + ' ' + errText.slice(0, 200));
      }

      console.log('[' + phoneLabel + '] Saved to Hook Pool (5 segments)');
      return { phoneId: phone.phoneId, segments: 5 };
    })
  );

  // Collect results for this round
  const roundSuccesses = [];
  const roundFailures = [];
  for (let i = 0; i < phoneResults.length; i++) {
    const pr = phoneResults[i];
    if (pr.status === 'fulfilled') {
      roundSuccesses.push(pr.value);
    } else {
      roundFailures.push({ phoneId: activePhones[i].phoneId, error: pr.reason.message || String(pr.reason) });
    }
  }

  const totalSegs = roundSuccesses.reduce((s, r) => s + r.segments, 0);
  results.push({
    round: round + 1,
    conceptId: concept.conceptId,
    hookType,
    batchId,
    generated: roundSuccesses.length,
    failed: roundFailures.length,
    segments: totalSegs,
    failures: roundFailures,
  });

  // Telegram notification per round
  if (TBOT && ADMIN_CHAT) {
    const msg = roundFailures.length > 0
      ? '\u26A0\uFE0F ' + roundLabel + ': ' + concept.conceptName + '/' + hookType + ' — ' + roundSuccesses.length + '/' + activePhones.length + ' phones OK (' + totalSegs + ' clips)\nFailed: ' + roundFailures.map(f => f.phoneId).join(', ')
      : '\u2705 ' + roundLabel + ': ' + concept.conceptName + '/' + hookType + ' — ' + activePhones.length + ' phones, ' + totalSegs + ' clips generated';
    try {
      await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_CHAT, text: msg }),
      });
    } catch(e) { /* non-fatal */ }
  }

  // Wait between rounds
  if (round < BATCHES_PER_RUN - 1) {
    console.log('[batch] Waiting 30s before next round...');
    await new Promise(r => setTimeout(r, 30000));
  }
}

// 4. Send summary
const totalGenerated = results.reduce((s, r) => s + r.generated, 0);
const totalSegments = results.reduce((s, r) => s + r.segments, 0);
const totalFailed = results.reduce((s, r) => s + r.failed, 0);

const summary = '\uD83D\uDCCA Hook Pool Batch Complete\n' +
  'Rounds: ' + BATCHES_PER_RUN + '\n' +
  'Phones: ' + activePhones.length + '\n' +
  '\u2705 Generated: ' + totalGenerated + ' videos (' + totalSegments + ' clips)\n' +
  (totalFailed > 0 ? '\u274C Failed: ' + totalFailed + ' videos\n' : '') +
  '\nBreakdown:\n' +
  results.map(r => '  R' + r.round + ': ' + r.conceptId + '/' + r.hookType + ' — ' + r.generated + ' ok' +
    (r.failed > 0 ? ', ' + r.failed + ' failed' : '')).join('\n');

console.log(summary);

if (TBOT && ADMIN_CHAT) {
  try {
    await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT, text: summary }),
    });
  } catch(e) { /* non-fatal */ }
}

return [{ json: { results, totalGenerated, totalSegments, totalFailed } }];
