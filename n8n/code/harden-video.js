// NODE: Harden Video - Anti-detection for TikTok/Instagram
// Strips ALL FFmpeg/x264 fingerprints from assembled video.
// Three-pass process:
//   Pass A: Strip x264 SEI NAL units from H.264 bitstream (filter_units=remove_types=6)
//   Pass B: Clean container metadata, remove edts atoms, set CapCut-like atoms
//   Pass C: Binary patch ftyp minor_version from 512 (FFmpeg default) to 0
// Mode: Run Once for All Items
//
// WIRING: Assemble Video -> this node -> Verify Hardening -> Send Final to Telegram

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const input = $input.first();
if (!input || !input.json.success) {
  return [{ json: { ...input.json, error: true, message: 'Harden: no successful assembly to harden' } }];
}

const videoData = input.binary && input.binary.video;
if (!videoData || !videoData.data) {
  return [{ json: { ...input.json, error: true, message: 'Harden: no video binary data' } }];
}

const scenarioName = input.json.scenarioName || 'unknown';
const workDir = '/tmp/toxicornah/' + scenarioName;
const inputFile = path.join(workDir, 'assembled_raw.mp4');
const strippedFile = path.join(workDir, 'assembled_stripped.mp4');
const hardenedFile = path.join(workDir, 'assembled_hardened.mp4');

// Ensure work directory exists
try { fs.mkdirSync(workDir, { recursive: true }); } catch (e) {}

// Write video binary to disk for FFmpeg processing
const videoBuf = Buffer.from(videoData.data, 'base64');
fs.writeFileSync(inputFile, videoBuf);

function q(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

const warnings = [];
const creationTime = new Date().toISOString().replace('Z', '000Z');

// ===== PASS A: Strip SEI NAL units from video bitstream =====
// x264 embeds encoder info as SEI type 6 NAL units INSIDE the video stream.
// -map_metadata -1 does NOT touch these. Only a bitstream filter can remove them.
// This removes: "x264 - core 164 r3108...", "Lavc60.31.102 libx264", encoding options
try {
  execSync('ffmpeg -y -i ' + q(inputFile) +
    " -c:v copy -bsf:v 'filter_units=remove_types=6' -c:a copy " + q(strippedFile),
    { timeout: 60000 });
} catch (e) {
  warnings.push('Pass A (SEI strip) failed, using raw: ' + (e.message || '').slice(0, 120));
  fs.copyFileSync(inputFile, strippedFile);
}

// ===== PASS B: Clean container metadata + mimic CapCut =====
// What CapCut outputs: ftyp=isom, no encoder string, no (C)too atom, standard handler names
// -fflags +bitexact: prevents FFmpeg from writing Lavf version into (C)too atom
// -map_metadata -1: strips ALL container metadata (udta, ilst, etc.)
// -brand isom: sets ftyp major_brand to match CapCut
// -use_editlist 0: prevents edts/elst atoms (FFmpeg-unique fingerprint per DFRWS 2014 paper)
// -movflags +faststart: moves moov before mdat (required for streaming)
// handler_name: VideoHandler/SoundHandler (standard mobile app names)
// creation_time: set to current time (empty = suspicious)
try {
  execSync('ffmpeg -y -i ' + q(strippedFile) + ' -c copy' +
    ' -map_metadata -1 -fflags +bitexact' +
    ' -brand isom -use_editlist 0' +
    ' -metadata creation_time="' + creationTime + '"' +
    ' -metadata:s:v handler_name="VideoHandler"' +
    ' -metadata:s:a handler_name="SoundHandler"' +
    ' -movflags +faststart ' + q(hardenedFile),
    { timeout: 60000 });
} catch (e) {
  warnings.push('Pass B (metadata clean) failed: ' + (e.message || '').slice(0, 120));
  // Fallback: use SEI-stripped version (at least stream is clean)
  if (fs.existsSync(strippedFile)) {
    fs.copyFileSync(strippedFile, hardenedFile);
  } else {
    fs.copyFileSync(inputFile, hardenedFile);
  }
}

// Cleanup temp files
try { fs.unlinkSync(inputFile); } catch (e) {}
try { fs.unlinkSync(strippedFile); } catch (e) {}

// ===== PASS C: Binary patch ftyp minor_version =====
// FFmpeg hardcodes minor_version=512 (0x200) in the ftyp box. CapCut uses 0.
// This is a known FFmpeg fingerprint. We patch 4 bytes at offset 12 to zero.
// ftyp box layout: [4 size][4 "ftyp"][4 major_brand][4 minor_version][N*4 compat_brands]
const hardenedBuf = fs.readFileSync(hardenedFile);
const ftypType = hardenedBuf.slice(4, 8).toString('ascii');
if (ftypType === 'ftyp') {
  const currentMinor = hardenedBuf.readUInt32BE(12);
  if (currentMinor === 512) {
    hardenedBuf.writeUInt32BE(0, 12);
    fs.writeFileSync(hardenedFile, hardenedBuf);
    // hardenedBuf is now patched in memory too
  }
}
const hardenedBase64 = hardenedBuf.toString('base64');

// Cleanup final temp
try { fs.unlinkSync(hardenedFile); } catch (e) {}

return [{
  json: {
    ...input.json,
    hardenWarnings: warnings.length > 0 ? warnings : undefined,
    hardenApplied: true,
    hardenCreationTime: creationTime,
  },
  binary: {
    video: {
      data: hardenedBase64,
      mimeType: 'video/mp4',
      fileName: videoData.fileName || ('VID_' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15) + '.mp4'),
    }
  }
}];
