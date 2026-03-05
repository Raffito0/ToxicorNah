// NODE: Download Assets
// Downloads all clips from Telegram and music from URL to local filesystem
// Must run BEFORE Assemble Video (FFmpeg needs local files)
// Self-healing: retries downloads 2x with 3s delay, continues with partial assets
// Mode: Run Once for All Items
//
// WIRING: After VO approved → this Code node → Assemble Video

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

const PRODUCTION_BOT_TOKEN = '8506263958:AAHPYYEuETxqaIHiR-Ymf-VxrZKwugHYwgM';
const CONTENT_BOT_TOKEN = '8389477139:AAFWFMhwVj7TLWBOtlX-3Pqz7pqK88fP4EU';
const BOT_TOKEN = PRODUCTION_BOT_TOKEN; // default for hook/outro videos
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

const production = $('Prepare Production').first().json;
const scenarioName = production.scenarioName;
const outputDir = '/tmp/toxicornah/' + scenarioName;

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// ─── retry helper ───
async function withRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

// ─── Telegram file download helper (with retry) ───
async function downloadTgFile(fileId, outputPath, token) {
  const t = token || BOT_TOKEN;
  return withRetry(async () => {
    const getFileRes = await fetch('https://api.telegram.org/bot' + t + '/getFile?file_id=' + fileId);
    const getFileData = await getFileRes.json();
    const filePath = getFileData.result?.file_path;
    if (!filePath) throw new Error('getFile failed for ' + fileId);
    const downloadUrl = 'https://api.telegram.org/file/bot' + t + '/' + filePath;
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error('Download failed: ' + res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  });
}

// ─── URL download helper (with retry) ───
async function downloadUrl(url, outputPath) {
  return withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('URL download failed: ' + res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  });
}

const chatId = production.chatId;
const warnings = [];

// ─── Download hook ───
let hookFile = null;
try {
  const hookData = $('Generate Hook').first().json;

  if (hookData.hookSource === 'fallback_blank') {
    // Self-healing: hook AI failed → create a blank black frame as placeholder
    const { execSync } = require('child_process');
    hookFile = path.join(outputDir, 'hook_blank.png');
    execSync('ffmpeg -y -f lavfi -i color=black:s=1080x1920:d=1 -frames:v 1 "' + hookFile + '"', { timeout: 10000 });
    warnings.push('Hook: using blank black placeholder (AI failed)');
  } else if (production.hookType === 'manual_clip' && production.hookClipFileId) {
    hookFile = await downloadTgFile(production.hookClipFileId, path.join(outputDir, 'hook.mp4'));
  } else {
    // For AI hooks: try Img2Vid video first (2-step approval), then Generate Hook binary
    let hookBinary = null;
    try { hookBinary = $('Img2Vid Hook').first().binary; } catch(e) {}
    if (hookBinary && hookBinary.hookVideo) {
      hookFile = path.join(outputDir, 'hook.mp4');
      fs.writeFileSync(hookFile, Buffer.from(hookBinary.hookVideo.data, 'base64'));
    } else {
      // Fallback: check Generate Hook directly (manual flows, or image-only)
      hookBinary = $('Generate Hook').first().binary;
      if (hookBinary) {
        if (hookBinary.hookVideo) {
          hookFile = path.join(outputDir, 'hook.mp4');
          fs.writeFileSync(hookFile, Buffer.from(hookBinary.hookVideo.data, 'base64'));
        } else if (hookBinary.hookImage) {
          hookFile = path.join(outputDir, 'hook.png');
          fs.writeFileSync(hookFile, Buffer.from(hookBinary.hookImage.data, 'base64'));
        }
      }
    }
  }
} catch (e) {
  warnings.push('Hook download failed: ' + e.message);
  // Self-healing: create blank placeholder
  try {
    const { execSync } = require('child_process');
    hookFile = path.join(outputDir, 'hook_blank.png');
    execSync('ffmpeg -y -f lavfi -i color=black:s=1080x1920:d=1 -frames:v 1 "' + hookFile + '"', { timeout: 10000 });
    warnings.push('Hook: using blank placeholder as fallback');
  } catch (e2) { warnings.push('Hook blank fallback also failed: ' + e2.message); }
}

