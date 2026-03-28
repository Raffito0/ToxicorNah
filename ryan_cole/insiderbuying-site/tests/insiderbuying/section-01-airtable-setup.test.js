'use strict';

const {
  INSIDER_ALERTS_FIELDS,
  MONITOR_STATE_FIELDS,
  MONITOR_STATE_SEEDS,
} = require('../../scripts/insiderbuying/setup-airtable-base');

describe('section-01: Airtable schema config', () => {
  // ── Insider_Alerts table ──────────────────────────────────────────────────

  describe('Insider_Alerts field definitions', () => {
    const fieldNames = INSIDER_ALERTS_FIELDS.map((f) => f.name);

    const requiredFields = [
      'dedup_key', 'ticker', 'company_name', 'insider_name', 'insider_title',
      'insider_category', 'transaction_type', 'shares', 'price_per_share',
      'total_value', 'transaction_date', 'filing_date', 'significance_score',
      'score_reasoning', 'ai_analysis', 'cluster_id', 'is_cluster_buy',
      'cluster_size', 'raw_filing_data', 'supabase_id', 'status',
      'emails_sent', 'push_sent', 'delivered_at', 'error_log',
    ];

    requiredFields.forEach((name) => {
      test(`defines field: ${name}`, () => {
        expect(fieldNames).toContain(name);
      });
    });

    test('transaction_type is singleSelect', () => {
      const f = INSIDER_ALERTS_FIELDS.find((x) => x.name === 'transaction_type');
      expect(f.type).toBe('singleSelect');
    });

    test('transaction_type has exactly 3 choices: buy, sell, cluster', () => {
      const f = INSIDER_ALERTS_FIELDS.find((x) => x.name === 'transaction_type');
      const names = f.options.choices.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(['buy', 'sell', 'cluster']));
      expect(names).toHaveLength(3);
    });

    test('status is singleSelect with 6 delivery states', () => {
      const f = INSIDER_ALERTS_FIELDS.find((x) => x.name === 'status');
      expect(f.type).toBe('singleSelect');
      const names = f.options.choices.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining(['new', 'processing', 'processed', 'delivered', 'delivery_failed', 'failed'])
      );
      expect(names).toHaveLength(6);
    });

    test('delivered_at is dateTime (not date-only)', () => {
      const f = INSIDER_ALERTS_FIELDS.find((x) => x.name === 'delivered_at');
      expect(f.type).toBe('dateTime');
    });

    test('is_cluster_buy is checkbox', () => {
      const f = INSIDER_ALERTS_FIELDS.find((x) => x.name === 'is_cluster_buy');
      expect(f.type).toBe('checkbox');
    });

    test('numeric fields have precision defined', () => {
      ['shares', 'cluster_size', 'significance_score', 'emails_sent', 'push_sent'].forEach((name) => {
        const f = INSIDER_ALERTS_FIELDS.find((x) => x.name === name);
        expect(f.type).toBe('number');
        expect(f.options).toBeDefined();
        expect(typeof f.options.precision).toBe('number');
      });
    });
  });

  // ── Monitor_State table ────────────────────────────────────────────────────

  describe('Monitor_State field definitions', () => {
    const fieldNames = MONITOR_STATE_FIELDS.map((f) => f.name);

    test('has all 5 required fields', () => {
      expect(fieldNames).toEqual(
        expect.arrayContaining([
          'name', 'last_check_timestamp', 'last_run_status',
          'last_run_filings_found', 'last_run_error',
        ])
      );
    });

    test('last_check_timestamp is dateTime (not date-only)', () => {
      const f = MONITOR_STATE_FIELDS.find((x) => x.name === 'last_check_timestamp');
      expect(f.type).toBe('dateTime');
    });
  });

  // ── Monitor_State seed records ─────────────────────────────────────────────

  describe('Monitor_State seed records', () => {
    test('seeds exactly 2 records', () => {
      expect(MONITOR_STATE_SEEDS).toHaveLength(2);
    });

    test('seeds market record', () => {
      const record = MONITOR_STATE_SEEDS.find((r) => r.fields.name === 'market');
      expect(record).toBeDefined();
    });

    test('seeds afterhours record', () => {
      const record = MONITOR_STATE_SEEDS.find((r) => r.fields.name === 'afterhours');
      expect(record).toBeDefined();
    });

    test('both seed records have last_check_timestamp as ISO datetime string', () => {
      MONITOR_STATE_SEEDS.forEach((record) => {
        const ts = record.fields.last_check_timestamp;
        expect(typeof ts).toBe('string');
        // ISO 8601 datetime includes 'T' separator and ends with 'Z' or offset
        expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      });
    });

    test('seed timestamps are in the past (at least 1h ago, at most 48h ago)', () => {
      const now = Date.now();
      MONITOR_STATE_SEEDS.forEach((record) => {
        const ts = new Date(record.fields.last_check_timestamp).getTime();
        const hoursAgo = (now - ts) / 1000 / 3600;
        expect(hoursAgo).toBeGreaterThan(1);
        expect(hoursAgo).toBeLessThan(48);
      });
    });
  });

  // ── Live integration tests (require real Airtable credentials) ─────────────
  // Run manually after executing setup-airtable-base.js:
  //   AIRTABLE_TOKEN=pat... BASE_ID=appXXX node scripts/insiderbuying/setup-airtable-base.js
  //
  //   Then verify in Airtable UI:
  //   - Insider_Alerts table accepts a record with all required fields populated
  //   - transaction_type rejects values outside buy/sell/cluster
  //   - Monitor_State has exactly 2 records (market / afterhours)
  //   - filterByFormula({dedup_key}='TEST_KEY') returns at most 1 record
});
