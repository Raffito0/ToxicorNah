import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { WebView } from 'react-native-webview';
import { BlurView } from 'expo-blur';

import { ToxicOrb } from './ToxicOrb';
import { SwipeableCardDeck } from './SwipeableCardDeck';
import { VerticalCardDeck } from './VerticalCardDeck';
import { DynamicCard } from './DynamicCard';
import { ScrollReveal } from './ScrollReveal';
import { SoulTypeMedia } from './SoulTypeMedia';
import { Colors, Fonts } from '@/constants/Colors';
import {
  getAnalysisResult,
  getAnalysisStatus,
  StoredAnalysisResult,
  computeDynamicGradient,
} from '@/services/analysisService';
import {
  getUserState,
  canPurchaseSingleUnlock,
  canUseFirstFreeAnalysis,
} from '@/services/userStateService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTENT_WIDTH = Math.min(SCREEN_WIDTH, 430);
const HORIZONTAL_PADDING = 30;
const BASE_URL = 'https://toxicor-nah.vercel.app';

/** Resolve an archetype image path to an absolute URL */
function resolveImageUrl(url: string): string {
  if (url.startsWith('http')) return url;
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Build the HTML for the blurred glassmorphism background on the Soul Type
 * card back face — identical approach to DynamicCard's buildBackHTML.
 */
function buildArchetypeBackHTML(imageUrl: string, width: number, height: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%;
    height: 100%;
    background: #111111;
    overflow: hidden;
  }
  .container {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    background: #111111;
    overflow: hidden;
  }
  .blur-wrapper {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    filter: blur(35px);
    transform: scale(1.2);
  }
  .img {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }
  .dark-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.25);
  }
  .depth-gradient {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: linear-gradient(
      to bottom,
      rgba(0,0,0,0.15) 0%,
      transparent 30%,
      transparent 70%,
      rgba(0,0,0,0.25) 100%
    );
  }
</style>
</head>
<body>
  <div class="container">
    <div class="blur-wrapper">
      <img class="img" src="${imageUrl}" alt="" />
    </div>
    <div class="dark-overlay"></div>
    <div class="depth-gradient"></div>
  </div>
