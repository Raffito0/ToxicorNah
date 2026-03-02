import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus, Users } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ToxicOrb } from '@/components/ToxicOrb';
import { Colors, Fonts } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ===== Types =====

export interface ConnectionCardData {
  personId: string;
  name: string;
  avatar: string | null;
  currentScore: number;
  archetypeTitle: string;
  archetypeImage: string | null;
  lastAnalyzedAt: string;
  analysisCount: number;
}

// ===== Data Fetching =====

const DEV_MODE = __DEV__;

const MOCK_CONNECTIONS: ConnectionCardData[] = [
  {
    personId: 'dev-alex-1',
    name: 'Alex',
    avatar: null,
    currentScore: 70,
    archetypeTitle: 'The Sweet Poison',
    archetypeImage: null,
    lastAnalyzedAt: new Date().toISOString(),
    analysisCount: 45,
  },
  {
    personId: 'dev-marcus-2',
    name: 'Marcus',
    avatar: null,
    currentScore: 35,
    archetypeTitle: 'The Ghost',
    archetypeImage: null,
    lastAnalyzedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    analysisCount: 12,
  },
];

async function fetchConnections(): Promise<ConnectionCardData[]> {
  if (DEV_MODE) {
    // Check AsyncStorage for stored dev connections
    try {
      const stored = await AsyncStorage.getItem('dev_connections');
      if (stored) return JSON.parse(stored);
    } catch {}
    return MOCK_CONNECTIONS;
  }

  // Production: Fetch from Supabase
  const { data: persons, error: personsError } = await supabase
    .from('persons')
    .select('*')
    .neq('is_archived', true)
    .order('created_at', { ascending: false });

  if (personsError || !persons || persons.length === 0) {
    return [];
  }

  const connections: ConnectionCardData[] = [];

  for (const person of persons) {
    const { data: analyses } = await supabase
      .from('analysis_results')
      .select('id, overall_score, created_at')
      .eq('person_id', person.id)
      .eq('processing_status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!analyses || analyses.length === 0) continue;

    const latestAnalysis = analyses[0];

    let archetypeTitle = '';
    let archetypeImage: string | null = null;

    const { data: archetype } = await supabase
      .from('analysis_relationship_archetypes')
      .select('archetype_title, image_url')
      .eq('analysis_id', latestAnalysis.id)
      .eq('person_type', 'person')
      .maybeSingle();

    if (archetype) {
      archetypeTitle = archetype.archetype_title || '';
      archetypeImage = archetype.image_url || null;
    }

    const { count } = await supabase
      .from('analysis_results')
      .select('id', { count: 'exact', head: true })
      .eq('person_id', person.id)
      .eq('processing_status', 'completed');

    connections.push({
      personId: person.id,
      name: person.name || 'Him',
      avatar: person.avatar_url || null,
      currentScore: latestAnalysis.overall_score,
      archetypeTitle,
      archetypeImage,
      lastAnalyzedAt: latestAnalysis.created_at,
      analysisCount: count || 1,
    });
  }

  return connections;
}

// ===== Helpers =====

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 12;
const HORIZONTAL_PADDING = 20;
const CARD_WIDTH = (SCREEN_WIDTH - HORIZONTAL_PADDING * 2 - GRID_GAP) / 2;
const CARD_HEIGHT = CARD_WIDTH * (16 / 9);

function getScoreColor(score: number): string {
  if (score <= 30) return '#4ade80';
  if (score <= 60) return '#facc15';
  return '#ef4444';
}

// ===== Connection Card =====

function ConnectionCard({
  connection,
  onPress,
}: {
  connection: ConnectionCardData;
  onPress: () => void;
}) {
  const scoreColor = getScoreColor(connection.currentScore);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { width: CARD_WIDTH, height: CARD_HEIGHT },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      {/* Background archetype image */}
      {connection.archetypeImage && (
        <Image
          source={{ uri: connection.archetypeImage }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={300}
        />
      )}

      {/* Fallback bg if no image */}
      {!connection.archetypeImage && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1A1A1A' }]} />
      )}

      {/* Top overlay: chats badge + score orb */}
      <View style={styles.cardTopRow}>
        <View style={styles.chatsBadge}>
          <Text style={styles.chatsBadgeText}>
            {connection.analysisCount} {connection.analysisCount === 1 ? 'Chat' : 'Chats'}
          </Text>
        </View>
        <ToxicOrb score={connection.currentScore} size={42} fontSizeOverride={13} />
      </View>

      {/* Glassmorphism bottom layer */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.85)']}
        locations={[0, 0.4, 1]}
        style={styles.cardBottomGradient}
      />

      {/* Bottom info */}
      <View style={styles.cardBottomInfo}>
        <View style={styles.cardBottomRow}>
          {/* Avatar */}
          <View style={styles.cardAvatar}>
            {connection.avatar ? (
              <Image
                source={{ uri: connection.avatar }}
                style={styles.cardAvatarImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.cardAvatarPlaceholder}>
                <Text style={styles.cardAvatarInitial}>
                  {connection.name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.cardTextContainer}>
            <Text style={styles.cardName} numberOfLines={1}>
              {connection.name}
            </Text>
            <Text style={styles.cardArchetype} numberOfLines={1}>
              {connection.archetypeTitle || 'Unknown'}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ===== Empty Card Slot (Add New) =====

function EmptyCardSlot({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.emptyCard,
        { width: CARD_WIDTH, height: CARD_HEIGHT },
        pressed && { backgroundColor: 'rgba(255,255,255,0.05)' },
      ]}
    >
      <View style={styles.emptyCardIcon}>
        <Plus size={22} color="rgba(255,255,255,0.4)" />
      </View>
      <Text style={styles.emptyCardText}>Analyze someone</Text>
    </Pressable>
  );
}

// ===== Main Component =====

interface ConnectionsPageProps {
  onAnalyzeNew?: () => void;
}

export function ConnectionsPage({ onAnalyzeNew }: ConnectionsPageProps) {
  const router = useRouter();
  const [connections, setConnections] = useState<ConnectionCardData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchConnections();
      setConnections(data);
    } catch (err) {
      console.error('Failed to load connections:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  function handleSelectPerson(personId: string) {
    router.push(`/person/${personId}`);
  }

  function handleAnalyzeNew() {
    if (onAnalyzeNew) {
      onAnalyzeNew();
    } else {
      // Default: navigate to analyze tab
      router.push('/(tabs)');
    }
  }

  const totalChats = connections.reduce((sum, c) => sum + c.analysisCount, 0);

  // Build data array: connections + 1 empty slot
  const gridData = [...connections, { _type: 'empty' as const }];

  // ===== Loading State =====
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.headerSection}>
          <Text style={styles.pageTitle}>Your Receipts</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="rgba(255,255,255,0.3)" />
          <Text style={styles.loadingText}>Loading connections...</Text>
        </View>
      </View>
    );
  }

  // ===== Empty State =====
  if (connections.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.headerSection}>
          <Text style={styles.pageTitle}>Your Receipts</Text>
        </View>
        <Animated.View entering={FadeIn.duration(600)} style={styles.emptyState}>
          <View style={styles.emptyStateIcon}>
            <Users size={28} color="rgba(255,255,255,0.3)" />
          </View>
          <Text style={styles.emptyStateTitle}>No connections yet</Text>
          <Text style={styles.emptyStateSubtitle}>
            Analyze a conversation to start building your collection
          </Text>
          <Pressable onPress={handleAnalyzeNew} style={styles.emptyStateCTA}>
            <Plus size={16} color="rgba(255,255,255,0.7)" />
            <Text style={styles.emptyStateCTAText}>Analyze Someone</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  // ===== Grid State =====
  return (
    <View style={styles.container}>
      <FlatList
        data={gridData}
        numColumns={2}
        keyExtractor={(item, index) =>
          'personId' in item ? item.personId : `empty-${index}`
        }
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.headerSection}>
            <Text style={styles.pageTitle}>Your Receipts</Text>
            <Text style={styles.statsText}>
              {connections.length} {connections.length === 1 ? 'person' : 'people'} ·{' '}
              {totalChats} {totalChats === 1 ? 'chat' : 'chats'} analyzed
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          if ('_type' in item && item._type === 'empty') {
            return <EmptyCardSlot onPress={handleAnalyzeNew} />;
          }
          const connection = item as ConnectionCardData;
          return (
            <ConnectionCard
              connection={connection}
              onPress={() => handleSelectPerson(connection.personId)}
            />
          );
        }}
      />
    </View>
  );
}

