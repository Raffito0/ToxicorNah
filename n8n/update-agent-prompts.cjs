// Update AI Agent nodes to read system prompt from Airtable (via Prepare Production)
// Run: node update-agent-prompts.cjs

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'unified-pipeline-fixed.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Default system prompts (used when Airtable field is empty)
const DEFAULT_HOOK_PROMPT = `You are an expert at writing image generation prompts for kie.ai (Nano Banana Pro model).
You write prompts for TikTok videos that analyze toxic/healthy relationship chats.

The image shows a girl reacting to a chat conversation on her phone — this is the HOOK (opening shot).

HOW KIE.AI WORKS:
- Image reference #1 = girl photo (her appearance). The model will try to COPY this photo exactly.
- Image reference #2 = environment frame (room she's in). The model uses this for the setting.
- Your prompt tells the model WHAT TO CHANGE from the reference — especially camera angle and pose.

YOUR JOB: Write a prompt that forces kie.ai to generate a NEW composition, NOT a copy of the girl reference photo.

TO PREVENT COPYING, you MUST:
1. Describe a SPECIFIC camera angle that is DIFFERENT from a standard front-facing shot. Pick ONE:
   - "Low angle shot from floor level, looking up at the girl"
   - "Close-up shot from slightly above, looking down at her face and phone"
   - "Side profile shot from 45 degrees to her left/right"
   - "Wide shot from across the room showing her full environment"
   - "Over-the-shoulder shot from behind, showing her phone screen glowing"
2. Describe a SPECIFIC body pose: hunched forward, curled up, legs crossed, leaning sideways, one hand on face, etc.
3. Describe a SPECIFIC emotion through facial expression and body language

ABSOLUTE RULES:
1. NEVER describe the girl's appearance (hair, face, body, clothes, skin, age). She is provided as reference image.
2. NEVER use "The same exact girl in the reference image" — this causes copying. Start with the camera angle instead.
3. The girl is in the same room as the environment frame — say "in the same room" ONCE, then focus on angle/pose.
4. The girl MUST be holding/looking at her phone
5. Keep the prompt under 120 words
6. End with: "Realistic, candid, shot on iPhone, 9:16 vertical"

OUTPUT: Return ONLY the prompt text, nothing else. No quotes, no explanation.`;

const DEFAULT_OUTRO_PROMPT = `You are an expert at writing image generation prompts for kie.ai (Nano Banana Pro model).
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

// Escape for n8n expression (backticks and dollar signs)
function escapeForExpression(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

for (const node of workflow.nodes) {
  if (node.name === 'Hook Prompt Agent') {
    // Use Airtable system prompt if available, otherwise default
    node.parameters.options.systemMessage =
      `={{ $('Prepare Production').first().json.hookImageSystemPrompt || '${escapeForExpression(DEFAULT_HOOK_PROMPT)}' }}`;
    console.log('Updated: Hook Prompt Agent systemMessage → reads from Airtable (with default fallback)');
  }
  if (node.name === 'Outro Prompt Agent') {
    node.parameters.options.systemMessage =
      `={{ $('Prepare Production').first().json.outroImageSystemPrompt || '${escapeForExpression(DEFAULT_OUTRO_PROMPT)}' }}`;
    console.log('Updated: Outro Prompt Agent systemMessage → reads from Airtable (with default fallback)');
  }
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('\nDone! System prompts now read from Airtable fields:');
console.log('  - hook_image_system_prompt (on Video Concepts)');
console.log('  - outro_image_system_prompt (on Video Concepts)');
console.log('If fields are empty, hardcoded defaults are used.');
