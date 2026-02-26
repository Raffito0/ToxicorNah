import type { ContentScenario } from '../types/contentScenario';
import type { StoredAnalysisResult } from './analysisService';
import { getSoulTypeById } from '../data/soulTypes';
import { supabase } from '../lib/supabase';

// Tag colors and gradients for message insights
const TAG_STYLES: Record<string, { tagColor: string; gradientStart: string; gradientEnd: string; accentColor: string }> = {
  'RED FLAG': { tagColor: '#E53935', gradientStart: '#5C1A1A', gradientEnd: '#3D1212', accentColor: '#ff9d9d' },
  'GREEN FLAG': { tagColor: '#43A047', gradientStart: '#1A3D2E', gradientEnd: '#0D2619', accentColor: '#9ddf90' },
  'DECODED': { tagColor: '#7C4DFF', gradientStart: '#2A1A4E', gradientEnd: '#1A0F33', accentColor: '#B39DDB' },
};

// Soul type gradient mapping by energy type
const SOUL_TYPE_GRADIENTS: Record<string, { from: string; to: string }> = {
  'Wild Energy': { from: '#2d1b4e', to: '#150d26' },
  'Warm Energy': { from: '#3d2d1a', to: '#1f170d' },
  'Abyss Energy': { from: '#0d0d1a', to: '#05050d' },
  'Hollow Energy': { from: '#1a1a3e', to: '#0d0d1f' },
  'Toxic Energy': { from: '#2d1b4e', to: '#150d26' },
  'Martyr Energy': { from: '#3d1a1a', to: '#1f0d0d' },
  'Explosive Energy': { from: '#3d1f0a', to: '#1f1005' },
  'Phantom Energy': { from: '#1a1a3e', to: '#0d0d1f' },
  'Frozen Energy': { from: '#162a3d', to: '#0b1520' },
  'Constrictor Energy': { from: '#1f2a1a', to: '#0f150d' },
  'Unstable Energy': { from: '#3d2d1a', to: '#1f170d' },
  'Shapeshifter Energy': { from: '#2d1a3d', to: '#170d1f' },
  'Collector Energy': { from: '#3d3d1a', to: '#1f1f0d' },
  'Rush Energy': { from: '#4d1a3d', to: '#26101e' },
  'Earth Energy': { from: '#1a3d2d', to: '#0d1f17' },
  'Fire Energy': { from: '#3d1f0a', to: '#1f1005' },
  'Frost Energy': { from: '#162a3d', to: '#0b1520' },
  'Silk Energy': { from: '#3d2d3d', to: '#1f171f' },
  'Intuitive Energy': { from: '#2d1b4e', to: '#150d26' },
  'Venom Energy': { from: '#1f2a1a', to: '#0f150d' },
  'Sunset Energy': { from: '#3d2d1a', to: '#1f170d' },
  'Shadow Energy': { from: '#1a1a3e', to: '#0d0d1f' },
  'Luxe Energy': { from: '#3d3d1a', to: '#1f1f0d' },
  'Labyrinth Energy': { from: '#2d1a3d', to: '#170d1f' },
  'Gold Energy': { from: '#3d3d1a', to: '#1f1f0d' },
  'Predator Energy': { from: '#1f2a1a', to: '#0f150d' },
  'Storm Energy': { from: '#1a2d3d', to: '#0d171f' },
  'Phoenix Energy': { from: '#3d1f0a', to: '#1f1005' },
  'Mirror Energy': { from: '#2d1a3d', to: '#170d1f' },
};

const DEFAULT_GRADIENT = { from: '#162a3d', to: '#0b1520' };

// Default trait colors
const TRAIT_COLORS = ['#6878c0', '#e08030', '#50b090', '#c06878', '#8060c0'];

// Category metadata
const CATEGORY_META: Array<{ key: string; name: string; category: string; categoryNumber: number }> = [
  { key: 'intentions', name: 'intentions', category: 'Intentions', categoryNumber: 1 },
  { key: 'chemistry', name: 'chemistry', category: 'Chemistry', categoryNumber: 2 },
  { key: 'effort', name: 'effort', category: 'Effort', categoryNumber: 3 },
  { key: 'redFlagsGreenFlags', name: 'redFlagsGreenFlags', category: 'Red & Green Flags', categoryNumber: 4 },
  { key: 'trajectory', name: 'trajectory', category: 'Trajectory', categoryNumber: 5 },
];

/**
 * Load a scenario JSON from /scenarios/{name}.json
 */
export async function loadScenario(name: string): Promise<ContentScenario> {
  const response = await fetch(`/scenarios/${name}.json`);
  if (!response.ok) {
    throw new Error(`Scenario "${name}" not found (${response.status})`);
  }
  return response.json();
}

/**
 * Load a scenario from Supabase content_scenarios table by UUID.
 */
export async function loadScenarioFromSupabase(id: string): Promise<ContentScenario> {
  const { data, error } = await supabase
    .from('content_scenarios')
    .select('scenario_json')
    .eq('id', id)
    .single();

  if (error || !data) {
    throw new Error(`Scenario "${id}" not found in Supabase: ${error?.message || 'no data'}`);
  }

  return data.scenario_json as ContentScenario;
}

