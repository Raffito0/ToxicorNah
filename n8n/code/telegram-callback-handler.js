// NODE: Handle Telegram Callback (for the companion workflow)
// Parses the callback_data from inline keyboard button press
// Mode: Run Once for All Items

const update = $input.first().json;

// Telegram sends callback_query with data like "approve_toxic-sad-happy-girl-1707600000"
const callbackData = update.callback_query
  ? update.callback_query.data
  : (update.data || '');

const callbackQueryId = update.callback_query
  ? update.callback_query.id
  : '';

const chatId = update.callback_query
  ? update.callback_query.message.chat.id
  : '';

// Parse action and scenario name
const parts = callbackData.split('_');
const action = parts[0]; // "approve", "redo", or "skip"
const scenarioName = parts.slice(1).join('_'); // rest is the scenario name

// Map action to Airtable status
let newStatus = '';
let responseText = '';
switch (action) {
  case 'approve':
    newStatus = 'approved';
    responseText = '\u2705 Scenario "' + scenarioName + '" approved!';
    break;
  case 'redo':
    newStatus = 'draft';
    responseText = '\u{1F504} Scenario "' + scenarioName + '" marked for regeneration.';
    break;
  case 'skip':
    newStatus = 'skipped';
    responseText = '\u274C Scenario "' + scenarioName + '" skipped.';
    break;
  default:
    newStatus = '';
    responseText = '\u2753 Unknown action: ' + action;
}

return [{
  json: {
    action,
    scenarioName,
    newStatus,
    responseText,
    callbackQueryId,
    chatId
  }
}];
