# Phase B: Scenario Generator — n8n Workflow 1
## Complete Build Guide

---

## 1. WORKFLOW OVERVIEW

### Purpose
Generate ContentScenario JSONs (chat + analysis results) plus all video content copy (hook text, VO script, captions, social caption). Each run produces ONE complete scenario ready for video production.

### Flow Diagram
```
[Manual Trigger]
  (params: count, concept_override, vibe_override)
        │
        ▼
┌─────────────────────────────┐
│ NODE 1: Airtable            │  GET all active Video Concepts
│ "Get Active Concepts"       │  Filter: is_active = TRUE
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODE 2: Code                │  Weighted random pick
│ "Select Concept"            │  + pick vibe + appStyle + gender
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODES 3a-3e: Airtable ×5   │  Parallel queries:
│ "Get Templates"             │  Body Clip Templates
│                             │  Caption Templates
│                             │  VO Templates
│                             │  Hook Text Pool
│                             │  Social Copy Examples
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODE 4: Code                │  Assemble all template data
│ "Build Scenario Prompt"     │  into one DeepSeek prompt
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODE 5: HTTP Request        │  POST to DeepSeek API
│ "Generate Scenario"         │  → ContentScenario JSON
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODE 6: Code                │  Parse JSON, validate all fields
│ "Validate Scenario"         │  Check soul types, scores, insights
└──────────┬──────────────────┘
           │ (retry up to 3× if invalid)
           ▼
┌─────────────────────────────┐
│ NODE 7: Code                │  Build content copy prompt
│ "Build Copy Prompt"         │  with scenario + templates
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODE 8: HTTP Request        │  POST to DeepSeek API
│ "Generate Content Copy"     │  → hook, VO, captions, social
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODE 9: Code                │  Validate copy structure
│ "Validate Copy"             │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODE 10: Telegram           │  Send approval message:
│ "Request Approval"          │  chat preview + scores + copy preview
│                             │  [✅ Approve] [🔄 Redo] [❌ Skip]
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ NODE 11: Wait               │  Webhook wait for Telegram callback
│ "Await Decision"            │  Timeout: 30 min
└──────────┬──────────────────┘
           │
     ┌─────┼──────┐
     ▼     ▼      ▼
  Approve  Redo   Skip
     │     │      │
     ▼     │      ▼
  [NODE 12]│    [End]
  Airtable │
  "Save    │
  Scenario"│
     │     └──► Loop back to NODE 5 (max 3)
     ▼
   [Done]
```

---

## 2. NODE-BY-NODE CONFIGURATION

### NODE 1: Airtable — "Get Active Concepts"
| Setting | Value |
|---------|-------|
| Operation | List Records |
| Base ID | `appsgjIdkpak2kaXq` |
| Table | `Video Concepts` (tblhhTVI4EYofdY32) |
| Filter Formula | `{is_active} = TRUE()` |

### NODE 2: Code — "Select Concept"
See **Section 5** for full JavaScript code.

**What it does:**
1. Takes the list of active concepts from Node 1
2. Weighted random selection based on `weight` field
3. Picks random `vibe` (toxic/wholesome/mixed/decoded) with distribution: 40/15/25/20
4. Picks random `appStyle` (imessage/instagram/whatsapp) with distribution: 40/30/30
5. Picks random `personGender` (male 80% / female 20%)
6. Generates a unique `scenario_name` slug

**Output:**
```json
{
  "concept": { ...full concept record... },
  "vibe": "toxic",
  "appStyle": "imessage",
  "personGender": "male",
  "scenarioName": "toxic-ice-01-1707600000"
}
```

### NODES 3a-3e: Airtable — "Get Templates" (5 parallel queries)

All 5 run in parallel, filtered by the selected concept's `concept_id`:

| Node | Table | Table ID | Filter |
|------|-------|----------|--------|
| 3a | Body Clip Templates | tblTcEPaDKKOyKGoL | `{concept_id} = "{{concept_id}}"` |
| 3b | Caption Templates | tblxhuowMWTPSQVdb | `{concept_id} = "{{concept_id}}"` |
| 3c | VO Templates | tblpyfkR7OdRiwSdo | `{concept_id} = "{{concept_id}}"` |
| 3d | Hook Text Pool | tblmCU1lVXEPqP8zK | `{concept_id} = "{{concept_id}}"` |
| 3e | Social Copy Examples | tblU1iYIOURfRYdfF | `{concept_id} = "{{concept_id}}"` |

> **n8n tip**: Use a "Merge" node after the 5 parallel Airtable queries to combine all data into one item.

### NODE 4: Code — "Build Scenario Prompt"
See **Section 3** for the full prompt template.

Takes all template data + selection params and builds the complete DeepSeek prompt.

### NODE 5: HTTP Request — "Generate Scenario"
| Setting | Value |
|---------|-------|
| Method | POST |
| URL | `https://api.deepseek.com/chat/completions` |
| Authentication | Header Auth |
| Header Name | `Authorization` |
| Header Value | `Bearer {{$credentials.deepseekApiKey}}` |
| Body Type | JSON |
| JSON Body | See below |

```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "{{systemPrompt}}" },
    { "role": "user", "content": "{{userPrompt}}" }
  ],
  "temperature": 0.9,
  "max_tokens": 4000,
  "response_format": { "type": "json_object" }
}
```

> **Note**: `response_format: json_object` forces DeepSeek to output valid JSON. Temperature 0.9 keeps chats creative.

### NODE 6: Code — "Validate Scenario"
See **Section 5** for full validation code.

### NODE 7: Code — "Build Copy Prompt"
See **Section 4** for the full prompt template.

### NODE 8: HTTP Request — "Generate Content Copy"
Same DeepSeek config as Node 5, but with:
- `temperature`: 0.85
- `max_tokens`: 3000

### NODE 9: Code — "Validate Copy"
See **Section 5** for validation code.

### NODE 10: Telegram — "Request Approval"
See **Section 6** for message template.

### NODE 11: Wait — "Await Decision"
| Setting | Value |
|---------|-------|
| Resume | On Webhook Call |
| Webhook URL | Auto-generated by n8n |
| Timeout | 30 minutes |

