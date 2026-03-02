// Add approval flow nodes (IF → Wait → IF) for Hook, VO, Outro
// Run: node add-approval-nodes.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const uuid = () => crypto.randomUUID();

// Telegram credential (copied from existing nodes)
const telegramCred = {
  telegramApi: { id: 'pyWK5SqqdZeXs1WU', name: 'Telegram account' }
};

// ═══════════════════════════════════════
// 1. Define new nodes
// ═══════════════════════════════════════

const newNodes = [
  // --- HOOK APPROVAL ---
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [{
          id: uuid(),
          leftValue: '={{ $json.hookReady }}',
          rightValue: false,
          operator: { type: 'boolean', operation: 'false' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: uuid(),
    name: 'Hook Needs Approval?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [-440, -1000]
  },
  {
    parameters: {
      resume: 'webhook',
      options: {}
    },
    id: uuid(),
    name: 'Wait Hook Approval',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [-220, -1100]
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [{
          id: uuid(),
          leftValue: '={{ $json.body.action }}',
          rightValue: 'approve',
          operator: { type: 'string', operation: 'equals' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: uuid(),
    name: 'Hook Approved?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [0, -1100]
  },

  // --- VO APPROVAL ---
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [{
          id: uuid(),
          leftValue: '={{ $json.voSkipped }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'false' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: uuid(),
    name: 'VO Needs Approval?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [220, -1000]
  },
  {
    parameters: {
      resume: 'webhook',
      options: {}
    },
    id: uuid(),
    name: 'Wait VO Approval',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [440, -1100]
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [{
          id: uuid(),
          leftValue: '={{ $json.body.action }}',
          rightValue: 'approve',
          operator: { type: 'string', operation: 'equals' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: uuid(),
    name: 'VO Approved?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [660, -1100]
  },

  // --- OUTRO APPROVAL ---
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [{
          id: uuid(),
          leftValue: '={{ $json.outroReady }}',
          rightValue: false,
          operator: { type: 'boolean', operation: 'false' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: uuid(),
    name: 'Outro Needs Approval?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [880, -1000]
  },
  {
    parameters: {
      resume: 'webhook',
      options: {}
    },
    id: uuid(),
    name: 'Wait Outro Approval',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [1100, -1100]
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [{
          id: uuid(),
          leftValue: '={{ $json.body.action }}',
          rightValue: 'approve',
          operator: { type: 'string', operation: 'equals' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: uuid(),
    name: 'Outro Approved?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [1320, -1100]
  },
];

// Add all new nodes
for (const node of newNodes) {
  workflow.nodes.push(node);
  console.log('Added node: ' + node.name);
}

// ═══════════════════════════════════════
// 2. Remove old nodes
// ═══════════════════════════════════════
const removeNames = ['Send Hook Preview', 'Send VO Preview'];
workflow.nodes = workflow.nodes.filter(n => {
  if (removeNames.includes(n.name)) {
    console.log('Removed node: ' + n.name);
    return false;
  }
  return true;
});
// Also remove their connections (as source)
for (const name of removeNames) {
  delete workflow.connections[name];
}
// Remove references to them as targets
for (const [srcName, conn] of Object.entries(workflow.connections)) {
  if (conn.main) {
    for (const outputArr of conn.main) {
      if (Array.isArray(outputArr)) {
        // Remove entries pointing to removed nodes
        for (let i = outputArr.length - 1; i >= 0; i--) {
          if (removeNames.includes(outputArr[i].node)) {
            outputArr.splice(i, 1);
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════
// 3. Shift existing production nodes right to make room
// ═══════════════════════════════════════
const shiftMap = {
  'Generate Hook': [-608, -1000],        // keep
  'Generate VO': [100, -1000],            // shifted right
  'Generate Outro': [760, -1000],         // shifted right
  'Download Assets': [1540, -1000],       // shifted right
  'Assemble Video': [1760, -1000],        // shifted right
  'Assembly Error?': [1980, -800],        // shifted right
  'Send Assembly Error': [2200, -700],    // shifted right
  'Send Final Video': [2200, -1000],      // shifted right
  'Update Run Complete': [2420, -1000],   // shifted right
  'Done Message': [2640, -1000],          // shifted right
};
for (const node of workflow.nodes) {
  if (shiftMap[node.name]) {
    node.position = shiftMap[node.name];
    console.log('Repositioned: ' + node.name + ' → [' + node.position + ']');
  }
}

// ═══════════════════════════════════════
// 4. Rewire connections
// ═══════════════════════════════════════

// Clear old connections from generate nodes
delete workflow.connections['Generate Hook'];
delete workflow.connections['Generate VO'];
delete workflow.connections['Generate Outro'];

// Helper: create a connection entry
const conn = (node, index = 0) => ({ node, type: 'main', index });

// HOOK flow:
// Generate Hook → Hook Needs Approval?
//   true (output 0)  → Wait Hook Approval → Hook Approved?
//     true (output 0)  → Generate VO
//     false (output 1) → Generate Hook (REDO)
//   false (output 1) → Generate VO
workflow.connections['Generate Hook'] = { main: [[conn('Hook Needs Approval?')]] };
workflow.connections['Hook Needs Approval?'] = {
  main: [
    [conn('Wait Hook Approval')],  // true: needs approval → wait
    [conn('Generate VO')],          // false: skip approval → VO
  ]
};
workflow.connections['Wait Hook Approval'] = { main: [[conn('Hook Approved?')]] };
workflow.connections['Hook Approved?'] = {
  main: [
    [conn('Generate VO')],     // true: approved → continue
    [conn('Generate Hook')],   // false: redo → regenerate
  ]
};

// VO flow:
// Generate VO → VO Needs Approval?
//   true (output 0)  → Wait VO Approval → VO Approved?
//     true (output 0)  → Generate Outro
//     false (output 1) → Generate VO (REDO)
//   false (output 1) → Generate Outro
workflow.connections['Generate VO'] = { main: [[conn('VO Needs Approval?')]] };
workflow.connections['VO Needs Approval?'] = {
  main: [
    [conn('Wait VO Approval')],
    [conn('Generate Outro')],
  ]
};
workflow.connections['Wait VO Approval'] = { main: [[conn('VO Approved?')]] };
workflow.connections['VO Approved?'] = {
  main: [
    [conn('Generate Outro')],
    [conn('Generate VO')],
  ]
};

// OUTRO flow:
// Generate Outro → Outro Needs Approval?
//   true (output 0)  → Wait Outro Approval → Outro Approved?
//     true (output 0)  → Download Assets
//     false (output 1) → Generate Outro (REDO)
//   false (output 1) → Download Assets
workflow.connections['Generate Outro'] = { main: [[conn('Outro Needs Approval?')]] };
workflow.connections['Outro Needs Approval?'] = {
  main: [
    [conn('Wait Outro Approval')],
    [conn('Download Assets')],
  ]
};
workflow.connections['Wait Outro Approval'] = { main: [[conn('Outro Approved?')]] };
workflow.connections['Outro Approved?'] = {
  main: [
    [conn('Download Assets')],
    [conn('Generate Outro')],
  ]
};

// ═══════════════════════════════════════
// 5. Write result
// ═══════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Added 9 approval nodes, removed 2 preview nodes, rewired connections.');
console.log('Total nodes: ' + workflow.nodes.length);
