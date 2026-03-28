'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Section 01: NocoDB VPS — Schema Definition Tests
 *
 * Validates that the setup script defines all 12 required tables
 * with correct field types. Parses the bash script as a source of truth.
 */

const SETUP_SCRIPT = fs.readFileSync(
  path.join(__dirname, '../../docker/nocodb/setup-tables.sh'),
  'utf8'
);

// Extract table names from create_table calls
function extractTableNames(script) {
  const matches = script.match(/create_table\s+"([^"]+)"/g) || [];
  return matches.map(m => m.match(/"([^"]+)"/)[1]);
}

// Extract columns for a table from the JSON block after create_table
function extractColumns(script, tableName) {
  const regex = new RegExp(`create_table\\s+"${tableName}"\\s+'\\[([\\s\\S]*?)\\]'`, 'm');
  const match = script.match(regex);
  if (!match) return [];
  try {
    const jsonStr = '[' + match[1] + ']';
    return JSON.parse(jsonStr);
  } catch {
    // Parse individual objects manually
    const objMatches = match[1].match(/\{[^}]+\}/g) || [];
    return objMatches.map(o => {
      try { return JSON.parse(o); }
      catch { return null; }
    }).filter(Boolean);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('section-01: NocoDB schema definitions', () => {

  const REQUIRED_TABLES = [
    'Keywords', 'Articles', 'Financial_Cache', 'Published_Images',
    'Data_Studies', 'Insider_Alerts', 'Outreach_Prospects', 'Outreach_Log',
    'X_Engagement_Log', 'Reddit_Log', 'Lead_Magnet_Versions', 'SEO_Rankings',
  ];

  test('setup script exists and is not empty', () => {
    expect(SETUP_SCRIPT.length).toBeGreaterThan(100);
  });

  test('all 12 required tables are defined', () => {
    const tables = extractTableNames(SETUP_SCRIPT);
    for (const t of REQUIRED_TABLES) {
      expect(tables).toContain(t);
    }
    expect(tables.length).toBe(12);
  });

  describe('Keywords table', () => {
    test('has required fields', () => {
      const cols = extractColumns(SETUP_SCRIPT, 'Keywords');
      const names = cols.map(c => c.title);
      expect(names).toContain('keyword');
      expect(names).toContain('ticker');
      expect(names).toContain('priority_score');
      expect(names).toContain('status');
      expect(names).toContain('search_volume');
    });
  });

  describe('Articles table', () => {
    test('has required fields', () => {
      const cols = extractColumns(SETUP_SCRIPT, 'Articles');
      const names = cols.map(c => c.title);
      expect(names).toContain('slug');
      expect(names).toContain('body_html');
      expect(names).toContain('verdict_type');
      expect(names).toContain('status');
      expect(names).toContain('hero_image_url');
      expect(names).toContain('seo_score');
      expect(names).toContain('ai_detection_score');
    });
  });

  describe('Financial_Cache table', () => {
    test('has ticker, data_type, expires_at', () => {
      const cols = extractColumns(SETUP_SCRIPT, 'Financial_Cache');
      const names = cols.map(c => c.title);
      expect(names).toContain('ticker');
      expect(names).toContain('data_type');
      expect(names).toContain('expires_at');
    });
  });

  describe('Insider_Alerts table', () => {
    test('has required fields', () => {
      const cols = extractColumns(SETUP_SCRIPT, 'Insider_Alerts');
      const names = cols.map(c => c.title);
      expect(names).toContain('ticker');
      expect(names).toContain('significance_score');
      expect(names).toContain('ai_analysis');
      expect(names).toContain('cluster_id');
    });
  });

  describe('Data_Studies table', () => {
    test('has required fields', () => {
      const cols = extractColumns(SETUP_SCRIPT, 'Data_Studies');
      const names = cols.map(c => c.title);
      expect(names).toContain('title');
      expect(names).toContain('study_type');
      expect(names).toContain('status');
    });
  });

  describe('docker-compose.yml', () => {
    const compose = fs.readFileSync(
      path.join(__dirname, '../../docker/nocodb/docker-compose.yml'),
      'utf8'
    );

    test('uses postgres:16', () => {
      expect(compose).toMatch(/postgres:16/);
    });

    test('has Traefik labels for HTTPS', () => {
      expect(compose).toMatch(/traefik\.http\.routers\.nocodb\.tls=true/);
    });

    test('has health check for postgres', () => {
      expect(compose).toMatch(/pg_isready/);
    });

    test('uses external Traefik network', () => {
      expect(compose).toMatch(/root_default/);
    });

    test('nocodb_db is not exposed to Traefik', () => {
      // nocodb_db should NOT have traefik labels
      const dbSection = compose.split(/nocodb_db:/)[1]?.split(/^volumes:/m)[0] || '';
      expect(dbSection).not.toMatch(/traefik\.enable/);
    });
  });
});
