-- Drop existing policies
DROP POLICY IF EXISTS "Archetypes are viewable by everyone" ON archetypes;
DROP POLICY IF EXISTS "Anyone can view archetypes" ON archetypes;

-- Recreate policy allowing everyone to view archetypes
CREATE POLICY "Archetypes are viewable by everyone"
  ON archetypes FOR SELECT
  USING (true);

-- Verify it's working
SELECT * FROM archetypes LIMIT 5;