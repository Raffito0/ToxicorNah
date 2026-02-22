import { supabase } from '../lib/supabase';

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

  // Meta
  analysisCount: number;
  hasEnoughData: boolean; // true if 3+ analyses
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
  const isDev = import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || new URLSearchParams(window.location.search).has('sid');

  if (isDev) {
    return {
      dominantArchetype: {
        title: 'The Moth',
        tagline: "You can't stay away from the fire",
        description: "You're drawn to intensity and chaos, even when you know it'll burn you. The thrill of unpredictability feels more real than stability.",
        traits: ['Intensity Seeker', 'Chaos Familiar', 'Heart Over Logic'],
        imageUrl: '/Screenshot 2026-01-26 230420.png',
        gradientFrom: '#a78bfa',
        gradientTo: '#4c1d95',
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
          yourArchetype: 'The Moth',
          yourArchetypeImage: '/Screenshot 2026-01-26 230420.png',
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
          title: 'The Moth',
          imageUrl: '/Screenshot 2026-01-26 230420.png',
          unlockedAt: '2025-12-01T10:00:00Z',
          personName: 'Alex',
          gradientFrom: '#a78bfa',
          gradientTo: '#4c1d95',
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
        { date: '2025-12-01T10:00:00Z', archetype: 'The Moth', personName: 'Alex', imageUrl: '' },
      ],
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
