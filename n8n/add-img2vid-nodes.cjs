// Add Img2Vid nodes + video approval flow to the unified pipeline
// Adds 8 nodes: 4 for hook video, 4 for outro video
// Rewires connections for the 2-step approval pattern:
//   Image approval → Img2Vid → Send Video Preview → Poll → Video Approved?
//
// Also fixes existing Poll nodes to reset approval field before polling
// (prevents infinite redo loop when field is stale 'redo')

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

function uuid() {
  return crypto.randomUUID();
}

// ─── Poll code template (with field reset) ───
function makePollCode(fieldName, label) {
  return `// Poll Airtable for ${fieldName} status every 10 seconds
// Resets the field to empty first to prevent stale 'redo' from causing immediate return

const _https = require('https');
const { URL } = require('url');

function airtableFetch(path) {
  return new Promise((resolve, reject) => {
    const AIRTABLE_TOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
    const u = new URL('https://api.airtable.com/v0/appsgjIdkpak2kaXq/tbltCYcVXrLYvyIJL/' + path);
    const req = _https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_TOKEN },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on('error', reject);
    req.end();
  });
}

function airtablePatch(recordId, fields) {
  return new Promise((resolve, reject) => {
    const AIRTABLE_TOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
    const body = JSON.stringify({ fields });
    const req = _https.request({
      hostname: 'api.airtable.com',
      path: '/v0/appsgjIdkpak2kaXq/tbltCYcVXrLYvyIJL/' + recordId,
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + AIRTABLE_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const recordId = $json.videoRunRecordId || $('Create Video Run').first().json.id;
const POLL_INTERVAL = 10000; // 10 seconds
const MAX_POLLS = 24; // 4 minutes max (below 300s sandbox timeout)

// Reset field to prevent stale 'redo' from causing immediate return on redo loop
try {
  await airtablePatch(recordId, { '${fieldName}': '' });
} catch(e) { /* non-fatal */ }

for (let i = 0; i < MAX_POLLS; i++) {
  await new Promise(r => setTimeout(r, POLL_INTERVAL));
  try {
    const record = await airtableFetch(recordId);
    const status = record.fields?.['${fieldName}'];
    if (status === 'approved') {
      return [{ json: { body: { action: 'approve' } } }];
    }
    if (status === 'redo') {
      return [{ json: { body: { action: 'redo' } } }];
    }
    // status is 'pending' or empty — keep polling
  } catch (err) {
    // Network error — keep polling
  }
}

// Timeout
throw new Error('${label} timed out after 4 minutes');
`;
}

// ─── Telegram credentials (same as existing) ───
const telegramCreds = {
  telegramApi: {
    id: 'pyWK5SqqdZeXs1WU',
    name: 'Telegram account',
  },
};

// ═══════════════════════════════════════
// 1. CREATE 8 NEW NODES
// ═══════════════════════════════════════

const newNodes = [
  // ─── HOOK VIDEO NODES ───
  {
    parameters: {
      jsCode: '// Placeholder — will be replaced by embed-code.cjs with img-to-video.js',
      mode: 'runOnceForAllItems',
    },
    id: uuid(),
    name: 'Img2Vid Hook',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [200, -1100],
  },
  {
    parameters: {
      operation: 'sendVideo',
      chatId: '={{ $json.chatId }}',
      binaryData: true,
      binaryPropertyName: 'hookVideo',
      additionalFields: {
        caption: '={{ "🎬 Hook VIDEO for \\"" + $json.scenarioName + "\\"\\n\\nSource: " + ($json.videoSource || "unknown") }}',
      },
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [
                {
                  text: '✅ Approve',
                  additionalFields: {
                    callback_data: "={{ 'vpApprove_' + $('Create Video Run').first().json.id + '_hook_vid' }}",
                  },
                },
                {
                  text: '🔄 Redo',
                  additionalFields: {
                    callback_data: "={{ 'vpRedo_' + $('Create Video Run').first().json.id + '_hook_vid' }}",
                  },
                },
              ],
            },
          },
        ],
      },
    },
    id: uuid(),
    name: 'Send Hook Video Preview',
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    position: [380, -1280],
    credentials: telegramCreds,
  },
  {
    parameters: {
      jsCode: makePollCode('hook_vid_approval', 'hook_vid_approval'),
      mode: 'runOnceForAllItems',
    },
    id: uuid(),
    name: 'Poll Hook Video Approval',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [520, -1200],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [
          {
            id: uuid(),
            leftValue: '={{ $json.body.action }}',
            rightValue: 'approve',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: uuid(),
    name: 'Hook Video Approved?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [660, -1100],
  },

  // ─── OUTRO VIDEO NODES ───
  {
    parameters: {
      jsCode: '// Placeholder — will be replaced by embed-code.cjs with img-to-video.js',
      mode: 'runOnceForAllItems',
    },
    id: uuid(),
    name: 'Img2Vid Outro',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2200, -1100],
  },
  {
    parameters: {
      operation: 'sendVideo',
      chatId: '={{ $json.chatId }}',
      binaryData: true,
      binaryPropertyName: 'outroVideo',
      additionalFields: {
        caption: '={{ "🎬 Outro VIDEO for \\"" + $json.scenarioName + "\\"\\n\\nSource: " + ($json.videoSource || "unknown") }}',
      },
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [
                {
                  text: '✅ Approve',
                  additionalFields: {
                    callback_data: "={{ 'vpApprove_' + $('Create Video Run').first().json.id + '_outro_vid' }}",
                  },
                },
                {
                  text: '🔄 Redo',
                  additionalFields: {
                    callback_data: "={{ 'vpRedo_' + $('Create Video Run').first().json.id + '_outro_vid' }}",
                  },
                },
              ],
            },
          },
        ],
      },
    },
    id: uuid(),
    name: 'Send Outro Video Preview',
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    position: [2380, -1280],
    credentials: telegramCreds,
  },
  {
    parameters: {
      jsCode: makePollCode('outro_vid_approval', 'outro_vid_approval'),
      mode: 'runOnceForAllItems',
    },
    id: uuid(),
    name: 'Poll Outro Video Approval',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2520, -1200],
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [
          {
            id: uuid(),
            leftValue: '={{ $json.body.action }}',
            rightValue: 'approve',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: uuid(),
    name: 'Outro Video Approved?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [2660, -1100],
  },
];

