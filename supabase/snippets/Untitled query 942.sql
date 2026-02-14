ALTER TABLE analysis_results
ADD COLUMN IF NOT EXISTS person_gender TEXT DEFAULT 'male';
