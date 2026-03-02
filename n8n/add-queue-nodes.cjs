// Script: Add queue-next-scenario flow to /done path
// Changes: /done no longer triggers production
// Instead: /done → update status → find next approved → queue next → telegram
// Run: node n8n/add-queue-nodes.cjs
// Then re-import workflow-video-pipeline.json into n8n

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'workflow-video-pipeline.json');
const codePath = path.join(__dirname, 'code');

function readCode(filename) {
  return fs.readFileSync(path.join(codePath, filename), 'utf8');
}

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const existingIds = new Set(workflow.nodes.map(n => n.id));

function addNodeIfMissing(node) {
  if (existingIds.has(node.id)) {
    // Update existing node
    const idx = workflow.nodes.findIndex(n => n.id === node.id);
    if (idx !== -1) workflow.nodes[idx] = node;
    console.log('Updated node: ' + node.name);
    return;
  }
  workflow.nodes.push(node);
  existingIds.add(node.id);
  console.log('Added node: ' + node.name);
}

// ═══════════════════════════════════════════════════════════════
// 1. Update Handle Done code
// ═══════════════════════════════════════════════════════════════
const handleDoneNode = workflow.nodes.find(n => n.name === 'Handle Done');
if (handleDoneNode) {
  handleDoneNode.parameters.jsCode = readCode('handle-done.js');
  console.log('Updated: Handle Done code');
}

// ═══════════════════════════════════════════════════════════════
// 2. Add new nodes for the /done → queue flow
// ═══════════════════════════════════════════════════════════════

// --- A. Update Scenario Recorded (Airtable Update) ---
addNodeIfMissing({
  parameters: {
    operation: 'update',
    base: { __rl: true, mode: 'id', value: 'appsgjIdkpak2kaXq' },
    table: { __rl: true, mode: 'id', value: 'tblcQaMBBPcOAy0NF' },
    columns: {
      mappingMode: 'defineBelow',
      value: {
        id: '={{ $json.scenarioRecordId }}',
        status: 'ready'
      },
      matchingColumns: ['id']
    },
    options: {}
  },
  id: 'vp-update-recorded',
  name: 'Update Scenario Recorded',
  type: 'n8n-nodes-base.airtable',
  typeVersion: 2.1,
  position: [1450, -250],
  credentials: {
    airtableTokenApi: {
      id: 'GQSE5xy7UEjGQdD3',
      name: 'Airtable Personal Access Token account'
    }
  }
});

// --- B. Find Next Approved (Airtable Search) ---
addNodeIfMissing({
  parameters: {
    operation: 'search',
    base: { __rl: true, mode: 'id', value: 'appsgjIdkpak2kaXq' },
    table: { __rl: true, mode: 'id', value: 'tblcQaMBBPcOAy0NF' },
    filterByFormula: '={status} = "approved"',
    sort: {
      property: [
        { field: 'created_at', direction: 'asc' }
      ]
    },
    limit: 1,
    options: {}
  },
  id: 'vp-find-next-approved',
  name: 'Find Next Approved',
  type: 'n8n-nodes-base.airtable',
  typeVersion: 2.1,
  position: [1700, -250],
  credentials: {
    airtableTokenApi: {
      id: 'GQSE5xy7UEjGQdD3',
      name: 'Airtable Personal Access Token account'
    }
  }
});

// --- C. Queue Next Scenario (Code) ---
addNodeIfMissing({
  parameters: {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: readCode('queue-next-scenario.js')
  },
  id: 'vp-queue-next',
  name: 'Queue Next Scenario',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1950, -250]
});

// --- D. Send Queue Msg (Telegram — sends next scenario instructions OR "all done") ---
addNodeIfMissing({
  parameters: {
    resource: 'message',
    operation: 'sendMessage',
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.message }}',
    additionalFields: {}
  },
  id: 'vp-send-queue-msg',
  name: 'Send Queue Msg',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [2200, -250],
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram Bot API account'
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 3. Update connections: /done → recording queue (NOT production)
// ═══════════════════════════════════════════════════════════════
const conn = workflow.connections;

// Change "Done Error?" else branch: Ack Produce → Update Scenario Recorded
if (conn['Done Error?']) {
  const elseOutput = conn['Done Error?'].main[1]; // index 1 = condition NOT met (no error)
  if (elseOutput && elseOutput.length > 0) {
    // Replace Ack Produce with Update Scenario Recorded
    elseOutput[0] = { node: 'Update Scenario Recorded', type: 'main', index: 0 };
    console.log('Rewired: Done Error? (else) → Update Scenario Recorded (was: Ack Produce)');
  }
}

// Update Scenario Recorded → Find Next Approved
conn['Update Scenario Recorded'] = {
  main: [[{ node: 'Find Next Approved', type: 'main', index: 0 }]]
};

// Find Next Approved → Queue Next Scenario
conn['Find Next Approved'] = {
  main: [[{ node: 'Queue Next Scenario', type: 'main', index: 0 }]]
};

// Queue Next Scenario → Send Queue Msg
conn['Queue Next Scenario'] = {
  main: [[{ node: 'Send Queue Msg', type: 'main', index: 0 }]]
};

console.log('Connected: /done queue flow (Update Recorded → Find Next → Queue Next → Send Msg)');

// ═══════════════════════════════════════════════════════════════
// 4. Update embed-code map
// ═══════════════════════════════════════════════════════════════

// Also update Parse Message code
const parseNode = workflow.nodes.find(n => n.name === 'Parse Message');
if (parseNode) {
  parseNode.parameters.jsCode = readCode('parse-video-message.js');
  console.log('Updated: Parse Message code');
}

// ═══════════════════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Re-import workflow-video-pipeline.json into n8n.');
