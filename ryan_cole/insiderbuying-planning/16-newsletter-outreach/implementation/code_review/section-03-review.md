# Code Review — section-03: newsletter-gates-and-send

## Summary

44/44 tests pass. Section-03 quality gate, HTML assembly, and send logic implemented.
4 HIGH/MEDIUM issues require fix before commit.

---

## H-1 — `sendViaResend` never checks HTTP response status (HIGH)

**Finding**: Line 733 calls `await postFn(...)` but discards the response entirely:
```js
await postFn('https://api.resend.com/emails/batch', { 'Authorization': 'Bearer ' + apiKey }, JSON.stringify(payload));
```
A Resend 4xx/5xx returns without throwing — the function logs success and returns normally. Subscribers silently don't receive the email with no indication of failure.

**Fix**: Capture response, check `resp.status >= 200 && resp.status < 300`, throw on failure.

---

## H-2 — `sendViaBeehiiv` swallows failure when no `resendFn` provided (HIGH)

**Finding**: When Beehiiv fails AND `resendFn` is null (line 697-700):
```js
if (resendFn) {
  await resendFn(html, subjectA, tier);
} else {
  console.warn('[sendViaBeehiiv] No resendFn provided — Resend fallback skipped');
}
```
The function logs a warning and returns successfully. The caller has no way to detect the failure — the newsletter was never sent.

**Fix**: When `resendFn` is null and fallback is needed, throw with the `fallbackReason` so the caller can surface the error.

---

## H-3 — `sendWeeklyNewsletter` word count uses `s6_pro` always (HIGH)

**Finding**: Line 794 hardcodes `sections.s6_pro` instead of using the longer of s6_free/s6_pro — inconsistent with `checkWordCount` which correctly picks the longer one:
```js
const wordCountText = [sections.s1, sections.s2, sections.s3, sections.s4, sections.s5, sections.s6_pro]
  .join(' ').replace(/<[^>]+>/g, ' ');
```
The `wordCount` logged to NocoDB will be off when `s6_free` is longer than `s6_pro`.

**Fix**: Mirror the `checkWordCount` logic — pick `s6_pro` if `s6_pro.length >= s6_free.length`, else `s6_free`.

---

## M-1 — `_httpsPost.json()` crashes on non-JSON error bodies (MEDIUM)

**Finding**: The `json()` method on the response object does `JSON.parse(data)` unconditionally:
```js
json: () => Promise.resolve(JSON.parse(data)),
```
Beehiiv returns HTML error pages on 5xx. `JSON.parse` throws a SyntaxError that surfaces as an unhandled rejection instead of a clean HTTP error.

**Fix**: Wrap `JSON.parse(data)` in try/catch; on parse failure return `{ _raw: data }` so callers still get a response object.

---

## M-2 — `sendPath = 'resend'` set before `sendViaResend` resolves (MEDIUM)

**Finding**: Inside `makeResendFallback`, `sendPath` is mutated before the await:
```js
return async function(html, subject) {
  sendPath = 'resend';           // set before await
  ...
  await sendViaResend(...);      // may throw
};
```
If `sendViaResend` throws, the NocoDB log will record `send_path='resend'` even though the send failed.

**Fix**: Move `sendPath = 'resend'` to after the `await sendViaResend(...)` line.

---

## M-3 — Subscriber fetch cap at 5000 with no pagination (MEDIUM, DOCUMENTED)

**Finding**: `nocodbApi.list('Newsletter_Subscribers', { limit: 5000 })` hard-caps at 5000 rows. If the subscriber list exceeds 5000, some subscribers are silently skipped.

**Decision**: Document as a known limitation. Pagination would require multiple list calls + cursor tracking — significant scope expansion. At current scale (pre-launch), 5000 is safe. Add a comment warning in the code.

---

## M-4 — AI section content injected raw into HTML (MEDIUM, USER DECISION)

**Finding**: AI-generated section text (`sections.s1` through `sections.s6_pro`) is concatenated directly into HTML `<div>` wrappers without `escapeHTML()`:
```js
'<div style="margin:24px 0;">' + (sections.s1 || '') + '</div>'
```
If the AI outputs a `<script>` tag or `<a href="javascript:...">`, it would render as live HTML in email clients.

**Options**:
- A) Keep raw injection — AI is a trusted internal system, XSS risk is low for a newsletter
- B) Escape AI output — safe default, prevents any accidental tag injection

**Decision**: Needs user input.

---

## L-1 — Missing guard on `BEEHIIV_PUBLICATION_ID` (LOW, DOCUMENTED)

**Finding**: If `BEEHIIV_PUBLICATION_ID` is empty, the Beehiiv URL becomes `https://api.beehiiv.com/v2/publications//posts`, which returns 404. The fallback triggers silently.

**Decision**: Document. A missing env var guard is an operational risk, not a code bug. The Resend fallback handles it. Add comment.

---

## L-2 — `console.warn` hyphen vs en-dash in messages (LOW, LET-GO)

Minor inconsistency in log message punctuation. Not worth a code change.

---

## Final Assessment

| Item | Severity | Action |
|------|----------|--------|
| `sendViaResend` ignores HTTP status | HIGH | Auto-fix |
| `sendViaBeehiiv` swallows failure (no resendFn) | HIGH | Auto-fix |
| `sendWeeklyNewsletter` wordCount uses s6_pro always | HIGH | Auto-fix |
| `_httpsPost.json()` crashes on non-JSON bodies | MEDIUM | Auto-fix |
| `sendPath` set before resend resolves | MEDIUM | Auto-fix |
| Subscriber cap at 5000 | MEDIUM | Document in code |
| AI content raw in HTML | MEDIUM | User decision |
| Missing BEEHIIV_PUBLICATION_ID guard | LOW | Document in code |
| Log message punctuation | LOW | Let-go |

Tests: 44/44 pass.
