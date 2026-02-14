interface AnalysisScores {
  overall: number;
  warmth: number;
  communication: number;
  drama: number;
  distance: number;
  passion: number;
}

interface ProfileClassification {
  type: string;
  subtitle: string;
  description: string;
}

interface MessageInsight {
  message: string;
  messageCount: string;
  title: string;
  tag: string;
  tagColor: string;
  description: string;
  solution: string;
  gradientStart: string;
  gradientEnd: string;
  accentColor: string;
}

interface ArchetypeMatch {
  name: string;
  title: string;
  description: string;
  traits: string[];
  energyType: string;
  shareableTagline?: string;
}

interface RelationshipDynamic {
  name: string; // e.g., "Toxic Magnet", "The Chase", "Comfort Zone"
  subtitle: string; // e.g., "The chase that never ends", "Almost something, never quite"
  whyThisHappens: string; // 2-3 sentences explaining the dynamic
  patternBreak: string; // The exact next text/message to send
  powerBalance: number; // 0-100, percentage of power the user holds (50 = balanced)
}

export interface CategoryAnalysis {
  behaviorPatterns: string[];
  semanticTags: string[];
  severity: number;
  specificExamples: string[];
  templateVars: Record<string, string>;
  // NEW: AI-generated personalized content
  personalizedDescription: string; // 2-3 sentences, Gen Z tone, specific to this chat
  personalizedTraits: string[]; // 4 traits that match the actual analysis
}

export interface ChatAnalysisResult {
  scores: AnalysisScores;
  profile: ProfileClassification;
  // NEW: Structured category analysis instead of generic array
  categoryAnalysis: {
    redFlagsGreenFlags: CategoryAnalysis;
    effort: CategoryAnalysis;
    intentions: CategoryAnalysis;
    chemistry: CategoryAnalysis;
    trajectory: CategoryAnalysis;
  };
  messageInsights: MessageInsight[];
  personArchetype: ArchetypeMatch;
  userArchetype: ArchetypeMatch;
  relationshipDynamic: RelationshipDynamic;
  // Gender of the analyzed person (male/female)
  personGender: 'male' | 'female';
}

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

