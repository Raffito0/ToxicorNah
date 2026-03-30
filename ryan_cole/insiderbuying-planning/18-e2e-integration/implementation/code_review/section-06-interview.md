# Code Review Interview — Section 06: X Pipeline E2E

**Date**: 2026-03-29
**Review file**: section-06-review.md
**Tests before interview**: 50/50 passing
**Tests after interview**: 55/55 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**CRITICAL: Add `following_count < 10` test (C1)**
- Added a dedicated test: `followers_count: 500, following_count: 5` — asserts `filterRelevant` returns empty array
- The `MIN_FOLLOWING = 10` guard is independent from `MIN_FOLLOWERS = 10`. Without this test, removing one guard from production would go undetected.

**HIGH: Assert request body sent to Anthropic AI (H1)**
- Added `expectFetchCalledTimes(fetchFn, 1, 'buildReplyPrompt')` — confirms exactly one Anthropic call
- Added body assertions: `callBody.messages[0].content` contains `'NVDA'` and `'Jensen Huang'`
- Added `callBody.system` contains `'data-driven'` — the archetype-specific system prompt string
- Catches regressions where filing context is silently omitted from the AI request

**HIGH: Add URL and AI-refusal validateReply tests (H2)**
- Added test: reply containing `.com/` URL path → `error` matches `/link/i`
- Added test: reply containing `'As an AI'` phrase → `error` matches `/AI refusal/i`
- These cover 2 of the 3 untested guard clauses (length boundary guards are lower priority)

**MEDIUM: Add contrarian and pattern archetype branch tests (M2)**
- Added `selectArchetype(null, () => 0.45)` → `'contrarian'`
- Added `selectArchetype(null, () => 0.75)` → `'pattern'`
- Catches future reordering of `REPLY_ARCHETYPES` object keys

---

### Let-go items (not actionable for this spec)

**`getCurrentPollingInterval` and `runXPollingCycle` have zero coverage (M4, M5)**: Out of scope for the chain test spec. These functions are part of the scheduling/state-machine layer, not the engagement chain.

**`postToXWithMedia` not covered (H3)**: Out of scope — this section only covers the `postToX` (no-media) payload builder.

**Date boundary off-by-one (M1)**: `checkDailyReplyCap` counts entries without date-filtering (filtering is delegated upstream). Tests document this contract — boundary testing of `created_at` on `checkDailyReplyCap` is not actionable here.

**Monolithic Test 4.1 structure (L1)**: The spec defines one happy-path chain test. Acceptable as-is — all stages are clearly commented.

---

## Result

All fixes applied. Tests re-run after all changes: **55/55 passing**.
