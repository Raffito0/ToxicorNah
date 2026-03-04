// NODE: Process Review (Telegram Webhook — instant response)
// Handles all Telegram review interactions for Hook Generator:
//   - Timestamps (e.g. "0.7" or "0.5 4.2 9.8")
//   - Approvals ("all" or "1 3")
//   - Skips ("skip")
//
// Triggered instantly by Telegram Webhook Trigger node.
// Replaces Phase 3 (getUpdates polling) from the scheduled Hook Generator.
//
// WIRING: Telegram Trigger → this Code node
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
const HOOK_POOL_TABLE = 'tbl3q91o3l0isSX9w';
const QUEUE_TABLE = 'tblXpyxSLN2vSJ4i3';

const ATOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';

const PREP01_BOT = '8686184447:AAH688Be7c19XdzwFzOmONyrnrTCc-q8VHg';
const ADMIN_CHAT = '5120450288';

const CLIP_DURATION = 3;

// ─── Telegram helpers ───
async function sendTelegram(text, replyMarkup) {
  try {
    const payload = { chat_id: ADMIN_CHAT, text: text };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const res = await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data.result && data.result.message_id;
  } catch (e) {
    console.log('[review] Telegram send error: ' + e.message);
    return null;
  }
}

async function sendTelegramVideo(buffer, caption) {
  try {
    const boundary = '----TGBoundary' + Date.now();
    const header =
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="chat_id"\r\n\r\n' +
      ADMIN_CHAT + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="caption"\r\n\r\n' +
      (caption || '') + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="video"; filename="clip.mp4"\r\n' +
      'Content-Type: video/mp4\r\n\r\n';
    const prefix = Buffer.from(header);
    const suffix = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([prefix, buffer, suffix]);
    console.log('[review] Sending video: ' + buffer.length + ' bytes, total body: ' + body.length + ' bytes');
    const res = await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/sendVideo', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: body,
    });
    const data = await res.json();
    if (!data.ok) { console.log('[review] sendVideo error: ' + JSON.stringify(data)); return null; }
    return data.result.message_id;
  } catch (e) {
    console.log('[review] Video send error: ' + e.message);
    return null;
  }
}

async function deleteTelegramMessage(messageId) {
  try {
    await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/deleteMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT, message_id: messageId }),
    });
  } catch (e) { console.log('[review] Telegram delete error: ' + e.message); }
}

// ─── FFmpeg trim (two-step: re-encode full → extract clip) ───
function trimClip(videoPath, startSec, keepAudio) {
  // Step 1: re-encode full video to clean H.264 (proven to work — same as burnTimecode)
  const h264Path = videoPath.replace('.mp4', '_h264.mp4');
  const audioFlag = keepAudio ? '-c:a aac' : '-an';
  console.log('[review] Step 1: Re-encoding to H.264 (audio: ' + (keepAudio ? 'keep' : 'strip') + ')...');
  execSync(
    'ffmpeg -y -i "' + videoPath + '" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p ' + audioFlag + ' -movflags +faststart "' + h264Path + '"',
    { timeout: 120000 }
  );
  const h264Size = fs.statSync(h264Path).size;
  console.log('[review] H.264 full video: ' + h264Size + ' bytes');

  // Step 2: extract clip with stream copy (fast, reliable)
  const outPath = videoPath.replace('.mp4', '_trim_' + startSec + '.mp4');
  console.log('[review] Step 2: Extracting clip at ' + startSec + 's...');
  execSync(
    'ffmpeg -y -ss ' + startSec + ' -i "' + h264Path + '" -t ' + CLIP_DURATION + ' -c copy -movflags +faststart "' + outPath + '"',
    { timeout: 30000 }
  );

  const clipSize = fs.statSync(outPath).size;
  console.log('[review] Clip size: ' + clipSize + ' bytes');
  try { fs.unlinkSync(h264Path); } catch (e) {}

  if (clipSize < 5000) {
    throw new Error('Clip too small (' + clipSize + ' bytes) — likely corrupt');
  }
  return outPath;
}

