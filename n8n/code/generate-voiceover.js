// NODE: Generate Voiceover via Fish.audio (Per-Segment)
// Generates SEPARATE audio for each video section that has VO text.
// Sections without VO (screenshot, upload_chat) get silence.
// Copy JSON structure: { hookVO, bodyClips: [{ vo }], outroVO }
// Template segments: [{ section, duration }, ...]
// Self-healing: retries 1x per segment, skips failed segments
// Mode: Run Once for All Items
//
// WIRING: Hook Approved? ' this Code node ' VO Needs Approval? ' Send VO Segments

const fs = require('fs');
const { execSync } = require('child_process');

// """ fetch polyfill (n8n Code node sandbox lacks global fetch) """
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

// """ Temp file upload with multi-host fallback """
// Tries 0x0.st ' catbox.moe ' tmpfiles.org in sequence
function upload0x0(buffer, filename, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const bodyBuf = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: ' + mimeType + '\r\n\r\n'),
      buffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const req = _https.request({
      hostname: '0x0.st', path: '/', method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': bodyBuf.length },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const url = Buffer.concat(chunks).toString().trim();
        if (url.startsWith('https://')) resolve(url);
        else reject(new Error('0x0.st: ' + url.substring(0, 100)));
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

function uploadCatbox(buffer, filename, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const bodyBuf = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n'),
      Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="fileToUpload"; filename="' + filename + '"\r\nContent-Type: ' + mimeType + '\r\n\r\n'),
      buffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const req = _https.request({
      hostname: 'catbox.moe', path: '/user/api.php', method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': bodyBuf.length },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const url = Buffer.concat(chunks).toString().trim();
        if (url.startsWith('https://')) resolve(url);
        else reject(new Error('catbox.moe: ' + url.substring(0, 100)));
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

function uploadTmpfiles(buffer, filename, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const bodyBuf = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: ' + mimeType + '\r\n\r\n'),
      buffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const req = _https.request({
      hostname: 'tmpfiles.org', path: '/api/v1/upload', method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': bodyBuf.length },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          // tmpfiles returns: {"status":"success","data":{"url":"https://tmpfiles.org/1234/file.mp3"}}
          // Direct download needs /dl/ inserted: https://tmpfiles.org/dl/1234/file.mp3
          if (json.status === 'success' && json.data && json.data.url) {
            const dlUrl = json.data.url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
            resolve(dlUrl);
          } else {
            reject(new Error('tmpfiles.org: ' + JSON.stringify(json).substring(0, 100)));
          }
        } catch(e) { reject(new Error('tmpfiles.org parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

async function uploadToTempHost(buffer, filename, mimeType = 'audio/mpeg') {
  // catbox.moe first: produces permanent https://files.catbox.moe/... URLs accessible from fal.ai
  const hosts = [
    { name: 'catbox.moe',  fn: () => uploadCatbox(buffer, filename, mimeType) },
    { name: '0x0.st',      fn: () => upload0x0(buffer, filename, mimeType) },
    { name: 'tmpfiles.org',fn: () => uploadTmpfiles(buffer, filename, mimeType) },
  ];
  const errors = [];
  for (const host of hosts) {
    try {
      const url = await host.fn();
      console.log('[upload] ' + filename + ' -> ' + host.name + ': ' + url);
      return url;
    } catch (err) {
      errors.push(host.name + ': ' + err.message);
      console.log('[upload] ' + host.name + ' failed: ' + err.message);
    }
  }
  throw new Error('All upload hosts failed: ' + errors.join(' | '));
}

// """ fal.ai key (for storage upload used by Sora 2 speaking) """
const FAL_KEY = (typeof $env !== 'undefined' && $env.FAL_KEY) || '1f90e772-6c27-4772-9c31-9fb0efd2ccb7:e1ae20a74cf0ad9a5be03baefd1603e0';

// """ fal.ai storage upload (2-step: initiate -> PUT) """
// Based on fal-ai/fal-js SDK source: libs/client/src/storage.ts
// Step 1: POST rest.alpha.fal.ai/storage/upload/initiate -> { file_url, upload_url }
// Step 2: PUT binary to upload_url
// Returns file_url (guaranteed accessible by fal.ai inference servers)
async function uploadToFalStorage(buffer, filename, mimeType) {
  // Step 1: Initiate upload
  const initBody = JSON.stringify({ content_type: mimeType, file_name: filename });
  const initResult = await new Promise((resolve, reject) => {
    const req = _https.request({
      hostname: 'rest.alpha.fal.ai',
      path: '/storage/upload/initiate?storage_type=fal-cdn-v3',
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + FAL_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(initBody),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        console.log('[fal initiate] status=' + res.statusCode + ' body=' + body.substring(0, 300));
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          reject(new Error('fal initiate parse error: ' + body.substring(0, 100)));
        }
      });
    });
    req.on('error', reject);
    req.write(initBody);
    req.end();
  });

  if (initResult.status !== 200 || !initResult.data.upload_url) {
    throw new Error('fal initiate HTTP ' + initResult.status + ' " ' + JSON.stringify(initResult.data).substring(0, 150));
  }

  const uploadUrl = initResult.data.upload_url;
  const fileUrl = initResult.data.file_url;

  // Step 2: PUT binary to signed upload URL
  const u = new URL(uploadUrl);
  const lib = u.protocol === 'https:' ? _https : _http;
  await new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': buffer.length,
      },
    }, (res) => {
      res.resume();
      console.log('[fal PUT] status=' + res.statusCode);
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error('fal PUT failed: HTTP ' + res.statusCode));
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });

  console.log('[fal storage] SUCCESS ' ' + fileUrl);
  return fileUrl;
}

// """ TTS Provider Toggle """
// 'elevenlabs' = ElevenLabs v3 (primary)
// 'fish'       = Fish.audio s1 (backup)
const TTS_PROVIDER = 'elevenlabs';

// """ ElevenLabs config """
const ELEVENLABS_API_KEY = 'sk_a645bb67bdb3fecc5604c41b18588e7b1d8a35092d0c28fc';
let ELEVENLABS_VOICE_ID = 'cIZgE1zTtJx92OFuLtNz'; // overridden by phone config below
const ELEVENLABS_MODEL = 'eleven_v3';
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';

// """ Fish.audio config (backup) """
const FISH_API_KEY = '145c958d4b194854b82e045f103472ee';
const REFERENCE_ID = '0b48750248ea42b68366d62bf2117edb';
const MODEL = 's1';

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 5000;

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

// """ Strip emojis from text (TTS engines try to vocalize them ' garbage sounds) """
function stripEmojis(text) {
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2702}-\u{27B0}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{231A}\u{231B}\u{25AA}-\u{25FE}\u{2934}-\u{2935}\u{2190}-\u{21FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// """ Strip ElevenLabs emotion tags (for Fish.audio which doesn't understand them) """
function stripEmotionTags(text) {
  return text.replace(/\[(gasps|sighs|laughs|whispers|sarcastic|frustrated|curious|excited)\]\s*/gi, '').trim();
}

// """ ElevenLabs v3 TTS for a single text segment """
async function elevenLabsTTS(text) {
  text = stripEmojis(text);
  const url = 'https://api.elevenlabs.io/v1/text-to-speech/' + ELEVENLABS_VOICE_ID + '?output_format=' + ELEVENLABS_OUTPUT_FORMAT;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('ElevenLabs API: ' + response.status + ' ' + errorText);
  }
  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer).toString('base64');
}

// """ Fish.audio TTS for a single text segment (backup) """
async function fishTTS(text) {
  text = stripEmotionTags(stripEmojis(text));
  const requestBody = { text, format: 'mp3' };
  if (REFERENCE_ID) requestBody.reference_id = REFERENCE_ID;
  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + FISH_API_KEY,
      'model': MODEL,
    },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('Fish.audio API: ' + response.status + ' ' + errorText);
  }
  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer).toString('base64');
}

// """ Unified TTS dispatcher """
async function generateSegmentAudio(text) {
  if (TTS_PROVIDER === 'elevenlabs') return elevenLabsTTS(text);
  return fishTTS(text);
}

const production = $('Prepare Production').first().json;
const chatId = production.chatId;
const scenarioName = production.scenarioName;

// Phone-aware voice override
if (production.phoneVoiceId) {
  ELEVENLABS_VOICE_ID = production.phoneVoiceId;
  console.log('[VO] Using phone voice: ' + ELEVENLABS_VOICE_ID);
}
const copyJson = production.copyJson;
const template = production.template;
const segments = (template && template.segments) || [];

// V3: Check if hook will come from pool (query Hook Pool directly)
// Generate Hook runs AFTER VO generation, so we can't read $('Generate Hook').
// Instead, check Airtable Hook Pool for ready clips matching this scenario.
const scenarioRecordId = production.scenarioRecordId || '';
const conceptIdVO = production.conceptId || '';
let hookFromPool = false;
let hookFromPoolReaction = false;
if (scenarioRecordId || conceptIdVO) {
  const ATOKEN_VO = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
  if (ATOKEN_VO) {
    try {
      // Try concept_id first (batch generator), fallback to scenario_id (legacy)
      const idFilterVO = conceptIdVO
        ? "{concept_id}='" + conceptIdVO + "'"
        : "{scenario_id}='" + scenarioRecordId + "'";
      // Search: phone-specific first, then shared (no phone_id)
      const voPoolQueries = [];
      if (production.phoneId) {
        voPoolQueries.push("{status}='ready'," + idFilterVO + ",{phone_id}='" + production.phoneId + "'");
      }
      voPoolQueries.push("{status}='ready'," + idFilterVO);

      let poolRes = null;
      for (const q of voPoolQueries) {
        const poolFormula = encodeURIComponent("AND(" + q + ")");
        poolRes = await fetch(
          'https://api.airtable.com/v0/appsgjIdkpak2kaXq/tbl3q91o3l0isSX9w?filterByFormula=' + poolFormula + '&maxRecords=1',
          { headers: { 'Authorization': 'Bearer ' + ATOKEN_VO } }
        );
        if (poolRes.ok) {
          const check = await poolRes.json();
          if (check.records && check.records.length > 0) {
            poolRes = { ok: true, json: () => Promise.resolve(check) };
            break;
          }
        }
        poolRes = null;
      }
      if (poolRes && poolRes.ok) {
        const poolData = await poolRes.json();
        if (poolData.records && poolData.records.length > 0) {
          const poolHookType = poolData.records[0].fields.hook_type || 'speaking';
          if (poolHookType === 'speaking') {
            hookFromPool = true;
            console.log('[VO] Hook Pool has ready speaking clip " will skip hook VO');
          } else {
            hookFromPoolReaction = true;
            console.log('[VO] Hook Pool has ready reaction clip " hook VO still needed');
          }
        }
      }
    } catch(e) {
      console.log('[VO] Hook Pool check failed: ' + e.message + ' " generating hook VO as fallback');
    }
  }
}

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// DEBUG MODE " skip Fish.audio TTS, return dummy audio per segment
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
const DEBUG_FAST = false;  // ? SET TO true FOR FAST TESTING (dummy audio)

// """ Map template segments to VO text """
// hook ' copyJson.hookVO, outro ' copyJson.outroVO
// Body sections WITH VO ' copyJson.bodyClips[bodyIndex].vo (in order)
// Sections that NEVER have VO: screenshot, upload_chat (visual-only sections)
const NO_VO_SECTIONS = ['screenshot', 'upload_chat'];

function getVoTextForSection(section, bodyIndex) {
  if (!copyJson) return null;
  if (section === 'hook') return copyJson.hookVO || null;
  if (section === 'outro') return copyJson.outroVO || null;
  // Body sections with VO: toxic_score, soul_type, deep_dive, etc.
  if (Array.isArray(copyJson.bodyClips) && bodyIndex >= 0 && bodyIndex < copyJson.bodyClips.length) {
    return copyJson.bodyClips[bodyIndex].vo || null;
  }
  return null;
}

if (!copyJson) {
  return [{
    json: {
      success: true,
      voSkipped: true,
      chatId,
      scenarioName,
      warning: '\u26A0\uFE0F No copy JSON found in scenario. Continuing without voiceover.',
    }
  }];
}

// Build voSegments array: one entry per template segment
// Track which body clip index we're at (skip hook/outro from body count)
let bodyIndex = 0;
const voSegments = [];

console.log('[VO-DEBUG] copyJson.bodyClips count: ' + (copyJson && copyJson.bodyClips ? copyJson.bodyClips.length : 'NONE'));
console.log('[VO-DEBUG] copyJson.hookVO: ' + (copyJson && copyJson.hookVO ? 'YES' : 'NO'));
console.log('[VO-DEBUG] copyJson.outroVO: ' + (copyJson && copyJson.outroVO ? 'YES' : 'NO'));
if (copyJson && copyJson.bodyClips) {
  copyJson.bodyClips.forEach((bc, idx) => console.log('[VO-DEBUG] bodyClip[' + idx + '] section=' + bc.section + ' vo=' + (bc.vo ? bc.vo.slice(0, 40) : 'NULL')));
}
console.log('[VO-DEBUG] template segments: ' + segments.map(s => s.section).join(', '));

for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const section = seg.section;
  const isHook = section === 'hook';
  const isOutro = section === 'outro';

  let voText = null;
  if (isHook) {
    voText = getVoTextForSection('hook', -1);
  } else if (isOutro) {
    voText = getVoTextForSection('outro', -1);
  } else if (NO_VO_SECTIONS.includes(section)) {
    // Visual-only section " no VO, don't consume a bodyClips entry
    voText = null;
  } else {
    // Body section WITH VO " use next bodyClip VO
    voText = getVoTextForSection(section, bodyIndex);
    console.log('[VO-DEBUG] section=' + section + ' bodyIndex=' + bodyIndex + ' voText=' + (voText ? voText.slice(0, 40) : 'NULL'));
    bodyIndex++;
  }

  voSegments.push({
    index: i,
    section,
    duration: seg.duration,
    text: voText || null,
    hasAudio: false, // will be set to true after TTS
  });
}

