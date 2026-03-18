# Project Manifest — 06 Navigation Completeness

## Overview

Make the phone-bot TikTok automation production-ready by closing ALL navigation gaps: every screen navigable, every state detectable, every popup handled, every "stuck" state recoverable, and engagement indistinguishable from a real user.

**Total known gaps**: 28 (from briefing) + 15 (from code audit + TikTok research) = **43 gaps**

## Priority Framework

- **CRITICAL**: Bot gets stuck, crashes, or can't start sessions (must fix)
- **HIGH**: Real user does this regularly, absence looks suspicious (must fix)
- **MEDIUM**: Real user does this sometimes, bot should too (fix if time)
- **LOW**: Nice to have (follow-up session)

## Split Structure

5 splits, dependency-ordered. Splits 1-2 are sequential prerequisites. Splits 3-5 are independent and can be parallelized.

```
Split 1: Session Infrastructure ──→ Split 2: Dynamic Nav ──┬──→ Split 3: Popup Arsenal
                                                            ├──→ Split 4: Engagement Completeness
                                                            └──→ Split 5: Video Posting Flow
```

---

## SPLIT_MANIFEST

```
01-session-infrastructure | Session lifecycle, device resilience, rate limiting | CRITICAL | none
02-dynamic-nav-detection | Dynamic tab detection, adaptive navigation, state awareness | CRITICAL | 01-session-infrastructure
03-popup-arsenal | All popups, overlays, CAPTCHA solving | HIGH | 01-session-infrastructure
04-engagement-completeness | Missing engagement actions, natural behavior diversity | HIGH | 02-dynamic-nav-detection
05-video-posting-flow | End-to-end posting, draft/skip, post-verification | HIGH | 02-dynamic-nav-detection
```

---

## Split Details

### 01-session-infrastructure (CRITICAL, prerequisite for all)
**Why**: Sessions must start/end cleanly. Without this, nothing else works reliably.

