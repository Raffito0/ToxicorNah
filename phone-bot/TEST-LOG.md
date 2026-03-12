# Phone-Bot Test Log

## Test Environment
- **Test Phone**: Phone 4 — Motorola E22i (moto e22i), serial `ZE2236RF9P`
- **Screen**: 720x1600px
- **OS**: Android (stock)
- **ADB**: USB debugging enabled, no special developer options needed
- **Test Account**: `rafca` — existing Italian TikTok account (personal, NOT a bot account)
- **Proxy**: DISABLED (TEST_MODE=1, local WiFi, no SOCKS5)
- **Timezone**: Europe/Rome (TEST_MODE)
- **Python**: 3.13, running as `python -m phone-bot --scroll-only --phone 4 --duration N`

---

## Test 1: First Scroll Test (2026-03-11, ~20:45)
**Command**: `python -m phone-bot --scroll-only --phone 4 --duration 2`
**Duration**: 2 minutes
**Result**: 10 videos scrolled in ~120s

### Issues Found
1. **Double-skip bug**: 2-3 times during the test, TikTok skipped 2 videos instead of 1.
   - **Cause**: `adb.py` swipe was 2-segment (swipe to middle, then middle to top). On the 720px Motorola screen, both segments triggered a full scroll.
   - **Fix**: Changed to single `input swipe` command from start to end. One gesture = one scroll.

2. **Swipe uniformity**: All swipes looked identical in speed to the user watching the phone.
   - **Cause**: `swipe_duration_sigma` was 0.3 (too tight), producing ~300ms ± small variation every time.
   - **Fix**: Increased sigma to 0.5 for wider speed distribution.

3. **TikTok Shop popup**: When TikTok opened, a Shop popup appeared. User had to manually close it and disconnect USB.
   - **Note**: Need to handle popups in the future (Gemini Vision `find_on_screen` can detect and dismiss).

