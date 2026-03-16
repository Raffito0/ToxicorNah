/**
 * Purchase Service — Unified facade for payments
 * Routes to StoreKit 2 (iOS) or Stripe (web) based on platform.
 *
 * This is the ONLY entry point for payment operations.
 * Components should never import stripeService or iapService directly.
 *
 * Lazy imports ensure native IAP modules are never loaded on web,
 * and Stripe modules are never loaded on iOS native.
 */
import { isIOSNative } from '../utils/platform';

// Lazy module references — loaded once on first use
let iapModule: typeof import('./iapService') | null = null;
let stripeModule: typeof import('./stripeService') | null = null;

async function getIAP() {
  if (!iapModule) {
    iapModule = await import('./iapService');
  }
  return iapModule;
}

async function getStripe() {
  if (!stripeModule) {
    stripeModule = await import('./stripeService');
  }
  return stripeModule;
}

/**
 * Initialize purchases — call once at app startup.
 * On iOS: initializes StoreKit 2 via @capgo/native-purchases.
 * On web: no-op (Stripe doesn't need initialization).
 */
export async function initPurchases(): Promise<void> {
  if (isIOSNative()) {
    const iap = await getIAP();
    await iap.initializeIAP();
  }
  // Stripe doesn't need initialization
}

/**
 * Subscribe to a plan.
 * On iOS: opens native StoreKit purchase sheet.
 * On web: redirects to Stripe Checkout.
 */
export async function subscribe(
  plan: 'annual' | 'monthly',
  analysisId?: string,
  isGuest?: boolean
): Promise<{ success: boolean; url?: string }> {
  if (isIOSNative()) {
    const iap = await getIAP();
    const productId = plan === 'annual'
      ? 'com.toxicornah.app.subscription.annual'
      : 'com.toxicornah.app.subscription.monthly';
    const success = await iap.purchaseProduct(productId);
    return { success };
  } else {
    const stripe = await getStripe();
    const result = await stripe.createSubscriptionCheckout(analysisId, plan, isGuest);
    if (result.url) {
      window.location.href = result.url;
      return { success: true, url: result.url };
    }
    return { success: false };
  }
}

/**
 * Single unlock purchase.
 * On iOS: opens native StoreKit purchase sheet.
 * On web: redirects to Stripe Checkout.
 */
export async function singleUnlock(
  analysisId: string,
  isGuest?: boolean
): Promise<{ success: boolean; url?: string }> {
  if (isIOSNative()) {
    const iap = await getIAP();
    const success = await iap.purchaseProduct('com.toxicornah.app.singleunlock', analysisId);
    return { success };
  } else {
    const stripe = await getStripe();
    const result = await stripe.createSingleUnlockCheckout(analysisId, isGuest);
    if (result.url) {
      window.location.href = result.url;
      return { success: true, url: result.url };
    }
    return { success: false };
  }
}

/**
 * Restore purchases.
 * On iOS: restores via StoreKit (required by Apple Review Guidelines).
 * On web: checks Supabase subscription status via Stripe.
 */
export async function restorePurchases(): Promise<{ restored: boolean }> {
  if (isIOSNative()) {
    const iap = await getIAP();
    const restored = await iap.restorePurchases();
    return { restored };
  } else {
    const stripe = await getStripe();
    const { isActive } = await stripe.getSubscriptionDetails();
    return { restored: isActive };
  }
}

/**
 * Open subscription management.
 * On iOS: opens native iOS subscription settings.
 * On web: opens Stripe Customer Portal.
 */
export async function manageSubscription(): Promise<void> {
  if (isIOSNative()) {
    const iap = await getIAP();
    await iap.manageSubscriptions();
  } else {
    const stripe = await getStripe();
    const { url } = await stripe.createCustomerPortalSession();
    if (url) {
      window.location.href = url;
    }
  }
}

/**
 * Check if user has premium access.
 * On iOS: checks StoreKit entitlements first, falls back to Supabase.
 * On web: checks Supabase (Stripe subscription status).
 */
export async function checkPremiumStatus(): Promise<boolean> {
  if (isIOSNative()) {
    try {
      const iap = await getIAP();
      return await iap.checkEntitlements();
    } catch {
      // Fallback to Supabase check if StoreKit fails
      const stripe = await getStripe();
      const { isActive } = await stripe.getSubscriptionDetails();
      return isActive;
    }
  } else {
    const stripe = await getStripe();
    const { isActive } = await stripe.getSubscriptionDetails();
    return isActive;
  }
}

/**
 * Get available products with localized prices (iOS only).
 * On web, returns null — prices are hardcoded in PaywallModal.
 */
export async function getProductOfferings(): Promise<any[] | null> {
  if (isIOSNative()) {
    const iap = await getIAP();
    return await iap.getProducts();
  }
  return null;
}
