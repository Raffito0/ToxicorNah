import { GoogleGenerativeAI } from '@google/generative-ai';
import { ContextReasoning, validateConsistency, inferReasoningFromScores } from '../utils/contextValidator';

// Re-export ContextReasoning for consumers
export type { ContextReasoning };

// ===== HYBRID APPROACH =====
// AI extracts behavioral patterns → Client-side matches to Soul Types
// This is FASTER because we don't send 2000+ tokens of Soul Type reference to AI

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
  title?: string;  // Filled by client-side matching based on observedBehaviors
  description: string;
  traits: string[];
  energyType?: string;  // Filled by client-side matching
  shareableTagline?: string;
  // HYBRID: AI extracts behaviors, client matches to Soul Type
  observedBehaviors: string[];  // e.g., ["ghosting", "hot cold", "manipulation"]
  evidenceMessages?: string[];
}

interface RelationshipDynamic {
  name: string;
  subtitle: string;
  whyThisHappens: string;
  patternBreak: string;
  powerBalance: number;
}

export interface CategoryAnalysis {
  behaviorPatterns: string[];
  semanticTags: string[];
  severity: number;
  specificExamples: string[];
  templateVars: Record<string, string>;
  personalizedDescription: string;
  personalizedTraits: string[];
}

export interface ChatAnalysisResult {
  reasoning?: ContextReasoning;
  scores: AnalysisScores;
  profile: ProfileClassification;
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
  personGender: 'male' | 'female';
}

// Phase 1: Quick analysis result (scores + archetypes only)
export interface QuickAnalysisResult {
  reasoning?: ContextReasoning;
  scores: AnalysisScores;
  profile: ProfileClassification;
  personArchetype: ArchetypeMatch;
  userArchetype: ArchetypeMatch;
  personGender: 'male' | 'female';
}

// Phase 2: Detailed analysis result (cards + insights)
export interface DetailedAnalysisResult {
  reasoning?: ContextReasoning;
  categoryAnalysis: {
    redFlagsGreenFlags: CategoryAnalysis;
    effort: CategoryAnalysis;
    intentions: CategoryAnalysis;
    chemistry: CategoryAnalysis;
    trajectory: CategoryAnalysis;
  };
  messageInsights: MessageInsight[];
  relationshipDynamic: RelationshipDynamic;
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Initialize the Gemini client
const getGeminiClient = () => {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured. Add VITE_GEMINI_API_KEY to your .env file.');
  }
  return new GoogleGenerativeAI(GEMINI_API_KEY);
};

// ============================================
// MANDATORY REASONING BLOCK
// ============================================
// Layer 1 + 2 of the Three-Layer Defense System.
// Forces Gemini to COMMIT to a context assessment BEFORE analyzing.
// Injected into all 3 analysis prompts.
const MANDATORY_REASONING_BLOCK = `
MANDATORY FIRST STEP - CONTEXT REASONING (THIS IS NOT OPTIONAL):
Before you write ANY scores, traits, or analysis, you MUST first fill the "reasoning" object.
The "reasoning" object MUST be the FIRST key in your JSON response. Do this BEFORE everything else.

This forces you to COMMIT to the conversation's vibe BEFORE analyzing individual messages.
Your scores, traits, descriptions, and messageInsights MUST be CONSISTENT with your reasoning.
If your reasoning says "playful" but your traits say "Insecure" - that is WRONG. Fix it.

"reasoning": {
  "overallVibe": "<EXACTLY ONE OF: playful, casual, friendly, romantic, flirty, tense, heated, toxic, mixed>",
  "chatContext": "<ONE sentence describing what is ACTUALLY happening in this conversation>",
  "isMemeOrJoke": <true if the conversation contains meme references, joke games, playful challenges, internet trends, or viral content. false otherwise>,
  "toxicityAssessment": "<EXACTLY ONE OF: none, minimal, moderate, significant, severe>",
  "severityCeiling": <number 1-10. This is the MAXIMUM severity ANY category can have. playful/casual/friendly chats = max 3. romantic/flirty = max 4. tense = max 6. heated/mixed = max 8. toxic = max 10>
}

ABSOLUTE CONSTRAINTS BASED ON YOUR OWN REASONING (VIOLATING THESE = WRONG OUTPUT):
- If overallVibe is "playful", "casual", or "friendly":
  * overall toxicity score MUST be under 25
  * NO category severity can exceed your severityCeiling
  * personalizedTraits MUST be proportional: use "Playful", "Charming", "Flirty", "Sweet", "Chill", "Warm", "Open", "Friendly", "Light", "Easygoing"
  * Do NOT use harsh traits like "Needy", "Insecure", "Attention-seeking", "Ego", "Validation-seeking", "Passive", "Bland" for playful or normal behavior
  * messageInsights should have MINIMUM 3 items (use DECODED for subtext/hidden meaning even in casual chats). RED FLAGs should be rare/zero for casual chats, but DECODED insights are always expected.
  * observedBehaviors must match the vibe: "charming", "warm", "sweet", "caring", "playful" - NOT "ego", "vague", "insecure"
- CRITICAL: "casual" vibe means BOTH people are relaxed and having a normal conversation. If one person is being VULNERABLE (asking about the relationship, expressing needs) and the other is DISMISSING/DEFLECTING/STONEWALLING — that is NOT "casual". That is "tense" or "mixed". Do NOT classify avoidant/dismissive behavior as "casual" just because the tone is calm.
- If overallVibe is "tense" or "mixed" (one person vulnerable, other dismissing):
  * overall toxicity score should be 40-75 depending on severity
  * Avoidant patterns like "lol chill", "why does it matter", "idk", deflecting DTR talks = real red flags
- If overallVibe is "toxic" or toxicityAssessment is "severe":
  * overall toxicity score MUST be above 60
  * RED FLAG messageInsights are expected and should be present
- If isMemeOrJoke is true:
  * Messages that are part of a meme/joke/game MUST NOT be flagged as red flags
  * "How would you describe me?" in a game context = GAME SETUP, NOT ego or insecurity or validation-seeking
  * Joke answers, riddles, wordplay = HUMOR, NOT character assessment material
  * The ABCDEFGHIJK game, "rate me" challenges, truth or dare = GAMES, analyze them as games

CALIBRATION EXAMPLES (what correct reasoning looks like):
1. Playful describe-me game chat (ABCDEFGHIJK, "how would you describe me" challenge):
   → overallVibe="playful", isMemeOrJoke=true, toxicityAssessment="none", severityCeiling=2
   → Behaviors: "charming", "warm", "sweet", "playful" (NOT "ego", "vague", "insecure")
   → No RED FLAGS for game questions. Still decode 3+ moments with DECODED (game dynamics, teasing subtext, power play in humor).
2. Normal casual catch-up ("how was your day", "I'm bored of quarantine"):
   → overallVibe="casual", toxicityAssessment="none", severityCeiling=3
   → Boredom about life/quarantine/work = venting about EXTERNAL situation, NOT about the relationship
3. Flirty banter with sexual humor:
   → overallVibe="flirty", toxicityAssessment="minimal", severityCeiling=4
   → Sexual jokes between consenting people in context = normal flirting, NOT objectification
4. Real manipulation, gaslighting, guilt-tripping:
   → overallVibe="toxic", toxicityAssessment="significant" or "severe", severityCeiling=9-10
   → THIS is where RED FLAGS belong
5. Avoidant/dismissive behavior ("lol chill", "why does it matter", deflecting serious questions, refusing to define the relationship):
   → overallVibe="tense" or "mixed", toxicityAssessment="moderate" or "significant", severityCeiling=7-8
   → Score MUST be 45-75. Dismissing someone's valid emotional needs IS toxic even if the tone is calm
   → A calm tone does NOT equal low toxicity. Emotional unavailability, stonewalling, and deflection are covert toxic patterns
   → RED FLAG messageInsights expected for dismissive responses to genuine vulnerability
5. Mixed signals - some warmth but also inconsistency:
   → overallVibe="mixed", toxicityAssessment="moderate", severityCeiling=6
`;

const TONE_CALIBRATION = `
VOICE & TONE - THIS IS CRITICAL:
You are talking DIRECTLY to the girl who uploaded this chat. She is 18-26.
This is NOT therapy. This is a relationship-drama AI. Your job is to make her say "OH MY GOD THIS IS HIM".

THE GOLDEN RULE: Every sentence you write must be screenshot-able, shareable, and quotable between friends.
If a phrase isn't "quotable", rewrite it shorter and sharper.

ABSOLUTE RULES:
1. ALWAYS address the user as "you" and the other person as "he"/"him" (or "she"/"her" if analyzing a girl)
2. NEVER use "Both individuals", "Both parties", "Both people", "They" when referring to the two people
3. NEVER use academic/clinical words: "reciprocal", "trajectory", "fostered", "individuals", "interaction", "engagement", "indicating", "suggesting", "demonstrates", "exhibits", "appears to be", "seems to suggest", "strained", "resistance to commitment"
4. NEVER write like a therapist or essay: "The conversation is...", "The intentions are...", "There is a positive...", "The effort seems...", "due to his defensiveness", "seeking clarity and security"
5. ALWAYS write like the sharpest, most brutally honest best friend she has
6. NATURAL RHYTHM. Mix short and medium sentences. Not every sentence needs a period after 5 words
7. Use contrast and opposition, but COMBINE them: "You're trying to connect while he keeps pulling away."
8. Truth bombs > explanations. Say what's REALLY happening

WRITING STYLE — RHYTHM IS EVERYTHING:
- Each description: MAX 2-3 sentences. Structure: Insight → Contrast → Closing punch
- MIX sentence lengths: one medium sentence (10-15 words) + one short punch (3-8 words). NOT four 5-word sentences in a row
- COMBINE related ideas into one flowing sentence instead of fragmenting them: "He wants fun, not responsibility" is BETTER than "He wants fun. Not responsibility."
- Opposition can live INSIDE one sentence: "You're making plans while he keeps breaking them."
- End with the strongest line. The last sentence is what she screenshots
- NEVER write 4+ sentences. If you have 4 short fragments, combine them into 2 stronger sentences

SUBJECT VARIATION — ABSOLUTE RULE:
NEVER start 2+ consecutive sentences with "He". Max 1 out of 3 sentences can start with "He".
Rotate subjects: You / He / This / That / The pattern / Now / It
Structure for 3-sentence cards:
  Sentence 1 → his behavior (He...)
  Sentence 2 → effect on her or the dynamic (You... / Now... / That's...)
  Sentence 3 → insight or closing (This... / That's... / The pattern...)
BAD (monotone "He He He"):
- "He avoids accountability. He makes you justify your question. He tries to control the narrative."
- "He shuts down. He deflects. He changes the subject."
- "He's distant. He's avoidant. He won't commit."
GOOD (varied subjects, natural voice):
- "He shuts the conversation down. You start questioning yourself. That's how control works."
- "You ask for clarity. He gives confusion. The pattern repeats."
- "He avoids the question and now you're the one explaining yourself. That's the shift."
- "He wants fun, not responsibility. You deserve better than convenience."
- "You're invested while he keeps his options open. That tells you everything."

BAD TONE (too clinical - NEVER write like this):
- "The chemistry feels strained due to his defensiveness and avoidant behavior"
- "You're seeking clarity and security, but he's resistant to commitment"
- "There's a positive and light chemistry present, fostered by the playful nature"
- "Both individuals are actively participating"
`;

