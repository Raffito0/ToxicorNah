# Toxic or Nah - Project Memory

## MANDATORY FORGE v2 WORKFLOW — phone-bot files

For phone-bot work, FORGE v2 replaces the old Block A/B/P text patterns with CLI commands that produce JSON cache files. Hooks verify these files mechanically — no text pattern matching.

**Three phases**: Analyze (before edit) → Predict (before test) → Verify (after test).
Each phase has required CLI steps. If you skip any, the hook blocks the next action.

For non-phone-bot work (web app, n8n, UI/UX, brainstorming), use the variant analysis blocks below — these are NOT enforced by hooks but are best-practice templates.

---

### FORGE v2 — Phase 1: Analyze (before ANY Edit/Write on phone-bot files)

**Enforced by hook**: `require-forge-analyze.py` blocks Edit/Write on phone-bot files if `.analyze_cache.json` is missing or incomplete.

Before editing ANY phone-bot file, run ALL of these commands in order:

```bash
python forge/forge_analyze.py --init --section <section-name>
python forge/forge_analyze.py --callers <function-being-modified>
python forge/forge_analyze.py --call-chain <function-being-modified>
python forge/forge_analyze.py --regression-check
python forge/forge_analyze.py --protected-core <function-being-modified>
python forge/forge_analyze.py --config-check
```

Optional (when fix involves pixel coordinates):
```bash
python forge/forge_analyze.py --pixel-check --factor <N>
```

Rules:
- **All 5 required steps must complete** before any Edit/Write is allowed. The hook checks `forge/.analyze_cache.json` mechanically.
- **SOLUTIONS.md first**: search `phone-bot/SOLUTIONS.md` with keywords matching the problem type BEFORE diagnosing. If a match exists, reuse that approach directly.
- **2nd failed attempt** → STOP. Spawn `problem-solver-specialist`, pass full context, wait for output before proceeding.
- **PROTECTED_CORE**: `_return_to_fyp`, `_tap_top_tab`, `get_bounding_box`, `scan_sidebar`, `humanize_swipe`, `tap_nav_home`, `_inbox_enter_subpage`. The `--protected-core` step detects these. The hook `require-protected-core-test.py` will BLOCK the Edit unless `phone-bot/.browse_smoke_ok` sentinel exists.
- **Regression files**: `--regression-check` populates `regression_files_to_read` in the cache. The hook checks `forge/.read_log.json` (populated by `track-reads.py` PostToolUse:Read hook) to verify you actually Read those files before editing.
- **Pixel math**: if `--pixel-check` was run, the hook validates that coordinate values in your Edit match the computed values for all 3 phones.
- **Non-phone-bot files**: the hook does NOT fire. Use the appropriate Block A variant below instead.

---

### Block A variants — use the matching block based on work type

#### App Idea / Brainstorming

```
── ANALYSIS (App Idea) ──────────────────────────────────────────
Pain:        [chi ha questo problema, con che frequenza, quanto gli fa male]
Hook:        [una frase che fa venire voglia all'istante — zero spiegazioni]
Why now:     [cosa è cambiato di recente che rende questo il momento giusto]
Evidence:    [prova che la gente lo vuole: Reddit / TikTok comments / search volume]
Audience:    [chi esattamente — età, comportamento, cosa già usano]
Differ:      [perché questo vs X/Y/Z — vantaggio specifico, non generico]
Virality:    [cosa lo rende virale su TikTok/Reels: meccaniche dell'app,
              features che spingono a condividere, UX loops che creano abitudine,
              brand identity che amplifica, content angles concreti]
Content:     [formati video: hook AI girl Sora 2 + outro AI +
              handheld POV iPhone mentre uso l'app — quali scene funzionano,
              quale storia racconta ogni formato]
Retention:   [meccanismi applicabili: streak / notifiche smart / social proof /
              FOMO / contenuto fresco / personalizzazione / gamification /
              utilità quotidiana / habit loop / UGC →
              quali si integrano naturalmente →
              frequenza realistica: giornaliera / più volte al giorno / settimanale →
              il #1 motivo per cui riaprono domani]
Monetize:    [tutti i modelli applicabili: sub / freemium / one-time / ads /
              marketplace % / in-app purchases / API / licensing →
              quali integrano naturalmente vs sembrano forzati/fastidiosi →
              chi pagherà davvero e perché (evidence da app simili) →
              mix ottimale: modello principale + secondario]
Loop:        [meccanismo di crescita organica integrato nel prodotto — ogni utente porta altri?]
Brand:       [nome: si ricorda in 2 secondi? / identità visiva / emozione che evoca / handle liberi]
Distribution:[come viene scoperto OLTRE alla virality: ASO keywords / influencer /
              paid / press / community seeding / cross-promo]
Build:       [sfida tecnica principale / stack necessario / timeline realistica MVP]
MVP:         [il minimo assoluto per validare in 2 settimane]
─────────────────────────────────────────────────────────────────
```

