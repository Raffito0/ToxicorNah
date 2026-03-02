import { supabase } from '@/lib/supabase';
import { MALE_SOUL_TYPES, FEMALE_SOUL_TYPES, SoulType, getMaleSoulTypeByName, getFemaleSoulTypeByName } from '@/data/soulTypes';

// ===== HYBRID SOUL TYPE MATCHING =====
// AI extracts behavioral patterns → Client matches to Soul Types

export interface SoulTypeMatchResult {
  soulType: SoulType;
  confidence: number;
  matchedKeywords: string[];
}

/**
 * BEHAVIOR SYNONYMS MAP
 * Maps AI-extracted behaviors to Soul Type keywords they correspond to.
 * This bridges the vocabulary gap between what AI outputs and what Soul Types expect.
 * Each key is a behavior the AI might extract, values are Soul Type keywords it maps to.
 */
const BEHAVIOR_SYNONYMS: Record<string, string[]> = {
  // Aggressive/threatening behaviors → The Silent Choke keywords
  'threatening': ['controlling', 'possessive', 'suffocating'],
  'aggressive': ['controlling', 'possessive', 'suffocating'],
  'intimidating': ['controlling', 'possessive', 'suffocating'],
  'harassing': ['controlling', 'possessive', 'stalking'],
  'stalking': ['controlling', 'possessive', 'checking phone', 'where were you'],
  'creepy': ['possessive', 'controlling', 'suffocating'],
  'scary': ['controlling', 'possessive', 'intimidating'],
  'abusive': ['controlling', 'possessive', 'manipulation'],
  'violent': ['controlling', 'possessive', 'suffocating'],
  'rage': ['controlling', 'possessive', 'mood swings'],
  'anger': ['controlling', 'possessive', 'mood swings'],
  'angry': ['controlling', 'possessive', 'mood swings'],

  // Objectifying/vulgar behaviors → The Silent Choke + Dark Mirror keywords
  'objectifying': ['possessive', 'selfish', 'my girl', 'mine'],
  'vulgar': ['inappropriate', 'selfish', 'disrespectful'],
  'inappropriate': ['possessive', 'selfish', 'controlling'],
  'disrespectful': ['selfish', 'ego', 'manipulation'],
  'degrading': ['manipulation', 'selfish', 'controlling'],
  'sexualizing': ['possessive', 'objectifying', 'selfish'],

  // Cautious/defensive female behaviors → The Frozen Bloom / Golden Rule keywords
  'cautious': ['guarded', 'walls', 'trust issues'],
  'defensive': ['guarded', 'walls', 'closed off'],
  'wary': ['guarded', 'trust issues', 'walls'],
  'careful': ['guarded', 'walls', 'trust issues'],
  'protecting': ['guarded', 'walls', 'self-protective'],
  'skeptical': ['guarded', 'trust issues', 'won\'t let you in'],
  'suspicious': ['guarded', 'trust issues', 'walls'],

  // Shocked/reactive behaviors → The Quiet Storm / Frozen Bloom
  'shocked': ['calm', 'observes', 'still waters'],
  'surprised': ['observes', 'calm', 'still waters'],
  'uncomfortable': ['guarded', 'walls', 'closed off'],
  'disgusted': ['standards', 'boundaries', 'walks away', 'done'],
  'repulsed': ['standards', 'boundaries', 'walks away', 'done'],

  // Questioning/inquisitive → The Inner Voice / Golden Rule
  'inquisitive': ['intuition', 'instinct', 'knows', 'listens'],
  'questioning': ['intuition', 'gut feeling', 'standards'],
  'curious': ['intuition', 'instinct', 'listens'],
  'investigative': ['intuition', 'gut feeling', 'knows'],

  // Strong/assertive female behaviors → The Golden Rule / Savage Grace
  'assertive': ['standards', 'boundaries', 'confident', 'high value'],
  'firm': ['standards', 'boundaries', 'non-negotiable'],
  'direct': ['standards', 'confident', 'boundaries'],
  'confrontational': ['fierce', 'savage', 'claws', 'dangerous'],
  'standing up': ['standards', 'boundaries', 'won\'t settle'],
  'setting boundaries': ['standards', 'boundaries', 'non-negotiable'],

  // Resilient female behaviors → The Rising Phoenix
  'resilient': ['phoenix', 'stronger', 'survivor', 'powerful'],
  'strong': ['phoenix', 'stronger', 'powerful', 'survivor'],
  'empowered': ['phoenix', 'powerful', 'rise', 'comeback'],
  'recovering': ['phoenix', 'survivor', 'rise', 'rebuild'],

  // Anxious/overthinking → The Living Maze
  'anxious': ['overthink', 'spiral', 'anxious', 'thoughts'],
  'overthinking': ['overthink', 'spiral', 'anxious', 'mind'],
  'worried': ['overthink', 'anxious', 'spiral'],
  'insecure': ['overthink', 'anxious', 'spiral', 'insecure'],
  'nervous': ['overthink', 'anxious', 'spiral'],

  // Breadcrumbing/stringing along → The Star Collector
  'breadcrumbing': ['stringing along', 'options', 'backup'],
  'leading on': ['stringing along', 'options', 'backup'],
  'playing games': ['stringing along', 'manipulation', 'options'],
  'keeping options': ['options', 'backup', 'never first'],

  // Passive-aggressive → The Sweet Poison / Dark Mirror
  'passive aggressive': ['manipulation', 'gaslighting', 'toxic'],
  'sarcastic': ['manipulation', 'toxic', 'gaslighting'],
  'condescending': ['ego', 'selfish', 'manipulation'],
  'dismissive': ['ego', 'selfish', 'gaslighting'],
  'belittling': ['manipulation', 'gaslighting', 'toxic'],

  // Love bombing → The Burning Promise
  'love bombing': ['overwhelming', 'intense', 'fast', 'future faking'],
  'bombing': ['overwhelming', 'intense', 'fast'],
  'obsessive': ['overwhelming', 'clingy', 'intense', 'possessive'],
  'smothering': ['clingy', 'suffocating', 'overwhelming'],

  // Emotionally unavailable → The Ice Charmer
  'emotionally unavailable': ['unavailable', 'distant', 'closed', 'walls'],
  'detached': ['unavailable', 'distant', 'closed'],
  'aloof': ['unavailable', 'distant', 'closed'],
  'indifferent': ['unavailable', 'distant', 'closed'],
  'apathetic': ['unavailable', 'distant', 'closed'],

  // Warm/caring/friendly → The Natural State / The Gentle Flame / The Sunset Soul
  'caring': ['genuine', 'authentic', 'warm', 'caring', 'kind'],
  'warm': ['genuine', 'authentic', 'warm', 'caring', 'warmth'],
  'friendly': ['genuine', 'authentic', 'warm', 'friendly', 'kind'],
  'kind': ['genuine', 'authentic', 'warm', 'caring', 'kind'],
  'genuine': ['genuine', 'authentic', 'real', 'honest'],
  'consistent': ['consistent', 'reliable', 'caring'],
  'sweet': ['caring', 'warm', 'genuine', 'sweet'],
};