const MESSAGE_ATTRIBUTION_RULES = `
MESSAGEINSIGHT TITLE FORMAT - ABSOLUTE RULE:
Every messageInsight title MUST START WITH "He" or "He's". No exceptions.
This is a neuroscience-backed decision: the user immediately understands WHO the insight is about.

FORMAT: "He's [verb]ing..." or "He [verb]s..." or "He [past tense]..."
Examples: "He's Testing You", "He's Deflecting", "He Noticed", "He's Hooked", "He's Guarding", "He Feels Safe"

The title MUST accurately describe what HE is ACTUALLY DOING in that specific message.

BEFORE writing the title, ask yourself:
1. What is HE DOING in this specific message? (asking? reacting? deflecting? teasing? confessing? calling out?)
2. Does my title start with "He" and describe HIS action?

COMMON MISTAKE - CONFUSING THE SUBJECT:
If he sends a message QUESTIONING something the user did, the insight is about HIS questioning, NOT about what the user did.
If he sends a message REACTING to news, the insight is about HIS reaction, NOT the news itself.
If he sends a message CATCHING ON to something, the insight is about HIM figuring it out, NOT about what he figured out.

EXAMPLES OF WRONG vs RIGHT:
- "Was I really saved as My Crush?" → WRONG: "Cute Confession?" → RIGHT: "He's Onto You"
- "Why didn't you tell me?" → WRONG: "Keeping Secrets" → RIGHT: "He's Calling Out"
- "I was thinking about you" → WRONG: "Playing It Cool" → RIGHT: "He's Opening Up"
- "Lol sure whatever you say" → WRONG: "Agreement" → RIGHT: "He's Brushing Off"
- "That's actually really sweet of you" → WRONG: "Sweet Talker" → RIGHT: "He Noticed"
- "I don't know how you will react" → WRONG: "Seeking Reassurance" → RIGHT: "He's Scared"
- "Non lo so" → WRONG: "Uncertain Response" → RIGHT: "He's Hesitating"
`;

const TAG_SELECTION_GUIDE = `
TAG SELECTION GUIDE - ABSOLUTE RULES:

MINIMUM 3 messageInsights per analysis. This is NON-NEGOTIABLE. Every chat has at least 3 moments worth decoding.
Target: 3-6 insights. Only go below 3 for chats with under 5 messages.

TAG DEFINITIONS:
- RED FLAG = ONLY genuinely toxic behavior: manipulation, gaslighting, controlling, disrespect, threats, degrading language
- GREEN FLAG = positive signals: genuine effort, respect, consistency, vulnerability used constructively, healthy communication
- DECODED = EVERYTHING ELSE worth analyzing: vulnerability, hesitation, hidden meaning, subtext, fear, testing, deflection, power moves, emotional tells

CRITICAL TAGGING MISTAKES TO AVOID:
- Vulnerability ("I'm afraid", "I don't know how you'll react") is DECODED, NOT RED FLAG
- Hesitation or nervousness is DECODED, NOT RED FLAG
- Being vague or dramatic is DECODED, NOT RED FLAG
- Playful teasing is DECODED or GREEN FLAG, NOT RED FLAG
- Only tag RED FLAG when there's ACTUAL harm, toxicity, or manipulation

FOR CASUAL/FRIENDLY/PLAYFUL CHATS:
- Use mostly DECODED and GREEN FLAG tags
- DECODED is your main tool here. Even the most normal message has subtext worth explaining
- "I want to tell you something" = DECODED (he's building up, testing safety)
- "You don't understand me" = DECODED (loneliness, fear of being misread)
- "Lmao stop playing" = DECODED (she's deflecting with humor, why?)
- There are ALWAYS hidden dynamics. Find them.
`;

