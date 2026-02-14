/**
 * Generates importable n8n workflow JSON files.
 * Run: node n8n/generate-workflow.cjs
 *
 * Uses native n8n nodes:
 *   - Basic LLM Chain + DeepSeek Chat Model (for AI generation)
 *   - Native Telegram node (for messaging)
 *   - Airtable node (for data storage)
 *
 * Produces:
 *   n8n/workflow-scenario-generator.json  (main workflow)
 *   n8n/workflow-telegram-callback.json   (companion callback handler)
 */

const fs = require('fs');
const path = require('path');

// Read all code node scripts
const codeDir = path.join(__dirname, 'code');
const readCode = (filename) => fs.readFileSync(path.join(codeDir, filename), 'utf-8');

const CODE = {
  selectConcept: readCode('select-concept.js'),
  buildScenarioPrompt: readCode('build-scenario-prompt.js'),
  validateScenario: readCode('validate-scenario.js'),
  buildCopyPrompt: readCode('build-copy-prompt.js'),
  validateCopy: readCode('validate-copy.js'),
  formatTelegram: readCode('format-telegram.js'),
  saveToAirtable: readCode('save-to-airtable.js'),
  telegramCallback: readCode('telegram-callback-handler.js'),
};

// ============================================================
// AIRTABLE CONFIG
// ============================================================
const AIRTABLE_BASE_ID = 'appsgjIdkpak2kaXq';
const TABLES = {
  videoConcepts: 'tblhhTVI4EYofdY32',
  bodyClipTemplates: 'tblTcEPaDKKOyKGoL',
  captionTemplates: 'tblxhuowMWTPSQVdb',
  voTemplates: 'tblpyfkR7OdRiwSdo',
  hookTextPool: 'tblmCU1lVXEPqP8zK',
  socialCopyExamples: 'tblU1iYIOURfRYdfF',
  scenarios: 'tblcQaMBBPcOAy0NF',
};

// ============================================================
// CREDENTIAL PLACEHOLDERS
// (n8n replaces these when you assign real credentials)
// ============================================================
const CRED_AIRTABLE = { id: 'REPLACE_AIRTABLE', name: 'Airtable Personal Access Token' };
const CRED_DEEPSEEK = { id: 'REPLACE_DEEPSEEK', name: 'DeepSeek' };
const CRED_TELEGRAM = { id: 'REPLACE_TELEGRAM', name: 'Telegram Bot API' };

// ============================================================
// NODE HELPERS
// ============================================================
let nodeIdCounter = 1;
function makeId() {
  return 'node_' + (nodeIdCounter++).toString().padStart(3, '0');
}

// --- Airtable Search (list / filter records) ---
function airtableSearchNode(name, tableId, filterFormula, position) {
  return {
    id: makeId(),
    name,
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position,
    parameters: {
      operation: 'search',
      application: { __rl: true, value: AIRTABLE_BASE_ID, mode: 'id' },
      table: { __rl: true, value: tableId, mode: 'id' },
      filterByFormula: filterFormula || '',
      options: {},
    },
    credentials: { airtableTokenApi: CRED_AIRTABLE },
  };
}

// --- Airtable Create ---
function airtableCreateNode(name, tableId, position) {
  return {
    id: makeId(),
    name,
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position,
    parameters: {
      operation: 'create',
      application: { __rl: true, value: AIRTABLE_BASE_ID, mode: 'id' },
      table: { __rl: true, value: tableId, mode: 'id' },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
      },
    },
    credentials: { airtableTokenApi: CRED_AIRTABLE },
  };
}

// --- Code ---
function codeNode(name, jsCode, position) {
  return {
    id: makeId(),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: {
      jsCode,
      mode: 'runOnceForAllItems',
    },
  };
}

// --- Basic LLM Chain (parent node for DeepSeek) ---
function basicLlmChainNode(name, position) {
  return {
    id: makeId(),
    name,
    type: '@n8n/n8n-nodes-langchain.chainLlm',
    typeVersion: 1.5,
    position,
    parameters: {
      promptType: 'define',
      text: '={{ $json.userPrompt }}',
      hasOutputParser: false,
      options: {
        systemMessage: '={{ $json.systemPrompt }}',
      },
    },
  };
}

// --- DeepSeek Chat Model (sub-node, connects via ai_languageModel) ---
function deepseekChatModelNode(name, position, temperature, maxTokens) {
  return {
    id: makeId(),
    name,
    type: '@n8n/n8n-nodes-langchain.lmChatDeepSeek',
    typeVersion: 1,
    position,
    parameters: {
      model: 'deepseek-chat',
      options: {
        temperature,
        maxTokens,
      },
    },
    credentials: { deepSeekApi: CRED_DEEPSEEK },
  };
}