// ─── Download body clips ───
const clipMapping = [];
for (let i = 0; i < (production.bodyClips || []).length; i++) {
  const clip = production.bodyClips[i];
  const localPath = path.join(outputDir, 'body_' + clip.clipIndex + '.mp4');
  try {
    if (clip.fileId) {
      await downloadTgFile(clip.fileId, localPath, CONTENT_BOT_TOKEN);
    }
    // Find matching template segment
    const segment = (production.clipMapping || [])[i] || {};
    clipMapping.push({
      section: segment.section || clip.section || 'body_' + clip.clipIndex,
      targetDuration: segment.targetDuration || 3.0,
      localPath,
      actualDuration: clip.duration || 0,
    });
  } catch (e) {
    warnings.push('Body clip ' + clip.clipIndex + ': ' + e.message + ' (skipped)');
    // Don't add to clipMapping — this clip will be excluded from assembly
  }
}

// ─── Download outro ───
let outroFile = null;
try {
  const outroData = $('Generate Outro').first().json;
  if (outroData.outroSkipped) {
    // No outro — fine
  } else if (outroData.outroSource === 'manual_clip' && outroData.outroFileId) {
    outroFile = await downloadTgFile(outroData.outroFileId, path.join(outputDir, 'outro.mp4'));
  } else if (outroData.outroSource === 'app_store_clip' && outroData.outroFileUrl) {
    outroFile = await downloadUrl(outroData.outroFileUrl, path.join(outputDir, 'outro.mp4'));
  } else if (outroData.outroSource === 'fallback_skip' || outroData.outroSource === 'app_store_fallback_skip') {
    // AI/app store failed, outro was skipped — fine
    warnings.push('Outro skipped (fallback)');
  } else {
    // Try Img2Vid Outro video first (2-step approval), then Generate Outro binary
    let outroBinary = null;
    try { outroBinary = $('Img2Vid Outro').first().binary; } catch(e) {}
    if (outroBinary && outroBinary.outroVideo) {
      outroFile = path.join(outputDir, 'outro.mp4');
      fs.writeFileSync(outroFile, Buffer.from(outroBinary.outroVideo.data, 'base64'));
    } else {
      outroBinary = $('Generate Outro').first().binary;
      if (outroBinary?.outroVideo) {
        outroFile = path.join(outputDir, 'outro.mp4');
        fs.writeFileSync(outroFile, Buffer.from(outroBinary.outroVideo.data, 'base64'));
      } else if (outroBinary?.outroImage) {
        outroFile = path.join(outputDir, 'outro.png');
        fs.writeFileSync(outroFile, Buffer.from(outroBinary.outroImage.data, 'base64'));
      }
    }
  }
} catch (e) {
  warnings.push('Outro: ' + e.message + ' (skipped)');
  // Self-healing: outro is optional, just skip it
}

