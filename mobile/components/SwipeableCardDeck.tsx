import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Lock } from 'lucide-react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Fonts, Colors } from '@/constants/Colors';
import { SkeletonCardStack } from '@/components/SkeletonCard';

interface CardData {
  index: number;
  categoryTitle: string;
  categoryTagline: string;
  punchyText: string;
  image: string;
}

const BASE_URL = 'https://toxicor-nah.vercel.app';

interface SwipeableCardDeckProps {
  cards?: CardData[];
  isFirstTimeFree?: boolean;
  onPaywallOpen?: () => void;
  isLoading?: boolean;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Match web: container maxWidth=400, paddingHorizontal=30, deck is 32px narrower
const CONTAINER_WIDTH = Math.min(SCREEN_WIDTH, 400);
const CARD_WIDTH = CONTAINER_WIDTH - 60 - 32;
const SWIPE_THRESHOLD = 50;

export function SwipeableCardDeck({
  cards: externalCards,
  isFirstTimeFree = false,
  onPaywallOpen,
  isLoading = false,
}: SwipeableCardDeckProps) {
  const [allCards, setAllCards] = useState<CardData[]>(externalCards || []);
  const [stackOrder, setStackOrder] = useState<number[]>([]);
  const [hasDealt, setHasDealt] = useState(false);

  useEffect(() => {
    if (externalCards && externalCards.length > 0) {
      setAllCards(externalCards);
      setStackOrder(externalCards.map((_, i) => externalCards.length - 1 - i));
      // Trigger deal animation after a short delay
      setTimeout(() => setHasDealt(true), 200);
    }
  }, [externalCards]);

  const moveTopToBottom = useCallback(() => {
    setStackOrder((prev) => {
      const newOrder = [...prev];
      const top = newOrder.pop()!;
      newOrder.unshift(top);
      return newOrder;
    });
  }, []);

  // ---- Skeleton loading state (matches web) ----
  if (isLoading || allCards.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.subtitle}>Emotional Breakdown</Text>
          <Text style={styles.title}>
            What The F
            <Text style={{ opacity: 0.7 }}>u</Text>
            <Text style={{ opacity: 0.5 }}>c</Text>
            <Text style={{ opacity: 0.3 }}>k</Text>
            {' '}Is Happening{'\n'}In The Chat
          </Text>
        </View>

        <View style={styles.deckContainer}>
          <SkeletonCardStack cardCount={3} />
        </View>

        <LoadingHint />
      </View>
    );
  }

  const orderedCards = stackOrder.map(index => allCards[index]);

  return (
    <View style={styles.container}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.subtitle}>Emotional Breakdown</Text>
        <Text style={styles.title}>
          What The F
          <Text style={{ opacity: 0.7 }}>u</Text>
          <Text style={{ opacity: 0.5 }}>c</Text>
          <Text style={{ opacity: 0.3 }}>k</Text>
          {' '}Is Happening{'\n'}In The Chat
        </Text>
      </View>

      {/* Card stack */}
      <View style={styles.deckContainer}>
        {orderedCards.map((cardItem, visualIndex) => {
          const isTop = visualIndex === orderedCards.length - 1;
          const isCardLocked = isFirstTimeFree && cardItem.index > 0;

          return (
            <SwipeableCard
              key={cardItem.index}
              cardItem={cardItem}
              visualIndex={visualIndex}
              isTop={isTop}
              isCardLocked={isCardLocked}
              hasDealt={hasDealt}
              totalCards={orderedCards.length}
              onSwipe={() => {
                if (isFirstTimeFree) {
                  onPaywallOpen?.();
                } else {
                  moveTopToBottom();
                }
              }}
              onTapLocked={() => onPaywallOpen?.()}
            />
          );
        })}
      </View>

      {/* Swipe hint — pulsing animation matching web */}
      <PulsingHint />
    </View>
  );
}

/** Animated loading hint */
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
    <View style={styles.hintContainer}>
      <Animated.Text style={[styles.hintText, animatedStyle]}>
        Analyzing patterns...
      </Animated.Text>
    </View>
  );
}

/** Pulsing "Swipe the card" hint with hand icon */
function PulsingHint() {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.hintContainer, animatedStyle]}>
      <Image
        source={{ uri: `${BASE_URL}/hand%20(2).png` }}
        style={styles.hintIcon}
        contentFit="contain"
      />
      <Text style={styles.hintText}>Swipe the card</Text>
    </Animated.View>
  );
}

