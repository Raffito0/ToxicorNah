// Add native Telegram nodes for approval previews (hook image, VO audio, outro image)
// Replaces the fetch()-based Telegram sends inside Code nodes
// Run: node add-telegram-previews.cjs

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const uuid = () => crypto.randomUUID();

const TELEGRAM_CRED = {
  telegramApi: {
    id: 'pyWK5SqqdZeXs1WU',
    name: 'Telegram account',
  },
};

// ═══════════════════════════════════════
// 1. Remove old preview nodes if they exist (idempotent)
// ═══════════════════════════════════════
const previewNames = ['Send Hook Preview', 'Send VO Preview', 'Send Outro Preview'];
workflow.nodes = workflow.nodes.filter(n => !previewNames.includes(n.name));
for (const name of previewNames) {
  delete workflow.connections[name];
}
console.log('Cleaned up any existing preview nodes.');

// ═══════════════════════════════════════
// 2. Define new Telegram preview nodes
// ═══════════════════════════════════════

// --- SEND HOOK PREVIEW (sendPhoto with hookImage binary + inline keyboard) ---
const sendHookPreviewNode = {
  parameters: {
    operation: 'sendPhoto',
    chatId: '={{ $json.chatId }}',
    binaryData: true,
    binaryPropertyName: 'hookImage',
    additionalFields: {
      caption: '={{ "🎨 Hook image for \\"" + $json.scenarioName + "\\"\\n\\nPrompt: " + ($json.hookPromptUsed || "template").substring(0, 200) }}',
    },
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: {
      rows: [
        {
          row: {
            buttons: [
              {
                text: '✅ Approve',
                additionalFields: {
                  callback_data: "={{ 'vpApprove_' + $execution.id + '_hook_img' }}",
                },
              },
              {
                text: '🔄 Redo',
                additionalFields: {
                  callback_data: "={{ 'vpRedo_' + $execution.id + '_hook_img' }}",
                },
              },
            ],
          },
        },
      ],
    },
  },
  id: uuid(),
  name: 'Send Hook Preview',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [-160, -1280],
  credentials: TELEGRAM_CRED,
};

// --- SEND VO PREVIEW (sendVoice with voAudio binary + inline keyboard) ---
const sendVoPreviewNode = {
  parameters: {
    operation: 'sendAudio',
    chatId: '={{ $json.chatId }}',
    binaryData: true,
    binaryPropertyName: 'voAudio',
    additionalFields: {
      caption: '={{ "🎤 Voiceover for \\"" + $json.scenarioName + "\\"\\n\\n" + ($json.voText || "").substring(0, 300) }}',
    },
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: {
      rows: [
        {
          row: {
            buttons: [
              {
                text: '✅ Approve',
                additionalFields: {
                  callback_data: "={{ 'vpApprove_' + $execution.id + '_vo' }}",
                },
              },
              {
                text: '🔄 Redo',
                additionalFields: {
                  callback_data: "={{ 'vpRedo_' + $execution.id + '_vo' }}",
                },
              },
            ],
          },
        },
      ],
    },
  },
  id: uuid(),
  name: 'Send VO Preview',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [720, -1280],
  credentials: TELEGRAM_CRED,
};

// --- SEND OUTRO PREVIEW (sendPhoto with outroImage binary + inline keyboard) ---
const sendOutroPreviewNode = {
  parameters: {
    operation: 'sendPhoto',
    chatId: '={{ $json.chatId }}',
    binaryData: true,
    binaryPropertyName: 'outroImage',
    additionalFields: {
      caption: '={{ "🎬 Outro image for \\"" + $json.scenarioName + "\\" (" + ($json.outroLabel || "ai") + ")\\n\\nPrompt: " + ($json.outroPromptUsed || "template").substring(0, 200) }}',
    },
    replyMarkup: 'inlineKeyboard',
    inlineKeyboard: {
      rows: [
        {
          row: {
            buttons: [
              {
                text: '✅ Approve',
                additionalFields: {
                  callback_data: "={{ 'vpApprove_' + $execution.id + '_outro_img' }}",
                },
              },
              {
                text: '🔄 Redo',
                additionalFields: {
                  callback_data: "={{ 'vpRedo_' + $execution.id + '_outro_img' }}",
                },
              },
            ],
          },
        },
      ],
    },
  },
  id: uuid(),
  name: 'Send Outro Preview',
  type: 'n8n-nodes-base.telegram',
  typeVersion: 1.2,
  position: [1820, -1280],
  credentials: TELEGRAM_CRED,
};

// Add nodes
workflow.nodes.push(sendHookPreviewNode, sendVoPreviewNode, sendOutroPreviewNode);
console.log('Added: Send Hook Preview, Send VO Preview, Send Outro Preview');

// ═══════════════════════════════════════
// 3. Rewire connections
// ═══════════════════════════════════════
const conn = (node, index = 0) => ({ node, type: 'main', index });

// Hook Needs Approval? → true → Send Hook Preview → Wait Hook Approval
// Hook Needs Approval? → false → skip to next (Generate VO)
workflow.connections['Hook Needs Approval?'] = {
  main: [
    [conn('Send Hook Preview')],   // true: needs approval → send preview
    [conn('Generate VO')],          // false: skip approval
  ],
};
workflow.connections['Send Hook Preview'] = {
  main: [[conn('Wait Hook Approval')]],
};

// VO Needs Approval? → true → Send VO Preview → Wait VO Approval
// VO Needs Approval? → false → skip to Outro Prompt Agent
workflow.connections['VO Needs Approval?'] = {
  main: [
    [conn('Send VO Preview')],          // true: needs approval → send preview
    [conn('Outro Prompt Agent')],       // false: skip → outro
  ],
};
workflow.connections['Send VO Preview'] = {
  main: [[conn('Wait VO Approval')]],
};

// Outro Needs Approval? → true → Send Outro Preview → Wait Outro Approval
// Outro Needs Approval? → false → skip to Download Assets
workflow.connections['Outro Needs Approval?'] = {
  main: [
    [conn('Send Outro Preview')],       // true: needs approval → send preview
    [conn('Download Assets')],          // false: skip → download
  ],
};
workflow.connections['Send Outro Preview'] = {
  main: [[conn('Wait Outro Approval')]],
};

// ═══════════════════════════════════════
// 4. Write result
// ═══════════════════════════════════════
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! Added 3 native Telegram preview nodes.');
console.log('Total nodes: ' + workflow.nodes.length);
console.log('\nFlow:');
console.log('  Hook:  Generate Hook → Hook Needs Approval? → Send Hook Preview → Wait Hook Approval');
console.log('  VO:    Generate VO → VO Needs Approval? → Send VO Preview → Wait VO Approval');
console.log('  Outro: Generate Outro → Outro Needs Approval? → Send Outro Preview → Wait Outro Approval');
