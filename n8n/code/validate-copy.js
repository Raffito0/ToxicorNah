// NODE: Validate Copy
// Validates the Gemini content copy response (new structure with bodyClips)
// Mode: Run Once for All Items

// Basic LLM Chain outputs { text: "..." } with the raw LLM response
const llmOutput = $input.first().json;
const { scenario } = $('Build Copy Prompt').first().json;
const { bodyClipCount } = $('Select Concept').first().json;
const { randomRelStatus } = $('Build Scenario Prompt').first().json;

// --- JSON Repair utility (smart quote escaping) ---
function repairJson(raw) {
  let s = raw;
  // Strip markdown code blocks
  s = s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  // Replace smart/curly quotes with straight quotes
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // Extract JSON object
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    s = s.substring(firstBrace, lastBrace + 1);
  }
  // Remove control characters
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Smart quote repair: walk through and escape internal quotes
  // When we see a " inside a string, peek ahead -- if the next non-whitespace
  // char is NOT valid JSON continuation (, } ] :), it's an internal quote
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\') { result += ch; escaped = true; continue; }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        // Peek ahead: skip whitespace/newlines to find next meaningful char
        let peekIdx = i + 1;
        while (peekIdx < s.length && /[\s\r\n]/.test(s[peekIdx])) peekIdx++;
        const nextChar = peekIdx < s.length ? s[peekIdx] : '';
        // Valid JSON after closing a string value: , } ] : or EOF
        if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === ':' || nextChar === '') {
          // Real closing quote
          inString = false;
          result += ch;
        } else {
          // Internal quote -- escape it
          result += '\\"';
        }
      }
      continue;
    }
    if (inString && ch === '\n') { result += '\\n'; continue; }
    if (inString && ch === '\r') { continue; }
    result += ch;
  }
  s = result;
  // Remove trailing commas before ] or }
  s = s.replace(/,\s*([\]}])/g, '$1');
  return s;
}

let copy;
try {
  const raw = llmOutput.output || llmOutput.text || llmOutput;

  if (typeof raw === 'object' && raw !== null) {
    copy = raw;
  } else {
    copy = JSON.parse(repairJson(String(raw)));
  }
} catch (e1) {
  try {
    const raw = llmOutput.output || llmOutput.text || llmOutput;
    let repaired = repairJson(String(raw));
    // Fallback: try position-based fix if smart repair still fails
    const posMatch = e1.message.match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1]);
      // Escape the problematic character at the reported position
      repaired = repaired.substring(0, pos) + '\\' + repaired.substring(pos);
    }
    copy = JSON.parse(repaired);
  } catch (e2) {
    return [{ json: { valid: false, errors: ['JSON parse failed after repair: ' + e2.message + ' | Original: ' + e1.message], copy: null, scenario } }];
  }
}

const errors = [];

// Character limit for all VOs (50 chars = ~3 seconds of natural speech)
const VO_CHAR_LIMIT = 50;
// Hard limit -- above this we auto-trim instead of failing
const VO_CHAR_HARD_LIMIT = 65;

// Strip ElevenLabs emotion tags for character counting (tags don't count as spoken chars)
// Tags: [gasps], [sighs], [laughs], [whispers], [sarcastic], [frustrated], [curious], [excited]
const EMOTION_TAGS = ['gasps', 'sighs', 'laughs', 'whispers', 'sarcastic', 'frustrated', 'curious', 'excited'];
const EMOTION_TAGS_RE = EMOTION_TAGS.join('|');

function stripEmotionTags(text) {
  return text.replace(/\[(gasps|sighs|laughs|whispers|sarcastic|frustrated|curious|excited)\]\s*/gi, '').trim();
}

// Fix bare emotion tags that Gemini outputs without brackets
// "gasps Wait what?" -> "[gasps] Wait what?"
// "sighs laughs I can't" -> "[sighs] [laughs] I can't"
function fixEmotionTags(text) {
  if (!text || typeof text !== 'string') return text;
  // Match bare tags at the start of the string (up to 2 consecutive tags)
  return text.replace(
    new RegExp('^(' + EMOTION_TAGS_RE + ')\\s+(?:(' + EMOTION_TAGS_RE + ')\\s+)?', 'i'),
    (_match, tag1, tag2) => {
      let fixed = '[' + tag1.toLowerCase() + '] ';
      if (tag2) fixed += '[' + tag2.toLowerCase() + '] ';
      return fixed;
    }
  );
}

