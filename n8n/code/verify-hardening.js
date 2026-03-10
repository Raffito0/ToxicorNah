// NODE: Verify Hardening - 15-check binary MP4 forensic analysis
// Parses the MP4 at binary level to ensure ZERO FFmpeg/x264 fingerprints remain.
// If ANY critical check fails: retries hardening internally, verifies again.
// If still fails after retry: BLOCKS the video (returns error, video will NOT be published).
// Mode: Run Once for All Items
//
// WIRING: Harden Video -> this node -> Send Final to Telegram
//
// 3 Levels:
//   Level 1 (Container): ftyp brand+minor_version, faststart, encoder strings, (C)too atom,
//                         free/skip atoms, handler names, creation_time, ilst content,
//                         edts atom (FFmpeg-unique fingerprint)
//   Level 2 (Stream):    x264 SEI in mdat, Lavc version, encoding params,
//                         FULL mdat scan for encoder strings (not just first 64KB)
//   Level 3 (Audio):     stereo channels, 48kHz sample rate

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const input = $input.first();
if (!input || !input.json.success) {
  return [{ json: { ...input.json, error: true, message: 'Verify: no video to verify' } }];
}

const videoData = input.binary && input.binary.video;
if (!videoData || !videoData.data) {
  return [{ json: { ...input.json, error: true, message: 'Verify: no video binary data' } }];
}