/**
 * Build a full StoredAnalysisResult from a simplified ContentScenario.
 * Auto-fills soul type images, gradients, trait colors from soulTypes.ts.
 */
export function buildStoredResult(scenario: ContentScenario): StoredAnalysisResult {
  const r = scenario.results;

  // Look up soul types
  const personST = getSoulTypeById(r.personSoulType);
  const userST = getSoulTypeById(r.userSoulType);

  if (!personST) throw new Error(`Person soul type "${r.personSoulType}" not found`);
  if (!userST) throw new Error(`User soul type "${r.userSoulType}" not found`);

  const personGradient = SOUL_TYPE_GRADIENTS[personST.energyType || ''] || DEFAULT_GRADIENT;
  const userGradient = SOUL_TYPE_GRADIENTS[userST.energyType || ''] || DEFAULT_GRADIENT;

  // Build emotional profiles from categories
  const categories = r.categories as Record<string, { description: string }>;
  const emotionalProfiles = CATEGORY_META.map((meta) => {
    const cat = categories[meta.key];
    return {
      archetypeId: meta.key,
      name: meta.name,
      description: cat?.description || '',
      category: meta.category,
      categoryNumber: meta.categoryNumber,
      traits: [],
      traitColors: [],
      gradientStart: personGradient.from,
      gradientEnd: personGradient.to,
    };
  });

  // Build message insights with proper styling
  const totalInsights = r.messageInsights.length;
  const messageInsights = r.messageInsights.map((insight, i) => {
    const style = TAG_STYLES[insight.tag] || TAG_STYLES['DECODED'];
    return {
      message: insight.message,
      messageCount: `${i + 1} of ${totalInsights}`,
      title: insight.title,
      tag: insight.tag,
      tagColor: style.tagColor,
      description: insight.description,
      solution: insight.solution,
      gradientStart: style.gradientStart,
      gradientEnd: style.gradientEnd,
      accentColor: style.accentColor,
    };
  });

  return {
    id: '', // Will be set by injectContentScenario
    overallScore: 100 - r.overallScore, // n8n uses health score (low=toxic), app uses toxicity score (high=toxic)
    warmthScore: r.warmthScore,
    communicationScore: r.communicationScore,
    dramaScore: r.dramaScore,
    distanceScore: r.distanceScore,
    passionScore: r.passionScore,
    profileType: r.profileType,
    profileSubtitle: r.profileSubtitle,
    profileDescription: r.profileDescription,
    isUnlocked: true,
    unlockType: 'subscription',
    personGender: r.personGender,
    personName: scenario.personDisplayName || r.personName,
    emotionalProfiles,
    messageInsights,
    personArchetype: {
      name: personST.name,
      title: personST.name,
      tagline: personST.tagline,
      description: r.personDescription || personST.description,
      traits: r.personTraits || personST.traits,
      traitColors: TRAIT_COLORS.slice(0, (r.personTraits || personST.traits).length),
      energyType: r.personEnergyType || personST.energyType || 'Unknown Energy',
      imageUrl: personST.normalImage,
      sideProfileImageUrl: personST.sideProfileImage,
      gradientFrom: personGradient.from,
      gradientTo: personGradient.to,
      shareableTagline: personST.tagline,
    },
    userArchetype: {
      name: userST.name,
      title: userST.name,
      tagline: userST.tagline,
      description: r.userDescription || userST.description,
      traits: r.userTraits || userST.traits,
      traitColors: TRAIT_COLORS.slice(0, (r.userTraits || userST.traits).length),
      energyType: r.userEnergyType || userST.energyType || 'Unknown Energy',
      imageUrl: userST.normalImage,
      sideProfileImageUrl: userST.sideProfileImage,
      gradientFrom: userGradient.from,
      gradientTo: userGradient.to,
    },
    relationshipDynamic: {
      name: r.dynamic.name,
      subtitle: r.dynamic.subtitle,
      whyThisHappens: r.dynamic.whyThisHappens,
      patternBreak: r.dynamic.patternBreak,
      powerBalance: r.dynamic.powerBalance,
    },
    personAvatar: scenario.personAvatar || null,
    personRelationshipStatus: scenario.personRelationshipStatus || null,
  };
}

/**
 * Inject a content scenario into localStorage and simulate the two-phase loading.
 * Returns the analysis ID that ResultsPage can use.
 */
export function injectContentScenario(scenario: ContentScenario): string {
  const analysisId = 'dev-analysis-content-' + Date.now();
  const result = buildStoredResult(scenario);
  result.id = analysisId;

  // Store the full result immediately (Phase 1 will read it)
  localStorage.setItem('dev_analysis_result_' + analysisId, JSON.stringify(result));

  // Phase 1: quick_ready immediately (scores + soul types visible)
  localStorage.setItem('analysis_status_' + analysisId, 'quick_ready');

  // Phase 2: completed after fake delay (cards + insights visible)
  setTimeout(() => {
    localStorage.setItem('analysis_status_' + analysisId, 'completed');
  }, 3000);

  console.log('[ContentMode] Injected scenario:', scenario.id, '→ analysisId:', analysisId);
  return analysisId;
}