/**
 * Expands observed behaviors using synonym map.
 * For each observed behavior, if it has synonyms, adds the mapped keywords.
 * Returns the expanded list of behaviors for matching.
 */
function expandBehaviors(observedBehaviors: string[]): string[] {
  const expanded = new Set<string>();

  for (const behavior of observedBehaviors) {
    // Keep the original behavior
    expanded.add(behavior);

    // Check for synonym matches (case-insensitive)
    const normBehavior = behavior.toLowerCase().trim();
    for (const [synonymKey, mappedKeywords] of Object.entries(BEHAVIOR_SYNONYMS)) {
      if (normBehavior === synonymKey || normBehavior.includes(synonymKey) || synonymKey.includes(normBehavior)) {
        for (const kw of mappedKeywords) {
          expanded.add(kw);
        }
      }
    }
  }

  return Array.from(expanded);
}

/**
 * Normalizes a behavior/keyword for matching
 * - Converts to lowercase
 * - Removes punctuation
 * - Handles common variations
 */
function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[-–—]/g, ' ')
    .replace(/[^\w\s']/g, '')
    .trim();
}

/**
 * Checks if two keywords/behaviors match (fuzzy matching)
 * - Exact match
 * - One contains the other
 * - Word overlap > 50%
 */
function keywordsMatch(observed: string, soulTypeKeyword: string): boolean {
  const normObserved = normalizeForMatching(observed);
  const normKeyword = normalizeForMatching(soulTypeKeyword);

  // Exact match
  if (normObserved === normKeyword) return true;

  // One contains the other
  if (normObserved.includes(normKeyword) || normKeyword.includes(normObserved)) return true;

  // Word overlap check
  const observedWords = normObserved.split(/\s+/);
  const keywordWords = normKeyword.split(/\s+/);
  const commonWords = observedWords.filter(w => keywordWords.includes(w));
  const overlapRatio = commonWords.length / Math.min(observedWords.length, keywordWords.length);

  return overlapRatio >= 0.5;
}

/**
 * HYBRID MATCHING: Match observed behaviors to the best Soul Type
 *
 * Uses a two-layer approach:
 * 1. Expand observed behaviors using synonym map (bridges vocabulary gap)
 * 2. Match expanded behaviors against Soul Type keywords
 *
 * @param observedBehaviors - Behaviors extracted by AI from chat (e.g., ["ghosting", "hot cold", "manipulation"])
 * @param gender - 'male' or 'female' to select from the right pool
 * @returns The best matching Soul Type with confidence score
 */
export function matchSoulTypeByKeywords(
  observedBehaviors: string[],
  gender: 'male' | 'female'
): SoulTypeMatchResult {
  const soulTypes = gender === 'male' ? MALE_SOUL_TYPES : FEMALE_SOUL_TYPES;

  // Expand behaviors using synonym map
  const expandedBehaviors = expandBehaviors(observedBehaviors);

  console.log(`[Soul Type Matching] Gender: ${gender}`);
  console.log(`[Soul Type Matching] Original behaviors: [${observedBehaviors.join(', ')}]`);
  console.log(`[Soul Type Matching] Expanded behaviors: [${expandedBehaviors.join(', ')}]`);

  // Score each Soul Type based on keyword matches
  const scored = soulTypes.map(soulType => {
    const keywords = soulType.keywords || [];
    const matchedKeywords: string[] = [];

    // For each expanded behavior, check if it matches any keyword
    for (const observed of expandedBehaviors) {
      for (const keyword of keywords) {
        if (keywordsMatch(observed, keyword) && !matchedKeywords.includes(keyword)) {
          matchedKeywords.push(keyword);
          break; // One match per observed behavior
        }
      }
    }

    // Score = matched keywords / total keywords, weighted by how many original behaviors matched
    const score = keywords.length > 0
      ? matchedKeywords.length / keywords.length
      : 0;

    return { soulType, score, matchedKeywords };
  });

  // Sort by score (highest first), then by number of matched keywords as tiebreaker
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.matchedKeywords.length - a.matchedKeywords.length;
  });

  // Return the best match
  const best = scored[0];

  console.log(`[Soul Type Matching] Best match: "${best.soulType.name}" (${(best.score * 100).toFixed(0)}% confidence)`);
  console.log(`[Soul Type Matching] Matched keywords: [${best.matchedKeywords.join(', ')}]`);

  // Log top 3 for debugging
  scored.slice(0, 3).forEach((s, i) => {
    console.log(`[Soul Type Matching] #${i + 1}: "${s.soulType.name}" score=${(s.score * 100).toFixed(0)}% matched=[${s.matchedKeywords.join(', ')}]`);
  });

  return {
    soulType: best.soulType,
    confidence: best.score,
    matchedKeywords: best.matchedKeywords
  };
}