// ===== Styles =====

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerSection: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 8,
    paddingBottom: 16,
  },
  pageTitle: {
    fontSize: 30,
    color: Colors.white,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  statsText: {
    fontSize: 15,
    color: Colors.textDim,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
  },
  gridContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 40,
  },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
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

  // Empty state
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
    fontSize: 16,
    color: Colors.textMuted,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: Colors.textDim,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    textAlign: 'center',
    maxWidth: 240,
    marginBottom: 24,
  },
  emptyStateCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  emptyStateCTAText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
  },

  // Connection Card
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.background,
    position: 'relative',
  },
  cardTopRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    zIndex: 10,
  },
  chatsBadge: {
    backgroundColor: 'rgba(255,255,255,0.71)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  chatsBadgeText: {
    fontSize: 11,
    color: '#000000',
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
  },
  cardBottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  cardBottomInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    zIndex: 10,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  cardAvatarImage: {
    width: 36,
    height: 36,
  },
  cardAvatarPlaceholder: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardAvatarInitial: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: Fonts.jakarta.regular,
  },
  cardTextContainer: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: 14,
    color: Colors.white,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    lineHeight: 18,
  },
  cardArchetype: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    lineHeight: 15,
  },

  // Empty card slot
  emptyCard: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCardText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
  },
});
