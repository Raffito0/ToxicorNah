import React, { useEffect, useMemo, useState } from 'react';
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
import { Colors, Fonts } from '@/constants/Colors';

export interface FlameHaloProps {
  /** Toxicity score 0-100 */
  score: number;
  /** Diameter in px (default 220) */
  size?: number;
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function palette(score: number) {
  const s = clamp(score);
  if (s <= 33)
    return {
      a: '#00FFD1',
      b: '#00B4FF',
      zone: 'SAFE ZONE',
      zoneColor: Colors.safeZone,
    };
  if (s <= 66)
    return {
      a: '#FFC35A',
      b: '#FF6A3D',
      zone: 'RISKY ZONE',
      zoneColor: Colors.riskyZone,
    };
  return {
    a: '#FF47C8',
    b: '#7A5CFF',
    zone: 'TOXIC ZONE',
    zoneColor: Colors.toxicZone,
  };
}

/**
 * Build the full HTML document for the SVG flame halo.
 * Uses feTurbulence + feDisplacementMap + feGaussianBlur identical to the web version.
 * The seed is animated via JS requestAnimationFrame inside the WebView.
 */
function buildFlameHTML(params: {
  size: number;
  colorA: string;
  colorB: string;
  baseFreq: number;
  displacementScale: number;
}): string {
  const { size, colorA, colorB, baseFreq, displacementScale } = params;

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
  svg {
    overflow: visible;
  }
</style>
</head>
<body>
  <svg width="${size}" height="${size}" viewBox="0 0 200 200">
    <defs>
      <!-- Liquid flame distortion -->
      <filter id="flame-liquid" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence
          id="turb"
          type="fractalNoise"
          baseFrequency="${baseFreq}"
          numOctaves="2"
          seed="0"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="${displacementScale}"
          xChannelSelector="R"
          yChannelSelector="G"
        />
        <!-- soft bloom -->
        <feGaussianBlur stdDeviation="1.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Glow -->
      <filter id="flame-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="6" result="b" />
        <feColorMatrix
          in="b"
          type="matrix"
          values="
            1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            0 0 0 0.9 0"
          result="c"
        />
        <feMerge>
          <feMergeNode in="c" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Gradient stroke -->
      <linearGradient id="flame-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${colorA}" stop-opacity="0.95" />
        <stop offset="55%" stop-color="${colorB}" stop-opacity="0.85" />
        <stop offset="100%" stop-color="${colorA}" stop-opacity="0.35" />
      </linearGradient>

      <!-- Fine grain overlay -->
      <filter id="flame-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="table" tableValues="0 0.12" />
        </feComponentTransfer>
      </filter>
    </defs>

    <!-- OUTER AURA haze -->
    <circle
      cx="100" cy="100" r="56"
      fill="none"
      stroke="${colorB}"
      stroke-opacity="0.10"
      stroke-width="30"
      filter="url(#flame-glow)"
    />

    <!-- FLAME RING (the main thing) -->
    <g filter="url(#flame-liquid)">
      <circle
        cx="100" cy="100" r="54"
        fill="none"
        stroke="url(#flame-grad)"
        stroke-width="10"
        stroke-linecap="round"
        opacity="0.95"
      />
      <!-- inner ring for depth -->
      <circle
        cx="100" cy="100" r="48"
        fill="none"
        stroke="${colorA}"
        stroke-opacity="0.22"
        stroke-width="6"
      />
    </g>

    <!-- Grain -->
    <rect
      x="0" y="0" width="200" height="200"
      filter="url(#flame-grain)"
      opacity="0.35"
      style="mix-blend-mode: overlay"
    />
  </svg>

  <script>
    // Animate the feTurbulence seed for the living flame effect
    var turb = document.getElementById('turb');
    var t = 0;
    function tick() {
      t += 0.9;
      turb.setAttribute('seed', Math.floor(t));
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  </script>
</body>
</html>`;
}

export function FlameHalo({ score, size = 220 }: FlameHaloProps) {
  const pal = palette(score);

  // "Wildness" scales with score
  const s = clamp(score);
  const baseFreq = s > 66 ? 0.012 : s > 33 ? 0.01 : 0.008;
  const displacementScale = s > 66 ? 18 : s > 33 ? 14 : 10;

  // Memoize HTML to avoid rebuilds
  const html = useMemo(
    () =>
      buildFlameHTML({
        size,
        colorA: pal.a,
        colorB: pal.b,
        baseFreq,
        displacementScale,
      }),
    [size, pal.a, pal.b, baseFreq, displacementScale],
  );

  // ===== Score count-up animation (native, matches ToxicOrb pattern) =====
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
    entranceOpacity.value = withTiming(1, {
      duration: 1200,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    entranceScale.value = withTiming(1, {
      duration: 1200,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
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
      scoreOpacity.value = withTiming(1, {
        duration: 1000,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      });
      scoreScale.value = withTiming(1, {
        duration: 1000,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      });
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const scoreStyle = useAnimatedStyle(() => ({
    opacity: scoreOpacity.value,
    transform: [{ scale: scoreScale.value }],
  }));

  const scoreFontSize = Math.max(size * 0.29, 24);

  return (
    <View style={[styles.wrapper, { width: size }]}>
      {/* Halo container */}
      <View style={[styles.haloContainer, { width: size, height: size }]}>
        {/* WebView renders the SVG flame ring */}
        <Animated.View
          style={[styles.webViewWrap, { width: size, height: size }, containerStyle]}
        >
          <WebView
            source={{ html }}
            style={{ width: size, height: size, backgroundColor: 'transparent' }}
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

        {/* Native score text overlay */}
        <Animated.View style={[styles.scoreOverlay, scoreStyle]}>
          <Text style={[styles.scoreText, { fontSize: scoreFontSize }]}>
            {displayScore}
          </Text>
          <Text style={styles.scoreDenominator}>/100</Text>
        </Animated.View>
      </View>

      {/* Zone label */}
      <Text style={[styles.zoneLabel, { color: pal.zoneColor }]}>{pal.zone}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  haloContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webViewWrap: {
    position: 'absolute',
  },
  scoreOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  scoreText: {
    color: Colors.white,
    fontFamily: Fonts.jakarta.regular,
    fontWeight: '600',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 20,
  },
  scoreDenominator: {
    color: Colors.textDim,
    fontSize: 12,
    fontFamily: Fonts.jakarta.regular,
    fontWeight: '400',
    marginTop: -2,
  },
  zoneLabel: {
    marginTop: 8,
    fontSize: 11,
    letterSpacing: 3,
    fontFamily: Fonts.outfit.medium,
  },
});
