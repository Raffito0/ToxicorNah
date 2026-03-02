import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  SkPath,
} from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  withTiming,
  useAnimatedReaction,
  runOnJS,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { Colors, Fonts } from '@/constants/Colors';

interface ScoreRingProps {
  score: number;
  maxScore?: number;
  size?: number;
  strokeWidth?: number;
  onColorCalculated?: (color: string) => void;
}

// ---- Color interpolation (matches web) ----

function interpolateColorChannels(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number,
): [number, number, number] {
  return [
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t),
  ];
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Get the ring color at a given percentage (0-1).
 * Matches the web version gradient: green -> yellow -> orange -> red
 */
export function getColorAtPercentage(percentage: number): string {
  const t = percentage;

  const GREEN = hexToRgb('#4ade80');
  const YELLOW = hexToRgb('#fbbf24');
  const ORANGE = hexToRgb('#ff6b35');
  const RED = hexToRgb('#ef4444');

  let r: number, g: number, b: number;

  if (t < 0.25) {
    [r, g, b] = interpolateColorChannels(...GREEN, ...YELLOW, t / 0.25);
  } else if (t < 0.5) {
    [r, g, b] = interpolateColorChannels(...YELLOW, ...ORANGE, (t - 0.25) / 0.25);
  } else if (t < 0.75) {
    [r, g, b] = interpolateColorChannels(...ORANGE, ...RED, (t - 0.5) / 0.25);
  } else {
    [r, g, b] = RED;
  }

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Convert a percentage (0-1) into a Skia-compatible color int.
 * Matches the same color stops as getColorAtPercentage.
 */
function getColorIntAtPercentage(percentage: number): number {
  const t = percentage;

  const GREEN = hexToRgb('#4ade80');
  const YELLOW = hexToRgb('#fbbf24');
  const ORANGE = hexToRgb('#ff6b35');
  const RED = hexToRgb('#ef4444');

  let r: number, g: number, b: number;

  if (t < 0.25) {
    [r, g, b] = interpolateColorChannels(...GREEN, ...YELLOW, t / 0.25);
  } else if (t < 0.5) {
    [r, g, b] = interpolateColorChannels(...YELLOW, ...ORANGE, (t - 0.25) / 0.25);
  } else if (t < 0.75) {
    [r, g, b] = interpolateColorChannels(...ORANGE, ...RED, (t - 0.5) / 0.25);
  } else {
    [r, g, b] = RED;
  }

  // ARGB packed int (alpha = 255)
  return ((255 << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

// ---- Segment path builders ----

const TOTAL_SEGMENTS = 72; // number of visual segments in the ring
const SEGMENT_GAP_DEG = 1.2; // degrees of gap between segments
const START_ANGLE = -90; // start from top (12 o'clock)

/**
 * Build the background ring path (full circle, segmented, gray).
 */
function buildBackgroundPath(
  cx: number,
  cy: number,
  radius: number,
  strokeWidth: number,
): string {
  const segmentArc = 360 / TOTAL_SEGMENTS;
  const drawArc = segmentArc - SEGMENT_GAP_DEG;
  const parts: string[] = [];

  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    const startDeg = START_ANGLE + i * segmentArc;
    parts.push(arcSegmentPath(cx, cy, radius, startDeg, drawArc));
  }

  return parts.join(' ');
}

/**
 * Build an arc segment SVG path string from a center, radius, start angle,
 * and sweep angle (all in degrees).
 */
function arcSegmentPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  sweepDeg: number,
): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(startDeg + sweepDeg));
  const y2 = cy + r * Math.sin(toRad(startDeg + sweepDeg));
  const largeArc = sweepDeg > 180 ? 1 : 0;

  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

/**
 * Build individual segment paths for the colored ring so each can be
 * colored independently based on its position.
 */
function buildSegmentPaths(
  cx: number,
  cy: number,
  radius: number,
): { path: string; colorT: number }[] {
  const segmentArc = 360 / TOTAL_SEGMENTS;
  const drawArc = segmentArc - SEGMENT_GAP_DEG;
  const result: { path: string; colorT: number }[] = [];

  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    const startDeg = START_ANGLE + i * segmentArc;
    const colorT = i / TOTAL_SEGMENTS; // 0..1 position in the ring
    result.push({
      path: arcSegmentPath(cx, cy, radius, startDeg, drawArc),
      colorT,
    });
  }

  return result;
}

