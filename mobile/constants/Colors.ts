// App colors matching web app's design system
export const Colors = {
  background: '#000000',

  // Text
  white: '#FFFFFF',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.5)',
  textDim: 'rgba(255, 255, 255, 0.35)',

  // MessageInsight tags
  redFlag: '#E53935',
  greenFlag: '#43A047',
  decoded: '#7C4DFF',
  decodedAccent: '#B39DDB',

  // Toxicity zones
  safeZone: '#6EE7B7',
  riskyZone: '#FCD34D',
  toxicZone: '#EF4444',

  // Purple accents (paywall, premium)
  purple: {
    light: 'rgba(139, 92, 246, 0.4)',
    medium: 'rgba(139, 92, 246, 0.6)',
    bg: 'rgba(139, 92, 246, 0.2)',
  },
};

// Font families - must match names used in useFonts()
export const Fonts = {
  outfit: {
    regular: 'Outfit-Regular',
    medium: 'Outfit-Medium',
    semiBold: 'Outfit-SemiBold',
    bold: 'Outfit-Bold',
  },
  jakarta: {
    extraLight: 'PlusJakartaSans-ExtraLight',
    light: 'PlusJakartaSans-Light',
    regular: 'PlusJakartaSans-Regular',
  },
  satoshi: {
    black: 'Satoshi-Black',
    bold: 'Satoshi-Bold',
  },
  syne: {
    bold: 'Syne-Bold',
  },
};

// For backward compatibility with template components
export default {
  light: {
    text: '#000',
    background: '#fff',
    tint: '#2f95dc',
    tabIconDefault: '#ccc',
    tabIconSelected: '#2f95dc',
  },
  dark: {
    text: '#fff',
    background: '#000000',
    tint: '#fff',
    tabIconDefault: '#ccc',
    tabIconSelected: '#fff',
  },
};
