import { supabase } from '../lib/supabase';
import { getMaleSoulTypeByName, getFemaleSoulTypeByName } from '../data/soulTypes';

// ===== Interfaces =====

export interface PersonProfileData {
  person: PersonBasicInfo;
  verdict: VerdictData;
  receipts: ReceiptsData;
  pattern: PatternData;
  archetype: ArchetypeData;
  mirror: MirrorData;
  trajectory: TrajectoryData;
  powerMove: PowerMoveData;
  vitalSigns: VitalSignsData;
  hardTruths: HardTruthsData;
}

export type RelationshipStatus = 'talking' | 'situationship' | 'dating' | 'boyfriend' | 'its_complicated' | 'ex' | null;

export const RELATIONSHIP_STATUS_OPTIONS: { value: NonNullable<RelationshipStatus>; label: string; emoji: string }[] = [
  { value: 'talking', label: 'Talking', emoji: '💬' },
  { value: 'situationship', label: 'Situationship', emoji: '🌀' },
  { value: 'dating', label: 'Dating', emoji: '💕' },
  { value: 'boyfriend', label: 'Boyfriend', emoji: '❤️' },
  { value: 'its_complicated', label: "It's Complicated", emoji: '🔥' },
  { value: 'ex', label: 'Ex', emoji: '💔' },
];

export interface PersonBasicInfo {
  id: string;
  name: string;
  avatar: string | null;
  totalAnalyses: number;
  relationshipStatus: RelationshipStatus;
  isArchived: boolean;
}

export interface VerdictData {
  overallScore: number;
  scoreLabel: string;
  warmthScore: number;
  communicationScore: number;
  dramaScore: number;
  distanceScore: number;
  passionScore: number;
  scoreDelta: number;
  totalAnalyses: number;
}

export interface ReceiptMessage {
  messageText: string;
  insightTitle: string;
  insightTag: string;
  tagColor: string;
  description: string;
  solution: string;
}

export interface ReceiptsData {
  messages: ReceiptMessage[];
  hasData: boolean;
}

export interface BehaviorFrequency {
  categoryName: string;
  archetypeName: string;
  frequency: number;
  totalAnalyses: number;
  severityAvg: number;
  topTraits: string[];
}

export interface PatternData {
  behaviors: BehaviorFrequency[];
  hasEnoughData: boolean;
}

export interface ArchetypeData {
  title: string;
  tagline: string;  // Soul Type's predefined tagline (e.g., "Wild at heart, impossible to cage")
  description: string;
  imageUrl: string;
  sideProfileImageUrl: string;  // For "Your Souls Together" card
  traits: string[];
  gradientFrom: string;
  gradientTo: string;
  shareableTagline: string;  // AI-generated snarky tagline
  consistency: { matchCount: number; totalCount: number };
  evolution: string[] | null; // Array of archetype titles over time, null if no change
}

export interface RealityCheckData {
  statement: string;    // "You're giving 100% to someone who gives you 30%"
  shift: string;        // "Your peace is worth more than his attention"
  category: string;     // "energy_imbalance" (for analytics/tracking)
}

export interface MirrorData {
  userArchetypeTitle: string;
  userArchetypeImage: string;
  userArchetypeSideImage: string;
  userArchetypeDescription: string;
  userArchetypeTraits: string[];
  userArchetypeGradientFrom: string;
  userArchetypeGradientTo: string;
  personArchetypeTitle: string;
  personArchetypeImage: string;
  personArchetypeSideImage: string;
  personName: string;
  powerBalance: number;
  powerShiftDirection: 'gaining' | 'losing' | 'stable';
  dynamicName: string;
  dynamicSubtitle: string;
  dynamicGradientFrom: string;
  dynamicGradientTo: string;
  hasEnoughData: boolean;
  realityCheck: RealityCheckData;  // The user's reality check (statement + shift)
  whyThisHappens: string;
  patternBreak: string;
}

export interface TrajectoryPoint {
  date: string;
  score: number;
}

export interface TrajectoryData {
  points: TrajectoryPoint[];
  patternLabel: 'Escalating' | 'Stable' | 'De-escalating';
  percentChange: number;
  hasEnoughData: boolean;
}

export interface PowerMoveData {
  patternBreak: string;
  solutions: string[];
  hasData: boolean;
}

export interface VitalSignsData {
  emotionalAge: number;        // 5-35 (years)
  heLikesYou: number;          // 0-10
  justWantsSex: number;        // 0-10
  ghostRisk: number;           // 0-10
  manipulationLevel: number;   // 0-10
  powerOverYou: number;        // 0-10
}

// ===== Hard Truths Types =====

export interface HardTruthAnswer {
  verdict: string;             // "YES" | "NO" | "UNLIKELY" | "7/10" etc.
  proof: string;               // Data-backed explanation
  verdictColor: string;        // Green/Yellow/Red hex
}

export interface HardTruthCard {
  question: string;            // Dynamic, with {name} interpolated
  answer: HardTruthAnswer;     // Computed verdict + proof
  category: 'archetype' | 'metric' | 'trajectory' | 'universal';
  gradientFrom: string;
  gradientTo: string;
}

export interface HardTruthsData {
  cards: HardTruthCard[];      // 5 dynamically selected cards
}

// ===== Score Label =====

export function getScoreLabel(score: number): string {
  if (score <= 20) return 'Green Flag Energy';
  if (score <= 40) return 'Mostly Chill';
  if (score <= 60) return 'Situationship Chaos';
  if (score <= 80) return 'Toxic AF';
  return 'RUN';
}

export function getScoreColor(score: number): string {
  if (score <= 30) return '#4ade80';
  if (score <= 60) return '#facc15';
  return '#ef4444';
}

// ===== Reality Check Categories =====
// Statement (brutal truth) + Shift (empowerment)

const REALITY_CHECKS: Record<string, RealityCheckData> = {
  energy_imbalance: {
    statement: "You're giving 100% to someone who gives you 30%",
    shift: "Your peace is worth more than his attention.",
    category: 'energy_imbalance',
  },
  chaos_addiction: {
    statement: "You're addicted to the chaos, not the person",
    shift: "Real love feels boring to a nervous system used to drama.",
    category: 'chaos_addiction',
  },
  waiting_game: {
    statement: "You keep waiting for a text that won't change anything",
    shift: "The answer is in the silence.",
    category: 'waiting_game',
  },
  project_not_partner: {
    statement: "You're trying to fix him. But he's not a project",
    shift: "Love shouldn't feel like unpaid labor.",
    category: 'project_not_partner',
  },
  minimum_acceptance: {
    statement: "He's giving you the bare minimum and you're calling it effort",
    shift: "You deserve someone who shows up without being asked.",
    category: 'minimum_acceptance',
  },
  hope_trap: {
    statement: "You stay because of who he could be, not who he is",
    shift: "Potential doesn't pay rent. And neither does he.",
    category: 'hope_trap',
  },
  validation_seeking: {
    statement: "You're looking for your worth in his replies",
    shift: "Your value isn't measured by his attention.",
    category: 'validation_seeking',
  },
  the_chase: {
    statement: "When he's available, you'll lose interest",
    shift: "What you want is the feeling, not the person.",
    category: 'the_chase',
  },
  mirror_mirror: {
    statement: "You see his red flags clearly. Can you see yours?",
    shift: "The patterns you hate in him? They look familiar.",
    category: 'mirror_mirror',
  },
  default: {
    statement: "You're so focused on decoding him that you forgot yourself",
    shift: "Start asking: what do I want?",
    category: 'default',
  },
};