### NODE 12: Airtable — "Save Scenario"
| Setting | Value |
|---------|-------|
| Operation | Create Record |
| Base ID | `appsgjIdkpak2kaXq` |
| Table | `Scenarios` (tblcQaMBBPcOAy0NF) |

**Fields to set:**
| Field | Value |
|-------|-------|
| `scenario_name` | `{{scenarioName}}` |
| `concept_id` | `{{concept.concept_id}}` |
| `vibe` | `{{vibe}}` |
| `app_style` | `{{appStyle}}` |
| `scenario_json` | `{{JSON.stringify(scenario)}}` |
| `generated_hook_text` | `{{contentCopy.hookText}}` |
| `generated_outro_text` | `{{contentCopy.outroText}}` |
| `generated_vo_script` | `{{contentCopy.voScript}}` |
| `generated_caption_plan` | `{{JSON.stringify(contentCopy.captionPlan)}}` |
| `generated_social_caption` | `{{contentCopy.socialCaption}}` |
| `status` | `approved` |

---

## 3. DEEPSEEK PROMPT: SCENARIO GENERATION

### System Prompt

```
You are a scenario generator for "Toxic or Nah," a relationship chat analysis app. You create realistic fake text conversations between two people, plus complete analysis results that the app would display.

Your output must be a single valid JSON object matching the ContentScenario interface exactly. No markdown, no code fences, no explanation — ONLY the JSON.

## CONTENT SCENARIO INTERFACE

{
  "id": string,                    // scenario slug, e.g. "toxic-jake-01"
  "chat": {
    "contactName": string,         // First name only (e.g. "Jake", "Sofia", "Marcus")
    "appStyle": "imessage" | "instagram" | "whatsapp",
    "messages": [                  // Array of 14-22 messages
      {
        "sender": "them" | "me",   // "them" = the person being analyzed, "me" = the user
        "text": string,            // Message text (natural texting style)
        "time"?: string            // Optional timestamp like "10:32 PM" (include on ~30-40% of messages)
      }
    ]
  },
  "results": {
    "personName": "Him" | "Her",   // ALWAYS "Him" for male, "Her" for female. NEVER the contact name.
    "personGender": "male" | "female",
    "overallScore": number,        // 0-100 (this is the HEALTH score, NOT toxicity)
    "warmthScore": number,         // 0-100
    "communicationScore": number,  // 0-100
    "dramaScore": number,          // 0-100 (HIGH = bad, lots of drama)
    "distanceScore": number,       // 0-100 (HIGH = bad, emotionally distant)
    "passionScore": number,        // 0-100
    "profileType": string,         // 2-4 word label (see VIBE RULES)
    "profileSubtitle": string,     // One witty sentence
    "profileDescription": string,  // 2-3 sentences about the chat dynamic
    "personSoulType": string,      // MUST be from VALID SOUL TYPE IDS below
    "userSoulType": string,        // MUST be from VALID SOUL TYPE IDS below
    "personDescription": string,   // 3-4 sentences about WHO this person IS as a personality. NOT what happened in the chat.
    "personTraits": [string, string, string, string, string],  // Exactly 5 personality traits
    "userDescription": string,     // 3-4 sentences about the user's personality
    "userTraits": [string, string, string, string, string],    // Exactly 5 personality traits
    "categories": {
      "intentions":        { "description": string },  // 2-3 sentences
      "chemistry":         { "description": string },
      "effort":            { "description": string },
      "redFlagsGreenFlags": { "description": string },
      "trajectory":        { "description": string }
    },
    "messageInsights": [           // EXACTLY 4-5 insights
      {
        "message": string,         // EXACT verbatim quote from chat messages array
        "title": string,           // 2-5 word catchy title for this insight
        "tag": "RED FLAG" | "GREEN FLAG" | "DECODED",
        "description": string,     // 3-4 sentences analyzing this specific message
        "solution": string         // 2-3 sentences of actionable advice
      }
    ],
    "dynamic": {
      "name": string,              // 2-4 word dynamic name (e.g. "The Convenience Trap")
      "subtitle": string,          // One sentence
      "whyThisHappens": string,    // 3-4 sentences explaining the pattern
      "patternBreak": string,      // 2-3 sentences of advice
      "powerBalance": number       // 0-100 (50 = equal, <50 = person has more power, >50 = user has more power)
    }
  }
}

## VALID SOUL TYPE IDS

### Male (use when personGender = "male"):
- "male-untamable" — The Untamable (Wild Energy): free-spirited, commitment-phobic, thrilling but unreliable
- "male-gentle-flame" — The Gentle Flame (Warm Energy): genuinely kind, emotionally present, warmth radiates
- "male-silent-abyss" — The Silent Abyss (Abyss Energy): deep but unreachable, pulls you in then disappears
- "male-faded-crown" — The Faded Crown (Hollow Energy): once great, now empty promises, living off past glory
- "male-sweet-poison" — The Sweet Poison (Toxic Energy): charming on surface, slowly toxic underneath
- "male-wounded-prince" — The Wounded Prince (Martyr Energy): uses his pain as a weapon, guilt-trips
- "male-burning-promise" — The Burning Promise (Explosive Energy): intense, passionate, but volatile and unpredictable
- "male-final-silence" — The Final Silence (Phantom Energy): ghoster, slow fader, disappears without explanation
- "male-dark-mirror" — The Dark Mirror (Toxic Energy): reflects your insecurities back, gaslighter
- "male-ice-charmer" — The Ice Charmer (Frozen Energy): cold but magnetic, minimal effort maximum control
- "male-silent-choke" — The Silent Choke (Constrictor Energy): controlling through silence and withdrawal
- "male-shifting-flame" — The Shifting Flame (Unstable Energy): hot and cold, inconsistent, keeps you guessing
- "male-chameleon" — The Chameleon (Shapeshifter Energy): becomes whoever you want, no real identity
- "male-star-collector" — The Star Collector (Collector Energy): charms everyone, you're not special to him

### Female (use when personGender = "female"):
- "female-love-rush" — The Love Rush (Rush Energy): falls fast, loves hard, overwhelming intensity
- "female-natural-state" — The Natural State (Earth Energy): grounded, stable, emotionally mature
- "female-fire-dance" — The Fire Dance (Fire Energy): passionate, confrontational, emotionally expressive
- "female-frozen-bloom" — The Frozen Bloom (Frost Energy): guarded, takes time to open, walls up
- "female-torn-silk" — The Torn Silk (Silk Energy): elegant but damaged, beautiful sadness
- "female-inner-voice" — The Inner Voice (Intuitive Energy): trusts gut feelings, perceptive, reads between lines
- "female-silent-venom" — The Silent Venom (Venom Energy): passive-aggressive, subtle toxicity
- "female-sunset-soul" — The Sunset Soul (Sunset Energy): nostalgic, holds onto past relationships
- "female-deep-shadow" — The Deep Shadow (Shadow Energy): dark moods, emotional depth, hard to reach
- "female-wild-luxury" — The Wild Luxury (Luxe Energy): high standards, expects effort, not easily impressed
- "female-living-maze" — The Living Maze (Labyrinth Energy): confusing, mixed signals, hard to navigate
- "female-golden-rule" — The Golden Rule (Gold Energy): sets boundaries, knows her worth, fair but firm
- "female-savage-grace" — The Savage Grace (Predator Energy): takes what she wants, dominant, fierce
- "female-quiet-storm" — The Quiet Storm (Storm Energy): calm surface, intense underneath
- "female-rising-phoenix" — The Rising Phoenix (Phoenix Energy): rebuilding from heartbreak, growth mode
- "female-liquid-mirror" — The Liquid Mirror (Mirror Energy): reflects others' energy, adaptive

### User Soul Types:
- When personGender = "male", userSoulType MUST be a "female-*" ID
- When personGender = "female", userSoulType MUST be a "male-*" ID

## ABSOLUTE RULES

1. **personName**: ALWAYS "Him" if male, "Her" if female. NEVER use the contactName.
2. **messageInsights[].message**: MUST be an EXACT copy-paste from chat.messages[].text. Character-for-character identical.
3. **messageInsights tags**: Include a MIX of tags. Minimum 1 DECODED insight per scenario. See VIBE RULES for tag distribution.
4. **messageInsights selection**: ONLY select genuinely noteworthy messages. NEVER select "hi", "hey", "hello", "what's up" or basic greetings.
5. **Insight titles**: The title must describe what the MESSAGE SENDER is doing. Ask: "Who sent this message? What is THEIR action? Does my title describe THEIR action?"
6. **Soul type match**: personSoulType must match the person's actual behavior in the chat. Don't assign "Ice Charmer" to someone being warm and loving.
7. **Score coherence**: overallScore must match the chat content. A toxic chat cannot have overallScore > 40. A wholesome chat cannot have overallScore < 65.
8. **BANNED traits**: NEVER use any of these: "Early Stage", "New Connection", "Fresh Start", "Getting to Know", "Just Met", "Beginning Phase".
9. **personDescription / userDescription**: Describe WHO they ARE as a person (personality, patterns, emotional style). NOT what happened in this specific chat.
10. **Category descriptions**: Analyze what actually happens in THIS chat. Be specific. Reference actual messages/events from the conversation.
11. **DECODED insights**: The description must decode the EXACT psychological moment — what they said, what they're actually feeling, why THIS specific response, what it reveals about their deeper motivations. NO vague summaries.
12. **No timestamps in message text**: Message text must be ONLY the message content. Timestamps go in the separate "time" field.
13. **Natural texting**: Use lowercase, abbreviations (wyd, lol, ngl, tbh, omg), emojis where natural. Match how real 18-28 year olds text.
14. **Conversation flow**: Messages must flow naturally. Each message responds to or builds on the previous ones. No random topic jumps.

## VIBE RULES

### toxic (overallScore: 15-35)
- warmthScore: 10-25, communicationScore: 15-30, dramaScore: 65-85, distanceScore: 70-90, passionScore: 10-25
- profileType examples: "Red Flag Alert", "Toxic Pattern", "Danger Zone", "Walking Red Flag"
- messageInsights: 2-3 RED FLAG, 0-1 GREEN FLAG, 1-2 DECODED
- Person soul types (male): ice-charmer, dark-mirror, silent-choke, sweet-poison, final-silence, star-collector, faded-crown
- Person soul types (female): silent-venom, living-maze, deep-shadow
- powerBalance: 15-35 (person has more power)
- Chat shows: manipulation, dismissiveness, gaslighting, breadcrumbing, love-bombing, stonewalling, guilt-tripping

### wholesome (overallScore: 75-95)
- warmthScore: 70-90, communicationScore: 70-90, dramaScore: 5-20, distanceScore: 5-20, passionScore: 65-90
- profileType examples: "Green Light", "Healthy Connection", "The Real Deal", "Keeper Alert"
- messageInsights: 0-1 RED FLAG, 2-3 GREEN FLAG, 1-2 DECODED
- Person soul types (male): gentle-flame, burning-promise, untamable (positive wild)
- Person soul types (female): natural-state, golden-rule, rising-phoenix, inner-voice
- powerBalance: 40-60 (balanced)
- Chat shows: genuine interest, emotional support, humor, reciprocity, planning future, vulnerability

### mixed (overallScore: 40-60)
- warmthScore: 35-55, communicationScore: 35-55, dramaScore: 35-55, distanceScore: 35-55, passionScore: 35-60
- profileType examples: "Mixed Signals", "Proceed with Caution", "Gray Area", "Situationship Energy"
- messageInsights: 1-2 RED FLAG, 1-2 GREEN FLAG, 1-2 DECODED
- Person soul types: any that show inconsistency (shifting-flame, chameleon, wounded-prince, frozen-bloom, torn-silk)
- powerBalance: 30-50
- Chat shows: inconsistency, hot/cold behavior, some good moments mixed with concerning ones

### decoded (overallScore: any range)
- Scores can be anything, but focus on HIDDEN MEANING
- profileType examples: "Hidden Layers", "Read Between The Lines", "Not What It Seems", "Decoded"
- messageInsights: 0-1 RED FLAG, 0-1 GREEN FLAG, 3-4 DECODED
- Person soul types: any
- Chat shows: subtext, double meanings, unspoken tension, indirect communication, what they say vs what they mean
```

