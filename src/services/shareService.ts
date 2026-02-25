import { supabase } from '../lib/supabase';

export interface ShareableCardData {
  soulTypeTitle: string;
  soulTypeTagline: string;
  soulTypeImageUrl: string;
  overallScore: number;
  personGender: 'male' | 'female';
  gradientFrom?: string;
  gradientTo?: string;
  ogImageUrl?: string;
}

/**
 * Creates a shared analysis record in Supabase and returns the share URL.
 */
export async function createShareLink(data: ShareableCardData): Promise<string> {
  const { data: record, error } = await supabase
    .from('shared_analyses')
    .insert({
      soul_type_title: data.soulTypeTitle,
      soul_type_tagline: data.soulTypeTagline,
      soul_type_image_url: data.soulTypeImageUrl,
      overall_score: data.overallScore,
      person_gender: data.personGender,
      gradient_from: data.gradientFrom || null,
      gradient_to: data.gradientTo || null,
      og_image_url: data.ogImageUrl || null,
    })
    .select('id')
    .single();

  if (error || !record) {
    throw new Error(`Failed to create share link: ${error?.message || 'no data'}`);
  }

  return `${window.location.origin}/share/${record.id}`;
}

/**
 * Loads shared analysis data for the landing page.
 */
export async function loadSharedAnalysis(id: string): Promise<ShareableCardData | null> {
  const { data, error } = await supabase
    .from('shared_analyses')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;

  // Increment view count (fire-and-forget)
  supabase
    .from('shared_analyses')
    .update({ view_count: (data.view_count || 0) + 1 })
    .eq('id', id)
    .then(() => {});

  return {
    soulTypeTitle: data.soul_type_title,
    soulTypeTagline: data.soul_type_tagline,
    soulTypeImageUrl: data.soul_type_image_url,
    overallScore: data.overall_score,
    personGender: data.person_gender,
    gradientFrom: data.gradient_from,
    gradientTo: data.gradient_to,
    ogImageUrl: data.og_image_url,
  };
}

/**
 * Copy text to clipboard with fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  }
}
