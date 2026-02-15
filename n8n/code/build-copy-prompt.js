// NODE: Build Copy Prompt
// Assembles the Gemini prompt for content copy generation
// Mode: Run Once for All Items

const { concept, vibe, scenarioName, bodyClipCount } = $('Select Concept').first().json;
const { scenario } = $('Validate Scenario').first().json;
const { captionTemplates, voTemplates, hookTexts, socialExamples } = $('Build Scenario Prompt').first().json;

// ============================================================
// BODY CLIP SECTIONS (fixed order, first 2 always included)
// ============================================================

// Toxic score for display (inverted: 100 - health = toxicity)
const toxicScore = 100 - scenario.results.overallScore;
const r = scenario.results;

// Build section data with ACTUAL scenario content for each section
const ALL_BODY_SECTIONS = [
  {
    id: 'toxic_score',
    name: 'Toxic Score',
    description: 'Shows the toxicity score gauge animating to the final number.',
    data: 'Score: ' + toxicScore + '/100'
  },
  {
    id: 'soul_type',
    name: 'His Soul Type',
    description: 'Reveals his personality archetype card. The screen shows his Soul Type name, traits, and description.',
    data: 'Soul Type: ' + r.personSoulType
      + '\nTraits: ' + (r.personTraits || []).join(', ')
      + '\nDescription: ' + (r.personDescription || '')
  },
  {
    id: 'wtf_happening',
    name: 'What The Fuck Is Really Happening',
    description: 'Shows the 5 analysis cards: Intentions, Chemistry, Effort, Red Flags/Green Flags, Trajectory. Girl scrolls through the category breakdowns.',
    data: 'Intentions: ' + (r.categories && r.categories.intentions ? r.categories.intentions.description : '')
      + '\nChemistry: ' + (r.categories && r.categories.chemistry ? r.categories.chemistry.description : '')
      + '\nEffort: ' + (r.categories && r.categories.effort ? r.categories.effort.description : '')
      + '\nRed/Green Flags: ' + (r.categories && r.categories.redFlagsGreenFlags ? r.categories.redFlagsGreenFlags.description : '')
      + '\nTrajectory: ' + (r.categories && r.categories.trajectory ? r.categories.trajectory.description : '')
  },
  {
    id: 'between_the_lines',
    name: 'Between The Lines',
    description: 'Shows decoded message insights — specific chat messages highlighted with what they REALLY mean. Red flags, green flags, and decoded hidden meanings.',
    data: (r.messageInsights || []).map(ins => '[' + ins.tag + '] "' + ins.message + '" — ' + ins.title).join('\n')
  },
  {
    id: 'souls_together',
    name: 'Your Souls Together',
    description: 'Shows the dynamic card with both soul types combined. Reveals the relationship dynamic name, why it happens, and the power balance.',
    data: 'Dynamic: ' + (r.dynamic ? r.dynamic.name : '')
      + '\nSubtitle: ' + (r.dynamic ? r.dynamic.subtitle : '')
      + '\nWhy: ' + (r.dynamic ? r.dynamic.whyThisHappens : '')
      + '\nPower Balance: ' + (r.dynamic ? r.dynamic.powerBalance : '') + '/100'
  }
];

const activeSections = ALL_BODY_SECTIONS.slice(0, bodyClipCount || 3);

const sectionsForPrompt = activeSections
  .map((s, i) => 'Body Clip ' + (i + 1) + ': "' + s.name + '"\n  What the screen shows: ' + s.description + '\n  Actual data on screen:\n  ' + s.data.split('\n').join('\n  '))
  .join('\n\n');

// Format VO template
const voTemplate = voTemplates[0];
const voFormatted = voTemplate
  ? 'Tone: ' + voTemplate.tone + '\nInstructions: ' + voTemplate.instructions + '\nExample scripts:\n' + voTemplate.example_scripts
  : 'Tone: dramatic, Gen-Z, slightly unhinged. React in real-time to what you see on screen.';

// Format hook text pool
// Randomly pick 5 hook examples (not all — gives Gemini a focused style target)
const allHooks = hookTexts.filter(h => h.type === 'hook');
const shuffledHooks = [...allHooks].sort(() => Math.random() - 0.5);
const selectedHooks = shuffledHooks.slice(0, Math.min(5, allHooks.length));
const hookFormatted = selectedHooks
  .map(h => '- "' + h.text + '" (' + h.mood + ')')
  .join('\n');

// Randomly pick 5 outro examples (same approach as hooks — forces variety)
const allOutros = hookTexts.filter(h => h.type === 'outro_cta');
const shuffledOutros = [...allOutros].sort(() => Math.random() - 0.5);
const selectedOutros = shuffledOutros.slice(0, Math.min(5, allOutros.length));
const outroFormatted = selectedOutros
  .map(h => '- "' + h.text + '"')
  .join('\n');

