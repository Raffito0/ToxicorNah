// NODE: Handle Telegram Callback (Unified Pipeline)
// Parses callback_data from inline keyboard button presses
// Handles FOUR types of callbacks:
//   1. Per-segment VO approval: "vpVoOk_{recordId}_{segIndex}", "vpVoRedo_{recordId}_{segIndex}"
//      Approves individual VO segments. On redo: regenerates via Fish.audio, re-sends audio.
//      When ALL segments approved â†’ sets vo_approval to "approved" â†’ pipeline continues.
//   2. Video pipeline asset approval: "vpApprove_{recordId}_{step}", "vpRedo_{recordId}_{step}"
//      Steps: hook_img, outro_img (vo is now handled per-segment above)
//   3. Hook generator: "img_approve_{recId}", "img_redo_{recId}", "vid_skip_{recId}", "vid_all_{recId}"
//      Instant button update + Airtable status change (replaces getUpdates polling)
//   4. Scenario approval: "approve_scenarioName", "redo_scenarioName", "skip_scenarioName"
// Mode: Run Once for All Items

const fs = require('fs');
const path = require('path');

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

// â”€â”€â”€ Multipart upload helper for Telegram sendAudio with inline_keyboard â”€â”€â”€
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

// â”€â”€â”€ TTS Provider Toggle â”€â”€â”€
// 'elevenlabs' = ElevenLabs v3 (primary)
// 'fish'       = Fish.audio s1 (backup)
const TTS_PROVIDER = 'elevenlabs';

// â”€â”€â”€ ElevenLabs config â”€â”€â”€
const ELEVENLABS_API_KEY = 'sk_a645bb67bdb3fecc5604c41b18588e7b1d8a35092d0c28fc';
const ELEVENLABS_VOICE_ID = 'cIZgE1zTtJx92OFuLtNz';
const ELEVENLABS_MODEL = 'eleven_v3';
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';

// â”€â”€â”€ Fish.audio config (backup) â”€â”€â”€
const FISH_API_KEY = '145c958d4b194854b82e045f103472ee';
const FISH_REFERENCE_ID = '0b48750248ea42b68366d62bf2117edb';
const FISH_MODEL = 's1';

