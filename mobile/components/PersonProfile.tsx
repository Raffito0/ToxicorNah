import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ToxicOrb } from '@/components/ToxicOrb';
import { SoulTypeMedia } from '@/components/SoulTypeMedia';
import { MetricBar } from '@/components/MetricBar';
import { Colors, Fonts } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ===== Types =====

interface PersonProfileData {
  person: {
    id: string;
    name: string;
    avatar: string | null;
    totalAnalyses: number;
  };
  verdict: {
    overallScore: number;
    warmthScore: number;
    communicationScore: number;
    dramaScore: number;
    distanceScore: number;
    passionScore: number;
    scoreDelta: number;
  };
  archetype: {
    title: string;
    tagline: string;
    description: string;
    imageUrl: string;
    sideProfileImageUrl: string;
    traits: string[];
    gradientFrom: string;
    gradientTo: string;
    energyType: string;
  };
  latestAnalysisId: string | null;
}

// ===== Data Fetching =====

const DEV_MODE = __DEV__;

function createMockProfile(personId: string): PersonProfileData {
  const mockProfiles: Record<string, PersonProfileData> = {
    'dev-alex-1': {
      person: {
        id: 'dev-alex-1',
        name: 'Alex',
        avatar: null,
        totalAnalyses: 45,
      },
      verdict: {
        overallScore: 70,
        warmthScore: 35,
        communicationScore: 45,
        dramaScore: 80,
        distanceScore: 72,
        passionScore: 60,
        scoreDelta: 5,
      },
      archetype: {
        title: 'The Sweet Poison',
        tagline: 'Charming on the surface, toxic underneath',
        description:
          'He draws you in with warmth and attention, but the deeper you go, the more you realize the sweetness was the setup.',
        imageUrl: '',
        sideProfileImageUrl: '',
        traits: ['Charming', 'Manipulative', 'Hot-Cold'],
        gradientFrom: '#4A1A2E',
        gradientTo: '#1A0A15',
        energyType: 'Dark Energy',
      },
      latestAnalysisId: 'dev-analysis-1',
    },
    'dev-marcus-2': {
      person: {
        id: 'dev-marcus-2',
        name: 'Marcus',
        avatar: null,
        totalAnalyses: 12,
      },
      verdict: {
        overallScore: 35,
        warmthScore: 70,
        communicationScore: 65,
        dramaScore: 20,
        distanceScore: 40,
        passionScore: 55,
        scoreDelta: -8,
      },
      archetype: {
        title: 'The Ghost',
        tagline: 'Now you see him, now you don\'t',
        description:
          'He\'s there when it\'s convenient and vanishes when things get real. You\'re always the one reaching out first.',
        imageUrl: '',
        sideProfileImageUrl: '',
        traits: ['Avoidant', 'Inconsistent', 'Mysterious'],
        gradientFrom: '#1A2A3A',
        gradientTo: '#0A1520',
        energyType: 'Shadow Energy',
      },
      latestAnalysisId: 'dev-analysis-2',
    },
  };

  return (
    mockProfiles[personId] || {
      person: {
        id: personId,
        name: 'Unknown',
        avatar: null,
        totalAnalyses: 0,
      },
      verdict: {
        overallScore: 50,
        warmthScore: 50,
        communicationScore: 50,
        dramaScore: 50,
        distanceScore: 50,
        passionScore: 50,
        scoreDelta: 0,
      },
      archetype: {
        title: 'Unknown',
        tagline: '',
        description: '',
        imageUrl: '',
        sideProfileImageUrl: '',
        traits: [],
        gradientFrom: '#162a3d',
        gradientTo: '#0b1520',
        energyType: 'Unknown',
      },
      latestAnalysisId: null,
    }
  );
}