function q(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

// ===== MP4 Binary Parser + 13-Check Verification Engine =====

function verifyAntiDetection(buf) {
  const report = { pass: true, checks: {}, critical: [], fileSize: buf.length };

  // -- Recursive MP4 box parser (parses EVERY atom in the file) --
  function parseBoxes(data, start, end) {
    const boxes = [];
    let pos = start;
    while (pos < end - 8) {
      let size = data.readUInt32BE(pos);
      const type = data.slice(pos + 4, pos + 8).toString('ascii');
      let headerSize = 8;
      if (size === 1 && pos + 16 <= end) {
        size = Number(data.readBigUInt64BE(pos + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end) break;
      const box = { type, offset: pos, size, headerSize };
      const containers = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'ilst', 'dinf', 'edts'];
      if (containers.includes(type)) {
        let childStart = pos + headerSize;
        if (type === 'meta') childStart += 4;
        box.children = parseBoxes(data, childStart, pos + size);
      }
      boxes.push(box);
      pos += size;
    }
    return boxes;
  }

  function findAllInTree(boxList, type) {
    const results = [];
    for (const box of boxList) {
      if (box.type === type) results.push(box);
      if (box.children) results.push(...findAllInTree(box.children, type));
    }
    return results;
  }

  const fail = (name, msg) => { report.checks[name] = 'FAIL: ' + msg; report.pass = false; report.critical.push(msg); };
  const ok = (name, msg) => { report.checks[name] = 'PASS' + (msg ? ': ' + msg : ''); };

  let boxes;
  try { boxes = parseBoxes(buf, 0, buf.length); } catch (e) {
    fail('parse', 'MP4 parse failed: ' + (e.message || '').slice(0, 80));
    return report;
  }

  // =============================================
  // LEVEL 1: Container metadata (8 checks)
  // =============================================

  // CHECK 1: ftyp major_brand must be 'isom' (CapCut standard)
  const ftyp = boxes.find(b => b.type === 'ftyp');
  if (ftyp) {
    const brand = buf.slice(ftyp.offset + 8, ftyp.offset + 12).toString('ascii');
    if (brand === 'isom') ok('L1_ftyp_brand', 'isom');
    else fail('L1_ftyp_brand', 'brand is "' + brand + '", expected "isom"');
    // CHECK 1b: minor_version must be 0 (FFmpeg defaults to 512/0x200)
    const minorVer = buf.readUInt32BE(ftyp.offset + 12);
    if (minorVer === 0) ok('L1_ftyp_minor_version', '0');
    else fail('L1_ftyp_minor_version', minorVer + ' (FFmpeg default is 512, expected 0)');
  } else fail('L1_ftyp_brand', 'no ftyp box found');

  // CHECK 1c: No edts/elst atoms (FFmpeg-unique fingerprint per DFRWS 2014 forensic paper)
  const edtsBoxes = findAllInTree(boxes, 'edts');
  if (edtsBoxes.length === 0) ok('L1_no_edts', 'no edit list atoms');
  else fail('L1_no_edts', edtsBoxes.length + ' edts atom(s) found (FFmpeg fingerprint)');

  // CHECK 2: moov before mdat (faststart applied)
  const moovPos = boxes.findIndex(b => b.type === 'moov');
  const mdatPos = boxes.findIndex(b => b.type === 'mdat');
  if (moovPos >= 0 && mdatPos >= 0 && moovPos < mdatPos) ok('L1_faststart', 'moov before mdat');
  else fail('L1_faststart', 'moov not before mdat');

  // CHECK 3: No encoder strings in container area (before mdat)
  const mdatBox = boxes.find(b => b.type === 'mdat');
  const containerEnd = mdatBox ? mdatBox.offset : buf.length;
  const containerStr = buf.slice(0, containerEnd).toString('latin1');
  const dangerStrings = [
    ['Lavf', 'FFmpeg muxer (libavformat)'],
    ['Lavc', 'FFmpeg codec (libavcodec)'],
    ['libx264', 'x264 encoder library'],
    ['FFmpeg', 'FFmpeg identifier'],
    ['x264 -', 'x264 encoder info'],
    ['HandBrake', 'HandBrake encoder'],
    ['encoder', 'encoder metadata tag'],
  ];
  for (const [pat, desc] of dangerStrings) {
    const idx = containerStr.indexOf(pat);
    const key = 'L1_container_' + pat.replace(/[^a-zA-Z0-9]/g, '');
    if (idx !== -1) fail(key, desc + ' found at byte ' + idx);
    else ok(key);
  }

  // CHECK 4: No (C)too atom (where FFmpeg writes its Lavf version)
  const tooIdx = containerStr.indexOf('\xA9too');
  if (tooIdx === -1) ok('L1_no_too_atom', 'no encoder tool atom');
  else fail('L1_no_too_atom', 'encoder tool atom at byte ' + tooIdx);

  // CHECK 5: No suspicious content in free/skip padding atoms
  const freeBoxes = boxes.filter(b => b.type === 'free' || b.type === 'skip');
  let freeClean = true;
  for (const fb of freeBoxes) {
    if (fb.size <= fb.headerSize) continue;
    const freeContent = buf.slice(fb.offset + fb.headerSize, fb.offset + fb.size).toString('latin1');
    for (const [pat] of dangerStrings) {
      if (freeContent.includes(pat)) {
        fail('L1_free_skip_clean', pat + ' in ' + fb.type + ' atom at byte ' + fb.offset);
        freeClean = false;
        break;
      }
    }
    if (!freeClean) break;
  }
  if (freeClean) ok('L1_free_skip_clean', freeBoxes.length + ' padding atoms clean');

  // CHECK 6: Handler names = VideoHandler + SoundHandler
  const hdlrBoxes = findAllInTree(boxes, 'hdlr');
  let vOk = false, aOk = false;
  for (const hb of hdlrBoxes) {
    const ds = hb.offset + hb.headerSize;
    if (ds + 24 > buf.length) continue;
    const hType = buf.slice(ds + 8, ds + 12).toString('ascii');
    let ns = ds + 24, ne = ns;
    while (ne < hb.offset + hb.size && buf[ne] !== 0 && ne - ns < 64) ne++;
    const hName = buf.slice(ns, ne).toString('ascii');
    if (hType === 'vide') {
      if (hName === 'VideoHandler') { ok('L1_handler_video', 'VideoHandler'); vOk = true; }
      else fail('L1_handler_video', '"' + hName + '", expected "VideoHandler"');
    }
    if (hType === 'soun') {
      if (hName === 'SoundHandler') { ok('L1_handler_audio', 'SoundHandler'); aOk = true; }
      else fail('L1_handler_audio', '"' + hName + '", expected "SoundHandler"');
    }
  }
  if (!vOk && !report.checks.L1_handler_video) fail('L1_handler_video', 'no video handler found');
  if (!aOk && !report.checks.L1_handler_audio) fail('L1_handler_audio', 'no audio handler found');

  // CHECK 7: creation_time is recent (not epoch 0 / year 1904)
  const moov = boxes.find(b => b.type === 'moov');
  if (moov && moov.children) {
    const mvhd = moov.children.find(b => b.type === 'mvhd');
    if (mvhd) {
      const ver = buf[mvhd.offset + mvhd.headerSize];
      let ct = 0;
      if (ver === 0) ct = buf.readUInt32BE(mvhd.offset + mvhd.headerSize + 4);
      else { try { ct = Number(buf.readBigUInt64BE(mvhd.offset + mvhd.headerSize + 4)); } catch(e) {} }
      const date = new Date((ct - 2082844800) * 1000);
      if (date.getFullYear() >= 2025) ok('L1_creation_time', date.toISOString());
      else fail('L1_creation_time', date.toISOString() + ' (too old, expected recent)');
    } else fail('L1_creation_time', 'no mvhd box');
  } else fail('L1_creation_time', 'no moov box');

  // CHECK 8: No ilst atom with encoder data
  const ilstBoxes = findAllInTree(boxes, 'ilst');
  let ilstClean = true;
  for (const il of ilstBoxes) {
    const ilStr = buf.slice(il.offset, il.offset + Math.min(il.size, 4096)).toString('latin1');
    if (ilStr.includes('\xA9too') || ilStr.includes('Lavf') || ilStr.includes('Lavc')) {
      fail('L1_ilst_clean', 'ilst contains encoder data');
      ilstClean = false;
      break;
    }
  }
  if (ilstClean) ok('L1_ilst_clean', ilstBoxes.length + ' ilst atoms clean');

  // =============================================
  // LEVEL 2: Video stream / mdat (5 checks)
  // Scans ENTIRE mdat, not just first 64KB — catches encoder strings in audio too
  // =============================================

  if (mdatBox) {
    // Scan in chunks to avoid toString on huge buffers
    const chunkSize = 262144; // 256KB chunks
    let foundSei = {}, foundLavc = false, foundLibx264 = false;
    const seiPats = [
      ['x264 - core', 'x264 SEI encoder signature'],
      ['options: cabac=', 'x264 encoding parameters'],
      ['videolan.org/x264', 'x264 URL in SEI'],
    ];
    for (let off = mdatBox.offset; off < mdatBox.offset + mdatBox.size; off += chunkSize - 64) {
      const end = Math.min(off + chunkSize, mdatBox.offset + mdatBox.size);
      const chunk = buf.slice(off, end).toString('latin1');
      for (const [pat, desc] of seiPats) {
        const key = 'L2_sei_' + pat.replace(/[^a-zA-Z0-9]/g, '');
        if (!foundSei[key] && chunk.includes(pat)) foundSei[key] = desc;
      }
      if (!foundLavc) { const m = chunk.match(/Lavc\d+\.\d+\.\d+/); if (m) foundLavc = m[0]; }
      if (!foundLibx264 && chunk.includes('libx264')) foundLibx264 = true;
    }

    // CHECK 9: No x264 SEI encoder string
    for (const [pat, desc] of seiPats) {
      const key = 'L2_sei_' + pat.replace(/[^a-zA-Z0-9]/g, '');
      if (foundSei[key]) fail(key, foundSei[key] + ' in mdat');
      else ok(key);
    }

    // CHECK 10: No Lavc version string anywhere in mdat (video SEI or audio fill elements)
    if (foundLavc) fail('L2_sei_lavc_version', '"' + foundLavc + '" in mdat stream');
    else ok('L2_sei_lavc_version');

    // CHECK 11: No libx264 reference anywhere in mdat
    if (foundLibx264) fail('L2_sei_libx264', 'libx264 in mdat stream');
    else ok('L2_sei_libx264');
  }

  // =============================================
  // LEVEL 3: Audio properties (2 checks)
  // =============================================

  // Find mp4a sample entry in stsd boxes
  const stsdBoxes = findAllInTree(boxes, 'stsd');
  let audioChannels = null, audioSampleRate = null;
  const fullStr = buf.toString('latin1');
  for (const stsd of stsdBoxes) {
    const mp4aOff = fullStr.indexOf('mp4a', stsd.offset);
    if (mp4aOff !== -1 && mp4aOff < stsd.offset + stsd.size && mp4aOff + 32 < buf.length) {
      // mp4a sample entry offsets (from 'mp4a' fourcc):
      // +20 = channel_count (uint16), +28 = sample_rate (uint32 16.16 fixed point)
      audioChannels = buf.readUInt16BE(mp4aOff + 20);
      audioSampleRate = buf.readUInt32BE(mp4aOff + 28) >>> 16;
      break;
    }
  }

  // CHECK 12: Stereo audio (2 channels)
  if (audioChannels === 2) ok('L3_audio_channels', 'stereo (2ch)');
  else fail('L3_audio_channels', (audioChannels !== null ? audioChannels + ' channels' : 'mp4a not found') + ', expected stereo');

  // CHECK 13: 48kHz sample rate
  if (audioSampleRate === 48000) ok('L3_audio_samplerate', '48000 Hz');
  else fail('L3_audio_samplerate', (audioSampleRate !== null ? audioSampleRate + ' Hz' : 'unknown') + ', expected 48000');

  return report;
}

// ===== Hardening function (for retry if verification fails) =====

function retryHarden(fileBuf, workDir) {
  const retryIn = path.join(workDir, 'retry_in.mp4');
  const retryStripped = path.join(workDir, 'retry_stripped.mp4');
  const retryOut = path.join(workDir, 'retry_out.mp4');
  const ct = new Date().toISOString().replace('Z', '000Z');

  fs.writeFileSync(retryIn, fileBuf);

  // Pass A: SEI strip
  try {
    execSync('ffmpeg -y -i ' + q(retryIn) +
      " -c:v copy -bsf:v 'filter_units=remove_types=6' -c:a copy " + q(retryStripped),
      { timeout: 60000 });
  } catch (e) {
    fs.copyFileSync(retryIn, retryStripped);
  }

  // Pass B: Container clean + remove edts
  try {
    execSync('ffmpeg -y -i ' + q(retryStripped) + ' -c copy' +
      ' -map_metadata -1 -fflags +bitexact' +
      ' -brand isom -use_editlist 0' +
      ' -metadata creation_time="' + ct + '"' +
      ' -metadata:s:v handler_name="VideoHandler"' +
      ' -metadata:s:a handler_name="SoundHandler"' +
      ' -movflags +faststart ' + q(retryOut),
      { timeout: 60000 });
  } catch (e) {
    // If pass B fails, use stripped version
    if (fs.existsSync(retryStripped)) fs.copyFileSync(retryStripped, retryOut);
    else fs.copyFileSync(retryIn, retryOut);
  }

  let result = fs.existsSync(retryOut) ? fs.readFileSync(retryOut) : fileBuf;

  // Pass C: Binary patch minor_version (512 -> 0) in ftyp
  if (result.length > 16 && result.slice(4, 8).toString('ascii') === 'ftyp') {
    if (result.readUInt32BE(12) === 512) {
      result = Buffer.from(result); // ensure writable copy
      result.writeUInt32BE(0, 12);
    }
  }

  // Cleanup
  try { fs.unlinkSync(retryIn); } catch (e) {}
  try { fs.unlinkSync(retryStripped); } catch (e) {}
  try { fs.unlinkSync(retryOut); } catch (e) {}

  return result;
}

// ===== Main verification flow =====

let videoBuf = Buffer.from(videoData.data, 'base64');
const scenarioName = input.json.scenarioName || 'unknown';
const workDir = '/tmp/toxicornah/' + scenarioName;
try { fs.mkdirSync(workDir, { recursive: true }); } catch (e) {}

// ATTEMPT 1: Verify the hardened video
let report = verifyAntiDetection(videoBuf);

// If failed: retry hardening and verify again
if (!report.pass) {
  const retryBuf = retryHarden(videoBuf, workDir);
  const report2 = verifyAntiDetection(retryBuf);

  if (report2.pass) {
    // Retry fixed it
    videoBuf = retryBuf;
    report = report2;
    report.checks._retry = 'PASS: retry hardening fixed all issues';
  } else {
    // Still failing after retry -> BLOCK the video
    return [{
      json: {
        success: false,
        error: true,
        scenarioName,
        chatId: input.json.chatId,
        runRecordId: input.json.runRecordId,
        message: 'BLOCKED: Video failed anti-detection verification after retry. ' +
          report2.critical.length + ' critical issues: ' + report2.critical.join(' | '),
        verifyReport: report2,
      }
    }];
  }
}

// All checks passed - forward video with verification report
return [{
  json: {
    ...input.json,
    verifyPassed: true,
    verifyChecks: Object.keys(report.checks).length,
    verifyCritical: report.critical.length,
    verifyReport: report,
  },
  binary: {
    video: {
      data: videoBuf.toString('base64'),
      mimeType: 'video/mp4',
      fileName: videoData.fileName,
    }
  }
}];
