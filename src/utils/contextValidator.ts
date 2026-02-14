// ============================================
// CONTEXT CONSISTENCY VALIDATOR
// ============================================
// Layer 3 of the Three-Layer Defense System.
// Hard-coded safety net that enforces consistency between
// Gemini's reasoning block and its analysis output.
// This runs AFTER JSON parsing, BEFORE storing results.

/**
 * Context reasoning that Gemini MUST produce BEFORE any analysis.
 * Forces chain-of-thought: understand the vibe → then analyze.
 */
export interface ContextReasoning {
  overallVibe: 'playful' | 'casual' | 'friendly' | 'romantic' | 'flirty' | 'tense' | 'heated' | 'toxic' | 'mixed';
  chatContext: string;
  isMemeOrJoke: boolean;
  toxicityAssessment: 'none' | 'minimal' | 'moderate' | 'significant' | 'severe';
  severityCeiling: number;
}

/**
 * Maps harsh/negative traits to proportional neutral alternatives.
 * Used when reasoning indicates a non-toxic context.
 */
const HARSH_TO_NEUTRAL_MAP: Record<string, string> = {
  // Personality misreads in positive contexts
  'insecure': 'Open',
  'needy': 'Warm',
  'attention-seeking': 'Expressive',
  'attention seeking': 'Expressive',
  'validation-seeking': 'Expressive',
  'validation seeking': 'Expressive',
  'ego': 'Confident',
  'egotistic': 'Confident',
  'egotistical': 'Confident',
  'narcissistic': 'Self-Assured',
  'clingy': 'Affectionate',
  'obsessive': 'Devoted',
  'overwhelming': 'Enthusiastic',
  'intense': 'Passionate',
  'anxious': 'Attentive',
  'overthink': 'Thoughtful',
  'overthinking': 'Thoughtful',
  'passive': 'Easygoing',
  'passive-aggressive': 'Reserved',
  'manipulative': 'Persuasive',
  'controlling': 'Decisive',
  'possessive': 'Protective',
  'jealous': 'Caring',
  'dismissive': 'Independent',
  'selfish': 'Self-Focused',
  'toxic': 'Complex',
  'aggressive': 'Direct',
  'bland': 'Steady',
  'dull': 'Low-Key',
  'unresponsive': 'Concise',
  'low-effort': 'Relaxed',
  'low effort': 'Relaxed',
  'subtle': 'Low-Key',
};

/** Vibes considered non-toxic / positive */
const POSITIVE_VIBES = ['playful', 'casual', 'friendly', 'romantic', 'flirty'];

/** Toxicity assessment levels considered low */
const LOW_TOXICITY_LEVELS = ['none', 'minimal'];

/** Keywords that indicate genuinely toxic behavior (even in positive vibes, these stay) */
const GENUINE_TOXIC_KEYWORDS = [
  'gaslight', 'manipulat', 'control', 'threaten', 'stalk',
  'abuse', 'degrad', 'guilt trip', 'blackmail', 'isolat',
  'harass', 'assault', 'violence', 'coerci',
];

/** Meme/game message patterns that should never be RED FLAGS */
const MEME_PATTERNS = [
  /how would you describe me/i,
  /describe me/i,
  /abcdefg/i,
  /rate me/i,
  /what do you think of me/i,
  /tell me something/i,
  /what am i/i,
  /would you rather/i,
  /truth or dare/i,
];

/**
 * Validates and enforces consistency between Gemini's reasoning block
 * and the rest of its output. Mutates the result object in place.
 */