// --- Telegram Send Message (native node) ---
function telegramSendNode(name, position, chatIdExpr, textExpr, parseMode, inlineKeyboard) {
  const params = {
    operation: 'sendMessage',
    chatId: chatIdExpr,
    text: textExpr,
    additionalFields: {},
  };
  if (parseMode) {
    params.additionalFields.parse_mode = parseMode;
  }
  if (inlineKeyboard) {
    params.replyMarkup = 'inlineKeyboard';
    params.inlineKeyboard = inlineKeyboard;
  }
  return {
    id: makeId(),
    name,
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    position,
    parameters: params,
    credentials: { telegramApi: CRED_TELEGRAM },
  };
}

// --- Telegram Answer Callback Query (native node) ---
function telegramAnswerQueryNode(name, position, queryIdExpr, textExpr) {
  return {
    id: makeId(),
    name,
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    position,
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: queryIdExpr,
      additionalFields: {
        text: textExpr,
      },
    },
    credentials: { telegramApi: CRED_TELEGRAM },
  };
}

// --- If ---
function ifNode(name, expression, position) {
  return {
    id: makeId(),
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '' },
        conditions: [
          {
            id: makeId(),
            leftValue: expression,
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
        ],
        combinator: 'and',
      },
    },
  };
}

// --- NoOp ---
function noOpNode(name, position) {
  return {
    id: makeId(),
    name,
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position,
    parameters: {},
  };
}

// --- Sticky Note ---
function stickyNote(name, content, position, width, height) {
  return {
    id: makeId(),
    name,
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position,
    parameters: { content, width, height },
  };
}

// ============================================================
// WORKFLOW 1: SCENARIO GENERATOR
// ============================================================

