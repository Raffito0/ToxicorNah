/*
  # Create user soul types table

  Stores the soul type assigned to each user (from soulTypes.ts)

  1. New Table
    - `user_soul_types`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users) - for authenticated users
      - `session_id` (text) - for anonymous/demo users
      - `soul_type_id` (text) - references soul type id like 'female-love-rush'
      - `assigned_at` (timestamptz)

  2. Security
    - Enable RLS
    - Users can only access their own soul type
*/

-- Create user_soul_types table
CREATE TABLE IF NOT EXISTS user_soul_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text,
  soul_type_id text NOT NULL,
  assigned_at timestamptz DEFAULT now(),

  -- Either user_id or session_id must be set
  CONSTRAINT user_or_session CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_soul_types_user_id ON user_soul_types(user_id);
CREATE INDEX IF NOT EXISTS idx_user_soul_types_session_id ON user_soul_types(session_id);

-- Enable RLS
ALTER TABLE user_soul_types ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users
CREATE POLICY "Users can view own soul type"
  ON user_soul_types FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own soul type"
  ON user_soul_types FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own soul type"
  ON user_soul_types FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policies for anonymous users (demo mode)
CREATE POLICY "Anonymous can view soul types by session"
  ON user_soul_types FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can insert soul types"
  ON user_soul_types FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can update soul types by session"
  ON user_soul_types FOR UPDATE
  TO anon
  USING (true);
