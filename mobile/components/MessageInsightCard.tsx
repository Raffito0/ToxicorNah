import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Lock, Flag, Eye, Flame, ShieldCheck } from 'lucide-react-native';
import { Fonts, Colors } from '@/constants/Colors';
import { haptics } from '@/services/haptics';

const BASE_URL = 'https://toxicor-nah.vercel.app';

// Background images per tag type (hosted on web deployment)
const TAG_BACKGROUNDS: Record<string, string> = {
  'RED FLAG': `${BASE_URL}/Screenshot%202026-02-01%20111831%201.png`,
  'DECODED': `${BASE_URL}/Screenshot%202026-02-01%20111831%282%29%201.png`,
  'GREEN FLAG': `${BASE_URL}/Screenshot%202026-02-01%20111831%202.png`,
};

function getBackgroundUri(tag: string): string {
  const upper = (tag || '').toUpperCase();
  return TAG_BACKGROUNDS[upper] || TAG_BACKGROUNDS['RED FLAG'];
}

function getDefaultGradient(tag: string) {
  const tagUpper = (tag || '').toUpperCase();
  switch (tagUpper) {
    case 'GREEN FLAG':
      return { accent: '#9ddf90' };
    case 'DECODED':
      return { accent: '#B39DDB' };
    case 'RED FLAG':
    default:
      return { accent: '#ff9d9d' };
  }
}

function getTagIcon(tag: string, color: string) {
  const tagUpper = (tag || '').toUpperCase();
  switch (tagUpper) {
    case 'GREEN FLAG':
      return <Flag size={14} color={color} />;
    case 'DECODED':
      return <Eye size={14} color={color} />;
    case 'RED FLAG':
    default:
      return <Flame size={14} color={color} />;
  }
}

function getBackIcon(tag: string) {
  const tagUpper = (tag || '').toUpperCase();
  if (tagUpper === 'DECODED') {
    return <Eye size={24} color="white" />;
  }
  return <ShieldCheck size={24} color="white" />;
}

interface MessageInsightCardProps {
  message: string;
  messageCount: string;
  title: string;
  tag: string;
  tagColor: string;
  description: string;
  solution: string;
  gradientStart?: string;
  gradientEnd?: string;
  accentColor?: string;
  isTop: boolean;
  isFlipped: boolean;
  visualIndex: number;
  distanceFromTop: number;
  cardIndex?: number;
  isFirstTimeFree?: boolean;
  onTap: () => void;
  onSwipe: () => void;
  onPaywallOpen?: () => void;
  hasDealt?: boolean;
  dealDelay?: number;
}

const CARD_HEIGHT = 220;

