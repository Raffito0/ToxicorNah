/**
 * W2 — Article Generation Workflow (n8n Code Node)
 *
 * Picks best keyword from NocoDB, extracts/validates ticker, calls Dexter
 * for research, generates article via Claude Tool Use, runs 14-point
 * quality gate, sanitizes HTML, writes to NocoDB, triggers downstream.
 *
 * Trigger: Schedule — 8:00 AM, 1:00 PM, 6:00 PM EST daily
 */

'use strict';

const { createClaudeClient } = require('./ai-client');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_VERDICTS = ['BUY', 'SELL', 'CAUTION', 'WAIT', 'NO_TRADE'];

const LENGTH_CONFIG = {
  short:  { maxTokens: 6000,  minWords: 800,  maxWords: 1000 },
  medium: { maxTokens: 8000,  minWords: 1200, maxWords: 1800 },
  long:   { maxTokens: 12000, minWords: 2000, maxWords: 3000 },
};

// Words that look like tickers but are common English words
const FALSE_POSITIVE_TICKERS = new Set([
  'A', 'I', 'THE', 'CEO', 'BEST', 'TOP', 'FOR', 'ALL', 'ARE', 'NEW',
  'BUY', 'SELL', 'IPO', 'ETF', 'AND', 'BUT', 'NOT', 'HAS', 'HAD',
  'WAS', 'CAN', 'MAY', 'NOW', 'HOW', 'WHY', 'USD', 'USA', 'SEC',
  'GDP', 'CPI', 'FED', 'EPS', 'ROI', 'DCF', 'FCF', 'YOY', 'QOQ',
  'ATH', 'ATL', 'OTC', 'DIV', 'PE', 'PB', 'PS',
]);

const BANNED_PHRASES = [
  // -- Original filler/cliche phrases --
  "it's worth noting", "it remains to be seen", "having said that",
  "on the other hand", "in conclusion", "at the end of the day",
  "all in all", "needless to say", "it goes without saying",
  "in today's market", "as we can see", "it should be noted",
  "moving forward", "let's dive in", "let's take a closer look",
  "without further ado", "in the grand scheme of things",
  "only time will tell", "the million-dollar question",
  "at first glance", "interestingly enough",
  "it's important to note", "as always", "stay tuned",
  "that being said",
  // -- Humanizer #1: Significance inflation --
  "stands as a testament", "serves as a testament", "is a testament",
  "pivotal moment", "pivotal role", "crucial role", "vital role",
  "key turning point", "indelible mark", "setting the stage",
  "marking a shift", "evolving landscape", "enduring legacy",
  "shaping the future", "underscores the importance",
  "highlights the significance", "reflects broader trends",
  // -- Humanizer #3: Superficial -ing analyses --
  "highlighting the", "underscoring the", "emphasizing the",
  "showcasing how", "reflecting the", "symbolizing the",
  "fostering a", "cultivating a", "encompassing a",
  // -- Humanizer #4: Promotional language --
  "vibrant", "nestled", "breathtaking", "groundbreaking",
  "must-visit", "stunning", "in the heart of",
  // -- Humanizer #5: Weasel attributions --
  "experts argue", "experts believe", "industry reports suggest",
  "observers have noted", "some critics argue",
  // -- Humanizer #6: Formulaic challenges --
  "despite these challenges", "despite its challenges",
  "continues to thrive", "future looks bright",
  "exciting times lie ahead", "journey toward excellence",
  // -- Humanizer #7: Overused AI vocabulary --
  "delve", "tapestry", "interplay", "intricate", "intricacies",
  "garner", "foster", "landscape of", "rich tapestry",
  // -- Humanizer #8: Copula avoidance --
  "serves as a", "stands as a", "boasts a", "represents a key",
  // -- Humanizer #9: Negative parallelism --
  "not only", "it's not just about",
  // -- Humanizer #19-21: Chat artifacts --
  "i hope this helps", "certainly!", "of course!",
  "you're absolutely right", "great question",
  "let me know if", "here is a",
  // -- Humanizer #22-24: Filler/hedging/generic --
  "in order to", "due to the fact that", "at this point in time",
  "in the event that", "has the ability to",
  "it could potentially", "might have some effect",
  "the future looks bright", "a step in the right direction",
];

const ALLOWED_TAGS = new Set([
  'h2', 'h3', 'p', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'blockquote', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'span',
]);

const REQUIRED_ARTICLE_FIELDS = [
  'title', 'meta_description', 'slug', 'key_takeaways', 'body_html',
  'verdict_type', 'verdict_text', 'word_count',
];

// ---------------------------------------------------------------------------
// Persona Constants (Section 01)
// ---------------------------------------------------------------------------

var CLAUDE_MODEL = 'claude-haiku-4-5-20251001'; // lightweight model for outline; override via env if needed

var BASE_SYSTEM_PROMPT = 'You are a financial analyst writing for Dexter Research, an independent data-driven financial analysis firm. Write with authority. Use specific numbers, percentages, and dollar amounts. Cite SEC filings. Avoid generic commentary. Never use filler phrases or AI-sounding vocabulary.';

var RYAN_CHEN_PERSONA = 'You are Ryan Chen, a former Goldman Sachs equity research analyst with 12 years of experience covering technology, semiconductor, and growth equities. You now write independent financial analysis for EarlyInsider.com. Write in first-person singular. Reference your Goldman Sachs analytical background naturally without forcing it. Your tone is direct, data-driven, and skeptical of consensus narratives. You cite specific page numbers from SEC filings. You disagree with Wall Street consensus when the numbers warrant it.';

// ---------------------------------------------------------------------------
// Ticker Extraction
// ---------------------------------------------------------------------------