#### n8n Workflow

```
── ANALYSIS (n8n) ───────────────────────────────────────────────
Trigger:     [cosa avvia il workflow + frequenza di esecuzione]
Data flow:   [formato input → ogni trasformazione → formato output finale]
Failure:     [cosa può rompersi ad ogni step + fallback / error handling]
Shared:      [altri workflow che leggono le stesse tabelle Airtable / webhook]
Cost:        [API calls per esecuzione × volume atteso × costo per API]
Rate limits: [quale API colpisce rate limit prima? a che volume?]
Idempotent:  [se gira due volte crea duplicati? come prevenirlo?]
Debug:       [come saprò quando si rompe in silenzio alle 3 di notte?]
─────────────────────────────────────────────────────────────────
```

#### App Development (React / TypeScript / Web)

```
── ANALYSIS (App Dev) ───────────────────────────────────────────
Cause:       [file:line — not a symptom]
Read:        [files Read]
Options:     [opt1 / opt2 / chosen: optN because ...]
Attempt:     [1st / 2nd → STOP: spawn problem-solver-specialist]
Callers:     [callers found via grep]
Breakage:    [callerA ✓  callerB ✓ ...]
User value:  [questo aiuta davvero l'utente? lo noterebbe se sparisse?]
Edge cases:  [input/stati insoliti che devono funzionare]
Types:       [rompe tipi TypeScript da qualche parte? ✓/✗]
Performance: [impatto su load time o runtime? ✓/✗]
Security:    [rischi XSS / injection / auth? ✓/✗]
─────────────────────────────────────────────────────────────────
```

#### UI/UX Design

```
── ANALYSIS (UI/UX) ─────────────────────────────────────────────
Problem:     [quale problema UX risolve — specifico, non generico]
First 3s:    [cosa vede e sente un nuovo utente nei primi 3 secondi]
Clarity:     [un utente non-tecnico sa immediatamente cosa fare? ✓/✗]
Friction:    [il punto di attrito più grande — può essere eliminato?]
Delight:     [cosa rende questo memorabile o piacevole da usare]
Flows:       [schermate / componenti / user flows affetti]
Platforms:   [differenze specifiche web / iOS / Android]
Thumb zone:  [le azioni chiave sono raggiungibili con un pollice? ✓/✗]
System:      [coerente con il design system esistente? ✓/✗]
States:      [loading state / error state / empty state definiti? ✓/✗]
─────────────────────────────────────────────────────────────────
```

---

### FORGE v2 — Phase 3: Verify (after test completes, before declaring PASS)

**Enforced by hook**: `require-forge-verify.py` blocks `forge_controller record-pass` if `.verify_result.json` is missing or incomplete.

After each test run, run ALL of these commands in order:

