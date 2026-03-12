# Toxic or Nah - Project Memory

## Workflow Rules
- **ALWAYS present the plan and wait for user approval before implementing any code changes.** Do not start writing/editing code until the user confirms the plan.

## Architecture
- React + TypeScript + Vite app for relationship chat analysis
- AI provider: Gemini 2.0 Flash (via `geminiService.ts`)
- Soul Types: 14 male + 16 female defined in `src/data/soulTypes.ts`
- Hybrid matching: AI extracts `observedBehaviors[]` → client matches via `archetypeMatchingService.ts`
- Three-phase analysis: Phase 1 (quick ~5s) → Phase 1.5 (Soul Type personalization micro-call ~2s) → Phase 2 (detailed, background)
- Soul Type card description: Personalized via micro-call AFTER matching (not from main AI analysis)
- DEV mode uses localStorage, production uses Supabase

## Key Files
- `src/data/soulTypes.ts` - Soul Type definitions (keywords, images, traits)
- `src/services/archetypeMatchingService.ts` - Hybrid matching + BEHAVIOR_SYNONYMS map
- `src/services/geminiService.ts` - AI prompts (full + quick + detailed)
- `src/services/analysisService.ts` - Orchestrates analysis flow
- `src/components/DynamicCard.tsx` - "Your Souls Together" flip card
- `src/components/ResultsPage.tsx` - Analysis results display

