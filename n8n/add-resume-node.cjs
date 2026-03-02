// Add native HTTP Request node to resume waiting VP executions
// Replaces the fetch() call inside Parse Callback Code node (which deadlocked)
// Run: node add-resume-node.cjs

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const uuid = () => crypto.randomUUID();

// Remove old node if exists (idempotent)
workflow.nodes = workflow.nodes.filter(n => n.name !== 'Resume VP Execution');
delete workflow.connections['Resume VP Execution'];

// ═══════════════════════════════════════
// Add HTTP Request node: POSTs to webhook-waiting/{executionId}
// ═══════════════════════════════════════
const resumeNode = {
  parameters: {
    method: 'POST',
    url: '={{ "https://n8n.srv1181791.hstgr.cloud/webhook-waiting/" + $json.executionId }}',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ action: $json.action, step: $json.step }) }}',
    options: {
      timeout: 10000,
      allowUnauthorizedCerts: true,
    },
  },
  id: uuid(),
  name: 'Resume VP Execution',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [-1500, -1680],  // Below "Is Scenario Callback?" false branch
};

workflow.nodes.push(resumeNode);
console.log('Added: Resume VP Execution (HTTP Request node)');

// ═══════════════════════════════════════
// Rewire: Is Scenario Callback? → false → Resume VP Execution
// ═══════════════════════════════════════
const conn = (node, index = 0) => ({ node, type: 'main', index });

// Get existing true branch connection
const existingConn = workflow.connections['Is Scenario Callback?'];
const trueBranch = existingConn?.main?.[0] || [conn('Answer Callback')];

workflow.connections['Is Scenario Callback?'] = {
  main: [
    trueBranch,                    // true: scenario → Answer Callback → ...
    [conn('Resume VP Execution')], // false: VP → resume the waiting execution
  ],
};

console.log('Wired: Is Scenario Callback? → false → Resume VP Execution');

// ═══════════════════════════════════════
// Write result
// ═══════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! VP callback flow:');
console.log('  Parse Callback → Is Scenario Callback?');
console.log('    → true:  Answer Callback → Find Scenario → ...');
console.log('    → false: Resume VP Execution (HTTP POST to webhook-waiting/{executionId})');
console.log('\nTotal nodes: ' + workflow.nodes.length);
