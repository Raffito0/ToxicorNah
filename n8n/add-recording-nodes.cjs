// Script: Add recording flow nodes to the Unified Pipeline workflow
// Run: node n8n/add-recording-nodes.cjs
// Then re-import workflow-video-pipeline.json into n8n

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'workflow-video-pipeline.json');
const codePath = path.join(__dirname, 'code');

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Helper: read code file
function readCode(filename) {
  return fs.readFileSync(path.join(codePath, filename), 'utf8');
}

// ═══════════════════════════════════════════════════════════════
// 1. UPDATE Parse Message code
// ═══════════════════════════════════════════════════════════════
const parseNode = workflow.nodes.find(n => n.name === 'Parse Message');
if (parseNode) {
  parseNode.parameters.jsCode = readCode('parse-video-message.js');
  console.log('Updated: Parse Message code');
}

// ═══════════════════════════════════════════════════════════════
// 2. ADD new Switch outputs to Route Message
// ═══════════════════════════════════════════════════════════════
const routeNode = workflow.nodes.find(n => n.name === 'Route Message');
if (routeNode) {
  const rules = routeNode.parameters.rules.values;

  // Check if already added
  const hasAutoClip = rules.some(r => r.outputKey === 'Auto Body Clip');
  if (!hasAutoClip) {
    rules.push({
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [{
          leftValue: '={{ $json.messageType }}',
          rightValue: 'auto_body_clip',
          operator: { type: 'string', operation: 'equals' }
        }],
        combinator: 'and'
      },
      renameOutput: true,
      outputKey: 'Auto Body Clip'
    });
    console.log('Added: Route Message → Auto Body Clip output');
  }

  const hasDone = rules.some(r => r.outputKey === 'Done Recording');
  if (!hasDone) {
    rules.push({
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [{
          leftValue: '={{ $json.messageType }}',
          rightValue: 'done_recording',
          operator: { type: 'string', operation: 'equals' }
        }],
        combinator: 'and'
      },
      renameOutput: true,
      outputKey: 'Done Recording'
    });
    console.log('Added: Route Message → Done Recording output');
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. ADD new nodes
// ═══════════════════════════════════════════════════════════════
const existingIds = new Set(workflow.nodes.map(n => n.id));

function addNodeIfMissing(node) {
  if (existingIds.has(node.id)) {
    console.log('Skipped (exists): ' + node.name);
    return;
  }
  workflow.nodes.push(node);
  existingIds.add(node.id);
  console.log('Added node: ' + node.name);
}

// --- A. Send Recording Instructions (Code) ---
addNodeIfMissing({
  parameters: {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: readCode('send-recording-instructions.js')
  },
  id: 'cb-rec-instructions',
  name: 'Send Recording Instructions',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [2300, -250]
});

// --- B. Send Recording Msg (Telegram) ---
addNodeIfMissing({
  parameters: {
    resource: 'message',
    operation: 'sendMessage',
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.message }}',
    additionalFields: {}
  },
  id: 'cb-rec-msg',
  name: 'Send Recording Msg',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [2550, -250],
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram Bot API account'
    }
  }
});

// --- C. Handle Auto Clip (Code) ---
addNodeIfMissing({
  parameters: {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: readCode('handle-auto-clip.js')
  },
  id: 'vp-handle-auto-clip',
  name: 'Handle Auto Clip',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [950, -50]
});

// --- D. Auto Clip OK? (IF) ---
addNodeIfMissing({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '' },
      conditions: [{
        id: 'auto-clip-error-check',
        leftValue: '={{ $json.error }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'equals' }
      }],
      combinator: 'and'
    }
  },
  id: 'vp-auto-clip-check',
  name: 'Auto Clip Error?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  position: [1200, -50]
});

// --- E. Send Auto Error (Telegram) ---
addNodeIfMissing({
  parameters: {
    resource: 'message',
    operation: 'sendMessage',
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.message }}',
    additionalFields: {}
  },
  id: 'vp-send-auto-error',
  name: 'Send Auto Error',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [1450, -150],
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram Bot API account'
    }
  }
});

// --- F. Save Auto Clip (Airtable Create) ---
addNodeIfMissing({
  parameters: {
    operation: 'create',
    base: { __rl: true, mode: 'id', value: 'appsgjIdkpak2kaXq' },
    table: { __rl: true, mode: 'id', value: 'tblJcmlW99FNxMNXk' },
    columns: {
      mappingMode: 'defineBelow',
      value: {
        clip_name: '={{ $json.clipName }}',
        scenario_id: '={{ [$json.scenarioRecordId] }}',
        clip_index: '={{ $json.clipIndex }}',
        clip_type: '={{ $json.clipType }}',
        clip_duration_sec: '={{ $json.duration }}',
        telegram_file_id: '={{ $json.fileId }}',
        section: '={{ $json.section }}',
        status: 'uploaded'
      },
      matchingColumns: []
    },
    options: {}
  },
  id: 'vp-save-auto-clip',
  name: 'Save Auto Clip',
  type: 'n8n-nodes-base.airtable',
  typeVersion: 2.1,
  position: [1450, 50],
  credentials: {
    airtableTokenApi: {
      id: 'GQSE5xy7UEjGQdD3',
      name: 'Airtable Personal Access Token account'
    }
  }
});

