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
import { Sparkles } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { SoulTypeMedia } from '@/components/SoulTypeMedia';
import { Colors, Fonts } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ===== Types =====

interface SoulProfileData {
  dominantArchetype: {
    title: string;
    tagline: string;
    description: string;
    traits: string[];
    imageUrl: string;
    energyType: string;
    gradientFrom: string;
    gradientTo: string;
  };
  stats: {
    totalAnalyses: number;
    totalRedFlags: number;
    totalRelationships: number;
    averageScore: number;
  };
  analysisCount: number;
}

// ===== Data Fetching =====

const DEV_MODE = __DEV__;

const MOCK_SOUL_PROFILE: SoulProfileData = {
  dominantArchetype: {
    title: 'The Moth',
    tagline: "You can't stay away from the fire",
    description:
      'You feel everything deeply and love with your whole heart. Sometimes that\'s your superpower, sometimes it\'s your downfall.',
    traits: ['Emotionally Deep', 'Magnetic', 'Fearless'],
    imageUrl: '',
    energyType: 'Fire Energy',
    gradientFrom: '#4A1A2E',
    gradientTo: '#1A0A15',
  },
  stats: {
    totalAnalyses: 8,
    totalRedFlags: 23,
    totalRelationships: 3,
    averageScore: 52,
  },
  analysisCount: 8,
};

async function fetchSoulProfile(): Promise<SoulProfileData | null> {
  if (DEV_MODE) {
    try {
      const stored = await AsyncStorage.getItem('dev_soul_profile');
      if (stored) return JSON.parse(stored);
    } catch {}
    return MOCK_SOUL_PROFILE;
  }

  // Production: Fetch from Supabase
  // Get all completed analyses for this user
  const { data: analyses, error } = await supabase
    .from('analysis_results')
    .select('id, overall_score, created_at, person_id')
    .eq('processing_status', 'completed')
    .order('created_at', { ascending: false });

  if (error || !analyses || analyses.length === 0) {
    return null;
  }

  // Count unique persons
  const uniquePersonIds = new Set(analyses.map((a) => a.person_id));

  // Get the latest analysis to determine dominant archetype
  const latestId = analyses[0].id;

  const { data: userArchetype } = await supabase
    .from('analysis_relationship_archetypes')
    .select('*')
    .eq('analysis_id', latestId)
    .eq('person_type', 'user')
    .maybeSingle();

  // Count red flags across all analyses
  const { count: redFlagCount } = await supabase
    .from('analysis_message_insights')
    .select('id', { count: 'exact', head: true })
    .in(
      'analysis_id',
      analyses.map((a) => a.id)
    )
    .eq('tag', 'RED FLAG');

  const avgScore =
    analyses.reduce((sum, a) => sum + a.overall_score, 0) / analyses.length;

  return {
    dominantArchetype: {
      title: userArchetype?.archetype_title || 'Unknown',
      tagline: userArchetype?.tagline || '',
      description: userArchetype?.description || '',
      traits: userArchetype?.traits || [],
      imageUrl: userArchetype?.image_url || '',
      energyType: userArchetype?.energy_type || 'Unknown Energy',
      gradientFrom: userArchetype?.gradient_from || '#162a3d',
      gradientTo: userArchetype?.gradient_to || '#0b1520',
    },
    stats: {
      totalAnalyses: analyses.length,
      totalRedFlags: redFlagCount || 0,
      totalRelationships: uniquePersonIds.size,
      averageScore: Math.round(avgScore),
    },
    analysisCount: analyses.length,
  };
}

// ===== Helpers =====

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 40;

function getScoreColor(score: number): string {
  if (score <= 30) return Colors.safeZone;
  if (score <= 60) return Colors.riskyZone;
  return Colors.toxicZone;
}

// ===== Trait Pill =====

function TraitPill({ trait }: { trait: string }) {
  // Limit to 2 words max
  const words = trait.split(' ');
  const display = words.slice(0, 2).join(' ');

  return (
    <View style={styles.traitPill}>
      <Text style={styles.traitPillText}>{display.toUpperCase()}</Text>
    </View>
  );
}

// ===== Stat Card =====

