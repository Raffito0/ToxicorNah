// NODE: Prepare Production (Dynamic â€” reads concept, template, music from Airtable)
// Consolidates all loaded data into a production plan
// Mode: Run Once for All Items
//
// WIRING: Find Music â†’ this Code node â†’ Produce Error? â†’ Create Video Run â†’ Generate Hook
// References: $('Parse Message'), $('Find Scenario (Produce)'), $('Find Concept'),
//             $('Find Body Clips'), $('Find Template'), $('Find Music')

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
          statusText: res.statusMessage || '',
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

const AIRTABLE_BASE = 'https://api.airtable.com/v0/appsgjIdkpak2kaXq';
const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';

// Helper: "toxic-sad-happy-girl-1771197483216" â†’ "Toxic Sad Happy Girl"
function formatName(raw) {
  if (!raw) return 'Scenario';
  return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const chatId = $('Parse Message').first().json.chatId;
const timeOfDay = $('Parse Message').first().json.timeOfDay || 'day'; // 'night' | 'day'

// â€”â€”â€” Phone lookup (by telegram_chat_id â†’ Phones table) â€”â€”â€”
let phoneId = '', phoneName = '', phoneRecordId = '';
let phoneVoiceId = '', phoneGirlRefUrl = '';
if (chatId && ATOKEN) {
  try {
    const pFilter = encodeURIComponent("{telegram_chat_id}='" + chatId + "'");
    const pRes = await fetch(
      AIRTABLE_BASE + '/tblCvT47GpZv29jz9?filterByFormula=' + pFilter + '&maxRecords=1',
      { headers: { 'Authorization': 'Bearer ' + ATOKEN } }
    );
    const pData = await pRes.json();
    if (pData.records && pData.records.length > 0) {
      const pr = pData.records[0];
      phoneId = pr.fields.phone_id || '';
      phoneName = pr.fields.phone_name || '';
      phoneRecordId = pr.id;
      phoneVoiceId = pr.fields.elevenlabs_voice_id || '';
      phoneGirlRefUrl = pr.fields.girl_ref_url || '';
      console.log('[prepare] Phone matched: ' + phoneName + ' (' + phoneId + ')');
    } else {
      console.log('[prepare] No phone found for chatId ' + chatId + ' â€” using defaults');
    }
  } catch (e) {
    console.log('[prepare] Phone lookup failed: ' + e.message);
  }
}

// â€”â€”â€” Scenario â€”â€”â€”
const scenarioItems = $('Find Scenario (Produce)').all().map(i => i.json);
if (scenarioItems.length === 0 || !scenarioItems[0].id) {
  return [{
    json: {
      error: true,
      chatId,
      message: '\u26A0\uFE0F Nessuno scenario pronto (status=ready) trovato.',
    }
  }];
}

const scenario = scenarioItems[0];
const scenarioName = scenario.scenario_name;

let scenarioJson = scenario.scenario_json;
if (typeof scenarioJson === 'string') {
  try { scenarioJson = JSON.parse(scenarioJson); } catch(e) { scenarioJson = null; }
}

let copyJson = scenario.generated_copy_json;
if (typeof copyJson === 'string') {
  try { copyJson = JSON.parse(copyJson); } catch(e) { copyJson = null; }
}

// â€”â€”â€” Concept config â€”â€”â€”
const conceptItems = $('Find Concept').all().map(i => i.json);
const concept = conceptItems.length > 0 && conceptItems[0].id ? conceptItems[0] : {};
const hookType = concept.hook_type || 'chat_screenshot';
const girlRefUrl = concept.girl_ref_url || '';
const hookPromptTemplate = concept.hook_prompt_template || '';
const outroPromptTemplate = concept.outro_prompt_template || '';
const hookEmotionRule = concept.hook_emotion_rule || 'match_toxicity';
const girlStylePrompt = concept.girl_style_prompt || '';
const environmentDescription = concept.environment_description || '';
const environmentFurniture = concept.environment_furniture || '';
const hookImageSystemPrompt = concept.hook_image_system_prompt || '';
const outroImageSystemPrompt = concept.outro_image_system_prompt || '';
const hookImagePromptSpeaking = concept.hook_image_prompt_speaking || concept.hook_image_prompt || '';
const hookImagePromptReaction = concept.hook_image_prompt_reaction || concept.hook_image_prompt || '';
const sora2SpeakingPrompt = concept.sora2_speaking_prompt || '';
const sora2ReactionPrompt = concept.sora2_reaction_prompt || '';

// Outro pool: parse JSON, weighted random selection
let selectedOutro = { type: 'none' };
let outroPoolRaw = concept.outro_pool_json;
if (typeof outroPoolRaw === 'string') {
  try { outroPoolRaw = JSON.parse(outroPoolRaw); } catch(e) { outroPoolRaw = null; }
}
if (Array.isArray(outroPoolRaw) && outroPoolRaw.length > 0) {
  const enabled = outroPoolRaw.filter(o => o.enabled !== false);
  if (enabled.length > 0) {
    const totalWeight = enabled.reduce((s, o) => s + (o.weight || 1), 0);
    let rand = Math.random() * totalWeight;
    for (const opt of enabled) {
      rand -= (opt.weight || 1);
      if (rand <= 0) { selectedOutro = opt; break; }
    }
    if (selectedOutro.type === undefined) selectedOutro = enabled[0];
  }
}

// â€”â€”â€” Sub-concept selection (for concepts with variants like sad-happy-girl) â€”â€”â€”
let selectedSubconcept = null;
let effectiveHookType = hookType;
let effectiveOutroType = selectedOutro.type;
let hookRefImageUrl = girlRefUrl;
let outroRefImageUrl = girlRefUrl;
let hookKlingPrompt = '';
let outroKlingPrompt = '';
let hookKlingDuration = null;

let subconceptsRaw = concept.sub_concepts_json;
if (typeof subconceptsRaw === 'string') {
  try { subconceptsRaw = JSON.parse(subconceptsRaw); } catch(e) { subconceptsRaw = null; }
}

if (Array.isArray(subconceptsRaw) && subconceptsRaw.length > 0) {
  const enabledSc = subconceptsRaw.filter(sc => sc.enabled !== false);
  if (enabledSc.length > 0) {
    // Weighted random selection (same algo as outro pool)
    const totalScWeight = enabledSc.reduce((s, sc) => s + (sc.weight || 1), 0);
    let scRand = Math.random() * totalScWeight;
    for (const sc of enabledSc) {
      scRand -= (sc.weight || 1);
      if (scRand <= 0) { selectedSubconcept = sc; break; }
    }
    if (!selectedSubconcept) selectedSubconcept = enabledSc[0];

    // Override hook/outro types from sub-concept
    effectiveHookType = selectedSubconcept.hook_type || hookType;
    effectiveOutroType = selectedSubconcept.outro_type || selectedOutro.type;
    hookKlingPrompt = selectedSubconcept.hook_prompt || '';
    outroKlingPrompt = selectedSubconcept.outro_prompt || '';

    // Randomize motion prompts for reaction (candid, not selfie) â€” V2.0
    if (selectedSubconcept.hook_type === 'reaction' && !hookKlingPrompt) {
      // STRATEGY: phone is always HELD STILL â€” she is REACTING, not actively operating it.
      // V2.0: two separate pools (cold_calculated vs explosive_control) + eye focus randomization.

      // Determine poseCategory from toxicity score (mirrors generate-hook.js logic)
      let poseCategory = 'cold_calculated';
      if (hookEmotionRule !== 'always_sad' && hookEmotionRule !== 'always_shocked') {
        const sc = scenarioJson ? (scenarioJson.overallScore || scenarioJson.toxicityScore || 15) : 15;
        poseCategory = sc <= 15 ? 'cold_calculated' : 'explosive_control';
      }

      // Weighted eye focus randomizer â€” micro saccade language (humans do this, AI doesn't)
      const eyeFocusOpts = [
        { weight: 40, text: 'eyes naturally settling forward, brief micro saccade before focusing' },
        { weight: 30, text: 'eyes slightly past camera, micro saccade then settle' },
        { weight: 20, text: 'eyes briefly downward then naturally shift forward' },
        { weight: 10, text: 'eyes naturally drift to side then refocus forward' },
      ];
      function pickEyeFocus() {
        const total = eyeFocusOpts.reduce((s, o) => s + o.weight, 0);
        let r = Math.random() * total;
        for (const opt of eyeFocusOpts) { r -= opt.weight; if (r <= 0) return opt.text; }
        return eyeFocusOpts[0].text;
      }

      // Cold pool â€” glacial, minimal, physical micro-action (85â€“99% toxic tier)
      const coldMotionPool = [
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, remains completely still for a moment, blinks once slowly, jaw subtly tightens, {EYE}, no tears, dry eyes',
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, barely tilts chin forward, breath steady and controlled, minimal movement, {EYE}, no tears, dry eyes',
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, micro eyebrow lift, no other visible movement, {EYE}, no tears, dry eyes',
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, holds completely still, slow controlled exhale through nose, {EYE}, no tears, dry eyes',
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, slight head tilt, expression unreadable, stillness dominates, {EYE}, no tears, dry eyes',
      ];

      // Explosive pool â€” contained physical tension (70â€“84% toxic tier)
      const explosiveMotionPool = [
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, sharp short exhale, jaw tightens briefly, {EYE}, no tears, dry eyes',
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, quick blink of disbelief, minimal head shift, {EYE}, no tears, dry eyes',
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, subtle head shake once, lips press then relax, {EYE}, no tears, dry eyes',
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, eyes widen slightly before narrowing, {EYE}, no tears, dry eyes',
        'Locked off tripod shot, static camera â€” she is sitting holding her phone still, not typing, visible tension in jaw and neck, small breath reset, {EYE}, no tears, dry eyes',
      ];

      // 15% energy contrast injection â€” deliberately mismatches tier for human feel
      const useContrast = Math.random() < 0.15;
      const motionPool = (poseCategory === 'cold_calculated' && !useContrast) ? coldMotionPool : explosiveMotionPool;

      // Pick prompt and inject randomized eye focus
      const rawPrompt = motionPool[Math.floor(Math.random() * motionPool.length)];
      hookKlingPrompt = rawPrompt.replace('{EYE}', pickEyeFocus());

    }
    hookKlingDuration = selectedSubconcept.hook_duration || null;

    // Seedance v1.5 Pro only supports '5' and '10' â€” leave null to use SEEDANCE_DURATION default

    // Image prompts for kie.ai (generate original images each time)
    // These override the AI-generated prompt or fallback template in generate-hook/outro
    // hook_ref_field / outro_ref_field are optional for pre-made refs (not used with kie.ai generation)
    if (selectedSubconcept.hook_ref_field && concept[selectedSubconcept.hook_ref_field]) {
      let urls = concept[selectedSubconcept.hook_ref_field];
      if (typeof urls === 'string') { try { urls = JSON.parse(urls); } catch(e) { urls = [urls]; } }
      if (Array.isArray(urls) && urls.length > 0) hookRefImageUrl = urls[Math.floor(Math.random() * urls.length)];
    }
    if (selectedSubconcept.outro_ref_field && concept[selectedSubconcept.outro_ref_field]) {
      let urls = concept[selectedSubconcept.outro_ref_field];
      if (typeof urls === 'string') { try { urls = JSON.parse(urls); } catch(e) { urls = [urls]; } }
      if (Array.isArray(urls) && urls.length > 0) outroRefImageUrl = urls[Math.floor(Math.random() * urls.length)];
    }
  }
}

// â€”â€”â€” Outro Category Override (from Workflow 1 copyJson) â€”â€”â€”
// outroCategory is set during scenario generation: 'organic', 'app_store', 'cta_lipsync'
const outroCategory = (copyJson && copyJson.outroCategory) || 'organic';

if (outroCategory === 'app_store') {
  // App store clip â€” override whatever the outro pool selected
  selectedOutro = { type: 'app_store_clip', label: 'app_store', weight: 0 };
  effectiveOutroType = 'app_store_clip';
} else if (outroCategory === 'cta_lipsync') {
  // Sora 2 speaking video â€” override outro type
  effectiveOutroType = 'speaking';
}
// 'organic' â†’ keep existing outro_pool_json selection (no override)

// â€”â€”â€” Body clips (from Find Body Clips, includes all clip types) â€”â€”â€”
// Deduplicate: n8n runs Airtable query once per upstream input item, `.all()` accumulates duplicates
const _rawClips = $('Find Body Clips').all().map(i => i.json);
const _seenIds = new Set();
const clipRecords = _rawClips.filter(c => {
  if (!c.id || _seenIds.has(c.id)) return false;
  _seenIds.add(c.id);
  return true;
});
if (clipRecords.length === 0 || !clipRecords[0].id) {
  return [{
    json: {
      error: true,
      chatId,
      message: '\u26A0\uFE0F Nessuna body clip trovata per "' + formatName(scenarioName) + '". Registra prima le clip.',
    }
  }];
}

// â€”â€”â€” Template (from Airtable, fallback to hardcoded Standard) â€”â€”â€”
const templateItems = $('Find Template').all().map(i => i.json);
let template;
if (templateItems.length > 0 && templateItems[0].id) {
  const tpl = templateItems[0];
  let segments = tpl.segments_json;
  if (typeof segments === 'string') {
    try { segments = JSON.parse(segments); } catch(e) { segments = null; }
  }
  if (Array.isArray(segments)) {
    template = {
      segments,
      totalDuration: tpl.total_duration_sec || segments.reduce((s, seg) => s + seg.duration, 0),
    };
  }
}
// Fallback: hardcoded Standard template (mirrors Airtable "Standard" template)
if (!template) {
  template = {
    segments: [
      { section: 'hook', duration: 3.0 },
      { section: 'screenshot', duration: 1.0 },
      { section: 'upload_chat', duration: 1.0 },
      { section: 'toxic_score', duration: 3.0 },
      { section: 'soul_type', duration: 3.0 },
      { section: 'deep_dive', duration: 3.0 },
      { section: 'outro', duration: 3.0 },
    ],
    totalDuration: 17.0,
  };
}

// â€”â€”â€” Music (random pick from active tracks) â€”â€”â€”
const musicItems = $('Find Music').all().map(i => i.json);
let musicTrack = null;
if (musicItems.length > 0 && musicItems[0].id) {
  const pick = musicItems[Math.floor(Math.random() * musicItems.length)];
  // Attachment URL from Airtable (valid ~2h), fallback to manual track_url
  const attachUrl = Array.isArray(pick.track_file) && pick.track_file.length > 0
    ? pick.track_file[0].url
    : null;
  musicTrack = {
    trackName: pick.track_name,
    fileUrl: attachUrl || pick.track_url,
    telegramFileId: pick.telegram_file_id,
    bpm: pick.bpm || 120,
    mood: pick.mood,
    durationSec: pick.duration_sec,
  };
}

// â€”â€”â€” Sort and map body clips â€”â€”â€”
const bodyClips = clipRecords
  .filter(c => c.clip_type === 'body' || !c.clip_type)
  .sort((a, b) => {
    // Primary: sort by clip_index
    const idxDiff = (a.clip_index || 0) - (b.clip_index || 0);
    if (idxDiff !== 0) return idxDiff;
    // Secondary: prefer clips with known duration (duration > 0 = valid file, 0 = possibly corrupt)
    return (b.clip_duration_sec || 0) - (a.clip_duration_sec || 0);
  })
  .map(clip => ({
    clipIndex: clip.clip_index,
    section: clip.section || 'body_' + clip.clip_index,
    fileId: clip.telegram_file_id,
    duration: clip.clip_duration_sec || 0,
    clipName: clip.clip_name,
  }));

// Map clips to template body segments
// Body clip sections use different names than template (e.g. chat_upload vs upload_chat)
const SECTION_ALIASES = {
  'chat_upload': 'upload_chat',
  'score_reveal': 'toxic_score',
  'soul_type_card': 'soul_type',
  'decoded_insight': 'deep_dive',
};
const bodySegments = template.segments.filter(s => s.section !== 'hook' && s.section !== 'outro');
// Match exactly 1 clip per template body segment (prevents duplicate clip explosion)
// Template defines the video structure â€” we never include more clips than segments
const usedClipIndices = new Set();
const clipMapping = bodySegments.map(seg => {
  const matchIdx = bodyClips.findIndex((clip, idx) => {
    if (usedClipIndices.has(idx)) return false;
    const normalized = SECTION_ALIASES[clip.section] || clip.section;
    return normalized === seg.section || clip.section === seg.section;
  });
  if (matchIdx < 0) return null; // no clip for this segment â€” skip
  usedClipIndices.add(matchIdx);
  const clip = bodyClips[matchIdx];
  return {
    section: clip.section, // keep original name for caption matching in assemble
    targetDuration: seg.duration,
    fileId: clip.fileId,
    actualDuration: clip.duration || 0,
  };
}).filter(Boolean);

// Hook clip (for manual_clip type)
const hookClips = clipRecords.filter(c => c.clip_type === 'hook_manual');
const hookClipFileId = hookClips.length > 0 ? hookClips[0].telegram_file_id : '';
const hookClipDuration = hookClips.length > 0 ? hookClips[0].clip_duration_sec : 0;

// Outro clip (for manual_clip type)
const outroClips = clipRecords.filter(c => c.clip_type === 'outro_manual');
const outroClipFileId = outroClips.length > 0 ? outroClips[0].telegram_file_id : '';
const outroClipDuration = outroClips.length > 0 ? outroClips[0].clip_duration_sec : 0;

return [{
  json: {
    scenarioName,
    displayName: formatName(scenarioName),
    chatId,
    hookType,
    selectedOutro,
    scenarioJson,
    copyJson,
    template,
    bodyClips,
    clipMapping,
    musicTrack,
    scenarioRecordId: scenario.id,
    hookText: scenario.generated_hook_text || '',
    hookClipFileId,
    hookClipDuration,
    outroClipFileId,
    outroClipDuration,
    girlRefUrl,
    hookPromptTemplate,
    outroPromptTemplate,
    hookEmotionRule,
    girlStylePrompt,
    environmentDescription,
    environmentFurniture,
    hookImageSystemPrompt,
    outroImageSystemPrompt,
    // Sub-concept & Kling fields
    selectedSubconcept,
    effectiveHookType,
    effectiveOutroType,
    hookRefImageUrl,
    outroRefImageUrl,
    hookKlingPrompt,
    outroKlingPrompt,
    hookKlingDuration,
    // Image prompts for kie.ai generation (mode-specific, sub-concept overrides)
    hookImagePrompt: selectedSubconcept && selectedSubconcept.hook_image_prompt
      ? selectedSubconcept.hook_image_prompt
      : (effectiveHookType === 'speaking' ? hookImagePromptSpeaking : hookImagePromptReaction),
    outroImagePrompt: selectedSubconcept ? (selectedSubconcept.outro_image_prompt || '') : '',
    // Sora 2 prompt templates (from Airtable â€” used by img-to-video.js)
    sora2SpeakingPrompt,
    sora2ReactionPrompt,
    // Outro category from Workflow 1 (organic, app_store, cta_lipsync)
    outroCategory,
    // Time of day for hook/outro image generation lighting
    timeOfDay,
    // Phone context (multi-phone support)
    phoneId,
    phoneName,
    phoneRecordId,
    phoneVoiceId,
    phoneGirlRefUrl,
    // Concept ID for Hook Pool lookup
    conceptId: concept.concept_id || '',
  }
}];
