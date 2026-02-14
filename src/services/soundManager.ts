/**
 * SoundManager - Audio feedback service for enhanced UX
 * Uses Web Audio API for low-latency, responsive sounds
 */

type SoundType =
  | 'scratch'
  | 'scratchReveal'
  | 'cardFlip'
  | 'swipeLeft'
  | 'swipeRight'
  | 'scoreReveal'
  | 'celebration'
  | 'buttonTap'
  | 'unlock';

interface SoundConfig {
  frequency?: number;
  duration?: number;
  type?: OscillatorType;
  volume?: number;
  attack?: number;
  decay?: number;
  frequencies?: number[];
}

const SOUND_CONFIGS: Record<SoundType, SoundConfig> = {
  // Scratch sound - short, subtle friction sound
  scratch: {
    frequency: 2000,
    duration: 0.03,
    type: 'sawtooth',
    volume: 0.05,
    attack: 0.001,
    decay: 0.02
  },

  // Scratch reveal complete - satisfying reveal sound
  scratchReveal: {
    frequency: 880,
    duration: 0.4,
    type: 'sine',
    volume: 0.3,
    attack: 0.01,
    decay: 0.3,
    frequencies: [440, 554, 659, 880] // A major chord arpeggio
  },

  // Card flip - whoosh sound
  cardFlip: {
    frequency: 400,
    duration: 0.15,
    type: 'sine',
    volume: 0.15,
    attack: 0.01,
    decay: 0.14
  },

  // Swipe left - subtle negative sound
  swipeLeft: {
    frequency: 200,
    duration: 0.1,
    type: 'triangle',
    volume: 0.1,
    attack: 0.01,
    decay: 0.09
  },

  // Swipe right - positive confirmation
  swipeRight: {
    frequency: 600,
    duration: 0.1,
    type: 'sine',
    volume: 0.12,
    attack: 0.01,
    decay: 0.09
  },

  // Score reveal - dramatic build-up
  scoreReveal: {
    frequency: 220,
    duration: 1.5,
    type: 'sine',
    volume: 0.2,
    attack: 0.1,
    decay: 1.4,
    frequencies: [220, 330, 440, 550, 660, 770, 880]
  },

  // Celebration - achievement unlock
  celebration: {
    frequency: 523,
    duration: 0.8,
    type: 'sine',
    volume: 0.25,
    attack: 0.01,
    decay: 0.7,
    frequencies: [523, 659, 784, 1047] // C major chord
  },

  // Button tap - subtle feedback
  buttonTap: {
    frequency: 800,
    duration: 0.05,
    type: 'sine',
    volume: 0.08,
    attack: 0.001,
    decay: 0.04
  },

  // Unlock - rewarding sound
  unlock: {
    frequency: 440,
    duration: 0.5,
    type: 'sine',
    volume: 0.2,
    attack: 0.01,
    decay: 0.4,
    frequencies: [440, 554, 659] // A major triad
  }
};

class SoundManager {
  private audioContext: AudioContext | null = null;
  private isEnabled: boolean = true;
  private masterVolume: number = 1.0;
  private lastScratchTime: number = 0;
  private scratchThrottle: number = 30; // ms between scratch sounds

  constructor() {
    // Initialize on first user interaction
    if (typeof window !== 'undefined') {
      const initAudio = () => {
        this.initAudioContext();
        document.removeEventListener('click', initAudio);
        document.removeEventListener('touchstart', initAudio);
      };
      document.addEventListener('click', initAudio);
      document.addEventListener('touchstart', initAudio);
    }
  }

  private initAudioContext(): void {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
  }

  private createOscillator(
    frequency: number,
    type: OscillatorType,
    duration: number,
    volume: number,
    attack: number,
    decay: number
  ): void {
    if (!this.audioContext || !this.isEnabled) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.type = type;
    oscillator.frequency.value = frequency;

    const now = this.audioContext.currentTime;
    const adjustedVolume = volume * this.masterVolume;

    // ADSR envelope
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(adjustedVolume, now + attack);
    gainNode.gain.linearRampToValueAtTime(0, now + attack + decay);

    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  play(soundType: SoundType): void {
    if (!this.isEnabled) return;

    // Throttle scratch sounds
    if (soundType === 'scratch') {
      const now = Date.now();
      if (now - this.lastScratchTime < this.scratchThrottle) return;
      this.lastScratchTime = now;
    }

    this.initAudioContext();

    const config = SOUND_CONFIGS[soundType];
    if (!config) return;

    const {
      frequency = 440,
      duration = 0.1,
      type = 'sine',
      volume = 0.1,
      attack = 0.01,
      decay = 0.09,
      frequencies
    } = config;

    // If multiple frequencies (chord/arpeggio), play them
    if (frequencies && frequencies.length > 0) {
      if (soundType === 'scoreReveal') {
        // Arpeggio for score reveal
        frequencies.forEach((freq, index) => {
          setTimeout(() => {
            this.createOscillator(freq, type, 0.2, volume, attack, 0.15);
          }, index * 150);
        });
      } else {
        // Chord for celebration/unlock
        frequencies.forEach((freq, index) => {
          setTimeout(() => {
            this.createOscillator(freq, type, duration, volume * 0.8, attack, decay);
          }, index * 50);
        });
      }
    } else {
      this.createOscillator(frequency, type, duration, volume, attack, decay);
    }
  }

  // Play scratch sound with random variation
  playScratch(): void {
    if (!this.isEnabled) return;

    const now = Date.now();
    if (now - this.lastScratchTime < this.scratchThrottle) return;
    this.lastScratchTime = now;

    this.initAudioContext();
    if (!this.audioContext) return;

    // Random frequency variation for natural sound
    const baseFreq = 1500 + Math.random() * 1000;

    this.createOscillator(
      baseFreq,
      'sawtooth',
      0.02 + Math.random() * 0.02,
      0.03 + Math.random() * 0.02,
      0.001,
      0.02
    );
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    // Save preference
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('soundEnabled', enabled.toString());
    }
  }

  isAudioEnabled(): boolean {
    return this.isEnabled;
  }

  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('soundVolume', this.masterVolume.toString());
    }
  }

  getVolume(): number {
    return this.masterVolume;
  }

  // Load preferences from localStorage
  loadPreferences(): void {
    if (typeof localStorage !== 'undefined') {
      const enabled = localStorage.getItem('soundEnabled');
      if (enabled !== null) {
        this.isEnabled = enabled === 'true';
      }

      const volume = localStorage.getItem('soundVolume');
      if (volume !== null) {
        this.masterVolume = parseFloat(volume);
      }
    }
  }
}

// Singleton instance
export const soundManager = new SoundManager();

// Load preferences on module load
if (typeof window !== 'undefined') {
  soundManager.loadPreferences();
}
