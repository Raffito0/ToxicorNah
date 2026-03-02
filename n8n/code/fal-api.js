// NODE: fal.ai API Helpers (Reference File)
// These functions are INLINED into generate-hook.js and generate-outro.js
// since n8n Code node sandbox can't require() local files.
//
// Two Kling endpoints via fal.ai:
// 1. Kling Avatar V2 (lip-sync): reference image + audio → lip-synced video
// 2. Kling Image-to-Video V2 (motion): reference image + prompt → gesture video
//
// Both use the same queue mechanism: submit → poll status → get result

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

// ─── fal.ai queue helpers ───

const FAL_AVATAR_ENDPOINT = 'fal-ai/kling-video/ai-avatar/v2/standard';
const FAL_I2V_ENDPOINT = 'fal-ai/kling-video/v2/master/image-to-video';
const FAL_BASE_URL = 'https://queue.fal.run';
const FAL_POLL_INTERVAL = 5000; // 5 seconds
const FAL_TIMEOUT = 600000; // 10 minutes

/**
 * Submit a job to fal.ai queue
 * @param {string} falKey - fal.ai API key
 * @param {string} endpoint - fal.ai model endpoint
 * @param {object} input - request body
 * @returns {Promise<string>} request_id
 */
async function falSubmit(falKey, endpoint, input) {
  const res = await fetch(FAL_BASE_URL + '/' + endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'Key ' + falKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('fal.ai submit (' + endpoint + '): ' + res.status + ' ' + errText);
  }
  const data = await res.json();
  return data.request_id;
}

/**
 * Poll fal.ai job status until complete
 * @param {string} falKey
 * @param {string} endpoint
 * @param {string} requestId
 * @param {number} timeoutMs
 * @returns {Promise<object>} result data
 */
async function falPoll(falKey, endpoint, requestId, timeoutMs = FAL_TIMEOUT) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, FAL_POLL_INTERVAL));

    try {
      const statusRes = await fetch(
        FAL_BASE_URL + '/' + endpoint + '/requests/' + requestId + '/status',
        { headers: { 'Authorization': 'Key ' + falKey } }
      );

      if (!statusRes.ok) continue; // network blip, retry

      const statusData = await statusRes.json();

      if (statusData.status === 'COMPLETED') {
        // Fetch the actual result
        const resultRes = await fetch(
          FAL_BASE_URL + '/' + endpoint + '/requests/' + requestId,
          { headers: { 'Authorization': 'Key ' + falKey } }
        );
        if (!resultRes.ok) {
          throw new Error('fal.ai result fetch failed: ' + resultRes.status);
        }
        return await resultRes.json();
      }

      if (statusData.status === 'FAILED') {
        throw new Error('fal.ai job failed: ' + JSON.stringify(statusData));
      }

      // IN_QUEUE or IN_PROGRESS — keep polling
    } catch (err) {
      if (err.message.includes('failed') || err.message.includes('FAILED')) throw err;
      // Network error — wait longer and retry
      await new Promise(r => setTimeout(r, FAL_POLL_INTERVAL * 2));
    }
  }

  throw new Error('fal.ai timeout after ' + (timeoutMs / 1000) + 's');
}

/**
 * Generate lip-synced video via Kling Avatar V2
 * @param {string} falKey - fal.ai API key
 * @param {string} imageUrl - Reference face image URL
 * @param {string} audioUrl - VO audio URL (MP3)
 * @param {string} prompt - Motion prompt (default: ".")
 * @returns {Promise<{videoUrl: string, duration: number}>}
 */
async function generateKlingAvatar(falKey, imageUrl, audioUrl, prompt = '.') {
  const requestId = await falSubmit(falKey, FAL_AVATAR_ENDPOINT, {
    image_url: imageUrl,
    audio_url: audioUrl,
    prompt: prompt || '.',
  });

  const result = await falPoll(falKey, FAL_AVATAR_ENDPOINT, requestId);

  if (!result.video || !result.video.url) {
    throw new Error('Kling Avatar returned no video URL');
  }

  return {
    videoUrl: result.video.url,
    duration: result.duration || 0,
  };
}

/**
 * Generate gesture/motion video via Kling Image-to-Video V2
 * @param {string} falKey - fal.ai API key
 * @param {string} imageUrl - Reference image URL
 * @param {string} prompt - Motion description
 * @param {string} duration - "5" or "10" seconds
 * @returns {Promise<{videoUrl: string}>}
 */
async function generateKlingI2V(falKey, imageUrl, prompt, duration = '5') {
  const requestId = await falSubmit(falKey, FAL_I2V_ENDPOINT, {
    image_url: imageUrl,
    prompt: prompt,
    duration: duration,
    negative_prompt: 'blur, distort, low quality, text, watermark',
    cfg_scale: 0.5,
  });

  const result = await falPoll(falKey, FAL_I2V_ENDPOINT, requestId);

  if (!result.video || !result.video.url) {
    throw new Error('Kling I2V returned no video URL');
  }

  return {
    videoUrl: result.video.url,
  };
}

/**
 * Download video from URL and return as Buffer
 * @param {string} videoUrl
 * @returns {Promise<Buffer>}
 */
async function downloadVideo(videoUrl) {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error('Video download failed: ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// Export for reference (not used in n8n — functions are inlined)
module.exports = {
  falSubmit,
  falPoll,
  generateKlingAvatar,
  generateKlingI2V,
  downloadVideo,
};
