-- Add missing columns to analysis_emotional_profiles
-- These are needed by the new archetype matching system

ALTER TABLE analysis_emotional_profiles
ADD COLUMN IF NOT EXISTS archetype_name TEXT,
ADD COLUMN IF NOT EXISTS category_name TEXT,
ADD COLUMN IF NOT EXISTS gradient_start TEXT,
ADD COLUMN IF NOT EXISTS gradient_end TEXT;