// Check if ANY segment has VO text
const segmentsWithVo = voSegments.filter(s => s.text && s.text.trim());
if (segmentsWithVo.length === 0) {
  return [{
    json: {
      success: true,
      voSkipped: true,
      chatId,
      scenarioName,
      voSegments,
      warning: '\u26A0\uFE0F All VO lines are empty. Continuing without voiceover.',
    }
  }];
}

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// Generate audio per segment
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
const binaryData = {};
const warnings = [];

if (DEBUG_FAST) {
  // Dummy: generate proper silent MP3 per segment via FFmpeg (correct duration for testing)
  for (const seg of voSegments) {
    if (seg.text && seg.text.trim()) {
      const dur = Math.max(1, Math.ceil(seg.text.split(' ').length / 2.5));
      const tmpPath = '/tmp/debug_vo_' + seg.index + '_' + Date.now() + '.mp3';
      try {
        execSync('ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ' + dur + ' -c:a libmp3lame -b:a 64k "' + tmpPath + '"', { timeout: 10000 });
        seg.hasAudio = true;
        seg.durationEstimate = dur;
        binaryData['voSegment_' + seg.index] = {
          data: fs.readFileSync(tmpPath).toString('base64'),
          mimeType: 'audio/mpeg',
          fileName: 'vo_' + seg.section + '.mp3',
        };
      } catch(e) {
        warnings.push('Debug VO gen failed for ' + seg.section + ': ' + e.message);
      }
      try { fs.unlinkSync(tmpPath); } catch(e) {}
    }
  }
} else {
  // Real: call TTS per segment
  for (const seg of voSegments) {
    if (!seg.text || !seg.text.trim()) continue;

    // V3: Skip hook VO if clip came from pool (audio already baked in)
    if (seg.section === 'hook' && hookFromPool) {
      console.log('[VO] Hook skipped (pool source " audio baked into clip)');
      continue;
    }

    try {
      const audioBase64 = await withRetry(
        () => generateSegmentAudio(seg.text),
        'Fish.audio ' + seg.section
      );
      seg.hasAudio = true;
      seg.durationEstimate = Math.ceil(seg.text.split(' ').length / 2.5);
      binaryData['voSegment_' + seg.index] = {
        data: audioBase64,
        mimeType: 'audio/mpeg',
        fileName: 'vo_' + seg.section + '.mp3',
      };
    } catch (err) {
      warnings.push(seg.section + ' VO failed: ' + err.message);
      // Self-healing: skip this segment, continue with others
    }
  }
}