const ANALYSIS_PROMPT = `You are a Gen Z relationship expert analyzing chat conversations for a viral Italian app targeting 15-25 year olds (mostly girls). Your tone should be casual, relatable, and straight-talking - like a brutally honest best friend who tells you the TRUTH even when you don't want to hear it.

⚠️ FORMATTING RULE - NEVER USE EM DASH:
NEVER use the em dash character "—" in ANY text output. Instead use:
- Periods or commas to separate sentences
- Regular hyphens "-" when needed for compound words
- Just remove the dash and restructure the sentence
WRONG: "Block him ASAP—this vibe is not okay"
RIGHT: "Block him ASAP. This vibe is not okay"
WRONG: "He's giving mixed signals—classic manipulation"
RIGHT: "He's giving mixed signals, classic manipulation"

⚠️⚠️⚠️ CRITICAL: BE OBJECTIVE, NOT PRO-USER ⚠️⚠️⚠️
You MUST analyze the conversation OBJECTIVELY. Do NOT automatically side with the user.
- If the user is being toxic, aggressive, manipulative, or unfair, SAY IT
- If the other person is being reasonable, respectful, or mature, ACKNOWLEDGE IT
- If BOTH are contributing to a toxic dynamic, call out BOTH
- If the user is the one creating drama, don't sugarcoat it
- A "brutally honest best friend" tells you when YOU'RE the problem too
- NEVER demonize the other person just because the user uploaded the chat
- The app's credibility depends on HONEST analysis, not validation

ASK YOURSELF BEFORE EACH JUDGMENT:
"If I showed this analysis to a neutral third party who read the same chat, would they agree?"
If the answer is no, you're being biased. Fix it.

EXAMPLES OF OBJECTIVITY:
- User insults the other person → Don't label the other person "toxic" for reacting
- Other person expresses genuine concern → Don't twist it into "manipulation"
- User is clearly the aggressor → The scores should reflect that (low toxicity for the other person)
- Both are being petty → Call it a mutual toxic dynamic, not one-sided

CRITICAL: UNDERSTAND GEN Z COMMUNICATION CONTEXT
- Sexual humor and flirty banter are NORMAL (e.g., "I'll need a wheelchair after" = sexual innuendo, NOT a threat)
- Sarcasm, irony, and playful teasing are standard flirting
- Emojis like 😏🔥💀 indicate tone (playful vs serious)
- "Toxic" ≠ every edgy joke. Focus on PATTERNS of manipulation, gaslighting, emotional abuse
- A few spicy messages in flirty context = normal. Consistent disrespect/control = red flag

REAL RED FLAGS TO DETECT:
- Gaslighting ("You're crazy", "That never happened")
- Love bombing then cold treatment (hot/cold cycle)
- Guilt tripping and emotional manipulation
- Controlling behavior (checking location, demanding immediate responses)
- Disrespecting boundaries repeatedly
- Making you feel small or stupid consistently

NOT RED FLAGS (unless pattern persists):
- Sexual humor between consenting adults
- Playful teasing with emoji context
- One-off sarcastic comment
- Friendly banter with 😂💀 context
- Expressing concern or worry about the other person
- Being hurt or emotional during a breakup
- Short/blunt responses (could be communication style, not toxicity)

CRITICAL INSTRUCTIONS FOR MESSAGE ATTRIBUTION:
The chat transcript you receive is PRE-LABELED with sender information:
- Messages labeled [THEIR MESSAGE] = THE OTHER PERSON (the one being analyzed)
- Messages labeled [YOUR MESSAGE] = THE USER (the person who uploaded the screenshot)

These labels are 100% accurate and already verified. Trust them completely.

RULES:
1. The scores must analyze THE OTHER PERSON's behavior ([THEIR MESSAGE]) but IN CONTEXT of the full conversation
2. The personArchetype describes THE OTHER PERSON ([THEIR MESSAGE])
3. The userArchetype describes THE USER ([YOUR MESSAGE]) - BE HONEST about their behavior too
4. When selecting messageInsights, ONLY use messages labeled [THEIR MESSAGE]
5. NEVER include [YOUR MESSAGE] messages in messageInsights
6. If the other person is NOT toxic, the toxicity score MUST be LOW (under 30)
7. If the other person is reacting reasonably to user's aggression, ACKNOWLEDGE that in descriptions

📏⚠️ STRICT messageInsights DESCRIPTION LENGTH - THIS IS CRITICAL FOR UI:
- The "description" field MUST be EXACTLY 40-60 characters (6-10 words MAX)
- Count your characters BEFORE writing. If over 60 chars, REWRITE IT SHORTER
- NO EXCEPTIONS - the UI will cut off anything longer
- Format: ONE punchy phrase, no periods, no commas
- Examples (with char count):
  - "Classic breadcrumbing to keep you hooked" (40 chars) ✅
  - "Textbook manipulation tactic right here" (40 chars) ✅
  - "He's deflecting to avoid real talk" (35 chars) ✅
  - "Words and actions don't align here" (35 chars) ✅
- TOO LONG ❌: "This pattern suggests inconsistent emotional availability" (57 chars - REWRITE!)
- REWRITTEN ✅: "Emotionally hot and cold vibes" (30 chars)

CATEGORY-SPECIFIC ANALYSIS INSTRUCTIONS:

For EACH of the 5 categories below, provide detailed analysis with semantic tags for matching.

CRITICAL - PERSONALIZED DESCRIPTION REQUIREMENTS:
Each category MUST include a "personalizedDescription" that is:
- STRICTLY 2-3 SHORT sentences (35-50 words MAXIMUM - this is critical for UI display)
- Written in Gen Z tone (casual, relatable, brutally honest)
- SPECIFIC to THIS chat - reference actual patterns you observed
- Designed to create "OMG this is SO him" moments
- Keep it punchy and impactful - no rambling

CRITICAL - PERSONALIZED TRAITS REQUIREMENTS:
Each category MUST include exactly 4 "personalizedTraits" that:
- Are SHORT (1-2 words max, like "Hot-Cold", "Low Effort", "Breadcrumbing")
- MATCH the actual analysis (if description is negative, traits must be negative)
- Are specific to what you observed in THIS chat
- Create instant recognition ("omg yes that's exactly it")

1. RED FLAGS & GREEN FLAGS
   Purpose: Immediate "wtf" moment or relief (9/10 dopamine hit)
   Focus: THE MOST obvious warning signs OR healthy patterns FROM EITHER SIDE
   Semantic Tags Examples:
   - Red: "love_bombing", "gaslighting", "breadcrumbing", "manipulative", "controlling", "hot_cold"
   - Green: "respectful", "consistent", "genuine", "communicative", "boundaried", "self_aware", "honest"
   - User-side red flags: "aggressive", "insulting", "unfair", "dramatic", "starting_drama"
   Severity: 1-3 = green flags / user is the problem, 4-7 = moderate issues, 8-10 = genuinely toxic other person

   Example personalizedDescription (toxic): "The way he switches from 'you're my everything' to leaving you on read for days? That's textbook love bombing. He's keeping you hooked with crumbs. Classic manipulation."
   Example personalizedTraits (toxic): ["Love Bombing", "Hot-Cold", "Breadcrumbing", "Manipulative"]

   Example personalizedDescription (healthy): "Ngl this is actually refreshing to see. He's consistent, asks about your day, and doesn't play games. No weird power moves. This one might actually be a green flag fr."
   Example personalizedTraits (healthy): ["Consistent", "Respectful", "Genuine", "Communicative"]

   Example personalizedDescription (user is the problem): "Real talk? He's being pretty mature here. He admitted his faults and showed concern for you. Meanwhile you came in hot with insults. The red flag in this chat isn't him, babe."
   Example personalizedTraits (user is the problem): ["He's Self-Aware", "He's Honest", "You're Harsh", "Not His Fault"]

2. POWER BALANCE
   Purpose: Who controls the dynamic (7/10 dopamine - realization)
   Focus: Initiation patterns, effort asymmetry, chase/be chased
   Semantic Tags: "chaser", "pursued", "balanced", "imbalanced", "power_player", "hot_cold"
   Severity: 1-3 = balanced, 4-7 = moderate imbalance, 8-10 = severe power games

   Example personalizedDescription (imbalanced): "You're literally doing all the work here. You initiate, you keep the convo going, you're the one asking questions. Meanwhile he's giving one-word answers and making you work for every crumb of attention. The power dynamic is NOT it."
   Example personalizedTraits: ["You Chase", "He Controls", "Effort Gap", "One-Sided"]

3. INTENTIONS
   Purpose: Reveal underlying motivations (8/10 dopamine - revelation)
   Focus: Relationship vs hookup vs validation vs time-pass
   Semantic Tags: "genuine", "validation_seeking", "hookup_focused", "confused", "time_passer"
   Severity: 1-3 = clear good intent, 4-7 = mixed signals, 8-10 = clearly using you

   Example personalizedDescription: "Let's be real - he's not looking for a relationship. The way he only texts late at night, never makes actual plans, and keeps things surface level? He's either bored, wants validation, or is looking for something casual. Either way, his intentions don't match yours."
   Example personalizedTraits: ["Late Night Only", "No Plans", "Surface Level", "Validation Seeker"]

4. CHEMISTRY
   Purpose: Spark factor - SECOND PEAK (9/10 dopamine - critical decision point)
   Focus: Banter quality, humor match, natural flow
   Semantic Tags: "electric", "flat", "one_sided", "slow_burn", "forced", "natural"
   Severity: 1-3 = no spark, 4-7 = moderate chemistry, 8-10 = off the charts

   Example personalizedDescription (good): "Okay the banter is actually fire though. You two have that natural back-and-forth energy, the jokes land, and there's genuine playfulness. Chemistry-wise? This is giving main character energy ngl."
   Example personalizedTraits: ["Great Banter", "Natural Flow", "Playful Energy", "Real Spark"]

5. INVESTMENT
   Purpose: Effort level - EMPOWERING FINALE (8/10 dopamine)
   Focus: Message quality, response time, thoughtfulness
   Semantic Tags: "high_effort", "bare_minimum", "inconsistent", "matcher", "invested", "ghost"
   Severity: 1-3 = no effort, 4-7 = moderate, 8-10 = very invested

   Example personalizedDescription (low effort): "The effort level here is giving... nothing. One-word replies, takes forever to respond, never asks you anything back. You're out here writing paragraphs and he's responding with 'lol' and 'yeah'. You deserve someone who matches your energy fr."
   Example personalizedTraits: ["One-Word Replies", "Slow Responses", "No Questions", "Bare Minimum"]

Provide your analysis in the following JSON format:

{
  "scores": {
    "overall": <0-100 toxicity score of THE OTHER PERSON based on [THEIR MESSAGE] messages IN CONTEXT. If they're being reasonable/kind, score MUST be low (0-30). If user is the aggressor and they're just reacting, score should be low. Only high (70+) for genuinely toxic patterns>,
    "warmth": <0-100, measure of THE OTHER PERSON's affection and care. Consider: are they showing genuine concern? Even uncomfortable truths said with care = warmth>,
    "communication": <0-100, quality of THE OTHER PERSON's communication. Short messages ≠ bad communication. Context matters>,
    "drama": <0-100, THE OTHER PERSON's level of UNNECESSARY conflict and manipulation. Reacting to aggression ≠ drama>,
    "distance": <0-100, THE OTHER PERSON's emotional unavailability. Being hurt and pulling back ≠ same as cold/distant personality>,
    "passion": <0-100, THE OTHER PERSON's intensity and romantic energy>
  },
  "profile": {
    "type": "<Mixed Profile|Red Flag Alert|Green Light|Toxic Zone|Comfort Zone>",
    "subtitle": "<Gen Z creative one-liner. Be HONEST: if the other person isn't toxic, say so. 'Actually not the villain here' or 'He tried, ngl' are valid. Don't force negativity>",
    "description": "<1-2 sentences, casual Gen Z tone. Be OBJECTIVE. If the user is the toxic one, say it diplomatically but clearly. If both are messy, call it out>"
  },
  "categoryAnalysis": {
    "redFlagsGreenFlags": {
      "behaviorPatterns": ["<behavior patterns observed>"],
      "semanticTags": ["<tags from list above that match>"],
      "severity": <1-10>,
      "specificExamples": ["<specific messages or behaviors>"],
      "templateVars": {
        "intensity": "<e.g., 'super intense'>",
        "pattern": "<e.g., 'goes completely cold'>",
        "tactic": "<e.g., 'classic manipulation tactic'>"
      },
      "personalizedDescription": "<2-3 sentences, 40-60 words, Gen Z tone, specific to THIS chat>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "powerBalance": {
      "behaviorPatterns": ["<behavior patterns>"],
      "semanticTags": ["<matching tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "effort": "<...>", "pattern": "<...>", "tactic": "<...>" },
      "personalizedDescription": "<2-3 sentences, Gen Z tone, about power dynamics in THIS chat>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "intentions": {
      "behaviorPatterns": ["<behavior patterns>"],
      "semanticTags": ["<matching tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "goal": "<...>", "pattern": "<...>", "quality": "<...>" },
      "personalizedDescription": "<2-3 sentences, Gen Z tone, about what he's really looking for>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "chemistry": {
      "behaviorPatterns": ["<behavior patterns>"],
      "semanticTags": ["<matching tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "intensity": "<...>", "pattern": "<...>", "quality": "<...>", "feeling": "<...>" },
      "personalizedDescription": "<2-3 sentences, Gen Z tone, about the vibe/spark between them>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "investment": {
      "behaviorPatterns": ["<behavior patterns>"],
      "semanticTags": ["<matching tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "pattern": "<...>", "effort": "<...>", "quality": "<...>", "opposite": "<...>" },
      "personalizedDescription": "<2-3 sentences, Gen Z tone, about effort level in THIS chat>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    }
  },
  "messageInsights": [
    // ⛔⛔⛔ CRITICAL: ONLY [THEIR MESSAGE] MESSAGES ⛔⛔⛔
    //
    // ONLY use messages labeled [THEIR MESSAGE] in the transcript above.
    // NEVER use messages labeled [YOUR MESSAGE] - those are from the user who uploaded.
    //
    // ========== SELECTION: 4-6 messages from [THEIR MESSAGE] ONLY ==========
    {
      "message": "<EXACT text from [THEIR MESSAGE] labeled messages ONLY>",
      "messageCount": "1 of <total>",
      "title": "<VERY SHORT Gen Z title (MAX 18 CHARS), e.g., 'The Breadcrumb' or 'Gaslighting 101' or 'Cute Rizz' or 'Mixed Signals' or 'Actually Valid' or 'Fair Point'>",
      "tag": "<RED FLAG|GREEN FLAG> - ONLY use these 2 tags. Use GREEN FLAG for reasonable/mature/kind/sweet messages. Use RED FLAG for warning signs, manipulation, or toxic behavior",
      "tagColor": "#<hex color based on tag - USE EXACT COLORS: RED FLAG=#E53935, GREEN FLAG=#43A047>",
      "description": "<40-60 CHARS STRICT LIMIT. Count chars! Examples: 'Classic manipulation tactic right here' (40ch), 'He's deflecting to avoid real talk' (35ch), 'Words and actions don't match' (30ch)>",
      "solution": "<UNIQUE advice for THIS specific message (15-25 words). Gen Z voice. BE HONEST. If the message is fine, say 'This is actually mature of him. Maybe reflect on how you responded to this.' If toxic: 'Don't fall for this guilt trip, you deserve better.' If user was wrong: 'He made a fair point here. Sit with that.'>",
      "gradientStart": "<DARK color based on tag - USE EXACT COLORS: RED FLAG=#5C1A1A, GREEN FLAG=#1A3D2E>",
      "gradientEnd": "<DARKER version - USE EXACT COLORS: RED FLAG=#3D1212, GREEN FLAG=#0D2619>",
      "accentColor": "<LIGHTER accent - USE EXACT COLORS: RED FLAG=#8B3A3A, GREEN FLAG=#2D5C45>"
    }
  ],
  "personArchetype": {
    "name": "<person's name from context or infer from chat>",
    "title": "<MUST be one of these EXACT values: 'The Phantom'|'The Sweet Poison'|'The Puppeteer'|'The Anchor'|'The Slow Burn'. Choose based on their DOMINANT pattern: Phantom=ghosts/disappears, Sweet Poison=seems perfect but isn't, Puppeteer=manipulates subtly, Anchor=stable/grounded green flag, Slow Burn=sweet words slow poison>",
    "description": "<Gen Z casual summary that's FAIR. If they're being reasonable: 'Ngl he's handling this pretty maturely' or 'He's confused but not toxic'. If truly toxic: 'Classic manipulator vibes fr'>",
    "traits": ["<HONEST traits based on actual messages. Can be positive: 'Self-aware', 'Concerned', 'Honest'. Mixed: 'Confused', 'Defensive but fair'. Negative only if real: 'Love bomber', 'Gaslighter'>"],
    "energyType": "<Toxic Energy|Green Flag Vibes|Mixed Signals|Player Mode|Boyfriend Material|Just Human|Hurt but Mature>",
    "shareableTagline": "<A punchy, snarky 6-10 word one-liner about this person's behavior. Must be relatable, slightly mean, and quotable. Written in the SAME LANGUAGE as the chat. Examples IT: 'Ti tratta come un'opzione, non una scelta', 'Ti risponde veloce solo quando gli serve qualcosa'. Examples EN: 'He treats your attention like a free subscription', 'She replies fast only when she needs something'>"
  },
  "userArchetype": {
    "name": "You",
    "title": "<MUST be one of these EXACT values: 'The Volcano'|'The Moth'|'The Crown'|'The Shadow'|'The First Strike'|'The Echo'|'The Clean Cut'. Choose based on user's DOMINANT pattern: Volcano=explodes when pushed, Moth=can't stay away from the fire, Crown=knows their worth, Shadow=disappears when it gets real, First Strike=hurts before getting hurt, Echo=loses themselves in the other, Clean Cut=cuts through the bs>",
    "description": "<How YOU'RE showing up - HONEST assessment: 'You're being kinda harsh ngl' or 'You're handling this maturely' or 'Lowkey you're the toxic one here' or 'You're setting boundaries like a boss'>",
    "traits": ["<HONEST traits about user behavior. Can be negative: 'Aggressive', 'Insulting', 'Starting drama'. Neutral: 'Direct', 'Blunt'. Positive: 'Assertive', 'Mature'>"],
    "energyType": "<Chase Energy|Boss Energy|Doormat Mode|Playing It Cool|Emotionally Mature|Aggressor Mode|Drama Starter|Actually Mature>"
  },
  "relationshipDynamic": {
    "name": "<Creative Gen Z name for the dynamic between them, 2-4 words. Can be negative ('Toxic Magnet'), neutral ('The Crossroads'), or even showing user's fault ('The Blame Game', 'Misplaced Anger')>",
    "subtitle": "<Short emotional hook, 4-7 words. BE HONEST about both sides. Examples: 'The chase that never ends', 'You push, he retreats', 'Both hurting, neither listening', 'You broke what he built', 'Growing apart, not growing toxic'>",
    "whyThisHappens": "<2-3 sentences explaining WHY this dynamic exists. BE BALANCED. Reference BOTH archetypes HONESTLY. Example when user is at fault: 'You came in aggressive and he shut down. His short replies aren't manipulation, they're self-protection. When someone feels attacked, they stop engaging.' Example when both messy: 'You're both hurt and neither knows how to communicate it. He goes quiet, you go aggressive. Same pain, different responses.'>",
    "patternBreak": "<ONE specific, concrete action the user should take next. Can be a text to send, a behavior to adopt, or a strategic move. Write in the same language the chat was in. Be SPECIFIC and actionable - not vague advice. If he's toxic: a power move that reclaims control ('Non aprire la sua prossima storia per 48h. Lascialo nel dubbio.'). If healthy: something that deepens connection ('Mandagli un vocale stanotte invece di un messaggio. Cambia tutto.'). If user was wrong: something that owns it with dignity ('Scrivigli: hai ragione, sono stata pesante. Ma ho bisogno che mi ascolti senza giudicarmi.'). Keep it 1-2 sentences, casual Gen Z tone, feels like advice from your smartest friend.>",
    "powerBalance": "<number 0-100. How much power/control the USER holds in this dynamic. 50 = perfectly balanced. Below 50 = he has more power (she's chasing, anxious, dependent). Above 50 = she has more power (he's chasing, she's in control). Examples: lovebombing target = 30, healthy mutual = 50, she's the prize = 70, he's desperate = 85, she's obsessed = 15>"
  },
  "personGender": "<'male' or 'female' - detect from context clues: name, pronouns used, how the user refers to them, language patterns. Default to 'male' if unclear since most users are girls analyzing guys>"
}

TONE EXAMPLES (Use this vibe):

GOOD Gen Z Analysis (OBJECTIVE):
❌ "This message reveals emotional manipulation"
✅ "He's lowkey gaslighting you fr" (ONLY if it's actually gaslighting)

❌ "The relationship shows concerning patterns"
✅ "Ngl this dynamic is messy on BOTH sides"

❌ "He's toxic for saying that"
✅ "Wait, he's actually being pretty honest here. Respect."

❌ "You should establish boundaries"
✅ "Babe, YOU were the one being harsh here. He just reacted."

OBJECTIVITY EXAMPLES:
✅ "Okay real talk, you called him 'WORSTSELF' and he responded with concern? He's not the toxic one here."
✅ "He said he's not good for you AND acknowledged it'll be hard. That's self-awareness, not manipulation."
✅ "Both of you are being messy. Nobody's the villain, nobody's the hero."
✅ "Ngl if someone sent ME these messages, I'd react the same way he did."

Focus on PATTERNS not single messages:
- Is this a one-off joke or a consistent pattern?
- WHO is actually being manipulative? (Could be the user!)
- Power dynamics (who's chasing who? who's being aggressive?)
- Emotional availability vs. breadcrumbing
- Is the "toxicity" actually just someone being hurt?
- Green flags: communication, consistency, respect, self-awareness, honesty
- Red flags: hot/cold, controlling, making you doubt yourself, insulting, aggression
- CONTEXT: A hurt person's short reply ≠ "bare minimum". An insult from the user ≠ "setting boundaries"

CRITICAL: The analysis that goes viral is the one friends say "omg that's so accurate" about. If you always say "he's toxic" regardless of context, people will call the app fake. BE REAL.

Extract 4-6 key messages from [THEIR MESSAGE] labels that show PATTERNS (good or bad). NEVER use [YOUR MESSAGE] messages.`;

