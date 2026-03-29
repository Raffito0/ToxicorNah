# Code Review Interview — section-03: newsletter-gates-and-send

## Summary

All fixes applied. 44/44 tests pass.

---

## H-1 — `sendViaResend` ignores HTTP response status (HIGH) — AUTO-FIX

**Finding**: `postFn(...)` return value was discarded. A Resend 4xx/5xx silently looked like success.

**Fix applied**: Capture response, check `resp.status >= 200 && resp.status < 300`. On failure, call `resp.text()` for the error body and throw `'Resend batch failed with HTTP {status}: {body}'`.

---

## H-2 — `sendViaBeehiiv` swallows failure when `resendFn` is null (HIGH) — AUTO-FIX

**Finding**: When Beehiiv failed AND no `resendFn` was wired, the function logged a warning and returned successfully. Caller had no way to detect that the newsletter was never sent.

**Fix applied**: Changed the `else` branch to `throw new Error('[sendViaBeehiiv] Beehiiv failed and no resendFn provided: ' + fallbackReason)`.

---

## H-3 — `sendWeeklyNewsletter` word count always used `s6_pro` (HIGH) — AUTO-FIX

**Finding**: Line 794 hardcoded `sections.s6_pro` — inconsistent with `checkWordCount` which picks the longer of s6_free/s6_pro.

**Fix applied**: Added `s6forCount` variable mirroring `checkWordCount` logic; uses `s6forCount` in the `wordCountText` join.

---

## M-1 — `_httpsPost.json()` crashed on non-JSON error bodies (MEDIUM) — AUTO-FIX

**Finding**: `JSON.parse(data)` unconditional. Beehiiv HTML error pages trigger SyntaxError as unhandled rejection.

**Fix applied**: Wrapped in try/catch — on parse failure returns `{ _raw: data }` so callers still get a response object.

---

## M-2 — `sendPath` set before `sendViaResend` resolves (MEDIUM) — AUTO-FIX

**Finding**: `sendPath = 'resend'` was set at the start of the closure, before `await sendViaResend(...)`. If the send threw, NocoDB would log `send_path='resend'` for a failed send.

**Fix applied**: Moved `sendPath = 'resend'` to after the `await sendViaResend(...)` line.

---

## M-3 — Subscriber cap at 5000 (MEDIUM) — DOCUMENTED

**Decision**: Added inline comment `// NOTE: capped at 5000 subscribers — no pagination. Sufficient for pre-launch scale.` Pagination is out of scope for this section.

---

## M-4 — AI section content injected raw into HTML (MEDIUM) — USER DECISION

**User chose**: Escape AI output.

**Fix applied**: All 7 section slots (`s1`-`s5`, `s6_free`, `s6_pro`) in both `assembleFreeHtml` and `assembleProHtml` now pass through `escapeHTML()`. Existing tests pass because SAMPLE_SECTIONS strings contain no HTML special characters — escaping is a no-op for them.

---

## L-1 — Missing guard on `BEEHIIV_PUBLICATION_ID` (LOW) — DOCUMENTED

**Decision**: Added comment near the `pubId` assignment: `// NOTE: if BEEHIIV_PUBLICATION_ID is missing the URL becomes /publications//posts (404). The Resend fallback will handle it, but watch for this in env setup.`

---

## L-2 — Log message punctuation (LOW) — LET-GO

Minor inconsistency in hyphen vs en-dash in `console.warn` messages. Not worth a code change.

---

## Final state

| Item | Severity | Action | Result |
|------|----------|--------|--------|
| `sendViaResend` ignores HTTP status | HIGH | Auto-fix | Fixed |
| `sendViaBeehiiv` swallows failure (no resendFn) | HIGH | Auto-fix | Fixed |
| `sendWeeklyNewsletter` wordCount uses s6_pro always | HIGH | Auto-fix | Fixed |
| `_httpsPost.json()` crashes on non-JSON bodies | MEDIUM | Auto-fix | Fixed |
| `sendPath` set before resend resolves | MEDIUM | Auto-fix | Fixed |
| Subscriber cap at 5000 | MEDIUM | Documented | Comment added |
| AI content raw in HTML | MEDIUM | User decided: escape | Fixed |
| Missing BEEHIIV_PUBLICATION_ID guard | LOW | Documented | Comment added |
| Log message punctuation | LOW | Let-go | — |

Tests: 44/44 pass.
