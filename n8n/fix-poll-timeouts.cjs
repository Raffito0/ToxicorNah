// Fix all Poll nodes: remove 4-minute timeout, poll indefinitely until approve/redo
// Polls every 30s instead of 10s (user may be away for hours)

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Map poll node names to their Airtable field names
const pollNodes = {
  'Poll Hook Approval': 'hook_approval',
  'Poll Outro Approval': 'outro_approval',
  'Poll VO Approval': 'vo_approval',
  'Poll Hook Video Approval': 'hook_vid_approval',
  'Poll Outro Video Approval': 'outro_vid_approval',
};

function makePollCode(fieldName) {
  return `// Poll Airtable for ${fieldName} — waits indefinitely until approve/redo
// Resets field to empty first to prevent stale values
// Polls every 30s to minimize API calls while user is away

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
const POLL_INTERVAL = 30000; // 30 seconds

// Reset field to prevent stale 'redo' from causing immediate return
try {
  await airtablePatch(recordId, { '${fieldName}': '' });
} catch(e) { /* non-fatal */ }

// Poll indefinitely — no timeout
while (true) {
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
`;
}

let updated = 0;
for (const node of workflow.nodes) {
  const fieldName = pollNodes[node.name];
  if (fieldName) {
    node.parameters.jsCode = makePollCode(fieldName);
    console.log('Updated: ' + node.name + ' → polls ' + fieldName + ' indefinitely (30s interval)');
    updated++;
  }
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone. Updated ' + updated + ' poll nodes.');
