# Workflow 3 — Video Pipeline (Modular Plan)

## Concept Overview

The pipeline must work for ANY video concept. Each concept defines:
- **Hook type**: what kind of hook asset (manual clip, AI images, AI video, etc.)
- **Body clips**: always manual recordings uploaded via Telegram
- **Outro pool**: weighted random selection from multiple outro options

---

## Video Concepts (current)

### Concept 3: `chat_screenshot`
- **Hook**: Manual clip (user films another phone, screenshots the chat, shows results)
  - Uploaded via Telegram like body clips: `#hook scenario_name`
- **Body clips**: Screen recordings of chat + analysis
- **Outro**: From outro pool (e.g., app store page clip, or other)

### Concept: `sad_girl`
- **Hook**: AI-generated image (kie.ai Nano Banana Pro) → converted to video (Humo.ai/ComfyUI)
  - Extract env frame from first body clip → kie.ai with env frame + girl ref → Telegram approval → img2vid → Telegram approval
- **Body clips**: Manual recordings
- **Outro**: From outro pool (e.g., AI girl reaction, app store clip, or other)

### Concept: `before_after`
- **Hook**: EITHER 3 AI images (1s each, girl+boyfriend together) OR a 3s manual video clip
  - Config flag decides which mode
- **Body clips**: Manual recordings
- **Outro**: From outro pool

---

## Outro Pool System

Each concept has an `outroPool` — array of possible outros with weights:

```
outroPool: [
  { type: "manual_clip", label: "app_store", weight: 40, enabled: true },
  { type: "ai_generated", label: "girl_reaction", weight: 60, enabled: true },
]
```

- `manual_clip`: pre-recorded clips stored in Airtable (telegram_file_id)
- `ai_generated`: kie.ai image → Humo.ai video (needs approval)
- System picks randomly based on weights among ENABLED options
- Configurable per concept in Airtable `Video Concepts` table

---

## Telegram Commands

| Command | Action |
|---|---|
| `#body scenario_name clip_index` + video | Upload body clip |
| `#hook scenario_name` + video | Upload manual hook clip |
| `#outro scenario_name label` + video | Upload manual outro clip (e.g., `#outro my_scenario app_store`) |
| `/produce scenario_name` | Start video production |

---

## Workflow Node Architecture

### PART 1: Trigger + Parse + Route (shared entry point)
```
Telegram Trigger → Parse Message → Route Message (Switch)
                                    ├─ "body_clip"  → Part 2
                                    ├─ "hook_clip"  → Part 2b (same save logic)
                                    ├─ "outro_clip" → Part 2c (same save logic)
                                    ├─ "produce"    → Part 3
                                    └─ fallback     → NoOp (ignore)
```

### PART 2: Upload Handlers (body/hook/outro clips)
All clip uploads follow the same pattern:
```
Find Scenario → Save to Airtable (Body Clips / Hook Clips / Outro Clips) → Telegram confirm
```
- Body clips: saved to Body Clips table with clip_index
- Hook clips: saved with type="hook_manual"
- Outro clips: saved with type="outro_manual" + label from caption

### PART 3: /produce → Load + Validate + Create Video Run
```
Ack Produce (Telegram "Starting...")
  → Find Scenario (Airtable)
  → Validate Scenario
  → IF error → Send Error
  → Find Body Clips (Airtable)
  → Validate Clips
  → IF no clips → Send Error
  → Load Concept Config (from Video Concepts table)
  → Create Video Run (Airtable)
  → Route by Hook Type (Switch)
      ├─ "manual_clip" → Part 4a
      ├─ "ai_image"    → Part 4b
      └─ "ai_multi_image" → Part 4c (before_after 3-image mode)
```

### PART 4a: Hook = Manual Clip
```
Find Hook Clip (Airtable, telegram_file_id)
  → Download from Telegram
  → [hook clip ready, skip to Part 5]
```

### PART 4b: Hook = AI Single Image → Video
```
Download First Body Clip from Telegram
  → Extract Env Frame (FFmpeg)
  → AI Agent: Generate Hook Prompt (Gemini LLM Chain)
  → Generate Hook Image (kie.ai Nano Banana Pro)
  → Send Image to Telegram for Approval (inline keyboard: Approve / Redo)
  → Wait Node (pauses until callback)
  → IF Redo → loop back to AI Agent
  → IF Approve → Img2Vid (Humo.ai / ComfyUI)
  → Send Video to Telegram for Approval
  → Wait Node
  → IF Redo → loop back to Img2Vid
  → IF Approve → [hook video ready, continue to Part 5]
```

