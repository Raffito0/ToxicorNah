import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
// import '../global.css'; // DISABLED: Tailwind base styles may cause asymmetric layout on Android
import { loadScenarioFromSupabase, injectContentScenario } from '@/services/contentModeService';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();

  const [loaded, error] = useFonts({
    'Outfit-Regular': require('../assets/fonts/OutfitRegular.ttf'),
    'Outfit-Medium': require('../assets/fonts/OutfitMedium.ttf'),
    'Outfit-SemiBold': require('../assets/fonts/OutfitSemiBold.ttf'),
    'Outfit-Bold': require('../assets/fonts/OutfitBold.ttf'),
    'PlusJakartaSans-ExtraLight': require('../assets/fonts/PlusJakartaSans-ExtraLight.otf'),
    'PlusJakartaSans-Light': require('../assets/fonts/PlusJakartaSans-Light.otf'),
    'PlusJakartaSans-Regular': require('../assets/fonts/PlusJakartaSans-Regular.otf'),
    'Satoshi-Black': require('../assets/fonts/Satoshi-Black.otf'),
    'Satoshi-Bold': require('../assets/fonts/Satoshi-Bold.otf'),
    'Syne-Bold': require('../assets/fonts/Syne-Bold.otf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // Handle deep links: toxicornah://results?sid=xxx
  useEffect(() => {
    if (!loaded) return;

    const handleDeepLink = async (event: { url: string }) => {
      const parsed = Linking.parse(event.url);
      const sid = parsed.queryParams?.sid;
      if (sid && typeof sid === 'string') {
        // Content mode: load scenario from Supabase and start analysis
        try {
          const scenario = await loadScenarioFromSupabase(sid);
          const analysisId = await injectContentScenario(scenario);
          if (analysisId) {
            router.replace(`/results/${analysisId}`);
          }
        } catch (err) {
          console.error('Deep link scenario load failed:', err);
        }
      }
    };

    // Handle URL that launched the app
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    // Handle URLs while app is running
    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000000' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="results/[id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="person/[id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="auth"
          options={{ presentation: 'modal' }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}
