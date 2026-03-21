# External Review Integration Notes

**Reviewer**: Gemini (gemini-3-pro-preview)
**Date**: 2026-03-21
**Plan reviewed**: claude-plan.md

---

## Suggestions INTEGRATED

### 1. App state reset between retries (Section 2)
**Review point**: "Retrying `post_video()` assumes failure was network-related. In UI automation, failure usually means the app is in an unexpected state. You must reset the app state between attempts."

**Decision**: INTEGRATE. This is the right approach. Between attempt 1 and attempt 2, the executor will force-stop the app, wait 3s, reopen it, and give it time to load before trying again. This handles pop-ups, stuck loading screens, and wedged states — the real causes of post failures.

**Changes to plan**: Updated Section 2 to add app-reset step between retries.

### 2. Typed exception classification (Section 2)
**Review point**: "Boolean returns hide context. Raise specific exceptions to distinguish failure modes."

**Decision**: INTEGRATE (simplified). Instead of full exception hierarchy, use 3 return codes: `"posted"` | `"draft"` | `"failed_retryable"` | `"failed_permanent"`. `BannedError` → abort session entirely. `MediaFormatError` → don't retry, mark failed. `AppWedgeError` → reset and retry. This avoids adding a heavyweight exception class hierarchy while solving the actual problem.

**Changes to plan**: Updated Section 2 error classification.

### 3. HTML parse mode for Telegram (Section 3)
**Review point**: "MarkdownV2 is aggressively strict. A single apostrophe in an Airtable record name causes 400 Bad Request, silently dropping critical error alerts."

**Decision**: INTEGRATE. HTML parse mode is correct. Only need to escape `<`, `>`, `&`. No risk of silent alert drops due to special characters in video names or captions.

**Changes to plan**: Updated Section 3 to use HTML parse mode.

### 4. R2 credentials in .env template (Section 1)
**Review point**: ".env template does not include Cloudflare R2 credentials required for `download_video()`."

**Decision**: INTEGRATE. Valid omission. `download_video()` calls into the delivery module which uses R2. The template must include `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`. These are already configured in the n8n VPS `.env` but need to be set locally for the phone-bot machine too.

**Changes to plan**: Updated Section 1 env var list.

### 5. Dry-run must mock Airtable PATCH calls (Section 8)
**Review point**: "Ensure `--dry-run` explicitly mocks the Airtable update calls. You do not want a dry-run accidentally marking real pending videos as 'draft' or 'posted'."

**Decision**: INTEGRATE. Critical. Pass `dry_run=True` down to all delivery module calls. `mark_posted/draft/skipped` must be no-ops in dry-run mode. `get_next_video()` and `download_video()` can still run (read-only).

**Changes to plan**: Updated Section 8 dry-run spec.

### 6. Warmup-only mode when stock is 0 (Section 4)
**Review point**: "Does 'skip-post' mean skip the entire session? The phone should still scroll to keep the account warm."

**Decision**: INTEGRATE. Valid. When stock=0, sessions run in scroll-only mode (no post). The phone opens TikTok, scrolls for the full pre-activity duration, but skips the post phase. This keeps the account active. "Skip-post" means skip the post step, not the entire session.

**Changes to plan**: Clarified Section 4 skip-post behavior.

---

## Suggestions NOT INTEGRATED

### 1. Replace run_forever() with Cron/Systemd
**Review point**: "Do not use `run_forever()`. Use Systemd or Cron to trigger main.py once per day."

**Decision**: NOT INTEGRATED. The system runs on Windows, which has no systemd. Task Scheduler is the Windows equivalent, but the user's setup is a development machine where a running Python process is practical. The plan already mentions Task Scheduler restart-on-failure as a backup. The memory leak concern is valid but manageable — each day's `run_today()` creates fresh bot instances per phone, so the accumulation is bounded. If this becomes a problem in production, switching to Task Scheduler is a one-line change (replace `run_forever()` with a single `run_today()` call + Task Scheduler daily trigger). Not a blocker now.

### 2. SQLite for dashboard-to-bot communication
**Review point**: "If Flask writes to control.json at the exact millisecond the bot reads it, you get JSONDecodeError."

**Decision**: NOT INTEGRATED. Use atomic file writes instead (write to temp file, rename atomically). Python's `os.replace()` is atomic on Windows and avoids the race condition without adding SQLite as a dependency. Adding SQLite to the phone-bot just for a control file is over-engineering at this stage. The dashboard doesn't exist yet.

### 3. SQLite cache for posted_record_ids (idempotency)
**Review point**: "Local SQLite cache prevents duplicate posts if Airtable mark_posted fails."

**Decision**: NOT INTEGRATED. The plan already includes idempotency via `scenario_name + date` check before posting. Adding SQLite adds a new dependency for a problem that has a simpler solution. If Airtable is down, the video stays "pending" (worst case: duplicate post, but that's recoverable). SQLite would help, but the risk profile doesn't justify the complexity at this stage.

### 4. Background thread for Telegram notifications
**Review point**: "Inline Telegram API calls block execution. Use queue.Queue + background thread."

**Decision**: NOT INTEGRATED. Telegram sends are infrequent (1-2 per session, not per frame). Blocking 0.5-2s during session transitions is acceptable — these happen between sessions, not during UI interactions. Adding thread management adds complexity and potential bugs (queue not draining before exit). Simple inline calls with retry_after handling are sufficient.

### 5. Host-side video caching (replace double-download)
**Review point**: "Download video once to host cache, push from cache for both TikTok and IG instead of downloading twice."

**Decision**: NOT INTEGRATED. At current scale (3 phones, ~10MB videos), R2 downloads take <2s. The double-download is a non-issue. Host caching adds complexity (cache directory management, cleanup logic, partial download handling). The plan correctly identifies that the same record is returned for both platforms due to status isolation. This optimization is appropriate at 20+ phones, not now.

### 6. Move proxy config to SQLite/database
**Review point**: "Flask dashboard cannot safely rewrite Python config files. Move proxy config to database."

**Decision**: NOT INTEGRATED (yet). The dashboard doesn't exist. The multi-proxy section (Section 7) stores proxy config in `config.py` for now, with a note that this should move to a managed config file/db when the dashboard is built. The review is correct architecturally but premature for the current scope.

---

## Summary

Integrated: 6 suggestions (app reset between retries, typed errors, HTML Telegram, R2 env vars, dry-run Airtable protection, warmup-only on zero stock)
Not integrated: 6 suggestions (SQLite infra, Systemd, host cache, background Telegram thread — all correct architecturally but over-engineered for current scope)