const ANALYSIS_PROMPT = `You are a Gen Z relationship expert analyzing chat conversations for a viral Italian app targeting 15-25 year olds (mostly girls). Your tone should be casual, relatable, and straight-talking - like a brutally honest best friend who tells you the TRUTH even when you don't want to hear it.

${MANDATORY_REASONING_BLOCK}

${TONE_CALIBRATION}

${MESSAGE_ATTRIBUTION_RULES}

${TAG_SELECTION_GUIDE}

FORMATTING RULE - NEVER USE EM DASH:
NEVER use the em dash character "-" in ANY text output. Instead use:
- Periods or commas to separate sentences
- Regular hyphens "-" when needed for compound words
- Just remove the dash and restructure the sentence
WRONG: "Block him ASAP-this vibe is not okay"
RIGHT: "Block him ASAP. This vibe is not okay"
WRONG: "He's giving mixed signals-classic manipulation"
RIGHT: "He's giving mixed signals, classic manipulation"

CRITICAL: BE OBJECTIVE, NOT PRO-USER
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
- User insults the other person -> Don't label the other person "toxic" for reacting
- Other person expresses genuine concern -> Don't twist it into "manipulation"
- User is clearly the aggressor -> The scores should reflect that (low toxicity for the other person)
- Both are being petty -> Call it a mutual toxic dynamic, not one-sided

CRITICAL: NEVER USE NAMES FROM CHAT
NEVER use a name extracted from the chat header (like "My Crush", "Babe", contact names) in any descriptions, traits, or text.
Always refer to the other person as "he"/"him" or "she"/"her" generically. The app will insert the correct name later.

CRITICAL: UNDERSTAND GEN Z COMMUNICATION CONTEXT
- Sexual humor and flirty banter are NORMAL (e.g., "I'll need a wheelchair after" = sexual innuendo, NOT a threat)
- Sarcasm, irony, and playful teasing are standard flirting
- Emojis like indicate tone (playful vs serious)
- "Toxic" does not equal every edgy joke. Focus on PATTERNS of manipulation, gaslighting, emotional abuse
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
- Friendly banter with context
- Expressing concern or worry about the other person
- Being hurt or emotional during a breakup
- Short/blunt responses (could be communication style, not toxicity)
- Simple greetings like "Hi", "Hey", "Hello"
- Basic small talk and courtesy messages
- Venting about external things (work, quarantine, boredom with life, weather, bad day) - this is NOT about the relationship
- Complaining about life situations that have nothing to do with the other person

CRITICAL: messageInsights MESSAGE SELECTION
Analyze EVERY [THEIR MESSAGE] message. If it has ANY subtext, hidden meaning, emotional tell, power move, or noteworthy behavior — include it.
The user is paying for insight on THEIR CHAT. More decoded messages = more value. Don't hold back.

TARGET: Analyze ALL noteworthy messages. If the chat has 4-5 of his messages, expect 3-5 messageInsights. If it has 8-10 messages, expect 5-7.
MINIMUM: 3 messageInsights per analysis (unless the chat literally has fewer than 5 messages total).

DO NOT INCLUDE these types of messages (the ONLY exceptions):
- Simple greetings: "Hi", "Hey", "Hello", "What's up", "Yo"
- Basic courtesy: "How are you?", "I'm good", "Thanks", "Good morning"
- Normal responses that are GENUINELY empty: "Okay", "Sure", "Sounds good"
- "Lol" or "Haha" ONLY when it's a genuine laugh with zero subtext

A message is RED FLAG if it shows:
- Manipulation, gaslighting, guilt-tripping
- Controlling, possessive, or threatening behavior
- Disrespect, degradation, objectification
- Love bombing, future faking
- Dismissing feelings ("You're overreacting", "You're crazy")

A message is GREEN FLAG if it shows:
- Genuine care, empathy, or active listening
- Respect for boundaries
- Emotional maturity, accountability, vulnerability
- Consistent effort, thoughtfulness

If a message doesn't clearly fit RED or GREEN, use DECODED. Most messages will be DECODED — that's the whole point. DECODED reveals what he's REALLY saying.

CONTEXT IS EVERYTHING - READ THE FULL CONVERSATION:
- A message's meaning depends on what came before and after
- Sexual innuendo in a flirty conversation = NOT a violence threat (may still be a red flag for objectification, but label the ACTUAL issue correctly)
- Short responses from someone naturally brief = NOT "dismissive"
- Sarcasm and irony must be detected from emoji context and conversation tone
- One dry message does NOT make someone toxic
- "You might need a wheelchair after I'm done with you" in a flirty context = sexual bravado/innuendo, NOT a literal violence threat
- TOPIC MATTERS: If someone says "I'm bored" while talking about quarantine/work/weather, they mean the EXTERNAL SITUATION, NOT the conversation or relationship. Only flag "bored" as a red flag if it's CLEARLY directed at the other person or the relationship itself
- Venting about life circumstances (lockdown, work stress, bad day) is NORMAL and NOT a relationship red flag
- A casual/friendly conversation with no clear toxicity should produce LOW toxicity scores but STILL have 3+ DECODED messageInsights (subtext exists even in casual chats)
- If the conversation is just two people chatting normally, use DECODED to reveal the subtext — don't force RED FLAGS but DO decode what's really being said

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

STRICT messageInsights DESCRIPTION LENGTH - THIS IS CRITICAL FOR UI:
- The "description" field MUST be EXACTLY 40-60 characters (6-10 words MAX)
- It should be a SHORT PREVIEW of what the "solution" (back of card) reveals
- Think of it as a teaser: "What It Really Means" summarized in one punchy phrase
- Format: ONE punchy phrase, no periods, no commas
- Examples:
  - "He's shrinking the convo to feel safe" (38 chars)
  - "Classic avoidant move disguised as chill" (41 chars)
  - "His silence is punishment not laziness" (38 chars)
  - "He's keeping score while playing cool" (37 chars)

STRICT messageInsights SOLUTION LENGTH:
- The "solution" field = "What It Really Means" for ALL tags (RED FLAG, GREEN FLAG, DECODED)
- ALL tags get psychological decoding, NEVER actionable advice
- MAX 2 sentences, under 30 words total
- Must reveal what's happening INSIDE HIS HEAD

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

ABSOLUTE BAN ON RELATIONSHIP STAGE ASSUMPTIONS:
- NEVER use "Early Stage", "New Connection", "Getting to Know", "Just Starting" or similar as a personalizedTrait
- NEVER write "early stages", "it's still early", "just getting started", "still new" in personalizedDescription
- You CANNOT know the relationship stage from a chat snippet. A short casual conversation does NOT mean "early stage" - people who have known each other for years also have brief check-in chats
- Describe WHAT YOU SEE in the conversation (tone, effort, vibe), NOT what stage you think the relationship is in
- Instead of "Early Stage" use traits like "Chill", "Light", "Casual", "Relaxed", "Friendly", "Open"

1. RED FLAGS & GREEN FLAGS
   Purpose: Immediate "wtf" moment or relief (9/10 dopamine hit)
   Focus: THE MOST obvious warning signs OR healthy patterns FROM EITHER SIDE
   Semantic Tags Examples:
   - Red: "love_bombing", "gaslighting", "breadcrumbing", "manipulative", "controlling", "hot_cold"
   - Green: "respectful", "consistent", "genuine", "communicative", "boundaried", "self_aware", "honest"
   - User-side red flags: "aggressive", "insulting", "unfair", "dramatic", "starting_drama"
   Severity: 1-3 = green flags / user is the problem, 4-7 = moderate issues, 8-10 = genuinely toxic other person

2. EFFORT
   Purpose: Who's actually showing up in this dynamic (7/10 dopamine - realization)
   Focus: Initiation patterns, effort asymmetry, who texts first, who plans dates, who puts in work
   Semantic Tags: "high_effort", "low_effort", "balanced", "one_sided", "chaser", "pursued", "bare_minimum"
   Severity: 1-3 = balanced effort, 4-7 = moderate imbalance, 8-10 = severely one-sided

3. INTENTIONS
   Purpose: Reveal underlying motivations (8/10 dopamine - revelation)
   Focus: Relationship vs hookup vs validation vs time-pass
   Semantic Tags: "genuine", "validation_seeking", "hookup_focused", "confused", "time_passer"
   Severity: 1-3 = clear good intent, 4-7 = mixed signals, 8-10 = clearly using you

4. CHEMISTRY
   Purpose: Spark factor - SECOND PEAK (9/10 dopamine - critical decision point)
   Focus: Banter quality, humor match, natural flow
   Semantic Tags: "electric", "flat", "one_sided", "slow_burn", "forced", "natural"
   Severity: 1-3 = no spark, 4-7 = moderate chemistry, 8-10 = off the charts

5. TRAJECTORY
   Purpose: Where this is heading - FUTURE REVEAL (8/10 dopamine)
   Focus: Direction of the relationship, potential outcomes, pattern predictions
   Semantic Tags: "going_somewhere", "dead_end", "situationship_forever", "slow_fade", "building", "stagnant"
   Severity: 1-3 = going nowhere, 4-7 = uncertain, 8-10 = clear positive trajectory

===== BEHAVIORAL PATTERN EXTRACTION =====

Your job is to EXTRACT specific behavioral patterns you observe in the chat. The app will match these to Soul Types automatically.

STEP 1: Identify behavioral patterns
For each person, list 4-8 specific behavioral keywords you observe. IMPORTANT: Use keywords from this list as much as possible (these are the ones the matching system recognizes best):

FOR HIM (male):
- Controlling/Possessive: "possessive", "jealous", "controlling", "checking phone", "isolating", "suffocating", "stalking", "threatening", "aggressive", "intimidating", "abusive", "objectifying"
- Ghosting/Avoidant: "ghosting", "disappears", "no response", "left on read", "blocked", "vanish", "no closure"
- Hot & Cold: "hot and cold", "inconsistent", "mixed signals", "confusing", "unpredictable", "back and forth", "mood swings"
- Manipulation: "gaslighting", "manipulation", "guilt trip", "plays victim", "emotional blackmail", "toxic"
- Narcissistic: "ego", "selfish", "gaslighting", "disrespectful", "condescending", "dismissive", "degrading"
- Love Bombing: "overwhelming", "intense", "fast", "future faking", "clingy", "love bombing"
- Sweet but Toxic: "charming", "sweet", "insidious", "erosion", "manipulation"
- Loyal/Good: "loyal", "caring", "consistent", "sweet", "reliable", "warm"
- Unavailable: "unavailable", "distant", "closed", "walls", "guarded"
- Mysterious: "vague", "undefined", "deep", "mysterious", "unreachable"
- Non-committal: "freedom", "wild", "independent", "non-committal", "adventurous"
- Stringing along: "backup", "second choice", "options", "stringing along", "breadcrumbing"
- Fake/Chameleon: "fake", "no identity", "changes", "adapts", "different person"
- Ex behavior: "comes back", "entitled", "return", "old flame"

FOR HER (female):
- Guarded/Defensive: "guarded", "walls", "trust issues", "closed off", "cautious", "defensive", "wary", "suspicious"
- Falls Fast: "catches feelings", "falls fast", "hopeless romantic", "all in", "attached"
- Passionate: "passionate", "intense", "fire", "all in", "obsessive", "consuming"
- Authentic: "authentic", "real", "genuine", "natural", "honest", "unfiltered"
- Overthinking: "overthink", "spiral", "anxious", "insecure", "worried"
- Intuitive: "intuition", "gut feeling", "instinct", "inquisitive", "questioning"
- Standards: "standards", "boundaries", "confident", "high value", "assertive", "firm"
- Quiet strength: "calm", "composed", "observes", "walks away", "done", "shocked", "disgusted"
- Fierce: "fierce", "savage", "dangerous", "untamed", "predator"
- Giving: "gives too much", "selfless", "burn out", "sacrifices"
- Resilient: "phoenix", "stronger", "survivor", "powerful", "comeback"
- Toxic: "toxic", "manipulative", "dangerous", "subtle", "venom"
- Adapts too much: "adapts", "loses herself", "mirrors", "no identity", "people pleaser"
- Luxe: "luxury", "high maintenance", "expensive", "spoiled"

STEP 2: Cite evidence
Quote 2-3 specific messages that prove each behavioral pattern.

STEP 3: Provide personalized description
Write a Gen Z description based on the ACTUAL behaviors you observed.

BE SPECIFIC - use keywords from the lists above that describe EXACTLY what you see in the chat. The matching system works best when you use these exact words.

Provide your analysis in the following JSON format:

{
  "reasoning": {
    "overallVibe": "<EXACTLY ONE: playful, casual, friendly, romantic, flirty, tense, heated, toxic, mixed>",
    "chatContext": "<1 sentence: what is ACTUALLY happening in this conversation>",
    "isMemeOrJoke": <true or false>,
    "toxicityAssessment": "<EXACTLY ONE: none, minimal, moderate, significant, severe>",
    "severityCeiling": <1-10>
  },
  "scores": {
    "overall": <0-100 toxicity score of THE OTHER PERSON based on [THEIR MESSAGE] messages IN CONTEXT. If they're being reasonable/kind, score MUST be low (0-30). If user is the aggressor and they're just reacting, score should be low. Only high (70+) for genuinely toxic patterns>,
    "warmth": <0-100, measure of THE OTHER PERSON's affection and care>,
    "communication": <0-100, quality of THE OTHER PERSON's communication>,
    "drama": <0-100, THE OTHER PERSON's level of UNNECESSARY conflict and manipulation>,
    "distance": <0-100, THE OTHER PERSON's emotional unavailability>,
    "passion": <0-100, THE OTHER PERSON's intensity and romantic energy>
  },
  "profile": {
    "type": "<Mixed Profile|Red Flag Alert|Green Light|Toxic Zone|Comfort Zone>",
    "subtitle": "<Punchy 4-8 word truth bomb. Not a description. A verdict. e.g., 'He's emotionally checked out.' or 'Avoidant mode activated.'>",
    "description": "<MAX 10 words. Sharp, direct. e.g., 'He's not investing in this.' NOT 'The conversation shows avoidant tendencies.'>"
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
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS (He/You/This/That). e.g., 'He dismisses your feelings and now you're the one apologizing. That's the red flag.'>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "effort": {
      "behaviorPatterns": ["<behavior patterns>"],
      "semanticTags": ["<matching tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "balance": "<...>", "pattern": "<...>", "who_initiates": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS. e.g., 'You're making plans while he keeps breaking them. That's not effort, that's tolerance.' NEVER 'Both individuals'>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "intentions": {
      "behaviorPatterns": ["<behavior patterns>"],
      "semanticTags": ["<matching tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "goal": "<...>", "pattern": "<...>", "quality": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS. e.g., 'He wants fun, not responsibility. You're the convenience, not the priority.'>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "chemistry": {
      "behaviorPatterns": ["<behavior patterns>"],
      "semanticTags": ["<matching tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "intensity": "<...>", "pattern": "<...>", "quality": "<...>", "feeling": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS. e.g., 'You're trying to connect while he pulls away. That gap is growing.'>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "trajectory": {
      "behaviorPatterns": ["<behavior patterns>"],
      "semanticTags": ["<matching tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "direction": "<...>", "pattern": "<...>", "outcome": "<...>", "likelihood": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS. e.g., 'This pattern keeps repeating. He won't change unless something forces him to.'>",
      "personalizedTraits": ["<trait1>", "<trait2>", "<trait3>", "<trait4>"]
    }
  },
  "messageInsights": [
    {
      "message": "<ONLY the raw message text, NO labels like [THEIR MESSAGE]. Just the actual words they typed>",
      "messageCount": "1 of <total>",
      "title": "<MUST START WITH 'He' (e.g. 'He's Testing You', 'He Noticed', 'He's Deflecting'). MAX 18 CHARS. Describes what HE is doing in this message. See ATTRIBUTION RULES below>",
      "tag": "<ONLY 'RED FLAG', 'GREEN FLAG', or 'DECODED' - see TAG SELECTION GUIDE below>",
      "tagColor": "#<hex color based on tag - RED FLAG=#E53935, GREEN FLAG=#43A047, DECODED=#7C4DFF>",
      "description": "<40-60 CHARS STRICT LIMIT - a short preview/summary of what the 'solution' insight reveals. Think of it as the teaser for the back of the card.>",
      "solution": "<'What It Really Means' — psychological decoding, NEVER advice. MAX 2-3 sentences (under 35 words). Mix sentence lengths for natural rhythm. Decode what's in his HEAD. e.g., 'He read every word but vulnerability makes him shut down. That haha is a shield, not a laugh.' NEVER paraphrase his words back.>",
      "gradientStart": "<DARK color based on tag>",
      "gradientEnd": "<DARKER version>",
      "accentColor": "<LIGHTER accent>"
    },
    "... REPEAT for EVERY noteworthy [THEIR MESSAGE]. Target 3-6 insights minimum. Decode ALL his messages with subtext."
  ],
  "personArchetype": {
    "name": "Him",
    "observedBehaviors": ["<4-8 behavioral keywords you observed, e.g., 'ghosting', 'hot cold', 'manipulation', 'inconsistent'>"],
    "evidenceMessages": ["<quote 2-3 specific messages that prove these behaviors>"],
    "description": "<2-3 sentences about WHO he is. VARY SUBJECTS. e.g., 'He feels everything but won't show it. You'll always be guessing.' NOT 'He feels. He hides. He avoids.'>",
    "traits": ["<4 HONEST traits based on actual messages>"],
    "shareableTagline": "<A punchy, snarky 6-10 word one-liner about this person's behavior. Written in the SAME LANGUAGE as the chat. Must be screenshot-worthy.>"
  },
  "userArchetype": {
    "name": "You",
    "observedBehaviors": ["<4-8 behavioral keywords for the user, e.g., 'catches feelings', 'hopeless romantic', 'overthinks'>"],
    "evidenceMessages": ["<quote 2-3 specific USER messages that prove these behaviors>"],
    "description": "<2-3 sentences about how you're showing up. VARY SUBJECTS. e.g., 'You ask the right questions but he's not the right answer. That's the hard truth.'>",
    "traits": ["<4 HONEST traits about user behavior>"]
  },
  "relationshipDynamic": {
    "name": "<Creative Gen Z name for the dynamic, 2-4 words>",
    "subtitle": "<Short emotional hook, 4-7 words>",
    "whyThisHappens": "<2-3 sentences, under 30 words. VARY SUBJECTS. e.g., 'You crave reassurance while he avoids accountability. That's the cycle — he blames, you question yourself.'>",
    "patternBreak": "<YOUR NEXT MOVE - see rules below>",
    "powerBalance": "<number 0-100. How much power the USER holds. 50 = balanced>"
  },
  "personGender": "<'male' or 'female' - detect from context clues>"
}

YOUR NEXT MOVE (patternBreak) - CRITICAL RULES:
This is the ONE piece of advice the user takes away. It MUST be valuable, specific, and non-obvious.
- Write in the SAME LANGUAGE as the chat (if chat is in Italian, write in Italian)
- 15-25 words, ONE concrete action she can do RIGHT NOW
- Talk TO her directly: "Send him...", "Next time he...", "Try asking him..."
- Must be SPECIFIC to what you observed in THIS chat. Reference actual patterns
- Must give her something she WOULDN'T have thought of on her own
- Must make her feel like she just got insider advice from someone who gets it
- NEVER generic advice like: "Communicate better", "Set boundaries", "Be yourself", "Talk about your feelings", "Try a different game", "Keep the energy going"
- NEVER obvious advice like: "Suggest a different activity", "Be more open", "Express yourself"

BAD EXAMPLES (generic, obvious, zero value):
- "Suggest a different type of game or activity" ← tells her nothing useful
- "Keep the good vibes going" ← means nothing
- "Communicate your feelings openly" ← therapist speak
- "Set clear boundaries" ← every article says this

GOOD EXAMPLES (specific, surprising, actually useful):
- "Next time he compliments you like that, don't just say thanks. Flip it back on him and watch him melt" (for a flirty chat)
- "He's testing if you'll wait around. Don't text first for 3 days and see how fast he shows up" (for breadcrumbing)
- "Manda un vocale la prossima volta, il testo nasconde l'energia che avete" (for an Italian chat with good chemistry)
- "Ask him one deep question out of nowhere. Something like 'what's something nobody knows about you?' - it'll change the whole dynamic" (for surface-level chat)
- "Smetti di rispondere subito. Fallo aspettare un po', vedi se ti cerca con più energia" (for a chase dynamic)

Focus on PATTERNS not single messages. Be REAL.

TAG SELECTION GUIDE - THREE TYPES OF MESSAGEINSIGHTS:
1. RED FLAG - Genuinely concerning behavior: manipulation, gaslighting, disrespect, coldness, breadcrumbing, control. Something a best friend would warn her about.
2. GREEN FLAG - Genuinely positive behavior: effort, vulnerability, consistency, respect, emotional availability. Something that shows he's actually a good one.
3. DECODED - The psychological layer underneath. You are an expert psychologist decoding human behavior, but you talk like a Gen Z best friend. DECODED is NOT a summary of the message. It's the HIDDEN psychological truth the user can't see on her own.

DECODED - HOW TO THINK LIKE A PSYCHOLOGIST (BUT TALK LIKE A BEST FRIEND):
For every DECODED message, you MUST analyze these layers:
1. WHAT HE SAID (the literal words)
2. WHAT HE'S ACTUALLY FEELING (the emotion underneath — fear? excitement? insecurity? control?)
3. WHY THIS SPECIFIC RESPONSE (what triggered him to say THIS instead of something else?)
4. WHAT THIS REVEALS about his psychology (attachment style, defense mechanism, emotional pattern)

The "solution" field for DECODED = "What It Really Means". This is where the REAL value is. It must:
- Decode the EXACT psychological moment, not give a vague summary
- Explain what's happening in his HEAD, not just describe what he did
- Reference the specific context that triggered this response
- Give the user an insight she genuinely couldn't figure out alone
- Be written casually but with real psychological depth

DECODED EXAMPLES (notice the psychological specificity):
- "Haha ok" after she sent a long heartfelt message →
  Title: "The Shutdown"
  Description: "Short reply after your long message? Not random."
  What It Really Means: "When someone drops to one-word replies after you open up, it's not that they don't care. He read every word. But vulnerability makes him uncomfortable, so he's shrinking the conversation to feel safe again. His 'haha' is a shield."

- "I mean you can do whatever you want" →
  Title: "The Silent Test"
  Description: "He's not giving permission. He's watching."
  What It Really Means: "This is a classic avoidant move. He WANTS you to choose him but he won't ask directly because asking = vulnerability = risk of rejection. So he frames it as 'your choice' but he's 100% keeping score of what you pick."

- "I don't understand, my number was initially saved on your phone as My crush?" →
  Title: "He's Onto You"
  Description: "He just connected the dots."
  What It Really Means: "He's not actually confused. The 'I don't understand' is him processing out loud. Your earlier slip gave it away and now he's replaying the whole conversation in his head. This question is him giving you one last chance to either own it or double down on the cover story."

- "Who did that? Lol" →
  Title: "Playing Along"
  Description: "He's entertained but also probing."
  What It Really Means: "The 'lol' keeps it light but the question is strategic. He's not just laughing at the prank. He wants to know who's behind it because that tells him who knows about the crush. He's gathering intel while pretending to just be amused."

- "Wait" followed by "What do you mean?" →
  Title: "The Penny Drop"
  Description: "Something just clicked in his head."
  What It Really Means: "That 'Wait' is the exact moment the pieces fell into place. He sent it before he even finished thinking. The gap between 'Wait' and 'What do you mean?' is him rewinding the conversation and realizing the prank story doesn't add up."

BAD DECODED — THESE ARE SUMMARIES, NOT DECODES. NEVER write like this:
- "He's genuinely worried about messing things up" ← this RESTATES what he SAID. We can already see he's worried. Where's the decode?
- "He's basically saying he likes you, but he's terrified you don't feel the same" ← paraphrasing his words back is NOT psychology. WHY is he terrified? What's the mechanism?
- "He's admitting his fear of rejection" ← HE LITERALLY SAID HE'S AFRAID. Repeating what someone said is not decoding.
- "He's being playful and curious" ← this is a DESCRIPTION, not a decode
- "He's catching on to the underlying context" ← too generic, what SPECIFIC context?
- "He's playfully calling you out" ← calling out WHAT exactly? What's the psychological mechanism?
- "He cares about your feelings and doesn't want to hurt you" ← we can SEE that from the message. Tell us what we CAN'T see.
- "He's probably been thinking about this for a while" ← probably? A psychologist doesn't guess. Decode the BEHAVIOR PATTERN.

THE SELF-CHECK TEST: Read your DECODED solution and ask — "Could the user figure this out just by re-reading the message?" If YES → you wrote a summary, not a decode. Go DEEPER. Find the invisible mechanism.

COMPARISON — same message, BAD vs GOOD:
Message: "The problem is, I'm afraid to say this to you"
BAD: "He's genuinely worried about messing things up. He's probably been thinking about this for a while. This is his way of testing the waters before diving in."
GOOD: "He's not just nervous — he's calculating. He's watching your reaction to THIS sentence to decide if it's safe to continue. The word 'afraid' is doing double duty: it's honest, but it's also a safety net. If you react badly, he can retreat behind 'I told you I was afraid' without ever having to say the actual thing."

Message: "You don't understand me, I don't know if you will feel the same way"
BAD: "He's basically saying he likes you, but he's terrified you don't feel the same."
GOOD: "'You don't understand me' — that's not frustration, that's loneliness. He's been carrying this alone and it's eating him up. And 'I don't know if you'll feel the same way' — he's literally rehearsing rejection while talking to you. He's already picturing the worst outcome, which means he cares way more than he's letting on."

GOOD DECODED gives the user a genuine "oh shit, I never thought of it that way" moment. It reveals the INVISIBLE mechanism behind the visible words.

CRITICAL: DO NOT include normal greetings, basic "hi/hey", or messages with genuinely ZERO subtext. Every DECODED message MUST have an actual hidden meaning worth explaining.

ABSOLUTE MINIMUM: 3 messageInsights per analysis. Target 3-6 (mix of tags). Only go below 3 for chats under 5 messages.
Even healthy/casual chats MUST have 3+ DECODED moments. Vulnerability, hesitation, subtext = DECODED, never RED FLAG.
IMPORTANT: If someone vents about life (boredom, quarantine, work stress), that's about their SITUATION, not the relationship. Don't flag it as RED FLAG. But you CAN DECODE what the venting reveals about their emotional state.
A normal casual conversation should get LOW toxicity scores (under 25). It should still have 3+ DECODED insights showing the subtext.
CRITICAL: messageInsights tag MUST be EXACTLY "RED FLAG", "GREEN FLAG", or "DECODED". No "NEUTRAL", no "YELLOW FLAG", no other values.
CRITICAL: NEVER use "Early Stage" as a personalizedTrait. NEVER say "early stages" or "it's still early" in any description. You CANNOT determine the relationship stage from a chat snippet.
The analysis that goes viral is the one friends say "omg that's so accurate" about. DECODED insights are the ones she screenshots and sends to her group chat because they made her see something she missed.`;

