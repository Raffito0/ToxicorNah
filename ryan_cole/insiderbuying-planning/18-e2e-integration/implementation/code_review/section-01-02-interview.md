# Code Review Interview — Sections 01 & 02: Helpers, Fixtures, Jest Config

**Date**: 2026-03-30
**Review file**: section-01-02-review.md
**Tests before interview**: 25/25 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**MEDIUM: NOCODB_API_KEY → NOCODB_API_TOKEN in BASE_ENV**
- `helpers.js`: Renamed `NOCODB_API_KEY` → `NOCODB_API_TOKEN` (production code reads `env.NOCODB_API_TOKEN`)
- Also added `NOCODB_PROJECT_ID`, `NOCODB_API_URL`, `FINNHUB_API_KEY`, R2 keys as suggested
- `helpers.test.js` line 143: Updated required-key check `'NOCODB_API_KEY'` → `'NOCODB_API_TOKEN'`

**MEDIUM: ONESIGNAL_API_KEY → ONESIGNAL_REST_API_KEY in BASE_ENV**
- `helpers.js`: Renamed `ONESIGNAL_API_KEY` → `ONESIGNAL_REST_API_KEY`
- `helpers.test.js` line 141: Updated required-key check accordingly

**LOW: Replace noSleep singleton with makeNoSleep() factory**
- `helpers.js`: Replaced module-level `const noSleep = jest.fn()...` with `function makeNoSleep()` factory
- Updated `module.exports` to export `makeNoSleep` instead of `noSleep`
- `helpers.test.js`: Updated import from `noSleep` → `makeNoSleep`, updated both tests to create local instance `const noSleep = makeNoSleep()` per test

**SUGGESTION: Add missing keys to BASE_ENV**
- Applied: `NOCODB_API_TOKEN`, `FINNHUB_API_KEY`, `NOCODB_PROJECT_ID`, `NOCODB_API_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` all added

### Let-go items (no action)

**SUGGESTION: Fix self-contradicting comment in section-02-jest-config.md**
- The spec note at line 65 shows `setupFilesAfterFramework` twice (same wrong string). The implementation already uses the correct key `setupFilesAfterEnv`. Spec comment is misleading but cosmetic — not worth touching the spec doc; the Deviations section already documents the correct key.

---

## Result

All fixes applied. Tests re-run after all changes: **25/25 passing**.