export function MessageInsightCard({
  message,
  messageCount,
  title,
  tag,
  tagColor,
  description,
  solution,
  isTop,
  isFlipped,
  visualIndex,
  distanceFromTop,
  cardIndex = 0,
  isFirstTimeFree = false,
  onTap,
  onSwipe,
  onPaywallOpen,
  hasDealt = true,
  dealDelay = 0,
}: MessageInsightCardProps) {
  const defaults = getDefaultGradient(tag);
  const accentColor = defaults.accent;
  const translateY = visualIndex * 20;
  const scale = 1 - distanceFromTop * 0.02;

  const isCardLocked = isFirstTimeFree && cardIndex > 0;
  const isSolutionLocked = isFirstTimeFree;

  const bgUri = getBackgroundUri(tag);
  const isDecoded = (tag || '').toUpperCase() === 'DECODED';

  // ---- Deal animation ----
  const dealOpacity = useSharedValue(hasDealt ? 1 : 0);
  const dealScale = useSharedValue(hasDealt ? scale : 0.92);
  const dealTranslateY = useSharedValue(hasDealt ? translateY : 0);

  useEffect(() => {
    if (hasDealt) {
      dealOpacity.value = withDelay(
        dealDelay * 1000,
        withSpring(1, { stiffness: 300, damping: 30 }),
      );
      dealScale.value = withDelay(
        dealDelay * 1000,
        withSpring(scale, { stiffness: 300, damping: 30 }),
      );
      dealTranslateY.value = withDelay(
        dealDelay * 1000,
        withSpring(translateY, { stiffness: 300, damping: 30 }),
      );
    }
  }, [hasDealt]);

  // ---- Flip animation ----
  const flipRotation = useSharedValue(isFlipped ? 180 : 0);
  useEffect(() => {
    flipRotation.value = withTiming(isFlipped ? 180 : 0, {
      duration: 500,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
  }, [isFlipped]);

  // ---- Drag ----
  const dragY = useSharedValue(0);

  const handleTap = useCallback(() => {
    haptics.medium();
    if (isCardLocked) {
      onPaywallOpen?.();
    } else if (isSolutionLocked && !isFlipped) {
      onPaywallOpen?.();
    } else {
      onTap();
    }
  }, [isCardLocked, isSolutionLocked, isFlipped, onTap, onPaywallOpen]);

  const handleSwipe = useCallback(() => {
    if (isFirstTimeFree) {
      onPaywallOpen?.();
    } else {
      onSwipe();
    }
  }, [isFirstTimeFree, onSwipe, onPaywallOpen]);

  const panGesture = Gesture.Pan()
    .enabled(isTop)
    .onUpdate((e) => {
      dragY.value = e.translationY * 0.6;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > 60 || Math.abs(e.velocityY) > 400) {
        runOnJS(handleSwipe)();
      }
      dragY.value = withSpring(0, { stiffness: 500, damping: 35 });
    });

  const tapGesture = Gesture.Tap()
    .enabled(isTop)
    .onEnd(() => {
      runOnJS(handleTap)();
    });

  const composed = Gesture.Exclusive(panGesture, tapGesture);

  // ---- Animated styles ----
  const stackStyle = useAnimatedStyle(() => ({
    opacity: dealOpacity.value,
    transform: [
      { translateY: dealTranslateY.value },
      { scale: dealScale.value },
    ],
    zIndex: visualIndex,
  }));

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  const frontStyle = useAnimatedStyle(() => ({
    opacity: flipRotation.value < 90 ? 1 : 0,
    transform: [
      { perspective: 1000 },
      { rotateY: `${flipRotation.value}deg` },
    ],
    backfaceVisibility: 'hidden' as const,
  }));

  const backStyle = useAnimatedStyle(() => ({
    opacity: flipRotation.value >= 90 ? 1 : 0,
    transform: [
      { perspective: 1000 },
      { rotateY: `${flipRotation.value + 180}deg` },
    ],
    backfaceVisibility: 'hidden' as const,
  }));

  return (
    <Animated.View style={[styles.outerCard, { height: CARD_HEIGHT }, stackStyle]}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.innerCard, dragStyle]}>
          {/* ===== FRONT FACE ===== */}
          <Animated.View style={[styles.face, frontStyle]}>
            {/* Background image */}
            <Image
              source={{ uri: bgUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
            {/* Black 25% overlay */}
            <View style={styles.darkOverlay25} />
            {/* Bottom gradient (70% height) */}
            <LinearGradient
              colors={['transparent', 'rgba(0, 0, 0, 0.4)', 'rgba(0, 0, 0, 0.7)']}
              locations={[0, 0.4, 1]}
              style={styles.bottomGradient}
            />

            {/* Split content row */}
            <View style={styles.splitRow}>
              {/* LEFT: message bubble */}
              <View style={styles.leftHalf}>
                <View
                  style={[
                    styles.glassBubble,
                    {
                      backgroundColor: isDecoded
                        ? 'rgba(124, 77, 255, 0.18)'
                        : 'rgba(255, 255, 255, 0.08)',
                    },
                  ]}
                >
                  <Text style={styles.bubbleText} numberOfLines={4}>
                    {message}
                  </Text>
                </View>
              </View>

              {/* RIGHT: tag + title + description */}
              <View style={styles.rightHalf}>
                <View style={styles.tagRow}>
                  {getTagIcon(tag, accentColor)}
                  <Text style={[styles.tagLabel, { color: accentColor }]}>
                    {tag}
                  </Text>
                </View>

                <Text style={styles.cardTitle} numberOfLines={2}>
                  {title}
                </Text>

                <Text style={styles.cardDescription} numberOfLines={5}>
                  {description}
                </Text>

                {/* Message count — bottom right */}
                <View style={styles.messageCountRow}>
                  <Text style={styles.messageCountText}>{messageCount}</Text>
                  {isSolutionLocked && !isCardLocked && (
                    <Lock size={12} color="#A78BFA" />
                  )}
                </View>
              </View>
            </View>

            {/* Dim overlay for non-top, non-locked cards */}
            {!isTop && !isCardLocked && (
              <View style={styles.dimOverlay} />
            )}

            {/* Lock overlay (cards 2+) */}
            {isCardLocked && (
              <View style={styles.lockOverlay}>
                <View style={styles.lockBadge}>
                  <Lock size={24} color="#D8B4FE" />
                  <Text style={styles.lockText}>Unlock to See More</Text>
                </View>
              </View>
            )}
          </Animated.View>

          {/* ===== BACK FACE ===== */}
          <Animated.View style={[styles.face, backStyle]}>
            {/* Mirrored background image */}
            <Image
              source={{ uri: bgUri }}
              style={[StyleSheet.absoluteFill, { transform: [{ scaleX: -1 }] }]}
              contentFit="cover"
            />
            {/* Blur overlay */}
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            {/* Black 50% overlay */}
            <View style={styles.darkOverlay50} />

            {/* Centered content */}
            <View style={styles.backContent}>
              <View style={styles.backIconCircle}>
                {getBackIcon(tag)}
              </View>
              <Text style={styles.backTitle}>What It Really Means</Text>
              <Text style={styles.backSolution}>{solution}</Text>
            </View>

            {/* Lock overlay for solution */}
            {isSolutionLocked && (
              <View style={styles.lockOverlay}>
                <View style={styles.lockBadge}>
                  <Lock size={24} color="#D8B4FE" />
                  <Text style={styles.lockText}>Unlock to see solution</Text>
                </View>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outerCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  innerCard: {
    width: '100%',
    height: '100%',
  },
  face: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#111111',
  },

  // ---- Front overlays ----
  darkOverlay25: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    zIndex: 1,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
    zIndex: 2,
  },

  // ---- Split layout ----
  splitRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 10,
  },
  leftHalf: {
    width: '50%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  glassBubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 130,
    width: '100%',
    transform: [{ rotate: '-6deg' }],
  },
  bubbleText: {
    fontSize: 12,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    color: '#FFFFFF',
    lineHeight: 17,
  },
  rightHalf: {
    width: '50%',
    height: '100%',
    justifyContent: 'center',
    paddingLeft: 4,
    paddingRight: 16,
    paddingVertical: 12,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  tagLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 17,
    color: '#FFFFFF',
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    lineHeight: 20,
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    lineHeight: 17,
  },
  messageCountRow: {
    position: 'absolute',
    bottom: 12,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  messageCountText: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // ---- Dim + Lock overlays ----
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 20,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  lockBadge: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  lockText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    textAlign: 'center',
  },

  // ---- Back face ----
  darkOverlay50: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 2,
  },
  backContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 10,
  },
  backIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  backTitle: {
    fontSize: 14,
    fontFamily: Fonts.outfit.medium,
    color: '#FFFFFF',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  backSolution: {
    fontSize: 12,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 17,
  },
});
