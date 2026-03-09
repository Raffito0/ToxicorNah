// NODE: Assemble Video with FFmpeg (Modular + Smart Trim + Music Sync)
// Combines all approved assets into the final video:
//   - Hook clip/video (manual or AI-generated, or blank placeholder)
//   - Body clips (smart-trimmed to template durations)
//   - Outro clip/video (manual, AI, or skipped)
//   - Voiceover audio (Fish.audio, or skipped)
//   - Background music (120 BPM, trimmed to total duration, or skipped)
// Self-healing: handles missing optional assets, retries FFmpeg with simpler params on failure
// Mode: Run Once for All Items
//
// WIRING: After all assets approved â†’ Download All Clips â†’ this Code node â†’ Send Final to Telegram
//
// Expects all clips downloaded to /tmp/toxicornah/{scenarioName}/
// Input: production data with template, clip mapping, file paths

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const _https = require('https');

// â”€â”€â”€ ElevenLabs Speech-to-Speech: convert baked hook audio to phone's voice â”€â”€â”€
function elevenLabsSTS(audioBuffer, voiceId, apiKey) {
  return new Promise((resolve, reject) => {
    const boundary = '----STS' + Date.now();
    const parts = [];
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="model_id"\r\n\r\neleven_english_sts_v2\r\n');
    parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="audio"; filename="hook.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n');
    const bodyBuf = Buffer.concat([
      Buffer.from(parts.join('')),
      audioBuffer,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    const req = _https.request({
      hostname: 'api.elevenlabs.io',
      path: '/v1/speech-to-speech/' + voiceId + '?output_format=mp3_44100_128',
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': bodyBuf.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(buf);
        } else {
          reject(new Error('STS HTTP ' + res.statusCode + ': ' + buf.toString().slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

const production = $input.first().json;
const {
  scenarioName,
  template,
  clipMapping,      // [{ section, targetDuration, localPath, actualDuration }]
  hookFile,         // path to hook clip/video
  outroFile,        // path to outro clip/video (null if skipped)
  voFile,           // path to voiceover MP3 (old single-file format, backward compat)
  voSegmentFiles,   // [{section, file, duration, durationEstimate}] (new per-segment format)
  musicFile,        // path to background music MP3
  chatId,
  runRecordId,
} = production;

// Detect baked-in audio from Sora 2 speaking videos
// These segments have speech audio embedded in the video â€” no separate VO overlay needed
const hookSource = production.hookSource || '';
const outroSource = production.outroSource || '';
const hasBakedHookAudio = (hookSource === 'speaking' || hookSource === 'pool');
const hasBakedOutroAudio = (outroSource === 'speaking');
const copyJson = production.copyJson || null;

const outputDir = production.outputDir || '/tmp/toxicornah/' + scenarioName;
const outputFile = path.join(outputDir, scenarioName + '_final.mp4');
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// STEP 1: Probe all clip durations with FFprobe
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
function probeDuration(filePath) {
  try {
    const result = execSync(
      'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "' + filePath + '"',
      { timeout: 10000 }
    ).toString().trim();
    return parseFloat(result) || 0;
  } catch (e) {
    return 0;
  }
}

function hasAudioStream(filePath) {
  try {
    const result = execSync(
      'ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "' + filePath + '"',
      { timeout: 10000 }
    ).toString().trim();
    return result.includes('audio');
  } catch (e) {
    return false;
  }
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// STEP 2: Calculate speed factors for smart trimming
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
function calcTrimStrategy(actualDuration, targetDuration) {
  if (actualDuration <= 0 || targetDuration <= 0) {
    return { method: 'none', speedFactor: 1.0 };
  }

  const sf = actualDuration / targetDuration;

  // Within 5%: just hard trim to exact duration
  if (sf >= 0.95 && sf <= 1.05) {
    return { method: 'trim', speedFactor: 1.0 };
  }

  // Slightly longer (up to 1.4x): speed up
  if (sf > 1.05 && sf <= 1.4) {
    return { method: 'speed', speedFactor: sf };
  }

  // Much longer: hard trim from end
  if (sf > 1.4) {
    return { method: 'trim', speedFactor: 1.0 };
  }

  // Slightly shorter (down to 0.7x): slow down
  if (sf >= 0.7 && sf < 0.95) {
    return { method: 'speed', speedFactor: sf };
  }

  // Much shorter: just trim (clip ends shorter â€” better than ugly freeze frame)
  if (sf < 0.7) {
    return { method: 'trim', speedFactor: 1.0 };
  }

  return { method: 'none', speedFactor: 1.0 };
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// CAPTION HELPERS: drawtext overlays for body clips and outro (NOT hook)
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
function stripEmojis(str) {
  if (!str) return '';
  return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '').trim();
}

// Safe caption dir (no spaces/special chars â€” safe for FFmpeg drawtext path)
const captionDir = '/tmp/toncap_' + (runRecordId || scenarioName || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
if (!fs.existsSync(captionDir)) fs.mkdirSync(captionDir, { recursive: true });

function writeCaptionFile(text, label) {
  const clean = stripEmojis(text);
  if (!clean) return null;
  const fp = captionDir + '/' + label + '.txt';
  fs.writeFileSync(fp, clean);
  return fp;
}

// Font detection: Proxima Nova Semibold (TikTok style) â†’ fallback to system fonts
const FONT_PATHS = [
  '/home/node/.n8n/fonts/ProximaNova-Semibold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];
const captionFont = FONT_PATHS.find(f => fs.existsSync(f)) || '';
const captionFontParam = captionFont ? ':fontfile=' + captionFont : '';

// Build section â†’ caption text map from copyJson
// Copy generation uses creative names (toxic_score, soul_type, wtf_happening)
// Templates use technical names (score_reveal, soul_type_card, decoded_insight)
// We store captions under ALL known aliases so either naming convention resolves
const SECTION_ALIAS_GROUPS = [
  ['toxic_score', 'score_reveal'],
  ['soul_type', 'soul_type_card'],
  ['deep_dive', 'decoded_insight', 'wtf_happening'],
  ['upload_chat', 'chat_upload'],
];
const _sectionAliasMap = {};
for (const group of SECTION_ALIAS_GROUPS) {
  for (const name of group) _sectionAliasMap[name] = group;
}
const bodyCaptionMap = {};
if (copyJson && copyJson.bodyClips) {
  for (const bc of copyJson.bodyClips) {
    if (bc.section && bc.text) {
      bodyCaptionMap[bc.section] = bc.text;
      const aliases = _sectionAliasMap[bc.section] || [];
      for (const alias of aliases) {
        if (!bodyCaptionMap[alias]) bodyCaptionMap[alias] = bc.text;
      }
    }
  }
}

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// STEP 3: Build FFmpeg command
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
const inputs = [];
const filterParts = [];
const scaledStreams = [];
let streamIdx = 0;

// Helper: quote path for shell
function q(p) { if (!p) return '""'; return '"' + p.replace(/"/g, '\\"') + '"'; }

// â”€â”€â”€ Hook input â”€â”€â”€
const hookSegment = template.segments.find(s => s.section === 'hook');
const hookTarget = hookSegment ? hookSegment.duration : 3.0;
let hookActualUsed = hookTarget; // track actual duration used (may differ for kling)
let hookStreamIdx = -1;

if (hookFile && fs.existsSync(hookFile)) {
  const hookActual = probeDuration(hookFile);
  hookStreamIdx = streamIdx++;

  if (hookFile.endsWith('.png') || hookFile.endsWith('.jpg')) {
    // Still image â†’ create video
    inputs.push('-loop 1 -t ' + hookTarget + ' -framerate ' + FPS + ' -i ' + q(hookFile));
    filterParts.push('[' + hookStreamIdx + ':v]scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS + '[hook]');
    hookActualUsed = hookTarget;
  } else if (hookActual <= 0.1) {
    // File has no readable duration (e.g. Telegram document) â€” loop first frame
    inputs.push('-loop 1 -t ' + hookTarget.toFixed(3) + ' -framerate ' + FPS + ' -i ' + q(hookFile));
    filterParts.push('[' + hookStreamIdx + ':v]scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS + '[hook]');
    hookActualUsed = hookTarget;
  } else if (hasBakedHookAudio) {
    // Sora 2 speaking: DON'T speed-adjust (would break lip sync)
    // Trim to exact duration as safety net
    inputs.push('-i ' + q(hookFile));
    let vf = '[' + hookStreamIdx + ':v]';
    vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS;
    vf += ',trim=0:' + hookTarget.toFixed(3) + ',setpts=PTS-STARTPTS[hook]';
    filterParts.push(vf);
    hookActualUsed = hookTarget;
  } else {
    // Normal: apply smart trim (speed up/down or hard trim, NO freeze)
    const hookTrim = calcTrimStrategy(hookActual, hookTarget);
    inputs.push('-i ' + q(hookFile));
    let vf = '[' + hookStreamIdx + ':v]';
    if (hookTrim.method === 'speed' && hookTrim.speedFactor !== 1.0) {
      vf += 'setpts=PTS/' + hookTrim.speedFactor.toFixed(4) + ',';
    }
    vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS;
    vf += ',trim=0:' + hookTarget.toFixed(3) + ',setpts=PTS-STARTPTS[hook]';
    filterParts.push(vf);
    hookActualUsed = hookTarget;
  }
  scaledStreams.push('[hook]');
}

// â”€â”€â”€ Body clip inputs â”€â”€â”€
// NO filter â€” include ALL segments (missing files get black placeholder instead of being silently dropped)
const bodySegments = clipMapping || [];
const _debugBody = []; // debug: track probed vs stored durations

// Deterministic pseudo-random for organic caption placement
function capRand(seed) { const x = Math.sin(seed * 9301 + 49297) * 49297; return x - Math.floor(x); }

for (let i = 0; i < bodySegments.length; i++) {
  const seg = bodySegments[i];
  const idx = streamIdx++;
  const label = 'body' + i;
  const target = seg.targetDuration || 3.0;
  const fileExists = seg.localPath && fs.existsSync(seg.localPath);

  // â”€â”€ Handle missing files: generate black placeholder â”€â”€
  if (!fileExists) {
    const placeholderPath = path.join(outputDir, 'black_body_' + i + '.png');
    try {
      execSync('ffmpeg -y -f lavfi -i color=black:s=' + WIDTH + 'x' + HEIGHT + ':d=1 -frames:v 1 "' + placeholderPath + '"', { timeout: 10000 });
    } catch (e) {
      _debugBody.push(seg.section + ': SKIPPED (placeholder failed: ' + e.message + ')');
      streamIdx--;
      continue;
    }
    inputs.push('-loop 1 -t ' + target.toFixed(3) + ' -framerate ' + FPS + ' -i ' + q(placeholderPath));
    let vf = '[' + idx + ':v]scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS;
    // Still apply caption overlay on placeholder
    const capText = bodyCaptionMap[seg.section] || null;
    const capFile = capText ? writeCaptionFile(capText, label) : null;
    if (capFile) {
      const capYBase = 0.27 + capRand(i * 7 + 1) * 0.10;
      const capYJitter = Math.round(-30 + capRand(i * 11 + 5) * 60);
      const capY = 'h*' + capYBase.toFixed(3) + '+(' + capYJitter + ')';
      const capXOff = Math.round(-40 + capRand(i * 19 + 7) * 80);
      const capX = '(w-text_w)/2+(' + capXOff + ')';
      const capStart = 0.15 + capRand(i * 13 + 3) * 0.55;
      const capEnd = target - capRand(i * 17 + 11) * 0.45;
      vf += ',drawtext=textfile=' + capFile + captionFontParam + ':fontsize=50:fontcolor=white:borderw=3:bordercolor=black@0.6:x=' + capX + ':y=' + capY + ":enable='between(t\\," + capStart.toFixed(3) + '\\,' + capEnd.toFixed(3) + ")'";
    }
    vf += '[' + label + ']';
    filterParts.push(vf);
    scaledStreams.push('[' + label + ']');
    _debugBody.push(seg.section + ': BLACK_PLACEHOLDER target=' + target);
    continue;
  }

  // â”€â”€ File exists: probe and process â”€â”€
  const probed = probeDuration(seg.localPath);
  const _capMatch = bodyCaptionMap[seg.section] || null;
  _debugBody.push(seg.section + ': stored=' + (seg.actualDuration||0) + ' probed=' + probed.toFixed(2) + ' target=' + target + ' cap=' + (_capMatch ? JSON.stringify(_capMatch) : 'NONE'));

  // If file has no readable duration, treat as still image (loop first frame for target duration)
  if (probed <= 0.1) {
    inputs.push('-loop 1 -t ' + target.toFixed(3) + ' -framerate ' + FPS + ' -i ' + q(seg.localPath));
  } else {
    inputs.push('-i ' + q(seg.localPath));
  }

  let vf = '[' + idx + ':v]';
  vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS;

  if (probed > 0.1) {
    if (probed < target * 0.95) {
      // Clip SHORTER than target: slow down to fill duration (max 2x slowdown)
      const slowFactor = target / probed;
      if (slowFactor <= 2.0) {
        vf += ',setpts=PTS*' + slowFactor.toFixed(4);
      }
      // Trim to exact target + reset timestamps
      vf += ',trim=0:' + target.toFixed(3) + ',setpts=PTS-STARTPTS';
    } else if (probed > target * 1.05 && probed <= target * 1.4) {
      // Clip slightly longer (5-40%): speed up to fit
      const speedFactor = probed / target;
      vf += ',setpts=PTS/' + speedFactor.toFixed(4) + ',trim=0:' + target.toFixed(3) + ',setpts=PTS-STARTPTS';
    } else {
      // Clip within Â±5% or much longer: hard trim to exact target
      vf += ',trim=0:' + target.toFixed(3) + ',setpts=PTS-STARTPTS';
    }
  }

  // Caption overlay (body clips only â€” hook is excluded, visual-only sections like screenshot/upload_chat get no caption)
  // Organic feel: random y-offset + random appear/disappear timing per segment
  const capText = bodyCaptionMap[seg.section] || null;
  const capFile = capText ? writeCaptionFile(capText, label) : null;
  if (capFile) {
    // Y: base varies 0.27â€“0.37 of screen height + pixel jitter Â±30px
    const capYBase = 0.27 + capRand(i * 7 + 1) * 0.10;
    const capYJitter = Math.round(-30 + capRand(i * 11 + 5) * 60);
    const capY = 'h*' + capYBase.toFixed(3) + '+(' + capYJitter + ')';
    // X: slight off-center Â±40px (feels hand-placed, not machine-centered)
    const capXOff = Math.round(-40 + capRand(i * 19 + 7) * 80);
    const capX = '(w-text_w)/2+(' + capXOff + ')';
    const capStart = 0.15 + capRand(i * 13 + 3) * 0.55;  // 0.15â€“0.70s
    const capEnd = target - capRand(i * 17 + 11) * 0.45;  // 0â€“0.45s before end
    vf += ',drawtext=textfile=' + capFile + captionFontParam + ':fontsize=50:fontcolor=white:borderw=3:bordercolor=black@0.6:x=' + capX + ':y=' + capY + ":enable='between(t\\," + capStart.toFixed(3) + '\\,' + capEnd.toFixed(3) + ")'";
  }
  vf += '[' + label + ']';
  filterParts.push(vf);
  scaledStreams.push('[' + label + ']');
}

// â”€â”€â”€ Outro input â”€â”€â”€
const outroSegment = template.segments.find(s => s.section === 'outro');
const outroTarget = outroSegment ? outroSegment.duration : 3.0;
let outroActualUsed = outroTarget;
let outroStreamIdx = -1;

if (outroFile && fs.existsSync(outroFile)) {
  const outroActual = probeDuration(outroFile);
  outroStreamIdx = streamIdx++;

  // Pre-compute outro caption drawtext (used in all paths)
  const outroCapFile = (copyJson && copyJson.outroText) ? writeCaptionFile(copyJson.outroText, 'outro') : null;
  function outroRand(seed) { const x = Math.sin(seed * 9301 + 49297) * 49297; return x - Math.floor(x); }
  const outroCStart = 0.15 + outroRand(42) * 0.55;
  const outroCEnd = outroTarget - outroRand(77) * 0.40;
  const outroCYBase = 0.27 + outroRand(19) * 0.10;
  const outroCYJitter = Math.round(-30 + outroRand(31) * 60);
  const outroCXOff = Math.round(-40 + outroRand(53) * 80);
  const outroDT = outroCapFile
    ? ",drawtext=textfile=" + outroCapFile + captionFontParam + ":fontsize=50:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2+(" + outroCXOff + "):y=h*" + outroCYBase.toFixed(3) + "+(" + outroCYJitter + "):enable='between(t\\," + outroCStart.toFixed(3) + "\\," + outroCEnd.toFixed(3) + ")'"
    : '';

  if (outroActual <= 0.1 && !outroFile.endsWith('.png') && !outroFile.endsWith('.jpg')) {
    // File has no readable duration (e.g. Telegram document) â€” loop first frame
    inputs.push('-loop 1 -t ' + outroTarget.toFixed(3) + ' -framerate ' + FPS + ' -i ' + q(outroFile));
    filterParts.push('[' + outroStreamIdx + ':v]scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS + outroDT + '[outro]');
    outroActualUsed = outroTarget;
  } else if (hasBakedOutroAudio) {
    // Sora 2 speaking: DON'T speed-adjust (would break lip sync)
    inputs.push('-i ' + q(outroFile));
    let vf = '[' + outroStreamIdx + ':v]';
    vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS;
    vf += ',trim=0:' + outroTarget.toFixed(3) + ',setpts=PTS-STARTPTS' + outroDT + '[outro]';
    filterParts.push(vf);
    outroActualUsed = outroTarget;
  } else {
    // Normal: apply smart trim (speed up/down or hard trim, NO freeze)
    inputs.push('-i ' + q(outroFile));
    const outroTrim = calcTrimStrategy(outroActual, outroTarget);
    let vf = '[' + outroStreamIdx + ':v]';
    if (outroTrim.method === 'speed' && outroTrim.speedFactor !== 1.0) {
      vf += 'setpts=PTS/' + outroTrim.speedFactor.toFixed(4) + ',';
    }
    vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=increase,crop=' + WIDTH + ':' + HEIGHT + ',setsar=1,fps=' + FPS;
    vf += ',trim=0:' + outroTarget.toFixed(3) + ',setpts=PTS-STARTPTS' + outroDT + '[outro]';
    filterParts.push(vf);
    outroActualUsed = outroTarget;
  }
  scaledStreams.push('[outro]');
}

// â”€â”€â”€ Concatenate all video streams â”€â”€â”€
if (scaledStreams.length === 0) {
  return [{ json: { error: true, chatId, message: 'No video streams to assemble' } }];
}
filterParts.push(scaledStreams.join('') + 'concat=n=' + scaledStreams.length + ':v=1:a=0[outv]');

// â”€â”€â”€ Audio: VO segments + Music â”€â”€â”€
let hasVo = false;
let musicIdx = -1;

// Per-segment VO with adelay (new format)
// Each VO segment is placed at its correct timeline position.
// If VO is longer than its clip duration, speed up with atempo (max 1.4x, preserves pitch).
// Beyond 1.4x the VO bleeds slightly â€” use per-segment redo to regenerate shorter.
if (voSegmentFiles && voSegmentFiles.length > 0) {
  const voLabels = [];
  let timeOffsetMs = 0;

  for (const seg of voSegmentFiles) {
    // Skip VO overlay for segments with baked-in audio (Sora 2 speaking)
    // Their audio is embedded in the video â€” extracted separately below
    const isBakedSegment = (seg.section === 'hook' && hasBakedHookAudio)
                        || (seg.section === 'outro' && hasBakedOutroAudio);

    if (!isBakedSegment && seg.file && fs.existsSync(seg.file)) {
      const voIdx = streamIdx++;
      inputs.push('-i ' + q(seg.file));
      const label = 'vo' + voLabels.length;

      // Check if VO needs speedup to fit in its clip's duration
      const voActual = probeDuration(seg.file);
      const voTarget = seg.duration || 0;
      let atempoFilter = '';
      if (voActual > 0 && voTarget > 0 && voActual > voTarget) {
        const speedFactor = Math.min(voActual / voTarget, 1.4);
        if (speedFactor > 1.02) { // only apply if >2% over (skip trivial differences)
          atempoFilter = 'atempo=' + speedFactor.toFixed(4) + ',';
        }
      }

      if (timeOffsetMs === 0) {
        filterParts.push('[' + voIdx + ':a]' + atempoFilter + 'loudnorm=I=-14:TP=-1:LRA=11,volume=1.0[' + label + ']');
      } else {
        filterParts.push('[' + voIdx + ':a]' + atempoFilter + 'loudnorm=I=-14:TP=-1:LRA=11,adelay=' + timeOffsetMs + '|' + timeOffsetMs + ',volume=1.0[' + label + ']');
      }
      voLabels.push('[' + label + ']');
    }
    // Advance timeline: use actual duration for baked segments, template duration otherwise
    if (seg.section === 'hook' && hasBakedHookAudio) {
      timeOffsetMs += Math.round(hookActualUsed * 1000);
    } else if (seg.section === 'outro' && hasBakedOutroAudio) {
      timeOffsetMs += Math.round(outroActualUsed * 1000);
    } else {
      timeOffsetMs += Math.round((seg.duration || 0) * 1000);
    }
  }

  if (voLabels.length > 0) {
    hasVo = true;
    if (voLabels.length === 1) {
      filterParts.push(voLabels[0] + 'acopy[vo_mixed]');
    } else {
      filterParts.push(voLabels.join('') + 'amix=inputs=' + voLabels.length + ':duration=longest:dropout_transition=0:normalize=0[vo_mixed]');
    }
  }
} else if (voFile && fs.existsSync(voFile)) {
  // Backward compat: old single-file VO
  const voIdx = streamIdx++;
  inputs.push('-i ' + q(voFile));
  filterParts.push('[' + voIdx + ':a]volume=1.0[vo_mixed]');
  hasVo = true;
}

if (musicFile && fs.existsSync(musicFile)) {
  musicIdx = streamIdx++;
  inputs.push('-i ' + q(musicFile));
  // Calculate actual total duration (kling segments may differ from template)
  let totalDur = 0;
  for (const seg of template.segments) {
    if (seg.section === 'hook') {
      totalDur += hookActualUsed;
    } else if (seg.section === 'outro' && outroFile && fs.existsSync(outroFile)) {
      totalDur += outroActualUsed;
    } else if (seg.section !== 'outro') {
      totalDur += seg.duration;
    }
  }
  if (totalDur <= 0) totalDur = template.totalDuration || 17;
  filterParts.push('[' + musicIdx + ':a]atrim=0:' + totalDur.toFixed(3) + ',asetpts=PTS-STARTPTS,volume=0.15,afade=t=out:st=' + (totalDur - 1).toFixed(3) + ':d=1[music]');
}

// â”€â”€â”€ Embedded audio: extract from speaking videos (Sora 2 with baked speech) â”€â”€â”€
// For speaking hooks: extract audio â†’ ElevenLabs STS â†’ convert to phone's voice
const klingAudioLabels = [];
let stsHookFile = null;
let stsHookIdx = -1;

if (hasBakedHookAudio && hookStreamIdx >= 0) {
  const hookHasAudio = hookFile && fs.existsSync(hookFile) && hasAudioStream(hookFile);
  const phoneVoiceId = production.phoneVoiceId || '';
  const elevenLabsKey = (typeof $env !== 'undefined' && $env.ELEVENLABS_API_KEY) || 'sk_a645bb67bdb3fecc5604c41b18588e7b1d8a35092d0c28fc';

  if (!hookHasAudio) {
    // Hook video has no audio stream â€” skip hook audio entirely (VO + music still work)
    console.log('[assemble] Hook video has no audio stream â€” skipping hook audio');
  } else if (phoneVoiceId && elevenLabsKey && hookFile && fs.existsSync(hookFile)) {
    // Extract audio from hook video
    const hookAudioTmp = path.join(outputDir, 'hook_audio_' + Date.now() + '.mp3');
    try {
      execSync('ffmpeg -y -i ' + q(hookFile) + ' -vn -acodec libmp3lame -ar 44100 -ab 128k ' + q(hookAudioTmp), { timeout: 10000 });
      const hookAudioBuf = fs.readFileSync(hookAudioTmp);
      console.log('[assemble] STS: extracting hook audio (' + hookAudioBuf.length + ' bytes) â†’ voice ' + phoneVoiceId);

      // Speech-to-Speech conversion
      const stsBuf = await elevenLabsSTS(hookAudioBuf, phoneVoiceId, elevenLabsKey);
      stsHookFile = path.join(outputDir, 'hook_sts_' + Date.now() + '.mp3');
      fs.writeFileSync(stsHookFile, stsBuf);
      console.log('[assemble] STS: converted hook audio (' + stsBuf.length + ' bytes)');

      // Add as separate input â€” use this instead of embedded audio
      stsHookIdx = streamIdx++;
      inputs.push('-i ' + q(stsHookFile));
      filterParts.push('[' + stsHookIdx + ':a]loudnorm=I=-14:TP=-1:LRA=11,volume=1.0[kling_hook_a]');
      klingAudioLabels.push('[kling_hook_a]');

      try { fs.unlinkSync(hookAudioTmp); } catch (e) {}
    } catch (e) {
      console.log('[assemble] STS failed, using original baked audio: ' + e.message);
      // Fallback: use original embedded audio
      filterParts.push('[' + hookStreamIdx + ':a]loudnorm=I=-14:TP=-1:LRA=11,volume=1.0[kling_hook_a]');
      klingAudioLabels.push('[kling_hook_a]');
      try { fs.unlinkSync(hookAudioTmp); } catch (e2) {}
    }
  } else {
    // No voice_id or API key â€” use original embedded audio
    filterParts.push('[' + hookStreamIdx + ':a]loudnorm=I=-14:TP=-1:LRA=11,volume=1.0[kling_hook_a]');
    klingAudioLabels.push('[kling_hook_a]');
  }
}

if (hasBakedOutroAudio && outroStreamIdx >= 0 && outroFile && hasAudioStream(outroFile)) {
  // Calculate outro timeline offset (sum of all segments before outro)
  let outroTimeOffsetMs = 0;
  for (const seg of template.segments) {
    if (seg.section === 'outro') break;
    if (seg.section === 'hook') {
      outroTimeOffsetMs += Math.round(hookActualUsed * 1000);
    } else {
      outroTimeOffsetMs += Math.round(seg.duration * 1000);
    }
  }
  if (outroTimeOffsetMs > 0) {
    filterParts.push('[' + outroStreamIdx + ':a]loudnorm=I=-14:TP=-1:LRA=11,adelay=' + outroTimeOffsetMs + '|' + outroTimeOffsetMs + ',volume=1.0[kling_outro_a]');
  } else {
    filterParts.push('[' + outroStreamIdx + ':a]loudnorm=I=-14:TP=-1:LRA=11,volume=1.0[kling_outro_a]');
  }
  klingAudioLabels.push('[kling_outro_a]');
}

// Mix audio: combine VO segments + kling embedded audio + music
const allAudioLabels = [];
if (hasVo) allAudioLabels.push('[vo_mixed]');
allAudioLabels.push(...klingAudioLabels);
if (musicIdx >= 0) allAudioLabels.push('[music]');

if (allAudioLabels.length > 1) {
  filterParts.push(allAudioLabels.join('') + 'amix=inputs=' + allAudioLabels.length + ':duration=longest:dropout_transition=1:normalize=0[outa]');
} else if (allAudioLabels.length === 1) {
  filterParts.push(allAudioLabels[0] + 'acopy[outa]');
}

const hasAudio = allAudioLabels.length > 0;

// â”€â”€â”€ Build full command â”€â”€â”€
const filterComplex = filterParts.join(';');

let cmd = 'ffmpeg -y ' + inputs.join(' ') +
  ' -filter_complex "' + filterComplex + '"' +
  ' -map "[outv]"';

if (hasAudio) {
  cmd += ' -map "[outa]"';
}

cmd += ' -c:v libx264 -preset fast -crf 23' +
  ' -c:a aac -b:a 192k' +
  ' -shortest' +
  ' -movflags +faststart' +
  ' ' + q(outputFile);

// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?
// STEP 4: Execute FFmpeg (with retry using simpler params)
// â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?â•?

// Collect warnings from Download Assets
const assetWarnings = production.warnings || [];

let ffmpegSuccess = false;
let ffmpegError = '';

// Attempt 1: full command with all features
try {
  execSync(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }); // 10 min timeout
  ffmpegSuccess = true;
} catch (err) {
  const stderr1 = err.stderr?.toString() || err.message;
  ffmpegError = stderr1.length > 500 ? stderr1.slice(-500) : stderr1;

  // Self-healing attempt 2: simpler command (no music, keep VO + kling audio)
  const nonMusicAudioLabels = allAudioLabels.filter(l => l !== '[music]');
  if (hasAudio && musicIdx >= 0 && nonMusicAudioLabels.length > 0) {
    try {
      // Rebuild without music
      const simpleFilterParts = filterParts.filter(p =>
        !p.includes('[music]') && !p.includes('amix=inputs=' + allAudioLabels.length) && !p.includes('acopy[outa]')
      );
      // Re-mix only non-music audio
      if (nonMusicAudioLabels.length > 1) {
        simpleFilterParts.push(nonMusicAudioLabels.join('') + 'amix=inputs=' + nonMusicAudioLabels.length + ':duration=longest:dropout_transition=1:normalize=0[outa]');
      } else {
        simpleFilterParts.push(nonMusicAudioLabels[0] + 'acopy[outa]');
      }

      const simpleFilter = simpleFilterParts.join(';');
      const simpleInputs = inputs.filter(inp => !inp.includes(q(musicFile)));

      let simpleCmd = 'ffmpeg -y ' + simpleInputs.join(' ') +
        ' -filter_complex "' + simpleFilter + '"' +
        ' -map "[outv]" -map "[outa]"' +
        ' -c:v libx264 -preset fast -crf 23' +
        ' -c:a aac -b:a 192k -shortest -movflags +faststart ' + q(outputFile);

      execSync(simpleCmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });
      ffmpegSuccess = true;
      assetWarnings.push('FFmpeg: retry without music succeeded');
    } catch (err2) {
      const stderr2 = err2.stderr?.toString() || err2.message;
      ffmpegError += '\nRetry without music: ' + (stderr2.length > 300 ? stderr2.slice(-300) : stderr2);
    }
  }

  // Self-healing attempt 3: video only, no audio at all
  if (!ffmpegSuccess) {
    try {
      const videoOnlyFilter = filterParts.filter(p =>
        !p.includes(':a]') && !p.includes('[vo]') && !p.includes('[music]') && !p.includes('amix') && !p.includes('[outa]') && !p.includes('acopy')
      ).join(';');

      const videoOnlyInputs = inputs.filter(inp =>
        !inp.includes(q(voFile)) && !inp.includes(q(musicFile))
      );

      let videoOnlyCmd = 'ffmpeg -y ' + videoOnlyInputs.join(' ') +
        ' -filter_complex "' + videoOnlyFilter + '"' +
        ' -map "[outv]"' +
        ' -c:v libx264 -preset fast -crf 23 -an -movflags +faststart ' + q(outputFile);

      execSync(videoOnlyCmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });
      ffmpegSuccess = true;
      assetWarnings.push('FFmpeg: video-only fallback (no audio)');
    } catch (err3) {
      const stderr3 = err3.stderr?.toString() || err3.message;
      ffmpegError += '\nVideo-only retry: ' + (stderr3.length > 300 ? stderr3.slice(-300) : stderr3);
    }
  }
}

if (!ffmpegSuccess || !fs.existsSync(outputFile)) {
  return [{
    json: {
      error: true,
      chatId,
      message: '\u274C FFmpeg failed after all retries:\n' + ffmpegError,
      command: cmd,
    }
  }];
}

const stats = fs.statSync(outputFile);
const videoBase64 = fs.readFileSync(outputFile).toString('base64');

return [{
  json: {
    success: true,
    outputFile,
    fileSizeMB: (stats.size / (1024 * 1024)).toFixed(1),
    scenarioName,
    chatId,
    runRecordId,
    warnings: assetWarnings.length > 0 ? assetWarnings : undefined,
    _debug: {
      bodyClips: _debugBody,
      outroFile: outroFile ? 'YES' : 'NONE',
      hookFile: hookFile ? 'YES' : 'NONE',
      totalStreams: scaledStreams.length,
      bodyCaptionMap: Object.keys(bodyCaptionMap).length > 0 ? bodyCaptionMap : 'EMPTY',
      captionFont: captionFont || 'NO_FONT_FOUND',
      captionDir,
      copyJsonPresent: !!copyJson,
      copyJsonBodyClips: copyJson && copyJson.bodyClips ? copyJson.bodyClips.length : 0,
      ffmpegCmd: cmd.slice(0, 2000),
      ffmpegError: ffmpegError ? ffmpegError.slice(-500) : 'none',
    },
  },
  binary: {
    video: {
      data: videoBase64,
      mimeType: 'video/mp4',
      fileName: scenarioName + '_final.mp4',
    }
  }
}];