// PHASE 1: Quick analysis prompt - just scores + archetypes (should complete in ~5s)
const QUICK_ANALYSIS_PROMPT = `You are a Gen Z relationship expert. Analyze this chat and provide ONLY the core metrics.

${MANDATORY_REASONING_BLOCK}

${TONE_CALIBRATION}

FORMATTING RULE - NEVER USE EM DASH:
NEVER use the em dash character "—" in ANY text. Use periods, commas, or hyphens instead.

CRITICAL: BE OBJECTIVE, NOT PRO-USER
Analyze OBJECTIVELY. If the user is toxic, say it. If the other person is reasonable, acknowledge it.

CRITICAL: NEVER USE NAMES FROM CHAT
NEVER use a name from the chat header in descriptions. Refer to the person as "he"/"him" or "she"/"her" generically.

CRITICAL: DON'T OVER-DRAMATIZE NORMAL CHATS
If the conversation is casual/friendly/normal, reflect that honestly:
- Low toxicity scores (under 25)
- Behavioral keywords that match the ACTUAL vibe (e.g., "warm", "caring", "consistent" for a friendly chat)
- Don't assign "anxious"/"overthink" to someone just because they're talkative or ask questions
- Don't assign "overwhelming"/"intense"/"passionate" for normal friendly gestures (e.g., offering to come visit is friendly, NOT overwhelming)
- Don't assign "inquisitive" for someone simply asking "how are you" or making normal conversation
- Venting about life (boredom, quarantine, work) is NOT about the relationship
- A normal chat between two people = "Green Light" or "Comfort Zone" profile, not "Mixed Profile"
- Use PROPORTIONAL keywords: a casual chat = "caring", "warm", "friendly", "genuine", NOT "passionate", "overwhelming", "intense"

CRITICAL: AVOIDANT/DISMISSIVE BEHAVIOR IS NOT "CASUAL"
A calm tone does NOT equal low toxicity. If one person is being vulnerable (asking about the relationship, expressing needs, trying to have a serious talk) and the other is DISMISSING, DEFLECTING, or STONEWALLING ("lol chill", "why does it matter", "idk", refusing to define things):
- overallVibe = "tense" or "mixed", NOT "casual"
- Toxicity score = 45-75 (this is covert toxic behavior)
- Emotional unavailability and dismissing someone's valid needs IS toxic
- Keywords: "dismissive", "unavailable", "distant", "vague", "non-committal"

CRITICAL MESSAGE LABELS:
- [THEIR MESSAGE] = THE OTHER PERSON (being analyzed)
- [YOUR MESSAGE] = THE USER (uploaded the chat)

BEHAVIORAL EXTRACTION - USE THESE KEYWORDS:
For each person, list 4-8 keywords. USE KEYWORDS FROM THIS LIST:
HIM: "possessive", "jealous", "controlling", "threatening", "aggressive", "intimidating", "stalking", "objectifying", "abusive", "ghosting", "disappears", "left on read", "hot and cold", "inconsistent", "mixed signals", "gaslighting", "manipulation", "guilt trip", "ego", "selfish", "disrespectful", "dismissive", "overwhelming", "intense", "clingy", "charming", "toxic", "loyal", "caring", "consistent", "warm", "unavailable", "distant", "vague", "mysterious", "non-committal", "freedom", "backup", "stringing along", "fake", "comes back"
HER: "guarded", "walls", "trust issues", "cautious", "defensive", "catches feelings", "falls fast", "hopeless romantic", "passionate", "intense", "authentic", "real", "genuine", "overthink", "spiral", "anxious", "intuition", "gut feeling", "inquisitive", "standards", "boundaries", "assertive", "calm", "composed", "walks away", "shocked", "fierce", "savage", "gives too much", "selfless", "phoenix", "stronger", "toxic", "manipulative", "adapts", "loses herself", "luxury", "high maintenance"

Respond with ONLY this JSON (no other text):
{
  "reasoning": {
    "overallVibe": "<EXACTLY ONE: playful, casual, friendly, romantic, flirty, tense, heated, toxic, mixed>",
    "chatContext": "<1 sentence: what is ACTUALLY happening>",
    "isMemeOrJoke": <true or false>,
    "toxicityAssessment": "<EXACTLY ONE: none, minimal, moderate, significant, severe>",
    "severityCeiling": <1-10>
  },
  "scores": {
    "overall": <0-100 toxicity of THE OTHER PERSON. Low (0-30) if genuinely reasonable/kind. Mid (40-70) if avoidant/dismissive/stonewalling. High (70+) for overtly toxic patterns>,
    "warmth": <0-100>,
    "communication": <0-100>,
    "drama": <0-100>,
    "distance": <0-100>,
    "passion": <0-100>
  },
  "profile": {
    "type": "<Mixed Profile|Red Flag Alert|Green Light|Toxic Zone|Comfort Zone>",
    "subtitle": "<Punchy 4-8 word truth bomb. A verdict, not a description. e.g., 'He's emotionally checked out.'>",
    "description": "<MAX 10 words. Sharp and direct. e.g., 'He's not investing in this.'>"
  },
  "personArchetype": {
    "name": "Him",
    "observedBehaviors": ["<4-8 behavioral keywords FROM THE LIST ABOVE>"],
    "evidenceMessages": ["<2-3 specific messages proving these behaviors>"],
    "description": "<2-3 sentences about WHO he is. VARY SUBJECTS. e.g., 'He connects in theory but never in reality. You'll keep waiting.' NOT 'He connects. He avoids. He deflects.'>",
    "traits": ["<4 traits based on actual chat behavior>"],
    "shareableTagline": "<6-10 word punchy one-liner in SAME LANGUAGE as chat. Screenshot-worthy.>"
  },
  "userArchetype": {
    "name": "You",
    "observedBehaviors": ["<4-8 behavioral keywords FROM THE LIST ABOVE>"],
    "evidenceMessages": ["<2-3 specific USER messages proving these behaviors>"],
    "description": "<2-3 sentences about how she shows up. VARY SUBJECTS. e.g., 'You ask the right questions but he's not the right answer. That's the hard truth.'>",
    "traits": ["<4 traits based on user behavior>"]
  },
  "personGender": "<'male' or 'female' from context>"
}`;