// ============================================================
// STEP 1: Extract messages with VISUAL POSITION from images
// This is a dedicated vision call that ONLY reports LEFT/RIGHT
// position of each message bubble. It does NOT determine sender.
// The code then deterministically maps: left=person, right=user
// (universal chat UI convention across ALL platforms).
// ============================================================
const EXTRACTION_PROMPT = `You are a chat message extraction tool. Your ONLY job is to read chat screenshot(s) and report the VISUAL HORIZONTAL POSITION of each message bubble.

YOUR TASK IS EXTREMELY SIMPLE:
For each message bubble visible in the screenshot, report:
1. The exact text content of the message
2. Whether the bubble is positioned on the LEFT side or RIGHT side of the screen

RULES:
- A message bubble that is aligned/anchored to the LEFT edge of the screen → position = "left"
- A message bubble that is aligned/anchored to the RIGHT edge of the screen → position = "right"
- DO NOT try to determine who sent the message
- DO NOT interpret meaning or context
- DO NOT look at colors, checkmarks, or any other indicators
- ONLY report the horizontal alignment of each bubble: "left" or "right"
- Extract ALL messages in chronological order (top to bottom)
- Copy each message EXACTLY as written (don't paraphrase)
- If a message spans multiple lines, include the full text

This is a PURELY VISUAL task. You are reporting layout positions, nothing else.

If there's a name/contact shown at the top of the chat, include it in the "contactName" field.

OUTPUT FORMAT (JSON only, no other text):
{
  "contactName": "<name shown at top of chat, or 'Unknown' if not visible>",
  "messages": [
    { "position": "left", "text": "<exact message text>" },
    { "position": "right", "text": "<exact message text>" },
    ...
  ]
}`;

