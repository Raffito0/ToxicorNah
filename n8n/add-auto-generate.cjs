// Script: Add auto-generate after /done when no more approved scenarios
// After Queue Next Scenario, if hasNext=false → Execute Workflow 1 (Scenario Generator)
// Run: node n8n/add-auto-generate.cjs
// Then re-import workflow-video-pipeline.json into n8n

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'workflow-video-pipeline.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const existingIds = new Set(workflow.nodes.map(n => n.id));

const SCENARIO_GENERATOR_ID = 'cNliMecIH6Yg1tGj';

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
// 1. Add IF node: Has Next Scenario?
// ═══════════════════════════════════════════════════════════════
addOrUpdateNode({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '' },
      conditions: [{
        id: 'has-next-check',
        leftValue: '={{ $json.hasNext }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'equals' }
      }],
      combinator: 'and'
    }
  },
  id: 'vp-has-next',
  name: 'Has Next Scenario?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  position: [2200, -250]
});

// ═══════════════════════════════════════════════════════════════
// 2. Add Execute Workflow node: Generate Next Scenario
// ═══════════════════════════════════════════════════════════════
addOrUpdateNode({
  parameters: {
    mode: 'each',
    workflowId: {
      __rl: true,
      mode: 'id',
      value: SCENARIO_GENERATOR_ID
    },
    options: {
      waitForSubWorkflow: false
    }
  },
  id: 'vp-generate-next',
  name: 'Generate Next Scenario',
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1.2,
  position: [2450, -150]
});

// ═══════════════════════════════════════════════════════════════
// 3. Add Telegram Send: "Generating..." message
// ═══════════════════════════════════════════════════════════════
addOrUpdateNode({
  parameters: {
    resource: 'message',
    operation: 'sendMessage',
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.message + "\\n\\n⏳ Generando nuovo scenario..." }}',
    additionalFields: {}
  },
  id: 'vp-send-generating',
  name: 'Send Generating Msg',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [2450, -350],
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram Bot API account'
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. Rewire connections
// ═══════════════════════════════════════════════════════════════
const conn = workflow.connections;

// Queue Next Scenario → Has Next Scenario? (was: Send Queue Msg)
conn['Queue Next Scenario'] = {
  main: [[{ node: 'Has Next Scenario?', type: 'main', index: 0 }]]
};

// Has Next Scenario? → [true: Send Queue Msg] [false: Send Generating Msg]
conn['Has Next Scenario?'] = {
  main: [
    [{ node: 'Send Queue Msg', type: 'main', index: 0 }],
    [{ node: 'Send Generating Msg', type: 'main', index: 0 }]
  ]
};

// Send Generating Msg → Generate Next Scenario
conn['Send Generating Msg'] = {
  main: [[{ node: 'Generate Next Scenario', type: 'main', index: 0 }]]
};

console.log('Wired: Queue Next → Has Next? → [yes: Send Queue Msg] / [no: Send Generating Msg → Execute Workflow 1]');

// ═══════════════════════════════════════════════════════════════
// SAVE
// ═══════════════════════════════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Re-import workflow-video-pipeline.json into n8n.');
