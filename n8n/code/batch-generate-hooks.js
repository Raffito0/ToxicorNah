// NODE: Batch Generate Hooks (Schedule Trigger — 8 AM CET / 6 AM UTC)
// Pre-generates Sora 2 hook videos during off-peak hours (5-15 CET = low error rate).
// Each 15s Sora 2 video = 5 × 3s hook segments stored in Hook Pool.
// /produce pulls from pool instantly instead of waiting for real-time Sora 2 generation.
//
// Cost: $0.025 per 15s video = $0.005 per hook. At 10 videos/day = 2 calls = $0.05/day.
//
// WIRING: Schedule Trigger (0 6 * * *) → this Code node
//
// Airtable tables:
//   - Video Concepts (tblhhTVI4EYofdY32) — source of concept configs
//   - Hook Pool (tbl3q91o3l0isSX9w) — stores pre-generated hook video segments
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
const KIE_API_KEY = '7670ade582cc72601f388dbdc0525b9e';
const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';
const APIMART_KEY = (typeof $env !== 'undefined' && $env.APIMART_API_KEY) || 'sk-kQeBOTjXlRbsutwcFSbjtDPmqLO5vZpFIFWkkW97WJYT5Y9l';
const APIMART_MODELS = ['sora-2', 'sora-2-vip'];
const TARGET_POOL_SIZE = 15; // maintain 15 available segments per concept (3 batches × 5)

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

async function sora2Generate(imageUrl, prompt, options = {}, chatId = '', botToken = '') {
  const BACKOFFS_SEC = [20, 35, 50, 60, 60, 60, 60, 60, 60, 60];
  const MAX_ROUNDS = 10;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roundLabel = (round + 1) + '/' + MAX_ROUNDS;
    console.log('[Batch Round ' + roundLabel + '] Submitting to ' + APIMART_MODELS.join(' + '));

    const submitResults = await Promise.allSettled(
      APIMART_MODELS.map(m => apimartSubmit(m, imageUrl, prompt, options))
    );

    const successes = submitResults.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (successes.length > 0) {
      console.log('[Batch Round ' + roundLabel + '] ' + successes[0].model + ' accepted!');
      return await apimartPoll(successes[0].taskId, successes[0].model);
    }

    const failures = submitResults.filter(r => r.status === 'rejected').map(r => r.reason.message || String(r.reason));
    console.log('[Batch Round ' + roundLabel + '] Both rejected: ' + failures.join(' | '));

    if (round < MAX_ROUNDS - 1) {
      const baseSec = BACKOFFS_SEC[round];
      const jitterSec = Math.floor(Math.random() * 21) - 10;
      const delaySec = Math.max(10, baseSec + jitterSec);
      console.log('[Batch Round ' + roundLabel + '] Retrying in ' + delaySec + 's...');

      if (botToken && chatId && round % 3 === 0) {
        try {
          await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '\u26A1 Batch Sora 2 retry ' + roundLabel + ', next in ' + delaySec + 's...' }),
          });
        } catch(e) { /* non-fatal */ }
      }

      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }

  throw new Error('Batch: all ' + MAX_ROUNDS + ' rounds failed');
}

// ─── Batch image prompt pools ───
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

// ─── Batch motion prompt pools (designed for 5 distinct 3s moments) ───
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

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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
      body: JSON.stringify({ chat_id: ADMIN_CHAT, text: '\uD83D\uDD04 Hook Pool batch starting...' }),
    });
  } catch(e) { /* non-fatal */ }
}

// 1. Get active concepts with kling_motion or kling_lipsync hook type
const conceptsFormula = encodeURIComponent("AND({is_active}=TRUE(),OR({hook_type}='kling_motion',{hook_type}='kling_lipsync'))");
const conceptsRes = await fetch(
  'https://api.airtable.com/v0/' + ABASE + '/' + CONCEPTS_TABLE + '?filterByFormula=' + conceptsFormula,
  { headers: { 'Authorization': 'Bearer ' + ATOKEN } }
);
if (!conceptsRes.ok) {
  return [{ json: { error: true, message: 'Failed to query concepts: ' + conceptsRes.status } }];
}
const concepts = (await conceptsRes.json()).records || [];
console.log('[batch] Found ' + concepts.length + ' active concepts with Sora 2 hooks');

// Also check sub_concepts_json for concepts that have kling variants
const allConcepts = [];
for (const c of concepts) {
  const hookType = c.fields.hook_type;
  const girlRefUrl = c.fields.girl_ref_url;
  if (!girlRefUrl) continue; // skip concepts without girl ref

  let subConcepts = c.fields.sub_concepts_json;
  if (typeof subConcepts === 'string') {
    try { subConcepts = JSON.parse(subConcepts); } catch(e) { subConcepts = null; }
  }

  // If sub-concepts exist, they may override hook_type per variant
  // For pool purposes, we generate based on the main hook_type
  if (hookType === 'kling_motion' || hookType === 'kling_lipsync') {
    allConcepts.push({
      recordId: c.id,
      conceptId: c.fields.concept_id,
      conceptName: c.fields.concept_name || c.fields.concept_id,
      hookType,
      girlRefUrl,
    });
  }
}

console.log('[batch] Processing ' + allConcepts.length + ' concepts');

const results = [];

