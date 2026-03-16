/**
 * IAP Service — StoreKit 2 via @capgo/native-purchases
 * Only used on iOS native. Web uses stripeService.ts
 */
import { NativePurchases } from '@capgo/native-purchases';
import { supabase } from '../lib/supabase';

// Product IDs matching App Store Connect
const PRODUCT_IDS = {
  MONTHLY: 'com.toxicornah.app.subscription.monthly',
  ANNUAL: 'com.toxicornah.app.subscription.annual',
  SINGLE_UNLOCK: 'com.toxicornah.app.singleunlock',
};

/**
 * Initialize IAP — call once at app startup on native platforms
 */
export async function initializeIAP(): Promise<void> {
  try {
    // @capgo/native-purchases auto-initializes with StoreKit 2
    // No API key needed (standalone plugin, not RevenueCat)
    console.log('[IAP] Initialized');
  } catch (err) {
    console.error('[IAP] Init failed:', err);
  }
}

/**
 * Get available products with localized prices from App Store
 */
export async function getProducts(): Promise<any[]> {
  try {
    const result = await NativePurchases.getProducts({
      productIdentifiers: Object.values(PRODUCT_IDS),
    });
    return result.products || [];
  } catch (err) {
    console.error('[IAP] getProducts failed:', err);
    return [];
  }
}

/**
 * Purchase a product by ID
 * Returns true if purchase succeeded, false otherwise
 */
export async function purchaseProduct(productId: string, analysisId?: string): Promise<boolean> {
  try {
    // purchaseProduct returns a Transaction directly
    const transaction = await NativePurchases.purchaseProduct({ productIdentifier: productId });

    if (transaction) {
      // Sync purchase to our backend
      await syncPurchaseToBackend(productId, transaction, analysisId);
      return true;
    }
    return false;
  } catch (err: any) {
    // User cancelled — not an error
    if (err?.code === 'USER_CANCELLED' || err?.message?.includes('cancel')) {
      console.log('[IAP] User cancelled purchase');
      return false;
    }
    console.error('[IAP] Purchase failed:', err);
    throw err;
  }
}

/**
 * Restore purchases — required by Apple
 */
export async function restorePurchases(): Promise<boolean> {
  try {
    // restorePurchases() returns void — refreshes StoreKit state
    await NativePurchases.restorePurchases();

    // After restore, check if any active purchases exist
    const result = await NativePurchases.getPurchases();
    const purchases = result.purchases || [];

    if (purchases.length > 0) {
      // Sync restored purchases to backend
      for (const tx of purchases) {
        await syncPurchaseToBackend(tx.productIdentifier, tx);
      }
      return true;
    }
    return false;
  } catch (err) {
    console.error('[IAP] Restore failed:', err);
    throw err;
  }
}

/**
 * Open native subscription management (iOS Settings)
 */
export async function manageSubscriptions(): Promise<void> {
  try {
    await NativePurchases.manageSubscriptions();
  } catch (err) {
    // Fallback: open Apple subscription URL
    window.open('https://apps.apple.com/account/subscriptions', '_blank');
  }
}

/**
 * Check if user has active subscription via StoreKit
 */
export async function checkEntitlements(): Promise<boolean> {
  try {
    const result = await NativePurchases.getPurchases();
    const purchases = result.purchases || [];

    // Check for active subscription
    return purchases.some((p: any) =>
      (p.productIdentifier === PRODUCT_IDS.MONTHLY || p.productIdentifier === PRODUCT_IDS.ANNUAL)
    );
  } catch (err) {
    console.error('[IAP] Check entitlements failed:', err);
    return false;
  }
}

/**
 * Sync a StoreKit purchase to our Supabase backend
 * This ensures the user_subscriptions table stays in sync
 */
async function syncPurchaseToBackend(
  productId: string,
  transaction: any,
  analysisId?: string
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const isSubscription = productId === PRODUCT_IDS.MONTHLY || productId === PRODUCT_IDS.ANNUAL;

    if (isSubscription) {
      // Upsert subscription record
      await supabase.from('user_subscriptions').upsert({
        user_id: user.id,
        status: 'active',
        plan_type: productId === PRODUCT_IDS.ANNUAL ? 'annual' : 'monthly',
        provider: 'apple',
        store_transaction_id: transaction.transactionId || transaction.id,
        current_period_end: new Date(Date.now() + (productId === PRODUCT_IDS.ANNUAL ? 365 : 30) * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } else if (productId === PRODUCT_IDS.SINGLE_UNLOCK && analysisId) {
      // Mark specific analysis as unlocked
      await supabase.from('analysis_results').update({
        is_unlocked: true,
        unlock_type: 'single_purchase',
      }).eq('id', analysisId);
    }

    // Record transaction
    await supabase.from('payment_transactions').insert({
      user_id: user.id,
      stripe_payment_id: `apple_${transaction.transactionId || transaction.id || Date.now()}`,
      payment_type: isSubscription ? 'subscription' : 'single_unlock',
      status: 'completed',
      amount_cents: productId === PRODUCT_IDS.ANNUAL ? 3999 : productId === PRODUCT_IDS.MONTHLY ? 499 : 199,
      currency: 'usd',
    });
  } catch (err) {
    console.error('[IAP] Sync to backend failed:', err);
    // Don't throw — the purchase already succeeded in StoreKit
    // Backend sync can be retried later
  }
}
