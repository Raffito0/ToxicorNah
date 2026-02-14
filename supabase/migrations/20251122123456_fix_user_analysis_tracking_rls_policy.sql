/*
  # Fix user_analysis_tracking RLS policy for authenticated users

  1. Changes
    - Drop the restrictive authenticated INSERT policy
    - Create a new policy that allows authenticated users to insert with either:
      - user_id matching their auth.uid()
      - user_id being NULL (for anonymous tracking)
  
  2. Security
    - Maintains security by requiring user_id match when provided
    - Allows NULL user_id for session-based tracking
*/

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "Users can insert own tracking" ON user_analysis_tracking;

-- Create new flexible policy for authenticated users
CREATE POLICY "Users can insert own tracking"
  ON user_analysis_tracking FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);
