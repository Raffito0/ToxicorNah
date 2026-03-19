# Emerging Problems

## EP-01: Reveal tap opens Android notification panel on Shop page

**Discovered during**: Search fix test from Shop page (2026-03-19)
**Frame evidence**: f_004 of Shop test — Android notification shade visible
**Root cause**: Reveal tap at y=1.5% (36px) on Shop page hits the Android status bar area, which opens the notification panel. On FYP/Following the top bar is fullscreen-overlay, but on Shop the TikTok UI starts lower (has search bar below top tabs), so y=36px is in the system status bar.
**Reproduction**: Start on Shop tab → run go_to_search() → first tap at y=1.5% opens notifications
**Impact**: LOW — notifications auto-dismiss when TikTok gets focus back, doesn't break the flow
**Fix idea**: Skip the reveal tap when NOT on a fullscreen video page (Shop, Explore, Profile have static top bars that don't need revealing)

## EP-02: Gemini bbox confuses cart icon (🛒) with search icon (🔍) on Shop page

**Discovered during**: Search fix test from Shop page (2026-03-19)
**Frame evidence**: f_007 — Cart page "Your cart is empty" opened instead of search
**Root cause**: On Shop page, the 🛒 cart icon is at x=91.8% y=7% — same area where the 🔍 search icon would be on other pages. Gemini bbox with x_min_pct=0.80 does NOT filter this because cart IS at x>80%.
**Reproduction**: Start on Shop tab → go_to_search() → Gemini finds "magnifier" at cart position → taps → Cart page opens
**Impact**: MEDIUM — wastes one attempt, nuclear_escape recovers. Search still opens on attempt 2.
**Fix idea**: Either (a) detect Shop via top bar text before attempting bbox, or (b) add "NOT cart/shopping bag" more aggressively to prompt, or (c) accept the recovery as sufficient since go_to_search is only called once per search session
