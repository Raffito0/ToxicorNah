// Add AI Agent nodes with DeepSeek (OpenAI-compatible) for hook/outro prompt generation
// Run: node add-prompt-agents.cjs
// After running: user must set DeepSeek credential on the model nodes in n8n UI

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const uuid = () => crypto.randomUUID();

// ═══════════════════════════════════════
// System prompts
// ═══════════════════════════════════════
const HOOK_SYSTEM_PROMPT = `You are an expert at writing image generation prompts for kie.ai (Nano Banana Pro model).
You write prompts for TikTok videos that analyze toxic/healthy relationship chats.

The image shows a girl reacting to a chat conversation on her phone — this is the HOOK (opening shot).

ABSOLUTE RULES:
1. NEVER describe the girl's appearance (hair color, face shape, body, clothes, skin, age). She is provided as reference image #1.
2. ALWAYS start with: "The same exact girl in the reference image"
3. If an environment reference frame is available, ALWAYS say "in the exact same room and setting shown in the second reference image" — NEVER invent a different room.
4. Focus ONLY on: pose, facial expression, emotion, body language, camera angle, lighting mood, phone interaction
5. Keep the prompt under 150 words
6. Style must be: realistic, candid, shot on iPhone, 9:16 vertical
7. The girl is looking at her phone screen reacting to the chat

OUTPUT: Return ONLY the prompt text, nothing else. No quotes, no explanation.`;

const OUTRO_SYSTEM_PROMPT = `You are an expert at writing image generation prompts for kie.ai (Nano Banana Pro model).
You write prompts for TikTok videos that analyze toxic/healthy relationship chats.

The image shows a girl AFTER reading the chat — this is the OUTRO (closing shot). She has already seen the analysis results.
The outro should show her in a DIFFERENT position than the hook (e.g., standing, leaning, sitting differently, looking away from phone).

ABSOLUTE RULES:
1. NEVER describe the girl's appearance (hair color, face shape, body, clothes, skin, age). She is provided as reference image #1.
2. ALWAYS start with: "The same exact girl in the reference image"
3. If a hook image is available as reference #2, ALWAYS say "in the exact same room and setting shown in the second reference image" — NEVER invent a different room.
4. The outro pose must be DIFFERENT from the hook (not looking at phone, different body position)
5. Focus ONLY on: pose, facial expression, emotion, body language, camera angle, lighting mood
6. Keep the prompt under 150 words
7. Style must be: realistic, candid, shot on iPhone, 9:16 vertical

OUTPUT: Return ONLY the prompt text, nothing else. No quotes, no explanation.`;

// ═══════════════════════════════════════
// User message expressions (n8n expressions referencing Prepare Production)
// ═══════════════════════════════════════
const HOOK_USER_MSG = `={{ "Generate a kie.ai image prompt for the HOOK shot.\\n\\nToxicity score: " + String($('Prepare Production').first().json.scenarioJson?.overallScore ?? 50) + "/100 (lower = more toxic)\\nVibe: " + String($('Prepare Production').first().json.scenarioJson?.vibe ?? 'unknown') + "\\nSummary: " + String($('Prepare Production').first().json.scenarioJson?.chatSummary ?? 'no summary available').slice(0, 400) + "\\nEnvironment ref frame: " + ($('Prepare Production').first().json.bodyClips?.length > 0 ? 'YES (second reference image shows the room)' : 'NO (describe a cozy bedroom setting)') }}`;

const OUTRO_USER_MSG = `={{ "Generate a kie.ai image prompt for the OUTRO shot.\\n\\nToxicity score: " + String($('Prepare Production').first().json.scenarioJson?.overallScore ?? 50) + "/100 (lower = more toxic)\\nVibe: " + String($('Prepare Production').first().json.scenarioJson?.vibe ?? 'unknown') + "\\nSummary: " + String($('Prepare Production').first().json.scenarioJson?.chatSummary ?? 'no summary available').slice(0, 400) + "\\nHook image available as ref: YES (second reference image shows the room from hook shot)" }}`;

// ═══════════════════════════════════════
// 1. Define new nodes
// ═══════════════════════════════════════

const hookAgentId = uuid();
const hookModelId = uuid();
const outroAgentId = uuid();
const outroModelId = uuid();

const newNodes = [
  // --- HOOK PROMPT AGENT ---
  {
    parameters: {
      text: HOOK_USER_MSG,
      options: {
        systemMessage: HOOK_SYSTEM_PROMPT,
      },
    },
    id: hookAgentId,
    name: 'Hook Prompt Agent',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [-830, -1000],
  },
  // DeepSeek model for hook (OpenAI-compatible)
  {
    parameters: {
      model: 'deepseek-chat',
      options: {
        baseURL: 'https://api.deepseek.com',
        temperature: 0.8,
        maxTokens: 300,
      },
    },
    id: hookModelId,
    name: 'DeepSeek Hook',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.2,
    position: [-830, -1200],
  },

  // --- OUTRO PROMPT AGENT ---
  {
    parameters: {
      text: OUTRO_USER_MSG,
      options: {
        systemMessage: OUTRO_SYSTEM_PROMPT,
      },
    },
    id: outroAgentId,
    name: 'Outro Prompt Agent',
    type: '@n8n/n8n-nodes-langchain.agent',
    typeVersion: 1.7,
    position: [540, -1000],
  },
  // DeepSeek model for outro
  {
    parameters: {
      model: 'deepseek-chat',
      options: {
        baseURL: 'https://api.deepseek.com',
        temperature: 0.8,
        maxTokens: 300,
      },
    },
    id: outroModelId,
    name: 'DeepSeek Outro',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.2,
    position: [540, -1200],
  },
];

