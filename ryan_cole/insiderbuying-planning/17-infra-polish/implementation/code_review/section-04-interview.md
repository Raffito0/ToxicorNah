# Code Review Interview -- section-04: hero-image-visual-templates

## Summary

Auto-fix applied: H1 (heroPrompt ReferenceError).
All others let-go.
34/34 tests pass.

---

## H1 -- heroPrompt ReferenceError in generateImages (HIGH) -- AUTO-FIX

**Finding**: `generateImages()` still had `prompt_used: heroPrompt` in the Published_Images POST body.
`heroPrompt` was removed with the fal.ai block. When `heroUrl` is truthy (normal production path),
this throws `ReferenceError: heroPrompt is not defined` and crashes the orchestrator after the image
is already uploaded to R2.

**Fix applied**: Changed `prompt_used: heroPrompt` -> `prompt_used: null`.

---

## H2 -- renderTemplate TypeError when fetchFn absent (HIGH) -- LET-GO

**Finding**: `renderTemplate` crashes if `helpers.fetchFn` is undefined. `generateHeroImage` passes
`helpers: { fetchFn: opts.fetchFn }` which can be undefined if caller omits it.

**Decision**: Let-go. In production (`generateImages`), `fetchFn` is always set from `helpers.fetchFn`.
The outer `try/catch` in `generateImages` handles any failure gracefully with `heroUrl = null`.
Adding a guard would change the public contract beyond spec scope.

---

## M1 -- uploadToR2 silent null return (MEDIUM) -- LET-GO

**Finding**: `uploadToR2` returns null silently when `env.R2_ACCOUNT_ID` is missing. If
`R2_PUBLIC_URL` is missing, produces broken URL string.

**Decision**: Let-go. Pre-existing behavior shared across all R2 uploads in the system. Not
introduced by this section.

---

## M2 -- Verdict vocabulary mismatch NO_TRADE vs HOLD (MEDIUM) -- LET-GO

**Finding**: `normalizeVerdict` maps `NO_TRADE` to `HOLD` silently. `BULLISH` test value is not a
real NocoDB verdict type.

**Decision**: Let-go. Pre-existing issue in `visual-css.js` VERDICTS map. Scope of this section is
the T13 field swap, not the verdict normalization system. A separate ticket is needed.

---

## L1 -- R2 key inconsistency (LOW) -- LET-GO (spec-prescribed)

**Finding**: All other images use `earlyinsider/images/{slug}_{type}.png` via `buildR2Key`.
T13 hero uses `hero-{slug}.png` at bucket root.

**Decision**: Let-go. Spec section-04 explicitly prescribes `hero-${article.slug}.png`. Spec takes
precedence over style consistency.

---

## L2 -- buildHeroPrompt dead code (LOW) -- LET-GO

**Finding**: `buildHeroPrompt` is still exported and tested but never called in production paths.

**Decision**: Let-go. Dead code removal is out of scope for this section. The existing tests verify
its behavior correctly; removing the function risks breaking callers outside this section.

---

## Final state

| Finding | Severity | Action | Result |
|---------|----------|--------|--------|
| heroPrompt ReferenceError | HIGH | Auto-fix (null) | Fixed |
| renderTemplate TypeError when fetchFn absent | HIGH | Let-go (catch block) | Noted |
| uploadToR2 silent null | MEDIUM | Let-go (pre-existing) | Noted |
| Verdict vocabulary mismatch | MEDIUM | Let-go (pre-existing) | Noted |
| R2 key inconsistency | LOW | Let-go (spec-prescribed) | Confirmed |
| buildHeroPrompt dead code | LOW | Let-go | Noted |

Tests: 34/34 pass.
