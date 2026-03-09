// NODE: Start Next Scenario
// When user sends /next, finds the next approved scenario and sets up recording state.
// If already recording, tells user to /done first.
// Mode: Run Once for All Items
//
// WIRING: Switch (start_next) -> Find Next Approved (Airtable) -> this Code node ->
//   IF error -> Telegram Send (error)
//   ELSE -> Telegram Send (recording instructions)

// Helper: "toxic-sad-happy-girl-1771197483216" -> "Toxic Sad Happy Girl"
function formatName(raw) {
  if (!raw) return 'Scenario';
  return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const staticData = $getWorkflowStaticData('global');
const chatId = $('Parse Message').first().json.chatId;

// Already recording? Tell user to /done first
if (staticData.activeRecording) {
  const currentName = formatName(staticData.activeRecording.scenarioName);
  return [{
    json: {
      error: true,
      chatId,
      message: '⚠️ Stai già registrando "' + currentName + '".\nManda /done prima di passare al prossimo.',
    }
  }];
}

// Check Airtable result for next approved scenario
const items = $input.all();
const nextScenario = items.length > 0 ? items[0].json : null;

if (!nextScenario || !nextScenario.id) {
  return [{
    json: {
      error: true,
      chatId,
      message: '📋 Nessuno scenario approvato in coda.\nGenera nuovi scenari prima.',
    }
  }];
}

// Set up recording state
const scenarioName = nextScenario.scenario_name;
const scenarioRecordId = nextScenario.id;
const displayName = formatName(scenarioName);

const bodySegments = [
  { section: 'screenshot', duration: 1, label: 'Screenshot della chat' },
  { section: 'upload_chat', duration: 1, label: 'Upload chat (caricamento)' },
  { section: 'toxic_score', duration: 3, label: 'Toxic score reveal' },
  { section: 'soul_type', duration: 3, label: 'Soul type card' },
  { section: 'deep_dive', duration: 3, label: 'Deep dive (categorie)' },
];

staticData.activeRecording = {
  scenarioName,
  chatId,
  scenarioRecordId,
  expectedClips: bodySegments,
  receivedCount: 0,
};

let msg = '🎬 Scenario: "' + displayName + '"\n\n';
msg += 'Registra queste body clip:\n\n';
bodySegments.forEach((seg, i) => {
  msg += '  ' + (i + 1) + '. ' + seg.label + ' (~' + seg.duration + 's)\n';
});
msg += '\nManda i video senza caption.\n';
msg += '👉 /done quando hai finito.';

return [{
  json: {
    chatId,
    scenarioName,
    scenarioRecordId,
    message: msg,
  }
}];
