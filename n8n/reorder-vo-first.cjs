#!/usr/bin/env node
// reorder-vo-first.cjs
// Rewires the n8n Unified Pipeline workflow JSON:
// 1. Moves VO generation BEFORE Hook generation (Kling Avatar V2 needs audio input)
// 2. Adds "Find App Store Clips" Airtable node before Outro generation
//
// Current flow:
//   Create Video Run → Hook Prompt Agent → Generate Hook → Hook Approval
//     → Generate VO → VO Approval → Outro Prompt Agent → Generate Outro
//
// New flow:
//   Create Video Run → Generate VO → VO Approval → Hook Prompt Agent
//     → Generate Hook → Hook Approval → Find App Store Clips
//     → Outro Prompt Agent → Generate Outro

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKFLOW_FILE = path.join(__dirname, 'unified-pipeline-fixed.json');

console.log('Reading workflow:', WORKFLOW_FILE);
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
const { nodes, connections } = workflow;

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════

function replaceTarget(sourceName, outputIndex, oldTarget, newTarget) {
  if (!connections[sourceName] || !connections[sourceName].main) {
    console.log('  ✗ Source not found in connections:', sourceName);
    return false;
  }
  const outputs = connections[sourceName].main[outputIndex];
  if (!outputs) {
    console.log('  ✗ Output index', outputIndex, 'not found for', sourceName);
    return false;
  }
  let changed = false;
  for (const conn of outputs) {
    if (conn.node === oldTarget) {
      conn.node = newTarget;
      changed = true;
    }
  }
  if (!changed) {
    console.log('  ✗ Target "' + oldTarget + '" not found in "' + sourceName + '" output[' + outputIndex + ']');
  }
  return changed;
}

// ═══════════════════════════════════════
// Step 1: Verify all required nodes exist
// ═══════════════════════════════════════
console.log('\nVerifying nodes...');
const requiredNodes = [
  'Create Video Run', 'Hook Prompt Agent', 'Generate Hook',
  'Hook Needs Approval?', 'Hook Approved?',
  'Generate VO', 'VO Needs Approval?', 'VO Approved?',
  'Outro Prompt Agent', 'Generate Outro',
];
for (const name of requiredNodes) {
  const node = nodes.find(n => n.name === name);
  if (!node) throw new Error('Required node not found: ' + name);
  console.log('  ✓', name);
}

// ═══════════════════════════════════════
// Step 2: Rewire connections — VO before Hook
// ═══════════════════════════════════════
console.log('\nRewiring connections...');

// 2a. Create Video Run → Generate VO (was → Hook Prompt Agent)
replaceTarget('Create Video Run', 0, 'Hook Prompt Agent', 'Generate VO');
console.log('  ✓ Create Video Run → Generate VO (was Hook Prompt Agent)');

// 2b. VO Needs Approval? false → Hook Prompt Agent (was → Outro Prompt Agent)
replaceTarget('VO Needs Approval?', 1, 'Outro Prompt Agent', 'Hook Prompt Agent');
console.log('  ✓ VO Needs Approval? [false] → Hook Prompt Agent (was Outro Prompt Agent)');

// 2c. VO Approved? true → Hook Prompt Agent (was → Outro Prompt Agent)
replaceTarget('VO Approved?', 0, 'Outro Prompt Agent', 'Hook Prompt Agent');
console.log('  ✓ VO Approved? [true] → Hook Prompt Agent (was Outro Prompt Agent)');

// 2d. Hook Needs Approval? false → Find App Store Clips (was → Generate VO)
replaceTarget('Hook Needs Approval?', 1, 'Generate VO', 'Find App Store Clips');
console.log('  ✓ Hook Needs Approval? [false] → Find App Store Clips (was Generate VO)');

// 2e. Hook Approved? true → Find App Store Clips (was → Generate VO)
replaceTarget('Hook Approved?', 0, 'Generate VO', 'Find App Store Clips');
console.log('  ✓ Hook Approved? [true] → Find App Store Clips (was Generate VO)');

// ═══════════════════════════════════════
// Step 3: Add "Find App Store Clips" Airtable node
// ═══════════════════════════════════════
console.log('\nAdding "Find App Store Clips" node...');

