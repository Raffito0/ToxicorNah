/*
  # Illustrations and Cards Management System

  1. New Tables
    - `archetypes`
      - `id` (uuid, primary key)
      - `name` (text) - e.g., "The Ether Caller", "The Joy Bringer"
      - `description` (text)
      - `category` (text) - e.g., "EMOTIONAL TONE", "POWER BALANCE"
      - `category_number` (integer) - 1-5 for ordering
      - `created_at` (timestamptz)
      
    - `illustrations`
      - `id` (uuid, primary key)
      - `url` (text) - URL or path to the illustration
      - `tags` (text[]) - array of tags for matching (e.g., ["warm", "energetic", "positive"])
      - `category` (text) - which category this illustration fits
      - `style` (text) - illustration style (e.g., "abstract", "portrait", "nature")
      - `created_at` (timestamptz)
      
    - `archetype_traits`
      - `id` (uuid, primary key)
      - `archetype_id` (uuid, foreign key to archetypes)
      - `trait` (text) - e.g., "Communicative", "Honest", "Playful"
      - `created_at` (timestamptz)
      
    - `illustration_mappings`
      - `id` (uuid, primary key)
      - `archetype_id` (uuid, foreign key to archetypes)
      - `illustration_id` (uuid, foreign key to illustrations)
      - `priority` (integer) - higher priority illustrations shown first
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Allow public read access (for displaying cards)
    - Restrict write access to authenticated users

  3. Notes
    - This system allows flexible mapping of hundreds of illustrations to different archetypes
    - The matching logic can consider category, tags, and manual mappings
    - Priority system allows control over which illustrations appear first
*/

-- Create archetypes table
CREATE TABLE IF NOT EXISTS archetypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  category_number integer NOT NULL CHECK (category_number BETWEEN 1 AND 5),
  gradient_start text DEFAULT '#1a1f4d',
  gradient_end text DEFAULT '#0d1333',
  created_at timestamptz DEFAULT now()
);

-- Create illustrations table
CREATE TABLE IF NOT EXISTS illustrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  tags text[] DEFAULT '{}',
  category text,
  style text,
  created_at timestamptz DEFAULT now()
);

-- Create archetype_traits table
CREATE TABLE IF NOT EXISTS archetype_traits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_id uuid REFERENCES archetypes(id) ON DELETE CASCADE,
  trait text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create illustration_mappings table
CREATE TABLE IF NOT EXISTS illustration_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_id uuid REFERENCES archetypes(id) ON DELETE CASCADE,
  illustration_id uuid REFERENCES illustrations(id) ON DELETE CASCADE,
  priority integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(archetype_id, illustration_id)
);

-- Enable RLS
ALTER TABLE archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE illustrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE archetype_traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE illustration_mappings ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables
CREATE POLICY "Anyone can view archetypes"
  ON archetypes FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view illustrations"
  ON illustrations FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view archetype traits"
  ON archetype_traits FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view illustration mappings"
  ON illustration_mappings FOR SELECT
  USING (true);

-- Authenticated users can manage content
CREATE POLICY "Authenticated users can insert archetypes"
  ON archetypes FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update archetypes"
  ON archetypes FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete archetypes"
  ON archetypes FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert illustrations"
  ON illustrations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update illustrations"
  ON illustrations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete illustrations"
  ON illustrations FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert traits"
  ON archetype_traits FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update traits"
  ON archetype_traits FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete traits"
  ON archetype_traits FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert mappings"
  ON illustration_mappings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update mappings"
  ON illustration_mappings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete mappings"
  ON illustration_mappings FOR DELETE
  TO authenticated
  USING (true);

-- Insert sample data for the existing archetypes
INSERT INTO archetypes (name, description, category, category_number, gradient_start, gradient_end)
VALUES 
  ('The Ether Caller', 'Você curte músicas que a maioria das pessoas curte. Seu gosto agrada a gregos e troianos, e a popularidade dos seus sons favoritos é a prova disso.', 'EMOTIONAL TONE', 1, '#1a1f4d', '#0d1333'),
  ('The Soul Seeker', 'Your emotional depth creates meaningful connections. You bring authenticity and vulnerability to every interaction.', 'POWER BALANCE', 2, '#1a3d2e', '#0d2619'),
  ('The Joy Bringer', 'Your positive energy lights up conversations. You have a natural ability to uplift those around you.', 'TRUST & VULNERABILITY', 3, '#4d2952', '#2d1633'),
  ('The Mind Reader', 'You have an intuitive understanding of others. Your perceptive nature helps you connect on a deeper level.', 'COMPATIBILITY FLOW', 4, '#2d1f1a', '#1a0f0d'),
  ('The Heart Guardian', 'You protect emotional boundaries while staying open. Your balance creates safe spaces for connection.', 'FUTURE VIBE', 5, '#331a1f', '#1a0d10')
ON CONFLICT DO NOTHING;

-- Insert sample traits
INSERT INTO archetype_traits (archetype_id, trait)
SELECT id, trait FROM archetypes, unnest(ARRAY[
  'Communicative', 'Honest', 'Playful', 'Curious'
]) AS trait WHERE name = 'The Ether Caller';

INSERT INTO archetype_traits (archetype_id, trait)
SELECT id, trait FROM archetypes, unnest(ARRAY[
  'Thoughtful', 'Deep', 'Sincere', 'Empathetic'
]) AS trait WHERE name = 'The Soul Seeker';

INSERT INTO archetype_traits (archetype_id, trait)
SELECT id, trait FROM archetypes, unnest(ARRAY[
  'Optimistic', 'Warm', 'Energetic', 'Fun'
]) AS trait WHERE name = 'The Joy Bringer';

INSERT INTO archetype_traits (archetype_id, trait)
SELECT id, trait FROM archetypes, unnest(ARRAY[
  'Intuitive', 'Understanding', 'Wise', 'Caring'
]) AS trait WHERE name = 'The Mind Reader';

INSERT INTO archetype_traits (archetype_id, trait)
SELECT id, trait FROM archetypes, unnest(ARRAY[
  'Protective', 'Balanced', 'Trustworthy', 'Gentle'
]) AS trait WHERE name = 'The Heart Guardian';

-- Insert sample illustrations with tags for matching
INSERT INTO illustrations (url, tags, category, style)
VALUES 
  ('/openart-image_YAzAeBs2_1763112825992_raw.png', ARRAY['energetic', 'bright', 'communicative'], 'EMOTIONAL TONE', 'abstract'),
  ('/openart-image_Hrq8vg71_1763113932943_raw.png', ARRAY['deep', 'thoughtful', 'emotional'], 'POWER BALANCE', 'portrait'),
  ('/openart-image_VPdZGqfk_1763062566481_raw.png', ARRAY['warm', 'positive', 'joyful'], 'TRUST & VULNERABILITY', 'nature'),
  ('/openart-image_zemd1c7y_1763113468576_raw.jpg', ARRAY['intuitive', 'wise', 'understanding'], 'COMPATIBILITY FLOW', 'abstract'),
  ('/openart-image_dcwh5KPN_1763106498150_raw.jpg', ARRAY['protective', 'balanced', 'gentle'], 'FUTURE VIBE', 'portrait')
ON CONFLICT DO NOTHING;

-- Create mappings between archetypes and illustrations
INSERT INTO illustration_mappings (archetype_id, illustration_id, priority)
SELECT a.id, i.id, 100
FROM archetypes a
JOIN illustrations i ON i.category = a.category;