/**
 * Get Soul Type by exact name match (for fallback/validation)
 */
export function getSoulTypeByName(name: string, gender: 'male' | 'female'): SoulType | null {
  if (gender === 'male') {
    return getMaleSoulTypeByName(name) || null;
  }
  return getFemaleSoulTypeByName(name) || null;
}

/**
 * Personalize a Soul Type description based on AI-generated context
 */
export function personalizeSoulTypeDescription(
  soulType: SoulType,
  aiDescription?: string
): string {
  // If AI provided a personalized description, use it
  // Otherwise use the default Soul Type description
  return aiDescription || soulType.description;
}

export interface Archetype {
  id: string;
  name: string;
  category: string;
  image_url: string;
  gradient_start: string;
  gradient_end: string;
  semantic_tags: string[];
  severity_range: number[];
  description_template: string;
  traits_pool: string[];
  rarity: string;
  unlock_count: number;
}

export interface CategoryAnalysis {
  behaviorPatterns: string[];
  semanticTags: string[];
  severity: number;
  specificExamples: string[];
  templateVars: Record<string, string>;
}

interface ArchetypeWithScore {
  archetype: Archetype;
  score: number;
}

/**
 * Seleziona il miglior archetype per una categoria basandosi su semantic matching
 */
export async function selectBestArchetype(
  category: string,
  analysis: CategoryAnalysis
): Promise<{ archetype: Archetype; confidence: number }> {

  // 1. Fetch tutti gli archetypes di quella categoria
  console.log('[Archetype Matching] Searching for category:', JSON.stringify(category));

  const { data: archetypes, error } = await supabase
    .from('archetypes')
    .select('*')
    .eq('category', category);

  console.log('[Archetype Matching] Found archetypes:', archetypes?.length || 0);

  if (error) {
    console.error('Error fetching archetypes:', error);
    throw error;
  }

  if (!archetypes || archetypes.length === 0) {
    // Log all available categories for debugging
    const { data: allCategories } = await supabase
      .from('archetypes')
      .select('category')
      .limit(100);

    const uniqueCategories = [...new Set(allCategories?.map(a => a.category) || [])];
    console.error('[Archetype Matching] Available categories in DB:', uniqueCategories);
    console.error('[Archetype Matching] Searched for:', category);

    throw new Error(`No archetypes found for category: ${category}. Available: ${uniqueCategories.join(', ')}`);
  }

  // 2. Score ogni archetype basato su semantic similarity
  const scored: ArchetypeWithScore[] = archetypes.map((archetype: Archetype) => {
    let score = 0;

    // A. Semantic tags overlap (60% weight)
    const tagOverlap = analysis.semanticTags.filter(tag =>
      archetype.semantic_tags.includes(tag)
    ).length;
    const tagScore = (tagOverlap / Math.max(analysis.semanticTags.length, 1)) * 0.6;
    score += tagScore;

    // B. Severity range match (30% weight)
    const [minSev, maxSev] = archetype.severity_range;
    const severityMatch = analysis.severity >= minSev && analysis.severity <= maxSev;
    score += severityMatch ? 0.3 : 0;

    // C. Rarity boost (10% weight) - favorisce archetypes meno comuni per varietà
    const rarityBoost = archetype.rarity === 'rare' ? 0.05 : archetype.rarity === 'epic' ? 0.1 : 0;
    score += rarityBoost;

    return { archetype, score };
  });

  // 3. Sort by score e return il migliore
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  // 4. Confidence = score normalizzato
  const confidence = Math.min(best.score, 1);

  console.log(`[Archetype Matching] Category: ${category}, Selected: ${best.archetype.name}, Confidence: ${confidence.toFixed(2)}`);

  return {
    archetype: best.archetype,
    confidence
  };
}

