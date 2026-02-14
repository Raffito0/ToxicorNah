// NODE: Validate Scenario
// Parses Gemini response and validates the ContentScenario JSON
// Mode: Run Once for All Items

// Basic LLM Chain outputs { text: "..." } with the raw LLM response
const llmOutput = $input.first().json;
const { vibe } = $('Select Concept').first().json;

// --- JSON Repair utility ---
function repairJson(raw) {
  let s = raw;

  // 1. Strip markdown code fences
  s = s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // 2. Extract JSON object if there's text before/after it
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    s = s.substring(firstBrace, lastBrace + 1);
  }

  // 3. Remove control characters inside strings (except \n \r \t)
  // Replace literal tabs, carriage returns that break JSON
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // 4. Fix unescaped newlines inside JSON strings
  // Walk through and escape newlines that are inside string values
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && ch === '\n') {
      result += '\\n';
      continue;
    }
    if (inString && ch === '\r') {
      continue; // skip carriage returns
    }
    result += ch;
  }
  s = result;

  // 5. Fix trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, '$1');

  // 6. Fix unescaped double quotes inside strings (heuristic)
  // Look for patterns like: "text "quoted" more" and fix to "text \"quoted\" more"
  // This is tricky so we only do a conservative fix: doubled quotes "" -> \"
  // (DeepSeek sometimes outputs "" inside strings)
  s = s.replace(/([^\\])""/g, '$1\\"');

  return s;
}

// Extract JSON from LLM output
// The output parser may have already parsed it into an object
let scenario;
try {
  const raw = llmOutput.output || llmOutput.text || llmOutput;

  if (typeof raw === 'object' && raw !== null) {
    // Already parsed by Structured Output Parser
    scenario = raw;
  } else {
    // Raw string — parse with repair
    const repaired = repairJson(String(raw));
    scenario = JSON.parse(repaired);
  }
} catch (e1) {
  try {
    const raw = llmOutput.output || llmOutput.text || llmOutput;
    let repaired = repairJson(String(raw));
    repaired = repaired.replace(/[\u201C\u201D\u2018\u2019]/g, '"');
    const posMatch = e1.message.match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1]);
      repaired = repaired.substring(0, pos) + '\\' + repaired.substring(pos);
    }
    scenario = JSON.parse(repaired);
  } catch (e2) {
    return [{ json: { valid: false, errors: ['JSON parse failed after repair: ' + e1.message], scenario: null } }];
  }
}

const errors = [];

// --- Required top-level fields ---
if (!scenario.id) errors.push('Missing id');
if (!scenario.chat) errors.push('Missing chat');
if (!scenario.results) errors.push('Missing results');

if (scenario.chat) {
  if (!scenario.chat.contactName) errors.push('Missing chat.contactName');
  if (!['imessage', 'instagram', 'whatsapp'].includes(scenario.chat.appStyle)) {
    errors.push('Invalid appStyle: ' + scenario.chat.appStyle);
  }
  if (!Array.isArray(scenario.chat.messages) || scenario.chat.messages.length < 12) {
    errors.push('Too few messages: ' + (scenario.chat.messages ? scenario.chat.messages.length : 0) + ' (min 12)');
  }
  if (scenario.chat.messages && scenario.chat.messages.length > 25) {
    errors.push('Too many messages: ' + scenario.chat.messages.length + ' (max 25)');
  }
  // Validate each message
  if (scenario.chat.messages) {
    scenario.chat.messages.forEach((msg, i) => {
      if (!['them', 'me'].includes(msg.sender)) errors.push('Message ' + i + ': invalid sender "' + msg.sender + '"');
      if (!msg.text || typeof msg.text !== 'string') errors.push('Message ' + i + ': missing or invalid text');
    });
  }
}