## Important Patterns
- Soul Type images: male=.mp4 video, female=.png, side profiles always .png
- DynamicCard front: two images with `mix-blend-mode: lighten` on #111111 bg
- DynamicCard back: `filter: blur(35px)` on image container (NOT backdropFilter - doesn't work with mix-blend-mode)
- Glassmorphism layers on Soul Type cards: blur=65% height, dark gradient=55% height
- MessageInsight tags: RED FLAG (#E53935), GREEN FLAG (#43A047), DECODED (#7C4DFF purple)
- DECODED = hidden subtext, double meanings, what he SAID vs what he MEANT. Back side says "What It Really Means"
- DECODED cards use eye icon (front) and eye SVG (back), purple gradient (#2A1A4E → #1A0F33), accent #B39DDB
- Target 3-6 messageInsights per analysis (mix of all 3 tags). Even healthy chats get DECODED insights
- contextValidator Rule 4 preserves both GREEN FLAG and DECODED (only filters RED FLAGs in positive vibes)

## React Native / Android WebView Lessons
- `BlurView` from expo-blur does NOT work on Android — produces gray rectangle artifacts
- CSS `mask-image` / `-webkit-mask-image` does NOT work in Android WebView — makes content invisible
- CSS `filter: blur(35px)` DOES work inside Android WebView (proven on DynamicCard back face, Soul Type card back face)
- WebView transparent background ONLY works for CSS-drawn content (e.g. ToxicOrb gradients), NOT for `<img>` tag content
- For gradient blur fade (sharp→blurred transition): use Canvas API compositing (`globalCompositeOperation: 'destination-in'` with gradient fill) inside WebView — this is the ONLY reliable approach on Android
- WebView with opaque `#111111` background renders reliably; transparent background is unreliable for image content

## Lessons Learned
- `backdropFilter` does NOT work when underlying elements use `mix-blend-mode`; use `filter: blur()` directly on the image container instead
- AI behavioral extraction needs guided vocabulary - without it, Gemini outputs words that don't match any Soul Type keywords, causing 0% confidence fallback
- BEHAVIOR_SYNONYMS map bridges the vocabulary gap between AI output and Soul Type keywords
- User explicitly said background should stay #111111, NOT #000000
- NEVER extract contact names from chat screenshots - only use "Him"/"Her" or user-assigned names
- Gemini vision includes timestamps as part of message text - must strip with regex AND tell extraction prompt to exclude
- messageInsights should ONLY include genuinely noteworthy messages - no "Hi", "Hey", basic greetings
- AI needs explicit examples of what is NOT a red flag (greetings, sarcasm, sexual banter in context)
- Gemini over-dramatizes normal/casual chats - must explicitly tell it that friendly conversations = low toxicity, few messageInsights
- Topic context matters: "I'm bored" about quarantine ≠ "I'm bored" of the relationship. Must instruct AI to distinguish external venting from relationship issues
- All 3 prompt sections (ANALYSIS, QUICK, DETAILED) need consistent rules - easy to fix main prompt but forget the others
- Gemini ignores soft instructions ("Do NOT assume") - must use ABSOLUTE BAN language + inline schema hints + hard code filters as safety net
- "Early Stage" problem: Gemini infers relationship stage from casual chat tone. Fixed with: banned trait list in prompts, inline schema "NEVER Early Stage" hints, hard code filter that replaces stage-related traits/descriptions
- Hard code filters are essential as a safety net: prompt instructions alone are not reliable with Gemini. Always add server-side validation for critical rules
- Soul Type card description should describe WHO the person IS (personality), NOT what happened in the chat. Chat events go in the 5 category cards
- Post-match micro-call pattern: AI can't know Soul Type before matching → do matching first → send Soul Type context to AI → get aligned description. Await with Promise.race timeout (4s) for graceful fallback
- MessageInsight title attribution: Gemini confuses WHO is doing WHAT. E.g., "Cute Confession?" for someone ASKING a question ≠ confessing. Fixed with MESSAGE_ATTRIBUTION_RULES constant: "Ask who sent this message, what is HE doing, does my title describe HIS action?"
- Current Soul Types don't cover all chat dynamics (e.g., playful/teasing user gets "Frozen Bloom"). User acknowledged this needs a future Soul Type expansion (10-20 most frequent dynamics)
- Prompt constants in geminiService.ts: MANDATORY_REASONING_BLOCK, TONE_CALIBRATION, MESSAGE_ATTRIBUTION_RULES - injected into prompts that need them
- Hard-code strip filter for [THEIR MESSAGE] labels needed in BOTH messageInsights.message AND categoryAnalysis.specificExamples
- DECODED "What It Really Means" must decode the EXACT psychological moment (what he's feeling, why THIS response, what it reveals). Vague summaries like "He's catching on to the underlying context" are BAD. Must give a genuine "oh shit" insight. Prompt uses 4-layer analysis framework: what he said → what he's feeling → why this response → what it reveals

## React Native / Mobile Lessons
- Android `aspectRatio` bug: `aspectRatio: 1` WITHOUT explicit `width: '100%'` sizes from content intrinsic height, producing a smaller-than-expected square. Always pair `aspectRatio` with `width: '100%'` on Android
- ScrollView `contentContainerStyle` padding can behave asymmetrically on some Android devices. Safer pattern: use a child `View` with explicit `width` + `alignSelf: 'center'` instead of `paddingHorizontal`
- `useWindowDimensions()` (reactive) is preferred over `Dimensions.get('window')` (static) for layout calculations
- Mobile app services: `analysisService.ts` functions expect `string[]` (URIs), not `ImageFile[]` objects. Use `.map(f => f.uri)`
- NativeWind `@tailwind base` in global.css can cause layout issues on Android — was disabled
- Expo Go ignores `edgeToEdgeEnabled` in app.json

## n8n Content Pipeline
- **Workflow 1**: Scenario Generator (Schedule Trigger, every 10 min — auto-loop with quota check)
- **Workflow 2**: Telegram Callback Handler (always-on, handles Approve/Redo/Skip)
- n8n self-hosted v1.122.5, LLM Chain nodes with Gemini 2.0 Flash (switched from DeepSeek)
- Airtable base: `appsgjIdkpak2kaXq` (ToxicOrNah Content Pipeline)
- Key tables: Video Concepts, Scenarios, Body Clip Templates, Caption Templates, VO Templates, Hook Text Pool, Social Copy Examples
- Code files in `n8n/code/` — update there first, then run `embed-code.cjs` to inject into workflow JSON
- **n8n Code node sandbox lacks global `fetch`** — must add polyfill using `require('https')`/`require('http')`. `require()` works for built-in modules (confirmed: fs, path, child_process, https, http)
- Airtable `list` operation doesn't exist → use `search`
- Airtable linked record fields need array of record IDs: `[concept.id]` not `concept.concept_id`
- Airtable Update node: use Code node before it to filter input to only fields you want to update (avoid `createdTime` and extra fields being sent)
- n8n resourceMapper `matchingColumns` required for Update operation
- Gemini partial message quoting: validate-scenario.js has substring matching + "not found in chat" is non-critical
- VO script sections: LLM uses descriptive names (chat_upload, score_reveal) not body_clip_1 — validation accepts any non-hook/non-outro as body
- n8n Google Gemini node type: `@n8n/n8n-nodes-langchain.lmChatGoogleGemini`, credential type: `googleGeminiApi`
- `extract-deepseek-response.js` is DEPRECATED — LLM Chain node handles response extraction automatically
- Only toxic vibes for video content (most viral) — `pickVibe()` returns 'toxic' always
- Toxic score must ALWAYS be 70+ (overallScore ≤ 30). Hard-code filter in validate-scenario.js caps at 30
- Hook generation: 5 random examples from Airtable + "write entry #6" framing (not all examples, not 1)
- Outro generation: same 5-random approach as hooks
- NEVER use contactName in VOs — only "he"/"him"/"bro" (Ban #10)
- ElevenLabs v3: model_id `eleven_v3`, voice_id `cIZgE1zTtJx92OFuLtNz`, header `xi-api-key`, endpoint `POST /v1/text-to-speech/{voice_id}`, output_format `mp3_44100_128`
- ElevenLabs emotion tags: `[gasps]`, `[sighs]`, `[laughs]`, `[whispers]`, `[sarcastic]`, `[frustrated]`, `[curious]`, `[excited]` — placed before text, stripped for Fish.audio backup
- ElevenLabs speed control: `voice_settings.speed` (1.0 = default)
- "bro" limit: MAX once across all VOs combined (prevents AI-sounding repetition)
- Male texting realism: 30% short (1-4 words), 50% medium (5-15), 20% longer (15-25). NOT all monosyllabic
- Hooks need SPECIFIC viral patterns (WARNING/EXPOSE/SETUP/CALLOUT/CONFESSION), not generic
- Emoji rendering: Twemoji SVGs injected via Puppeteer (replaces Windows/Linux system emojis)
- n8n runs on Hostinger VPS (in Docker). Local Docker is only for Supabase
- Screenshot server: `host.docker.internal:3456` — runs on same machine as n8n Docker
- VO limit: 50 characters max (character-based, not word-based)

## Workflow 3 — Video Pipeline (Modular)
- **Trigger**: Telegram commands: `#body`, `#hook`, `#outro`, `/produce` + Auto Produce Schedule (30 min) + Webhook
- **Modular by concept**: hook_type per concept (manual_clip, ai_image, ai_multi_image, speaking, reaction)
- **Outro Pool**: weighted random selection from enabled options per concept (`outro_pool_json` in Video Concepts)
- **Video Templates**: beat-synced at 120 BPM, segments with fixed durations (Standard 17s, Extended 20s, Snappy 14s, Long 23s)
- **Smart Clip Trimming**: FFprobe duration → speed factor → setpts speed up/down (1.05-1.4x range) or trim/freeze
- **Music**: all tracks 120 BPM, trimmed to template total duration, volume 0.15, fade out last 1s
- **AI image gen**: kie.ai Nano Banana Pro (env frame + girl ref as image_input)
- **AI img2vid**: Sora 2 via APIMart.ai ($0.025/video, 15s, 9:16, 720p). Shotgun retry strategy: dual-model concurrent (`sora-2` + `sora-2-vip`) with escalating backoff (10 rounds, ~8 min max). Replaced Seedance + Kling Avatar V2
- **APIMart.ai API**: async task API. Submit: `POST /v1/videos/generations`, Poll: `GET /v1/tasks/{taskId}`. Key stored as `APIMART_API_KEY` env var
- **APIMart capacity issues**: "所有渠道均已失败" = all channels full. $0.00 charged on failures. Shotgun retry mitigates this
- **Sora 2 trim selection**: 15s video, user picks timestamps for 3s clips, polled via Airtable `hook_vid_approval`
- **VO**: ElevenLabs v3 (primary), Fish.audio s1 (backup) — `TTS_PROVIDER` toggle in code
- **Approvals**: every AI asset → Telegram inline keyboard → Wait node → Workflow 2 callback
- Airtable tables: Video Templates (`tblmyK72H7PlJeskQ`), Music Library (`tblrI9FPHxkfgyrii`)
- Key code files: `parse-video-message.js`, `save-clip.js`, `prepare-production.js`, `generate-hook.js`, `generate-outro.js`, `generate-voiceover.js`, `extract-frame.js`, `img-to-video.js`, `assemble-video.js`, `harden-video.js`, `verify-hardening.js`, `auto-produce.js`, `set-produce-context.js`
- Chat Screenshot concept: hook = manual clip (not Puppeteer), HAS outro (from pool)
- Before After concept: hook = 3 AI images (1s each) OR manual 3s clip
- **Hook types renamed**: `kling_lipsync` → `speaking`, `kling_motion` → `reaction`. Kling no longer used for hooks — all via Sora 2
- **Speaking hooks**: Sora 2 generates the girl SAYING the hook text via prompt (e.g. `A young woman saying: [text] to the camera...`). Video has baked audio — no ElevenLabs or FFmpeg overlay needed
- **Reaction hooks**: Sora 2 generates the girl reacting (no speech). Video is silent — VO still added by generate-voiceover.js
- **Hook Pool**: Airtable `tbl3q91o3l0isSX9w`. One record per 3s clip. Linked to specific scenario via `scenario_id`. `hook_type` = `speaking` (audio baked) or `reaction` (silent)
- **Hook Generation Queue**: Airtable `tblXpyxSLN2vSJ4i3`. Tracks 15s video generation lifecycle. Statuses: `submitted` → `generating` → `completed` → `review_sent` → `clips_preview_sent` → `clips_saved` / `failed`
- **Continuous Hook Generator**: Runs every 2 min via Schedule Trigger. State machine phases: (1) poll kie.ai images, (2) poll Sora 2 videos, (3) REMOVED (was getUpdates, now handled by Unified Pipeline webhook), (4) submit Sora 2 for approved images, (5) send ready images to Telegram for review, (6) deliver ready videos to phone's Telegram chat, (7) submit new kie.ai images. Code: `batch-generate-hooks.js`, workflow: `workflow-hook-batch.json`
- **Multi-provider**: PoYo (active), APIMart (disabled), laozhang (disabled). Generic `PROVIDERS[]` config with submit/poll/parse per provider. Round-robin selection. Enable new provider by flipping `enabled: true`
- **Quota system**: Per-phone quota: `phone.videos_per_day * BUFFER_DAYS(7)`. Smart stop per phone: no API calls when phone's pool full. `MAX_CONCURRENT = 6` simultaneous submissions across all phones. 7 days buffer = 1 week reserve against provider downtime
- **Pool flow**: generate-hook.js checks pool by `scenario_id` → speaking clips: `hookSource='pool'` (audio baked, VO skipped, assemble extracts embedded audio) → reaction clips: `hookSource='pool_reaction'` (silent, VO still generated, assemble overlays VO). Both types: img-to-video.js passthrough, auto-approve
- **Video Concepts checkboxes**: `hook_speaking_enabled` and `hook_reaction_enabled` — controls which hook types the generator processes. Both can be enabled simultaneously
- **PoYo.ai**: alternative Sora 2 provider. API key: `sk-vJqqGNNTcH9g89DnEYum48LHkdR0R6sZ-qQCFoiWzCJQlPmXKtbIdOWiRGnhB-`. Submit: `POST https://api.poyo.ai/api/generate/submit`, Poll: `GET https://api.poyo.ai/api/generate/status/{task_id}`. Models: `sora-2`, `sora-2-private` ($0.07). Auth: `Bearer` token. Response: `data.files[0].file_url` when `status=finished`. URLs valid 24h
- **Availability Monitor**: Airtable `tbluInOlQ1Biyg1CB`. Probes PoYo every 30 min (`sora-2` + `sora-2-private`), records success/failure per model. Daily analysis at 23:30 CET → Telegram summary with best/worst hours. Code: `monitor-availability.js`. Env var: `POYO_API_KEY`
- **Topaz deflicker**: fal.ai Topaz Video Upscaler (`fal-ai/topaz/upscale/video`) applied to each 3s trimmed clip in `process-review.js` before upload to Hook Pool. `upscale_factor: 1` (same res, just deflicker/stabilize/denoise). Cost: $0.01/sec × 3s = $0.03/clip. Graceful fallback: if Topaz fails, raw clip is used. Queue API: submit → poll status → get result
- **Anti-flicker prompt keywords**: Added to `buildSpeakingPrompt()` and `REACTION_MOTION_PROMPTS` in `hook-generator.js`: "consistent lighting, stable exposure, temporal consistency, smooth skin texture, no brightness fluctuation". Reduces Sora 2 flickering at source ~60-70%
- **Multi-Phone System**: Pipeline is phone-aware. Each phone has its own girl, voice, Telegram chat, and hook quota
  - Phones table (`tblCvT47GpZv29jz9`): `telegram_chat_id`, `girl_ref_url`, `elevenlabs_voice_id`, `videos_per_day`, `topic_assemble_id`, `topic_images_videos_id`
  - Hook Pool + Queue: `phone_id` field links clips/jobs to specific phones
  - `prepare-production.js`: Looks up phone by `telegram_chat_id` from chatId, passes `phoneId/phoneName/phoneRecordId/phoneVoiceId/phoneGirlRefUrl` downstream
  - `generate-hook.js`: Prefers `phoneGirlRefUrl` over concept `girlRefUrl`, filters Hook Pool by `phone_id`
  - `generate-outro.js`: Same girl ref override
  - `generate-voiceover.js`: Uses `phoneVoiceId` for ElevenLabs (fallback to hardcoded default)
  - `hook-generator.js`: Loads active phones, round-robin generation per phone, quota per phone, kie.ai uses phone's girl_ref_url
  - Telegram messages in Hook Generator prefixed with "📱 Phone Name" label
- **Content Library** (`tblx1KX7mlTX5QyGb`): `save-to-content-library.js` runs after "Send Final Video" — downloads video from Telegram → uploads to Cloudflare R2 → saves permanent R2 URL + social_caption + phone_id + platform_status_tiktok/ig='pending' to Airtable. ADB software reads from here
- **Cloudflare R2**: Storage for permanent video URLs + girl ref images. Bucket: `toxic-or-nah`, public dev URL: `https://pub-6e119e86bbae4479912db5c9a79d8fed.r2.dev`. Upload via S3 API with AWS Sig V4 (built-in `crypto` module). Env vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`. Girl ref images at `girls/phone-{1,2,3}.jpg`, videos at `videos/{name}_{timestamp}.mp4`
- **URL expiration gotchas**: Telegram file URLs expire after ~1 hour (officially). Airtable attachment URLs expire after ~2 hours. Neither is suitable for permanent storage → use R2
- **Telegram chat structure**: @Prep01_Bot (scenarios, shared), @Ueien_bot (everything else — per-phone supergroups with forum topics). @asdfsfddfdffbot deprecated
  - **SUPERGROUPS (forum topics enabled, 2026-03-09)**:
    - Phone 1: chat_id `-1003628617587`, topic_images_videos=`16`
    - Phone 2: chat_id `-1003822830975`, topic_images_videos=`3`
    - Phone 3: chat_id `-1003808705017`, topic_images_videos=`3`
  - OLD chat IDs (NO LONGER VALID): Phone 1 `-5281394823`, Phone 2 `-5070665033`, Phone 3 `-5005369370`
  - **Forum Topics**: "Assemble" = renamed General topic (NO message_thread_id needed), "Images & Videos" = custom topic (needs message_thread_id)
  - `topic_assemble_id` in Airtable Phones table = EMPTY (General doesn't need thread ID)
  - `topic_images_videos_id` in Airtable Phones table = topic ID per phone (16, 3, 3)
  - Each phone chat receives: hook images → "Images & Videos" topic, VOs/outro/final → "Assemble" (General) topic
  - @Ueien_bot privacy mode DISABLED (required for receiving text messages like timestamps in group chats)
  - **Supergroup gotcha**: enabling forum topics migrates groups to supergroups with NEW chat IDs. Old IDs return "group chat was upgraded to a supergroup chat" with `migrate_to_chat_id`
  - **Bot must be member**: after supergroup migration, bot may lose access — remove and re-add to each group
  - **General topic**: sending without `message_thread_id` goes to General (= Assemble). Sending with `message_thread_id=1` FAILS ("message thread not found")
- **Per-phone delivery**: Hook Generator sends images/videos to `phone.telegram_chat_id` (looked up from Phones table). `tgSendPhoto`/`tgSendVideo`/`tgSendMessage` accept `targetChatId` param, fallback to `HOOK_CHAT`
- **Trim processing**: Handled by `process-hook-trim.js` in Unified Pipeline (NOT in Hook Generator). Looks up phone from chatId → filters queue by `phone_id` → trims → sends clips to same chat → saves to Hook Pool. Triggered via Telegram Trigger webhook (no getUpdates conflict)
- **Scenario Generator auto-loop**: `select-concept.js` has quota logic — loads active phones, calculates `SUM(videos_per_day) * 7 / 2 * 3` scenarios needed, counts available (approved + has `generated_hook_text`), skips if enough. After Send Photo (Telegram) loops back to Get Active Concepts for next scenario. "Should Generate?" IF node gates the flow. Fully automatic — adding a phone increases quota automatically
- **Hook texts from Scenarios table**: `batch-generate-hooks.js` uses `fetchScenarioHookTexts()` to query Scenarios table (`tblcQaMBBPcOAy0NF`) for approved scenarios with `generated_hook_text`, NOT the old Hook Text Pool
- **One-at-a-time video delivery**: `saveToQueue()` saves with `status: 'completed'`, `deliverNextForReview()` checks for active `review_sent` before delivering next. Videos queue up, delivered one at a time for review
- **Auto Produce System** (2026-03-09): Automatic parallel video production for all phones
  - Schedule Trigger (every 30 min) → `auto-produce.js` checks quota per phone → triggers webhook per phone
  - Each webhook call = separate n8n execution = TRUE parallel production (3 phones simultaneously)
  - Quota: `videos_per_day * 7` pending videos per phone. Stops when phone has enough Content Library stock
  - In-progress guard: checks Video Runs table for `status='started'` per phone — won't launch 2nd production for same phone
  - `set-produce-context.js`: merge node that standardizes data from both manual `/produce` and auto webhook paths
  - `prepare-production.js` references `$('Set Produce Context')` (was `$('Parse Message')`)
  - Ack Produce prefixes "🤖 Auto: " for auto-triggered productions
  - Approval gates UNCHANGED — user still approves hook/VO/outro via Telegram inline keyboard
  - Key files: `auto-produce.js`, `set-produce-context.js`
  - Webhook path: `auto-produce` (internal, called from `http://localhost:5678/webhook/auto-produce`)

## n8n Docker/VPS Setup
- VPS: Hostinger, IP `72.62.61.93`, docker-compose at `/docker/n8n/docker-compose.yml`
- Traefik reverse proxy: `/root/docker-compose.yml` (separate compose project)
- n8n sandbox: no global `fetch`, no global `URL` — must polyfill with `require('https')`, `require('http')`, `require('url')`
- `NODE_FUNCTION_ALLOW_BUILTIN=*` env var required to allow `require()` of built-in modules
- Fetch polyfill requires 3 lines: `const _https = require('https'); const _http = require('http'); const { URL } = require('url');`
- Docker volume: `n8n_data` (external, declared with `name: n8n_data`)
- Traefik network: `root_default` — n8n must connect to it via `networks: traefik_net: external: true, name: root_default`
- Required Traefik labels: `traefik.docker.network=root_default` + `traefik.http.services.n8n.loadbalancer.server.port=5678` (needed when container is on multiple networks)
- Unified Pipeline workflow = active workflow combining Workflow 2 + 3 logic

## COMPLETED: Video Assembly Fix (2026-03-09)
- ✅ All 4 bugs fixed and deployed: missing clips → black placeholder, smart trim, amix duration=longest, tpad removed
- ✅ Re-verified working after body clip cleanup (scenario `toxic-sad-happy-girl-1772930496805`)
- Body clip gotcha: Telegram `BQ` file_id = document (duration 0), `BA` = video. Both work with FFmpeg, BA preferred
- Body Clips table: `tblJcmlW99FNxMNXk`. Template needs 5: screenshot(1s), upload_chat(1s), toxic_score(3s), soul_type(3s), deep_dive(3s)
- When uploading body clips via `#body`, send as VIDEO not document to get correct duration

## Video Delivery Bridge (2026-03-09)
- **Location**: `C:\Users\trmlsn\Desktop\Weekly & Daily Plan\delivery\`
- **Purpose**: Bridge between Content Library (Airtable/R2) → physical phones (ADB push)
- **Approach**: Runtime assignment (Approach B) — video assigned when execution script reaches a posting session, NOT pre-assigned in weekly plan
- **Modules**: `config.py`, `content_library.py`, `downloader.py`, `adb_push.py`, `status.py`, `cli.py`
- **Status**: Tested and working — Airtable query ✅, R2 download ✅, ADB push ready (needs phone USB)
- **API**: `from delivery import get_next_video, download_video, push_to_phone, mark_posted`
- **CLI**: `python -m delivery.cli status --phone 2` / `deliver --phone 2 --platform tiktok`
- **Gotchas**: R2 download needs User-Agent header (Python urllib default gets 403). Airtable linked record filter uses `FIND('Phone 2', {content_label})` not record ID
- **Same video** goes to both TikTok + IG on same phone. First platform downloads+pushes, second just posts (file already there)
- **Status tracking**: `platform_status_tiktok` / `platform_status_instagram` = pending → posted / draft / skipped
- **Content Library orphans**: Old records with deleted R2 files return 403 — clean periodically

## Weekly & Daily Plan System
- **Location**: `C:\Users\trmlsn\Desktop\Weekly & Daily Plan\`
- **Python 3.14 package** (`planner/`): generates realistic posting schedules for 6 accounts (3 phones × TikTok + IG)
- **Output**: `output/weekly_plan_YYYY-WNN.json` + `.txt` (human-readable)
- **State**: `state/account_state.json` persists personalities, last rest days, break intervals
- **Delivery bridge**: `delivery/` module (see Video Delivery Bridge section above)
- **Will be integrated** into user's Flask-based automation software (Python 3.12, Appium/ADB, currently Instagram-only, TikTok in progress)
- **CLI**: `python -m planner.main --weekly` (current week) or `--weekly --date 2026-03-02` (specific week)
- **Validation**: `python validate.py` (checks all rules), `python stress_test.py` (20 runs, 100% pass rate)

### Account Setup
- 3 phones, each with TikTok + Instagram account (6 total)
- 1 shared USA Mobile SOCKS5 proxy (`sinister.services:20002`), rotated on phone switch only
- Only 1 account active at a time (proxy rotates when switching phones)
- Phone order randomized daily, both accounts of same phone always consecutive

### Key Rules (17+ total)
- **R2**: 75-95% of normal days have 2 posts (personality-driven). ~2 posts/day/account
- **R3**: 2 sessions/account/day (92%), 1 session (8%). Max 2
- **R4/R5**: Pre-post scroll 6-19min (normal), post-post scroll 6-14min. Short/long outliers per personality
- **R6**: Time slots with weighted engagement (Evening/Night Peak = weight 3, highest)
- **R7**: 1 rest day/week (84-95% prob) — sessions but NO posts
- **R8**: 1 one-post day/week (only 1 post instead of 2). Never same as rest day
- **R9**: Rest and one-post days rotate weekdays each week
- **R10**: Every 7-15 days, 1 account takes 2 consecutive days completely OFF
- **R12**: 5-10% of sessions aborted (<2 min, no post). If post was scheduled, reschedule
- **R13**: 3-7% weekly: extended session 25-40 min (user gets lost scrolling)
- **R14**: Post errors: 2-5% saved as DRAFT, 1-3% SKIPPED (changed mind). Vary by personality
- **R15**: ≥2 phones active daily (ensures proxy rotation)
- **R16**: Dynamic personalities per account (refresh every 7-14 days, 70% new + 30% old blend)
- **R17**: 1-5 min gap same-phone sessions, 0-30 min gap different-phone sessions

### Session JSON Structure (what the execution script reads)
```json
{
  "account": "ph2_tiktok",
  "phone": 2,
  "platform": "tiktok",
  "start_time": "19:45",
  "end_time": "20:11",
  "time_slot": "Evening",
  "session_number": 1,
  "type": "normal",
  "post_scheduled": true,
  "post_outcome": "posted",
  "pre_activity_minutes": 15,
  "post_activity_minutes": 10,
  "total_duration_minutes": 26,
  "proxy_rotation_before": false
}
```
- **type**: `normal` | `aborted` | `extended` | `rest_only`
- **post_outcome**: `posted` | `draft` | `skipped` | `null`
- **proxy_rotation_before**: true = call rotation API before this session

### Execution Flow (how the automation software should use it)
```
1. Load weekly plan JSON → filter today's sessions
2. For each session (at start_time):
   a. If proxy_rotation_before: call proxy rotation API, wait 2-3s
   b. Open app (platform on phone) via ADB
   c. If type == "aborted": close app after 1-2 min, skip to next
   d. Scroll for pre_activity_minutes
   e. If post_scheduled && post_outcome == "posted":
      → delivery.get_next_video(phone_id, platform)
      → delivery.download_video() + delivery.push_to_phone()
      → Post video with caption from video["caption"]
      → delivery.mark_posted(record_id, platform)
   f. If post_outcome == "draft": open post screen → save as draft
   g. If post_outcome == "skipped": open post screen → go back
   h. Scroll for post_activity_minutes
   i. Close app
3. Same video goes to both TikTok + IG on same phone
   → First platform: download + push + post + mark_posted("tiktok")
   → Second platform: video already on phone → post + mark_posted("instagram")
```

### Key Files
- `planner/config.py` — accounts, proxy, time slots, rule parameters
- `planner/scheduler.py` — core scheduling orchestration
- `planner/rules_engine.py` — 17 rules implementations
- `planner/personality.py` — dynamic personality evolution (Rule 16)
- `planner/models.py` — Session, DailyPlan, WeeklyPlan dataclasses
- `planner/formatter.py` — JSON + TXT output
- `delivery/` — Video Delivery Bridge (see above)

## COMPLETED: Auto-Produce + Forum Topics + Multi-Phone Fixes (2026-03-09)

### Stato: FUNZIONANTE
- Auto-produce triggera 3 phone in parallelo con scenari DIVERSI
- Ogni phone usa la propria ragazza (girl_ref_url), voce (voice_id), hook pool
- VO, hook, outro arrivano tutti su Assemble topic per ogni phone
- Hook Pool filtrato strict per phone_id (no cross-phone fallback)
- Speaking outro usa durata naturale Kling Avatar V2 (no hard trim 3s)

### Problemi risolti (2026-03-09, sessione completa):
1. **Webhook 404**: auto-produce POST ma webhook accettava solo GET → aggiunto `httpMethod: POST`
2. **$('Parse Message') not executed**: auto-produce path bypassa Parse Message → cambiato a `$('Set Produce Context')`
3. **Supergroup migration**: abilitare forum topics cambia chat_id → aggiornati tutti gli ID in Airtable
4. **Bot non vedeva supergroup**: rimosso e riaggiunto @Ueien_bot a Phone 2 e 3
5. **message_thread_id=1 invalido**: General topic non usa thread ID → svuotato `topic_assemble_id`
6. **Smart quotes SyntaxError**: `""''` nei file JS → sostituite con `""''` ASCII (899 occorrenze)
7. **Unicode arrows/box chars**: `->`, `--`, `+` nei commenti → sostituiti con ASCII
8. **Generate VO broken string**: `' ' '` → `' -> '` dopo rimozione freccia
9. **Stesso scenario per tutti i phone**: Airtable read-after-write consistency lag → pre-load ALL ready scenarios in array locale, assegnamento via index (no re-query)
10. **Airtable 422 UNKNOWN_FIELD_NAME**: `fields[]` con comma-separated values non supportato → rimosso parametro
11. **Hook pool cross-phone fallback**: Phone 1 (zero pool clips) prendeva clip di Phone 2 via fallback senza phone_id → rimossi fallback queries senza phone_id in `checkHookPool()`
12. **extractHookLastFrame() non trovava video per fresh hooks**: `$('Generate Hook')` ha solo `hookImage` per fresh hooks, `hookVideo` è su `$('Img2Vid Hook')` → aggiunto fallback a Img2Vid Hook
13. **Hook image/video su topic sbagliato**: Send Hook Preview e Send Hook Video Preview usavano `topicImagesVideosId` → cambiato a `topicAssembleId` (tutto il flusso /produce va su Assemble)
14. **VO callback race condition**: click rapidi su Approve perdevano segmenti (read-modify-write concurrent sovrascriveva) → retry loop con verify dopo PATCH
15. **Speaking outro trimmata a 3s**: `hasBakedOutroAudio` path faceva `trim=0:3.000` → ora usa durata naturale con cap a outroTarget+1.5s

### File chiave modificati:
- `n8n/code/auto-produce.js` — pre-load scenari in array locale, webhook per phone
- `n8n/code/generate-hook.js` — strict phone_id filtering in checkHookPool(), pool message routing
- `n8n/code/generate-outro.js` — extractHookLastFrame() fallback a Img2Vid Hook
- `n8n/code/generate-voiceover.js` — syntax fix (4 broken console.log lines)
- `n8n/code/assemble-video.js` — speaking outro natural duration, syntax fix
- `n8n/code/telegram-callback-handler.js` — VO callback race-condition-safe retry, withTopic() helper
- `n8n/code/handle-done.js` — phone lookup per topic_assemble_id
- `n8n/code/set-produce-context.js` — merge node per manual/auto paths
- `n8n/code/send-vo-segments.js` — topicAssembleId per VO messages
- `n8n/unified-pipeline-fixed.json` — all above embedded + topic routing fixes
- TUTTI i file in `n8n/code/` — encoding fix (smart quotes, Unicode)

### Encoding gotcha IMPORTANTE:
- I file JS in `n8n/code/` erano pieni di **smart quotes** (`""`) e **Unicode chars** (`->`, `--`, box drawing `+===+`)
- Questi funzionano in VS Code ma ROMPONO il JavaScript engine di n8n (Code node sandbox)
- **MAI** usare caratteri non-ASCII nel codice JS per n8n. Solo ASCII puro
- Script di pulizia: `n8n/fix_encoding.py` — rimuove tutti i non-ASCII problematici
- Se un file viene editato e reintroduce smart quotes, rieseguire: `python3 n8n/fix_encoding.py && node n8n/embed-code.cjs`

### Key gotchas da ricordare:
- **Airtable read-after-write**: PATCH poi GET immediato può tornare dati vecchi. Pre-caricare e usare array locale
- **n8n binary propagation**: `$('Generate Hook').binary.hookVideo` esiste solo per POOL hooks. Per fresh hooks il video è su `$('Img2Vid Hook').binary.hookVideo`
- **Telegram forum topic routing**: tutto il flusso `/produce` va su Assemble (General, no message_thread_id). "Images & Videos" topic è solo per Batch Hook Generator
- **Hook Pool**: phone-1 e phone-3 hanno ZERO clip. Generano fresh hook on-demand. Solo phone-2 ha clip nel pool
- **VO concurrent callbacks**: Airtable vo_segments_json è un JSON blob — concurrent PATCH sovrascrive. Il retry-verify loop risolve

### TODO futuro:
1. **Batch Hook Generator**: generare clip pool per phone-1 e phone-3 (import `workflow-hook-batch.json` su n8n)
2. **ADB serials**: Configure `ADB_SERIAL_PHONE1/2/3` env vars per delivery bridge — trovare con `adb devices` quando colleghi i telefoni via USB
3. **WisGate provider**: Integrate as fallback in sora2Race() if needed

## COMPLETED: Delivery Module + Anti-Detection Hardening (2026-03-09 sera)

### Delivery Module (`Weekly & Daily Plan/delivery/`)
Creato modulo Python per bridge Content Library → telefoni fisici. **Testato e funzionante** con Airtable reale.

**File creati:**
- `__init__.py` — exports: `get_next_video`, `download_video`, `push_to_phone`, `mark_posted/draft/skipped`
- `config.py` — Airtable token (hardcoded default), R2 URL, ADB serials (env vars), phone labels, path `/sdcard/DCIM/Camera`
- `content_library.py` — query Airtable con `FIND('Phone N', {content_label})` + `platform_status_{platform}='pending'`
- `downloader.py` — R2 download con User-Agent header (urllib default gets 403)
- `adb_push.py` — `adb -s {serial} push`, Samsung filename `VID_YYYYMMDD_HHMMSS_NNN.mp4`
- `status.py` — PATCH `platform_status_{platform}` = posted/draft/skipped
- `cli.py` — `python -m delivery.cli status --phone 2` / `deliver --phone 2 --platform tiktok`

**Content Library stock attuale:** Phone 1: 1 video, Phone 2: 5 video, Phone 3: 3 video

**Gotcha Airtable API:**
- `fields[]` come parametro urlencode causa 422 — rimuoverlo
- `sort[0][field]` come parametro urlencode causa 422 — rimuoverlo
- Formula: `AND(FIND('Phone 1', {content_label}), {platform_status_tiktok}='pending')` funziona

### Anti-Detection Video Hardening (3-node pipeline, 2026-03-10)
Sistema completo anti-fingerprint. Pipeline: `assemble-video.js` → `harden-video.js` → `verify-hardening.js`

**Architettura a 3 nodi:**
1. **assemble-video.js** — encoding con `-flags +bitexact` (previene Lavc version string in AAC fill elements)
2. **harden-video.js** — 3-pass post-processing (SEI strip → container clean → binary patch)
3. **verify-hardening.js** — 15-check verification engine con auto-retry

**harden-video.js — 3 pass:**
- **Pass A**: `filter_units=remove_types=6` — strip SEI NAL units (x264 encoder info embedded nel bitstream H.264)
- **Pass B**: `-c copy -map_metadata -1 -fflags +bitexact -brand isom -use_editlist 0 -movflags +faststart` + handler_name + creation_time
  - `-use_editlist 0`: previene edts/elst atoms (fingerprint FFmpeg-unique, DFRWS 2014 forensic paper)
  - `-fflags +bitexact`: previene Lavf version in (C)too atom
  - `-brand isom`: ftyp major_brand neutro (non mp42)
- **Pass C**: Binary patch ftyp `minor_version` da 512 (default FFmpeg) a 0 — 4 bytes a offset 12

**verify-hardening.js — 15 check (era 13):**
- L1: ftyp brand=isom, **minor_version=0** (NEW), **no edts atoms** (NEW), no Lavf/(C)too, handler names, creation_time
- L2: Full mdat scan in **256KB overlapping chunks** (era solo primi 64KB) — cerca x264/Lavc/libx264/FFmpeg/Lavf
- L3: moov ordering
- Auto-retry con `retryHarden()` se check falliscono (include `-use_editlist 0` + minor_version patch)

**Fingerprint FFmpeg identificati e fixati (55 totali, ~15 actionable):**

| Fingerprint | Fix | Dove |
|-------------|-----|------|
| x264 SEI NAL units | `filter_units=remove_types=6` | harden Pass A |
| Lavf muxer string in (C)too | `-fflags +bitexact` | harden Pass B |
| Container metadata (udta, ilst) | `-map_metadata -1` | harden Pass B |
| edts/elst atoms | `-use_editlist 0` | harden Pass B |
| ftyp minor_version=512 | Binary patch offset 12 → 0 | harden Pass C |
| AAC fill element encoder string | `-flags +bitexact` | assemble-video.js (encoding time) |
| handler_name=Lavf/Apple | Explicit VideoHandler/SoundHandler | harden Pass B |
| Audio mono 44100Hz | `-ar 48000 -ac 2` | assemble-video.js |
| Telegram fileName | `VID_YYYYMMDD_HHMMSS.mp4` | assemble-video.js |

**IMPORTANTE**: `-flags +bitexact` DEVE essere presente durante l'encoding in assemble-video.js (gia su linee 610, 655, 681). Il hardening post-processo NON puo rimuovere stringhe embed nell'audio AAC — solo il flag durante encoding le previene.

**Research findings (2026-03-10):**
- TikTok e Instagram ri-encodano OGNI video uploadato — container metadata originali vengono distrutti
- Zero casi documentati di shadowban causato da fingerprint FFmpeg
- CapCut mimicry puo essere controproducente — TikTok flagga metadata CapCut negativamente ("not original to platform")
- Approccio migliore: metadata neutri/puliti, non imitazione di app specifiche
- `-brand isom` (neutro) preferito a `-brand mp42` (CapCut-specific)

**Key files:**
- `n8n/code/harden-video.js` — 3-pass hardening
- `n8n/code/verify-hardening.js` — 15-check verification + auto-retry
- `deep_forensic_analysis.cjs` — 20+ check diagnostic tool (locale, non in pipeline)
- `test_full_hardening.cjs` — test script locale per verifica

### Anti-Detection Delivery (adb_push.py + config.py)
- File naming Samsung: `VID_YYYYMMDD_HHMMSS_NNN.mp4`
- Upload path: `/sdcard/DCIM/Camera/` (non path custom)
- ADB serials da env vars (non ancora configurati — servono telefoni fisici)

### Telefoni reali (specs per metadata/naming):
- **Phone 1**: Samsung Galaxy S9+ — SM-G965F — Android 10
- **Phone 2**: Samsung Galaxy S22 — SM-S901B/DS — Android 16
- **Phone 3**: Samsung Galaxy S9 — SM-G960F — Android 10

### Rischi reali vs teorici (analisi finale):
**Rischi REALI di ban/shadowban:**
1. **Appium detection** (ALTISSIMO) — TikTok rileva UiAutomator2, touch precision, accessibility services. QUESTO e il rischio #1
2. **Account nuovi che postano 2/day subito** — serve rampa graduale (settimana 1 = solo scroll, settimana 2 = 1/day, settimana 3+ = 2/day)
3. **Nessuna interazione organica** — account che solo postano e mai likano/commentano = bot

**Rischi IRRILEVANTI (fixati comunque per completezza):**
- FFmpeg residui: CapCut usa FFmpeg+libx264 internamente, stessi residui
- x264 SEI string: TikTok ri-encoda ogni video, il bitstream originale viene distrutto
- Encoding parameters (CRF, preset): le piattaforme non li controllano
- ElevenLabs watermark: nessun fix pratico, il re-encoding AAC lo degrada parzialmente

### Automation Software (altra chat Claude Code):
- In sviluppo separatamente — Flask/Appium/ADB per TikTok e Instagram
- Usa il delivery module (`from delivery import get_next_video, download_video, push_to_phone, mark_posted`)
- Legge weekly plan JSON per scheduling sessioni
- **CRITICO**: deve implementare anti-Appium detection (randomizzare touch, hide instrumentation, pause naturali)

### PROSSIMI STEP (da dove continuare):
1. **Re-importare `unified-pipeline-fixed.json`** su n8n VPS — contiene TUTTI i fix (encoding, anti-detection, 3-pass hardening, 15-check verify, VO race condition, speaking outro, extractHookLastFrame, topic routing, stereo 48kHz, metadata clean)
2. **Disattivare e riattivare** il workflow (registra webhook Telegram)
3. **Pulire Video Runs** con `status='started'` (Airtable MCP: `list_records` con `filterByFormula: {status}='started'` sulla tabella Video Runs, poi `update_records` con `status='cancelled'`)
4. **Testare auto-produce** — verificare che i video finali passino tutti 15 check di verify-hardening:
   - ftyp brand=isom, minor_version=0, no edts atoms
   - Zero stringhe x264/Lavc/FFmpeg nel mdat (full scan)
   - Audio stereo 48kHz
   - fileName pulito su Telegram (`VID_...mp4`)
5. **Importare `workflow-hook-batch.json`** su n8n per generare hook pool per Phone 1 e 3
6. **Continuare automation software** (altra chat) — integrazione delivery module, anti-Appium

### Preferenze utente:
- **SEMPRE pulire Video Runs** con `status='started'` prima di ritestare, senza chiedere
- **MAI usare CLI** per importare workflow — l'utente importa manualmente dalla UI di n8n
- **MAI pushare su remote** senza chiedere

## Phone-Bot Anti-Detection Rewrite (phone-bot/)

### Cos'e il phone-bot
Software Python che automatizza TikTok + Instagram su telefoni fisici Samsung via ADB.
Simula comportamento umano: scroll, like, comment, follow, post video.

### Piano di riscrittura anti-detection
Piano completo in `C:\Users\trmlsn\.claude\plans\wondrous-watching-stallman.md` (5 fasi).

### Stato completamento (aggiornato 2026-03-10):

**FASE 1 — Eliminare comandi ADB rilevabili: COMPLETATA**
- 1A: Rimosso `uiautomator dump` (rilevabile). Creato `core/coords.py` con mappe coordinate normalizzate. Tutti gli elementi UI trovati via coordinate + Gemini Vision per casi dinamici
- 1B: Sostituito `monkey -p` con `am start -n` (APP_ACTIVITIES in config.py)
- 1C: `close_app_natural()` = Home → Recent Apps → swipe up. `_force_stop()` solo come fallback privato

**FASE 2 — Human Behavior Engine: IN CORSO**

Completato:
- **Log-normal timing**: TUTTE le chiamate `random.uniform(X, Y)` per timing convertite in distribuzioni log-normal via `_timing()` / `human.timing()`. 29 parametri timing in `config.py` come tuple `(mediana, sigma, min, max)`. Distribuzioni pesanti = la maggior parte dei valori vicino alla mediana, pause lunghe occasionali = umano
- **14 micro-comportamenti**: tutti implementati (zona morta, errori digitazione, pausa post-like, peek scroll, re-watch, primo video lungo, speed ramp, micro-scroll, doppia apertura commenti, tempo reazione caricamento, background a fine sessione, like burst, azione correlata post-like, fasi sessione)
- **Session Flow Phases**: 5 fasi (Arrival -> Warmup -> Peak -> Fatigue -> Exit) in `config.SESSION_PHASES`, gestite da `SessionPhaseTracker` in `human.py`
- **`verify_email` rimosso**: l'utente verifica email manualmente, rimosso da warmup.py (6 punti) + executor.py (2 punti)

COMPLETATO (2026-03-10, sessione serale):
- **Per-account Personality System**: 7 tratti comportamentali unici per account (reels_preference, story_affinity, double_tap_habit, explore_curiosity, boredom_rate, boredom_relief, switch_threshold). Persistiti in JSON, evolvono ~1.5% per sessione basandosi sul comportamento reale. Dopo ~60 sessioni (~1 mese) ogni account ha abitudini visibilmente diverse
- **BoredomTracker**: Float 0.0-1.0 che sale con scroll passivo (contenuto fuori nicchia = +30% noia), scende con engagement (like/comment/follow). Quando supera switch_threshold della personalita' -> trigger cambio Feed/Reels. Influenza anche pick_action() (piu' noia = piu' search/explore)
- **Niche keywords per sessione**: executor.py ora campiona 6-10 keyword random dal pool di 21 per ogni sessione, cosi' ogni account cerca cose diverse
- **11 magic numbers eliminati**: tutte le probabilita' hardcoded in browse_session() (double_tap 0.6/0.5, stories 0.25/0.30, feed/reels switch ogni 20 azioni, health check ogni 15, ecc.) sostituite con tratti personalita' o decisioni boredom-driven

COMPLETATO (2026-03-11, sessione odierna):

**Swipe humanization rewrite** — `humanize_swipe()` riscritto da zero con fisica del pollice:
- **Swipe habit per sessione**: handedness (75% destro), grip_offset (25-50px da centro), arc_inward (12-28px), speed_mult, noise_level — persistenti per tutta la sessione come "memoria muscolare"
- **Grip shift**: ogni 12-30 swipe il grip si sposta leggermente (aggiusti la mano)
- **Continuita' temporale**: ogni swipe ha durata simile al precedente (blend 60% vecchio + 40% nuovo), NON randomizzato da zero ogni volta
- **Continuita' posizione**: start Y blendato col precedente (30% vecchio + 70% nuovo)
- **Arco del pollice**: il pollice curva VERSO IL CENTRO durante lo swipe su (verso destra se mancino, verso sinistra se destro). L'ampiezza varia per-swipe con gaussiana
- **Fatica progressiva**: ogni swipe diventa ~5% piu' lento e ~5% piu' basso con la fatica
- **Outlier rari (~3%)**: a volte uno swipe e' un po' off (non wildamente diverso, solo +-15-25% dalla media)
- **Singolo comando ADB**: `adb.swipe()` ora usa UN SOLO `input swipe` (era due segmenti che causavano double-skip su Motorola 720x1600)

**Search explore session** — `search_explore_session()` (NUOVO) per TikTok e Instagram:
- Prima: `search_hashtag()` cercava 1 keyword, aspettava 7s ferma, tornava alla FYP. Zero interazione con risultati
- Ora: cerca una keyword -> scrolla griglia risultati -> apre video -> guarda -> decide se likare/visitare profilo/cercare altra keyword -> esce
- TUTTE le decisioni guidate da stato (curiosity, boredom, energy, patience, videos_watched, found_interesting) — ZERO probabilita' fisse
- Formule chiave:
  - `browse_drive = curiosity*5 + boredom*3 + energy*0.5` (quanti risultati sfogliare)
  - `like_drive = energy*0.15 + videos_watched*0.04 + boredom*0.06` (se likare)
  - `profile_drive = curiosity*1.5 + videos_watched*0.03 + boredom*0.08` (se visitare profilo)
  - `second_drive = curiosity*2.5 + boredom*0.4 + patience*0.05` (se cercare seconda keyword)
- Coordinate griglia: TikTok 4 slot (2 colonne), Instagram 6 slot (3 colonne) — in `coords.py`
- Metodi helper: `_type_search_query()`, `_clear_and_retype()` (cancella barra search e riscrive)
- `browse_session()` aggiornato: usa `search_explore_session()` poi torna alla FYP

**Dynamic probabilities** — TUTTE le probabilita' dei micro-comportamenti ora dipendono dallo stato:
- `should_peek_scroll()`: patience * (1 - fatigue*0.5) — paziente e riposato = piu' peek
- `should_rewatch()`: patience * (1 - fatigue*0.6) * (1 - boredom*0.5) — paziente + non annoiato + riposato
- `should_micro_scroll()`: (1 + fatigue*0.6) * (1 + boredom*0.3) — stanco/annoiato = piu' scroll imprecisi
- `should_double_open_comments()`: social * (1 + fatigue*0.4) — sociale + stanco = fumble
- `should_end_in_background()`: (1 + fatigue*2.5) * (1.5 - energy) — stanchissimo = si addormenta col telefono

**Typing rhythm system** — `typing_delay()` e `type_with_errors()` riscritti:
- Ogni testo riceve un RITMO casuale scelto in base allo stato:
  - **confident**: veloce e costante, pochi errori. Favorito con alta energia + bassa stanchezza
  - **composing**: irregolare, pause random sparse. Favorito con bassa energia + alta stanchezza
  - **rush**: accelera verso la fine, +25% errori. Favorito con alta noia + poca pazienza
  - **careful**: lento e regolare, -40% errori. Favorito con alta pazienza
- Scelta ritmo con pesi dinamici: `w_confident = 1+energy*1.5-fatigue*0.5`, ecc.
- Delay per-carattere influenzato da: ritmo, posizione nel testo, se dopo spazio, se lettera agli angoli tastiera (q,z,p,x,m,k,w)
- Pause "thinking" a posizioni PRE-GENERATE random (non 8% fisso ovunque): composing = 1-N random, careful = intervalli semi-regolari con jitter, confident/rush = quasi mai
- Due messaggi scritti di fila possono avere ritmi diversi

**Test mode** — `TEST_MODE` flag in config.py:
- `PHONEBOT_TEST=1` env var (default on)
- Skip proxy (usa WiFi locale), timezone Europe/Rome, verbose logging
- `--scroll-only --phone 4` in main.py: scroll passivo 5 min senza engagement per test
- executor.py: skip proxy connect/disconnect in test mode

GIA' FIXATI (verificato 2026-03-10):
- **`close_app_natural()`**: USA GIA' `_hw_delay()` log-normal, NON delay fissi
- **Avatar hack**: USA GIA' `get_coord("instagram", "avatar_reel")` da coords.py, NON il calcolo 9%
- **Gemini retry**: HA GIA' 2 tentativi con 3s pausa
- **Niche keywords**: ORA passate anche a sessioni regolari (vedi sopra)

DA FARE (phone-bot):
- **~100+ `time.sleep(N)` con numeri letterali**: il buco piu grande rimasto. Sparsi in tiktok.py (~40), instagram.py (~40), adb.py (~5), proxy.py (~3). DEVONO essere convertiti in `time.sleep(self.human.timing("param_name"))`
- **Proxy credentials in chiaro**: config.py ha username/password — spostare in env vars
- **Scan for remaining fixed probabilities**: cercare `random.random() < 0.` nel codebase per eventuali probabilita' fisse rimaste

**FASE 3 — Proxy: NESSUNA MODIFICA NECESSARIA** (proxy mobile SOCKS5 USA = IP residenziale)

**FASE 4 — Fix Upload Flow: COMPLETATA** (sessione precedente)
- Path media: `/sdcard/Download/video_NNNN.mp4` (non Camera)
- Search keywords: niche keywords dal config

**FASE 5 — Warmup: COMPLETATA**
- Durata 5-8 giorni randomizzata per account
- Zero likes giorni 1-2 (regola assoluta)
- Dead days (1-2, niente app) + lazy days (scroll breve, zero engagement)
- Engagement non-monotonico (alcuni giorni meno del precedente)
- Profile pic/bio su giorni random diversi per account
- Ogni account schedule DIVERSO
- Camera overlay trick per primo post TikTok

### File principali phone-bot:
```
phone-bot/
  config.py           — Config centrale (29 timing params log-normal, phones, accounts, proxy, TEST_MODE)
  main.py             — Entry point (--test, --warmup, --scroll-only --phone N)
  TEST-LOG.md         — Log di tutti i cambiamenti con spiegazioni dettagliate
  core/
    adb.py            — Comandi ADB (tap, single-swipe, open/close app, screenshot)
    coords.py         — Mappe coordinate UI per TikTok + Instagram (+ search grid + search_clear)
    human.py          — Engine comportamento umano (timing log-normal, 14 micro-behaviors, 5 fasi sessione, swipe habit, typing rhythm)
    gemini.py         — Gemini Vision API per analisi UI dinamica
    proxy.py          — Rotazione proxy SOCKS5
  actions/
    tiktok.py         — Automazione TikTok (browse, search_explore_session, like, comment, follow, post)
    instagram.py      — Automazione Instagram (stessa struttura + search_explore_session)
  planner/
    executor.py       — Esecuzione sessioni (warmup + regolari, skip proxy in TEST_MODE)
    warmup.py         — Generazione piano warmup (5-8 giorni rampa graduale)
```

### Architettura timing:
```
config.py HUMAN dict
  27 tuple: (median, sigma, min, max)
    → core/human.py: _timing(name) → _lognormal(median, sigma, min, max)
        → HumanEngine.timing(name) — API pubblica
        → 12 metodi interni (action_delay, watch_duration, etc.)
    → actions/tiktok.py: self.human.timing("t_app_load") etc.
    → actions/instagram.py: stesso pattern
    → planner/executor.py: human.timing("t_session_gap") etc.
```

### Come fixare i `time.sleep(N)` rimanenti:
1. Leggere ogni file (tiktok.py, instagram.py, adb.py, proxy.py)
2. Per ogni `time.sleep(numero_letterale)`, determinare COSA sta aspettando
3. Mapparlo a un param timing esistente O crearne uno nuovo in config.HUMAN
4. Sostituire con `time.sleep(self.human.timing("param_name"))`
5. Per adb.py: la classe ADB non ha accesso a HumanEngine — passarlo come argomento O aggiungere metodo `_delay()` diretto
6. Ogni nuovo param: tuple `(mediana, sigma, min, max)`, mediana vicina al numero originale
7. Sleep molto corti (< 0.1s) per sincronizzazione ADB possono restare fissi
8. Verifica finale: `grep -rn "time.sleep(" phone-bot/` = ZERO numeri letterali

## iOS App Build (2026-03-11) — IN CORSO

### Contesto
L'utente deve distribuire l'app su App Store (non solo body clips).
L'app Android esiste gia' (Capacitor WebView). Serve la versione iOS identica e funzionante.
L'utente NON ha un Mac — usa MacInCloud (Mac remoto via RDP).

### Architettura App
- **Capacitor** wrappa la web app (React + Vite) in gusci nativi Android/iOS
- Stessa codebase web per entrambe le piattaforme
- `npm run build` → `dist/` → `npx cap copy ios` → Xcode build
- Il progetto iOS esiste gia' in `ios/App/`

### Cosa e' stato fatto (2026-03-10 sera):
1. **capacitor.config.ts**: aggiunto config iOS (backgroundColor #111111, contentInset, preferredContentMode)
2. **Info.plist**: registrato URL scheme `toxicornah://`, bloccato orientamento a solo Portrait
3. **AppDelegate.swift**: aggiunto handler deep link per iOS — estrae `sid` da URL `toxicornah://results?sid=UUID`, inietta nel WebView via JavaScript
4. **Web app buildata e pushata** su GitHub (`github.com/Raffito0/ToxicorNah`, branch main)

### Cosa e' stato fatto (2026-03-11) — SESSIONE MACINCLOUD:
1. **Setup Mac**: scaricato ZIP da GitHub (git clone non funzionava per config SSH), escluso `public/` per spazio disco
2. **Creato .env** sul Mac con VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + VITE_GEMINI_API_KEY
3. **App avviata nel simulatore iPhone 17 Pro** — funzionante al 100%
4. **UploadPage fixes**:
   - Rimossi `Friend` e `Family Member` dalla lista relationship (restano: Crush, Boyfriend/Girlfriend, Ex, Situationship)
   - Aggiunto bottone **ADD** dopo i relationship tag
   - `createNewPerson()` ora ha fallback a **localStorage** se Supabase fallisce
   - Aggiunto upload foto avatar nel form con cerchio cliccabile (+)
   - Scroll fix: `h-screen overflow-hidden` → `min-h-screen overflow-y-auto`
5. **ResultsPage fix**: hero section (avatar + background image) nascosta per first-time users (quando personName e' "Him" o "Unknown")
6. **AvatarCropModal**: nuovo componente `src/components/AvatarCropModal.tsx`
   - Crop circolare con drag (pointer events) e zoom (scroll + pinch)
   - Clamping corretto: immagine non puo' mai mostrare sfondo nero
   - Fix landscape: usa `Math.max(CIRCLE_SIZE/w, CIRCLE_SIZE/h)` per scala iniziale
   - `stateRef` per evitare stale closures negli event handler
   - Glassmorphism backdrop (blur 18px + dark overlay)
   - Popup `#111111` uniforme, bordo sottile, shadow profonda
   - Animazione spring all'apertura
   - Scroll della pagina bloccato mentre il modal e' aperto
   - Canvas API esporta area circolare come JPEG dataURL
7. **Tutto pushato** su GitHub (commit `1daf199`)

### MacInCloud — Istruzioni Setup (per la prossima sessione)
**IMPORTANTE**: il Mac NON ha git configurato. Ogni volta scaricare lo ZIP:
```bash
# 1. Scarica ZIP da github.com/Raffito0/ToxicorNah → Code → Download ZIP
# 2. Nel Terminal:
rm -rf ~/Downloads/ToxicorNah-main
cd Downloads && unzip ToxicorNah-main.zip -x "ToxicorNah-main/public/*"
cd ToxicorNah-main

# 3. Crea .env (le API keys sono sempre le stesse):
printf 'VITE_SUPABASE_URL=https://iilqnbumccqxlyloerzd.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpbHFuYnVtY2NxeGx5bG9lcnpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3MjMwMjgsImV4cCI6MjA4NDI5OTAyOH0.XhAsnTD36zk6dFegmsvw3DJ3emkpMASDI-6TKungHng\nVITE_GEMINI_API_KEY=AIzaSyDvwh4rbEQu4TnsqmPukaC6wAqXiyINuv8\n' > .env

# 4. Build e apri Xcode:
npm install && npm run build && npx cap copy ios && npx cap open ios
```
Poi in Xcode: seleziona iPhone 17 Pro → Play (triangolo)

**Tasto ~ sul Mac via RDP Windows**: scrivere `$HOME` al posto di `~` nei comandi

### Problemi noti MacInCloud:
- **git clone non funziona**: la config globale git ha regola `url.https://.insteadOf=git://` che trasforma HTTPS in SSH. Non risolvibile facilmente → usare ZIP
- **Disco pieno**: la cartella `public/` ha video/immagini pesanti → sempre escluderla dall'unzip
- **Simulatore "No such process"**: crash intermittente → Product → Clean Build Folder → Play di nuovo
- **`@` sulla tastiera italiana via RDP**: Alt+G o Alt+2 (se non funziona, usare la variabile nel codice)

### Deep Link — come funziona:
- n8n genera link `APP_URL/?sid=UUID` e lo manda su Telegram
- Su iOS: `AppDelegate.swift` intercetta `toxicornah://results?sid=UUID` → inietta JS nel WebView
- `App.tsx` ascolta l'evento `applink-sid` → carica scenario da Supabase → mostra risultati

### File iOS chiave:
- `capacitor.config.ts` — config Capacitor (appId, webDir, iOS/Android settings)
- `ios/App/App/AppDelegate.swift` — entry point iOS + deep link handler
- `ios/App/App/Info.plist` — URL scheme, orientamento, bundle ID
- `ios/App/App.xcodeproj` — progetto Xcode (aprire questo)
- `ios/App/App/public/` — asset web (generati da `npx cap copy ios`)
- `src/components/AvatarCropModal.tsx` — modal crop circolare avatar (NUOVO)

### Come installare .ipa su iPhone senza Apple Developer Program ($99):
1. Su MacInCloud: Xcode → **Product → Archive → Distribute → Development → Export**
2. Scaricare .ipa sul PC Windows
3. Installare **AltStore** su Windows (altstore.io) + iTunes
4. Collegare iPhone via USB → AltStore installa l'app
5. iPhone: Impostazioni → Generali → Gestione Dispositivo → fidati del profilo
6. L'app scade ogni 7 giorni, AltStore rinnova automaticamente (PC + iPhone stessa WiFi)

## Deep Profile Intelligence System (2026-03-12) — IN CORSO

### Obiettivo
Portare la personalizzazione di PersonProfile (profili ragazzi) e My Soul da 4.2/10 a ~8/10. Le ragazze devono pensare "cazzo, ha letto veramente la nostra chat e ha azzeccato Marco." ZERO frasi generiche, ZERO lookup tables.

### Problema attuale
- **Category Cards**: 8/10 — Gemini scrive direttamente, funzionano benissimo
- **Message Insights**: 9/10 — Gemini cita messaggi reali, ottime
- **Vital Signs**: 4/10 — formule `weighted average(warmth*0.5 + passion*0.3 + ...)` in `personProfileService.ts`, narrative generiche
- **Hard Truths**: 3/10 — 20 funzioni con threshold-based verdicts, proof generici tipo "Based on your conversation patterns"
- **Reality Check**: 3/10 — cascading if-else su powerBalance/dramaScore, frasi template
- **Your Two Sides**: 2/10 — 128 tratti hardcoded in `soulTypeDuality.ts`, rotano ogni 4 giorni, zero connessione alla chat
- **You Are Becoming**: 2/10 — lookup `EVOLUTION_MAP[archetype][trend]`, fake confidence
- **Mistakes**: 3/10 — 12 templates con funzioni condizionali e priorita', frasi generiche
- **Soul Compatibility**: 3/10 — formula `base 50 + energy modifier + keyword overlap`
- **Attracted Soul Type**: 2/10 — conta frequenza archetipo maschile, usa `ATTRACTION_REASONS` lookup

### Architettura soluzione: Hybrid (dati + narrativa)
**Strada 1 (dati strutturati)**: Gemini estrae fingerprint comportamentali → numeri, pattern, conteggi → aggregabili cross-analisi
**Strada 2 (narrativa personalizzata)**: Gemini scrive testi specifici alla chat → citazioni reali, "oh shit" moments

### Fasi di analisi (timing):
```
Ragazza uploada chat
  → Phase 1 (Quick, ~5s): score + soul type match → mostra ResultsPage
  → Phase 1.5 (micro-call, ~2s): personalizza descrizione Soul Type
  → Phase 2A (Detailed, background ~15s): 5 category cards + message insights
  → Phase 2B (Deep Profile, background ~10s, PARALLELO a 2A): NEW
      → behavioral fingerprints (his + hers)
      → vital signs con narrative evidence-based
      → hard truths con citazioni chat reali
      → reality check personalizzato
  → Phase 3 (Soul Synthesis, on-demand): quando apre My Soul
      → aggrega fingerprint di TUTTE le analisi
      → Gemini scrive Your Two Sides, Mistakes, Becoming, Compatibility personalizzati
      → cached in DB, refresh quando nuova analisi
```

### COSA E' GIA' STATO FATTO (Step 1 completato):

**File: `src/services/geminiService.ts`** (linee 2019-2357, +339 righe)
- ✅ `DeepProfileResult` interface completa (linea 2027)
- ✅ `DEEP_PROFILE_PROMPT` costante (~116 righe, linea 2066) — 5 sezioni: behavioral fingerprint, user fingerprint, vital signs, hard truths, reality check
- ✅ `analyzeDeepProfile()` funzione (linea 2189) — chiama Gemini 2.0 Flash, temp 0.5, 5000 token, valida e clampa tutti gli score
- ✅ `getDeepProfileFallback()` (linea 2326) — fallback safe con narrative vuote (frontend detecta e usa formule vecchie)

**Interfaccia DeepProfileResult** (per riferimento):
```typescript
{
  behavioralFingerprint: { responseTimePattern, messageLengthPattern, initiatorBalance, deflectionStyle, vulnerabilityLevel, consistencyScore, controlTactics[] }
  userBehavioralFingerprint: { messageLengthPattern, initiatorBalance, emotionalLabor, boundaryMoments, selfErasureMoments, overExplainingCount }
  vitalSigns: { emotionalAge, heLikesYou, justWantsSex, ghostRisk, manipulationLevel, powerOverYou } // each: { score: 0-100, narrative: string }
  hardTruths: [{ question, verdict, proof, verdictColor, category }] // exactly 5
  realityCheck: { statement, shift }
}
```

### STEP 2 — IN CORSO: Integrare Phase 2B in analysisService.ts

**Problema chiave da risolvere**: `analyzeDeepProfile()` ha bisogno di `ExtractionResult` (trascrizione chat). Ma:
- **DEV mode** (`processTwoPhaseAnalysis`, linea 1346): ✅ l'extraction e' GIA' disponibile dopo `analyzeQuick()` che ritorna `{ quick, extraction }`
- **Production mode** (`runAIAnalysis`, linea 627): ❌ usa `analyzeChatScreenshots()` che combina extraction+analisi in UNA sola call e NON ritorna l'extraction separatamente

**Soluzione pianificata**:
1. Modificare `analyzeChatScreenshots()` in `geminiService.ts` per ritornare ANCHE l'extraction: `{ result, extraction }` (o aggiungere un campo all'output)
2. Oppure (piu' semplice): in `runAIAnalysis`, dopo la call principale, estrarre i messaggi separatamente con `extractMessagesFromImages()` solo per Phase 2B

**Per DEV mode** (la parte facile, linea ~1690 di analysisService.ts):
```typescript
// Attualmente:
const detailed = await analyzeDetailed(extraction, quick.reasoning);
// Diventa:
const [detailed, deepProfile] = await Promise.all([
  analyzeDetailed(extraction, quick.reasoning),
  analyzeDeepProfile(extraction, quick.scores, quick.reasoning, personMatched?.title, userMatched?.title)
]);
// Poi salvare deepProfile nel localStorage result object
```

**Per Production mode** (piu' complesso, linea ~638):
- Dopo `analyzeChatScreenshots()`, lanciare Phase 2B come fire-and-forget (Promise che aggiorna DB quando finisce)
- L'extraction va ottenuta separatamente (o `analyzeChatScreenshots` deve esporre extraction)

**Storage**:
- Production: colonna `deep_profile` JSON nella tabella `analysis_results` (Supabase)
- DEV: merge nel `StoredAnalysisResult` object in localStorage

### STEP 3: DB Migration
- Aggiungere colonna `deep_profile` (tipo JSONB) alla tabella `analysis_results` in Supabase
- Default: NULL (analisi vecchie senza deep profile)

### STEP 4: PersonProfile — Vital Signs legge da deep_profile
- `personProfileService.ts`: se `analysis.deep_profile?.vitalSigns` esiste E narrative non vuote → usa score + narrative da deep_profile
- Altrimenti: fallback alle formule weighted-average attuali (backward compatible)

### STEP 5: PersonProfile — Hard Truths legge da deep_profile
- Se `deep_profile?.hardTruths` esiste e ha 5 entries → usa quelli (question, verdict, proof, verdictColor)
- Altrimenti: fallback alle ~20 funzioni answer attuali con threshold

### STEP 6: PersonProfile — Reality Check legge da deep_profile
- Se `deep_profile?.realityCheck?.statement` non vuoto → usa statement + shift da deep_profile
- Altrimenti: fallback al cascading if-else attuale

### STEP 7: Phase 3 — Soul Synthesis prompt + interface in geminiService.ts
- Nuovo prompt che riceve TUTTI i `behavioralFingerprint` + `userBehavioralFingerprint` di ogni analisi
- Genera: Your Two Sides personalizzati, Mistakes basati su pattern reali, You Are Becoming con vera traiettoria, Attracted Soul Type con motivo vero
- Interface `SoulSynthesisResult`

### STEP 8: DB — creare tabella `soul_profile_synthesis`
- Campi: user_id, synthesis_data (JSONB), last_analysis_count (int), updated_at
- Cache: se `last_analysis_count == current count` → usa cache, altrimenti rigenera

### STEP 9: SoulPage — fetchSoulProfile integra Phase 3
- `soulProfileService.ts`: check cache → se stale, chiama Phase 3 → salva → ritorna dati
- Se Phase 3 non ancora pronta: fallback ai dati vecchi (lookup tables)

### STEP 10: SoulPage — sezioni leggono da synthesis
- Your Two Sides: da Phase 3 invece di `soulTypeDuality.ts` (128 tratti hardcoded)
- Mistakes: da Phase 3 invece di `MISTAKE_TEMPLATES` (12 template con condizioni)
- You Are Becoming: da Phase 3 invece di `EVOLUTION_MAP` (lookup statico)
- Soul You Attract: da Phase 3 con motivo vero basato su pattern

### STEP 11: Compatibility — blend formula + dati reali
- Se l'utente ha analisi reali con un certo Soul Type → blend punteggio formula con dati reali
- Es: se ha 3 analisi con "Iron Veil" e tutte tossiche → compatibilita' bassa anche se la formula dice alta

### Altre cose fatte oggi (2026-03-12)

**ShareDynamicOverlay.tsx** (NUOVO file, ~200 righe):
- Overlay share per la DynamicCard (front face)
- Card 9:16 con side profiles + mix-blend-mode lighten su #111111
- 4 bottoni share: Instagram Stories, Save video, Copy link, More...
- Usa `generateDynamicShareVideo()` e `generateDynamicShareImage()` da shareVideo.ts

**CallOutOverlay.tsx** (modificato, +23/-17):
- Miglioramenti UI e fix

**ResultsPage.tsx** (modificato, +29 righe):
- `pb-4` → `pb-24` fix bottone tagliato
- Integrazione ShareDynamicOverlay

**shareVideo.ts** (modificato, +271 righe):
- `generateDynamicShareVideo()` e `generateDynamicShareImage()` — funzioni per generare video/immagine share della DynamicCard

**Playwright test setup** (NUOVO):
- `playwright.config.ts` — config per Mobile Chrome (Pixel 5), baseURL localhost:5173
- `tests/analysis.spec.ts` — test E2E: upload screenshot → analisi → verifica risultati
- `tests/example.spec.ts` — test di esempio Playwright

**phone-bot/TEST-LOG.md** — aggiornato con test recenti

### Fix gia' applicato (2026-03-12):
- `pb-4` → `pb-24` nel container principale ResultsPage (linea 590) — il bottone "SHARE YOUR DYNAMIC" era tagliato dal fondo pagina

## TODO — ALTRI PROSSIMI STEP

### iOS App — prossimi step

**Step 1 — Riaprire MacInCloud e riprendere dal simulatore**
1. Accedere a MacInCloud via RDP
2. Se la sessione e' scaduta: ri-scaricare ZIP e rifare setup (vedi istruzioni sopra)
3. Se la sessione e' ancora attiva: `cd ~/Downloads/ToxicorNah-main && npm run build && npx cap copy ios` → Play in Xcode

**Step 2 — Testare flow completo nel simulatore**
- Upload chat screenshot → analisi → risultati ✅ (gia' testato)
- First-time user: niente hero section, niente form persona ✅ (gia' testato)
- Create new person → ADD → persona selezionata ✅ (gia' testato)
- Avatar crop: aprire modal, trascinare, zoomare, scegliere → DA VERIFICARE (fix landscape pushato ma non ritestato)
- Scorrere tutta la ResultsPage: Soul Type card, MessageInsights, DynamicCard flip, category cards → DA FARE

**Step 3 — Fixare eventuali bug di layout rimanenti**
- Fix CSS in `src/` sul Mac con sed
- `npm run build && npx cap copy ios` → Play

**Step 4 — Export .ipa e installazione su iPhone reale**
1. Xcode → Product → Archive
2. Distribute App → Development → Export
3. Scaricare .ipa su Windows
4. AltStore → installa su iPhone
5. Testare deep link: aprire `toxicornah://results?sid=UUID` da Telegram

**Step 5 — Preparare per App Store (futuro)**
- Serve Apple Developer Program ($99/anno)
- Xcode → Archive → Distribute → App Store Connect

### Phone-Bot (rimasto da fare)
- Convertire ~100+ `time.sleep(N)` letterali in timing log-normal (tiktok.py ~40, instagram.py ~40, adb.py ~5, proxy.py ~3)
- Spostare proxy credentials in env vars
- Scan `random.random() < 0.` per probabilita' fisse rimaste
- Testare search_explore_session su telefono reale (verificare coordinate griglia)
- Testare typing rhythm (verificare che i 4 ritmi producano delay diversi)

### n8n Pipeline
- Re-importare `unified-pipeline-fixed.json` su VPS
- Pulire Video Runs con status='started'
- Testare auto-produce (verificare 15 check hardening)
- Importare `workflow-hook-batch.json` per hook pool Phone 1 e 3
