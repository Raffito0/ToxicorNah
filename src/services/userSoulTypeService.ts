import { supabase } from '../lib/supabase';
import { getSoulTypeById, SoulType } from '../data/soulTypes';
import { usesMockData } from '../utils/platform';

// ===== Types =====

export interface UserSoulTypeRecord {
  id: string;
  user_id: string | null;
  session_id: string | null;
  soul_type_id: string;
  assigned_at: string;
}

// ===== Session ID Helper =====

const SESSION_ID_KEY = 'toxicornah_session_id';

function getOrCreateSessionId(): string {
  let sessionId = localStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  }
  return sessionId;
}

// ===== DEV Mode Storage =====

const DEV_SOUL_TYPE_KEY = 'toxicornah_user_soul_type';

function getDevSoulType(): string | null {
  return localStorage.getItem(DEV_SOUL_TYPE_KEY);
}

function setDevSoulType(soulTypeId: string): void {
  localStorage.setItem(DEV_SOUL_TYPE_KEY, soulTypeId);
}

// ===== Main Functions =====

/**
 * Save the user's assigned soul type
 */
export async function saveUserSoulType(soulTypeId: string): Promise<{ success: boolean; error?: string }> {
  if (usesMockData()) {
    // DEV: Save to localStorage
    setDevSoulType(soulTypeId);
    return { success: true };
  }

  // Production: Save to Supabase
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const sessionId = getOrCreateSessionId();

    // Check if user already has a soul type
    const existing = await getUserSoulTypeRecord();

    if (existing) {
      // Update existing record
      const { error } = await supabase
        .from('user_soul_types')
        .update({
          soul_type_id: soulTypeId,
          assigned_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) throw error;
    } else {
      // Insert new record
      const { error } = await supabase
        .from('user_soul_types')
        .insert({
          user_id: user?.id || null,
          session_id: user ? null : sessionId,
          soul_type_id: soulTypeId,
        });

      if (error) throw error;
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving user soul type:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Get the user's soul type record from database
 */
async function getUserSoulTypeRecord(): Promise<UserSoulTypeRecord | null> {
  const { data: { user } } = await supabase.auth.getUser();
  const sessionId = getOrCreateSessionId();

  let query = supabase
    .from('user_soul_types')
    .select('*')
    .order('assigned_at', { ascending: false })
    .limit(1);

  if (user) {
    query = query.eq('user_id', user.id);
  } else {
    query = query.eq('session_id', sessionId);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  return data as UserSoulTypeRecord;
}

/**
 * Get the user's assigned soul type (full object)
 */
export async function getUserSoulType(): Promise<SoulType | null> {
  if (usesMockData()) {
    // DEV: Get from localStorage
    const soulTypeId = getDevSoulType();
    if (!soulTypeId) return null;
    return getSoulTypeById(soulTypeId);
  }

  // Production: Get from Supabase
  try {
    const record = await getUserSoulTypeRecord();
    if (!record) return null;
    return getSoulTypeById(record.soul_type_id);
  } catch (error) {
    console.error('Error getting user soul type:', error);
    return null;
  }
}

/**
 * Check if user has a soul type assigned
 */
export async function hasUserSoulType(): Promise<boolean> {
  const soulType = await getUserSoulType();
  return soulType !== null;
}

/**
 * Clear the user's soul type (for testing/reset)
 */
export async function clearUserSoulType(): Promise<{ success: boolean; error?: string }> {
  if (usesMockData()) {
    localStorage.removeItem(DEV_SOUL_TYPE_KEY);
    return { success: true };
  }

  try {
    const record = await getUserSoulTypeRecord();
    if (record) {
      const { error } = await supabase
        .from('user_soul_types')
        .delete()
        .eq('id', record.id);

      if (error) throw error;
    }
    return { success: true };
  } catch (error) {
    console.error('Error clearing user soul type:', error);
    return { success: false, error: String(error) };
  }
}
