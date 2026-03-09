// NODE: Queue Next Scenario
// After /day or /night saves clips, auto-presents the next approved scenario.
// If next scenario exists ' sets recording state + returns instructions (hasNext=true)
// If no scenarios in queue ' returns "generating..." message (hasNext=false)
// Mode: Run Once for All Items
//
// WIRING: Find Next Approved (Airtable Search) ' this Code node '
//   IF hasNext ' Send Queue Msg (recording instructions)
//   ELSE ' Send Queue Msg ("generating..." or "all done")
//
// Input: Airtable search result for next approved scenario (may be empty)

// Helper: "toxic-sad-happy-girl-1771197483216" ' "Toxic Sad Happy Girl"
function formatName(raw) {
  if (!raw) return 'Scenario';
  return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const staticData = $getWorkflowStaticData('global');

// Handle Done path OR Set Time of Day path " try both
let chatId, prevScenario, prevClipCount, timeLabel;
try {
  const src = $('Set Time of Day').first().json;
  chatId = src.chatId;
  prevScenario = formatName(src.scenarioName);
  prevClipCount = src.clipCount;
  timeLabel = src.timeLabel || (src.timeOfDay === 'night' ? ' Night' : 'ï? Day');
} catch(e) {
  const src = $('Handle Done').first().json;
  chatId = src.chatId;
  prevScenario = formatName(src.scenarioName);
  prevClipCount = src.clipCount;
  timeLabel = null;
}

// Check if Airtable returned a next scenario
const items = $input.all();
const nextScenario = (items.length > 0 && items[0].json && items[0].json.id) ? items[0].json : null;

// Build saved confirmation
const timePart = timeLabel ? ' " ' + timeLabel : '';
const savedMsg = '... ' + prevClipCount + ' clip' + timePart + ' salvate per "' + prevScenario + '".';

if (nextScenario) {
  // Auto-present the next scenario for recording
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

  // Set up recording state for the next scenario
  staticData.activeRecording = {
    scenarioName,
    chatId,
    scenarioRecordId,
    expectedClips: bodySegments,
    receivedCount: 0,
  };

  let nextMsg = savedMsg + '\n\n';
  nextMsg += ' Prossimo: "' + displayName + '"\n\n';
  nextMsg += 'Registra queste body clip:\n\n';
  bodySegments.forEach((seg, i) => {
    nextMsg += '  ' + (i + 1) + '. ' + seg.label + ' (~' + seg.duration + 's)\n';
  });
  nextMsg += '\nManda i video senza caption.\n';
  nextMsg += '' /done quando hai finito.';

  return [{
    json: {
      hasNext: true,
      chatId,
      scenarioName,
      scenarioRecordId,
      message: nextMsg,
    }
  }];
}

// No scenarios in queue
return [{
  json: {
    hasNext: false,
    chatId,
    message: savedMsg + '\n\n" Nessuno scenario in coda. Il generatore li creer  automaticamente.\nUsa /next per controllare.',
  }
}];
