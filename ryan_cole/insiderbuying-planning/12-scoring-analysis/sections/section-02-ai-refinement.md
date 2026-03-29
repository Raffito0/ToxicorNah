# Section 02: AI Refinement Layer

## Overview

This section adds `callDeepSeekForRefinement(filing, baseScore)` to `score-alert.js`. It is called immediately after `computeBaseScore()` (section-01) and applies a constrained ±1 AI adjustment to produce the final score. The goal is to capture qualitative context the deterministic formula cannot compute — without allowing the AI to override the formula's numeric judgment.

**Depends on**: section-01 (computeBaseScore must exist and return a base score before this function is called).

**Blocks**: section-03 (runScoreAlert integrates both base scoring and AI refinement before filtering logic is finalized).

---

## File to Modify

```
n8n/code/insiderbuying/score-alert.js
```

No workflow JSON changes required. The existing `runScoreAlert(filing, deps)` function signature is unchanged — this new function is an internal helper called inside it.

---

## Tests First

**File**: `n8n/tests/score-alert.test.js` — add a `callDeepSeekForRefinement()` describe block.

Write these tests before implementing. All tests use dependency injection: pass `fetchFn` as `jest.fn()` to intercept DeepSeek calls, and `sleep` as `() => Promise.resolve()` to skip delays.

### Response Parsing

```
describe('callDeepSeekForRefinement - response parsing', () => {
  // Test: valid JSON {"adjustment": 1, "reason": "first buy in years"}
  //   → adjustment applied, final_score = base_score + 1

  // Test: valid JSON {"adjustment": 0, "reason": "routine cluster trade"}
  //   → final_score = base_score unchanged

  // Test: valid JSON {"adjustment": -1, "reason": "heavy selling context"}
  //   → final_score = base_score - 1

  // Test: JSON wrapped in markdown fences ```json{"adjustment": 0, "reason": "..."}```
  //   → strips fences, parses correctly, adjustment applied

  // Test: out-of-range adjustment value 2
  //   → clamped to 1, applied as +1

  // Test: out-of-range adjustment value -2
  //   → clamped to -1, applied as -1
})
```

### Retry and Fallback

```
describe('callDeepSeekForRefinement - retry and fallback', () => {
  // Test: invalid JSON response on first call, valid JSON on second call
  //   → uses second result, no crash

  // Test: empty string response on first call, valid JSON on second call
  //   → triggers retry, uses second result

  // Test: both calls return invalid JSON
  //   → ai_adjustment = 0, final_score = base_score, warning logged

  // Test: DeepSeek throws a network error on first call, valid response on second
  //   → recovers, uses second result

  // Test: DeepSeek throws on both calls
  //   → ai_adjustment = 0, final_score = base_score, warning logged
})
```

### 10b5-1 Cap

```
describe('callDeepSeekForRefinement - 10b5-1 plan handling', () => {
  // Test: is10b5Plan = true
  //   → fetchFn (DeepSeek) never called (refinement skipped entirely)

  // Test: is10b5Plan = true, base_score = 4
  //   → final_score = 4 (under cap, untouched)

  // Test: is10b5Plan = true, base_score = 5
  //   → final_score = 5 (exactly at cap, untouched)

  // Test: is10b5Plan = true, base_score = 7 (formula produced a high base)
  //   → final_score = 5 (cap enforced)

  // Test: is10b5Plan = false, base_score + adjustment would be 11
  //   → clamped to 10
})
```

### Output Shape

```
describe('callDeepSeekForRefinement - returned object shape', () => {
  // Test: returned object always includes base_score, ai_adjustment, ai_reason, final_score

  // Test: on successful AI call, ai_reason contains the string from DeepSeek response

  // Test: on fallback (AI failed), ai_adjustment = 0 and ai_reason contains a
  //   non-empty explanation string (e.g., "AI refinement failed, using base score")
})
```

---

## Implementation

### Function Signature

```javascript
async function callDeepSeekForRefinement(filing, baseScore, deps)
// filing   — the filing object (needs: is10b5Plan, direction, and qualitative context fields)
// baseScore — number from computeBaseScore(), e.g. 7.3
// deps     — { fetchFn, sleep, env } (same deps object as runScoreAlert)
// Returns  — { base_score, ai_adjustment, ai_reason, final_score }
```

### When to Skip Entirely

If `filing.is10b5Plan === true`, skip DeepSeek entirely:
- Apply the 10b5-1 cap: `final_score = Math.min(baseScore, 5)`
- Return `{ base_score: baseScore, ai_adjustment: 0, ai_reason: '10b5-1 plan — cap applied, refinement skipped', final_score }`

This avoids paying for an API call and makes the cap logic unambiguous (no risk of a +1 AI adjustment pushing a capped trade above 5).

### Prompt Construction

The prompt must be short and structured. Use temperature `0.0` for maximum determinism. The prompt includes:

- The base score
- The transaction direction text (`'buy'` when `filing.direction === 'A'`, `'sell'` when `filing.direction === 'D'`)
- Four specific qualifying factors that the deterministic formula cannot compute

**Direction-aware framing for the four qualifying factors**:

For buys (`direction = 'A'`):
1. Is this the insider's first purchase in 2+ years after a long period of no buying?
2. Did the insider buy into a recent earnings miss or analyst downgrade (buying a dip)?
3. Did the insider significantly increase their position size vs. their typical trade size?
4. Is there an unusual timing signal (e.g., bought right before a product launch, deal announcement window)?

