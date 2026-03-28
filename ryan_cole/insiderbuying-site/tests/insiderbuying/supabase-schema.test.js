'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Section 02: Supabase Schema — Migration Validation Tests
 *
 * Validates the SQL migration files define all required tables,
 * RLS policies, indexes, triggers, and Realtime configuration.
 */

const MIGRATIONS_DIR = path.join(__dirname, '../../supabase/migrations');
const V1 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20260326000000_insiderbuying_schema.sql'), 'utf8');
const V2 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20260327000001_insider_alerts_v2.sql'), 'utf8');
const ALL_SQL = V1 + '\n' + V2;

// ─────────────────────────────────────────────────────────────────────────────
describe('section-02: Supabase schema', () => {

  describe('tables', () => {
    const REQUIRED = [
      'profiles', 'subscriptions', 'insider_alerts',
      'user_alert_preferences', 'articles_cache', 'reports',
      'newsletter_subscribers',
    ];

    test.each(REQUIRED)('CREATE TABLE %s exists', (table) => {
      expect(ALL_SQL).toMatch(new RegExp(`CREATE TABLE public\\.${table}`));
    });
  });

  describe('RLS', () => {
    test('RLS enabled on all 7 tables', () => {
      const rlsMatches = ALL_SQL.match(/ENABLE ROW LEVEL SECURITY/g) || [];
      expect(rlsMatches.length).toBeGreaterThanOrEqual(7);
    });

    test('profiles: users can read own profile', () => {
      expect(ALL_SQL).toMatch(/profiles.*FOR SELECT/s);
      expect(ALL_SQL).toMatch(/auth\.uid\(\) = id/);
    });

    test('insider_alerts: authenticated can read', () => {
      expect(ALL_SQL).toMatch(/insider_alerts.*FOR SELECT.*TO authenticated/s);
    });

    test('articles_cache: public read', () => {
      expect(ALL_SQL).toMatch(/articles_cache.*FOR SELECT/s);
    });

    test('newsletter_subscribers: anon can insert', () => {
      expect(ALL_SQL).toMatch(/newsletter_subscribers.*FOR INSERT.*TO anon/s);
    });

    test('service_role can insert insider_alerts', () => {
      expect(ALL_SQL).toMatch(/insider_alerts.*FOR INSERT.*TO service_role/s);
    });

    test('service_role can update insider_alerts (v2)', () => {
      expect(V2).toMatch(/service_role can update insider_alerts/);
    });
  });

  describe('Realtime', () => {
    test('insider_alerts added to supabase_realtime publication', () => {
      expect(ALL_SQL).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE.*insider_alerts/);
    });
  });

  describe('triggers', () => {
    test('profile creation trigger on auth.users', () => {
      expect(ALL_SQL).toMatch(/handle_new_user/);
      expect(ALL_SQL).toMatch(/AFTER INSERT ON auth\.users/);
    });

    test('alert preferences creation trigger', () => {
      expect(ALL_SQL).toMatch(/handle_new_user_preferences/);
    });

    test('profile trigger uses SECURITY DEFINER', () => {
      expect(ALL_SQL).toMatch(/SECURITY DEFINER/);
    });
  });

  describe('indexes', () => {
    test('insider_alerts has ticker index', () => {
      expect(ALL_SQL).toMatch(/idx_insider_alerts_ticker/);
    });

    test('insider_alerts has created_at DESC index', () => {
      expect(ALL_SQL).toMatch(/idx_insider_alerts_created/);
    });

    test('insider_alerts has dedup_key unique index (v2)', () => {
      expect(V2).toMatch(/idx_insider_alerts_dedup/);
    });

    test('articles_cache has slug index', () => {
      expect(ALL_SQL).toMatch(/idx_articles_cache_slug/);
    });
  });

  describe('constraints', () => {
    test('profiles subscription_tier CHECK (free, pro)', () => {
      expect(V1).toMatch(/subscription_tier IN \('free', 'pro'\)/);
    });

    test('subscriptions status CHECK', () => {
      expect(V1).toMatch(/status IN \('active', 'canceled', 'past_due', 'trialing'\)/);
    });

    test('significance_score CHECK (1-10)', () => {
      expect(V1).toMatch(/significance_score.*BETWEEN 1 AND 10/);
    });

    test('transaction_type includes cluster (v2)', () => {
      expect(V2).toMatch(/transaction_type IN \('buy', 'sell', 'cluster'\)/);
    });
  });

  describe('v2 migration additions', () => {
    test('adds dedup_key column', () => {
      expect(V2).toMatch(/ADD COLUMN IF NOT EXISTS dedup_key/);
    });

    test('adds retry_count column', () => {
      expect(V2).toMatch(/ADD COLUMN IF NOT EXISTS retry_count/);
    });

    test('adds delivery tracking columns', () => {
      expect(V2).toMatch(/emails_sent/);
      expect(V2).toMatch(/push_sent/);
      expect(V2).toMatch(/delivered_at/);
    });
  });
});
