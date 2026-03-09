// NODE: Parse Video Pipeline Message
// Routes incoming Telegram messages to the correct handler:
//   - #body scenario_name clip_index [section]  â†’ body clip upload
//   - #hook scenario_name                       â†’ manual hook clip upload
//   - #outro scenario_name label                â†’ manual outro clip upload
//   - /produce scenario_name [template]         â†’ trigger video production
//   - /done                                     â†’ finish recording (does NOT auto-start next)
//   - /next                                     â†’ manually start recording next approved scenario
//   - video with no caption (during recording)  â†’ auto body clip
//   - anything else                             â†’ ignored
// Mode: Run Once for All Items
//
// WIRING: Telegram Trigger (message) â†’ this Code node â†’ Switch node (Route Message)
// Switch outputs: body_clip | hook_clip | outro_clip | produce | done_recording | start_next | auto_body_clip | unknown

const update = $input.first().json;
const message = update.message || update;
const text = (message.caption || message.text || '').trim();
const chatId = message.chat?.id || '';

const hasVideo = !!(message.video || message.document);
const video = message.video || message.document || {};

// â”€â”€â”€ Static data (needed for /produce timeOfDay fallback + auto_body_clip) â”€â”€â”€
const staticData = $getWorkflowStaticData('global');

// â”€â”€â”€ #body scenario_name clip_index [section] â”€â”€â”€
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

// â”€â”€â”€ #hook scenario_name â”€â”€â”€
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

// â”€â”€â”€ #outro scenario_name label â”€â”€â”€
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

// â”€â”€â”€ /produce [scenario_name] [night|day] â€” no args = next ready scenario â”€â”€â”€
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
  // Fall back to time recorded during /done â†’ /night|/day (stored in static data)
  const timeOfDay = explicitTimeOfDay || staticData.activeRecordingTimeOfDay || 'day';
  return [{ json: { messageType: 'produce', scenarioName, timeOfDay, chatId } }];
}

// â”€â”€â”€ /day or /night â€” set lighting time after /done â”€â”€â”€
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

// â”€â”€â”€ /done â€” finish recording â”€â”€â”€
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

// â”€â”€â”€ /next â€” manually start recording next approved scenario â”€â”€â”€
if (text.match(/^\/next$/i)) {
  return [{
    json: {
      messageType: 'start_next',
      chatId,
    }
  }];
}

// â”€â”€â”€ Video with no recognized command during active recording â†’ auto body clip â”€â”€â”€
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

// â”€â”€â”€ Hook trim timestamps: "0.9 4.4 8.7" or "0.3 x 8.1" â”€â”€â”€
if (text && !hasVideo) {
  const parts = text.split(/[\s,]+/);
  const parsed = parts.map(function(p) {
    if (p.toLowerCase() === 'x' || p.toLowerCase() === 'skip') return 'x';
    const n = Number(p);
    return (!isNaN(n) && n >= 0 && n < 15) ? n : undefined;
  });
  const isValid = parsed.every(function(v) { return v === 'x' || v !== undefined; })
    && parsed.some(function(v) { return v !== 'x'; })
    && parsed.length >= 1 && parsed.length <= 3;
  if (isValid) {
    return [{
      json: {
        messageType: 'hook_trim',
        timestamps: parsed,
        chatId,
      }
    }];
  }
}

// Unknown â€” ignore silently
return [{
  json: {
    messageType: 'unknown',
    text: text.substring(0, 100),
    chatId,
  }
}];