</body>
</html>`;
}

function getToxicityLabel(score: number): string {
  if (score <= 30) return 'Barely a Red Flag';
  if (score <= 50) return 'Low-key Toxic';
  if (score <= 65) return 'Certified Toxic';
  if (score <= 80) return 'Dangerously Toxic';
  return 'Run.';
}

function getHaloColor(score: number): string {
  if (score <= 33) return Colors.safeZone;
  if (score <= 66) return Colors.riskyZone;
  return Colors.toxicZone;
}

interface ResultsPageProps {
  analysisId?: string;
}

export function ResultsPage({ analysisId }: ResultsPageProps) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<StoredAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailedLoading, setIsDetailedLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Reading the vibes...');
  const [showPaywall, setShowPaywall] = useState(false);
  const [isArchetypeCardFlipped, setIsArchetypeCardFlipped] = useState(false);
  const [showArchetypeContent, setShowArchetypeContent] = useState(false);

  const [userState, setUserState] = useState({
    isPremium: false,
    canUseSingleUnlock: true,
    singleUnlocksRemaining: 2,
    isFirstAnalysis: false,
  });

  const haloColor = useMemo(() => {
    if (!analysis) return '#666666';
    return getHaloColor(analysis.overallScore);
  }, [analysis?.overallScore]);

  // Build category cards from emotionalProfiles for SwipeableCardDeck
  // Match web: always use hardcoded category images, match profiles by name/category
  const categoryCards = useMemo(() => {
    if (!analysis?.emotionalProfiles?.length) return undefined;

    const categoryDescriptions = [
      { title: 'Intentions', tagline: 'What he actually wants', fallbackImage: 'Intentions.png' },
      { title: 'Chemistry', tagline: "What's really between you", fallbackImage: 'Chemistry.png' },
      { title: 'Effort', tagline: "Who's showing up", fallbackImage: 'Effort.png' },
      { title: 'Red & Green Flags', tagline: 'The signs you need to see', fallbackImage: 'Red & Green Flags.png' },
      { title: 'Trajectory', tagline: 'Where this is heading', fallbackImage: 'Communication.png' },
    ];

    const categoryKeyMap: Record<string, string> = {
      'Intentions': 'intentions',
      'Chemistry': 'chemistry',
      'Effort': 'effort',
      'Red & Green Flags': 'redFlagsGreenFlags',
      'Trajectory': 'trajectory',
    };

    return categoryDescriptions.map((category, index) => {
      const categoryKey = categoryKeyMap[category.title];
      const profile = analysis.emotionalProfiles.find(p =>
        p.name === categoryKey ||
        p.category === category.title ||
        (p.category === 'Red Flags & Green Flags' && category.title === 'Red & Green Flags')
      );

      const punchyText = (profile?.description && profile.description.trim() !== '')
        ? profile.description
        : category.tagline;

      return {
        index,
        categoryTitle: category.title,
        categoryTagline: category.tagline,
        punchyText,
        image: category.fallbackImage,
      };
    });
  }, [analysis?.emotionalProfiles]);

  const dynamicGradient = useMemo(() => {
    if (!analysis) return { gradientStart: '#162a3d', gradientEnd: '#0b1520' };
    return {
      gradientStart: computeDynamicGradient(analysis.personArchetype.title, analysis.userArchetype.title).from,
      gradientEnd: computeDynamicGradient(analysis.personArchetype.title, analysis.userArchetype.title).to,
    };
  }, [analysis?.personArchetype.title, analysis?.userArchetype.title]);

  // Soul Type card back: WebView-based blur (identical to DynamicCard approach)
  const archetypeCardWidth = CONTENT_WIDTH - HORIZONTAL_PADDING * 2;
  const archetypeCardHeight = (archetypeCardWidth / 9) * 16;
  const archetypeBackHTML = useMemo(() => {
    if (!analysis) return '';
    const imgUrl = resolveImageUrl(
      analysis.personArchetype.sideProfileImageUrl || analysis.personArchetype.imageUrl,
    );
    return buildArchetypeBackHTML(imgUrl, archetypeCardWidth, archetypeCardHeight);
  }, [analysis?.personArchetype.sideProfileImageUrl, analysis?.personArchetype.imageUrl]);

  // Archetype card flip animation
  const flipRotation = useSharedValue(180);
  const flipFrontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${flipRotation.value}deg` }],
    backfaceVisibility: 'hidden' as const,
  }));
  const flipBackStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${flipRotation.value + 180}deg` }],
    backfaceVisibility: 'hidden' as const,
  }));

  // Load user state
  useEffect(() => {
    loadUserState();
  }, [analysisId]);

  // Rotating loading messages
  useEffect(() => {
    if (!isLoading) return;
    const messages = [
      'Reading the vibes...',
      'Detecting patterns...',
      'Analyzing chemistry...',
      'Almost there...',
    ];
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % messages.length;
      setLoadingMessage(messages[index]);
    }, 3000);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Polling for analysis status (two-phase)
  useEffect(() => {
    if (!analysisId) {
      setIsLoading(false);
      setIsDetailedLoading(false);
      return;
    }

    const checkResults = async () => {
      const status = await getAnalysisStatus(analysisId);

      if (status === 'quick_ready' || status === 'completed') {
        try {
          const result = await getAnalysisResult(analysisId);
          if (result) {
            setAnalysis(result);
            setIsLoading(false);
            if (status === 'completed') {
              setIsDetailedLoading(false);
            }
          }
        } catch (error) {
          console.error('Error loading analysis:', error);
          setIsLoading(false);
          setIsDetailedLoading(false);
        }
      } else if (status === 'error') {
        console.error('Analysis failed');
        setIsLoading(false);
        setIsDetailedLoading(false);
      }
    };

    checkResults();
    const interval = setInterval(checkResults, 500);
    return () => clearInterval(interval);
  }, [analysisId]);

  async function loadUserState() {
    const state = await getUserState();
    setUserState({
      isPremium: state.isPremium,
      canUseSingleUnlock: canPurchaseSingleUnlock(state),
      singleUnlocksRemaining: 2 - state.singleUnlocksThisMonth,
      isFirstAnalysis: canUseFirstFreeAnalysis(state),
    });
  }

  function handleBlurredContentClick() {
    if (!analysis?.isUnlocked) {
      setShowPaywall(true);
    }
  }

  function handleFlipArchetype() {
    if (!isArchetypeCardFlipped) {
      setIsArchetypeCardFlipped(true);
      flipRotation.value = withTiming(0, { duration: 600, easing: Easing.bezier(0.4, 0, 0.2, 1) });
      setTimeout(() => setShowArchetypeContent(true), 250);
    }
  }

  // ===== LOADING STATE =====
  if (isLoading || !analysis) {
    return (
      <View style={styles.container}>
        <View style={styles.centeredContent}>
          <Animated.Text
            entering={FadeIn.duration(600)}
            style={styles.loadingSubtitle}
          >
            Toxicity Score
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.duration(600).delay(100)}
            style={styles.loadingTitle}
          >
            Analyzing...
          </Animated.Text>

          <View style={styles.orbContainer}>
            <ToxicOrb score={0} size={140} isLoading />
          </View>

          <Animated.Text
            entering={FadeIn.duration(300)}
            style={styles.loadingMessage}
            key={loadingMessage}
          >
            {loadingMessage}
          </Animated.Text>
        </View>
      </View>
    );
  }

  // DEV MODE: Always unlock content in development
  const isFullyUnlocked = __DEV__ || userState.isPremium || analysis.isUnlocked;
  const isFirstTimeFree = !isFullyUnlocked && userState.isFirstAnalysis;

  // ===== MAIN RESULTS =====
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ===== SCORE SECTION ===== */}
      <Animated.View
        entering={FadeInDown.duration(600).easing(Easing.bezier(0.25, 0.46, 0.45, 0.94))}
        style={styles.section}
      >
        <Text style={styles.sectionSubtitle}>Toxicity Score</Text>
        <Text style={styles.sectionTitle}>
          How Toxic {analysis.personGender === 'female' ? 'She Is' : 'He Is'}
        </Text>

        <View style={styles.orbContainer}>
          <ToxicOrb score={analysis.overallScore} size={140} />
        </View>

        <Text style={[styles.profileType, { color: haloColor }]}>
          {analysis.overallScore > 80 ? 'Toxic AF' : getToxicityLabel(analysis.overallScore)}
        </Text>
        <Text style={styles.profileSubtitle}>{analysis.profileSubtitle}</Text>
        <Text style={styles.profileDescription}>{analysis.profileDescription}</Text>
      </Animated.View>

      {/* ===== SOUL TYPE SECTION ===== */}
      <ScrollReveal>
        <View style={[styles.section, { paddingTop: 19, paddingBottom: 0 }]}>
          <Text style={styles.sectionSubtitle}>
            Who {analysis.personGender === 'female' ? 'She' : 'He'} Is
          </Text>
          <Text style={styles.sectionTitle}>
            {analysis.personGender === 'female' ? 'Her' : 'His'} Soul Type
          </Text>

          {/* Flippable Archetype Card */}
          <Pressable
            onPress={handleFlipArchetype}
            style={styles.archetypeCardContainer}
          >
            {/* FRONT SIDE - Revealed archetype */}
            <Animated.View style={[styles.archetypeCard, flipFrontStyle]}>
              <SoulTypeMedia
                src={analysis.personArchetype.imageUrl}
                contentFit="cover"
              />

              {/* Overlay: blur + gradient + text */}
              {showArchetypeContent && (
                <View style={styles.archetypeOverlay}>
                  {/* Blur layer via expo-blur with dimezisBlurView (Android-specific method) */}
                  <BlurView
                    intensity={80}
                    tint="dark"
                    experimentalBlurMethod="dimezisBlurView"
                    style={styles.archetypeBlurLayer}
                  />

                  {/* Dark gradient for text readability */}
                  <LinearGradient
                    colors={[
                      'transparent',
                      'rgba(0,0,0,0.3)',
                      'rgba(0,0,0,0.6)',
                      'rgba(0,0,0,0.85)',
                    ]}
                    locations={[0, 0.4, 0.7, 1]}
                    style={styles.archetypeGradient}
                  />

                  {/* Text content */}
                  <View style={styles.archetypeContent}>
                    <Text style={styles.archetypeTitle}>
                      {analysis.personArchetype.title}
                    </Text>
                    <Text style={styles.archetypeTagline}>
                      {analysis.personArchetype.tagline?.replace(/\.$/, '')}
                    </Text>
                    <Text style={styles.archetypeDescription}>
                      {analysis.personArchetype.description}
                    </Text>

                    {/* Trait Pills */}
                    <View style={styles.traitPillsContainer}>
                      {(analysis.personArchetype.traits || ['COLD', 'NARCISSIST', 'BOLD'])
                        .slice(0, 3)
                        .map((trait, index) => {
                          const words = trait.split(' ');
                          const displayTrait = words.length > 1 && index === 0
                            ? words.slice(0, 2).join(' ')
                            : words[0];
                          return (
                            <View key={index} style={styles.traitPill}>
                              <Text style={styles.traitPillText}>
                                {displayTrait}
                              </Text>
                            </View>
                          );
                        })}
                    </View>
                  </View>
                </View>
              )}
            </Animated.View>

            {/* BACK SIDE - "Discover who he is" */}
            <Animated.View style={[styles.archetypeCard, styles.archetypeCardBack, flipBackStyle]}>
              {/* Blurred glassmorphism background via WebView — same as DynamicCard */}
              <WebView
                source={{ html: archetypeBackHTML }}
                style={{ width: archetypeCardWidth, height: archetypeCardHeight, backgroundColor: '#111111' }}
                scrollEnabled={false}
                bounces={false}
                overScrollMode="never"
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                pointerEvents="none"
                androidLayerType="hardware"
                originWhitelist={['*']}
              />
              <View style={styles.archetypeBackContent}>
                <Image
                  source={{ uri: `${BASE_URL}/hand.png` }}
                  style={{ width: 32, height: 32, opacity: 0.7, marginBottom: 20 }}
                />
                <Text style={styles.archetypeBackText}>
                  Discover who {analysis.personGender === 'female' ? 'she' : 'he'} is
                </Text>
              </View>
            </Animated.View>
          </Pressable>

          {/* CALL HIM/HER OUT Button */}
          {showArchetypeContent && (
            <Animated.View entering={FadeInDown.duration(500).delay(600)} style={{ width: '100%' }}>
              <Pressable
                style={styles.callOutButton}
                onPress={() => {
                  // TODO: Implement share with react-native-view-shot + expo-sharing
                }}
              >
                <Image
                  source={{ uri: `${BASE_URL}/devil (1).png` }}
                  style={{ width: 20, height: 20 }}
                />
                <Text style={styles.callOutButtonText}>
                  CALL {analysis.personGender === 'female' ? 'HER' : 'HIM'} OUT
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </View>
      </ScrollReveal>

      {/* ===== SWIPEABLE CARD DECK (5 category cards) ===== */}
      <ScrollReveal>
        <SwipeableCardDeck
          cards={categoryCards}
          isFirstTimeFree={isFirstTimeFree}
          onPaywallOpen={() => setShowPaywall(true)}
          isLoading={isDetailedLoading}
        />
      </ScrollReveal>

      {/* ===== VERTICAL CARD DECK (Message Insights) ===== */}
      <ScrollReveal>
        <VerticalCardDeck
          messageInsights={analysis.messageInsights}
          isFirstTimeFree={isFirstTimeFree}
          onPaywallOpen={() => setShowPaywall(true)}
          isLoading={isDetailedLoading}
        />
      </ScrollReveal>

      {/* ===== YOUR SOULS TOGETHER (DynamicCard) ===== */}
      <ScrollReveal>
        <View style={[styles.section, { paddingTop: 96 }]}>
          <Text style={styles.sectionSubtitle}>The Dynamic</Text>
          <Text style={[styles.sectionTitle, { marginBottom: 32 }]}>
            Your Souls Together
          </Text>
          <DynamicCard
            dynamicName={analysis.relationshipDynamic.name}
            subtitle={analysis.relationshipDynamic.subtitle}
            whyThisHappens={analysis.relationshipDynamic.whyThisHappens}
            patternBreak={analysis.relationshipDynamic.patternBreak}
            width={CONTENT_WIDTH - HORIZONTAL_PADDING * 2}
            partnerSoulType={{
              name: analysis.personArchetype.name,
              title: analysis.personArchetype.title,
              imageUrl: analysis.personArchetype.imageUrl,
              sideProfileImageUrl: analysis.personArchetype.sideProfileImageUrl,
            }}
            userSoulType={{
              name: analysis.userArchetype.name,
              title: analysis.userArchetype.title,
              imageUrl: analysis.userArchetype.imageUrl,
              sideProfileImageUrl: analysis.userArchetype.sideProfileImageUrl,
            }}
          />

          {/* Share Dynamic Button */}
          <Animated.View entering={FadeInDown.duration(500).delay(300)} style={{ width: '100%' }}>
            <Pressable
              style={[styles.callOutButton, { marginTop: 24 }]}
              onPress={() => {
                // TODO: Implement share
              }}
            >
              <Image
                source={{ uri: `${BASE_URL}/devil (1).png` }}
                style={{ width: 20, height: 20 }}
              />
              <Text style={styles.callOutButtonText}>
                SHARE YOUR DYNAMIC
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </ScrollReveal>

      {/* Bottom spacing */}
      <View style={{ height: 120 }} />

      {/* TODO: PaywallModal */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
  },
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  section: {
    width: CONTENT_WIDTH,
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 48,
    alignItems: 'center',
  },
  sectionSubtitle: {
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontSize: 16,
    fontFamily: Fonts.jakarta.extraLight,
    marginBottom: 8,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 33,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    textAlign: 'center',
  },

  // Loading state
  loadingSubtitle: {
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontSize: 16,
    fontFamily: Fonts.jakarta.extraLight,
    marginBottom: 8,
  },
  loadingTitle: {
    color: Colors.textPrimary,
    fontSize: 28,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  loadingMessage: {
    color: Colors.textMuted,
    textTransform: 'uppercase',
    fontSize: 14,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
  },

  // Orb
  orbContainer: {
    marginVertical: 32,
    alignItems: 'center',
  },

  // Profile info
  profileType: {
    fontSize: 24,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  profileSubtitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  profileDescription: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 14,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
    lineHeight: 22,
  },

  // Archetype card
  archetypeCardContainer: {
    width: CONTENT_WIDTH - HORIZONTAL_PADDING * 2,
    aspectRatio: 9 / 16,
    marginTop: 24,
  },
  archetypeCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: Colors.background,
  },
  archetypeCardBack: {
    // Back side shares same absolute positioning
  },
  archetypeOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  archetypeBlurLayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  archetypeGradient: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    right: -2,
    height: '55%',
  },
  archetypeContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  archetypeTitle: {
    fontSize: 32,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    lineHeight: 42,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  archetypeTagline: {
    marginTop: 8,
    fontSize: 18,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.85)',
    fontStyle: 'italic',
    textAlign: 'center',
    maxWidth: 280,
  },
  archetypeDescription: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    maxWidth: 280,
  },
  traitPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  traitPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  traitPillText: {
    fontSize: 10,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.9)',
    textTransform: 'uppercase',
  },

  // Back side of archetype card
  archetypeBackContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    zIndex: 2,
  },
  archetypeBackText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    textAlign: 'center',
  },

  // Call Out / Share buttons
  callOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: '#7200B4',
    marginTop: 24,
    width: '100%',
  },
  callOutButtonText: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: Fonts.jakarta.regular,
    letterSpacing: 1.5,
  },
});
