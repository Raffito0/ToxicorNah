# Section 01 Interview — ai-client.js

No user interview required. All review items resolved during triage.

## Triage Decisions

**Issue 1: Missing `stream: false` in DeepSeek body**
- Decision: Auto-fix
- Reason: DeepSeek API may default to streaming without this flag, breaking `response.json()` calls. Adding `stream: false` ensures consistent non-streaming responses.
- Fix applied: Added `body.stream = false` in `_buildBody()` DeepSeek branch.

**Issue 2: Config field named `url` instead of `baseUrl`**
- Decision: Let go
- Reason: Cosmetic naming deviation with no behavioral impact. Tests pass. Callers don't access config internals directly.

## Result

44/44 tests pass after auto-fix. No regressions.