// Auto-trim VOs that exceed the character limit (Gemini can't count chars)
function trimVO(vo) {
  // Allow small grace (up to 55) -- only actively trim above that
  const TRIM_THRESHOLD = 55;
  // Count chars WITHOUT emotion tags (they don't count as spoken text)
  const spokenLength = stripEmotionTags(vo).length;
  if (!vo || spokenLength <= TRIM_THRESHOLD) return vo;

  let trimmed = vo;

  // Step 1: Remove trailing filler words
  const TRAILING_FILLERS = [', lol', ' lol', ', honestly', ' honestly', ', like', ' tho', ', bro', ' fr', ', ngl'];
  for (const filler of TRAILING_FILLERS) {
    if (trimmed.toLowerCase().endsWith(filler) || trimmed.toLowerCase().endsWith(filler + '.')) {
      trimmed = trimmed.substring(0, trimmed.length - (trimmed.toLowerCase().endsWith(filler + '.') ? filler.length + 1 : filler.length)).trim();
      // Re-add period if it makes sense
      if (!/[.!?\-.]$/.test(trimmed)) trimmed += '.';
      if (stripEmotionTags(trimmed).length <= VO_CHAR_LIMIT) return trimmed;
    }
  }

  // Step 2: If two sentences, try keeping just the first
  const sentenceBreak = trimmed.match(/^(\[[\w]+\]\s*)*(.{20,}?[.!?])\s+/);
  if (sentenceBreak) {
    const candidate = sentenceBreak[0].trimEnd();
    if (stripEmotionTags(candidate).length <= VO_CHAR_LIMIT && stripEmotionTags(candidate).length >= 20) {
      return candidate;
    }
  }

  // Step 3: Cut spoken text at last word boundary before limit and add ellipsis
  const spokenOnly = stripEmotionTags(trimmed);
  if (spokenOnly.length > VO_CHAR_LIMIT) {
    // Extract leading tags to preserve them
    const tagMatch = trimmed.match(/^((?:\[[\w]+\]\s*)*)/);
    const leadingTags = tagMatch ? tagMatch[1] : '';
    const textPart = trimmed.substring(leadingTags.length);
    const cut = textPart.substring(0, VO_CHAR_LIMIT - 1);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 15) {
      trimmed = leadingTags + cut.substring(0, lastSpace).replace(/[,.\s]+$/, '') + '--';
    }
  }

  return trimmed;
}

// Valid body clip section IDs
const ALL_SECTION_IDS = ['toxic_score', 'soul_type', 'wtf_happening', 'between_the_lines', 'souls_together'];
const expectedCount = Math.min(5, Math.max(2, bodyClipCount || 3));

// Hook text (max 8 words for short punchy overlay)
if (!copy.hookText || typeof copy.hookText !== 'string') {
  errors.push('Missing hookText');
} else if (copy.hookText.split(' ').length > 10) {
  errors.push('hookText too long: ' + copy.hookText.split(' ').length + ' words (max 8-10)');
}

// Hook VO (50 chars max for 3s speech) -- auto-trim if over limit
if (!copy.hookVO || typeof copy.hookVO !== 'string') {
  errors.push('Missing hookVO');
} else {
  copy.hookVO = fixEmotionTags(copy.hookVO);
  const originalHookVO = copy.hookVO;
  copy.hookVO = trimVO(copy.hookVO);
  if (originalHookVO !== copy.hookVO) {
    errors.push('hookVO auto-trimmed: "' + originalHookVO + '" -> "' + copy.hookVO + '" (auto-fixed)');
  }
  if (stripEmotionTags(copy.hookVO).length > VO_CHAR_HARD_LIMIT) {
    errors.push('hookVO too long even after trim: ' + stripEmotionTags(copy.hookVO).length + ' spoken chars (max ' + VO_CHAR_LIMIT + '). Text: "' + copy.hookVO + '"');
  }
}