async function fetchPersonProfile(
  personId: string
): Promise<PersonProfileData | null> {
  if (DEV_MODE) {
    try {
      const stored = await AsyncStorage.getItem(`dev_person_${personId}`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return createMockProfile(personId);
  }

  // Production: Fetch from Supabase
  const { data: person, error: personError } = await supabase
    .from('persons')
    .select('*')
    .eq('id', personId)
    .single();

  if (personError || !person) return null;

  // Get all completed analyses for this person
  const { data: analyses } = await supabase
    .from('analysis_results')
    .select('*')
    .eq('person_id', personId)
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false })
    .limit(2);

  if (!analyses || analyses.length === 0) return null;

  const latest = analyses[0];
  const previous = analyses.length > 1 ? analyses[1] : null;
  const scoreDelta = previous
    ? latest.overall_score - previous.overall_score
    : 0;

  // Get archetype info
  const { data: archetype } = await supabase
    .from('analysis_relationship_archetypes')
    .select('*')
    .eq('analysis_id', latest.id)
    .eq('person_type', 'person')
    .maybeSingle();

  // Total analyses count
  const { count: totalCount } = await supabase
    .from('analysis_results')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', personId)
    .eq('processing_status', 'completed');

  return {
    person: {
      id: person.id,
      name: person.name || 'Him',
      avatar: person.avatar_url || null,
      totalAnalyses: totalCount || 1,
    },
    verdict: {
      overallScore: latest.overall_score || 50,
      warmthScore: latest.warmth_score || 50,
      communicationScore: latest.communication_score || 50,
      dramaScore: latest.drama_score || 50,
      distanceScore: latest.distance_score || 50,
      passionScore: latest.passion_score || 50,
      scoreDelta,
    },
    archetype: {
      title: archetype?.archetype_title || 'Unknown',
      tagline: archetype?.tagline || '',
      description: archetype?.description || '',
      imageUrl: archetype?.image_url || '',
      sideProfileImageUrl: archetype?.side_profile_image_url || '',
      traits: archetype?.traits || [],
      gradientFrom: archetype?.gradient_from || '#162a3d',
      gradientTo: archetype?.gradient_to || '#0b1520',
      energyType: archetype?.energy_type || 'Unknown Energy',
    },
    latestAnalysisId: latest.id,
  };
}

// ===== Helpers =====

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function getScoreColor(score: number): string {
  if (score <= 30) return Colors.safeZone;
  if (score <= 60) return Colors.riskyZone;
  return Colors.toxicZone;
}

function getToxicityLabel(score: number): string {
  if (score <= 30) return 'Barely a Red Flag';
  if (score <= 50) return 'Low-key Toxic';
  if (score <= 65) return 'Certified Toxic';
  if (score <= 80) return 'Dangerously Toxic';
  return 'Run.';
}

function getMetricColor(value: number): string {
  // For sub-scores: higher = worse (more toxic behavior in that area)
  if (value <= 30) return Colors.safeZone;
  if (value <= 60) return Colors.riskyZone;
  return Colors.toxicZone;
}

// ===== Trait Pill =====

function TraitPill({ trait }: { trait: string }) {
  const words = trait.split(' ');
  const display = words.slice(0, 2).join(' ');

  return (
    <View style={styles.traitPill}>
      <Text style={styles.traitPillText}>{display.toUpperCase()}</Text>
    </View>
  );
}

// ===== Main Component =====

interface PersonProfileProps {
  personId: string;
}