```bash
python forge/forge_verify.py --filter-logs --log <test_log_path>
python forge/forge_verify.py --gemini-analysis --video <recording.mkv> --log forge/.filtered_log.txt
python forge/forge_verify.py --compare-predictions
python forge/forge_verify.py --interference-check
python forge/forge_verify.py --write-emerging
```

Then record the result:
```bash
python forge/forge_controller.py record-pass   # or record-fail
```

Rules:
- **N/3 resets to 0 on any FAIL**. Three consecutive PASS = section done.
- **`--gemini-analysis` with `--mock`** is allowed for offline testing but the hook blocks `record-pass` if verdict is UNVERIFIED. Real video required for production PASS.
- **Interference detection**: `--interference-check` reads the verify result. If a high/critical popup or unexpected_screen anomaly precedes the failure event, the attempt is NOT counted (not a real failure of your fix).
- **Recovery > 2 fires = masked bug**: the Gemini analysis detects excessive recovery calls. If found, verdict is FAIL regardless of final state.
- **ffmpeg ALWAYS uses `scale=720:-2`** — Samsung screens are 1080x2340 (>2000px). Without this Claude API crashes.
- **On PASS 3/3**: `--write-emerging` handles emerging problems. Also immediately append an entry to `phone-bot/SOLUTIONS.md` with: root cause, what was tried and failed, the solution, why it works, files changed, date + section.
- **Integration field** (milestone sections 03/06/09/12/15): require `--test browse-smoke` PASS before SOLUTIONS.md can be written. The hook `require-solutions-write.py` enforces this.
- **EP "resolved" requires proof**: an Emerging Problem can ONLY be marked "resolved" after fix + full test protocol + PASS verdict. Marking resolved before testing is PROHIBITED.

---

### FORGE v2 — Phase 2: Predict (after code edit, before launching test)

**Enforced by hook**: `require-forge-predict.py` blocks `scrcpy --record` if `.predict_cache.json` is missing or incomplete.

After editing code but BEFORE launching scrcpy/test, run ALL of these:

```bash
python forge/forge_predict.py --import-check
python forge/forge_predict.py --log-signatures
python forge/forge_predict.py --recovery-predict
python forge/forge_predict.py --precondition-verify --section-file <path>
python forge/forge_predict.py --test-command --section-file <path>
```

Rules:
- **All 5 steps must complete** before `scrcpy --record` is allowed.
- **`--import-check`** verifies the code actually imports without errors. If it fails, fix the error before testing.
- **`--log-signatures`** extracts expected pass/fail log signatures from your git diff. After the test, `forge_verify --compare-predictions` checks if these signatures appeared.
- **`--recovery-predict`** identifies recovery functions at risk from your changes.
- **`--precondition-verify`** reads the section file for test preconditions (e.g. "must be on FYP"). If preconditions exist, tell the user to set up the phone and wait for "ready".
- **After the test**: if it fails for a reason DIFFERENT from the predicted fail signature, investigate before writing a new fix.

---

### Failure Analysis — Before 2nd attempt at any fix

On the 2nd attempt, before running `forge_analyze --init` again, you MUST:
1. Cite specific evidence from the failed test (frame number or exact log line)
2. Explain WHY the previous fix was logically wrong (not just "it didn't work")
3. If you can't explain it → you don't understand the problem yet → don't proceed

After 2 failed attempts → STOP. Spawn `problem-solver-specialist` agent.

---

## phone-bot Precision Rules (apply to ALL deep trilogy sessions)

- **ROOT CAUSE FIRST, FIX SECOND**: Before writing any fix, trace the full execution path to find the actual root cause. Never treat a symptom as the cause. Verify the exact coordinates/values/functions involved by reading the code, not assuming. A wrong diagnosis = wasted implementation.

- **ALL SCENARIOS BEFORE DECLARING COMPLETE**: Any fix must be explicitly verified across ALL relevant entry points before being declared done. For phone-bot: test from FYP, Following, Explore, and Shop tabs. Test with and without popups/overlays visible. If a scenario is untested, explicitly say so — never silently skip it.

