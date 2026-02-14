// NODE: Save Scenario to Supabase
// Saves approved scenario JSON to Supabase content_scenarios table
// Returns the UUID for building the demo URL (?sid=xxx)
// Mode: Run Once for All Items
//
// This node should run AFTER the "Update Scenario Status" node in Flow 2
// when the action is "approve".
//
// Requires: Supabase URL and Service Role Key in n8n credentials/environment
// Set these as n8n environment variables:
//   SUPABASE_URL = https://iilqnbumccqxlyloerzd.supabase.co
//   SUPABASE_SERVICE_KEY = your-service-role-key

const input = $input.first().json;

// Only save if action is approve
if (input.action !== 'approve') {
  return [{ json: { skipped: true, reason: 'Action is not approve: ' + input.action } }];
}

const scenarioName = input.scenarioName;

// Get the scenario JSON from the Airtable record
// The scenario data should be passed through from the pipeline
const scenarioJson = input.scenarioJson || input.scenario;

if (!scenarioJson) {
  return [{ json: { error: true, message: 'No scenario JSON found in input' } }];
}

// Supabase REST API insert
const supabaseUrl = $env.SUPABASE_URL || 'https://iilqnbumccqxlyloerzd.supabase.co';
const supabaseKey = $env.SUPABASE_SERVICE_KEY;

if (!supabaseKey) {
  return [{ json: { error: true, message: 'SUPABASE_SERVICE_KEY not configured in n8n environment' } }];
}

const response = await fetch(supabaseUrl + '/rest/v1/content_scenarios', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': 'Bearer ' + supabaseKey,
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
  return [{ json: { error: true, message: 'Supabase insert failed: ' + response.status + ' ' + errorText } }];
}

const [inserted] = await response.json();
const uuid = inserted.id;

// Build the demo URL
const appUrl = $env.APP_URL || 'https://toxicornah.com';
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