// ─── Upload to catbox.moe ───
async function uploadFile(buffer, filename) {
  const boundary = '----CatboxBoundary' + Date.now();
  let parts = '';
  parts += '--' + boundary + '\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n';
  parts += '--' + boundary + '\r\nContent-Disposition: form-data; name="fileToUpload"; filename="' + filename + '"\r\nContent-Type: video/mp4\r\n\r\n';
  const prefix = Buffer.from(parts);
  const suffix = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([prefix, buffer, suffix]);

  console.log('[review] Uploading to catbox.moe (' + buffer.length + ' bytes)...');
  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body: body,
  });
  const url = (await res.text()).trim();
  if (!url.startsWith('http')) throw new Error('Catbox upload failed: ' + url.slice(0, 200));
  console.log('[review] Catbox URL: ' + url);
  return url;
}

// ─── Airtable helpers ───
async function airtableFetch(tablePath, options) {
  options = options || {};
  const res = await fetch('https://api.airtable.com/v0/' + ABASE + '/' + tablePath, {
    method: options.method || 'GET',
    headers: { 'Authorization': 'Bearer ' + ATOKEN, 'Content-Type': 'application/json' },
    body: options.body || undefined,
  });
  if (!res.ok) throw new Error('Airtable ' + tablePath + ': ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

async function queueUpdate(recordId, fields) {
  return airtableFetch(QUEUE_TABLE, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: recordId, fields: fields }] }),
  });
}

async function poolCreate(fields) {
  return airtableFetch(HOOK_POOL_TABLE, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: fields }] }),
  });
}

// ─── Counter message helpers ───
// Stores the "Clips saved" counter msg_id in a special __counter__ queue record
async function getCounter() {
  try {
    const formula = encodeURIComponent("{task_id}='__counter__'");
    const data = await airtableFetch(QUEUE_TABLE + '?filterByFormula=' + formula + '&maxRecords=1');
    if (data.records && data.records.length > 0) {
      const r = data.records[0];
      return { recordId: r.id, msgId: parseInt(r.fields.telegram_msg_id || '0') || 0 };
    }
  } catch (e) { console.log('[review] getCounter error: ' + e.message); }
  return { recordId: null, msgId: 0 };
}

async function saveCounter(msgId, existingRecordId) {
  if (existingRecordId) {
    await queueUpdate(existingRecordId, { telegram_msg_id: String(msgId) });
  } else {
    await airtableFetch(QUEUE_TABLE, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields: { task_id: '__counter__', telegram_msg_id: String(msgId) } }] }),
    });
  }
}

async function updateCounterMessage(newClips) {
  // Count total ready hooks in pool
  let totalReady = 0;
  try {
    const formula = encodeURIComponent("{status}='ready'");
    const poolData = await airtableFetch(HOOK_POOL_TABLE + '?filterByFormula=' + formula + '&fields%5B%5D=status&pageSize=100');
    totalReady = (poolData.records || []).length;
  } catch (e) {}

  // Delete old counter message
  const counter = await getCounter();
  if (counter.msgId) await deleteTelegramMessage(counter.msgId);

  // Send new counter
  const counterMsgId = await sendTelegram('Hook Pool: ' + totalReady + '/20 ready');
  if (counterMsgId) await saveCounter(counterMsgId, counter.recordId);
}


// ═══════════════════════════════════════════════════════
// MAIN — Process incoming Telegram update (message or callback_query)
// ═══════════════════════════════════════════════════════

const result = { processed: false, action: null };

if (!ATOKEN) {
  console.log('[review] No AIRTABLE_API_KEY — exiting');
  return [{ json: { skipped: true, reason: 'no_api_key' } }];
}

const input = $input.first();

