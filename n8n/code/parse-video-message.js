// NODE: Parse Video Pipeline Message
// Routes incoming Telegram messages to the correct handler:
//   - #body scenario_name clip_index [section]  → body clip upload
//   - #hook scenario_name                       → manual hook clip upload
//   - #outro scenario_name label                → manual outro clip upload
//   - /produce scenario_name [template]         → trigger video production
//   - /done                                     → finish recording (does NOT auto-start next)
//   - /next                                     → manually start recording next approved scenario
//   - video with no caption (during recording)  → auto body clip
//   - anything else                             → ignored
// Mode: Run Once for All Items
//
// WIRING: Telegram Trigger (message) → this Code node → Switch node (Route Message)
// Switch outputs: body_clip | hook_clip | outro_clip | produce | done_recording | start_next | auto_body_clip | unknown

const update = $input.first().json;
const message = update.message || update;
const text = (message.caption || message.text || '').trim();
const chatId = message.chat?.id || '';

const hasVideo = !!(message.video || message.document);
const video = message.video || message.document || {};

// ─── Static data (needed for /produce timeOfDay fallback + auto_body_clip) ───
const staticData = $getWorkflowStaticData('global');

// ─── #body scenario_name clip_index [section] ───
const bodyMatch = text.match(/#body\s+(\S+)\s+(\d+)(?:\s+(\S+))?/i);
if (hasVideo && bodyMatch) {
  return [{
    json: {
      messageType: 'body_clip',
      scenarioName: bodyMatch[1],
      clipIndex: parseInt(bodyMatch[2], 10),
      section: bodyMatch[3] || '',
      fileId: video.file_id,
      fileSize: video.file_size || 0,
      duration: video.duration || 0,
      chatId,
    }
  }];
}

// ─── #hook scenario_name ───
const hookMatch = text.match(/#hook\s+(\S+)/i);
if (hasVideo && hookMatch) {
  return [{
    json: {
      messageType: 'hook_clip',
      scenarioName: hookMatch[1],
      fileId: video.file_id,
      fileSize: video.file_size || 0,
      duration: video.duration || 0,
      chatId,
    }
  }];
}

// ─── #outro scenario_name label ───
const outroMatch = text.match(/#outro\s+(\S+)\s+(\S+)/i);
if (hasVideo && outroMatch) {
  return [{
    json: {
      messageType: 'outro_clip',
      scenarioName: outroMatch[1],
      label: outroMatch[2],
      fileId: video.file_id,
      fileSize: video.file_size || 0,
      duration: video.duration || 0,
      chatId,
    }
  }];
}

// ─── /produce [scenario_name] [night|day] — no args = next ready scenario ───
// Examples: /produce  |  /produce my-scenario  |  /produce my-scenario night  |  /produce night
if (text.match(/^\/produce/i)) {
  const parts = text.trim().split(/\s+/);
  let scenarioName = '';
  let explicitTimeOfDay = null;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].match(/^(night|day)$/i)) {
      explicitTimeOfDay = parts[i].toLowerCase();
    } else if (parts[i]) {
      scenarioName = parts[i];
    }
  }
  // Fall back to time recorded during /done → /night|/day (stored in static data)
  const timeOfDay = explicitTimeOfDay || staticData.activeRecordingTimeOfDay || 'day';
  return [{ json: { messageType: 'produce', scenarioName, timeOfDay, chatId } }];
}

// ─── /day or /night — set lighting time after /done ───
if (text.match(/^\/(day|night)$/i)) {
  const timeOfDay = text.match(/^\/night$/i) ? 'night' : 'day';
  return [{
    json: {
      messageType: 'set_time_of_day',
      timeOfDay,
      chatId,
    }
  }];
}

// ─── /done — finish recording ───
if (text.match(/^\/done$/i)) {
  const activeRec = staticData.activeRecording;
  return [{
    json: {
      messageType: 'done_recording',
      scenarioName: activeRec ? activeRec.scenarioName : '',
      chatId,
    }
  }];
}

// ─── /next — manually start recording next approved scenario ───
if (text.match(/^\/next$/i)) {
  return [{
    json: {
      messageType: 'start_next',
      chatId,
    }
  }];
}

// ─── Video with no recognized command during active recording → auto body clip ───
if (hasVideo && staticData.activeRecording) {
  return [{
    json: {
      messageType: 'auto_body_clip',
      fileId: video.file_id,
      fileSize: video.file_size || 0,
      duration: video.duration || 0,
      chatId,
    }
  }];
}

// Unknown — ignore silently
return [{
  json: {
    messageType: 'unknown',
    text: text.substring(0, 100),
    chatId,
  }
}];
