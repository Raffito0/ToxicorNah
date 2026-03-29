# Code Review Interview — Section 03: Alert Pipeline E2E Tests

**Date**: 2026-03-30
**Review file**: section-03-review.md
**Tests before interview**: 30/30 passing
**Tests after interview**: 31/31 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**MEDIUM: `if (analysisText)` guard could vacuously skip analysis assertions**
- Removed the `if (analysisText)` guard wrapping all four assertion lines in Test 1.1 Stage 4
- Added `expect(analysisText).not.toBeNull()` as the first unconditional assertion
- This ensures the fixture validation is not silently bypassed on a null return

**MEDIUM: Router keys were overly broad substrings**
- Changed `'user_alert_preferences'` → `'/rest/v1/user_alert_preferences'`
- Changed `'profiles'` → `'/rest/v1/profiles'`
- Changed `'admin/users'` → `'/auth/v1/admin/users'`
- Changed `'resend.com'` → `'resend.com'` (already fine), `'onesignal'` → `'onesignal.com'`
- Prevents accidental routing collisions if URLs share substrings

**MEDIUM: Wrong API key variable in `runScoreAlert` call**
- `deepseekApiKey: TEST_ENV.ANTHROPIC_API_KEY` → `deepseekApiKey: TEST_ENV.DEEPSEEK_API_KEY`
- Semantic correctness — test now passes a key named for the service being called

**LOW: Missing `expect(deliveryResult.status).toBe('delivered')`**
- Added delivery status assertion in Test 1.1
- Confirms the delivery result shape includes status field as specified

**LOW: 10b5-1 test missing DeepSeek bypass assertion**
- Added `expectFetchCalledTimes(scoreFetchFn, 0, '10b5-no-ai')` in Test 1.3
- Confirms the 10b5-1 cap fires before any DeepSeek refinement call is made
- Test passes: score-alert.js applies the 10b5 cap during base scoring before calling DeepSeek

**LOW: Gift transaction contract not verified end-to-end**
- Added new `it('gift filing is filtered out by runScoreAlert')` sub-test in Test 1.2
- Calls `runScoreAlert([giftFiling])` with `transactionCode: 'G'` and asserts empty result array
- Covers the contract defined in the spec: gift transactions must be filtered by the scorer itself

### Let-go items (no action)

**SUGGESTION: Split Test 1.1 into sub-tests per stage**
- Test 1.1 is intentionally an end-to-end chain test; splitting into unit-per-stage tests would duplicate what separate section tests cover. Let go.

---

## Result

All fixes applied. Tests re-run after all changes: **31/31 passing** (one new test added).