// ═══════════════════════════════════════════════════════
// CALLBACK QUERY — Hook image approval (inline keyboard buttons)
// ═══════════════════════════════════════════════════════

const callbackQuery = input.json.callback_query || null;
if (callbackQuery) {
  const cbData = callbackQuery.data || '';
  const cbId = callbackQuery.id || '';
  const cbChatId = callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id;
  const cbMsgId = callbackQuery.message && callbackQuery.message.message_id;

  if (cbData.startsWith('hookImg_ok_') || cbData.startsWith('hookImg_redo_')) {
    const isApprove = cbData.startsWith('hookImg_ok_');
    const prefix = isApprove ? 'hookImg_ok_' : 'hookImg_redo_';
    const queueRecordId = cbData.substring(prefix.length);

    // Answer callback immediately (removes loading spinner)
    if (cbId) {
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/answerCallbackQuery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: cbId,
            text: isApprove ? '\u2705 Image approved!' : '\uD83D\uDD04 Regenerating image...',
          }),
        });
      } catch (e) { /* non-fatal */ }
    }

    // Update inline keyboard to show result
    if (cbMsgId) {
      const btnText = isApprove ? '\u2705 Approved — submitting to Sora 2...' : '\uD83D\uDD04 Redoing...';
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/editMessageReplyMarkup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cbChatId,
            message_id: cbMsgId,
            reply_markup: { inline_keyboard: [[{ text: btnText, callback_data: 'noop' }]] },
          }),
        });
      } catch (e) { /* non-fatal */ }
    }

    // Update Airtable queue record
    const newStatus = isApprove ? 'image_approved' : 'image_redo';
    try {
      await queueUpdate(queueRecordId, { status: newStatus });
      console.log('[review] Hook image ' + (isApprove ? 'approved' : 'redo') + ': ' + queueRecordId);
    } catch (e) {
      console.log('[review] Airtable update error: ' + e.message);
    }

    return [{ json: { type: 'hook_image_approval', action: isApprove ? 'approve' : 'redo', recordId: queueRecordId } }];
  }

  // ─── review_skip_ — Skip video at timestamp step (inline button) ───
  if (cbData.startsWith('review_skip_')) {
    const queueRecordId = cbData.substring('review_skip_'.length);

    if (cbId) {
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/answerCallbackQuery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cbId, text: '\u23ED Skipped!' }),
        });
      } catch (e) { /* non-fatal */ }
    }

    // Remove inline keyboard
    if (cbMsgId) {
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/editMessageReplyMarkup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } }),
        });
      } catch (e) { /* non-fatal */ }
    }

    // Same logic as text "skip" in review_sent
    try {
      const recData = await airtableFetch(QUEUE_TABLE + '/' + queueRecordId);
      const rf = recData.fields || {};
      await queueUpdate(queueRecordId, { status: 'failed', error_message: 'Skipped by user' });
      let skipMsgIds = [];
      try { skipMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
      for (const mid of skipMsgIds) { await deleteTelegramMessage(mid); }
      await updateCounterMessage(0);
    } catch (e) {
      console.log('[review] review_skip error: ' + e.message);
    }

    return [{ json: { type: 'review_skip', recordId: queueRecordId } }];
  }

  // ─── clips_all_ — Approve all clips (inline button) ───
  if (cbData.startsWith('clips_all_')) {
    const queueRecordId = cbData.substring('clips_all_'.length);

    if (cbId) {
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/answerCallbackQuery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cbId, text: '\u2705 Approving all clips...' }),
        });
      } catch (e) { /* non-fatal */ }
    }

    // Update keyboard to show progress
    if (cbMsgId) {
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/editMessageReplyMarkup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cbChatId, message_id: cbMsgId,
            reply_markup: { inline_keyboard: [[{ text: '\u2705 Saving clips...', callback_data: 'noop' }]] },
          }),
        });
      } catch (e) { /* non-fatal */ }
    }

    // Load record and run same logic as text "all"
    try {
      const recData = await airtableFetch(QUEUE_TABLE + '/' + queueRecordId);
      const rf = recData.fields || {};

      let timestamps = [];
      try { timestamps = JSON.parse(rf.timestamps_json || '[]'); } catch (e) {}
      let hookTexts = [];
      try { hookTexts = JSON.parse(rf.hook_texts_json || '[]'); } catch (e) {}
      let scenarioIds = [];
      try { scenarioIds = JSON.parse(rf.scenario_ids_json || '[]'); } catch (e) {}

      const approvedIndices = hookTexts.map(function(_, i) { return i; });
      const videoUrl = rf.video_url;
      const hookMode = rf.hook_mode || 'speaking';
      const conceptId = rf.concept_id || '';
      const conceptName = rf.concept_name || '';
      const girlRefUrl = rf.girl_ref_url || '';
      const sourceImageUrl = rf.source_image_url || '';

      let clipsSaved = 0;
      const vidRes = await fetch(videoUrl);
      if (!vidRes.ok) throw new Error('Video re-download failed: ' + vidRes.status);
      const videoBuffer = Buffer.from(await vidRes.arrayBuffer());
      const rawPath = '/tmp/review_cb_approve_' + Date.now() + '.mp4';
      fs.writeFileSync(rawPath, videoBuffer);

      const batchId = 'gen_' + new Date().toISOString().slice(0, 10) + '_' + queueRecordId.slice(-5);
      let lastClipError = '';

      for (const idx of approvedIndices) {
        const ts = timestamps[idx];
        const ht = hookTexts[idx] || '';
        const scenarioId = scenarioIds[idx] || '';
        try {
          const trimPath = trimClip(rawPath, ts, hookMode === 'speaking');
          const clipBuffer = fs.readFileSync(trimPath);
          const clipUrl = await uploadFile(clipBuffer, 'hook_' + batchId + '_' + idx + '.mp4');

          await poolCreate({
            batch_id: batchId, concept_id: conceptId, concept_name: conceptName,
            hook_type: hookMode, girl_ref_url: girlRefUrl, source_image_url: sourceImageUrl,
            source_video_url: videoUrl,
            video_file: [{ url: clipUrl }],
            clip_start_sec: ts, clip_duration_sec: CLIP_DURATION, hook_text: ht,
            scenario_id: scenarioId, status: 'ready', created_at: new Date().toISOString(),
          });

          clipsSaved++;
          try { fs.unlinkSync(trimPath); } catch (e) {}
        } catch (e) {
          lastClipError = e.message;
          console.log('[review] clips_all save error clip ' + idx + ': ' + e.message);
        }
      }

      try { fs.unlinkSync(rawPath); } catch (e) {}

      if (clipsSaved > 0) {
        await queueUpdate(queueRecordId, { status: 'clips_saved', reviewed_at: new Date().toISOString() });
        let allMsgIds = [];
        try { allMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
        for (const mid of allMsgIds) { await deleteTelegramMessage(mid); }
        await updateCounterMessage(clipsSaved);
      } else {
        await sendTelegram('Upload failed: ' + (lastClipError || 'unknown') + '\nReply "all" to retry or "skip".');
      }
    } catch (e) {
      console.log('[review] clips_all error: ' + e.message);
      await sendTelegram('Error saving clips: ' + e.message);
    }

    return [{ json: { type: 'clips_approve_all', recordId: queueRecordId } }];
  }

  // ─── clips_skip_ — Skip all clips (inline button) ───
  if (cbData.startsWith('clips_skip_')) {
    const queueRecordId = cbData.substring('clips_skip_'.length);

    if (cbId) {
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/answerCallbackQuery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cbId, text: '\u23ED Skipped!' }),
        });
      } catch (e) { /* non-fatal */ }
    }

    if (cbMsgId) {
      try {
        await fetch('https://api.telegram.org/bot' + PREP01_BOT + '/editMessageReplyMarkup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } }),
        });
      } catch (e) { /* non-fatal */ }
    }

    try {
      const recData = await airtableFetch(QUEUE_TABLE + '/' + queueRecordId);
      const rf = recData.fields || {};
      await queueUpdate(queueRecordId, { status: 'failed', error_message: 'Skipped at approval' });
      let skipMsgIds = [];
      try { skipMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
      for (const mid of skipMsgIds) { await deleteTelegramMessage(mid); }
      await updateCounterMessage(0);
    } catch (e) {
      console.log('[review] clips_skip error: ' + e.message);
    }

    return [{ json: { type: 'clips_skip', recordId: queueRecordId } }];
  }

  // Unknown callback — ignore
  console.log('[review] Unknown callback: ' + cbData);
  return [{ json: { skipped: true, reason: 'unknown_callback', data: cbData } }];
}

