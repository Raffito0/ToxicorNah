import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

export interface ToxicOrbProps {
  score: number;
  size?: number;
  animationDuration?: number;
  isLoading?: boolean;
  fontSizeOverride?: number;
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function getZoneColors(score: number) {
  const s = clamp(score);
  if (s <= 33) {
    return {
      bg: "oklch(15% 0.02 180)",
      c1: "oklch(75% 0.18 170)",
      c2: "oklch(70% 0.15 145)",
      c3: "oklch(72% 0.16 190)",
      c4: "oklch(68% 0.14 160)",
    };
  }
  if (s <= 66) {
    return {
      bg: "oklch(15% 0.02 60)",
      c1: "oklch(78% 0.18 70)",
      c2: "oklch(75% 0.20 45)",
      c3: "oklch(82% 0.15 90)",
      c4: "oklch(70% 0.22 55)",
    };
  }
  return {
    bg: "oklch(8% 0.06 15)",
    c1: "oklch(40% 0.28 25)",
    c2: "oklch(80% 0.20 65)",
    c3: "oklch(60% 0.32 350)",
    c4: "oklch(72% 0.18 75)",
  };
}

const LOADING_COLORS = {
  bg: "oklch(12% 0.03 280)",
  c1: "oklch(45% 0.15 280)",
  c2: "oklch(55% 0.18 290)",
  c3: "oklch(50% 0.12 270)",
  c4: "oklch(40% 0.10 285)",
};

// Build the full HTML for the orb — identical CSS from the web app
function buildOrbHTML(params: {
  size: number;
  colors: { bg: string; c1: string; c2: string; c3: string; c4: string };
  animationDuration: number;
  blurAmount: number;
  finalContrast: number;
  flameIntensity: number;
  maskRadius: string;
}) {
  const { size, colors, animationDuration, blurAmount, finalContrast, flameIntensity, maskRadius } = params;
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @property --angle {
    syntax: "<angle>";
    inherits: false;
    initial-value: 0deg;
  }

  .toxic-orb {
    width: ${size}px;
    height: ${size}px;
    display: grid;
    grid-template-areas: "stack";
    overflow: visible;
    position: relative;
    animation: blob-morph 12s ease-in-out infinite;
    --bg: ${colors.bg};
    --c1: ${colors.c1};
    --c2: ${colors.c2};
    --c3: ${colors.c3};
    --c4: ${colors.c4};
    --animation-duration: ${animationDuration}s;
    --blur-amount: ${blurAmount}px;
    --contrast-amount: ${finalContrast};
    --flame-intensity: ${flameIntensity};
    --mask-radius: ${maskRadius};
  }

  @keyframes blob-morph {
    0%, 100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
    25% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; }
    50% { border-radius: 50% 60% 30% 60% / 30% 40% 70% 50%; }
    75% { border-radius: 60% 40% 60% 40% / 70% 30% 50% 60%; }
  }

  .toxic-orb::before,
  .toxic-orb::after {
    content: "";
    display: block;
    grid-area: stack;
    width: 100%;
    height: 100%;
    border-radius: inherit;
  }

  .toxic-orb::before {
    background:
      conic-gradient(from calc(var(--angle) * 2) at 25% 70%, var(--c3), transparent 15% 85%, var(--c3)),
      conic-gradient(from calc(var(--angle) * -1.5) at 50% 50%, var(--c4), transparent 10% 90%, var(--c4)),
      conic-gradient(from calc(var(--angle) * 2) at 45% 75%, var(--c2), transparent 20% 70%, var(--c2)),
      conic-gradient(from calc(var(--angle) * -3) at 80% 20%, var(--c1), transparent 25% 75%, var(--c1)),
      conic-gradient(from calc(var(--angle) * 1.5) at 70% 60%, var(--c4), transparent 15% 85%, var(--c4)),
      conic-gradient(from calc(var(--angle) * 2) at 15% 5%, var(--c2), transparent 10% 90%, var(--c2)),
      conic-gradient(from calc(var(--angle) * 1) at 20% 80%, var(--c1), transparent 10% 90%, var(--c1)),
      conic-gradient(from calc(var(--angle) * -2) at 85% 10%, var(--c3), transparent 15% 85%, var(--c3)),
      conic-gradient(from calc(var(--angle) * 2.5) at 30% 30%, var(--c4), transparent 20% 80%, var(--c4));
    filter: blur(var(--blur-amount)) contrast(var(--contrast-amount));
    animation: toxic-rotate var(--animation-duration) linear infinite;
  }