### User Prompt Template

```
Generate a ContentScenario JSON with these parameters:

CONCEPT: {{conceptName}}
CONCEPT DESCRIPTION: {{conceptDescription}}
VIBE: {{vibe}}
APP STYLE: {{appStyle}}
PERSON GENDER: {{personGender}}
SCENARIO ID: "{{scenarioName}}"
SCENARIOS NEEDED: {{scenariosPerVideo}}

{{#if scenariosPerVideo > 1}}
NOTE: This concept needs {{scenariosPerVideo}} separate scenarios (e.g., for "Comparing Exes" — one per girl's ex). Generate ONLY scenario #{{currentScenarioIndex}} now.
{{/if}}

BODY CLIP STRUCTURE (what the video will show):
{{bodyClipTemplatesFormatted}}

Generate the scenario now. Remember:
- The chat must feel REAL (natural texting between 18-28 year olds)
- 14-22 messages in the conversation
- The analysis must MATCH the chat content
- personName = "Him" if male, "Her" if female
- messageInsights[].message must be EXACT quotes from the chat
- Include exactly 4-5 messageInsights with proper tag mix for "{{vibe}}" vibe
- All soul type IDs must be from the valid list
- 5 traits per person, no banned traits
- DECODED insights must reveal the EXACT psychological moment
```