// ─── Collect VO segment files from disk ───
// Send VO Segments saves files to /tmp/toxicornah_vo/{recordId}/vo_{index}.mp3
// Callback handler may overwrite individual files on redo (latest approved version)
// We read from disk instead of Generate VO binary to get the freshest files
let voFile = null; // backward compat (single VO)
const voSegmentFiles = []; // per-segment VO files [{section, file, duration, durationEstimate}]
const runRecordId = (() => { try { return $('Create Video Run').first().json.id; } catch(e) { return null; } })();
try {
  const voData = $('Generate VO').first().json;
  if (voData.voSkipped) {
    warnings.push('VO skipped: ' + (voData.warning || 'no VO available'));
  } else {
    const voSegments = voData.voSegments || [];
    const voDir = runRecordId ? '/tmp/toxicornah_vo/' + runRecordId : null;

    if (voSegments.length > 0) {
      for (const seg of voSegments) {
        if (!seg.hasAudio) {
          voSegmentFiles.push({ section: seg.section, file: null, duration: seg.duration });
          continue;
        }

        // Try disk first (latest version, possibly regenerated by callback handler)
        const diskPath = voDir ? path.join(voDir, 'vo_' + seg.index + '.mp3') : null;
        const destPath = path.join(outputDir, 'vo_' + seg.section + '.mp3');

        if (diskPath && fs.existsSync(diskPath)) {
          // Copy from VO dir to output dir
          fs.copyFileSync(diskPath, destPath);
          voSegmentFiles.push({ section: seg.section, file: destPath, duration: seg.duration, durationEstimate: seg.durationEstimate });
        } else {
          // Fallback: try Generate VO binary
          const voBinary = $('Generate VO').first().binary || {};
          const key = 'voSegment_' + seg.index;
          const binary = voBinary[key];
          if (binary) {
            fs.writeFileSync(destPath, Buffer.from(binary.data, 'base64'));
            voSegmentFiles.push({ section: seg.section, file: destPath, duration: seg.duration, durationEstimate: seg.durationEstimate });
          } else {
            voSegmentFiles.push({ section: seg.section, file: null, duration: seg.duration });
            warnings.push('VO ' + seg.section + ': no file found (disk or binary)');
          }
        }
      }
    } else {
      // Backward compat: old single-file format
      const voBinary = $('Generate VO').first().binary || {};
      if (voBinary.voAudio) {
        voFile = path.join(outputDir, 'voiceover.mp3');
        fs.writeFileSync(voFile, Buffer.from(voBinary.voAudio.data, 'base64'));
      }
    }
  }
} catch (e) {
  warnings.push('VO: ' + e.message + ' (skipped)');
  // Self-healing: video works without VO
}

// ─── Download music ───
let musicFile = null;
try {
  if (production.musicTrack) {
    if (production.musicTrack.telegramFileId) {
      musicFile = await downloadTgFile(production.musicTrack.telegramFileId, path.join(outputDir, 'music.mp3'));
    } else if (production.musicTrack.fileUrl) {
      musicFile = await downloadUrl(production.musicTrack.fileUrl, path.join(outputDir, 'music.mp3'));
    }
  }
} catch (e) {
  warnings.push('Music: ' + e.message + ' (skipped)');
  // Self-healing: video works without music
}

// Only hard-fail if we have NO body clips at all
if (clipMapping.length === 0) {
  return [{ json: { error: true, chatId, message: '\u274C All body clip downloads failed. Cannot assemble video.\n' + warnings.join('\n') } }];
}

// Read hookSource/outroSource for assembly (baked audio detection)
const hookSource = (() => { try { return $('Generate Hook').first().json.hookSource || ''; } catch(e) { return ''; } })();
const outroSource = (() => { try { return $('Generate Outro').first().json.outroSource || ''; } catch(e) { return ''; } })();

// Debug: log clip mapping for troubleshooting
const _debugClips = clipMapping.map(c => c.section + '(t=' + c.targetDuration + ',a=' + c.actualDuration + ',' + (c.localPath ? 'OK' : 'NO_FILE') + ')');

return [{
  json: {
    scenarioName,
    outputDir,
    hookFile,
    outroFile,
    voFile,
    voSegmentFiles: voSegmentFiles.length > 0 ? voSegmentFiles : undefined,
    musicFile,
    clipMapping,
    template: production.template,
    chatId,
    runRecordId,
    hookSource,
    outroSource,
    copyJson: production.copyJson || null,
    warnings: warnings.length > 0 ? warnings : undefined,
    _debug: {
      bodyClipsIn: (production.bodyClips || []).length,
      clipMappingOut: clipMapping.length,
      clips: _debugClips,
      outro: outroFile || 'NONE',
      outroSrc: outroSource,
    },
  }
}];
