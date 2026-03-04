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
// WIRING: After all assets approved → Download All Clips → this Code node → Send Final to Telegram
//
// Expects all clips downloaded to /tmp/toxicornah/{scenarioName}/
// Input: production data with template, clip mapping, file paths

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
// These segments have speech audio embedded in the video — no separate VO overlay needed
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

// ═══════════════════════════════════════
// STEP 1: Probe all clip durations with FFprobe
// ═══════════════════════════════════════
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

// ═══════════════════════════════════════
// STEP 2: Calculate speed factors for smart trimming
// ═══════════════════════════════════════
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

  // Much shorter: freeze last frame
  if (sf < 0.7) {
    const gap = targetDuration - actualDuration;
    return { method: 'freeze', speedFactor: 1.0, freezeDuration: gap };
  }

  return { method: 'none', speedFactor: 1.0 };
}

// ═══════════════════════════════════════
// CAPTION HELPERS: drawtext overlays for body clips and outro (NOT hook)
// ═══════════════════════════════════════
function stripEmojis(str) {
  if (!str) return '';
  return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '').trim();
}

// Safe caption dir (no spaces/special chars — safe for FFmpeg drawtext path)
const captionDir = '/tmp/toncap_' + (runRecordId || scenarioName || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
if (!fs.existsSync(captionDir)) fs.mkdirSync(captionDir, { recursive: true });

function writeCaptionFile(text, label) {
  const clean = stripEmojis(text);
  if (!clean) return null;
  const fp = captionDir + '/' + label + '.txt';
  fs.writeFileSync(fp, clean);
  return fp;
}

// Font detection: Proxima Nova Semibold (TikTok style) → fallback to system fonts
const FONT_PATHS = [
  '/home/node/.n8n/fonts/ProximaNova-Semibold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];
const captionFont = FONT_PATHS.find(f => fs.existsSync(f)) || '';
const captionFontParam = captionFont ? ':fontfile=' + captionFont : '';

// Build section → caption text map from copyJson
const bodyCaptionMap = {};
if (copyJson && copyJson.bodyClips) {
  for (const bc of copyJson.bodyClips) {
    if (bc.section && bc.text) bodyCaptionMap[bc.section] = bc.text;
  }
}

// ═══════════════════════════════════════
// STEP 3: Build FFmpeg command
// ═══════════════════════════════════════
const inputs = [];
const filterParts = [];
const scaledStreams = [];
let streamIdx = 0;

// Helper: quote path for shell
function q(p) { if (!p) return '""'; return '"' + p.replace(/"/g, '\\"') + '"'; }

// ─── Hook input ───
const hookSegment = template.segments.find(s => s.section === 'hook');
const hookTarget = hookSegment ? hookSegment.duration : 3.0;
let hookActualUsed = hookTarget; // track actual duration used (may differ for kling)
let hookStreamIdx = -1;

if (hookFile && fs.existsSync(hookFile)) {
  const hookActual = probeDuration(hookFile);
  hookStreamIdx = streamIdx++;

  if (hookFile.endsWith('.png') || hookFile.endsWith('.jpg')) {
    // Still image → create video
    inputs.push('-loop 1 -t ' + hookTarget + ' -framerate ' + FPS + ' -i ' + q(hookFile));
    filterParts.push('[' + hookStreamIdx + ':v]scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=decrease,pad=' + WIDTH + ':' + HEIGHT + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + FPS + '[hook]');
    hookActualUsed = hookTarget;
  } else if (hasBakedHookAudio) {
    // Sora 2 speaking: DON'T speed-adjust (would break lip sync)
    // VO is pre-padded to hookTarget in generate-voiceover → Kling video ≈ hookTarget
    // Trim to exact duration as safety net
    inputs.push('-i ' + q(hookFile));
    let vf = '[' + hookStreamIdx + ':v]';
    vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=decrease,pad=' + WIDTH + ':' + HEIGHT + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + FPS;
    vf += ',trim=0:' + hookTarget.toFixed(3) + ',setpts=PTS-STARTPTS[hook]';
    filterParts.push(vf);
    hookActualUsed = hookTarget;
  } else {
    // Normal: apply smart trim
    const hookTrim = calcTrimStrategy(hookActual, hookTarget);
    inputs.push('-i ' + q(hookFile));
    let vf = '[' + hookStreamIdx + ':v]';
    if (hookTrim.method === 'speed' && hookTrim.speedFactor !== 1.0) {
      vf += 'setpts=PTS/' + hookTrim.speedFactor.toFixed(4) + ',';
    }
    vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=decrease,pad=' + WIDTH + ':' + HEIGHT + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + FPS;
    if (hookTrim.method === 'freeze') {
      vf += ',tpad=stop=-1:stop_mode=clone:stop_duration=' + hookTrim.freezeDuration.toFixed(3);
    }
    vf += ',trim=0:' + hookTarget.toFixed(3) + ',setpts=PTS-STARTPTS[hook]';
    filterParts.push(vf);
    hookActualUsed = hookTarget;
  }
  scaledStreams.push('[hook]');
}

// ─── Body clip inputs ───
const bodySegments = (clipMapping || []).filter(c => c.localPath && fs.existsSync(c.localPath));

for (let i = 0; i < bodySegments.length; i++) {
  const seg = bodySegments[i];
  const idx = streamIdx++;
  const label = 'body' + i;
  // Always probe the real file duration — Airtable clip_duration_sec may be stale/wrong
  const actual = probeDuration(seg.localPath) || seg.actualDuration || 0;
  const target = seg.targetDuration || 3.0;
  // Always take the FIRST `target` seconds of the clip
  const startOffset = 0;

  inputs.push('-i ' + q(seg.localPath));

  let vf = '[' + idx + ':v]';
  vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=decrease,pad=' + WIDTH + ':' + HEIGHT + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + FPS;
  vf += ',trim=' + startOffset.toFixed(3) + ':' + (startOffset + target).toFixed(3) + ',setpts=PTS-STARTPTS';
  // Caption overlay (body clips only — hook is excluded, visual-only sections like screenshot/upload_chat get no caption)
  // Organic feel: random y-offset + random appear/disappear timing per segment
  const capText = bodyCaptionMap[seg.section] || null;
  const capFile = capText ? writeCaptionFile(capText, label) : null;
  if (capFile) {
    // Pseudo-random (deterministic per segment index) for organic timing
    function capRand(seed) { const x = Math.sin(seed * 9301 + 49297) * 49297; return x - Math.floor(x); }
    const capYOff = Math.round(-22 + capRand(i * 7 + 1) * 44); // -22 to +22px
    const capY = 'h*0.32+(' + capYOff + ')';
    const capStart = 0.2 + capRand(i * 13 + 3) * 0.5;  // 0.20–0.70s
    const capEnd = target - capRand(i * 17 + 11) * 0.4;  // 0–0.40s before end
    vf += ',drawtext=textfile=' + capFile + captionFontParam + ':fontsize=50:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=' + capY + ":enable='between(t\\," + capStart.toFixed(3) + '\\,' + capEnd.toFixed(3) + ")'";
  }
  vf += '[' + label + ']';
  filterParts.push(vf);
  scaledStreams.push('[' + label + ']');
}

// ─── Outro input ───
const outroSegment = template.segments.find(s => s.section === 'outro');
const outroTarget = outroSegment ? outroSegment.duration : 3.0;
let outroActualUsed = outroTarget;
let outroStreamIdx = -1;

if (outroFile && fs.existsSync(outroFile)) {
  const outroActual = probeDuration(outroFile);
  outroStreamIdx = streamIdx++;

  inputs.push('-i ' + q(outroFile));

  // Pre-compute outro caption drawtext (used in both baked and normal paths)
  const outroCapFile = (copyJson && copyJson.outroText) ? writeCaptionFile(copyJson.outroText, 'outro') : null;
  function outroRand(seed) { const x = Math.sin(seed * 9301 + 49297) * 49297; return x - Math.floor(x); }
  const outroCStart = 0.2 + outroRand(42) * 0.5;
  const outroCEnd = outroTarget - outroRand(77) * 0.35;
  const outroCYOff = Math.round(-22 + outroRand(19) * 44);
  const outroDT = outroCapFile
    ? ",drawtext=textfile=" + outroCapFile + captionFontParam + ":fontsize=50:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.32+(" + outroCYOff + "):enable='between(t\\," + outroCStart.toFixed(3) + "\\," + outroCEnd.toFixed(3) + ")'"
    : '';

  if (hasBakedOutroAudio) {
    // Sora 2 speaking: DON'T speed-adjust (would break lip sync)
    // VO is pre-padded to outroTarget in generate-voiceover → Kling video ≈ outroTarget
    // Trim to exact duration as safety net
    let vf = '[' + outroStreamIdx + ':v]';
    vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=decrease,pad=' + WIDTH + ':' + HEIGHT + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + FPS;
    vf += ',trim=0:' + outroTarget.toFixed(3) + ',setpts=PTS-STARTPTS' + outroDT + '[outro]';
    filterParts.push(vf);
    outroActualUsed = outroTarget;
  } else {
    // Normal: apply smart trim
    const outroTrim = calcTrimStrategy(outroActual, outroTarget);
    let vf = '[' + outroStreamIdx + ':v]';
    if (outroTrim.method === 'speed' && outroTrim.speedFactor !== 1.0) {
      vf += 'setpts=PTS/' + outroTrim.speedFactor.toFixed(4) + ',';
    }
    vf += 'scale=' + WIDTH + ':' + HEIGHT + ':force_original_aspect_ratio=decrease,pad=' + WIDTH + ':' + HEIGHT + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + FPS;
    if (outroTrim.method === 'freeze') {
      vf += ',tpad=stop=-1:stop_mode=clone:stop_duration=' + outroTrim.freezeDuration.toFixed(3);
    }
    vf += ',trim=0:' + outroTarget.toFixed(3) + ',setpts=PTS-STARTPTS' + outroDT + '[outro]';
    filterParts.push(vf);
    outroActualUsed = outroTarget;
  }
  scaledStreams.push('[outro]');
}

// ─── Concatenate all video streams ───
if (scaledStreams.length === 0) {
  return [{ json: { error: true, chatId, message: 'No video streams to assemble' } }];
}
filterParts.push(scaledStreams.join('') + 'concat=n=' + scaledStreams.length + ':v=1:a=0[outv]');

// ─── Audio: VO segments + Music ───
let hasVo = false;
let musicIdx = -1;

// Per-segment VO with adelay (new format)
// Each VO segment is placed at its correct timeline position.
// If VO is longer than its clip duration, speed up with atempo (max 1.4x, preserves pitch).
// Beyond 1.4x the VO bleeds slightly — use per-segment redo to regenerate shorter.
if (voSegmentFiles && voSegmentFiles.length > 0) {
  const voLabels = [];
  let timeOffsetMs = 0;

  for (const seg of voSegmentFiles) {
    // Skip VO overlay for segments with baked-in audio (Sora 2 speaking)
    // Their audio is embedded in the video — extracted separately below
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
        filterParts.push('[' + voIdx + ':a]' + atempoFilter + 'volume=1.0[' + label + ']');
      } else {
        filterParts.push('[' + voIdx + ':a]' + atempoFilter + 'adelay=' + timeOffsetMs + '|' + timeOffsetMs + ',volume=1.0[' + label + ']');
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
      filterParts.push(voLabels.join('') + 'amix=inputs=' + voLabels.length + ':duration=longest:dropout_transition=0[vo_mixed]');
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

// ─── Embedded audio: extract from speaking videos (Sora 2 with baked speech) ───
const klingAudioLabels = [];

if (hasBakedHookAudio && hookStreamIdx >= 0) {
  // Hook is always the first segment — no adelay needed
  filterParts.push('[' + hookStreamIdx + ':a]volume=1.0[kling_hook_a]');
  klingAudioLabels.push('[kling_hook_a]');
}

if (hasBakedOutroAudio && outroStreamIdx >= 0) {
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
    filterParts.push('[' + outroStreamIdx + ':a]adelay=' + outroTimeOffsetMs + '|' + outroTimeOffsetMs + ',volume=1.0[kling_outro_a]');
  } else {
    filterParts.push('[' + outroStreamIdx + ':a]volume=1.0[kling_outro_a]');
  }
  klingAudioLabels.push('[kling_outro_a]');
}

// Mix audio: combine VO segments + kling embedded audio + music
const allAudioLabels = [];
if (hasVo) allAudioLabels.push('[vo_mixed]');
allAudioLabels.push(...klingAudioLabels);
if (musicIdx >= 0) allAudioLabels.push('[music]');

if (allAudioLabels.length > 1) {
  filterParts.push(allAudioLabels.join('') + 'amix=inputs=' + allAudioLabels.length + ':duration=longest:dropout_transition=1[outa]');
} else if (allAudioLabels.length === 1) {
  filterParts.push(allAudioLabels[0] + 'acopy[outa]');
}

const hasAudio = allAudioLabels.length > 0;

// ─── Build full command ───
const filterComplex = filterParts.join(';');

let cmd = 'ffmpeg -y ' + inputs.join(' ') +
  ' -filter_complex "' + filterComplex + '"' +
  ' -map "[outv]"';

if (hasAudio) {
  cmd += ' -map "[outa]"';
}

cmd += ' -c:v libx264 -preset fast -crf 23' +
  ' -c:a aac -b:a 192k' +
  ' -movflags +faststart' +
  ' ' + q(outputFile);

// ═══════════════════════════════════════
// STEP 4: Execute FFmpeg (with retry using simpler params)
// ═══════════════════════════════════════

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
        simpleFilterParts.push(nonMusicAudioLabels.join('') + 'amix=inputs=' + nonMusicAudioLabels.length + ':duration=longest:dropout_transition=1[outa]');
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
  },
  binary: {
    video: {
      data: videoBase64,
      mimeType: 'video/mp4',
      fileName: scenarioName + '_final.mp4',
    }
  }
}];
