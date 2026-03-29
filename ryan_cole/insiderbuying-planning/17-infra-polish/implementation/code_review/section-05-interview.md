# Code Review Interview -- section-05: infra-fixes (A9, A10, A11)

## Summary

1 auto-fix applied (M1). All others let-go.
23/23 tests pass.

---

## H1 -- Tests not written (HIGH) -- LET-GO (FALSE ALARM)

**Finding**: Reviewer claimed checkCapGuard tests were not written.

**Verification**: Tests DO exist in `n8n/tests/reddit-monitor.test.js` lines 160-228
(6 tests, imported on line 13). 23/23 pass. Reviewer confused .js source file with .test.js.

**Decision**: Let-go. No action needed.

---

## M1 -- dailyCap vs daily_limit field name (MEDIUM) -- AUTO-FIX

**Finding**: Spec code block uses `s.daily_limit || 0` but live `SUBREDDIT_TONE_MAP` uses
`dailyCap`. Implementation uses `dailyCap` (correct), but the inconsistency is a silent
maintenance trap for anyone adding new subreddits following the spec template.

**Fix applied**: Added clarifying comment inside `checkCapGuard`:
```javascript
// Uses 'dailyCap' (the actual field name in SUBREDDIT_TONE_MAP).
// The spec draft called it 'daily_limit' but the live data uses 'dailyCap'.
```

---

## L1 -- Startup alertFn null (LOW) -- LET-GO

**Finding**: Module-level `checkCapGuard(SUBREDDIT_TONE_MAP, null)` passes null alertFn,
so no Telegram alert fires at startup even if cap is exceeded.

**Decision**: Let-go. Intentional design: startup logging goes to stdout/stderr (captured
by Docker logs). Telegram alert is only useful when cap is dynamically exceeded at runtime,
not at boot. The guard does still log via console.error at startup.

---

## L2 -- /sitemap/ trailing-slash not redirected (LOW) -- LET-GO

**Finding**: Only `/sitemap` is redirected, not `/sitemap/`.

**Decision**: Let-go. Not a material SEO risk; the primary crawl path is through
`robots.txt` → `/sitemap.xml` directly. Out of spec scope.

---

## Final state

| Finding | Severity | Action | Result |
|---------|----------|--------|--------|
| Tests not written (false alarm) | HIGH | Let-go (tests verified present) | Confirmed 23/23 |
| dailyCap vs daily_limit mismatch | MEDIUM | Auto-fix (comment added) | Fixed |
| Startup alertFn null | LOW | Let-go (intentional) | Noted |
| /sitemap/ trailing slash | LOW | Let-go | Noted |

Tests: 23/23 pass.
