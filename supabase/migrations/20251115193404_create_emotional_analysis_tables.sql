-- Emotional Chat Analysis Schema
-- Creates tables for storing chat analysis data including scores, profiles, insights, and archetypes

CREATE TABLE IF NOT EXISTS chat_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overall_score integer NOT NULL DEFAULT 0,
  warmth_score integer NOT NULL DEFAULT 0,
  communication_score integer NOT NULL DEFAULT 0,
  drama_score integer NOT NULL DEFAULT 0,
  distance_score integer NOT NULL DEFAULT 0,
  passion_score integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emotional_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES chat_analyses(id) ON DELETE CASCADE,
  archetype_name text NOT NULL,
  description text NOT NULL,
  traits text[] NOT NULL DEFAULT '{}',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES chat_analyses(id) ON DELETE CASCADE,
  message_text text NOT NULL,
  surface_meaning text NOT NULL,
  deeper_meaning text NOT NULL,
  suggested_response text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relationship_archetypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES chat_analyses(id) ON DELETE CASCADE,
  person_type text NOT NULL,
  archetype_name text NOT NULL,
  traits text[] NOT NULL DEFAULT '{}',
  energy_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE chat_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE emotional_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_archetypes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to chat_analyses"
  ON chat_analyses FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public read access to emotional_profiles"
  ON emotional_profiles FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public read access to message_insights"
  ON message_insights FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public read access to relationship_archetypes"
  ON relationship_archetypes FOR SELECT
  TO public
  USING (true);