// ═══════════════════════════════════════════════════════
// TEXT MESSAGE — Process review (timestamps, approvals, skips)
// ═══════════════════════════════════════════════════════

// Get the message from Telegram Trigger node
const message = input.json.message || input.json;
const chatId = message.chat && message.chat.id && message.chat.id.toString();
const userText = (message.text || '').trim();
const userMsgId = message.message_id; // Track for cleanup

if (!userText) {
  console.log('[review] No text in message — ignoring');
  return [{ json: { skipped: true, reason: 'no_text' } }];
}

if (chatId !== ADMIN_CHAT) {
  console.log('[review] Message from unknown chat: ' + chatId);
  return [{ json: { skipped: true, reason: 'wrong_chat' } }];
}

console.log('[review] Received: "' + userText + '"');

// Find the oldest record waiting for review
let reviewRecord = null;
try {
  const formula = encodeURIComponent("OR({status}='review_sent',{status}='clips_preview_sent')");
  const qData = await airtableFetch(
    QUEUE_TABLE + '?filterByFormula=' + formula +
    '&sort%5B0%5D%5Bfield%5D=submitted_at&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=1'
  );
  if (qData.records && qData.records.length > 0) reviewRecord = qData.records[0];
} catch (e) {
  console.log('[review] Query error: ' + e.message);
  return [{ json: { error: e.message } }];
}