const generatedCount = voSegments.filter(s => s.hasAudio).length;

if (generatedCount === 0) {
  return [{
    json: {
      success: true,
      voSkipped: true,
      chatId,
      scenarioName,
      voSegments,
      warning: '\u26A0\uFE0F All VO segments failed. Continuing without voiceover.' +
        (warnings.length > 0 ? '\n' + warnings.join('\n') : ''),
    }
  }];
}

// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
// Upload hook/outro VO to temp host for Sora 2 speaking (needs public URLs)
// Only uploads if the effective hook/outro type uses speaking
// *?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?*?
let voHookFileUrl = null;
let voOutroFileUrl = null;

const effectiveHookType = production.effectiveHookType || production.hookType;
const effectiveOutroType = production.effectiveOutroType || (production.selectedOutro && production.selectedOutro.type);

// """ Pad hook/outro VO to exact template duration for Sora 2 speaking """
// Sora 2 generates video matching audio length ' audio must be exact for beat sync
// Uses FFmpeg apad (silence padding) + trim to guarantee exact duration
function padVoToExactDuration(segIdx, targetDur) {
  const key = 'voSegment_' + segIdx;
  if (!binaryData[key]) return;
  const tmpIn = '/tmp/tonvo_in_' + segIdx + '.mp3';
  const tmpOut = '/tmp/tonvo_out_' + segIdx + '.mp3';
  try {
    fs.writeFileSync(tmpIn, Buffer.from(binaryData[key].data, 'base64'));
    execSync(
      'ffmpeg -y -i "' + tmpIn + '" -af "apad=whole_dur=' + targetDur.toFixed(3) + '" -t ' + targetDur.toFixed(3) + ' "' + tmpOut + '"',
      { timeout: 15000 }
    );
    binaryData[key].data = fs.readFileSync(tmpOut).toString('base64');
  } catch (e) {
    warnings.push('VO pad to ' + targetDur + 's failed: ' + e.message);
  }
  try { fs.unlinkSync(tmpIn); } catch(e) {}
  try { fs.unlinkSync(tmpOut); } catch(e) {}
}