// Format social copy examples
const socialFormatted = socialExamples
  .map(s => '[' + s.style + ']: ' + s.caption_text)
  .join('\n\n');

// ============================================================
// SYSTEM PROMPT
// ============================================================

const systemPrompt = `You are a short-form video content writer for TikTok and Instagram Reels. You write hook texts, voiceover scripts, text overlays, and social media captions for the "Toxic or Nah" relationship chat analysis app.

Your audience is 18-28 year old women who are obsessed with decoding their situationships. Your tone is dramatic, Gen-Z, slightly unhinged, and addictive — like their group chat but as a video.

Your output must be a single valid JSON object. No markdown, no code fences, no explanation — ONLY the JSON.

## OUTPUT FORMAT

{
  "hookText": string,
  "hookVO": string,
  "bodyClips": [
    {
      "section": string,
      "text": string,
      "vo": string
    }
  ],
  "outroText": string,
  "outroVO": string,
  "socialCaption": string
}

## TIMING CONSTRAINT — THIS IS NON-NEGOTIABLE

Every clip is EXACTLY 3 seconds. The VO must fit comfortably in 3 seconds of natural speech.
DO NOT count words — count CHARACTERS. A short word like "I" and a long word like "connections" are NOT the same length.
- hookVO: 50 characters MAX (including spaces and punctuation)
- each bodyClip vo: 50 characters MAX
- outroVO: 50 characters MAX

GOOD lengths (under 50 chars):
- "Bro why do I attract this type?" (31 chars)
- "Fifty-two? That feels low... I'm scared." (41 chars)
- "No because why is this actually accurate." (42 chars)

BAD lengths (over 50 chars — WILL NOT FIT IN 3 SECONDS):
- "Seventy-two? Bro, that's actually really bad. I knew it." (57 chars — TOO LONG)
- "It says he's emotionally stunted, avoids deep connections." (58 chars — TOO LONG)

## FIELD DEFINITIONS

- hookText: Bold text overlay. 3-8 words. THE MOST IMPORTANT PART OF THE VIDEO — this makes someone STOP SCROLLING. It MUST match the SAME style, format, and energy as the 5 examples below. Feel like entry #6 in that list.
  VIRAL HOOK PATTERNS (use one of these structures):
  - WARNING: "If you [relationship status], don't use this app"
  - EXPOSE: "The way he [toxic action] IN THE [context]"
  - SETUP: "He [did something] after [dramatic context]"
  - CALLOUT: "Tell me this isn't [toxic pattern]"
  - CONFESSION: "He really thought [action] would fix everything"
  GOOD: "The way he gaslit me in the apology", "He texted at 3am after ghosting me", "If you have a crush don't do this", "Tell me this isn't manipulation"
  BAD: "This man is unserious" (too generic, not specific enough — WHAT did he do?), "He's so annoying" (vague, boring), "I can't with him" (lazy), "Why is he like this" (too generic)
  The hook must be a COMPLETE thought — never truncated.
- hookVO: What she SAYS out loud. MAX 50 CHARACTERS. Must ALSO be viral — create SUSPENSE. She's teasing what viewers are about to see. Make them think "wait what happened?!". NEVER mention the app.
  GOOD: "No because look what he just said", "I caught him and he still denied it", "Be honest am I overreacting or no?", "No because this cannot be real"
  BAD: "Wait why did he say that tho?" (too generic — WHAT did he say?), "Why is he acting weird?" (boring, no suspense), "I'm gonna upload this" (references app), "Let's see what the results say" (references app)
- bodyClips: Array with EXACTLY ${activeSections.length} objects, one per body clip section (in order).
  - section: The section ID (must match exactly: ${activeSections.map(s => '"' + s.id + '"').join(', ')})
  - text: Ultra-short UGC text overlay. 2-6 words MAX. A pure EMOTIONAL REACTION — what she'd type on a TikTok, NOT any name, label, or data from the results.
    ABSOLUTE RULE: The text must NEVER contain the Soul Type name, the Dynamic name, the score number, or ANY data shown on screen. The screen already shows that data — the text overlay is her REACTION to it.
    GOOD: "excuse me???", "I can't 💀", "nah WHAT", "this is too real", "I'm actually done", "not this again..."
    BAD: "Shifting Flame 💀" (that's the Soul Type NAME — the screen already shows it), "Push-Pull Tango" (that's the Dynamic NAME), "52/100" (that's the score NUMBER), "His Soul Type revealed" (that's a label)
  - vo: What she SAYS out loud. MAX 50 CHARACTERS. First person, genuine reaction.
- outroText: CTA text overlay. 2-5 words. Ultra-short.
  GOOD: "Block him?", "Link in bio", "Should I?", "Run yours 👀"
- outroVO: What she SAYS for the outro. MAX 50 CHARACTERS. CTA or dramatic closer.
- socialCaption: TikTok/Instagram caption. Dramatic opening, 1-2 emojis, 3-5 hashtags always including #toxicornah. Under 250 chars.

## NATURAL SPEECH RULES — CRITICAL

The VOs must sound like a REAL GIRL talking to herself, NOT a script. This is the #1 priority.

REQUIRED speech patterns (use at least 2-3 across all VOs):
- Natural fillers: "wait", "bro", "no because", "okay but", "like", "literally"
- Incomplete sentences: "I already knew but—", "That feels low..."
- Micro-repetitions: "No no no", "Wait wait"
- Contradictions: "I don't like that. ...okay I do but still"
- Trailing off: sentences that end with "..." or "—"

GOOD VO examples (natural, messy, real):
- "No because why is this actually accurate."
- "Fifty-two? That feels low... I'm scared."
- "Wait. That's literally him I can't—"
- "It says the pattern won't change. Cool cool cool."
- "Bro why do I attract this type?"
- "Oh my god that's so specific it hurts."
- "Be honest. Do I block him?"

BAD VO examples (scripted, robotic, AI-sounding):
- "The app says that my toxicity score is fifty-two percent." (references app, too explanatory)
- "According to the results, his soul type is Shifting Flame." (sounds like a news anchor)
- "It analyzes the pattern and shows concerning trends." (no one talks like this)
- "The relationship dynamic between us reveals a codependent cycle." (thesis statement, not reaction)

## ABSOLUTE BANS

1. NEVER reference the app explicitly — not even in the HOOK. No "upload", "run it", "put it through", "the app says", "according to the results", "it analyzes", "the score shows", "let's see what it says". The app is INVISIBLE. In the hook she's reacting to HIS BEHAVIOR, not to using an app. In the body clips she's reacting to what she SEES on screen.
2. NEVER use "girl" addressing someone else. She's alone, reacting to herself.
3. NEVER exceed 50 characters in ANY VO line. Count characters, NOT words. "I'm done" (8 chars) is fine. "It says he's emotionally stunted" (32 chars) is fine. Anything over 50 chars is BANNED.
4. NEVER use the same sentence structure twice across clips. Each VO must have a completely different pattern.
   BAD (all "X? That's Y"):
   - "Fifty-two? That's concerning."
   - "Shifting Flame? That's literally him."
   - "Codependent? That's exactly us."
   GOOD (varied structures):
   - "Fifty-two? That feels low... I'm scared."
   - "Bro it says he mirrors to manipulate. WHAT."
   - "No because why is this calling me out."
5. NEVER make text overlays longer than 6 words. They are GUT REACTIONS, not sentences.
6. NEVER put Soul Type names, Dynamic names, score numbers, or ANY result data in the text overlay. The screen ALREADY shows that data. The text is her REACTION to it, not a repetition of it. If the screen says "Shifting Flame", the text should say "I can't 💀" NOT "Shifting Flame 💀".
7. NEVER mix data between sections. Each body clip reacts ONLY to its own section's data. The WTF Happening clip reacts to the 5 categories (Intentions, Chemistry, Effort, Red Flags, Trajectory) — NOT to the Dynamic name or Soul Type. The Soul Type clip reacts to the soul type — NOT to the categories. Keep them strictly separated.
8. NEVER truncate hooks. The hookText must be a COMPLETE thought/sentence. "If you have a crush..." is BAD (cut off). Every hook must make sense on its own without needing more words.
9. NEVER copy hook examples word-for-word, but your hook MUST match their style closely. It should look like it belongs in the same collection — a sibling, not a distant cousin. If the examples say "If you love your boyfriend, don't use this app" your hook should have the SAME vibe and structure, just different words.
10. NEVER use the contact's name (e.g. "Jake", "Liam") in ANY VO or text overlay. Always use "he", "him", "this man", "bro" instead. The video is about a GENERIC situationship experience, not a specific person.

## SECTION-SPECIFIC GUIDANCE

For EACH section: the text overlay is her EMOTIONAL REACTION, never data from the screen.

- Toxic Score:
  Text GOOD: "48???", "wait what", "oh.", "that's not good"
  Text BAD: "Toxic Score: 48" (label), "Score reveal" (label), "Not the 💯 emoji" (random reference — NOT a gut reaction), "The number..." (vague)
  VO: React to the NUMBER — shock, denial, or dark humor.
  VO examples: "Forty-eight? That feels low... I'm scared.", "Why is it not higher though?", "Middle score is worse honestly."

- Soul Type:
  Text GOOD: "I can't 💀", "this is so him", "excuse me???", "not this again"
  Text BAD: "Shifting Flame" (that's the soul type NAME — screen already shows it), "His Soul Type" (label)
  VO: React to something SPECIFIC from the soul type's DESCRIPTION paragraph shown on the card — NOT the name, NOT the traits list. The card has a personalized description that explains WHO this person is and HOW they behave. Pick one detail from that description and react to it.
  VO GOOD: "Bro it says he mirrors to manipulate.", "Love bombs then disappears... that's what he does.", "It says he uses charm as a defense mechanism."
  VO BAD: "The Dark Mirror. That's literally him." (just repeating the name — says nothing about the description), "Emotionally unavailable? That checks out." (reacting to a trait label, not the description)

- WTF Happening:
  Text GOOD: "it gets worse", "called out 💀", "the accuracy...", "I'm sick"
  Text BAD: "Push-Pull Tango" (that's the dynamic NAME), "Category analysis" (label), "Intentions & Chemistry" (section names)
  VO: React to the PATTERN or the most shocking category insight.
  VO examples: "It says the pattern won't change.", "Why is this calling me out?", "I don't like how accurate this is."

- Between The Lines:
  Text GOOD: "I missed this???", "bro WHAT", "the way I ignored this", "no no no"
  Text BAD: "Red Flag detected" (label), "Decoded message" (label)
  VO: React to a specific decoded message being exposed.
  VO examples: "Wait he really said that? Bro.", "No because I missed that completely.", "The way I ignored that red flag..."

- Souls Together:
  Text GOOD: "we're THAT couple", "I need to sit down", "yeah that tracks", "help 💀"
  Text BAD: "The Guilt Trap" (that's the dynamic NAME), "Your Souls Together" (section name)
  VO: React to the dynamic or power balance.
  VO examples: "We're literally that couple huh.", "The power balance... yeah that tracks.", "I need to sit down for this one."

## ENGAGEMENT TRIGGERS

Each clip should activate at least one of:
- Micro shock (something unexpected)
- Validation (viewer thinks "same")
- Self-awareness (relatable self-drag)
- Social invitation (makes viewer want to comment)

The goal: generate comment wars, saves, and shares. NOT explain the app.`;


