-- Add new columns to existing archetypes table for collectable personality cards
-- Note: archetypes table already exists from 20251116115712_create_illustrations_and_cards_system.sql

-- Drop old columns that we're replacing
ALTER TABLE archetypes
DROP COLUMN IF EXISTS description,
DROP COLUMN IF EXISTS category_number;

-- Add new columns for AI matching and personalization
ALTER TABLE archetypes
ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS semantic_tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS severity_range INT[] DEFAULT ARRAY[1, 10],
ADD COLUMN IF NOT EXISTS description_template TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS traits_pool TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS rarity TEXT DEFAULT 'common',
ADD COLUMN IF NOT EXISTS unlock_count INT DEFAULT 0;

-- Add constraint for rarity if it doesn't exist
DO $$
BEGIN
  ALTER TABLE archetypes
  ADD CONSTRAINT check_rarity CHECK (rarity IN ('common', 'rare', 'epic'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add constraint for severity_range if it doesn't exist
DO $$
BEGIN
  ALTER TABLE archetypes
  ADD CONSTRAINT check_severity_range CHECK (array_length(severity_range, 1) = 2);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Index per performance (IF NOT EXISTS supported in newer Postgres)
CREATE INDEX IF NOT EXISTS idx_archetypes_category ON archetypes(category);
CREATE INDEX IF NOT EXISTS idx_archetypes_semantic_tags ON archetypes USING GIN(semantic_tags);

-- Clear old sample data before we add new archetype system
DELETE FROM archetype_traits;
DELETE FROM archetypes;

-- Modify analysis_emotional_profiles per supportare archetypes
ALTER TABLE analysis_emotional_profiles
ADD COLUMN IF NOT EXISTS archetype_id UUID REFERENCES archetypes(id),
ADD COLUMN IF NOT EXISTS personalized_description TEXT,
ADD COLUMN IF NOT EXISTS selected_traits TEXT[],
ADD COLUMN IF NOT EXISTS behavior_patterns TEXT[],
ADD COLUMN IF NOT EXISTS severity INT,
ADD COLUMN IF NOT EXISTS ai_confidence FLOAT;

-- Add constraint for ai_confidence if it doesn't exist
DO $$
BEGIN
  ALTER TABLE analysis_emotional_profiles
  ADD CONSTRAINT check_ai_confidence CHECK (ai_confidence >= 0 AND ai_confidence <= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create user collection table per gamification
CREATE TABLE IF NOT EXISTS user_archetype_collection (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  session_id TEXT NOT NULL,
  archetype_id UUID REFERENCES archetypes(id) NOT NULL,
  unlocked_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(session_id, archetype_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_session ON user_archetype_collection(session_id);
CREATE INDEX IF NOT EXISTS idx_collection_archetype ON user_archetype_collection(archetype_id);

-- RLS Policies (drop existing ones first to avoid conflicts)
ALTER TABLE user_archetype_collection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Archetypes are viewable by everyone" ON archetypes;
DROP POLICY IF EXISTS "Users can view their own collection" ON user_archetype_collection;
DROP POLICY IF EXISTS "Users can insert into their collection" ON user_archetype_collection;

CREATE POLICY "Archetypes are viewable by everyone"
  ON archetypes FOR SELECT
  USING (true);

CREATE POLICY "Users can view their own collection"
  ON user_archetype_collection FOR SELECT
  USING (
    session_id = current_setting('app.session_id', true) OR
    user_id = auth.uid()
  );

CREATE POLICY "Users can insert into their collection"
  ON user_archetype_collection FOR INSERT
  WITH CHECK (
    session_id = current_setting('app.session_id', true) OR
    user_id = auth.uid()
  );

-- Function to increment archetype unlock counter
CREATE OR REPLACE FUNCTION increment_archetype_unlocks(p_archetype_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE archetypes
  SET unlock_count = unlock_count + 1
  WHERE id = p_archetype_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
