// NODE: Handle Done Recording
// When user sends /done, saves clip count and sends day/night inline keyboard.
// The callback handler (tod_day/tod_night) completes the flow.
// Mode: Run Once for All Items

// â”€â”€â”€ fetch polyfill â”€â”€â”€
const _https = require('https');
const _http = require('http');
const { URL } = require('url');
function fetch(url, opts = {}, _rc = 0) {
  return new Promise((resolve, reject) => {
    if (_rc > 5) return reject(new Error('Too many redirects'));
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? _https : _http;
    const body = opts.body || null;
    const ro = { hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: opts.method || 'GET', headers: { ...(opts.headers || {}) } };
    if (body) ro.headers['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(ro, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) { res.resume(); return fetch(res.headers.location.startsWith('http') ? res.headers.location : u.protocol+'//'+u.host+res.headers.location, opts, _rc+1).then(resolve).catch(reject); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: () => Promise.resolve(buf.toString()), json: () => Promise.resolve(JSON.parse(buf.toString())) }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const PREP01_BOT = '8389477139:AAFWFMhwVj7TLWBOtlX-3Pqz7pqK88fP4EU';

const staticData = $getWorkflowStaticData('global');
const input = $input.first().json;

// â”€â”€â”€ No active recording? â”€â”€â”€
if (!staticData.activeRecording) {
  return [{
    json: {
      error: true,
      chatId: input.chatId,
      message: '\u26A0\uFE0F Nessuna registrazione attiva.',
    }
  }];
}

// Helper: "toxic-sad-happy-girl-1771197483216" â†’ "Toxic Sad Happy Girl"
function formatName(raw) {
  if (!raw) return 'Scenario';
  return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const rec = staticData.activeRecording;
const scenarioName = rec.scenarioName;
const scenarioRecordId = rec.scenarioRecordId;
const receivedCount = rec.receivedCount;

// No clips sent? Reset state and skip
if (receivedCount === 0) {
  delete staticData.activeRecording;
  return [{
    json: {
      error: true,
      chatId: input.chatId,
      message: '\uD83D\uDDD1\uFE0F Registrazione "' + formatName(scenarioName) + '" annullata. Manda /next per il prossimo.',
    }
  }];
}

// Save clip count then clear state â€” callback is handled by Unified Pipeline (different workflow)
staticData.activeRecording.clipCount = receivedCount;
delete staticData.activeRecording;

// Send day/night inline keyboard directly via Telegram API
let sendResult = 'skipped';
if (PREP01_BOT) {
  try {
    const res = await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: '\u2705 ' + receivedCount + ' clip ricevute per "' + formatName(scenarioName) + '".\n\nHai registrato di giorno o di notte?',
        reply_markup: { inline_keyboard: [
          [
            { text: '\u2600\uFE0F Giorno', callback_data: 'tod_day_' + scenarioRecordId },
            { text: '\uD83C\uDF19 Notte', callback_data: 'tod_night_' + scenarioRecordId },
          ],
        ] },
      }),
    });
    const resText = await res.text();
    sendResult = 'status=' + res.status + ' body=' + resText.substring(0, 300);
  } catch (e) { sendResult = 'error: ' + (e.message || e); }
}

// Return error:true so the workflow doesn't continue to the Airtable update chain
// The callback handler (tod_day/tod_night/led_*) will handle the rest
return [{
  json: {
    error: true,
    chatId: input.chatId,
    message: '', // empty â€” already sent via API above
    _debug_send: sendResult,
    _debug_scenarioRecordId: scenarioRecordId,
    _debug_receivedCount: receivedCount,
  }
}];