// PHASE 2: Detailed analysis prompt - cards + insights (can take longer)
const DETAILED_ANALYSIS_PROMPT = `You are a Gen Z relationship expert. Analyze this chat for the DETAILED breakdown cards.

${MANDATORY_REASONING_BLOCK}

${TONE_CALIBRATION}

${MESSAGE_ATTRIBUTION_RULES}

${TAG_SELECTION_GUIDE}

FORMATTING RULE - NEVER USE EM DASH:
NEVER use "—" in ANY text. Use periods, commas, or hyphens instead.

CRITICAL MESSAGE LABELS:
- [THEIR MESSAGE] = THE OTHER PERSON (being analyzed)
- [YOUR MESSAGE] = THE USER

CRITICAL: NEVER USE NAMES FROM CHAT
NEVER use a name from the chat header in descriptions. Refer to the person as "he"/"him" or "she"/"her" generically.

CRITICAL: messageInsights — ANALYZE ALL NOTEWORTHY MESSAGES
Go through EVERY [THEIR MESSAGE] one by one. If it has subtext, hidden meaning, emotional tell, deflection, power move — include it as a messageInsight.
DO NOT include: simple greetings ("Hi", "Hey"), basic courtesy ("How are you?", "I'm good").
INCLUDE everything else — use DECODED for subtext, RED FLAG for toxic behavior, GREEN FLAG for genuine positive signals.
MINIMUM 3 messageInsights. If the chat has 4-5 of his messages, expect 3-5 insights. If 8-10 messages, expect 5-7.
TOPIC MATTERS: "I'm bored" about quarantine/work/life = venting about EXTERNAL situation, NOT a red flag. But you CAN DECODE what the venting reveals.
Even casual chats MUST have 3+ DECODED insights. The user wants EVERY message decoded, not just the obvious ones.

STRICT DESCRIPTION LENGTHS:
- personalizedDescription: MAX 2-3 sentences, under 25 words. Mix short + medium sentence lengths for natural rhythm. NEVER 4+ fragmented sentences
- messageInsights description: 40-60 characters STRICT (6-10 words) — teaser for the back of the card
- messageInsights solution: MAX 2-3 sentences, under 30 words — truth bomb decoding with natural rhythm, not therapy notes

CRITICAL: PROPORTIONAL personalizedTraits
personalizedTraits MUST match the actual vibe of the conversation. Describe what you SEE, don't assume the relationship stage.
- For a normal/friendly chat: use NEUTRAL or POSITIVE traits like "Easygoing", "Friendly", "Casual", "Chill", "Open", "Balanced", "Light"
- Do NOT use harsh negative traits like "Bland", "Dull", "Passive", "Unresponsive", "Low-effort" for someone who IS responding and being polite
- Someone who responds to every message but uses short replies is "Concise" or "Brief", NOT "Passive" or "Unresponsive"
- A conversation with low chemistry is "Chill", "Relaxed", "Low-key", NOT "Bland" or "Dull"
- NEVER use "Early Stage", "New Connection", "Getting to Know" or any relationship-stage trait. You CANNOT determine the stage from a chat snippet
- NEVER write "early stages", "it's still early", "just getting started" in descriptions. Describe WHAT YOU SEE, not what stage you assume
- A short casual chat does NOT mean "early stage" - people in long relationships also have brief check-in conversations
- Reserve truly negative traits for genuinely toxic/problematic behavior

CATEGORY ANALYSIS:
1. RED FLAGS & GREEN FLAGS - Warning signs or healthy patterns
2. EFFORT - Who's showing up, initiation patterns
3. INTENTIONS - Relationship vs hookup vs validation
4. CHEMISTRY - Spark factor, banter quality
5. TRAJECTORY - Where this is heading

Respond with ONLY this JSON:
{
  "reasoning": {
    "overallVibe": "<EXACTLY ONE: playful, casual, friendly, romantic, flirty, tense, heated, toxic, mixed>",
    "chatContext": "<1 sentence: what is ACTUALLY happening>",
    "isMemeOrJoke": <true or false>,
    "toxicityAssessment": "<EXACTLY ONE: none, minimal, moderate, significant, severe>",
    "severityCeiling": <1-10>
  },
  "categoryAnalysis": {
    "redFlagsGreenFlags": {
      "behaviorPatterns": ["<patterns>"],
      "semanticTags": ["<tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "intensity": "<...>", "pattern": "<...>", "tactic": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS (He/You/This/That). e.g., 'He dismisses your feelings and now you're the one apologizing. That's the red flag.'>",
      "personalizedTraits": ["<NEVER 'Early Stage' - describe the VIBE: Chill, Friendly, etc>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "effort": {
      "behaviorPatterns": ["<patterns>"],
      "semanticTags": ["<tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "balance": "<...>", "pattern": "<...>", "who_initiates": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS. e.g., 'You're making plans while he keeps breaking them. That's not effort, that's tolerance.' NEVER 'Both individuals'.>",
      "personalizedTraits": ["<NEVER 'Early Stage' - describe EFFORT: Balanced, One-Sided, etc>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "intentions": {
      "behaviorPatterns": ["<patterns>"],
      "semanticTags": ["<tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "goal": "<...>", "pattern": "<...>", "quality": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS. e.g., 'He wants fun, not responsibility. You're the convenience, not the priority.'>",
      "personalizedTraits": ["<NEVER 'Early Stage' - describe INTENT: Genuine, Friendly, etc>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "chemistry": {
      "behaviorPatterns": ["<patterns>"],
      "semanticTags": ["<tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "intensity": "<...>", "pattern": "<...>", "quality": "<...>", "feeling": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS. e.g., 'You're trying to connect while he pulls away. That gap is growing.'>",
      "personalizedTraits": ["<NEVER 'Early Stage' - describe CHEMISTRY: Natural, Warm, etc>", "<trait2>", "<trait3>", "<trait4>"]
    },
    "trajectory": {
      "behaviorPatterns": ["<patterns>"],
      "semanticTags": ["<tags>"],
      "severity": <1-10>,
      "specificExamples": ["<examples>"],
      "templateVars": { "direction": "<...>", "pattern": "<...>", "outcome": "<...>", "likelihood": "<...>" },
      "personalizedDescription": "<MAX 2-3 sentences, under 25 words. VARY SUBJECTS. e.g., 'This pattern keeps repeating. He won't change unless something forces him to.'>",
      "personalizedTraits": ["<NEVER 'Early Stage' - describe DIRECTION: Building, Steady, etc>", "<trait2>", "<trait3>", "<trait4>"]
    }
  },
  "messageInsights": [
    {
      "message": "<ONLY the raw message text, NO labels like [THEIR MESSAGE]. Just the actual words they typed>",
      "messageCount": "1 of <total>",
      "title": "<MUST START WITH 'He' (e.g. 'He's Testing You', 'He Noticed', 'He's Deflecting'). MAX 18 CHARS. Describes what HE is doing. See ATTRIBUTION RULES below>",
      "tag": "<ONLY 'RED FLAG', 'GREEN FLAG', or 'DECODED' - see TAG SELECTION GUIDE. RED FLAG=ONLY genuinely toxic. DECODED=vulnerability, hesitation, subtext, hidden meaning>",
      "tagColor": "<RED FLAG=#E53935, GREEN FLAG=#43A047, DECODED=#7C4DFF>",
      "description": "<40-60 CHARS STRICT - a short preview/summary of what the 'solution' insight reveals. Teaser for the back of the card.>",
      "solution": "<'What It Really Means' — psychological decoding, NEVER advice. MAX 2-3 sentences (under 35 words). Mix sentence lengths for natural rhythm. e.g., 'He read every word but vulnerability makes him shut down. That haha is a shield, not a laugh.' NEVER paraphrase.>",
      "gradientStart": "<dark hex>",
      "gradientEnd": "<darker hex>",
      "accentColor": "<lighter accent>"
    },
    "... REPEAT for EVERY noteworthy [THEIR MESSAGE]. Target 3-6 insights. Decode ALL his messages that have subtext."
  ],
  "relationshipDynamic": {
    "name": "<Creative 2-4 word name>",
    "subtitle": "<4-7 word emotional hook>",
    "whyThisHappens": "<2-3 sentences, under 30 words. VARY SUBJECTS. e.g., 'You crave reassurance while he avoids accountability. That's the cycle — he blames, you question yourself.'>",
    "patternBreak": "<YOUR NEXT MOVE: 15-25 words, same language as chat, specific to THIS situation, non-obvious, talks TO her. See ANALYSIS_PROMPT rules for patternBreak>",
    "powerBalance": <0-100, 50=balanced>
  }
}

YOUR NEXT MOVE (patternBreak) - CRITICAL:
- Write in the SAME LANGUAGE as the chat
- 15-25 words, ONE concrete action she can do RIGHT NOW
- Talk TO her: "Send him...", "Next time he...", "Try..."
- Must be SPECIFIC to what you observed in THIS chat
- Must give her something she wouldn't have thought of on her own
- NEVER generic: "Communicate better", "Set boundaries", "Be yourself", "Keep the energy going", "Try a different activity"
- GOOD: "Next time he starts the game, make HIM go first. See what letters he picks for you"
- GOOD: "Manda un vocale la prossima volta, il testo nasconde l'energia che avete"`;

