// NODE: Send Recording Instructions
// After scenario approval, tells the user which body clips to record
// Stores recording state in workflow static data (activeRecording)
// Mode: Run Once for All Items
//
// WIRING: After Save to Supabase (approve branch) ' this Code node ' Telegram Send Message
//         Also wire to: Airtable Update Scenario (set status = 'recording')
//
// The Telegram Send node should use {{ $json.message }} as text and {{ $json.chatId }} as chat ID.
// The Airtable Update node should set status = 'recording' for record {{ $json.scenarioRecordId }}.

const staticData = $getWorkflowStaticData('global');

// Helper: "toxic-sad-happy-girl-1771197483216" ' "Toxic Sad Happy Girl"
function formatName(raw) {
  if (!raw) return 'Scenario';
  return raw.replace(/-\d{10,}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Get data from approval flow
const supabaseResult = $('Save to Supabase').first().json;

// scenarioName: try multiple sources
let scenarioName = supabaseResult.scenarioName;
if (!scenarioName) {
  try { scenarioName = $('Find Scenario (Callback)').first().json.scenario_name; } catch(e) {}
}
if (!scenarioName) {
  try { scenarioName = $('Parse Callback').first().json.scenarioName; } catch(e) {}
}

// chatId: try multiple sources
let chatId;
try { chatId = $('Parse Callback').first().json.chatId; } catch(e) {}
if (!chatId) chatId = supabaseResult.chatId || '';

// Scenario record ID for Airtable status update
let scenarioRecordId = '';
try {
  const scenarioRecord = $('Find Scenario (Callback)').first().json;
  scenarioRecordId = scenarioRecord.id || '';
} catch(e) {}

// """ Body segments (Standard template " covers most concepts) """
// These describe what the user needs to record on their phone screen
const bodySegments = [
  { section: 'screenshot', duration: 1, label: 'Screenshot della chat' },
  { section: 'upload_chat', duration: 1, label: 'Upload chat (caricamento)' },
  { section: 'toxic_score', duration: 3, label: 'Toxic score reveal' },
  { section: 'soul_type', duration: 3, label: 'Soul type card' },
  { section: 'deep_dive', duration: 3, label: 'Deep dive (categorie)' },
];

// Store recording state
staticData.activeRecording = {
  scenarioName,
  chatId,
  scenarioRecordId,
  expectedClips: bodySegments,
  receivedCount: 0,
};

// Read timeOfDay from static data (stored during /produce flow)
const timeOfDay = staticData.activeRecordingTimeOfDay || 'day';
const timeLabel = timeOfDay === 'night' ? ' Night' : 'ï? Day';

// Build Telegram message
const displayName = formatName(scenarioName);
let msg = ' "' + displayName + '" approvato! ' + timeLabel + '\n\n';
msg += 'Registra queste body clip in ordine:\n\n';
bodySegments.forEach((seg, i) => {
  msg += '  ' + (i + 1) + '. ' + seg.label + ' (~' + seg.duration + 's)\n';
});
msg += '\nManda i video uno alla volta, senza caption.\n';
msg += '/done quando hai finito.';

return [{
  json: {
    message: msg,
    chatId,
    scenarioName,
    scenarioRecordId,
    newStatus: 'recording',
  }
}];