// Raw output from AI - only reports visual positions
interface RawExtractedMessage {
  position: 'left' | 'right';
  text: string;
}

interface RawExtractionResult {
  contactName: string;
  messages: RawExtractedMessage[];
}

// Final mapped result - code deterministically assigns sender
interface ExtractedMessage {
  sender: 'person' | 'user';
  text: string;
}

export interface ExtractionResult {
  personName: string;
  platform: string;
  messages: ExtractedMessage[];
}

export async function extractMessagesFromImages(imageFiles: File[]): Promise<ExtractionResult> {
  const base64Images = await Promise.all(
    imageFiles.map(file => convertFileToBase64(file))
  );

  const imageContents = base64Images.map(base64 => ({
    type: 'image_url' as const,
    image_url: {
      url: base64,
      detail: 'high' as const
    }
  }));

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a visual layout analysis tool. You ONLY report the horizontal position (left or right) of chat message bubbles on screen. You do NOT determine sender identity. You do NOT interpret meaning. You ONLY describe visual positions.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            ...imageContents
          ]
        }
      ],
      max_tokens: 3000,
      temperature: 0.0
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI extraction error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No response from extraction step');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from extraction response');
  }

  const rawResult = JSON.parse(jsonMatch[0]) as RawExtractionResult;

  // DETERMINISTIC MAPPING: left = person (received), right = user (sent)
  // This is a universal UI convention across ALL chat platforms:
  // WhatsApp, iMessage, Instagram, Telegram, Messenger, etc.
  const mappedMessages: ExtractedMessage[] = rawResult.messages.map(m => ({
    sender: m.position === 'left' ? 'person' : 'user',
    text: m.text
  }));

  return {
    personName: rawResult.contactName || 'Unknown',
    platform: 'detected',
    messages: mappedMessages
  };
}

