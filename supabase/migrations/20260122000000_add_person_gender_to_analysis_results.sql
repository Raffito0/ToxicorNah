-- Add person_gender column to analysis_results table
-- This column stores the detected gender of the analyzed person ('male' or 'female')

ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS person_gender TEXT DEFAULT 'male';

-- Add comment for documentation
COMMENT ON COLUMN analysis_results.person_gender IS 'Gender of the analyzed person (male/female), used for UI text like "How Toxic He Is" vs "How Toxic She Is"';
