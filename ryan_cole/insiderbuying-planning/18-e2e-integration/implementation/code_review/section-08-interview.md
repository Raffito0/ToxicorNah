# Code Review Interview — Section 08: Newsletter Pipeline E2E

**Date**: 2026-03-29
**Review file**: section-08-review.md
**Tests before interview**: 79/79 passing
**Tests after interview**: 82/82 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**HIGH: Add `sendWeeklyNewsletter` word-count-gate test (H1)**
- Calls `sendWeeklyNewsletter` with short AI response (30 words/section = 210 words, fails < 1000 gate)
- Asserts promise rejects with `/word count/i`
- Asserts `beehiivPostFn` called 0 times — proves orchestrator stops before delivery
- Without this test, deleting `checkWordCount(sections)` at line 792 would pass all other tests

**HIGH: Add `sendViaBeehiiv` failure path test (H2)**
- `_postFn` returns `{ status: 500, json: async () => ({}) }` with no `_resendFn`
- Asserts promise rejects — proves the error propagates rather than silently swallowing

**MEDIUM: Distinct sentinel strings per section in `makeSections` (M3)**
- Changed from all-identical "word" text to per-section sentinels (S1SENTINEL, S4SENTINEL, etc.)
- Added `expect(html).not.toContain('S4SENTINEL')` and `.not.toContain('S5SENTINEL')` in free HTML test
- Added `expect(html).toContain('S4SENTINEL')` and `.toContain('S5SENTINEL')` in pro HTML test
- Detects content leakage between tiers that identical text would mask

**MEDIUM: Assert full Beehiiv URL path including publication ID (M4)**
- Changed `toContain('beehiiv.com')` to `toContain('/v2/publications/pub_test_000/posts')`
- Catches bug where `BEEHIIV_PUBLICATION_ID` env key is misread or omitted

**MEDIUM: Assert Authorization header on Beehiiv calls (M5)**
- Added `expect(call1[1]).toEqual(expect.objectContaining({ Authorization: 'Bearer test-beehiiv-key-000' }))`
- Catches API key regression without requiring a real Beehiiv request

**MEDIUM: Add `sendWeeklyNewsletter` happy-path test (M6)**
- New `describe('Test 6.3')` with full orchestration test
- Asserts: AI called once, Beehiiv called twice, NocoDB `create` called once with correct fields
- Provides integration coverage for `gatherFn → generateNewsletter → gates → assemble → send → log` chain

---

### Let-go items

**L7: Use `expectFetchCalledTimes` helper**: `sendViaBeehiiv` uses `_postFn` (jest.fn), not fetchFn — helper wrapper adds no value here

**L8: Move pre-check inside main describe**: Cosmetic org issue, not worth changing test grouping
