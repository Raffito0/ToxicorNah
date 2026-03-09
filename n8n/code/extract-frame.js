// NODE: Extract Frame from First Body Clip
// Uses FFmpeg to extract the first frame from the first body clip
// This frame serves as the environment/lighting reference for AI image generation
// Mode: Run Once for All Items
//
// WIRING: After body clips are loaded -> this Code node
// Output: frame image as binary + frame URL (uploaded to temp storage)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scenario = $('Validate Clips').first().json;
const bodyClips = scenario.bodyClips || [];
const scenarioName = scenario.scenarioName;
const outputDir = '/tmp/toxicornah/' + scenarioName;

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

if (bodyClips.length === 0) {
  return [{ json: { error: true, message: 'No body clips to extract frame from' } }];
}

// Get the first body clip file path
// The body clip video needs to be downloaded first (from Telegram or Airtable)
// This node expects the first clip to already be at the expected path
const firstClip = bodyClips[0];
const clipPath = firstClip.localPath || path.join(outputDir, 'body_' + firstClip.clipIndex + '.mp4');
const framePath = path.join(outputDir, 'env_frame.png');

if (!fs.existsSync(clipPath)) {
  return [{
    json: {
      error: true,
      message: 'First body clip not found at: ' + clipPath + '. Download body clips first.',
      chatId: scenario.chatId,
    }
  }];
}

// Extract first frame using FFmpeg
try {
  execSync(
    'ffmpeg -y -i "' + clipPath + '" -frames:v 1 -q:v 2 "' + framePath + '"',
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
  );
} catch (err) {
  return [{
    json: {
      error: true,
      message: 'FFmpeg frame extraction failed: ' + (err.stderr?.toString()?.substring(0, 300) || err.message),
      chatId: scenario.chatId,
    }
  }];
}

if (!fs.existsSync(framePath)) {
  return [{ json: { error: true, message: 'Frame file not found after extraction', chatId: scenario.chatId } }];
}

const frameBuffer = fs.readFileSync(framePath);

return [{
  json: {
    success: true,
    framePath,
    scenarioName,
    chatId: scenario.chatId,
    conceptType: scenario.conceptType,
  },
  binary: {
    envFrame: {
      data: frameBuffer.toString('base64'),
      mimeType: 'image/png',
      fileName: 'env_frame.png',
    }
  }
}];
