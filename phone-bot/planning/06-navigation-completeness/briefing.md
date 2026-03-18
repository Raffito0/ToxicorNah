# Phone-Bot TikTok Navigation Completeness Audit + Fix

## Deadline: 8 hours from now. Software must be PRODUCTION READY by end of session.

## Context

phone-bot is a Python automation system that controls TikTok on real Android phones via ADB. It simulates human behavior: scrolling, liking, commenting, following, posting videos, browsing different tabs.

We've completed:
- Phase 1: Universal device compatibility (works on any Android phone)
- Phase 2: Production reliability (crash recovery, timeouts, popup handler, Telegram alerts)
- Phase 3: UHID touch engine (touches indistinguishable from real human fingers)

Now we need Phase 4: **Navigation completeness**. The bot must be able to navigate EVERY part of TikTok that a real user would visit, handle EVERY screen state it might encounter, and recover from EVERY wrong state — all unattended.

## What "Complete" Means

A real TikTok user:
1. Opens the app → lands on FYP
2. Scrolls FYP, watches videos, likes some, comments occasionally
3. Visits creator profiles from FYP → scrolls their videos → maybe follows
4. Opens Following tab → watches videos from people they follow
5. Opens Explore/Discover → browses trending content
6. Opens Inbox → checks notifications, new followers, messages
7. Watches Stories from the Stories carousel at top of inbox/following
8. Sometimes enters a LIVE stream accidentally → exits
9. Uses Search → types keywords → browses results → opens videos
10. Opens Shop tab briefly (real users do this)
11. Opens their own Profile → checks stats
12. Posts videos (from Content Library)
13. Handles every popup, overlay, dialog that appears
14. Navigates BACK to FYP from any screen without getting lost

The bot must do ALL of these things naturally, with proper state awareness (knowing WHERE it is at all times), and self-recovery (getting back to a known state when lost).

## YOUR TASK

### Step 1: Read the ENTIRE codebase

Read every file thoroughly:
```
phone-bot/
  actions/tiktok.py        (~4200 lines - the main action file)
  actions/instagram.py      (for reference, not in scope)
  core/adb.py
  core/human.py
  core/gemini.py
  core/sidebar.py
  core/page_state.py
  core/coords.py
  core/verify.py
  planner/executor.py
  planner/warmup.py
  config.py
  main.py
```

### Step 2: Map every navigation path

For EACH TikTok section, document:
- What the bot CAN currently do (implemented and working)
- What the bot CANNOT do (not implemented or broken)
- What the bot does PARTIALLY (implemented but incomplete/fragile)
- What screen states exist that the bot doesn't handle
- What transitions between screens are missing

Sections to audit:
1. **FYP (For You Page)** — scroll, engage, sidebar detection, video types (normal, ad, LIVE preview)
2. **Following tab** — video feed, empty state, profile visits from here
3. **Friends tab** (if exists on current TikTok version)
4. **Explore/Discover** — trending, categories, content browsing
5. **Inbox** — Activity, New Followers, Messages, follow-back flow
6. **Stories carousel** — detection, viewing, navigation, LIVE in stories
7. **LIVE streams** — accidental entry, intentional brief viewing, exit methods
8. **Search** — open search, type query, browse results grid, open video, return
9. **Shop tab** — brief visit (what real users do)
10. **Own Profile** — view stats, scroll own videos
11. **Creator profiles** — visit from FYP/Following/Search, scroll videos, follow, return
12. **Comments** — open, read, write, close, handle 0 comments
13. **Video posting** — full flow from Content Library to posted
14. **Navigation recovery** — _return_to_fyp(), nuclear_escape(), getting un-stuck from any screen
15. **State detection** — how does the bot know where it is? What states can't it detect?

### Step 3: Research TikTok UI structure

Research the current TikTok UI (2025-2026 version):
- What are ALL the tabs at the bottom? (Home/Shop/Create/Inbox/Profile? Or has it changed?)
- What does the Following tab look like? Is it a separate tab or inside Home?
- What popups/overlays appear regularly? (content preferences, "Not interested", region warnings, etc.)
- What does the Explore/Discover page look like?
- What happens when you tap different parts of the screen on different pages?
- Are there any new TikTok features (2025-2026) that the bot should be aware of?

If you need screenshots of specific TikTok pages to understand the layout, ASK — we have phones connected and can provide them.

### Step 4: Create a prioritized fix list

