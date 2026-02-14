// NODE: Build Scenario Prompt
// Assembles the Gemini prompt from concept data + all templates
// Mode: Run Once for All Items

const { concept, vibe, appStyle, personGender, scenarioName } = $('Select Concept').first().json;

const bodyClipTemplates = $('Get Body Clip Templates').all().map(i => i.json);
const captionTemplates = $('Get Caption Templates').all().map(i => i.json);
const voTemplates = $('Get VO Templates').all().map(i => i.json);
const hookTexts = $('Get Hook Texts').all().map(i => i.json);
const socialExamples = $('Get Social Examples').all().map(i => i.json);

// Format body clip templates for prompt context
const bodyClipsFormatted = bodyClipTemplates
  .sort((a, b) => Number(a.clip_index) - Number(b.clip_index))
  .map(t => {
    const group = t.character_group ? ' [' + t.character_group + ']' : '';
    return '  Clip ' + t.clip_index + ': "' + t.clip_label + '" (' + t.app_section + ') - ' + t.min_duration_sec + '-' + t.max_duration_sec + 's' + group;
  })
  .join('\n');

// ============================================================
// SYSTEM PROMPT
// ============================================================

const systemPrompt = `You are a scenario generator for "Toxic or Nah," a relationship chat analysis app. You create realistic fake text conversations between two people, plus complete analysis results that the app would display.

Your output must be a single valid JSON object matching the ContentScenario interface exactly. No markdown, no code fences, no explanation — ONLY the JSON.

## CONTENT SCENARIO INTERFACE

{
  "id": string,
  "chat": {
    "contactName": string,
    "appStyle": "imessage" | "instagram" | "whatsapp",
    "messages": [
      {
        "sender": "them" | "me",
        "text": string,
        "time"?: string
      }
    ]
  },
  "results": {
    "personName": "Him" | "Her",
    "personGender": "male" | "female",
    "overallScore": number,
    "warmthScore": number,
    "communicationScore": number,
    "dramaScore": number,
    "distanceScore": number,
    "passionScore": number,
    "profileType": string,
    "profileSubtitle": string,
    "profileDescription": string,
    "personSoulType": string,
    "userSoulType": string,
    "personDescription": string,
    "personTraits": [string, string, string, string, string],
    "userDescription": string,
    "userTraits": [string, string, string, string, string],
    "categories": {
      "intentions":        { "description": string },
      "chemistry":         { "description": string },
      "effort":            { "description": string },
      "redFlagsGreenFlags": { "description": string },
      "trajectory":        { "description": string }
    },
    "messageInsights": [
      {
        "message": string,
        "title": string,
        "tag": "RED FLAG" | "GREEN FLAG" | "DECODED",
        "description": string,
        "solution": string
      }
    ],
    "dynamic": {
      "name": string,
      "subtitle": string,
      "whyThisHappens": string,
      "patternBreak": string,
      "powerBalance": number
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

1. personName: ALWAYS "Him" if male, "Her" if female. NEVER use the contactName.
2. messageInsights[].message: MUST be an EXACT copy-paste from chat.messages[].text. Character-for-character identical.
3. messageInsights tags: Include a MIX of tags. Minimum 1 DECODED insight per scenario.
4. messageInsights selection: ONLY select genuinely noteworthy messages. NEVER select "hi", "hey", "hello", "what's up" or basic greetings.
5. Insight titles: The title must describe what the MESSAGE SENDER is doing. Ask: "Who sent this message? What is THEIR action? Does my title describe THEIR action?"
6. Soul type match: personSoulType must match the person's actual behavior in the chat.
7. Score coherence: overallScore must ALWAYS be between 15-30 (toxic score = 100 - overallScore, so toxic score is always 70+). This applies to ALL vibes.
8. BANNED traits: NEVER use "Early Stage", "New Connection", "Fresh Start", "Getting to Know", "Just Met", "Beginning Phase".
9. personDescription / userDescription: Describe WHO they ARE as a person (personality, patterns). NOT what happened in this chat.
10. Category descriptions: Analyze what actually happens in THIS chat. Be specific, reference actual messages.
11. DECODED insights: Decode the EXACT psychological moment — what they said, what they're feeling, why THIS response, what it reveals.
12. No timestamps in message text: Timestamps go in the separate "time" field.
13. Natural texting: lowercase, abbreviations (wyd, lol, ngl, tbh, omg), emojis where natural. Real 18-28 year olds.
14. Conversation flow: Messages must flow naturally. No random topic jumps.

## VIRAL CHAT RULES — THIS IS THE #1 PRIORITY

The chat MUST make viewers STOP SCROLLING. Every chat must have at least ONE moment that makes you go "oh HELL no" or "wait WHAT did he just say?!". Think about what gets millions of views on TikTok relationship content:

TOXIC PATTERNS TO USE (pick 2-3 per chat):
- Gaslighting ("I never said that", "you're being dramatic", "that's not what happened")
- Love bombing then going cold ("you're my everything" → *3 days later* → "idk what we are")
- Guilt tripping ("after everything I've done for you")
- Caught lying ("who's Sarah?" "my cousin" → but context reveals it's not)
- Breadcrumbing ("miss you" at 2am then disappears for a week)
- Passive aggressive ("k", "whatever you want", "I'm fine")
- DARVO (Deny, Attack, Reverse Victim and Offender — "YOU'RE the one who...")
- Double standards ("I can hang out with whoever but you can't")
- Future faking ("we should move in together" but never follows through)
- Dismissing feelings ("why are you making this a big deal", "you always overreact")

CHAT STRUCTURE FOR VIRALITY:
- Start normalish, then escalate — the toxic moment hits mid-chat or at the end
- Include at least ONE message that viewers would screenshot and send to their group chat
- The "me" (user) should be reasonable — the toxicity comes from "them"
- Include moments where "me" calls him out OR moments where she misses the red flag (both are viral)
- Natural texting: lowercase, abbreviations (wyd, lol, ngl, tbh), emojis. NOT formal grammar.
- Some messages should be short punchy texts, not paragraphs

BAD CHAT (boring, not viral — NEVER generate this):
- "Hey how's your week?" "Good, you?" "Want to grab dinner?" "Sure!" "Great see you at 8"
- Normal planning conversations
- Two people being nice to each other with no tension

GOOD CHAT (viral, toxic, dramatic):
- "who was that girl in your story" "what girl" "the one literally hanging on you" "she's just a friend calm down" "then why did she comment 'my man 😍' on your post" "bro you're so insecure it's actually unattractive"
- HE escalates, deflects, manipulates. She either catches him or misses it.

## VIBE RULES

### toxic (overallScore: 15-30)
- warmthScore: 10-25, communicationScore: 15-30, dramaScore: 65-85, distanceScore: 70-90, passionScore: 10-25
- profileType examples: "Red Flag Alert", "Toxic Pattern", "Danger Zone", "Walking Red Flag"
- messageInsights: 2-3 RED FLAG, 0-1 GREEN FLAG, 1-2 DECODED
- Person soul types (male): ice-charmer, dark-mirror, silent-choke, sweet-poison, final-silence, star-collector, faded-crown
- powerBalance: 15-35 (person has more power)

### wholesome (overallScore: 20-30)
- warmthScore: 55-75, communicationScore: 55-70, dramaScore: 15-30, distanceScore: 15-30, passionScore: 55-75
- profileType examples: "Green Light", "Healthy Connection", "The Real Deal", "Keeper Alert"
- messageInsights: 0-1 RED FLAG, 2-3 GREEN FLAG, 1-2 DECODED
- Person soul types (male): gentle-flame, burning-promise, untamable
- powerBalance: 40-60 (balanced)

### mixed (overallScore: 20-30)
- warmthScore: 30-50, communicationScore: 25-45, dramaScore: 45-65, distanceScore: 50-70, passionScore: 25-50
- profileType examples: "Mixed Signals", "Proceed with Caution", "Gray Area", "Situationship Energy"
- messageInsights: 1-2 RED FLAG, 1-2 GREEN FLAG, 1-2 DECODED
- Person soul types: shifting-flame, chameleon, wounded-prince, frozen-bloom, torn-silk
- powerBalance: 30-50

### decoded (overallScore: 15-30)
- Focus on HIDDEN MEANING, subtext
- profileType examples: "Hidden Layers", "Read Between The Lines", "Not What It Seems"
- messageInsights: 0-1 RED FLAG, 0-1 GREEN FLAG, 3-4 DECODED
- Person soul types: any`;