---

## 4. DEEPSEEK PROMPT: CONTENT COPY GENERATION

### System Prompt

```
You are a short-form video content writer for TikTok and Instagram Reels. You write hook texts, voiceover scripts, caption overlays, and social media captions for the "Toxic or Nah" relationship chat analysis app.

Your audience is 18-28 year old women who are obsessed with decoding their situationships. Your tone is dramatic, Gen-Z, slightly unhinged, and addictive — like their group chat but as a video.

Your output must be a single valid JSON object. No markdown, no code fences, no explanation — ONLY the JSON.

## OUTPUT FORMAT

{
  "hookText": string,           // The text overlay for the hook clip (8-15 words max)
  "outroText": string,          // CTA text for outro clip (8-12 words)
  "voScript": {
    "sections": [
      {
        "part": string,         // "hook", "body_clip_1", "body_clip_2", etc., "outro"
        "text": string,         // The VO line for this section (1-2 sentences, MAX 15 words per section)
        "duration_hint": string // e.g. "2-3s"
      }
    ]
  },
  "captionPlan": [
    {
      "captionIndex": number,   // Order (1, 2, 3...)
      "part": "hook" | "body" | "outro",
      "text": string,           // Concrete caption text (with emojis if needed)
      "style": "dramatic" | "reaction" | "commentary" | "emphasis" | "cta",
      "position": "top-center" | "bottom-center" | "center",
      "linkedBodyClipIndex": number | null,  // Which body clip (for body captions)
      "startOffsetSec": number, // Offset from start of this part
      "durationSec": number     // How long caption shows
    }
  ],
  "socialCaption": string       // Full post caption with emojis + hashtags (150-250 chars)
}

## RULES

1. **Hook text**: Must be scroll-stopping. Short, dramatic, makes you NEED to watch. Use "..." for suspense. Examples:
   - "This chat gave me chills..."
   - "POV: his texts decoded 💀"
   - "I should NOT have analyzed this"

2. **VO script**: Spoken by the AI girl persona. She sounds like she's reacting in real-time while showing the app. Keep it NATURAL — not scripted-sounding. Use filler words occasionally ("like", "omg", "wait").
   - Each section ≤15 words (must fit in 2-3 seconds of speech)
   - Hook section: dramatic opener, 1 sentence
   - Body sections: react to what's on screen (score, soul type, decoded message, etc.)
   - Outro section: CTA ("link in bio")

3. **Caption plan**: These are text overlays that appear on the video. They reinforce what's happening.
   - Total captions: 4-7 per video
   - Hook should have 1 caption (the hook text)
   - Each body clip should have 0-1 caption
   - Outro should have 1 caption (CTA)
   - Use {{variables}} ONLY from this list: {{toxicity_score}}, {{soul_type_name}}, {{person_name}}, {{contact_name}}

4. **Social caption**: For TikTok/Instagram post description.
   - Dramatic or relatable opening line
   - 1-2 relevant emojis
   - End with 3-5 hashtags: always include #toxicornah #redflag #relationships + 2 relevant ones
   - Keep under 250 characters total

5. **Concept-specific rules**: Adapt to the video concept structure provided.
```

### User Prompt Template

```
Generate all content copy for this scenario:

## SCENARIO
{{scenarioJSON}}

## CONCEPT
Name: {{conceptName}}
Description: {{conceptDescription}}

## BODY CLIP STRUCTURE
{{bodyClipTemplatesFormatted}}
(VO script must have one section per clip above, plus hook and outro)

## VO TEMPLATE
Tone: {{voTone}}
Instructions: {{voInstructions}}
Example scripts for reference:
{{voExampleScripts}}

## HOOK TEXT EXAMPLES (for inspiration, don't copy exactly)
{{hookTextPoolFormatted}}

## SOCIAL COPY EXAMPLES (for style reference)
{{socialCopyExamplesFormatted}}

## CAPTION TEMPLATE PATTERN
{{captionTemplatesFormatted}}

Key data to use in captions:
- Toxicity Score: {{overallScore}}
- Person Soul Type: {{personSoulTypeName}}
- Contact Name: {{contactName}}
- Person Name: {{personName}}

Generate the content copy JSON now.
```

---

## 5. VALIDATION CODE (JavaScript for n8n Code Nodes)

### Node 2: Select Concept

