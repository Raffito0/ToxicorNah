import { supabase } from '../lib/supabase';
import { getUserState, consumeFirstFreeAnalysis, consumeBonusUnlock, canUseFirstFreeAnalysis, canUseBonusUnlock, getOrCreateSessionId } from './userStateService';
import { analyzeChatScreenshots, analyzeQuick, analyzeDetailed, QuickAnalysisResult, DetailedAnalysisResult, ExtractionResult, generatePersonalizedSoulTypeDescriptions } from './geminiService';
import { selectBestArchetype, personalizeDescription, selectTraitsFromPool, matchSoulTypeByKeywords } from './archetypeMatchingService';
import { findMostSimilarColor, generateDarkGradient } from '../utils/colorUtils';
import { getMaleSoulTypeByName, getFemaleSoulTypeByName, MALE_SOUL_TYPES, FEMALE_SOUL_TYPES, SoulType } from '../data/soulTypes';

// ===== HYBRID SOUL TYPE MATCHING =====
// AI extracts behavioral patterns → Client matches to Soul Types

interface ArchetypeWithMatching {
  name: string;
  title: string;
  tagline: string;  // Soul Type's predefined tagline (e.g., "Wild at heart, impossible to cage")
  description: string;
  traits: string[];
  energyType: string;
  shareableTagline?: string;
  imageUrl: string;
  sideProfileImageUrl: string;  // For "Your Souls Together" card
  gradientFrom: string;
  gradientTo: string;
  matchedKeywords: string[];
  confidence: number;
  // AI data preserved for Soul Type personalization micro-call
  aiObservedBehaviors: string[];
  aiEvidenceMessages: string[];
}

/**
 * Performs client-side Soul Type matching based on observed behaviors from AI
 * Returns a complete archetype object with all necessary fields filled in
 */
function matchAndBuildArchetype(
  aiArchetype: {
    name: string;
    observedBehaviors: string[];
    evidenceMessages?: string[];
    description: string;
    traits: string[];
    shareableTagline?: string;
    title?: string;
    energyType?: string;
  },
  gender: 'male' | 'female'
): ArchetypeWithMatching {
  // If observedBehaviors is empty or AI already provided a valid title, use fallback
  const observedBehaviors = aiArchetype.observedBehaviors || [];

  // Perform client-side matching
  const matchResult = matchSoulTypeByKeywords(observedBehaviors, gender);
  const soulType = matchResult.soulType;

  // Get image, tagline, and gradient from matched Soul Type
  const imageUrl = soulType.normalImage;
  const sideProfileImageUrl = soulType.sideProfileImage;
  const tagline = soulType.tagline;  // Predefined tagline from soulTypes.ts
  const gradientColors = SOUL_TYPE_GRADIENTS[soulType.energyType || ''] || { from: '#162a3d', to: '#0b1520' };

  console.log(`[Hybrid Matching] ${gender} Soul Type: "${soulType.name}" (${(matchResult.confidence * 100).toFixed(0)}% confidence)`);
  console.log(`[Hybrid Matching] Tagline: "${tagline}"`);
  console.log(`[Hybrid Matching] Matched keywords: [${matchResult.matchedKeywords.join(', ')}]`);

  return {
    name: aiArchetype.name,
    title: soulType.name,  // Use matched Soul Type name
    tagline,  // Soul Type's predefined tagline
    description: soulType.description,  // Use predefined Soul Type description (personalized later by micro-call)
    traits: soulType.traits,  // Use predefined Soul Type traits (personalized later by micro-call)
    energyType: soulType.energyType || 'Unknown Energy',
    shareableTagline: aiArchetype.shareableTagline,
    imageUrl,
    sideProfileImageUrl,
    gradientFrom: gradientColors.from,
    gradientTo: gradientColors.to,
    matchedKeywords: matchResult.matchedKeywords,
    confidence: matchResult.confidence,
    // Keep AI data for Soul Type personalization micro-call
    aiObservedBehaviors: aiArchetype.observedBehaviors || [],
    aiEvidenceMessages: aiArchetype.evidenceMessages || [],
  };
}

// ===== SOUL TYPE IMAGE & GRADIENT HELPERS =====
// Soul Types use Supabase Storage: dynamic-archetypes/soul-types/{gender}/

