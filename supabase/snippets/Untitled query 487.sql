-- Temporarily disable RLS to test
ALTER TABLE archetypes DISABLE ROW LEVEL SECURITY;

-- Verify it works
SELECT COUNT(*) FROM archetypes;