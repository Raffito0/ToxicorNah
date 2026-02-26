// Embed updated code files into scenario generator workflow JSON
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'workflow-scenario-generator.json');
const codePath = path.join(__dirname, 'code');

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Map code file names to n8n node names in the scenario generator
const codeMap = {
  'build-scenario-prompt.js': 'Build Scenario Prompt',
  'build-copy-prompt.js': 'Build Copy Prompt',
  'validate-scenario.js': 'Validate Scenario',
  'validate-copy.js': 'Validate Copy',
};

let updated = 0;
for (const node of workflow.nodes) {
  if (node.type !== 'n8n-nodes-base.code') continue;

  for (const [file, nodeName] of Object.entries(codeMap)) {
    if (node.name === nodeName) {
      const filePath = path.join(codePath, file);
      if (fs.existsSync(filePath)) {
        const code = fs.readFileSync(filePath, 'utf8');
        node.parameters.jsCode = code;
        console.log('Updated: ' + node.name + ' ← ' + file);
        updated++;
      }
    }
  }
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('Done. Updated ' + updated + ' nodes.');
