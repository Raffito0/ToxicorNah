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
- Key code files: `parse-video-message.js`, `save-clip.js`, `prepare-production.js`, `generate-hook.js`, `generate-outro.js`, `generate-voiceover.js`, `extract-frame.js`, `img-to-video.js`, `assemble-video.js`, `auto-produce.js`, `set-produce-context.js`
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

### Anti-Detection Video Hardening (assemble-video.js)
Analisi completa 360 gradi di tutti i rischi ban/shadowban su TikTok e Instagram.

**Fix applicati (tutti embedded in unified-pipeline-fixed.json):**

| Fix | Cosa fa |
|-----|---------|
| `-map_metadata -1` | Strip TUTTI i metadata globali |
| `-fflags +bitexact` | Rimuove encoder string muxer (Lavf) |
| `-flags +bitexact` | Rimuove x264 SEI version string dal bitstream video |
| `-brand mp42` | ftyp atom = CapCut/InShot style (non default FFmpeg `isom`) |
| `-profile:v high -level 4.0` | Profilo encoding esplicito e coerente |
| `-ar 48000` | Sample rate 48kHz (come camera Android, non 44.1kHz da CD/MP3) |
| `-ac 2` | Audio stereo (non mono — ogni video da telefono e stereo) |
| `handler_name=VideoHandler/SoundHandler` | Standard Android |
| `creation_time` | Timestamp ISO corrente |
| Hook STS audio 48kHz | Era 44100, fixato a 48000 |
| Telegram fileName pulito | `VID_YYYYMMDD_HHMMSS.mp4` (non `scenarioName_final.mp4`) |

**Metadata approach: editing app style, NOT camera style.**
Il video e chiaramente post-prodotto (screenshot, testo, overlay) — mettere metadata camera Samsung sarebbe CONTRADDITTORIO e piu sospetto. Il video ora ha solo handler names + creation_time, identico a export CapCut/InShot.

**Step 5 in assemble-video.js**: secondo pass FFmpeg con `-c copy` che ri-wrappa il video con metadata puliti. Graceful fallback se fallisce.

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
1. **Re-importare `unified-pipeline-fixed.json`** su n8n VPS — contiene TUTTI i fix (encoding, anti-detection, VO race condition, speaking outro, extractHookLastFrame, topic routing, stereo 48kHz, metadata clean)
2. **Disattivare e riattivare** il workflow (registra webhook Telegram)
3. **Pulire Video Runs** con `status='started'` (Airtable MCP: `list_records` con `filterByFormula: {status}='started'` sulla tabella Video Runs, poi `update_records` con `status='cancelled'`)
4. **Testare auto-produce** — verificare che i video finali abbiano:
   - Audio stereo 48kHz
   - Nessun metadata FFmpeg/x264 (controllare con `ffprobe -show_format -show_streams video.mp4`)
   - fileName pulito su Telegram (`VID_...mp4`)
5. **Importare `workflow-hook-batch.json`** su n8n per generare hook pool per Phone 1 e 3
6. **Continuare automation software** (altra chat) — integrazione delivery module, anti-Appium

### Preferenze utente:
- **SEMPRE pulire Video Runs** con `status='started'` prima di ritestare, senza chiedere
- **MAI usare CLI** per importare workflow — l'utente importa manualmente dalla UI di n8n
- **MAI pushare su remote** senza chiedere