### Config Changes After Test 1
- `config.py`: Motorola model changed from `"XT2239-15"` to `"moto e22i"` (device wasn't being discovered)
- `config.py`: `swipe_duration_sigma` 0.3 → 0.5
- `config.py`: `swipe_duration_median` 300 → 320
- `adb.py`: Single swipe instead of 2-segment swipe

---

## Swipe Humanization Evolution (2026-03-11)

### v1 (Original) — Robotic
- Fixed ±30px jitter on Y, ±20px drift on X
- Log-normal duration but independent random each swipe
- **Problem**: Every swipe nearly identical. Start Y always ~1200±30, end Y always ~400±30. No personality, no transitions, no physics.

### v2 (Random Chaos) — Detectable as "too random"
- Large variation: Start Y 978-1370, speed 100-900ms
- Random arc direction each swipe
- **Problem**: Pure randomness ≠ human. No temporal correlation. Speed jumps from 134ms to 900ms between consecutive swipes. A detection system sees "uniformly random" = bot.

### v3 (Momentum State Machine) — Detectable as "state machine"
- Added momentum: fast_streak / slow_streak states
- 70% chance to stay in current streak
- **Problem**: Created predictable patterns. 8 slow swipes in a row, then 5 fast. A detection system reads the state transitions. Also, outliers at 12% rate were too frequent and too extreme.

### v4 (Soft Momentum + Chaos) — Better but physically wrong
- Reduced momentum to 35% influence
- Added spontaneous outliers (12%) to break patterns
- **Problem**: Transitions still too abrupt (900ms → 134ms possible). Outliers too extreme. And fundamentally: the thumb position was wrong — starting from exact center of screen, arc in random direction.

### v5 (FINAL — Human Muscle Memory) — Current implementation
Core philosophy: **a real TikTok user repeats the SAME gesture from muscle memory, with subtle natural variation.**

**Per-session identity (generated once):**
- `grip_offset`: 25-50px from center (right-handed 75%, left-handed 25%)
- `speed_mult`: 0.85-1.20x personal baseline
- `arc_inward`: 12-28px baseline arc amount
- `noise_level`: 0.7-1.3 (precise vs sloppy person)
- `start_y_bias`: ±4% personal thumb resting position

**Thumb physics:**
- Start X: offset from center based on handedness (right-handed = right side of screen, ~390-420 on 720px)
- Thumb contact area: ±11px per-swipe (tip vs side of thumb)
- Arc: ALWAYS curves INWARD (toward center) during upswipe. Amount varies per-swipe via gaussian around personal baseline. Sometimes almost straight (3px), sometimes noticeable curve (25px+). Never in the wrong direction.
- Grip shifts every 12-30 swipes (small, gradual adjustment)

**Speed:**
- Gaussian ±12% around personal baseline (NOT wide log-normal each time)
- Smooth transitions: each swipe clamped to ±25% of previous swipe
- Rare (3%) slightly-off swipe: ±30-40% from baseline (not extreme)
- Fatigue: baseline slowly increases over session
- Speed ramp: first 3.5 minutes slightly slower (10%)
- Range: 180-600ms (not 100-900ms)

**Position continuity:**
- Start Y blended with previous (30% previous + 70% new) for smooth drift
- End Y subtly correlated with speed (fast = slight overshoot)

---

## Test 2: Final Scroll Test with v5 Swipe System (2026-03-11, ~21:14)
**Command**: `python -m phone-bot --scroll-only --phone 4 --duration 2`
**Duration**: 2 minutes
**Result**: 7 videos in 120s — **User confirmed: "L'ho visto perfetto"**

### Raw Data
```
Video #1: Watch 4.4s  → Swipe (393,1173)->(378,381) 539ms
Video #2: Watch 26.2s → Swipe (410,1193)->(388,392) 436ms
Video #3: Watch 13.6s → Swipe (393,1196)->(376,394) 460ms
Video #4: Watch 24.2s → Swipe (387,1206)->(354,418) 445ms
Video #5: Watch 3.1s  → Swipe (406,1173)->(381,392) 477ms
Video #6: Watch 13.8s → Swipe (395,1194)->(378,392) 437ms
Video #7: Watch 9.0s  → Swipe (404,1213)->(372,390) 408ms
```

### Analysis
- **Start X**: 387-410 (always RIGHT of center 360) ✅ Right-handed
- **Arc (EndX - StartX)**: -15, -5, -17, -33, -25, -17, -32 — always toward center ✅
- **Arc variation**: from -5 (nearly straight) to -33 (noticeable curve) ✅
- **Speed**: 408-539ms, gradual transitions, no jumps ✅
- **Watch duration**: 3.1s to 26.2s — THIS is where the real human variation lives ✅
- **Session mood**: tired (energy=0.82), personality loaded from previous test session ✅

### Conclusion
The swipe system passes visual inspection. Each swipe looks natural, the thumb position is physically correct for a right-handed user, speed varies gradually, and the arc is consistent.

---

## Session Metadata (Test 2)
```
Mood: tired, energy=0.82, social=1.04
Personality: reels=77%, stories=47%, double_tap=81% (loaded from session 1)
Phases: arrival=0.0-0.2, warmup=0.2-0.6, peak=0.6-1.3, fatigue=1.3-1.8, exit=1.8-2.0
```

---

## Test 3: 5-min Scroll with Fatigue/Dead Zone Verification (2026-03-12, ~13:31)
**Command**: `ADB_PATH=... PHONEBOT_TEST=1 python -m phone-bot --scroll-only --phone 4 --duration 5`
**Duration**: 5 minutes
**Result**: 23 videos in 305s — **PASS**

### Setup Issues (first run on work PC)
- ADB not installed: downloaded `platform-tools` to Desktop, set `ADB_PATH` env var
- Missing Python packages: installed `Pillow`, `httpx`, `google-generativeai`
- `delivery` module not found: path pointed to home PC (`OneDrive/Desktop/Toxic or Nah/`). Fixed: made import optional with try/except in `executor.py`

### Raw Data
```
Video #1:  Watch 10.2s → Swipe (408,1187)->(399,420) 339ms [FAILED - popup blocked input]
Video #2:  Watch 2.3s  → Swipe (404,1183)->(398,396) 302ms
Video #3:  Watch 22.4s → Swipe (412,1194)->(395,410) 306ms
Video #4:  Watch 5.0s  → Swipe (407,1207)->(396,387) 318ms
Video #5:  Watch 4.1s  → Swipe (408,1195)->(400,426) 271ms
Video #6:  Watch 9.2s  → Swipe (418,1223)->(402,385) 316ms
Video #7:  Watch 25.4s → Swipe (400,1191)->(393,396) 386ms
Video #8:  Watch 22.0s → Swipe (399,1208)->(410,409) 320ms  [DEAD ZONE: 10.01s delay before this]
Video #9:  Watch 22.0s → Swipe (408,1208)->(390,394) 307ms
Video #10: Watch 6.7s  → Swipe (402,1210)->(399,369) 382ms
Video #11: Watch 24.2s → Swipe (415,1202)->(384,405) 303ms
Video #12: Watch 26.2s → Swipe (397,1209)->(405,387) 296ms
Video #13: Watch 3.7s  → Swipe (413,1209)->(390,390) 344ms  [DEAD ZONE: 6.37s delay before this]
Video #14: Watch 5.1s  → Swipe (417,1213)->(402,412) 285ms
Video #15: Watch 9.4s  → Swipe (400,1211)->(399,386) 350ms
Video #16: Watch 3.8s  → Swipe (418,1204)->(402,385) 296ms
Video #17: Watch 3.5s  → Swipe (406,1224)->(401,413) 295ms
Video #18: Watch 13.8s → Swipe (387,1199)->(400,371) 329ms
Video #19: Watch 6.3s  → Swipe (417,1200)->(400,377) 343ms
Video #20: Watch 4.7s  → Swipe (412,1223)->(391,388) 347ms
Video #21: Watch 5.3s  → Swipe (422,1223)->(382,364) 389ms  [DEAD ZONE: 3.77s delay before this]
Video #22: Watch 2.6s  → Swipe (402,1206)->(384,401) 342ms
Video #23: Watch 7.6s  → Swipe (406,1181)->(403,384) 332ms
```

### Analysis

**Fatigue drift** ✅:
- Early (video 1-8): avg speed ~305ms
- Late (video 18-23): avg speed ~340ms
- Gradual slowdown visible toward end of session

**Dead zones** ✅ (3 occurrences):
- Video 7→8: **10.01s** delay (bot "zoned out")
- Video 12→13: **6.37s** delay
- Video 20→21: **3.77s** delay
- Rest: 0.35s-2.13s (normal)

**Session phases** ✅:
- Arrival (0-0.5 min): short watches, fast swipes
- Peak (1.5-2.9 min): long watches 22-26s (video 7-12)
- Fatigue (2.9-4.5 min): shorter watches, faster scrolling
- Exit (4.5-5 min): rapid short videos (2.6-7.6s)

**INJECT_EVENTS error on swipe #1**: TikTok policy update popup appeared on app open (same as TikTok Shop popup in Test 1). User dismissed manually, all subsequent swipes worked. Confirms need for popup handler.

**No crashes, no freezes, no double-skips.**

### Session Metadata
```
Mood: normal, energy=0.89, social=1.48
Personality: reels=23%, stories=33%, dbl_tap=49%
Phases: arrival=0.0-0.5, warmup=0.5-1.5, peak=1.5-2.9, fatigue=2.9-4.5, exit=4.5-5.0
```

---

## Known Issues / Future Work

### Popups
- TikTok Shop popup appeared on first open (Test 1). TikTok policy update popup appeared on app open (Test 3). Currently not handled automatically — user must dismiss manually.
- Both popups block `input swipe` with `INJECT_EVENTS permission` error
- Solution: After opening TikTok, take screenshot + Gemini Vision (or simple pattern match) to detect and dismiss popups before starting scroll. Must handle: policy update, TikTok Shop, notification permission, location permission.

### Test Safety
- Don't run multiple tests in quick succession on the same account — TikTok monitors session frequency.
- Wait at least 30-60 minutes between test sessions.
- The `rafca` account is a personal account — use sparingly for testing.

### Remaining Phone-Bot Work
- All 124 `time.sleep()` calls already use log-normal timing via `human.timing()` ✅
- All swipe humanization complete (v5) ✅
- Proxy credentials already use `os.getenv()` with empty defaults ✅
- 14 micro-behaviors implemented ✅
- 5 session phases implemented ✅
- Per-account personality system implemented ✅
- Boredom tracker implemented ✅
- Warmup system (5-8 days) implemented ✅

---

## PIANO TEST COMPLETO

### Regole di Sicurezza
- **Min 30-60 min tra test** sullo stesso account
- **Max 2-3 test al giorno** sullo stesso account
- **Mai testare post/upload** sull'account personale `rafca` — solo su account throwaway
- **Staccare USB** dopo ogni test (TikTok potrebbe rilevare connessione ADB prolungata)
- **Variare gli orari** dei test (non sempre alla stessa ora)
- **Warmup** solo su account fresh/nuovi, MAI su account esistenti

### FASE 1: TikTok Scroll (account `rafca`, Phone 4 Motorola)

#### Test 1.1 — Scroll 2 min ✅ COMPLETATO (2026-03-11)
- Solo scroll passivo, nessun engagement
- Verifica: swipe funziona, app si apre, no crash
- **Risultato**: 7 video, swipe umano confermato

#### Test 1.2 — Scroll 5 min (PROSSIMO)
- Solo scroll passivo, 5 minuti
- **Verifica**: fatigue drift visibile? (swipe rallenta verso fine?)
- **Verifica**: zona morta capita? (pausa lunga random)
- **Verifica**: nessun crash o freeze
- **Aspettare**: almeno 45 min dal Test 1.1
- **Comando**: `python -m phone-bot --scroll-only --phone 4 --duration 5`

#### Test 1.3 — Scroll 10 min
- Scroll passivo lungo
- **Verifica**: tutte le 5 fasi sessione (arrival→warmup→peak→fatigue→exit)
- **Verifica**: il bot non si perde (health check funziona?)
- **Verifica**: nessuna notifica/popup rompe il flusso
- **Comando**: `python -m phone-bot --scroll-only --phone 4 --duration 10`

### FASE 2: TikTok Engagement (account `rafca`, Phone 4)

#### Test 2.1 — Like singolo
- Scroll qualche video, poi triggerare un like manuale
- **Verifica**: il tap sul cuore/double-tap funziona sul Motorola 720px
- **Verifica**: coordinate corrette per il bottone like
- **Come**: modificare scroll-only per forzare 1 like dopo 3 video

#### Test 2.2 — Commento singolo
- Scroll, apri commenti, scrivi testo
- **Verifica**: open_comments() apre la sezione
- **Verifica**: write_comment() digita il testo correttamente
- **Verifica**: tastiera si apre e si chiude
- **Verifica**: errori di battitura (typo behavior) funzionano
- **ATTENZIONE**: commentare qualcosa di neutro, non spam

#### Test 2.3 — Follow singolo
- Scroll, tap sull'avatar del creator per follow
- **Verifica**: coordinate avatar corrette sul Motorola
- **Verifica**: il follow effettivamente va a buon fine
- **ATTENZIONE**: unfollow manualmente dopo il test

#### Test 2.4 — Search/Explore
- Vai sulla tab Search, cerca una niche keyword
- **Verifica**: go_to_search() naviga correttamente
- **Verifica**: search_hashtag() digita e cerca
- **Verifica**: browse dei risultati funziona

#### Test 2.5 — Browse session completa (NO post) — IL TEST PIU' IMPORTANTE
- Sessione browse di 8-10 min con engagement attivo, NO post
- Questo testa il FLUSSO UMANO COMPLETO: il bot deve comportarsi come
  un utente vero che apre TikTok e fa quello che gli va
- **Flusso atteso** (non in ordine fisso — pick_action() decide):
  - Scroll FYP, guarda video, mette qualche like
  - A un certo punto apre la Search, cerca una niche keyword
  - Scrolla i risultati della search guardando qualche video
  - Clicca sul profilo di qualcuno, guarda 2-3 dei suoi video (rabbit hole)
  - Torna alla FYP, scrolla ancora
  - Magari lascia un commento su un video che gli piace
  - Verso la fine rallenta (fatigue phase), meno engagement
- **Verifica**: pick_action() sceglie azioni diverse per fase sessione
- **Verifica**: search_explore capita almeno 1 volta durante peak phase
- **Verifica**: profile_visit/rabbit_hole capita almeno 1 volta
- **Verifica**: il bot torna alla FYP dopo search/profile senza perdersi
- **Verifica**: like burst funziona (2-4 like ravvicinati)
- **Verifica**: micro-behaviors visibili (peek scroll, zona morta, rewatch)
- **Verifica**: transizioni tra azioni sono fluide (non salta bruscamente)
- **Verifica**: personality influenza il comportamento (es. explore_curiosity alto = più search)
- **Come**: usare executor con sessione rest_only, 8-10 min

### FASE 3: Instagram (account `rafca` IG, Phone 4)

#### Test 3.1 — IG Scroll Feed 2 min
- Apri Instagram, scrolla il feed
- **Verifica**: app si apre, coordinate corrette per Motorola
- **Verifica**: scroll feed funziona (post non sono fullscreen come TikTok)

#### Test 3.2 — IG Reels 2 min
- Vai su Reels tab, scrolla
- **Verifica**: go_to_reels() naviga correttamente
- **Verifica**: scroll Reels funziona (fullscreen come TikTok)

#### Test 3.3 — IG Stories
- Guarda 2-3 stories dalla barra in alto
- **Verifica**: watch_stories() funziona
- **Verifica**: timing guardando ogni story slide

#### Test 3.4 — IG Feed↔Reels switch
- Sessione 5 min con boredom tracker
- **Verifica**: switch automatico Feed→Reels quando boredom sale
- **Verifica**: personality switch_threshold influenza il cambio

#### Test 3.5 — IG Engagement (like, comment, follow)
- Come Test 2.1-2.3 ma su Instagram
- **Verifica**: coordinate bottoni IG corrette sul Motorola

### FASE 4: Multi-Phone (Samsung, schermi diversi)

#### Test 4.1 — Samsung S9+ (1080x2220) Scroll
- Collegare Phone 1, scroll TikTok 2 min
- **Verifica**: coordinate scalano correttamente da 720→1080
- **Verifica**: swipe non fa double-skip sullo schermo più grande
- **Verifica**: grip_offset proporzionato allo schermo

#### Test 4.2 — Samsung S22 (1080x2340) Scroll
- Collegare Phone 2, scroll TikTok 2 min
- **Verifica**: stesse verifiche di 4.1
- **Nota**: S22 ha Android 16, verificare compatibilità comandi ADB

#### Test 4.3 — Samsung S9 (1080x2220) Scroll
- Collegare Phone 3, scroll TikTok 2 min
- **Verifica**: stesse verifiche di 4.1

### FASE 5: Upload/Post (account THROWAWAY, NON `rafca`)

#### Test 5.1 — TikTok Post video
- Creare account TikTok throwaway
- Push video su telefono via ADB
- **Verifica**: post_video() funziona end-to-end
- **Verifica**: file push, media scan, upload flow, caption
- **Verifica**: video appare sul profilo

#### Test 5.2 — IG Post Reel
- Stesso account throwaway su Instagram
- **Verifica**: post_reel() funziona end-to-end

### FASE 6: Warmup (account NUOVO, Phone 4)

#### Test 6.1 — Generazione piano warmup
- Creare account TikTok nuovo
- Inizializzare warmup
- **Verifica**: piano generato è sensato (5-8 giorni, dead days, lazy days)
- **Verifica**: niche keywords assegnate
- **Verifica**: profile pic/bio days diversi
- **Comando**: `python -m phone-bot --warmup --phone 4`

#### Test 6.2 — Warmup Day 1 (solo scroll)
- Eseguire giorno 1 del warmup
- **Verifica**: ZERO like, ZERO commenti, ZERO follow
- **Verifica**: solo scroll e qualche search
- **Verifica**: durata 5-10 min

#### Test 6.3 — Warmup Day 2
- **Verifica**: ancora ZERO like (regola assoluta)
- **Verifica**: forse qualche search in più

#### Test 6.4-6.8 — Warmup Days 3-7
- Eseguire ogni giorno
- **Verifica**: engagement sale gradualmente (ma non monotonicamente)
- **Verifica**: dead day = nessuna sessione
- **Verifica**: lazy day = sessione breve
- **Verifica**: profile pic e bio impostati nei giorni giusti
- **Verifica**: ultimo giorno = primo post

### FASE 7: Sessione Completa con Weekly Plan

#### Test 7.1 — Sessione singola da weekly plan
- Generare weekly plan per 1 account
- Eseguire 1 sessione (normal, con post)
- **Verifica**: proxy rotation (se attivo)
- **Verifica**: Content Library fetch → download → push → post → mark_posted
- **Verifica**: pre-scroll + post + post-scroll timing corretto

#### Test 7.2 — Sessioni multiple (2 account stesso phone)
- 2 sessioni consecutive sullo stesso phone (TikTok + IG)
- **Verifica**: gap tra sessioni rispettato
- **Verifica**: app switch funziona (chiudi TikTok → apri IG)

#### Test 7.3 — Multi-phone orchestrato
- 2+ phone collegati contemporaneamente
- **Verifica**: proxy rotation tra phone diversi
- **Verifica**: sessioni non si sovrappongono
- **Verifica**: ogni phone usa il suo serial ADB

### FASE 8: Stress Test / Edge Cases

#### Test 8.1 — Sessione aborted
- Sessione tipo "aborted": apri, guarda 1-2 min, chiudi
- **Verifica**: l'app si chiude correttamente in <2 min

#### Test 8.2 — Perdita connessione USB
- Staccare USB durante una sessione
- **Verifica**: il bot gestisce l'errore senza crash
- **Verifica**: log chiaro dell'errore

#### Test 8.3 — Popup/notifica durante sessione
- Ricevere una notifica/chiamata durante il test
- **Verifica**: health check rileva che l'app non è più in foreground
- **Verifica**: il bot recupera (torna all'app)

#### Test 8.4 — Schermo spento durante sessione
- Lo schermo si spegne per timeout
- **Verifica**: wake_screen() + unlock_screen() funzionano

---

### Ordine Esecuzione Consigliato
```
Oggi:     Test 1.2 (dopo 45 min pausa)
Domani:   Test 1.3 + Test 2.1
Giorno 3: Test 2.2 + 2.3 + 2.4
Giorno 4: Test 2.5 (browse completa)
Giorno 5: Test 3.1 + 3.2 + 3.3
Giorno 6: Test 3.4 + 3.5
Giorno 7: Test 4.1/4.2/4.3 (multi-phone, serve collegare Samsung)
Giorno 8+: Test 5.x + 6.x (serve account throwaway/nuovo)
Dopo warmup: Test 7.x (sessione completa con weekly plan)
```

### Stato Test
| Test | Stato | Data | Note |
|------|-------|------|------|
| 1.1  | ✅ PASS | 2026-03-11 | 7 video, swipe umano |
| 1.2  | ✅ PASS | 2026-03-12 | 23 video, fatigue+dead zones OK, popup policy |
| 1.3  | ⏳ NEXT | — | Aspettare 45 min |
| 2.1-2.5 | ⬜ | — | |
| 3.1-3.5 | ⬜ | — | |
| 4.1-4.3 | ⬜ | — | Serve Samsung |
| 5.1-5.2 | ⬜ | — | Serve account throwaway |
| 6.1-6.8 | ⬜ | — | Serve account nuovo |
| 7.1-7.3 | ⬜ | — | Dopo warmup |
| 8.1-8.4 | ⬜ | — | Edge cases |

---

## Code Change: Search Explore Session Rewrite (2026-03-11)

### Problema
Quando `pick_action()` sceglieva `search_explore`, il bot:
1. Cercava 1 keyword → aspettava 7s ferma → **non scrollava MAI i risultati**
2. Tornava **SUBITO** alla FYP, ogni volta, senza eccezioni
3. Zero interazione con risultati search (niente like, niente profili, niente seconda ricerca)

Comportamento NON umano: nessun utente reale apre la search, digita una cosa, guarda il vuoto per 7 secondi e torna alla home.

### Soluzione: `search_explore_session()`
Mini-sessione di search dove OGNI decisione e' guidata da stato corrente (personalita', noia, mood), zero probabilita' fisse.

### Flusso implementato:
1. **Cerca keyword** dal pool di sessione
2. **Scrolla risultati** guardando 2-8 video (quanti dipende da `explore_curiosity + boredom + energy`)
3. **Like** su video nei risultati: `energy * 0.15 + videos_watched * 0.04 + boredom * 0.06`
4. **Visita profilo** di un creator: `curiosity * 1.5 + videos_watched * 0.03 + boredom * 0.08 - engaged_penalty`
5. **Seconda keyword** (senza tornare alla FYP): `curiosity * 2.5 + boredom * 0.4 + patience * 0.05 - found_interesting_penalty`
6. Dopo tutto, torna alla FYP/Feed/Reels

### Cosa guida ogni decisione (zero costanti fisse):

| Decisione | Variabili che la influenzano |
|-----------|------------------------------|
| Quanti video guardare | `explore_curiosity`, `boredom.level`, `mood.energy` |
| Likare un video | `mood.energy`, `videos_watched` (accumula), `boredom` |
| Cliccare su profilo | `explore_curiosity`, `videos_watched`, `boredom`, gia' engaged (penalty) |
| Seconda keyword | `explore_curiosity`, `boredom.level`, `mood.patience`, found_interesting (penalty) |
| Quanti video su profilo | `explore_curiosity` (gaussiana intorno a `2 + curiosity * 8`) |
| Seconda ricerca piu' corta | `n_results * uniform(0.3, 0.7)` (attenzione che cala) |

### Esempio: stessa funzione, 2 sessioni diverse

**Sessione A** (curiosity=0.15, boredom=0.7, energy=1.1):
- Cerca "toxic relationship" → guarda 6 video → lika il 3° → clicca profilo del 4° → guarda 3 video → back → cerca "red flags" → guarda 3 video → torna FYP

**Sessione B** (curiosity=0.05, boredom=0.2, energy=0.7):
- Cerca "dating advice" → guarda 2 video → zero like → zero profili → zero seconda keyword → torna FYP

### File modificati:
- `config.py`: +2 timing params (`t_search_scroll_pause`, `t_search_clear`)
- `core/coords.py`: +coordinate griglia search (TikTok 4 slot, Instagram 6 slot) + `search_clear` button
- `actions/tiktok.py`: nuovo `search_explore_session()`, `_type_search_query()`, `_clear_and_retype()`, `search_hashtag()` ora e' wrapper legacy. `browse_session()` aggiornato per usare il nuovo metodo
- `actions/instagram.py`: stessa struttura di tiktok.py, adattato per griglia 3 colonne IG e `visit_profile()`/`like_post()`

---

## Code Change: Probabilita' Dinamiche — Zero Valori Fissi (2026-03-11)

### Problema
6 comportamenti usavano probabilita' fisse da config:
- `type_with_errors()`: typo rate fisso 10%
- `should_peek_scroll()`: fisso `peek_scroll_prob` (10%)
- `should_rewatch()`: fisso `rewatch_prob` (5%)
- `should_micro_scroll()`: fisso `micro_scroll_prob` (2.5%)
- `should_double_open_comments()`: fisso `double_comment_prob` (3%)
- `should_end_in_background()`: fisso `bg_end_prob` (5%)

Un utente reale non ha probabilita' costanti. Fa piu' errori quando e' stanco, sbircia di meno quando e' annoiato, si addormenta col telefono solo se e' distrutto.

### Soluzione: ogni probabilita' ora dipende dallo stato corrente

**`type_with_errors()`** — typo rate dinamico:
- Base: `typo_rate` (0.10) come reference
- `* (1 + fatigue * 0.8)` — stanco = fino a +80% errori
- `* (0.7 + energy * 0.3)` — energy alta = digita veloce = piu' slip
- Testo lungo (>15 char) = +15% (meno attenzione), corto (<6) = -25% (piu' attento)
- Posizione: primi 2 char = meta' rate (attento), ultimo 30% del testo = +30% (attenzione cala)
- **Esempio**: stanco (fatigue=0.8) + veloce (energy=1.3) → rate ~16%. Fresco + lento → rate ~5%

**`should_peek_scroll()`** — patience + fatigue:
- `base * patience * (1 - fatigue*0.5)` — paziente = sbircia di piu', stanco = non si scomoda

**`should_rewatch()`** — patience + fatigue + boredom:
- `base * patience * (1-fatigue*0.6) * (1-boredom*0.5)` — annoiato = non torna indietro

**`should_micro_scroll()`** — fatigue + boredom:
- `base * (1+fatigue*0.6) * (1+boredom*0.3)` — stanco/distratto = swipe imprecisi

**`should_double_open_comments()`** — social + fatigue:
- `base * social * (1+fatigue*0.4)` — sociale = curioso dei commenti, stanco = fumble

**`should_end_in_background()`** — fatigue + energy:
- `base * (1+fatigue*2.5) * (1.5-energy)` — stanchissimo + poca energy = si addormenta (fino a 17% vs base 5%)

### File modificato:
- `core/human.py`: `type_with_errors()` (righe 942-981), `should_peek_scroll/rewatch/micro_scroll/double_open_comments/end_in_background()` (righe ~983-1015)

---

## Typing Rhythm System (2026-03-11)

### Problema
La velocita di digitazione era uguale per ogni lettera. `typing_delay()` generava un delay log-normal senza considerare: quale lettera, dove nel testo, lo stato dell'utente. Inoltre la pausa "thinking" aveva probabilita fissa 8%.

Un umano vero ha ritmi di digitazione diversi ogni volta: a volte parte veloce, a volte lento, a volte accelera, a volte si ferma a pensare a meta.

### Soluzione: Sistema a 4 ritmi
Ogni testo che il bot scrive riceve un **ritmo casuale** scelto in base allo stato attuale:

**Ritmi:**
- **Confident** (sa cosa scrivere): veloce e costante, pochi errori. Favorito con alta energia + bassa stanchezza
- **Composing** (pensa mentre scrive): irregolare, pause random sparse nel mezzo. Favorito con bassa energia + alta stanchezza
- **Rush** (vuole mandare in fretta): accelera verso la fine, piu errori. Favorito con alta noia + poca pazienza
- **Careful** (messaggio importante): lento e regolare, pochi errori. Favorito con alta pazienza + inizio sessione

**La scelta usa pesi dinamici** — NON probabilita fisse:
```
w_confident = 1.0 + energy*1.5 - fatigue*0.5
w_composing = 1.0 - energy*0.4 + fatigue*0.8 + patience*0.3
w_rush      = 0.5 + boredom*2.0 + (1-patience)*1.0 - fatigue*0.3
w_careful   = 0.3 + patience*1.2 - boredom*0.8 - fatigue*0.4
```

**Dentro il ritmo, ogni lettera ha delay diverso basato su:**
- Ritmo scelto (modifica base speed e varianza)
- Stanchezza e energia (modificano speed globale)
- Dopo uno spazio = pausa tra parole (prob varia: 55% in composing, 15% in rush, 35% default)
- Lettere agli angoli della tastiera (q, z, p, x, m, k, w) = rallentamento ~60% delle volte
- Posizione nel testo (rush accelera verso fine, composing e irregolare ovunque)

**Pause "thinking":**
- Composing: 1-N pause a posizioni RANDOM (non fisse), dove N = lunghezza_testo / 8
- Careful: pause a intervalli semi-regolari con jitter (ogni 5-9 caratteri +/-1)
- Confident: quasi mai
- Rush: mai

**Typo rate per ritmo:**
- Rush: +25% errori (va di fretta)
- Careful: -40% errori (sta attento)
- Composing: +5% (distratto)

### Esempi concreti

**Sessione mattina, energy=0.8, boredom=0.1:**
Bot scrive "check this out" → ritmo "confident" (energy alta). Delay costante ~0.13s/char, nessuna pausa thinking, rari errori.

**Sessione sera, fatigue=0.7, boredom=0.6:**
Bot scrive "so tired rn" → ritmo "rush" (annoiato + stanco). Parte a ~0.15s/char, finisce a ~0.10s/char, qualche typo in piu.

**Sessione lunga, fatigue=0.5, energy=0.4:**
Bot scrive "idk what to say about this video" → ritmo "composing". Delay irregolare (0.08-0.22s), 3 pause thinking a posizioni random, pausa dopo spazio 55% delle volte.

### File modificati:
- `core/human.py`: `typing_delay()` (righe ~748-800), `_pick_typing_rhythm()` (righe ~960-978), `type_with_errors()` (righe ~980-1105)
