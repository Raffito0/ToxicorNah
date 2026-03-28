'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATION_FILE = path.join(
  __dirname,
  '../../supabase/migrations/20260327000001_insider_alerts_v2.sql'
);

let sql;
beforeAll(() => {
  sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
});

describe('section-00: insider_alerts v2 migration file', () => {
  // ── Column additions ────────────────────────────────────────────────────────

  const requiredColumns = [
    'transaction_date',
    'dedup_key',
    'insider_category',
    'score_reasoning',
    'cluster_size',
    'status',
    'retry_count',
    'emails_sent',
    'push_sent',
    'delivered_at',
    'error_log',
  ];

  requiredColumns.forEach((col) => {
    test(`adds column ${col} with IF NOT EXISTS guard`, () => {
      const pattern = new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}`);
      expect(sql).toMatch(pattern);
    });
  });

  test('does NOT re-add cluster_id (already exists in v1)', () => {
    expect(sql).not.toMatch(/ADD COLUMN\s+IF NOT EXISTS\s+cluster_id/);
  });

  test('does NOT re-add is_cluster_buy (already exists in v1)', () => {
    expect(sql).not.toMatch(/ADD COLUMN\s+IF NOT EXISTS\s+is_cluster_buy/);
  });

  // ── Indexes ─────────────────────────────────────────────────────────────────

  test('creates dedup_key partial unique index with IF NOT EXISTS', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_insider_alerts_dedup');
    expect(sql).toContain('WHERE dedup_key IS NOT NULL');
  });

  test('creates status index for delivery queries', () => {
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_insider_alerts_status');
  });

  // ── transaction_type CHECK constraint ────────────────────────────────────────

  test('drops old transaction_type CHECK constraint with IF EXISTS', () => {
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS insider_alerts_transaction_type_check");
  });

  test('wraps ADD CONSTRAINT in DO block for idempotency', () => {
    // The DO block contains the pg_constraint guard before ADD CONSTRAINT
    expect(sql).toMatch(/pg_constraint[\s\S]+?insider_alerts_transaction_type_check/);
  });

  test("new transaction_type CHECK includes 'buy', 'sell', 'cluster'", () => {
    const check = sql.match(/CHECK \(transaction_type IN \([^)]+\)\)/);
    expect(check).not.toBeNull();
    expect(check[0]).toContain("'buy'");
    expect(check[0]).toContain("'sell'");
    expect(check[0]).toContain("'cluster'");
  });

  // ── status CHECK constraint ──────────────────────────────────────────────────

  test('adds status CHECK constraint with valid delivery states', () => {
    expect(sql).toContain('insider_alerts_status_check');
    expect(sql).toContain("'new'");
    expect(sql).toContain("'processed'");
    expect(sql).toContain("'delivered'");
    expect(sql).toContain("'delivery_failed'");
    expect(sql).toContain("'dead_letter'");
  });

  test('status CHECK is wrapped in idempotency guard', () => {
    expect(sql).toMatch(/pg_constraint[\s\S]+?insider_alerts_status_check/);
  });

  // ── service_role UPDATE policy ───────────────────────────────────────────────

  test('adds service_role UPDATE policy', () => {
    expect(sql).toContain('service_role can update insider_alerts');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('TO service_role');
  });

  test('service_role policy is wrapped in pg_policies IF NOT EXISTS guard', () => {
    expect(sql).toMatch(/pg_policies[\s\S]+?service_role can update insider_alerts/);
  });

  // ── Live-DB integration tests (require local Supabase) ──────────────────────
  // The following are documented here but must be run manually against a real DB:
  //   supabase start && supabase db push
  //   SELECT column_name FROM information_schema.columns WHERE table_name='insider_alerts'
  //   INSERT ... transaction_type='cluster' (should succeed)
  //   INSERT ... transaction_type='grant'   (should fail constraint)
  //   INSERT ... dedup_key='x' twice        (second should fail unique index)
  //   UPDATE insider_alerts ... (service_role key: succeeds; anon key: 0 rows affected)
  //   Run migration twice: no errors on second run
});
