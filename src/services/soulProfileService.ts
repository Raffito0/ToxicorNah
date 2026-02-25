import { supabase } from '../lib/supabase';
import { getFemaleSoulTypeByName, getMaleSoulTypeByName } from '../data/soulTypes';
import { buildSoulCompatibility, type CompatibilityCard } from '../data/soulTypeCompatibility';
import { usesMockData } from '../utils/platform';

// ===== Interfaces =====

export interface SoulProfileData {
  // Hero - Dominant Archetype
  dominantArchetype: {
    title: string;
    tagline: string;
    description: string;
    traits: string[];
    imageUrl: string;
    gradientFrom: string;
    gradientTo: string;
  };

  // Pattern Shock stat for hero
  patternShock: {
    stat: string;           // "4 of 5"
    label: string;          // "relationships"
    insight: string;        // "you gave more than you received"
    percentage: number;     // 80
  };

  // Stats (for shareable card)
  stats: {
    totalAnalyses: number;
    totalRedFlags: number;
    totalRelationships: number;
    rarestPattern: {
      name: string;
      percentage: number;
    };
  };

  // Type Matrix - How user changes with different guy types
  typeMatrix: TypeMatrixEntry[];

  // Archetype Collection
  unlockedArchetypes: UnlockedArchetype[];
  archetypeRarities: Record<string, { percentage: number; rarity: 'common' | 'rare' | 'epic' }>;

  // Power Dynamics across all relationships
  powerAcrossRelationships: PowerRelationship[];
  averagePowerHeld: number;
  overallPowerTrend: 'gaining' | 'losing' | 'stable';

  // Evolution
  archetypeEvolution: EvolutionPoint[];

  // Soul You Attract
  attractedSoulType: AttractedSoulTypeData;

  // Soul Compatibility
  compatibility: CompatibilityCard[];

  // Mistakes You Keep Making
  mistakes: MistakeEntry[];

  // You Are Becoming
  becoming: BecomingData;

  // Meta
  analysisCount: number;
  hasEnoughData: boolean; // true if 3+ analyses
}

export interface AttractedSoulTypeData {
  archetype: string;
  tagline: string;
  imageUrl: string;
  traits: string[];
  frequency: string;       // "3 out of 5 guys"
  percentage: number;       // 60
  why: string;              // from ATTRACTION_REASONS map
  totalPersons: number;
}

export interface MistakeEntry {
  title: string;
  description: string;
  frequencyString: string;  // "In 4 of 5 relationships"
  icon: string;
}

export interface BecomingData {
  currentArchetype: string;
  futureArchetype: string;
  futureImageUrl: string;
  futureTagline: string;
  journeyDescription: string;
  confidence: number;       // percentage
  analysisCount: number;
}

export interface TypeMatrixEntry {
  hisArchetype: string;
  hisArchetypeImage: string;
  yourArchetype: string;
  yourArchetypeImage: string;
  insight: string;
  relationshipCount: number;
  personNames: string[];
}

export interface UnlockedArchetype {
  title: string;
  imageUrl: string;
  unlockedAt: string;
  personName: string;
  gradientFrom: string;
  gradientTo: string;
}

export interface PowerRelationship {
  personName: string;
  personId: string;
  powerBalance: number; // 0-100, lower = she has less power
  trend: 'gaining' | 'losing' | 'stable';
}

export interface EvolutionPoint {
  date: string;
  archetype: string;
  personName: string;
  imageUrl: string;
}

// ===== Archetype Taglines =====

const ARCHETYPE_TAGLINES: Record<string, string> = {
  'The Volcano': "You explode when pushed too far",
  'The Crown': "You know your worth",
  'The Shadow': "You disappear when things get real",
  'The First Strike': "You hurt before you get hurt",
  'The Echo': "You lose yourself in them",
  'The Clean Cut': "You cut through the bs",
  'The Moth': "You can't stay away from the fire",
  // Defaults for other archetypes
  'default': "Your patterns reveal who you become in love",
};

// ===== Archetype Rarity (hardcoded) =====

const ARCHETYPE_RARITIES: Record<string, { percentage: number; rarity: 'common' | 'rare' | 'epic' }> = {
  'The Echo': { percentage: 28, rarity: 'common' },
  'The Moth': { percentage: 24, rarity: 'common' },
  'The Volcano': { percentage: 18, rarity: 'common' },
  'The Shadow': { percentage: 14, rarity: 'rare' },
  'The First Strike': { percentage: 8, rarity: 'rare' },
  'The Crown': { percentage: 5, rarity: 'epic' },
  'The Clean Cut': { percentage: 3, rarity: 'epic' },
};

// ===== Type Matrix Insights =====
// Maps "his archetype" → "her archetype" → insight

const TYPE_MATRIX_INSIGHTS: Record<string, Record<string, string>> = {
  'The Player': {
    'The Echo': "You lose yourself trying to keep his attention",
    'The Moth': "You chase the thrill, ignoring the warning signs",
    'The Volcano': "His games trigger your explosive side",
    'The Shadow': "You disappear before he can hurt you",
    'The Crown': "You see through his act immediately",
    'The First Strike': "You try to beat him at his own game",
    'default': "His energy brings out your shadows",
  },
  'The Ghost': {
    'The Echo': "His silence makes you try even harder",
    'The Moth': "You keep reaching for someone who isn't there",
    'The Volcano': "You explode from the frustration of silence",
    'The Shadow': "Two ghosts don't make a presence",
    'The Crown': "You refuse to chase unavailable energy",
    'The First Strike': "You ghost him before he ghosts you",
    'default': "His absence amplifies your patterns",
  },
  'The Sweet Poison': {
    'The Echo': "His warmth makes you forget the warning signs",
    'The Moth': "You keep going back despite knowing better",
    'The Volcano': "The sweetness triggers your guard",
    'The Shadow': "You hide from the intensity",
    'The Crown': "You see the manipulation beneath the charm",
    'The First Strike': "You strike before the poison takes effect",
    'default': "His charm disarms your defenses",
  },
  'The Love Bomber': {
    'The Echo': "You mirror his intensity until you're empty",
    'The Moth': "The fire feels like home until it burns",
    'The Volcano': "His intensity matches yours—until it explodes",
    'The Shadow': "You retreat from the overwhelming attention",
    'The Crown': "You recognize the pattern early",
    'The First Strike': "You protect yourself from the crash",
    'default': "His intensity overwhelms your system",
  },
  'The Hot & Cold': {
    'The Echo': "You adapt to every temperature change",
    'The Moth': "The unpredictability becomes addictive",
    'The Volcano': "The inconsistency triggers your rage",
    'The Shadow': "You vanish when things get confusing",
    'The Crown': "You demand consistency or walk away",
    'The First Strike': "You create chaos before he does",
    'default': "His inconsistency destabilizes you",
  },
  'default': {
    'default': "This combination reveals your hidden patterns",
  },
};

// ===== Attraction Reasons =====
// Maps herType → hisType → why she attracts him
// Placeholder structure — AI-generated content will replace these

