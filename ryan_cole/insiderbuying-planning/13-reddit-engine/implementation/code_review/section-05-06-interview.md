# Code Review Interview — Sections 05 + 06

Sections 05 (CAT 6 DD Posts) and 06 (Anti-AI Detection) were implemented together in one pass
because `_callClaude` (needed by section 05) depends on `NEGATIVE_EXAMPLES` and `ANTI_PUMP_RULE`
constants defined in section 06.

---

## Reviewer Findings and Triage

### C1 — `checkDDPostLimit`: wrong priority (monthly_limit vs too_recent)
**Reviewer claim**: `too_recent` check should come before `monthly_limit` to match "natural" ordering.
**Decision**: LET GO — intentional test-driven ordering.
The test `'returns monthly_limit when 8 posted this month'` passes rows with `posted_at` within 3 days
AND count=8. If `too_recent` were checked first, that test would get `too_recent` instead of
`monthly_limit`. Monthly limit is a hard gate that should be checked first anyway (cheapest check).

### C2 — `checkDDPostLimit` uses `new Date()` instead of `_now()`
**Reviewer claim**: Time injection seam is broken; tests cannot mock current time.
**Decision**: AUTO-FIX — real bug.
Changed `var now = new Date()` → `var now = _now()`. The `threeDaysAgo` and `monthStart`
calculations already reference `now`, so they automatically benefit from the fix.
**Fix applied**: line 701.

### C3 — Double NFA disclaimer
**Reviewer claim**: `NFA` constant is appended in both `buildDDPost` and `_buildSubredditVariants`.
**Decision**: LET GO — false alarm.
The `NFA` variable inside `buildDDPost` is declared but never appended to the return value
(it was a leftover from planning). Only `_buildSubredditVariants` appends the disclaimer.
No double-append in production output.

### A1 — `_selectDDSubreddits` hardcoded thresholds
**Reviewer claim**: score >= 8 and cap >= 5B thresholds are hardcoded; should be config.
**Decision**: LET GO — premature abstraction.
These thresholds are domain knowledge, not operational config. Making them configurable adds
indirection with no current benefit. Can be extracted to constants if they need tuning later.

### A2 — `scheduleDDReplies` window calculation
**Reviewer claim**: `+ 2 * 60 * 60 * 1000` hardcoded reply window.
**Decision**: LET GO — acceptable inline constant.
The 2-hour reply window is a business rule defined once. Wrapping in a named constant would
add noise without improving readability at this scale.

### A3 — Regex `\b([0-9]|10)\b` matches `1` from `10`
**Reviewer claim**: The alternation `[0-9]|10` with word boundaries could match single digits
inside `10`.
**Decision**: LET GO — false alarm, regex is correct.
`\b` word boundaries prevent partial matches. `10` has a word boundary at both ends;
`\b1\b` does NOT match inside `10` because `0` is a word character. The regex functions correctly.

### C4 — `_buildSubredditVariants` silently truncates at 38000 chars
**Reviewer claim**: Truncation is silent; caller doesn't know post was truncated.
**Decision**: LET GO — acceptable defensive limit.
38000 chars is well below Reddit's 40000-char limit. Silent truncation prevents API errors
without breaking the posting flow. A warning log would be nice-to-have but not critical.

### C5 — `_callClaude` returns `''` silently on empty response
**Reviewer claim**: Callers cannot distinguish "Claude returned nothing" from a real error.
**Decision**: AUTO-FIX — easy improvement, improves debuggability.
Added `console.warn('[_callClaude] empty response from Claude API')` before returning `''`.
**Fix applied**: lines 668-671.

### A4 — `_countFundamentalMetrics` regex fragility
**Reviewer claim**: Simple keyword list could miss metrics or have false positives.
**Decision**: LET GO — good-enough heuristic.
The function is a rough signal for subreddit selection (ValueInvesting threshold). Precision
matters less than not over-engineering; false positives mean posting to ValueInvesting more
often, which is low risk.

---

## Summary

| Finding | Action | Reason |
|---------|--------|--------|
| C1 — monthly_limit ordering | Let go | Intentional test-driven ordering |
| C2 — `new Date()` not `_now()` | **Fixed** | Real test-seam bug |
| C3 — double NFA disclaimer | Let go | False alarm, no double-append |
| A1 — hardcoded thresholds | Let go | Not worth premature extraction |
| A2 — hardcoded reply window | Let go | Inline constant, defined once |
| A3 — regex `\b([0-9]\|10)\b` | Let go | False alarm, regex is correct |
| C4 — silent truncation | Let go | Defensive limit, acceptable |
| C5 — silent empty response | **Fixed** | Easy, improves debuggability |
| A4 — regex fragility | Let go | Good-enough heuristic |

Tests after fixes: **105/105 passing**.