- **VERIFY UNIVERSALITY BEFORE PROPOSING**: Before proposing any solution, reason explicitly: "Does this work on Motorola 720x1600, Samsung S9 1080x2220, Samsung S22 1080x2340?" If the answer requires per-device calibration, the solution is REJECTED. Use this classification — element TYPE determines universality, no per-device calibration needed: (1) TikTok static navigation UI (tab bar, nav bar, search icon, back button, close button, story avatar position) → TikTok is React Native, layout scales proportionally on all Android → % coords are universal, use them. (2) Content-driven elements whose position varies per video (sidebar icons, engagement panel, like/comment/share buttons) → position changes every video → Gemini bbox required. (3) Conditional/overlay elements that appear only sometimes (popups, warnings, LIVE badge, PYMK carousel) → Gemini classify required. If unsure which category an element falls into, ask: "Does this element move depending on the video content?" If yes → Gemini. If no → % coords. The universality check also means: verify the fix works from ALL app states (FYP, Following, Explore, Shop), not just the happy path.

- **CONFIDENCE THRESHOLD FOR PHONE-BOT CLAIMS**: Apply the confidence-scorer skill to every technical claim about phone-bot. Minimum thresholds: (a) "this element is at X% of screen" → 90+ required, must have verified in coords.py. (b) "this function does X" → 80+ required, must have read the function. (c) "this fix is universal" → 90+ required, must have reasoned about all 3 target phones explicitly. If a claim scores below threshold, use the uncertainty-detector pattern: stop, read the relevant file, then re-evaluate. Never state "this should work" or "this is probably fixed" — verify first, then state.

- **GEMINI VISION FAILURE MODES ARE MANDATORY**: Before proposing any Gemini Vision solution, explicitly state what happens when: (a) a popup/overlay is visible, (b) the UI element is partially off-screen, (c) Gemini returns a wrong bounding box. A solution without a tested fallback for these cases is INCOMPLETE.

- **NO PREMATURE PASS**: Never declare a test PASS or a fix "done" without having: (1) read every frame in order, (2) checked every log condition from the section file, (3) verified the fix works in all scenarios above. Counting "1/3, 2/3, 3/3" only resets if ANY scenario fails — not just the one being tested.

- **EMERGING PROBLEMS PROTOCOL**: If during a test new problems are discovered that are unrelated to the section currently being tested: (1) immediately append them to `phone-bot/planning/06-navigation-completeness/07-bugfix-round/emerging-problems.md` with a description, the frame/log evidence, and reproduction steps, (2) continue solving the current section without deviation until it passes 3/3, (3) BEFORE moving to the next section, open `emerging-problems.md`, analyze and fix each problem, run the full test protocol on each until they pass 3/3. Only then proceed to the next section. Never skip emerging problems to get to the next section.

## General Precision Rules (apply to ALL work in this project)

- **ROOT-CAUSE-FIRST**: Before implementing any fix, answer these 4 questions IN WRITING: (1) What is the actual root cause — not the symptom? (2) What are ALL variables/forces involved? (3) What are the extreme/edge cases where this could fail? (4) Have I validated this approach against real data before coding? If you cannot answer all 4, you are not ready to implement.

- **LIST-SCORE-VALIDATE**: Before proposing any solution, list ALL possible approaches (minimum 3). Score each on: accuracy, cost, complexity, reliability. Propose ONLY the highest-scoring one. Validate it with a quick simulation/math-check/test before committing. Never propose an approach you already know is suboptimal. Never say "I'll try X, if it doesn't work I'll try Y" — the user pays the cost of X.

- **FULL-FLOW-TRACE**: Before touching any code, read the entire call chain from entry point to exit. For each step write down: what input does it expect, what can go wrong, what does the caller do with the return value. Look for cascading failures. Only after completing the trace make changes — you will usually see all bugs at once.