// Individual swipeable card with gesture handling
function SwipeableCard({
  cardItem,
  visualIndex,
  isTop,
  isCardLocked,
  hasDealt,
  totalCards,
  onSwipe,
  onTapLocked,
}: {
  cardItem: CardData;
  visualIndex: number;
  isTop: boolean;
  isCardLocked: boolean;
  hasDealt: boolean;
  totalCards: number;
  onSwipe: () => void;
  onTapLocked: () => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isFirstDeal = useRef(true);

  const rotation = isTop ? 0 : (visualIndex - 1) * 6;
  const stackTranslateY = visualIndex * 12;

  // Deal animation shared values
  const dealOpacity = useSharedValue(hasDealt ? 1 : 0);
  const dealScale = useSharedValue(hasDealt ? (isTop ? 1.02 : 1) : 0.92);
  const dealRotation = useSharedValue(hasDealt ? rotation : 0);
  const dealTranslateY = useSharedValue(hasDealt ? stackTranslateY : 0);

  useEffect(() => {
    if (hasDealt) {
      // Stagger only on the very first deal, not on swipe reorders
      const stagger = isFirstDeal.current && !isTop ? visualIndex * 80 : 0;
      const spring = { stiffness: 260, damping: 25 };
      dealOpacity.value = withDelay(stagger, withSpring(1, spring));
      dealScale.value = withDelay(stagger, withSpring(isTop ? 1.02 : 1, spring));
      dealRotation.value = withDelay(stagger, withSpring(rotation, spring));
      dealTranslateY.value = withDelay(stagger, withSpring(stackTranslateY, spring));

      if (isFirstDeal.current && isTop) {
        isFirstDeal.current = false;
      }
    }
  }, [hasDealt, isTop, visualIndex]);

  // Pan gesture — no activeOffsetX so translation isn't eaten.
  // minDistance(10) gives a small dead-zone.
  // RNGH ScrollView (in ResultsPage) arbitrates: when this Pan activates, scroll is cancelled.
  const panGesture = Gesture.Pan()
    .enabled(isTop && !isCardLocked)
    .minDistance(10)
    .onUpdate((e) => {
      translateX.value = e.translationX * 0.7;
      translateY.value = e.translationY * 0.7;
    })
    .onEnd((e) => {
      const totalOffset = Math.abs(e.translationX) + Math.abs(e.translationY);
      const totalVelocity = Math.abs(e.velocityX) + Math.abs(e.velocityY);

      if (totalOffset > SWIPE_THRESHOLD || totalVelocity > 400) {
        runOnJS(onSwipe)();
      }

      translateX.value = withSpring(0, { stiffness: 500, damping: 35 });
      translateY.value = withSpring(0, { stiffness: 500, damping: 35 });
    });

  const tapGesture = Gesture.Tap()
    .enabled(isTop && isCardLocked)
    .onEnd(() => {
      runOnJS(onTapLocked)();
    });

  // Exclusive: first gesture to activate wins (pan for swipe, tap for locked cards)
  const composed = Gesture.Exclusive(panGesture, tapGesture);

  // Outer stack position — NO zIndex in animated style (Android unreliable).
  // Rendering order handles z-stacking (last child = on top).
  const stackStyle = useAnimatedStyle(() => ({
    opacity: dealOpacity.value,
    transform: [
      { rotate: `${dealRotation.value}deg` },
      { translateY: dealTranslateY.value },
      { scale: dealScale.value },
    ],
  }));

  // Inner drag offset
  const dragStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  // Resolve image URL
  const imageUri = cardItem.image
    ? (cardItem.image.startsWith('http')
        ? cardItem.image
        : `${BASE_URL}/${cardItem.image}`)
    : undefined;

  return (
    <Animated.View style={[styles.cardOuter, stackStyle]}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.cardInner, dragStyle]}>
          {/* Card content */}
          <View style={[
            styles.card,
            isTop && styles.cardTopShadow,
            !isTop && { opacity: 0.7 },
          ]}>
            {/* Top half - Image */}
            <View style={styles.imageContainer}>
              {imageUri && (
                <Image
                  source={{ uri: imageUri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              )}
              {/* Bottom gradient blend into card bg */}
              <LinearGradient
                colors={['transparent', '#111111']}
                style={styles.imageGradient}
              />
            </View>

            {/* Bottom half - Content */}
            <View style={styles.contentContainer}>
              <Text style={styles.categoryTitle}>{cardItem.categoryTitle}</Text>
              <Text style={styles.punchyText}>{cardItem.punchyText}</Text>
            </View>
          </View>

          {/* Darkening overlay for non-top cards */}
          {!isTop && !isCardLocked && (
            <View style={styles.darkenOverlay} />
          )}

          {/* Lock overlay */}
          {isCardLocked && (
            <View style={styles.lockOverlay}>
              <View style={styles.lockBadge}>
                <Lock size={32} color="#D8B4FE" />
                <Text style={styles.lockTitle}>Unlock Full Analysis</Text>
                <Text style={styles.lockSubtitle}>
                  Tap to see {cardItem.categoryTitle}
                </Text>
              </View>
            </View>
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    paddingHorizontal: 30,
    paddingTop: 96,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: Fonts.jakarta.extraLight,
    marginBottom: 8,
  },
  title: {
    fontSize: 33,
    color: '#FFFFFF',
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  deckContainer: {
    width: CARD_WIDTH,
    aspectRatio: 3 / 4,
    alignSelf: 'center',
    position: 'relative',
  },
  cardOuter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardInner: {
    width: '100%',
    height: '100%',
  },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#111111',
  },
  cardTopShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 20,
  },
  imageContainer: {
    width: '100%',
    height: '50%',
    overflow: 'hidden',
  },
  imageGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
  },
  contentContainer: {
    width: '100%',
    height: '50%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  categoryTitle: {
    fontSize: 30,
    color: '#FFFFFF',
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  punchyText: {
    fontSize: 14,
    fontFamily: Fonts.jakarta.extraLight,
    lineHeight: 21,
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    maxWidth: 280,
  },
  darkenOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  lockBadge: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingVertical: 24,
    borderRadius: 16,
    backgroundColor: Colors.purple.bg,
    borderWidth: 1,
    borderColor: Colors.purple.light,
  },
  lockTitle: {
    fontSize: 14,
    color: '#FFFFFF',
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  lockSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: Fonts.jakarta.regular,
    textAlign: 'center',
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 70,
  },
  hintIcon: {
    width: 20,
    height: 20,
    opacity: 0.7,
  },
  hintText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: Fonts.jakarta.extraLight,
  },
});
