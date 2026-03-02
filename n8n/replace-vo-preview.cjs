// Replace native "Send VO Preview" Telegram node with "Send VO Segments" Code node
// Also register send-vo-segments.js in embed-code.cjs mapping
// Run: node replace-vo-preview.cjs

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const uuid = () => crypto.randomUUID();

// Read the send-vo-segments.js code
const sendVoCode = fs.readFileSync(path.join(__dirname, 'code', 'send-vo-segments.js'), 'utf8');

// Find the old "Send VO Preview" node to get its position
const oldNode = workflow.nodes.find(n => n.name === 'Send VO Preview');
const position = oldNode ? oldNode.position : [840, -1400];

// Remove old node
workflow.nodes = workflow.nodes.filter(n => n.name !== 'Send VO Preview');
delete workflow.connections['Send VO Preview'];
console.log('Removed: Send VO Preview (Telegram node)');

// Add new Code node
const newNode = {
  parameters: {
    jsCode: sendVoCode,
    mode: 'runOnceForAllItems',
  },
  id: uuid(),
  name: 'Send VO Segments',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: position,
};

workflow.nodes.push(newNode);
console.log('Added: Send VO Segments (Code node)');

// Rewire connections:
// VO Needs Approval? → true → Send VO Segments
// Find VO Needs Approval? and update its true branch
const voNeedsConn = workflow.connections['VO Needs Approval?'];
if (voNeedsConn && voNeedsConn.main) {
  // true branch (index 0) should point to Send VO Segments
  voNeedsConn.main[0] = [{ node: 'Send VO Segments', type: 'main', index: 0 }];
  console.log('Rewired: VO Needs Approval? → true → Send VO Segments');
}

// Send VO Segments → Poll VO Approval
workflow.connections['Send VO Segments'] = {
  main: [[{ node: 'Poll VO Approval', type: 'main', index: 0 }]],
};
console.log('Wired: Send VO Segments → Poll VO Approval');

// Write result
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Replaced Send VO Preview with Send VO Segments.');
console.log('Total nodes: ' + workflow.nodes.length);
console.log('\nNew flow:');
console.log('  VO Needs Approval? → true → Send VO Segments (Code) → Poll VO Approval → VO Approved?');
