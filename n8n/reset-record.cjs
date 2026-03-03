// Quick utility to reset a Hook Generation Queue record status
// Usage: node reset-record.cjs <AIRTABLE_API_KEY> [task_id] [new_status]
const https = require('https');

const API_KEY = process.argv[2];
const TASK_ID = process.argv[3] || 'FY3YQ1O89N1SNNOX';
const NEW_STATUS = process.argv[4] || 'clips_preview_sent';

const BASE = 'appsgjIdkpak2kaXq';
const TABLE = 'tblXpyxSLN2vSJ4i3';

if (!API_KEY) {
  console.error('Usage: node reset-record.cjs <AIRTABLE_API_KEY> [task_id] [new_status]');
  console.error('Defaults: task_id=FY3YQ1O89N1SNNOX, new_status=clips_preview_sent');
  process.exit(1);
}

// Step 1: Find the record by task_id
const formula = encodeURIComponent(`{task_id}="${TASK_ID}"`);
const searchPath = `/v0/${BASE}/${TABLE}?filterByFormula=${formula}&maxRecords=1`;

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
  console.log(`Looking for task_id="${TASK_ID}" ...`);
  const data = await airtableRequest('GET', searchPath);
  if (!data.records || data.records.length === 0) {
    console.error('Record not found with task_id=' + TASK_ID);
    process.exit(1);
  }
  const rec = data.records[0];
  const recId = rec.id;
  const currentStatus = rec.fields.status;
  console.log(`Found: ${recId} (current status: ${currentStatus})`);

  // Step 2: Update status
  const updatePath = `/v0/${BASE}/${TABLE}/${recId}`;
  const result = await airtableRequest('PATCH', updatePath, {
    fields: { status: NEW_STATUS },
  });
  console.log(`Updated: ${recId} → status="${result.fields.status}"`);
  console.log('Done! You can now retest the approval flow on Telegram.');
})();