/**
 * Personalizza la description template con i valori generati dall'AI
 */
export function personalizeDescription(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;

  // Replace {variable} placeholders con i valori dall'AI
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{${key}}`;
    result = result.replace(new RegExp(placeholder, 'g'), value || '...');
  }

  // Clean up any remaining unreplaced placeholders
  result = result.replace(/\{[^}]+\}/g, '...');

  return result;
}

/**
 * Seleziona i traits migliori dal pool dell'archetype basandosi sui semantic tags
 */
export function selectTraitsFromPool(
  pool: string[],
  aiTags: string[],
  count: number = 4
): string[] {
  // Prioritize traits che matchano i semantic tags dell'AI
  const matched = pool.filter(trait =>
    aiTags.some(tag =>
      trait.toLowerCase().includes(tag.toLowerCase().replace(/_/g, ' ')) ||
      tag.toLowerCase().replace(/_/g, ' ').includes(trait.toLowerCase())
    )
  );

  // Se abbiamo abbastanza match, usa quelli
  if (matched.length >= count) {
    return matched.slice(0, count);
  }

  // Altrimenti completa con random dal pool
  const remaining = pool.filter(t => !matched.includes(t));
  const random = remaining
    .sort(() => Math.random() - 0.5)
    .slice(0, count - matched.length);

  return [...matched, ...random].slice(0, count);
}

/**
 * Fetch image URL for an archetype
 */
export async function getArchetypeImageUrl(archetypeId: string): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('archetypes')
    .select('image_url')
    .eq('id', archetypeId)
    .single();

  if (error) {
    console.error('Error fetching archetype image:', error);
    return undefined;
  }

  return data?.image_url;
}
