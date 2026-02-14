import { supabase } from '../lib/supabase';
import { getOrCreateSessionId } from './userStateService';

// Stripe Price IDs - Configure these in your Stripe Dashboard
const STRIPE_PRICES = {
  SUBSCRIPTION_MONTHLY: import.meta.env.VITE_STRIPE_PRICE_SUBSCRIPTION_MONTHLY || 'price_subscription_monthly',
  SUBSCRIPTION_ANNUAL: import.meta.env.VITE_STRIPE_PRICE_SUBSCRIPTION_ANNUAL || 'price_subscription_annual',
  SINGLE_UNLOCK: import.meta.env.VITE_STRIPE_PRICE_SINGLE_UNLOCK || 'price_single_unlock'
};

interface CheckoutSessionResponse {
  url: string | null;
  error: string | null;
}

/**
 * Creates a Stripe Checkout session for subscription
 * @param analysisId - Optional analysis ID to unlock after subscription
 * @param plan - 'annual' or 'monthly' subscription plan
 */
export async function createSubscriptionCheckout(
  analysisId?: string,
  plan: 'annual' | 'monthly' = 'annual'
): Promise<CheckoutSessionResponse> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const sessionId = getOrCreateSessionId();

    const priceId = plan === 'annual'
      ? STRIPE_PRICES.SUBSCRIPTION_ANNUAL
      : STRIPE_PRICES.SUBSCRIPTION_MONTHLY;

    // Annual plan has a 7-day free trial
    const trialPeriodDays = plan === 'annual' ? 7 : undefined;

    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        priceId,
        mode: 'subscription',
        userId: user?.id || null,
        sessionId: sessionId,
        analysisId: analysisId,
        trialPeriodDays,
        successUrl: `${window.location.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}&type=subscription&plan=${plan}`,
        cancelUrl: `${window.location.origin}/results/${analysisId || ''}`
      }
    });

    if (error) {
      console.error('Checkout session error:', error);
      return { url: null, error: error.message };
    }

    return { url: data.url, error: null };
  } catch (err) {
    console.error('Failed to create checkout session:', err);
    return { url: null, error: 'Failed to create checkout session' };
  }
}

/**
 * Creates a Stripe Checkout session for single analysis unlock
 */
export async function createSingleUnlockCheckout(analysisId: string): Promise<CheckoutSessionResponse> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const sessionId = getOrCreateSessionId();

    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        priceId: STRIPE_PRICES.SINGLE_UNLOCK,
        mode: 'payment',
        userId: user?.id || null,
        sessionId: sessionId,
        analysisId: analysisId,
        successUrl: `${window.location.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}&type=single&analysis=${analysisId}`,
        cancelUrl: `${window.location.origin}/results/${analysisId}`
      }
    });

    if (error) {
      console.error('Checkout session error:', error);
      return { url: null, error: error.message };
    }

    return { url: data.url, error: null };
  } catch (err) {
    console.error('Failed to create checkout session:', err);
    return { url: null, error: 'Failed to create checkout session' };
  }
}

/**
 * Verifies a completed payment and updates the database
 */
export async function verifyPaymentSuccess(checkoutSessionId: string): Promise<{
  success: boolean;
  type: 'subscription' | 'single_unlock' | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-payment', {
      body: { checkoutSessionId }
    });

    if (error) {
      return { success: false, type: null, error: error.message };
    }

    return {
      success: data.success,
      type: data.type,
      error: null
    };
  } catch (err) {
    console.error('Payment verification failed:', err);
    return { success: false, type: null, error: 'Payment verification failed' };
  }
}

/**
 * Creates a Stripe Customer Portal session for managing subscription
 */
export async function createCustomerPortalSession(): Promise<CheckoutSessionResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('create-portal-session', {
      body: {
        returnUrl: `${window.location.origin}/soul`
      }
    });

    if (error) {
      return { url: null, error: error.message };
    }

    return { url: data.url, error: null };
  } catch (err) {
    console.error('Failed to create portal session:', err);
    return { url: null, error: 'Failed to create portal session' };
  }
}

/**
 * Gets the current subscription status from Stripe
 */
export async function getSubscriptionDetails(): Promise<{
  isActive: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('get-subscription-status', {});

    if (error) {
      return {
        isActive: false,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        error: error.message
      };
    }

    return {
      isActive: data.isActive,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      currentPeriodEnd: data.currentPeriodEnd ? new Date(data.currentPeriodEnd) : null,
      error: null
    };
  } catch (err) {
    console.error('Failed to get subscription status:', err);
    return {
      isActive: false,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      error: 'Failed to get subscription status'
    };
  }
}