// ---- Component ----

export function ScoreRing({
  score,
  maxScore = 100,
  size = 208,
  strokeWidth = 14,
  onColorCalculated,
}: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Animated progress 0 -> 1
  const progress = useSharedValue(0);
  // Animated displayed score number
  const displayedScore = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    displayedScore.value = 0;
    progress.value = withTiming(score / maxScore, {
      duration: 2000,
      easing: Easing.out(Easing.cubic),
    });
    displayedScore.value = withTiming(score, {
      duration: 2000,
      easing: Easing.out(Easing.cubic),
    });
  }, [score, maxScore]);

  // Report color to parent
  useAnimatedReaction(
    () => displayedScore.value,
    (current) => {
      if (onColorCalculated && current > 0) {
        const pct = current / maxScore;
        const color = getColorAtPercentage(pct);
        runOnJS(onColorCalculated)(color);
      }
    },
  );

  // Build static paths
  const bgPathStr = useMemo(
    () => buildBackgroundPath(cx, cy, radius, strokeWidth),
    [cx, cy, radius, strokeWidth],
  );

  const bgPath = useMemo(() => {
    const p = Skia.Path.MakeFromSVGString(bgPathStr);
    return p ?? Skia.Path.Make();
  }, [bgPathStr]);

  const segments = useMemo(
    () => buildSegmentPaths(cx, cy, radius),
    [cx, cy, radius],
  );

  const segmentSkiaPaths = useMemo(
    () =>
      segments.map((s) => {
        const p = Skia.Path.MakeFromSVGString(s.path);
        return { path: p ?? Skia.Path.Make(), colorT: s.colorT };
      }),
    [segments],
  );

  // Derive which segments to show and their colors based on animated progress
  const segmentCount = useDerivedValue(() => {
    return Math.floor(progress.value * TOTAL_SEGMENTS);
  });

  // For the text readout we need a JS state value
  const [displayNumber, setDisplayNumber] = React.useState(0);

  useAnimatedReaction(
    () => Math.floor(displayedScore.value),
    (current, previous) => {
      if (current !== previous) {
        runOnJS(setDisplayNumber)(current);
      }
    },
  );

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Canvas style={{ width: size, height: size }}>
        {/* Background ring (gray) */}
        <Path
          path={bgPath}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap="round"
          color="#1A1A1A"
        />

        {/* Colored segments */}
        {segmentSkiaPaths.map((seg, i) => (
          <AnimatedSegment
            key={i}
            path={seg.path}
            strokeWidth={strokeWidth}
            colorT={seg.colorT}
            index={i}
            segmentCount={segmentCount}
          />
        ))}
      </Canvas>

      {/* Score text overlay */}
      <View style={styles.textOverlay}>
        <Text style={styles.scoreText}>{displayNumber}</Text>
        <Text style={styles.maxScoreText}>/{maxScore}</Text>
      </View>
    </View>
  );
}

// ---- Animated single segment ----

interface AnimatedSegmentProps {
  path: SkPath;
  strokeWidth: number;
  colorT: number;
  index: number;
  segmentCount: SharedValue<number>;
}

function AnimatedSegment({
  path,
  strokeWidth,
  colorT,
  index,
  segmentCount,
}: AnimatedSegmentProps) {
  const opacity = useDerivedValue(() => {
    return index < segmentCount.value ? 1 : 0;
  });

  const colorInt = useMemo(() => getColorIntAtPercentage(colorT), [colorT]);

  // Convert to hex for Skia
  const r = (colorInt >> 16) & 0xff;
  const g = (colorInt >> 8) & 0xff;
  const b = colorInt & 0xff;
  const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={strokeWidth}
      strokeCap="round"
      color={hexColor}
      opacity={opacity}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    marginBottom: 12,
  },
  textOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  scoreText: {
    fontSize: 42,
    color: Colors.white,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
  },
  maxScoreText: {
    fontSize: 13,
    color: '#747474',
    marginTop: 2,
    fontFamily: Fonts.jakarta.light,
  },
});
