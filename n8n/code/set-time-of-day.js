// NODE: Set Time of Day
// After /done asks "day or night?", user replies /day or /night.
// Stores timeOfDay in static data, clears active recording, outputs
// scenario info for the Airtable update chain.
// Mode: Run Once for All Items
//
// WIRING: Switch (set_time_of_day) → this Code node → Update Scenario Recorded
//         (same Airtable chain as Handle Done success path)

// Helper: "toxic-sad-happy-girl-1771197483216" → "Toxic Sad Happy Girl"
function formatName(raw) {
  if (!raw) return 'Scenario';
  return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const staticData = $getWorkflowStaticData('global');
const input = $input.first().json;
const timeOfDay = input.timeOfDay || 'day';

if (!staticData.activeRecording) {
  return [{
    json: {
      error: true,
      chatId: input.chatId,
      message: '⚠️ Nessuna registrazione attiva. Manda /done prima di specificare giorno o notte.',
    }
  }];
}

const rec = staticData.activeRecording;
const scenarioName = rec.scenarioName;
const scenarioRecordId = rec.scenarioRecordId;
const clipCount = rec.clipCount || rec.receivedCount || 0;

// Store timeOfDay for use during production (generate-hook reads this)
staticData.activeRecordingTimeOfDay = timeOfDay;

// Clear recording state — user is done
delete staticData.activeRecording;

const timeLabel = timeOfDay === 'night' ? '🌙 Night' : '☀️ Day';

return [{
  json: {
    scenarioName,
    scenarioRecordId,
    chatId: input.chatId,
    clipCount,
    timeOfDay,
    timeLabel,
    // Queue Next Scenario reads this message
    message: '✅ ' + clipCount + ' clip — ' + timeLabel + ' — salvate per "' + formatName(scenarioName) + '".\n\n👉 /next quando vuoi iniziare un altro scenario.',
  }
}];