function stripEmojis(text) {
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2702}-\u{27B0}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{231A}\u{231B}\u{25AA}-\u{25FE}\u{2934}-\u{2935}\u{2190}-\u{21FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// â”€â”€â”€ Strip ElevenLabs emotion tags (for Fish.audio which doesn't understand them) â”€â”€â”€
function stripEmotionTags(text) {
  return text.replace(/\[(gasps|sighs|laughs|whispers|sarcastic|frustrated|curious|excited)\]\s*/gi, '').trim();
}

// â”€â”€â”€ ElevenLabs v3 TTS with native speed control â”€â”€â”€
// speed is passed at TOP LEVEL of request body (not in voice_settings)
// ElevenLabs eleven_v3 natively adjusts voice cadence â€” sounds like real person speaking faster/slower
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

// â”€â”€â”€ Fish.audio TTS with speed control (backup) â”€â”€â”€
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

// â”€â”€â”€ Unified TTS dispatcher â”€â”€â”€
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
const PREP01_BOT = '8389477139:AAFWFMhwVj7TLWBOtlX-3Pqz7pqK88fP4EU';
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

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// PER-SEGMENT VO APPROVAL â€” vpVoOk / vpVoRedo / vpVoFaster
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
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
    // â”€â”€â”€ APPROVE: mark segment, check if all done â”€â”€â”€
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
    // â”€â”€â”€ REDO / FASTER / SLOWER: regenerate via Fish.audio â”€â”€â”€
    // Faster: +0.15 speed. Slower: -0.15 speed. Redo: keep current speed.
    // Fish.audio range: 0.5 â€“ 2.0
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

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// VIDEO PIPELINE APPROVAL â€” vpApprove_{recordId}_{step} / vpRedo_{recordId}_{step}
// recordId = Airtable Video Runs record ID
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
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

  // Update button to show Approved/Redoing state
  if (messageId && TELEGRAM_BOT_TOKEN) {
    const btnText = isApprove ? '\u2705 Approved' : '\uD83D\uDD04 Redoing...';
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

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// AUTO-NEXT: load next approved scenario after LED/Day selection
// Replicates start-next-scenario.js logic inline
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
const HOOK_QUEUE_TABLE = 'tblXpyxSLN2vSJ4i3';
const SCENARIOS_TABLE = 'tblcQaMBBPcOAy0NF';
const PHONES_TABLE = 'tblCvT47GpZv29jz9';
const CONCEPTS_TABLE = 'tblhhTVI4EYofdY32';
const SUPABASE_URL = 'https://iilqnbumccqxlyloerzd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpbHFuYnVtY2NxeGx5bG9lcnpkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODcyMzAyOCwiZXhwIjoyMDg0Mjk5MDI4fQ.XUKQTfMrtg2gYwIiJX_dMBX6C4VSlKZS09cNC7h7yVQ';
const APP_URL = 'https://toxicor-nah.vercel.app';
const PROFILE_PICS = [
  '/GUYS PROFILE PICS/openart-image_43m08NP7_1772054346917_raw.jpg',
  '/GUYS PROFILE PICS/openart-image_767eF_NR_1772054370739_raw.jpg',
  '/GUYS PROFILE PICS/openart-image_76WI-X36_1772054341562_raw.jpg',
  '/GUYS PROFILE PICS/openart-image_CX2wvxHx_1772054327378_raw.jpg',
  '/GUYS PROFILE PICS/openart-image_Igx9x5Tb_1772054336505_raw.jpg',
  '/GUYS PROFILE PICS/openart-image_-Jv_st6o_1772054314707_raw.jpg',
  '/GUYS PROFILE PICS/openart-image_k34F-chA_1772054331278_raw.jpg',
  '/GUYS PROFILE PICS/openart-image_l7RhnYOF_1771785086054_raw.png',
  '/GUYS PROFILE PICS/openart-image_q7qc-3aA_1772054349021_raw.jpg',
];

async function autoLoadNextScenario(botToken, targetChatId) {
  const staticData = $getWorkflowStaticData('global');

  // Already recording? Skip
  if (staticData.activeRecording) {
    console.log('[auto-next] Already recording â€” skipping');
    return;
  }

  // 1. Find next approved scenario
  const filter = encodeURIComponent("AND({status}='approved',{generated_hook_text}!='')");
  const scenUrl = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + SCENARIOS_TABLE +
    '?filterByFormula=' + filter + '&maxRecords=1';
  const scenRes = await fetch(scenUrl, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN } });
  if (!scenRes.ok) {
    const errBody = await scenRes.text();
    console.log('[auto-next] Airtable error: ' + scenRes.status + ' ' + errBody);
    try {
      await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: '\u26A0\uFE0F Auto-next error: Airtable ' + scenRes.status }),
      });
    } catch (e) { /* non-fatal */ }
    return;
  }
  const scenData = await scenRes.json();
  const nextScenario = (scenData.records && scenData.records[0]) || null;

  if (!nextScenario) {
    try {
      await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: '\uD83D\uDCCB Nessuno scenario approvato in coda.\nGenera nuovi scenari prima.' }),
      });
    } catch (e) { /* non-fatal */ }
    return;
  }

  const nf = nextScenario.fields || {};
  const scenarioName = nf.scenario_name || '';
  const scenarioRecordId = nextScenario.id;
  const screenshotUrl = nf.screenshot_url || '';

  function formatName(raw) {
    if (!raw) return 'Scenario';
    return raw.replace(/-\d{10,}$/, '').split('-').map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }
  const displayName = formatName(scenarioName);

  // 2. Parse scenario_json and save to Supabase
  let scenarioJson = nf.scenario_json;
  if (typeof scenarioJson === 'string') {
    try { scenarioJson = JSON.parse(scenarioJson); } catch (e) { scenarioJson = null; }
  }

  let demoUrl = '';
  if (scenarioJson) {
    scenarioJson.personAvatar = PROFILE_PICS[Math.floor(Math.random() * PROFILE_PICS.length)];
    if (!scenarioJson.personDisplayName && scenarioJson.chat && scenarioJson.chat.contactName) {
      scenarioJson.personDisplayName = scenarioJson.chat.contactName;
    }
    try {
      const supRes = await fetch(SUPABASE_URL + '/rest/v1/content_scenarios?on_conflict=scenario_id', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'return=representation,resolution=merge-duplicates',
        },
        body: JSON.stringify({ scenario_id: scenarioName, scenario_json: scenarioJson, status: 'approved' }),
      });
      if (supRes.ok) {
        const [inserted] = await supRes.json();
        demoUrl = APP_URL + '/?sid=' + inserted.id;
      }
    } catch (e) { console.log('[auto-next] Supabase error: ' + e.message); }
  }

  // 3. Set up recording state
  const bodySegments = [
    { section: 'screenshot', duration: 1, label: 'Screenshot della chat' },
    { section: 'upload_chat', duration: 1, label: 'Upload chat (caricamento)' },
    { section: 'toxic_score', duration: 3, label: 'Toxic score reveal' },
    { section: 'soul_type', duration: 3, label: 'Soul type card' },
    { section: 'deep_dive', duration: 3, label: 'Deep dive (categorie)' },
  ];

  staticData.activeRecording = {
    scenarioName,
    chatId: targetChatId,
    scenarioRecordId,
    expectedClips: bodySegments,
    receivedCount: 0,
  };

  // 4. Determine which phone this scenario will go to + count
  var phoneInfo = await assignPhoneSequential();
  var phoneLabel = '';
  if (phoneInfo) {
    var pName = phoneInfo.phone.phoneId.replace('phone-', 'Phone ');
    var nextNum = (phoneInfo.currentReady || 0) + 1;
    phoneLabel = '\uD83D\uDCF1 ' + pName + ' \u2014 Scenario ' + nextNum + '/3';
    if (nextNum === 1) {
      phoneLabel += ' \u{1F195} Nuovo batch!';
    }
    phoneLabel += '\n\n';
  }

  // 5. Build caption
  let caption = phoneLabel + '\uD83C\uDFAC Scenario: "' + displayName + '"\n\n';
  caption += 'Registra queste body clip:\n\n';
  bodySegments.forEach(function(seg, i) {
    caption += '  ' + (i + 1) + '. ' + seg.label + ' (~' + seg.duration + 's)\n';
  });
  caption += '\nManda i video senza caption.\n';
  caption += '\uD83D\uDC49 /done quando hai finito.';
  if (demoUrl) {
    caption += '\n\n\uD83D\uDCF1 App: ' + demoUrl;
  }

  // 5. Send screenshot photo or text message
  try {
    let photoSent = false;
    if (screenshotUrl) {
      const photoRes = await fetch('https://api.telegram.org/bot' + botToken + '/sendPhoto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, photo: screenshotUrl, caption: caption }),
      });
      const photoJson = await photoRes.json();
      if (photoJson.ok) {
        photoSent = true;
      } else {
        console.log('[auto-next] sendPhoto failed: ' + JSON.stringify(photoJson));
      }
    }
    if (!photoSent) {
      await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: caption }),
      });
    }
  } catch (e) { console.log('[auto-next] Telegram send error: ' + e.message); }

  console.log('[auto-next] Loaded scenario: ' + scenarioName);
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// HELPERS: concept lookup + round-robin phone + batch queue
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?