**Gaps addressed** (briefing # + new findings):
| # | Gap | Priority | Source |
|---|-----|----------|--------|
| 13 | Screen stay-on during sessions | CRITICAL | Briefing |
| 19 | Volume at realistic level | HIGH | Briefing |
| 28 | Feed refresh detection after reopen/WiFi restore | HIGH | Briefing |
| 17 | Production hardening status check (verify Plan 02 items exist) | CRITICAL | Briefing |
| N1 | `_device_lost` static class variable → instance variable | CRITICAL | Code audit |
| N2 | Rate limit tracking: follow caps (~200/day, ~30/hour), like caps (~500/day) | HIGH | TikTok research |
| N3 | WiFi toggle wiring in executor (adb.py has methods, executor doesn't call them) | MEDIUM | Code audit |

**Files modified**: `core/adb.py`, `planner/executor.py`, `config.py`
**Estimated effort**: ~1.5 hours
**Test**: Session starts, screen stays on, volume audible, rate limits tracked, WiFi toggles between sessions

---

### 02-dynamic-nav-detection (CRITICAL, depends on 01)
**Why**: TikTok shows different UI to different accounts. Bot must detect what's there and adapt.

**Gaps addressed**:
| # | Gap | Priority | Source |
|---|-----|----------|--------|
| 10 | Tab switching verification (fingerprint fails on similar pages) | CRITICAL | Briefing |
| 1 | LIVE handling: `_exit_live()` never tested, verify & fix | CRITICAL | Briefing |
| 2 | Following tab empty state detection | HIGH | Briefing |
| 3 | Following tab profile visit recovery (rabbit_hole → back to Following) | HIGH | Briefing |
| 8 | Own profile visit (real users check stats) | HIGH | Briefing |
| 15 | State detection: what states can't the bot detect? | HIGH | Briefing |
| 14 | Navigation recovery: `_return_to_fyp()` from any screen | HIGH | Briefing |
| N7 | Variable bottom nav detection (Friends/Shop/Discover slot changes) | CRITICAL | TikTok research |
| N8 | Variable top tab detection (new accounts: only For You + Following) | CRITICAL | TikTok research |
| N15 | Nearby/Local feed tab (new, EU/US 2025-2026) | LOW | TikTok research |

**Key design decision**: Bot should scan available tabs once per session via Gemini Vision on first FYP load, cache the result, and adapt all navigation accordingly. During warmup (new accounts), restrict to FYP-only regardless of what tabs are detected.

**Files modified**: `actions/tiktok.py`, `core/page_state.py`, `core/coords.py`, `config.py`
**Estimated effort**: ~2.5 hours
**Test**: Bot detects available tabs on Samsung S9 (new account) vs S22 (mature account), navigates to each detected tab, verifies arrival, recovers from wrong states

---

### 03-popup-arsenal (HIGH, depends on 01)
**Why**: TikTok throws 10+ popup types. Unhandled popup = bot stuck.

**Gaps addressed**:
| # | Gap | Priority | Source |
|---|-----|----------|--------|
| 14 | TikTok app update popups ("What's New") | HIGH | Briefing |
| 15 | Content preferences popup ("Choose your interests") | HIGH | Briefing |
| 16 | Account verification prompts | HIGH | Briefing |
| 25 | App Not Responding dialog | HIGH | Briefing |
| - | Basic CAPTCHA auto-solve (puzzle slide + rotate) | HIGH | Interview |
| N4 | Cookie consent (EU GDPR) | HIGH | TikTok research |
| N5 | Content warning overlays ("age protected") | MEDIUM | TikTok research |
| N6 | Wind-down mode prompts (after 10 PM) | MEDIUM | TikTok research |

**Key design**: Extend PopupGuardian's Gemini classification prompt to recognize all new popup types. Add pixel pre-filters where possible (cookie consent = bottom button band, ANR = system dialog pattern). CAPTCHA: detect puzzle/rotate type → Gemini Vision to find target position → execute gesture.

**Files modified**: `actions/tiktok.py` (PopupGuardian class), `core/gemini.py` (new prompts), `config.py`
**Estimated effort**: ~2 hours
**Test**: Each popup type manually triggered (or screenshot injected) and correctly dismissed/solved

---

### 04-engagement-completeness (HIGH, depends on 02)
**Why**: A bot that only scrolls + likes is detectable. Real users do 10+ different actions.

**Gaps addressed**:
| # | Gap | Priority | Source |
|---|-----|----------|--------|
| 18 | "Not interested" long-press (2-5% of videos) | HIGH | Briefing |
| 23 | Bookmark/save videos (1-3% of videos) | HIGH | Briefing |
| 22 | Read-only comment browsing (open, scroll, close without writing) | HIGH | Briefing |
| 21 | Photo carousel detection + appropriate swiping behavior | HIGH | Briefing |
| 20 | Notification badge response (tap Inbox when red dot) | MEDIUM | Briefing |
| 24 | DM/Messages brief glance | MEDIUM | Briefing |
| 12 | Post-posting profile check (go to Profile, check views) | MEDIUM | Briefing |
| 4 | Story detection edge cases (progress bar + Gemini fallback) | MEDIUM | Briefing |
| 5 | Comments with 0 comments (dismiss behavior) | MEDIUM | Briefing |
| 6 | Search second keyword (clear/retype flow) | MEDIUM | Briefing |
| 7 | Shop tab brief glance | MEDIUM | Briefing |
| N3 | Photo carousel dot indicator detection (different UI from video) | HIGH | TikTok research |

**Key design**: Each new action integrated into `browse_session()` pick_action weights + session phase weights. Actions gated by personality traits (explore_curiosity drives bookmark, comment_sociality drives read-only comments). Photo carousel detection via sidebar scan (no sidebar = possible carousel) + Gemini verification.

**Files modified**: `actions/tiktok.py`, `core/human.py` (new decision methods), `core/sidebar.py` (carousel detection), `config.py` (new timing params + probabilities)
**Estimated effort**: ~2.5 hours
**Test**: 10-minute browse session exercises all new actions at expected frequencies. Photo carousel handled correctly. DM glance opens and closes without interaction.

---

### 05-video-posting-flow (HIGH, depends on 02)
**Why**: Posting is the core monetization action. Must work flawlessly.

**Gaps addressed**:
| # | Gap | Priority | Source |
|---|-----|----------|--------|
| 9 | Posting flow audit: full path from gallery to posted | CRITICAL | Briefing |
| 11 | Complete posting: upload → caption → hashtags → post → verify | CRITICAL | Briefing |
| 26 | Draft save flow (post_outcome: "draft") | HIGH | Briefing |
| 12 | Post-posting behavior: check Profile for views | MEDIUM | Briefing |

**Key design**: Audit existing `post_video()` (line 3588-3673 of tiktok.py). Current flow: push file → media scan → tap + → Upload → gallery_first → Next → caption → post → verify. Gaps: no hashtag entry, no caption from Content Library, no draft save, no skip flow, no post-verification (just checks app is still open). Fix: add caption + hashtag entry from Content Library `social_caption`, implement draft/skip flows, add Profile visit after posting to verify.

**Files modified**: `actions/tiktok.py` (post_video, new draft_video, skip_post), `planner/executor.py` (pass caption/hashtags to post flow)
**Estimated effort**: ~1.5 hours
**Test**: Post video with caption → verify on Profile. Save draft → verify draft exists. Skip → verify no post created.

---

## Execution Order

1. **01-session-infrastructure** (~1.5h) — Foundation
2. **02-dynamic-nav-detection** (~2.5h) — Navigation intelligence
3. **03-popup-arsenal** (~2h) — Defensive completeness [can parallel with 04/05]
4. **04-engagement-completeness** (~2.5h) — Behavioral realism [can parallel with 03/05]
5. **05-video-posting-flow** (~1.5h) — Monetization path [can parallel with 03/04]

**Total estimate**: ~10 hours (more than 8). Prioritization:
- **Must ship**: Splits 01, 02, 04 (core navigation + engagement = production minimum)
- **Should ship**: Split 03 (popups can cause stuck states)
- **Can defer**: Split 05 (posting works today, just incomplete)

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Gemini Vision rate limits during tab detection | Cache tab scan result per session, don't re-scan |
| CAPTCHA solving accuracy | Fallback to abort + Telegram alert if auto-solve fails |
| Photo carousel false positives | Only flag as carousel if sidebar scan returns None AND Gemini confirms |
| Variable nav breaks fixed coords | Detection-first: scan tabs, THEN use detected positions |
| Rate limit accuracy (TikTok's limits are dynamic) | Conservative caps (150 follows/day, 400 likes/day) with per-session tracking |
