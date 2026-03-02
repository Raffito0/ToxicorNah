// NODE: Handle Telegram Callback (Unified Pipeline)
// Parses callback_data from inline keyboard button presses
// Handles THREE types of callbacks:
//   1. Per-segment VO approval: "vpVoOk_{recordId}_{segIndex}", "vpVoRedo_{recordId}_{segIndex}"
//      Approves individual VO segments. On redo: regenerates via Fish.audio, re-sends audio.
//      When ALL segments approved → sets vo_approval to "approved" → pipeline continues.
//   2. Video pipeline asset approval: "vpApprove_{recordId}_{step}", "vpRedo_{recordId}_{step}"
//      Steps: hook_img, outro_img (vo is now handled per-segment above)
//   3. Scenario approval: "approve_scenarioName", "redo_scenarioName", "skip_scenarioName"
// Mode: Run Once for All Items

const fs = require('fs');
const path = require('path');

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

// ─── Multipart upload helper for Telegram sendAudio with inline_keyboard ───
function sendTelegramAudio(botToken, chatId, audioBuffer, filename, caption, replyMarkup) {
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
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="audio"; filename="' + filename + '"\r\nContent-Type: audio/mpeg\r\n\r\n');
    const bodyBuf = Buffer.concat([
      Buffer.from(parts.join('')),
      audioBuffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const req = _https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + botToken + '/sendAudio',
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

// ─── TTS Provider Toggle ───
// 'elevenlabs' = ElevenLabs v3 (primary)
// 'fish'       = Fish.audio s1 (backup)
const TTS_PROVIDER = 'elevenlabs';

// ─── ElevenLabs config ───
const ELEVENLABS_API_KEY = 'sk_a645bb67bdb3fecc5604c41b18588e7b1d8a35092d0c28fc';
const ELEVENLABS_VOICE_ID = 'cIZgE1zTtJx92OFuLtNz';
const ELEVENLABS_MODEL = 'eleven_v3';
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';

// ─── Fish.audio config (backup) ───
const FISH_API_KEY = '145c958d4b194854b82e045f103472ee';
const FISH_REFERENCE_ID = '0b48750248ea42b68366d62bf2117edb';
const FISH_MODEL = 's1';

function stripEmojis(text) {
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2702}-\u{27B0}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{231A}\u{231B}\u{25AA}-\u{25FE}\u{2934}-\u{2935}\u{2190}-\u{21FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Strip ElevenLabs emotion tags (for Fish.audio which doesn't understand them) ───
function stripEmotionTags(text) {
  return text.replace(/\[(gasps|sighs|laughs|whispers|sarcastic|frustrated|curious|excited)\]\s*/gi, '').trim();
}

// ─── ElevenLabs v3 TTS with native speed control ───
// speed is passed at TOP LEVEL of request body (not in voice_settings)
// ElevenLabs eleven_v3 natively adjusts voice cadence — sounds like real person speaking faster/slower
async function elevenLabsTTS(text, speed) {
  text = stripEmojis(text);
  const url = 'https://api.elevenlabs.io/v1/text-to-speech/' + ELEVENLABS_VOICE_ID + '?output_format=' + ELEVENLABS_OUTPUT_FORMAT;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL, speed: speed || 1.0 }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('ElevenLabs: ' + response.status + ' ' + errorText);
  }
  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer);
}

// ─── Fish.audio TTS with speed control (backup) ───
async function fishTTS(text, speed) {
  text = stripEmotionTags(stripEmojis(text));
  const requestBody = { text, format: 'mp3' };
  if (FISH_REFERENCE_ID) requestBody.reference_id = FISH_REFERENCE_ID;
  if (speed && speed !== 1.0) requestBody.prosody = { speed };
  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + FISH_API_KEY,
      'model': FISH_MODEL,
    },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('Fish.audio: ' + response.status + ' ' + errorText);
  }
  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer);
}

// ─── Unified TTS dispatcher ───
async function ttsGenerate(text, speed) {
  if (TTS_PROVIDER === 'elevenlabs') return elevenLabsTTS(text, speed);
  return fishTTS(text, speed);
}

// Section display labels
const sectionLabels = {
  'hook': '\uD83C\uDFA3 Hook',
  'toxic_score': '\u2620\uFE0F Toxic Score',
  'soul_type': '\uD83D\uDC7B Soul Type',
  'deep_dive': '\uD83D\uDD2C Deep Dive',
  'outro': '\uD83D\uDC4B Outro',
};

