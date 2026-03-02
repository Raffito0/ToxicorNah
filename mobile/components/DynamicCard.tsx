import React, { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { Colors, Fonts } from '@/constants/Colors';

const BASE_URL = 'https://toxicor-nah.vercel.app';

interface SoulTypeInfo {
  name: string;
  title: string;
  /** Full URL or path to main image */
  imageUrl: string;
  /** Full URL or path to side-profile .png */
  sideProfileImageUrl?: string;
}

export interface DynamicCardProps {
  /** The name of the relationship dynamic (e.g. "Mirror & Maze") */
  dynamicName: string;
  /** One-line subtitle shown below the dynamic name */
  subtitle: string;
  /** "Why This Happens" explanation (back side) */
  whyThisHappens: string;
  /** "Your Next Move" advice text (back side) */
  patternBreak: string;
  /** The partner's (his) Soul Type info */
  partnerSoulType: SoulTypeInfo;
  /** The user's (her) Soul Type info */
  userSoulType: SoulTypeInfo;
  /** Partner gender — determines label text */
  partnerGender?: 'male' | 'female';
  /** User gender */
  userGender?: 'male' | 'female';
  /** Card width (defaults to screen width - 48) */
  width?: number;
}

/**
 * Resolves image URLs: ensures they are absolute URLs.
 * Side-profile .png images are used for the blend (never .mp4 videos).
 */
function resolveImageUrl(archetype: SoulTypeInfo): string {
  const url = archetype.sideProfileImageUrl || archetype.imageUrl;
  if (url.startsWith('http')) return url;
  // Relative path — prepend deployment base
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Build the HTML for the front-face WebView.
 * Two side-profile images with mix-blend-mode: lighten on #111111 bg.
 */
function buildFrontHTML(
  leftImageUrl: string,
  rightImageUrl: string,
  width: number,
  height: number,
): string {
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
  .img-base, .img-blend {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .img-base {
    object-position: left center;
  }
  .img-blend {
    object-position: right center;
    mix-blend-mode: lighten;
  }
  /* Noise grain overlay */
  .grain {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none;
    opacity: 0.06;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
    mix-blend-mode: overlay;
  }
</style>
</head>
<body>
  <div class="container">
    <img class="img-base" src="${leftImageUrl}" alt="" />
    <img class="img-blend" src="${rightImageUrl}" alt="" />
    <div class="grain"></div>
  </div>
</body>
</html>`;
}

/**
 * Build the HTML for the back-face blurred background WebView.
 * Same two images blended with mix-blend-mode: lighten, but with blur(35px).
 */
function buildBackHTML(
  leftImageUrl: string,
  rightImageUrl: string,
  width: number,
  height: number,
): string {
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
  .img-base, .img-blend {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .img-base {
    object-position: left center;
  }
  .img-blend {
    object-position: right center;
    mix-blend-mode: lighten;
  }
  /* Dark overlay */
  .dark-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.25);
  }
  /* Subtle gradient for depth */
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
      <img class="img-base" src="${leftImageUrl}" alt="" />
      <img class="img-blend" src="${rightImageUrl}" alt="" />
    </div>
    <div class="dark-overlay"></div>
    <div class="depth-gradient"></div>
  </div>
</body>
</html>`;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function DynamicCard({
  dynamicName,
  subtitle,
  whyThisHappens,
  patternBreak,
  partnerSoulType,
  userSoulType,
  partnerGender = 'male',
  userGender = 'female',
  width: cardWidth,
}: DynamicCardProps) {
  const width = cardWidth ?? SCREEN_WIDTH - 48;
  const height = (width / 9) * 16; // 9:16 aspect ratio

  // Resolve image URLs (always .png side profiles for the blend)
  const leftImageUrl = resolveImageUrl(partnerSoulType);
  const rightImageUrl = resolveImageUrl(userSoulType);

  // Labels based on gender
  const partnerLabel = partnerGender === 'male' ? 'His Soul Type' : 'Her Soul Type';
  const userLabel = 'Your Soul Type';

  // ===== Flip animation (matches FlipCard.tsx pattern) =====
  const rotation = useSharedValue(0);
  const isFlipped = useSharedValue(false);

  const handlePress = useCallback(() => {
    const newFlipped = !isFlipped.value;
    isFlipped.value = newFlipped;
    rotation.value = withTiming(newFlipped ? 180 : 0, {
      duration: 600,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
  }, []);

  const frontAnimStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [0, 180]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden' as const,
      opacity: rotation.value < 90 ? 1 : 0,
    };
  });

  const backAnimStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(rotation.value, [0, 180], [180, 360]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden' as const,
      opacity: rotation.value >= 90 ? 1 : 0,
    };
  });

  // Back side content opacity (delayed reveal after flip)
  const backContentOpacity = useAnimatedStyle(() => {
    // Fade in when fully flipped
    const opacity = interpolate(rotation.value, [120, 180], [0, 1], 'clamp');
    return { opacity };
  });

  // Memoize HTML to avoid rebuilds on every render
  const frontHTML = useMemo(
    () => buildFrontHTML(leftImageUrl, rightImageUrl, width, height),
    [leftImageUrl, rightImageUrl, width, height],
  );
  const backHTML = useMemo(
    () => buildBackHTML(leftImageUrl, rightImageUrl, width, height),
    [leftImageUrl, rightImageUrl, width, height],
  );

  return (
    <View style={{ width, alignItems: 'center' }}>
      <Pressable onPress={handlePress} style={{ width, height }}>
        {/* ===== FRONT FACE ===== */}
        <Animated.View
          style={[
            { position: 'absolute', width, height, borderRadius: 28, overflow: 'hidden' },
            frontAnimStyle,
          ]}
        >
          {/* WebView with mix-blend-mode images */}
          <WebView
            source={{ html: frontHTML }}
            style={{ width, height, backgroundColor: '#111111' }}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            pointerEvents="none"
            androidLayerType="hardware"
            originWhitelist={['*']}
          />

          {/* Glassmorphism blur layer (native gradient since we can't use backdropFilter) */}
          <LinearGradient
            colors={[
              'transparent',
              'rgba(0,0,0,0.05)',
              'rgba(0,0,0,0.2)',
              'rgba(0,0,0,0.5)',
              'rgba(0,0,0,0.75)',
            ]}
            locations={[0, 0.25, 0.5, 0.75, 1]}
            style={[styles.glassmorphism, { height: height * 0.5 }]}
          />

          {/* Content layer — dynamic name, subtitle, soul type blocks */}
          <View style={styles.frontContent}>
            {/* Dynamic Title */}
            <Text style={styles.dynamicTitle}>{dynamicName}</Text>

            {/* Subtitle */}
            <Text style={styles.subtitle}>{subtitle}</Text>

            {/* Soul Type Blocks */}
            <View style={styles.soulTypeRow}>
              {/* Partner Soul Type */}
              <View style={styles.soulTypeBlock}>
                <Text style={styles.soulTypeLabel}>{partnerLabel}</Text>
                <Text style={styles.soulTypeName}>{partnerSoulType.title}</Text>
              </View>

              {/* Divider */}
              <View style={styles.divider} />

              {/* User Soul Type */}
              <View style={styles.soulTypeBlock}>
                <Text style={styles.soulTypeLabel}>{userLabel}</Text>
                <Text style={styles.soulTypeName}>{userSoulType.title}</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ===== BACK FACE ===== */}
        <Animated.View
          style={[
            { position: 'absolute', width, height, borderRadius: 28, overflow: 'hidden' },
            backAnimStyle,
          ]}
        >
          {/* Blurred background via WebView */}
          <WebView
            source={{ html: backHTML }}
            style={{ width, height, backgroundColor: '#111111' }}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            pointerEvents="none"
            androidLayerType="hardware"
            originWhitelist={['*']}
          />

          {/* Back side text content */}
          <Animated.View style={[styles.backContent, backContentOpacity]}>
            {/* Why This Happens */}
            <View style={styles.backSection}>
              <Text style={styles.backSectionTitle}>Why This Happens</Text>
              <Text style={styles.backSectionText}>{whyThisHappens}</Text>
            </View>

            {/* Divider */}
            <View style={styles.backDivider} />

            {/* Your Next Move */}
            <View style={styles.backSection}>
              <Text style={styles.backSectionTitle}>Your Next Move</Text>
              <Text style={styles.backSectionText}>{patternBreak}</Text>
            </View>
          </Animated.View>
        </Animated.View>
      </Pressable>

      {/* Tap hint */}
      <Text style={styles.tapHint}>Tap to flip</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ===== Front face =====
  glassmorphism: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  frontContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  dynamicTitle: {
    fontSize: 32,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    lineHeight: 42,
    color: Colors.white,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 280,
  },
  soulTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
  },
  soulTypeBlock: {
    width: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soulTypeLabel: {
    fontSize: 10,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase',
  },
  soulTypeName: {
    fontSize: 16,
    fontFamily: Fonts.outfit.regular,
    letterSpacing: 1.5,
    color: Colors.white,
    marginTop: 4,
    textAlign: 'center',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 12,
  },

  // ===== Back face =====
  backContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  backSection: {
    alignItems: 'center',
  },
  backSectionTitle: {
    fontSize: 18,
    fontFamily: Fonts.outfit.medium,
    letterSpacing: 1.5,
    color: Colors.white,
    marginBottom: 12,
    textAlign: 'center',
  },
  backSectionText: {
    fontSize: 14,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  backDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 32,
    marginHorizontal: 0,
  },

  // ===== Tap hint =====
  tapHint: {
    fontSize: 11,
    fontFamily: Fonts.jakarta.extraLight,
    letterSpacing: 1.5,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 16,
  },
});