// Fetch concept prompts by Airtable record ID (not text concept_id)
async function fetchConceptData(conceptRecordId) {
  if (!conceptRecordId) return { hookImagePrompt: '', sora2SpeakingPrompt: '', conceptIdStr: '' };
  try {
    const res = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + CONCEPTS_TABLE + '/' + conceptRecordId, {
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN },
    });
    if (!res.ok) return { hookImagePrompt: '', sora2SpeakingPrompt: '', conceptIdStr: '' };
    const c = await res.json();
    return {
      hookImagePrompt: c.fields.hook_image_prompt_speaking || c.fields.hook_image_prompt || '',
      sora2SpeakingPrompt: c.fields.sora2_speaking_prompt || '',
      conceptIdStr: c.fields.concept_id || '',
    };
  } catch (e) {
    return { hookImagePrompt: '', sora2SpeakingPrompt: '', conceptIdStr: '' };
  }
}

// Load active phones and pick the first one that has < 3 ready scenarios (sequential fill)
async function assignPhoneSequential() {
  // 1. Load active phones (sorted by phone_id for consistent order)
  const phonesUrl = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + PHONES_TABLE +
    '?filterByFormula=' + encodeURIComponent("{is_active}=TRUE()") +
    '&sort%5B0%5D%5Bfield%5D=phone_id&sort%5B0%5D%5Bdirection%5D=asc';
  const phonesRes = await fetch(phonesUrl, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN } });
  if (!phonesRes.ok) return null;
  const phonesData = await phonesRes.json();
  const phones = (phonesData.records || []).map(function(r) {
    return { phoneId: r.fields.phone_id, girlRefUrl: r.fields.girl_ref_url || '', recordId: r.id };
  });
  if (phones.length === 0) return null;

  // 2. Count ready scenarios per phone
  const counts = {};
  for (var pi = 0; pi < phones.length; pi++) { counts[phones[pi].phoneId] = 0; }

  const readyUrl = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + SCENARIOS_TABLE +
    '?filterByFormula=' + encodeURIComponent("{status}='ready'") + '&fields%5B%5D=phone_id';
  const readyRes = await fetch(readyUrl, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN } });
  if (readyRes.ok) {
    var data = await readyRes.json();
    for (var ri = 0; ri < (data.records || []).length; ri++) {
      var pid = (data.records[ri].fields.phone_id || '');
      if (counts[pid] !== undefined) counts[pid]++;
    }
  }

  // 3. Pick first phone that has < 3 ready (sequential: fill phone-1 first, then phone-2, etc.)
  for (var si = 0; si < phones.length; si++) {
    if ((counts[phones[si].phoneId] || 0) < 3) {
      return { phone: phones[si], currentReady: counts[phones[si].phoneId] || 0 };
    }
  }

  // All phones have 3+ ready â€” pick first phone anyway (will batch immediately)
  return { phone: phones[0], currentReady: counts[phones[0].phoneId] || 0 };
}

