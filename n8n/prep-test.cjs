// Prepare a full-flow test: find a record with video_url and reset to "completed"
// Usage: node prep-test.cjs <AIRTABLE_API_KEY>
//   Lists all queue records, picks the best candidate, resets to "completed"
//   so Phase 2 delivers it to Telegram on the next tick.

const https = require('https');

const API_KEY = process.argv[2];
const BASE = 'appsgjIdkpak2kaXq';
const QUEUE_TABLE = 'tblXpyxSLN2vSJ4i3';

if (!API_KEY) {
  console.error('Usage: node prep-test.cjs <AIRTABLE_API_KEY>');
  process.exit(1);
}

function airtableRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.airtable.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(text)); }
        catch { reject(new Error('Invalid JSON: ' + text.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('Fetching all queue records...\n');

  // Get all records with key fields
  const fields = ['task_id', 'status', 'video_url', 'concept_name', 'hook_mode', 'hook_texts_json', 'scenario_ids_json', 'submitted_at']
    .map(f => 'fields%5B%5D=' + f).join('&');
  const data = await airtableRequest('GET', `/v0/${BASE}/${QUEUE_TABLE}?${fields}&sort%5B0%5D%5Bfield%5D=submitted_at&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=20`);

  const records = data.records || [];
  if (records.length === 0) {
    console.log('No records found in queue. Need to generate a Sora 2 video first.');
    process.exit(1);
  }

  console.log('Queue records:\n');
  for (const r of records) {
    const f = r.fields;
    const hasVideo = f.video_url ? 'YES' : 'no';
    console.log(`  ${r.id} | ${(f.status || '?').padEnd(20)} | video: ${hasVideo} | ${f.concept_name || '?'} (${f.hook_mode || '?'})`);
  }
  console.log('');

  // Find best candidate: has video_url, prefer clips_saved > failed > completed > any
  const withVideo = records.filter(r => r.fields.video_url);
  if (withVideo.length === 0) {
    console.log('No records with video_url found. Need a completed Sora 2 generation first.');
    process.exit(1);
  }

  const priority = ['clips_saved', 'failed', 'completed', 'review_sent', 'clips_preview_sent'];
  let candidate = null;
  for (const status of priority) {
    candidate = withVideo.find(r => r.fields.status === status);
    if (candidate) break;
  }
  if (!candidate) candidate = withVideo[0];

  const cf = candidate.fields;
  console.log('Selected: ' + candidate.id);
  console.log('  Status: ' + cf.status);
  console.log('  Concept: ' + (cf.concept_name || '?'));
  console.log('  Mode: ' + (cf.hook_mode || '?'));
  console.log('  Hooks: ' + (cf.hook_texts_json || '[]'));
  console.log('  Video: ' + (cf.video_url || 'none').slice(0, 80) + '...');
  console.log('');

  if (cf.status === 'completed') {
    console.log('Already "completed" — Phase 2 will deliver it on the next tick.');
    process.exit(0);
  }

  // Reset to completed
  console.log('Resetting to "completed"...');
  const result = await airtableRequest('PATCH', `/v0/${BASE}/${QUEUE_TABLE}/${candidate.id}`, {
    fields: {
      status: 'completed',
      telegram_msg_id: '[]',  // clear old Telegram message IDs
      timestamps_json: '',     // clear old timestamps
      reviewed_at: '',         // clear review timestamp
      error_message: '',       // clear any error
    },
  });

  console.log('Done! Status: ' + result.fields.status);
  console.log('\nNext Hook Generator tick (≤2 min) will:');
  console.log('  1. Download the Sora 2 video');
  console.log('  2. Burn timecode overlay');
  console.log('  3. Send to Telegram');
  console.log('  4. Set status to "review_sent"');
  console.log('\nThen reply with timestamps → instant webhook → trim → approve → save!');
})();
