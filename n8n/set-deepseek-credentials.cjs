// Sets DeepSeek credentials on Hook and Outro LLM nodes

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const DEEPSEEK_CREDENTIAL = {
  id: 'lynNdJ1q80Ynwnhv',
  name: 'DeepSeek',
};

const deepseekNodes = ['DeepSeek Hook', 'DeepSeek Outro'];

let updated = 0;
for (const node of workflow.nodes) {
  if (deepseekNodes.includes(node.name)) {
    if (!node.credentials) node.credentials = {};
    node.credentials.deepSeekApi = DEEPSEEK_CREDENTIAL;
    console.log('✅ ' + node.name);
    updated++;
  }
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone. Updated ' + updated + '/' + deepseekNodes.length + ' nodes.');