// Check if a phone has 3+ 'ready' scenarios with same time_of_day+led_color â†’ batch into 1 queue record
async function checkAndCreateBatch(phone, hookImagePrompt, sora2SpeakingPrompt, conceptIdStr, timeOfDay, ledColor) {
  var ledPart = ledColor ? ",{led_color}='" + ledColor + "'" : ",{led_color}=''";
  var filter = encodeURIComponent("AND({status}='ready',{phone_id}='" + phone.phoneId + "',{time_of_day}='" + timeOfDay + "'" + ledPart + ")");
  var readyUrl = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + SCENARIOS_TABLE +
    '?filterByFormula=' + filter + '&maxRecords=3';
  var readyRes = await fetch(readyUrl, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN } });
  if (!readyRes.ok) return { created: false, count: 0, phoneId: phone.phoneId };
  var readyData = await readyRes.json();
  var readyScenarios = readyData.records || [];

  if (readyScenarios.length < 3) {
    return { created: false, count: readyScenarios.length, phoneId: phone.phoneId };
  }

  var batch = readyScenarios.slice(0, 3);
  var hookTexts = batch.map(function(r) {
    // Use hookVO (what the girl SAYS) not hookText (caption overlay)
    try {
      var copyJson = typeof r.fields.generated_copy_json === 'string'
        ? JSON.parse(r.fields.generated_copy_json) : r.fields.generated_copy_json;
      if (copyJson && copyJson.hookVO) return copyJson.hookVO;
    } catch (e) {}
    return r.fields.generated_hook_text || '';
  });
  var scenarioIds = batch.map(function(r) { return r.id; });

  // Create queue record with 3 hook texts
  await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + HOOK_QUEUE_TABLE, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      concept_id: conceptIdStr,
      concept_name: batch.map(function(r) { return r.fields.scenario_name || ''; }).join(', '),
      hook_mode: 'speaking',
      phone_id: phone.phoneId,
      hook_texts_json: JSON.stringify(hookTexts),
      scenario_ids_json: JSON.stringify(scenarioIds),
      girl_ref_url: phone.girlRefUrl,
      hook_image_prompt: hookImagePrompt,
      sora2_speaking_prompt: sora2SpeakingPrompt,
      time_of_day: timeOfDay,
      led_color: ledColor,
      status: 'image_pending',
    } }),
  });

  // Mark all 3 scenarios as 'queued'
  for (var si = 0; si < batch.length; si++) {
    await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + SCENARIOS_TABLE + '/' + batch[si].id, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { status: 'queued' } }),
    });
  }

  return { created: true, count: 3, phoneId: phone.phoneId, hookTexts: hookTexts };
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// LED COLOR CALLBACK â€” led_{color}_{scenarioRecordId}
// After /done â†’ night, user picks LED color. Marks scenario ready, batches 3 into queue.
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?