### PART 4c: Hook = 3 AI Images (before_after)
```
Same as 4b but generates 3 images sequentially:
  → AI Agent: Generate Image Prompt 1 (girl+bf moment 1)
  → kie.ai → Telegram Approval → (loop or continue)
  → AI Agent: Generate Image Prompt 2 (moment 2)
  → kie.ai → Telegram Approval
  → AI Agent: Generate Image Prompt 3 (moment 3)
  → kie.ai → Telegram Approval
  → Concatenate 3 images as 1s-each video segments (FFmpeg)
  → [hook ready, continue to Part 5]
```

### PART 5: Outro Selection + Generation
```
Pick Outro (Code node — weighted random from outroPool config)
  → Route by Outro Type (Switch)
      ├─ "manual_clip" → Find Outro Clip (Airtable) → Download → [outro ready]
      ├─ "ai_generated" → AI Agent: Generate Outro Prompt
      │     → kie.ai (hook image as ref + girl ref)
      │     → Telegram Approval → Wait
      │     → Img2Vid → Telegram Approval → Wait
      │     → [outro ready]
      └─ "none" → [skip outro]
```

### PART 6: Voiceover + Assembly
```
Generate VO (Fish.audio)
  → Send VO to Telegram for Approval → Wait
  → Download All Body Clips from Telegram
  → Assemble Video (FFmpeg: hook + body clips + outro + VO + music)
  → Send Final Video to Telegram for Approval → Wait
  → IF Approve → Upload to Content Library (Airtable) → Update Video Run status
  → IF Redo → ??? (manual re-edit needed)
```

---

## Video Templates (Music Sync System)

All music tracks are normalized to **120 BPM** (1 beat = 0.5s).
Every segment duration is a multiple of 0.5s → music always lands on beat.

A **template** defines the exact segment structure of a video.
Each segment has a `section` name, a `duration` in seconds, and a `source` type.

### Template Definitions

```
TEMPLATE A — "Standard" (17s, 34 beats)
  hook:          3.0s  (6 beats)   — hook clip/video
  screenshot:    1.0s  (2 beats)   — body clip: scrolling to chat
  upload_chat:   1.0s  (2 beats)   — body clip: uploading screenshots
  toxic_score:   3.0s  (6 beats)   — body clip: toxic score reveal
  soul_type:     3.0s  (6 beats)   — body clip: soul type section
  deep_dive:     3.0s  (6 beats)   — body clip: between the lines / category
  outro:         3.0s  (6 beats)   — outro clip/video

TEMPLATE B — "Extended" (20s, 40 beats)
  hook:          3.0s  (6 beats)
  screenshot:    1.0s  (2 beats)
  upload_chat:   1.0s  (2 beats)
  toxic_score:   3.0s  (6 beats)
  soul_type:     3.0s  (6 beats)
  deep_dive_1:   3.0s  (6 beats)   — first category section
  deep_dive_2:   3.0s  (6 beats)   — second category section
  outro:         3.0s  (6 beats)

TEMPLATE C — "Snappy" (14s, 28 beats)
  hook:          3.0s  (6 beats)
  screenshot:    1.0s  (2 beats)
  upload_chat:   1.0s  (2 beats)
  toxic_score:   2.0s  (4 beats)
  soul_type:     2.0s  (4 beats)
  deep_dive:     2.0s  (4 beats)
  outro:         3.0s  (6 beats)

TEMPLATE D — "Long" (23s, 46 beats)
  hook:          3.0s  (6 beats)
  screenshot:    1.5s  (3 beats)
  upload_chat:   1.5s  (3 beats)
  toxic_score:   3.0s  (6 beats)
  soul_type:     3.0s  (6 beats)
  deep_dive_1:   3.0s  (6 beats)
  deep_dive_2:   3.0s  (6 beats)
  outro:         3.0s  (6 beats)
  message_card:  2.0s  (4 beats)   — optional message insight card
```

Templates are stored in Airtable (`Video Templates` table) or hardcoded in a code node.
Each scenario in Airtable links to a template.

### Music Selection

- Music tracks table in Airtable: `name`, `file_url`, `bpm` (always 120), `mood`, `duration_sec`
- During `/produce`, a track is selected (random from matching mood, or specified)
- FFmpeg trims the music to match the total template duration
- Music starts on beat 1 of the hook segment