function StatCard({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, color ? { color } : undefined]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ===== Empty State =====

function EmptyState() {
  const router = useRouter();

  return (
    <Animated.View entering={FadeIn.duration(600)} style={styles.emptyState}>
      <View style={styles.emptyStateIcon}>
        <Sparkles size={28} color="rgba(255,255,255,0.3)" />
      </View>
      <Text style={styles.emptyStateTitle}>Discover Your Soul Type</Text>
      <Text style={styles.emptyStateSubtitle}>
        Complete your first analysis to discover who you become in love
      </Text>
      <Pressable
        onPress={() => router.push('/(tabs)')}
        style={styles.emptyStateCTA}
      >
        <Text style={styles.emptyStateCTAText}>Analyze a Chat</Text>
      </Pressable>
    </Animated.View>
  );
}

// ===== Main Component =====

export function SoulPage() {
  const [data, setData] = useState<SoulProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await fetchSoulProfile();
      setData(profile);
    } catch (err) {
      console.error('Failed to load soul profile:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // ===== Loading State =====
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="rgba(255,255,255,0.3)" />
          <Text style={styles.loadingText}>Loading your soul...</Text>
        </View>
      </View>
    );
  }

  // ===== Empty State =====
  if (!data || data.analysisCount === 0) {
    return (
      <View style={styles.container}>
        <EmptyState />
      </View>
    );
  }

  const { dominantArchetype, stats } = data;
  const accentColor = '#A855F7';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ===== HERO SECTION ===== */}
      <View style={styles.heroSection}>
        {/* Blurred background */}
        {dominantArchetype.imageUrl ? (
          <Image
            source={{ uri: dominantArchetype.imageUrl }}
            style={styles.heroBgImage}
            contentFit="cover"
            blurRadius={18}
          />
        ) : (
          <LinearGradient
            colors={[dominantArchetype.gradientFrom, dominantArchetype.gradientTo]}
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* Bottom fade */}
        <LinearGradient
          colors={['transparent', Colors.background]}
          locations={[0, 1]}
          style={styles.heroBottomFade}
        />

        {/* Content */}
        <View style={styles.heroContent}>
          <Text style={[styles.heroLabel, { color: accentColor }]}>Your Soul</Text>
          <Text style={styles.heroTitle}>{dominantArchetype.title}</Text>
          <Text style={styles.heroTagline}>{dominantArchetype.tagline}</Text>
        </View>
      </View>

      {/* ===== ARCHETYPE CARD ===== */}
      <Animated.View entering={FadeInDown.delay(200).duration(600)} style={styles.sectionPadding}>
        {/* Section Header */}
        <Text style={styles.sectionLabel}>WHO YOU ARE</Text>
        <Text style={styles.sectionTitle}>Your Soul Type</Text>

        {/* The Card */}
        <View style={styles.archetypeCard}>
          {/* Full image background */}
          {dominantArchetype.imageUrl ? (
            <SoulTypeMedia
              src={dominantArchetype.imageUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <LinearGradient
              colors={[dominantArchetype.gradientFrom, dominantArchetype.gradientTo]}
              style={StyleSheet.absoluteFill}
            />
          )}

          {/* Gradient overlay for text */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.9)']}
            locations={[0.3, 0.6, 1]}
            style={StyleSheet.absoluteFill}
          />

          {/* Card content */}
          <View style={styles.archetypeCardContent}>
            <Text style={styles.archetypeCardTitle}>{dominantArchetype.title}</Text>
            <Text style={styles.archetypeCardTagline}>
              {dominantArchetype.tagline}
            </Text>
            <Text style={styles.archetypeCardDesc}>
              {dominantArchetype.description}
            </Text>

            {/* Trait Pills */}
            {dominantArchetype.traits.length > 0 && (
              <View style={styles.traitPillRow}>
                {dominantArchetype.traits.slice(0, 3).map((trait, i) => (
                  <TraitPill key={i} trait={trait} />
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Energy Type Badge */}
        {dominantArchetype.energyType && (
          <View style={styles.energyBadge}>
            <Sparkles size={14} color={accentColor} />
            <Text style={[styles.energyBadgeText, { color: accentColor }]}>
              {dominantArchetype.energyType}
            </Text>
          </View>
        )}
      </Animated.View>

      {/* ===== STATS SECTION ===== */}
      <Animated.View entering={FadeInDown.delay(400).duration(600)} style={styles.sectionPadding}>
        <Text style={styles.sectionLabel}>YOUR STATS</Text>
        <Text style={styles.sectionTitle}>The Numbers</Text>

        <View style={styles.statsGrid}>
          <StatCard
            value={String(stats.totalAnalyses)}
            label="Chats Analyzed"
          />
          <StatCard
            value={String(stats.totalRelationships)}
            label="People"
          />
          <StatCard
            value={String(stats.totalRedFlags)}
            label="Red Flags"
            color={Colors.redFlag}
          />
          <StatCard
            value={String(stats.averageScore)}
            label="Avg Score"
            color={getScoreColor(stats.averageScore)}
          />
        </View>
      </Animated.View>

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

  // Empty State
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 18,
    color: Colors.textMuted,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: Colors.textDim,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyStateCTA: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 99,
    backgroundColor: '#7200B4',
  },
  emptyStateCTAText: {
    fontSize: 15,
    color: Colors.white,
    fontFamily: Fonts.jakarta.regular,
    letterSpacing: 1.5,
  },

  // Hero Section
  heroSection: {
    position: 'relative',
    width: '100%',
    minHeight: 280,
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
  heroContent: {
    position: 'relative',
    zIndex: 3,
    alignItems: 'center',
    paddingTop: 80,
    paddingBottom: 32,
    paddingHorizontal: 32,
  },
  heroLabel: {
    fontSize: 18,
    fontFamily: Fonts.jakarta.regular,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 28,
    color: Colors.white,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  heroTagline: {
    fontSize: 14,
    color: Colors.textMuted,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    marginTop: 8,
    textAlign: 'center',
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
  archetypeCardDesc: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    lineHeight: 22,
    marginTop: 12,
    textAlign: 'center',
    maxWidth: 280,
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

  // Energy Badge
  energyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: 'rgba(168,85,247,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.2)',
  },
  energyBadgeText: {
    fontSize: 13,
    fontFamily: Fonts.jakarta.regular,
    letterSpacing: 1.5,
  },

  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: (SCREEN_WIDTH - 40 - 12) / 2 - 0.5,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    padding: 20,
  },
  statValue: {
    fontSize: 24,
    color: Colors.white,
    fontFamily: Fonts.satoshi.bold,
    lineHeight: 28,
  },
  statLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    marginTop: 4,
  },
});