const ATTRACTION_REASONS: Record<string, Record<string, string>> = {
  'The Love Rush': {
    'The Sweet Poison': "Your intensity is an open door for his manipulation. You fall before you think.",
    'The Burning Promise': "Two fast flames — you both sprint toward love, but one of you always burns out first.",
    'The Wounded Prince': "Your warmth feels like rescue to him. He needs saving, and you can't resist.",
    'The Star Collector': "You give everything upfront — he barely has to try to add you to his collection.",
    'default': "You love fast. He sees someone who won't make him work for it.",
  },
  'The Natural State': {
    'The Gentle Flame': "Genuine meets genuine — the healthiest match in your orbit.",
    'The Faded Crown': "Your stability is a magnet for men clinging to past glory.",
    'The Chameleon': "Your authenticity fascinates him — he doesn't know what real looks like.",
    'default': "Your groundedness attracts men who crave stability they can't create themselves.",
  },
  'The Fire Dance': {
    'The Shifting Flame': "Two chaotic energies feeding off each other. Addictive and destructive.",
    'The Burning Promise': "Matching fire — explosive chemistry, but no one knows when to stop.",
    'The Ice Charmer': "Your fire melts his ice. He's drawn to what he can't feel on his own.",
    'default': "Your passion is magnetic — but it attracts men who confuse intensity with love.",
  },
  'The Frozen Bloom': {
    'The Burning Promise': "He sees your walls as a challenge. He'll promise the world to melt them.",
    'The Sweet Poison': "Your guard is down with charm — he slips through the cracks you didn't know existed.",
    'The Gentle Flame': "His patience is the only warmth that doesn't scare you.",
    'default': "Your walls attract men who either want to save you or break you.",
  },
  'The Torn Silk': {
    'The Wounded Prince': "Two broken people hoping the other will be the glue. Neither is.",
    'The Gentle Flame': "He's drawn to your elegance in pain — he wants to protect what's cracked.",
    'The Sweet Poison': "He sees your scars and knows exactly where to press.",
    'default': "Your beautiful damage attracts men who romanticize what's broken.",
  },
  'The Inner Voice': {
    'The Silent Abyss': "You're drawn to decode him. He's drawn to someone who actually tries.",
    'The Chameleon': "Your self-awareness intimidates — only shapeshifters try to match it.",
    'The Gentle Flame': "He respects your depth. You trust his consistency.",
    'default': "Your intuition attracts men who are either transparent or terrified of being seen.",
  },
  'The Silent Venom': {
    'The Dark Mirror': "Two tactical minds — a power struggle disguised as a relationship.",
    'The Sweet Poison': "Mutual toxicity. You both know the game, and neither stops playing.",
    'The Wounded Prince': "He doesn't see your venom coming. You didn't plan to use it.",
    'default': "Your quiet power attracts men who underestimate you — until it's too late.",
  },
  'The Sunset Soul': {
    'The Star Collector': "You pour until you're empty. He takes without looking back.",
    'The Faded Crown': "He takes your warmth for granted — you're too busy giving to notice.",
    'The Wounded Prince': "Your selflessness is his life support. You'll drain yourself for his wounds.",
    'default': "You give too much. You attract men who are happy to take it all.",
  },
  'The Deep Shadow': {
    'The Silent Abyss': "Two mysteries orbiting each other — deep but never truly connecting.",
    'The Ice Charmer': "Your mystery intrigues his calculated coldness.",
    'The Dark Mirror': "He mirrors your darkness back — neither of you looks away.",
    'default': "Your enigma attracts men fascinated by what they can't fully reach.",
  },
  'The Wild Luxury': {
    'The Star Collector': "You're his trophy. He's your audience. Neither sees the other clearly.",
    'The Untamable': "Wild meets wild — thrilling but no one builds anything lasting.",
    'The Burning Promise': "He promises the lifestyle. You want the fairy tale. Neither delivers.",
    'default': "Your unapologetic standards attract men who want the image, not the reality.",
  },
  'The Living Maze': {
    'The Chameleon': "Two people lost in identity — mirrors reflecting mirrors.",
    'The Sweet Poison': "Your overthinking is his playground. He'll twist every doubt you have.",
    'The Shifting Flame': "His inconsistency feeds your spirals. You're addicted to solving him.",
    'default': "Your complexity attracts men who either want to solve you or exploit your confusion.",
  },
  'The Golden Rule': {
    'The Gentle Flame': "The match you deserve — he meets your standards naturally.",
    'The Untamable': "Your boundaries fascinate wild men. Some rise to meet them. Most don't.",
    'The Faded Crown': "He sees your crown and wants it reflected on him.",
    'default': "Your standards attract men who either rise to meet them or resent them.",
  },
  'The Savage Grace': {
    'The Untamable': "Two predators — the chemistry is electric but someone always gets bitten.",
    'The Dark Mirror': "He sees a worthy opponent. You see someone who won't flinch.",
    'The Ice Charmer': "Your fire against his ice — the tension is the entire relationship.",
    'default': "Your fierce elegance attracts men who want a challenge, not a partnership.",
  },
  'The Quiet Storm': {
    'The Silent Abyss': "Two quiet forces — deep respect or deep avoidance. Nothing in between.",
    'The Burning Promise': "Your patience meets his urgency — he pushes, you observe.",
    'The Dark Mirror': "He tests everyone. You're the only one who doesn't react. It drives him crazy.",
    'default': "Your composure attracts men who mistake your patience for weakness.",
  },
  'The Rising Phoenix': {
    'The Wounded Prince': "He sees your transformation and wants the same rescue you gave yourself.",
    'The Sweet Poison': "He's drawn to your strength. You're drawn to proving you can handle anything.",
    'The Gentle Flame': "He admires what you've built from ashes. This one might be real.",
    'default': "Your comeback story attracts men who either respect your growth or test it.",
  },
  'The Liquid Mirror': {
    'The Chameleon': "Two shapeshifters — neither knows who they really are anymore.",
    'The Dark Mirror': "He projects, you absorb. His identity becomes yours.",
    'The Star Collector': "You become whoever he needs. He collects versions of you like trophies.",
    'default': "You adapt to everyone. You attract men who love what you become for them, not who you are.",
  },
  'default': {
    'default': "Your energy pattern creates a specific gravitational pull — this is who answers.",
  },
};

function getAttractionReason(herType: string, hisType: string): string {
  const herReasons = ATTRACTION_REASONS[herType] || ATTRACTION_REASONS['default'];
  return herReasons[hisType] || herReasons['default'] || ATTRACTION_REASONS['default']['default'];
}

// ===== Mistake Templates =====
// Each has a condition function that checks real data

interface MistakeTemplate {
  title: string;
  description: string;
  icon: string;
  priority: number; // higher = shown first when multiple match
  condition: (ctx: MistakeContext) => boolean;
  frequencyString: (ctx: MistakeContext) => string;
}

interface MistakeContext {
  averagePowerHeld: number;
  totalAnalyses: number;
  totalRedFlags: number;
  totalRelationships: number;
  dominantArchetype: string;
  typeMatrix: TypeMatrixEntry[];
  archetypeEvolution: EvolutionPoint[];
  powerAcrossRelationships: PowerRelationship[];
}

