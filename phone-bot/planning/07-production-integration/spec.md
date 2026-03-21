# Production Integration: Phone-Bot + Weekly & Daily Plan + Automatic Posting

## Goal

Complete the integration between the phone-bot automation system and the Weekly & Daily Plan scheduling system for fully autonomous TikTok + Instagram posting across 3 phones. After this is done, the system should run unattended: generate weekly schedules, execute sessions at the right times, post videos automatically, and notify the operator via Telegram.

## Current State

### What Already Works
- **Weekly plan generation** (`Weekly & Daily Plan/planner/`): Generates JSON schedules with 17+ rules (rest days, post frequency, personality-driven timing, proxy rotation)
- **Session executor** (`phone-bot/planner/executor.py`): `run_today()` loads plan JSON, waits for `start_time` via `_wait_until()`, executes sessions including posting handler (posted/draft/skipped cases)
- **TikTok posting** (`phone-bot/actions/tiktok.py`): `post_video()` uploads video with caption
- **Instagram posting** (`phone-bot/actions/instagram.py`): `post_reel()` uploads reel with caption
- **Delivery module** (`Weekly & Daily Plan/delivery/`): `get_next_video()` → `download_video()` → `push_to_phone()` → `mark_posted()` — tested and working with Airtable + R2
- **Phone-bot browse sessions**: scroll, like, comment, follow, search — all working with human simulation
- **Warmup system**: 5-8 day gradual ramp, zero likes days 1-2, personality-driven

### What's Missing / Not Configured
1. **Environment variables not set**: `AIRTABLE_API_KEY`, `ADB_SERIAL_PHONE1/2/3`, `PROXY_USERNAME/PASSWORD/ROTATION_TOKEN`, `PHONEBOT_TELEGRAM_TOKEN/CHAT`
2. **No production monitoring**: `telegram_watchdog.py` is for FORGE workflow only, not production session monitoring
3. **No post recovery**: if `post_video()` fails, the video stays "pending" but no retry in current or next session
4. **No cron/daemon**: bot must be launched manually every day
5. **Content Library low stock**: Phone 1: 1 video, Phone 2: 5 videos, Phone 3: 3 videos (~1-2 days buffer at 2 posts/day)
6. **Same-video cross-platform not verified**: documented flow (TikTok downloads+posts, IG reuses file) not tested end-to-end
7. **Instagram regular sessions not tested**: warmup posts on IG work, but scheduled production IG sessions untested
8. **No health dashboard**: no way to see at a glance if all sessions ran, all posts succeeded, any errors

## Architecture

### System Components
```
Weekly & Daily Plan/
  planner/         — Generates weekly_plan JSON (17 rules, personality system)
  delivery/        — Content Library bridge (Airtable → R2 → ADB push)
  output/          — Generated plan JSONs

phone-bot/
  main.py          — Entry point (--warmup, --test, regular run_today)
  config.py        — Central config (phones, proxy, timing, Airtable)
  planner/
    executor.py    — Session executor (load plan, wait, execute, post)
    warmup.py      — Warmup plan generation
  actions/
    tiktok.py      — TikTok automation (browse, post, engage)
    instagram.py   — Instagram automation (browse, post, engage)
  core/
    adb.py         — ADB controller
    human.py       — Human behavior engine
    gemini.py      — Gemini Vision API
    proxy.py       — Proxy rotation
  telegram_watchdog.py — Currently FORGE-only, needs production monitoring
```

### Execution Flow (target state)
```
[Cron/Daemon] → python main.py (PHONEBOT_TEST=0)
  ↓
executor.run_today()
  ↓ load weekly_plan JSON for current week
  ↓ filter today's sessions
  ↓
For each session (sorted by start_time):
  ├─ _wait_until(start_time)
  ├─ proxy_rotation_before? → rotate proxy
  ├─ Open TikTok/Instagram
  ├─ type=aborted? → close after 1-2 min
  ├─ type=rest_only? → scroll only, no post
  ├─ type=normal:
  │   ├─ Scroll pre_activity_minutes
  │   ├─ post_scheduled + posted:
  │   │   ├─ delivery.get_next_video(phone, platform)
  │   │   ├─ delivery.download_video()
  │   │   ├─ delivery.push_to_phone()
  │   │   ├─ bot.post_video(path, caption)
  │   │   ├─ [NEW] verify post success
  │   │   ├─ [NEW] retry on failure (max 2)
  │   │   └─ delivery.mark_posted()
  │   ├─ post_scheduled + draft → save as draft
  │   ├─ post_scheduled + skipped → go back
  │   └─ Scroll post_activity_minutes
  ├─ Close app
  └─ [NEW] Telegram notification (session result)

[NEW] Daily summary → Telegram (sessions run, posts made, errors)
```

### Target Phones
- Phone 1: Samsung Galaxy S9+ (SM-G965F, Android 10)
- Phone 2: Samsung Galaxy S22 (SM-S901B/DS, Android 16)
- Phone 3: Samsung Galaxy S9 (SM-G960F, Android 10)

### Content Pipeline Connection
- n8n workflow generates videos → saves to Content Library (Airtable + R2)
- Delivery module queries Content Library for pending videos per phone/platform
- After posting, marks video as "posted" in Airtable
- Need: minimum 7 days buffer (14 videos per phone) for unattended operation

## Scope of This Plan

### In Scope
1. Configure all environment variables for production
2. End-to-end test of delivery pipeline (Airtable → R2 → ADB push → phone storage)
3. Test single TikTok post + single Instagram post via bot
4. Test full session with scroll + post integrated
5. Production monitoring via Telegram (per-session notifications + daily summary)
6. Post recovery logic (retry on failure, re-queue video)
7. Cron/daemon setup for daily automatic execution
8. Content Library stock verification and minimum buffer alerts
9. Same-video cross-platform posting verification (TikTok then IG from same file)

### Out of Scope
- Changes to the Weekly & Daily Plan generation rules (already working)
- Changes to browse/engagement behavior (handled by navigation sections)
- n8n workflow modifications (content generation is separate)
- New phone onboarding (assuming 3 phones already set up with TikTok + IG)

## Key Risks
- **Ban risk from posting**: TikTok/IG may detect automated posting. Mitigation: warmup period, human-like timing, varied captions
- **USB disconnect during posting**: phone disconnects mid-upload. Mitigation: DeviceLostError recovery already exists
- **Content Library runs dry**: no videos to post. Mitigation: stock alerts via Telegram, n8n auto-production
- **Proxy failure**: rotation API down. Mitigation: fallback to direct connection (higher risk but doesn't crash)
- **ADB push fails**: storage full or path wrong. Mitigation: verify free space before push, cleanup old videos
