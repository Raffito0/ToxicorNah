// NODE: Save to Content Library
// After video is assembled and sent to Telegram, saves the video + metadata
// to Airtable Content Library for ADB software to consume.
// Mode: Run Once for All Items
//
// WIRING: Send Final Video → this Code node (parallel with Update Run Complete)
// References: $('Assemble Video'), $('Prepare Production'), $('Create Video Run'),
//             $('Find Concept'), $('Send Final Video')

// ─── polyfills (n8n Code node sandbox) ───
const _https = require('https');
const _http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

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
      ro.headers['Content-Length'] = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
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
          buffer: () => Promise.resolve(buf),
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

// ─── R2 upload via S3 API (AWS Signature V4) ───
function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data).digest(encoding);
}
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function uploadToR2(bucket, key, bodyBuffer, contentType) {
  const accessKeyId = (typeof $env !== 'undefined' && $env.R2_ACCESS_KEY_ID) || '';
  const secretAccessKey = (typeof $env !== 'undefined' && $env.R2_SECRET_ACCESS_KEY) || '';
  const accountId = (typeof $env !== 'undefined' && $env.R2_ACCOUNT_ID) || '';

  if (!accessKeyId || !secretAccessKey || !accountId) {
    return Promise.reject(new Error('R2 credentials missing'));
  }

  const host = accountId + '.r2.cloudflarestorage.com';
  const region = 'auto';
  const service = 's3';
  const method = 'PUT';
  const path = '/' + bucket + '/' + key;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256(bodyBuffer);
  const headers = {
    'Host': host,
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Length': String(bodyBuffer.length),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const signedHeaders = signedHeaderKeys.join(';');
  const canonicalHeaders = signedHeaderKeys.map(k => k + ':' + headers[Object.keys(headers).find(h => h.toLowerCase() === k)]).join('\n') + '\n';

  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
  const stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + sha256(canonicalRequest);

  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');

  const authHeader = 'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  return new Promise((resolve, reject) => {
    const ro = {
      hostname: host,
      path: path,
      method: 'PUT',
      headers: { ...headers, 'Authorization': authHeader },
    };
    const req = _https.request(ro, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode });
        } else {
          reject(new Error('R2 upload failed: HTTP ' + res.statusCode + ' — ' + Buffer.concat(chunks).toString().slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

// ─── main ───
const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
const BOT_TOKEN = (typeof $env !== 'undefined' && $env.TELEGRAM_BOT_TOKEN) || '';
const ABASE = 'https://api.airtable.com/v0/appsgjIdkpak2kaXq';
const CONTENT_LIBRARY_TABLE = 'tblx1KX7mlTX5QyGb';
const R2_PUBLIC_URL = (typeof $env !== 'undefined' && $env.R2_PUBLIC_URL) || '';
const R2_BUCKET = 'toxic-or-nah';

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

  // Download video from Telegram → upload to R2 → permanent URL
  let videoPublicUrl = '';
  try {
    const tgResult = $('Send Final Video').first().json;
    const fileId = (tgResult.video || tgResult.document || tgResult.animation || {}).file_id;
    if (fileId && BOT_TOKEN) {
      const gfRes = await fetch(
        'https://api.telegram.org/bot' + BOT_TOKEN + '/getFile?file_id=' + fileId
      );
      const gfData = await gfRes.json();
      if (gfData.ok && gfData.result && gfData.result.file_path) {
        const tgUrl = 'https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + gfData.result.file_path;
        console.log('[ContentLib] Downloading video from Telegram...');

        // Download video binary
        const dlRes = await fetch(tgUrl);
        if (!dlRes.ok) throw new Error('Download failed: HTTP ' + dlRes.status);
        const videoBuf = await dlRes.buffer();
        console.log('[ContentLib] Downloaded ' + (videoBuf.length / 1024 / 1024).toFixed(1) + 'MB');

        // Upload to R2
        const ts = Date.now();
        const safeName = scenarioName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
        const r2Key = 'videos/' + safeName + '_' + ts + '.mp4';

        await uploadToR2(R2_BUCKET, r2Key, videoBuf, 'video/mp4');
        videoPublicUrl = R2_PUBLIC_URL + '/' + r2Key;
        console.log('[ContentLib] Uploaded to R2: ' + videoPublicUrl);
      }
    }
  } catch (e) {
    console.log('[ContentLib] R2 upload failed: ' + e.message);
    // Fallback: try Telegram URL directly (may expire)
    try {
      const tgResult = $('Send Final Video').first().json;
      const fileId = (tgResult.video || tgResult.document || tgResult.animation || {}).file_id;
      if (fileId && BOT_TOKEN) {
        const gfRes = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getFile?file_id=' + fileId);
        const gfData = await gfRes.json();
        if (gfData.ok && gfData.result && gfData.result.file_path) {
          videoPublicUrl = 'https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + gfData.result.file_path;
          console.log('[ContentLib] Fallback to Telegram URL (may expire)');
        }
      }
    } catch (e2) {}
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

  if (videoPublicUrl) {
    fields.video_attachment = [{ url: videoPublicUrl }];
    fields.video_url = videoPublicUrl;
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
    return [{ json: { success: true, contentRecordId: createData.id, phoneName, scenarioName, videoUrl: videoPublicUrl } }];
  } else {
    console.log('[ContentLib] Create failed: ' + JSON.stringify(createData).slice(0, 300));
    return [{ json: { success: false, error: JSON.stringify(createData).slice(0, 200) } }];
  }

} catch (e) {
  console.log('[ContentLib] Error: ' + e.message);
  return [{ json: { success: false, error: e.message } }];
}
