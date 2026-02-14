/*
  # Allow viewing demo persons
  
  1. Changes
    - Add policy to allow authenticated users to view persons with NULL user_id
    - This enables demo/shared persons to be visible to all users
*/

CREATE POLICY "Users can view demo persons"
  ON persons
  FOR SELECT
  TO authenticated
  USING (user_id IS NULL);
