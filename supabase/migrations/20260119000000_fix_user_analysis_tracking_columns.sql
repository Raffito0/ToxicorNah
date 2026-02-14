-- Fix user_analysis_tracking column names to match code expectations
-- The code uses different column names than the original migration

-- Add columns that the code expects
ALTER TABLE user_analysis_tracking
ADD COLUMN IF NOT EXISTS has_used_first_free_analysis BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS single_unlocks_used_this_month INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS viral_bonus_unlocks_available INTEGER DEFAULT 0;

-- Copy data from old columns if they exist and new columns are empty
UPDATE user_analysis_tracking
SET has_used_first_free_analysis = COALESCE(first_analysis_completed, FALSE)
WHERE has_used_first_free_analysis IS NULL OR has_used_first_free_analysis = FALSE;

UPDATE user_analysis_tracking
SET single_unlocks_used_this_month = COALESCE(single_unlocks_this_month, 0)
WHERE single_unlocks_used_this_month = 0;

UPDATE user_analysis_tracking
SET viral_bonus_unlocks_available = COALESCE(free_bonus_unlocks, 0)
WHERE viral_bonus_unlocks_available = 0;
