import { supabase } from '../lib/supabase';

export interface UserState {
  isPremium: boolean;
  fullAnalysesUsed: number;
  singleUnlocksThisMonth: number;
  freeBonusUnlocks: number;
  firstAnalysisCompleted: boolean;
  sessionId: string;
}

export interface SubscriptionStatus {
  isActive: boolean;
  endDate: Date | null;
}

const SESSION_STORAGE_KEY = 'toxic_or_nah_session_id';

export function getOrCreateSessionId(): string {
  let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    sessionId = `anon_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }
  return sessionId;
}

export async function getUserState(): Promise<UserState> {
  const sessionId = getOrCreateSessionId();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: subscription } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('status', 'active')
    .maybeSingle();

  const isPremium = subscription !== null &&
    subscription.current_period_end &&
    new Date(subscription.current_period_end) > new Date();

  let tracking = await supabase
    .from('user_analysis_tracking')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (!tracking.data) {
    const { data: newTracking, error } = await supabase
      .from('user_analysis_tracking')
      .insert({
        user_id: user?.id || null,
        session_id: sessionId,
        full_analyses_used: 0,
        single_unlocks_used_this_month: 0,
        viral_bonus_unlocks_available: 0,
        has_used_first_free_analysis: false
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating tracking:', error);
      throw error;
    }

    tracking.data = newTracking;
  }

  return {
    isPremium,
    fullAnalysesUsed: tracking.data.full_analyses_used || 0,
    singleUnlocksThisMonth: tracking.data.single_unlocks_used_this_month || 0,
    freeBonusUnlocks: tracking.data.viral_bonus_unlocks_available || 0,
    firstAnalysisCompleted: tracking.data.has_used_first_free_analysis || false,
    sessionId
  };
}

export async function updateUserState(updates: Partial<UserState>): Promise<void> {
  const sessionId = getOrCreateSessionId();

  const updateData: Record<string, unknown> = {};

  if (updates.fullAnalysesUsed !== undefined) {
    updateData.full_analyses_used = updates.fullAnalysesUsed;
  }
  if (updates.singleUnlocksThisMonth !== undefined) {
    updateData.single_unlocks_used_this_month = updates.singleUnlocksThisMonth;
  }
  if (updates.freeBonusUnlocks !== undefined) {
    updateData.viral_bonus_unlocks_available = updates.freeBonusUnlocks;
  }
  if (updates.firstAnalysisCompleted !== undefined) {
    updateData.has_used_first_free_analysis = updates.firstAnalysisCompleted;
  }

  updateData.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('user_analysis_tracking')
    .update(updateData)
    .eq('session_id', sessionId);

  if (error) {
    console.error('Error updating user state:', error);
    throw error;
  }
}

export async function checkSubscriptionStatus(): Promise<SubscriptionStatus> {
  const { data } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('status', 'active')
    .maybeSingle();

  if (!data || !data.current_period_end) {
    return { isActive: false, endDate: null };
  }

  const endDate = new Date(data.current_period_end);
  const isActive = endDate > new Date();

  return { isActive, endDate };
}

export function canUseFirstFreeAnalysis(state: UserState): boolean {
  return !state.firstAnalysisCompleted;
}

export function canUseBonusUnlock(state: UserState): boolean {
  return state.freeBonusUnlocks > 0;
}

export function canPurchaseSingleUnlock(state: UserState): boolean {
  return state.singleUnlocksThisMonth < 2;
}

export function shouldShowBlurredContent(state: UserState): boolean {
  if (state.isPremium) return false;
  return true;
}

export async function consumeFirstFreeAnalysis(): Promise<void> {
  await updateUserState({
    firstAnalysisCompleted: true,
    fullAnalysesUsed: 1
  });
}

export async function consumeBonusUnlock(currentState: UserState): Promise<void> {
  await updateUserState({
    freeBonusUnlocks: Math.max(0, currentState.freeBonusUnlocks - 1),
    fullAnalysesUsed: currentState.fullAnalysesUsed + 1
  });
}

export async function grantViralBonusUnlock(currentState: UserState): Promise<void> {
  if (currentState.freeBonusUnlocks === 0) {
    await updateUserState({
      freeBonusUnlocks: 1
    });
  }
}

export async function recordSingleUnlockPurchase(currentState: UserState, analysisId: string): Promise<void> {
  await updateUserState({
    singleUnlocksThisMonth: currentState.singleUnlocksThisMonth + 1,
    fullAnalysesUsed: currentState.fullAnalysesUsed + 1
  });

  await supabase
    .from('analysis_results')
    .update({
      is_unlocked: true,
      unlock_type: 'single_purchase'
    })
    .eq('id', analysisId);
}

export async function recordSubscriptionActivation(): Promise<void> {
  const sessionId = getOrCreateSessionId();

  const { data: tracking } = await supabase
    .from('user_analysis_tracking')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (tracking) {
    await supabase
      .from('user_analysis_tracking')
      .update({
        full_analyses_used: tracking.full_analyses_used + 1,
        updated_at: new Date().toISOString()
      })
      .eq('session_id', sessionId);
  }
}

export async function resetMonthlyCounters(): Promise<void> {
  const { error } = await supabase
    .from('user_analysis_tracking')
    .update({
      single_unlocks_used_this_month: 0,
      updated_at: new Date().toISOString()
    })
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    console.error('Error resetting monthly counters:', error);
  }
}

// ============================================================
// USER FLOW STATES - for optimizing UX based on user type
// ============================================================
export type UserFlowState = 'first_time_free' | 'returning_free' | 'subscribed';

/**
 * Determines the user's flow state for UX optimization:
 * - first_time_free: First-time user, not subscribed → skip crop modal & person selection
 * - returning_free: Returning user, not subscribed → show everything
 * - subscribed: Premium user → show everything
 */
export function getUserFlowState(state: UserState): UserFlowState {
  if (state.isPremium) {
    return 'subscribed';
  }
  if (!state.firstAnalysisCompleted) {
    return 'first_time_free';
  }
  return 'returning_free';
}

/**
 * Returns true if this is a first-time user who should get the fast-track experience
 * (skip crop modal, skip person selection)
 */
export function isFirstTimeUser(state: UserState): boolean {
  return !state.isPremium && !state.firstAnalysisCompleted;
}

/**
 * Returns true if user has never visited the app before (no localStorage flag).
 * Used to determine guest mode (skip auth for first-time users).
 */
export function isFirstVisit(): boolean {
  return !localStorage.getItem('has_visited');
}

/**
 * Marks that the user has visited the app (so next time they see auth page).
 */
export function markVisited(): void {
  localStorage.setItem('has_visited', 'true');
}

/**
 * Migrates guest analysis data from localStorage to Supabase after account creation.
 * Links the anonymous session to the new user ID.
 */
export async function migrateGuestToUser(userId: string): Promise<void> {
  const sessionId = getOrCreateSessionId();

  // Link existing tracking record to the new user
  await supabase
    .from('user_analysis_tracking')
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId);

  // Link any analysis results from this session to the user
  await supabase
    .from('analysis_results')
    .update({ user_id: userId })
    .eq('session_id', sessionId);

  // Mark as visited so returning user sees auth page
  markVisited();
}

/**
 * Links a Stripe checkout session to a user account after guest→user migration.
 */
export async function linkStripeCustomer(userId: string, stripeSessionId: string): Promise<void> {
  await supabase.functions.invoke('link-stripe-customer', {
    body: { userId, stripeSessionId }
  });
}