function buildMainWorkflow() {
  nodeIdCounter = 1;

  const nodes = [];
  const connections = {};

  // Standard main connection (node → node)
  function connect(fromName, toName, fromIndex = 0) {
    if (!connections[fromName]) connections[fromName] = {};
    if (!connections[fromName].main) connections[fromName].main = [];
    while (connections[fromName].main.length <= fromIndex) {
      connections[fromName].main.push([]);
    }
    connections[fromName].main[fromIndex].push({ node: toName, type: 'main', index: 0 });
  }

  // AI sub-node connection (e.g. DeepSeek Chat Model → Basic LLM Chain)
  function connectAi(fromName, toName, connectionType) {
    if (!connections[fromName]) connections[fromName] = {};
    if (!connections[fromName][connectionType]) connections[fromName][connectionType] = [[]];
    connections[fromName][connectionType][0].push({
      node: toName,
      type: connectionType,
      index: 0,
    });
  }

  // ── Sticky Note ──────────────────────────────────────────
  nodes.push(stickyNote(
    'Instructions',
    '## ToxicOrNah - Scenario Generator\n\n' +
    '### Setup required:\n' +
    '1. **Airtable**: Assign your Airtable Personal Access Token credential to all Airtable nodes\n' +
    '2. **DeepSeek**: Create a DeepSeek credential (API key) and assign to both DeepSeek Chat Model sub-nodes\n' +
    '3. **Telegram**: Create a Telegram Bot API credential and assign to the Send node. Set `TELEGRAM_CHAT_ID` in Settings → Variables\n\n' +
    '### How to use:\n' +
    '- Click "Test workflow" to generate 1 scenario\n' +
    '- Check Telegram for approval message with Approve/Redo/Skip buttons\n' +
    '- Use the companion "Telegram Callback Handler" workflow to process button clicks',
    [-200, -300],
    520,
    340
  ));

  // ── Manual Trigger ───────────────────────────────────────
  const trigger = {
    id: makeId(),
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [0, 300],
    parameters: {},
  };
  nodes.push(trigger);

  // ── Get Active Concepts (Airtable) ──────────────────────
  const getConcepts = airtableSearchNode(
    'Get Active Concepts',
    TABLES.videoConcepts,
    '{is_active} = TRUE()',
    [220, 300]
  );
  nodes.push(getConcepts);
  connect('Manual Trigger', 'Get Active Concepts');

  // ── Select Concept (Code) ──────────────────────────────
  const selectConcept = codeNode('Select Concept', CODE.selectConcept, [440, 300]);
  nodes.push(selectConcept);
  connect('Get Active Concepts', 'Select Concept');

  // ── Get Templates (Airtable × 5, sequential) ──────────
  const conceptFilter = '={{ \'{concept_id} = "\' + $("Select Concept").first().json.conceptId + \'"\' }}';

  const getBodyClips = airtableSearchNode('Get Body Clip Templates', TABLES.bodyClipTemplates, conceptFilter, [660, 300]);
  nodes.push(getBodyClips);
  connect('Select Concept', 'Get Body Clip Templates');

  const getCaptions = airtableSearchNode('Get Caption Templates', TABLES.captionTemplates, conceptFilter, [880, 300]);
  nodes.push(getCaptions);
  connect('Get Body Clip Templates', 'Get Caption Templates');

  const getVO = airtableSearchNode('Get VO Templates', TABLES.voTemplates, conceptFilter, [1100, 300]);
  nodes.push(getVO);
  connect('Get Caption Templates', 'Get VO Templates');

  const getHooks = airtableSearchNode('Get Hook Texts', TABLES.hookTextPool, conceptFilter, [1320, 300]);
  nodes.push(getHooks);
  connect('Get VO Templates', 'Get Hook Texts');

  const getSocial = airtableSearchNode('Get Social Examples', TABLES.socialCopyExamples, conceptFilter, [1540, 300]);
  nodes.push(getSocial);
  connect('Get Hook Texts', 'Get Social Examples');

  // ── Build Scenario Prompt (Code) ───────────────────────
  const buildPrompt = codeNode('Build Scenario Prompt', CODE.buildScenarioPrompt, [1760, 300]);
  nodes.push(buildPrompt);
  connect('Get Social Examples', 'Build Scenario Prompt');

  // ── Generate Scenario (Basic LLM Chain + DeepSeek) ─────
  const genScenario = basicLlmChainNode('Generate Scenario', [1980, 300]);
  nodes.push(genScenario);
  connect('Build Scenario Prompt', 'Generate Scenario');

  // DeepSeek sub-node for scenario generation (high creativity)
  const dsScenarioModel = deepseekChatModelNode(
    'DeepSeek Scenario Model',
    [1980, 520],  // positioned below parent
    0.9,          // temperature
    4000          // maxTokens
  );
  nodes.push(dsScenarioModel);
  connectAi('DeepSeek Scenario Model', 'Generate Scenario', 'ai_languageModel');

  // ── Validate Scenario (Code) ───────────────────────────
  const validateScenario = codeNode('Validate Scenario', CODE.validateScenario, [2200, 300]);
  nodes.push(validateScenario);
  connect('Generate Scenario', 'Validate Scenario');

  // ── Scenario Valid? (If) ───────────────────────────────
  const scenarioValid = ifNode(
    'Scenario Valid?',
    '={{ $input.first().json.valid }}',
    [2420, 300]
  );
  nodes.push(scenarioValid);
  connect('Validate Scenario', 'Scenario Valid?');

  // ── Build Copy Prompt (Code) — True branch ─────────────
  const buildCopy = codeNode('Build Copy Prompt', CODE.buildCopyPrompt, [2640, 200]);
  nodes.push(buildCopy);
  connect('Scenario Valid?', 'Build Copy Prompt', 0); // True = output 0

  // ── Error: Invalid Scenario — False branch ─────────────
  const errorStop = noOpNode('Error: Invalid Scenario', [2640, 500]);
  nodes.push(errorStop);
  connect('Scenario Valid?', 'Error: Invalid Scenario', 1); // False = output 1

  // ── Generate Content Copy (Basic LLM Chain + DeepSeek) ─
  const genCopy = basicLlmChainNode('Generate Content Copy', [2860, 200]);
  nodes.push(genCopy);
  connect('Build Copy Prompt', 'Generate Content Copy');

  // DeepSeek sub-node for copy generation (slightly lower temp)
  const dsCopyModel = deepseekChatModelNode(
    'DeepSeek Copy Model',
    [2860, 420],  // positioned below parent
    0.85,         // temperature
    3000          // maxTokens
  );
  nodes.push(dsCopyModel);
  connectAi('DeepSeek Copy Model', 'Generate Content Copy', 'ai_languageModel');

  // ── Validate Copy (Code) ───────────────────────────────
  const validateCopy = codeNode('Validate Copy', CODE.validateCopy, [3080, 200]);
  nodes.push(validateCopy);
  connect('Generate Content Copy', 'Validate Copy');

  // ── Copy Valid? (If) ───────────────────────────────────
  const copyValid = ifNode(
    'Copy Valid?',
    '={{ $input.first().json.valid }}',
    [3300, 200]
  );
  nodes.push(copyValid);
  connect('Validate Copy', 'Copy Valid?');

  // ── Error: Invalid Copy — False branch ─────────────────
  const errorStop2 = noOpNode('Error: Invalid Copy', [3300, 500]);
  nodes.push(errorStop2);
  connect('Copy Valid?', 'Error: Invalid Copy', 1);

  // ── Prepare Airtable Save (Code) ───────────────────────
  const prepSave = codeNode('Prepare Airtable Save', CODE.saveToAirtable, [3520, 100]);
  nodes.push(prepSave);
  connect('Copy Valid?', 'Prepare Airtable Save', 0); // True

  // ── Save to Airtable ──────────────────────────────────
  const saveAirtable = airtableCreateNode('Save Scenario', TABLES.scenarios, [3740, 100]);
  nodes.push(saveAirtable);
  connect('Prepare Airtable Save', 'Save Scenario');

  // ── Format Telegram Message (Code) ─────────────────────
  const formatTelegram = codeNode('Format Telegram Message', CODE.formatTelegram, [3960, 100]);
  nodes.push(formatTelegram);
  connect('Save Scenario', 'Format Telegram Message');

  // ── Send Telegram Approval (native Telegram node) ──────
  const sendTelegram = telegramSendNode(
    'Send Telegram Approval',
    [4180, 100],
    '={{ $env.TELEGRAM_CHAT_ID }}',
    '={{ $json.message }}',
    'Markdown',
    {
      rows: [
        {
          values: [
            {
              text: '\u2705 Approve',
              additionalFields: {
                callback_data: "={{ 'approve_' + $json.scenarioName }}",
              },
            },
            {
              text: '\uD83D\uDD04 Redo',
              additionalFields: {
                callback_data: "={{ 'redo_' + $json.scenarioName }}",
              },
            },
            {
              text: '\u274C Skip',
              additionalFields: {
                callback_data: "={{ 'skip_' + $json.scenarioName }}",
              },
            },
          ],
        },
      ],
    }
  );
  nodes.push(sendTelegram);
  connect('Format Telegram Message', 'Send Telegram Approval');

  return {
    name: 'ToxicOrNah - Scenario Generator',
    nodes,
    connections,
    active: false,
    settings: {
      executionOrder: 'v1',
    },
    versionId: 'toxicornah-scenario-gen-v2',
    meta: {
      templateCredsSetupCompleted: false,
    },
    tags: [{ name: 'ToxicOrNah' }],
  };
}

