import React, { useCallback } from 'react';
import { ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

interface ScrollRevealProps {
  children: React.ReactNode;
  style?: ViewStyle;
  delay?: number;
}

/**
 * Equivalent of web ScrollReveal — fades in with blur-like effect when visible.
 * Uses onLayout to detect when the component is mounted and triggers animation.
 * Since React Native doesn't have IntersectionObserver, we trigger on mount
 * with an optional delay for staggering.
 */
export function ScrollReveal({ children, style, delay = 0 }: ScrollRevealProps) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.97);
  const hasAnimated = useSharedValue(false);

  const triggerAnimation = useCallback(() => {
    if (hasAnimated.value) return;
    hasAnimated.value = true;

    const timingConfig = {
      duration: 600,
      easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
    };

    opacity.value = withTiming(1, { ...timingConfig });
    scale.value = withTiming(1, { ...timingConfig });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const onLayout = useCallback(() => {
    if (delay > 0) {
      setTimeout(triggerAnimation, delay);
    } else {
      triggerAnimation();
    }
  }, [delay, triggerAnimation]);

  return (
    <Animated.View style={[{ width: '100%' }, style, animatedStyle]} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}
