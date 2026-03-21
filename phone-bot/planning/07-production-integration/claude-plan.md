# Implementation Plan: Production Integration

## Overview

This plan transforms the phone-bot from a test/development tool into a production system that runs 24/7, posting videos on TikTok and Instagram across multiple phones. The system is managed via a Flask dashboard and monitored via Telegram.

The phone-bot code (browse sessions, human behavior, Gemini vision, posting) is already complete. What's missing is the "glue": retry logic, monitoring, service lifecycle, and configuration.

---

## Section 1: Environment Configuration & Delivery Path Reconciliation

### Problem

The system has two disconnected video delivery paths:
1. **Delivery module** (`Weekly & Daily Plan/delivery/`): `push_to_phone()` pushes to `/sdcard/DCIM/Camera/` via `ADB_SERIAL_PHONE{N}` env vars
2. **Executor/post_video()**: `adb.push_file()` pushes to `/sdcard/Download/video_{timestamp}.mp4` using the already-connected ADB controller

Path 2 is what actually runs. Path 1 (`push_to_phone()`) is imported but never called.

### Solution

Remove `push_to_phone()` from the executor import chain. The delivery module's role is: `get_next_video()` (Airtable query) + `download_video()` (R2 download) + `mark_posted/draft/skipped()` (status update). The ADB push is handled by `post_video()`/`post_reel()` directly — they already push the file as part of their flow.

Create a `.env` file template with all required variables and a `setup_env.py` script that validates each variable before first production run.

### Files to modify
- `phone-bot/planner/executor.py` — remove `push_to_phone` from delivery import
- Create `phone-bot/.env.template` — all required env vars with descriptions
- Create `phone-bot/setup_env.py` — validates env vars, tests ADB connections, tests proxy, tests Airtable

### Env vars to configure
```
PHONEBOT_TEST=0
AIRTABLE_API_KEY=pat...
PROXY_USERNAME=...
PROXY_PASSWORD=...
PROXY_ROTATION_TOKEN=...
HOTSPOT_SSID=PhoneBot_Proxy
HOTSPOT_PASSWORD=...
GEMINI_API_KEY=AIza...
PHONEBOT_TELEGRAM_TOKEN=123:ABC...
PHONEBOT_TELEGRAM_CHAT=123456789
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_URL=https://pub-...r2.dev
ADB_SERIAL_PHONE1=...
ADB_SERIAL_PHONE2=...
ADB_SERIAL_PHONE3=...
```

Note: ADB serials are only needed if the delivery module's `push_to_phone()` is ever called directly. In the current architecture, the bot manages ADB via its own connected ADB controller — but the serials should be documented in the template for reference.

---

## Section 2: Post Retry Logic

### Problem

If `post_video()` or `post_reel()` returns `False`, the executor continues the session without retry. The video remains "pending" in Airtable and will be picked up again in a future session — but there's no explicit retry, no draft fallback, and no notification.

### Solution

Wrap the post call in a retry loop inside `_execute_normal()`. The critical insight for UI automation is that a failed post usually means the app is in an unexpected state (pop-up, stuck loading screen, wedged state) — not a network error. Between attempts, the app must be reset to a clean state.

**Retry flow**:
```
Attempt 1: post_video(path, caption)
  → Success: return "posted"
  → Retryable failure: force-stop app, wait 3s, reopen app, wait for load
Attempt 2: post_video(path, caption)
  → Success: return "posted"
  → Any failure: save as draft
Draft save: bot.save_as_draft(path, caption)
  → Success: return "draft"
  → Failure: mark as "failed", send critical Telegram alert, return "failed"
```

**Error classification**:

`post_video()` / `post_reel()` should return a result code rather than a bare boolean:
- `"success"` → posted, mark_posted in Airtable
- `"retryable"` → UI failure, trigger app reset + retry
- `"banned"` → account restriction detected, abort session entirely (no retry)
- `"media_error"` → video format/size rejected, don't retry (same error will happen again)

The retry logic lives in executor.py, not in the posting functions themselves. `post_video()`/`post_reel()` remain pure "try once" operations.