const outroPromptAgent = nodes.find(n => n.name === 'Outro Prompt Agent');
const appStoreClipsNode = {
  parameters: {
    operation: 'search',
    base: {
      __rl: true,
      value: 'appsgjIdkpak2kaXq',
      mode: 'list',
      cachedResultName: 'ToxicOrNah Content Pipeline',
      cachedResultUrl: 'https://airtable.com/appsgjIdkpak2kaXq',
    },
    table: {
      __rl: true,
      value: 'tblixE2hz3VVNqYiN',
      mode: 'list',
      cachedResultName: 'App Store Clips',
      cachedResultUrl: 'https://airtable.com/appsgjIdkpak2kaXq/tblixE2hz3VVNqYiN',
    },
    filterByFormula: 'AND({is_active}=TRUE(), {is_used}=FALSE())',
    options: {},
  },
  type: 'n8n-nodes-base.airtable',
  typeVersion: 2.1,
  position: [
    outroPromptAgent.position[0] - 220,
    outroPromptAgent.position[1],
  ],
  id: crypto.randomUUID(),
  name: 'Find App Store Clips',
  credentials: {
    airtableTokenApi: {
      id: 'GQSE5xy7UEjGQdD3',
      name: 'Airtable Personal Access Token account',
    },
  },
};

nodes.push(appStoreClipsNode);
console.log('  ✓ Added node at position', appStoreClipsNode.position);

// Wire: Find App Store Clips → Outro Prompt Agent
connections['Find App Store Clips'] = {
  main: [[{ node: 'Outro Prompt Agent', type: 'main', index: 0 }]],
};
console.log('  ✓ Find App Store Clips → Outro Prompt Agent');

// ═══════════════════════════════════════
// Step 4: Verify final connection chain
// ═══════════════════════════════════════
console.log('\nVerifying new flow...');

function getTarget(sourceName, outputIndex) {
  const conns = connections[sourceName]?.main?.[outputIndex];
  return conns ? conns.map(c => c.node).join(', ') : '(none)';
}

const chain = [
  ['Create Video Run', 0, 'Generate VO'],
  ['Generate VO', 0, 'VO Needs Approval?'],
  ['VO Needs Approval?', 1, 'Hook Prompt Agent'],
  ['VO Approved?', 0, 'Hook Prompt Agent'],
  ['VO Approved?', 1, 'Generate VO'],
  ['Hook Prompt Agent', 0, 'Generate Hook'],
  ['Generate Hook', 0, 'Hook Needs Approval?'],
  ['Hook Needs Approval?', 1, 'Find App Store Clips'],
  ['Hook Approved?', 0, 'Find App Store Clips'],
  ['Hook Approved?', 1, 'Hook Prompt Agent'],
  ['Find App Store Clips', 0, 'Outro Prompt Agent'],
  ['Outro Prompt Agent', 0, 'Generate Outro'],
];

let allOk = true;
for (const [src, idx, expected] of chain) {
  const actual = getTarget(src, idx);
  const ok = actual.includes(expected);
  console.log(ok ? '  ✓' : '  ✗', `"${src}" [${idx}] → "${actual}" ${ok ? '' : '(EXPECTED: ' + expected + ')'}`);
  if (!ok) allOk = false;
}

if (!allOk) {
  console.log('\n⚠ Some connections did not match expected targets. Review manually.');
}

// ═══════════════════════════════════════
// Step 5: Write output
// ═══════════════════════════════════════
fs.writeFileSync(WORKFLOW_FILE, JSON.stringify(workflow, null, 2));
console.log('\n✅ Workflow rewired successfully!');
console.log('Output:', WORKFLOW_FILE);
console.log('\nNew execution order:');
console.log('  Prepare Production → Create Video Run → Generate VO → [VO Approval]');
console.log('  → Hook Prompt Agent → Generate Hook → [Hook Approval]');
console.log('  → Find App Store Clips → Outro Prompt Agent → Generate Outro');
console.log('  → [Outro Approval] → Download Assets → Assemble Video');