const MISTAKE_TEMPLATES: MistakeTemplate[] = [
  {
    title: 'Giving away your power',
    description: "You hand over control before you even realize it. Every time you adjust yourself to keep the peace, you lose a piece of who you are.",
    icon: '👑',
    priority: 10,
    condition: (ctx) => ctx.averagePowerHeld < 45,
    frequencyString: (ctx) => {
      const lowPower = ctx.powerAcrossRelationships.filter(p => p.powerBalance < 45).length;
      return `In ${lowPower} of ${ctx.totalRelationships} relationships`;
    },
  },
  {
    title: 'Chasing the same type',
    description: "Different name, different face — same pattern. You keep picking the same energy wearing a new disguise.",
    icon: '🔄',
    priority: 9,
    condition: (ctx) => {
      // Check if any male archetype appears 2+ times
      const hisTypeCounts: Record<string, number> = {};
      ctx.typeMatrix.forEach(t => {
        hisTypeCounts[t.hisArchetype] = (hisTypeCounts[t.hisArchetype] || 0) + t.relationshipCount;
      });
      return Object.values(hisTypeCounts).some(c => c >= 2);
    },
    frequencyString: (ctx) => {
      const hisTypeCounts: Record<string, number> = {};
      ctx.typeMatrix.forEach(t => {
        hisTypeCounts[t.hisArchetype] = (hisTypeCounts[t.hisArchetype] || 0) + t.relationshipCount;
      });
      const sorted = Object.entries(hisTypeCounts).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0 && sorted[0][1] >= 2) {
        return `${sorted[0][1]} guys with the same energy`;
      }
      return `Across ${ctx.totalRelationships} relationships`;
    },
  },
  {
    title: 'Ignoring the red flags',
    description: "You see them. You feel them. And then you explain them away. Every time you justify his behavior, you betray your own instincts.",
    icon: '🚩',
    priority: 8,
    condition: (ctx) => ctx.totalRedFlags > ctx.totalAnalyses * 2,
    frequencyString: (ctx) => `${ctx.totalRedFlags} red flags across ${ctx.totalAnalyses} conversations`,
  },
  {
    title: 'Becoming someone else for him',
    description: "You shapeshift to fit what he wants, and lose the person you were before you met him. Love shouldn't cost you your identity.",
    icon: '🎭',
    priority: 7,
    condition: (ctx) => {
      const uniqueArchetypes = new Set(ctx.archetypeEvolution.map(e => e.archetype));
      return uniqueArchetypes.size >= 3;
    },
    frequencyString: (ctx) => {
      const uniqueArchetypes = new Set(ctx.archetypeEvolution.map(e => e.archetype));
      return `${uniqueArchetypes.size} different versions of yourself`;
    },
  },
  {
    title: 'Staying too long',
    description: "You keep hoping the next conversation will be different. It won't. The exit was three red flags ago.",
    icon: '⏳',
    priority: 6,
    condition: (ctx) => ctx.totalAnalyses >= 5 && ctx.averagePowerHeld < 50,
    frequencyString: (ctx) => `${ctx.totalAnalyses} conversations deep and still hoping`,
  },
  {
    title: 'Loving too fast',
    description: "You dive in headfirst before checking if there's water. Your heart moves faster than your judgment.",
    icon: '💨',
    priority: 5,
    condition: (ctx) => ['The Love Rush', 'The Fire Dance'].includes(ctx.dominantArchetype),
    frequencyString: (ctx) => `Your dominant pattern across ${ctx.totalRelationships} relationships`,
  },
  {
    title: 'Over-explaining yourself',
    description: "You write paragraphs when he gives you one word. If you have to explain why you deserve basic respect, he already doesn't get it.",
    icon: '📝',
    priority: 5,
    condition: (ctx) => ['The Sunset Soul', 'The Living Maze'].includes(ctx.dominantArchetype),
    frequencyString: (ctx) => `Your pattern as ${ctx.dominantArchetype}`,
  },
  {
    title: 'Building walls instead of boundaries',
    description: "There's a difference between protecting yourself and imprisoning yourself. You've confused the two.",
    icon: '🧊',
    priority: 5,
    condition: (ctx) => ['The Frozen Bloom', 'The Quiet Storm', 'The Deep Shadow'].includes(ctx.dominantArchetype),
    frequencyString: (ctx) => `Your pattern as ${ctx.dominantArchetype}`,
  },
  {
    title: 'Trusting the mask over the pattern',
    description: "He showed you who he was in the first three messages. Everything after was you choosing to believe the highlight reel.",
    icon: '🎪',
    priority: 4,
    condition: (ctx) => {
      const hisTypes = new Set(ctx.typeMatrix.map(t => t.hisArchetype));
      return hisTypes.has('The Sweet Poison') || hisTypes.has('The Chameleon') || hisTypes.has('The Dark Mirror');
    },
    frequencyString: (ctx) => `At least one manipulator in your history`,
  },
  {
    title: 'Mistaking intensity for intimacy',
    description: "The butterflies weren't love — they were anxiety. Real love doesn't keep you on edge. It keeps you grounded.",
    icon: '🦋',
    priority: 4,
    condition: (ctx) => {
      const hisTypes = new Set(ctx.typeMatrix.map(t => t.hisArchetype));
      return hisTypes.has('The Burning Promise') || hisTypes.has('The Shifting Flame');
    },
    frequencyString: (ctx) => `Pattern found in your chat history`,
  },
  {
    title: 'Pouring from an empty cup',
    description: "You give and give until there's nothing left, then wonder why you feel invisible. You can't love someone into loving you back.",
    icon: '🫗',
    priority: 5,
    condition: (ctx) => ['The Sunset Soul', 'The Torn Silk'].includes(ctx.dominantArchetype),
    frequencyString: (ctx) => `Your energy pattern as ${ctx.dominantArchetype}`,
  },
  {
    title: 'Collecting unavailable men',
    description: "Ghost. Abyss. Ice. Different label, same emptiness. You're drawn to men who can't show up.",
    icon: '👻',
    priority: 6,
    condition: (ctx) => {
      const unavailableTypes = ['The Final Silence', 'The Silent Abyss', 'The Ice Charmer', 'The Untamable'];
      const hisTypes = ctx.typeMatrix.map(t => t.hisArchetype);
      const unavailableCount = hisTypes.filter(t => unavailableTypes.includes(t)).length;
      return unavailableCount >= 2;
    },
    frequencyString: (ctx) => {
      const unavailableTypes = ['The Final Silence', 'The Silent Abyss', 'The Ice Charmer', 'The Untamable'];
      const count = ctx.typeMatrix.filter(t => unavailableTypes.includes(t.hisArchetype)).length;
      return `${count} emotionally unavailable types in your history`;
    },
  },
];

// ===== Evolution Map =====
// Maps currentArchetype + powerTrend → futureArchetype