function computeRealityCheck(
  powerBalance: number,
  powerShiftDirection: 'gaining' | 'losing' | 'stable',
  verdict: VerdictData
): RealityCheckData {
  const userPower = 100 - powerBalance;
  const isLosingPower = powerShiftDirection === 'losing';

  // Energy Imbalance (most common): User has low power
  if (userPower < 40) {
    return REALITY_CHECKS.energy_imbalance;
  }

  // Chaos Addiction: High drama score
  if (verdict.dramaScore > 70) {
    return REALITY_CHECKS.chaos_addiction;
  }

  // The Chase: Low power + losing more
  if (userPower < 35 && isLosingPower) {
    return REALITY_CHECKS.the_chase;
  }

  // Project Not Partner: Has power + person is cold
  if (userPower > 60 && verdict.warmthScore < 35) {
    return REALITY_CHECKS.project_not_partner;
  }

  // Waiting Game: Person is distant
  if (verdict.distanceScore > 65) {
    return REALITY_CHECKS.waiting_game;
  }

  // Minimum Acceptance: Low warmth + high distance
  if (verdict.warmthScore < 40 && verdict.distanceScore > 50) {
    return REALITY_CHECKS.minimum_acceptance;
  }

  // Hope Trap: High toxicity but user has some power (stays anyway)
  if (verdict.overallScore > 60 && userPower > 50) {
    return REALITY_CHECKS.hope_trap;
  }

  // Mirror Mirror: Drama + bad communication (similar toxic patterns)
  if (verdict.dramaScore > 50 && verdict.communicationScore < 40) {
    return REALITY_CHECKS.mirror_mirror;
  }

  // Validation Seeking: Very distant person
  if (verdict.distanceScore > 70) {
    return REALITY_CHECKS.validation_seeking;
  }

  // Default: The Invisible (balanced but lost yourself)
  return REALITY_CHECKS.default;
}

// ===== Vital Signs Computation =====

function computeEmotionalAge(verdict: VerdictData): number {
  const maturity = (
    verdict.warmthScore * 0.3 +
    verdict.communicationScore * 0.3 +
    (100 - verdict.dramaScore) * 0.2 +
    (100 - verdict.distanceScore) * 0.2
  ) / 100;
  return Math.round(maturity * 30 + 5); // Range: 5-35
}

function computeHeLikesYou(verdict: VerdictData): number {
  const raw = verdict.warmthScore * 0.4 +
    verdict.passionScore * 0.35 +
    (100 - verdict.distanceScore) * 0.25;
  return Math.round(raw / 10);
}

function computeJustWantsSex(verdict: VerdictData): number {
  const raw = verdict.passionScore * 0.4 +
    verdict.distanceScore * 0.25 +
    (100 - verdict.warmthScore) * 0.2 +
    (100 - verdict.communicationScore) * 0.15;
  return Math.round(raw / 10);
}

function computeGhostRisk(verdict: VerdictData): number {
  const raw = verdict.distanceScore * 0.5 +
    (100 - verdict.warmthScore) * 0.25 +
    (100 - verdict.passionScore) * 0.25;
  return Math.round(raw / 10);
}

function computeManipulationLevel(verdict: VerdictData): number {
  const raw = verdict.dramaScore * 0.6 +
    (100 - verdict.communicationScore) * 0.4;
  return Math.round(raw / 10);
}

function buildVitalSigns(
  verdict: VerdictData,
  mirror: MirrorData
): VitalSignsData {
  return {
    emotionalAge: computeEmotionalAge(verdict),
    heLikesYou: computeHeLikesYou(verdict),
    justWantsSex: computeJustWantsSex(verdict),
    ghostRisk: computeGhostRisk(verdict),
    manipulationLevel: computeManipulationLevel(verdict),
    powerOverYou: Math.round(mirror.powerBalance / 10),
  };
}

// ===== Hard Truths System =====

// Gradient map per question category
const QUESTION_GRADIENTS: Record<string, { from: string; to: string }> = {
  archetype: { from: '#2D1B4E', to: '#1A0F2E' },    // Purple (identity)
  metric: { from: '#4A1A1A', to: '#2D0F0F' },       // Red (danger)
  trajectory: { from: '#1A2F4D', to: '#0F1A2E' },   // Blue (time)
  universal: { from: '#1A3D2E', to: '#0F2E1A' },    // Green (truth)
};

// Helper types for question system
interface QuestionContext {
  name: string;
  verdict: VerdictData;
  vitalSigns: VitalSignsData;
  trajectory: TrajectoryData;
  archetype: ArchetypeData;
  totalAnalyses: number;
}

interface QuestionTemplate {
  question: string;
  category: 'archetype' | 'metric' | 'trajectory' | 'universal';
  priority: number;
  condition?: (ctx: QuestionContext) => boolean;
  computeAnswer: (ctx: QuestionContext) => HardTruthAnswer;
}

// ===== Answer Computation Functions =====

function computeAffectionReality(ctx: QuestionContext): HardTruthAnswer {
  const { warmthScore, passionScore, dramaScore } = ctx.verdict;
  const realAffection = Math.round((warmthScore * 0.5 + passionScore * 0.3) - (dramaScore * 0.2));
  const percentage = Math.max(0, Math.min(100, realAffection));

  if (percentage > 70) {
    return {
      verdict: "YES, BUT...",
      proof: "Real feelings don't erase red flags. He can love you AND be bad for you.",
      verdictColor: '#4ade80',
    };
  }
  if (percentage > 50) {
    return {
      verdict: "IT'S COMPLICATED",
      proof: "The affection is real. The consistency isn't. That's not your fault.",
      verdictColor: '#facc15',
    };
  }
  if (percentage > 30) {
    return {
      verdict: "PERFORMANCE",
      proof: "Love bombers believe their own act. Until they don't need you anymore.",
      verdictColor: '#ef4444',
    };
  }
  return {
    verdict: "THE BARE MINIMUM",
    proof: "He gives just enough to keep you. Not enough to keep you happy.",
    verdictColor: '#ef4444',
  };
}

