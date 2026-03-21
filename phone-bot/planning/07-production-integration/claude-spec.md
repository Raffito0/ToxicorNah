# Combined Spec: Production Integration

## What We're Building

A production-ready automation system that runs 24/7 on a Windows PC, executing daily posting schedules across multiple phones (starting with 3, expandable) via USB. Each phone has TikTok + Instagram accounts that follow a weekly plan: scroll, engage, and post videos at scheduled times. The system is managed via a Flask dashboard and monitored via Telegram.

## Current State

The following components are **complete and tested**:
- Weekly plan generation (17 rules, personality-driven schedules)
- Session executor (`run_today()` with time-based waiting + posting handler)
- TikTok `post_video()` and Instagram `post_reel()`
- Delivery module (Airtable Content Library → R2 download → mark posted/draft/skipped)
- Human behavior engine (log-normal timing, 14 micro-behaviors, personality system)
- Warmup system (5-8 day gradual ramp per account)
- Proxy rotation (SOCKS5 via sinister.services, WiFi hotspot)

## What's Missing

### 1. Environment Configuration
All env vars are empty. Must set: `AIRTABLE_API_KEY`, `PROXY_USERNAME/PASSWORD/ROTATION_TOKEN`, `HOTSPOT_SSID/PASSWORD`, `PHONEBOT_TELEGRAM_TOKEN/CHAT`, `PHONEBOT_TEST=0`.

ADB serials: `delivery/config.py` has `ADB_SERIAL_PHONE{N}` vars but they're unused because `push_to_phone()` is never called by the executor. The executor uses `adb.push_file()` directly in `post_video()`. These are two different code paths — needs reconciliation.

### 2. Post Retry Logic
If `post_video()` returns False, the executor currently does nothing — no retry, no draft save, no notification. Video stays "pending" in Airtable.

**Required**: Retry up to 2 times in the same session. If all retries fail, save as draft on the platform and mark as "draft" in Airtable. Send Telegram alert.

### 3. Telegram Production Monitoring
`telegram_watchdog.py` exists but is FORGE-only. Need a production monitoring module that sends:
- Session start notification (phone, platform, type)
- Session result (posted/scrolled/error, duration)
- Post failure alerts
- Content Library stock alerts (when < 14 videos for any phone)
- Daily summary (sessions run, posts made, errors, stock levels)

### 4. Content Library Stock Monitoring
When a phone has fewer than 14 pending videos (7 days buffer at 2/day), send Telegram alert. Skip post (scroll-only session) if stock is 0 for that phone.

### 5. Always-On Service Architecture
The bot must run as a persistent service, not a one-shot script. It should:
- Start manually from the dashboard (first time)
- Run continuously, executing sessions as their start_time arrives
- Support dynamic phone addition without restart (new phones enter warmup automatically)
- Handle graceful shutdown from dashboard

### 6. Multi-Proxy Support
Currently 1 proxy for all phones. Need to support multiple proxies (1 per ~4 phones). Each account should have a configurable proxy assignment via dashboard dropdown.

### 7. Dashboard Integration Points
The existing Flask dashboard (Instagram) will be extended for TikTok. The production integration needs these API endpoints/data:
- Phone/account status (warmup/active/error)
- Current session state (idle/scrolling/posting)
- Start/stop automation control
- Weekly plan view
- Content Library stock per phone

### 8. Cross-Platform Posting Verification
Same video goes to TikTok first, then IG. Caption is identical. The flow:
1. TikTok session: `download_video()` → `post_video()` → `mark_posted("tiktok")`
2. IG session (same phone, consecutive): video already on device → `post_reel()` → `mark_posted("instagram")`

This flow is documented but never tested end-to-end.

## Design Decisions (from interview)

1. **Retry-then-draft**: 2 retries in session, then draft + alert. No cross-session retry queue.
2. **Per-session notifications**: Telegram alert on every session start + result. Not every action.
3. **7-day buffer**: Alert at < 14 videos. Skip post at 0.
4. **Always-on**: Persistent Python process started from dashboard. Not cron/Task Scheduler.
5. **Hub USB fixed**: Phones always connected. No hot-plug detection needed.
6. **Same caption**: Identical for TikTok and IG. No per-platform captions.
7. **Multi-proxy**: Each account selects its proxy from dashboard. Proxy config stored per-account.
8. **Dynamic onboarding**: New phones added from dashboard auto-enter warmup. No system restart needed.

## Constraints

- Windows 11 PC (not Linux)
- Python 3.13+
- `phone-bot/` package structure with relative imports
- ADB via USB only (no WiFi ADB)
- Gemini 2.0 Flash for vision
- FORGE v2 workflow for testing
- Existing Flask dashboard codebase (separate repo, developed by another developer)