// --- G. Confirm Auto Clip (Telegram) ---
addNodeIfMissing({
  parameters: {
    resource: 'message',
    operation: 'sendMessage',
    chatId: '={{ $("Handle Auto Clip").first().json.chatId }}',
    text: '={{ $("Handle Auto Clip").first().json.confirmMessage }}',
    additionalFields: {}
  },
  id: 'vp-confirm-auto-clip',
  name: 'Confirm Auto Clip',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [1700, 50],
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram Bot API account'
    }
  }
});

// --- H. Handle Done (Code) ---
addNodeIfMissing({
  parameters: {
    mode: 'runOnceForAllItems',
    language: 'javaScript',
    jsCode: readCode('handle-done.js')
  },
  id: 'vp-handle-done',
  name: 'Handle Done',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [950, -350]
});

// --- I. Done Error? (IF) ---
addNodeIfMissing({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '' },
      conditions: [{
        id: 'done-error-check',
        leftValue: '={{ $json.error }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'equals' }
      }],
      combinator: 'and'
    }
  },
  id: 'vp-done-check',
  name: 'Done Error?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  position: [1200, -350]
});

// --- J. Send Done Error (Telegram) ---
addNodeIfMissing({
  parameters: {
    resource: 'message',
    operation: 'sendMessage',
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.message }}',
    additionalFields: {}
  },
  id: 'vp-send-done-error',
  name: 'Send Done Error',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [1450, -450],
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram Bot API account'
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. UPDATE connections
// ═══════════════════════════════════════════════════════════════
const conn = workflow.connections;

// --- A. Save to Supabase → also connect to Send Recording Instructions ---
if (conn['Save to Supabase']) {
  const existing = conn['Save to Supabase'].main[0];
  const hasRecInstr = existing.some(c => c.node === 'Send Recording Instructions');
  if (!hasRecInstr) {
    existing.push({ node: 'Send Recording Instructions', type: 'main', index: 0 });
    console.log('Connected: Save to Supabase → Send Recording Instructions');
  }
}

// --- B. Send Recording Instructions → Send Recording Msg ---
conn['Send Recording Instructions'] = {
  main: [[{ node: 'Send Recording Msg', type: 'main', index: 0 }]]
};
console.log('Connected: Send Recording Instructions → Send Recording Msg');

// --- C. Route Message — add Auto Body Clip and Done Recording outputs ---
if (conn['Route Message']) {
  const mainOutputs = conn['Route Message'].main;

  // Current: [0:Body, 1:Hook, 2:Outro, 3:Produce, 4:fallback(Ignore)]
  // Target:  [0:Body, 1:Hook, 2:Outro, 3:Produce, 4:AutoClip, 5:Done, 6:fallback(Ignore)]

  // Only modify if we have exactly 5 outputs (original state)
  if (mainOutputs.length === 5) {
    // Remove fallback (last entry)
    const fallback = mainOutputs.pop();

    // Add Auto Body Clip (output 4)
    mainOutputs.push([{ node: 'Handle Auto Clip', type: 'main', index: 0 }]);

    // Add Done Recording (output 5)
    mainOutputs.push([{ node: 'Handle Done', type: 'main', index: 0 }]);

    // Re-add fallback (output 6)
    mainOutputs.push(fallback);

    console.log('Updated: Route Message outputs (added Auto Body Clip + Done Recording)');
  } else {
    console.log('Route Message already has ' + mainOutputs.length + ' outputs — skipping');
  }
}

// --- D. Handle Auto Clip → Auto Clip Error? ---
conn['Handle Auto Clip'] = {
  main: [[{ node: 'Auto Clip Error?', type: 'main', index: 0 }]]
};

// --- E. Auto Clip Error? → [error: Send Auto Error, ok: Save Auto Clip] ---
conn['Auto Clip Error?'] = {
  main: [
    [{ node: 'Send Auto Error', type: 'main', index: 0 }],
    [{ node: 'Save Auto Clip', type: 'main', index: 0 }]
  ]
};

// --- F. Save Auto Clip → Confirm Auto Clip ---
conn['Save Auto Clip'] = {
  main: [[{ node: 'Confirm Auto Clip', type: 'main', index: 0 }]]
};

console.log('Connected: Auto Body Clip flow');

// --- G. Handle Done → Done Error? ---
conn['Handle Done'] = {
  main: [[{ node: 'Done Error?', type: 'main', index: 0 }]]
};

// --- H. Done Error? → [error: Send Done Error, ok: Ack Produce (existing production pipeline)] ---
conn['Done Error?'] = {
  main: [
    [{ node: 'Send Done Error', type: 'main', index: 0 }],
    [{ node: 'Ack Produce', type: 'main', index: 0 }]
  ]
};

console.log('Connected: Done Recording flow (feeds into existing production pipeline)');

// ═══════════════════════════════════════════════════════════════
// 5. Also update all existing code nodes with latest code
// ═══════════════════════════════════════════════════════════════
const codeMap = {
  'save-to-supabase.js': 'Save to Supabase',
  'generate-hook.js': 'Generate Hook',
  'generate-voiceover.js': 'Generate VO',
  'generate-outro.js': 'Generate Outro',
  'download-assets.js': 'Download Assets',
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
// SAVE
// ═══════════════════════════════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Workflow saved. Re-import workflow-video-pipeline.json into n8n.');
