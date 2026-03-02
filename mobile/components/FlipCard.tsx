import React, { useCallback } from 'react';
import { Pressable, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';

interface FlipCardProps {
  front: React.ReactNode;
  back: React.ReactNode;
  style?: ViewStyle;
  onFlip?: (isFlipped: boolean) => void;
}

/**
 * 3D flip card using Reanimated.
 * Tap to flip between front and back faces.
 */
export function FlipCard({ front, back, style, onFlip }: FlipCardProps) {
  const rotation = useSharedValue(0);
  const isFlipped = useSharedValue(false);

  const handlePress = useCallback(() => {
    const newFlipped = !isFlipped.value;
    isFlipped.value = newFlipped;
    rotation.value = withTiming(newFlipped ? 180 : 0, {
      duration: 500,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
    onFlip?.(newFlipped);
  }, [onFlip]);

  const frontStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [0, 180]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden' as const,
      opacity: rotation.value < 90 ? 1 : 0,
    };
  });

  const backStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [180, 360]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden' as const,
      opacity: rotation.value >= 90 ? 1 : 0,
    };
  });

  return (
    <Pressable onPress={handlePress} style={style}>
      <Animated.View style={[{ position: 'absolute', width: '100%', height: '100%' }, frontStyle]}>
        {front}
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', width: '100%', height: '100%' }, backStyle]}>
        {back}
      </Animated.View>
    </Pressable>
  );
}