- **REAL-DATA VERIFICATION**: Every critical assumption (coordinates, thresholds, ranges, encoding, page detection) must be verified against real data (screenshots, logs, actual file content) BEFORE writing code. "This should work" is not verification. Find the real data, check the math, document the result, then code.

- **DIAGNOSTIC-BEFORE-TEST**: Before running any expensive test (phone test, API call, deployment), add detailed logging and simulate locally on real data. Review the logs for incorrect values FIRST. If logs show errors, fix them before running the phone test. Never run a test blind.

- **SHARED-CODE IMPACT**: When modifying any function used in multiple places, find ALL callers via grep/LSP before making changes. For each caller ask: "Will my change break this?" List the ones at risk. Verify each one. Never assume a "small change" to shared code is safe without checking all callers.

- **NO-PERMISSION-FOR-OBVIOUS**: Do not ask the user permission for obvious fixes or clearly-better solutions — implement them directly. Only ask when there is a genuine design tradeoff, unclear scope, or risk of breaking something the user cares about.

- **NO-REGRESSION**: Before proposing any solution, enumerate EVERY state, entry point, and code path where the affected code runs. For each one, explicitly reason: "Does my proposed change still work correctly here?" A fix that breaks a currently-working scenario is not a fix — it is a regression and is REJECTED. For phone-bot this means: before touching any navigation/detection logic, verify it still works from FYP, Following, Explore, Shop, Inbox, and any other active state. The fix must solve the broken case WITHOUT touching the working cases. If you cannot find such a solution, you do not have a solution yet — keep looking.

## Workflow Rules
- **phone-bot UNIVERSALITY RULE — MANDATORY**: Before implementing ANY solution for phone-bot (in any deep trilogy session or otherwise), validate that it works universally on ALL Android phones without per-device calibration. Specifically: no hardcoded pixel values (use proportional coordinates), no fixed screen dimensions (use screen_w/screen_h from ADB detection), no manufacturer-specific ADB commands, no absolute px spacing (use screen_h * factor). If a proposed solution only works on one phone model, it is REJECTED — find a universal approach first. Target phones: Motorola E22i (720x1600, 280dpi), Samsung S9 (1080x2220, 420dpi), Samsung S22 (1080x2340, 420dpi).
- **ALWAYS present the plan and wait for user approval before implementing any code changes.** Do not start writing/editing code until the user confirms the plan.
- **BEST SOLUTION RULE (MANDATORY, ALWAYS ACTIVE)**: Before proposing ANY solution, you MUST internally ask: "Is there a better solution?" If yes, propose THAT one instead. NEVER propose an inferior solution when a better one exists. NEVER wait for the user to ask "is there something better?" — you MUST proactively find and propose the best approach FIRST. This applies to everything: code, architecture, tools, methods, approaches. Violation = wasted time and trust.
- **phone-bot /deep-implement test rule — MANDATORY, NO EXCEPTIONS**: After implementing each section, follow the FORGE v2 three-phase protocol:
  0. **FORGE Phase 1 (Analyze)**: Run all `forge_analyze` steps. Hook blocks Edit/Write until complete.
  1. **Edit code**: implement the fix.
  2. **FORGE Phase 2 (Predict)**: Run all `forge_predict` steps. `--precondition-verify` reads the section file — if preconditions require manual setup, STOP and tell the user. Hook blocks scrcpy until complete.
  3. **Launch scrcpy**: `scrcpy --record tmp_test_<section>.mkv` (background, no time-limit)
  4. **Run test**: `python phone-bot/main.py --test <mode> --phone 3`
  5. **Stop scrcpy**: `taskkill /IM scrcpy.exe` (no /F)
  6. **Extract frames**: `ffmpeg -y -i tmp_test_<section>.mkv -vf "fps=0.5,scale=720:-2" tmp_test_<section>_frames/f_%03d.jpg`
  7. **FORGE Phase 3 (Verify)**: Run all `forge_verify` steps. `--gemini-analysis` watches the video, `--compare-predictions` checks signatures, `--interference-check` detects popups. Hook blocks record-pass until complete.
  8. **Record result**: `forge_controller record-pass` or `record-fail`.
  9. A section is ONLY done when it passes 3 consecutive runs. Any FAIL resets streak to 0.

