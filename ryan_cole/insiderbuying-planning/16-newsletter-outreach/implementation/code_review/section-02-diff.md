# Section-02 Diff — newsletter-ai-generation

Files modified:
- `n8n/code/insiderbuying/weekly-newsletter.js` (+125 lines)
- `tests/insiderbuying/weekly-newsletter.test.js` (+146 lines)

Key changes:
1. Added `require('./ai-client')` — uses `createOpusClient` (Opus via kie.ai) for human-facing content
2. Added `_NEWSLETTER_SYSTEM_PROMPT`, section descriptions, and JSON schema constants
3. Added `_sendTelegramAlert(msg, env)` — native `https.request` POST helper
4. Added `generateNewsletter(data, _opts)` — 3-attempt retry loop with constraint feedback
5. Added 8 tests for all acceptance criteria
6. Added `generateNewsletter` to `module.exports`

Design decisions vs spec:
- Spec said "Use the same HTTPS pattern as analyze-alert.js (plain require('https') DeepSeek call)"
  — `analyze-alert.js` itself uses `require('./ai-client')`, not raw DeepSeek HTTPS
  — Used `createOpusClient` (consistent with all other human-facing content in the codebase)
- `_telegramFn` injectable for tests (avoids real network calls in test suite)
- `_aiClient` injectable for tests (no need for module-level jest.mock on the actual call)
