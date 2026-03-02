import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

type SoundType = 'scratch' | 'scratchReveal' | 'cardFlip' | 'swipeLeft' | 'swipeRight' | 'scoreReveal' | 'celebration' | 'buttonTap' | 'unlock';

class SoundManager {
  private enabled = true;
  private volume = 0.5;

  async loadPreferences() {
    const enabled = await AsyncStorage.getItem('soundEnabled');
    const volume = await AsyncStorage.getItem('soundVolume');
    if (enabled !== null) this.enabled = enabled === 'true';
    if (volume !== null) this.volume = parseFloat(volume);
  }

  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    await AsyncStorage.setItem('soundEnabled', String(enabled));
  }

  async setVolume(volume: number) {
    this.volume = volume;
    await AsyncStorage.setItem('soundVolume', String(volume));
  }

  isEnabled() { return this.enabled; }
  getVolume() { return this.volume; }

  // Stub - sounds will be added when audio files are bundled
  async play(type: SoundType) {
    if (!this.enabled) return;
    // TODO: Load and play bundled audio files
    console.log(`[SoundManager] Would play: ${type}`);
  }

  async playScratch() { await this.play('scratch'); }
}

export const soundManager = new SoundManager();