const r = scenario.results;
if (r) {
  // --- personName auto-fix ---
  const expectedName = r.personGender === 'male' ? 'Him' : 'Her';
  if (r.personName !== expectedName) {
    errors.push('personName should be "' + expectedName + '", got "' + r.personName + '" (auto-fixed)');
    r.personName = expectedName;
  }

  // --- Scores 0-100 ---
  const scoreFields = ['overallScore', 'warmthScore', 'communicationScore', 'dramaScore', 'distanceScore', 'passionScore'];
  scoreFields.forEach(field => {
    const val = r[field];
    if (typeof val !== 'number' || val < 0 || val > 100) {
      errors.push(field + ' out of range: ' + val);
    }
  });

  // --- Hard-code: toxic score must be 70+ (overallScore ≤ 30) for all vibes ---
  if (typeof r.overallScore === 'number' && r.overallScore > 30) {
    errors.push('overallScore=' + r.overallScore + ' too high (max 30, toxic score must be 70+) — auto-fixed to 30');
    r.overallScore = 30;
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
  const ALL_SOUL_TYPES = MALE_SOUL_TYPES.concat(FEMALE_SOUL_TYPES);

  if (!ALL_SOUL_TYPES.includes(r.personSoulType)) {
    errors.push('Invalid personSoulType: "' + r.personSoulType + '"');
  }
  if (!ALL_SOUL_TYPES.includes(r.userSoulType)) {
    errors.push('Invalid userSoulType: "' + r.userSoulType + '"');
  }

  // Gender-soul type cross check
  if (r.personGender === 'male' && r.personSoulType && !r.personSoulType.startsWith('male-')) {
    errors.push('personGender=male but personSoulType is not male: ' + r.personSoulType);
  }
  if (r.personGender === 'male' && r.userSoulType && !r.userSoulType.startsWith('female-')) {
    errors.push('personGender=male but userSoulType should be female: ' + r.userSoulType);
  }
  if (r.personGender === 'female' && r.personSoulType && !r.personSoulType.startsWith('female-')) {
    errors.push('personGender=female but personSoulType is not female: ' + r.personSoulType);
  }
  if (r.personGender === 'female' && r.userSoulType && !r.userSoulType.startsWith('male-')) {
    errors.push('personGender=female but userSoulType should be male: ' + r.userSoulType);
  }

  // --- Traits ---
  if (!Array.isArray(r.personTraits) || r.personTraits.length !== 5) {
    errors.push('personTraits must have exactly 5, got ' + (r.personTraits ? r.personTraits.length : 0));
  }
  if (!Array.isArray(r.userTraits) || r.userTraits.length !== 5) {
    errors.push('userTraits must have exactly 5, got ' + (r.userTraits ? r.userTraits.length : 0));
  }

  // Banned traits filter
  const BANNED = ['Early Stage', 'New Connection', 'Fresh Start', 'Getting to Know', 'Just Met', 'Beginning Phase'];
  const allTraits = (r.personTraits || []).concat(r.userTraits || []);
  allTraits.forEach(trait => {
    if (BANNED.some(b => trait.toLowerCase().includes(b.toLowerCase()))) {
      errors.push('Banned trait found: "' + trait + '"');
    }
  });

  // --- Categories ---
  const requiredCategories = ['intentions', 'chemistry', 'effort', 'redFlagsGreenFlags', 'trajectory'];
  requiredCategories.forEach(cat => {
    if (!r.categories || !r.categories[cat] || !r.categories[cat].description) {
      errors.push('Missing or empty category: ' + cat);
    }
  });

  // --- Message Insights ---
  if (!Array.isArray(r.messageInsights)) {
    errors.push('messageInsights is not an array');
  } else {
    if (r.messageInsights.length < 3 || r.messageInsights.length > 6) {
      errors.push('messageInsights count=' + r.messageInsights.length + ' (need 3-6)');
    }

    // Check each insight message is an exact quote from chat
    const chatTexts = (scenario.chat && scenario.chat.messages ? scenario.chat.messages : []).map(m => m.text);
    r.messageInsights.forEach((insight, i) => {
      if (!chatTexts.includes(insight.message)) {
        const insightLower = insight.message.trim().toLowerCase();
        // Try fuzzy match (trimmed, case-insensitive exact)
        let matched = chatTexts.find(t => t.trim().toLowerCase() === insightLower);
        // Try substring match: AI quoted part of a message
        if (!matched) {
          matched = chatTexts.find(t => t.toLowerCase().includes(insightLower));
        }
        // Try reverse substring: chat message is part of AI quote (less common)
        if (!matched) {
          matched = chatTexts.find(t => insightLower.includes(t.toLowerCase()) && t.length > 10);
        }
        if (matched) {
          insight.message = matched; // Auto-fix to exact chat text
        } else {
          errors.push('Insight ' + i + ': message "' + insight.message + '" not found in chat');
        }
      }
      if (!['RED FLAG', 'GREEN FLAG', 'DECODED'].includes(insight.tag)) {
        errors.push('Insight ' + i + ': invalid tag "' + insight.tag + '"');
      }
    });

    // Check DECODED requirement
    const hasDecoded = r.messageInsights.some(ins => ins.tag === 'DECODED');
    if (!hasDecoded) {
      errors.push('No DECODED insight found (at least 1 required)');
    }

    // Check no greetings selected
    const GREETING_WORDS = ['hi', 'hey', 'hello', 'sup', 'yo', 'hii', 'hiii'];
    r.messageInsights.forEach((insight, i) => {
      const lower = insight.message.toLowerCase().trim();
      if (GREETING_WORDS.includes(lower)) {
        errors.push('Insight ' + i + ': "' + insight.message + '" is a basic greeting');
      }
    });
  }

  // --- Dynamic ---
  if (!r.dynamic || !r.dynamic.name) errors.push('Missing dynamic.name');
  if (!r.dynamic || !r.dynamic.whyThisHappens) errors.push('Missing dynamic.whyThisHappens');
  if (r.dynamic && (typeof r.dynamic.powerBalance !== 'number' || r.dynamic.powerBalance < 0 || r.dynamic.powerBalance > 100)) {
    errors.push('dynamic.powerBalance out of range: ' + (r.dynamic ? r.dynamic.powerBalance : 'undefined'));
  }
}

// Determine if we should pass the scenario through (allow minor errors)
const criticalErrors = errors.filter(e =>
  !e.includes('auto-fixed') &&
  !e.includes('out of range') &&
  !e.includes('not found in chat') // partial quote mismatches are non-critical
);
const valid = criticalErrors.length === 0;

return [{
  json: {
    valid,
    errors,
    scenario: scenario,
    errorCount: errors.length,
    criticalErrorCount: criticalErrors.length
  }
}];