const EXTRACTION_PROMPT = `You are a chat message extraction tool. Your ONLY job is to read chat screenshot(s) and report the VISUAL HORIZONTAL POSITION of each message bubble.

YOUR TASK IS EXTREMELY SIMPLE:
For each message bubble visible in the screenshot, report:
1. The exact text content of the message
2. Whether the bubble is positioned on the LEFT side or RIGHT side of the screen

RULES:
- A message bubble that is aligned/anchored to the LEFT edge of the screen -> position = "left"
- A message bubble that is aligned/anchored to the RIGHT edge of the screen -> position = "right"
- DO NOT try to determine who sent the message
- DO NOT interpret meaning or context
- DO NOT look at colors, checkmarks, or any other indicators
- ONLY report the horizontal alignment of each bubble: "left" or "right"
- Extract ALL messages in chronological order (top to bottom)
- Copy each message text as written (don't paraphrase)
- If a message spans multiple lines, include the full text
- EXCLUDE any timestamp from the message text (like "12:41 AM", "3:30 PM", "14:22", "12:55 AM"). Timestamps appear near message bubbles but are NOT part of the message content. Only extract the actual words/text of the message, never the time.
- EXCLUDE read receipt indicators (checkmarks) from the message text
- DO NOT extract the contact name from the chat header

This is a PURELY VISUAL task. You are reporting layout positions and message TEXT ONLY (no timestamps, no checkmarks, no contact names).

OUTPUT FORMAT (JSON only, no other text):
{
  "messages": [
    { "position": "left", "text": "<message text WITHOUT timestamps>" },
    { "position": "right", "text": "<message text WITHOUT timestamps>" },
    ...
  ]
}`;

interface RawExtractedMessage {
  position: 'left' | 'right';
  text: string;
}

interface RawExtractionResult {
  contactName?: string;  // No longer extracted, kept for backwards compat
  messages: RawExtractedMessage[];
}

interface ExtractedMessage {
  sender: 'person' | 'user';
  text: string;
}

export interface ExtractionResult {
  personName: string;
  platform: string;
  messages: ExtractedMessage[];
}

async function convertFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      // Remove the data:image/...;base64, prefix for Gemini
      const base64Data = base64.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getMimeType(file: File): string {
  const type = file.type;
  if (type === 'image/jpeg' || type === 'image/jpg') return 'image/jpeg';
  if (type === 'image/png') return 'image/png';
  if (type === 'image/webp') return 'image/webp';
  if (type === 'image/heic') return 'image/heic';
  return 'image/jpeg'; // default
}

export async function extractMessagesFromImages(imageFiles: File[]): Promise<ExtractionResult> {
  const genAI = getGeminiClient();
  // Use gemini-2.0-flash for vision tasks
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Prepare image parts for Gemini
  const imageParts = await Promise.all(
    imageFiles.map(async (file) => ({
      inlineData: {
        data: await convertFileToBase64(file),
        mimeType: getMimeType(file),
      },
    }))
  );

  const result = await model.generateContent([
    { text: EXTRACTION_PROMPT },
    ...imageParts,
  ]);

  const response = result.response;
  const content = response.text();

  if (!content) {
    throw new Error('No response from Gemini extraction step');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from extraction response');
  }

  const rawResult = JSON.parse(jsonMatch[0]) as RawExtractionResult;

  // DETERMINISTIC MAPPING: left = person (received), right = user (sent)
  // Also strip any timestamps/checkmarks that Gemini might have included
  const mappedMessages: ExtractedMessage[] = rawResult.messages.map((m) => ({
    sender: m.position === 'left' ? 'person' : 'user',
    text: m.text
      .replace(/\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)\s*$/i, '')  // Strip 12h timestamps: "Hi 12:41 AM" → "Hi"
      .replace(/\s*\d{1,2}:\d{2}\s*$/i, '')                      // Strip 24h timestamps: "Hi 14:22" → "Hi"
      .replace(/\s*[✓✔]{1,2}\s*$/g, '')                          // Strip read receipts: "Hi ✓✓" → "Hi"
      .replace(/\s*\/?\s*$/g, '')                                  // Strip trailing slashes
      .trim(),
  }));

  return {
    personName: 'Him',  // Never use extracted names - the app uses the user-assigned name
    platform: 'detected',
    messages: mappedMessages,
  };
}

function buildAnalysisPromptWithMessages(extraction: ExtractionResult): string {
  const transcript = extraction.messages
    .map((m) => {
      const label =
        m.sender === 'person'
          ? `[THEIR MESSAGE]`
          : `[YOUR MESSAGE - User]`;
      return `${label}: "${m.text}"`;
    })
    .join('\n');

  const personMessages = extraction.messages.filter((m) => m.sender === 'person');
  const userMessages = extraction.messages.filter((m) => m.sender === 'user');

  return `${ANALYSIS_PROMPT}

==========================================================================
CHAT TRANSCRIPT (pre-extracted and labeled - DO NOT question these labels):
==========================================================================

Platform: ${extraction.platform}
Person being analyzed: the other person
Total messages from THEM: ${personMessages.length}
Total messages from USER: ${userMessages.length}

--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---

CRITICAL REMINDER FOR messageInsights:
The messages labeled [THEIR MESSAGE] are from the person being analyzed.
The messages labeled [YOUR MESSAGE] are from the user who uploaded the chat.
For messageInsights, ONLY use messages labeled [THEIR MESSAGE].
NEVER use messages labeled [YOUR MESSAGE] in messageInsights.

GO THROUGH EVERY [THEIR MESSAGE] ONE BY ONE. If it has subtext, hidden meaning, deflection, power move, emotional tell — include it.
Skip ONLY bare greetings ("Hi", "Hey") and truly empty responses. Decode EVERYTHING else.
There are ${personMessages.length} of his messages. You should have at LEAST ${Math.max(3, Math.min(personMessages.length - 1, 6))} messageInsights.

RED FLAG is ONLY for genuinely toxic behavior (manipulation, gaslighting, control, disrespect).
Use DECODED for vulnerability, hesitation, hidden meaning, subtext, deflection, avoidance.
The user wants EVERY notable message explained. More insights = more value.

CRITICAL REMINDER FOR BEHAVIORAL EXTRACTION:
1. Extract 4-8 behavioral keywords for EACH person (him and her)
2. Use short, descriptive keywords like: "ghosting", "hot cold", "manipulation", "controlling", "loyal", "caring"
3. Cite 2-3 specific messages as evidence for each person
4. The app will automatically match behaviors to Soul Types

CRITICAL REMINDER FOR NAMES:
NEVER use a contact name from the chat header in any description. Use "he"/"him" or "she"/"her".

CRITICAL REMINDER FOR RELATIONSHIP STAGE:
NEVER use "Early Stage" as a personalizedTrait. NEVER say "early stages", "it's still early", "just getting started" in any description. You cannot determine the relationship stage from a chat snippet. Describe the VIBE, not the stage.`;
}