const EVOLUTION_MAP: Record<string, Record<string, string>> = {
  'The Love Rush': { gaining: 'The Golden Rule', losing: 'The Liquid Mirror', stable: 'The Fire Dance' },
  'The Natural State': { gaining: 'The Golden Rule', losing: 'The Frozen Bloom', stable: 'The Natural State' },
  'The Fire Dance': { gaining: 'The Savage Grace', losing: 'The Living Maze', stable: 'The Fire Dance' },
  'The Frozen Bloom': { gaining: 'The Rising Phoenix', losing: 'The Deep Shadow', stable: 'The Quiet Storm' },
  'The Torn Silk': { gaining: 'The Rising Phoenix', losing: 'The Sunset Soul', stable: 'The Inner Voice' },
  'The Inner Voice': { gaining: 'The Golden Rule', losing: 'The Living Maze', stable: 'The Inner Voice' },
  'The Silent Venom': { gaining: 'The Savage Grace', losing: 'The Deep Shadow', stable: 'The Quiet Storm' },
  'The Sunset Soul': { gaining: 'The Rising Phoenix', losing: 'The Liquid Mirror', stable: 'The Torn Silk' },
  'The Deep Shadow': { gaining: 'The Quiet Storm', losing: 'The Frozen Bloom', stable: 'The Deep Shadow' },
  'The Wild Luxury': { gaining: 'The Savage Grace', losing: 'The Love Rush', stable: 'The Wild Luxury' },
  'The Living Maze': { gaining: 'The Inner Voice', losing: 'The Liquid Mirror', stable: 'The Living Maze' },
  'The Golden Rule': { gaining: 'The Golden Rule', losing: 'The Quiet Storm', stable: 'The Golden Rule' },
  'The Savage Grace': { gaining: 'The Savage Grace', losing: 'The Silent Venom', stable: 'The Savage Grace' },
  'The Quiet Storm': { gaining: 'The Golden Rule', losing: 'The Frozen Bloom', stable: 'The Quiet Storm' },
  'The Rising Phoenix': { gaining: 'The Rising Phoenix', losing: 'The Fire Dance', stable: 'The Rising Phoenix' },
  'The Liquid Mirror': { gaining: 'The Inner Voice', losing: 'The Sunset Soul', stable: 'The Liquid Mirror' },
};

// Journey descriptions: from → to → description
const JOURNEY_DESCRIPTIONS: Record<string, Record<string, string>> = {
  'The Love Rush': {
    'The Golden Rule': "You're learning that love isn't about speed — it's about standards. The rush is fading, and clarity is taking its place.",
    'The Liquid Mirror': "Be careful — you're losing yourself in the chase. The more you rush, the less of you remains.",
    'The Fire Dance': "Your passion is stabilizing into something fiercer. Not calmer — more directed.",
  },
  'The Natural State': {
    'The Golden Rule': "Your groundedness is evolving into unshakable standards. You're becoming someone who doesn't just accept — she chooses.",
    'The Frozen Bloom': "Someone hurt your trust. Your openness is closing. Don't let one person freeze who you are.",
  },
  'The Fire Dance': {
    'The Savage Grace': "Your fire is becoming precision. Wild energy channeled into something dangerous and elegant.",
    'The Living Maze': "Your fire is turning inward, burning you instead of warming you. Time to redirect.",
  },
  'The Frozen Bloom': {
    'The Rising Phoenix': "The ice is cracking — not because someone broke it, but because you're too powerful to stay frozen.",
    'The Deep Shadow': "You're pulling further inward. The walls are getting thicker. Don't disappear.",
    'The Quiet Storm': "Your patience is your power now. The bloom is still frozen, but the storm is building underneath.",
  },
  'The Torn Silk': {
    'The Rising Phoenix': "Every crack is becoming a story of survival. You're not broken — you're becoming unbreakable.",
    'The Sunset Soul': "You're giving away the pieces you have left. Save something for yourself.",
    'The Inner Voice': "Your wounds are teaching you to listen — to yourself, not to him.",
  },
  'The Inner Voice': {
    'The Golden Rule': "Your intuition is becoming your law. You don't just feel the truth anymore — you enforce it.",
    'The Living Maze': "Your inner voice is getting drowned out by noise. Find the quiet again.",
  },
  'The Silent Venom': {
    'The Savage Grace': "Your quiet power is becoming elegant precision. You don't need venom when you have authority.",
    'The Deep Shadow': "You're retreating into darkness. The venom is turning inward.",
    'The Quiet Storm': "The venom is settling into calm resolve. Still dangerous, but more controlled.",
  },
  'The Sunset Soul': {
    'The Rising Phoenix': "You gave until you were empty — and now you're rising from what's left. This is your comeback.",
    'The Liquid Mirror': "You're fading into whoever he needs. Stop pouring — there's nothing left to give.",
    'The Torn Silk': "You're still giving, but you're learning which pieces are worth saving.",
  },
  'The Deep Shadow': {
    'The Quiet Storm': "You're emerging from the shadow — not into the light, but into controlled power.",
    'The Frozen Bloom': "You're going deeper underground. Come up for air before you forget what sunlight feels like.",
  },
  'The Wild Luxury': {
    'The Savage Grace': "Your wildness is becoming refined power. Still untamed, but impossibly elegant.",
    'The Love Rush': "You're dropping your standards for the thrill. Luxury without boundaries is just chaos.",
  },
  'The Living Maze': {
    'The Inner Voice': "The fog is lifting. You're starting to trust your own direction instead of spiraling.",
    'The Liquid Mirror': "You're lost in the maze AND in him now. Find yourself before trying to find love.",
  },
  'The Golden Rule': {
    'The Golden Rule': "You're not just maintaining your standards — you're elevating them. This is your evolved form.",
    'The Quiet Storm': "Your standards are being tested. The frustration is building. Don't let it erode what you've built.",
  },
  'The Savage Grace': {
    'The Savage Grace': "Already at your most powerful. The grace sharpens with each encounter.",
    'The Silent Venom': "Your grace is curdling into bitterness. Power without grace is just cruelty.",
  },
  'The Quiet Storm': {
    'The Golden Rule': "Your patience is becoming purpose. The storm is settling into unshakable standards.",
    'The Frozen Bloom': "You've been patient too long. The storm froze. Don't mistake numbness for peace.",
  },
  'The Rising Phoenix': {
    'The Rising Phoenix': "Rising even higher. Every fire only makes you more powerful.",
    'The Fire Dance': "The phoenix energy is scattering. Focus the fire before it burns without purpose.",
  },
  'The Liquid Mirror': {
    'The Inner Voice': "You're finally seeing your own reflection instead of his. This is where it changes.",
    'The Sunset Soul': "You're mirroring AND pouring. Two ways to disappear. Choose yourself instead.",
  },
  'default': {
    'default': "Your patterns are shifting. Every analysis brings you closer to who you're becoming.",
  },
};

function getJourneyDescription(from: string, to: string): string {
  if (from === to) {
    const selfDesc = JOURNEY_DESCRIPTIONS[from]?.[from];
    if (selfDesc) return selfDesc;
    return `You're deepening into your ${from} energy. Same core, stronger foundation.`;
  }
  return JOURNEY_DESCRIPTIONS[from]?.[to]
    || JOURNEY_DESCRIPTIONS['default']?.['default']
    || "Your patterns are shifting. Every analysis brings you closer to who you're becoming.";
}

