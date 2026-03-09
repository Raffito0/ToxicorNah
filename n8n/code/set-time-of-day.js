// NODE: Set Time of Day
// After /done asks "day or night?", user replies /day or /night.
// DAY: clears state, outputs scenario info for Airtable update.
// NIGHT: asks LED color via inline keyboard. Callback handler completes the flow.
// Mode: Run Once for All Items
//
// WIRING: Switch (set_time_of_day) â†’ this Code node â†’
//   IF askingLed â†’ Send LED Question (Telegram with inline keyboard)
//   ELSE â†’ Update Scenario Recorded (Airtable chain)

// Helper: "toxic-sad-happy-girl-1771197483216" â†’ "Toxic Sad Happy Girl"
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
      message: 'âš ï¸? Nessuna registrazione attiva. Manda /done prima di specificare giorno o notte.',
    }
  }];
}

const rec = staticData.activeRecording;
const scenarioName = rec.scenarioName;
const scenarioRecordId = rec.scenarioRecordId;
const clipCount = rec.clipCount || rec.receivedCount || 0;

if (timeOfDay === 'night') {
  // Don't clear state yet â€” wait for LED color answer
  staticData.activeRecording.timeOfDay = 'night';
  return [{
    json: {
      askingLed: true,
      chatId: input.chatId,
      scenarioRecordId,
      message: 'ðŸŒ™ Night â€” che LED hai usato?',
    }
  }];
}

// DAY â€” complete immediately
staticData.activeRecordingTimeOfDay = timeOfDay;
delete staticData.activeRecording;

return [{
  json: {
    scenarioName,
    scenarioRecordId,
    chatId: input.chatId,
    clipCount,
    timeOfDay,
    ledColor: '',
    timeLabel: 'â˜€ï¸? Day',
    message: 'âœ… ' + clipCount + ' clip â€” â˜€ï¸? Day â€” salvate per "' + formatName(scenarioName) + '".\n\nâ?³ Generando hook image...',
  }
}];