export function validateConsistency(
  reasoning: ContextReasoning,
  result: {
    scores?: { overall: number; drama?: number; distance?: number; warmth?: number; communication?: number; passion?: number };
    categoryAnalysis?: Record<string, {
      severity: number;
      personalizedTraits: string[];
      personalizedDescription: string;
    }>;
    messageInsights?: Array<{
      message: string;
      tag: string;
      description: string;
      messageCount: string;
    }>;
    profile?: {
      type: string;
      subtitle: string;
      description: string;
    };
    personArchetype?: {
      traits: string[];
      description: string;
      observedBehaviors?: string[];
    };
    userArchetype?: {
      traits: string[];
      description: string;
      observedBehaviors?: string[];
    };
  }
): void {
  const isPositiveVibe = POSITIVE_VIBES.includes(reasoning.overallVibe);
  const isLowToxicity = LOW_TOXICITY_LEVELS.includes(reasoning.toxicityAssessment);
  const ceiling = Math.max(1, Math.min(10, reasoning.severityCeiling || 10));

  console.log(`[ConsistencyValidator] Vibe: ${reasoning.overallVibe}, Toxicity: ${reasoning.toxicityAssessment}, Ceiling: ${ceiling}, Meme: ${reasoning.isMemeOrJoke}`);

  // RULE 1: Clamp overall toxicity score based on vibe
  if (result.scores && isPositiveVibe && isLowToxicity) {
    if (result.scores.overall > 30) {
      console.log(`[ConsistencyValidator] Clamped overall score from ${result.scores.overall} to 30 (vibe: ${reasoning.overallVibe})`);
      result.scores.overall = 30;
    }
    if (result.scores.drama !== undefined && result.scores.drama > 25) {
      console.log(`[ConsistencyValidator] Clamped drama from ${result.scores.drama} to 25`);
      result.scores.drama = 25;
    }
  }

  // RULE 2: Clamp all category severities to the ceiling
  if (result.categoryAnalysis) {
    for (const [catKey, cat] of Object.entries(result.categoryAnalysis)) {
      if (cat.severity > ceiling) {
        console.log(`[ConsistencyValidator] Clamped ${catKey} severity from ${cat.severity} to ${ceiling}`);
        cat.severity = ceiling;
      }
    }
  }

  // RULE 3: Replace harsh traits with proportional alternatives (positive vibes only)
  if (isPositiveVibe && ceiling <= 4) {
    if (result.categoryAnalysis) {
      for (const [catKey, cat] of Object.entries(result.categoryAnalysis)) {
        cat.personalizedTraits = cat.personalizedTraits.map(trait => {
          const lower = trait.toLowerCase().trim();
          const replacement = HARSH_TO_NEUTRAL_MAP[lower];
          if (replacement) {
            console.log(`[ConsistencyValidator] Replaced trait "${trait}" -> "${replacement}" in ${catKey}`);
            return replacement;
          }
          return trait;
        });
      }
    }
    // Also fix archetype traits
    if (result.personArchetype?.traits) {
      result.personArchetype.traits = result.personArchetype.traits.map(trait => {
        const lower = trait.toLowerCase().trim();
        return HARSH_TO_NEUTRAL_MAP[lower] || trait;
      });
    }
    if (result.userArchetype?.traits) {
      result.userArchetype.traits = result.userArchetype.traits.map(trait => {
        const lower = trait.toLowerCase().trim();
        return HARSH_TO_NEUTRAL_MAP[lower] || trait;
      });
    }
  }

  // RULE 4: Filter RED FLAG messageInsights for positive vibes with low ceiling
  // Note: GREEN FLAG and DECODED tags are always preserved (only RED FLAGs get filtered)
  if (result.messageInsights && isPositiveVibe && ceiling <= 3) {
    const before = result.messageInsights.length;
    result.messageInsights = result.messageInsights.filter(insight => {
      if (insight.tag === 'GREEN FLAG' || insight.tag === 'DECODED') return true;
      if (insight.tag === 'RED FLAG') {
        const desc = (insight.description || '').toLowerCase();
        const msg = (insight.message || '').toLowerCase();
        const combined = desc + ' ' + msg;
        const isGenuineToxic = GENUINE_TOXIC_KEYWORDS.some(kw => combined.includes(kw));
        if (!isGenuineToxic) {
          console.log(`[ConsistencyValidator] Removed non-toxic RED FLAG in positive vibe: "${insight.message?.substring(0, 50)}"`);
          return false;
        }
      }
      return true;
    });
    if (result.messageInsights.length < before) {
      result.messageInsights.forEach((insight, idx) => {
        insight.messageCount = `${idx + 1} of ${result.messageInsights!.length}`;
      });
    }
  }

  // RULE 5: If meme/joke, remove RED FLAGS on meme/game messages
  if (reasoning.isMemeOrJoke && result.messageInsights) {
    const before = result.messageInsights.length;
    result.messageInsights = result.messageInsights.filter(insight => {
      if (insight.tag !== 'RED FLAG') return true;
      const msg = insight.message || '';
      const isMemeMessage = MEME_PATTERNS.some(p => p.test(msg));
      if (isMemeMessage) {
        console.log(`[ConsistencyValidator] Removed meme/joke RED FLAG: "${msg.substring(0, 50)}"`);
        return false;
      }
      return true;
    });
    if (result.messageInsights.length < before) {
      result.messageInsights.forEach((insight, idx) => {
        insight.messageCount = `${idx + 1} of ${result.messageInsights!.length}`;
      });
    }
  }

  // RULE 6: Cross-validate profile type vs toxicity score
  if (result.scores && result.profile) {
    if (isPositiveVibe && result.scores.overall <= 30) {
      if (result.profile.type === 'Red Flag Alert' || result.profile.type === 'Toxic Zone') {
        console.log(`[ConsistencyValidator] Overrode profile "${result.profile.type}" -> "${result.scores.overall <= 15 ? 'Comfort Zone' : 'Green Light'}"`);
        result.profile.type = result.scores.overall <= 15 ? 'Comfort Zone' : 'Green Light';
      }
    }
    if (result.scores.overall >= 60 && result.profile.type === 'Comfort Zone') {
      console.log(`[ConsistencyValidator] Overrode profile "Comfort Zone" -> "Red Flag Alert"`);
      result.profile.type = result.scores.overall >= 80 ? 'Toxic Zone' : 'Red Flag Alert';
    }
  }

  // RULE 7: Clean observedBehaviors for positive vibes (remove "ego", "vague" etc.)
  if (isPositiveVibe && ceiling <= 3) {
    const harshBehaviors = ['ego', 'selfish', 'vague', 'manipulative', 'toxic', 'controlling', 'possessive', 'aggressive', 'threatening', 'stalking', 'abusive'];
    const neutralReplacements: Record<string, string> = {
      'ego': 'charming',
      'selfish': 'confident',
      'vague': 'mysterious',
      'manipulative': 'persuasive',
      'toxic': 'complex',
      'controlling': 'decisive',
      'possessive': 'protective',
      'aggressive': 'direct',
    };

    if (result.personArchetype?.observedBehaviors) {
      result.personArchetype.observedBehaviors = result.personArchetype.observedBehaviors.map(b => {
        const lower = b.toLowerCase().trim();
        if (harshBehaviors.includes(lower)) {
          const replacement = neutralReplacements[lower] || 'warm';
          console.log(`[ConsistencyValidator] Replaced person behavior "${b}" -> "${replacement}"`);
          return replacement;
        }
        return b;
      });
    }
    if (result.userArchetype?.observedBehaviors) {
      result.userArchetype.observedBehaviors = result.userArchetype.observedBehaviors.map(b => {
        const lower = b.toLowerCase().trim();
        if (harshBehaviors.includes(lower)) {
          const replacement = neutralReplacements[lower] || 'warm';
          console.log(`[ConsistencyValidator] Replaced user behavior "${b}" -> "${replacement}"`);
          return replacement;
        }
        return b;
      });
    }
  }
}