---

## Smart Clip Trimming System

Body clips are manually recorded and will NEVER be exactly the template duration.
The pipeline must automatically fit each clip to its template segment.

### Rules (in priority order):

1. **Calculate speed factor**: `speedFactor = actualDuration / targetDuration`
2. **If speedFactor is 1.0 ± 0.05** (within 5%): no change needed, just trim to exact duration
3. **If clip is LONGER (speedFactor 1.05 - 1.4)**: speed up slightly
   - FFmpeg: `setpts=PTS/{speedFactor}` (e.g., 3.6s → 3.0s = 1.2x speed, barely noticeable)
   - Also speeds up audio: `atempo={speedFactor}`
4. **If clip is LONGER (speedFactor > 1.4)**: trim from end, keep the most important first part
   - FFmpeg: `-t {targetDuration}` (hard cut)
   - For screen recordings, the beginning (the action) is usually the important part
5. **If clip is SHORTER (speedFactor 0.7 - 0.95)**: slow down slightly
   - FFmpeg: `setpts=PTS/{speedFactor}` (e.g., 2.7s → 3.0s = 0.9x speed)
6. **If clip is MUCH SHORTER (speedFactor < 0.7)**: freeze last frame to fill remaining time
   - FFmpeg: `tpad=stop=-1:stop_mode=clone:stop_duration={gapSeconds}`

### Implementation in FFmpeg filter_complex:

For each body clip segment:
```
[{idx}:v] setpts=PTS/{sf}, scale=1080:1920:..., fps=30 [{label}]
[{idx}:a] atempo={sf} [{label}a]
```

Where `sf` = `min(max(speedFactor, 0.7), 1.4)` — clamped to safe range.
If the clip has no audio (screen recording), skip the atempo filter.

### Clip Duration Detection:

Before assembly, a Code node uses FFprobe to get exact duration of each downloaded clip:
```
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "clip.mp4"
```

---

## Approval Flow Architecture

Every approval uses the same pattern:
1. **Send asset** to Telegram with inline keyboard (`Approve ✅` / `Redo 🔄`)
2. **Wait Node** — pauses execution, stores `executionId` + `resumeUrl` in Video Runs table
3. **Workflow 2** (Telegram Callback Handler) receives the button press → calls the Wait node's webhook URL to resume

The callback_data format: `vpApprove_{runId}_{step}` or `vpRedo_{runId}_{step}`

Steps: `hook_img`, `hook_vid`, `outro_img`, `outro_vid`, `vo`, `final`

---

## Airtable Changes Needed

### Video Concepts table — new fields:
- `hook_type`: singleSelect ("manual_clip", "ai_image", "ai_multi_image")
- `outro_pool_json`: longText (JSON array of outro options with weights)
- `girl_ref_url`: url (character reference image for AI generation)

### Scenarios table — new fields:
- `template_id`: linkedRecord to Video Templates table
- `hook_file_id`: text (telegram file_id for manual hook clips)

### Body Clips table — reuse for all clip types:
- Add `clip_type` field: singleSelect ("body", "hook_manual", "outro_manual")
- Add `label` field: text (e.g., "app_store" for outro clips)
- Add `section` field: text (template section name this clip maps to, e.g., "screenshot", "toxic_score")

### NEW: Video Templates table
- `template_name`: text ("Standard", "Snappy", etc.)
- `segments_json`: longText (JSON array of segments with section + duration)
- `total_duration_sec`: number (auto-calculated)
- `beat_count`: number (total_duration * 2 at 120 BPM)

### NEW: Music Tracks table
- `track_name`: text
- `file_url`: url (or attachment)
- `telegram_file_id`: text
- `bpm`: number (always 120)
- `mood`: singleSelect ("dark", "energetic", "chill", "dramatic")
- `duration_sec`: number

---

## Build Order (piece by piece)

1. **Airtable schema updates** (add fields)
2. **Part 1**: Trigger + Parse (extend parse-video-message.js for #hook, #outro)
3. **Part 2**: Upload handlers (extend receive-body-clips.js)
4. **Part 3**: /produce → load + validate + route
5. **Part 4a**: Manual hook clip path
6. **Part 4b**: AI hook image → video path (with approvals)
7. **Part 5**: Outro pool + selection + generation
8. **Part 6**: VO + Assembly + Final approval
9. **Wire Workflow 2** to handle vpApprove/vpRedo callbacks
