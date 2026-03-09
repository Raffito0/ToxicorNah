// NODE: Save Clip (unified handler for body/hook/outro)
// Prepares the Airtable record for any clip type uploaded via Telegram
// Mode: Run Once for All Items
//
// WIRING: Parse Message â†’ Route Message (Switch) â†’ Find Scenario â†’ this Code node â†’ Airtable Create â†’ Telegram confirm
//
// Input: parsed message data from Parse Message + scenario record from Find Scenario
// Handles all 3 clip types: body_clip, hook_clip, outro_clip

const parsed = $('Parse Message').first().json;
const scenario = $('Find Scenario (Clip)').first().json;

if (!scenario || !scenario.id) {
  return [{
    json: {
      error: true,
      chatId: parsed.chatId,
      message: 'Scenario "' + parsed.scenarioName + '" not found in Airtable'
    }
  }];
}

const messageType = parsed.messageType;

// Build the Airtable record fields based on clip type
const record = {
  scenario_id: [scenario.id],
  telegram_file_id: parsed.fileId,
  clip_duration_sec: parsed.duration,
  status: 'uploaded',
};

if (messageType === 'body_clip') {
  record.clip_name = parsed.scenarioName + '_body_' + parsed.clipIndex;
  record.clip_type = 'body';
  record.clip_index = parsed.clipIndex;
  record.section = parsed.section || '';  // optional template section mapping
} else if (messageType === 'hook_clip') {
  record.clip_name = parsed.scenarioName + '_hook';
  record.clip_type = 'hook_manual';
  record.clip_index = 0;
} else if (messageType === 'outro_clip') {
  record.clip_name = parsed.scenarioName + '_outro_' + parsed.label;
  record.clip_type = 'outro_manual';
  record.clip_index = 0;
  record.label = parsed.label || '';
}

// Build confirmation message
let confirmMsg = '';
if (messageType === 'body_clip') {
  confirmMsg = '\u2705 Body clip #' + parsed.clipIndex + ' saved for "' + parsed.scenarioName + '"';
  if (parsed.section) confirmMsg += ' (section: ' + parsed.section + ')';
} else if (messageType === 'hook_clip') {
  confirmMsg = '\u2705 Hook clip saved for "' + parsed.scenarioName + '"';
} else if (messageType === 'outro_clip') {
  confirmMsg = '\u2705 Outro clip "' + parsed.label + '" saved for "' + parsed.scenarioName + '"';
}

return [{
  json: {
    ...record,
    chatId: parsed.chatId,
    scenarioName: parsed.scenarioName,
    confirmMsg,
  }
}];
