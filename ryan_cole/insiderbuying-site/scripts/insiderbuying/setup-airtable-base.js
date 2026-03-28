'use strict';

/**
 * setup-airtable-base.js
 *
 * Creates the InsiderBuying.ai Airtable base tables and seeds Monitor_State.
 *
 * Usage:
 *   AIRTABLE_TOKEN=pat... BASE_ID=appXXX node scripts/insiderbuying/setup-airtable-base.js
 *
 * Prerequisites:
 *   1. Manually create a new base named "InsiderBuying.ai" in the Airtable UI.
 *   2. Copy its base ID (starts with "app") and set BASE_ID env var.
 *   3. Set AIRTABLE_TOKEN to a personal access token with scopes:
 *      schema.bases:write, data.records:write
 *
 * The Airtable REST API cannot create a base — only tables/fields/records within one.
 */

const https = require('https');

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.BASE_ID;

if (require.main === module && (!TOKEN || !BASE_ID)) {
  console.error('ERROR: AIRTABLE_TOKEN and BASE_ID env vars are required.');
  process.exit(1);
}

// ── HTTP helper ────────────────────────────────────────────────────────────────

function airtableRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.airtable.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) reject(new Error(`Airtable ${res.statusCode}: ${JSON.stringify(parsed)}`));
          else resolve(parsed);
        } catch (e) {
          reject(new Error(`JSON parse error: ${raw}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Field definitions ──────────────────────────────────────────────────────────

const INSIDER_ALERTS_FIELDS = [
  // Filing metadata
  { name: 'dedup_key', type: 'singleLineText' },
  { name: 'ticker', type: 'singleLineText' },
  { name: 'company_name', type: 'singleLineText' },
  { name: 'insider_name', type: 'singleLineText' },
  { name: 'insider_title', type: 'singleLineText' },
  { name: 'insider_category', type: 'singleLineText' },
  // Trade details
  {
    name: 'transaction_type',
    type: 'singleSelect',
    options: { choices: [{ name: 'buy' }, { name: 'sell' }, { name: 'cluster' }] },
  },
  { name: 'shares', type: 'number', options: { precision: 0 } },
  { name: 'price_per_share', type: 'number', options: { precision: 4 } },
  { name: 'total_value', type: 'number', options: { precision: 2 } },
  { name: 'transaction_date', type: 'date', options: { dateFormat: { name: 'iso' } } },
  { name: 'filing_date', type: 'date', options: { dateFormat: { name: 'iso' } } },
  // AI scoring
  { name: 'significance_score', type: 'number', options: { precision: 0 } },
  { name: 'score_reasoning', type: 'multilineText' },
  { name: 'ai_analysis', type: 'multilineText' },
  // Cluster
  { name: 'cluster_id', type: 'singleLineText' },
  { name: 'is_cluster_buy', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
  { name: 'cluster_size', type: 'number', options: { precision: 0 } },
  // Debug & cross-reference
  { name: 'raw_filing_data', type: 'multilineText' },
  { name: 'supabase_id', type: 'singleLineText' },
  // Delivery tracking
  {
    name: 'status',
    type: 'singleSelect',
    options: {
      choices: [
        { name: 'new' },
        { name: 'processing' },
        { name: 'processed' },
        { name: 'delivered' },
        { name: 'delivery_failed' },
        { name: 'failed' },
      ],
    },
  },
  { name: 'emails_sent', type: 'number', options: { precision: 0 } },
  { name: 'push_sent', type: 'number', options: { precision: 0 } },
  {
    name: 'delivered_at',
    type: 'dateTime',
    options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
  },
  { name: 'error_log', type: 'multilineText' },
];

const MONITOR_STATE_FIELDS = [
  { name: 'name', type: 'singleLineText' },
  {
    name: 'last_check_timestamp',
    type: 'dateTime',
    options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
  },
  { name: 'last_run_status', type: 'singleLineText' },
  { name: 'last_run_filings_found', type: 'number', options: { precision: 0 } },
  { name: 'last_run_error', type: 'multilineText' },
];

// ── Seed records for Monitor_State ────────────────────────────────────────────

function yesterday() {
  return new Date(Date.now() - 86400000).toISOString();
}

const MONITOR_STATE_SEEDS = [
  { fields: { name: 'market', last_check_timestamp: yesterday() } },
  { fields: { name: 'afterhours', last_check_timestamp: yesterday() } },
];

// ── Main setup flow ────────────────────────────────────────────────────────────

async function getExistingTables() {
  const res = await airtableRequest('GET', `/v0/meta/bases/${BASE_ID}/tables`);
  return res.tables || [];
}

async function createTable(name, fields, existingTables) {
  const existing = existingTables.find((t) => t.name === name);
  if (existing) {
    console.log(`  Table "${name}" already exists (${existing.id}), skipping creation.`);
    return existing;
  }

  console.log(`Creating table: ${name}...`);
  // Airtable requires at least one field in table creation.
  // Additional fields are added via the fields endpoint.
  const firstField = fields[0];
  const table = await airtableRequest('POST', `/v0/meta/bases/${BASE_ID}/tables`, {
    name,
    fields: [firstField],
  });
  console.log(`  Created table ${name} (id: ${table.id})`);

  // Add remaining fields (skip those already present)
  const existingFieldNames = new Set((table.fields || []).map((f) => f.name));
  for (const field of fields.slice(1)) {
    if (existingFieldNames.has(field.name)) {
      console.log(`  Field "${field.name}" already exists, skipping.`);
      continue;
    }
    await airtableRequest('POST', `/v0/meta/bases/${BASE_ID}/tables/${table.id}/fields`, field);
    console.log(`  Added field: ${field.name}`);
  }
  return table;
}

async function seedRecords(tableId, records) {
  console.log(`Seeding ${records.length} records...`);
  const result = await airtableRequest('POST', `/v0/${BASE_ID}/${tableId}`, { records });
  console.log(`  Seeded ${result.records.length} records.`);
}

async function main() {
  console.log(`Setting up InsiderBuying.ai base (${BASE_ID})...`);

  const existingTables = await getExistingTables();
  const alertsTable = await createTable('Insider_Alerts', INSIDER_ALERTS_FIELDS, existingTables);
  const monitorTable = await createTable('Monitor_State', MONITOR_STATE_FIELDS, existingTables);

  await seedRecords(monitorTable.id, MONITOR_STATE_SEEDS);

  console.log('\nDone. Base IDs to save in your .env / n8n credentials:');
  console.log(`  AIRTABLE_BASE_ID=${BASE_ID}`);
  console.log(`  INSIDER_ALERTS_TABLE_ID=${alertsTable.id}`);
  console.log(`  MONITOR_STATE_TABLE_ID=${monitorTable.id}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Setup failed:', err.message);
    process.exit(1);
  });
}

// Export schema config for unit tests
module.exports = { INSIDER_ALERTS_FIELDS, MONITOR_STATE_FIELDS, MONITOR_STATE_SEEDS };