```javascript
// NODE 2: Select Concept — weighted random + params
const concepts = $input.all().map(item => item.json);

// --- Weighted random selection ---
function weightedRandom(items, weightField) {
  const totalWeight = items.reduce((sum, item) => sum + (Number(item[weightField]) || 1), 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= (Number(item[weightField]) || 1);
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

const concept = weightedRandom(concepts, 'weight');

// --- Vibe selection (40% toxic, 25% mixed, 20% decoded, 15% wholesome) ---
function pickVibe() {
  const r = Math.random();
  if (r < 0.40) return 'toxic';
  if (r < 0.65) return 'mixed';
  if (r < 0.85) return 'decoded';
  return 'wholesome';
}

// --- App style (40% imessage, 30% instagram, 30% whatsapp) ---
function pickAppStyle() {
  const r = Math.random();
  if (r < 0.40) return 'imessage';
  if (r < 0.70) return 'instagram';
  return 'whatsapp';
}

// --- Gender (80% male, 20% female) ---
const personGender = Math.random() < 0.80 ? 'male' : 'female';

const vibe = pickVibe();
const appStyle = pickAppStyle();
const scenarioName = `${vibe}-${concept.concept_id}-${Date.now()}`;

return [{
  json: {
    concept,
    vibe,
    appStyle,
    personGender,
    scenarioName,
    conceptId: concept.concept_id
  }
}];
```

### Node 4: Build Scenario Prompt

```javascript
// NODE 4: Build Scenario Prompt
// Inputs: concept (from Node 2), templates (from Nodes 3a-3e)
const { concept, vibe, appStyle, personGender, scenarioName } = $('Select Concept').first().json;

const bodyClipTemplates = $('Get Body Clip Templates').all().map(i => i.json);
const captionTemplates = $('Get Caption Templates').all().map(i => i.json);
const voTemplates = $('Get VO Templates').all().map(i => i.json);
const hookTexts = $('Get Hook Text Pool').all().map(i => i.json);
const socialExamples = $('Get Social Copy Examples').all().map(i => i.json);

// Format body clip templates for the prompt
const bodyClipsFormatted = bodyClipTemplates
  .sort((a, b) => Number(a.clip_index) - Number(b.clip_index))
  .map(t => `  Clip ${t.clip_index}: "${t.clip_label}" (${t.app_section}) — ${t.min_duration_sec}-${t.max_duration_sec}s${t.character_group ? ` [${t.character_group}]` : ''}`)
  .join('\n');

// The system prompt is the full prompt from Section 3 (stored as a variable or in Airtable)
// For n8n: store this in a "Set" node or as a workflow variable
const systemPrompt = `<PASTE THE FULL SYSTEM PROMPT FROM SECTION 3 HERE>`;

const userPrompt = `Generate a ContentScenario JSON with these parameters:

CONCEPT: ${concept.concept_name}
CONCEPT DESCRIPTION: ${concept.description}
VIBE: ${vibe}
APP STYLE: ${appStyle}
PERSON GENDER: ${personGender}
SCENARIO ID: "${scenarioName}"
SCENARIOS NEEDED: ${concept.scenarios_per_video}

BODY CLIP STRUCTURE (what the video will show):
${bodyClipsFormatted}

Generate the scenario now. Remember:
- The chat must feel REAL (natural texting between 18-28 year olds)
- 14-22 messages in the conversation
- The analysis must MATCH the chat content
- personName = "${personGender === 'male' ? 'Him' : 'Her'}"
- messageInsights[].message must be EXACT quotes from the chat
- Include exactly 4-5 messageInsights with proper tag mix for "${vibe}" vibe
- All soul type IDs must be from the valid list
- 5 traits per person, no banned traits
- DECODED insights must reveal the EXACT psychological moment`;

return [{
  json: {
    systemPrompt,
    userPrompt,
    bodyClipsFormatted,
    // Pass templates through for content copy generation later
    captionTemplates,
    voTemplates,
    hookTexts,
    socialExamples
  }
}];
```

### Node 6: Validate Scenario