For everything that's missing or broken:
- **CRITICAL**: Bot gets stuck or crashes (must fix)
- **HIGH**: Real user would do this regularly, bot doesn't (looks suspicious if missing)
- **MEDIUM**: Real user does this sometimes, bot should too
- **LOW**: Nice to have, not suspicious if missing

### Step 5: Find what WE MISSED

The 28 known issues listed below are what WE found. But we are NOT TikTok experts and we definitely missed things. YOU must:
- Research current TikTok behavior (2025-2026) to find flows/screens/popups we didn't mention
- Read the entire codebase and find gaps WE didn't notice — edge cases, unhandled states, missing transitions
- Think like a TikTok power user: what do they do that our bot doesn't?
- Think like a TikTok anti-bot engineer: what patterns would flag our bot as non-human?
- Add YOUR findings to the fix list alongside ours

Do NOT limit yourself to only fixing what we listed. Our list is a starting point, not the complete picture.

### Step 6: Implement ALL critical and high priority fixes

This is not just an audit — implement the fixes. We have 8 hours.

Focus on:
1. Every screen must be navigable TO and FROM
2. Every screen state must be detectable (know where we are)
3. Every "stuck" state must have a recovery path
4. Every action must verify its result before proceeding
5. Engagement must look natural across ALL sections, not just FYP

## Known Issues (from our testing)

These are bugs/gaps we already know about — verify they're still present and fix them:

1. **LIVE handling**: `_exit_live()` implemented but NEVER tested on real phone. Bot entered LIVE accidentally during Samsung S9 test (frame analysis confirmed). Unknown if exit works.

2. **Following tab empty state**: No detection for "Follow accounts to see videos here" screen. Bot would scroll an empty page.

3. **Following tab profile visit recovery**: After visiting a profile from Following (rabbit_hole), pressing back may not return to Following feed correctly.

4. **Story detection edge cases**: Pixel progress bar detector works 90%+ but Gemini fallback needed for edge cases. Story-to-LIVE transition in carousel not fully tested.

5. **Comments with 0 comments**: Bot opens comments, finds nothing, current dismiss behavior (2 video taps) needs verification.

6. **Search second keyword**: After searching one keyword and browsing results, navigating back to search bar and typing second keyword — clear/retype flow needs verification.

7. **Shop tab**: Bot has `browse_shop_session()` but it's minimal. Real users see the Shop tab, glance briefly, leave.

8. **Own Profile**: Bot never visits its own profile. Real users check their own profile sometimes.

9. **Posting flow**: `post_video()` exists but the full flow (Content Library → select video → add caption → post → verify posted) needs audit.

10. **Tab switching verification**: After tapping a bottom tab, how does the bot verify it actually switched? Fingerprint comparison fails on similar-looking pages.

## Key Technical Patterns (how the bot works)

- **UI element finding**: Gemini Vision bbox mode (not fixed coordinates) for dynamic elements
- **Page identification**: Gemini Vision classify_screen_with_reference() for page state
- **Sidebar scanning**: Pixel brightness column scan for engagement panel icons
- **Navigation**: Bottom tab bar at _NAV_Y, proportional coordinates in coords.py
- **State verification**: wait_and_verify() with retry system
- **Recovery**: 3-tier: press_back → _return_to_fyp (nav_home tap) → nuclear_escape (HOME + reopen)
- **All timing**: Log-normal distributions from config.py HUMAN dict
- **Touch injection**: UHID virtual touchscreen (just implemented)

## CRITICAL: New Account vs Mature Account UI Differences

TikTok shows DIFFERENT UI depending on account age/state:

**New accounts (warmup phase, first days)**:
- FYP top bar shows ONLY "For You" and "Following" tabs
- NO Explore tab, NO Shop tab, NO Friends tab — these appear LATER as the account matures
- FYP is full of ADs and LIVE preview cards (much more than mature accounts)
- This was confirmed yesterday on Samsung S9 with a fresh account

**Mature accounts (after weeks of use)**:
- FYP top bar has more tabs: "For You", "Following", "Explore", possibly "Friends", "Shop"
- Fewer ADs in FYP, more personalized content

**What this means for the bot**:
- The bot MUST detect which tabs are actually present on the FYP top bar — NOT assume a fixed set
- During warmup (first 2-3 days, randomized per account — NOT a fixed number): bot should ONLY scroll FYP videos passively. NO search, NO keywords, NO hashtags, NO explore, NO inbox browsing, NO following from FYP. Just scroll and watch like a brand new user getting to know the app. After day 2-3 it can start liking (see warmup.py for the existing gradual ramp).
- After warmup completes: bot can start searching keywords, browsing explore, visiting profiles, following, etc. The transition should be gradual, not sudden.
- The system should dynamically detect available tabs (Gemini Vision or pixel analysis on the top bar) and adapt behavior accordingly
- Let deep-trilogy decide the best approach: should we scan the top bar once per session to know what's available? Or detect on-the-fly when trying to navigate?

