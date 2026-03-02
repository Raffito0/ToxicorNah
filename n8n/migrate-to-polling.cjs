// Migrate from Wait (webhook) approval to Airtable polling approval
// Removes: Wait Hook/VO/Outro Approval, Resume VP Execution
// Adds: Poll Hook/VO/Outro Approval (Code nodes that poll Airtable)
// Updates: Send Hook/VO/Outro Preview callback_data to use Airtable record ID
// Run: node migrate-to-polling.cjs

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const uuid = () => crypto.randomUUID();

// ═══════════════════════════════════════
// 1. REMOVE old webhook Wait nodes + Resume VP Execution
// ═══════════════════════════════════════
const removeNodes = [
  'Wait Hook Approval',
  'Wait VO Approval',
  'Wait Outro Approval',
  'Resume VP Execution',
];
workflow.nodes = workflow.nodes.filter(n => !removeNodes.includes(n.name));
for (const name of removeNodes) {
  delete workflow.connections[name];
}
console.log('Removed:', removeNodes.join(', '));

// ═══════════════════════════════════════
// 2. ADD polling Code nodes (one per approval step)
// ═══════════════════════════════════════

// Polling Code node template — polls Airtable field every 10s
function makePollNode(name, approvalField, position) {
  return {
    parameters: {
      jsCode: `// Poll Airtable for ${approvalField} status every 10 seconds
// Replaces Wait (webhook) node — webhook-waiting doesn't work in n8n v1.122.5

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

const recordId = $json.videoRunRecordId || $('Create Video Run').first().json.id;
const POLL_INTERVAL = 10000; // 10 seconds
const MAX_POLLS = 24; // 4 minutes max (below 300s sandbox timeout)

for (let i = 0; i < MAX_POLLS; i++) {
  await new Promise(r => setTimeout(r, POLL_INTERVAL));
  try {
    const record = await airtableFetch(recordId);
    const status = record.fields?.${approvalField};
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

// Timeout after 5 minutes
throw new Error('${approvalField} timed out after 4 minutes');
`,
      mode: 'runOnceForAllItems',
    },
    id: uuid(),
    name: name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: position,
  };
}

const pollHookNode = makePollNode('Poll Hook Approval', 'hook_approval', [-40, -1200]);
const pollVoNode = makePollNode('Poll VO Approval', 'vo_approval', [840, -1200]);
const pollOutroNode = makePollNode('Poll Outro Approval', 'outro_approval', [1940, -1200]);

workflow.nodes.push(pollHookNode, pollVoNode, pollOutroNode);
console.log('Added: Poll Hook Approval, Poll VO Approval, Poll Outro Approval');

// ═══════════════════════════════════════
// 3. UPDATE Send Preview callback_data to use Airtable record ID
// ═══════════════════════════════════════
for (const node of workflow.nodes) {
  if (node.name === 'Send Hook Preview') {
    // Change $execution.id to Create Video Run record ID
    const rows = node.parameters.inlineKeyboard?.rows;
    if (rows) {
      for (const row of rows) {
        for (const btn of row.row.buttons) {
          if (btn.additionalFields?.callback_data) {
            btn.additionalFields.callback_data = btn.additionalFields.callback_data
              .replace('$execution.id', "$('Create Video Run').first().json.id");
          }
        }
      }
    }
    console.log('Updated: Send Hook Preview callback_data → Airtable record ID');
  }
  if (node.name === 'Send VO Preview') {
    const rows = node.parameters.inlineKeyboard?.rows;
    if (rows) {
      for (const row of rows) {
        for (const btn of row.row.buttons) {
          if (btn.additionalFields?.callback_data) {
            btn.additionalFields.callback_data = btn.additionalFields.callback_data
              .replace('$execution.id', "$('Create Video Run').first().json.id");
          }
        }
      }
    }
    console.log('Updated: Send VO Preview callback_data → Airtable record ID');
  }
  if (node.name === 'Send Outro Preview') {
    const rows = node.parameters.inlineKeyboard?.rows;
    if (rows) {
      for (const row of rows) {
        for (const btn of row.row.buttons) {
          if (btn.additionalFields?.callback_data) {
            btn.additionalFields.callback_data = btn.additionalFields.callback_data
              .replace('$execution.id', "$('Create Video Run').first().json.id");
          }
        }
      }
    }
    console.log('Updated: Send Outro Preview callback_data → Airtable record ID');
  }
}

// ═══════════════════════════════════════
// 4. REWIRE connections
// ═══════════════════════════════════════
const conn = (node, index = 0) => ({ node, type: 'main', index });

// Send Hook Preview → Poll Hook Approval → Hook Approved?
workflow.connections['Send Hook Preview'] = {
  main: [[conn('Poll Hook Approval')]],
};
workflow.connections['Poll Hook Approval'] = {
  main: [[conn('Hook Approved?')]],
};

// Send VO Preview → Poll VO Approval → VO Approved?
workflow.connections['Send VO Preview'] = {
  main: [[conn('Poll VO Approval')]],
};
workflow.connections['Poll VO Approval'] = {
  main: [[conn('VO Approved?')]],
};

// Send Outro Preview → Poll Outro Approval → Outro Approved?
workflow.connections['Send Outro Preview'] = {
  main: [[conn('Poll Outro Approval')]],
};
workflow.connections['Poll Outro Approval'] = {
  main: [[conn('Outro Approved?')]],
};

// Is Scenario Callback? → false → nothing (VP is handled via Airtable, no more HTTP resume)
const scConn = workflow.connections['Is Scenario Callback?'];
if (scConn) {
  scConn.main[1] = []; // false branch → empty (VP approval goes through Airtable polling)
}
console.log('Rewired: Send Preview → Poll Approval → Approved? (for all 3 steps)');
console.log('Rewired: Is Scenario Callback? false → empty (no more HTTP resume)');

// ═══════════════════════════════════════
// 5. Also set hook_approval to 'pending' in Create Video Run
// ═══════════════════════════════════════
const cvrNode = workflow.nodes.find(n => n.name === 'Create Video Run');
if (cvrNode && cvrNode.parameters.columns?.value) {
  cvrNode.parameters.columns.value.hook_approval = 'pending';
  cvrNode.parameters.columns.value.vo_approval = 'pending';
  cvrNode.parameters.columns.value.outro_approval = 'pending';
  console.log('Updated: Create Video Run → sets all approval fields to "pending"');
}

// ═══════════════════════════════════════
// WRITE
// ═══════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Migrated to Airtable polling approval.');
console.log('Total nodes: ' + workflow.nodes.length);
console.log('\nNew flow:');
console.log('  Send Hook Preview → Poll Hook Approval (10s polling) → Hook Approved?');
console.log('  Send VO Preview → Poll VO Approval (10s polling) → VO Approved?');
console.log('  Send Outro Preview → Poll Outro Approval (10s polling) → Outro Approved?');
console.log('\nCallback handler updates Airtable fields instead of webhook-waiting.');
console.log('\nIMPORTANT: Add AIRTABLE_API_KEY env var to n8n Docker if not already set.');
