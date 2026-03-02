import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { MessageInsightCard } from '@/components/MessageInsightCard';
import { SkeletonCard } from '@/components/SkeletonCard';
import { Fonts, Colors } from '@/constants/Colors';

const BASE_URL = 'https://toxicor-nah.vercel.app';

// ---- Types ----

interface VerticalCardData {
  gradientStart: string;
  gradientEnd: string;
  accentColor: string;
  title: string;
  tag: string;
  tagColor: string;
  description: string;
  message: string;
  messageCount: string;
  solution: string;
}

interface VerticalCardDeckProps {
  /** Pre-loaded messageInsights data array */
  messageInsights?: VerticalCardData[];
  /** Whether the user is on a first-time-free trial */
  isFirstTimeFree?: boolean;
  /** Called when a paywall gate is triggered */
  onPaywallOpen?: () => void;
  /** External loading flag (e.g., Phase 2 still running) */
  isLoading?: boolean;
}

// ---- Constants ----

const CARD_HEIGHT = 220;
const STACK_OFFSET = 20; // px between each stacked card

// ---- Component ----

export function VerticalCardDeck({
  messageInsights,
  isFirstTimeFree = false,
  onPaywallOpen,
  isLoading: externalLoading = false,
}: VerticalCardDeckProps) {
  const [verticalCards, setVerticalCards] = useState<VerticalCardData[]>([]);
  const [stackOrder, setStackOrder] = useState<number[]>([]);
  const [flippedCards, setFlippedCards] = useState<boolean[]>([]);
  const [hasDealt, setHasDealt] = useState(false);
  const [loading, setLoading] = useState(true);

  // Process incoming messageInsights data
  useEffect(() => {
    if (externalLoading) {
      setLoading(true);
      return;
    }

    if (!messageInsights || messageInsights.length === 0) {
      setVerticalCards([]);
      setLoading(false);
      return;
    }

    const totalCards = messageInsights.length;
    const cards: VerticalCardData[] = messageInsights.map((insight, index) => ({
      gradientStart: insight.gradientStart || '',
      gradientEnd: insight.gradientEnd || '',
      accentColor: insight.accentColor || insight.tagColor || '#3A3A5A',
      title: insight.title,
      tag: insight.tag,
      tagColor: insight.tagColor || '#42A5F5',
      description: insight.description,
      message: insight.message,
      messageCount: `${index + 1} of ${totalCards}`,
      solution: insight.solution,
    }));

    setVerticalCards(cards);
    // Stack order: last index on top visually (card 0 appears on top)
    setStackOrder(cards.map((_, i) => cards.length - 1 - i));
    setFlippedCards(new Array(cards.length).fill(false));
    setLoading(false);

    // Trigger deal animation after a short delay
    setTimeout(() => setHasDealt(true), 300);
  }, [messageInsights, externalLoading]);

  // Move top card to bottom of stack
  const moveTopToBottom = useCallback(() => {
    setStackOrder((prev) => {
      const newOrder = [...prev];
      const top = newOrder.pop()!;
      newOrder.unshift(top);

      // Reset flip state for the card that was just moved
      setFlippedCards((prevFlipped) => {
        const newFlipped = [...prevFlipped];
        newFlipped[top] = false;
        return newFlipped;
      });

      return newOrder;
    });
  }, []);

  // Toggle flip for a specific card
  const toggleCardFlip = useCallback((cardIndex: number) => {
    setFlippedCards((prev) => {
      const newFlipped = [...prev];
      newFlipped[cardIndex] = !newFlipped[cardIndex];
      return newFlipped;
    });
  }, []);

  const orderedCards = stackOrder.map((orderIndex) => verticalCards[orderIndex]);

  // Dynamic container height
  const totalStackHeight =
    orderedCards.length > 0
      ? CARD_HEIGHT + (orderedCards.length - 1) * STACK_OFFSET
      : CARD_HEIGHT;

  const showSkeleton = externalLoading || loading;

  // ---- Skeleton loading state ----
  if (showSkeleton) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.subtitle}>Message Breakdown</Text>
          <Text style={styles.title}>Between The Lines</Text>
        </View>

        <View style={[styles.deckContainer, { height: 280 }]}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[
                styles.skeletonCard,
                {
                  top: i * 20,
                  zIndex: 3 - i,
                  transform: [{ scale: i === 0 ? 1 : 0.95 - i * 0.02 }],
                  opacity: 1 - i * 0.15,
                },
              ]}
            >
              <SkeletonCard height={CARD_HEIGHT} borderRadius={20} />
            </View>
          ))}
        </View>

        <LoadingHint />
      </View>
    );
  }

  // ---- Empty state ----
  if (verticalCards.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.subtitle}>Message Breakdown</Text>
          <Text style={styles.title}>Between The Lines</Text>
        </View>

        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Not much to decode here — this chat is pretty straightforward.
          </Text>
        </View>
      </View>
    );
  }

  // ---- Card deck ----
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.subtitle}>Message Breakdown</Text>
        <Text style={styles.title}>Between The Lines</Text>
      </View>

      <View style={[styles.deckContainer, { height: totalStackHeight }]}>
        {/* Inner wrapper: cards position absolutely within content area (matching web) */}
        <View style={styles.deckInner}>
          {orderedCards.map((vCard, visualIndex) => {
            const isTop = visualIndex === orderedCards.length - 1;
            const distanceFromTop = orderedCards.length - 1 - visualIndex;
            const cardDataIndex = stackOrder[visualIndex];
            const isFlipped = flippedCards[cardDataIndex];

            return (
              <MessageInsightCard
                key={vCard.title}
                message={vCard.message}
                messageCount={vCard.messageCount}
                title={vCard.title}
                tag={vCard.tag}
                tagColor={vCard.tagColor}
                description={vCard.description}
                solution={vCard.solution}
                gradientStart={vCard.gradientStart}
                gradientEnd={vCard.gradientEnd}
                accentColor={vCard.accentColor}
                isTop={isTop}
                isFlipped={isFlipped}
                visualIndex={visualIndex}
                distanceFromTop={distanceFromTop}
                cardIndex={cardDataIndex}
                isFirstTimeFree={isFirstTimeFree}
                onTap={() => toggleCardFlip(cardDataIndex)}
                onSwipe={moveTopToBottom}
                onPaywallOpen={onPaywallOpen}
                hasDealt={hasDealt}
                dealDelay={visualIndex * 0.1}
              />
            );
          })}
        </View>
      </View>

      {/* Interaction hints */}
      <View style={styles.hintsRow}>
        <PulsingHint text="Tap the card" iconUri={`${BASE_URL}/hand.png`} />
        <PulsingHint text="Swipe the card" iconUri={`${BASE_URL}/hand%20(1).png`} delay={500} />
      </View>
    </View>
  );
}

