// Add "Get Outro Examples" Airtable node to scenario generator workflow
// Wires: Get Social Examples → Get Outro Examples → Build Scenario Prompt
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'workflow-scenario-generator.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// 1. Check if node already exists
const existing = workflow.nodes.find(n => n.name === 'Get Outro Examples');
if (existing) {
  console.log('Node "Get Outro Examples" already exists, skipping creation.');
} else {
  // 2. Create the new Airtable node
  // Position: between Get Social Examples [1120, 112] and Build Scenario Prompt [1344, 112]
  const newNode = {
    id: 'f7a3e1b2-outro-examples-node',
    name: 'Get Outro Examples',
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position: [1232, 112],
    parameters: {
      operation: 'search',
      base: {
        __rl: true,
        value: 'appsgjIdkpak2kaXq',
        mode: 'id',
      },
      table: {
        __rl: true,
        value: 'tbl9lMPjhorITKcN1',
        mode: 'id',
      },
      filterByFormula: '{is_active} = TRUE()',
      options: {},
    },
    credentials: {
      airtableTokenApi: {
        id: 'GQSE5xy7UEjGQdD3',
        name: 'Airtable Personal Access Token account',
      },
    },
  };

  workflow.nodes.push(newNode);
  console.log('Added node: Get Outro Examples');
}

// 3. Rewire connections
// Before: Get Social Examples → Build Scenario Prompt
// After:  Get Social Examples → Get Outro Examples → Build Scenario Prompt

const conn = workflow.connections;

// Update Get Social Examples to point to Get Outro Examples
if (conn['Get Social Examples']) {
  const mainOutputs = conn['Get Social Examples'].main;
  if (mainOutputs && mainOutputs[0]) {
    // Find and replace the Build Scenario Prompt connection
    const idx = mainOutputs[0].findIndex(c => c.node === 'Build Scenario Prompt');
    if (idx >= 0) {
      mainOutputs[0][idx] = {
        node: 'Get Outro Examples',
        type: 'main',
        index: 0,
      };
      console.log('Rewired: Get Social Examples → Get Outro Examples');
    } else {
      // Just add it
      mainOutputs[0].push({
        node: 'Get Outro Examples',
        type: 'main',
        index: 0,
      });
      console.log('Added connection: Get Social Examples → Get Outro Examples');
    }
  }
}

// Add Get Outro Examples → Build Scenario Prompt connection
if (!conn['Get Outro Examples']) {
  conn['Get Outro Examples'] = {
    main: [
      [
        {
          node: 'Build Scenario Prompt',
          type: 'main',
          index: 0,
        },
      ],
    ],
  };
  console.log('Added connection: Get Outro Examples → Build Scenario Prompt');
} else {
  console.log('Connection from Get Outro Examples already exists');
}

// 4. Save
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('Done. Workflow saved.');
