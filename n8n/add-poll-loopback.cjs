// Replaces infinite-loop polling with loop-back polling architecture.
// Each Poll node runs for 4 minutes (within 300s Code node timeout),
// then returns 'timeout'. A new "Is Timeout?" If node loops back to
// the same Poll node for another cycle. This allows unlimited wait
// time without hitting N8N_RUNNERS_TASK_TIMEOUT.
//
// Before:  Send Preview → Poll (infinite loop) → Approved?
// After:   Send Preview → Poll (4 min) → Is Timeout? → YES: back to Poll
//                                                     → NO:  Approved?
//
// Run: node add-poll-loopback.cjs

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const uuid = () => crypto.randomUUID();

// ═══════════════════════════════════════
// Poll Code template — polls for 4 min, returns timeout instead of throwing
// ═══════════════════════════════════════
function makePollCode(field) {
  return `// Poll Airtable for ${field} — 4-minute cycle with loop-back on timeout
// Architecture: polls for 4 min → returns timeout → workflow loops back → another 4 min
// This avoids the 300s Code node timeout while allowing unlimited wait time.

const _https = require('https');
const { URL } = require('url');

function airtableFetch(recordPath) {
  return new Promise((resolve, reject) => {
    const AIRTABLE_TOKEN = (typeof $env !== 'undefined' && $env.AIRTABLE_API_KEY) || '';
    const u = new URL('https://api.airtable.com/v0/appsgjIdkpak2kaXq/tbltCYcVXrLYvyIJL/' + recordPath);
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
const MAX_POLLS = 24; // 24 × 10s = 4 minutes (safely under 300s timeout)

// ─── Immediate check: catches approvals that arrived during loop-back gap ───
try {
  const record = await airtableFetch(recordId);
  const initialStatus = record.fields?.['${field}'];
  if (initialStatus === 'approved') {
    return [{ json: { body: { action: 'approve' } } }];
  }
  if (initialStatus === 'redo') {
    // Reset so the redo doesn't fire again after the redo loop comes back
    try { await airtablePatch(recordId, { '${field}': '' }); } catch(e) {}
    return [{ json: { body: { action: 'redo' } } }];
  }
} catch(e) { /* non-fatal — proceed to polling */ }

// ─── Poll for up to 4 minutes ───
for (let i = 0; i < MAX_POLLS; i++) {
  await new Promise(r => setTimeout(r, POLL_INTERVAL));
  try {
    const record = await airtableFetch(recordId);
    const status = record.fields?.['${field}'];
    if (status === 'approved') {
      return [{ json: { body: { action: 'approve' } } }];
    }
    if (status === 'redo') {
      try { await airtablePatch(recordId, { '${field}': '' }); } catch(e) {}
      return [{ json: { body: { action: 'redo' } } }];
    }
    // status is 'pending' or empty — keep polling
  } catch (err) {
    // Network error — keep polling
  }
}

// ─── Timeout: workflow loops back for another 4-minute cycle ───
return [{ json: { body: { action: 'timeout' } } }];
`;
}

// ═══════════════════════════════════════
// "Is Timeout?" If node template
// ═══════════════════════════════════════
function makeTimeoutIfNode(name, position) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [
          {
            id: uuid(),
            leftValue: '={{ $json.body.action }}',
            rightValue: 'timeout',
            operator: { type: 'string', operation: 'equals' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id: uuid(),
    name: name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: position,
  };
}

// ═══════════════════════════════════════
// Steps to process
// ═══════════════════════════════════════
const steps = [
  {
    pollName: 'Poll Hook Approval',
    approvedName: 'Hook Approved?',
    timeoutName: 'Is Hook Poll Timeout?',
    field: 'hook_approval',
  },
  {
    pollName: 'Poll Hook Video Approval',
    approvedName: 'Hook Video Approved?',
    timeoutName: 'Is Hook Vid Poll Timeout?',
    field: 'hook_vid_approval',
  },
  {
    pollName: 'Poll VO Approval',
    approvedName: 'VO Approved?',
    timeoutName: 'Is VO Poll Timeout?',
    field: 'vo_approval',
  },
  {
    pollName: 'Poll Outro Approval',
    approvedName: 'Outro Approved?',
    timeoutName: 'Is Outro Poll Timeout?',
    field: 'outro_approval',
  },
  {
    pollName: 'Poll Outro Video Approval',
    approvedName: 'Outro Video Approved?',
    timeoutName: 'Is Outro Vid Poll Timeout?',
    field: 'outro_vid_approval',
  },
];

const conn = (node, index = 0) => ({ node, type: 'main', index });

for (const step of steps) {
  // 1. Find poll node and update its code
  const pollNode = workflow.nodes.find(n => n.name === step.pollName);
  if (!pollNode) {
    console.error('NOT FOUND: ' + step.pollName);
    continue;
  }
  pollNode.parameters.jsCode = makePollCode(step.field);
  console.log('Updated: ' + step.pollName + ' (4-min loop-back polling)');

  // 2. Find approved node (for positioning)
  const approvedNode = workflow.nodes.find(n => n.name === step.approvedName);
  if (!approvedNode) {
    console.error('NOT FOUND: ' + step.approvedName);
    continue;
  }

  // 3. Position the timeout If node between poll and approved
  const pollPos = pollNode.position;
  const approvedPos = approvedNode.position;
  const timeoutPos = [
    Math.round((pollPos[0] + approvedPos[0]) / 2),
    pollPos[1], // same Y as poll node
  ];

  // 4. Create and add timeout If node
  const timeoutNode = makeTimeoutIfNode(step.timeoutName, timeoutPos);
  workflow.nodes.push(timeoutNode);
  console.log('Added: ' + step.timeoutName + ' at [' + timeoutPos + ']');

  // 5. Rewire connections
  // Old: Poll → Approved?
  // New: Poll → Is Timeout? → YES(0): back to Poll, NO(1): Approved?

  // Poll → Is Timeout?
  workflow.connections[step.pollName] = {
    main: [[conn(step.timeoutName)]],
  };

  // Is Timeout? → YES(0): back to Poll, NO(1): Approved?
  workflow.connections[step.timeoutName] = {
    main: [
      [conn(step.pollName)],     // TRUE (timeout) → loop back to poll
      [conn(step.approvedName)], // FALSE (approve/redo) → existing Approved?
    ],
  };

  console.log('Rewired: ' + step.pollName + ' → ' + step.timeoutName + ' → YES: loop back / NO: ' + step.approvedName);
}

// ═══════════════════════════════════════
// WRITE
// ═══════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\n✅ Done! Added loop-back polling to all 5 approval steps.');
console.log('Total nodes: ' + workflow.nodes.length);
console.log('\nNew flow for each step:');
console.log('  Send Preview → Poll (4 min) → Is Timeout?');
console.log('                                   YES → back to Poll (another 4 min cycle)');
console.log('                                   NO  → Approved? (approve/redo routing)');
console.log('\nNo more infinite loops in Code nodes. Unlimited wait time via loop-back.');
