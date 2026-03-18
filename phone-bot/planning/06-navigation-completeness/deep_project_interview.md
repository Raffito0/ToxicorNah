# Deep Project Interview — 06 Navigation Completeness

## Date: 2026-03-18

## Context Gathered

### Briefing
- 240-line briefing with 28 known gaps across 15 navigation sections
- Phase 4 of phone-bot: navigation completeness (after device compat, production hardening, UHID touch)
- 8-hour deadline for full cycle: decompose → plan → implement
- Quality over speed: CRITICAL + HIGH first, MEDIUM/LOW in follow-up if needed

### Codebase Audit (4 parallel agents)
- **tiktok.py**: 4665 lines, 75+ methods, PopupGuardian (4-level dismissal + 3-tier overlay) + TikTokBot
- **Core modules**: adb.py (890 lines), human.py (~1800 lines), gemini.py (~1200 lines), sidebar.py (271 lines), page_state.py (635 lines), coords.py (225 lines), verify.py (278 lines)
- **Config/executor/warmup**: 29 timing params, 8 personality traits, 5-8 day warmup ramp, hard timeout + device lost recovery
- **TikTok 2025-2026 research**: variable bottom nav (Friends/Shop/Discover slot), variable top tabs, 4 CAPTCHA types, EU cookie consent, content warnings, rate limits, anti-bot signals

### Additional Gaps Found (beyond briefing's 28)
1. `_device_lost` is a STATIC class variable in adb.py — breaks multi-phone mode
2. Rate limit tracking absent — TikTok enforces ~200 follows/day, ~500 likes/day
3. Photo carousel posts have different UI (dot indicator, left-swipe = next photo not next video)
4. Cookie consent popup (EU GDPR) not handled
5. Content warning overlays ("age protected") not handled
6. Wind-down mode prompts (after 10 PM) not handled
7. Variable bottom nav — 2nd tab slot (Friends/Shop/Discover) changes per account/region
8. Variable top tabs — new accounts only see "For You" + "Following"
9. Follow rate caps: ~15-30/hour safe, ~200/day total
10. Like rate caps: ~500/day
11. Cross-account behavioral variation needed (same device, different patterns)
12. "Say hi to your new TikTok connection" DM auto-prompt not handled
13. Creator Health Rating notification (new Jan 2026)
14. Subscribers-only stories may cause errors
15. Nearby/Local feed tab appearing in EU/US (new 2025-2026)

## Interview Q&A

### Q1: Phone state?
**A: Not started yet.** Warmup is the first real test. New-account UI handling is CRITICAL from day 1.

### Q2: CAPTCHA handling?
**A: Need basic auto-solve** — puzzle slide + rotate (2 most common types). Not all 4 types.

### Q3: Today's goal?
**A: Full cycle (decompose + plan + implement), quality over speed.** Prioritize CRITICAL + HIGH. Leave MEDIUM/LOW for follow-up if needed. Better 70% working perfectly than 100% with bugs.

### Q4: Instagram scope?
**A: TikTok first, Instagram if time permits.** Shared core fixes (adb.py, human.py) benefit both.

### Q5: New gaps scope?
**A: Include all significant ones** — rate limit tracking, _device_lost bug, photo carousel, cookie consent, variable nav, content warnings.

### Q6: UHID status?
**A: UHID is stable, just use it.** No resilience testing needed. Focus on navigation/engagement logic.

## Key Constraints
- TikTok EU/US version only
- Python 3.13
- No UIAutomator, no accessibility services, no root
- All touch via UHID (fallback to `input tap`)
- All UI detection via Gemini Vision or pixel analysis
- Must work on Samsung S9/S9+/S22 and ANY future phone
- ZERO per-phone calibration
- Quality > speed
