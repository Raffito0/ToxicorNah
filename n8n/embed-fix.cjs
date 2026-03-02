const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'workflow-video-pipeline.json');
const codePath = path.join(__dirname, 'code', 'save-to-supabase.js');

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const code = fs.readFileSync(codePath, 'utf8');

let updated = 0;
for (const node of workflow.nodes) {
  if (node.name === 'Save to Supabase' && node.type === 'n8n-nodes-base.code') {
    node.parameters.jsCode = code;
    console.log('Updated: Save to Supabase');
    updated++;
  }
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('Done. Updated ' + updated + ' nodes.');
