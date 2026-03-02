// Adds a second Telegram Trigger for the Content Bot
// The content bot handles: #body, #hook, #outro, /done, /next, auto clips, scenario callbacks
// The production bot handles: /produce, hook/outro/VO approvals, final video
//
// After importing, user must manually set the credential on the new trigger + content send nodes

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// ─── 1. Find existing Telegram Trigger ───
const existingTrigger = workflow.nodes.find(n => n.type === 'n8n-nodes-base.telegramTrigger');
if (!existingTrigger) { console.error('Telegram Trigger not found!'); process.exit(1); }

console.log('Found existing trigger: "' + existingTrigger.name + '" at position', existingTrigger.position);

// ─── 2. Create Content Bot Telegram Trigger ───
const contentTrigger = {
  parameters: {
    updates: ['message', 'callback_query'],
    webhookId: 'toxicornah-content-bot',
  },
  type: 'n8n-nodes-base.telegramTrigger',
  typeVersion: 1.1,
  position: [existingTrigger.position[0], existingTrigger.position[1] - 200],
  id: 'content-bot-trigger-' + Date.now(),
  name: 'Content Bot Trigger',
  webhookId: 'toxicornah-content-bot',
  credentials: {
    telegramApi: {
      id: 'REPLACE_WITH_CONTENT_BOT_CREDENTIAL_ID',
      name: 'ToxicOrNah Content Bot',
    },
  },
};

workflow.nodes.push(contentTrigger);
console.log('✅ Added "Content Bot Trigger" node');

// Rename existing trigger for clarity
const oldName = existingTrigger.name;
existingTrigger.name = 'Production Bot Trigger';

// Update all references to old trigger name in connections
if (workflow.connections[oldName]) {
  workflow.connections['Production Bot Trigger'] = workflow.connections[oldName];
  delete workflow.connections[oldName];
}
// Update any node that references the old trigger name in expressions
for (const node of workflow.nodes) {
  const params = JSON.stringify(node.parameters || {});
  if (params.includes(oldName)) {
    node.parameters = JSON.parse(params.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'Production Bot Trigger'));
  }
}
console.log('✅ Renamed "' + oldName + '" → "Production Bot Trigger"');

// ─── 3. Connect Content Bot Trigger to Detect Type ───
// Find what the production trigger connects to
const prodTriggerConn = workflow.connections['Production Bot Trigger'];
if (prodTriggerConn && prodTriggerConn.main && prodTriggerConn.main[0]) {
  const targetNode = prodTriggerConn.main[0][0].node;
  workflow.connections['Content Bot Trigger'] = {
    main: [[{ node: targetNode, type: 'main', index: 0 }]],
  };
  console.log('✅ Wired Content Bot Trigger → ' + targetNode);
}

// ─── Save ───
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

console.log('\n✅ Done! Content Bot Trigger added.\n');
console.log('═══════════════════════════════════════════════════');
console.log('AFTER IMPORTING, update credential on these nodes:');
console.log('═══════════════════════════════════════════════════\n');
console.log('Content Bot credential (new bot):');
console.log('  1. Content Bot Trigger');
console.log('  2. Confirm Clip Saved');
console.log('  3. Send Clip Error');
console.log('  4. Confirm Auto Clip');
console.log('  5. Send Auto Error');
console.log('  6. Send Done Error');
console.log('  7. Send Recording Msg');
console.log('  8. Send Queue Msg');
console.log('  9. Send Generating Msg');
console.log('  10. Send DemoUrl');
console.log('  11. Send Confirmation');
console.log('  12. Send Next Msg');
console.log('\nProduction Bot credential (keep current):');
console.log('  - Production Bot Trigger (already set)');
console.log('  - Ack Produce');
console.log('  - Send Error (Produce)');
console.log('  - Send Produce Error');
console.log('  - Send Hook Preview');
console.log('  - Send Hook Video Preview');
console.log('  - Send Outro Preview');
console.log('  - Send Outro Video Preview');
console.log('  - Send VO Segments');
console.log('  - Send Final Video');
console.log('  - Done Message');
console.log('  - Send Assembly Error');