function extractTicker(keyword) {
  if (!keyword || typeof keyword !== 'string') return null;

  // Match tickers with optional dot notation (BRK.B)
  // Lookahead allows punctuation, whitespace, or end-of-string after ticker
  const matches = keyword.match(/\b([A-Z]{1,5}(?:\.[A-Z])?)(?=[\s,;:!?).\-]|$)/g);
  if (!matches) return null;

  for (const candidate of matches) {
    if (!FALSE_POSITIVE_TICKERS.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Article Parameters (weighted random)
// ---------------------------------------------------------------------------

function determineArticleParams(blog) {
  const r = Math.random();
  const targetLength = r < 0.3 ? 'short' : r < 0.8 ? 'medium' : 'long';
  const authorName = blog === 'insiderbuying' ? 'Dexter Research' : 'Ryan Cole';
  const maxTokens = LENGTH_CONFIG[targetLength].maxTokens;

  return { targetLength, authorName, maxTokens };
}

// ---------------------------------------------------------------------------
// Template Variable Interpolation
// ---------------------------------------------------------------------------

function interpolateTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Claude Tool Use Schema
// ---------------------------------------------------------------------------

function buildToolSchema() {
  return {
    name: 'generate_article',
    description: 'Generate a financial analysis article with structured output',
    input_schema: {
      type: 'object',
      required: [
        'title', 'meta_description', 'slug', 'key_takeaways', 'body_html',
        'verdict_type', 'verdict_text', 'word_count', 'primary_keyword',
        'secondary_keywords_used', 'data_tables_count', 'filing_citations_count',
        'confidence_notes',
      ],
      properties: {
        title: { type: 'string', description: '55-65 characters, contains ticker or company name' },
        meta_description: { type: 'string', description: '140-155 characters with primary keyword' },
        slug: { type: 'string', description: 'URL-friendly lowercase with hyphens' },
        key_takeaways: { type: 'array', items: { type: 'string' }, description: '3-4 bullet points each with a number' },
        body_html: { type: 'string', description: 'Full article as semantic HTML' },
        verdict_type: { type: 'string', enum: VALID_VERDICTS },
        verdict_text: { type: 'string', description: 'Clear position with numeric threshold' },
        word_count: { type: 'number' },
        primary_keyword: { type: 'string' },
        secondary_keywords_used: { type: 'array', items: { type: 'string' } },
        data_tables_count: { type: 'number' },
        filing_citations_count: { type: 'number' },
        confidence_notes: { type: 'string' },
      },
    },
  };
}


// ---------------------------------------------------------------------------
// Readability helpers
// ---------------------------------------------------------------------------

const FINANCE_ABBREV_SYLLABLES = { IPO: 3, ETF: 3, CEO: 3, SEC: 3, ESG: 3, CFO: 3, COO: 3, CTO: 3 };

function countSyllablesInline(word) {
  const upper = word.toUpperCase();
  if (FINANCE_ABBREV_SYLLABLES[upper] !== undefined) return FINANCE_ABBREV_SYLLABLES[upper];
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!lower) return 1;
  let count = (lower.match(/[aeiouy]+/gi) || []).length;
  // subtract silent trailing e (but not when preceded by l or r, which form their own syllable)
  const prev = lower[lower.length - 2];
  if (lower.length > 2 && lower.endsWith('e') && !/[aeiouy]/.test(prev) && !/[lr]/.test(prev)) {
    count -= 1;
  }
  return Math.max(1, count);
}

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr) {
  if (!arr || arr.length <= 1) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length);
}

function extractSentences(html) {
  const text = (html || '').replace(/<[^>]+>/g, ' ');
  // Protect decimal points (e.g. $26.0B, 64.2%) so they don't split sentences
  const cleaned = text.replace(/(\d)\.(\d)/g, '$1\u00B7$2');
  const matches = cleaned.match(/[^.!?]*[.!?]+(?=\s|$)/g) || [];
  return matches.map((s) => s.replace(/\u00B7/g, '.').trim()).filter(Boolean);
}

function countWords(html) {
  const text = (html || '').replace(/<[^>]+>/g, ' ');
  return text.split(/\s+/).filter(Boolean).length;
}