export function PersonProfile({ personId }: PersonProfileProps) {
  const router = useRouter();
  const [data, setData] = useState<PersonProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await fetchPersonProfile(personId);
      setData(profile);
    } catch (err) {
      console.error('Failed to load person profile:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // ===== Loading State =====
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="rgba(255,255,255,0.3)" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  // ===== Error/Not Found State =====
  if (!data) {
    return (
      <View style={styles.container}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={24} color={Colors.white} />
        </Pressable>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Person not found</Text>
        </View>
      </View>
    );
  }

  const { person, verdict, archetype, latestAnalysisId } = data;
  const scoreColor = getScoreColor(verdict.overallScore);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ===== HERO SECTION ===== */}
      <View style={styles.heroSection}>
        {/* Blurred archetype background */}
        {archetype.imageUrl ? (
          <Image
            source={{ uri: archetype.imageUrl }}
            style={styles.heroBgImage}
            contentFit="cover"
            blurRadius={18}
          />
        ) : (
          <LinearGradient
            colors={[archetype.gradientFrom, archetype.gradientTo]}
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* Bottom fade */}
        <LinearGradient
          colors={['transparent', Colors.background]}
          locations={[0, 1]}
          style={styles.heroBottomFade}
        />

        {/* Back button */}
        <Pressable
          onPress={() => router.back()}
          style={styles.heroBackButton}
        >
          <ChevronLeft size={24} color={Colors.white} />
        </Pressable>

        {/* Content */}
        <View style={styles.heroContent}>
          {/* Avatar */}
          <View style={styles.avatarContainer}>
            <View style={[styles.avatarRing, { borderColor: `${scoreColor}60` }]}>
              {person.avatar ? (
                <Image
                  source={{ uri: person.avatar }}
                  style={styles.avatarImage}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>
                    {person.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            {/* Analysis count badge */}
            <View style={[styles.analysisBadge, { backgroundColor: scoreColor }]}>
              <Text style={styles.analysisBadgeText}>{person.totalAnalyses}</Text>
            </View>
          </View>

          {/* Person name */}
          <Text style={styles.heroName}>{person.name}</Text>

          {/* Archetype title */}
          <Text style={styles.heroArchetypeTitle}>{archetype.title}</Text>

          {/* Description */}
          {archetype.description ? (
            <Text style={styles.heroDescription}>{archetype.description}</Text>
          ) : null}
        </View>
      </View>

      {/* ===== TOXICITY VERDICT ===== */}
      <Animated.View entering={FadeInDown.delay(200).duration(600)} style={styles.sectionPadding}>
        <Text style={styles.sectionLabel}>THE VERDICT</Text>
        <Text style={styles.sectionTitle}>Toxicity Score</Text>

        {/* Score Orb + Label */}
        <View style={styles.verdictRow}>
          <ToxicOrb score={verdict.overallScore} size={120} />
          <View style={styles.verdictInfo}>
            <Text style={[styles.verdictLabel, { color: scoreColor }]}>
              {getToxicityLabel(verdict.overallScore)}
            </Text>
            {verdict.scoreDelta !== 0 && (
              <Text
                style={[
                  styles.verdictDelta,
                  {
                    color:
                      verdict.scoreDelta > 0 ? Colors.toxicZone : Colors.safeZone,
                  },
                ]}
              >
                {verdict.scoreDelta > 0 ? '+' : ''}
                {verdict.scoreDelta} since last analysis
              </Text>
            )}
          </View>
        </View>
      </Animated.View>

      {/* ===== SCORE BREAKDOWN ===== */}
      <Animated.View entering={FadeInDown.delay(400).duration(600)} style={styles.sectionPadding}>
        <Text style={styles.sectionLabel}>BREAKDOWN</Text>
        <Text style={styles.sectionTitle}>Sub-Scores</Text>

        <View style={styles.metricsContainer}>
          <MetricBar
            label="Warmth"
            value={verdict.warmthScore}
            color={getMetricColor(verdict.warmthScore)}
          />
          <MetricBar
            label="Communication"
            value={verdict.communicationScore}
            color={getMetricColor(verdict.communicationScore)}
          />
          <MetricBar
            label="Drama"
            value={verdict.dramaScore}
            color={getMetricColor(verdict.dramaScore)}
          />
          <MetricBar
            label="Distance"
            value={verdict.distanceScore}
            color={getMetricColor(verdict.distanceScore)}
          />
          <MetricBar
            label="Passion"
            value={verdict.passionScore}
            color={getMetricColor(verdict.passionScore)}
          />
        </View>
      </Animated.View>

      {/* ===== SOUL TYPE CARD ===== */}
      <Animated.View entering={FadeInDown.delay(600).duration(600)} style={styles.sectionPadding}>
        <Text style={styles.sectionLabel}>HIS SOUL TYPE</Text>
        <Text style={styles.sectionTitle}>{archetype.title}</Text>

        <View style={styles.archetypeCard}>
          {/* Full image background */}
          {archetype.imageUrl ? (
            <SoulTypeMedia
              src={archetype.imageUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <LinearGradient
              colors={[archetype.gradientFrom, archetype.gradientTo]}
              style={StyleSheet.absoluteFill}
            />
          )}

          {/* Gradient overlay */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.9)']}
            locations={[0.3, 0.6, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Card content */}
          <View style={styles.archetypeCardContent}>
            <Text style={styles.archetypeCardTitle}>{archetype.title}</Text>
            <Text style={styles.archetypeCardTagline}>{archetype.tagline}</Text>

            {/* Trait Pills */}
            {archetype.traits.length > 0 && (
              <View style={styles.traitPillRow}>
                {archetype.traits.slice(0, 3).map((trait, i) => (
                  <TraitPill key={i} trait={trait} />
                ))}
              </View>
            )}
          </View>
        </View>
      </Animated.View>

      {/* ===== VIEW LATEST ANALYSIS CTA ===== */}
      {latestAnalysisId && (
        <Animated.View entering={FadeInDown.delay(800).duration(600)} style={styles.sectionPadding}>
          <Pressable
            onPress={() => router.push(`/results/${latestAnalysisId}`)}
            style={({ pressed }) => [
              styles.viewAnalysisCTA,
              pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
            ]}
          >
            <Text style={styles.viewAnalysisCTAText}>VIEW LATEST ANALYSIS</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Bottom spacer */}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ===== Styles =====

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textDim,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
  },

  // Back button (non-hero context)
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 50,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Hero Section
  heroSection: {
    position: 'relative',
    width: '100%',
    minHeight: 360,
    overflow: 'hidden',
  },
  heroBgImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  heroBottomFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  heroBackButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 50,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroContent: {
    position: 'relative',
    zIndex: 3,
    alignItems: 'center',
    paddingTop: 70,
    paddingBottom: 24,
    paddingHorizontal: 32,
  },

  // Avatar
  avatarContainer: {
    position: 'relative',
  },
  avatarRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 2,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  avatarInitial: {
    fontSize: 48,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: Fonts.outfit.medium,
  },
  analysisBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.background,
    zIndex: 5,
  },
  analysisBadgeText: {
    fontSize: 10,
    color: Colors.white,
    fontFamily: Fonts.jakarta.regular,
    fontWeight: '600',
  },

  // Hero text
  heroName: {
    fontSize: 22,
    color: Colors.white,
    fontFamily: Fonts.jakarta.regular,
    fontWeight: '500',
    marginTop: 16,
  },
  heroArchetypeTitle: {
    fontSize: 24,
    color: Colors.white,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginTop: 4,
    textAlign: 'center',
  },
  heroDescription: {
    fontSize: 14,
    color: Colors.textMuted,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 22,
  },

  // Section Styling
  sectionPadding: {
    paddingHorizontal: 20,
    marginTop: 32,
  },
  sectionLabel: {
    fontSize: 14,
    color: Colors.textMuted,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 28,
    color: Colors.white,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginBottom: 20,
  },

  // Verdict
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  verdictInfo: {
    flex: 1,
  },
  verdictLabel: {
    fontSize: 20,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
  },
  verdictDelta: {
    fontSize: 13,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1,
    marginTop: 4,
  },

  // Metrics
  metricsContainer: {
    gap: 4,
  },

  // Archetype Card
  archetypeCard: {
    width: '100%',
    aspectRatio: 9 / 16,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: Colors.background,
    position: 'relative',
  },
  archetypeCardContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  archetypeCardTitle: {
    fontSize: 32,
    color: Colors.white,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    textAlign: 'center',
    lineHeight: 40,
  },
  archetypeCardTagline: {
    fontSize: 17,
    color: Colors.white,
    fontFamily: Fonts.jakarta.regular,
    marginTop: 4,
    textAlign: 'center',
  },

  // Trait Pills
  traitPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  traitPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  traitPillText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
  },

  // View Analysis CTA
  viewAnalysisCTA: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 99,
    backgroundColor: '#7200B4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewAnalysisCTAText: {
    fontSize: 15,
    color: Colors.white,
    fontFamily: Fonts.jakarta.regular,
    letterSpacing: 1.5,
    fontWeight: '400',
  },
});