// ============================================================
// USER PROMPT
// ============================================================

const userPrompt = `Generate a ContentScenario JSON with these parameters:

CONCEPT: ${concept.concept_name}
CONCEPT DESCRIPTION: ${concept.description || 'General relationship chat analysis video'}
VIBE: ${vibe}
APP STYLE: ${appStyle}
PERSON GENDER: ${personGender}
SCENARIO ID: "${scenarioName}"
SCENARIOS NEEDED: ${concept.scenarios_per_video || 1}

BODY CLIP STRUCTURE (what the video will show):
${bodyClipsFormatted}

Generate the scenario now. Remember:
- The chat must be VIRAL — dramatic, toxic, the kind that gets millions of views on TikTok
- At least ONE moment where viewers would screenshot and send to their group chat
- Real texting style (lowercase, abbreviations, emojis) but TOXIC content
- 14-22 messages in the conversation
- The analysis must MATCH the chat content
- personName = "${personGender === 'male' ? 'Him' : 'Her'}"
- messageInsights[].message must be EXACT quotes from the chat
- Include exactly 4-5 messageInsights with proper tag mix for "${vibe}" vibe
- All soul type IDs must be from the valid list
- 5 traits per person, no banned traits
- DECODED insights must reveal the EXACT psychological moment`;

// Output system + user prompts for the Basic LLM Chain node (Gemini 2.0 Flash)
return [{
  json: {
    systemPrompt,
    userPrompt,
    // Pass templates through for content copy generation later
    bodyClipsFormatted,
    captionTemplates,
    voTemplates,
    hookTexts,
    socialExamples
  }
}];
