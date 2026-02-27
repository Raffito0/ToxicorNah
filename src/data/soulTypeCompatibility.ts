// Soul Type Compatibility — Formula-based scoring system
// No 224-entry manual matrix needed. Uses energy type relationships + trait overlap.

import { getMaleSoulTypeByName, getFemaleSoulTypeByName } from './soulTypes';
import type { TypeMatrixEntry } from '../services/soulProfileService';

// ===== Energy Type Compatibility Matrix =====
// Score modifiers for energy type pairings: positive = complementary, negative = conflicting

type EnergyScore = Record<string, number>;

const ENERGY_COMPATIBILITY: Record<string, EnergyScore> = {
  // Female energies → Male energies score modifier (-30 to +30)
  'Rush Energy': { 'Warm Energy': 25, 'Explosive Energy': -10, 'Phantom Energy': -25, 'Collector Energy': -20, 'Wild Energy': 5, 'Toxic Energy': -15, 'Frozen Energy': -20 },
  'Earth Energy': { 'Warm Energy': 30, 'Wild Energy': -10, 'Toxic Energy': -25, 'Shapeshifter Energy': -15, 'Hollow Energy': -10, 'Martyr Energy': -5, 'Constrictor Energy': -25 },
  'Fire Energy': { 'Explosive Energy': 10, 'Frozen Energy': -5, 'Unstable Energy': -15, 'Wild Energy': 15, 'Warm Energy': 20, 'Phantom Energy': -20, 'Toxic Energy': -10 },
  'Frost Energy': { 'Warm Energy': 20, 'Explosive Energy': -25, 'Phantom Energy': -15, 'Wild Energy': -10, 'Frozen Energy': -20, 'Constrictor Energy': -25, 'Abyss Energy': -5 },
  'Silk Energy': { 'Warm Energy': 25, 'Martyr Energy': -15, 'Toxic Energy': -25, 'Explosive Energy': -10, 'Abyss Energy': -5, 'Collector Energy': -20, 'Wild Energy': 5 },
  'Intuitive Energy': { 'Warm Energy': 20, 'Shapeshifter Energy': -20, 'Toxic Energy': -20, 'Abyss Energy': 5, 'Wild Energy': 0, 'Constrictor Energy': -25, 'Phantom Energy': -15 },
  'Venom Energy': { 'Toxic Energy': -10, 'Warm Energy': 15, 'Frozen Energy': 5, 'Martyr Energy': -5, 'Wild Energy': 10, 'Explosive Energy': -15, 'Shapeshifter Energy': -15 },
  'Sunset Energy': { 'Warm Energy': 25, 'Collector Energy': -25, 'Hollow Energy': -20, 'Martyr Energy': -10, 'Toxic Energy': -25, 'Constrictor Energy': -20, 'Wild Energy': 0 },
  'Shadow Energy': { 'Abyss Energy': 10, 'Frozen Energy': 5, 'Warm Energy': 15, 'Explosive Energy': -20, 'Constrictor Energy': -20, 'Shapeshifter Energy': -10, 'Collector Energy': -15 },
  'Luxe Energy': { 'Wild Energy': 15, 'Warm Energy': 10, 'Collector Energy': -10, 'Hollow Energy': -15, 'Toxic Energy': -20, 'Explosive Energy': 5, 'Constrictor Energy': -25 },
  'Labyrinth Energy': { 'Warm Energy': 25, 'Unstable Energy': -25, 'Shapeshifter Energy': -20, 'Toxic Energy': -20, 'Phantom Energy': -15, 'Wild Energy': -5, 'Abyss Energy': -10 },
  'Gold Energy': { 'Warm Energy': 30, 'Wild Energy': 10, 'Frozen Energy': -5, 'Toxic Energy': -25, 'Martyr Energy': -10, 'Constrictor Energy': -25, 'Hollow Energy': -15 },
  'Predator Energy': { 'Wild Energy': 20, 'Toxic Energy': -5, 'Frozen Energy': 10, 'Warm Energy': 15, 'Martyr Energy': -10, 'Shapeshifter Energy': -15, 'Constrictor Energy': -15 },
  'Storm Energy': { 'Warm Energy': 20, 'Explosive Energy': -10, 'Abyss Energy': 10, 'Toxic Energy': -15, 'Wild Energy': 5, 'Phantom Energy': -10, 'Constrictor Energy': -20 },
  'Phoenix Energy': { 'Warm Energy': 25, 'Toxic Energy': -15, 'Martyr Energy': -5, 'Wild Energy': 10, 'Explosive Energy': -10, 'Hollow Energy': -10, 'Frozen Energy': 5 },
  'Mirror Energy': { 'Warm Energy': 20, 'Shapeshifter Energy': -25, 'Toxic Energy': -25, 'Collector Energy': -20, 'Constrictor Energy': -25, 'Abyss Energy': -10, 'Wild Energy': -5 },
};

