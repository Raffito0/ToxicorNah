// MODULE: kie.ai API Helper (Nano Banana Pro)
// Handles image generation via kie.ai's Nano Banana Pro API
//
// API flow:
//   1. POST /api/v1/jobs/createTask → taskId
//   2. GET  /api/v1/jobs/recordInfo?taskId=xxx → poll until success → resultUrls[]
//
// Supports up to 8 reference images for character/environment consistency
// Pricing: ~$0.09/image (1K-2K), ~$0.12/image (4K)

const KIE_API_URL = 'https://api.kie.ai/api/v1/jobs';

/**
 * Generate an image using Nano Banana Pro
 * @param {string} apiKey - kie.ai API key
 * @param {string} prompt - Image generation prompt
 * @param {string[]} imageRefs - Array of image URLs (up to 8) for reference
 * @param {object} options - { aspectRatio, resolution, outputFormat }
 * @param {number} timeoutMs - Max wait time (default 3 minutes)
 * @returns {object} - { success, imageUrl, taskId, error }
 */
async function generate(apiKey, prompt, imageRefs = [], options = {}, timeoutMs = 180000) {
  if (!apiKey) {
    return { success: false, error: 'kie.ai API key not configured' };
  }

  const {
    aspectRatio = '9:16',  // Portrait for TikTok/Reels
    resolution = '2K',
    outputFormat = 'png',
  } = options;

  // Step 1: Create task
  const createRes = await fetch(KIE_API_URL + '/createTask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: 'nano-banana-pro',
      input: {
        prompt,
        image_input: imageRefs.length > 0 ? imageRefs : undefined,
        aspect_ratio: aspectRatio,
        resolution,
        output_format: outputFormat,
      },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    return { success: false, error: 'kie.ai createTask failed: ' + createRes.status + ' ' + errText };
  }

  const createData = await createRes.json();
  if (createData.code !== 200 || !createData.data?.taskId) {
    return { success: false, error: 'kie.ai createTask error: ' + JSON.stringify(createData) };
  }

  const taskId = createData.data.taskId;

  // Step 2: Poll for completion
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000)); // Poll every 3 seconds

    const pollRes = await fetch(KIE_API_URL + '/recordInfo?taskId=' + taskId, {
      headers: { 'Authorization': 'Bearer ' + apiKey },
    });

    if (!pollRes.ok) continue;

    const pollData = await pollRes.json();
    const state = pollData.data?.state;

    if (state === 'success') {
      let resultUrls = [];
      try {
        const resultJson = JSON.parse(pollData.data.resultJson);
        resultUrls = resultJson.resultUrls || [];
      } catch (e) {
        return { success: false, error: 'Failed to parse resultJson', taskId };
      }

      if (resultUrls.length === 0) {
        return { success: false, error: 'No result URLs in response', taskId };
      }

      return { success: true, imageUrl: resultUrls[0], allUrls: resultUrls, taskId };
    }

    if (state === 'fail') {
      return {
        success: false,
        error: 'Generation failed: ' + (pollData.data.failMsg || pollData.data.failCode || 'unknown'),
        taskId,
      };
    }

    // Still processing (waiting, queuing, generating) — continue polling
  }

  return { success: false, error: 'Timeout after ' + (timeoutMs / 1000) + 's', taskId };
}

/**
 * Download an image from a URL and return as Buffer
 * @param {string} imageUrl - URL to download (expires after 24h)
 * @returns {Buffer}
 */
async function downloadImage(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error('Download failed: ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { generate, downloadImage };
