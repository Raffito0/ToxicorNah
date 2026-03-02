// NODE: Receive Body Clips from Telegram
// Handles video messages sent to the bot with format: #body scenario_name clip_index
// Example: User sends a video with caption "#body weekend-vibes-001 2"
// Creates a Body Clips record in Airtable with the video file
// Mode: Run Once for All Items
//
// WIRING: Telegram Trigger (message) → this Code node → Airtable Create → Telegram confirmation

const AIRTABLE_TOKEN = ''; // ← Set via n8n credentials, not hardcoded here
const BASE_ID = 'appsgjIdkpak2kaXq';
const BODY_CLIPS_TABLE = 'tblJcmlW99FNxMNXk';
const SCENARIOS_TABLE = 'tblcQaMBBPcOAy0NF';

const update = $input.first().json;

// Extract message data
const message = update.message || update;
const caption = message.caption || message.text || '';
const chatId = message.chat?.id || '';

// Get video file info — Telegram sends videos as either 'video' or 'document'
const video = message.video || message.document;
if (!video) {
  return [{
    json: {
      error: true,
      chatId,
      message: 'No video file found in message. Send a video with caption: #body scenario_name clip_index'
    }
  }];
}

// Parse caption: #body scenario_name clip_index
const bodyMatch = caption.match(/#body\s+(\S+)\s+(\d+)/i);
if (!bodyMatch) {
  return [{
    json: {
      error: true,
      chatId,
      message: 'Invalid caption format. Use: #body scenario_name clip_index\nExample: #body weekend-vibes-001 2'
    }
  }];
}

const scenarioName = bodyMatch[1];
const clipIndex = parseInt(bodyMatch[2], 10);
const fileId = video.file_id;
const duration = video.duration || 0;

// Get Telegram file download URL
// n8n's Telegram node handles the Bot API token, but in a Code node we need to call the API directly
// The bot token is available from the credential — we'll pass it through from the trigger node
// For now, output the parsed data for the next nodes to handle

return [{
  json: {
    scenarioName,
    clipIndex,
    fileId,
    duration,
    chatId,
    clipName: scenarioName + '_clip_' + clipIndex,
    // These will be used by subsequent nodes:
    // 1. HTTP Request node to get file URL: GET https://api.telegram.org/bot{token}/getFile?file_id={fileId}
    // 2. Build download URL: https://api.telegram.org/file/bot{token}/{file_path}
    // 3. Airtable Create node to insert Body Clips record with attachment URL
  }
}];