  /* Radial mask: hides contrast-filter dark artifacts at edges */
  .toxic-orb {
    -webkit-mask-image: radial-gradient(circle at center, black 0%, black 64%, transparent 72%);
    mask-image: radial-gradient(circle at center, black 0%, black 64%, transparent 72%);
  }

  @keyframes toxic-rotate {
    to { --angle: 360deg; }
  }
</style>
</head>
<body>
  <div class="toxic-orb"></div>
</body>
</html>`;
}

const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;

export function ToxicOrb({
  score,
  size = 260,
  animationDuration = 20,
  isLoading = false,
  fontSizeOverride,
}: ToxicOrbProps) {
  const colors = isLoading ? LOADING_COLORS : getZoneColors(score);

  const s = clamp(score);
  const flameIntensity = s > 66 ? 1.15 : s > 33 ? 1.1 : 1.05;

  const blurAmount = size < SIZE_THRESHOLD_SMALL
    ? Math.max(size * 0.008, 1)
    : Math.max(size * 0.015, 4);

  const contrastAmount = size < SIZE_THRESHOLD_SMALL
    ? Math.max(size * 0.004, 1.2)
    : Math.max(size * 0.008, 1.5);

  const getMaskRadius = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return "0%";
    if (value < SIZE_THRESHOLD_SMALL) return "5%";
    if (value < SIZE_THRESHOLD_MEDIUM) return "15%";
    return "25%";
  };

  const finalContrast = size < SIZE_THRESHOLD_TINY
    ? 1.1
    : size < SIZE_THRESHOLD_SMALL
      ? Math.max(contrastAmount * 1.2, 1.3)
      : contrastAmount;

  // Extra padding so the blob-morph animation doesn't get clipped at edges
  const orbPadding = Math.round(size * 0.15);
  const webViewSize = size + orbPadding * 2;

  const html = buildOrbHTML({
    size,
    colors,
    animationDuration,
    blurAmount,
    finalContrast,
    flameIntensity,
    maskRadius: getMaskRadius(size),
  });

  // Count-up animation for score number
  const animatedScore = useSharedValue(0);
  const [displayScore, setDisplayScore] = useState('0');

  useAnimatedReaction(
    () => Math.round(animatedScore.value),
    (current) => {
      runOnJS(setDisplayScore)(current.toString());
    },
  );

  useEffect(() => {
    animatedScore.value = withTiming(score, {
      duration: 850,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [score]);

  // Entrance animation
  const entranceOpacity = useSharedValue(0);
  const entranceScale = useSharedValue(0.8);

  useEffect(() => {
    entranceOpacity.value = withTiming(1, { duration: 1200, easing: Easing.bezier(0.16, 1, 0.3, 1) });
    entranceScale.value = withTiming(1, { duration: 1200, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: entranceOpacity.value,
    transform: [{ scale: entranceScale.value }],
  }));

  // Score text entrance (delayed)
  const scoreOpacity = useSharedValue(0);
  const scoreScale = useSharedValue(0.5);

  useEffect(() => {
    const timer = setTimeout(() => {
      scoreOpacity.value = withTiming(1, { duration: 1000, easing: Easing.bezier(0.16, 1, 0.3, 1) });
      scoreScale.value = withTiming(1, { duration: 1000, easing: Easing.bezier(0.16, 1, 0.3, 1) });
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const scoreStyle = useAnimatedStyle(() => ({
    opacity: scoreOpacity.value,
    transform: [{ scale: scoreScale.value }],
  }));

  const fontSize = fontSizeOverride || Math.max(size * 0.25, 9);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* WebView renders the exact same CSS orb — oversized so blob-morph isn't clipped */}
      <Animated.View style={[styles.webViewContainer, { width: webViewSize, height: webViewSize }, containerStyle]}>
        <WebView
          source={{ html }}
          style={{ width: webViewSize, height: webViewSize, backgroundColor: 'transparent' }}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          pointerEvents="none"
          androidLayerType="hardware"
          originWhitelist={['*']}
        />
      </Animated.View>

      {/* Native score text overlay — animated with Reanimated */}
      {!isLoading && (
        <Animated.View style={[styles.scoreOverlay, scoreStyle]}>
          <Text
            style={[
              styles.scoreText,
              {
                fontSize,
                fontWeight: size < 60 ? '400' : '600',
              },
            ]}
          >
            {displayScore}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  webViewContainer: {
    position: 'absolute',
  },
  scoreOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  scoreText: {
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans-Regular',
    letterSpacing: -0.7,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 20,
  },
});