const TELEGRAM_BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
const AIRTABLE_TOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
const AIRTABLE_BASE = 'appsgjIdkpak2kaXq';
const VIDEO_RUNS_TABLE = 'tbltCYcVXrLYvyIJL';

const update = $input.first().json;

const callbackData = update.callback_query
  ? update.callback_query.data
  : (update.data || '');

const callbackQueryId = update.callback_query
  ? update.callback_query.id
  : '';

const chatId = update.callback_query
  ? update.callback_query.message.chat.id
  : '';

const messageId = update.callback_query
  ? update.callback_query.message.message_id
  : '';

// ═══════════════════════════════════════
// PER-SEGMENT VO APPROVAL — vpVoOk / vpVoRedo / vpVoFaster
// ═══════════════════════════════════════
if (callbackData.startsWith('vpVoOk_') || callbackData.startsWith('vpVoRedo_') || callbackData.startsWith('vpVoFaster_') || callbackData.startsWith('vpVoSlower_')) {
  const isApprove = callbackData.startsWith('vpVoOk_');
  const isFaster = callbackData.startsWith('vpVoFaster_');
  const isSlower = callbackData.startsWith('vpVoSlower_');
  const prefix = isApprove ? 'vpVoOk_' : (isFaster ? 'vpVoFaster_' : (isSlower ? 'vpVoSlower_' : 'vpVoRedo_'));
  const rest = callbackData.substring(prefix.length); // "recXXX_3"
  const lastUnderscore = rest.lastIndexOf('_');
  const recordId = rest.substring(0, lastUnderscore);
  const segIndex = parseInt(rest.substring(lastUnderscore + 1), 10);

  // Answer callback query immediately
  if (callbackQueryId) {
    try {
      await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/answerCallbackQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: isApprove ? '\u2705 Segment approved!' : (isFaster ? '\u26A1 Regenerating faster...' : (isSlower ? '\uD83D\uDC22 Regenerating slower...' : '\uD83D\uDD04 Regenerating...')),
        }),
      });
    } catch (e) { /* non-fatal */ }
  }

  // Read current vo_segments_json from Airtable
  let segments = [];
  try {
    const res = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + VIDEO_RUNS_TABLE + '/' + recordId, {
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN },
    });
    const record = await res.json();
    const raw = record.fields?.vo_segments_json;
    if (raw) segments = JSON.parse(raw);
  } catch (e) {
    return [{ json: { type: 'vo_segment', action: 'error', error: 'Failed to read Airtable: ' + e.message } }];
  }

  const seg = segments.find(s => s.index === segIndex);
  if (!seg) {
    return [{ json: { type: 'vo_segment', action: 'error', error: 'Segment index ' + segIndex + ' not found' } }];
  }

  const label = sectionLabels[seg.section] || seg.section;

  if (isApprove) {
    // ─── APPROVE: mark segment, check if all done ───
    seg.status = 'approved';

    if (messageId) {
      try {
        await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/editMessageReplyMarkup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '\u2705 Approved', callback_data: 'noop' }]] },
          }),
        });
      } catch (e) { /* non-fatal */ }
    }

    const pendingSegs = segments.filter(s => s.status === 'pending');
    const updateFields = { vo_segments_json: JSON.stringify(segments) };

    if (pendingSegs.length === 0) {
      updateFields.vo_approval = 'approved';
    }

    try {
      await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + VIDEO_RUNS_TABLE + '/' + recordId, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + AIRTABLE_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: updateFields }),
      });
    } catch (e) { /* non-fatal */ }

    if (pendingSegs.length === 0) {
      try {
        await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '\u2705 All VO segments approved! Pipeline continuing...',
          }),
        });
      } catch (e) { /* non-fatal */ }
    }

    return [{ json: { type: 'vo_segment', action: 'approve', segIndex, recordId, allApproved: pendingSegs.length === 0 } }];

  } else {
    // ─── REDO / FASTER / SLOWER: regenerate via Fish.audio ───
    // Faster: +0.15 speed. Slower: -0.15 speed. Redo: keep current speed.
    // Fish.audio range: 0.5 – 2.0
    const currentSpeed = seg.speed || 1.0;
    const newSpeed = isFaster
      ? Math.min(2.0, Math.round((currentSpeed + 0.15) * 100) / 100)
      : isSlower
        ? Math.max(0.5, Math.round((currentSpeed - 0.15) * 100) / 100)
        : currentSpeed;

    // Remove buttons from the old message
    if (messageId) {
      const btnText = isFaster ? ('\u26A1 Faster ' + newSpeed + 'x...') : (isSlower ? ('\uD83D\uDC22 Slower ' + newSpeed + 'x...') : '\uD83D\uDD04 Redoing...');
      try {
        await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/editMessageReplyMarkup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: btnText, callback_data: 'noop' }]] },
          }),
        });
      } catch (e) { /* non-fatal */ }
    }

    const voText = seg.text;
    if (!voText) {
      try {
        await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: '\u26A0\uFE0F No VO text for ' + label + ' \u2014 cannot redo.' }),
        });
      } catch (e) { /* non-fatal */ }
      return [{ json: { type: 'vo_segment', action: 'redo_error', segIndex, error: 'No text' } }];
    }

    // Call TTS with speed
    let audioBuffer;
    try {
      audioBuffer = await ttsGenerate(voText, newSpeed);
    } catch (e) {
      try {
        await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: '\u274C TTS failed for ' + label + ': ' + e.message }),
        });
      } catch (_) { /* non-fatal */ }
      return [{ json: { type: 'vo_segment', action: 'redo_error', segIndex, error: e.message } }];
    }

    // Save new audio to disk
    const voDir = '/tmp/toxicornah_vo/' + recordId;
    if (!fs.existsSync(voDir)) {
      fs.mkdirSync(voDir, { recursive: true });
    }
    const filePath = path.join(voDir, 'vo_' + segIndex + '.mp3');
    fs.writeFileSync(filePath, audioBuffer);

    // Re-read segments from Airtable to avoid overwriting concurrent approvals
    let freshSegments = segments;
    try {
      const freshRes = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + VIDEO_RUNS_TABLE + '/' + recordId, {
        headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN },
      });
      const freshRecord = await freshRes.json();
      const freshRaw = freshRecord.fields?.vo_segments_json;
      if (freshRaw) freshSegments = JSON.parse(freshRaw);
    } catch (e) { /* use old segments as fallback */ }

    // Update this segment: status=pending, speed=newSpeed
    const freshSeg = freshSegments.find(s => s.index === segIndex);
    if (freshSeg) {
      freshSeg.status = 'pending';
      freshSeg.speed = newSpeed;
    }

    try {
      await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + VIDEO_RUNS_TABLE + '/' + recordId, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + AIRTABLE_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: { vo_segments_json: JSON.stringify(freshSegments) } }),
      });
    } catch (e) { /* non-fatal */ }

    // Build caption with speed info
    const speedInfo = newSpeed !== 1.0 ? ' [' + newSpeed + 'x]' : '';
    const regenLabel = isFaster ? '\u26A1 ' : (isSlower ? '\uD83D\uDC22 ' : '\uD83D\uDD04 ');
    const caption = regenLabel + label + ' VO (regenerated' + speedInfo + ')\n"' + voText.substring(0, 180) + '"';

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '\u2705 Approve', callback_data: 'vpVoOk_' + recordId + '_' + segIndex },
          { text: '\uD83D\uDD04 Redo', callback_data: 'vpVoRedo_' + recordId + '_' + segIndex },
        ],
        [
          { text: '\uD83D\uDC22 Slower', callback_data: 'vpVoSlower_' + recordId + '_' + segIndex },
          { text: '\u26A1 Faster', callback_data: 'vpVoFaster_' + recordId + '_' + segIndex },
        ],
      ],
    };

    try {
      await sendTelegramAudio(TELEGRAM_BOT_TOKEN, chatId, audioBuffer, 'vo_' + seg.section + '.mp3', caption, replyMarkup);
    } catch (e) {
      try {
        await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: '\u26A0\uFE0F Failed to send new audio: ' + e.message }),
        });
      } catch (_) { /* non-fatal */ }
    }

    return [{ json: { type: 'vo_segment', action: isFaster ? 'faster' : (isSlower ? 'slower' : 'redo'), segIndex, recordId, speed: newSpeed } }];
  }
}