// V3: Skip hook VO padding/upload when pool source (audio already baked in)
if (effectiveHookType === 'speaking' && !hookFromPool) {
  const hookSeg = voSegments.find(s => s.section === 'hook' && s.hasAudio);
  if (hookSeg) padVoToExactDuration(hookSeg.index, hookSeg.duration);
}
if (effectiveOutroType === 'speaking') {
  const outroSeg = voSegments.find(s => s.section === 'outro' && s.hasAudio);
  if (outroSeg) padVoToExactDuration(outroSeg.index, outroSeg.duration);
}

// Upload hook VO if Sora 2 speaking needs it (skip for pool " audio baked in)
if (effectiveHookType === 'speaking' && !hookFromPool) {
  const hookSeg = voSegments.find(s => s.section === 'hook' && s.hasAudio);
  if (!hookSeg) {
    return [{ json: { error: true, chatId, scenarioName, message: '\u274C Hook VO not generated (TTS failed for hook segment). Cannot do Sora 2 speaking. Check ElevenLabs API.' } }];
  }
  if (binaryData['voSegment_' + hookSeg.index]) {
    const hookVoBuffer = Buffer.from(binaryData['voSegment_' + hookSeg.index].data, 'base64');
    // fal.ai storage first (guaranteed accessible), fallback to temp hosts
    try {
      voHookFileUrl = await uploadToFalStorage(hookVoBuffer, 'vo_hook.mp3', 'audio/mpeg');
      console.log('[VO upload] hook ' fal.ai storage: ' + voHookFileUrl);
    } catch (falErr) {
      console.log('[VO upload] fal.ai storage failed: ' + falErr.message + ' " trying temp hosts');
      try {
        voHookFileUrl = await uploadToTempHost(hookVoBuffer, 'vo_hook.mp3');
      } catch (err) {
        return [{ json: { error: true, chatId, scenarioName, message: '\u274C Hook VO upload failed (all hosts): ' + err.message } }];
      }
    }
  }
}

// Upload outro VO if Sora 2 speaking needs it
if (effectiveOutroType === 'speaking') {
  const outroSeg = voSegments.find(s => s.section === 'outro' && s.hasAudio);
  if (!outroSeg) {
    return [{ json: { error: true, chatId, scenarioName, message: '\u274C Outro VO not generated (TTS failed for outro segment). Cannot do Sora 2 speaking. Check ElevenLabs API.' } }];
  }
  if (binaryData['voSegment_' + outroSeg.index]) {
    const outroVoBuffer = Buffer.from(binaryData['voSegment_' + outroSeg.index].data, 'base64');
    try {
      voOutroFileUrl = await uploadToFalStorage(outroVoBuffer, 'vo_outro.mp3', 'audio/mpeg');
      console.log('[VO upload] outro ' fal.ai storage: ' + voOutroFileUrl);
    } catch (falErr) {
      console.log('[VO upload] fal.ai storage failed: ' + falErr.message + ' " trying temp hosts');
      try {
        voOutroFileUrl = await uploadToTempHost(outroVoBuffer, 'vo_outro.mp3');
      } catch (err) {
        return [{ json: { error: true, chatId, scenarioName, message: '\u274C Outro VO upload failed (all hosts): ' + err.message } }];
      }
    }
  }
}

return [{
  json: {
    success: true,
    voSkipped: false,
    chatId,
    scenarioName,
    voSegments,
    voSegmentCount: generatedCount,
    totalSegments: voSegments.length,
    voHookFileUrl,
    voOutroFileUrl,
    warnings: warnings.length > 0 ? warnings : undefined,
  },
  binary: binaryData,
}];