export async function analyzeChatScreenshots(
  imageFiles: File[],
  validatedExtraction?: ExtractionResult
): Promise<ChatAnalysisResult> {
  const genAI = getGeminiClient();

  try {
    // Use validated extraction if provided (user already confirmed sides)
    let extraction: ExtractionResult;

    if (validatedExtraction) {
      console.log('[Gemini] Using user-validated extraction (100% accurate)');
      extraction = validatedExtraction;
    } else {
      console.log('[Gemini] Step 1: Extracting messages from screenshots...');
      extraction = await extractMessagesFromImages(imageFiles);
    }

    console.log('[Gemini] Extraction result:', JSON.stringify(extraction, null, 2));
    const finalPersonMsgs = extraction.messages.filter((m) => m.sender === 'person');
    const finalUserMsgs = extraction.messages.filter((m) => m.sender === 'user');
    console.log(
      `[Gemini] Final attribution: ${finalPersonMsgs.length} person msgs, ${finalUserMsgs.length} user msgs`
    );

    // STEP 2: Analyze using pre-labeled text
    console.log('[Gemini] Step 2: Analyzing pre-labeled messages with Gemini 2.0 Flash...');
    const analysisPrompt = buildAnalysisPromptWithMessages(extraction);

    // Use gemini-2.0-flash for analysis (fast + smart)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4000,
      },
    });

    const result = await model.generateContent(analysisPrompt);
    const response = result.response;
    const content = response.text();

    if (!content) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from response');
    }

    const analysisResult = JSON.parse(jsonMatch[0]) as ChatAnalysisResult;

    // CONTEXT CONSISTENCY VALIDATION (Layer 3 of Three-Layer Defense)
    const reasoning = analysisResult.reasoning || inferReasoningFromScores(analysisResult.scores);
    analysisResult.reasoning = reasoning;
    console.log('[Gemini] Reasoning:', JSON.stringify(reasoning));
    validateConsistency(reasoning, analysisResult);

    // HYBRID APPROACH: AI provides observedBehaviors, client-side matching fills in Soul Type
    // Ensure observedBehaviors arrays exist (fallback for older format)
    if (!analysisResult.personArchetype.observedBehaviors) {
      analysisResult.personArchetype.observedBehaviors = [];
    }
    if (!analysisResult.userArchetype.observedBehaviors) {
      analysisResult.userArchetype.observedBehaviors = [];
    }

    console.log('[Gemini] Person observed behaviors:', analysisResult.personArchetype.observedBehaviors);
    console.log('[Gemini] User observed behaviors:', analysisResult.userArchetype.observedBehaviors);

    // HARD FILTER: Remove any messageInsights that use user messages
    const personMessageTexts = extraction.messages
      .filter((m) => m.sender === 'person')
      .map((m) => m.text.toLowerCase().trim());

    if (analysisResult.messageInsights && analysisResult.messageInsights.length > 0) {
      const originalCount = analysisResult.messageInsights.length;

      analysisResult.messageInsights = analysisResult.messageInsights.filter((insight) => {
        const insightText = (insight.message || '').toLowerCase().trim();

        const isPersonMessage = personMessageTexts.some((personText) => {
          if (insightText === personText) return true;
          if (insightText.includes(personText) || personText.includes(insightText)) return true;
          if (
            insightText.length > 10 &&
            personText.length > 10 &&
            insightText.substring(0, 30) === personText.substring(0, 30)
          )
            return true;
          return false;
        });

        if (!isPersonMessage) {
          console.warn(`[Gemini FILTERED OUT] messageInsight uses user message: "${insight.message}"`);
        }
        return isPersonMessage;
      });

      const filteredCount = analysisResult.messageInsights.length;
      analysisResult.messageInsights.forEach((insight, idx) => {
        insight.messageCount = `${idx + 1} of ${filteredCount}`;
      });

      if (filteredCount < originalCount) {
        console.log(
          `[Gemini HARD FILTER] Removed ${originalCount - filteredCount} user messages from messageInsights. ${filteredCount} remain.`
        );
      }
    }

    // HARD FILTER: Strip transcript labels from messageInsight messages
    if (analysisResult.messageInsights && analysisResult.messageInsights.length > 0) {
      analysisResult.messageInsights.forEach(insight => {
        if (insight.message) {
          insight.message = insight.message
            .replace(/^\[THEIR MESSAGE\]\s*:\s*/i, '')
            .replace(/^\[YOUR MESSAGE(?:\s*-\s*User)?\]\s*:\s*/i, '')
            .replace(/^["']|["']$/g, '');
        }
      });
    }

    // HARD FILTER: Strip transcript labels from specificExamples in categoryAnalysis
    if (analysisResult.categoryAnalysis) {
      for (const [, cat] of Object.entries(analysisResult.categoryAnalysis)) {
        if (cat && cat.specificExamples && Array.isArray(cat.specificExamples)) {
          cat.specificExamples = cat.specificExamples.map((example: string) =>
            example
              .replace(/^\[THEIR MESSAGE\]\s*:\s*/i, '')
              .replace(/^\[YOUR MESSAGE(?:\s*-\s*User)?\]\s*:\s*/i, '')
              .replace(/^["']|["']$/g, '')
          );
        }
      }
    }

    // HARD FILTER: Remove any messageInsights with invalid tags (only RED FLAG, GREEN FLAG, and DECODED are valid)
    if (analysisResult.messageInsights && analysisResult.messageInsights.length > 0) {
      const validTags = ['RED FLAG', 'GREEN FLAG', 'DECODED'];
      const beforeCount = analysisResult.messageInsights.length;
      analysisResult.messageInsights = analysisResult.messageInsights.filter((insight) => {
        const isValid = validTags.includes(insight.tag);
        if (!isValid) {
          console.warn(`[Gemini FILTERED OUT] Invalid tag "${insight.tag}" on message: "${insight.message}"`);
        }
        return isValid;
      });
      if (analysisResult.messageInsights.length < beforeCount) {
        console.log(`[Gemini HARD FILTER] Removed ${beforeCount - analysisResult.messageInsights.length} insights with invalid tags.`);
        analysisResult.messageInsights.forEach((insight, idx) => {
          insight.messageCount = `${idx + 1} of ${analysisResult.messageInsights.length}`;
        });
      }
    }

    // HARD FILTER: Remove "Early Stage" and relationship-stage assumptions from personalizedTraits
    const bannedTraits = ['early stage', 'new connection', 'getting to know', 'just starting', 'fresh start', 'beginning'];
    if (analysisResult.categoryAnalysis) {
      for (const [catKey, cat] of Object.entries(analysisResult.categoryAnalysis)) {
        if (cat && cat.personalizedTraits) {
          const before = cat.personalizedTraits.length;
          cat.personalizedTraits = cat.personalizedTraits.filter((trait: string) => {
            const isStage = bannedTraits.some(b => trait.toLowerCase().includes(b));
            if (isStage) console.warn(`[Gemini HARD FILTER] Removed stage trait "${trait}" from ${catKey}`);
            return !isStage;
          });
          // Pad back to 4 traits if we removed any
          while (cat.personalizedTraits.length < 4 && cat.personalizedTraits.length < before) {
            cat.personalizedTraits.push('Casual');
          }
        }
        // Also clean descriptions
        if (cat && cat.personalizedDescription) {
          cat.personalizedDescription = cat.personalizedDescription
            .replace(/\b(early stage[s]?|it'?s still early|just getting started|still new|early on|early days)\b/gi, 'at this point');
        }
      }
    }

    return analysisResult;
  } catch (error) {
    console.error('[Gemini] Error analyzing chat:', error);
    throw error;
  }
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

// ============================================
// TWO-PHASE ANALYSIS FUNCTIONS
// ============================================

function buildQuickAnalysisPrompt(extraction: ExtractionResult): string {
  const transcript = extraction.messages
    .map((m) => {
      const label = m.sender === 'person'
        ? `[THEIR MESSAGE]`
        : `[YOUR MESSAGE - User]`;
      return `${label}: "${m.text}"`;
    })
    .join('\n');

  return `${QUICK_ANALYSIS_PROMPT}

CHAT TRANSCRIPT:
Person being analyzed: the other person
--- TRANSCRIPT ---
${transcript}
--- END ---

REMINDER: Extract 4-8 behavioral keywords for EACH person.
Use short, descriptive keywords like: "ghosting", "hot cold", "manipulation", "loyal", "caring", "catches feelings"
NEVER use a contact name from the chat header in descriptions. Use "he"/"him" or "she"/"her".`;
}

function buildDetailedAnalysisPrompt(extraction: ExtractionResult, phase1Reasoning?: ContextReasoning): string {
  const transcript = extraction.messages
    .map((m) => {
      const label = m.sender === 'person'
        ? `[THEIR MESSAGE]`
        : `[YOUR MESSAGE - User]`;
      return `${label}: "${m.text}"`;
    })
    .join('\n');

  const personMessages = extraction.messages.filter((m) => m.sender === 'person');

  const phase1Context = phase1Reasoning ? `
PHASE 1 CONTEXT (from the quick analysis of this SAME chat - your reasoning MUST be consistent):
- Overall Vibe: ${phase1Reasoning.overallVibe}
- Chat Context: ${phase1Reasoning.chatContext}
- Is Meme/Joke: ${phase1Reasoning.isMemeOrJoke}
- Toxicity Assessment: ${phase1Reasoning.toxicityAssessment}
- Severity Ceiling: ${phase1Reasoning.severityCeiling}
Your reasoning block MUST match this Phase 1 assessment. Do NOT contradict it.
` : '';

  return `${DETAILED_ANALYSIS_PROMPT}
${phase1Context}
CHAT TRANSCRIPT:
Person being analyzed: the other person
Total [THEIR MESSAGE] count: ${personMessages.length}
--- TRANSCRIPT ---
${transcript}
--- END ---

REMINDER: messageInsights MUST use ONLY [THEIR MESSAGE] messages.
ANALYZE EVERY [THEIR MESSAGE] — if it has ANY subtext, emotional tell, deflection, or hidden meaning, include it.
There are ${personMessages.length} messages from him. Expect at LEAST ${Math.max(3, Math.min(personMessages.length - 1, 6))} messageInsights.
Skip ONLY bare greetings ("Hi", "Hey") and truly empty responses. Everything else gets decoded.
RED FLAG = ONLY genuinely toxic behavior. Vulnerability/fear/hesitation = DECODED, never RED FLAG.
NEVER use a contact name from the chat header. Use "he"/"him" or "she"/"her".
NEVER use "Early Stage" as a personalizedTrait. NEVER write "early stages" or "it's still early" in any description. Describe the VIBE, not the stage.`;
}

/**
 * PHASE 1: Quick analysis - scores + archetypes only (~5-6 seconds)
 * Shows: Toxic Score section + Soul Type section
 */
export async function analyzeQuick(imageFiles: File[]): Promise<{ quick: QuickAnalysisResult; extraction: ExtractionResult }> {
  const genAI = getGeminiClient();

  console.log('[Gemini Phase 1] Extracting messages...');
  const extraction = await extractMessagesFromImages(imageFiles);
  console.log('[Gemini Phase 1] Extraction complete:', extraction.messages.length, 'messages');

  console.log('[Gemini Phase 1] Starting quick analysis...');
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1800, // Increased for reasoning block
    },
  });

  const prompt = buildQuickAnalysisPrompt(extraction);
  const result = await model.generateContent(prompt);
  const content = result.response.text();

  if (!content) {
    throw new Error('No response from Gemini quick analysis');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from quick analysis response');
  }

  const quickResult = JSON.parse(jsonMatch[0]) as QuickAnalysisResult;

  // CONTEXT CONSISTENCY VALIDATION (Layer 3 of Three-Layer Defense)
  const reasoning = quickResult.reasoning || inferReasoningFromScores(quickResult.scores);
  quickResult.reasoning = reasoning;
  console.log('[Gemini Phase 1] Reasoning:', JSON.stringify(reasoning));
  validateConsistency(reasoning, quickResult);

  // HYBRID APPROACH: Ensure observedBehaviors arrays exist
  if (!quickResult.personArchetype.observedBehaviors) {
    quickResult.personArchetype.observedBehaviors = [];
  }
  if (!quickResult.userArchetype.observedBehaviors) {
    quickResult.userArchetype.observedBehaviors = [];
  }

  console.log('[Gemini Phase 1] Person observed behaviors:', quickResult.personArchetype.observedBehaviors);
  console.log('[Gemini Phase 1] User observed behaviors:', quickResult.userArchetype.observedBehaviors);
  console.log('[Gemini Phase 1] Quick analysis complete!');
  return { quick: quickResult, extraction };
}

/**
 * PHASE 2: Detailed analysis - cards + insights (runs in background)
 * Shows: SwipeableCardDeck, VerticalCardDeck, DynamicCard
 */
export async function analyzeDetailed(extraction: ExtractionResult, phase1Reasoning?: ContextReasoning): Promise<DetailedAnalysisResult> {
  const genAI = getGeminiClient();

  console.log('[Gemini Phase 2] Starting detailed analysis...');
  if (phase1Reasoning) {
    console.log('[Gemini Phase 2] Using Phase 1 reasoning context:', JSON.stringify(phase1Reasoning));
  }
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4000,
    },
  });

  const prompt = buildDetailedAnalysisPrompt(extraction, phase1Reasoning);
  const result = await model.generateContent(prompt);
  const content = result.response.text();

  if (!content) {
    throw new Error('No response from Gemini detailed analysis');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from detailed analysis response');
  }

  const detailedResult = JSON.parse(jsonMatch[0]) as DetailedAnalysisResult;

  // CONTEXT CONSISTENCY VALIDATION (Layer 3 of Three-Layer Defense)
  const reasoning = detailedResult.reasoning || (phase1Reasoning ? phase1Reasoning : inferReasoningFromScores({ overall: 50, warmth: 50, drama: 50, passion: 50 }));
  detailedResult.reasoning = reasoning;
  console.log('[Gemini Phase 2] Reasoning:', JSON.stringify(reasoning));
  validateConsistency(reasoning, detailedResult);

  // Filter messageInsights to only include person messages
  const personMessageTexts = extraction.messages
    .filter((m) => m.sender === 'person')
    .map((m) => m.text.toLowerCase().trim());

  if (detailedResult.messageInsights && detailedResult.messageInsights.length > 0) {
    detailedResult.messageInsights = detailedResult.messageInsights.filter((insight) => {
      const insightText = (insight.message || '').toLowerCase().trim();
      return personMessageTexts.some((personText) => {
        if (insightText === personText) return true;
        if (insightText.includes(personText) || personText.includes(insightText)) return true;
        if (insightText.length > 10 && personText.length > 10 &&
            insightText.substring(0, 30) === personText.substring(0, 30)) return true;
        return false;
      });
    });

    // Re-number the insights
    detailedResult.messageInsights.forEach((insight, idx) => {
      insight.messageCount = `${idx + 1} of ${detailedResult.messageInsights.length}`;
    });
  }

  // HARD FILTER: Strip transcript labels from messageInsight messages
  if (detailedResult.messageInsights && detailedResult.messageInsights.length > 0) {
    detailedResult.messageInsights.forEach(insight => {
      if (insight.message) {
        insight.message = insight.message
          .replace(/^\[THEIR MESSAGE\]\s*:\s*/i, '')
          .replace(/^\[YOUR MESSAGE(?:\s*-\s*User)?\]\s*:\s*/i, '')
          .replace(/^["']|["']$/g, '');
      }
    });
  }

  // HARD FILTER: Strip transcript labels from specificExamples in categoryAnalysis
  if (detailedResult.categoryAnalysis) {
    for (const [, cat] of Object.entries(detailedResult.categoryAnalysis)) {
      if (cat && cat.specificExamples && Array.isArray(cat.specificExamples)) {
        cat.specificExamples = cat.specificExamples.map((example: string) =>
          example
            .replace(/^\[THEIR MESSAGE\]\s*:\s*/i, '')
            .replace(/^\[YOUR MESSAGE(?:\s*-\s*User)?\]\s*:\s*/i, '')
            .replace(/^["']|["']$/g, '')
        );
      }
    }
  }

  // HARD FILTER: Remove any messageInsights with invalid tags (only RED FLAG, GREEN FLAG, and DECODED are valid)
  if (detailedResult.messageInsights && detailedResult.messageInsights.length > 0) {
    const validTags = ['RED FLAG', 'GREEN FLAG', 'DECODED'];
    const beforeCount = detailedResult.messageInsights.length;
    detailedResult.messageInsights = detailedResult.messageInsights.filter((insight) => {
      const isValid = validTags.includes(insight.tag);
      if (!isValid) {
        console.warn(`[Gemini Phase 2 FILTERED OUT] Invalid tag "${insight.tag}" on message: "${insight.message}"`);
      }
      return isValid;
    });
    if (detailedResult.messageInsights.length < beforeCount) {
      console.log(`[Gemini Phase 2 HARD FILTER] Removed ${beforeCount - detailedResult.messageInsights.length} insights with invalid tags.`);
      detailedResult.messageInsights.forEach((insight, idx) => {
        insight.messageCount = `${idx + 1} of ${detailedResult.messageInsights.length}`;
      });
    }
  }

  // HARD FILTER: Remove "Early Stage" and relationship-stage assumptions from personalizedTraits
  const bannedTraits = ['early stage', 'new connection', 'getting to know', 'just starting', 'fresh start', 'beginning'];
  if (detailedResult.categoryAnalysis) {
    for (const [catKey, cat] of Object.entries(detailedResult.categoryAnalysis)) {
      if (cat && cat.personalizedTraits) {
        const before = cat.personalizedTraits.length;
        cat.personalizedTraits = cat.personalizedTraits.filter((trait: string) => {
          const isStage = bannedTraits.some(b => trait.toLowerCase().includes(b));
          if (isStage) console.warn(`[Gemini Phase 2 HARD FILTER] Removed stage trait "${trait}" from ${catKey}`);
          return !isStage;
        });
        while (cat.personalizedTraits.length < 4 && cat.personalizedTraits.length < before) {
          cat.personalizedTraits.push('Casual');
        }
      }
      if (cat && cat.personalizedDescription) {
        cat.personalizedDescription = cat.personalizedDescription
          .replace(/\b(early stage[s]?|it'?s still early|just getting started|still new|early on|early days)\b/gi, 'at this point');
      }
    }
  }

  console.log('[Gemini Phase 2] Detailed analysis complete!');
  return detailedResult;
}

// ============================================
// SOUL TYPE PERSONALIZATION MICRO-CALL
// ============================================

export interface SoulTypePersonalizationInput {
  soulTypeName: string;
  soulTypeTagline: string;
  soulTypeDescription: string;
  soulTypeTraits: string[];
  observedBehaviors: string[];
  evidenceMessages: string[];
  gender: 'male' | 'female';
}

export interface SoulTypePersonalizationResult {
  description: string;
  traits: string[];
}

/**
 * Post-match micro-call: Generates personalized Soul Type descriptions
 * that connect the person's actual behavior to their matched Soul Type.
 * Fast (~2s) because the prompt is very small.
 */
export async function generatePersonalizedSoulTypeDescriptions(
  person: SoulTypePersonalizationInput,
  user: SoulTypePersonalizationInput
): Promise<{ person: SoulTypePersonalizationResult; user: SoulTypePersonalizationResult } | null> {
  const genAI = getGeminiClient();

  console.log('[Gemini Soul Type Personalization] Starting...');
  console.log(`[Gemini Soul Type Personalization] Person: "${person.soulTypeName}", User: "${user.soulTypeName}"`);

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `You personalize Soul Type descriptions for a relationship analysis app. You're talking TO the girl who uploaded this chat.

PERSON (${person.gender}):
- Soul Type: "${person.soulTypeName}"
- Identity: "${person.soulTypeTagline}"
- Core description: "${person.soulTypeDescription}"
- Default traits: ${JSON.stringify(person.soulTypeTraits)}
- Observed behaviors in chat: ${JSON.stringify(person.observedBehaviors)}
- Evidence messages: ${JSON.stringify(person.evidenceMessages.slice(0, 3))}

USER (${user.gender}):
- Soul Type: "${user.soulTypeName}"
- Identity: "${user.soulTypeTagline}"
- Core description: "${user.soulTypeDescription}"
- Default traits: ${JSON.stringify(user.soulTypeTraits)}
- Observed behaviors in chat: ${JSON.stringify(user.observedBehaviors)}
- Evidence messages: ${JSON.stringify(user.evidenceMessages.slice(0, 3))}

For EACH person, write:
1. A personalized description (2-3 sentences, under 25 words total) that describes WHO they are. Connect behavior to Soul Type. NOT chat events. CHARACTER only. Mix sentence lengths for natural rhythm.
2. Exactly 3 short personality traits (1-2 words each) that are ALIGNED with the Soul Type but SPECIFIC to their observed behavior. Use the default traits as inspiration but make them specific to what you observed.

RULES:
- NEVER reference chat events directly ("he said X", "she texted Y")
- Describe personality, character, and energy, not actions
- The description should feel like it belongs ON the Soul Type card
- Traits must be SHORT (1-2 words) and ALIGNED with the Soul Type's vibe
- NEVER use em dash. Use periods, commas, or hyphens instead
- NEVER use names from chat headers. Use "he"/"she" generically

TONE & RHYTHM - CRITICAL:
- Write truth bombs, not therapy notes. Screenshot-worthy
- MIX sentence lengths: one medium sentence + one short punch. NOT four 5-word fragments
- Combine related ideas: "He feels everything but won't show it" > "He feels everything. He just won't show it."
- VARY SUBJECTS: NEVER start 2+ consecutive sentences with "He". Alternate: He / You / That / This / It
- For the PERSON: "He connects in theory but never in practice. You'll keep waiting." (He → You)
- For the USER: "You don't perform, you just are. That's your whole power." (You → That)
- NEVER sound like a therapist. No "exhibits", "demonstrates", "indicates", "consistent warmth"
- NEVER write 4+ short fragmented sentences. Max 2-3 sentences with natural flow
- BAD: "He avoids. He deflects. He controls." (monotone He He He)
- GOOD: "He avoids the hard conversations. You end up carrying the weight. That's the pattern."
- BAD: "He demonstrates consistent warmth and genuine attentiveness in his interactions"
- GOOD: "He's warm when it's easy, absent when it matters. You deserve consistency."

JSON only:
{
  "person": {
    "description": "<personalized description connecting behavior to Soul Type>",
    "traits": ["<trait1>", "<trait2>", "<trait3>"]
  },
  "user": {
    "description": "<personalized description connecting behavior to Soul Type>",
    "traits": ["<trait1>", "<trait2>", "<trait3>"]
  }
}`;

    const result = await model.generateContent(prompt);
    const content = result.response.text();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Gemini Soul Type Personalization] No JSON found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    console.log('[Gemini Soul Type Personalization] Complete!');
    console.log('[Gemini Soul Type Personalization] Person description:', parsed.person?.description);
    console.log('[Gemini Soul Type Personalization] Person traits:', parsed.person?.traits);
    console.log('[Gemini Soul Type Personalization] User description:', parsed.user?.description);
    console.log('[Gemini Soul Type Personalization] User traits:', parsed.user?.traits);

    return {
      person: {
        description: parsed.person?.description || person.soulTypeDescription,
        traits: (parsed.person?.traits || person.soulTypeTraits).slice(0, 3),
      },
      user: {
        description: parsed.user?.description || user.soulTypeDescription,
        traits: (parsed.user?.traits || user.soulTypeTraits).slice(0, 3),
      },
    };
  } catch (error) {
    console.warn('[Gemini Soul Type Personalization] Failed:', error);
    return null;
  }
}
