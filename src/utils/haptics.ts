// Haptic feedback utility for tactile interactions
// Uses the Vibration API for mobile devices

export const haptics = {
  // Light tap - for selections, toggles
  light: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  },

  // Medium tap - for confirmations, card flips
  medium: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(25);
    }
  },

  // Heavy tap - for important actions
  heavy: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
  },

  // Success pattern - for completed actions
  success: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate([10, 30, 10, 30, 50]);
    }
  },

  // Error pattern - for errors/warnings
  error: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate([30, 50, 30]);
    }
  },

  // Swipe feedback - for card swipes
  swipe: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(15);
    }
  },

  // Reveal feedback - for scratch/reveal moments
  reveal: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate([20, 40, 60]);
    }
  },
};