const ledMatch = callbackData.match(/^led_(red|purple|green|blue|none)_(.+)$/);
if (ledMatch) {
  const ledColor = ledMatch[1] === 'none' ? '' : ledMatch[1];
  const scenarioRecordId = ledMatch[2];

  // Answer callback
  if (callbackQueryId) {
    const label = ledColor ? ('ðŸ’¡ ' + ledColor.charAt(0).toUpperCase() + ledColor.slice(1) + ' LED') : 'âš« No LED';
    try {
      await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/answerCallbackQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text: label + ' â€” generating hook...' }),
      });
    } catch (e) { /* non-fatal */ }
  }

  // Update button
  if (messageId) {
    const btnLabel = ledColor ? ('ðŸ’¡ ' + ledColor.charAt(0).toUpperCase() + ledColor.slice(1) + ' LED') : 'âš« No LED';
    try {
      await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/editMessageReplyMarkup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '\u2705 ' + btnLabel, callback_data: 'noop' }]] },
        }),
      });
    } catch (e) { /* non-fatal */ }
  }

  // Fetch scenario, update to ready, check batch
  let hookRequestError = '';
  let batchResult = { created: false, count: 0 };
  try {
    // 1. Fetch scenario record
    const scenRes = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + SCENARIOS_TABLE + '/' + scenarioRecordId, {
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN },
    });
    const scenario = await scenRes.json();
    const sf = scenario.fields || {};
    const conceptRecIds = sf.concept_id || [];
    const conceptRecordId = Array.isArray(conceptRecIds) ? conceptRecIds[0] : (conceptRecIds || '');

    // 2. Round-robin phone assignment
    const phoneAssign = await assignPhoneSequential();
    if (!phoneAssign) throw new Error('No active phones found');
    const assignedPhone = phoneAssign.phone;

    // 3. Fetch concept prompts (by record ID directly)
    const { hookImagePrompt, sora2SpeakingPrompt, conceptIdStr } = await fetchConceptData(conceptRecordId);

    // 4. Update scenario with time_of_day + led_color + phone_id + status=ready
    await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + SCENARIOS_TABLE + '/' + scenarioRecordId, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { time_of_day: 'night', led_color: ledColor, phone_id: assignedPhone.phoneId, status: 'ready' } }),
    });

    // 5. Check batch â€” creates queue record if this phone has 3+ ready scenarios
    batchResult = await checkAndCreateBatch(assignedPhone, hookImagePrompt, sora2SpeakingPrompt, conceptIdStr, 'night', ledColor);
  } catch (e) {
    hookRequestError = e.message;
  }

  // 6. Send confirmation
  const ledLabel = ledColor ? (' + ' + ledColor + ' LED') : '';
  let confirmMsg;
  if (hookRequestError) {
    confirmMsg = '\u26A0\uFE0F Hook request failed: ' + hookRequestError;
  } else if (batchResult.created) {
    confirmMsg = '\u2705 Night' + ledLabel + ' \u2014 batch 3 hook (' + batchResult.phoneId + ') in coda!';
  } else {
    confirmMsg = '\u2705 Night' + ledLabel + ' \u2014 ' + (batchResult.phoneId || '?') + ': ' + batchResult.count + '/3 scenari pronti.';
  }
  try {
    await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: confirmMsg }),
    });
  } catch (e) { /* non-fatal */ }

  // 7. Auto-load next scenario
  try {
    await autoLoadNextScenario(PREP01_BOT, chatId);
  } catch (e) {
    console.log('[led] auto-next error: ' + e.message);
    try {
      await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '\u26A0\uFE0F Auto-next error: ' + e.message }),
      });
    } catch (e2) { /* non-fatal */ }
  }

  return [{ json: { type: 'led_selection', scenarioRecordId, timeOfDay: 'night', ledColor, chatId } }];
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// DAY/NIGHT CALLBACK â€” tod_day_{scenarioRecordId} / tod_night_{scenarioRecordId}
// Replaces /day and /night text commands with inline keyboard
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
const todMatch = callbackData.match(/^tod_(day|night)_(.+)$/);
if (todMatch) {
  const timeOfDay = todMatch[1];
  const scenarioRecordId = todMatch[2];

  // Answer callback
  if (callbackQueryId) {
    const label = timeOfDay === 'night' ? '\uD83C\uDF19 Night' : '\u2600\uFE0F Day';
    try {
      await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/answerCallbackQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text: label }),
      });
    } catch (e) { /* non-fatal */ }
  }

  if (timeOfDay === 'night') {
    // Update button to show Night selected, then ask LED color
    if (messageId) {
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/editMessageReplyMarkup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '\u2705 \uD83C\uDF19 Night', callback_data: 'noop' }]] },
          }),
        });
      } catch (e) { /* non-fatal */ }
    }

    // Send LED question
    try {
      await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '\uD83C\uDF19 Night \u2014 che LED hai usato?',
          reply_markup: { inline_keyboard: [
            [
              { text: '\uD83D\uDD34 Red', callback_data: 'led_red_' + scenarioRecordId },
              { text: '\uD83D\uDFE3 Purple', callback_data: 'led_purple_' + scenarioRecordId },
            ],
            [
              { text: '\uD83D\uDFE2 Green', callback_data: 'led_green_' + scenarioRecordId },
              { text: '\uD83D\uDD35 Blue', callback_data: 'led_blue_' + scenarioRecordId },
            ],
            [
              { text: '\u26AB No LED', callback_data: 'led_none_' + scenarioRecordId },
            ],
          ] },
        }),
      });
    } catch (e) { /* non-fatal */ }

    return [{ json: { type: 'tod_night_asking_led', scenarioRecordId, chatId, callbackQueryId } }];
  }

  // DAY â€” update button, create hook request inline, confirm
  if (messageId) {
    try {
      await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/editMessageReplyMarkup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: '\u2705 \u2600\uFE0F Day', callback_data: 'noop' }]] },
        }),
      });
    } catch (e) { /* non-fatal */ }
  }

  let dayError = '';
  let dayBatchResult = { created: false, count: 0 };
  try {
    // 1. Fetch scenario record
    const scenRes = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + SCENARIOS_TABLE + '/' + scenarioRecordId, {
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN },
    });
    const scenario = await scenRes.json();
    const sf = scenario.fields || {};
    const conceptRecIds = sf.concept_id || [];
    const conceptRecordId = Array.isArray(conceptRecIds) ? conceptRecIds[0] : (conceptRecIds || '');

    // 2. Round-robin phone assignment
    const dayPhoneAssign = await assignPhoneSequential();
    if (!dayPhoneAssign) throw new Error('No active phones found');
    const dayAssignedPhone = dayPhoneAssign.phone;

    // 3. Fetch concept prompts (by record ID directly)
    const { hookImagePrompt, sora2SpeakingPrompt, conceptIdStr } = await fetchConceptData(conceptRecordId);

    // 4. Update scenario with time_of_day + phone_id + status=ready
    await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + SCENARIOS_TABLE + '/' + scenarioRecordId, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { time_of_day: 'day', led_color: '', phone_id: dayAssignedPhone.phoneId, status: 'ready' } }),
    });

    // 5. Check batch â€” creates queue record if this phone has 3+ ready scenarios
    dayBatchResult = await checkAndCreateBatch(dayAssignedPhone, hookImagePrompt, sora2SpeakingPrompt, conceptIdStr, 'day', '');
  } catch (e) {
    dayError = e.message;
  }

  let dayMsg;
  if (dayError) {
    dayMsg = '\u26A0\uFE0F Hook request failed: ' + dayError;
  } else if (dayBatchResult.created) {
    dayMsg = '\u2705 Day \u2014 batch 3 hook (' + dayBatchResult.phoneId + ') in coda!';
  } else {
    dayMsg = '\u2705 Day \u2014 ' + (dayBatchResult.phoneId || '?') + ': ' + dayBatchResult.count + '/3 scenari pronti.';
  }
  try {
    await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: dayMsg }),
    });
  } catch (e) { /* non-fatal */ }

  // Auto-load next scenario
  try {
    await autoLoadNextScenario(PREP01_BOT, chatId);
  } catch (e) {
    console.log('[day] auto-next error: ' + e.message);
    try {
      await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '\u26A0\uFE0F Auto-next error: ' + e.message }),
      });
    } catch (e2) { /* non-fatal */ }
  }

  return [{ json: { type: 'led_selection', scenarioRecordId, timeOfDay: 'day', ledColor: '', chatId } }];
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// HOOK GENERATOR CALLBACKS â€” img_approve/img_redo/vid_skip/vid_all
// Handled here (webhook) so buttons update INSTANTLY
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?