```javascript
// NODE 6: Validate Scenario JSON
const response = $input.first().json;

// Extract JSON from DeepSeek response
let scenario;
try {
  const content = response.choices[0].message.content;
  scenario = JSON.parse(content);
} catch (e) {
  return [{ json: { valid: false, error: `JSON parse failed: ${e.message}`, scenario: null } }];
}

const errors = [];

// --- Required top-level fields ---
if (!scenario.id) errors.push('Missing id');
if (!scenario.chat) errors.push('Missing chat');
if (!scenario.results) errors.push('Missing results');

if (scenario.chat) {
  if (!scenario.chat.contactName) errors.push('Missing chat.contactName');
  if (!['imessage', 'instagram', 'whatsapp'].includes(scenario.chat.appStyle)) {
    errors.push(`Invalid appStyle: ${scenario.chat.appStyle}`);
  }
  if (!Array.isArray(scenario.chat.messages) || scenario.chat.messages.length < 12) {
    errors.push(`Too few messages: ${scenario.chat?.messages?.length || 0} (min 12)`);
  }
  if (scenario.chat.messages && scenario.chat.messages.length > 25) {
    errors.push(`Too many messages: ${scenario.chat.messages.length} (max 25)`);
  }
  // Validate each message
  if (scenario.chat.messages) {
    scenario.chat.messages.forEach((msg, i) => {
      if (!['them', 'me'].includes(msg.sender)) errors.push(`Message ${i}: invalid sender "${msg.sender}"`);
      if (!msg.text || typeof msg.text !== 'string') errors.push(`Message ${i}: missing or invalid text`);
    });
  }
}

const r = scenario.results;
if (r) {
  // --- personName ---
  const expectedName = r.personGender === 'male' ? 'Him' : 'Her';
  if (r.personName !== expectedName) {
    errors.push(`personName should be "${expectedName}", got "${r.personName}"`);
    r.personName = expectedName; // Auto-fix
  }

  // --- Scores 0-100 ---
  const scoreFields = ['overallScore', 'warmthScore', 'communicationScore', 'dramaScore', 'distanceScore', 'passionScore'];
  scoreFields.forEach(field => {
    const val = r[field];
    if (typeof val !== 'number' || val < 0 || val > 100) {
      errors.push(`${field} out of range: ${val}`);
    }
  });

  // --- Vibe coherence ---
  const { vibe } = $('Select Concept').first().json;
  if (vibe === 'toxic' && r.overallScore > 40) {
    errors.push(`Toxic vibe but overallScore=${r.overallScore} (should be ≤40)`);
  }
  if (vibe === 'wholesome' && r.overallScore < 65) {
    errors.push(`Wholesome vibe but overallScore=${r.overallScore} (should be ≥65)`);
  }

  // --- Valid soul type IDs ---
  const MALE_SOUL_TYPES = [
    'male-untamable', 'male-gentle-flame', 'male-silent-abyss', 'male-faded-crown',
    'male-sweet-poison', 'male-wounded-prince', 'male-burning-promise', 'male-final-silence',
    'male-dark-mirror', 'male-ice-charmer', 'male-silent-choke', 'male-shifting-flame',
    'male-chameleon', 'male-star-collector'
  ];
  const FEMALE_SOUL_TYPES = [
    'female-love-rush', 'female-natural-state', 'female-fire-dance', 'female-frozen-bloom',
    'female-torn-silk', 'female-inner-voice', 'female-silent-venom', 'female-sunset-soul',
    'female-deep-shadow', 'female-wild-luxury', 'female-living-maze', 'female-golden-rule',
    'female-savage-grace', 'female-quiet-storm', 'female-rising-phoenix', 'female-liquid-mirror'
  ];
  const ALL_SOUL_TYPES = [...MALE_SOUL_TYPES, ...FEMALE_SOUL_TYPES];

  if (!ALL_SOUL_TYPES.includes(r.personSoulType)) {
    errors.push(`Invalid personSoulType: "${r.personSoulType}"`);
  }
  if (!ALL_SOUL_TYPES.includes(r.userSoulType)) {
    errors.push(`Invalid userSoulType: "${r.userSoulType}"`);
  }

  // Gender-soul type cross check
  if (r.personGender === 'male' && r.personSoulType && !r.personSoulType.startsWith('male-')) {
    errors.push(`personGender=male but personSoulType="${r.personSoulType}" is not male`);
  }
  if (r.personGender === 'male' && r.userSoulType && !r.userSoulType.startsWith('female-')) {
    errors.push(`personGender=male but userSoulType="${r.userSoulType}" should be female`);
  }
  if (r.personGender === 'female' && r.personSoulType && !r.personSoulType.startsWith('female-')) {
    errors.push(`personGender=female but personSoulType="${r.personSoulType}" is not female`);
  }
  if (r.personGender === 'female' && r.userSoulType && !r.userSoulType.startsWith('male-')) {
    errors.push(`personGender=female but userSoulType="${r.userSoulType}" should be male`);
  }

  // --- Traits ---
  if (!Array.isArray(r.personTraits) || r.personTraits.length !== 5) {
    errors.push(`personTraits must have exactly 5 items, got ${r.personTraits?.length}`);
  }
  if (!Array.isArray(r.userTraits) || r.userTraits.length !== 5) {
    errors.push(`userTraits must have exactly 5 items, got ${r.userTraits?.length}`);
  }

  // Banned traits filter
  const BANNED = ['Early Stage', 'New Connection', 'Fresh Start', 'Getting to Know', 'Just Met', 'Beginning Phase'];
  const allTraits = [...(r.personTraits || []), ...(r.userTraits || [])];
  allTraits.forEach(trait => {
    if (BANNED.some(b => trait.toLowerCase().includes(b.toLowerCase()))) {
      errors.push(`Banned trait found: "${trait}"`);
    }
  });

  // --- Categories ---
  const requiredCategories = ['intentions', 'chemistry', 'effort', 'redFlagsGreenFlags', 'trajectory'];
  requiredCategories.forEach(cat => {
    if (!r.categories?.[cat]?.description) {
      errors.push(`Missing or empty category: ${cat}`);
    }
  });

  // --- Message Insights ---
  if (!Array.isArray(r.messageInsights)) {
    errors.push('messageInsights is not an array');
  } else {
    if (r.messageInsights.length < 3 || r.messageInsights.length > 6) {
      errors.push(`messageInsights count=${r.messageInsights.length} (need 3-6)`);
    }

    // Check each insight's message is an exact quote from chat
    const chatTexts = (scenario.chat?.messages || []).map(m => m.text);
    r.messageInsights.forEach((insight, i) => {
      if (!chatTexts.includes(insight.message)) {
        // Try fuzzy match (trimmed, case-insensitive)
        const fuzzy = chatTexts.find(t =>
          t.trim().toLowerCase() === insight.message.trim().toLowerCase()
        );
        if (fuzzy) {
          insight.message = fuzzy; // Auto-fix to exact match
        } else {
          errors.push(`Insight ${i}: message "${insight.message}" not found in chat messages`);
        }
      }
      if (!['RED FLAG', 'GREEN FLAG', 'DECODED'].includes(insight.tag)) {
        errors.push(`Insight ${i}: invalid tag "${insight.tag}"`);
      }
    });

    // Check DECODED requirement
    const hasDecoded = r.messageInsights.some(i => i.tag === 'DECODED');
    if (!hasDecoded) {
      errors.push('No DECODED insight found (at least 1 required)');
    }

    // Check no greetings selected
    const GREETING_WORDS = ['hi', 'hey', 'hello', 'sup', 'yo'];
    r.messageInsights.forEach((insight, i) => {
      const lower = insight.message.toLowerCase().trim();
      if (GREETING_WORDS.includes(lower)) {
        errors.push(`Insight ${i}: message "${insight.message}" is a basic greeting`);
      }
    });
  }

  // --- Dynamic ---
  if (!r.dynamic?.name) errors.push('Missing dynamic.name');
  if (!r.dynamic?.whyThisHappens) errors.push('Missing dynamic.whyThisHappens');
  if (typeof r.dynamic?.powerBalance !== 'number' || r.dynamic.powerBalance < 0 || r.dynamic.powerBalance > 100) {
    errors.push(`dynamic.powerBalance out of range: ${r.dynamic?.powerBalance}`);
  }
}

const valid = errors.length === 0;

return [{
  json: {
    valid,
    errors,
    scenario: valid || errors.length <= 2 ? scenario : null,
    // Pass through for next nodes
    errorCount: errors.length
  }
}];
```

### Node 7: Build Content Copy Prompt

