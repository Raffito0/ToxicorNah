// Create a test record in Hook Generation Queue with a real video URL
// Usage: node create-test.cjs <AIRTABLE_API_KEY>

const https = require('https');

const API_KEY = process.argv[2];
const BASE = 'appsgjIdkpak2kaXq';
const QUEUE_TABLE = 'tblXpyxSLN2vSJ4i3';

if (!API_KEY) {
  console.error('Usage: node create-test.cjs <AIRTABLE_API_KEY>');
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
  console.log('Creating test record...\n');

  const result = await airtableRequest('POST', `/v0/${BASE}/${QUEUE_TABLE}`, {
    records: [{
      fields: {
        task_id: 'TEST_' + Date.now(),
        status: 'completed',
        video_url: 'https://v3b.fal.media/files/b/0a9098cb/DcOcMk8CXs6pQAYPjzM6Z_hvGyelrq.mp4',
        concept_name: 'Test Sora',
        hook_mode: 'speaking',
        hook_texts_json: '["This is what happens when you trust too easily"]',
        scenario_ids_json: '["test_001"]',
        submitted_at: new Date().toISOString(),
        telegram_msg_id: '[]',
      },
    }],
  });

  if (result.error) {
    console.error('Error: ' + result.error.message);
    process.exit(1);
  }

  const rec = result.records[0];
  console.log('Created: ' + rec.id);
  console.log('Status: ' + rec.fields.status);
  console.log('Video: ' + rec.fields.video_url);
  console.log('\nHook Generator Phase 2 will deliver it to Telegram on the next tick (≤2 min).');
})();
