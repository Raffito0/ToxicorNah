// Add "Delete Scenario" node on the non-approved callback path
// Is Approved? FALSE → Delete Scenario → Send Confirmation
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'workflow-video-pipeline.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// 1. Add the Delete Scenario node
const deleteNode = {
  parameters: {
    operation: "deleteRecord",
    base: {
      __rl: true,
      value: "appsgjIdkpak2kaXq",
      mode: "list",
      cachedResultName: "ToxicOrNah Content Pipeline",
      cachedResultUrl: "https://airtable.com/appsgjIdkpak2kaXq"
    },
    table: {
      __rl: true,
      value: "tblcQaMBBPcOAy0NF",
      mode: "list",
      cachedResultName: "Scenarios",
      cachedResultUrl: "https://airtable.com/appsgjIdkpak2kaXq/tblcQaMBBPcOAy0NF"
    },
    id: "={{ $('Find Scenario (Callback)').first().json.id }}"
  },
  id: "cb-delete-scenario",
  name: "Delete Scenario",
  type: "n8n-nodes-base.airtable",
  typeVersion: 2.1,
  position: [1400, 200],
  credentials: {
    airtableTokenApi: {
      id: "GQSE5xy7UEjGQdD3",
      name: "Airtable Personal Access Token account"
    }
  }
};

// Check if already exists
const exists = workflow.nodes.find(n => n.id === 'cb-delete-scenario');
if (exists) {
  console.log('Delete Scenario node already exists, skipping');
} else {
  workflow.nodes.push(deleteNode);
  console.log('Added Delete Scenario node');
}

// 2. Rewire: Is Approved? FALSE → Delete Scenario → Send Confirmation
// Currently: Is Approved? FALSE → Send Confirmation
// New: Is Approved? FALSE → Delete Scenario → Send Confirmation

const conn = workflow.connections;

// Find "Is Approved?" connections
if (conn['Is Approved?'] && conn['Is Approved?'].main) {
  const falseOutput = conn['Is Approved?'].main[1]; // output 1 = FALSE
  if (falseOutput) {
    // Save current FALSE target (should be Send Confirmation)
    const currentTarget = JSON.parse(JSON.stringify(falseOutput));
    console.log('Current FALSE path goes to:', currentTarget.map(c => c.node).join(', '));

    // Point FALSE to Delete Scenario instead
    conn['Is Approved?'].main[1] = [{
      node: "Delete Scenario",
      type: "main",
      index: 0
    }];
    console.log('Rewired: Is Approved? FALSE → Delete Scenario');

    // Delete Scenario → Send Confirmation
    conn['Delete Scenario'] = {
      main: [currentTarget]
    };
    console.log('Wired: Delete Scenario → ' + currentTarget.map(c => c.node).join(', '));
  }
}

// 3. Also update Update Status to only run on approved path
// Actually, let's keep it simple - the update runs first, then delete removes the record anyway
// So on redo/skip: status gets updated (to "draft"/"skipped"), then record gets deleted = clean

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('Done! Workflow updated.');
console.log('Total nodes:', workflow.nodes.length);
