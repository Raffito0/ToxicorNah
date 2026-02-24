/**
 * Returns true if running in Capacitor native app (Android/iOS).
 * Capacitor injects window.Capacitor when running inside a native WebView.
 */
export function isNativeApp(): boolean {
  return !!(window as any).Capacitor;
}

/**
 * Returns true if running in development mode (localhost browser, NOT native app).
 * Use this instead of checking hostname directly — Capacitor also runs on localhost.
 */
export function isDevMode(): boolean {
  if (isNativeApp()) return false;
  return import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

/**
 * Returns true if in content mode (?sid= URL param).
 */
export function isContentMode(): boolean {
  return new URLSearchParams(window.location.search).has('sid');
}

/**
 * Combined check: dev mode OR content mode (both use mock data).
 */
export function usesMockData(): boolean {
  return isDevMode() || isContentMode();
}