for (const concept of allConcepts) {
  const { conceptId, conceptName, hookType, girlRefUrl } = concept;

  // 2. Check current pool level for this concept
  const poolFormula = encodeURIComponent("AND({status}='ready',{concept_id}='" + conceptId + "')");
  let totalAvailable = 0;
  try {
    const poolRes = await fetch(
      'https://api.airtable.com/v0/' + ABASE + '/' + HOOK_POOL_TABLE + '?filterByFormula=' + poolFormula,
      { headers: { 'Authorization': 'Bearer ' + ATOKEN } }
    );
    if (poolRes.ok) {
      const poolRecords = (await poolRes.json()).records || [];
      totalAvailable = poolRecords.reduce((sum, r) => sum + (r.fields.available_segments || 0), 0);
    }
  } catch(e) {
    console.log('[' + conceptId + '] Pool check error: ' + e.message);
  }

  if (totalAvailable >= TARGET_POOL_SIZE) {
    console.log('[' + conceptId + '] Pool sufficient: ' + totalAvailable + ' segments available, target: ' + TARGET_POOL_SIZE);
    results.push({ conceptId, status: 'sufficient', available: totalAvailable });
    continue;
  }

  const deficit = TARGET_POOL_SIZE - totalAvailable;
  const batchesNeeded = Math.ceil(deficit / 5);
  console.log('[' + conceptId + '] Pool deficit: ' + totalAvailable + '/' + TARGET_POOL_SIZE + ', generating ' + batchesNeeded + ' batch(es)');

  // 3. Generate batches for this concept
  for (let b = 0; b < batchesNeeded; b++) {
    const batchId = 'batch_' + new Date().toISOString().slice(0, 10) + '_' + conceptId + '_' + b;
    console.log('[' + batchId + '] Starting...');

    try {
      // a. Generate kie.ai image
      const imagePrompts = BATCH_IMAGE_PROMPTS[hookType] || BATCH_IMAGE_PROMPTS.kling_motion;
      const imagePrompt = pickRandom(imagePrompts);
      console.log('[' + batchId + '] Generating kie.ai image...');
      const taskId = await kieGenerate(imagePrompt, [girlRefUrl]);
      const sourceImageUrl = await kiePoll(taskId);
      console.log('[' + batchId + '] kie.ai image: ' + sourceImageUrl);

      // b. Generate Sora 2 video (15s)
      const motionPrompts = BATCH_MOTION_PROMPTS[hookType] || BATCH_MOTION_PROMPTS.kling_motion;
      const motionPrompt = pickRandom(motionPrompts);
      console.log('[' + batchId + '] Generating Sora 2 video (15s)...');
      const videoUrl = await sora2Generate(sourceImageUrl, motionPrompt, { duration: 15 }, ADMIN_CHAT, TBOT);
      console.log('[' + batchId + '] Sora 2 video: ' + videoUrl);

      // c. Create Hook Pool record with video attachment
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
            concept_id: conceptId,
            concept_name: conceptName,
            hook_type: hookType,
            girl_ref_url: girlRefUrl,
            source_image_url: sourceImageUrl,
            video_file: [{ url: videoUrl }], // Airtable downloads and stores permanently
            motion_prompt: motionPrompt,
            total_segments: 5,
            available_segments: 5,
            segments_json: JSON.stringify(segments),
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

      console.log('[' + batchId + '] Hook Pool record created with 5 segments');
      results.push({ conceptId, batchId, status: 'generated', segments: 5 });

      // Telegram notification per batch
      if (TBOT && ADMIN_CHAT) {
        try {
          await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT,
              text: '\u2705 Hook Pool: generated 5 hooks for "' + conceptName + '" (' + batchId + ')',
            }),
          });
        } catch(e) { /* non-fatal */ }
      }

      // Wait 30s between batches to avoid rate limiting
      if (b < batchesNeeded - 1) {
        await new Promise(r => setTimeout(r, 30000));
      }

    } catch (err) {
      console.log('[' + batchId + '] FAILED: ' + err.message);
      results.push({ conceptId, batchId, status: 'failed', error: err.message });

      // Telegram error notification
      if (TBOT && ADMIN_CHAT) {
        try {
          await fetch('https://api.telegram.org/bot' + TBOT + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT,
              text: '\u274C Hook Pool batch failed for "' + conceptName + '": ' + err.message.slice(0, 200),
            }),
          });
        } catch(e) { /* non-fatal */ }
      }
    }
  }

  // Wait 60s between concepts
  await new Promise(r => setTimeout(r, 60000));
}

// 4. Send summary
const generated = results.filter(r => r.status === 'generated');
const failed = results.filter(r => r.status === 'failed');
const sufficient = results.filter(r => r.status === 'sufficient');
const totalSegments = generated.reduce((sum, r) => sum + (r.segments || 0), 0);

const summary = '\uD83D\uDCCA Hook Pool Batch Complete\n' +
  '\u2705 Generated: ' + generated.length + ' batches (' + totalSegments + ' segments)\n' +
  (failed.length > 0 ? '\u274C Failed: ' + failed.length + ' batches\n' : '') +
  '\u2139\uFE0F Sufficient: ' + sufficient.length + ' concepts already stocked\n' +
  'Total concepts processed: ' + allConcepts.length;

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

return [{ json: { results, totalGenerated: generated.length, totalSegments, totalFailed: failed.length } }];
