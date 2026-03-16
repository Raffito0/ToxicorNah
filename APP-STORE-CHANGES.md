# App Store Submission — Implementation Changelog

**Created**: 2026-03-15
**Last Updated**: 2026-03-15 (ALL CODE CHANGES COMPLETED)
**Purpose**: Document EVERY change made for App Store compliance. If anything breaks, this file tracks exactly what was modified, why, and how to revert.

## IMPLEMENTATION STATUS: COMPLETED

| Phase | Status | Build |
|-------|--------|-------|
| Phase 1: File cleanup | DONE | PASS |
| Phase 2: UI dead-end fixes | DONE | PASS |
| Phase 3: StoreKit 2 IAP | DONE | PASS |

### What was actually done:

**12 files DELETED:**
- 10 Adobe Express PNG files from `public/` (9 unused + 1 after fallback replacement)
- `src/components/TestOpenAI.tsx` (orphan debug component)
- `src/components/ProfilePage.tsx` (dead code, never routed)

**2 files CREATED:**
- `src/services/iapService.ts` (170 lines — StoreKit 2 wrapper via @capgo/native-purchases)
- `src/services/purchaseService.ts` (165 lines — facade: iOS→IAP, web→Stripe)

**9 files MODIFIED:**
- `src/components/PersonProfile.tsx` — line 428: Adobe fallback → inline SVG data URI
- `src/components/SigilsScreen.tsx` — removed MirrorCard dead end (457→321 lines)
- `src/components/InnerTruthReveal.tsx` — implemented real localStorage save
- `src/components/ResultsPage.tsx` — added AI disclosure footer + switched to purchaseService + iOS PaywallModal props
- `src/components/PaywallModal.tsx` — added optional isNativeIOS + onRestore props + Restore button
- `src/components/SoulPage.tsx` — Manage/Restore subscription now via purchaseService
- `src/App.tsx` — added initPurchases() at startup
- `src/utils/platform.ts` — added isIOSNative(), isAndroidNative(), isWeb()
- `package.json` — added @capgo/native-purchases dependency

**1 file NOT MODIFIED (as planned):**
- `src/services/stripeService.ts` — untouched, web payments work identically

**Build results:**
- Baseline (before changes): 1050 KB, built in 8.3s
- After all changes: 1051 KB, built in 7.8s
- iapService lazy-loaded in separate 12.5 KB chunk (only loaded on iOS)

---

## HOW TO REVERT

All changes are in git. Before starting implementation:
```bash
git stash   # or commit current work
```
After implementation, if something breaks:
```bash
git diff HEAD   # see what changed
git checkout -- <file>   # revert specific file
git stash pop   # restore pre-implementation state
```

---

## CATEGORY 1: FILES TO DELETE (safe — zero references in code)

### 1A. Unused Adobe Express images in /public/

These files are NOT referenced anywhere in the codebase. Verified via `grep -r "Adobe"` — only `Adobe Express - file 1 (3).png` is referenced (see Category 2).

| File | Size | Why delete |
|------|------|------------|
| `public/Adobe Express - file 1.png` | — | Unused, clutters public/ |
| `public/Adobe Express - file 1 (1).png` | — | Unused |
| `public/Adobe Express - file 1 (2).png` | — | Unused |
| `public/Adobe Express - file 1 (4).png` | — | Unused |
| `public/Adobe Express - file 1 (5) (1).png` | — | Unused |
| `public/Adobe Exprddess - file 1 (3).png` | — | Unused (typo in name) |
| `public/Adobe Edsdxpress - file 1 (3).png` | — | Unused (typo in name) |
| `public/Adobe Exsdfprsdsdsdsdsdess - file 1 (3).png` | — | Unused (typo in name) |
| `public/Adobe Expreasdss - file 1 (3).png` | — | Unused (typo in name) |

**Total: 9 files**
**Risk: ZERO** — no code references these files.

### 1B. Orphan debug component

| File | Why delete |
|------|------------|
| `src/components/TestOpenAI.tsx` | Debug-only component. NOT imported by any file. No route points to it. Verified via `grep -r "TestOpenAI" src/` — only self-reference found. |

**Risk: ZERO** — not imported, not routed, not rendered anywhere.

---

## CATEGORY 2: FILES TO MODIFY

### 2A. PersonProfile.tsx — Replace Adobe Express fallback