// ═══════════════════════════════════════
// VIDEO PIPELINE APPROVAL — vpApprove_{recordId}_{step} / vpRedo_{recordId}_{step}
// recordId = Airtable Video Runs record ID
// ═══════════════════════════════════════
if (callbackData.startsWith('vpApprove_') || callbackData.startsWith('vpRedo_')) {
  const isApprove = callbackData.startsWith('vpApprove_');
  const prefix = isApprove ? 'vpApprove_' : 'vpRedo_';
  const rest = callbackData.substring(prefix.length);
  const firstUnderscore = rest.indexOf('_');
  const recordId = rest.substring(0, firstUnderscore);
  const step = rest.substring(firstUnderscore + 1);

  const action = isApprove ? 'approve' : 'redo';
  const stepLabels = {
    'hook_img': 'Hook image',
    'hook_vid': 'Hook video',
    'hook_vid_0': 'Hook trim [0-3s]',
    'hook_vid_1': 'Hook trim [1-4s]',
    'hook_vid_2': 'Hook trim [2-5s]',
    'outro_img': 'Outro image',
    'outro_vid': 'Outro video',
    'vo': 'Voiceover',
  };
  const stepLabel = stepLabels[step] || step;

  const stepToField = {
    'hook_img': 'hook_approval',
    'hook_vid': 'hook_vid_approval',
    'hook_vid_0': 'hook_vid_approval',
    'hook_vid_1': 'hook_vid_approval',
    'hook_vid_2': 'hook_vid_approval',
    'vo': 'vo_approval',
    'outro_img': 'outro_approval',
    'outro_vid': 'outro_vid_approval',
  };
  const approvalField = stepToField[step];
  // Trim-choice callbacks write 'approved_N' so img-to-video.js internal poll detects them.
  // Standard approve writes 'approved' which Poll Hook Video Approval detects.
  const trimChoiceMatch = step.match(/^hook_vid_(\d)$/);
  const approvalValue = isApprove
    ? (trimChoiceMatch ? 'approved_' + trimChoiceMatch[1] : 'approved')
    : 'redo';

  if (callbackQueryId) {
    try {
      await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/answerCallbackQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: isApprove ? '\u2705 ' + stepLabel + ' approved!' : '\uD83D\uDD04 Redoing ' + stepLabel + '...',
        }),
      });
    } catch (e) { /* non-fatal */ }
  }

  if (TELEGRAM_BOT_TOKEN) {
    const emoji = isApprove ? '\u2705' : '\uD83D\uDD04';
    const msg = isApprove
      ? (trimChoiceMatch
          ? emoji + ' ' + stepLabel + ' scelto! In attesa di conferma...'
          : emoji + ' ' + stepLabel + ' approved! Continuing pipeline...')
      : emoji + ' Redoing ' + stepLabel + '...';
    try {
      await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg }),
      });
    } catch (e) { /* non-fatal */ }
  }

  if (AIRTABLE_TOKEN && approvalField && recordId) {
    try {
      await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + VIDEO_RUNS_TABLE + '/' + recordId, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + AIRTABLE_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: { [approvalField]: approvalValue } }),
      });
    } catch (e) {
      if (TELEGRAM_BOT_TOKEN && chatId) {
        try {
          await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: '\u26A0\uFE0F Airtable update failed: ' + (e.message || e) }),
          });
        } catch (_) { /* ignore */ }
      }
    }
  }

  return [{
    json: {
      type: 'video_pipeline',
      action,
      step,
      recordId,
      callbackQueryId,
      chatId,
    }
  }];
}

// ═══════════════════════════════════════
// SCENARIO APPROVAL — approve/redo/skip_{scenarioName}
// ═══════════════════════════════════════
const parts = callbackData.split('_');
const action = parts[0];
const scenarioName = parts.slice(1).join('_');

let newStatus = '';
let responseText = '';
switch (action) {
  case 'approve':
    newStatus = 'approved';
    responseText = '\u2705 Scenario "' + scenarioName + '" approved!';
    break;
  case 'redo':
    newStatus = 'draft';
    responseText = '\uD83D\uDD04 Scenario "' + scenarioName + '" marked for regeneration.\n\n\u23F3 Generating new scenario...';
    break;
  case 'skip':
    newStatus = 'skipped';
    responseText = '\u274C Scenario "' + scenarioName + '" skipped.';
    break;
  default:
    newStatus = '';
    responseText = '\u2753 Unknown action: ' + action;
}

return [{
  json: {
    type: 'scenario',
    action,
    scenarioName,
    newStatus,
    responseText,
    callbackQueryId,
    chatId
  }
}];
