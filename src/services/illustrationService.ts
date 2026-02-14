import { supabase } from '../lib/supabase';

export interface Archetype {
  id: string;
  name: string;
  description: string;
  category: string;
  category_number: number;
  gradient_start: string;
  gradient_end: string;
}

export interface Illustration {
  id: string;
  url: string;
  tags: string[];
  category: string | null;
  style: string | null;
}

export interface ArchetypeTrait {
  id: string;
  archetype_id: string;
  trait: string;
  color: string;
}

export interface ArchetypeWithDetails extends Archetype {
  traits: string[];
  traitColors: string[];
  illustration: Illustration | null;
}

export async function getArchetypesWithIllustrations(): Promise<ArchetypeWithDetails[]> {
  const { data: archetypes, error: archetypesError } = await supabase
    .from('archetypes')
    .select('*')
    .order('category_number');

  if (archetypesError) {
    console.error('Error fetching archetypes:', archetypesError);
    return [];
  }

  const { data: traits, error: traitsError } = await supabase
    .from('archetype_traits')
    .select('*');

  if (traitsError) {
    console.error('Error fetching traits:', traitsError);
  }

  const { data: mappings, error: mappingsError } = await supabase
    .from('illustration_mappings')
    .select(`
      archetype_id,
      priority,
      illustrations (*)
    `)
    .order('priority', { ascending: false });

  if (mappingsError) {
    console.error('Error fetching mappings:', mappingsError);
  }

  return archetypes.map(archetype => {
    const archetypeTraitObjects = traits?.filter(t => t.archetype_id === archetype.id) || [];
    const archetypeTraits = archetypeTraitObjects.map(t => t.trait);
    const archetypeTraitColors = archetypeTraitObjects.map(t => t.color || archetype.gradient_start);

    const mapping = mappings?.find(m => m.archetype_id === archetype.id);
    const illustration = mapping?.illustrations as unknown as Illustration | null;

    return {
      ...archetype,
      traits: archetypeTraits,
      traitColors: archetypeTraitColors,
      illustration
    };
  });
}

export async function getIllustrationForArchetype(
  archetypeId: string,
  tags?: string[]
): Promise<Illustration | null> {
  let query = supabase
    .from('illustration_mappings')
    .select(`
      illustrations (*)
    `)
    .eq('archetype_id', archetypeId)
    .order('priority', { ascending: false })
    .limit(1);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error fetching illustration:', error);
    return null;
  }

  return data?.illustrations as unknown as Illustration | null;
}

export async function findIllustrationsByTags(
  tags: string[],
  category?: string
): Promise<Illustration[]> {
  let query = supabase
    .from('illustrations')
    .select('*')
    .overlaps('tags', tags);

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error finding illustrations by tags:', error);
    return [];
  }

  return data || [];
}

export async function addIllustration(
  url: string,
  tags: string[],
  category?: string,
  style?: string
): Promise<Illustration | null> {
  const { data, error } = await supabase
    .from('illustrations')
    .insert({
      url,
      tags,
      category,
      style
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding illustration:', error);
    return null;
  }

  return data;
}

export async function mapIllustrationToArchetype(
  archetypeId: string,
  illustrationId: string,
  priority: number = 0
): Promise<boolean> {
  const { error } = await supabase
    .from('illustration_mappings')
    .insert({
      archetype_id: archetypeId,
      illustration_id: illustrationId,
      priority
    });

  if (error) {
    console.error('Error mapping illustration:', error);
    return false;
  }

  return true;
}
