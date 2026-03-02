// Add IF node after Parse Callback to route VP callbacks away from scenario path
// VP callbacks are fully handled inside Parse Callback (answer + resume)
// Scenario callbacks need the downstream Answer Callback → Find Scenario → Update Status flow
// Run: node add-callback-router.cjs

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const uuid = () => crypto.randomUUID();

// Remove old router if exists (idempotent)
workflow.nodes = workflow.nodes.filter(n => n.name !== 'Is Scenario Callback?');
delete workflow.connections['Is Scenario Callback?'];

// Add IF node: checks if callback type is "scenario"
const routerNode = {
  parameters: {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
      },
      conditions: [
        {
          id: uuid(),
          leftValue: '={{ $json.type }}',
          rightValue: 'scenario',
          operator: {
            type: 'string',
            operation: 'equals',
          },
        },
      ],
      combinator: 'and',
    },
  },
  id: uuid(),
  name: 'Is Scenario Callback?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  position: [-1700, -1760],
};

workflow.nodes.push(routerNode);
console.log('Added: Is Scenario Callback?');

// Rewire:
// Before: Parse Callback → Answer Callback → Find Scenario → ...
// After:  Parse Callback → Is Scenario Callback?
//           → true  → Answer Callback → Find Scenario → ...
//           → false → (end, VP already handled)

const conn = (node, index = 0) => ({ node, type: 'main', index });

workflow.connections['Parse Callback'] = {
  main: [[conn('Is Scenario Callback?')]],
};

workflow.connections['Is Scenario Callback?'] = {
  main: [
    [conn('Answer Callback')],  // true: scenario → continue existing flow
    [],                          // false: VP callback → done (already handled in Parse Callback)
  ],
};

// Answer Callback → Find Scenario connection stays as-is (already exists)

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Added callback router after Parse Callback.');
console.log('Total nodes: ' + workflow.nodes.length);
console.log('\nCallback flow:');
console.log('  Parse Callback → Is Scenario Callback?');
console.log('    → true:  Answer Callback → Find Scenario → Update Status → ...');
console.log('    → false: (end) — VP callback fully handled in Parse Callback');