For sells (`direction = 'D'`):
1. Is this the insider's first sale in 2+ years after a long period of no selling?
2. Did the insider sell into strength (stock near all-time highs) suggesting bearish conviction rather than routine diversification?
3. Is the sell size unusually large relative to their typical sale history?
4. Is there a timing signal that suggests informed selling rather than routine tax planning?

The prompt instructs DeepSeek to respond with **only** a JSON object — no prose, no markdown blocks. Required schema:

```json
{"adjustment": 0, "reason": "one sentence explanation"}
```

Where `adjustment` is an integer: -1, 0, or 1.

### Response Validation and Parsing

Before calling `JSON.parse()`:
1. Strip markdown code fences: remove ` ```json `, ` ``` `, and surrounding whitespace
2. Trim the result

After parsing:
- If parsing fails → retry
- If `adjustment` is not -1, 0, or 1 → clamp to the nearest valid value (i.e., values > 1 become 1, values < -1 become -1)
- If `reason` is missing or empty → substitute a default string, do not retry for this alone

### Retry Logic

```
Attempt 1: call DeepSeek
  → on success with valid JSON: proceed
  → on failure (network error, invalid JSON, empty response):
      wait 2 seconds (deps.sleep(2000))
      Attempt 2: retry with identical prompt
        → on success: proceed
        → on any failure: set ai_adjustment = 0, ai_reason = 'AI refinement failed after 2 attempts — using base score', log WARN
```

The retry is a single re-send of the same prompt. Do not modify the prompt on retry.

### Final Score Computation

```javascript
const raw = baseScore + ai_adjustment;
const final_score = Math.min(10, Math.max(1, parseFloat(raw.toFixed(1))));
```

Note: `baseScore` already has one decimal (from `computeBaseScore`). Adding an integer adjustment keeps one decimal precision. The `parseFloat(toFixed(1))` call prevents floating point drift (e.g., 7.3 + 1 = 8.300000000000001).

### Return Value

Always return an object with these four fields:

```javascript
{
  base_score: baseScore,          // original deterministic score, e.g. 7.3
  ai_adjustment: aiAdjustment,    // integer: -1, 0, or 1
  ai_reason: aiReason,            // string from DeepSeek or fallback explanation
  final_score: finalScore         // clamped [1, 10], one decimal
}
```

These four fields are stored in NocoDB as separate columns (`base_score`, `ai_adjustment`, `ai_reason` in addition to the existing score field) so individual scoring decisions are auditable.

---

## Integration into runScoreAlert()

Inside `runScoreAlert(filing, deps)`, after calling `computeBaseScore(filing)`:

```javascript
// Pseudocode — replace existing Claude Haiku call with:
const baseScore = computeBaseScore(filing);
if (baseScore === 0) {
  // G/F exclusion already handled — return null
}
const refinement = await callDeepSeekForRefinement(filing, baseScore, deps);
// refinement.final_score is what gets stored and forwarded
```

The existing AI scoring call (Claude Haiku assign 1-10) is removed entirely and replaced by this two-step flow.

---

## DeepSeek Client

Use the existing `callDeepSeek(prompt, options)` from unit-10 (AI provider swap). The `options` object should include `{ temperature: 0.0 }`. The DeepSeek client is available via `deps` or module scope depending on how unit-10 was wired — check how other callers in `score-alert.js` currently invoke it.

---

## NocoDB Schema Note

The NocoDB alert table needs three additional columns for the data this function produces. These may already exist from unit-08 if the migration was thorough:

- `base_score` — decimal
- `ai_adjustment` — integer (-1, 0, 1)
- `ai_reason` — text

If they do not exist, add them. No other schema changes are required for this section (the `direction` and `is10b5_plan` columns are handled in section-03).

---

## Boundaries

This section does **not** implement:
- The G/F exclusion filter (that is section-03's belt-and-suspenders check)
- Same-day sell detection (section-03)
- Score logging (section-03)
- The final NocoDB write (section-03 wires together all the outputs)

This section's only job is to take a `baseScore` number and return a `{ base_score, ai_adjustment, ai_reason, final_score }` object, handling all DeepSeek failure modes gracefully.

---

## Implementation Notes (Actual)

- File modified: `n8n/code/insiderbuying/score-alert.js` — added `REFINEMENT_FALLBACK_REASON`, `_buildRefinementPrompt()`, `_stripFences()`, `callDeepSeekForRefinement()`, export
- File modified: `tests/insiderbuying/score-alert.test.js` — added 17 core tests + `beforeEach(() => sleep.mockClear())` + 1 whitespace-only reason test (19 tests total for S02)
- `deps` signature uses `{ client, sleep }` not `{ fetchFn, sleep, env }` from spec — `client` wraps the DeepSeek call; `env` is unused at this layer
- 10b5-1 final_score uses `Math.min(5, Math.max(1, baseScore))` (not just `Math.min(baseScore, 5)`) — lower-bound clamp added per code review to match spec `[1, 10]` contract
- Retry loop: `continue` on empty string still triggers sleep on next iteration because `attempt` increments to 1 — added inline comment to clarify
- `client.complete(null, prompt, { temperature: 0.0 })` — `null` first arg = no system prompt, user-turn only — added comment per code review
- `beforeEach(() => sleep.mockClear())` added to prevent sleep call count accumulation across tests
- 121/121 tests pass after all fixes (total suite, all sections).