// Body clips
if (!Array.isArray(copy.bodyClips)) {
  errors.push('Missing or invalid bodyClips array');
} else {
  if (copy.bodyClips.length !== expectedCount) {
    errors.push('Expected ' + expectedCount + ' bodyClips, got ' + copy.bodyClips.length);
  }
  copy.bodyClips.forEach((clip, i) => {
    if (!clip.section) {
      errors.push('Body clip ' + i + ': missing section ID');
    } else if (!ALL_SECTION_IDS.includes(clip.section)) {
      errors.push('Body clip ' + i + ': invalid section "' + clip.section + '"');
    }
    if (!clip.text || typeof clip.text !== 'string') {
      errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): missing text');
    } else if (clip.text.split(' ').length > 5) {
      errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): text too long (' + clip.text.split(' ').length + ' words, max 4)');
    }
    if (!clip.vo || typeof clip.vo !== 'string') {
      errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): missing vo');
    } else {
      clip.vo = fixEmotionTags(clip.vo);
      const originalVO = clip.vo;
      clip.vo = trimVO(clip.vo);
      if (originalVO !== clip.vo) {
        errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): vo auto-trimmed: "' + originalVO + '" -> "' + clip.vo + '" (auto-fixed)');
      }
      if (stripEmotionTags(clip.vo).length > VO_CHAR_HARD_LIMIT) {
        errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): vo too long even after trim (' + stripEmotionTags(clip.vo).length + ' spoken chars, max ' + VO_CHAR_LIMIT + '). Text: "' + clip.vo + '"');
      }
    }
  });

  // Ensure required sections are present
  const presentSections = copy.bodyClips.map(c => c.section);
  if (!presentSections.includes('toxic_score')) {
    errors.push('Missing required body clip section: toxic_score');
  }
  if (!presentSections.includes('soul_type')) {
    errors.push('Missing required body clip section: soul_type');
  }
}

// === Outro category override from pool selection (Build Copy Prompt) ===
const { selectedOutroCategory, selectedOutroText, selectedOutroVO: selectedOutroVOText } = $('Build Copy Prompt').first().json;
if (selectedOutroText) {
  copy.outroText = selectedOutroText;
  copy.outroVO = selectedOutroVOText || selectedOutroText;
}
// Tag the copy JSON with the selected category for Workflow 3 routing
copy.outroCategory = selectedOutroCategory || 'organic';

// Outro text (max 7 words -- pool examples can be longer)
if (!copy.outroText || typeof copy.outroText !== 'string') {
  errors.push('Missing outroText');
}

// Outro VO (50 chars max for 3s speech) -- auto-trim if over limit
if (!copy.outroVO || typeof copy.outroVO !== 'string') {
  errors.push('Missing outroVO');
} else {
  copy.outroVO = fixEmotionTags(copy.outroVO);
  const originalOutroVO = copy.outroVO;
  copy.outroVO = trimVO(copy.outroVO);
  if (originalOutroVO !== copy.outroVO) {
    errors.push('outroVO auto-trimmed: "' + originalOutroVO + '" -> "' + copy.outroVO + '" (auto-fixed)');
  }
  if (stripEmotionTags(copy.outroVO).length > VO_CHAR_HARD_LIMIT) {
    errors.push('outroVO too long even after trim: ' + stripEmotionTags(copy.outroVO).length + ' spoken chars (max ' + VO_CHAR_LIMIT + '). Text: "' + copy.outroVO + '"');
  }
}

// Social caption
if (!copy.socialCaption || typeof copy.socialCaption !== 'string') {
  errors.push('Missing socialCaption');
} else if (!copy.socialCaption.toLowerCase().includes('#toxicornah')) {
  copy.socialCaption = copy.socialCaption.trim() + ' #toxicornah';
  errors.push('socialCaption was missing #toxicornah (auto-fixed)');
}

const valid = errors.filter(e => !e.includes('auto-fixed')).length === 0;

return [{
  json: { valid, errors, copy, scenario }
}];