function computeFleschKincaidEase(html) {
  // Strip script/style blocks including content
  const noScript = (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const plain = noScript.replace(/<[^>]+>/g, ' ');
  const words = plain.split(/\s+/).filter(Boolean);
  const sentences = extractSentences(plain);
  if (words.length === 0 || sentences.length === 0) return null;
  const syllables = words.reduce((s, w) => s + countSyllablesInline(w), 0);
  return 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
}

// ---------------------------------------------------------------------------
// Quality Gate (19 checks)
// ---------------------------------------------------------------------------

/**
 * @param {object} article
 * @param {{ primaryKeyword: string, daysSinceFiling: number }} opts
 * @returns {{ valid: boolean, errors: string[], staleness_warning: boolean }}
 */
function qualityGate(article, opts) {
  const { primaryKeyword, daysSinceFiling } = opts || {};
  const errors = [];
  let staleness_warning = false;

  // Check 1: Title length 55-65 chars
  if (!article.title || article.title.length < 55 || article.title.length > 65) {
    errors.push(`Title length ${(article.title || '').length} outside 55-65 range`);
  }

  // Check 2: Meta description 140-155 chars
  if (!article.meta_description || article.meta_description.length < 140 || article.meta_description.length > 155) {
    errors.push(`Meta description length ${(article.meta_description || '').length} outside 140-155 range`);
  }

  // Check 3: key_takeaways 3-4 items, each contains a number
  if (!Array.isArray(article.key_takeaways) ||
      article.key_takeaways.length < 3 || article.key_takeaways.length > 4) {
    errors.push(`key_takeaways must have 3-4 items, got ${article.key_takeaways ? article.key_takeaways.length : 0}`);
  } else {
    for (let i = 0; i < article.key_takeaways.length; i++) {
      if (!/\d/.test(article.key_takeaways[i])) {
        errors.push(`key_takeaway #${i + 1} does not contain a number`);
      }
    }
  }

  // Check 4: verdict_type valid
  if (!article.verdict_type || !VALID_VERDICTS.includes(article.verdict_type)) {
    errors.push(`Invalid verdict_type: ${article.verdict_type}`);
  }

  // Check 5: verdict_text exists and contains a number
  if (!article.verdict_text || !/\d/.test(article.verdict_text)) {
    errors.push('verdict_text missing or lacks numeric threshold');
  }

  // Check 6: Zero banned AI phrases (scan plain text)
  const bodyPlain = (article.body_html || '').replace(/<[^>]+>/g, ' ').toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (bodyPlain.includes(phrase.toLowerCase())) {
      errors.push(`Banned phrase found: "${phrase}"`);
    }
  }

  // Check 7: At least 40% of paragraphs contain numeric data (plain text per paragraph)
  const paragraphs = (article.body_html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  if (paragraphs.length > 0) {
    const numericPattern = /\d/;
    const numericCount = paragraphs.filter((p) => numericPattern.test(p.replace(/<[^>]+>/g, ''))).length;
    const density = numericCount / paragraphs.length;
    if (density < 0.4) {
      errors.push(`Paragraph numeric density ${(density * 100).toFixed(0)}% below 40% threshold`);
    }
  }

  // Check 8: FK Ease 25-55 (skip if null)
  const fk = computeFleschKincaidEase(article.body_html);
  if (fk !== null) {
    if (fk < 25 || fk > 55) {
      errors.push(`Flesch-Kincaid ease score ${fk.toFixed(1)} outside 25-55 range`);
    }
  }

  // Check 9: Word count 1800-2500
  const wc = countWords(article.body_html);
  if (wc < 1800 || wc > 2500) {
    errors.push(`Word count ${wc} outside 1800-2500 range`);
  }

  // Check 10: Visual placeholders >= 3
  const body = article.body_html || '';
  const missingVisuals = [];
  if (!body.includes('{{VISUAL_1}}')) missingVisuals.push('{{VISUAL_1}}');
  if (!body.includes('{{VISUAL_2}}')) missingVisuals.push('{{VISUAL_2}}');
  if (!body.includes('{{VISUAL_3}}')) missingVisuals.push('{{VISUAL_3}}');
  if (missingVisuals.length > 0) {
    errors.push(`Missing visual placeholders: ${missingVisuals.join(', ')}`);
  }

  // Check 11: Internal links >= 4
  const internalLinks = (body.match(/href="\/[^"]*"/g) || []).length;
  if (internalLinks < 4) {
    errors.push(`Internal links ${internalLinks} below minimum of 4`);
  }

  // Check 12: CTA in first 500 chars
  const first500 = body.slice(0, 500).toLowerCase();
  const ctaWords = ['alert', 'subscribe', 'notification', 'free'];
  if (!ctaWords.some((w) => first500.includes(w))) {
    errors.push('No CTA (alert/subscribe/notification/free) in first 500 chars');
  }

  // Check 13: Track record section
  if (!bodyPlain.includes('track record')) {
    errors.push('Missing "track record" section');
  }

  // Check 14: Social proof
  const socialProofPhrases = ['subscriber', 'members', 'readers'];
  if (!socialProofPhrases.some((p) => bodyPlain.includes(p))) {
    errors.push('Missing social proof (subscriber/members/readers)');
  }

  // Check 15: Filing timeliness
  if (daysSinceFiling !== undefined && daysSinceFiling !== null) {
    if (daysSinceFiling > 72) {
      errors.push(`Filing too stale: ${daysSinceFiling} days since filing (max 72)`);
    } else if (daysSinceFiling > 24) {
      staleness_warning = true;
    }
  }

  // Check 16: TLDR in first 200 words
  const plainWords = (article.body_html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
  const first200text = plainWords.slice(0, 200).join(' ').toLowerCase();
  const tldrPhrases = ['tldr', 'tl;dr', 'key takeaway', 'in brief'];
  if (!tldrPhrases.some((p) => first200text.includes(p))) {
    errors.push('TLDR/key takeaway not found in first 200 words');
  }

  // Check 17: Sentence variation CV > 0.45
  const sentences = extractSentences(article.body_html);
  if (sentences.length > 1) {
    const lengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
    const m = mean(lengths);
    if (m > 0) {
      const cv = stdDev(lengths) / m;
      if (cv <= 0.45) {
        errors.push(`Sentence length variation CV ${cv.toFixed(2)} below 0.45 threshold`);
      }
    }
  }

  // Check 18: Keyword density 1.0-2.5%
  if (primaryKeyword && wc > 0) {
    const kwLower = primaryKeyword.toLowerCase();
    const bodyLower2 = (article.body_html || '').replace(/<[^>]+>/g, ' ').toLowerCase();
    const kwRegex = new RegExp(kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const kwMatches = (bodyLower2.match(kwRegex) || []).length;
    const kwDensity = (kwMatches / wc) * 100;
    if (kwDensity < 1.0 || kwDensity > 2.5) {
      errors.push(`Keyword density ${kwDensity.toFixed(1)}% outside 1.0-2.5% range`);
    }
  }

  // Check 19: No generic opening (use bodyPlain to handle any HTML nesting)
  const GENERIC_OPENINGS = ['In this article', 'Today we', "In today's", 'Welcome to', 'Are you', 'Have you ever'];
  const openingLower = bodyPlain.trimStart().slice(0, 100).toLowerCase();
  for (const phrase of GENERIC_OPENINGS) {
    if (openingLower.startsWith(phrase.toLowerCase())) {
      errors.push(`Generic opening detected: "${phrase}"`);
      break;
    }
  }

  return { valid: errors.length === 0, errors, staleness_warning };
}

// ---------------------------------------------------------------------------
// SEO Score (Step 8.7)
// ---------------------------------------------------------------------------

/**
 * Compute a 0-100 SEO score for the article.
 * Checks: keyword density, heading structure, internal links,
 * readability (Flesch-Kincaid approximation), meta completeness.
 * Returns { score, breakdown, pass } where pass = score >= 70.
 */
function seoScore(article, primaryKeyword) {
  const breakdown = {};
  const bodyText = (article.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = bodyText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const kwLower = (primaryKeyword || '').toLowerCase();
  const kwWords = kwLower.split(/\s+/).filter((w) => w.length > 2);

  // 1. Keyword density (target 1.0-2.5%, max 20 pts)
  if (kwWords.length > 0 && wordCount > 0) {
    const bodyLower = bodyText.toLowerCase();
    // Count occurrences of the most specific keyword word
    const mainWord = kwWords.reduce((a, b) => a.length >= b.length ? a : b, '');
    const regex = new RegExp('\\b' + mainWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    const matches = bodyLower.match(regex) || [];
    const density = (matches.length / wordCount) * 100;
    if (density >= 1.0 && density <= 2.5) {
      breakdown.keywordDensity = 20;
    } else if (density >= 0.5 && density <= 3.5) {
      breakdown.keywordDensity = 12;
    } else {
      breakdown.keywordDensity = 5;
    }
  } else {
    breakdown.keywordDensity = 0;
  }

  // 2. Heading structure (max 20 pts)
  const h2s = (article.body_html || '').match(/<h2[^>]*>/gi) || [];
  const h3s = (article.body_html || '').match(/<h3[^>]*>/gi) || [];
  let headingScore = 0;
  if (h2s.length >= 3) headingScore += 10;
  else if (h2s.length >= 2) headingScore += 7;
  else if (h2s.length >= 1) headingScore += 4;
  if (h3s.length >= 1) headingScore += 5;
  // Keyword in H2 (already checked in quality gate, reward here)
  const h2Text = (article.body_html || '').match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [];
  const kwInH2 = h2Text.some((h) => kwWords.some((w) => h.toLowerCase().includes(w)));
  if (kwInH2) headingScore += 5;
  breakdown.headingStructure = Math.min(headingScore, 20);

  // 3. Internal links (max 10 pts)
  const internalLinks = ((article.body_html || '').match(/href=["']\/[^"']+["']/g) || []).length;
  breakdown.internalLinks = internalLinks >= 3 ? 10 : internalLinks >= 1 ? 6 : 0;

  // 4. Readability — Flesch-Kincaid approximation (max 20 pts)
  // FK = 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
  // We approximate syllables by counting vowel groups
  const sentences = bodyText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(sentences.length, 1);
  const avgWordsPerSentence = wordCount / sentenceCount;
  let syllableCount = 0;
  for (const word of words) {
    const vowelGroups = word.toLowerCase().match(/[aeiouy]+/g) || [];
    syllableCount += Math.max(vowelGroups.length, 1);
  }
  const avgSyllablesPerWord = syllableCount / Math.max(wordCount, 1);
  const fkGrade = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;
  // Target: 8-10 grade level
  if (fkGrade >= 7 && fkGrade <= 11) {
    breakdown.readability = 20;
  } else if (fkGrade >= 5 && fkGrade <= 13) {
    breakdown.readability = 12;
  } else {
    breakdown.readability = 5;
  }

  // 5. Meta completeness (max 15 pts)
  let metaScore = 0;
  if (article.title && article.title.length >= 50 && article.title.length <= 70) metaScore += 5;
  if (article.meta_description && article.meta_description.length >= 130 && article.meta_description.length <= 160) metaScore += 5;
  if (article.slug && article.slug.length > 0) metaScore += 5;
  breakdown.metaCompleteness = metaScore;

  // 6. Content length relative to type (max 15 pts)
  if (wordCount >= 1200) {
    breakdown.contentLength = 15;
  } else if (wordCount >= 800) {
    breakdown.contentLength = 10;
  } else {
    breakdown.contentLength = 3;
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return {
    score: Math.min(total, 100),
    breakdown,
    pass: total >= 70,
  };
}

// ---------------------------------------------------------------------------
// AI Detection Score (Step 8.8)
// ---------------------------------------------------------------------------

// AI-signature word list (high-frequency in AI text, low in human text)
const AI_SIGNAL_WORDS = [
  'additionally', 'furthermore', 'moreover', 'consequently',
  'delve', 'crucial', 'pivotal', 'underscore', 'underscores',
  'landscape', 'tapestry', 'interplay', 'intricate',
  'foster', 'fostering', 'garner', 'garnered',
  'showcase', 'showcasing', 'showcased',
  'highlight', 'highlighting', 'highlighted',
  'enhance', 'enhancing', 'enhanced',
  'emphasize', 'emphasizing', 'emphasized',
  'vibrant', 'robust', 'comprehensive', 'noteworthy',
  'commendable', 'meticulous', 'nuanced',
  'testament', 'realm', 'paradigm',
  'multifaceted', 'groundbreaking',
];

/**
 * Compute an AI detection risk score (0-100, lower = more human).
 * Checks: AI signal word density, sentence length uniformity,
 * paragraph structure repetitiveness, banned phrase remnants.
 * Returns { score, signals, pass } where pass = score <= 40.
 */
function aiDetectionScore(article) {
  const bodyText = (article.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = bodyText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const signals = [];

  if (wordCount === 0) return { score: 0, signals: [], pass: true };

  // 1. AI signal word density (0-35 pts)
  const bodyLower = bodyText.toLowerCase();
  let aiWordHits = 0;
  for (const word of AI_SIGNAL_WORDS) {
    const regex = new RegExp('\\b' + word + '\\b', 'gi');
    const matches = bodyLower.match(regex) || [];
    aiWordHits += matches.length;
  }
  const aiWordDensity = (aiWordHits / wordCount) * 100;
  let aiWordScore = 0;
  if (aiWordDensity > 3) {
    aiWordScore = 35;
    signals.push(`High AI vocabulary density: ${aiWordDensity.toFixed(1)}% (${aiWordHits} hits)`);
  } else if (aiWordDensity > 1.5) {
    aiWordScore = 20;
    signals.push(`Moderate AI vocabulary: ${aiWordDensity.toFixed(1)}%`);
  } else if (aiWordDensity > 0.5) {
    aiWordScore = 8;
  }

  // 2. Sentence length uniformity (0-25 pts)
  // Humans vary sentence length wildly; AI tends toward uniform lengths
  const sentences = bodyText.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  if (sentences.length >= 5) {
    const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avgLen, 2), 0) / lengths.length;
    const coeffVar = Math.sqrt(variance) / avgLen; // coefficient of variation
    // Human text: CV typically 0.4-0.8. AI text: CV typically 0.2-0.35
    let uniformScore = 0;
    if (coeffVar < 0.25) {
      uniformScore = 25;
      signals.push(`Very uniform sentence lengths (CV=${coeffVar.toFixed(2)})`);
    } else if (coeffVar < 0.35) {
      uniformScore = 15;
      signals.push(`Somewhat uniform sentences (CV=${coeffVar.toFixed(2)})`);
    } else if (coeffVar < 0.45) {
      uniformScore = 5;
    }
    aiWordScore += uniformScore; // reuse variable for total
  }

  // 3. Paragraph opening repetition (0-20 pts)
  // AI tends to start paragraphs with similar structures
  const paragraphs = (article.body_html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  if (paragraphs.length >= 4) {
    const openers = paragraphs.map((p) => {
      const text = p.replace(/<[^>]+>/g, '').trim();
      return text.split(/\s+/).slice(0, 3).join(' ').toLowerCase();
    });
    // Check for repeated opening patterns (e.g., "The company's", "The company's")
    const firstWords = paragraphs.map((p) => p.replace(/<[^>]+>/g, '').trim().split(/\s+/)[0]?.toLowerCase());
    const wordCounts = {};
    for (const w of firstWords) {
      if (w) wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
    const maxRepeat = Math.max(...Object.values(wordCounts));
    const repeatRatio = maxRepeat / paragraphs.length;
    if (repeatRatio > 0.5) {
      aiWordScore += 20;
      signals.push(`${(repeatRatio * 100).toFixed(0)}% of paragraphs start with same word`);
    } else if (repeatRatio > 0.35) {
      aiWordScore += 10;
      signals.push(`${(repeatRatio * 100).toFixed(0)}% paragraph opener repetition`);
    }
  }

  // 4. Em dash overuse (0-10 pts) — Humanizer #13
  const emDashCount = (bodyText.match(/\u2014|---?/g) || []).length;
  const emDashPer1000 = (emDashCount / wordCount) * 1000;
  if (emDashPer1000 > 5) {
    aiWordScore += 10;
    signals.push(`Em dash overuse: ${emDashCount} in ${wordCount} words`);
  } else if (emDashPer1000 > 2.5) {
    aiWordScore += 5;
  }

  // 5. "Not only...but also" / negative parallelism (0-10 pts) — Humanizer #9
  const negParallel = (bodyLower.match(/not only\b.*?\bbut\b/g) || []).length +
                       (bodyLower.match(/it's not just\b/g) || []).length;
  if (negParallel >= 2) {
    aiWordScore += 10;
    signals.push(`${negParallel} negative parallelisms found`);
  } else if (negParallel === 1) {
    aiWordScore += 3;
  }

  const finalScore = Math.min(aiWordScore, 100);
  return {
    score: finalScore,
    signals,
    pass: finalScore <= 40,
  };
}

// ---------------------------------------------------------------------------
// HTML Sanitization
// ---------------------------------------------------------------------------

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function sanitizeHtml(html) {
  if (!html) return '';

  // Remove script, iframe, style tags and their content
  let clean = html.replace(/<(script|iframe|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove self-closing and unclosed versions
  clean = clean.replace(/<(script|iframe|style)\b[^>]*>/gi, '');

  // Process remaining tags
  clean = clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tag, attrs) => {
    const tagLower = tag.toLowerCase();
    const isClosing = match.startsWith('</');

    if (!ALLOWED_TAGS.has(tagLower)) {
      return ''; // strip unknown tags
    }

    if (isClosing) {
      return `</${tagLower}>`;
    }

    // Parse and filter attributes
    let cleanAttrs = '';

    if (tagLower === 'a') {
      // Allow href only
      const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
      if (hrefMatch) {
        const href = hrefMatch[1];
        // Only allow / or https:// URLs
        if (href.startsWith('/') || href.startsWith('https://')) {
          cleanAttrs = ` href="${escapeAttr(href)}"`;
          // Add nofollow for external links
          if (href.startsWith('https://')) {
            cleanAttrs += ' rel="nofollow noopener noreferrer"';
          }
        }
      }
    } else if (tagLower === 'p' || tagLower === 'section') {
      // Allow class attribute only
      const classMatch = attrs.match(/class\s*=\s*["']([^"']+)["']/i);
      if (classMatch) {
        cleanAttrs = ` class="${escapeAttr(classMatch[1])}"`;
      }
    }
    // All other tags: no attributes

    return `<${tagLower}${cleanAttrs}>`;
  });

  // Final safety pass: strip any remaining dangerous patterns
  clean = clean.replace(/<script\b[^>]*>/gi, '');
  clean = clean.replace(/<\/script>/gi, '');
  clean = clean.replace(/\bon\w+\s*=/gi, '');

  return clean;
}

// ---------------------------------------------------------------------------
// Slug Uniqueness
// ---------------------------------------------------------------------------

function ensureUniqueSlug(slug, existingSlugs) {
  if (!existingSlugs || !existingSlugs.includes(slug)) {
    return slug;
  }

  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const withDate = `${slug}-${yy}${mm}`;

  if (!existingSlugs.includes(withDate)) {
    return withDate;
  }

  // Double collision: add counter
  for (let i = 2; i < 100; i++) {
    const candidate = `${withDate}-${i}`;
    if (!existingSlugs.includes(candidate)) {
      return candidate;
    }
  }

  return `${slug}-${Date.now()}`; // ultimate fallback
}

// ---------------------------------------------------------------------------
// Section 01: Persona, Outline, Draft Builder
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for a Claude article generation call.
 * Injects Ryan Chen persona for insiderbuying blog only.
 * @param {{ blog: string }} opts
 * @returns {string}
 */
function buildSystemPrompt(opts) {
  var blog = opts && opts.blog;
  var prompt = BASE_SYSTEM_PROMPT;
  if (blog === 'insiderbuying') {
    prompt += '\n\n' + RYAN_CHEN_PERSONA;
  }
  return prompt;
}

/**
 * Strip markdown code fences then parse JSON.
 * @param {string} text
 * @returns {object}
 */
function parseClaudeJSON(text) {
  var cleaned = text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Validate a Claude-generated article outline.
 * @param {object} outline
 * @param {string} ticker
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateOutline(outline, ticker) {
  var errors = [];
  if (!outline || !Array.isArray(outline.sections) || outline.sections.length < 5) {
    errors.push('Outline has fewer than 5 H2 sections');
  }
  if (ticker && outline && outline.headline) {
    if (!outline.headline.toLowerCase().includes(ticker.toLowerCase())) {
      errors.push('Outline does not mention ticker');
    }
  } else if (!outline || !outline.headline) {
    errors.push('Outline does not mention ticker');
  }
  return { valid: errors.length === 0, errors: errors };
}

/**
 * Generate a structured article outline via a lightweight Claude call.
 * Has an independent 1-retry budget (2 total attempts).
 * @param {string} ticker
 * @param {string} articleType
 * @param {object} dexterData
 * @param {function} fetchFn
 * @param {string} [anthropicApiKey]
 * @returns {Promise<object>}
 */
async function generateArticleOutline(ticker, articleType, dexterData, fetchFn, anthropicApiKey) {
  var basePrompt = 'Generate a structured article outline for an insider buying analysis.\n'
    + 'Ticker: ' + ticker + '\n'
    + 'Article type: ' + (articleType || 'A') + '\n\n'
    + 'Return JSON only (no markdown fences) with this exact shape:\n'
    + '{"headline":"55-65 char headline containing ' + ticker + '","tldr":["bullet1","bullet2","bullet3"],'
    + '"sections":[{"h2":"Section Title","h3s":["Subsection A","Subsection B"]}],'
    + '"required_data_points":["specific data point"]}\n\n'
    + 'Requirements: 5-7 H2 sections, headline must contain "' + ticker + '", no markdown fences in response.';

  var lastErrors = [];

  var outlineClient = createClaudeClient(fetchFn, anthropicApiKey);

  for (var attempt = 0; attempt < 2; attempt++) {
    var prompt = attempt === 0
      ? basePrompt
      : basePrompt + '\n\nRegenerate outline fixing: ' + lastErrors.join('; ');

    var result = await outlineClient.complete('', prompt, { maxTokens: 400 });
    var raw = result.content || '';

    var outline = null;
    try { outline = parseClaudeJSON(raw); } catch (e) { /* invalid JSON */ }

    if (outline) {
      var validation = validateOutline(outline, ticker);
      if (validation.valid) return outline;
      lastErrors = validation.errors;
    } else {
      lastErrors = ['Failed to parse outline JSON'];
    }
  }

  throw new Error('Article outline validation failed after 2 attempts: ' + lastErrors.join('; '));
}

/**
 * Build the user message for the draft Claude call.
 * Includes validated outline and visual placeholder instruction.
 * @param {object|null} outline
 * @returns {string}
 */
function buildDraftUserMessage(outline) {
  var parts = [];

  if (outline) {
    var outlineBlock = '[OUTLINE]\n'
      + 'Headline: ' + outline.headline + '\n'
      + 'Sections:\n'
      + (outline.sections || []).map(function(s) {
        var h3Lines = (s.h3s || []).map(function(h) { return '### ' + h; }).join('\n');
        return '## ' + s.h2 + (h3Lines ? '\n' + h3Lines : '');
      }).join('\n\n')
      + '\n[/OUTLINE]';
    parts.push(outlineBlock);
  }

  parts.push('Generate the article now.');
  parts.push('Your article body_html must include {{VISUAL_1}}, {{VISUAL_2}}, and {{VISUAL_3}} tokens at appropriate chart positions within body_html.');

  return parts.join('\n\n');
}

/**
 * Extract the tool_use result from a raw Claude API response.
 * @param {object} response
 * @returns {object|null}
 */
function extractToolResult(response) {
  if (!response || !Array.isArray(response.content)) return null;
  var toolBlock = response.content.find(function(b) {
    return b.type === 'tool_use' && b.name === 'generate_article';
  });
  if (!toolBlock) return null;
  return toolBlock.input || null;
}

// ---------------------------------------------------------------------------
// NocoDB helpers (for n8n Code node usage)
// ---------------------------------------------------------------------------

// Table name -> table ID mapping. Set via env vars or defaults.
// NOCODB_BASE_URL should be: http://nocodb:8080/api/v1/db/data/noco/{BASE_ID}
// Paths like /Keywords become /{TABLE_ID_KEYWORDS}
function resolveTablePath(path, opts = {}) {
  const tableMap = opts.tableMap || {};
  // Replace /TableName with /tableId at the start of path
  const match = path.match(/^\/([A-Za-z_]+)(.*)/);
  if (match) {
    const tableName = match[1];
    const rest = match[2];
    const tableId = tableMap[tableName];
    if (tableId) return `/${tableId}${rest}`;
  }
  return path; // fallback: use path as-is
}

async function nocodbGet(path, token, opts = {}) {
  const { fetchFn, baseUrl } = opts;
  if (!fetchFn) throw new Error('fetchFn required');

  const resolved = resolveTablePath(path, opts);
  const res = await fetchFn(`${baseUrl}${resolved}`, {
    headers: { 'xc-token': token },
  });
  if (!res.ok) return null;
  return res.json();
}

async function nocodbPost(path, data, token, opts = {}) {
  const { fetchFn, baseUrl } = opts;
  if (!fetchFn) throw new Error('fetchFn required');

  const resolved = resolveTablePath(path, opts);
  const res = await fetchFn(`${baseUrl}${resolved}`, {
    method: 'POST',
    headers: { 'xc-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

async function nocodbPatch(path, data, token, opts = {}) {
  const { fetchFn, baseUrl } = opts;
  if (!fetchFn) throw new Error('fetchFn required');

  const resolved = resolveTablePath(path, opts);
  const res = await fetchFn(`${baseUrl}${resolved}`, {
    method: 'PATCH',
    headers: { 'xc-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Keyword Picker
// ---------------------------------------------------------------------------

async function pickKeyword(blog, nocodbOpts) {
  const where = `(status,eq,new)~or((status,eq,in_progress)~and(updated_at,lt,exactDate,${oneHourAgo()}))`;
  const path = `/Keywords?where=${encodeURIComponent(where)}&sort=-priority_score&limit=1`;

  const result = await nocodbGet(path, nocodbOpts.token, nocodbOpts);
  if (!result || !result.list || result.list.length === 0) return null;
  return result.list[0];
}

function oneHourAgo() {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

async function lockKeyword(keywordId, nocodbOpts) {
  return nocodbPatch(
    `/Keywords/${keywordId}`,
    { status: 'in_progress', updated_at: new Date().toISOString() },
    nocodbOpts.token,
    nocodbOpts,
  );
}

// ---------------------------------------------------------------------------
// Ticker Validation via Financial Datasets API
// ---------------------------------------------------------------------------

async function validateTickerApi(ticker, opts = {}) {
  const { fetchFn, apiKey } = opts;
  if (!fetchFn || !apiKey) return false;

  try {
    const res = await fetchFn(
      `https://api.financialdatasets.ai/api/v1/financial-statements/income-statements?ticker=${encodeURIComponent(ticker)}&limit=1`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data?.income_statements) && data.income_statements.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Write Article to NocoDB
// ---------------------------------------------------------------------------

async function writeArticle(article, keyword, nocodbOpts) {
  return nocodbPost('/Articles', {
    slug: article.slug,
    title_text: article.title,
    meta_description: article.meta_description,
    body_html: article.body_html,
    verdict_type: article.verdict_type,
    verdict_text: article.verdict_text,
    key_takeaways: JSON.stringify(article.key_takeaways),
    word_count: article.word_count,
    primary_keyword: article.primary_keyword || keyword.keyword,
    secondary_keywords_used: JSON.stringify(article.secondary_keywords_used || []),
    data_tables_count: article.data_tables_count || 0,
    filing_citations_count: article.filing_citations_count || 0,
    confidence_notes: article.confidence_notes || '',
    staleness_warning: article.staleness_warning || false,
    ticker: keyword.ticker || extractTicker(keyword.keyword),
    sector: keyword.sector || '',
    company_name: keyword.company_name || '',
    blog: keyword.blog,
    author_name: keyword.author_name || '',
    status: 'enriching',
    quality_gate_pass: true,
    published_at: new Date().toISOString(),
  }, nocodbOpts.token, nocodbOpts);
}

// ---------------------------------------------------------------------------
// Update Keyword Status
// ---------------------------------------------------------------------------

async function updateKeywordStatus(keywordId, status, nocodbOpts) {
  const data = { status };
  if (status === 'used') data.used_at = new Date().toISOString();
  return nocodbPatch(`/Keywords/${keywordId}`, data, nocodbOpts.token, nocodbOpts);
}

// ---------------------------------------------------------------------------
// Downstream Triggers (Sequential)
// ---------------------------------------------------------------------------

async function triggerDownstream(articleId, slug, opts = {}) {
  const { fetchFn, w12Url, w13Url, revalidateUrl, revalidateSecret, indexingAuth } = opts;
  const results = { w12: null, w13: null, revalidate: null, indexing: null };

  // W12: Image Generation (wait for completion)
  if (w12Url && fetchFn) {
    try {
      const res = await fetchFn(w12Url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: articleId }),
      });
      results.w12 = res.ok ? 'success' : 'failed';
    } catch (e) {
      results.w12 = `error: ${e.message}`;
    }
  }

  // W13: Cross-Linking (wait for completion)
  if (w13Url && fetchFn) {
    try {
      const res = await fetchFn(w13Url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: articleId }),
      });
      results.w13 = res.ok ? 'success' : 'failed';
    } catch (e) {
      results.w13 = `error: ${e.message}`;
    }
  }

  // Revalidate specific page
  if (revalidateUrl && fetchFn) {
    try {
      const res = await fetchFn(
        `${revalidateUrl}?secret=${revalidateSecret}&slug=${slug}`,
        { method: 'POST' },
      );
      results.revalidate = res.ok ? 'success' : 'failed';
    } catch (e) {
      results.revalidate = `error: ${e.message}`;
    }
  }

  // Google Indexing API
  if (indexingAuth && fetchFn) {
    try {
      const res = await fetchFn('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${indexingAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: `https://earlyinsider.com/blog/${slug}`,
          type: 'URL_UPDATED',
        }),
      });
      results.indexing = res.ok ? 'success' : 'failed';
    } catch (e) {
      results.indexing = `error: ${e.message}`;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Telegram Notification
// ---------------------------------------------------------------------------

async function notifyTelegram(article, keyword, opts = {}) {
  const { fetchFn, botToken, chatId } = opts;
  if (!fetchFn || !botToken || !chatId) return;

  const text = [
    `New article published:`,
    `Title: ${article.title}`,
    `Ticker: ${keyword.ticker || 'N/A'}`,
    `Verdict: ${article.verdict_type}`,
    `Words: ${article.word_count}`,
    `URL: https://earlyinsider.com/blog/${article.slug}`,
  ].join('\n');

  await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

// ---------------------------------------------------------------------------
// Main Orchestrator (for n8n Code node)
// ---------------------------------------------------------------------------

async function generateArticle(input, helpers) {
  const { blog } = input;
  const fetchFn = helpers?.fetchFn;
  const env = helpers?.env || {};

  const nocodbOpts = {
    fetchFn,
    baseUrl: env.NOCODB_BASE_URL,
    token: env.NOCODB_API_TOKEN,
    tableMap: {
      Keywords: env.NOCODB_TABLE_KEYWORDS || 'Keywords',
      Articles: env.NOCODB_TABLE_ARTICLES || 'Articles',
      Financial_Cache: env.NOCODB_TABLE_CACHE || 'Financial_Cache',
      Published_Images: env.NOCODB_TABLE_IMAGES || 'Published_Images',
    },
  };

  // Step 1: Pick keyword
  const keyword = await pickKeyword(blog, nocodbOpts);
  if (!keyword) {
    await notifyTelegram(
      { title: 'No keywords available', word_count: 0, slug: '', verdict_type: 'N/A' },
      { ticker: 'N/A' },
      { fetchFn, botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID },
    );
    return { status: 'skipped', reason: 'No keywords available' };
  }

  // Lock keyword
  await lockKeyword(keyword.id, nocodbOpts);

  // Step 2: Extract & validate ticker
  const ticker = extractTicker(keyword.keyword);
  if (ticker) {
    const valid = await validateTickerApi(ticker, {
      fetchFn,
      apiKey: env.FINANCIAL_DATASETS_API_KEY,
    });
    if (!valid) {
      await updateKeywordStatus(keyword.id, 'invalid_ticker', nocodbOpts);
      return { status: 'skipped', reason: `Invalid ticker: ${ticker}` };
    }
  }

  // Step 2.5: Content freshness check (before outline generation)
  const freshness = await checkContentFreshness(ticker || keyword.ticker || '', nocodbOpts);
  const effectiveArticleType = freshness.effectiveArticleType;
  if (!freshness.fresh) {
    console.log(`[generate-article] ${ticker}: recent article found (${freshness.lastPublished}), using contrarian angle`);
  }

  // Step 3: Call Dexter (via webhook)
  let dexterData = {};
  if (env.DEXTER_WEBHOOK_URL && fetchFn) {
    const dRes = await fetchFn(env.DEXTER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, keyword: keyword.keyword, article_type: keyword.article_type, blog }),
    });
    if (dRes.ok) dexterData = await dRes.json();
    if (dexterData.data_completeness !== undefined && dexterData.data_completeness < 0.5) {
      await updateKeywordStatus(keyword.id, 'skipped', nocodbOpts);
      return { status: 'skipped', reason: 'Insufficient data from Dexter' };
    }
  }

  // Step 4: Determine article params
  const params = determineArticleParams(blog);

  // Step 5: Interpolate template
  const templateVars = {
    BLOG: blog,
    TICKER: ticker || keyword.keyword,
    COMPANY_NAME: dexterData.company_name || ticker || '',
    SECTOR: dexterData.sector || '',
    MARKET_CAP: dexterData.market_cap || '',
    ARTICLE_TYPE: keyword.article_type || 'A',
    TARGET_LENGTH: params.targetLength,
    KEYWORD: keyword.keyword,
    SECONDARY_KEYWORDS: keyword.secondary_keywords || '',
    DEXTER_ANALYSIS: JSON.stringify(dexterData.dexter_analysis || {}),
    FINANCIAL_DATA: JSON.stringify(dexterData.financial_data || {}),
    INSIDER_TRADES: JSON.stringify(dexterData.insider_trades || []),
    STOCK_PRICES: JSON.stringify(dexterData.stock_prices || {}),
    COMPETITOR_DATA: JSON.stringify(dexterData.competitor_data || []),
    MANAGEMENT_QUOTES: JSON.stringify(dexterData.management_quotes || []),
    NEWS_DATA: JSON.stringify(dexterData.news || []),
    CURRENT_DATE: new Date().toISOString().split('T')[0],
    AUTHOR_NAME: params.authorName,
  };

  // Read system prompt template
  const systemPromptTemplate = env.ARTICLE_SYSTEM_PROMPT || '';
  const systemPrompt = interpolateTemplate(systemPromptTemplate, templateVars);

  // Step 6-7: Claude API call with Tool Use + retry
  const claude = createClaudeClient(fetchFn, env.ANTHROPIC_API_KEY);
  let article = null;
  let retryFeedback = '';
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt = attempt === 0
      ? systemPrompt
      : `${systemPrompt}\n\nQuality gate failed on previous attempt: ${retryFeedback}. Fix these specific issues and regenerate.`;

    let result;
    try {
      result = await claude.completeToolUse(
        prompt,
        'Generate the article now.',
        [buildToolSchema()],
        { type: 'tool', name: 'generate_article' },
        {
          temperature: 0.6,
          maxTokens: params.maxTokens,
          cache: true,
        },
      );
    } catch (err) {
      console.log(`[generate-article] Claude refusal or error: ${err.message}`);
      await updateKeywordStatus(keyword.id, 'skipped', nocodbOpts);
      return { status: 'skipped', reason: 'Claude safety refusal' };
    }

    article = result.toolResult;
    if (!article) {
      // Safety refusal or unexpected response
      await updateKeywordStatus(keyword.id, 'skipped', nocodbOpts);
      return { status: 'skipped', reason: 'Claude safety refusal' };
    }

    // Sanitize HTML BEFORE quality gate so gate checks post-sanitized content
    article.body_html = sanitizeHtml(article.body_html);

    // Recompute word count from actual body (don't trust Claude's self-report)
    const textOnly = (article.body_html || '').replace(/<[^>]+>/g, '');
    article.word_count = textOnly.split(/\s+/).filter(Boolean).length;

    // Step 8: Quality gate (19 checks)
    const gate = qualityGate(article, { primaryKeyword: keyword.keyword, daysSinceFiling: keyword.days_since_filing });

    // Step 8.7: SEO Score (must be >= 70)
    const seo = seoScore(article, keyword.keyword);
    article._seoScore = seo.score;
    article._seoBreakdown = seo.breakdown;

    // Step 8.8: AI Detection Score (must be <= 40)
    const aiCheck = aiDetectionScore(article);
    article._aiDetectionScore = aiCheck.score;

    // Collect ALL failures across all 3 gates
    const allFailures = [...gate.errors];
    if (!seo.pass) {
      const weakAreas = Object.entries(seo.breakdown)
        .filter(([, v]) => v < 10)
        .map(([k]) => k);
      allFailures.push(`SEO score ${seo.score}/100 (weak: ${weakAreas.join(', ') || 'overall'}). Improve keyword density to 1-2.5%, add 3+ internal links, use 3+ H2s with keyword, target Flesch-Kincaid grade 8-10`);
    }
    if (!aiCheck.pass) {
      allFailures.push(`AI detection risk ${aiCheck.score}/100: ${aiCheck.signals.join('; ')}. Vary sentence lengths, avoid starting paragraphs with the same word, reduce AI vocabulary (additionally/furthermore/crucial/comprehensive/robust/noteworthy), remove em dashes, avoid "not only...but" constructions`);
    }

    // All 3 gates passed → article is top-tier, break out
    if (allFailures.length === 0) break;

    if (attempt === MAX_RETRIES) {
      // Save as error after exhausting retries
      article.status = 'error';
      article.confidence_notes = `Gate failures: ${allFailures.join('; ')}`;
      await nocodbPost('/Articles', {
        slug: article.slug || `error-${Date.now()}`,
        title_text: article.title || 'Quality gate failure',
        body_html: article.body_html || '',
        status: 'error',
        quality_gate_pass: false,
        confidence_notes: article.confidence_notes,
        seo_score: seo.score,
        ai_detection_score: aiCheck.score,
        blog,
      }, nocodbOpts.token, nocodbOpts);

      await updateKeywordStatus(keyword.id, 'skipped', nocodbOpts);
      await notifyTelegram(
        { ...article, verdict_type: 'ERROR' },
        keyword,
        { fetchFn, botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID },
      );
      return { status: 'error', failures: allFailures, seoScore: seo.score, aiScore: aiCheck.score };
    }

    retryFeedback = allFailures.join('; ');
  }

  // Step 8.5: Visual placeholder replacement
  const r2Env = {
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    R2_PUBLIC_URL: env.R2_PUBLIC_URL,
  };
  article = await replaceVisualPlaceholders(article, dexterData, fetchFn, r2Env);

  // Step 8.55: Append Schema.org JSON-LD
  article.body_html = article.body_html + '\n' + generateSchema({
    ...article,
    published_at: new Date().toISOString(),
  });

  // Step 8.6: Ensure unique slug
  const existingSlugsRes = await nocodbGet(
    `/Articles?fields=slug&where=(slug,like,${article.slug}%)`,
    nocodbOpts.token,
    nocodbOpts,
  );
  const existingSlugs = (existingSlugsRes?.list || []).map((r) => r.slug);
  article.slug = ensureUniqueSlug(article.slug, existingSlugs);

  // Step 9: Write to NocoDB (include staleness_warning from quality gate)
  article.staleness_warning = gate.staleness_warning;
  const created = await writeArticle(article, { ...keyword, author_name: params.authorName }, nocodbOpts);

  // Step 10: Update keyword
  await updateKeywordStatus(keyword.id, 'used', nocodbOpts);

  // Step 11: Trigger downstream (sequential)
  const articleId = created?.id || created?.Id;
  if (articleId) {
    // Update status to published only if downstream succeeded
    const downstream = await triggerDownstream(articleId, article.slug, {
      fetchFn,
      w12Url: env.W12_WEBHOOK_URL,
      w13Url: env.W13_WEBHOOK_URL,
      revalidateUrl: env.REVALIDATE_URL,
      revalidateSecret: env.REVALIDATION_SECRET,
      indexingAuth: env.GOOGLE_INDEXING_TOKEN,
    });

    const downstreamOk = (!downstream.w12 || downstream.w12 === 'success') &&
                          (!downstream.w13 || downstream.w13 === 'success');
    const newStatus = downstreamOk ? 'published' : 'enriching';
    await nocodbPatch(`/Articles/${articleId}`, { status: newStatus }, nocodbOpts.token, nocodbOpts);
  }

  // Step 13: Notify
  await notifyTelegram(article, keyword, {
    fetchFn,
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  });

  return { status: 'published', article_id: articleId, slug: article.slug };
}

// ---------------------------------------------------------------------------
// Section 03 — Schema.org JSON-LD
// ---------------------------------------------------------------------------

/**
 * Build a Schema.org JSON-LD <script> block for the article.
 * @param {Object} article
 * @returns {string}
 */
function generateSchema(article) {
  const schemaObj = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        'name': article.title || '',
        'headline': article.title || '',
        'description': article.meta_description || '',
        'datePublished': article.published_at || new Date().toISOString(),
        'dateModified': article.published_at || new Date().toISOString(),
        'author': { '@id': '#ryan-chen' },
        'url': `https://earlyinsider.com/articles/${article.slug || ''}`,
      },
      {
        '@id': '#ryan-chen',
        '@type': 'Person',
        'name': 'Ryan Chen',
        'jobTitle': 'Independent Finance Analyst',
        'description': 'Former Goldman Sachs equity research analyst covering technology and financial services sectors.',
      },
      {
        '@type': 'FinancialProduct',
        'name': 'EarlyInsider Insider Intelligence Alerts',
        'description': 'Real-time insider transaction alerts and analysis for retail investors.',
        'url': 'https://earlyinsider.com/alerts',
      },
    ],
  };
  return `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`;
}

// ---------------------------------------------------------------------------
// Section 03 — Content Freshness Check
// ---------------------------------------------------------------------------

/**
 * Check if an article for this ticker was published in the last 30 days.
 * @param {string} ticker
 * @param {Object} nocodbOpts - { token, baseUrl, fetchFn }
 * @returns {Promise<{ fresh: boolean, effectiveArticleType: string, lastPublished?: string }>}
 */
async function checkContentFreshness(ticker, nocodbOpts) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const where = `(ticker,eq,${ticker})~and(published_at,gt,${thirtyDaysAgo})`;
    const path = `/Articles?where=${encodeURIComponent(where)}&limit=1`;
    const result = await nocodbGet(path, nocodbOpts.token, nocodbOpts);
    const records = (result && result.list) ? result.list : [];
    if (records.length === 0) {
      return { fresh: true, effectiveArticleType: 'insider_buying' };
    }
    return { fresh: false, effectiveArticleType: 'contrarian', lastPublished: records[0].published_at };
  } catch (e) {
    // Safe default: treat as fresh so generation proceeds
    return { fresh: true, effectiveArticleType: 'insider_buying' };
  }
}

// ---------------------------------------------------------------------------
// Section 03 — R2 Chart Upload
// ---------------------------------------------------------------------------

/**
 * Upload a PNG chart buffer to Cloudflare R2.
 * @param {Buffer} buffer - PNG image data
 * @param {string} key - R2 object key, e.g. "charts/aapl-4-1711234567.png"
 * @param {Function} fetchFn
 * @param {Object} env - { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL }
 * @returns {Promise<string>} Public R2 URL
 */
async function uploadChart(buffer, key, fetchFn, env) {
  const crypto = require('crypto');
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${key}`;
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:-]/g, '').replace(/\.\d+/, '');
  const dateDay = dateStr.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const scope = `${dateDay}/${region}/${service}/aws4_request`;

  const payloadHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const canonicalHeaders = [
    'content-type:image/png',
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${dateStr}`,
  ].join('\n');
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', `/${key}`, '', canonicalHeaders, '', signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', dateStr, scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  function hmac(k, d) { return crypto.createHmac('sha256', k).update(d).digest(); }
  const kDate = hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, dateDay);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetchFn(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png',
      'Host': host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': dateStr,
      'Authorization': authorization,
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);
  return `${env.R2_PUBLIC_URL}/${key}`;
}

// ---------------------------------------------------------------------------
// Section 03 — Visual Placeholder Replacement
// ---------------------------------------------------------------------------

const VISUAL_TEMPLATE_MAP = {
  '{{VISUAL_1}}': { templateId: 4, description: 'Insider Transaction Table' },
  '{{VISUAL_2}}': { templateId: 5, description: 'Price Chart with buy marker' },
  '{{VISUAL_3}}': { templateId: 6, description: 'Revenue Trend' },
};

/**
 * Replace {{VISUAL_N}} tokens with real chart <img> tags.
 * @param {Object} article - Article object with body_html
 * @param {Object} filingData - Insider filing data for chart generation
 * @param {Function} fetchFn
 * @param {Object} env - R2 credentials
 * @param {Object} [templates] - { renderTemplate(templateId, data): Promise<Buffer> }
 * @returns {Promise<Object>} Updated article object
 */
async function replaceVisualPlaceholders(article, filingData, fetchFn, env, templates) {
  const ticker = (article.primary_keyword || article.slug || 'unknown').split('-')[0].toLowerCase();
  const ts = Date.now();

  for (const [token, meta] of Object.entries(VISUAL_TEMPLATE_MAP)) {
    if (!article.body_html.includes(token)) {
      console.warn(`Missing placeholder: ${token}`);
      continue;
    }
    try {
      let buffer;
      if (templates && typeof templates.renderTemplate === 'function') {
        buffer = await templates.renderTemplate(meta.templateId, { filingData, article });
      } else {
        // visual-templates.js not available — leave placeholder (graceful degradation)
        continue;
      }
      const key = `charts/${ticker}-${meta.templateId}-${ts}.png`;
      const url = await uploadChart(buffer, key, fetchFn, env);
      article.body_html = article.body_html.replace(
        token,
        `<img src="${url}" alt="${meta.description}" class="article-chart" />`,
      );
    } catch (e) {
      console.warn(`Failed to replace ${token}: ${e.message}`);
    }
  }
  return article;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Pure functions (tested)
  extractTicker,
  determineArticleParams,
  interpolateTemplate,
  buildToolSchema,
  extractToolResult,
  buildSystemPrompt,
  validateOutline,
  generateArticleOutline,
  buildDraftUserMessage,
  parseClaudeJSON,
  countSyllablesInline,
  computeFleschKincaidEase,
  extractSentences,
  countWords,
  stdDev,
  mean,
  qualityGate,
  seoScore,
  aiDetectionScore,
  sanitizeHtml,
  ensureUniqueSlug,
  generateSchema,
  checkContentFreshness,
  uploadChart,
  replaceVisualPlaceholders,

  // Orchestration (integration tested)
  pickKeyword,
  lockKeyword,
  validateTickerApi,
  writeArticle,
  updateKeywordStatus,
  triggerDownstream,
  notifyTelegram,
  generateArticle,

  // NocoDB helpers
  nocodbGet,
  nocodbPost,
  nocodbPatch,

  // Constants
  VALID_VERDICTS,
  BANNED_PHRASES,
  LENGTH_CONFIG,
  FALSE_POSITIVE_TICKERS,
  ALLOWED_TAGS,
  REQUIRED_ARTICLE_FIELDS,
  AI_SIGNAL_WORDS,
};