```javascript
// NODE 7: Build Content Copy Prompt
const { concept, vibe, scenarioName } = $('Select Concept').first().json;
const { scenario } = $('Validate Scenario').first().json;
const { captionTemplates, voTemplates, hookTexts, socialExamples } = $('Build Scenario Prompt').first().json;

// Format VO template
const voTemplate = voTemplates[0]; // One per concept
const voFormatted = voTemplate
  ? `Tone: ${voTemplate.tone}\nInstructions: ${voTemplate.instructions}\nExample scripts:\n${voTemplate.example_scripts}`
  : 'No VO template found — use dramatic, Gen-Z, slightly unhinged tone.';

// Format hook text pool
const hookFormatted = hookTexts
  .filter(h => h.type === 'hook')
  .map(h => `- "${h.text}" (${h.mood})`)
  .join('\n');

const outroFormatted = hookTexts
  .filter(h => h.type === 'outro_cta')
  .map(h => `- "${h.text}"`)
  .join('\n');

// Format social copy examples
const socialFormatted = socialExamples
  .map(s => `[${s.style}]: ${s.caption_text}`)
  .join('\n\n');

// Format caption templates
const captionFormatted = captionTemplates
  .sort((a, b) => Number(a.caption_index) - Number(b.caption_index))
  .map(c => `  #${c.caption_index} [${c.part}] style=${c.style} position=${c.position} @${c.start_offset_sec}s for ${c.duration_sec}s${c.linked_body_clip_index ? ` (clip ${c.linked_body_clip_index})` : ''}\n    Template: "${c.text_template}"`)
  .join('\n');

// Format body clip structure
const bodyClipTemplatesData = $('Get Body Clip Templates').all().map(i => i.json);
const bodyClipsFormatted = bodyClipTemplatesData
  .sort((a, b) => Number(a.clip_index) - Number(b.clip_index))
  .map(t => `  Clip ${t.clip_index}: "${t.clip_label}" (${t.app_section}) — ${t.min_duration_sec}-${t.max_duration_sec}s`)
  .join('\n');

const systemPrompt = `<PASTE THE FULL CONTENT COPY SYSTEM PROMPT FROM SECTION 4 HERE>`;

const userPrompt = `Generate all content copy for this scenario:

## SCENARIO
${JSON.stringify(scenario, null, 2)}

## CONCEPT
Name: ${concept.concept_name}
Description: ${concept.description}

## BODY CLIP STRUCTURE
${bodyClipsFormatted}
(VO script must have one section per clip above, plus hook and outro)

## VO TEMPLATE
${voFormatted}

## HOOK TEXT EXAMPLES (for inspiration, don't copy exactly)
${hookFormatted}

## OUTRO CTA EXAMPLES
${outroFormatted}

## SOCIAL COPY EXAMPLES (for style reference)
${socialFormatted}

## CAPTION TEMPLATE PATTERN
${captionFormatted}

Key data to use in captions:
- Toxicity Score: ${scenario.results.overallScore}
- Person Soul Type: ${scenario.results.personSoulType}
- Contact Name: ${scenario.chat.contactName}
- Person Name: ${scenario.results.personName}

Generate the content copy JSON now.`;

return [{
  json: { systemPrompt, userPrompt, scenario }
}];
```

### Node 9: Validate Content Copy

```javascript
// NODE 9: Validate Content Copy
const response = $input.first().json;
const { scenario } = $('Build Copy Prompt').first().json;

let copy;
try {
  const content = response.choices[0].message.content;
  copy = JSON.parse(content);
} catch (e) {
  return [{ json: { valid: false, error: `JSON parse failed: ${e.message}`, copy: null } }];
}

const errors = [];

// Hook text
if (!copy.hookText || typeof copy.hookText !== 'string') {
  errors.push('Missing hookText');
} else if (copy.hookText.split(' ').length > 20) {
  errors.push(`hookText too long: ${copy.hookText.split(' ').length} words`);
}

// Outro text
if (!copy.outroText || typeof copy.outroText !== 'string') {
  errors.push('Missing outroText');
}

// VO Script
if (!copy.voScript?.sections || !Array.isArray(copy.voScript.sections)) {
  errors.push('Missing or invalid voScript.sections');
} else {
  // Must have hook + body clips + outro sections
  const parts = copy.voScript.sections.map(s => s.part);
  if (!parts.includes('hook')) errors.push('VO missing hook section');
  if (!parts.some(p => p.startsWith('body_clip_'))) errors.push('VO missing body clip sections');
  // Check each section has text
  copy.voScript.sections.forEach((s, i) => {
    if (!s.text || typeof s.text !== 'string') {
      errors.push(`VO section ${i} (${s.part}): missing text`);
    }
  });
}

// Caption plan
if (!Array.isArray(copy.captionPlan)) {
  errors.push('Missing or invalid captionPlan');
} else {
  if (copy.captionPlan.length < 3) errors.push(`Too few captions: ${copy.captionPlan.length}`);
  if (copy.captionPlan.length > 10) errors.push(`Too many captions: ${copy.captionPlan.length}`);
  copy.captionPlan.forEach((c, i) => {
    if (!c.text) errors.push(`Caption ${i}: missing text`);
    if (!['hook', 'body', 'outro'].includes(c.part)) errors.push(`Caption ${i}: invalid part "${c.part}"`);
    if (!['dramatic', 'reaction', 'commentary', 'emphasis', 'cta'].includes(c.style)) {
      errors.push(`Caption ${i}: invalid style "${c.style}"`);
    }
  });
}

// Social caption
if (!copy.socialCaption || typeof copy.socialCaption !== 'string') {
  errors.push('Missing socialCaption');
} else if (!copy.socialCaption.includes('#toxicornah')) {
  errors.push('socialCaption missing #toxicornah hashtag');
}

const valid = errors.length === 0;

return [{
  json: { valid, errors, copy: valid || errors.length <= 3 ? copy : null }
}];
```

---

## 6. TELEGRAM APPROVAL MESSAGES

### Scenario Approval Message (Node 10)

```javascript
// NODE 10: Build Telegram approval message
const { concept, vibe, appStyle, scenarioName } = $('Select Concept').first().json;
const { scenario } = $('Validate Scenario').first().json;
const { copy } = $('Validate Copy').first().json;