// Add nodes
for (const node of newNodes) {
  workflow.nodes.push(node);
  console.log('Added node: ' + node.name);
}

// ═══════════════════════════════════════
// 2. Shift existing nodes right to make room
// ═══════════════════════════════════════
const shiftMap = {
  'Generate Hook': [-608, -1000],       // keep position
  'Hook Needs Approval?': [-380, -1000],
  'Wait Hook Approval': [-160, -1100],
  'Hook Approved?': [60, -1100],
  'Generate VO': [280, -1000],
  'VO Needs Approval?': [500, -1000],
  'Wait VO Approval': [720, -1100],
  'VO Approved?': [940, -1100],
  'Generate Outro': [1380, -1000],      // shifted right to make room for Outro Prompt Agent
  'Outro Needs Approval?': [1600, -1000],
  'Wait Outro Approval': [1820, -1100],
  'Outro Approved?': [2040, -1100],
  'Download Assets': [2260, -1000],
  'Assemble Video': [2480, -1000],
  'Assembly Error?': [2700, -800],
  'Send Assembly Error': [2920, -700],
  'Send Final Video': [2920, -1000],
  'Update Run Complete': [3140, -1000],
  'Done Message': [3360, -1000],
};

for (const node of workflow.nodes) {
  if (shiftMap[node.name]) {
    node.position = shiftMap[node.name];
    console.log('Repositioned: ' + node.name + ' → [' + node.position + ']');
  }
}

// Position prompt agents
for (const node of workflow.nodes) {
  if (node.name === 'Hook Prompt Agent') node.position = [-830, -1000];
  if (node.name === 'DeepSeek Hook') node.position = [-830, -1200];
  if (node.name === 'Outro Prompt Agent') node.position = [1160, -1000];
  if (node.name === 'DeepSeek Outro') node.position = [1160, -1200];
}

// ═══════════════════════════════════════
// 3. Rewire main connections
// ═══════════════════════════════════════
const conn = (node, index = 0) => ({ node, type: 'main', index });

// HOOK: Create Video Run → Hook Prompt Agent → Generate Hook
workflow.connections['Create Video Run'] = { main: [[conn('Hook Prompt Agent')]] };
workflow.connections['Hook Prompt Agent'] = { main: [[conn('Generate Hook')]] };

// Hook redo: Hook Approved? false → Hook Prompt Agent (regenerate prompt)
workflow.connections['Hook Approved?'] = {
  main: [
    [conn('Generate VO')],           // true: approved → continue
    [conn('Hook Prompt Agent')],     // false: redo → regenerate prompt + image
  ]
};

// OUTRO: VO paths → Outro Prompt Agent → Generate Outro
workflow.connections['VO Needs Approval?'] = {
  main: [
    [conn('Wait VO Approval')],       // true: needs approval
    [conn('Outro Prompt Agent')],     // false: skip VO approval → outro prompt
  ]
};
workflow.connections['VO Approved?'] = {
  main: [
    [conn('Outro Prompt Agent')],     // true: approved → outro prompt
    [conn('Generate VO')],            // false: redo VO
  ]
};
workflow.connections['Outro Prompt Agent'] = { main: [[conn('Generate Outro')]] };

// Outro redo: Outro Approved? false → Outro Prompt Agent (regenerate prompt)
workflow.connections['Outro Approved?'] = {
  main: [
    [conn('Download Assets')],        // true: approved → continue
    [conn('Outro Prompt Agent')],     // false: redo → regenerate prompt + image
  ]
};

// ═══════════════════════════════════════
// 4. Sub-node connections (ai_languageModel)
// ═══════════════════════════════════════
// DeepSeek model → Agent (language model connection)
workflow.connections['DeepSeek Hook'] = {
  ai_languageModel: [
    [{ node: 'Hook Prompt Agent', type: 'ai_languageModel', index: 0 }]
  ]
};
workflow.connections['DeepSeek Outro'] = {
  ai_languageModel: [
    [{ node: 'Outro Prompt Agent', type: 'ai_languageModel', index: 0 }]
  ]
};

// ═══════════════════════════════════════
// 5. Write result
// ═══════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Added 4 nodes (2 AI Agents + 2 DeepSeek Models).');
console.log('Total nodes: ' + workflow.nodes.length);
console.log('\n⚠️  IMPORTANT: After importing, set the DeepSeek credential on "DeepSeek Hook" and "DeepSeek Outro" model nodes in n8n UI.');
console.log('Create an OpenAI credential with your DeepSeek API key and base URL: https://api.deepseek.com');
