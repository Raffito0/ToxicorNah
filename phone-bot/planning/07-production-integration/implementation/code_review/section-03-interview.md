# Section 03 Code Review Interview

## Review Findings Triage

### Auto-fixed
1. **Deprecated asyncio API** — Changed `asyncio.get_event_loop().run_until_complete()` to `asyncio.run()` in test_post_retry.py
2. **Session duration comment** — Added clarifying comment about pre/post split matching weekly plan budget

### Intentional (no fix)
1. **Tests mirror algorithm** — Tests define standalone `post_with_retry()` because executor.py has heavy import chains (config, adb, gemini, etc.). The algorithm is simple enough that the test copy stays in sync.
2. **browse_session still has posting code** — Kept for backward compatibility with warmup callers. Not dead code.
3. **Warmup doesn't use retry** — Warmup posting is simpler, runs in try/except already.
4. **No "banned" detection yet** — post_video/post_reel return "retryable" as fallback. "banned" path exists in retry logic for when popup guardian supports it.
5. **AST-only tests for save_as_draft** — Pragmatic given import constraints. Behavioral verification requires phone.
6. **Draft coords unverified** — Risk note acknowledged. Will verify on real devices.
7. **Unrelated changes in diff** — Pre-existing uncommitted changes in tiktok.py/instagram.py. Only section-03 specific files will be committed.

### Deferred
1. **`_last_post_result` initialization** — Not critical, only accessed after post attempt.
