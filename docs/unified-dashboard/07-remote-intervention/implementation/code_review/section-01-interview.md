# Section 01 Code Review Interview

## Review Findings Triage

### Auto-fixed
1. **Double gate check (executor + tiktok)**: Fixed — executor.py now delegates to `bot._check_pre_post_pause()` via `hasattr` check instead of duplicating gate logic.
2. **Unconditional pause on standalone mode**: Fixed — `_check_pre_post_pause()` returns 'approve' immediately if no `_pre_post_callback` is registered. Standalone phone-bot is unaffected.

### Let go
3. **Race on request_pause replacing event while waiting**: Acknowledged but architecturally impossible — one thread per phone, only one caller per phone_id at a time.
4. **Singleton TOCTOU gap**: CPython GIL makes this safe. No free-threaded Python planned for this project.
5. **No validation of decision strings in resolve()**: Valid but low-risk — all callers are internal code (Telegram handler, dashboard), not user input.
6. **Stale entries if check_and_wait never called**: Very unlikely — request_pause and check_and_wait are always called together. No cleanup needed.
7. **Pause logic (warmup forced vs notify flag)**: Deferred to section-07 (integration wiring) — requires Flask context and BotAccount model access.
8. **Unrelated PopupGuardian changes in diff**: Pre-existing uncommitted changes, not part of this section.