The draft fallback (`save_as_draft()`) is a new method on both TikTokBot and InstagramBot: opens post screen, fills caption, taps "Save draft" instead of "Post". If draft save also fails, mark as "failed" in Airtable and send critical alert.

### Files to modify
- `phone-bot/planner/executor.py` — add `_post_with_retry()`, replace direct `post_video()` calls
- `phone-bot/actions/tiktok.py` — update `post_video()` to return result code, add `save_as_draft()`
- `phone-bot/actions/instagram.py` — update `post_reel()` to return result code, add `save_as_draft()`

---

## Section 3: Telegram Production Monitoring

### Problem

`telegram_watchdog.py` is for FORGE development sessions. Production needs different monitoring: session lifecycle events, post results, stock alerts, daily summaries.

### Solution

Create `phone-bot/core/telegram_monitor.py` — a singleton monitor that sends structured HTML messages to Telegram.

**Parse mode: HTML** (not MarkdownV2). HTML requires only escaping `<`, `>`, `&`. MarkdownV2 is fragile — special characters in video names or captions cause silent 400 errors that drop critical alerts.

**Message types**:

1. **Session start**: `"📱 Phone 2 TikTok | Session started | Type: normal | Post: scheduled"`
2. **Session result**: `"✅ Phone 2 TikTok | DONE | Posted: video_name | Duration: 18m"` or `"❌ Phone 2 TikTok | ERROR | Reason: upload_failed | Duration: 5m"`
3. **Post failure**: `"🚨 POST FAILED | Phone 2 TikTok | After 2 retries | Saved as draft | Video: scenario_name"`
4. **Stock alert**: `"⚠️ LOW STOCK | Phone 2: 3 videos remaining (need 14) | Posting will skip if 0"`
5. **Daily summary** (sent after last session):
   ```
   📊 Daily Summary
   Sessions: 12/12 completed
   Posts: 5 TikTok + 5 IG (1 draft, 1 skipped)
   Errors: 0
   Stock: Ph1=12, Ph2=8 ⚠️, Ph3=14
   ```

**Implementation**: Inline `requests.post()` to Telegram Bot API (no framework, no background thread). Rate limit handling: check for `retry_after` in 429 responses, sleep and retry once. Helper function `_html_escape(text)` for safe message construction.

Telegram sends happen between sessions (not during UI interactions), so the 0.5-2s blocking time is acceptable at this scale.

**Integration points in executor.py**: Add `monitor.session_start()` and `monitor.session_result()` calls at the appropriate places. Stock check runs once at the start of `run_today()`.

### Files to create
- `phone-bot/core/telegram_monitor.py` — singleton monitor class with HTML formatting

### Files to modify
- `phone-bot/planner/executor.py` — add monitor calls at session start/end/error
- `phone-bot/config.py` — add TELEGRAM config section

---

## Section 4: Content Library Stock Monitoring

### Problem

Content Library has limited stock (Phone 1: 1, Phone 2: 5, Phone 3: 3 videos). At 2 posts/day, this runs dry in 1-2 days. No alert system exists.

### Solution

At the start of `run_today()`, query Airtable for each phone's pending video count. If any phone has fewer than 14 (7-day buffer), send Telegram alert. If a phone has 0, all its posting sessions run in **warmup-only mode** (scroll-only, no post attempt).

**Important distinction**: "stock=0" does NOT mean skip the session entirely. The phone still opens TikTok, scrolls for the full pre-activity duration, and engages normally. Only the post phase is skipped. This keeps the account algorithmically active and avoids looking dormant.

**Stock check function**:
```python
def check_content_stock(phones: list[int]) -> dict[int, int]:
    """Returns {phone_id: pending_count} for each phone."""
```

Uses `delivery.get_next_video()` pattern — Airtable query with `FIND('Phone N', {content_label})` + count pending.

**Decision matrix**:
- Stock >= 14 → normal posting
- Stock 1-13 → post normally BUT send Telegram warning
- Stock 0 → warmup-only mode for all this phone's sessions today, send critical alert

