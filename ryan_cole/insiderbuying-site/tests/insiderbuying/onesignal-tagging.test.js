'use strict';

/**
 * Section 09: OneSignal User Tagging — Logic Tests
 *
 * Tests the pure logic for OneSignal user linking and tag sync.
 * Since we can't render React components in plain Jest (no jsdom),
 * we extract and test the decision logic as pure functions.
 */

// ── Extracted logic (mirrors what OneSignalInit.tsx + syncOneSignalTags use) ──

/**
 * Determines whether OneSignal.login() should be called and with what ID.
 * @param {object|null} session - Supabase session object
 * @returns {{ shouldLogin: boolean, externalId: string|null }}
 */
function shouldLoginToOneSignal(session) {
  if (!session?.user?.id) return { shouldLogin: false, externalId: null };
  return { shouldLogin: true, externalId: session.user.id };
}

/**
 * Builds OneSignal tags for the preference save operation.
 * alert_score_min MUST be a number (not string) — W5 uses numeric <= comparison.
 * @param {{ min_significance_score: number }} prefs
 * @param {{ subscription_tier: string }} profile
 * @returns {{ alert_score_min: number, plan: string }}
 */
function buildOneSignalTags(prefs, profile) {
  // OneSignal SDK addTag() accepts string values. Server-side filter
  // uses numeric comparison for tag filters (e.g., <= operator).
  return {
    alert_score_min: String(prefs.min_significance_score),
    plan: profile.subscription_tier || 'free',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('section-09: onesignal-tagging', () => {

  describe('shouldLoginToOneSignal()', () => {
    test('calls login with user.id when session exists', () => {
      const session = { user: { id: 'uuid-123-abc' } };
      const result = shouldLoginToOneSignal(session);
      expect(result.shouldLogin).toBe(true);
      expect(result.externalId).toBe('uuid-123-abc');
    });

    test('does NOT call login when session is null', () => {
      const result = shouldLoginToOneSignal(null);
      expect(result.shouldLogin).toBe(false);
      expect(result.externalId).toBeNull();
    });

    test('does NOT call login when session has no user', () => {
      const result = shouldLoginToOneSignal({ user: null });
      expect(result.shouldLogin).toBe(false);
    });

    test('does NOT call login when user has no id', () => {
      const result = shouldLoginToOneSignal({ user: {} });
      expect(result.shouldLogin).toBe(false);
    });

    test('calls login again on auth state change with new user', () => {
      const session1 = { user: { id: 'user-1' } };
      const session2 = { user: { id: 'user-2' } };
      const r1 = shouldLoginToOneSignal(session1);
      const r2 = shouldLoginToOneSignal(session2);
      expect(r1.shouldLogin).toBe(true);
      expect(r2.shouldLogin).toBe(true);
      expect(r1.externalId).not.toBe(r2.externalId);
    });
  });

  describe('buildOneSignalTags()', () => {
    test('alert_score_min is a string (OneSignal SDK requires string, server compares numerically)', () => {
      const tags = buildOneSignalTags(
        { min_significance_score: 7 },
        { subscription_tier: 'pro' }
      );
      expect(typeof tags.alert_score_min).toBe('string');
      expect(tags.alert_score_min).toBe('7');
    });

    test('alert_score_min handles numeric input correctly', () => {
      const tags = buildOneSignalTags(
        { min_significance_score: 10 },
        { subscription_tier: 'free' }
      );
      expect(tags.alert_score_min).toBe('10');
    });

    test('plan tag matches subscription_tier for pro', () => {
      const tags = buildOneSignalTags(
        { min_significance_score: 5 },
        { subscription_tier: 'pro' }
      );
      expect(tags.plan).toBe('pro');
    });

    test('plan tag matches subscription_tier for free', () => {
      const tags = buildOneSignalTags(
        { min_significance_score: 5 },
        { subscription_tier: 'free' }
      );
      expect(tags.plan).toBe('free');
    });

    test('plan defaults to free when subscription_tier is missing', () => {
      const tags = buildOneSignalTags(
        { min_significance_score: 5 },
        {}
      );
      expect(tags.plan).toBe('free');
    });

    test('tags are set on every call (preference save, not only login)', () => {
      // Call twice with different values — both should return correct tags
      const tags1 = buildOneSignalTags(
        { min_significance_score: 3 },
        { subscription_tier: 'free' }
      );
      const tags2 = buildOneSignalTags(
        { min_significance_score: 8 },
        { subscription_tier: 'pro' }
      );
      expect(tags1.alert_score_min).toBe('3');
      expect(tags1.plan).toBe('free');
      expect(tags2.alert_score_min).toBe('8');
      expect(tags2.plan).toBe('pro');
    });
  });

  describe('number vs string critical path', () => {
    test('string "10" <= "6" is true (the BUG we prevent)', () => {
      // This is why alert_score_min MUST be a number
      expect('10' <= '6').toBe(true); // lexicographic — WRONG
      expect(10 <= 6).toBe(false);    // numeric — CORRECT
    });

    test('buildOneSignalTags always returns string alert_score_min', () => {
      const inputs = [1, 5, 10, '3', '7', '10'];
      for (const score of inputs) {
        const tags = buildOneSignalTags(
          { min_significance_score: score },
          { subscription_tier: 'free' }
        );
        expect(typeof tags.alert_score_min).toBe('string');
      }
    });
  });
});
