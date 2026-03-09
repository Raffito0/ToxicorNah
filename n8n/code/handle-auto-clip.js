// NODE: Handle Auto Body Clip
// When user sends a video without caption during active recording session.
// Reads state from workflow static data, auto-numbers the clip.
// Mode: Run Once for All Items
//
// WIRING: Switch (auto_body_clip) â†’ this Code node â†’ Save Body Clip (Airtable Create) â†’ Send Confirmation (Telegram)
//
// Airtable Create node should map:
//   clip_name     â†’ {{ $json.clipName }}
//   scenario_id   â†’ {{ [$json.scenarioRecordId] }}   (linked record â€” must be array)
//   clip_index    â†’ {{ $json.clipIndex }}
//   telegram_file_id â†’ {{ $json.fileId }}
//   clip_duration_sec â†’ {{ $json.duration }}
//   clip_type     â†’ {{ $json.clipType }}
//   section       â†’ {{ $json.section }}
//   status        â†’ uploaded
//
// Telegram Send node should use {{ $json.confirmMessage }} as text.

const staticData = $getWorkflowStaticData('global');
const input = $input.first().json;

// â”€â”€â”€ No active recording? â”€â”€â”€
if (!staticData.activeRecording) {
  return [{
    json: {
      error: true,
      chatId: input.chatId,
      message: 'âš ï¸? Nessuna registrazione attiva. Approva prima uno scenario.',
    }
  }];
}

const rec = staticData.activeRecording;
const clipIndex = rec.receivedCount + 1;
const expected = rec.expectedClips || [];
const totalExpected = expected.length;
const segment = expected[rec.receivedCount] || {};

// Increment counter
rec.receivedCount = clipIndex;

// Build clip data for Airtable
const clipName = rec.scenarioName + '_body_' + clipIndex;
const section = segment.section || 'body_' + clipIndex;
const sectionLabel = segment.label || section;

// Confirmation message
let confirm = 'âœ… Clip ' + clipIndex + '/' + totalExpected + ' (' + sectionLabel + ')';
if (clipIndex >= totalExpected) {
  confirm += '\n\nâœ… Tutte le clip ricevute!';
} else {
  const nextSeg = expected[clipIndex];
  if (nextSeg) {
    confirm += '\n\nðŸ‘‰ Prossima: ' + (clipIndex + 1) + '. ' + nextSeg.label;
  }
}

// If all clips received, auto-send day/night keyboard and clear state
const allDone = clipIndex >= totalExpected;
if (allDone) {
  const PREP01_BOT = '8389477139:AAFWFMhwVj7TLWBOtlX-3Pqz7pqK88fP4EU';
  const scenarioRecordId = rec.scenarioRecordId;
  const receivedCount = rec.receivedCount;

  // Helper for display name
  function formatName(raw) {
    if (!raw) return 'Scenario';
    return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  delete staticData.activeRecording;

  try {
    const _https = require('https');
    const _http = require('http');
    const { URL } = require('url');
    function quickFetch(url, opts = {}) {
      return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === 'https:' ? _https : _http;
        const body = opts.body || null;
        const ro = { hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: opts.method || 'GET', headers: { ...(opts.headers || {}) } };
        if (body) ro.headers['Content-Length'] = Buffer.byteLength(body);
        const req = lib.request(ro, res => {
          const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 }); });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      });
    }

    await quickFetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: '\u2705 ' + receivedCount + ' clip ricevute per "' + formatName(rec.scenarioName) + '".\n\nHai registrato di giorno o di notte?',
        reply_markup: { inline_keyboard: [[
          { text: '\u2600\uFE0F Giorno', callback_data: 'tod_day_' + scenarioRecordId },
          { text: '\uD83C\uDF19 Notte', callback_data: 'tod_night_' + scenarioRecordId },
        ]] },
      }),
    });
  } catch (e) { /* non-fatal */ }
}

return [{
  json: {
    clipName,
    scenarioName: rec.scenarioName,
    scenarioRecordId: rec.scenarioRecordId,
    clipIndex,
    section,
    fileId: input.fileId,
    duration: input.duration,
    clipType: 'body',
    chatId: input.chatId,
    confirmMessage: confirm,
    allReceived: allDone,
  }
}];
