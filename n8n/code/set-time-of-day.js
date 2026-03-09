// NODE: Set Time of Day
// After /done asks "day or night?", user replies /day or /night.
// DAY: clears state, outputs scenario info for Airtable update.
// NIGHT: asks LED color via inline keyboard. Callback handler completes the flow.
// Mode: Run Once for All Items
//
// WIRING: Switch (set_time_of_day) ' this Code node '
//   IF askingLed ' Send LED Question (Telegram with inline keyboard)
//   ELSE ' Update Scenario Recorded (Airtable chain)

// Helper: "toxic-sad-happy-girl-1771197483216" ' "Toxic Sad Happy Girl"
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
      message: ' ï? Nessuna registrazione attiva. Manda /done prima di specificare giorno o notte.',
    }
  }];
}

const rec = staticData.activeRecording;
const scenarioName = rec.scenarioName;
const scenarioRecordId = rec.scenarioRecordId;
const clipCount = rec.clipCount || rec.receivedCount || 0;

if (timeOfDay === 'night') {
  // Don't clear state yet " wait for LED color answer
  staticData.activeRecording.timeOfDay = 'night';
  return [{
    json: {
      askingLed: true,
      chatId: input.chatId,
      scenarioRecordId,
      message: ' Night " che LED hai usato?',
    }
  }];
}

// DAY " complete immediately
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
    timeLabel: 'ï? Day',
    message: '... ' + clipCount + ' clip " ï? Day " salvate per "' + formatName(scenarioName) + '".\n\n?³ Generando hook image...',
  }
}];