function getTypeMatrixInsight(hisArchetype: string, herArchetype: string): string {
  // Normalize archetype names (remove "The " prefix for matching)
  const normalizeArchetype = (name: string) => {
    // Check if it contains any key archetype names
    const archetypes = ['Player', 'Ghost', 'Sweet Poison', 'Love Bomber', 'Hot & Cold', 'Hot and Cold'];
    for (const arch of archetypes) {
      if (name.toLowerCase().includes(arch.toLowerCase())) {
        if (arch === 'Hot and Cold') return 'The Hot & Cold';
        return `The ${arch}`;
      }
    }
    return name;
  };

  const hisNormalized = normalizeArchetype(hisArchetype);
  const herNormalized = herArchetype;

  const hisInsights = TYPE_MATRIX_INSIGHTS[hisNormalized] || TYPE_MATRIX_INSIGHTS['default'];
  return hisInsights[herNormalized] || hisInsights['default'] || TYPE_MATRIX_INSIGHTS['default']['default'];
}

// ===== Main Fetch Function =====

export async function fetchSoulProfile(): Promise<SoulProfileData | null> {
  // DEV MODE: Return mock data in development
  if (usesMockData()) {
    return {
      dominantArchetype: {
        title: 'The Rising Phoenix',
        tagline: "Built from what broke her",
        description: "She burned down to ashes—and rose even brighter. Every heartbreak became fuel, every betrayal became strength. She didn't just survive, she transformed.",
        traits: ['Resilient', 'Transformed', 'Powerful'],
        imageUrl: getFemaleSoulTypeByName('The Rising Phoenix')?.normalImage || '',
        gradientFrom: '#f97316',
        gradientTo: '#7c2d12',
      },
      patternShock: {
        stat: '4 of 5',
        label: 'relationships',
        insight: 'you gave more than you received',
        percentage: 80,
      },
      stats: {
        totalAnalyses: 12,
        totalRedFlags: 47,
        totalRelationships: 5,
        rarestPattern: {
          name: 'Chaos Addiction',
          percentage: 15,
        },
      },
      typeMatrix: [
        {
          hisArchetype: 'The Sweet Poison',
          hisArchetypeImage: '/openart-image_SeQ6AwE2_1769430650812_raw.png',
          yourArchetype: 'The Rising Phoenix',
          yourArchetypeImage: getFemaleSoulTypeByName('The Rising Phoenix')?.normalImage || '',
          insight: 'You keep going back despite knowing better',
          relationshipCount: 2,
          personNames: ['Alex', 'Marco'],
        },
        {
          hisArchetype: 'The Ghost',
          hisArchetypeImage: '/openart-image_qimyfp0q_1769432612544_raw (1).png',
          yourArchetype: 'The Volcano',
          yourArchetypeImage: '/Screenshot 2026-01-26 230420.png',
          insight: 'You explode from the frustration of silence',
          relationshipCount: 1,
          personNames: ['Luca'],
        },
      ],
      unlockedArchetypes: [
        {
          title: 'The Rising Phoenix',
          imageUrl: getFemaleSoulTypeByName('The Rising Phoenix')?.normalImage || '',
          unlockedAt: '2025-12-01T10:00:00Z',
          personName: 'Alex',
          gradientFrom: '#f97316',
          gradientTo: '#7c2d12',
        },
        {
          title: 'The Volcano',
          imageUrl: '/Screenshot 2026-01-26 230420.png',
          unlockedAt: '2025-11-15T10:00:00Z',
          personName: 'Luca',
          gradientFrom: '#ef4444',
          gradientTo: '#7f1d1d',
        },
      ],
      archetypeRarities: ARCHETYPE_RARITIES,
      powerAcrossRelationships: [
        { personName: 'Alex', personId: 'dev-alex-1', powerBalance: 35, trend: 'losing' },
        { personName: 'Luca', personId: 'dev-luca-1', powerBalance: 55, trend: 'gaining' },
      ],
      averagePowerHeld: 38,
      overallPowerTrend: 'losing',
      archetypeEvolution: [
        { date: '2025-10-01T10:00:00Z', archetype: 'The Echo', personName: 'Marco', imageUrl: '' },
        { date: '2025-11-15T10:00:00Z', archetype: 'The Volcano', personName: 'Luca', imageUrl: '' },
        { date: '2025-12-01T10:00:00Z', archetype: 'The Rising Phoenix', personName: 'Alex', imageUrl: '' },
      ],
      compatibility: buildSoulCompatibility('The Rising Phoenix', [
        {
          hisArchetype: 'The Sweet Poison',
          hisArchetypeImage: '',
          yourArchetype: 'The Rising Phoenix',
          yourArchetypeImage: '',
          insight: '',
          relationshipCount: 2,
          personNames: ['Alex', 'Marco'],
        },
      ]),
      attractedSoulType: {
        archetype: 'The Sweet Poison',
        tagline: getMaleSoulTypeByName('The Sweet Poison')?.tagline || '',
        imageUrl: getMaleSoulTypeByName('The Sweet Poison')?.normalImage || '',
        traits: getMaleSoulTypeByName('The Sweet Poison')?.traits || [],
        frequency: '3 out of 5 guys',
        percentage: 60,
        why: getAttractionReason('The Rising Phoenix', 'The Sweet Poison'),
        totalPersons: 5,
      },
      mistakes: [
        { title: 'Ignoring the red flags', description: "You see them. You feel them. And then you explain them away.", icon: '🚩', frequencyString: '47 red flags across 12 conversations' },
        { title: 'Giving away your power', description: "You hand over control before you even realize it.", icon: '👑', frequencyString: 'In 4 of 5 relationships' },
        { title: 'Chasing the same type', description: "Different name, different face — same pattern.", icon: '🔄', frequencyString: '3 guys with the same energy' },
      ],
      becoming: {
        currentArchetype: 'The Rising Phoenix',
        futureArchetype: 'The Rising Phoenix',
        futureImageUrl: getFemaleSoulTypeByName('The Rising Phoenix')?.normalImage || '',
        futureTagline: getFemaleSoulTypeByName('The Rising Phoenix')?.tagline || '',
        journeyDescription: "Rising even higher. Every fire only makes you more powerful.",
        confidence: 95,
        analysisCount: 12,
      },
      analysisCount: 12,
      hasEnoughData: true,
    };
  }

  // 1. Fetch ALL completed analyses across ALL persons
  const { data: analyses, error } = await supabase
    .from('analysis_results')
    .select('*, persons(id, name, avatar)')
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false });

  if (error || !analyses || analyses.length === 0) {
    return null;
  }

  const analysisIds = analyses.map(a => a.id);
  const totalAnalyses = analyses.length;

  // Get unique persons
  const uniquePersons = new Map<string, string>();
  analyses.forEach(a => {
    if (a.persons) {
      uniquePersons.set(a.person_id, a.persons.name);
    }
  });
  const totalRelationships = uniquePersons.size;

  // 2. Fetch all related data in parallel
  const [archetypesRes, messageInsightsRes, dynamicsRes] = await Promise.all([
    supabase
      .from('analysis_relationship_archetypes')
      .select('*')
      .in('analysis_id', analysisIds),
    supabase
      .from('analysis_message_insights')
      .select('*')
      .in('analysis_id', analysisIds),
    supabase
      .from('analysis_relationship_dynamic')
      .select('*')
      .in('analysis_id', analysisIds),
  ]);

  const allArchetypes = archetypesRes.data || [];
  const allMessageInsights = messageInsightsRes.data || [];
  const allDynamics = dynamicsRes.data || [];

  // 3. Build data sections
  const dominantArchetype = buildDominantArchetype(allArchetypes, analyses);
  const patternShock = buildPatternShock(allDynamics, totalRelationships);
  const stats = buildStats(totalAnalyses, allMessageInsights, totalRelationships);
  const typeMatrix = buildTypeMatrix(allArchetypes, analyses);
  const { unlockedArchetypes, archetypeRarities } = buildArchetypeCollection(allArchetypes, analyses);
  const { powerAcrossRelationships, averagePowerHeld, overallPowerTrend } = buildPowerDynamics(allDynamics, analyses);
  const archetypeEvolution = buildEvolution(allArchetypes, analyses);

  // 4. Build new dynamic sections
  const attractedSoulType = buildAttractedSoulType(allArchetypes, analyses, dominantArchetype.title);
  const compatibility = buildSoulCompatibility(dominantArchetype.title, typeMatrix);

  const mistakeCtx: MistakeContext = {
    averagePowerHeld,
    totalAnalyses,
    totalRedFlags: stats.totalRedFlags,
    totalRelationships,
    dominantArchetype: dominantArchetype.title,
    typeMatrix,
    archetypeEvolution,
    powerAcrossRelationships,
  };
  const mistakes = buildMistakes(mistakeCtx);

  const becoming = buildBecoming(dominantArchetype.title, overallPowerTrend, totalAnalyses);

  return {
    dominantArchetype,
    patternShock,
    stats,
    typeMatrix,
    unlockedArchetypes,
    archetypeRarities,
    powerAcrossRelationships,
    averagePowerHeld,
    overallPowerTrend,
    archetypeEvolution,
    attractedSoulType,
    compatibility,
    mistakes,
    becoming,
    analysisCount: totalAnalyses,
    hasEnoughData: totalAnalyses >= 3,
  };
}