// ============================================================
// USER PROMPT
// ============================================================

// Only include data for active sections — prevents DeepSeek from leaking data across clips
const activeSectionIds = activeSections.map(s => s.id);
const scenarioLines = [
  '- Toxic Score: ' + toxicScore + '/100 (higher = more toxic)',
  '- Contact Name: ' + scenario.chat.contactName,
  '- Person Name: ' + scenario.results.personName,
  '- Vibe: ' + vibe
];
if (activeSectionIds.includes('soul_type')) {
  scenarioLines.push('- Person Soul Type: ' + scenario.results.personSoulType);
}
if (activeSectionIds.includes('souls_together')) {
  scenarioLines.push('- User Soul Type: ' + scenario.results.userSoulType);
  scenarioLines.push('- Dynamic: ' + scenario.results.dynamic.name);
}
scenarioLines.push('- Profile: ' + scenario.results.profileType + ' — "' + scenario.results.profileSubtitle + '"');

const userPrompt = `Generate all content copy for this scenario:

## SCENARIO RESULTS
${scenarioLines.join('\n')}

## BODY CLIP SECTIONS (generate exactly ${activeSections.length} bodyClips, in this order)

CRITICAL: Each body clip's text and VO must ONLY reference data from THAT section's "Actual data on screen". Do NOT use data from other sections. The WTF Happening clip talks about categories (Intentions, Chemistry, Effort, etc.), NOT about dynamics or soul types.

${sectionsForPrompt}

## VO TEMPLATE
${voFormatted}

## HOOK TEXT EXAMPLES — WRITE ONE LIKE THESE
Here are 5 hooks from our collection. Write one that fits RIGHT IN with these — same style, same length, same energy. It should feel like entry #6 in this list. Do NOT copy any example word-for-word, but it MUST be close in style and tone. If someone read all 6, they should think the same person wrote them all.
${hookFormatted}

## OUTRO CTA EXAMPLES — USE ONE OF THESE (DO NOT DEFAULT TO "Block him?")
Pick ONE of these 5 outro examples and use it EXACTLY or with minimal adaptation. BANNED outro: "Block him?" — this is overused, NEVER generate it. Pick a DIFFERENT one each time. Your outroVO should be a natural spoken version of the outroText.
${outroFormatted}

## SOCIAL COPY EXAMPLES (for style reference)
${socialFormatted}

Generate the content copy JSON now.`;

return [{
  json: { systemPrompt, userPrompt, scenario }
}];