**File**: `src/components/PersonProfile.tsx`
**Line**: 428
**Current code**:
```typescript
const DEV_ARCHETYPE_IMAGE_FALLBACK = '/Adobe Express - file 1 (3).png';
```
**Change to**: Inline SVG data URI or solid color placeholder (so we can delete the Adobe file too)
**Used at lines**: 469, 551, 2895 — all as `archetype.imageUrl || DEV_ARCHETYPE_IMAGE_FALLBACK`
**Why**: Remove dependency on Adobe Express file. In production, `archetype.imageUrl` always comes from Supabase, so fallback only triggers in dev.
**Risk**: LOW — only affects dev mode when Supabase image URL is missing.
**Revert**: Restore line 428 to original string + keep the PNG file.

### 2B. SigilsScreen.tsx — Fix Mirror dead end

**File**: `src/components/SigilsScreen.tsx`
**Line**: ~52
**Current**: Button "Open Mirror" has `// TODO: Open Mirror sub-screen` — does nothing on click
**Change**: Either implement navigation OR remove the button entirely
**Why**: Apple rejects apps with buttons that don't work (dead ends)
**Risk**: LOW — removing a non-functional button can't break anything. If implementing, new code could have bugs.
**Revert**: Restore original button code.

### 2C. ProfilePage.tsx — Remove "Coming soon" stub

**File**: `src/components/ProfilePage.tsx` (if it exists as a route)
**Current**: Shows "Coming soon" placeholder text
**Change**: Either implement a real settings page OR remove the route/nav entry that points to it
**Why**: Apple rejects "Coming soon" screens
**Risk**: MEDIUM — if removing the route, must ensure no navigation points to it. If implementing, new code.
**Revert**: Restore original component.

### 2D. InnerTruthReveal.tsx — Fix fake Save

**File**: `src/components/InnerTruthReveal.tsx`
**Line**: ~19
**Current**: Save button shows success UI but `// TODO: Save to local storage or backend` — doesn't actually save
**Change**: Either implement localStorage save OR remove the Save button
**Why**: Button that pretends to work but doesn't = misleading UI
**Risk**: LOW
**Revert**: Restore original code.

### 2E. SoulPage.tsx — Remove placeholder images

**File**: `src/components/SoulPage.tsx`
**Line**: ~1679
**Current**: Hardcoded placeholder image URLs
**Change**: Replace with real assets or conditional rendering
**Why**: Placeholder content visible to users
**Risk**: LOW — cosmetic change
**Revert**: Restore original URLs.

### 2F. AI Disclosure — Add in-app notice

**Files affected**: `src/components/ResultsPage.tsx` and/or `src/components/UploadPage.tsx`
**Current**: No in-app AI disclosure (only in Privacy Policy / Terms)
**Change**: Add subtle footer text like "Analyzed by AI · For entertainment only · [Learn more]"
**Why**: Apple requires clear AI/LLM disclosure in-app for apps using AI
**Risk**: LOW — additive UI change, no existing code modified
**Revert**: Remove added JSX.

---

## CATEGORY 3: MAJOR NEW IMPLEMENTATION NEEDED

### 3A. StoreKit 2 / In-App Purchases (CRITICAL)

**Current state**: App uses Stripe web checkout (`checkout.stripe.com`) for all payments
**Problem**: Apple Guideline 3.1.1 requires IAP for digital content unlocks
**What needs to happen**:
1. Install Capacitor IAP plugin (e.g., `@capacitor-community/in-app-purchase` or `cordova-plugin-purchase`)
2. Create IAP products on App Store Connect (Monthly, Annual, Single Unlock)
3. New service file: `src/services/iapService.ts` — handles StoreKit 2 purchases on iOS
4. Modify `PaywallModal` — detect platform (iOS vs web), route to IAP on iOS, Stripe on web
5. Modify `Restore Purchases` in SoulPage — call StoreKit restore on iOS
6. Modify `Manage Subscription` — open `itms-apps://apps.apple.com/account/subscriptions` on iOS

**Files affected**:
- `package.json` — new dependency
- `capacitor.config.ts` — plugin config
- `src/services/iapService.ts` — NEW file
- `src/services/stripeService.ts` — add platform detection
- `src/components/PaywallModal.tsx` (or mobile equivalent) — IAP flow
- `src/components/SoulPage.tsx` — Restore/Manage subscription for iOS
- `src/components/ResultsPage.tsx` — unlock flow

**Risk**: HIGH — this is the most complex change. Payment flows are critical.
**Revert**: Remove IAP plugin, restore Stripe-only flow.
**Testing**: Must test with App Store Sandbox accounts before submission.

---

## CATEGORY 4: APP STORE CONNECT SETUP (no code changes)