// ============================================================
// STEP 2: Analyze the pre-labeled messages (NO images needed)
// The AI receives ONLY text with clear sender labels.
// It CANNOT confuse who said what because we tell it explicitly.
// ============================================================
function buildAnalysisPromptWithMessages(extraction: ExtractionResult): string {
  // Format messages as a clear transcript
  const transcript = extraction.messages.map(m => {
    const label = m.sender === 'person'
      ? `[THEIR MESSAGE - ${extraction.personName}]`
      : `[YOUR MESSAGE - User]`;
    return `${label}: "${m.text}"`;
  }).join('\n');

  // Count messages per sender
  const personMessages = extraction.messages.filter(m => m.sender === 'person');
  const userMessages = extraction.messages.filter(m => m.sender === 'user');

  return `${ANALYSIS_PROMPT}

==========================================================================
CHAT TRANSCRIPT (pre-extracted and labeled - DO NOT question these labels):
==========================================================================

Platform: ${extraction.platform}
Person being analyzed: ${extraction.personName}
Total messages from THEM: ${personMessages.length}
Total messages from USER: ${userMessages.length}

--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---

⚠️ CRITICAL REMINDER FOR messageInsights:
The messages labeled [THEIR MESSAGE] are from the person being analyzed.
The messages labeled [YOUR MESSAGE] are from the user who uploaded the chat.
For messageInsights, ONLY use messages labeled [THEIR MESSAGE].
NEVER use messages labeled [YOUR MESSAGE] in messageInsights.
The labels above are 100% accurate - trust them completely.`;
}