// ===== Trait Compatibility =====
// Some trait combos amplify each other (positive) or clash (negative)

const TRAIT_SYNERGIES: Record<string, Record<string, number>> = {
  'Resilient': { 'Loyal': 10, 'Attentive': 10, 'Wholesome': 5 },
  'Passionate': { 'Magnetic': 10, 'Unpredictable': -5, 'Overwhelming': -10 },
  'Guarded': { 'Patient': 10, 'Overwhelming': -15, 'Possessive': -20 },
  'Confident': { 'Loyal': 10, 'Charming': 5, 'Manipulative': -10 },
  'Empathetic': { 'Manipulative': -15, 'Loyal': 10, 'Attentive': 10 },
  'Independent': { 'Possessive': -20, 'Controlling': -20, 'Unpredictable': 5 },
  'Analytical': { 'Deceptive': -10, 'Inconsistent': -15, 'Loyal': 10 },
};

// ===== Compatibility Card Labels =====

export interface CompatibilityCard {
  hisType: string;
  hisImageUrl: string;
  hisTagline: string;
  score: number;
  tag: 'SAFE' | 'RED FLAG' | 'SURPRISING';
  label: string;       // "Most Compatible" / "Least Compatible" / "Surprising Match"
  description: string;
  realConversations?: number; // If user has actual analyses with this type
}

// ===== Main Compatibility Calculator =====

export function calculateCompatibility(herType: string, hisType: string): number {
  const herData = getFemaleSoulTypeByName(herType);
  const hisData = getMaleSoulTypeByName(hisType);

  if (!herData || !hisData) return 50; // neutral fallback

  let score = 50; // base score

  // 1. Energy type compatibility (biggest factor: -30 to +30)
  const herEnergy = herData.energyType;
  const hisEnergy = hisData.energyType;
  const energyMod = ENERGY_COMPATIBILITY[herEnergy]?.[hisEnergy] ?? 0;
  score += energyMod;

  // 2. Keyword overlap (high overlap = understanding but triggering: moderate positive)
  const herKeywords = new Set(herData.keywords.map(k => k.toLowerCase()));
  const hisKeywords = hisData.keywords.map(k => k.toLowerCase());
  const overlap = hisKeywords.filter(k => herKeywords.has(k)).length;
  const overlapRatio = hisKeywords.length > 0 ? overlap / hisKeywords.length : 0;

  // Some overlap is good (understanding), too much is bad (triggering)
  if (overlapRatio <= 0.15) score += 5;   // Low overlap: different but complementary
  else if (overlapRatio <= 0.3) score += 10; // Moderate: good understanding
  else score -= 5;                          // High: too similar, triggering

  // 3. Trait synergies (-20 to +20)
  let traitMod = 0;
  for (const herTrait of herData.traits) {
    const synergies = TRAIT_SYNERGIES[herTrait];
    if (synergies) {
      for (const hisTrait of hisData.traits) {
        traitMod += synergies[hisTrait] || 0;
      }
    }
  }
  score += Math.max(-20, Math.min(20, traitMod));

  // Clamp to 5-95 range (never 0 or 100)
  return Math.max(5, Math.min(95, Math.round(score)));
}

