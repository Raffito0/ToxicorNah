// Fix DeepSeek model nodes: change from OpenAI-compatible to native DeepSeek Chat Model
// Run: node fix-deepseek-nodes.cjs

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

let fixed = 0;
for (const node of workflow.nodes) {
  if (node.name === 'DeepSeek Hook' || node.name === 'DeepSeek Outro') {
    // Change type to native DeepSeek
    node.type = '@n8n/n8n-nodes-langchain.lmChatDeepSeek';
    node.typeVersion = 1;
    // Native DeepSeek node uses different parameter structure
    node.parameters = {
      model: 'deepseek-chat',
      options: {
        temperature: 0.8,
        maxTokens: 300,
      },
    };
    fixed++;
    console.log('Fixed: ' + node.name + ' → lmChatDeepSeek (native)');
  }
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Fixed ' + fixed + ' nodes to use native DeepSeek Chat Model.');
console.log('Credential type needed: deepSeekApi (set in n8n UI on each model node)');