// Add new nodes to workflow
workflow.nodes.push(...newNodes);
console.log('Added ' + newNodes.length + ' new nodes');

// ═══════════════════════════════════════
// 2. SHIFT DOWNSTREAM NODES RIGHT (make room for outro video nodes)
// ═══════════════════════════════════════

// Nodes at x >= 2260 need to shift right by 800
const SHIFT_THRESHOLD = 2260;
const SHIFT_AMOUNT = 800;
const shiftedNodes = [];

for (const node of workflow.nodes) {
  if (newNodes.includes(node)) continue; // don't shift newly added nodes
  if (node.position && node.position[0] >= SHIFT_THRESHOLD) {
    node.position[0] += SHIFT_AMOUNT;
    shiftedNodes.push(node.name);
  }
}
console.log('Shifted ' + shiftedNodes.length + ' nodes right by ' + SHIFT_AMOUNT + ': ' + shiftedNodes.join(', '));

// ═══════════════════════════════════════
// 3. REWIRE CONNECTIONS
// ═══════════════════════════════════════

const conn = workflow.connections;

// Helper to set a connection
function setConn(fromNode, outputIndex, targets) {
  if (!conn[fromNode]) conn[fromNode] = { main: [] };
  while (conn[fromNode].main.length <= outputIndex) {
    conn[fromNode].main.push([]);
  }
  conn[fromNode].main[outputIndex] = targets.map(t => ({
    node: t,
    type: 'main',
    index: 0,
  }));
}

// ─── Hook video flow ───
// OLD: Hook Approved? (TRUE/0) → Find App Store Clips
// NEW: Hook Approved? (TRUE/0) → Img2Vid Hook
//      Img2Vid Hook → Send Hook Video Preview → Poll Hook Video Approval → Hook Video Approved?
//      Hook Video Approved? (TRUE/0) → Find App Store Clips
//      Hook Video Approved? (FALSE/1) → Img2Vid Hook

setConn('Hook Approved?', 0, ['Img2Vid Hook']); // TRUE: go to video conversion
// Keep Hook Approved? FALSE (index 1) → Hook Prompt Agent (unchanged)

setConn('Img2Vid Hook', 0, ['Send Hook Video Preview']);
setConn('Send Hook Video Preview', 0, ['Poll Hook Video Approval']);
setConn('Poll Hook Video Approval', 0, ['Hook Video Approved?']);
setConn('Hook Video Approved?', 0, ['Find App Store Clips']); // TRUE: continue
setConn('Hook Video Approved?', 1, ['Img2Vid Hook']); // FALSE: redo video

// ─── Outro video flow ───
// OLD: Outro Approved? (TRUE/0) → Download Assets
// NEW: Outro Approved? (TRUE/0) → Img2Vid Outro
//      Img2Vid Outro → Send Outro Video Preview → Poll Outro Video Approval → Outro Video Approved?
//      Outro Video Approved? (TRUE/0) → Download Assets
//      Outro Video Approved? (FALSE/1) → Img2Vid Outro

setConn('Outro Approved?', 0, ['Img2Vid Outro']); // TRUE: go to video conversion
// Keep Outro Approved? FALSE (index 1) → Outro Prompt Agent (unchanged)

setConn('Img2Vid Outro', 0, ['Send Outro Video Preview']);
setConn('Send Outro Video Preview', 0, ['Poll Outro Video Approval']);
setConn('Poll Outro Video Approval', 0, ['Outro Video Approved?']);
setConn('Outro Video Approved?', 0, ['Download Assets']); // TRUE: continue
setConn('Outro Video Approved?', 1, ['Img2Vid Outro']); // FALSE: redo video

// ─── Also update: Hook/Outro Needs Approval FALSE path ───
// When approval not needed, skip the ENTIRE img2vid flow too
// Hook Needs Approval? FALSE (index 1) → Find App Store Clips (unchanged, already correct)
// Outro Needs Approval? FALSE (index 1) → Download Assets (unchanged, already correct)

console.log('Rewired connections for hook and outro video approval flows');

// ═══════════════════════════════════════
// 4. FIX EXISTING POLL NODES — add field reset before polling
// ═══════════════════════════════════════

// Update Poll Hook Approval to reset hook_approval before polling
for (const node of workflow.nodes) {
  if (node.name === 'Poll Hook Approval') {
    node.parameters.jsCode = makePollCode('hook_approval', 'hook_approval');
    console.log('Fixed Poll Hook Approval: added field reset');
  }
  if (node.name === 'Poll Outro Approval') {
    node.parameters.jsCode = makePollCode('outro_approval', 'outro_approval');
    console.log('Fixed Poll Outro Approval: added field reset');
  }
}

// ═══════════════════════════════════════
// 5. SAVE
// ═══════════════════════════════════════

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('Saved updated workflow to ' + workflowPath);
console.log('\nDone! Run embed-code.cjs next to inject img-to-video.js code into Img2Vid Hook and Img2Vid Outro nodes.');