## Additional Known Gaps NOT Yet Mentioned

11. **Video posting full flow**: `post_video()` exists but the COMPLETE TikTok posting flow needs audit: open camera/upload → select video from gallery → add caption (from Content Library `social_caption` field) → add hashtags → post → verify it actually posted → return to FYP. Every step must be verified.

12. **Post-posting behavior**: Real users check their video after posting — go to Profile, see if it got views, then go back to scrolling. Bot doesn't do this.

13. **Screen stay-on**: Phones must keep screen on during sessions. Need `adb shell settings put system screen_off_timeout 1800000` or `svc power stayon true` at session start. Without this, screen turns off mid-session.

14. **TikTok app update popups**: "What's New" / "Update Available" dialogs. These appear after auto-updates. Must be dismissed.

15. **Content preferences popup**: "Choose your interests" dialog on brand new accounts. Must be handled during warmup.

16. **Account verification prompts**: TikTok sometimes asks to verify phone number or add email. Must detect and either dismiss or alert.

17. **Production hardening (Plan 02) status**: The popup handler, Gemini circuit breaker, ADB subprocess cleanup, session hard timeout, fatigue persistence — these were PLANNED in phone-bot/planning/02-production-hardening/ but may not be implemented yet. Check if they exist in the code. If not, they're prerequisites for "production ready" and must be included.

18. **"Not interested" long-press**: Real users occasionally long-press a video → "Not interested". Bot should do this rarely (~2-5% of videos) to look human and train the algorithm.

19. **Sound/volume**: Phone should have volume at a realistic level (not muted, not max). Real users watch with sound. `adb shell media volume --set N` at session start.

20. **Notification badges**: TikTok shows red dot badges on Inbox/Profile tabs. Bot should notice these and occasionally tap Inbox when badge is present (like a real user checking notifications).

21. **Photo carousels/slideshows**: TikTok now has photo slideshow posts. Swiping LEFT goes to next photo (not next video). If bot swipes UP on a carousel, it skips to next video — fine. But bot must NOT get confused if it encounters one (different UI, no sidebar icons in same places).

22. **Reading comments without writing**: Real users open comments to READ far more often than to write. Bot should sometimes open comments, scroll a bit, then close WITHOUT typing. Currently bot only opens comments to write.

23. **Bookmarking/saving videos**: Real users occasionally bookmark videos (tap bookmark icon in sidebar). Bot should do this rarely (~1-3% of videos). Simple sidebar icon tap.

24. **DM/Messages tab**: Real users check messages occasionally. Bot should open Messages tab in Inbox sometimes, glance briefly, go back. Even without replying — just the activity of opening it.

25. **App Not Responding dialog**: If TikTok freezes, Android shows "Wait / Close App" dialog. Bot must detect and tap "Wait" or "Close" and recover.

26. **Draft video saving**: Weekly plan has `post_outcome: "draft"`. Does the bot actually navigate the draft save flow correctly? Open upload → go back → "Save as draft?" → confirm.

27. **Timezone + Language**: Already handled manually — user sets these during factory reset setup. NOT the bot's responsibility. Skip this.

28. **Feed refresh on return**: When TikTok is reopened after WiFi was off, the feed refreshes. There might be a loading spinner or "Refresh" button. Bot must wait for content to load before trying to interact.

## MANDATORY: Universal Compatibility

EVERYTHING implemented must work on ANY Android phone without per-phone manual calibration:
- All coordinates MUST be proportional (lambda w, h) or Gemini Vision bbox
- All pixel thresholds MUST be proportional or adaptive
- All timing MUST use log-normal from config.py
- Zero hardcoded pixel values, zero phone-specific constants
- A brand new phone plugged in with just its ADB serial in config works immediately
- This rule applies to EVERY line of code written in this session — no exceptions

## Constraints

- TikTok EU/US version only
- Python 3.13
- No UIAutomator, no accessibility services, no root
- All touch via UHID (with fallback to `input tap`)
- All UI detection via Gemini Vision or pixel analysis
- Must work on Samsung S9 (1080x2220), S9+ (1080x2220), S22 (1080x2340), and ANY future phone
- ZERO per-phone calibration — everything auto-detected or proportional
- 8 HOUR DEADLINE — focus on what matters most, ship it