// ===== Build 3 Compatibility Cards =====

const MALE_SOUL_TYPES = [
  'The Untamable', 'The Gentle Flame', 'The Silent Abyss', 'The Faded Crown',
  'The Sweet Poison', 'The Wounded Prince', 'The Burning Promise', 'The Final Silence',
  'The Dark Mirror', 'The Ice Charmer', 'The Silent Choke', 'The Shifting Flame',
  'The Chameleon', 'The Star Collector',
];

// Descriptions for compatibility cards
const COMPAT_DESCRIPTIONS: Record<string, Record<string, string>> = {
  'SAFE': {
    'The Gentle Flame': "He matches your energy without draining it. This is what love is supposed to feel like.",
    'The Untamable': "Wild but real. He won't cage you and you won't bore him.",
    'default': "This energy complements yours naturally. Less friction, more flow.",
  },
  'RED FLAG': {
    'The Sweet Poison': "Maximum danger zone. His charm is custom-designed to bypass your defenses.",
    'The Dark Mirror': "He'll reflect your worst back at you and call it love.",
    'The Silent Choke': "His control and your freedom are on a collision course.",
    'The Star Collector': "You're a bookmark, not a story. He'll never give you the whole chapter.",
    'default': "This energy clashes with yours in ways that erode who you are.",
  },
  'SURPRISING': {
    'default': "On paper this shouldn't work — but the data says otherwise.",
  },
};

function getCompatDescription(tag: 'SAFE' | 'RED FLAG' | 'SURPRISING', hisType: string): string {
  const tagDescs = COMPAT_DESCRIPTIONS[tag];
  return tagDescs[hisType] || tagDescs['default'];
}

export function buildSoulCompatibility(
  herType: string,
  typeMatrix: TypeMatrixEntry[],
): CompatibilityCard[] {
  // Calculate compatibility with ALL male types
  const allScores = MALE_SOUL_TYPES.map(hisType => {
    const hisData = getMaleSoulTypeByName(hisType);
    const realCount = typeMatrix.filter(t => t.hisArchetype === hisType).reduce((sum, t) => sum + t.relationshipCount, 0);
    return {
      hisType,
      hisImageUrl: hisData?.normalImage || '',
      hisTagline: hisData?.tagline || '',
      score: calculateCompatibility(herType, hisType),
      realConversations: realCount > 0 ? realCount : undefined,
    };
  }).sort((a, b) => b.score - a.score);

  const cards: CompatibilityCard[] = [];

  // 1. Most Compatible (highest score) — SAFE
  const best = allScores[0];
  cards.push({
    ...best,
    tag: 'SAFE',
    label: 'Most Compatible',
    description: getCompatDescription('SAFE', best.hisType),
  });

  // 2. Least Compatible (lowest score) — RED FLAG
  const worst = allScores[allScores.length - 1];
  cards.push({
    ...worst,
    tag: 'RED FLAG',
    label: 'Least Compatible',
    description: getCompatDescription('RED FLAG', worst.hisType),
  });

  // 3. Surprising Match — a type the user has ACTUALLY attracted but with mid-range compatibility
  // or if no real data, pick a mid-range score type
  const midRange = allScores.filter(s => s.score >= 35 && s.score <= 65 && s.hisType !== best.hisType && s.hisType !== worst.hisType);

  // Prefer one the user has real conversations with
  const withReal = midRange.filter(s => s.realConversations && s.realConversations > 0);
  const surprising = withReal.length > 0
    ? withReal[0]
    : midRange.length > 0
      ? midRange[Math.floor(midRange.length / 2)]
      : allScores[Math.floor(allScores.length / 2)]; // absolute fallback

  cards.push({
    ...surprising,
    tag: 'SURPRISING',
    label: 'Surprising Match',
    description: surprising.realConversations
      ? `Based on ${surprising.realConversations} real conversation${surprising.realConversations > 1 ? 's' : ''} — this pairing defies the formula.`
      : getCompatDescription('SURPRISING', surprising.hisType),
  });

  return cards;
}