// ---- Sub-components ----

/** Pulsing opacity hint text with optional icon */
function PulsingHint({ text, iconUri, delay = 0 }: { text: string; iconUri?: string; delay?: number }) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.5, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        ),
        -1, // infinite
        false,
      ),
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.hintItem, animatedStyle]}>
      {iconUri && (
        <Image
          source={{ uri: iconUri }}
          style={styles.hintIcon}
          contentFit="contain"
        />
      )}
      <Text style={styles.hintText}>{text}</Text>
    </Animated.View>
  );
}

/** Animated "Reading messages..." loading hint */
function LoadingHint() {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.8, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={styles.loadingHint} >
      <Animated.Text style={[styles.loadingHintText, animatedStyle]}>
        Reading messages...
      </Animated.Text>
    </Animated.View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    paddingTop: 96,
  },
  header: {
    marginBottom: 32,
    paddingHorizontal: 30,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: Fonts.jakarta.extraLight,
    marginBottom: 8,
    textAlign: 'center',
  },
  title: {
    fontSize: 33,
    color: Colors.white,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  deckContainer: {
    width: '100%',
    paddingHorizontal: 14,
    position: 'relative',
  },
  deckInner: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  skeletonCard: {
    position: 'absolute',
    left: 14,
    right: 14,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 30,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.jakarta.light,
    letterSpacing: 0.5,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 280,
  },

  // Hints
  hintsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginTop: 16,
  },
  hintItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hintIcon: {
    width: 20,
    height: 20,
    opacity: 0.7,
  },
  hintText: {
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: Fonts.jakarta.extraLight,
  },

  // Loading hint
  loadingHint: {
    alignItems: 'center',
    marginTop: 16,
  },
  loadingHintText: {
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: Fonts.jakarta.extraLight,
  },
});
