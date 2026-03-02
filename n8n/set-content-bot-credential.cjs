// Sets the Content Bot Telegram credential on all content-related nodes

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const CONTENT_CREDENTIAL = {
  id: 'LnY46hGLXjQCETpn',
  name: 'Content Bot',
};

const contentNodes = [
  'Content Bot Trigger',
  'Confirm Clip Saved',
  'Send Clip Error',
  'Confirm Auto Clip',
  'Send Auto Error',
  'Send Done Error',
  'Send Recording Msg',
  'Send Queue Msg',
  'Send Generating Msg',
  'Send DemoUrl',
  'Send Confirmation',
  'Send Next Msg',
];

let updated = 0;
for (const node of workflow.nodes) {
  if (contentNodes.includes(node.name)) {
    if (!node.credentials) node.credentials = {};
    node.credentials.telegramApi = CONTENT_CREDENTIAL;
    console.log('✅ ' + node.name);
    updated++;
  }
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone. Updated ' + updated + '/' + contentNodes.length + ' nodes.');

if (updated < contentNodes.length) {
  const found = workflow.nodes.map(n => n.name);
  const missing = contentNodes.filter(n => !found.includes(n));
  console.log('Missing nodes:', missing);
}