// ============================================================
// WORKFLOW 2: TELEGRAM CALLBACK HANDLER
// ============================================================

function buildCallbackWorkflow() {
  nodeIdCounter = 100;

  const nodes = [];
  const connections = {};

  function connect(fromName, toName, fromIndex = 0) {
    if (!connections[fromName]) connections[fromName] = {};
    if (!connections[fromName].main) connections[fromName].main = [];
    while (connections[fromName].main.length <= fromIndex) {
      connections[fromName].main.push([]);
    }
    connections[fromName].main[fromIndex].push({ node: toName, type: 'main', index: 0 });
  }

  // ── Sticky Note ──────────────────────────────────────────
  nodes.push(stickyNote(
    'Callback Instructions',
    '## Telegram Callback Handler\n\n' +
    'Listens for Approve/Redo/Skip button presses from the Scenario Generator.\n\n' +
    '### Setup:\n' +
    '1. Assign **Telegram Bot API** credential to Trigger + Send nodes\n' +
    '2. Assign **Airtable** credential to Airtable nodes\n' +
    '3. **Activate this workflow** (must be always-on)',
    [-200, -200],
    450,
    260
  ));

  // ── Telegram Trigger (callback_query) ──────────────────
  const trigger = {
    id: makeId(),
    name: 'Telegram Trigger',
    type: 'n8n-nodes-base.telegramTrigger',
    typeVersion: 1.1,
    position: [0, 300],
    parameters: {
      updates: ['callback_query'],
    },
    credentials: { telegramApi: CRED_TELEGRAM },
    webhookId: 'toxicornah-callback',
  };
  nodes.push(trigger);

  // ── Parse Callback (Code) ─────────────────────────────
  const parseCallback = codeNode('Parse Callback', CODE.telegramCallback, [250, 300]);
  nodes.push(parseCallback);
  connect('Telegram Trigger', 'Parse Callback');

  // ── Answer Callback Query (native Telegram node) ──────
  const answerCallback = telegramAnswerQueryNode(
    'Answer Callback',
    [500, 300],
    '={{ $json.callbackQueryId }}',
    '={{ $json.responseText }}'
  );
  nodes.push(answerCallback);
  connect('Parse Callback', 'Answer Callback');

  // ── Find Scenario (Airtable search with filter) ────────
  const searchScenario = {
    id: makeId(),
    name: 'Find Scenario',
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position: [750, 300],
    parameters: {
      operation: 'search',
      application: { __rl: true, value: AIRTABLE_BASE_ID, mode: 'id' },
      table: { __rl: true, value: TABLES.scenarios, mode: 'id' },
      filterByFormula: '={{ \'{scenario_name} = "\' + $("Parse Callback").first().json.scenarioName + \'"\' }}',
      options: {},
    },
    credentials: { airtableTokenApi: CRED_AIRTABLE },
  };
  nodes.push(searchScenario);
  connect('Answer Callback', 'Find Scenario');

  // ── Update Status (Airtable update) ───────────────────
  const updateScenario = {
    id: makeId(),
    name: 'Update Status',
    type: 'n8n-nodes-base.airtable',
    typeVersion: 2.1,
    position: [1000, 300],
    parameters: {
      operation: 'update',
      application: { __rl: true, value: AIRTABLE_BASE_ID, mode: 'id' },
      table: { __rl: true, value: TABLES.scenarios, mode: 'id' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          status: '={{ $("Parse Callback").first().json.newStatus }}',
        },
      },
      id: '={{ $input.first().json.id }}',
    },
    credentials: { airtableTokenApi: CRED_AIRTABLE },
  };
  nodes.push(updateScenario);
  connect('Find Scenario', 'Update Status');

  // ── Send Confirmation (native Telegram node) ──────────
  const sendConfirmation = telegramSendNode(
    'Send Confirmation',
    [1250, 300],
    '={{ $("Parse Callback").first().json.chatId }}',
    '={{ $("Parse Callback").first().json.responseText }}',
    null,
    null
  );
  nodes.push(sendConfirmation);
  connect('Update Status', 'Send Confirmation');

  return {
    name: 'ToxicOrNah - Telegram Callback Handler',
    nodes,
    connections,
    active: false,
    settings: {
      executionOrder: 'v1',
    },
    versionId: 'toxicornah-telegram-callback-v2',
    meta: {
      templateCredsSetupCompleted: false,
    },
    tags: [{ name: 'ToxicOrNah' }],
  };
}

