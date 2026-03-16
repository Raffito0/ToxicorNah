import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.toxicornah.app',
  appName: 'Toxic or Nah',
  webDir: 'dist',
  android: {
    backgroundColor: '#111111',
  },
  ios: {
    backgroundColor: '#111111',
    contentInset: 'always',
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: '#111111',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#111111',
    },
  },
};

export default config;