### Files to modify
- `phone-bot/planner/executor.py` — add stock check in `run_today()`, implement warmup-only mode
- `phone-bot/core/telegram_monitor.py` — add `stock_alert()` method

---

## Section 5: Cross-Platform Posting Verification

### Problem

The documented flow says: TikTok downloads+posts first, then IG reuses the file already on the phone. But in the executor code, each session independently calls `download_video()`. This means the video is downloaded twice (once for TikTok, once for IG).

### Solution

The double-download is intentional and acceptable at current scale — R2 downloads take <2s for a 10MB video. Each session is independent, which is architecturally clean. The key things to verify are the delivery logic and status isolation:

1. **Same video selected**: Both `get_next_video(phone_id, "tiktok")` and `get_next_video(phone_id, "instagram")` must return the same video record. They query by `platform_status_tiktok='pending'` and `platform_status_instagram='pending'` independently — so they DO get the same record (since both statuses are "pending" initially).

2. **Status isolation**: After TikTok posts and calls `mark_posted(record_id, "tiktok")`, only `platform_status_tiktok` is updated. The IG session queries `platform_status_instagram='pending'` — which still returns the same record. Correct.

3. **File cleanup**: Both `post_video()` and `post_reel()` delete the video from the phone after posting. The second platform's posting function pushes the file again before posting, so this is fine.

**Verification plan**: Write an integration test that simulates the full status-isolation flow without actually posting:
```
get_next_video(1, "tiktok") → record A
mark_posted(A, "tiktok")
get_next_video(1, "instagram") → should return record A (IG status still pending)
mark_posted(A, "instagram")
get_next_video(1, "tiktok") → should return record B (A is fully posted)
```

### Files to create
- `phone-bot/tests/test_cross_platform_posting.py` — integration test with real Airtable

---

## Section 6: Always-On Service Architecture

### Problem

The bot is currently a one-shot script: `python main.py` runs today's sessions and exits. For 24/7 operation, it needs to:
1. Stay running between days
2. Generate/load the next day's plan at midnight
3. Handle graceful shutdown from dashboard
4. Support dynamic phone addition without restart

### Solution

Add a `run_forever()` mode that loops daily:

```
while running:
    plan = load_or_generate_today_plan()
    await run_today(plan)
    wait_until_midnight()
    # next iteration loads tomorrow's plan
```

Note: `run_forever()` is appropriate for this Windows-based setup. Each day's `run_today()` creates fresh bot instances per phone, bounding memory accumulation. If memory issues arise, the Task Scheduler restart-on-failure (already planned) handles it by relaunching the process daily.

**Dashboard control**: The bot reads a control file between sessions. Writes use Python's `os.replace()` (atomic on Windows) to avoid race conditions — the bot never reads a half-written file.

**Dynamic phone addition**: When a new phone is added via dashboard:
1. Dashboard writes phone config to a shared JSON file or database
2. Bot detects new phones at the start of each day's `run_today()` cycle
3. New phones auto-enter warmup (executor already handles this — checks `warmup_state.json`)

**Graceful shutdown**: Set a `running = False` flag. The bot finishes the current session, then exits the main loop. No session interruption.

### Architecture choice

**Option A**: Bot runs as a standalone Python process with a control file
- Dashboard writes to `phone-bot/data/control.json` (`{"action": "stop"}`) using atomic write (temp file → rename)
- Bot checks this file between sessions
- Simple, no extra dependencies

**Option B**: Bot exposes a FastAPI endpoint on localhost
- Dashboard calls `POST /api/bot/stop`, `GET /api/bot/status`
- More complex but cleaner API

**Recommendation**: Option A for now (simpler, no new dependencies). Option B when dashboard integration matures.

### Files to modify
- `phone-bot/main.py` — add `run_forever()` mode
- `phone-bot/planner/executor.py` — add `check_new_phones()` at start of `run_today()`

### Files to create
- `phone-bot/data/control.json` — bot control file (stop/restart commands)

---

## Section 7: Multi-Proxy Support

### Problem

Currently 1 SOCKS5 proxy for all phones. With 4+ phones, need multiple proxies. Each account should select its proxy from a dashboard dropdown.

### Solution