// ============================================================
// GENERATE FILES
// ============================================================

const mainWorkflow = buildMainWorkflow();
const callbackWorkflow = buildCallbackWorkflow();

const outDir = __dirname;

fs.writeFileSync(
  path.join(outDir, 'workflow-scenario-generator.json'),
  JSON.stringify(mainWorkflow, null, 2)
);

fs.writeFileSync(
  path.join(outDir, 'workflow-telegram-callback.json'),
  JSON.stringify(callbackWorkflow, null, 2)
);

console.log('Generated:');
console.log('  n8n/workflow-scenario-generator.json  (' + mainWorkflow.nodes.length + ' nodes)');
console.log('  n8n/workflow-telegram-callback.json   (' + callbackWorkflow.nodes.length + ' nodes)');
console.log('');
console.log('Node types used:');
console.log('  - Basic LLM Chain      (@n8n/n8n-nodes-langchain.chainLlm v1.5)');
console.log('  - DeepSeek Chat Model  (@n8n/n8n-nodes-langchain.lmChatDeepSeek v1)');
console.log('  - Telegram             (n8n-nodes-base.telegram v1.2)');
console.log('  - Telegram Trigger     (n8n-nodes-base.telegramTrigger v1.1)');
console.log('  - Airtable             (n8n-nodes-base.airtable v2.1)');
console.log('  - Code                 (n8n-nodes-base.code v2)');
console.log('');
console.log('Setup:');
console.log('  1. Import both workflows into n8n');
console.log('  2. Assign credentials:');
console.log('     - Airtable Personal Access Token  -> all Airtable nodes');
console.log('     - DeepSeek API key                -> both DeepSeek Chat Model sub-nodes');
console.log('     - Telegram Bot API                -> Telegram Trigger + Send nodes');
console.log('  3. Set TELEGRAM_CHAT_ID in n8n Settings -> Variables');
console.log('  4. Activate the Telegram Callback Handler workflow');
console.log('  5. Test the Scenario Generator with "Test workflow"');