if (!reviewRecord) {
  console.log('[review] No pending review — ignoring message');
  return [{ json: { skipped: true, reason: 'no_pending_review' } }];
}

const rf = reviewRecord.fields;
const reviewStatus = rf.status;
console.log('[review] Record ' + reviewRecord.id + ' status: ' + reviewStatus);

// ─── WAITING FOR TIMESTAMPS ───
if (reviewStatus === 'review_sent') {
  if (userText.toLowerCase() === 'skip') {
    await queueUpdate(reviewRecord.id, { status: 'failed', error_message: 'Skipped by user' });
    let skipMsgIds = [];
    try { skipMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
    skipMsgIds.push(userMsgId);
    for (const mid of skipMsgIds) { await deleteTelegramMessage(mid); }
    await updateCounterMessage(0);
    result.processed = true;
    result.action = 'skipped';

  } else {
    // Parse timestamps
    const timestamps = userText.split(/[\s,]+/).map(function(t) { return parseFloat(t); }).filter(function(t) { return !isNaN(t); });
    let hookTexts = [];
    try { hookTexts = JSON.parse(rf.hook_texts_json || '[]'); } catch (e) {}
    let scenarioIds = [];
    try { scenarioIds = JSON.parse(rf.scenario_ids_json || '[]'); } catch (e) {}

    if (timestamps.length !== hookTexts.length) {
      await sendTelegram('Expected ' + hookTexts.length + ' timestamps, got ' + timestamps.length + '. Try again or "skip".');
    } else {
      const validTs = timestamps.every(function(t) { return t >= 0 && t <= 12; });
      if (!validTs) {
        await sendTelegram('Timestamps must be 0-12 (each clip = 3s from start). Decimals OK (e.g. 0.5). Try again or "skip".');
      } else {
        // Download video and trim clips
        const videoUrl = rf.video_url;
        const hookMode = rf.hook_mode || 'speaking';
        const isSpeaking = hookMode === 'speaking';

        try {
          const vidRes = await fetch(videoUrl);
          if (!vidRes.ok) throw new Error('Video download failed: ' + vidRes.status);
          const videoBuffer = Buffer.from(await vidRes.arrayBuffer());
          const rawPath = '/tmp/review_raw_' + Date.now() + '.mp4';
          fs.writeFileSync(rawPath, videoBuffer);

          let allMsgIds = [];
          try { allMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
          allMsgIds.push(userMsgId);

          for (let ci = 0; ci < timestamps.length; ci++) {
            const ts = timestamps[ci];
            const ht = hookTexts[ci] || '';
            try {
              const trimPath = trimClip(rawPath, ts, isSpeaking);
              const clipBuffer = fs.readFileSync(trimPath);
              const audioLabel = isSpeaking ? '' : ' (silent)';
              const clipMsgId = await sendTelegramVideo(clipBuffer, 'Clip ' + (ci + 1) + '/' + timestamps.length + audioLabel + ': "' + ht.slice(0, 50) + '"');
              if (clipMsgId) allMsgIds.push(clipMsgId);
              try { fs.unlinkSync(trimPath); } catch (e) {}
            } catch (e) {
              await sendTelegram('Clip ' + (ci + 1) + ' trim failed: ' + e.message);
            }
          }

          try { fs.unlinkSync(rawPath); } catch (e) {}

          const approveKeyboard = {
            inline_keyboard: [[
              { text: '\u2705 Approve All', callback_data: 'clips_all_' + reviewRecord.id },
              { text: '\u23ED Skip', callback_data: 'clips_skip_' + reviewRecord.id },
            ]],
          };
          const promptMsgId = await sendTelegram('Tap to approve, or reply "1 3" for selective', approveKeyboard);
          if (promptMsgId) allMsgIds.push(promptMsgId);

          await queueUpdate(reviewRecord.id, {
            status: 'clips_preview_sent',
            timestamps_json: JSON.stringify(timestamps),
            telegram_msg_id: JSON.stringify(allMsgIds),
          });
          result.processed = true;
          result.action = 'clips_trimmed';

        } catch (e) {
          console.log('[review] Trim error: ' + e.message);
          await queueUpdate(reviewRecord.id, { status: 'failed', error_message: 'Trim error: ' + e.message });
          await sendTelegram('Video processing failed: ' + e.message);
          result.processed = true;
          result.action = 'trim_error';
        }
      }
    }
  }
}

// ─── WAITING FOR APPROVAL ───
if (reviewStatus === 'clips_preview_sent') {
  if (userText.toLowerCase() === 'skip') {
    await queueUpdate(reviewRecord.id, { status: 'failed', error_message: 'Skipped at approval' });
    let skipMsgIds = [];
    try { skipMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
    skipMsgIds.push(userMsgId);
    for (const mid of skipMsgIds) { await deleteTelegramMessage(mid); }
    await updateCounterMessage(0);
    result.processed = true;
    result.action = 'skipped_at_approval';

  } else {
    let timestamps = [];
    try { timestamps = JSON.parse(rf.timestamps_json || '[]'); } catch (e) {}
    let hookTexts = [];
    try { hookTexts = JSON.parse(rf.hook_texts_json || '[]'); } catch (e) {}
    let scenarioIds = [];
    try { scenarioIds = JSON.parse(rf.scenario_ids_json || '[]'); } catch (e) {}

    // Parse approval
    let approvedIndices;
    if (userText.toLowerCase() === 'all') {
      approvedIndices = hookTexts.map(function(_, i) { return i; });
    } else {
      approvedIndices = userText.split(/[\s,]+/)
        .map(function(n) { return parseInt(n) - 1; })
        .filter(function(n) { return n >= 0 && n < hookTexts.length; });
    }

    if (approvedIndices.length === 0) {
      await sendTelegram('No valid clips selected. Reply "all", "1 3", or "skip".');
    } else {
      const videoUrl = rf.video_url;
      const hookMode = rf.hook_mode || 'speaking';
      const isSpeaking = hookMode === 'speaking';
      const conceptId = rf.concept_id || '';
      const conceptName = rf.concept_name || '';
      const girlRefUrl = rf.girl_ref_url || '';
      const sourceImageUrl = rf.source_image_url || '';
      const motionPrompt = rf.motion_prompt || '';

      let clipsSaved = 0;

      try {
        const vidRes = await fetch(videoUrl);
        if (!vidRes.ok) throw new Error('Video re-download failed: ' + vidRes.status);
        const videoBuffer = Buffer.from(await vidRes.arrayBuffer());
        const rawPath = '/tmp/review_approve_' + Date.now() + '.mp4';
        fs.writeFileSync(rawPath, videoBuffer);

        const batchId = 'gen_' + new Date().toISOString().slice(0, 10) + '_' + reviewRecord.id.slice(-5);

        for (const idx of approvedIndices) {
          const ts = timestamps[idx];
          const ht = hookTexts[idx] || '';
          const scenarioId = scenarioIds[idx] || '';

          try {
            const trimPath = trimClip(rawPath, ts, isSpeaking);
            const clipBuffer = fs.readFileSync(trimPath);
            const clipUrl = await uploadFile(clipBuffer, 'hook_' + batchId + '_' + idx + '.mp4');

            await poolCreate({
              batch_id: batchId,
              concept_id: conceptId,
              concept_name: conceptName,
              hook_type: hookMode,
              girl_ref_url: girlRefUrl,
              source_image_url: sourceImageUrl,
              source_video_url: videoUrl,
              video_file: [{ url: clipUrl }],
              clip_start_sec: ts,
              clip_duration_sec: CLIP_DURATION,
              hook_text: ht,
              scenario_id: scenarioId,
              status: 'ready',
              created_at: new Date().toISOString(),
            });

            clipsSaved++;
            console.log('[review] Saved clip: scenario ' + scenarioId + ' at ' + ts + 's');
            try { fs.unlinkSync(trimPath); } catch (e) {}
          } catch (e) {
            console.log('[review] Save error clip ' + idx + ': ' + e.message);
            await sendTelegram('Clip ' + (idx + 1) + ' save failed: ' + e.message);
          }
        }

        try { fs.unlinkSync(rawPath); } catch (e) {}

        if (clipsSaved === 0) {
          await sendTelegram('No clips saved (upload failed). Reply "all" to retry or "skip".');
          result.processed = true;
          result.action = 'save_failed';
        } else {
          await queueUpdate(reviewRecord.id, {
            status: 'clips_saved',
            reviewed_at: new Date().toISOString(),
          });

          // Delete ALL messages for this video (bot + user messages)
          let allMsgIds = [];
          try { allMsgIds = JSON.parse(rf.telegram_msg_id || '[]'); } catch (e) {}
          allMsgIds.push(userMsgId);
          for (const mid of allMsgIds) {
            await deleteTelegramMessage(mid);
          }

          // Update counter message (delete old, send new with current pool count)
          await updateCounterMessage(clipsSaved);

          result.processed = true;
          result.action = 'clips_saved';
          result.clipsSaved = clipsSaved;
        }

      } catch (e) {
        console.log('[review] Approval error: ' + e.message);
        await sendTelegram('Error saving clips: ' + e.message + '. Reply "all" to retry or "skip".');
        result.processed = true;
        result.action = 'approval_error';
      }
    }
  }
}

return [{ json: result }];
