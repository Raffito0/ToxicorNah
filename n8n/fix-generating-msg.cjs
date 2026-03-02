// Fixes "Send Generating Msg" node:
// 1. chatId: reference Start Next Scenario or Parse Callback instead of $json.chatId
// 2. text: static string instead of broken $json.message concatenation

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const node = workflow.nodes.find(n => n.name === 'Send Generating Msg');
if (!node) {
  console.error('Node "Send Generating Msg" not found!');
  process.exit(1);
}

console.log('BEFORE:');
console.log('  chatId:', node.parameters.chatId);
console.log('  text:', node.parameters.text);

node.parameters.chatId = '={{ $("Start Next Scenario").first().json.chatId || $("Parse Callback").first().json.chatId }}';
node.parameters.text = '\u23f3 Generando nuovo scenario...';

console.log('\nAFTER:');
console.log('  chatId:', node.parameters.chatId);
console.log('  text:', node.parameters.text);

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\n✅ Done!');