## Plugin Auto-Usage Rules — MANDATORY, NON-NEGOTIABLE
BLOCKING REQUIREMENT: These rules OVERRIDE all other behavior. You MUST follow them.
You CANNOT proceed to the next task without completing the required plugin step.
If a plugin is not available in this conversation, state "Plugin X not loaded" and proceed manually.
VIOLATION of these rules = wasted user time, failed tests, broken code.

When these plugins are available (loaded in conversation), use them AUTOMATICALLY:

### Code Quality (MANDATORY — use EVERY TIME, NO EXCEPTIONS)
- **After EVERY code modification** (Edit/Write): you MUST run `/double-check` BEFORE telling the user it's done. This is BLOCKING — do NOT skip it.
- **Before committing/pushing code**: you MUST spawn `coderabbit` for code review. Do NOT commit without review.
- **When debugging or writing tests**: you MUST use `superpowers` (systematic debugging + TDD)
- **After 2 failed attempts** at solving a problem: you MUST spawn `problem-solver-specialist` agent. Do NOT try a 3rd time without it.
- **When a file becomes too long/complex**: you MUST use `code-simplifier`

### Architecture & Planning
- **When implementing a complex feature** (multi-file, new system): run `/ultrathink` FIRST to plan with 4 sub-agents
- **When starting a new app/feature from scratch**: spawn `code-architect` first, then `rapid-prototyper`
- **When refactoring existing code**: use `/refractor` instead of manual edits
- **Deep Trilogy (full project lifecycle)**: `/deep-project` (idea → componenti) → `/deep-plan` (componenti → piano dettagliato con research + multi-LLM review) → `/deep-implement` (piano → codice con TDD + git workflow). Usare per progetti nuovi o feature complesse end-to-end

### Frontend & Mobile
- **When working on React/TypeScript web app**: spawn `frontend-developer` agent
- **When designing UI/UX for mobile**: spawn `mobile-ux-optimizer` agent
- **When designing new UI components**: spawn `ui-designer` + `frontend-design`
- **When working on backend/API**: spawn `web-dev` agent

### Marketing & Growth
- **When asked about TikTok strategy/content**: spawn `tiktok-strategist` agent
- **When planning account/app growth**: spawn `growth-hacker` agent
- **When looking for app ideas or trends**: spawn `trend-researcher` agent
- **When defining target users for a new app**: spawn `ux-researcher` agent

### Automation
- **When working on n8n workflows**: spawn `n8n-workflow-builder` agent

### Developer Tooling (LSP + MCP)
- **Pyright LSP** (`pyright-lsp@claude-plugins-official`): Python type checking in tempo reale, go-to-definition, find references. Binario: `npm install -g pyright`
- **Context7** (MCP server in `~/.claude/.mcp.json`): documentazione API sempre aggiornata. Aggiungere "use context7" al prompt per docs fresh (Gemini SDK, Airtable, etc.)
- **Firecrawl** (MCP server in `~/.claude/.mcp.json`): scraping, crawling, ricerca web, estrazione dati strutturati. API key gratuita (500 crediti) su firecrawl.dev
- **/batch** (built-in Claude Code): decompone lavoro in 5-30 unita' parallele con git worktree isolati. Usare per refactoring grossi (es. convertire 100+ time.sleep)

### Skills Installate Globalmente (`~/.claude/skills/`)