function computeMaskSlipTime(ctx: QuestionContext): HardTruthAnswer {
  const { dramaScore, distanceScore } = ctx.verdict;
  const instability = (dramaScore + distanceScore) / 2;

  if (instability > 70) {
    return {
      verdict: "ANY DAY NOW",
      proof: "He's already slipping. The cracks are showing. You see them.",
      verdictColor: '#ef4444',
    };
  }
  if (instability > 50) {
    return {
      verdict: "GIVE IT A MONTH",
      proof: "The act takes energy. Energy he's already losing. Watch closely.",
      verdictColor: '#ef4444',
    };
  }
  if (instability > 30) {
    return {
      verdict: "A FEW MONTHS",
      proof: "He's got stamina, but no one keeps a mask on forever.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "HE MIGHT BE REAL",
    proof: "Either this is actually him, or he's a professional. Time will tell.",
    verdictColor: '#4ade80',
  };
}

function computeCommitmentChance(ctx: QuestionContext): HardTruthAnswer {
  const { warmthScore, distanceScore, communicationScore } = ctx.verdict;
  const commitment = Math.round((warmthScore * 0.4 + communicationScore * 0.3 + (100 - distanceScore) * 0.3));

  if (commitment > 70) {
    return {
      verdict: "IF HE WANTS TO",
      proof: "He's capable. Whether he wants YOU specifically? That's the real question.",
      verdictColor: '#4ade80',
    };
  }
  if (commitment > 50) {
    return {
      verdict: "NOT ANYTIME SOON",
      proof: "He likes where he's at. No pressure, no labels, no accountability.",
      verdictColor: '#facc15',
    };
  }
  if (commitment > 30) {
    return {
      verdict: "PROBABLY NOT",
      proof: "You can't convince someone to choose you. And you shouldn't have to.",
      verdictColor: '#ef4444',
    };
  }
  return {
    verdict: "GIRL, NO.",
    proof: "The question isn't can he. It's: why are you still asking?",
    verdictColor: '#ef4444',
  };
}

function computeBackupStatus(ctx: QuestionContext): HardTruthAnswer {
  const { warmthScore, distanceScore, passionScore } = ctx.verdict;
  const backupRisk = Math.round((distanceScore * 0.5 + (100 - warmthScore) * 0.3 + passionScore * 0.2));

  if (backupRisk > 70) {
    return {
      verdict: "PLAN B ENERGY",
      proof: "You're the safety net, not the priority. And you feel it.",
      verdictColor: '#ef4444',
    };
  }
  if (backupRisk > 50) {
    return {
      verdict: "MAYBE",
      proof: "He keeps you close but not too close. Convenient, not committed.",
      verdictColor: '#facc15',
    };
  }
  if (backupRisk > 30) {
    return {
      verdict: "UNCLEAR",
      proof: "He's unsure. Which means you should be sure — about what YOU want.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "YOU'RE HIS FOCUS",
    proof: "He's not juggling options. He's just bad at communicating.",
    verdictColor: '#4ade80',
  };
}

function computeConsistencyChance(ctx: QuestionContext): HardTruthAnswer {
  const { dramaScore, communicationScore } = ctx.verdict;
  const consistency = Math.round(((100 - dramaScore) * 0.6 + communicationScore * 0.4));

  if (consistency > 60) {
    return {
      verdict: "MAYBE",
      proof: "The potential is there. But potential doesn't pay rent.",
      verdictColor: '#4ade80',
    };
  }
  if (consistency > 40) {
    return {
      verdict: "DON'T HOLD YOUR BREATH",
      proof: "He's consistently inconsistent. That IS the pattern.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "NO",
    proof: "Chaos is his comfort zone. You can't love him into stability.",
    verdictColor: '#ef4444',
  };
}

function computeSelfAwareness(ctx: QuestionContext): HardTruthAnswer {
  const { dramaScore, communicationScore, distanceScore } = ctx.verdict;
  const awareness = Math.round((communicationScore * 0.5 + (100 - dramaScore) * 0.3 + (100 - distanceScore) * 0.2));

  if (awareness > 60) {
    return {
      verdict: "KINDA",
      proof: "He knows. He's just not ready to admit it. Or act on it.",
      verdictColor: '#4ade80',
    };
  }
  if (awareness > 40) {
    return {
      verdict: "BARELY",
      proof: "He's figuring himself out. But you're not his therapist.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "ABSOLUTELY NOT",
    proof: "He's lost. And you can't be his GPS and his girlfriend.",
    verdictColor: '#ef4444',
  };
}

function computeExclusivity(ctx: QuestionContext): HardTruthAnswer {
  const { distanceScore, warmthScore, passionScore } = ctx.verdict;
  const exclusivity = Math.round((warmthScore * 0.4 + (100 - distanceScore) * 0.4 + passionScore * 0.2));

  if (exclusivity > 70) {
    return {
      verdict: "PROBABLY",
      proof: "He's focused on you. That doesn't mean he's good for you.",
      verdictColor: '#4ade80',
    };
  }
  if (exclusivity > 50) {
    return {
      verdict: "MAYBE",
      proof: "He's not out there looking. He's also not closing the door.",
      verdictColor: '#facc15',
    };
  }
  if (exclusivity > 30) {
    return {
      verdict: "UNCLEAR",
      proof: "His energy is scattered. That's its own red flag.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "DOUBTFUL",
    proof: "His attention is divided. You deserve to be the main event, not a subplot.",
    verdictColor: '#ef4444',
  };
}

function computePlayerChange(ctx: QuestionContext): HardTruthAnswer {
  const consistency = ctx.archetype.consistency;
  const changeRate = Math.round(100 - (consistency.matchCount / consistency.totalCount) * 100);

  if (changeRate > 40) {
    return {
      verdict: "RARELY",
      proof: "Some do. For the right person. The question: is he doing the work?",
      verdictColor: '#facc15',
    };
  }
  if (changeRate > 20) {
    return {
      verdict: "ALMOST NEVER",
      proof: "Players don't change. They just get tired. That's not the same thing.",
      verdictColor: '#ef4444',
    };
  }
  return {
    verdict: "NOT THIS ONE",
    proof: "He's committed to the game. Not to growth.",
    verdictColor: '#ef4444',
  };
}

function computeIntentionalDrain(ctx: QuestionContext): HardTruthAnswer {
  const { dramaScore, communicationScore, warmthScore } = ctx.verdict;
  const intentional = Math.round((dramaScore * 0.5 + (100 - communicationScore) * 0.3 + (100 - warmthScore) * 0.2));

  if (intentional > 60) {
    return {
      verdict: "YES",
      proof: "The chaos isn't accidental. He needs your energy to survive.",
      verdictColor: '#ef4444',
    };
  }
  if (intentional > 40) {
    return {
      verdict: "PARTIALLY",
      proof: "He might not realize it. But your exhaustion isn't a coincidence.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "NOT REALLY",
    proof: "He's draining, but not intentionally. Doesn't make it okay though.",
    verdictColor: '#4ade80',
  };
}

function computeReciprocity(ctx: QuestionContext): HardTruthAnswer {
  const { warmthScore, communicationScore, passionScore } = ctx.verdict;
  const reciprocity = Math.round((warmthScore * 0.4 + communicationScore * 0.3 + passionScore * 0.3));

  if (reciprocity > 60) {
    return {
      verdict: "MAYBE",
      proof: "He's capable. Just hasn't made it a priority yet.",
      verdictColor: '#facc15',
    };
  }
  if (reciprocity > 40) {
    return {
      verdict: "DON'T COUNT ON IT",
      proof: "He takes what you give. But giving back? That's extra effort he won't spend.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "NO",
    proof: "This is a one-way street. And you've been walking it alone.",
    verdictColor: '#ef4444',
  };
}

function computeGhostTimeline(ctx: QuestionContext): HardTruthAnswer {
  const ghostRisk = ctx.vitalSigns.ghostRisk;

  if (ghostRisk >= 9) {
    return {
      verdict: "ONE FOOT OUT",
      proof: "He's already mentally checked out. The text just hasn't caught up yet.",
      verdictColor: '#ef4444',
    };
  }
  if (ghostRisk >= 7) {
    return {
      verdict: "SOON",
      proof: "The distance is growing. You feel it. Trust that.",
      verdictColor: '#ef4444',
    };
  }
  if (ghostRisk >= 5) {
    return {
      verdict: "NOT YET",
      proof: "He's here for now. But 'for now' is all you're getting.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "LOW RISK",
    proof: "He's not a flight risk. His issues are different.",
    verdictColor: '#4ade80',
  };
}

function computeCheckedOut(ctx: QuestionContext): HardTruthAnswer {
  const { distanceScore, warmthScore, passionScore } = ctx.verdict;
  const checkedOut = Math.round((distanceScore * 0.5 + (100 - warmthScore) * 0.25 + (100 - passionScore) * 0.25));

  if (checkedOut > 70) {
    return {
      verdict: "YES",
      proof: "His body is here. His mind left already. You can feel it.",
      verdictColor: '#ef4444',
    };
  }
  if (checkedOut > 50) {
    return {
      verdict: "HALFWAY",
      proof: "He's drifting. Not gone yet, but not fully here either.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "NOT YET",
    proof: "He's present. Distracted maybe, but not checked out.",
    verdictColor: '#4ade80',
  };
}

function computePlayingYou(ctx: QuestionContext): HardTruthAnswer {
  const manipulation = ctx.vitalSigns.manipulationLevel;

  if (manipulation >= 8) {
    return {
      verdict: "LIKE A VIOLIN",
      proof: "The confusion you feel? That's not love. That's strategy.",
      verdictColor: '#ef4444',
    };
  }
  if (manipulation >= 6) {
    return {
      verdict: "PROBABLY YEAH",
      proof: "The pattern is there. Hot, cold, repeat. It's not mixed signals. It's control.",
      verdictColor: '#ef4444',
    };
  }
  if (manipulation >= 4) {
    return {
      verdict: "MAYBE NOT ON PURPOSE",
      proof: "He's chaotic, not calculating. Still draining though.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "NOT REALLY",
    proof: "He's messy, but not manipulative. Different problem.",
    verdictColor: '#4ade80',
  };
}

function computeAgenda(ctx: QuestionContext): HardTruthAnswer {
  const { passionScore, warmthScore, distanceScore } = ctx.verdict;
  const justPhysical = ctx.vitalSigns.justWantsSex;

  if (justPhysical >= 7) {
    return {
      verdict: "YOUR BODY",
      proof: "He's here for what you can give, not who you are.",
      verdictColor: '#ef4444',
    };
  }
  if (distanceScore > 60 && warmthScore < 40) {
    return {
      verdict: "KEEPING OPTIONS OPEN",
      proof: "He wants the benefits without the commitment. Classic.",
      verdictColor: '#ef4444',
    };
  }
  if (passionScore > warmthScore + 20) {
    return {
      verdict: "FUN ONLY",
      proof: "He's in it for a good time, not a long time. Know the difference.",
      verdictColor: '#ef4444',
    };
  }
  return {
    verdict: "EVEN HE DOESN'T KNOW",
    proof: "He's winging it. Which means you're winging it too.",
    verdictColor: '#facc15',
  };
}

function computeActualLike(ctx: QuestionContext): HardTruthAnswer {
  const heLikesYou = ctx.vitalSigns.heLikesYou;

  if (heLikesYou >= 8) {
    return {
      verdict: "YES HE DOES",
      proof: "He's into you. But liking you doesn't mean he's good for you.",
      verdictColor: '#4ade80',
    };
  }
  if (heLikesYou >= 6) {
    return {
      verdict: "YEAH, MOSTLY",
      proof: "He likes you. He just doesn't know what to do with that.",
      verdictColor: '#4ade80',
    };
  }
  if (heLikesYou >= 4) {
    return {
      verdict: "HE LIKES THE CHASE",
      proof: "There's a difference between wanting you and wanting you available.",
      verdictColor: '#facc15',
    };
  }
  if (heLikesYou >= 2) {
    return {
      verdict: "NOT REALLY",
      proof: "You're convenient, not chosen. You deserve better.",
      verdictColor: '#ef4444',
    };
  }
  return {
    verdict: "GIRL... NO.",
    proof: "The evidence is in. It's time to stop making excuses for him.",
    verdictColor: '#ef4444',
  };
}

function computePassingTime(ctx: QuestionContext): HardTruthAnswer {
  const { warmthScore, distanceScore, communicationScore } = ctx.verdict;
  const passingTime = Math.round((distanceScore * 0.4 + (100 - warmthScore) * 0.3 + (100 - communicationScore) * 0.3));

  if (passingTime > 60) {
    return {
      verdict: "PROBABLY",
      proof: "You're comfortable. Not cherished. There's a difference.",
      verdictColor: '#ef4444',
    };
  }
  if (passingTime > 40) {
    return {
      verdict: "MAYBE",
      proof: "He's not rushing to define things. Ask yourself why.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "NO",
    proof: "He's invested. Just messy about showing it.",
    verdictColor: '#4ade80',
  };
}

function computeBodyOnly(ctx: QuestionContext): HardTruthAnswer {
  const justWantsSex = ctx.vitalSigns.justWantsSex;

  if (justWantsSex >= 8) {
    return {
      verdict: "YOUR BODY",
      proof: "He's here for what you can give, not who you are.",
      verdictColor: '#ef4444',
    };
  }
  if (justWantsSex >= 6) {
    return {
      verdict: "MOSTLY PHYSICAL",
      proof: "Connection fades after the fun. That's your answer.",
      verdictColor: '#ef4444',
    };
  }
  if (justWantsSex >= 4) {
    return {
      verdict: "BOTH, BUT...",
      proof: "He wants both. Just not enough of the non-physical.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "HE SEES YOU",
    proof: "This isn't just physical. His issues are elsewhere.",
    verdictColor: '#4ade80',
  };
}

function computeWalkAway(ctx: QuestionContext): HardTruthAnswer {
  const powerOverYou = ctx.vitalSigns.powerOverYou;

  if (powerOverYou >= 8) {
    return {
      verdict: "NOT EASILY",
      proof: "He has a hold on you. Recognizing that is step one.",
      verdictColor: '#ef4444',
    };
  }
  if (powerOverYou >= 6) {
    return {
      verdict: "IT'LL HURT",
      proof: "You can. It won't be easy. But you'll survive. You always do.",
      verdictColor: '#facc15',
    };
  }
  if (powerOverYou >= 4) {
    return {
      verdict: "YES YOU CAN",
      proof: "You have more power than you think. Use it.",
      verdictColor: '#4ade80',
    };
  }
  return {
    verdict: "EASILY",
    proof: "You're already halfway out. Keep going.",
    verdictColor: '#4ade80',
  };
}

function computeMaturityCheck(ctx: QuestionContext): HardTruthAnswer {
  const emotionalAge = ctx.vitalSigns.emotionalAge;

  if (emotionalAge >= 25) {
    return {
      verdict: "YES",
      proof: "He's got the emotional age to handle this. The question is: does he want to?",
      verdictColor: '#4ade80',
    };
  }
  if (emotionalAge >= 20) {
    return {
      verdict: "BARELY",
      proof: "He's growing. But you're not his practice round.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "NO",
    proof: "He's a boy in a man's body. You deserve someone who's caught up.",
    verdictColor: '#ef4444',
  };
}

function computeEscalationPeak(ctx: QuestionContext): HardTruthAnswer {
  const { percentChange } = ctx.trajectory;
  const { overallScore } = ctx.verdict;

  const projected = Math.min(100, overallScore + Math.abs(percentChange) * 0.5);

  if (projected >= 80) {
    return {
      verdict: "WORSE THAN THIS",
      proof: "He's escalating. And he hasn't hit his peak yet. Get out before he does.",
      verdictColor: '#ef4444',
    };
  }
  if (projected >= 60) {
    return {
      verdict: "BAD",
      proof: "The trend line goes up. That's not a good direction.",
      verdictColor: '#ef4444',
    };
  }
  return {
    verdict: "HARD TO SAY",
    proof: "It could stabilize. It could also get worse. Watch closely.",
    verdictColor: '#facc15',
  };
}

function computeRealSelf(ctx: QuestionContext): HardTruthAnswer {
  const consistency = ctx.archetype.consistency;
  const isConsistent = consistency.matchCount / consistency.totalCount > 0.6;

  if (isConsistent) {
    return {
      verdict: "THIS IS HIM",
      proof: "What you're seeing isn't a phase. It's his default. Believe it.",
      verdictColor: '#ef4444',
    };
  }
  return {
    verdict: "MAYBE",
    proof: "He's still evolving. But you're not obligated to wait for the final version.",
    verdictColor: '#facc15',
  };
}

function computeRealChange(ctx: QuestionContext): HardTruthAnswer {
  const { percentChange } = ctx.trajectory;
  const improving = percentChange < -10;

  if (improving) {
    return {
      verdict: "MAYBE",
      proof: "The trend is positive. But talk is cheap. Watch the actions.",
      verdictColor: '#4ade80',
    };
  }
  return {
    verdict: "UNLIKELY",
    proof: "He talks about changing. He hasn't actually done it.",
    verdictColor: '#facc15',
  };
}

function computeProgressDuration(ctx: QuestionContext): HardTruthAnswer {
  const { percentChange } = ctx.trajectory;
  const sustainable = percentChange < -15 && ctx.totalAnalyses >= 3;

  if (sustainable) {
    return {
      verdict: "POSSIBLY",
      proof: "He's shown consistency. That's rare. Still—stay alert.",
      verdictColor: '#4ade80',
    };
  }
  return {
    verdict: "PROBABLY NOT",
    proof: "Progress without effort dies. And he hasn't been putting in work.",
    verdictColor: '#facc15',
  };
}

function computePermanence(ctx: QuestionContext): HardTruthAnswer {
  const consistency = ctx.archetype.consistency;
  const isStable = ctx.trajectory.patternLabel === 'Stable';
  const isConsistent = consistency.matchCount / consistency.totalCount > 0.7;

  if (isStable && isConsistent) {
    return {
      verdict: "YES",
      proof: "People can change. But he hasn't. And that's data, not pessimism.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "MAYBE NOT",
    proof: "He's shown some variance. But betting on change is a gamble.",
    verdictColor: '#4ade80',
  };
}

function computeAcceptance(ctx: QuestionContext): HardTruthAnswer {
  const { overallScore } = ctx.verdict;

  if (overallScore <= 30) {
    return {
      verdict: "YES — HEALTHY",
      proof: "He's not perfect, but he's not harmful. That's a start.",
      verdictColor: '#4ade80',
    };
  }
  if (overallScore <= 50) {
    return {
      verdict: "IT'S A CHOICE",
      proof: "You can accept him. The question is whether you should.",
      verdictColor: '#facc15',
    };
  }
  if (overallScore <= 70) {
    return {
      verdict: "AT WHAT COST?",
      proof: "Acceptance isn't supposed to hurt this much.",
      verdictColor: '#ef4444',
    };
  }
  return {
    verdict: "DON'T",
    proof: "Some things shouldn't be accepted. His behavior is one of them.",
    verdictColor: '#ef4444',
  };
}

function computeWeakness(ctx: QuestionContext): HardTruthAnswer {
  const { warmthScore, communicationScore, dramaScore, distanceScore, passionScore } = ctx.verdict;

  const metrics = [
    { name: 'EMOTIONAL WALLS', score: warmthScore, proof: "He guards his heart. Problem is, he locks you out too." },
    { name: 'SILENCE', score: communicationScore, proof: "When things get hard, he goes quiet. That's not peace—it's avoidance." },
    { name: 'CHAOS', score: 100 - dramaScore, proof: "Drama follows him. It's not bad luck. It's a pattern." },
    { name: 'DISTANCE', score: 100 - distanceScore, proof: "He's physically there, mentally elsewhere. You notice." },
    { name: 'FLATLINE', score: passionScore, proof: "The spark died. Or maybe it was never really there." },
  ];

  const weakest = metrics.sort((a, b) => a.score - b.score)[0];

  return {
    verdict: weakest.name,
    proof: weakest.proof,
    verdictColor: weakest.score < 40 ? '#ef4444' : '#facc15',
  };
}

function computeFear(ctx: QuestionContext): HardTruthAnswer {
  const { warmthScore, distanceScore, dramaScore, communicationScore } = ctx.verdict;

  if (distanceScore > 60) {
    return {
      verdict: "REAL INTIMACY",
      proof: "He keeps you close enough to stay, far enough to escape.",
      verdictColor: '#facc15',
    };
  }
  if (dramaScore > 60) {
    return {
      verdict: "LOSING CONTROL",
      proof: "Chaos is his comfort. Stability scares him.",
      verdictColor: '#facc15',
    };
  }
  if (warmthScore < 40 && communicationScore < 40) {
    return {
      verdict: "VULNERABILITY",
      proof: "He'd rather be cold than risk being hurt.",
      verdictColor: '#facc15',
    };
  }
  return {
    verdict: "BEING TRULY KNOWN",
    proof: "He shows you pieces, never the whole picture. That's intentional.",
    verdictColor: '#facc15',
  };
}

function computeBrutalTruth(ctx: QuestionContext): HardTruthAnswer {
  const { overallScore, dramaScore, distanceScore, warmthScore } = ctx.verdict;
  const ghostRisk = ctx.vitalSigns.ghostRisk;
  const manipulation = ctx.vitalSigns.manipulationLevel;

  if (overallScore > 75) {
    return {
      verdict: "HE'S NOT GOOD FOR YOU",
      proof: "Not maybe. Not sometimes. Period. The data doesn't lie, even when he does.",
      verdictColor: '#ef4444',
    };
  }
  if (manipulation >= 7) {
    return {
      verdict: "HE KNOWS EXACTLY WHAT HE'S DOING",
      proof: "Stop giving him the benefit of the doubt. He doesn't give you the same.",
      verdictColor: '#ef4444',
    };
  }
  if (ghostRisk >= 8) {
    return {
      verdict: "HE'S ALREADY LEAVING",
      proof: "You can fight for this. But you'd be fighting alone.",
      verdictColor: '#ef4444',
    };
  }
  if (distanceScore > 60 && warmthScore < 40) {
    return {
      verdict: "YOU'RE MORE INTO HIM",
      proof: "The imbalance isn't going away. And you deserve equal energy.",
      verdictColor: '#ef4444',
    };
  }
  if (dramaScore > 60) {
    return {
      verdict: "THE CHAOS IS THE POINT",
      proof: "It's not a bug, it's a feature. He runs on drama. You can't fix that.",
      verdictColor: '#facc15',
    };
  }
  if (overallScore <= 30) {
    return {
      verdict: "THIS ONE MIGHT BE OKAY",
      proof: "Low toxicity. Proceed with caution, but there's hope here.",
      verdictColor: '#4ade80',
    };
  }
  return {
    verdict: "TRUST YOUR GUT",
    proof: "That feeling you can't shake? It's there for a reason.",
    verdictColor: '#facc15',
  };
}

// ===== Question Templates =====

function getArchetypeQuestions(archetypeTitle: string): QuestionTemplate[] {
  const titleLower = archetypeTitle.toLowerCase();

  if (titleLower.includes('love bomb') || titleLower.includes('lovebomb')) {
    return [
      { question: "Is {name}'s affection real?", category: 'archetype', priority: 10, computeAnswer: computeAffectionReality },
      { question: "When will the mask slip?", category: 'archetype', priority: 9, computeAnswer: computeMaskSlipTime },
    ];
  }
  if (titleLower.includes('ghost') || titleLower.includes('avoidant')) {
    return [
      { question: "Will {name} ever commit?", category: 'archetype', priority: 10, computeAnswer: computeCommitmentChance },
      { question: "Is he keeping you as a backup?", category: 'archetype', priority: 9, computeAnswer: computeBackupStatus },
    ];
  }
  if (titleLower.includes('hot') && titleLower.includes('cold')) {
    return [
      { question: "Will he ever be consistent?", category: 'archetype', priority: 10, computeAnswer: computeConsistencyChance },
      { question: "Does he even know what he wants?", category: 'archetype', priority: 9, computeAnswer: computeSelfAwareness },
    ];
  }
  if (titleLower.includes('player') || titleLower.includes('casanova')) {
    return [
      { question: "Are you the only one?", category: 'archetype', priority: 10, computeAnswer: computeExclusivity },
      { question: "Can a player ever change?", category: 'archetype', priority: 9, computeAnswer: computePlayerChange },
    ];
  }
  if (titleLower.includes('vampire') || titleLower.includes('narciss') || titleLower.includes('toxic')) {
    return [
      { question: "Is he draining you on purpose?", category: 'archetype', priority: 10, computeAnswer: computeIntentionalDrain },
      { question: "Will he ever give back?", category: 'archetype', priority: 9, computeAnswer: computeReciprocity },
    ];
  }

  // Default questions for unknown archetypes
  return [
    { question: "What's {name} really like?", category: 'archetype', priority: 8, computeAnswer: computeWeakness },
    { question: "Can you trust {name}?", category: 'archetype', priority: 7, computeAnswer: computeCommitmentChance },
  ];
}

function getMetricQuestions(ctx: QuestionContext): QuestionTemplate[] {
  const questions: QuestionTemplate[] = [];
  const vs = ctx.vitalSigns;

  if (vs.ghostRisk >= 7) {
    questions.push({ question: "How long before he disappears?", category: 'metric', priority: 8, computeAnswer: computeGhostTimeline });
    questions.push({ question: "Is he already mentally checked out?", category: 'metric', priority: 7, computeAnswer: computeCheckedOut });
  }
  if (vs.manipulationLevel >= 7) {
    questions.push({ question: "Is {name} playing you?", category: 'metric', priority: 8, computeAnswer: computePlayingYou });
    questions.push({ question: "What's his real agenda?", category: 'metric', priority: 7, computeAnswer: computeAgenda });
  }
  if (vs.heLikesYou <= 4) {
    questions.push({ question: "Does he actually like you?", category: 'metric', priority: 8, computeAnswer: computeActualLike });
    questions.push({ question: "Is he just passing time?", category: 'metric', priority: 7, computeAnswer: computePassingTime });
  }
  if (vs.justWantsSex >= 7) {
    questions.push({ question: "Is he here for you or your body?", category: 'metric', priority: 8, computeAnswer: computeBodyOnly });
  }
  if (vs.powerOverYou >= 7) {
    questions.push({ question: "Can you walk away?", category: 'metric', priority: 8, computeAnswer: computeWalkAway });
  }
  if (vs.emotionalAge <= 15) {
    questions.push({ question: "Is he mature enough?", category: 'metric', priority: 7, computeAnswer: computeMaturityCheck });
  }

  return questions;
}

function getTrajectoryQuestions(trajectory: TrajectoryData): QuestionTemplate[] {
  if (trajectory.patternLabel === 'Escalating') {
    return [
      { question: "How bad will it get?", category: 'trajectory', priority: 7, computeAnswer: computeEscalationPeak },
      { question: "Is this the real {name} emerging?", category: 'trajectory', priority: 6, computeAnswer: computeRealSelf },
    ];
  }
  if (trajectory.patternLabel === 'De-escalating') {
    return [
      { question: "Is he really changing?", category: 'trajectory', priority: 7, computeAnswer: computeRealChange },
      { question: "Will this progress last?", category: 'trajectory', priority: 6, computeAnswer: computeProgressDuration },
    ];
  }
  // Stable
  return [
    { question: "Is this who he'll always be?", category: 'trajectory', priority: 7, computeAnswer: computePermanence },
    { question: "Can you accept {name} as he is?", category: 'trajectory', priority: 6, computeAnswer: computeAcceptance },
  ];
}

const UNIVERSAL_QUESTIONS: QuestionTemplate[] = [
  { question: "What's {name}'s biggest weakness?", category: 'universal', priority: 5, computeAnswer: computeWeakness },
  { question: "What does he fear most?", category: 'universal', priority: 5, computeAnswer: computeFear },
  { question: "The one thing you need to accept", category: 'universal', priority: 5, computeAnswer: computeBrutalTruth },
];

// ===== Selection Algorithm =====

function selectHardTruths(ctx: QuestionContext): HardTruthCard[] {
  const pool: QuestionTemplate[] = [];

  // 1. Add archetype-specific questions
  pool.push(...getArchetypeQuestions(ctx.archetype.title));

  // 2. Add metric-triggered questions
  pool.push(...getMetricQuestions(ctx));

  // 3. Add trajectory questions
  pool.push(...getTrajectoryQuestions(ctx.trajectory));

  // 4. Add universal questions
  pool.push(...UNIVERSAL_QUESTIONS);

  // 5. Sort by priority and select with category diversity
  pool.sort((a, b) => b.priority - a.priority);

  const selected: HardTruthCard[] = [];
  const categoryCounts: Record<string, number> = { archetype: 0, metric: 0, trajectory: 0, universal: 0 };

  for (const q of pool) {
    if (selected.length >= 5) break;
    if (categoryCounts[q.category] < 2) { // Max 2 per category
      const answer = q.computeAnswer(ctx);
      const gradients = QUESTION_GRADIENTS[q.category];

      selected.push({
        question: q.question.replace('{name}', ctx.name),
        answer,
        category: q.category,
        gradientFrom: gradients.from,
        gradientTo: gradients.to,
      });

      categoryCounts[q.category]++;
    }
  }

  // Fill remaining slots with universal questions if needed
  while (selected.length < 5 && UNIVERSAL_QUESTIONS.length > 0) {
    const remaining = UNIVERSAL_QUESTIONS.filter(q =>
      !selected.some(s => s.question === q.question.replace('{name}', ctx.name))
    );
    if (remaining.length === 0) break;

    const q = remaining[0];
    const answer = q.computeAnswer(ctx);
    const gradients = QUESTION_GRADIENTS[q.category];

    selected.push({
      question: q.question.replace('{name}', ctx.name),
      answer,
      category: q.category,
      gradientFrom: gradients.from,
      gradientTo: gradients.to,
    });
  }

  return selected;
}

function buildHardTruths(
  person: PersonBasicInfo,
  verdict: VerdictData,
  vitalSigns: VitalSignsData,
  trajectory: TrajectoryData,
  archetype: ArchetypeData
): HardTruthsData {
  const ctx: QuestionContext = {
    name: person.name,
    verdict,
    vitalSigns,
    trajectory,
    archetype,
    totalAnalyses: person.totalAnalyses,
  };

  const cards = selectHardTruths(ctx);
  return { cards };
}

// ===== Main Fetch Function =====

export async function fetchPersonProfile(personId: string): Promise<PersonProfileData | null> {
  // DEV MODE: Return mock data in development
  const isDev = import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || new URLSearchParams(window.location.search).has('sid');

  if (isDev) {
    return {
      person: applyPersonOverrides(personId, {
        id: personId,
        name: 'Alex',
        avatar: null,
        totalAnalyses: 45,
        relationshipStatus: null,
        isArchived: false,
      }),
      verdict: {
        overallScore: 70,
        scoreLabel: 'Toxic AF',
        warmthScore: 35,
        communicationScore: 25,
        dramaScore: 75,
        distanceScore: 60,
        passionScore: 80,
        scoreDelta: 5,
        totalAnalyses: 45,
      },
      receipts: {
        messages: [
          {
            messageText: "I'll text you later babe",
            insightTitle: "Empty Promise Pattern",
            insightTag: "RED FLAG",
            tagColor: "#ef4444",
            description: "He says 'later' but means 'when convenient'. Classic breadcrumbing.",
            solution: "Stop waiting. If he wanted to, he would.",
          },
          {
            messageText: "You're overreacting",
            insightTitle: "Gaslighting Alert",
            insightTag: "RED FLAG",
            tagColor: "#E53935",
            description: "Dismissing your feelings is manipulation 101.",
            solution: "Your feelings are valid. Trust them.",
          },
          {
            messageText: "I'm not like other guys",
            insightTitle: "The Classic Line",
            insightTag: "RED FLAG",
            tagColor: "#E53935",
            description: "Spoiler: he's exactly like other guys.",
            solution: "Judge by actions, not words.",
          },
        ],
        hasData: true,
      },
      pattern: {
        behaviors: [
          {
            categoryName: "Communication",
            archetypeName: "The Ghost",
            frequency: 8,
            totalAnalyses: 45,
            severityAvg: 7.5,
            topTraits: ["Disappears randomly", "Short responses", "Avoids deep talks"],
          },
          {
            categoryName: "Emotional Investment",
            archetypeName: "The Breadcrumber",
            frequency: 6,
            totalAnalyses: 45,
            severityAvg: 6.2,
            topTraits: ["Hot and cold", "Mixed signals", "Keeps you guessing"],
          },
        ],
        hasEnoughData: true,
      },
      archetype: {
        title: "The Ice Charmer",
        tagline: "His walls have walls",
        description: "He's physically present but emotionally checked out. Deep conversations feel like pulling teeth.",
        imageUrl: getMaleSoulTypeByName('The Ice Charmer')?.normalImage || '',
        sideProfileImageUrl: getMaleSoulTypeByName('The Ice Charmer')?.sideProfileImage || '',
        traits: ["Dismissive", "Defensive", "Insincere"],
        gradientFrom: "#3b82f6",
        gradientTo: "#1e3a5f",
        shareableTagline: "Sweet words, slow poison",
        consistency: { matchCount: 38, totalCount: 45 },
        evolution: null,
      },
      mirror: {
        userArchetypeTitle: "The Love Rush",
        userArchetypeImage: getFemaleSoulTypeByName('The Love Rush')?.normalImage || '',
        userArchetypeSideImage: getFemaleSoulTypeByName('The Love Rush')?.sideProfileImage || '',
        userArchetypeDescription: "You're drawn to intensity and chaos.",
        userArchetypeTraits: ["Intensity seeker", "Chaos familiar"],
        userArchetypeGradientFrom: "#a78bfa",
        userArchetypeGradientTo: "#4c1d95",
        personArchetypeTitle: "The Ice Charmer",
        personArchetypeImage: getMaleSoulTypeByName('The Ice Charmer')?.normalImage || '',
        personArchetypeSideImage: getMaleSoulTypeByName('The Ice Charmer')?.sideProfileImage || '',
        personName: "Alex",
        powerBalance: 65,
        powerShiftDirection: "losing",
        dynamicName: "Toxic Magnetism",
        dynamicSubtitle: "You're drawn to what hurts you",
        dynamicGradientFrom: "#1e3a5f",
        dynamicGradientTo: "#0f1a2e",
        hasEnoughData: true,
        realityCheck: {
          statement: "You're giving 100% to someone who gives you 30%",
          shift: "Your peace is worth more than his attention.",
          category: "energy_imbalance",
        },
        whyThisHappens: "You're drawn to intensity because calm feels boring to your nervous system. He feeds on attention and you give it freely — creating a cycle neither of you can break alone.",
        patternBreak: "Stop initiating for one full week. Watch who he becomes when the chase stops. That's the real him.",
      },
      trajectory: {
        points: [
          { date: "2025-10-01", score: 55 },
          { date: "2025-11-01", score: 62 },
          { date: "2025-12-01", score: 68 },
          { date: "2026-01-01", score: 70 },
        ],
        patternLabel: "Escalating",
        percentChange: 27,
        hasEnoughData: true,
      },
      powerMove: {
        patternBreak: "Stop initiating conversations for one week. See who he becomes when you're not carrying the relationship.",
        solutions: [
          "Match his energy exactly for 48 hours",
          "Stop explaining yourself when he doesn't ask",
          "Make plans that don't include him",
        ],
        hasData: true,
      },
      vitalSigns: {
        emotionalAge: 16,
        heLikesYou: 5,
        justWantsSex: 7,
        ghostRisk: 8,
        manipulationLevel: 6,
        powerOverYou: 7,
      },
      hardTruths: {
        cards: [
          {
            question: "Does Alex actually like you?",
            answer: {
              verdict: "HE LIKES THE CHASE",
              proof: "There's a difference between wanting you and wanting you available.",
              verdictColor: "#facc15",
            },
            category: "metric",
            gradientFrom: "#4A1A1A",
            gradientTo: "#2D0F0F",
          },
          {
            question: "Will he ever commit?",
            answer: {
              verdict: "NOT ANYTIME SOON",
              proof: "He likes where he's at. No pressure, no labels, no accountability.",
              verdictColor: "#facc15",
            },
            category: "archetype",
            gradientFrom: "#2D1B4E",
            gradientTo: "#1A0F2E",
          },
          {
            question: "How bad will it get?",
            answer: {
              verdict: "WORSE THAN THIS",
              proof: "He's escalating. And he hasn't hit his peak yet. Get out before he does.",
              verdictColor: "#ef4444",
            },
            category: "trajectory",
            gradientFrom: "#1A2F4D",
            gradientTo: "#0F1A2E",
          },
          {
            question: "What's Alex's biggest weakness?",
            answer: {
              verdict: "EMOTIONAL WALLS",
              proof: "He guards his heart. Problem is, he locks you out too.",
              verdictColor: "#ef4444",
            },
            category: "universal",
            gradientFrom: "#1A3D2E",
            gradientTo: "#0F2E1A",
          },
          {
            question: "Can you walk away?",
            answer: {
              verdict: "IT'LL HURT",
              proof: "You can. It won't be easy. But you'll survive. You always do.",
              verdictColor: "#facc15",
            },
            category: "metric",
            gradientFrom: "#4A1A1A",
            gradientTo: "#2D0F0F",
          },
        ],
      },
    };
  }

  // 1. Fetch person basic info
  const { data: person } = await supabase
    .from('persons')
    .select('id, name, avatar, relationship_status, is_archived')
    .eq('id', personId)
    .single();

  if (!person) return null;

  // 2. Fetch ALL completed analyses for this person
  const { data: analyses } = await supabase
    .from('analysis_results')
    .select('*')
    .eq('person_id', personId)
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false });

  if (!analyses || analyses.length === 0) return null;

  const analysisIds = analyses.map(a => a.id);
  const totalAnalyses = analyses.length;

  // 3. Fetch all related data in parallel
  const [archetypesRes, emotionalProfilesRes, messageInsightsRes, dynamicsRes] = await Promise.all([
    supabase
      .from('analysis_relationship_archetypes')
      .select('*')
      .in('analysis_id', analysisIds),
    supabase
      .from('analysis_emotional_profiles')
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
  const allEmotionalProfiles = emotionalProfilesRes.data || [];
  const allMessageInsights = messageInsightsRes.data || [];
  const allDynamics = dynamicsRes.data || [];

  // 4. Build each section
  const verdict = buildVerdict(analyses);
  const receipts = buildReceipts(allMessageInsights);
  const pattern = buildPattern(allEmotionalProfiles, totalAnalyses);
  const archetype = buildArchetype(allArchetypes, analyses, totalAnalyses);
  const mirror = buildMirror(allArchetypes, allDynamics, analyses, person.name, verdict);
  const trajectory = buildTrajectory(analyses);
  const powerMove = buildPowerMove(allDynamics, allMessageInsights);
  const vitalSigns = buildVitalSigns(verdict, mirror);

  const personInfo: PersonBasicInfo = {
    id: person.id,
    name: person.name,
    avatar: person.avatar || null,
    totalAnalyses,
    relationshipStatus: person.relationship_status || null,
    isArchived: person.is_archived || false,
  };

  const hardTruths = buildHardTruths(personInfo, verdict, vitalSigns, trajectory, archetype);

  return {
    person: personInfo,
    verdict,
    receipts,
    pattern,
    archetype,
    mirror,
    trajectory,
    powerMove,
    vitalSigns,
    hardTruths,
  };
}

// ===== Section Builders =====

function buildVerdict(analyses: any[]): VerdictData {
  const latest = analyses[0];
  const previous = analyses.length > 1 ? analyses[1] : null;

  return {
    overallScore: latest.overall_score,
    scoreLabel: getScoreLabel(latest.overall_score),
    warmthScore: latest.warmth_score || 0,
    communicationScore: latest.communication_score || 0,
    dramaScore: latest.drama_score || 0,
    distanceScore: latest.distance_score || 0,
    passionScore: latest.passion_score || 0,
    scoreDelta: previous ? latest.overall_score - previous.overall_score : 0,
    totalAnalyses: analyses.length,
  };
}

function buildReceipts(insights: any[]): ReceiptsData {
  if (!insights || insights.length === 0) {
    return { messages: [], hasData: false };
  }

  // Sort by severity: RED FLAG > GREEN FLAG
  const tagPriority: Record<string, number> = {
    'RED FLAG': 2,
    'GREEN FLAG': 1,
  };

  const sorted = [...insights].sort((a, b) => {
    const aPriority = tagPriority[a.insight_tag?.toUpperCase()] ?? 1;
    const bPriority = tagPriority[b.insight_tag?.toUpperCase()] ?? 1;
    return bPriority - aPriority;
  });

  const messages: ReceiptMessage[] = sorted.slice(0, 5).map(i => ({
    messageText: i.message_text,
    insightTitle: i.insight_title,
    insightTag: i.insight_tag || 'RED FLAG',
    tagColor: i.tag_color || '#E53935',
    description: i.description || '',
    solution: i.solution || '',
  }));

  return { messages, hasData: true };
}

function buildPattern(profiles: any[], totalAnalyses: number): PatternData {
  if (!profiles || profiles.length === 0) {
    return { behaviors: [], hasEnoughData: false };
  }

  // Group by category_name
  const categoryMap: Record<string, {
    archetypes: string[];
    severities: number[];
    allTraits: string[];
  }> = {};

  profiles.forEach(p => {
    const cat = p.category_name;
    if (!categoryMap[cat]) {
      categoryMap[cat] = { archetypes: [], severities: [], allTraits: [] };
    }
    categoryMap[cat].archetypes.push(p.archetype_name);
    if (p.severity != null) categoryMap[cat].severities.push(p.severity);
    if (p.selected_traits && Array.isArray(p.selected_traits)) {
      categoryMap[cat].allTraits.push(...p.selected_traits);
    }
  });

  const behaviors: BehaviorFrequency[] = Object.entries(categoryMap)
    .map(([cat, data]) => {
      // Count unique analyses that had this category
      const frequency = new Set(
        profiles
          .filter(p => p.category_name === cat)
          .map(p => p.analysis_id)
      ).size;

      const sevAvg = data.severities.length > 0
        ? data.severities.reduce((a, b) => a + b, 0) / data.severities.length
        : 0;

      // Get top 3 most common traits
      const traitCounts: Record<string, number> = {};
      data.allTraits.forEach(t => { traitCounts[t] = (traitCounts[t] || 0) + 1; });
      const topTraits = Object.entries(traitCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([trait]) => trait);

      // Most common archetype name for this category
      const archCounts: Record<string, number> = {};
      data.archetypes.forEach(a => { archCounts[a] = (archCounts[a] || 0) + 1; });
      const dominantArch = Object.entries(archCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || cat;

      return {
        categoryName: cat,
        archetypeName: dominantArch,
        frequency,
        totalAnalyses,
        severityAvg: sevAvg,
        topTraits,
      };
    })
    .sort((a, b) => b.severityAvg - a.severityAvg);

  return { behaviors, hasEnoughData: totalAnalyses >= 2 };
}

function buildArchetype(archetypes: any[], analyses: any[], totalAnalyses: number): ArchetypeData {
  const personArchetypes = archetypes.filter(a => a.person_type === 'person');
  const latestAnalysisId = analyses[0].id;
  const latest = personArchetypes.find(a => a.analysis_id === latestAnalysisId);

  // Count archetype title frequency for consistency
  const titleCounts: Record<string, number> = {};
  personArchetypes.forEach(a => {
    if (a.archetype_title) {
      titleCounts[a.archetype_title] = (titleCounts[a.archetype_title] || 0) + 1;
    }
  });

  const dominantTitle = Object.entries(titleCounts)
    .sort((a, b) => b[1] - a[1])[0];

  // Build evolution (chronological order of archetype titles)
  let evolution: string[] | null = null;
  if (totalAnalyses >= 2) {
    const chronological = analyses
      .slice()
      .reverse()
      .map(a => {
        const arch = personArchetypes.find(pa => pa.analysis_id === a.id);
        return arch?.archetype_title || null;
      })
      .filter(Boolean) as string[];

    // Only show evolution if there's actually a change
    const uniqueTitles = [...new Set(chronological)];
    if (uniqueTitles.length > 1) {
      evolution = chronological;
    }
  }

  return {
    title: latest?.archetype_title || 'Unknown',
    description: latest?.description || '',
    imageUrl: latest?.image_url || '',
    traits: latest?.traits || [],
    gradientFrom: latest?.gradient_from || '#1a1a2e',
    gradientTo: latest?.gradient_to || '#0f0f1a',
    consistency: {
      matchCount: dominantTitle?.[1] || 1,
      totalCount: totalAnalyses,
    },
    evolution,
  };
}

function buildMirror(archetypes: any[], dynamics: any[], analyses: any[], personName: string, verdict: VerdictData): MirrorData {
  const userArchetypes = archetypes.filter(a => a.person_type === 'user');
  const personArchetypes = archetypes.filter(a => a.person_type === 'person');
  const latestAnalysisId = analyses[0].id;
  const latestUserArch = userArchetypes.find(a => a.analysis_id === latestAnalysisId);
  const latestPersonArch = personArchetypes.find(a => a.analysis_id === latestAnalysisId);
  const latestDynamic = dynamics.find(d => d.analysis_id === latestAnalysisId);

  // Power shift direction
  let powerShiftDirection: 'gaining' | 'losing' | 'stable' = 'stable';
  if (analyses.length >= 2 && dynamics.length >= 2) {
    const chronoDynamics = analyses
      .slice()
      .reverse()
      .map(a => dynamics.find(d => d.analysis_id === a.id))
      .filter(Boolean);

    if (chronoDynamics.length >= 2) {
      const first = chronoDynamics[0]?.power_balance ?? 50;
      const last = chronoDynamics[chronoDynamics.length - 1]?.power_balance ?? 50;
      if (last - first > 5) powerShiftDirection = 'gaining';
      else if (first - last > 5) powerShiftDirection = 'losing';
    }
  }

  const powerBalance = latestDynamic?.power_balance ?? 50;

  // Compute blind spot based on power dynamics and verdict
  const realityCheck = computeRealityCheck(powerBalance, powerShiftDirection, verdict);

  // Derive side profile images from Soul Type title lookup
  const userSideImage = getFemaleSoulTypeByName(latestUserArch?.archetype_title || '')?.sideProfileImage || '';
  const personSideImage = getMaleSoulTypeByName(latestPersonArch?.archetype_title || '')?.sideProfileImage || '';

  return {
    userArchetypeTitle: latestUserArch?.archetype_title || 'Unknown',
    userArchetypeImage: latestUserArch?.image_url || '',
    userArchetypeSideImage: userSideImage,
    userArchetypeDescription: latestUserArch?.description || '',
    userArchetypeTraits: latestUserArch?.traits || [],
    userArchetypeGradientFrom: latestUserArch?.gradient_from || '#3d2a6b',
    userArchetypeGradientTo: latestUserArch?.gradient_to || '#1a1233',
    personArchetypeTitle: latestPersonArch?.archetype_title || 'Unknown',
    personArchetypeImage: latestPersonArch?.image_url || '',
    personArchetypeSideImage: personSideImage,
    personName,
    powerBalance,
    powerShiftDirection,
    dynamicName: latestDynamic?.name || '',
    dynamicSubtitle: latestDynamic?.subtitle || '',
    dynamicGradientFrom: latestDynamic?.gradient_start || '#1a1a2e',
    dynamicGradientTo: latestDynamic?.gradient_end || '#0f0f1a',
    hasEnoughData: dynamics.length > 0,
    realityCheck,
    whyThisHappens: latestDynamic?.why_this_happens || '',
    patternBreak: latestDynamic?.pattern_break || '',
  };
}

function buildTrajectory(analyses: any[]): TrajectoryData {
  const points: TrajectoryPoint[] = analyses
    .slice()
    .reverse()
    .map(a => ({
      date: a.created_at,
      score: a.overall_score,
    }));

  let patternLabel: 'Escalating' | 'Stable' | 'De-escalating' = 'Stable';
  let percentChange = 0;

  if (points.length >= 2) {
    const first = points[0].score;
    const last = points[points.length - 1].score;
    const diff = last - first;
    percentChange = first > 0 ? Math.round((diff / first) * 100) : 0;

    if (diff > 10) patternLabel = 'Escalating';
    else if (diff < -10) patternLabel = 'De-escalating';
  }

  return {
    points,
    patternLabel,
    percentChange,
    hasEnoughData: analyses.length >= 2,
  };
}

function buildPowerMove(dynamics: any[], insights: any[]): PowerMoveData {
  // Get pattern_break from the latest dynamic
  const latestDynamic = dynamics[0];
  const patternBreak = latestDynamic?.pattern_break || '';

  // Get unique solutions from message insights
  const solutions = insights
    .filter(i => i.solution && i.solution.trim())
    .map(i => i.solution)
    .filter((s, i, arr) => arr.indexOf(s) === i) // unique
    .slice(0, 3);

  return {
    patternBreak,
    solutions,
    hasData: !!patternBreak || solutions.length > 0,
  };
}

// ===== DEV MODE: LocalStorage Persistence for Person Overrides =====

const PERSON_OVERRIDES_KEY = 'toxicornah_person_overrides';
const DELETED_PERSONS_KEY = 'toxicornah_deleted_persons';

interface PersonOverrides {
  name?: string;
  avatar?: string | null;
  relationshipStatus?: RelationshipStatus;
  isArchived?: boolean;
}

function getPersonOverrides(): Record<string, PersonOverrides> {
  try {
    const raw = localStorage.getItem(PERSON_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getPersonOverride(personId: string): PersonOverrides | null {
  return getPersonOverrides()[personId] || null;
}

function setPersonOverride(personId: string, fields: Partial<PersonOverrides>) {
  const overrides = getPersonOverrides();
  overrides[personId] = { ...overrides[personId], ...fields };
  localStorage.setItem(PERSON_OVERRIDES_KEY, JSON.stringify(overrides));
}

function deletePersonOverride(personId: string) {
  const overrides = getPersonOverrides();
  delete overrides[personId];
  localStorage.setItem(PERSON_OVERRIDES_KEY, JSON.stringify(overrides));
}

function applyPersonOverrides(personId: string, base: PersonBasicInfo): PersonBasicInfo {
  const override = getPersonOverride(personId);
  if (!override) return base;
  return {
    ...base,
    name: override.name ?? base.name,
    avatar: override.avatar !== undefined ? override.avatar : base.avatar,
    relationshipStatus: override.relationshipStatus !== undefined ? override.relationshipStatus : base.relationshipStatus,
    isArchived: override.isArchived !== undefined ? override.isArchived : base.isArchived,
  };
}

export function getDeletedPersonIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_PERSONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isPersonArchived(personId: string): boolean {
  const override = getPersonOverride(personId);
  return override?.isArchived === true;
}

// ===== Person Management CRUD Functions =====

const isDev = () => import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || new URLSearchParams(window.location.search).has('sid');

export async function updatePersonName(personId: string, newName: string): Promise<boolean> {
  if (isDev()) {
    setPersonOverride(personId, { name: newName });
    return true;
  }
  const { error } = await supabase
    .from('persons')
    .update({ name: newName })
    .eq('id', personId);
  return !error;
}

export async function updatePersonAvatar(personId: string, avatarUrl: string | null): Promise<boolean> {
  if (isDev()) {
    setPersonOverride(personId, { avatar: avatarUrl });
    return true;
  }
  const { error } = await supabase
    .from('persons')
    .update({ avatar: avatarUrl })
    .eq('id', personId);
  return !error;
}

export async function updateRelationshipStatus(personId: string, status: RelationshipStatus): Promise<boolean> {
  if (isDev()) {
    setPersonOverride(personId, { relationshipStatus: status });
    return true;
  }
  const { error } = await supabase
    .from('persons')
    .update({ relationship_status: status })
    .eq('id', personId);
  return !error;
}

export async function archivePerson(personId: string): Promise<boolean> {
  if (isDev()) {
    setPersonOverride(personId, { isArchived: true });
    return true;
  }
  const { error } = await supabase
    .from('persons')
    .update({ is_archived: true })
    .eq('id', personId);
  return !error;
}

export async function unarchivePerson(personId: string): Promise<boolean> {
  if (isDev()) {
    setPersonOverride(personId, { isArchived: false });
    return true;
  }
  const { error } = await supabase
    .from('persons')
    .update({ is_archived: false })
    .eq('id', personId);
  return !error;
}

export async function deletePerson(personId: string): Promise<boolean> {
  if (isDev()) {
    deletePersonOverride(personId);
    const deleted = getDeletedPersonIds();
    deleted.push(personId);
    localStorage.setItem(DELETED_PERSONS_KEY, JSON.stringify(deleted));
    return true;
  }
  const { error } = await supabase
    .from('persons')
    .delete()
    .eq('id', personId);
  return !error;
}