// Default gradient colors for Soul Types (can be customized per energy type)
const SOUL_TYPE_GRADIENTS: Record<string, { from: string; to: string }> = {
  // Male Soul Types
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
  // Female Soul Types
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

// Default colors for dynamic gradient computation
const DEFAULT_SOUL_TYPE_COLORS: [string, string, string] = ['#2d1b4e', '#6878c0', '#e08030'];

/**
 * Computes the DynamicCard gradient by finding the most similar color
 * between person and user soul type palettes, then generating a dark gradient.
 */
export function computeDynamicGradient(
  personTitle: string,
  userTitle: string
): { from: string; to: string } {
  // Use default colors for both soul types
  const sharedColor = findMostSimilarColor(DEFAULT_SOUL_TYPE_COLORS, DEFAULT_SOUL_TYPE_COLORS);
  const gradient = generateDarkGradient(sharedColor);

  return { from: gradient.start, to: gradient.end };
}

/**
 * Get Soul Type image for male (person) - uses normalImage from soulTypes.ts
 */
function getPersonArchetypeImage(title: string): string {
  const soulType = getMaleSoulTypeByName(title);
  if (soulType) {
    return soulType.normalImage;
  }
  // Fallback to first male soul type
  return MALE_SOUL_TYPES[0]?.normalImage || '';
}

/**
 * Get Soul Type image for female (user) - uses normalImage from soulTypes.ts
 */
function getUserArchetypeImage(title: string): string {
  const soulType = getFemaleSoulTypeByName(title);
  if (soulType) {
    return soulType.normalImage;
  }
  // Fallback to first female soul type
  return FEMALE_SOUL_TYPES[0]?.normalImage || '';
}

/**
 * Get gradient colors for a Soul Type based on its energy type
 */
function getPersonArchetypeGradient(title: string): { from: string; to: string } {
  const soulType = getMaleSoulTypeByName(title);
  if (soulType?.energyType) {
    return SOUL_TYPE_GRADIENTS[soulType.energyType] || { from: '#162a3d', to: '#0b1520' };
  }
  return { from: '#162a3d', to: '#0b1520' };
}

/**
 * Get gradient for shareable card based on Soul Type
 */
export function getShareableCardGradient(title: string): { from: string; to: string } {
  const soulType = getMaleSoulTypeByName(title);
  if (soulType?.energyType) {
    return SOUL_TYPE_GRADIENTS[soulType.energyType] || { from: '#162a3d', to: '#0b1520' };
  }
  const gradient = generateDarkGradient(DEFAULT_SOUL_TYPE_COLORS[0]);
  return { from: gradient.start, to: gradient.end };
}

function calculateProfileColor(score: number): { start: string; end: string } {
  if (score >= 80) {
    return { start: '#580007', end: '#a3352a' };
  } else if (score >= 60) {
    return { start: '#4d2952', end: '#7a3d8f' };
  } else if (score >= 40) {
    return { start: '#1a3a52', end: '#2d5f7e' };
  } else if (score >= 20) {
    return { start: '#1f4037', end: '#3a6f5f' };
  } else {
    return { start: '#0d2619', end: '#1a3d2e' };
  }
}

export interface StoredAnalysisResult {
  id: string;
  overallScore: number;
  warmthScore: number;
  communicationScore: number;
  dramaScore: number;
  distanceScore: number;
  passionScore: number;
  profileType: string;
  profileSubtitle: string;
  profileDescription: string;
  isUnlocked: boolean;
  unlockType: string;
  personGender: 'male' | 'female';
  personName: string;
  emotionalProfiles: Array<{
    archetypeId: string;
    name: string;
    description: string;
    category: string;
    categoryNumber: number;
    traits: string[];
    traitColors: string[];
    gradientStart: string;
    gradientEnd: string;
    illustrationUrl?: string;
  }>;
  messageInsights: Array<{
    message: string;
    messageCount: string;
    title: string;
    tag: string;
    tagColor: string;
    description: string;
    solution: string;
    gradientStart: string;
    gradientEnd: string;
    accentColor: string;
  }>;
  personArchetype: {
    name: string;
    title: string;
    tagline: string;  // Soul Type's predefined tagline
    description: string;
    traits: string[];
    traitColors: string[];
    energyType: string;
    imageUrl: string;
    sideProfileImageUrl: string;  // For "Your Souls Together" card
    gradientFrom: string;
    gradientTo: string;
    shareableTagline: string;
  };
  userArchetype: {
    name: string;
    title: string;
    tagline: string;  // Soul Type's predefined tagline
    description: string;
    traits: string[];
    traitColors: string[];
    energyType: string;
    imageUrl: string;
    sideProfileImageUrl: string;  // For "Your Souls Together" card
    gradientFrom: string;
    gradientTo: string;
  };
  relationshipDynamic: {
    name: string;
    subtitle: string;
    whyThisHappens: string;
    patternBreak: string;
    powerBalance: number;
  };
}

export async function processAnalysis(personId: string, imageFiles: File[]): Promise<string> {
  console.log('processAnalysis: Starting with personId:', personId, 'files:', imageFiles.length);

  // DEV/FALLBACK MODE: Call real Gemini API but skip Supabase database operations
  // Triggered in dev mode OR when Supabase is unavailable (person creation failed)
  if (personId.startsWith('dev-')) {
    console.log('processAnalysis: LOCAL MODE - calling real Gemini API, skipping Supabase');
    return await processAnalysisDevMode(personId, imageFiles);
  }

  const userState = await getUserState();
  console.log('processAnalysis: Got user state:', userState);

  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id || null;
  console.log('processAnalysis: Current user ID:', userId);

  const chatUploadPromises = imageFiles.map(async (file) => {
    const fileName = `${Date.now()}_${file.name}`;
    console.log('processAnalysis: Uploading file:', fileName);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('chat-screenshots')
      .upload(fileName, file);

    if (uploadError) {
      console.error('processAnalysis: Upload error:', uploadError);
      throw uploadError;
    }

    console.log('processAnalysis: File uploaded successfully:', fileName);

    const { data: { publicUrl } } = supabase.storage
      .from('chat-screenshots')
      .getPublicUrl(fileName);

    console.log('processAnalysis: Got public URL:', publicUrl);

    const { data: chatUpload, error: chatError } = await supabase
      .from('chat_uploads')
      .insert({
        user_id: userId,
        person_id: personId,
        file_url: publicUrl,
        analysis_status: 'pending'
      })
      .select()
      .single();

    if (chatError) {
      console.error('processAnalysis: Chat upload insert error:', chatError);
      throw chatError;
    }

    console.log('processAnalysis: Chat upload created:', chatUpload.id);
    return chatUpload.id;
  });

  const chatUploadIds = await Promise.all(chatUploadPromises);
  console.log('processAnalysis: All files uploaded, IDs:', chatUploadIds);
  const primaryChatUploadId = chatUploadIds[0];

  const isFirstAnalysis = canUseFirstFreeAnalysis(userState);
  const hasBonusUnlock = canUseBonusUnlock(userState);
  const shouldUnlock = userState.isPremium || isFirstAnalysis || hasBonusUnlock;

  let unlockType: string;
  if (userState.isPremium) {
    unlockType = 'subscription';
  } else if (isFirstAnalysis) {
    unlockType = 'free_first';
  } else if (hasBonusUnlock) {
    unlockType = 'viral_bonus';
  } else {
    unlockType = 'locked';
  }

  console.log('processAnalysis: Creating analysis result with unlock:', shouldUnlock, 'type:', unlockType);

  const { data: analysisResult, error: analysisError } = await supabase
    .from('analysis_results')
    .insert({
      chat_upload_id: primaryChatUploadId,
      person_id: personId,
      processing_status: 'processing',
      is_unlocked: shouldUnlock,
      unlock_type: shouldUnlock ? unlockType : null
    })
    .select()
    .single();

  if (analysisError) {
    console.error('processAnalysis: Analysis result insert error:', analysisError);
    throw analysisError;
  }

  console.log('processAnalysis: Analysis result created:', analysisResult.id);
  console.log('processAnalysis: Starting AI analysis...');

  await runAIAnalysis(analysisResult.id, imageFiles, personId);

  console.log('processAnalysis: AI analysis complete');

  if (isFirstAnalysis) {
    await consumeFirstFreeAnalysis();
  } else if (hasBonusUnlock) {
    await consumeBonusUnlock(userState);
  }

  console.log('processAnalysis: Returning analysis ID:', analysisResult.id);
  return analysisResult.id;
}

/**
 * DEV MODE: Process analysis using real Gemini API but skip Supabase operations.
 * Results are stored in localStorage for retrieval.
 */
async function processAnalysisDevMode(personId: string, imageFiles: File[]): Promise<string> {
  const devAnalysisId = 'dev-analysis-' + Date.now();

  try {
    console.log('[DEV MODE] Starting AI analysis with Gemini 2.0 Flash...');

    // Call real Gemini API
    const aiResult = await analyzeChatScreenshots(imageFiles);

    console.log('[DEV MODE] Gemini analysis complete:', aiResult);

    // HYBRID MATCHING: Client-side Soul Type matching based on observed behaviors
    const personMatched = matchAndBuildArchetype(aiResult.personArchetype, 'male');
    const userMatched = matchAndBuildArchetype(aiResult.userArchetype, 'female');

    console.log('[DEV MODE] Hybrid matching complete:');
    console.log(`  Person: "${personMatched.title}" (${(personMatched.confidence * 100).toFixed(0)}%)`);
    console.log(`  User: "${userMatched.title}" (${(userMatched.confidence * 100).toFixed(0)}%)`);

    // Personalize Soul Type descriptions with micro-call
    console.log('[DEV MODE] Personalizing Soul Type descriptions...');
    const singlePhasePersonGender = (aiResult.personGender || 'male') as 'male' | 'female';
    const singlePhaseUserGender = singlePhasePersonGender === 'male' ? 'female' : 'male';

    let singlePhaseTimeout: ReturnType<typeof setTimeout>;
    const singlePhasePersonalization = await Promise.race([
      generatePersonalizedSoulTypeDescriptions(
        {
          soulTypeName: personMatched.title,
          soulTypeTagline: personMatched.tagline,
          soulTypeDescription: personMatched.description,
          soulTypeTraits: personMatched.traits,
          observedBehaviors: personMatched.aiObservedBehaviors,
          evidenceMessages: personMatched.aiEvidenceMessages,
          gender: singlePhasePersonGender,
        },
        {
          soulTypeName: userMatched.title,
          soulTypeTagline: userMatched.tagline,
          soulTypeDescription: userMatched.description,
          soulTypeTraits: userMatched.traits,
          observedBehaviors: userMatched.aiObservedBehaviors,
          evidenceMessages: userMatched.aiEvidenceMessages,
          gender: singlePhaseUserGender,
        }
      ),
      new Promise<null>((resolve) => {
        singlePhaseTimeout = setTimeout(() => {
          console.warn('[Soul Type Personalization] Timeout after 4s, using predefined descriptions');
          resolve(null);
        }, 4000);
      })
    ]);
    clearTimeout(singlePhaseTimeout!);

    if (singlePhasePersonalization) {
      personMatched.description = singlePhasePersonalization.person.description;
      personMatched.traits = singlePhasePersonalization.person.traits;
      userMatched.description = singlePhasePersonalization.user.description;
      userMatched.traits = singlePhasePersonalization.user.traits;
      console.log('[Soul Type Personalization] Applied personalized descriptions!');
    } else {
      console.log('[Soul Type Personalization] Using predefined descriptions (fallback)');
    }

    // Use matched archetype data for images and gradients
    const personImageUrl = personMatched.imageUrl;
    const userImageUrl = userMatched.imageUrl;
    const personArchetypeGradient = { from: personMatched.gradientFrom, to: personMatched.gradientTo };

    const storedResult: StoredAnalysisResult = {
      id: devAnalysisId,
      overallScore: aiResult.scores.overall,
      warmthScore: aiResult.scores.warmth,
      communicationScore: aiResult.scores.communication,
      dramaScore: aiResult.scores.drama,
      distanceScore: aiResult.scores.distance,
      passionScore: aiResult.scores.passion,
      profileType: aiResult.profile.type,
      profileSubtitle: aiResult.profile.subtitle,
      profileDescription: aiResult.profile.description,
      isUnlocked: true,
      unlockType: 'dev_mode',
      personGender: aiResult.personGender || 'male',
      personName: 'Him',  // Never use AI-extracted name; the UI uses the user-assigned name
      emotionalProfiles: Object.entries(aiResult.categoryAnalysis).map(([key, analysis], index) => {
        const categoryNames: Record<string, string> = {
          redFlagsGreenFlags: 'Red Flags & Green Flags',
          effort: 'Effort',
          intentions: 'Intentions',
          chemistry: 'Chemistry',
          trajectory: 'Trajectory'
        };
        return {
          archetypeId: `dev-${key}`,
          name: key,
          description: analysis.personalizedDescription || '',
          category: categoryNames[key] || key,
          categoryNumber: index + 1,
          traits: analysis.personalizedTraits || [],
          traitColors: ['#8B5CF6', '#EC4899', '#F59E0B', '#10B981'],
          gradientStart: '#1a1a3e',
          gradientEnd: '#0d0d1f',
        };
      }),
      messageInsights: aiResult.messageInsights || [],
      personArchetype: {
        name: personMatched.name,
        title: personMatched.title,  // From hybrid matching
        tagline: personMatched.tagline,  // Soul Type's predefined tagline
        description: personMatched.description,
        traits: personMatched.traits,
        traitColors: ['#F75221', '#E01F01', '#E0B118'],
        energyType: personMatched.energyType,  // From hybrid matching
        imageUrl: personMatched.imageUrl,
        sideProfileImageUrl: personMatched.sideProfileImageUrl,
        gradientFrom: personMatched.gradientFrom,
        gradientTo: personMatched.gradientTo,
        shareableTagline: personMatched.shareableTagline || ''
      },
      userArchetype: {
        name: userMatched.name,
        title: userMatched.title,  // From hybrid matching
        tagline: userMatched.tagline,  // Soul Type's predefined tagline
        description: userMatched.description,
        traits: userMatched.traits,
        traitColors: ['#2A9D8F', '#1B5B54', '#3ABAA8'],
        energyType: userMatched.energyType,  // From hybrid matching
        imageUrl: userMatched.imageUrl,
        sideProfileImageUrl: userMatched.sideProfileImageUrl,
        gradientFrom: userMatched.gradientFrom,
        gradientTo: userMatched.gradientTo
      },
      relationshipDynamic: aiResult.relationshipDynamic || {
        name: 'The Dynamic',
        subtitle: 'Analysis complete',
        whyThisHappens: 'Based on chat patterns',
        patternBreak: 'Take action based on insights',
        powerBalance: 50
      }
    };

    // Store in localStorage
    localStorage.setItem('dev_analysis_result_' + devAnalysisId, JSON.stringify(storedResult));
    console.log('[DEV MODE] Analysis stored in localStorage:', devAnalysisId);

    return devAnalysisId;
  } catch (error) {
    console.error('[DEV MODE] Gemini analysis failed:', error);
    throw error;
  }
}

async function runAIAnalysis(analysisId: string, imageFiles: File[], personId: string): Promise<void> {
  try {
    console.log('Starting AI analysis with Gemini 2.0 Flash...');

    // Gemini API call - uses position-based extraction (left=person, right=user)
    const aiResult = await analyzeChatScreenshots(imageFiles);

    console.log('Gemini analysis complete:', aiResult);

    // Fallback mock data in case OpenAI fails
    const mockResult = {
      scores: {
        overall: 75,
        warmth: 80,
        communication: 70,
        drama: 35,
        distance: 40,
        passion: 85
      },
      profile: {
        type: "Relazione Equilibrata",
        subtitle: "Una connessione sana e promettente",
        description: "La vostra comunicazione mostra segni di affetto, rispetto e interesse reciproco. C'è un buon equilibrio tra vicinanza emotiva e spazio personale."
      },
      emotionalArchetypes: ["The Soul Seeker", "The Joy Bringer", "The Heart Guardian"],
      messageInsights: [
        {
          message: "Ti penso sempre ❤️",
          messageCount: "12 volte",
          title: "Espressioni d'Affetto",
          tag: "POSITIVO",
          tagColor: "#10B981",
          description: "Messaggi che dimostrano affetto e pensiero costante verso l'altra persona",
          solution: "Continua a esprimere i tuoi sentimenti in modo autentico",
          gradientStart: "#10B981",
          gradientEnd: "#34D399",
          accentColor: "#10B981"
        },
        {
          message: "Come è andata la giornata?",
          messageCount: "8 volte",
          title: "Interesse Genuino",
          tag: "POSITIVO",
          tagColor: "#3B82F6",
          description: "Domande che mostrano interesse per la vita quotidiana dell'altra persona",
          solution: "Mantieni questa curiosità e attenzione verso l'altro",
          gradientStart: "#3B82F6",
          gradientEnd: "#60A5FA",
          accentColor: "#3B82F6"
        },
        {
          message: "Non ho tempo ora",
          messageCount: "5 volte",
          title: "Momenti di Distanza",
          tag: "ATTENZIONE",
          tagColor: "#F59E0B",
          description: "Messaggi che potrebbero indicare bisogno di spazio personale",
          solution: "Rispetta i tempi e gli spazi dell'altra persona",
          gradientStart: "#F59E0B",
          gradientEnd: "#FBBF24",
          accentColor: "#F59E0B"
        }
      ],
      personArchetype: {
        name: "L'Amante Appassionato",
        title: "Intenso ed Emotivo",
        description: "Una persona che vive le emozioni intensamente e cerca una connessione profonda",
        traits: ["Passionale", "Romantico", "Espressivo"],
        energyType: "Fuoco"
      },
      userArchetype: {
        name: "Il Compagno Equilibrato",
        title: "Stabile e Presente",
        description: "Una persona che bilancia affetto e razionalità, creando stabilità nella relazione",
        traits: ["Stabile", "Affidabile", "Comprensivo"],
        energyType: "Terra"
      }
    };

    const profileColors = calculateProfileColor(aiResult.scores.overall);

    const { error: updateError } = await supabase
      .from('analysis_results')
      .update({
        overall_score: aiResult.scores.overall,
        warmth_score: aiResult.scores.warmth,
        communication_score: aiResult.scores.communication,
        drama_score: aiResult.scores.drama,
        distance_score: aiResult.scores.distance,
        passion_score: aiResult.scores.passion,
        profile_type: aiResult.profile.type,
        profile_subtitle: aiResult.profile.subtitle,
        profile_description: aiResult.profile.description,
        person_gender: aiResult.personGender || 'male',
        ai_raw_response: aiResult as unknown as Record<string, unknown>,
        processing_status: 'completed'
      })
      .eq('id', analysisId);

    if (updateError) {
      console.error('Error updating analysis:', updateError);
      throw updateError;
    }

    // Save emotional archetypes using semantic matching with predefined archetypes
    const categories = [
      { key: 'redFlagsGreenFlags', name: 'Red Flags & Green Flags' },
      { key: 'effort', name: 'Effort' },
      { key: 'intentions', name: 'Intentions' },
      { key: 'chemistry', name: 'Chemistry' },
      { key: 'trajectory', name: 'Trajectory' }
    ];

    // OPTIMIZED: Get user once at the start (not in each loop iteration)
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const sessionId = getOrCreateSessionId();

    // OPTIMIZED: Process all 5 categories in PARALLEL instead of sequentially
    const categoryPromises = categories.map(async (category, i) => {
      const analysis = aiResult.categoryAnalysis[category.key as keyof typeof aiResult.categoryAnalysis];

      try {
        // 1. Semantic matching to find best archetype
        const { archetype } = await selectBestArchetype(
          category.name,
          analysis
        );

        // 2. Use AI-generated personalized description (fallback to template if not available)
        const personalizedDesc = analysis.personalizedDescription || personalizeDescription(
          archetype.description_template,
          analysis.templateVars
        );

        // 3. Use AI-generated personalized traits (fallback to pool selection if not available)
        const selectedTraits = analysis.personalizedTraits && analysis.personalizedTraits.length === 4
          ? analysis.personalizedTraits
          : selectTraitsFromPool(archetype.traits_pool, analysis.semanticTags, 4);

        // 4. Save to database
        const { error: profileError } = await supabase
          .from('analysis_emotional_profiles')
          .insert({
            analysis_id: analysisId,
            archetype_id: archetype.id,
            archetype_name: archetype.name,
            category_name: category.name,
            personalized_description: personalizedDesc,
            selected_traits: selectedTraits,
            severity: analysis.severity,
            gradient_start: archetype.gradient_start,
            gradient_end: archetype.gradient_end,
            display_order: i
          });

        if (profileError) {
          console.error('Error inserting emotional profile:', profileError);
          throw profileError;
        }

        // 5. Add to user collection (fire and forget - non-critical)
        supabase
          .from('user_archetype_collection')
          .insert({
            user_id: currentUser?.id || null,
            session_id: sessionId,
            archetype_id: archetype.id
          })
          .then(() => {});

        // 6. Increment unlock counter (fire and forget - non-critical)
        supabase.rpc('increment_archetype_unlocks', { p_archetype_id: archetype.id }).then(() => {});

      } catch (error) {
        console.error(`Error processing category ${category.name}:`, error);
        // Continue with other categories instead of failing entire analysis
      }
    });

    // OPTIMIZED: Batch insert ALL message insights at once instead of one by one
    const insightRecords = aiResult.messageInsights.map((insight, i) => ({
      analysis_id: analysisId,
      message_text: insight.message,
      message_count: insight.messageCount,
      insight_title: insight.title,
      insight_tag: insight.tag,
      tag_color: insight.tagColor,
      description: insight.description,
      solution: insight.solution,
      gradient_start: insight.gradientStart,
      gradient_end: insight.gradientEnd,
      accent_color: insight.accentColor,
      display_order: i
    }));

    // Wait for categories (parallel) and insights (batch) together
    const [, insightsResult] = await Promise.all([
      Promise.all(categoryPromises),
      supabase.from('analysis_message_insights').insert(insightRecords)
    ]);

    if (insightsResult.error) {
      console.error('Error batch inserting message insights:', insightsResult.error);
      throw insightsResult.error;
    }

    // HYBRID MATCHING: Client-side Soul Type matching for production
    const personMatched = matchAndBuildArchetype(aiResult.personArchetype, 'male');
    const userMatched = matchAndBuildArchetype(aiResult.userArchetype, 'female');

    console.log('[Production] Hybrid matching:');
    console.log(`  Person: "${personMatched.title}" (${(personMatched.confidence * 100).toFixed(0)}%)`);
    console.log(`  User: "${userMatched.title}" (${(userMatched.confidence * 100).toFixed(0)}%)`);

    // Personalize Soul Type descriptions with micro-call
    const prodPersonGender = (aiResult.personGender || 'male') as 'male' | 'female';
    const prodUserGender = prodPersonGender === 'male' ? 'female' : 'male';

    let prodTimeout: ReturnType<typeof setTimeout>;
    const prodPersonalization = await Promise.race([
      generatePersonalizedSoulTypeDescriptions(
        {
          soulTypeName: personMatched.title,
          soulTypeTagline: personMatched.tagline,
          soulTypeDescription: personMatched.description,
          soulTypeTraits: personMatched.traits,
          observedBehaviors: personMatched.aiObservedBehaviors,
          evidenceMessages: personMatched.aiEvidenceMessages,
          gender: prodPersonGender,
        },
        {
          soulTypeName: userMatched.title,
          soulTypeTagline: userMatched.tagline,
          soulTypeDescription: userMatched.description,
          soulTypeTraits: userMatched.traits,
          observedBehaviors: userMatched.aiObservedBehaviors,
          evidenceMessages: userMatched.aiEvidenceMessages,
          gender: prodUserGender,
        }
      ),
      new Promise<null>((resolve) => {
        prodTimeout = setTimeout(() => {
          console.warn('[Production Soul Type Personalization] Timeout after 4s');
          resolve(null);
        }, 4000);
      })
    ]);
    clearTimeout(prodTimeout!);

    if (prodPersonalization) {
      personMatched.description = prodPersonalization.person.description;
      personMatched.traits = prodPersonalization.person.traits;
      userMatched.description = prodPersonalization.user.description;
      userMatched.traits = prodPersonalization.user.traits;
      console.log('[Production Soul Type Personalization] Applied!');
    }

    const { error: archetypeInsertError } = await supabase
      .from('analysis_relationship_archetypes')
      .insert([
        {
          analysis_id: analysisId,
          person_type: 'person',
          archetype_name: personMatched.name,
          archetype_title: personMatched.title,  // From hybrid matching
          description: personMatched.description,
          traits: personMatched.traits,
          trait_colors: ['#F75221', '#E01F01', '#E0B118'],
          energy_type: personMatched.energyType,  // From hybrid matching
          image_url: personMatched.imageUrl,
          gradient_from: personMatched.gradientFrom,
          gradient_to: personMatched.gradientTo,
          shareable_tagline: personMatched.shareableTagline || ''
        },
        {
          analysis_id: analysisId,
          person_type: 'user',
          archetype_name: userMatched.name,
          archetype_title: userMatched.title,  // From hybrid matching
          description: userMatched.description,
          traits: userMatched.traits,
          trait_colors: ['#2A9D8F', '#1B5B54', '#3ABAA8'],
          energy_type: userMatched.energyType,  // From hybrid matching
          image_url: userMatched.imageUrl,
          gradient_from: userMatched.gradientFrom,
          gradient_to: userMatched.gradientTo
        }
      ]);

    if (archetypeInsertError) {
      console.error('Error inserting relationship archetypes:', archetypeInsertError);
      throw archetypeInsertError;
    }

    // Save relationship dynamic to analysis_results table as JSON (table analysis_relationship_dynamic doesn't exist)
    if (aiResult.relationshipDynamic) {
      const { error: dynamicError } = await supabase
        .from('analysis_results')
        .update({
          relationship_dynamic: {
            name: aiResult.relationshipDynamic.name,
            subtitle: aiResult.relationshipDynamic.subtitle,
            why_this_happens: aiResult.relationshipDynamic.whyThisHappens,
            pattern_break: aiResult.relationshipDynamic.patternBreak,
            power_balance: aiResult.relationshipDynamic.powerBalance ?? 50
          }
        })
        .eq('id', analysisId);

      if (dynamicError) {
        // Non-critical error, log and continue
        console.warn('Could not save relationship dynamic (column may not exist):', dynamicError);
      }
    }

  } catch (error) {
    console.error('AI analysis failed, will retry or mark as failed:', error);

    // Mark as failed in database
    await supabase
      .from('analysis_results')
      .update({
        processing_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', analysisId);

    throw error;
  }
}

export async function getAnalysisResult(analysisId: string): Promise<StoredAnalysisResult | null> {
  // LOCAL MODE: Check localStorage for dev-analysis-* IDs (dev, fallback, or content mode)
  if (analysisId.startsWith('dev-analysis-')) {
    // Try to get real Gemini result from localStorage
    const storedResult = localStorage.getItem('dev_analysis_result_' + analysisId);
    if (storedResult) {
      console.log('getAnalysisResult: LOCAL MODE - returning Gemini result from localStorage for', analysisId);
      return JSON.parse(storedResult) as StoredAnalysisResult;
    }
    // Fall back to mock if no real result found
    console.log('getAnalysisResult: LOCAL MODE - no localStorage result, returning mock for', analysisId);
    return getMockAnalysisResult(analysisId);
  }

  const { data: analysis, error } = await supabase
    .from('analysis_results')
    .select('*')
    .eq('id', analysisId)
    .maybeSingle();

  if (error || !analysis) {
    console.error('Error fetching analysis:', error);
    // In dev mode, return mock data as fallback
    if (isDev) {
      console.log('getAnalysisResult: DEV MODE fallback - returning mock analysis');
      return getMockAnalysisResult(analysisId);
    }
    return null;
  }

  // Fetch person name from persons table
  let personName = 'Unknown';
  if (analysis.person_id) {
    const { data: person } = await supabase
      .from('persons')
      .select('name')
      .eq('id', analysis.person_id)
      .single();
    if (person?.name) {
      personName = person.name;
    }
  }

  const { data: emotionalProfiles } = await supabase
    .from('analysis_emotional_profiles')
    .select('*')
    .eq('analysis_id', analysisId)
    .order('display_order');

  const { data: messageInsights } = await supabase
    .from('analysis_message_insights')
    .select('*')
    .eq('analysis_id', analysisId)
    .order('display_order');

  const { data: relationshipArchetypes } = await supabase
    .from('analysis_relationship_archetypes')
    .select('*')
    .eq('analysis_id', analysisId);

  const { data: relationshipDynamic } = await supabase
    .from('analysis_relationship_dynamic')
    .select('*')
    .eq('analysis_id', analysisId)
    .maybeSingle();

  const personArchetype = relationshipArchetypes?.find(a => a.person_type === 'person');
  const userArchetype = relationshipArchetypes?.find(a => a.person_type === 'user');

  // Map emotional profiles with archetype data
  const emotionalProfilesWithDetails = await Promise.all((emotionalProfiles || []).map(async (profile) => {
    // Fetch archetype image if archetype_id exists
    let illustrationUrl: string | undefined;
    console.log('[DEBUG] Profile archetype_id:', profile.archetype_id, 'for category:', profile.category_name);

    if (profile.archetype_id) {
      const { data: archetype, error } = await supabase
        .from('archetypes')
        .select('image_url')
        .eq('id', profile.archetype_id)
        .single();

      console.log('[DEBUG] Archetype query result:', { archetype, error, image_url: archetype?.image_url });
      illustrationUrl = archetype?.image_url;
    } else {
      console.log('[DEBUG] No archetype_id for profile:', profile.archetype_name);
    }

    return {
      archetypeId: profile.archetype_id || profile.id,
      name: profile.archetype_name,
      description: profile.personalized_description || profile.archetype_description || '',
      category: profile.category_name || 'Emotional Tone',
      categoryNumber: profile.display_order + 1,
      traits: profile.selected_traits || [],
      traitColors: [],
      gradientStart: profile.gradient_start,
      gradientEnd: profile.gradient_end,
      illustrationUrl
    };
  }));

  return {
    id: analysis.id,
    overallScore: analysis.overall_score,
    warmthScore: analysis.warmth_score,
    communicationScore: analysis.communication_score,
    dramaScore: analysis.drama_score,
    distanceScore: analysis.distance_score,
    passionScore: analysis.passion_score,
    profileType: analysis.profile_type,
    profileSubtitle: analysis.profile_subtitle,
    profileDescription: analysis.profile_description,
    isUnlocked: analysis.is_unlocked,
    unlockType: analysis.unlock_type,
    personGender: analysis.person_gender || 'male',
    personName,
    emotionalProfiles: emotionalProfilesWithDetails,
    messageInsights: (messageInsights || []).map(m => ({
      message: m.message_text,
      messageCount: m.message_count,
      title: m.insight_title,
      tag: m.insight_tag,
      tagColor: m.tag_color,
      description: m.description,
      solution: m.solution,
      gradientStart: m.gradient_start,
      gradientEnd: m.gradient_end,
      accentColor: m.accent_color
    })),
    personArchetype: personArchetype ? {
      name: personArchetype.archetype_name,
      title: personArchetype.archetype_title,
      description: personArchetype.description,
      traits: personArchetype.traits,
      traitColors: personArchetype.trait_colors,
      energyType: personArchetype.energy_type,
      imageUrl: personArchetype.image_url,
      gradientFrom: personArchetype.gradient_from,
      gradientTo: personArchetype.gradient_to,
      shareableTagline: personArchetype.shareable_tagline || ''
    } : {
      name: 'Unknown',
      title: 'The Mystery',
      description: 'Analysis incomplete',
      traits: [],
      traitColors: [],
      energyType: 'Neutral',
      imageUrl: '',
      gradientFrom: '#000000',
      gradientTo: '#333333',
      shareableTagline: ''
    },
    userArchetype: userArchetype ? {
      name: userArchetype.archetype_name,
      title: userArchetype.archetype_title,
      description: userArchetype.description,
      traits: userArchetype.traits,
      traitColors: userArchetype.trait_colors,
      energyType: userArchetype.energy_type,
      imageUrl: userArchetype.image_url,
      gradientFrom: userArchetype.gradient_from,
      gradientTo: userArchetype.gradient_to
    } : {
      name: 'Unknown',
      title: 'The Mystery',
      description: 'Analysis incomplete',
      traits: [],
      traitColors: [],
      energyType: 'Neutral',
      imageUrl: '',
      gradientFrom: '#000000',
      gradientTo: '#333333'
    },
    relationshipDynamic: relationshipDynamic ? {
      name: relationshipDynamic.name,
      subtitle: relationshipDynamic.subtitle,
      whyThisHappens: relationshipDynamic.why_this_happens,
      patternBreak: relationshipDynamic.pattern_break,
      powerBalance: relationshipDynamic.power_balance ?? 50
    } : {
      name: 'The Dynamic',
      subtitle: 'Still analyzing...',
      whyThisHappens: 'Analysis in progress',
      patternBreak: 'Check back soon',
      powerBalance: 50
    }
  };
}

// DEV MODE: Mock analysis result for development/testing
function getMockAnalysisResult(analysisId: string): StoredAnalysisResult {
  return {
    id: analysisId,
    overallScore: 72,
    warmthScore: 78,
    communicationScore: 65,
    dramaScore: 45,
    distanceScore: 38,
    passionScore: 82,
    profileType: 'The Sweet Poison',
    profileSubtitle: 'Charming but complicated',
    profileDescription: 'He draws you in with sweetness, but there are patterns worth watching.',
    isUnlocked: true,
    unlockType: 'free_first',
    personName: 'Him',
    processingStatus: 'completed',
    emotionalProfiles: [
      {
        archetypeId: 'mock-1',
        name: 'The Charmer',
        description: 'Uses charm and wit to keep you interested, but commitment remains unclear.',
        category: 'Communication Style',
        categoryNumber: 1,
        traits: ['Sweet talker', 'Inconsistent', 'Avoidant'],
        traitColors: ['#f59e0b', '#ef4444', '#8b5cf6'],
        gradientStart: '#f59e0b',
        gradientEnd: '#d97706',
        illustrationUrl: '/openart-image_SeQ6AwE2_1769430650812_raw.png'
      },
      {
        archetypeId: 'mock-2',
        name: 'The Puzzle',
        description: 'Hard to read, keeps you guessing about their true feelings.',
        category: 'Emotional Availability',
        categoryNumber: 2,
        traits: ['Mixed signals', 'Hot and cold', 'Mysterious'],
        traitColors: ['#8b5cf6', '#6366f1', '#3b82f6'],
        gradientStart: '#8b5cf6',
        gradientEnd: '#6366f1',
        illustrationUrl: '/openart-image_qimyfp0q_1769432612544_raw (1).png'
      }
    ],
    messageInsights: [
      {
        id: 'insight-1',
        message: '"I miss you" followed by 3 days of silence',
        messageCount: '4 times',
        title: 'Mixed Signals Alert',
        tag: 'RED FLAG',
        tagColor: '#E53935',
        description: 'Words and actions don\'t align. This pattern suggests inconsistent emotional availability.',
        solution: 'Pay attention to actions, not just words. Consistent behavior is what matters.',
        gradientStart: '#5C1A1A',
        gradientEnd: '#3D1212',
        accentColor: '#ff9d9d'
      },
      {
        id: 'insight-2',
        message: '"You\'re overthinking it"',
        messageCount: '3 times',
        title: 'Dismissive Pattern',
        tag: 'RED FLAG',
        tagColor: '#E53935',
        description: 'Dismissing your concerns is a way to avoid accountability.',
        solution: 'Your feelings are valid. Don\'t let anyone minimize them.',
        gradientStart: '#5C1A1A',
        gradientEnd: '#3D1212',
        accentColor: '#ff9d9d'
      },
      {
        id: 'insight-3',
        message: 'Good morning texts every day',
        messageCount: '7 times',
        title: 'Consistent Effort',
        tag: 'GREEN FLAG',
        tagColor: '#43A047',
        description: 'Daily check-ins show you\'re on their mind.',
        solution: 'Appreciate the consistency and reciprocate the effort.',
        gradientStart: '#1A3D2E',
        gradientEnd: '#0D2619',
        accentColor: '#9ddf90'
      }
    ],
    personArchetype: {
      name: 'Him',
      title: 'The Sweet Poison',
      tagline: 'Tastes like love. Burns like acid.',
      description: 'Tastes like love. Burns like acid. Every word drips honey, but somehow you always feel smaller after talking to him.',
      traits: ['Manipulative', 'Charming', 'Corrosive'],
      traitColors: ['#F75221', '#E01F01', '#E0B118'],
      energyType: 'Toxic Energy',
      imageUrl: getMaleSoulTypeByName('The Sweet Poison')?.normalImage || '',
      sideProfileImageUrl: getMaleSoulTypeByName('The Sweet Poison')?.sideProfileImage || '',
      gradientFrom: '#2d1b4e',
      gradientTo: '#150d26',
      shareableTagline: 'Sweet words, slow poison'
    },
    userArchetype: {
      name: 'You',
      title: 'The Love Rush',
      tagline: 'Ready to love before hello.',
      description: 'Ready to love before hello. She catches feelings like other people catch colds: fast, hard, and with no warning.',
      traits: ['Hopeless romantic', 'Fast-falling', 'All heart'],
      traitColors: ['#2A9D8F', '#1B5B54', '#3ABAA8'],
      energyType: 'Rush Energy',
      imageUrl: getFemaleSoulTypeByName('The Love Rush')?.normalImage || '',
      sideProfileImageUrl: getFemaleSoulTypeByName('The Love Rush')?.sideProfileImage || '',
      gradientFrom: '#4d1a3d',
      gradientTo: '#26101e'
    },
    relationshipDynamic: {
      name: 'The Push-Pull',
      subtitle: 'Hot and cold, back and forth',
      whyThisHappens: 'One person craves closeness while the other fears it. This creates a cycle of pursuit and retreat.',
      patternBreak: 'Stop chasing. Let them come to you. If they don\'t, you have your answer.',
      powerBalance: 35
    }
  };
}

// ============================================
// TWO-PHASE PROGRESSIVE LOADING
// ============================================

// Status: pending -> quick_ready -> completed | error
export type AnalysisStatus = 'pending' | 'quick_ready' | 'completed' | 'error';

/**
 * Get the status of an analysis (for polling during loading)
 * - 'pending': Still processing Phase 1 (quick analysis)
 * - 'quick_ready': Phase 1 done (score + soul type visible), Phase 2 in progress
 * - 'completed': Both phases done (all cards visible)
 * - 'error': Something failed
 */
export function getAnalysisStatus(analysisId: string): AnalysisStatus {
  // LOCAL MODE: Check localStorage for dev-analysis-* IDs
  if (analysisId.startsWith('dev-analysis-')) {
    const status = localStorage.getItem('analysis_status_' + analysisId);
    return (status as AnalysisStatus) || 'pending';
  }

  // For production (Supabase mode), we'd check processing_status
  return 'completed';
}

/**
 * Start an analysis with TWO-PHASE loading:
 * Phase 1 (~5-6s): Quick analysis - scores + archetypes
 * Phase 2 (background): Detailed analysis - cards + insights
 */
export async function startAnalysis(personId: string, imageFiles: File[]): Promise<string> {
  console.log('startAnalysis: Starting TWO-PHASE analysis with personId:', personId, 'files:', imageFiles.length);

  // DEV/FALLBACK MODE: Use localStorage + real Gemini API
  // Triggered in dev mode OR when Supabase is unavailable (person creation failed)
  if (personId.startsWith('dev-')) {
    const devAnalysisId = 'dev-analysis-' + Date.now();

    // Set initial status to pending
    localStorage.setItem('analysis_status_' + devAnalysisId, 'pending');

    console.log('[LOCAL MODE] startAnalysis: Created ID:', devAnalysisId, '- starting two-phase processing');

    // Start two-phase processing (don't await - runs in background)
    processTwoPhaseAnalysis(devAnalysisId, imageFiles);

    return devAnalysisId;
  }

  // PRODUCTION MODE: Use existing processAnalysis (Supabase)
  return await processAnalysis(personId, imageFiles);
}

/**
 * TWO-PHASE background processing for DEV MODE
 * Phase 1: Quick analysis (~5-6s) - shows score + soul type
 * Phase 2: Detailed analysis (background) - shows cards
 */
async function processTwoPhaseAnalysis(analysisId: string, imageFiles: File[]): Promise<void> {
  // ═══════════════════════════════════════════════════════════
  // DEMO MODE: Skip AI, return hardcoded super-toxic result
  // ═══════════════════════════════════════════════════════════
  const DEMO_MODE = true; // ← SET TO false TO USE REAL GEMINI AI
  if (DEMO_MODE) {
    console.log('[DEMO MODE] Returning hardcoded toxic result');

    const demoResult: StoredAnalysisResult = {
      id: analysisId,
      overallScore: 88,
      warmthScore: 14,
      communicationScore: 18,
      dramaScore: 82,
      distanceScore: 88,
      passionScore: 10,
      profileType: 'Walking Red Flag',
      profileSubtitle: 'Run and never look back',
      profileDescription: 'Girl this man is a whole crime scene in a hoodie.',
      isUnlocked: true,
      unlockType: 'free_first',
      personName: 'Him',
      personGender: 'male',
      processingStatus: 'completed',
      emotionalProfiles: [
        {
          archetypeId: 'demo-1',
          name: 'Intentions',
          description: 'He keeps you around for validation, not connection. Every "wyd" at 2am is a power move — he reaches out only when he needs his ego fed. There\'s no plan for you in his future, just a revolving door he controls.',
          category: 'Intentions',
          categoryNumber: 1,
          traits: ['Breadcrumbing', 'Ego-driven', 'No commitment'],
          traitColors: ['#E53935', '#FF7043', '#EF5350'],
          gradientStart: '#E53935',
          gradientEnd: '#B71C1C',
          specificExamples: ['His "I miss you" at 1am after ignoring you all day is textbook breadcrumbing — just enough to keep you hooked.', 'He dodged "what are we" three times. That IS your answer.'],
        },
        {
          archetypeId: 'demo-2',
          name: 'Chemistry',
          description: 'The chemistry here is one-sided — you bring the fire, he brings a lighter and watches you burn. His charm is calculated, not genuine. He mirrors just enough of your energy to keep you engaged.',
          category: 'Chemistry',
          categoryNumber: 2,
          traits: ['One-sided effort', 'Calculated charm', 'Mirroring'],
          traitColors: ['#FF7043', '#E53935', '#D32F2F'],
          gradientStart: '#FF7043',
          gradientEnd: '#D84315',
          specificExamples: ['You wrote a whole paragraph. He sent "lol ok." That\'s not matching energy — that\'s contempt.', 'He only flirts when you pull away. Classic push-pull manipulation.'],
        },
        {
          archetypeId: 'demo-3',
          name: 'Effort',
          description: 'His effort is nonexistent. You plan every date, initiate every conversation, and carry the emotional weight of two people. He coasts on your investment while giving nothing back.',
          category: 'Effort',
          categoryNumber: 3,
          traits: ['Zero initiative', 'You do everything', 'Emotional freeloader'],
          traitColors: ['#EF5350', '#E53935', '#C62828'],
          gradientStart: '#EF5350',
          gradientEnd: '#C62828',
          specificExamples: ['You\'ve initiated the last 11 conversations. He started zero.', 'He "forgot" your birthday but posted on his story the same day.'],
        },
        {
          archetypeId: 'demo-4',
          name: 'Red Flags & Green Flags',
          description: 'All red, no green. Gaslighting when confronted, dismissing your feelings as "drama," and disappearing acts are not quirks — they\'re patterns of emotional manipulation.',
          category: 'Red Flags & Green Flags',
          categoryNumber: 4,
          traits: ['Gaslighting', 'Dismissive', 'Disappearing acts'],
          traitColors: ['#E53935', '#D32F2F', '#B71C1C'],
          gradientStart: '#D32F2F',
          gradientEnd: '#8E0000',
          specificExamples: ['"You\'re being dramatic" after HE ghosted for 5 days is textbook DARVO.', '"She\'s just a friend" but the friend is commenting hearts on every pic.'],
        },
        {
          archetypeId: 'demo-5',
          name: 'Trajectory',
          description: 'This is going nowhere and he knows it. He\'ll keep you in a situationship limbo as long as you let him — because commitment means accountability, and accountability means he can\'t do whatever he wants.',
          category: 'Trajectory',
          categoryNumber: 5,
          traits: ['Situationship forever', 'Avoids labels', 'Dead end'],
          traitColors: ['#B71C1C', '#E53935', '#EF5350'],
          gradientStart: '#B71C1C',
          gradientEnd: '#4E0000',
          specificExamples: ['6 months in and you still can\'t call him your boyfriend. The ambiguity is intentional.', 'He said "let\'s see where this goes" — it went nowhere.'],
        },
      ],
      messageInsights: [
        {
          id: 'demo-i1',
          message: 'lol ok whatever you say',
          messageCount: '',
          title: 'The Shutdown',
          tag: 'RED FLAG',
          tagColor: '#E53935',
          description: 'He\'s punishing you with indifference for having feelings.',
          solution: 'That "lol ok" isn\'t casual — it\'s calculated. He read your whole message, felt challenged, and chose the response that would make you feel the smallest. The laugh is the cruelest part: it says your emotions are entertainment to him.',
          gradientStart: '#5C1A1A',
          gradientEnd: '#3D1212',
          accentColor: '#ff9d9d',
        },
        {
          id: 'demo-i2',
          message: 'she\'s just a friend calm down',
          messageCount: '',
          title: 'The Gaslight Special',
          tag: 'RED FLAG',
          tagColor: '#E53935',
          description: '"Calm down" is his way of making YOUR reaction the problem.',
          solution: 'He flipped it — now YOU\'RE the crazy one for noticing the girl commenting fire emojis on every photo. "She\'s just a friend" plus "calm down" is a two-hit combo: deny the evidence, then shame you for seeing it. He\'s not defending himself, he\'s attacking your perception.',
          gradientStart: '#5C1A1A',
          gradientEnd: '#3D1212',
          accentColor: '#ff9d9d',
        },
        {
          id: 'demo-i3',
          message: 'i said i was sorry what more do you want',
          messageCount: '',
          title: 'The Non-Apology',
          tag: 'RED FLAG',
          tagColor: '#E53935',
          description: 'His "sorry" is a transaction — he thinks saying it once buys him a clean slate.',
          solution: 'This isn\'t remorse, it\'s impatience. He\'s not sorry he hurt you — he\'s annoyed that his five-letter word didn\'t make the problem disappear. "What more do you want" reveals it: he sees your pain as an inconvenience, not something he caused.',
          gradientStart: '#5C1A1A',
          gradientEnd: '#3D1212',
          accentColor: '#ff9d9d',
        },
        {
          id: 'demo-i4',
          message: 'you always do this',
          messageCount: '',
          title: 'The Deflection',
          tag: 'DECODED',
          tagColor: '#7C4DFF',
          description: 'He\'s rewriting history to make you the villain of his story.',
          solution: '"You always do this" is a panic button. He hit it because you got too close to the truth. Instead of addressing what he did, he\'s drowning the conversation in vague accusations. He doesn\'t mean "you always do this" — he means "stop holding me accountable."',
          gradientStart: '#2A1A4E',
          gradientEnd: '#1A0F33',
          accentColor: '#B39DDB',
        },
        {
          id: 'demo-i5',
          message: 'good morning beautiful ❤️',
          messageCount: '',
          title: 'The Love Bomb',
          tag: 'DECODED',
          tagColor: '#7C4DFF',
          description: 'Sweet words after silence — this is the reset button, not affection.',
          solution: 'This "good morning beautiful" came 48 hours after he ghosted your last 3 messages. It\'s not love — it\'s a reset button. He knows one sweet text erases days of neglect in your mind. The heart emoji is strategic: maximum emotional impact, zero actual effort.',
          gradientStart: '#2A1A4E',
          gradientEnd: '#1A0F33',
          accentColor: '#B39DDB',
        },
      ],
      personArchetype: {
        name: 'Him',
        title: 'The Burning Promise',
        tagline: 'Soulmate energy week one. Stranger by month two.',
        description: 'All grand gestures, future plans, and "I\'ve never felt this way before." He made you the center of his universe so fast you didn\'t notice the expiration date. You didn\'t do anything wrong. He just burned through you.',
        traits: ['Love Bomber', 'Future Faker', 'Intensity Addict', 'Fast Burner', 'Emotionally Volatile'],
        traitColors: ['#FF6D00', '#FF3D00', '#DD2C00', '#FF9100', '#E65100'],
        energyType: 'Explosive Energy',
        imageUrl: getMaleSoulTypeByName('The Burning Promise')?.normalImage || '',
        sideProfileImageUrl: getMaleSoulTypeByName('The Burning Promise')?.sideProfileImage || '',
        gradientFrom: '#2d1b4e',
        gradientTo: '#150d26',
        shareableTagline: 'Reflects your wounds back at you',
      },
      userArchetype: {
        name: 'You',
        title: 'The Love Rush',
        tagline: 'Ready to love before hello.',
        description: 'You love with your whole chest and zero hesitation. You see the best in people even when they show you the worst — not because you\'re naive, but because your heart genuinely believes everyone deserves a chance. That\'s beautiful. But it\'s also why you stayed this long.',
        traits: ['All-in lover', 'Sees the best', 'Emotionally brave', 'Loyal to a fault', 'Hope-driven'],
        traitColors: ['#2A9D8F', '#1B5B54', '#3ABAA8', '#4DB6AC', '#26A69A'],
        energyType: 'Rush Energy',
        imageUrl: getFemaleSoulTypeByName('The Love Rush')?.normalImage || '',
        sideProfileImageUrl: getFemaleSoulTypeByName('The Love Rush')?.sideProfileImage || '',
        gradientFrom: '#4d1a3d',
        gradientTo: '#26101e',
      },
      relationshipDynamic: {
        name: 'The Guilt Trap',
        subtitle: 'You apologize for his mistakes',
        whyThisHappens: 'He trained you to feel guilty for having needs. Every time you brought something up, he flipped it until YOU were the one saying sorry. Now you second-guess every emotion before you even feel it.',
        patternBreak: 'Stop apologizing for having standards. Your needs aren\'t drama — his inability to meet them is.',
        powerBalance: 22,
      },
    };

    // Store as Phase 1 (quick) result first
    localStorage.setItem('dev_analysis_result_' + analysisId, JSON.stringify(demoResult));
    localStorage.setItem('analysis_status_' + analysisId, 'quick_ready');

    // Simulate Phase 2 delay (1 second)
    await new Promise(r => setTimeout(r, 1000));

    // Mark as fully complete
    localStorage.setItem('dev_analysis_result_' + analysisId, JSON.stringify(demoResult));
    localStorage.setItem('analysis_status_' + analysisId, 'completed');
    console.log('[DEMO MODE] Result stored, status: completed');
    return;
  }

  let extraction: ExtractionResult | null = null;

  try {
    // ============ PHASE 1: Quick Analysis (~5-6s) ============
    console.log('[DEV MODE] PHASE 1: Starting quick analysis...');

    const { quick, extraction: ext } = await analyzeQuick(imageFiles);
    extraction = ext; // Save for Phase 2

    console.log('[DEV MODE] PHASE 1 COMPLETE:', quick);

    // HYBRID MATCHING: Client-side Soul Type matching based on observed behaviors
    const personMatched = matchAndBuildArchetype(quick.personArchetype, 'male');
    const userMatched = matchAndBuildArchetype(quick.userArchetype, 'female');

    console.log('[DEV MODE] PHASE 1 Hybrid matching:');
    console.log(`  Person: "${personMatched.title}" (${(personMatched.confidence * 100).toFixed(0)}%)`);
    console.log(`  User: "${userMatched.title}" (${(userMatched.confidence * 100).toFixed(0)}%)`);

    // ============ PHASE 1.5: Personalize Soul Type descriptions ============
    console.log('[DEV MODE] PHASE 1.5: Personalizing Soul Type descriptions...');

    const personGender = (quick.personGender || 'male') as 'male' | 'female';
    const userGender = personGender === 'male' ? 'female' : 'male';

    let phase15Timeout: ReturnType<typeof setTimeout>;
    const personalizationResult = await Promise.race([
      generatePersonalizedSoulTypeDescriptions(
        {
          soulTypeName: personMatched.title,
          soulTypeTagline: personMatched.tagline,
          soulTypeDescription: personMatched.description,
          soulTypeTraits: personMatched.traits,
          observedBehaviors: personMatched.aiObservedBehaviors,
          evidenceMessages: personMatched.aiEvidenceMessages,
          gender: personGender,
        },
        {
          soulTypeName: userMatched.title,
          soulTypeTagline: userMatched.tagline,
          soulTypeDescription: userMatched.description,
          soulTypeTraits: userMatched.traits,
          observedBehaviors: userMatched.aiObservedBehaviors,
          evidenceMessages: userMatched.aiEvidenceMessages,
          gender: userGender,
        }
      ),
      // 4-second timeout safety net
      new Promise<null>((resolve) => {
        phase15Timeout = setTimeout(() => {
          console.warn('[Soul Type Personalization] Timeout after 4s, using predefined descriptions');
          resolve(null);
        }, 4000);
      })
    ]);
    clearTimeout(phase15Timeout!);

    // Apply personalized descriptions if available, otherwise keep predefined
    if (personalizationResult) {
      personMatched.description = personalizationResult.person.description;
      personMatched.traits = personalizationResult.person.traits;
      userMatched.description = personalizationResult.user.description;
      userMatched.traits = personalizationResult.user.traits;
      console.log('[Soul Type Personalization] Applied personalized descriptions!');
    } else {
      console.log('[Soul Type Personalization] Using predefined descriptions (fallback)');
    }

    // Use matched archetype data
    const personImageUrl = personMatched.imageUrl;
    const userImageUrl = userMatched.imageUrl;
    const personArchetypeGradient = { from: personMatched.gradientFrom, to: personMatched.gradientTo };

    const partialResult: StoredAnalysisResult = {
      id: analysisId,
      overallScore: quick.scores.overall,
      warmthScore: quick.scores.warmth,
      communicationScore: quick.scores.communication,
      dramaScore: quick.scores.drama,
      distanceScore: quick.scores.distance,
      passionScore: quick.scores.passion,
      profileType: quick.profile.type,
      profileSubtitle: quick.profile.subtitle,
      profileDescription: quick.profile.description,
      isUnlocked: true,
      unlockType: 'dev_mode',
      personGender: quick.personGender || 'male',
      personName: 'Him',  // Never use AI-extracted name; the UI uses the user-assigned name
      // Empty arrays for Phase 2 data (will be populated later)
      emotionalProfiles: [],
      messageInsights: [],
      personArchetype: {
        name: personMatched.name,
        title: personMatched.title,  // From hybrid matching
        tagline: personMatched.tagline,  // Soul Type's predefined tagline
        description: personMatched.description,
        traits: personMatched.traits,
        traitColors: ['#F75221', '#E01F01', '#E0B118'],
        energyType: personMatched.energyType,  // From hybrid matching
        imageUrl: personMatched.imageUrl,
        sideProfileImageUrl: personMatched.sideProfileImageUrl,
        gradientFrom: personMatched.gradientFrom,
        gradientTo: personMatched.gradientTo,
        shareableTagline: personMatched.shareableTagline || ''
      },
      userArchetype: {
        name: userMatched.name,
        title: userMatched.title,  // From hybrid matching
        tagline: userMatched.tagline,  // Soul Type's predefined tagline
        description: userMatched.description,
        traits: userMatched.traits,
        traitColors: ['#2A9D8F', '#1B5B54', '#3ABAA8'],
        energyType: userMatched.energyType,  // From hybrid matching
        imageUrl: userMatched.imageUrl,
        sideProfileImageUrl: userMatched.sideProfileImageUrl,
        gradientFrom: userMatched.gradientFrom,
        gradientTo: userMatched.gradientTo
      },
      // Placeholder for dynamic (will be updated in Phase 2)
      relationshipDynamic: {
        name: 'Analyzing...',
        subtitle: 'Loading dynamic...',
        whyThisHappens: '',
        patternBreak: '',
        powerBalance: 50
      }
    };

    // Store partial result and mark Phase 1 complete
    localStorage.setItem('dev_analysis_result_' + analysisId, JSON.stringify(partialResult));
    localStorage.setItem('analysis_status_' + analysisId, 'quick_ready');

    console.log('[DEV MODE] PHASE 1: Status set to quick_ready. User can now see score + soul type!');

    // ============ PHASE 2: Detailed Analysis (background) ============
    console.log('[DEV MODE] PHASE 2: Starting detailed analysis...');

    const detailed = await analyzeDetailed(extraction, quick.reasoning);

    console.log('[DEV MODE] PHASE 2 COMPLETE - Raw detailed result:', JSON.stringify(detailed, null, 2));
    console.log('[DEV MODE] PHASE 2 - categoryAnalysis keys:', Object.keys(detailed.categoryAnalysis || {}));
    console.log('[DEV MODE] PHASE 2 - Each category personalizedDescription:');
    if (detailed.categoryAnalysis) {
      Object.entries(detailed.categoryAnalysis).forEach(([key, val]) => {
        console.log(`  ${key}: "${val?.personalizedDescription}" (${val?.personalizedDescription?.length || 0} chars)`);
      });
    }
    console.log('[DEV MODE] PHASE 2 - messageInsights count:', detailed.messageInsights?.length);
    if (detailed.messageInsights) {
      detailed.messageInsights.forEach((m, i) => {
        console.log(`  Insight ${i}: title="${m.title}", message="${m.message?.substring(0, 30)}..."`);
      });
    }

    // Merge Phase 2 data into result
    const fullResult: StoredAnalysisResult = {
      ...partialResult,
      emotionalProfiles: Object.entries(detailed.categoryAnalysis).map(([key, analysis], index) => {
        const categoryNames: Record<string, string> = {
          redFlagsGreenFlags: 'Red Flags & Green Flags',
          effort: 'Effort',
          intentions: 'Intentions',
          chemistry: 'Chemistry',
          trajectory: 'Trajectory'
        };

        // Build a fallback description from semantic tags if personalizedDescription is empty
        let description = analysis.personalizedDescription;
        if (!description || description.trim() === '') {
          // Fallback: use semantic tags to create a description
          const tags = analysis.semanticTags || [];
          const patterns = analysis.behaviorPatterns || [];
          if (tags.length > 0 || patterns.length > 0) {
            description = `Pattern detected: ${[...tags, ...patterns].slice(0, 3).join(', ')}.`;
          } else {
            description = `${categoryNames[key]} analysis based on chat patterns.`;
          }
          console.log(`[DEV MODE] Empty personalizedDescription for ${key}, using fallback: "${description}"`);
        }

        return {
          archetypeId: `dev-${key}`,
          name: key,
          description: description,
          category: categoryNames[key] || key,
          categoryNumber: index + 1,
          traits: analysis.personalizedTraits || [],
          traitColors: ['#8B5CF6', '#EC4899', '#F59E0B', '#10B981'],
          gradientStart: '#1a1a3e',
          gradientEnd: '#0d0d1f',
        };
      }),
      messageInsights: (detailed.messageInsights && detailed.messageInsights.length > 0)
        ? detailed.messageInsights
        : (() => {
            console.log('[DEV MODE] WARNING: No messageInsights from Phase 2, this section will be empty');
            return [];
          })(),
      relationshipDynamic: detailed.relationshipDynamic || {
        name: 'The Dynamic',
        subtitle: 'Analysis complete',
        whyThisHappens: 'Based on chat patterns',
        patternBreak: 'Take action based on insights',
        powerBalance: 50
      }
    };

    // Store full result and mark completed
    console.log('[DEV MODE] PHASE 2: Full result being stored:', {
      emotionalProfilesCount: fullResult.emotionalProfiles.length,
      emotionalProfiles: fullResult.emotionalProfiles.map(p => ({ name: p.name, category: p.category, descLength: p.description?.length })),
      messageInsightsCount: fullResult.messageInsights.length,
      messageInsights: fullResult.messageInsights.map(m => ({ title: m.title, messageLength: m.message?.length }))
    });
    localStorage.setItem('dev_analysis_result_' + analysisId, JSON.stringify(fullResult));
    localStorage.setItem('analysis_status_' + analysisId, 'completed');

    console.log('[DEV MODE] PHASE 2: Status set to completed. All cards now visible!');

  } catch (error) {
    console.error('[DEV MODE] Two-phase processing failed:', error);
    localStorage.setItem('analysis_status_' + analysisId, 'error');
  }
}