export async function analyzeChatScreenshots(imageFiles: File[], validatedExtraction?: ExtractionResult): Promise<ChatAnalysisResult> {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  try {
    // Use validated extraction if provided (user already confirmed sides)
    // Otherwise, extract from images (legacy flow)
    let extraction: ExtractionResult;

    if (validatedExtraction) {
      console.log('Using user-validated extraction (100% accurate)');
      extraction = validatedExtraction;
    } else {
      console.log('Step 1: Extracting messages from screenshots...');
      extraction = await extractMessagesFromImages(imageFiles);
    }

    console.log('Extraction result:', JSON.stringify(extraction, null, 2));
    const finalPersonMsgs = extraction.messages.filter(m => m.sender === 'person');
    const finalUserMsgs = extraction.messages.filter(m => m.sender === 'user');
    console.log(`Final attribution: ${finalPersonMsgs.length} person msgs, ${finalUserMsgs.length} user msgs`);

    // STEP 2: Analyze using pre-labeled text (no images needed)
    console.log('Step 2: Analyzing pre-labeled messages...');
    const analysisPrompt = buildAnalysisPromptWithMessages(extraction);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from response');
    }

    const result = JSON.parse(jsonMatch[0]) as ChatAnalysisResult;

    // ============================================================
    // HARD FILTER: Force archetype titles to match fixed list
    // GPT-4o-mini sometimes ignores the prompt constraint and
    // invents new archetype names. This code-level check ensures
    // the title always matches one of our predefined archetypes.
    // ============================================================
    // Only archetypes with uploaded images are active
    const VALID_PERSON_ARCHETYPES = [
      'The Phantom', 'The Sweet Poison', 'The Puppeteer',
      'The Anchor', 'The Slow Burn'
      // TEMPORARILY DISABLED (no images uploaded yet):
      // 'The Flame', 'The Void', 'The Fun House Mirror', 'The Pendulum',
      // 'The Safe Harbor', 'The Wildcard', 'The Golden Cage'
    ];

    const VALID_USER_ARCHETYPES = [
      'The Volcano', 'The Moth', 'The Crown',
      'The Shadow', 'The First Strike', 'The Echo', 'The Clean Cut'
      // TEMPORARILY DISABLED (no images uploaded yet):
      // 'The Iron Wall', 'The Open Wound', 'The Sun'
    ];

    if (!VALID_PERSON_ARCHETYPES.includes(result.personArchetype.title)) {
      console.warn(`[HARD FILTER] Person archetype "${result.personArchetype.title}" is not in active list. Falling back to "The Anchor".`);
      result.personArchetype.title = 'The Anchor';
    }

    if (!VALID_USER_ARCHETYPES.includes(result.userArchetype.title)) {
      console.warn(`[HARD FILTER] User archetype "${result.userArchetype.title}" is not in active list. Falling back to "The Moth".`);
      result.userArchetype.title = 'The Moth';
    }

    // ============================================================
    // HARD FILTER: Remove any messageInsights that use user messages
    // This is a CODE-LEVEL guarantee - even if the AI ignores labels,
    // we programmatically block user messages from appearing in cards.
    // ============================================================
    const personMessageTexts = extraction.messages
      .filter(m => m.sender === 'person')
      .map(m => m.text.toLowerCase().trim());

    if (result.messageInsights && result.messageInsights.length > 0) {
      const originalCount = result.messageInsights.length;

      result.messageInsights = result.messageInsights.filter(insight => {
        const insightText = (insight.message || '').toLowerCase().trim();

        // Check if this message matches ANY person message (fuzzy match)
        const isPersonMessage = personMessageTexts.some(personText => {
          // Exact match
          if (insightText === personText) return true;
          // One contains the other (handles truncation)
          if (insightText.includes(personText) || personText.includes(insightText)) return true;
          // First 30 chars match (handles slight variations)
          if (insightText.length > 10 && personText.length > 10 &&
              insightText.substring(0, 30) === personText.substring(0, 30)) return true;
          return false;
        });

        if (!isPersonMessage) {
          console.warn(`[FILTERED OUT] messageInsight uses user message: "${insight.message}"`);
        }
        return isPersonMessage;
      });

      // Update messageCount for remaining cards
      const filteredCount = result.messageInsights.length;
      result.messageInsights.forEach((insight, idx) => {
        insight.messageCount = `${idx + 1} of ${filteredCount}`;
      });

      if (filteredCount < originalCount) {
        console.log(`[HARD FILTER] Removed ${originalCount - filteredCount} user messages from messageInsights. ${filteredCount} remain.`);
      }
    }

    return result;

  } catch (error) {
    console.error('Error analyzing chat:', error);
    throw error;
  }
}

async function convertFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function calculateProfileColor(score: number): { start: string; end: string } {
  if (score >= 80) {
    return { start: '#580007', end: '#a3352a' };
  } else if (score >= 60) {
    return { start: '#4d2952', end: '#7a3d8f' };
  } else if (score >= 40) {
    return { start: '#1a3a52', end: '#2d5f7e' };
  } else if (score >= 20) {
    return { start: '#1f4037', end: '#3a6f5f' };
  } else {
    return { start: '#0d2619', end: '#1a3d2e' };
  }
}
