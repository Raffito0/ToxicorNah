// MODULE: ComfyUI REST API Helper
// Connects to ComfyUI running on SimplePod.ai GPU cloud
// Handles: submit workflow -> poll status -> download result
//
// ComfyUI API endpoints:
//   POST /prompt              -- submit a workflow
//   GET  /history/{prompt_id} -- check execution status
//   GET  /view?filename=...   -- download output image/video
//
// Usage in n8n Code nodes:
//   const comfy = require('./comfyui-api.js'); // or inline the functions
//   const result = await comfy.run(COMFYUI_URL, workflowJson);

// Config -- set your SimplePod.ai ComfyUI instance URL
// Format: https://{pod-id}-8188.proxy.runpod.net or similar
const DEFAULT_COMFYUI_URL = ''; // <- Set your ComfyUI URL from SimplePod.ai

/**
 * Submit a ComfyUI workflow prompt and wait for completion
 * @param {string} baseUrl - ComfyUI server URL (e.g. https://xxx-8188.proxy.runpod.net)
 * @param {object} workflow - ComfyUI workflow JSON (API format)
 * @param {number} timeoutMs - Max wait time (default 5 minutes)
 * @returns {object} - { success, images[], prompt_id, error }
 */
async function run(baseUrl, workflow, timeoutMs = 300000) {
  const url = baseUrl || DEFAULT_COMFYUI_URL;
  if (!url) {
    return { success: false, error: 'ComfyUI URL not configured' };
  }

  // Step 1: Submit the prompt
  const promptRes = await fetch(url + '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!promptRes.ok) {
    const errText = await promptRes.text();
    return { success: false, error: 'Submit failed: ' + promptRes.status + ' ' + errText };
  }

  const { prompt_id } = await promptRes.json();
  if (!prompt_id) {
    return { success: false, error: 'No prompt_id returned' };
  }

  // Step 2: Poll for completion
  const startTime = Date.now();
  let completed = false;
  let historyData = null;

  while (Date.now() - startTime < timeoutMs) {
    await sleep(2000); // Poll every 2 seconds

    const historyRes = await fetch(url + '/history/' + prompt_id);
    if (!historyRes.ok) continue;

    const history = await historyRes.json();
    const entry = history[prompt_id];

    if (!entry) continue;

    if (entry.status?.completed || entry.outputs) {
      historyData = entry;
      completed = true;
      break;
    }

    if (entry.status?.status_str === 'error') {
      return { success: false, error: 'ComfyUI execution error', prompt_id };
    }
  }

  if (!completed) {
    return { success: false, error: 'Timeout after ' + (timeoutMs / 1000) + 's', prompt_id };
  }

  // Step 3: Extract output filenames
  const outputs = historyData.outputs || {};
  const images = [];

  for (const nodeId of Object.keys(outputs)) {
    const nodeOutput = outputs[nodeId];
    if (nodeOutput.images) {
      for (const img of nodeOutput.images) {
        images.push({
          filename: img.filename,
          subfolder: img.subfolder || '',
          type: img.type || 'output',
          downloadUrl: url + '/view?filename=' + encodeURIComponent(img.filename) +
            (img.subfolder ? '&subfolder=' + encodeURIComponent(img.subfolder) : '') +
            '&type=' + (img.type || 'output'),
        });
      }
    }
    // Also check for video outputs (gifs/videos in some nodes)
    if (nodeOutput.gifs) {
      for (const vid of nodeOutput.gifs) {
        images.push({
          filename: vid.filename,
          subfolder: vid.subfolder || '',
          type: vid.type || 'output',
          downloadUrl: url + '/view?filename=' + encodeURIComponent(vid.filename) +
            (vid.subfolder ? '&subfolder=' + encodeURIComponent(vid.subfolder) : '') +
            '&type=' + (vid.type || 'output'),
        });
      }
    }
  }

  return { success: true, prompt_id, images };
}

/**
 * Download a file from ComfyUI
 * @param {string} downloadUrl - Full URL from run() result
 * @returns {Buffer} - Binary file data
 */
async function download(downloadUrl) {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error('Download failed: ' + res.status);
  }
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export for use in n8n Code nodes (inline or require)
// In n8n Code nodes, copy the functions directly since require() doesn't work for local files
module.exports = { run, download, sleep };
