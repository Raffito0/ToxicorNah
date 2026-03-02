#!/usr/bin/env node
// add-clip-mark.cjs
// Adds auto-marking of App Store Clips as used after successful video assembly.
// Adds 2 nodes wired in parallel from "Send Final Video":
//   Send Final Video → Prepare Clip Mark → Mark App Store Clip Used
//   Send Final Video → Update Run Complete (existing, unchanged)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKFLOW_FILE = path.join(__dirname, 'unified-pipeline-fixed.json');

console.log('Reading workflow:', WORKFLOW_FILE);
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
const { nodes, connections } = workflow;

// ═══════════════════════════════════════
// Step 1: Add "Prepare Clip Mark" Code node
// ═══════════════════════════════════════
console.log('\nAdding nodes...');

const sendFinalVideo = nodes.find(n => n.name === 'Send Final Video');
if (!sendFinalVideo) throw new Error('Node "Send Final Video" not found');

// Read the code file
const codeFilePath = path.join(__dirname, 'code', 'mark-clip-used.js');
const codeContent = fs.readFileSync(codeFilePath, 'utf8');

const prepareClipMark = {
  parameters: {
    jsCode: codeContent,
    mode: 'runOnceForAllItems',
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [
    sendFinalVideo.position[0] + 10,
    sendFinalVideo.position[1] - 250,
  ],
  id: crypto.randomUUID(),
  name: 'Prepare Clip Mark',
};

nodes.push(prepareClipMark);
console.log('  ✓ Added "Prepare Clip Mark" at', prepareClipMark.position);

// ═══════════════════════════════════════
// Step 2: Add "Mark App Store Clip Used" Airtable Update node
// ═══════════════════════════════════════

const markClipUsed = {
  parameters: {
    operation: 'update',
    base: {
      __rl: true,
      mode: 'id',
      value: 'appsgjIdkpak2kaXq',
    },
    table: {
      __rl: true,
      mode: 'id',
      value: 'tblixE2hz3VVNqYiN',
    },
    columns: {
      mappingMode: 'defineBelow',
      value: {
        id: '={{ $json.recordId }}',
        is_used: true,
        used_date: '={{ $now.toISODate() }}',
      },
      matchingColumns: ['id'],
    },
    options: {},
  },
  type: 'n8n-nodes-base.airtable',
  typeVersion: 2.1,
  position: [
    prepareClipMark.position[0] + 260,
    prepareClipMark.position[1],
  ],
  id: crypto.randomUUID(),
  name: 'Mark App Store Clip Used',
  credentials: {
    airtableTokenApi: {
      id: 'GQSE5xy7UEjGQdD3',
      name: 'Airtable Personal Access Token account',
    },
  },
};

nodes.push(markClipUsed);
console.log('  ✓ Added "Mark App Store Clip Used" at', markClipUsed.position);

// ═══════════════════════════════════════
// Step 3: Wire connections
// ═══════════════════════════════════════
console.log('\nWiring connections...');

// Add "Prepare Clip Mark" as additional output from "Send Final Video"
// (existing connection to "Update Run Complete" stays)
if (!connections['Send Final Video']) {
  connections['Send Final Video'] = { main: [[]] };
}
connections['Send Final Video'].main[0].push({
  node: 'Prepare Clip Mark',
  type: 'main',
  index: 0,
});
console.log('  ✓ Send Final Video → Prepare Clip Mark (parallel with Update Run Complete)');

// Wire: Prepare Clip Mark → Mark App Store Clip Used
connections['Prepare Clip Mark'] = {
  main: [[{ node: 'Mark App Store Clip Used', type: 'main', index: 0 }]],
};
console.log('  ✓ Prepare Clip Mark → Mark App Store Clip Used');

// ═══════════════════════════════════════
// Step 4: Verify
// ═══════════════════════════════════════
console.log('\nVerifying...');
const sfvTargets = connections['Send Final Video'].main[0].map(c => c.node);
console.log('  Send Final Video outputs:', sfvTargets.join(', '));
const pcmTargets = connections['Prepare Clip Mark'].main[0].map(c => c.node);
console.log('  Prepare Clip Mark outputs:', pcmTargets.join(', '));

// ═══════════════════════════════════════
// Step 5: Write
// ═══════════════════════════════════════
fs.writeFileSync(WORKFLOW_FILE, JSON.stringify(workflow, null, 2));
console.log('\n✅ App Store clip auto-marking added!');
console.log('  Send Final Video → Update Run Complete (existing)');
console.log('  Send Final Video → Prepare Clip Mark → Mark App Store Clip Used (new, parallel)');
