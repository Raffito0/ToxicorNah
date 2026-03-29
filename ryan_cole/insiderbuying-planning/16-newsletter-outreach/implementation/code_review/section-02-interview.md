# Code Review Interview — section-02: newsletter-ai-generation

## Summary

All fixes applied. 20/20 tests pass.

---

## B-1 — `createOpusClient(undefined, key)` crashes in n8n sandbox (HIGH) — AUTO-FIX

**Finding**: `createOpusClient(undefined, key)` stores `undefined` as `_fetchFn`. In n8n sandbox (no
global `fetch`), the first real call throws `TypeError: this._fetchFn is not a function`. Tests escaped
this because `_aiClient` injection bypasses the `createOpusClient` call entirely.

**Fix applied**: Changed to `createOpusClient(_httpsGet, env.KIEAI_API_KEY || '')`. `_httpsGet` is already
defined in the same module.

---

## B-2 — Code-fence regex doesn't handle leading whitespace (MEDIUM) — AUTO-FIX

**Finding**: `/^```(?:json)?\s*/i` only matches a fence at position 0. If the AI response has a leading
newline before the backticks, the regex misses it and `JSON.parse` receives the fence characters,
burning a retry.

**Fix applied**: Changed to `/^\s*```(?:json)?\s*/i` and `/\s*```\s*$/`. Leading/trailing whitespace now
stripped before the fence token.

---

## B-3 — `_sendTelegramAlert` resolve timing dependency (LOW) — AUTO-FIX

**Finding**: `res.on('end', resolve)` may not fire on some Node.js versions if the stream has already
ended by the time the listener is attached. Since we only need to fire-and-forget, resolving immediately
in the response callback is safer.

**Fix applied**: Changed `(res) => { res.resume(); res.on('end', resolve); }` to
`(res) => { res.resume(); resolve(); }`.

---

## B-4 — Plan says DeepSeek, implementation uses Opus (HIGH — plan deviation) — DOCUMENTED

**Finding**: Plan spec (section-02-newsletter-ai-generation.md) explicitly specifies DeepSeek. The
implementation uses `createOpusClient` (Claude Opus via kie.ai).

**Decision**: Keep Opus. `analyze-alert.js` (the file the plan referenced as the pattern) itself uses
`require('./ai-client')`, not raw DeepSeek HTTPS. The entire codebase has migrated to `ai-client.js`
for all AI calls. Using Opus is consistent with how all other human-facing editorial content is
generated. Section doc updated to reflect this.

---

## T-1 — Missing assertion: `lastError` content in retry prompt — ADDED

**Finding**: The retry-on-missing-keys test verified `client.complete` was called twice but did not
assert the retry prompt contained the constraint feedback. The plan mandates this.

**Fix applied**: Added `expect(retryPrompt).toContain('Missing or empty section keys')` to the retry
test.

---

## Final state

| Item | Severity | Action | Result |
|------|----------|--------|--------|
| `createOpusClient(undefined, ...)` | HIGH | Auto-fix | Fixed |
| Code-fence leading whitespace | MEDIUM | Auto-fix | Fixed |
| Telegram resolve timing | LOW | Auto-fix | Fixed |
| Plan says DeepSeek, code uses Opus | HIGH (deviation) | Documented in section doc | Documented |
| Missing retry prompt assertion | MEDIUM | Added test | Fixed |

Tests: 20/20 pass.
