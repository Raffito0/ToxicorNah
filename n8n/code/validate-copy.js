// NODE: Validate Copy
// Validates the Gemini content copy response (new structure with bodyClips)
// Mode: Run Once for All Items

// Basic LLM Chain outputs { text: "..." } with the raw LLM response
const llmOutput = $input.first().json;
const { scenario } = $('Build Copy Prompt').first().json;
const { bodyClipCount } = $('Select Concept').first().json;

// --- JSON Repair utility ---
function repairJson(raw) {
  let s = raw;
  s = s.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    s = s.substring(firstBrace, lastBrace + 1);
  }
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\') { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && ch === '\n') { result += '\\n'; continue; }
    if (inString && ch === '\r') { continue; }
    result += ch;
  }
  s = result;
  s = s.replace(/,\s*([\]}])/g, '$1');
  s = s.replace(/([^\\])""/g, '$1\\"');
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
    repaired = repaired.replace(/[\u201C\u201D\u2018\u2019]/g, '"');
    const posMatch = e1.message.match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1]);
      repaired = repaired.substring(0, pos) + '\\' + repaired.substring(pos);
    }
    copy = JSON.parse(repaired);
  } catch (e2) {
    return [{ json: { valid: false, errors: ['JSON parse failed after repair: ' + e1.message], copy: null, scenario } }];
  }
}

const errors = [];

// Character limit for all VOs (50 chars = ~3 seconds of natural speech)
const VO_CHAR_LIMIT = 50;
// Hard limit — above this we auto-trim instead of failing
const VO_CHAR_HARD_LIMIT = 65;

// Auto-trim VOs that exceed the character limit (Gemini can't count chars)
function trimVO(vo) {
  // Allow small grace (up to 55) — only actively trim above that
  const TRIM_THRESHOLD = 55;
  if (!vo || vo.length <= TRIM_THRESHOLD) return vo;

  let trimmed = vo;

  // Step 1: Remove trailing filler words
  const TRAILING_FILLERS = [', lol', ' lol', ', honestly', ' honestly', ', like', ' tho', ', bro', ' fr', ', ngl'];
  for (const filler of TRAILING_FILLERS) {
    if (trimmed.toLowerCase().endsWith(filler) || trimmed.toLowerCase().endsWith(filler + '.')) {
      trimmed = trimmed.substring(0, trimmed.length - (trimmed.toLowerCase().endsWith(filler + '.') ? filler.length + 1 : filler.length)).trim();
      // Re-add period if it makes sense
      if (!/[.!?—…]$/.test(trimmed)) trimmed += '.';
      if (trimmed.length <= VO_CHAR_LIMIT) return trimmed;
    }
  }

  // Step 2: If two sentences, try keeping just the first
  const sentenceBreak = trimmed.match(/^(.{20,}?[.!?])\s+/);
  if (sentenceBreak && sentenceBreak[1].length <= VO_CHAR_LIMIT && sentenceBreak[1].length >= 20) {
    return sentenceBreak[1];
  }

  // Step 3: Cut at last word boundary before limit and add ellipsis
  if (trimmed.length > VO_CHAR_LIMIT) {
    const cut = trimmed.substring(0, VO_CHAR_LIMIT - 1);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 20) {
      trimmed = cut.substring(0, lastSpace).replace(/[,.\s]+$/, '') + '—';
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

// Hook VO (50 chars max for 3s speech) — auto-trim if over limit
if (!copy.hookVO || typeof copy.hookVO !== 'string') {
  errors.push('Missing hookVO');
} else {
  const originalHookVO = copy.hookVO;
  copy.hookVO = trimVO(copy.hookVO);
  if (originalHookVO !== copy.hookVO) {
    errors.push('hookVO auto-trimmed: "' + originalHookVO + '" → "' + copy.hookVO + '" (auto-fixed)');
  }
  if (copy.hookVO.length > VO_CHAR_HARD_LIMIT) {
    errors.push('hookVO too long even after trim: ' + copy.hookVO.length + ' chars (max ' + VO_CHAR_LIMIT + '). Text: "' + copy.hookVO + '"');
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
    } else if (clip.text.split(' ').length > 8) {
      errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): text too long (' + clip.text.split(' ').length + ' words, max 6)');
    }
    if (!clip.vo || typeof clip.vo !== 'string') {
      errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): missing vo');
    } else {
      const originalVO = clip.vo;
      clip.vo = trimVO(clip.vo);
      if (originalVO !== clip.vo) {
        errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): vo auto-trimmed: "' + originalVO + '" → "' + clip.vo + '" (auto-fixed)');
      }
      if (clip.vo.length > VO_CHAR_HARD_LIMIT) {
        errors.push('Body clip ' + i + ' (' + (clip.section || '?') + '): vo too long even after trim (' + clip.vo.length + ' chars, max ' + VO_CHAR_LIMIT + '). Text: "' + clip.vo + '"');
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

// ═══ Outro category override from pool selection (Build Copy Prompt) ═══
const { selectedOutroCategory, selectedOutroText, selectedOutroVO: selectedOutroVOText } = $('Build Copy Prompt').first().json;
if (selectedOutroText) {
  copy.outroText = selectedOutroText;
  copy.outroVO = selectedOutroVOText || selectedOutroText;
}
// Tag the copy JSON with the selected category for Workflow 3 routing
copy.outroCategory = selectedOutroCategory || 'organic';

// Outro text (max 7 words — pool examples can be longer)
if (!copy.outroText || typeof copy.outroText !== 'string') {
  errors.push('Missing outroText');
}

// Outro VO (50 chars max for 3s speech) — auto-trim if over limit
if (!copy.outroVO || typeof copy.outroVO !== 'string') {
  errors.push('Missing outroVO');
} else {
  const originalOutroVO = copy.outroVO;
  copy.outroVO = trimVO(copy.outroVO);
  if (originalOutroVO !== copy.outroVO) {
    errors.push('outroVO auto-trimmed: "' + originalOutroVO + '" → "' + copy.outroVO + '" (auto-fixed)');
  }
  if (copy.outroVO.length > VO_CHAR_HARD_LIMIT) {
    errors.push('outroVO too long even after trim: ' + copy.outroVO.length + ' chars (max ' + VO_CHAR_LIMIT + '). Text: "' + copy.outroVO + '"');
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