const chat = scenario.chat;
const results = scenario.results;

// Preview: first 3 and last 3 messages
const msgs = chat.messages;
const preview = [
  ...msgs.slice(0, 3).map(m => `${m.sender === 'them' ? '👤' : '👩'} ${m.text}`),
  msgs.length > 6 ? `... (${msgs.length - 6} more messages) ...` : '',
  ...msgs.slice(-3).map(m => `${m.sender === 'them' ? '👤' : '👩'} ${m.text}`)
].filter(Boolean).join('\n');

const message = `🎬 *NEW SCENARIO*

📋 *${concept.concept_name}*  |  ${vibe.toUpperCase()}  |  ${appStyle}
🆔 ${scenarioName}

💬 *Chat Preview (${chat.contactName}):*
${preview}

📊 *Scores:*
Health: ${results.overallScore}/100
Warmth: ${results.warmthScore} | Drama: ${results.dramaScore} | Distance: ${results.distanceScore}

🎭 *Soul Types:*
${results.personName}: ${results.personSoulType}
User: ${results.userSoulType}

🏷️ *Profile:* ${results.profileType} — "${results.profileSubtitle}"

🔍 *Insights (${results.messageInsights.length}):*
${results.messageInsights.map(i => `${i.tag === 'RED FLAG' ? '🚩' : i.tag === 'GREEN FLAG' ? '✅' : '🔮'} "${i.title}"`).join('\n')}

⚡ *Dynamic:* ${results.dynamic.name}

🎙️ *Hook:* "${copy.hookText}"
🗣️ *VO Preview:* "${copy.voScript.sections[0]?.text || ''}"
📱 *Social:* ${copy.socialCaption.substring(0, 100)}...`;

return [{
  json: {
    telegramMessage: message,
    scenarioName,
    scenario,
    copy
  }
}];
```

### Telegram Inline Keyboard

```json
{
  "inline_keyboard": [
    [
      { "text": "✅ Approve", "callback_data": "approve_{{scenarioName}}" },
      { "text": "🔄 Regenerate", "callback_data": "redo_{{scenarioName}}" },
      { "text": "❌ Skip", "callback_data": "skip_{{scenarioName}}" }
    ]
  ]
}
```

---

## 7. BATCH MODE

For weekly batch generation (42 scenarios):

### Option A: n8n Loop Node
1. Add a **Loop Over Items** node at the start
2. Create 42 "trigger items" (e.g., via Code node that returns 42 empty items)
3. Each iteration runs the full pipeline above
4. Add a 5-second delay between iterations to avoid rate limits

### Option B: Manual Repeated Trigger
1. Keep the workflow as single-scenario
2. Use n8n's "Execute Workflow" node in a parent workflow
3. Parent workflow loops N times, calling this workflow each time

### Option C: Scheduled Trigger
1. Replace Manual Trigger with Schedule Trigger
2. Run every 30 minutes during a specific day
3. Each run generates 1 scenario
4. 14 hours × 2/hour = 28 scenarios per day → 2 days to fill the week

**Recommendation**: Start with Option A (Loop). Set `count` parameter on Manual Trigger. The loop generates `count` scenarios sequentially.

---

## 8. TESTING CHECKLIST

### Before Going Live
- [ ] Generate 1 toxic scenario → verify chat feels real, scores match vibe
- [ ] Generate 1 wholesome scenario → verify high scores, green flags, warm chat
- [ ] Generate 1 mixed scenario → verify ambiguity, mixed signals
- [ ] Generate 1 decoded scenario → verify 3+ DECODED insights with deep analysis
- [ ] Generate for each appStyle (imessage, instagram, whatsapp)
- [ ] Generate for each concept (sad-happy-girl, before-after, chat-start, comparing-exes)
- [ ] Verify ALL soul type IDs are valid (no typos, no hallucinated IDs)
- [ ] Verify messageInsights messages are exact quotes from chat
- [ ] Verify no banned traits appear
- [ ] Verify personName is always "Him"/"Her" (never the contact name)
- [ ] Verify content copy: VO has correct number of sections matching body clips
- [ ] Verify captions: reasonable count, proper styles, correct parts
- [ ] Verify social caption includes #toxicornah hashtag
- [ ] Test Telegram approval flow (approve, regenerate, skip)
- [ ] Test batch mode: generate 5 in a row → no duplicates, varied concepts/vibes
- [ ] Load a generated scenario into the app via `?scenario={name}` → verify it renders correctly

### Quality Checks (Ongoing)
- [ ] Chat diversity: different texting styles, topics, relationship stages
- [ ] Soul type variety: not always the same few types
- [ ] Score distribution matches vibe percentages
- [ ] No repetitive hook texts or VO scripts
- [ ] DECODED insights are genuinely insightful (not vague)

---

## 9. AIRTABLE IDS REFERENCE

| Table | ID |
|-------|----|
| Base | `appsgjIdkpak2kaXq` |
| Video Concepts | `tblhhTVI4EYofdY32` |
| Body Clip Templates | `tblTcEPaDKKOyKGoL` |
| Caption Templates | `tblxhuowMWTPSQVdb` |
| VO Templates | `tblpyfkR7OdRiwSdo` |
| Hook Text Pool | `tblmCU1lVXEPqP8zK` |
| Social Copy Examples | `tblU1iYIOURfRYdfF` |
| Scenarios | `tblcQaMBBPcOAy0NF` |
| Body Clips | `tblJcmlW99FNxMNXk` |
| Video Runs | `tbltCYcVXrLYvyIJL` |
| Content Library | `tblx1KX7mlTX5QyGb` |
| Execution Logs | `tblQMt0NwVcuXu7OA` |
| Phones | `tblCvT47GpZv29jz9` |
| Music Library | `tblrI9FPHxkfgyrii` |

### Video Concept Record IDs
| Concept | Record ID |
|---------|-----------|
| sad-happy-girl | `reccA9CirWfhOWFWH` |
| before-after | `recq6atQ8xVWPdvcR` |
| chat-start | `rec1CdB5qcseyosK3` |
| comparing-exes | `recMgB8KDxTWpOwIH` |
