// Script: Wire the production pipeline flow
// Adds: Load Production Data, Find Produce Scenario, Find Produce Clips, Prepare Production, Send Final Video
// Wires: Route Message (Produce) → Load → Find Scenario → Find Clips → Prepare → Hook → VO → Outro → Download → Assemble → Send Final
// Run: node n8n/add-production-nodes.cjs
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

function addOrUpdateNode(node) {
  if (existingIds.has(node.id)) {
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
// 1. Add new nodes
// ═══════════════════════════════════════════════════════════════

// --- A. Load Production Data (Code) ---
addOrUpdateNode({
  parameters: {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: readCode('load-production-data.js')
  },
  id: 'vp-load-prod',
  name: 'Load Production Data',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [950, -650]
});

// --- B. Find Produce Scenario (Airtable Search) ---
addOrUpdateNode({
  parameters: {
    operation: 'search',
    base: { __rl: true, mode: 'id', value: 'appsgjIdkpak2kaXq' },
    table: { __rl: true, mode: 'id', value: 'tblcQaMBBPcOAy0NF' },
    filterByFormula: '={{ $json.scenarioFilter }}',
    sort: {
      property: [
        { field: 'created_at', direction: 'asc' }
      ]
    },
    limit: 1,
    options: {}
  },
  id: 'vp-find-produce-scenario',
  name: 'Find Produce Scenario',
  type: 'n8n-nodes-base.airtable',
  typeVersion: 2.1,
  position: [1200, -650],
  credentials: {
    airtableTokenApi: {
      id: 'GQSE5xy7UEjGQdD3',
      name: 'Airtable Personal Access Token account'
    }
  }
});

// --- C. Find Produce Clips (Airtable Search — body clips linked to scenario) ---
addOrUpdateNode({
  parameters: {
    operation: 'search',
    base: { __rl: true, mode: 'id', value: 'appsgjIdkpak2kaXq' },
    table: { __rl: true, mode: 'id', value: 'tblJcmlW99FNxMNXk' },
    filterByFormula: '={{ \'FIND("\' + $json.scenario_name + \'", {clip_name})\' }}',
    options: {}
  },
  id: 'vp-find-produce-clips',
  name: 'Find Produce Clips',
  type: 'n8n-nodes-base.airtable',
  typeVersion: 2.1,
  position: [1450, -650],
  credentials: {
    airtableTokenApi: {
      id: 'GQSE5xy7UEjGQdD3',
      name: 'Airtable Personal Access Token account'
    }
  }
});

// --- D. Prepare Production (Code) ---
addOrUpdateNode({
  parameters: {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: readCode('prepare-production.js')
  },
  id: 'vp-prepare-prod',
  name: 'Prepare Production',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1700, -650]
});

// --- E. Send Produce Error (Telegram) ---
addOrUpdateNode({
  parameters: {
    resource: 'message',
    operation: 'sendMessage',
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.message }}',
    additionalFields: {}
  },
  id: 'vp-send-produce-error',
  name: 'Send Produce Error',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [2200, -750],
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram Bot API account'
    }
  }
});

// --- F. Send Final Video (Telegram — sends the assembled video for approval) ---
addOrUpdateNode({
  parameters: {
    resource: 'message',
    operation: 'sendVideo',
    chatId: '={{ $json.chatId }}',
    binaryPropertyName: 'video',
    additionalFields: {
      caption: '={{ "🎬 Video pronto: " + $json.scenarioName + "\\nDimensione: " + $json.fileSizeMB + " MB" + ($json.warnings ? "\\n\\n⚠️ " + $json.warnings.join("\\n⚠️ ") : "") }}'
    }
  },
  id: 'vp-send-final',
  name: 'Send Final Video',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [3700, -650],
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram Bot API account'
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. Update existing code nodes with latest code
// ═══════════════════════════════════════════════════════════════

const codeMap = {
  'parse-video-message.js': 'Parse Message',
  'load-production-data.js': 'Load Production Data',
  'prepare-production.js': 'Prepare Production',
  'generate-hook.js': 'Generate Hook',
  'generate-voiceover.js': 'Generate VO',
  'generate-outro.js': 'Generate Outro',
  'download-assets.js': 'Download Assets',
  'assemble-video.js': 'Assemble Video',
  'handle-auto-clip.js': 'Handle Auto Clip',
  'handle-done.js': 'Handle Done',
  'queue-next-scenario.js': 'Queue Next Scenario',
  'save-to-supabase.js': 'Save to Supabase',
  'send-recording-instructions.js': 'Send Recording Instructions',
};

for (const node of workflow.nodes) {
  if (node.type !== 'n8n-nodes-base.code') continue;
  for (const [file, nodeName] of Object.entries(codeMap)) {
    if (node.name === nodeName) {
      const filePath = path.join(codePath, file);
      if (fs.existsSync(filePath)) {
        node.parameters.jsCode = readCode(file);
        console.log('Updated code: ' + nodeName);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. Wire the production flow
// ═══════════════════════════════════════════════════════════════
const conn = workflow.connections;

// Route Message output 3 (Produce) → Load Production Data (replace Ack Produce)
if (conn['Route Message']) {
  const mainOutputs = conn['Route Message'].main;
  if (mainOutputs[3]) {
    mainOutputs[3] = [{ node: 'Load Production Data', type: 'main', index: 0 }];
    console.log('Rewired: Route Message (Produce) → Load Production Data');
  }
}

// Load Production Data → Find Produce Scenario
conn['Load Production Data'] = {
  main: [[{ node: 'Find Produce Scenario', type: 'main', index: 0 }]]
};

// Find Produce Scenario → Find Produce Clips
conn['Find Produce Scenario'] = {
  main: [[{ node: 'Find Produce Clips', type: 'main', index: 0 }]]
};

// Find Produce Clips → Prepare Production
conn['Find Produce Clips'] = {
  main: [[{ node: 'Prepare Production', type: 'main', index: 0 }]]
};

// Prepare Production → Produce Error? (existing IF node)
conn['Prepare Production'] = {
  main: [[{ node: 'Produce Error?', type: 'main', index: 0 }]]
};

// Produce Error? → [true: Send Produce Error, false: Generate Hook]
conn['Produce Error?'] = {
  main: [
    [{ node: 'Send Produce Error', type: 'main', index: 0 }],
    [{ node: 'Generate Hook', type: 'main', index: 0 }]
  ]
};

// Generate Hook → Generate VO
conn['Generate Hook'] = {
  main: [[{ node: 'Generate VO', type: 'main', index: 0 }]]
};

// Generate VO → Generate Outro
conn['Generate VO'] = {
  main: [[{ node: 'Generate Outro', type: 'main', index: 0 }]]
};

// Generate Outro → Download Assets
conn['Generate Outro'] = {
  main: [[{ node: 'Download Assets', type: 'main', index: 0 }]]
};

// Download Assets → Assemble Video
conn['Download Assets'] = {
  main: [[{ node: 'Assemble Video', type: 'main', index: 0 }]]
};

// Assemble Video → Send Final Video
conn['Assemble Video'] = {
  main: [[{ node: 'Send Final Video', type: 'main', index: 0 }]]
};

console.log('\nConnected: /produce → Load → Find Scenario → Find Clips → Prepare → Error? → Hook → VO → Outro → Download → Assemble → Send Final');

// ═══════════════════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Re-import workflow-video-pipeline.json into n8n.');
