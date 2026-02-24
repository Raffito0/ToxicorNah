// NODE: Save Scenario to Supabase
// Saves approved scenario JSON to Supabase content_scenarios table
// Returns the UUID for building the demo URL (?sid=xxx)
// Mode: Run Once for All Items
//
// WIRING: In Workflow 2, placed on the "approve" branch of the IF node after Update Status.
// References $('Find Scenario') for scenario_json and $('Parse Callback') for action/scenarioName.
//
// ─── fetch polyfill (n8n Code node sandbox lacks global fetch) ───
const _https = require('https');
const _http = require('http');
const { URL } = require('url');
function fetch(url, opts = {}, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (_redirectCount > 5) return reject(new Error('Too many redirects'));
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? _https : _http;
    const body = opts.body || null;
    const ro = {
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { ...(opts.headers || {}) },
    };
    if (body) ro.headers['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(ro, res => {
      // Follow redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); // drain response
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : u.protocol + '//' + u.host + res.headers.location;
        return fetch(redirectUrl, opts, _redirectCount + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(buf.toString()),
          json: () => Promise.resolve(JSON.parse(buf.toString())),
          arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Config — hardcoded for private self-hosted n8n
const SUPABASE_URL = 'https://iilqnbumccqxlyloerzd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpbHFuYnVtY2NxeGx5bG9lcnpkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODcyMzAyOCwiZXhwIjoyMDg0Mjk5MDI4fQ.XUKQTfMrtg2gYwIiJX_dMBX6C4VSlKZS09cNC7h7yVQ'; // ← Replace with your service_role key from Supabase Dashboard → Settings → API
const APP_URL = 'https://toxicor-nah.vercel.app';

// Get action and scenarioName from the callback handler node
const callback = $('Parse Callback').first().json;
const action = callback.action;
const scenarioName = callback.scenarioName;

// Only save if action is approve
if (action !== 'approve') {
  return [{ json: { skipped: true, reason: 'Action is not approve: ' + action } }];
}

// Get scenario_json from the Find Scenario node (not $input — after Update Status, input only has id+status)
const airtableRecord = $('Find Scenario (Callback)').first().json;
let scenarioJson = airtableRecord.scenario_json || airtableRecord.fields?.scenario_json;

if (!scenarioJson) {
  return [{ json: { error: true, message: 'No scenario_json found in Airtable record. Fields: ' + Object.keys(airtableRecord).join(', ') } }];
}

// Parse if stored as string in Airtable
if (typeof scenarioJson === 'string') {
  try {
    scenarioJson = JSON.parse(scenarioJson);
  } catch (e) {
    return [{ json: { error: true, message: 'Failed to parse scenario_json: ' + e.message } }];
  }
}

// Supabase REST API insert

const response = await fetch(SUPABASE_URL + '/rest/v1/content_scenarios', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer': 'return=representation',
  },
  body: JSON.stringify({
    scenario_id: scenarioName,
    scenario_json: scenarioJson,
    status: 'approved',
  }),
});

if (!response.ok) {
  const errorText = await response.text();
  return [{ json: { error: true, scenarioName, message: 'Supabase insert failed: ' + response.status + ' ' + errorText } }];
}

const [inserted] = await response.json();
const uuid = inserted.id;

// Build the demo URL
const appUrl = APP_URL;
const demoUrl = appUrl + '/?sid=' + uuid;

return [{
  json: {
    success: true,
    uuid,
    scenarioName,
    demoUrl,
    message: '📱 Demo URL: ' + demoUrl,
  }
}];
