UPDATE analysis_results 
SET is_unlocked = true 
WHERE is_unlocked = false;