if (callbackData.startsWith('img_approve_') || callbackData.startsWith('img_redo_')) {
  const isApprove = callbackData.startsWith('img_approve_');
  const recordId = callbackData.replace(/^img_(approve|redo)_/, '');
  const newStatus = isApprove ? 'image_approved' : 'image_redo';

  // Answer callback
  if (callbackQueryId) {
    try {
      await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/answerCallbackQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text: isApprove ? 'Approved!' : 'Will regenerate!' }),
      });
    } catch (e) { /* non-fatal */ }
  }

  // Update button
  if (messageId) {
    try {
      await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/editMessageReplyMarkup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: isApprove ? '\u2705 Approved' : '\uD83D\uDD04 Redo Requested', callback_data: 'noop' }]] },
        }),
      });
    } catch (e) { /* non-fatal */ }
  }

  // Update Airtable
  if (AIRTABLE_TOKEN) {
    try {
      await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + HOOK_QUEUE_TABLE + '/' + recordId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { status: newStatus } }),
      });
    } catch (e) { /* non-fatal */ }
  }

  return [{ json: { type: 'hook_generator', action: isApprove ? 'img_approve' : 'img_redo', recordId, chatId, callbackQueryId } }];
}

if (callbackData.startsWith('vid_skip_') || callbackData.startsWith('vid_all_')) {
  const isSkip = callbackData.startsWith('vid_skip_');
  const recordId = callbackData.replace(/^vid_(skip|all)_/, '');

  // Answer callback
  if (callbackQueryId) {
    try {
      await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/answerCallbackQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text: isSkip ? 'Skipped' : 'Auto-trimming 0s, 5s, 10s' }),
      });
    } catch (e) { /* non-fatal */ }
  }

  // Update button
  if (messageId) {
    try {
      await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/editMessageReplyMarkup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [[{ text: isSkip ? '\u274C Skipped' : '\u2702\uFE0F Auto-trimming...', callback_data: 'noop' }]] },
        }),
      });
    } catch (e) { /* non-fatal */ }
  }

  if (isSkip && AIRTABLE_TOKEN) {
    // Mark as failed
    try {
      await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + HOOK_QUEUE_TABLE + '/' + recordId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { status: 'failed', error_message: 'Skipped by user' } }),
      });
    } catch (e) { /* non-fatal */ }
  }

  if (!isSkip) {
    // vid_all: store trim timestamps in Airtable as a field the batch generator can read
    try {
      await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + HOOK_QUEUE_TABLE + '/' + recordId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { trim_timestamps: '0,5,10', status: 'video_trimming' } }),
      });
    } catch (e) { /* non-fatal */ }
  }

  return [{ json: { type: 'hook_generator', action: isSkip ? 'vid_skip' : 'vid_all', recordId, chatId, callbackQueryId } }];
}

if (callbackData === 'noop') {
  // Already-processed button click, just answer silently
  if (callbackQueryId) {
    try {
      await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/answerCallbackQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    } catch (e) { /* non-fatal */ }
  }
  return [{ json: { type: 'noop', chatId, callbackQueryId } }];
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// SCENARIO APPROVAL â€” approve/redo/skip_{scenarioName}
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
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
