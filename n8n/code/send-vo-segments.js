// NODE: Send VO Segments to Telegram (Per-Segment Approval)
// Sends each VO segment as a separate audio message with individual Approve/Redo buttons.
// Saves audio files to /tmp/toxicornah_vo/{recordId}/ for later use by Download Assets.
// Writes vo_segments_json to Airtable for callback handler to use on redo.
// When ALL segments approved (via callback handler), vo_approval â†’ "approved" â†’ pipeline continues.
// Mode: Run Once for All Items

const fs = require('fs');
const path = require('path');

// â”€â”€â”€ fetch polyfill â”€â”€â”€
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
    if (body && typeof body === 'string') ro.headers['Content-Length'] = Buffer.byteLength(body);
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
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : body);
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

const TELEGRAM_BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
const AIRTABLE_TOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
const AIRTABLE_BASE = 'appsgjIdkpak2kaXq';
const VIDEO_RUNS_TABLE = 'tbltCYcVXrLYvyIJL';

const voData = $('Generate VO').first().json;
const voBinary = $('Generate VO').first().binary || {};
const chatId = voData.chatId;
const scenarioName = voData.scenarioName;
const voSegments = voData.voSegments || [];
const recordId = (() => { try { return $('Create Video Run').first().json.id; } catch(e) { return 'unknown'; } })();

// Section display labels
const sectionLabels = {
  'hook': '\uD83C\uDFA3 Hook',
  'screenshot': '\uD83D\uDCF1 Screenshot',
  'upload_chat': '\uD83D\uDCE4 Upload',
  'toxic_score': '\u2620\uFE0F Toxic Score',
  'soul_type': '\uD83D\uDC7B Soul Type',
  'deep_dive': '\uD83D\uDD2C Deep Dive',
  'outro': '\uD83D\uDC4B Outro',
};

// â”€â”€â”€ Save VO files to disk for later use â”€â”€â”€
const voDir = '/tmp/toxicornah_vo/' + recordId;
if (!fs.existsSync(voDir)) {
  fs.mkdirSync(voDir, { recursive: true });
}

// Build vo_segments_json for Airtable (tracks text + status for callback handler)
const segmentsData = [];

// Send each VO segment with individual Approve/Redo buttons
let sentCount = 0;
for (const seg of voSegments) {
  if (!seg.hasAudio) {
    // No audio for this section â€” track but skip sending
    segmentsData.push({
      index: seg.index,
      section: seg.section,
      text: null,
      status: 'skip',
    });
    continue;
  }

  const binaryKey = 'voSegment_' + seg.index;
  const binary = voBinary[binaryKey];
  if (!binary) {
    segmentsData.push({
      index: seg.index,
      section: seg.section,
      text: seg.text,
      status: 'skip',
    });
    continue;
  }

  // Save audio file to disk
  const audioBuffer = Buffer.from(binary.data, 'base64');
  const filePath = path.join(voDir, 'vo_' + seg.index + '.mp3');
  fs.writeFileSync(filePath, audioBuffer);

  // Track in segments data (speed defaults to 1.0)
  segmentsData.push({
    index: seg.index,
    section: seg.section,
    text: seg.text,
    status: 'pending',
    speed: 1.0,
  });

  // Build caption and buttons
  const label = sectionLabels[seg.section] || seg.section;
  const caption = label + ' VO\n"' + (seg.text || '').substring(0, 180) + '"';

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '\u2705 Approve', callback_data: 'vpVoOk_' + recordId + '_' + seg.index },
        { text: '\uD83D\uDD04 Redo', callback_data: 'vpVoRedo_' + recordId + '_' + seg.index },
      ],
      [
        { text: '\uD83D\uDC22 Slower', callback_data: 'vpVoSlower_' + recordId + '_' + seg.index },
        { text: '\u26A1 Faster', callback_data: 'vpVoFaster_' + recordId + '_' + seg.index },
      ],
    ],
  };

  try {
    await sendTelegramAudio(TELEGRAM_BOT_TOKEN, chatId, audioBuffer, 'vo_' + seg.section + '.mp3', caption, replyMarkup);
    sentCount++;
    // Small delay between messages to avoid rate limiting
    if (sentCount < voSegments.filter(s => s.hasAudio).length) {
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) {
    // Non-fatal: continue sending others
  }
}

// â”€â”€â”€ Write vo_segments_json to Airtable â”€â”€â”€
if (AIRTABLE_TOKEN && recordId && recordId !== 'unknown') {
  try {
    await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + VIDEO_RUNS_TABLE + '/' + recordId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + AIRTABLE_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          vo_segments_json: JSON.stringify(segmentsData),
        },
      }),
    });
  } catch (e) {
    // Non-fatal but log
  }
}

// Send summary message
const pendingCount = segmentsData.filter(s => s.status === 'pending').length;
const summary = '\uD83C\uDFA4 ' + sentCount + ' VO segments for "' + scenarioName + '"\n\nApprove or redo each one above. Pipeline continues when all are approved.';
try {
  await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: summary,
    }),
  });
} catch (e) {
  // Non-fatal
}

return [{ json: { sent: sentCount, chatId, scenarioName, recordId, voDir } }];
