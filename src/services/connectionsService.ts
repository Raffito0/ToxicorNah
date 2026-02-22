import { supabase } from '../lib/supabase';
import { getDeletedPersonIds, isPersonArchived } from './personProfileService';

export interface ConnectionCardData {
  personId: string;
  name: string;
  avatar: string | null;
  currentScore: number;
  scoreDelta: number;
  archetypeTitle: string;
  archetypeImage: string | null;
  lastAnalyzedAt: string;
  analysisCount: number;
}

export function getRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks === 1) return '1 week ago';
  return `${diffWeeks} weeks ago`;
}

export function getScoreColor(score: number): string {
  if (score <= 30) return '#4ade80'; // green
  if (score <= 60) return '#facc15'; // yellow
  return '#ef4444'; // red
}

export async function fetchConnections(): Promise<ConnectionCardData[]> {
  // DEV MODE: Return mock data in development
  const isDev = import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || new URLSearchParams(window.location.search).has('sid');

  if (isDev) {
    const deletedIds = getDeletedPersonIds();
    const mockConnections = [
      {
        personId: 'dev-alex-1',
        name: 'Alex',
        avatar: '/67320b97b9sdfacf6001d2d3e5b.jpg',
        currentScore: 70,
        scoreDelta: 5,
        archetypeTitle: 'The Sweet Poison',
        archetypeImage: '/Adobe Express - file 1 (3).png',
        lastAnalyzedAt: new Date().toISOString(),
        analysisCount: 45,
      },
      {
        personId: 'dev-marcus-2',
        name: 'Marcus',
        avatar: '/images (12).jpeg',
        currentScore: 35,
        scoreDelta: -8,
        archetypeTitle: 'The Ghost',
        archetypeImage: '/Adobe Exsdfpress - file 1 (3).png',
        lastAnalyzedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        analysisCount: 12,
      },
    ];
    return mockConnections.filter(c =>
      !deletedIds.includes(c.personId) && !isPersonArchived(c.personId)
    );
  }

  // 1. Load all non-archived persons
  const { data: persons, error: personsError } = await supabase
    .from('persons')
    .select('*')
    .neq('is_archived', true)
    .order('created_at', { ascending: false });

  if (personsError || !persons || persons.length === 0) {
    return [];
  }

  const connections: ConnectionCardData[] = [];

  for (const person of persons) {
    // 2. Get latest completed analyses for this person (last 2 for delta)
    const { data: analyses } = await supabase
      .from('analysis_results')
      .select('id, overall_score, created_at')
      .eq('person_id', person.id)
      .eq('processing_status', 'completed')
      .order('created_at', { ascending: false })
      .limit(2);

    if (!analyses || analyses.length === 0) continue;

    const latestAnalysis = analyses[0];
    const previousAnalysis = analyses.length > 1 ? analyses[1] : null;
    const scoreDelta = previousAnalysis
      ? latestAnalysis.overall_score - previousAnalysis.overall_score
      : 0;

    // 3. Get person archetype from latest analysis
    let archetypeTitle = '';
    let archetypeImage: string | null = null;

    const { data: archetype } = await supabase
      .from('analysis_relationship_archetypes')
      .select('archetype_title, image_url')
      .eq('analysis_id', latestAnalysis.id)
      .eq('person_type', 'person')
      .maybeSingle();

    if (archetype) {
      archetypeTitle = archetype.archetype_title || '';
      archetypeImage = archetype.image_url || null;
    }

    // 4. Get total analysis count for this person
    const { count } = await supabase
      .from('analysis_results')
      .select('id', { count: 'exact', head: true })
      .eq('person_id', person.id)
      .eq('processing_status', 'completed');

    connections.push({
      personId: person.id,
      name: person.name,
      avatar: person.avatar || null,
      currentScore: latestAnalysis.overall_score,
      scoreDelta,
      archetypeTitle,
      archetypeImage,
      lastAnalyzedAt: latestAnalysis.created_at,
      analysisCount: count || 1,
    });
  }

  return connections;
}
