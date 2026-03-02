// NODE: Queue Next Scenario
// After /done saves clips, this node checks if there's another approved scenario to record.
// If yes → sets recording state + returns instructions message
// If no → returns "all done" message
// Mode: Run Once for All Items
//
// WIRING: Find Next Approved (Airtable Search) → this Code node →
//   IF hasNext → Send Next Recording Msg (Telegram)
//   ELSE → Send All Done Msg (Telegram)
//
// Input: Airtable search result for next approved scenario (may be empty)

// Helper: "toxic-sad-happy-girl-1771197483216" → "Toxic Sad Happy Girl"
function formatName(raw) {
  if (!raw) return 'Scenario';
  return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const staticData = $getWorkflowStaticData('global');

// Handle Done path OR Set Time of Day path — try both
let chatId, prevScenario, prevClipCount, timeLabel;
try {
  const src = $('Set Time of Day').first().json;
  chatId = src.chatId;
  prevScenario = formatName(src.scenarioName);
  prevClipCount = src.clipCount;
  timeLabel = src.timeLabel || (src.timeOfDay === 'night' ? '🌙 Night' : '☀️ Day');
} catch(e) {
  const src = $('Handle Done').first().json;
  chatId = src.chatId;
  prevScenario = formatName(src.scenarioName);
  prevClipCount = src.clipCount;
  timeLabel = null;
}

// Check if Airtable returned a next scenario
const items = $input.all();
const nextScenario = items.length > 0 ? items[0].json : null;

// Build message — include timeLabel if available (set_time_of_day path)
const timePart = timeLabel ? ' — ' + timeLabel : '';
return [{
  json: {
    hasNext: false,
    chatId,
    message: '✅ ' + prevClipCount + ' clip' + timePart + ' salvate per "' + prevScenario + '".\n\n👉 /next quando vuoi iniziare un altro scenario.',
  }
}];
