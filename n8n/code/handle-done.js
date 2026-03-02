// NODE: Handle Done Recording
// When user sends /done, marks current scenario as recorded (NOT production).
// Production runs separately on a schedule (Monday-Sunday).
// Clears recording state from workflow static data.
// Mode: Run Once for All Items
//
// WIRING: Switch (done_recording) → this Code node →
//   IF error → Telegram Send (error message)
//   ELSE → Update Scenario Recorded (Airtable) → Find Next Approved (Airtable) → Queue Next Scenario (Code) → Telegram

const staticData = $getWorkflowStaticData('global');
const input = $input.first().json;

// ─── No active recording? ───
if (!staticData.activeRecording) {
  return [{
    json: {
      error: true,
      chatId: input.chatId,
      message: '⚠️ Nessuna registrazione attiva.',
    }
  }];
}

// Helper: "toxic-sad-happy-girl-1771197483216" → "Toxic Sad Happy Girl"
function formatName(raw) {
  if (!raw) return 'Scenario';
  return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const rec = staticData.activeRecording;
const scenarioName = rec.scenarioName;
const scenarioRecordId = rec.scenarioRecordId;
const receivedCount = rec.receivedCount;

// Need at least 1 clip — keep session active so user can retry
if (receivedCount === 0) {
  return [{
    json: {
      error: true,
      chatId: input.chatId,
      message: '⚠️ Non hai mandato nessuna body clip. Registra almeno un video prima di /done.',
    }
  }];
}

// Keep recording state alive — user must confirm /day or /night before clearing
staticData.activeRecording.clipCount = receivedCount;

// Ask user to specify day or night for the hook image lighting
return [{
  json: {
    error: true,
    askingTimeOfDay: true,
    chatId: input.chatId,
    message: '✅ ' + receivedCount + ' clip ricevute.\n\nHai registrato di giorno o di notte?\n\n☀️ /day  —  🌙 /night',
  }
}];
