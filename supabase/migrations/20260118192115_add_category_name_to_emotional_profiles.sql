-- Add category_name column to analysis_emotional_profiles table
ALTER TABLE analysis_emotional_profiles
ADD COLUMN IF NOT EXISTS category_name TEXT;

-- Update existing records with default category names based on display_order
UPDATE analysis_emotional_profiles
SET category_name = CASE
  WHEN display_order % 5 = 0 THEN 'Emotional Tone'
  WHEN display_order % 5 = 1 THEN 'Power Balance'
  WHEN display_order % 5 = 2 THEN 'Red Flags & Green Flags'
  WHEN display_order % 5 = 3 THEN 'Attachment Style'
  WHEN display_order % 5 = 4 THEN 'Chemistry'
END
WHERE category_name IS NULL;
