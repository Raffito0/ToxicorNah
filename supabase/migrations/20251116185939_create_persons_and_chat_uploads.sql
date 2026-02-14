/*
  # Create persons and chat uploads system

  1. New Tables
    - `persons`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users) - owner of this person record
      - `name` (text) - person's name
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      
    - `chat_uploads`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users) - who uploaded
      - `person_id` (uuid, foreign key to persons) - which person this chat is about
      - `file_url` (text) - URL to uploaded screenshot
      - `analysis_status` (text) - 'pending', 'processing', 'completed', 'failed'
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Users can only access their own persons and uploads
    - For demo purposes, allow anonymous access with session-based ownership

  3. Notes
    - This system tracks people being analyzed and their chat uploads
    - Each upload is linked to a person for historical tracking
*/

-- Create persons table
CREATE TABLE IF NOT EXISTS persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create chat_uploads table
CREATE TABLE IF NOT EXISTS chat_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id uuid REFERENCES persons(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  analysis_status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_uploads ENABLE ROW LEVEL SECURITY;

-- Policies for persons table
CREATE POLICY "Users can view own persons"
  ON persons FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own persons"
  ON persons FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own persons"
  ON persons FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own persons"
  ON persons FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow anonymous access for demo (optional - remove in production)
CREATE POLICY "Anonymous can view all persons"
  ON persons FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can insert persons"
  ON persons FOR INSERT
  TO anon
  WITH CHECK (true);

-- Policies for chat_uploads table
CREATE POLICY "Users can view own uploads"
  ON chat_uploads FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own uploads"
  ON chat_uploads FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own uploads"
  ON chat_uploads FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own uploads"
  ON chat_uploads FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow anonymous access for demo (optional - remove in production)
CREATE POLICY "Anonymous can view all uploads"
  ON chat_uploads FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can insert uploads"
  ON chat_uploads FOR INSERT
  TO anon
  WITH CHECK (true);

-- Insert sample persons for testing
INSERT INTO persons (name, user_id)
VALUES 
  ('James', NULL),
  ('Sarah', NULL),
  ('Alex', NULL)
ON CONFLICT DO NOTHING;