/**
 * Infers a ContextReasoning from scores when Gemini fails to produce one.
 * FALLBACK ONLY — the prompt should always produce reasoning.
 */
export function inferReasoningFromScores(scores: {
  overall: number;
  warmth: number;
  communication?: number;
  drama: number;
  passion: number;
}): ContextReasoning {
  const { overall, warmth, drama, passion } = scores;

  let overallVibe: ContextReasoning['overallVibe'];
  let toxicityAssessment: ContextReasoning['toxicityAssessment'];
  let severityCeiling: number;

  if (overall <= 15 && warmth >= 70) {
    overallVibe = 'friendly';
    toxicityAssessment = 'none';
    severityCeiling = 2;
  } else if (overall <= 25) {
    overallVibe = passion >= 60 ? 'romantic' : 'casual';
    toxicityAssessment = 'minimal';
    severityCeiling = 3;
  } else if (overall <= 45) {
    overallVibe = 'mixed';
    toxicityAssessment = 'moderate';
    severityCeiling = 6;
  } else if (overall <= 70) {
    overallVibe = drama >= 50 ? 'heated' : 'tense';
    toxicityAssessment = 'significant';
    severityCeiling = 8;
  } else {
    overallVibe = 'toxic';
    toxicityAssessment = 'severe';
    severityCeiling = 10;
  }

  console.warn('[ConsistencyValidator] Reasoning block missing from AI output, inferred from scores:', { overallVibe, toxicityAssessment, severityCeiling });

  return {
    overallVibe,
    chatContext: 'Inferred from scores (reasoning block was missing)',
    isMemeOrJoke: false,
    toxicityAssessment,
    severityCeiling,
  };
}
