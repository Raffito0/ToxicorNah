// Adds /next command route to the unified pipeline workflow:
// 1. New rule "Start Next" in Route Message switch
// 2. New Airtable search node "Find Approved (Next)"
// 3. New Code node "Start Next Scenario"
// 4. New Telegram send node "Send Next Msg"
// 5. Wiring: Route Message → Find Approved (Next) → Start Next Scenario → Send Next Msg

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Load start-next-scenario.js code
const startNextCode = fs.readFileSync(path.join(__dirname, 'code', 'start-next-scenario.js'), 'utf8');

// ─── 1. Add "Start Next" rule to Route Message switch ───
const routeMessage = workflow.nodes.find(n => n.name === 'Route Message');
if (!routeMessage) { console.error('Route Message node not found!'); process.exit(1); }

// Add new rule before fallback (fallback is handled by options.fallbackOutput)
routeMessage.parameters.rules.values.push({
  conditions: {
    options: { caseSensitive: true, leftValue: '' },
    conditions: [{
      leftValue: '={{ $json.messageType }}',
      rightValue: 'start_next',
      operator: { type: 'string', operation: 'equals' },
    }],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: 'Start Next',
});

console.log('✅ Added "Start Next" rule to Route Message (output index 6)');

// ─── 2. New Airtable search node ───
const findApprovedNext = {
  parameters: {
    operation: 'search',
    base: { __rl: true, mode: 'id', value: 'appsgjIdkpak2kaXq' },
    table: { __rl: true, mode: 'id', value: 'tblcQaMBBPcOAy0NF' },
    filterByFormula: '={status} = "approved"',
    options: {},
    sort: { property: [{ field: 'created_at' }] },
  },
  type: 'n8n-nodes-base.airtable',
  typeVersion: 2.1,
  position: [-1280, -1320],
  id: 'find-approved-next-' + Date.now(),
  name: 'Find Approved (Next)',
  credentials: {
    airtableTokenApi: {
      id: 'GQSE5xy7UEjGQdD3',
      name: 'Airtable Personal Access Token account',
    },
  },
  onError: 'continueRegularOutput',
  alwaysOutputData: true,
};
workflow.nodes.push(findApprovedNext);
console.log('✅ Added "Find Approved (Next)" Airtable node');

// ─── 3. New Code node: Start Next Scenario ───
const startNextNode = {
  parameters: {
    jsCode: startNextCode,
    mode: 'runOnceForAllItems',
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [-1056, -1320],
  id: 'start-next-scenario-' + Date.now(),
  name: 'Start Next Scenario',
};
workflow.nodes.push(startNextNode);
console.log('✅ Added "Start Next Scenario" Code node');

// ─── 4. New Telegram send node ───
const sendNextMsg = {
  parameters: {
    chatId: '={{ $json.chatId }}',
    text: '={{ $json.message }}',
    additionalFields: {},
  },
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [-832, -1320],
  id: 'send-next-msg-' + Date.now(),
  name: 'Send Next Msg',
  webhookId: 'send-next-msg-' + Date.now(),
  credentials: {
    telegramApi: {
      id: 'pyWK5SqqdZeXs1WU',
      name: 'Telegram account',
    },
  },
};
workflow.nodes.push(sendNextMsg);
console.log('✅ Added "Send Next Msg" Telegram node');

// ─── 5. Wire connections ───

// Route Message output 6 (Start Next) → Find Approved (Next)
// Current connections have 7 outputs (0-5 = rules, 6 = fallback)
// After adding the new rule, outputs are: 0-5 = old rules, 6 = Start Next, 7 = fallback
const rmConn = workflow.connections['Route Message'];
if (rmConn && rmConn.main) {
  // Current fallback is at index 6, shift it to index 7
  const fallback = rmConn.main[6] || [{ node: 'Ignore', type: 'main', index: 0 }];
  // Insert Start Next at index 6
  rmConn.main[6] = [{ node: 'Find Approved (Next)', type: 'main', index: 0 }];
  // Move fallback to index 7
  rmConn.main[7] = fallback;
  console.log('✅ Wired Route Message [Start Next] → Find Approved (Next)');
  console.log('✅ Moved fallback (Ignore) to output 7');
}

// Find Approved (Next) → Start Next Scenario
workflow.connections['Find Approved (Next)'] = {
  main: [[{ node: 'Start Next Scenario', type: 'main', index: 0 }]],
};
console.log('✅ Wired Find Approved (Next) → Start Next Scenario');

// Start Next Scenario → Send Next Msg
workflow.connections['Start Next Scenario'] = {
  main: [[{ node: 'Send Next Msg', type: 'main', index: 0 }]],
};
console.log('✅ Wired Start Next Scenario → Send Next Msg');

// ─── Save ───
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\n✅ Done! /next route added to workflow.');