These are administrative tasks done in Apple's web interface, not code:

| Task | Where |
|------|-------|
| Register bundle ID `com.toxicornah.app` | developer.apple.com |
| Create app on App Store Connect | appstoreconnect.apple.com |
| Enroll in Small Business Program (15%) | appstoreconnect.apple.com |
| Sign Paid Apps Agreement | appstoreconnect.apple.com |
| Complete tax forms | appstoreconnect.apple.com |
| Add bank account | appstoreconnect.apple.com |
| Set age rating (17+) | appstoreconnect.apple.com |
| Set pricing & availability | appstoreconnect.apple.com |
| Add Privacy Policy URL | appstoreconnect.apple.com |
| Add Support URL | appstoreconnect.apple.com |
| Configure Privacy Nutrition Label | appstoreconnect.apple.com |
| Create IAP products (after code is ready) | appstoreconnect.apple.com |
| Write app description | appstoreconnect.apple.com |
| Add keywords | appstoreconnect.apple.com |
| Create screenshots (iPhone 6.9" + 6.7") | Figma/Simulator |
| Set locale to English only | appstoreconnect.apple.com |
| Create test account for reviewers | Supabase |
| Write review notes (3-step instructions) | appstoreconnect.apple.com |
| Export compliance (no encryption = exempt) | appstoreconnect.apple.com |

---

## CATEGORY 5: NICE-TO-HAVE (not blocking approval)

| Item | Priority | Notes |
|------|----------|-------|
| Rate limiting on AI calls | Medium | Prevents API cost abuse. Not required by Apple. |
| Offline/slow network handling | Low | Show "No connection" message. Nice UX but not required. |
| Verify `help.toxicornah.com` works | Medium | If URL 404s, Apple may flag it |
| iPad layout testing | Medium | App is portrait-only, should work but needs verification |
| Remove unused files from public/ (non-Adobe) | Low | WhatsApp images, test videos, tmp folders — dev artifacts |

---

## CATEGORY 6: SECTIONS THAT PASSED (no changes needed)

| Checklist item | Status |
|----------------|--------|
| Privacy Policy content | PASS — comprehensive GDPR/CCPA/Italian law |
| Terms of Service content | PASS — entertainment disclaimer, IP rights |
| PP + ToS linked in app | PASS — Settings modal + AuthPage footer |
| Contact email | PASS — support@toxicornah.com |
| Account deletion | PASS — double confirm, Supabase edge function |
| Sign in with Apple | PASS — Supabase OAuth |
| Password reset (OTP) | PASS — email code flow |
| No native permissions needed | PASS — uses HTML file picker |
| No ATT needed | PASS — zero tracking/analytics SDKs |
| No community features | N/A — no user-to-user chat |
| Paywall honesty | PASS — no fake urgency |
| Pricing clarity | PASS — all prices shown clearly |
| Core use-case < 60s | PASS — upload → results in ~5s |
| iOS config clean | PASS — portrait only, deep links, minimal deps |

---

## IMPLEMENTATION ORDER (recommended)

1. **Delete safe files** (Category 1) — zero risk, clean up repo
2. **Fix PersonProfile fallback** (2A) — then delete last Adobe file
3. **Fix dead ends** (2B, 2C, 2D, 2E) — remove/implement broken buttons
4. **Add AI disclosure** (2F) — small additive change
5. **Implement StoreKit 2** (3A) — biggest task, do last when everything else is stable
6. **App Store Connect setup** (Category 4) — parallel with code work

---

## CHECKLIST SCORE BEFORE vs AFTER

| Category | Before | After (projected) |
|----------|--------|-------------------|
| 1. Unfinished flows | 1/4 | 4/4 |
| 2. Legal pages | 5/7 | 7/7 |
| 3. Business setup | 0/5 | 5/5 (App Store Connect) |
| 4. App listing | 0/2 | 2/2 (App Store Connect) |
| 5. Permissions + privacy | 5/6 | 6/6 |
| 6. Subscriptions / IAP | 2/10 | 10/10 (after StoreKit 2) |
| 7. Accounts | 4/4 | 4/4 |
| 8. Community | N/A | N/A |
| 9. Store listing | 1/5 | 5/5 (App Store Connect) |
| 10. Localization | 1/3 | 3/3 |
| 11. QA | 1/6 | 6/6 (after testing) |
| 12. Content + IP | 1/3 | 3/3 |
| 13. Reviewer access | 0/4 | 4/4 |
| 14. Final pass | 1/5 | 5/5 |
| **TOTAL** | **22/78** | **78/78** |
