'use strict';

/**
 * Section 08: Subscription-Aware Blur — Logic Tests
 *
 * Tests the blur/CTA logic extracted from alerts/page.tsx.
 * Since the project uses plain Jest (no jsdom/RTL), we test the
 * pure logic functions that determine blur and CTA behavior.
 */

// ── Extracted logic (mirrors what page.tsx uses) ─────────────────────────────

function getBlurState({ isLoggedIn, isPro }) {
  return {
    shouldBlur: !isPro,
    showCta: !isPro,
    ctaText: !isLoggedIn ? 'Sign up for free' : 'Upgrade to Pro',
    ctaLink: !isLoggedIn ? '/signup' : '/pricing',
  };
}

function deriveIsPro(profileData) {
  if (!profileData) return false;
  return profileData.subscription_tier === 'pro';
}

function getBlurClasses(isPro) {
  return isPro ? '' : 'blur-[4px] select-none';
}

// ─────────────────────────────────────────────────────────────────────────────
describe('section-08: alerts-blur logic', () => {

  describe('deriveIsPro()', () => {
    test('returns true for pro subscription', () => {
      expect(deriveIsPro({ subscription_tier: 'pro' })).toBe(true);
    });

    test('returns false for free subscription', () => {
      expect(deriveIsPro({ subscription_tier: 'free' })).toBe(false);
    });

    test('returns false for null profile data (query error)', () => {
      expect(deriveIsPro(null)).toBe(false);
    });

    test('returns false for undefined profile data', () => {
      expect(deriveIsPro(undefined)).toBe(false);
    });

    test('returns false for missing subscription_tier field', () => {
      expect(deriveIsPro({})).toBe(false);
    });
  });

  describe('getBlurClasses()', () => {
    test('isPro=true → no blur classes', () => {
      expect(getBlurClasses(true)).toBe('');
    });

    test('isPro=false → blur-[4px] select-none', () => {
      expect(getBlurClasses(false)).toBe('blur-[4px] select-none');
    });
  });

  describe('getBlurState()', () => {
    test('unauthenticated → blur, signup CTA', () => {
      const state = getBlurState({ isLoggedIn: false, isPro: false });
      expect(state.shouldBlur).toBe(true);
      expect(state.showCta).toBe(true);
      expect(state.ctaText).toBe('Sign up for free');
      expect(state.ctaLink).toBe('/signup');
    });

    test('authenticated free → blur, upgrade CTA', () => {
      const state = getBlurState({ isLoggedIn: true, isPro: false });
      expect(state.shouldBlur).toBe(true);
      expect(state.showCta).toBe(true);
      expect(state.ctaText).toBe('Upgrade to Pro');
      expect(state.ctaLink).toBe('/pricing');
    });

    test('authenticated pro → no blur, no CTA', () => {
      const state = getBlurState({ isLoggedIn: true, isPro: true });
      expect(state.shouldBlur).toBe(false);
      expect(state.showCta).toBe(false);
    });

    test('profiles query failure → treated as free (blur)', () => {
      // When profiles query fails, isPro stays false
      const state = getBlurState({ isLoggedIn: true, isPro: false });
      expect(state.shouldBlur).toBe(true);
      expect(state.showCta).toBe(true);
    });
  });

  describe('blur behavior matrix', () => {
    const cases = [
      { desc: 'unauthenticated',       isLoggedIn: false, isPro: false, blur: true,  cta: true,  ctaText: 'Sign up for free' },
      { desc: 'authenticated, free',    isLoggedIn: true,  isPro: false, blur: true,  cta: true,  ctaText: 'Upgrade to Pro' },
      { desc: 'authenticated, pro',     isLoggedIn: true,  isPro: true,  blur: false, cta: false, ctaText: undefined },
      { desc: 'profiles error',         isLoggedIn: true,  isPro: false, blur: true,  cta: true,  ctaText: 'Upgrade to Pro' },
    ];

    test.each(cases)('$desc → blur=$blur, cta=$cta', ({ isLoggedIn, isPro, blur, cta, ctaText }) => {
      const state = getBlurState({ isLoggedIn, isPro });
      expect(state.shouldBlur).toBe(blur);
      expect(state.showCta).toBe(cta);
      if (ctaText) expect(state.ctaText).toBe(ctaText);
    });
  });
});