Change `config.PROXY` from a single dict to a list of proxy configs:

```python
PROXIES = [
    {"id": "proxy-1", "host": "sinister.services", "port": 20002, ...},
    {"id": "proxy-2", "host": "sinister.services", "port": 20003, ...},
]
```

Each account in `config.ACCOUNTS` gets a `proxy_id` field. `proxy.py` looks up the proxy config by ID when switching phones.

**Note**: Proxy assignment is currently in `config.py`. When the Flask dashboard is built, proxy config and account-to-proxy mappings should move to a managed JSON/db file that Flask controls. For now, `config.py` holds both secrets (via env vars) and operational config (proxy list).

### Files to modify
- `phone-bot/config.py` — change `PROXY` to `PROXIES` list, add `proxy_id` to accounts
- `phone-bot/core/proxy.py` — `ProxyQueue.switch_to_phone()` uses account's proxy_id

---

## Section 8: End-to-End Integration Test

### Problem

No test verifies the full production flow: load plan → wait → proxy → open app → scroll → post → mark posted → close → next session.

### Solution

Create a production dry-run test mode: `python main.py --dry-run`

This mode:
- Loads the weekly plan for today
- Executes each session with `dry_run=True` flag:
  - Proxy rotation: simulated (logged but not called)
  - App open/close: real (verifies ADB works)
  - Scroll: real but shortened (30s instead of 8-15 min)
  - Post: simulated (opens post screen, verifies video is selectable, but doesn't tap Post)
  - **Airtable PATCH calls**: fully mocked — `mark_posted/draft/skipped` are no-ops when `dry_run=True`. `get_next_video()` and `download_video()` still run (read-only operations)
  - Telegram notifications: real (verifies monitoring works)
- Takes ~10 minutes instead of ~4 hours
- Validates the entire pipeline without actually posting or modifying production data

The `dry_run=True` flag must be passed through the executor down to every delivery module call. The delivery module's status functions (`mark_posted`, `mark_draft`, `mark_skipped`) check this flag and return early without making PATCH requests.

### Files to modify
- `phone-bot/main.py` — add `--dry-run` CLI flag
- `phone-bot/planner/executor.py` — thread `dry_run` flag through to all delivery calls
- Delivery module status functions — respect `dry_run=True` parameter

---

## Implementation Order

```
Section 1 (env config)      ← must be first, everything depends on this
    ↓
Section 5 (cross-platform)  ← verify delivery logic before adding retry
    ↓
Section 2 (post retry)      ← core posting reliability
    ↓
Section 3 (Telegram monitor) ← monitoring infrastructure
    ↓
Section 4 (stock monitor)   ← uses Telegram monitor from Section 3
    ↓
Section 6 (always-on)       ← service architecture
    ↓
Section 7 (multi-proxy)     ← scaling infrastructure
    ↓
Section 8 (E2E test)        ← validates everything together
```

Sections 1-4 are the critical path for minimum viable production. Sections 5-8 are for scaling and robustness.

The dry-run infrastructure (Section 8) could be built early to safely test Sections 2-4 without spamming live accounts. If that's preferred, build Section 8's dry-run flag immediately after Section 1, then use it while building Sections 2-4.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Airtable API down during mark_posted | Wrap in try/except, log error, video stays "pending". Idempotency check (scenario_name + date) before each post prevents duplicate posts if Airtable recovers and the video was already posted |
| Phone USB disconnect mid-post | DeviceLostError already handled — phone added to dead_phones set, remaining sessions skipped |
| Proxy rotation fails | Retry once, skip session if both fail |
| Content Library empty | Stock check at day start, warmup-only mode (no post skip), Telegram alert |
| Bot crashes overnight | Task Scheduler restart-on-failure as backup. control.json state is preserved between restarts |
| TikTok/IG UI changes | Gemini Vision adapts to UI changes. Only fixed coords (nav bar) could break — but these are proportional |
| Duplicate post (mark_posted failed silently) | Idempotency check: before posting, verify video was not already posted today via scenario_name + date comparison |
| Post UI wedged (unexpected app state) | App state reset between retries: force-stop, reopen, wait for load |
