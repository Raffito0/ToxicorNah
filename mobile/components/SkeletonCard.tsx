import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface SkeletonCardProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
}

export function SkeletonCard({
  width = '100%',
  height = 200,
  borderRadius = 28,
}: SkeletonCardProps) {
  const shimmer = useSharedValue(0.3);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(0.6, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: shimmer.value,
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width: width as any, height, borderRadius },
        animatedStyle,
      ]}
    />
  );
}

export function SkeletonCardStack({ cardCount = 3 }: { cardCount?: number }) {
  return (
    <View style={styles.stack}>
      {Array.from({ length: cardCount }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.stackCard,
            {
              zIndex: cardCount - i,
              transform: [
                { rotate: `${(i - 1) * 6}deg` },
                { translateY: i * 12 },
              ],
            },
          ]}
        >
          <SkeletonCard height={300} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  stack: {
    position: 'relative',
    aspectRatio: 3 / 4,
  },
  stackCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