// ===== Section Builders =====

function buildDominantArchetype(archetypes: any[], analyses: any[]): SoulProfileData['dominantArchetype'] {
  // Get user archetypes only
  const userArchetypes = archetypes.filter(a => a.person_type === 'user');

  if (userArchetypes.length === 0) {
    return {
      title: 'Unknown',
      tagline: ARCHETYPE_TAGLINES['default'],
      description: '',
      traits: [],
      imageUrl: '',
      gradientFrom: '#3d2a6b',
      gradientTo: '#1a1233',
    };
  }

  // Count frequency of each archetype title
  const titleCounts: Record<string, { count: number; archetype: any }> = {};
  userArchetypes.forEach(a => {
    const title = a.archetype_title || 'Unknown';
    if (!titleCounts[title]) {
      titleCounts[title] = { count: 0, archetype: a };
    }
    titleCounts[title].count++;
  });

  // Get the most frequent (dominant) archetype
  const sorted = Object.entries(titleCounts).sort((a, b) => b[1].count - a[1].count);
  const dominant = sorted[0][1].archetype;
  const dominantTitle = dominant.archetype_title || 'Unknown';

  return {
    title: dominantTitle,
    tagline: ARCHETYPE_TAGLINES[dominantTitle] || ARCHETYPE_TAGLINES['default'],
    description: dominant.description || '',
    traits: dominant.traits || [],
    imageUrl: dominant.image_url || '',
    gradientFrom: dominant.gradient_from || '#3d2a6b',
    gradientTo: dominant.gradient_to || '#1a1233',
  };
}

function buildPatternShock(dynamics: any[], totalRelationships: number): SoulProfileData['patternShock'] {
  if (dynamics.length === 0 || totalRelationships === 0) {
    return {
      stat: '0 of 0',
      label: 'relationships',
      insight: 'analyze more chats to see your patterns',
      percentage: 0,
    };
  }

  // Count relationships where user has less than 50% power (gave more than received)
  const lowPowerCount = dynamics.filter(d => (100 - d.power_balance) < 50).length;

  // Get unique analyses with low power
  const analysisWithLowPower = new Set(
    dynamics.filter(d => (100 - d.power_balance) < 50).map(d => d.analysis_id)
  );

  // Approximate relationships with energy imbalance
  const imbalanceCount = Math.min(analysisWithLowPower.size, totalRelationships);
  const percentage = totalRelationships > 0 ? Math.round((imbalanceCount / totalRelationships) * 100) : 0;

  // Choose insight based on pattern
  let insight = 'you gave more than you received';
  if (percentage > 80) {
    insight = 'you gave more than you received';
  } else if (percentage > 60) {
    insight = 'you chased unavailable energy';
  } else if (percentage > 40) {
    insight = 'you lost yourself in situationships';
  } else {
    insight = 'you held your power';
  }

  return {
    stat: `${imbalanceCount} of ${totalRelationships}`,
    label: 'relationships',
    insight,
    percentage,
  };
}

function buildStats(totalAnalyses: number, insights: any[], totalRelationships: number): SoulProfileData['stats'] {
  // Count red flags
  const redFlags = insights.filter(i =>
    i.insight_tag?.toUpperCase() === 'RED FLAG'
  ).length;

  // Determine rarest pattern (hardcoded for now based on archetype rarities)
  const rarestPatterns = [
    { name: 'The Crown Energy', percentage: 5 },
    { name: 'Clean Boundaries', percentage: 8 },
    { name: 'Self-Worth First', percentage: 12 },
    { name: 'Chaos Addiction', percentage: 15 },
  ];

  // Pick based on analysis count to create variation
  const patternIndex = totalAnalyses % rarestPatterns.length;
  const rarestPattern = rarestPatterns[patternIndex];

  return {
    totalAnalyses,
    totalRedFlags: redFlags,
    totalRelationships,
    rarestPattern,
  };
}

