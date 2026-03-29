# Code Review Interview — Section 05: Reddit Pipeline E2E

**Date**: 2026-03-30
**Review file**: section-05-review.md
**Tests before interview**: 40/40 passing
**Tests after interview**: 40/40 passing

---

## Triage Summary

### Auto-fixes applied (no user input needed)

**CRITICAL: Add warning comment to `makeDepsFetch` about sync `res.json()`**
- Added explanatory comment above `makeDepsFetch`: `_callClaude` calls `res.json()` synchronously, not as a Promise. Shared helpers' `makeFetch`/`makeRouter` return Promises from `json()` and must NOT be used here — they would cause `_callClaude` to silently return empty string.

**HIGH: Test 3.1 — assert exact comment value (not just typeof)**
- Changed `expect(typeof comment).toBe('string') + expect(comment.length).toBeGreaterThan(0)` → `expect(comment).toBe(VALID_COMMENT)`
- Catches mock-wiring failures (e.g., `_setDeps` not injected, mock returning wrong value)

**HIGH: Test 3.3 — add URL date assertion**
- Added `expect(calledUrl).toContain('2026-03-01')` — frozen fake timers give a deterministic date
- Catches regression where `getESTDateString` produces undefined or empty string, causing the log query to use a wrong date

**MEDIUM: Test 3.2 — derive word-limit strings from SUBREDDIT_TONE_MAP**
- Changed hardcoded `'50-100 words'` and `'150-200 words'` to derive from `SUBREDDIT_TONE_MAP.wallstreetbets.wordLimit` and `SUBREDDIT_TONE_MAP.ValueInvesting.wordLimit`
- Added `expect(wsbLimits[1]).toBeLessThan(viLimits[0])` to assert the tone map spec intent

**LOW: Remove unused `makeNoSleep` import and instantiation**
- Removed from import line and from test body

---

### Let-go items (spec deviations — not actionable)

**`draftComment` is a prompt builder, not an AI caller**: Spec assumed `draftComment(post, insiderData)` returns a comment string with AI call. Production function returns `{ prompt, maxTokens }` synchronously. Tests use `buildCommentPrompt` (the actual AI caller) for the chain and validate-comment integration.

**`validateComment` returns `{ valid, issues }` not a boolean**: Spec said `validateComment(comment) === true`. Production returns `{ valid: true, issues: [] }`. Tests use `expect(validation.valid).toBe(true)`.

**Test 3.2 uses prompt inspection instead of mock comment length**: Word count of Claude's output is determined by Claude's response (which we mock). Asserting word limits in the system prompt body is more robust than counting words in mock responses.

---

## Result

All fixes applied. Tests re-run after all changes: **40/40 passing**.
