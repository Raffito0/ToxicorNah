import React from 'react';
import { StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { isSoulTypeVideo } from '@/data/soulTypes';

interface SoulTypeMediaProps {
  /** Full URL to the soul type media (video .mp4 or image .png) */
  src: string;
  /** Accessible description */
  alt?: string;
  /** Width and height of the media container */
  size?: number;
  /** If true, show the side profile version (always .png) */
  showSideProfile?: boolean;
  /** Additional styles applied to the media element */
  style?: StyleProp<ViewStyle>;
  /** Border radius override */
  borderRadius?: number;
  /** Resize mode for images */
  contentFit?: 'cover' | 'contain' | 'fill' | 'none';
}

/**
 * Renders Video for male Soul Types (.mp4) and Image for female Soul Types (.png).
 * Side profiles are always .png for both genders.
 *
 * Videos auto-play, loop, and are muted (required for mobile autoplay).
 * Images use expo-image for optimized loading with blur placeholder.
 */
export function SoulTypeMedia({
  src,
  alt = '',
  size,
  showSideProfile = false,
  style,
  borderRadius,
  contentFit = 'cover',
}: SoulTypeMediaProps) {
  // Side profiles are always .png, so never video
  const isVideo = !showSideProfile && isSoulTypeVideo(src);

  const sizeStyle = size
    ? { width: size, height: size }
    : undefined;

  if (isVideo) {
    return (
      <Video
        source={{ uri: src }}
        shouldPlay
        isLooping
        isMuted
        resizeMode={ResizeMode.COVER}
        style={[
          styles.media,
          sizeStyle,
          borderRadius != null && { borderRadius },
          style,
        ]}
      />
    );
  }

  return (
    <Image
      source={{ uri: src }}
      alt={alt}
      contentFit={contentFit}
      transition={300}
      style={[
        styles.media,
        sizeStyle,
        borderRadius != null && { borderRadius },
        style as any,
      ]}
      placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
    />
  );
}

const styles = StyleSheet.create({
  media: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1A1A1A',
  },
});