function buildTypeMatrix(archetypes: any[], analyses: any[]): TypeMatrixEntry[] {
  // Group analyses by person to get his archetype + her archetype pairs
  const personAnalysisMap = new Map<string, any[]>();
  analyses.forEach(a => {
    const personId = a.person_id;
    if (!personAnalysisMap.has(personId)) {
      personAnalysisMap.set(personId, []);
    }
    personAnalysisMap.get(personId)!.push(a);
  });

  // Build pairs: his archetype → her archetype
  const pairCounts: Record<string, {
    hisArchetype: string;
    hisArchetypeImage: string;
    yourArchetype: string;
    yourArchetypeImage: string;
    personNames: Set<string>;
    count: number;
  }> = {};

  personAnalysisMap.forEach((personAnalyses, personId) => {
    // Get the latest analysis for this person
    const latestAnalysis = personAnalyses[0];
    const analysisId = latestAnalysis.id;
    const personName = latestAnalysis.persons?.name || 'Unknown';

    // Find archetypes for this analysis
    const hisArch = archetypes.find(a => a.analysis_id === analysisId && a.person_type === 'person');
    const herArch = archetypes.find(a => a.analysis_id === analysisId && a.person_type === 'user');

    if (hisArch && herArch) {
      const pairKey = `${hisArch.archetype_title}|${herArch.archetype_title}`;

      if (!pairCounts[pairKey]) {
        pairCounts[pairKey] = {
          hisArchetype: hisArch.archetype_title || 'Unknown',
          hisArchetypeImage: hisArch.image_url || '',
          yourArchetype: herArch.archetype_title || 'Unknown',
          yourArchetypeImage: herArch.image_url || '',
          personNames: new Set(),
          count: 0,
        };
      }

      pairCounts[pairKey].personNames.add(personName);
      pairCounts[pairKey].count++;
    }
  });

  // Convert to array and add insights
  const matrix: TypeMatrixEntry[] = Object.values(pairCounts).map(pair => ({
    hisArchetype: pair.hisArchetype,
    hisArchetypeImage: pair.hisArchetypeImage,
    yourArchetype: pair.yourArchetype,
    yourArchetypeImage: pair.yourArchetypeImage,
    insight: getTypeMatrixInsight(pair.hisArchetype, pair.yourArchetype),
    relationshipCount: pair.count,
    personNames: Array.from(pair.personNames),
  }));

  // Sort by relationship count (most common patterns first)
  return matrix.sort((a, b) => b.relationshipCount - a.relationshipCount);
}

function buildArchetypeCollection(archetypes: any[], analyses: any[]): {
  unlockedArchetypes: UnlockedArchetype[];
  archetypeRarities: Record<string, { percentage: number; rarity: 'common' | 'rare' | 'epic' }>;
} {
  // Get user archetypes only
  const userArchetypes = archetypes.filter(a => a.person_type === 'user');

  // Track unique archetypes with their first occurrence
  const archetypeMap = new Map<string, {
    archetype: any;
    firstDate: string;
    personName: string;
  }>();

  // Sort analyses by date ascending to find first occurrence
  const sortedAnalyses = [...analyses].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  sortedAnalyses.forEach(analysis => {
    const userArch = userArchetypes.find(a => a.analysis_id === analysis.id);
    if (userArch && userArch.archetype_title) {
      const title = userArch.archetype_title;
      if (!archetypeMap.has(title)) {
        archetypeMap.set(title, {
          archetype: userArch,
          firstDate: analysis.created_at,
          personName: analysis.persons?.name || 'Unknown',
        });
      }
    }
  });

  const unlockedArchetypes: UnlockedArchetype[] = Array.from(archetypeMap.entries()).map(([title, data]) => ({
    title,
    imageUrl: data.archetype.image_url || '',
    unlockedAt: data.firstDate,
    personName: data.personName,
    gradientFrom: data.archetype.gradient_from || '#3d2a6b',
    gradientTo: data.archetype.gradient_to || '#1a1233',
  }));

  return {
    unlockedArchetypes,
    archetypeRarities: ARCHETYPE_RARITIES,
  };
}

function buildPowerDynamics(dynamics: any[], analyses: any[]): {
  powerAcrossRelationships: PowerRelationship[];
  averagePowerHeld: number;
  overallPowerTrend: 'gaining' | 'losing' | 'stable';
} {
  // Group dynamics by person
  const personDynamicsMap = new Map<string, any[]>();

  dynamics.forEach(d => {
    const analysis = analyses.find(a => a.id === d.analysis_id);
    if (analysis) {
      const personId = analysis.person_id;
      if (!personDynamicsMap.has(personId)) {
        personDynamicsMap.set(personId, []);
      }
      personDynamicsMap.get(personId)!.push({
        ...d,
        date: analysis.created_at,
        personName: analysis.persons?.name || 'Unknown',
      });
    }
  });

  const powerRelationships: PowerRelationship[] = [];
  let totalUserPower = 0;
  let count = 0;

  personDynamicsMap.forEach((personDynamics, personId) => {
    // Sort by date
    const sorted = personDynamics.sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const latest = sorted[sorted.length - 1];
    const first = sorted[0];

    // User power is 100 - power_balance (since power_balance is HIS power)
    const userPower = 100 - latest.power_balance;
    totalUserPower += userPower;
    count++;

    // Determine trend
    let trend: 'gaining' | 'losing' | 'stable' = 'stable';
    if (sorted.length >= 2) {
      const firstUserPower = 100 - first.power_balance;
      const diff = userPower - firstUserPower;
      if (diff > 5) trend = 'gaining';
      else if (diff < -5) trend = 'losing';
    }

    powerRelationships.push({
      personName: latest.personName,
      personId,
      powerBalance: userPower,
      trend,
    });
  });

  // Calculate average and overall trend
  const averagePowerHeld = count > 0 ? Math.round(totalUserPower / count) : 50;

  // Overall trend based on most recent analyses
  let overallTrend: 'gaining' | 'losing' | 'stable' = 'stable';
  const losingCount = powerRelationships.filter(p => p.trend === 'losing').length;
  const gainingCount = powerRelationships.filter(p => p.trend === 'gaining').length;

  if (losingCount > gainingCount && losingCount > powerRelationships.length / 2) {
    overallTrend = 'losing';
  } else if (gainingCount > losingCount && gainingCount > powerRelationships.length / 2) {
    overallTrend = 'gaining';
  }

  return {
    powerAcrossRelationships: powerRelationships,
    averagePowerHeld,
    overallPowerTrend: overallTrend,
  };
}

function buildEvolution(archetypes: any[], analyses: any[]): EvolutionPoint[] {
  // Get user archetypes only
  const userArchetypes = archetypes.filter(a => a.person_type === 'user');

  // Sort analyses chronologically
  const sortedAnalyses = [...analyses].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const evolution: EvolutionPoint[] = [];
  let lastArchetype = '';

  sortedAnalyses.forEach(analysis => {
    const userArch = userArchetypes.find(a => a.analysis_id === analysis.id);
    if (userArch && userArch.archetype_title) {
      const title = userArch.archetype_title;
      // Only add if it's different from the last one (shows actual evolution)
      if (title !== lastArchetype) {
        evolution.push({
          date: analysis.created_at,
          archetype: title,
          personName: analysis.persons?.name || 'Unknown',
          imageUrl: userArch.image_url || '',
        });
        lastArchetype = title;
      }
    }
  });

  return evolution;
}

// ===== New Section Builders =====

