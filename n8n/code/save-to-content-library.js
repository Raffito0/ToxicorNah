// NODE: Save to Content Library
// After video is assembled and sent to Telegram, saves the video + metadata
// to Airtable Content Library for ADB software to consume.
// Mode: Run Once for All Items
//
// WIRING: Send Final Video → this Code node (parallel with Update Run Complete)
// References: $('Assemble Video'), $('Prepare Production'), $('Create Video Run'),
//             $('Find Concept'), $('Send Final Video')

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
          text: () => Promise.resolve(buf.toString()),
          json: () => Promise.resolve(JSON.parse(buf.toString())),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
const BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
const ABASE = 'https://api.airtable.com/v0/appsgjIdkpak2kaXq';
const CONTENT_LIBRARY_TABLE = 'tblx1KX7mlTX5QyGb';

try {
  const assembled = $('Assemble Video').first().json;
  const production = $('Prepare Production').first().json;

  const scenarioName = assembled.scenarioName || production.scenarioName || 'unknown';
  const phoneRecordId = production.phoneRecordId || '';
  const phoneName = production.phoneName || '';
  const copyJson = production.copyJson;
  const socialCaption = (copyJson && copyJson.socialCaption) || '';

  // Get run record ID
  let runRecordId = '';
  try { runRecordId = $('Create Video Run').first().json.id || ''; } catch (e) {}

  // Get concept record ID
  let conceptRecordId = '';
  try { conceptRecordId = $('Find Concept').first().json.id || ''; } catch (e) {}

  // Extract Telegram video file_id from Send Final Video response
  let videoAttachmentUrl = '';
  try {
    const tgResult = $('Send Final Video').first().json;
    const fileId = (tgResult.video || tgResult.document || tgResult.animation || {}).file_id;
    if (fileId && BOT_TOKEN) {
      const gfRes = await fetch(
        'https://api.telegram.org/bot' + BOT_TOKEN + '/getFile?file_id=' + fileId
      );
      const gfData = await gfRes.json();
      if (gfData.ok && gfData.result && gfData.result.file_path) {
        videoAttachmentUrl = 'https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + gfData.result.file_path;
        console.log('[ContentLib] Got Telegram CDN URL for video');
      }
    }
  } catch (e) {
    console.log('[ContentLib] getFile failed: ' + e.message);
  }

  if (!ATOKEN) {
    console.log('[ContentLib] No AIRTABLE_API_KEY — skipping');
    return [{ json: { success: false, error: 'no_api_key' } }];
  }

  // Build Content Library record fields
  const fields = {
    content_label: scenarioName + (phoneName ? ' \u2014 ' + phoneName : ''),
    social_caption: socialCaption,
    platform_status_tiktok: 'pending',
    platform_status_instagram: 'pending',
  };

  if (phoneRecordId) fields.phone_id = [phoneRecordId];
  if (runRecordId) fields.run_id = [runRecordId];
  if (conceptRecordId) fields.concept_id = [conceptRecordId];

  // Airtable fetches the URL immediately and stores the file permanently
  if (videoAttachmentUrl) {
    fields.video_attachment = [{ url: videoAttachmentUrl }];
    fields.video_url = videoAttachmentUrl;
  }

  // Create record
  const createRes = await fetch(ABASE + '/' + CONTENT_LIBRARY_TABLE, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + ATOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  const createData = await createRes.json();

  if (createData.id) {
    console.log('[ContentLib] Record created: ' + createData.id + ' for ' + scenarioName);
    return [{ json: { success: true, contentRecordId: createData.id, phoneName, scenarioName } }];
  } else {
    console.log('[ContentLib] Create failed: ' + JSON.stringify(createData).slice(0, 300));
    return [{ json: { success: false, error: JSON.stringify(createData).slice(0, 200) } }];
  }

} catch (e) {
  console.log('[ContentLib] Error: ' + e.message);
  return [{ json: { success: false, error: e.message } }];
}
