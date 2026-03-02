// NODE: Handle Auto Body Clip
// When user sends a video without caption during active recording session.
// Reads state from workflow static data, auto-numbers the clip.
// Mode: Run Once for All Items
//
// WIRING: Switch (auto_body_clip) → this Code node → Save Body Clip (Airtable Create) → Send Confirmation (Telegram)
//
// Airtable Create node should map:
//   clip_name     → {{ $json.clipName }}
//   scenario_id   → {{ [$json.scenarioRecordId] }}   (linked record — must be array)
//   clip_index    → {{ $json.clipIndex }}
//   telegram_file_id → {{ $json.fileId }}
//   clip_duration_sec → {{ $json.duration }}
//   clip_type     → {{ $json.clipType }}
//   section       → {{ $json.section }}
//   status        → uploaded
//
// Telegram Send node should use {{ $json.confirmMessage }} as text.

const staticData = $getWorkflowStaticData('global');
const input = $input.first().json;

// ─── No active recording? ───
if (!staticData.activeRecording) {
  return [{
    json: {
      error: true,
      chatId: input.chatId,
      message: '⚠️ Nessuna registrazione attiva. Approva prima uno scenario.',
    }
  }];
}

const rec = staticData.activeRecording;
const clipIndex = rec.receivedCount + 1;
const expected = rec.expectedClips || [];
const totalExpected = expected.length;
const segment = expected[rec.receivedCount] || {};

// Increment counter
rec.receivedCount = clipIndex;

// Build clip data for Airtable
const clipName = rec.scenarioName + '_body_' + clipIndex;
const section = segment.section || 'body_' + clipIndex;
const sectionLabel = segment.label || section;

// Confirmation message
let confirm = '✅ Clip ' + clipIndex + '/' + totalExpected + ' (' + sectionLabel + ')';
if (clipIndex >= totalExpected) {
  confirm += '\n\n✅ Tutte le clip ricevute! Manda /done per avviare la produzione.';
} else {
  const nextSeg = expected[clipIndex];
  if (nextSeg) {
    confirm += '\n\n👉 Prossima: ' + (clipIndex + 1) + '. ' + nextSeg.label;
  }
}

return [{
  json: {
    clipName,
    scenarioName: rec.scenarioName,
    scenarioRecordId: rec.scenarioRecordId,
    clipIndex,
    section,
    fileId: input.fileId,
    duration: input.duration,
    clipType: 'body',
    chatId: input.chatId,
    confirmMessage: confirm,
    allReceived: clipIndex >= totalExpected,
  }
}];