function buildAttractedSoulType(
  archetypes: any[],
  analyses: any[],
  dominantArchetype: string,
): AttractedSoulTypeData {
  // Get person (male) archetypes only
  const personArchetypes = archetypes.filter(a => a.person_type === 'person');

  if (personArchetypes.length === 0) {
    return {
      archetype: 'Unknown',
      tagline: '',
      imageUrl: '',
      traits: [],
      frequency: 'No data yet',
      percentage: 0,
      why: 'Analyze more chats to discover your pattern.',
      totalPersons: 0,
    };
  }

  // Count frequency of each male archetype across unique persons
  const personToType = new Map<string, string>();
  analyses.forEach(a => {
    const hisArch = personArchetypes.find(ar => ar.analysis_id === a.id);
    if (hisArch && a.person_id) {
      // Use latest analysis per person (analyses are sorted desc by created_at)
      if (!personToType.has(a.person_id)) {
        personToType.set(a.person_id, hisArch.archetype_title || 'Unknown');
      }
    }
  });

  const typeCounts: Record<string, number> = {};
  personToType.forEach((type) => {
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });

  const totalPersons = personToType.size;
  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const [topType, topCount] = sorted[0];
  const percentage = totalPersons > 0 ? Math.round((topCount / totalPersons) * 100) : 0;

  // Check if all types are different (no pattern)
  const allDifferent = sorted.every(([, count]) => count === 1) && totalPersons > 2;

  // Build frequency string
  let frequency: string;
  if (allDifferent) {
    frequency = 'No clear pattern yet';
  } else if (totalPersons === 1) {
    frequency = 'Based on 1 conversation';
  } else {
    frequency = `${topCount} out of ${totalPersons} guys`;
  }

  // Get Soul Type data for the most attracted type
  const soulTypeData = getMaleSoulTypeByName(topType);

  return {
    archetype: topType,
    tagline: soulTypeData?.tagline || '',
    imageUrl: soulTypeData?.normalImage || '',
    traits: soulTypeData?.traits || [],
    frequency,
    percentage,
    why: allDifferent
      ? "You attract unpredictably — no dominant pattern yet. Keep scanning."
      : getAttractionReason(dominantArchetype, topType),
    totalPersons,
  };
}

function buildMistakes(
  ctx: MistakeContext,
): MistakeEntry[] {
  // Filter templates by satisfied conditions and convert to MistakeEntry
  const matched: MistakeEntry[] = MISTAKE_TEMPLATES
    .filter(t => t.condition(ctx))
    .sort((a, b) => b.priority - a.priority)
    .map(t => ({
      title: t.title,
      description: t.description,
      frequencyString: t.frequencyString(ctx),
      icon: t.icon,
    }));

  // Take top 3
  const top = matched.slice(0, 3);

  // If < 3 conditions matched, fill with archetype-specific fallbacks
  if (top.length < 3) {
    const archetype = ctx.dominantArchetype;

    const ARCHETYPE_MISTAKES: Record<string, MistakeEntry[]> = {
      'The Love Rush': [
        { title: 'Confusing chemistry with compatibility', description: "The spark blinds you to the gaps. Just because it feels electric doesn't mean it's right.", icon: '⚡', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Natural State': [
        { title: 'Tolerating less than you deserve', description: "Your easygoing nature makes you accept behavior that should be a dealbreaker.", icon: '🌿', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Fire Dance': [
        { title: 'Burning bridges to feel alive', description: "You destroy good things because stability feels boring. Chaos isn't passion.", icon: '🔥', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Frozen Bloom': [
        { title: 'Punishing new people for old pain', description: "He's not the one who hurt you. But your walls don't know the difference.", icon: '❄️', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Torn Silk': [
        { title: 'Wearing your wounds as identity', description: "Your scars are part of your story, not the whole story. Don't let pain define you.", icon: '🕊️', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Inner Voice': [
        { title: 'Overanalyzing until you miss the moment', description: "Your intuition is sharp, but sometimes you think so deeply you talk yourself out of good things.", icon: '🔮', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Silent Venom': [
        { title: 'Striking before communicating', description: "You go quiet and deadly when a conversation would have been enough.", icon: '🐍', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Sunset Soul': [
        { title: 'Giving until there\'s nothing left', description: "Your warmth is beautiful, but you pour until you're empty. Save something for yourself.", icon: '🌅', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Deep Shadow': [
        { title: 'Hiding instead of healing', description: "The shadows feel safe, but they're not where growth happens. Step into the light sometimes.", icon: '🌑', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Wild Luxury': [
        { title: 'Confusing attention with affection', description: "Being spoiled isn't the same as being loved. Grand gestures can hide empty hearts.", icon: '💎', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Living Maze': [
        { title: 'Overthinking yourself into paralysis', description: "You spiral until every choice feels wrong. Sometimes the only mistake is not choosing.", icon: '🌀', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Golden Rule': [
        { title: 'Standards so high they become walls', description: "Knowing your worth is power. But perfection isn't a person — don't filter out the real ones.", icon: '✨', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Savage Grace': [
        { title: 'Confusing independence with isolation', description: "You don't need anyone — but wanting someone isn't weakness. Let them in sometimes.", icon: '🐆', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Quiet Storm': [
        { title: 'Bottling until you break', description: "Your patience is a superpower — until it becomes a pressure cooker. Speak before the storm.", icon: '🌊', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Rising Phoenix': [
        { title: 'Using strength as armor', description: "You survived everything. But survival mode isn't the same as living. Let the guard down.", icon: '🔥', frequencyString: `Core pattern of ${archetype}` },
      ],
      'The Liquid Mirror': [
        { title: 'Disappearing into whoever he needs', description: "You become his perfect match by erasing yourself. But who are you when he's not around?", icon: '🪞', frequencyString: `Core pattern of ${archetype}` },
      ],
    };

    const fallbacks = ARCHETYPE_MISTAKES[archetype] || ARCHETYPE_MISTAKES['The Love Rush'] || [];
    for (const fb of fallbacks) {
      if (top.length >= 3) break;
      if (!top.some(t => t.title === fb.title)) {
        top.push(fb);
      }
    }
  }

  return top;
}

function buildBecoming(
  dominantArchetype: string,
  overallPowerTrend: 'gaining' | 'losing' | 'stable',
  analysisCount: number,
): BecomingData {
  // Default to gaining for optimistic first-time experience
  const trend = analysisCount <= 1 ? 'gaining' : overallPowerTrend;

  // Look up future archetype from evolution map
  const evolutionPaths = EVOLUTION_MAP[dominantArchetype];
  let futureArchetype: string;

  if (evolutionPaths) {
    futureArchetype = evolutionPaths[trend] || evolutionPaths['stable'] || dominantArchetype;
  } else {
    // Unknown archetype — use self
    futureArchetype = dominantArchetype;
  }

  // Get future Soul Type data
  const futureData = getFemaleSoulTypeByName(futureArchetype);

  // Calculate confidence (grows with more analyses)
  const confidence = Math.min(95, 50 + (analysisCount * 5));

  // Get journey description
  const journeyDescription = getJourneyDescription(dominantArchetype, futureArchetype);

  return {
    currentArchetype: dominantArchetype,
    futureArchetype,
    futureImageUrl: futureData?.normalImage || '',
    futureTagline: futureData?.tagline || '',
    journeyDescription,
    confidence,
    analysisCount,
  };
}