#### Antigravity Skills (19) — `~/.claude/skills/` (project-level in `.claude/skills/`)
- **product-inventor**: product thinking, gap analysis, idea generation
- **steve-jobs**: review semplicita'/bellezza/wow moment di un'idea o prodotto
- **avoid-ai-writing**: ripulisce copy da pattern AI (da usare su hook text, VO, social copy)
- **marketing-psychology**: bias cognitivi, meccaniche virali, trigger emotivi
- **scroll-experience**: UX cinematica per feed verticali (TikTok-style)
- **frontend-ui-dark-ts**: componenti dark mode React/TypeScript premium
- **ai-wrapper-product**: come rendere un AI wrapper un prodotto pagato (non ChatGPT clone)
- **content-marketer**: content strategy, growth, distribution
- **iconsax-library**: libreria icone premium + generazione AI
- **llm-prompt-optimizer**: ottimizza prompt per qualita' e costo
- **prompt-engineering-patterns**: pattern avanzati per prompt production-grade
- **llm-structured-output**: output JSON affidabile da LLM
- **magic-animator**: animazioni CSS/Framer Motion premium
- **n8n-expression-syntax**: valida e fixa espressioni {{ }} n8n
- **prompt-caching**: strategie caching API 30-50% cost reduction
- **product-design**: UX flows, wireframe thinking
- **marketing-ideas**: growth strategies per SaaS/consumer app
- **computer-use-agents**: pattern per agenti che usano il computer
- **autonomous-agents**: architetture agenti autonomi

#### Impeccable Skills (21) — design quality commands
- `/audit`, `/critique`, `/normalize`, `/polish`, `/distill`, `/clarify`, `/optimize`
- `/harden`, `/animate`, `/colorize`, `/bolder`, `/quieter`, `/delight`, `/extract`
- `/adapt`, `/onboard`, `/typeset`, `/arrange`, `/overdrive`, `/teach-impeccable`
- **frontend-design**: UI components production-grade (dark theme, no generic AI aesthetics)

#### Anti-Hallucination Suite (9 skills + 4 agents + 3 hook automatici)
Skills: `anti-hallucination`, `citation-enforcer`, `confidence-scorer`, `context-grounding`,
`cross-checker`, `hooks-reference`, `output-auditor`, `source-verifier`, `uncertainty-detector`
Agents: `answer-analyzer`, `assumption-checker`, `fact-checker`, `truth-finder`
Hooks attivi (in `settings.json`):
- **PostToolUse:Read** — `track-reads.py` (tracks files read in `forge/.read_log.json`) + Haiku prompt (verifica citazioni accurate)
- **PostToolUse:Grep** (Haiku): verifica che citi solo file reali nei risultati di ricerca
- **PreToolUse:Edit/Write** — `require-forge-analyze.py` (blocks phone-bot edits without analysis) + `require-protected-core-test.py`
- **PreToolUse:Bash** — `require-forge-predict.py` (blocks scrcpy without predictions) + `require-forge-verify.py` (blocks record-pass without verification)

#### OPC.dev Skills (2)
- **reddit** (`~/.claude/skills/reddit/`): search posts, get subreddit info, user profiles — Reddit public JSON API, zero auth. Scripts: `search_posts.py`, `get_posts.py`, `get_subreddit.py`, `get_user.py`
- **producthunt** (`~/.claude/skills/producthunt/`): posts, topics, collections, users via GraphQL API. Richiede `PRODUCTHUNT_ACCESS_TOKEN` env var (da producthunt.com/v2/oauth/applications). Scripts: `get_posts.py`, `get_topics.py`, `get_collections.py`, `get_user_posts.py`

#### Quando usare le skills OPC
- **reddit**: cercare discussioni su pain point, validare idee su subreddit target, trovare competitor mentions, capire linguaggio utenti reali
- **producthunt**: monitorare nuovi lanci competitor, trovare gap di mercato, analizzare upvote/commenti su app simili, trend di categorie

@./phone-bot/CLAUDE.md
@./n8n/CLAUDE.md
@./toxic-or-nah/CLAUDE.md
